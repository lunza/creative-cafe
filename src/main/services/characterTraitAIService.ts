/**
 * AI 辅助角色特征生成服务（主进程）
 *
 * Spec: add-asset-and-trait-management / Task 12
 *
 * 用途：
 *  - 基于角色卡的 description / personality / scenario 字段，
 *    调用现有 AI 引擎（OpenAI 兼容 /v1/chat/completions 端点）自动提取视觉特征 tag 列表
 *  - 输出的 tag 列表（如 `["white fur", "dog girl", "blue eyes", "black shirt"]`）
 *    可直接写入 characterTraitService 持久化，供 SD 生成时携带以保证角色一致性
 *
 * 复用基础设施：
 *  - AIConfigProvider（src/main/services/ai/AIConfigProvider.ts）：读取激活引擎的
 *    baseUrl / apiKey / apiKeyTransmission / systemPrompt / modelName
 *  - 与 DescriptionPolisher / OutlineGenerator 一致的 fetch + /v1/chat/completions 调用模式
 *  - 采用非流式调用（特征提取任务输出短，无需流式）
 *
 * 与 characterTraitService 的关系：
 *  - 本服务只负责「生成」特征 tag，不负责持久化
 *  - 持久化由 characterTraitService.saveTraits 负责，前端拿到 traits 后自行调用
 *  - 解耦使本服务可独立测试与复用（例如未来可接入批量生成）
 *
 * 错误处理约定（SubTask 12.4）：
 *  - 任何步骤失败返回 `{ success: false, error: 友好信息 }`，不抛异常
 *  - AI 引擎未配置：返回「AI 引擎未配置，请先在设置中配置 API」
 *  - 调用失败（网络/超时/HTTP 错误）：返回「AI 调用失败：<具体原因>」
 *  - 返回格式异常（空内容/无法解析）：返回「AI 返回内容无法解析为 tag 列表」
 *  - 日志前缀 `[CharacterTraitAI]`，与 characterTraitService 的 `[CharacterTraitService]` 区分
 */

import * as fsSync from 'fs';
import { aiConfigProvider } from './ai/AIConfigProvider';
import { getStorageService } from './storageService';
import type { ChatMessage } from './AIService';

/**
 * 角色特征生成入参。
 * - characterCardId：角色卡 ID（即角色卡 PNG 文件路径，用于日志关联；当 includeImage=true 时也用于读取图片）
 * - description：角色描述（必填，LLM 主要依据）
 * - personality：角色性格（可选，补充上下文）
 * - scenario：角色场景（可选，补充上下文）
 * - includeImage：是否将角色卡 PNG 图片一并发送给多模态模型（仅当 AI 引擎 supportsVision=true 时有效）
 */
export interface GenerateCharacterTraitsParams {
  characterCardId: string;
  description: string;
  personality?: string;
  scenario?: string;
  /** 是否附带角色卡图片（多模态模型综合文本+图片提取特征） */
  includeImage?: boolean;
}

/**
 * 角色特征生成返回值。
 * - success=true 时 traits 为去重后的 tag 字符串数组（可能为空数组，表示 LLM 未提取到任何特征）
 * - success=false 时 error 为友好错误信息（非堆栈）
 */
export interface GenerateCharacterTraitsResult {
  success: boolean;
  traits?: string[];
  /** 角色外观描述（中文自然语言，2-4 句话，描述体型/发色/瞳色/服饰/配饰/种族等） */
  appearanceDescription?: string;
  error?: string;
}

/**
 * 图片识别特征提取入参（Spec: add-model-capability-detection-and-image-recognition / Task 6）。
 * - characterCardPath：角色卡 PNG 图片路径（必填，读取后转 base64 data URI 发送给多模态模型）
 * - characterName：角色名（可选，注入 user message 提供上下文）
 */
export interface RecognizeImageTraitsParams {
  characterCardPath: string;
  characterName?: string;
}

/**
 * 专用系统提示词（SubTask 12.2）。
 *
 * 设计要点：
 *  - 明确角色（角色视觉特征提取助手）与目标（输出 SD 提示词格式 tag）
 *  - 列出提取范围（物种/毛色发色/瞳色/服饰/配饰/其他显著特征）保证覆盖面
 *  - 4 条硬性要求：英文 tag / 逗号分隔 / 简洁 / 不臆测
 *  - 提供输出示例，降低 LLM 输出自然语言句子的概率
 *  - 与用户消息分开放置：system 中只放指令，description/personality/scenario 由调用方拼入 user 消息
 */
const CHARACTER_TRAIT_SYSTEM_PROMPT = `你是一个角色视觉特征提取助手。请从给定的角色描述中提取角色的视觉外观特征，输出为逗号分隔的英文 tag 列表，用于 Stable Diffusion 图像生成，并同时输出一段中文角色外观描述。

提取范围：
- 物种/种族（如 dog girl, cat boy, human, elf）
- 毛色/发色（如 white fur, black hair, blonde hair）
- 瞳色（如 blue eyes, red eyes）
- 服饰（如 black shirt, school uniform, dress）
- 配饰（like glasses, ribbon, hat）
- 其他显著视觉特征（如 animal ears, tail, wings）

要求：
1. 首先输出一行英文 tag，逗号分隔，不要编号、不要自然语言句子、不要解释
2. 然后输出一行 "---DESCRIPTION---" 作为分隔符
3. 最后输出一段中文角色外观描述（2-4句话），描述角色的整体视觉外观，包括体型、发色发型、瞳色、服饰、配饰、种族等
4. 输出示例：
white fur, dog girl, blue eyes, black shirt, animal ears
---DESCRIPTION---
一位犬耳少女，拥有洁白的毛发和蓝色的眼睛。身穿黑色衬衫，头上有一对毛茸茸的犬耳。体型娇小，整体风格偏可爱。`;

/**
 * 图片识别专用系统提示词（Spec: add-model-capability-detection-and-image-recognition / Task 6）。
 *
 * 与 CHARACTER_TRAIT_SYSTEM_PROMPT 的区别：
 *  - 面向多模态视觉模型，输入是角色卡 PNG 图片而非文本描述
 *  - 英文指令（视觉模型英文覆盖更广）
 *  - 提取范围更广：含 body type / skin tone / ethnicity / species，覆盖图片可见的全部视觉特征
 *  - 输出仍为英文逗号分隔 SD tag，复用 parseTraitsFromContent 解析
 */
const IMAGE_TRAIT_SYSTEM_PROMPT = `You are a visual character analyst. Analyze the character image and extract visual features as English comma-separated tags for Stable Diffusion. Include: hair color, hair style, eye color, body type, clothing, accessories, skin tone, ethnicity, species (if non-human), distinctive features.

Output format requirements:
1. First, output ONE line of English tags separated by commas, no numbering, no explanations.
2. Then output a line "---DESCRIPTION---" as a separator.
3. Finally, output a Chinese character appearance description (2-4 sentences) describing the overall visual appearance, including body type, hair color/style, eye color, clothing, accessories, species/race, etc.

Output example:
white hair, red eyes, school uniform, cat ears
---DESCRIPTION---
一位猫耳少女，拥有白色长发和红色的眼睛。身穿学校制服，头上有一对白色的猫耳。体型纤细，整体风格偏清纯。`;

/**
 * AI 辅助角色特征生成服务。
 *
 * 设计原则：
 *  - 无状态：每次调用实时读取 AI 引擎配置，不缓存
 *  - 永不抛异常：所有错误转为 `{ success: false, error }` 返回
 *  - 复用 aiConfigProvider：与 writing/* 服务共享配置入口
 *  - 非流式调用：特征 tag 输出短，无需流式
 */
class CharacterTraitAIService {
  /**
   * 生成角色视觉特征 tag 列表。
   *
   * 流程：
   *  1. 读取 AI 引擎配置（baseUrl / apiKey / modelName / systemPrompt / apiKeyTransmission）
   *  2. 校验 baseUrl / apiKey / modelName 是否齐备，缺失返回友好错误
   *  3. 读取引擎的 temperature / max_tokens（缺失时使用默认值 0.3 / 512）
   *  4. 构建 system + user 消息，注入引擎 systemPrompt（与 OutlineGenerator 一致）
   *  5. 非流式 POST /v1/chat/completions
   *  6. 解析 data.choices[0].message.content，提取逗号分隔 tag
   *  7. trim 每项，过滤空字符串，去重，保留原顺序
   *
   * @param params 入参，详见 GenerateCharacterTraitsParams
   * @returns 详见 GenerateCharacterTraitsResult
   */
  async generateCharacterTraits(
    params: GenerateCharacterTraitsParams
  ): Promise<GenerateCharacterTraitsResult> {
    const { characterCardId, description, personality, scenario, includeImage } = params;

    try {
      // 入参校验
      if (!characterCardId) {
        return { success: false, error: 'characterCardId 不能为空' };
      }
      if (!description || !description.trim()) {
        return { success: false, error: '角色描述为空，无法提取视觉特征' };
      }

      // 1. 读取 AI 引擎配置
      const aiConfig = aiConfigProvider.getAIConfig({ defaultTransmission: 'header' });
      const baseUrl = aiConfig.baseUrl;
      const apiKey = aiConfig.apiKey;
      const apiKeyTransmission = aiConfig.apiKeyTransmission;
      const engineSystemPrompt = aiConfig.systemPrompt || '';
      const modelName = aiConfig.modelName;

      // 2. 配置兜底校验（SubTask 12.4）
      if (!baseUrl) {
        console.warn('[CharacterTraitAI] AI 引擎未配置 baseUrl');
        return {
          success: false,
          error: 'AI 引擎未配置，请先在设置中配置 API',
        };
      }
      if (!apiKey) {
        console.warn('[CharacterTraitAI] AI 引擎未配置 apiKey');
        return {
          success: false,
          error: 'AI 引擎未配置，请先在设置中配置 API',
        };
      }
      if (!modelName) {
        console.warn('[CharacterTraitAI] AI 引擎未配置 modelName');
        return {
          success: false,
          error: 'AI 引擎未配置，请先在设置中配置 API',
        };
      }

      // 3. 读取引擎运行时参数（temperature / max_tokens）
      // 【重点标记 - 项目最高优先级规则】禁止使用 AI 参数默认值：
      // 缺失时返回友好错误（不抛异常、不静默使用 fallback），与 WritingStyleLearningService
      // 抛 '未配置 AI 温度参数/最大令牌数' 错误的语义一致，符合技术文档
      // 「禁止设置 AI 参数默认值」规则（实施日期 2026-05-24）
      const runtimeConfig = this.getEngineRuntimeConfig();
      if (!runtimeConfig) {
        return {
          success: false,
          error: 'AI 引擎未配置 temperature 或 max_tokens 参数，请在设置中配置 AI 引擎',
        };
      }
      const { temperature, maxTokens } = runtimeConfig;

      // 4. 构建 messages
      // 【重点标记 - 多模态综合特征提取】当 includeImage=true 时，将角色卡 PNG 图片
      // 与文本描述一并发送给多模态模型，综合图片视觉信息 + 文本描述提取更完整的特征 tag。
      const userContent = this.buildUserMessage(description, personality, scenario);

      let messages: Array<{ role: 'system' | 'user'; content: string | Array<{ type: 'text'; text: string } | { type: 'image_url'; image_url: { url: string } }> }>;

      if (includeImage) {
        // 读取角色卡 PNG 图片为 base64 data URI
        try {
          const imageBuffer = fsSync.readFileSync(characterCardId);
          const base64Image = imageBuffer.toString('base64');
          const dataUri = `data:image/png;base64,${base64Image}`;
          messages = [
            { role: 'system', content: CHARACTER_TRAIT_SYSTEM_PROMPT + '\n\nIn addition to the text description, a character image is provided. Please analyze BOTH the image and the text description to extract comprehensive visual feature tags AND write a Chinese appearance description. Prioritize features visible in the image, and use the text description to fill in any gaps. Remember to output the tags first, then the "---DESCRIPTION---" separator, then the Chinese description.' },
            {
              role: 'user',
              content: [
                { type: 'text', text: userContent },
                { type: 'image_url', image_url: { url: dataUri } },
              ],
            },
          ];
          console.log('[CharacterTraitAI] includeImage=true, sending multimodal request with character card image');
        } catch (imgError) {
          console.warn('[CharacterTraitAI] Failed to read character card image, falling back to text-only:', imgError);
          messages = [
            { role: 'system', content: CHARACTER_TRAIT_SYSTEM_PROMPT },
            { role: 'user', content: userContent },
          ];
        }
      } else {
        messages = [
          { role: 'system', content: CHARACTER_TRAIT_SYSTEM_PROMPT },
          { role: 'user', content: userContent },
        ];
      }
      // 注入引擎级 system prompt（与 OutlineGenerator.enrichSystemPrompt 一致）
      const enrichedMessages = this.enrichSystemPrompt(messages, engineSystemPrompt);

      // 5. 构建请求头与请求体
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
      };
      const requestBody: Record<string, any> = {
        model: modelName,
        messages: enrichedMessages,
        temperature,
        max_tokens: maxTokens,
        stream: false,
      };
      if (apiKey) {
        if (apiKeyTransmission === 'header') {
          const authValue = apiKey.trim().startsWith('Bearer ') ? apiKey : `Bearer ${apiKey}`;
          headers['Authorization'] = authValue;
        } else {
          requestBody.api_key = apiKey;
        }
      }

      console.log('[CharacterTraitAI] Calling LLM for characterCardId:', characterCardId, {
        baseUrl,
        modelName,
        apiKeyTransmission,
        temperature,
        maxTokens,
        descriptionLength: description.length,
      });

      // 6. 非流式调用 LLM
      const response = await fetch(`${baseUrl}/v1/chat/completions`, {
        method: 'POST',
        headers,
        body: JSON.stringify(requestBody),
      });

      if (!response.ok) {
        const errorText = await response.text().catch(() => '');
        console.error('[CharacterTraitAI] LLM request failed:', response.status, response.statusText, errorText);
        return {
          success: false,
          error: `AI 调用失败：HTTP ${response.status} ${response.statusText}`,
        };
      }

      const data = await response.json();
      const content: string | undefined = data?.choices?.[0]?.message?.content;

      if (!content || typeof content !== 'string' || !content.trim()) {
        console.error('[CharacterTraitAI] LLM returned empty content:', data);
        return {
          success: false,
          error: 'AI 返回内容无法解析为 tag 列表',
        };
      }

      // 7. 解析响应：提取逗号分隔的 tag + 角色外观描述
      const { traits, appearanceDescription } = this.parseTraitsAndDescription(content);

      console.log('[CharacterTraitAI] Generated traits:', traits.length, 'tags for characterCardId:', characterCardId, 'hasDescription:', !!appearanceDescription);

      return { success: true, traits, appearanceDescription };
    } catch (error) {
      console.error('[CharacterTraitAI] generateCharacterTraits failed:', error);
      // 网络错误 / 超时 / JSON 解析错误 等统一兜底
      const message = error instanceof Error ? error.message : String(error);
      // 友好化常见错误
      if (message.includes('fetch failed') || message.toLowerCase().includes('network')) {
        return {
          success: false,
          error: 'AI 调用失败：无法连接到 AI 服务，请检查网络或 API 地址',
        };
      }
      if (message.toLowerCase().includes('abort') || message.toLowerCase().includes('timeout')) {
        return {
          success: false,
          error: 'AI 调用失败：请求超时，请稍后重试',
        };
      }
      return {
        success: false,
        error: `AI 调用失败：${message}`,
      };
    }
  }

  /**
   * 通过多模态模型识别角色卡图片，提取视觉特征 tag 列表（Spec: add-model-capability-detection-and-image-recognition / Task 6）。
   *
   * 与 generateCharacterTraits 的区别：
   *  - 输入是角色卡 PNG 图片（base64 data URI），而非文本描述
   *  - 需要模型支持视觉输入（supportsVision=true，由前端判断，本方法不重复检测）
   *  - 使用 IMAGE_TRAIT_SYSTEM_PROMPT（英文指令，覆盖范围更广）
   *  - user message 为多模态 content（text + image_url），复用 ChatMessage 联合类型（Task 1）
   *
   * 流程：
   *  1. 读取 AI 引擎配置（baseUrl / apiKey / modelName / apiKeyTransmission / systemPrompt）
   *  2. 读取引擎运行时参数 temperature / max_tokens（复用 getEngineRuntimeConfig，遵守禁止默认值规则）
   *  3. 读取角色卡 PNG 为 base64，构建 data URI
   *  4. 构建 system + 多模态 user 消息（ChatMessage[]，含 image_url）
   *  5. 非流式 POST /v1/chat/completions
   *  6. 解析 data.choices[0].message.content，复用 parseTraitsFromContent
   *
   * @param params 入参，详见 RecognizeImageTraitsParams
   * @returns 详见 GenerateCharacterTraitsResult（复用同一返回类型）
   */
  async recognizeImageTraits(
    params: RecognizeImageTraitsParams
  ): Promise<GenerateCharacterTraitsResult> {
    const { characterCardPath, characterName } = params;

    try {
      // 入参校验
      if (!characterCardPath) {
        return { success: false, error: 'characterCardPath 不能为空' };
      }

      // 1. 读取 AI 引擎配置
      const aiConfig = aiConfigProvider.getAIConfig({ defaultTransmission: 'header' });
      const baseUrl = aiConfig.baseUrl;
      const apiKey = aiConfig.apiKey;
      const apiKeyTransmission = aiConfig.apiKeyTransmission;
      const engineSystemPrompt = aiConfig.systemPrompt || '';
      const modelName = aiConfig.modelName;

      // 2. 配置兜底校验
      if (!baseUrl) {
        console.warn('[CharacterTraitAI] recognizeImageTraits: AI 引擎未配置 baseUrl');
        return {
          success: false,
          error: 'AI 引擎未配置，请先在设置中配置 API',
        };
      }
      if (!apiKey) {
        console.warn('[CharacterTraitAI] recognizeImageTraits: AI 引擎未配置 apiKey');
        return {
          success: false,
          error: 'AI 引擎未配置，请先在设置中配置 API',
        };
      }
      if (!modelName) {
        console.warn('[CharacterTraitAI] recognizeImageTraits: AI 引擎未配置 modelName');
        return {
          success: false,
          error: 'AI 引擎未配置，请先在设置中配置 API',
        };
      }

      // 3. 读取引擎运行时参数（temperature / max_tokens）
      // 【项目最高优先级规则】禁止使用 AI 参数默认值，复用 getEngineRuntimeConfig
      const runtimeConfig = this.getEngineRuntimeConfig();
      if (!runtimeConfig) {
        return {
          success: false,
          error: 'AI 引擎未配置 temperature 或 max_tokens 参数，请在设置中配置 AI 引擎',
        };
      }
      const { temperature, maxTokens } = runtimeConfig;

      // 4. 读取角色卡 PNG 为 base64 data URI
      let dataUri: string;
      try {
        const imageBuffer = fsSync.readFileSync(characterCardPath);
        const base64 = imageBuffer.toString('base64');
        dataUri = `data:image/png;base64,${base64}`;
      } catch (readError) {
        console.error('[CharacterTraitAI] recognizeImageTraits: 读取角色卡图片失败:', readError);
        return {
          success: false,
          error: `读取角色卡图片失败：${readError instanceof Error ? readError.message : String(readError)}`,
        };
      }

      // 5. 构建 messages（多模态）
      // 注入引擎级 system prompt（与 generateCharacterTraits.enrichSystemPrompt 语义一致）
      const systemContent = engineSystemPrompt && engineSystemPrompt.trim()
        ? `${engineSystemPrompt.trim()}\n\n${IMAGE_TRAIT_SYSTEM_PROMPT}`
        : IMAGE_TRAIT_SYSTEM_PROMPT;

      const userText = characterName
        ? `Analyze this character image of ${characterName} and extract visual feature tags.`
        : 'Analyze this character image and extract visual feature tags.';

      const messages: ChatMessage[] = [
        { role: 'system', content: systemContent },
        {
          role: 'user',
          content: [
            { type: 'text', text: userText },
            { type: 'image_url', image_url: { url: dataUri } },
          ],
        },
      ];

      // 6. 构建请求头与请求体
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
      };
      const requestBody: Record<string, any> = {
        model: modelName,
        messages,
        temperature,
        max_tokens: maxTokens,
        stream: false,
      };
      if (apiKey) {
        if (apiKeyTransmission === 'header') {
          const authValue = apiKey.trim().startsWith('Bearer ') ? apiKey : `Bearer ${apiKey}`;
          headers['Authorization'] = authValue;
        } else {
          requestBody.api_key = apiKey;
        }
      }

      console.log('[CharacterTraitAI] recognizeImageTraits: Calling multimodal LLM:', {
        baseUrl,
        modelName,
        apiKeyTransmission,
        temperature,
        maxTokens,
        characterCardPath,
        characterName,
      });

      // 7. 非流式调用 LLM
      const response = await fetch(`${baseUrl}/v1/chat/completions`, {
        method: 'POST',
        headers,
        body: JSON.stringify(requestBody),
      });

      if (!response.ok) {
        const errorText = await response.text().catch(() => '');
        console.error('[CharacterTraitAI] recognizeImageTraits: LLM request failed:', response.status, response.statusText, errorText);
        return {
          success: false,
          error: `AI 调用失败：HTTP ${response.status} ${response.statusText}`,
        };
      }

      const data = await response.json();
      const content: string | undefined = data?.choices?.[0]?.message?.content;

      if (!content || typeof content !== 'string' || !content.trim()) {
        console.error('[CharacterTraitAI] recognizeImageTraits: LLM returned empty content:', data);
        return {
          success: false,
          error: 'AI 返回内容无法解析为 tag 列表',
        };
      }

      // 8. 解析响应：复用 parseTraitsAndDescription 提取 tag + 角色外观描述
      const { traits, appearanceDescription } = this.parseTraitsAndDescription(content);

      console.log('[CharacterTraitAI] recognizeImageTraits: Generated traits:', traits.length, 'tags for:', characterCardPath, 'hasDescription:', !!appearanceDescription);

      return { success: true, traits, appearanceDescription };
    } catch (error) {
      console.error('[CharacterTraitAI] recognizeImageTraits failed:', error);
      const message = error instanceof Error ? error.message : String(error);
      if (message.includes('fetch failed') || message.toLowerCase().includes('network')) {
        return {
          success: false,
          error: 'AI 调用失败：无法连接到 AI 服务，请检查网络或 API 地址',
        };
      }
      if (message.toLowerCase().includes('abort') || message.toLowerCase().includes('timeout')) {
        return {
          success: false,
          error: 'AI 调用失败：请求超时，请稍后重试',
        };
      }
      return {
        success: false,
        error: `AI 调用失败：${message}`,
      };
    }
  }

  /**
   * 读取激活引擎的 temperature / max_tokens 运行时配置。
   *
   * 【项目最高优先级规则】禁止使用 AI 参数默认值：
   * 任一字段缺失（或类型非 number）即返回 null，由调用方返回友好错误。
   * 与 WritingStyleLearningService.getTemperature / getMaxTokens 抛错语义一致，
   * 仅改为返回 null 以适配本 service「不抛异常」的错误兜底约定。
   *
   * @returns `{ temperature, maxTokens }` 或 null（任一字段缺失时）
   */
  private getEngineRuntimeConfig(): { temperature: number; maxTokens: number } | null {
    try {
      const storageService = getStorageService();
      const settings = storageService.getSettings();
      const engines = settings?.aiEngines || [];
      if (engines.length === 0) {
        return null;
      }
      const activeEngine = engines.find((e: any) => e.id === settings?.activeEngineId) || engines[0];
      const temperature = activeEngine?.temperature;
      const maxTokens = activeEngine?.max_tokens;
      if (typeof temperature !== 'number' || typeof maxTokens !== 'number') {
        return null;
      }
      return { temperature, maxTokens };
    } catch (error) {
      console.warn('[CharacterTraitAI] getEngineRuntimeConfig failed:', error);
      return null;
    }
  }

  /**
   * 构建用户消息：拼接 description + personality + scenario。
   * 空字段不拼入，避免向 LLM 暴露空段落。
   */
  private buildUserMessage(
    description: string,
    personality?: string,
    scenario?: string
  ): string {
    const parts: string[] = [];
    parts.push(`角色描述：\n${description.trim()}`);
    if (personality && personality.trim()) {
      parts.push(`角色性格：\n${personality.trim()}`);
    }
    if (scenario && scenario.trim()) {
      parts.push(`角色场景：\n${scenario.trim()}`);
    }
    parts.push('请输出视觉特征 tag 列表：');
    return parts.join('\n\n');
  }

  /**
   * 将引擎级 system prompt 注入到首个 system message 前面。
   * 与 OutlineGenerator.enrichSystemPrompt / AIService.enrichSystemPrompt 行为一致。
   *
   * 【重点标记 - 多模态兼容】content 类型扩展为联合类型以支持多模态消息。
   * 经审计验证：所有调用方（generateCharacterTraits）构建的首条 system message 的 content
   * 始终为 string（CHARACTER_TRAIT_SYSTEM_PROMPT 或其字符串拼接），
   * 多模态 image_url 数组仅出现在 user message 中，因此 index===0 分支的字符串拼接逻辑安全、不受影响。
   * recognizeImageTraits 路径不经过此方法（system prompt 在调用前已内联拼接为字符串）。
   */
  private enrichSystemPrompt(
    messages: Array<{ role: 'system' | 'user'; content: string | Array<{ type: 'text'; text: string } | { type: 'image_url'; image_url: { url: string } }> }>,
    engineSystemPrompt: string
  ): Array<{ role: 'system' | 'user'; content: string | Array<{ type: 'text'; text: string } | { type: 'image_url'; image_url: { url: string } }> }> {
    if (!engineSystemPrompt || !engineSystemPrompt.trim()) {
      return messages;
    }
    return messages.map((msg, index) => {
      if (index === 0 && msg.role === 'system') {
        return {
          role: 'system' as const,
          content: engineSystemPrompt.trim() + '\n\n' + msg.content,
        };
      }
      return msg;
    });
  }

  /**
   * 解析 LLM 返回内容为 tag 数组 + 角色外观描述。
   *
   * 内容结构：tag 行 + "---DESCRIPTION---" 分隔符 + 中文描述段落。
   * - 若存在分隔符：分隔符之前按 tag 解析，分隔符之后为描述（trim）
   * - 若不存在分隔符：整体按 tag 解析，描述为空串（向后兼容旧模型输出）
   *
   * @returns `{ traits, appearanceDescription }`
   */
  private parseTraitsAndDescription(content: string): { traits: string[]; appearanceDescription: string } {
    const separator = '---DESCRIPTION---';
    const parts = content.split(separator);
    const tagContent = parts[0] || content;
    const descContent = parts.length > 1 ? parts.slice(1).join(separator).trim() : '';
    const traits = this.parseTraitsFromContent(tagContent);
    return { traits, appearanceDescription: descContent };
  }

  /**
   * 解析 LLM 返回内容为 tag 数组。
   *
   * 处理步骤：
   *  1. 按逗号分隔（兼容中英文逗号）
   *  2. trim 每项
   *  3. 过滤空字符串
   *  4. 移除可能的前缀编号（如 "1. " / "- " / "* "）
   *  5. 去重，保留首次出现的顺序
   *
   * 鲁棒性：
   *  - LLM 偶尔会输出多行（每行一个 tag 或一段含逗号的句子），统一按逗号 + 换行切分
   *  - LLM 偶尔会输出编号列表，移除前缀
   *  - LLM 偶尔会输出尾部的句号/分号，trim 掉
   */
  private parseTraitsFromContent(content: string): string[] {
    // 同时按英文逗号、中文逗号、换行、分号切分
    const tokens = content.split(/[,，\n;；]+/);
    const seen = new Set<string>();
    const result: string[] = [];
    for (let raw of tokens) {
      let tag = raw.trim();
      if (!tag) continue;
      // 移除前缀编号：如 "1. " / "1) " / "- " / "* " / "1、"
      tag = tag.replace(/^[\d]+[.)、]\s*/, '').replace(/^[-*]\s*/, '');
      // 移除尾部句号/冒号
      tag = tag.replace(/[.。:：]+$/, '').trim();
      if (!tag) continue;
      // 去重（大小写敏感，与 SD 提示词语义一致）
      if (seen.has(tag)) continue;
      seen.add(tag);
      result.push(tag);
    }
    return result;
  }
}

/**
 * 单例导出。与 characterTraitService / assetService / expressionService 单例模式一致。
 */
export const characterTraitAIService = new CharacterTraitAIService();
