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
import { categoryDictionaryService } from './categoryDictionaryService';
import {
  SYSTEM_TRAIT_CATEGORIES,
  UNCATEGORIZED_CATEGORY_ID,
  type CategorizedTrait,
  type TraitCategory,
} from '../../shared/types/characterTrait.types';

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
 * - success=true 时 traits 为去重后的「带分类」特征项数组（可能为空数组，表示 LLM 未提取到任何特征）
 * - success=false 时 error 为友好错误信息（非堆栈）
 *
 * 【重点标记 - AI 自动归类增强】traits 由 `string[]` 升级为 `CategorizedTrait[]`
 *  - 原 Spec「AI 集成适配」规定 AI 返回 `string[]`、新特征落入「未分类」
 *  - 本次增强：AI 输出 `分类:tag` 形式，解析后携带 categoryId 透传到 store
 *  - store `setTraits` 据此将特征放入对应系统分类，无需用户手动归类
 *  - 兼容性：AI 未输出分类前缀时 categoryId 兜底为 `UNCATEGORIZED_CATEGORY_ID`，行为等价于原 Spec
 */
export interface GenerateCharacterTraitsResult {
  success: boolean;
  traits?: CategorizedTrait[];
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
 * 动态场景提示词生成入参（Spec: add-dynamic-scene-prompt-generation / Task 2）。
 *
 * 设计动机：
 *  - 与 `GenerateCharacterTraitsParams`（基于角色卡描述提取「固有」特征）正交，
 *    本接口处理「一次性」场景指令：用户输入自然语言命令，由 LLM 解析为三组英文 SD tag
 *  - 三组 tag 与 `DynamicScenePrompt`（clothing / pose / scene）一一对应，下游通过占位符
 *    `{clothing}` / `{pose}` / `{scene}` 注入 SD 生成链路
 *
 * 字段语义：
 *  - `naturalLanguageInput`：用户原始自然语言指令（中文/英文均可，必填非空）
 *    示例：「让角色穿上一套哥特风的衣服，骑着摩托驰骋在高速公路上」
 *  - `baseTraits`：角色基础特征拼接字符串（可选，给 LLM 提供角色上下文避免生成矛盾 tag）
 *    示例：`"white fur, dog girl, blue eyes, tail"` —— LLM 应避免生成 `no tail` 等矛盾 tag
 */
export interface GenerateDynamicScenePromptsParams {
  /** 用户的自然语言指令（中文/英文均可，必填，非空字符串；空/纯空白触发兜底错误） */
  naturalLanguageInput: string;
  /**
   * 角色基础特征拼接字符串（可选，用于给 LLM 提供角色上下文，
   * 避免生成的服装/姿势与角色已有特征冲突——例如基础特征有 "tail"，
   * LLM 应避免生成 "no tail" 等矛盾 tag）
   */
  baseTraits?: string;
}

/**
 * 动态场景提示词生成返回值（Spec: add-dynamic-scene-prompt-generation / Task 2）。
 *
 * 字段语义：
 *  - `success=true` 时返回 `clothing` / `pose` / `scene` 三组英文 SD tag 字符串
 *    （未提及的维度为空字符串 `""`，与 spec「未提及的维度返回空」一致）
 *  - `success=false` 时返回 `error` 友好信息（不抛异常，与 `GenerateCharacterTraitsResult` 约定一致）
 *
 * 与 `GenerateCharacterTraitsResult` 的区别：
 *  - 不返回 `CategorizedTrait[]`，因为动态场景 tag 已按 clothing / pose / scene 三个维度分组，
 *    无需再走 `parseTraitsFromContent` 的「分类:tag」解析
 *  - 不返回 `appearanceDescription`，因为本接口只解析场景指令，不生成角色外观描述
 */
export interface GenerateDynamicScenePromptsResult {
  success: boolean;
  /** 服装相关英文 SD tag 字符串（逗号分隔，未提及时为空字符串 ""） */
  clothing?: string;
  /** 动作/姿势英文 SD tag 字符串（逗号分隔，未提及时为空字符串 ""） */
  pose?: string;
  /** 场景/环境英文 SD tag 字符串（逗号分隔，未提及时为空字符串 ""） */
  scene?: string;
  error?: string;
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
 *
 * 【重点标记 - AI 自动归类增强】原提示词输出扁平 `tag` 列表，本次升级为「分类:tag」格式：
 *  - 每条 tag 前缀系统分类标签（basic / head / body / clothing / background / pose / expression）
 *  - LLM 据语义自行判断每条特征所属分类，由主进程 parseTraitsFromContent 解析剥离前缀
 *  - 兼容性：LLM 偶发不输出前缀时，parseTraitsFromContent 兜底归入 uncategorized
 *
 * 【重点标记 - AI 不生成自定义分类 tag 的 bug 修复】Spec: fix-asset-trait-and-scene-defects / Task 5
 *  - 本常量硬编码 7 个系统分类，LLM 不知道用户创建的自定义分类（如「纹身」「武器装备」），
 *    导致 AI 不会为这些分类生成 `tattoo:dragon tattoo` 等带前缀的 tag
 *  - 现已改为动态构建：`generateCharacterTraits` 调用 `buildDynamicTraitSystemPrompt(globalCategories)`
 *    将系统分类 + 全局字典自定义分类合并注入提示词
 *  - 本常量保留作为基线参考（文档化 prompt 结构），不再直接用于生产调用
 */
export const CHARACTER_TRAIT_SYSTEM_PROMPT = `你是一个角色视觉特征提取助手。请从给定的角色描述中提取角色的视觉外观特征，并为每个特征分配一个分类标签，输出为逗号分隔的「分类:tag」列表，用于 Stable Diffusion 图像生成，并同时输出一段中文角色外观描述。

分类体系（必须使用以下英文分类标签作为前缀，与「分类:tag」中的「分类」对应）：
- basic：基本特征（种族/物种如 lucario, pokemon, furry, anthro, feral, human, dog girl, cat boy, elf；性别如 female, male, 1girl, 1boy；内容分级如 sfw, nsfw；以及其他描述角色基本属性的基底特征，作为整个角色的基底）
- head：头部特征（发色、发型、瞳色、动物耳朵、帽子、面部装饰等头部相关）
- body：身体特征（体型、肤色、毛色、尾巴、翅膀、身高等身体相关，不含物种与性别）
- clothing：衣物配饰（服装、配饰、眼镜、缎带、首饰等）
- background：背景环境（场景元素、背景物件）
- pose：人物姿势（身体姿态、动作）
- expression：人物表情（面部表情、情绪状态）

分类建议（参考，按特征语义归入最合适的分类）：
- 物种/种族（如 dog girl, cat boy, human, elf, lucario, pokemon, furry, anthro, feral）→ basic
- 性别（如 female, male, 1girl, 1boy）→ basic
- 内容分级（如 sfw, nsfw）→ basic
- 毛色（如 white fur, black fur）→ body
- 发色（如 black hair, blonde hair）→ head
- 瞳色（如 blue eyes, red eyes）→ head
- 服饰（如 black shirt, school uniform, dress）→ clothing
- 配饰（如 glasses, ribbon, hat）→ clothing
- 动物耳朵（如 animal ears, dog ears）→ head
- 尾巴/翅膀（如 tail, wings）→ body

要求：
1. 首先输出一行「分类:tag」列表，逗号分隔，每个 tag 前缀一个分类标签，格式为 \`分类:tag\`（如 \`basic:dog girl, basic:female, head:white hair\`），不要编号、不要自然语言句子、不要解释
2. 然后输出一行 "---DESCRIPTION---" 作为分隔符
3. 最后输出一段中文角色外观描述（2-4 句话），描述角色的整体视觉外观，包括物种、性别、体型、发色发型、瞳色、服饰、配饰等
4. 输出示例：
basic:dog girl, basic:female, head:white hair, head:blue eyes, body:white fur, clothing:black shirt, head:animal ears
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
 *
 * 【重点标记 - AI 自动归类增强】与 CHARACTER_TRAIT_SYSTEM_PROMPT 同步升级为「category:tag」格式，
 * 便于多模态识别结果同样携带分类信息进入 store
 *
 * 【重点标记 - AI 不生成自定义分类 tag 的 bug 修复】Spec: fix-asset-trait-and-scene-defects / Task 5
 *  - 与 CHARACTER_TRAIT_SYSTEM_PROMPT 同步改为动态构建：
 *    `recognizeImageTraits` 调用 `buildDynamicImageTraitSystemPrompt(globalCategories)`
 *  - 本常量保留作为基线参考（文档化 prompt 结构），不再直接用于生产调用
 */
export const IMAGE_TRAIT_SYSTEM_PROMPT = `You are a visual character analyst. Analyze the character image and extract visual features as English comma-separated "category:tag" pairs for Stable Diffusion. Each tag MUST be prefixed with one of these category labels:
- basic: species/race (e.g. lucario, pokemon, furry, anthro, feral, human, dog girl, cat boy, elf), gender (e.g. female, male, 1girl, 1boy), content rating (e.g. sfw, nsfw), and other foundational character attributes
- head: hair color, hair style, eye color, animal ears, hat, facial decorations
- body: body type, skin tone, fur color, tail, wings, height (excluding species and gender)
- clothing: clothes, accessories, glasses, ribbon, jewelry
- background: scene elements, background objects
- pose: body posture, action
- expression: facial expression, emotion

Category guidance:
- Species/race (e.g. dog girl, cat boy, human, elf, lucario, pokemon, furry, anthro, feral) → basic
- Gender (e.g. female, male, 1girl, 1boy) → basic
- Content rating (e.g. sfw, nsfw) → basic
- Fur color (e.g. white fur, black fur) → body
- Hair color (e.g. black hair, blonde hair) → head
- Eye color (e.g. blue eyes, red eyes) → head
- Clothing (e.g. black shirt, school uniform, dress) → clothing
- Accessories (e.g. glasses, ribbon, hat) → clothing
- Animal ears (e.g. animal ears, dog ears) → head
- Tail/wings (e.g. tail, wings) → body

Output format requirements:
1. First, output ONE line of "category:tag" pairs separated by commas, no numbering, no explanations. Example: basic:cat girl, basic:female, head:white hair, head:red eyes, clothing:school uniform, head:cat ears
2. Then output a line "---DESCRIPTION---" as a separator.
3. Finally, output a Chinese character appearance description (2-4 sentences) describing the overall visual appearance, including species, gender, body type, hair color/style, eye color, clothing, accessories, etc.

Output example:
basic:cat girl, basic:female, head:white hair, head:red eyes, clothing:school uniform, head:cat ears
---DESCRIPTION---
一位猫耳少女，拥有白色长发和红色的眼睛。身穿学校制服，头上有一对白色的猫耳。体型纤细，整体风格偏清纯。`;

/**
 * 动态场景解析专用系统提示词（Spec: add-dynamic-scene-prompt-generation / Task 2）。
 *
 * 设计要点（与 CHARACTER_TRAIT_SYSTEM_PROMPT / IMAGE_TRAIT_SYSTEM_PROMPT 对齐）：
 *  - 角色：动态场景解析助手，将自然语言指令解析为三组英文 SD tag
 *  - 三个维度：clothing（服装/配饰/鞋帽）/ pose（动作/姿势/体态）/ scene（环境/背景/场景）
 *  - 输出格式：三个分隔符 `---CLOTHING---` / `---POSE---` / `---SCENE---`，
 *    每个分隔符后跟随一组逗号分隔的英文 tag（可与分隔符同行或下一行）
 *  - 维度未提及时，分隔符后留空（无 tag），由调用方解析为空字符串
 *  - 严格英文 tag，逗号分隔，无编号、无解释、无自然语言句子
 *  - 1-2 个示例覆盖「复合指令（三维度齐全）」与「单一维度指令」两种情况
 *  - 提示 LLM 若收到 baseTraits 上下文，避免生成与之矛盾的 tag，但不要重复输出基础特征
 *
 * 与 CHARACTER_TRAIT_SYSTEM_PROMPT 的区别：
 *  - CHARACTER_TRAIT_SYSTEM_PROMPT 提取「角色固有视觉特征」（种族/发色/瞳色等），输出 `分类:tag`
 *  - DYNAMIC_SCENE_SYSTEM_PROMPT 解析「一次性场景指令」（服装/动作/场景），输出按维度分组的 tag
 *  - 两者不共用 prompt，避免 LLM 混淆「固有特征」与「场景指令」语义
 */
const DYNAMIC_SCENE_SYSTEM_PROMPT = `你是一个动态场景解析助手。请将用户输入的自然语言指令解析为三组英文 Stable Diffusion tag，分别对应服装、动作与场景三个维度。

三个维度的范围：
- clothing：服装、配饰、鞋帽、首饰等角色穿着相关（如 gothic dress, black lace, choker, boots, hat）
- pose：动作、姿势、体态等角色姿态相关（如 riding motorcycle, holding handlebars, leaning forward, sitting on chair）
- scene：环境、背景、场景等周围空间相关（如 highway, motion blur, sunset, road, classroom, night sky）

输出格式（必须严格遵守）：
- 每个维度输出一行分隔符，分隔符后跟随逗号分隔的英文 tag
- 三个分隔符分别为 \`---CLOTHING---\` / \`---POSE---\` / \`---SCENE---\`（大小写不敏感，可被解析器容忍）
- tag 可与分隔符同行，也可放在分隔符的下一行
- 若用户指令未提及某维度，仍需输出该分隔符，其后留空（不输出任何 tag）
- tag 必须为英文，逗号分隔，不要编号、不要自然语言句子、不要解释、不要重复输出基础特征

可选上下文（用户消息可能附带「角色基础特征」作为参考）：
- 这些基础特征是角色「固有」属性（如 white fur, dog girl, blue eyes, tail），描述的是角色本身而非本次场景
- 你解析的服装/动作/场景是「一次性」场景指令，与基础特征正交，不要在输出中重复基础特征
- 但需避免生成与基础特征矛盾的 tag（例如基础特征有 tail 时，不要生成 no tail）

示例 1（复合指令，三维度齐全）：
用户输入：让角色穿上一套哥特风的衣服，骑着摩托驰骋在高速公路上
你的输出：
---CLOTHING---
gothic dress, black lace, choker, dark makeup, boots
---POSE---
riding motorcycle, holding handlebars, leaning forward, windblown hair
---SCENE---
highway, motion blur, sunset, road, dramatic lighting

示例 2（单一维度指令，其余维度留空）：
用户输入：让角色坐在椅子上
你的输出：
---CLOTHING---

---POSE---
sitting on chair, hands on lap, relaxed posture
---SCENE---

请严格按上述格式输出，不要输出任何额外说明。`;

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
      //
      // 【重点标记 - AI 不生成自定义分类 tag 的 bug 修复】Spec: fix-asset-trait-and-scene-defects / Task 5.2
      // 原 messages 直接使用硬编码的 CHARACTER_TRAIT_SYSTEM_PROMPT，仅含 7 个系统分类，
      // LLM 不知道用户创建的自定义分类（如「纹身」「武器装备」），导致不会为这些分类生成 tag。
      // 现改为：先从全局字典加载自定义分类，再调用 buildDynamicTraitSystemPrompt 动态构建提示词。
      const globalCategories = categoryDictionaryService.loadDictionary().categories;
      const dynamicSystemPrompt = this.buildDynamicTraitSystemPrompt(globalCategories);

      const userContent = this.buildUserMessage(description, personality, scenario);

      let messages: Array<{ role: 'system' | 'user'; content: string | Array<{ type: 'text'; text: string } | { type: 'image_url'; image_url: { url: string } }> }>;

      if (includeImage) {
        // 读取角色卡 PNG 图片为 base64 data URI
        try {
          const imageBuffer = fsSync.readFileSync(characterCardId);
          const base64Image = imageBuffer.toString('base64');
          const dataUri = `data:image/png;base64,${base64Image}`;
          messages = [
            { role: 'system', content: dynamicSystemPrompt + '\n\nIn addition to the text description, a character image is provided. Please analyze BOTH the image and the text description to extract comprehensive visual feature tags with category prefixes (format: `category:tag`) AND write a Chinese appearance description. Prioritize features visible in the image, and use the text description to fill in any gaps. Remember to output the categorized tags first, then the "---DESCRIPTION---" separator, then the Chinese description.' },
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
            { role: 'system', content: dynamicSystemPrompt },
            { role: 'user', content: userContent },
          ];
        }
      } else {
        messages = [
          { role: 'system', content: dynamicSystemPrompt },
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
      //
      // 【重点标记 - AI 不生成自定义分类 tag 的 bug 修复】Spec: fix-asset-trait-and-scene-defects / Task 5.3
      // 原直接使用硬编码的 IMAGE_TRAIT_SYSTEM_PROMPT，仅含 7 个系统分类，
      // 多模态模型同样无法识别用户自定义分类。现改为动态构建：
      // 从全局字典加载自定义分类 → 调用 buildDynamicImageTraitSystemPrompt 注入完整分类列表。
      const globalCategories = categoryDictionaryService.loadDictionary().categories;
      const dynamicImageSystemPrompt = this.buildDynamicImageTraitSystemPrompt(globalCategories);
      const systemContent = engineSystemPrompt && engineSystemPrompt.trim()
        ? `${engineSystemPrompt.trim()}\n\n${dynamicImageSystemPrompt}`
        : dynamicImageSystemPrompt;

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
   * 动态构建特征生成系统提示词（Spec: fix-asset-trait-and-scene-defects / Task 5）。
   *
   * 【重点标记 - AI 不生成自定义分类 tag 的 bug 修复】
   * 原 `CHARACTER_TRAIT_SYSTEM_PROMPT` 硬编码 7 个系统分类，LLM 不知道用户创建的自定义分类
   * （如「纹身」「武器装备」），导致 AI 不会为这些分类生成 tag。
   * 本方法将系统分类 + 全局字典自定义分类合并为完整的分类列表，注入到提示词中。
   *
   * 设计要点：
   *  - 系统分类保留原 `CHARACTER_TRAIT_SYSTEM_PROMPT` 中的详细描述（物种/性别/发色等示例）
   *  - 自定义分类仅列出 `id：名称（自定义分类）`，因用户创建时未填写描述
   *  - 分类建议同步追加自定义分类的「名称 → id」映射，引导 LLM 将相关特征归入
   *  - 输出格式与原 prompt 完全一致（「分类:tag」列表 + `---DESCRIPTION---` + 中文描述）
   *
   * @param globalCategories 全局字典中的自定义分类（不含系统分类）
   * @returns 完整的系统提示词
   */
  private buildDynamicTraitSystemPrompt(globalCategories: TraitCategory[]): string {
    // 系统分类的详细描述（保留原 CHARACTER_TRAIT_SYSTEM_PROMPT 的细节）
    const systemCategoryDescriptions: Record<string, string> = {
      basic:
        '基本特征（种族/物种如 lucario, pokemon, furry, anthro, feral, human, dog girl, cat boy, elf；性别如 female, male, 1girl, 1boy；内容分级如 sfw, nsfw；以及其他描述角色基本属性的基底特征，作为整个角色的基底）',
      head: '头部特征（发色、发型、瞳色、动物耳朵、帽子、面部装饰等头部相关）',
      body: '身体特征（体型、肤色、毛色、尾巴、翅膀、身高等身体相关，不含物种与性别）',
      clothing: '衣物配饰（服装、配饰、眼镜、缎带、首饰等）',
      background: '背景环境（场景元素、背景物件）',
      pose: '人物姿势（身体姿态、动作）',
      expression: '人物表情（面部表情、情绪状态）',
    };

    // 合并系统分类 + 自定义分类
    const allCategories = [...SYSTEM_TRAIT_CATEGORIES, ...globalCategories];

    // 构建分类列表文本：系统分类保留详细描述，自定义分类标注「自定义分类」
    const categoryLines = allCategories
      .map((c) => {
        if (c.isSystem) {
          return `- ${c.id}：${systemCategoryDescriptions[c.id] || c.name}`;
        }
        return `- ${c.id}：${c.name}（自定义分类）`;
      })
      .join('\n');

    // 构建分类建议文本：系统分类保留原示例，自定义分类追加「名称 → id」
    const systemGuidance = [
      '- 物种/种族（如 dog girl, cat boy, human, elf, lucario, pokemon, furry, anthro, feral）→ basic',
      '- 性别（如 female, male, 1girl, 1boy）→ basic',
      '- 内容分级（如 sfw, nsfw）→ basic',
      '- 毛色（如 white fur, black fur）→ body',
      '- 发色（如 black hair, blonde hair）→ head',
      '- 瞳色（如 blue eyes, red eyes）→ head',
      '- 服饰（如 black shirt, school uniform, dress）→ clothing',
      '- 配饰（如 glasses, ribbon, hat）→ clothing',
      '- 动物耳朵（如 animal ears, dog ears）→ head',
      '- 尾巴/翅膀（如 tail, wings）→ body',
    ];
    const customGuidance = globalCategories.map((c) => `- ${c.name} → ${c.id}`);
    const categoryGuidance = [...systemGuidance, ...customGuidance].join('\n');

    return `你是一个角色视觉特征提取助手。请从给定的角色描述中提取角色的视觉外观特征，并为每个特征分配一个分类标签，输出为逗号分隔的「分类:tag」列表，用于 Stable Diffusion 图像生成，并同时输出一段中文角色外观描述。

分类体系（必须使用以下英文分类标签作为前缀，与「分类:tag」中的「分类」对应）：
${categoryLines}

分类建议（参考，按特征语义归入最合适的分类）：
${categoryGuidance}

要求：
1. 首先输出一行「分类:tag」列表，逗号分隔，每个 tag 前缀一个分类标签，格式为 \`分类:tag\`（如 \`basic:dog girl, basic:female, head:white hair\`），不要编号、不要自然语言句子、不要解释
2. 然后输出一行 "---DESCRIPTION---" 作为分隔符
3. 最后输出一段中文角色外观描述（2-4 句话），描述角色的整体视觉外观，包括物种、性别、体型、发色发型、瞳色、服饰、配饰等
4. 输出示例：
basic:dog girl, basic:female, head:white hair, head:blue eyes, body:white fur, clothing:black shirt, head:animal ears
---DESCRIPTION---
一位犬耳少女，拥有洁白的毛发和蓝色的眼睛。身穿黑色衬衫，头上有一对毛茸茸的犬耳。体型娇小，整体风格偏可爱。`;
  }

  /**
   * 动态构建图片识别系统提示词（Spec: fix-asset-trait-and-scene-defects / Task 5）。
   *
   * 【重点标记 - AI 不生成自定义分类 tag 的 bug 修复】
   * 与 `buildDynamicTraitSystemPrompt` 对应的英文版本，面向多模态视觉模型。
   * 原 `IMAGE_TRAIT_SYSTEM_PROMPT` 同样硬编码 7 个系统分类，本方法将其改为动态构建。
   *
   * 设计要点：
   *  - 系统分类保留原 `IMAGE_TRAIT_SYSTEM_PROMPT` 中的英文详细描述
   *  - 自定义分类标注 `(custom category)`，与中文版的「（自定义分类）」对应
   *  - 分类建议同步追加自定义分类的「名称 → id」映射
   *  - 输出格式与原 prompt 完全一致
   *
   * @param globalCategories 全局字典中的自定义分类（不含系统分类）
   * @returns 完整的系统提示词（英文指令 + 中文描述输出要求）
   */
  private buildDynamicImageTraitSystemPrompt(globalCategories: TraitCategory[]): string {
    // 系统分类的详细描述（保留原 IMAGE_TRAIT_SYSTEM_PROMPT 的细节）
    const systemCategoryDescriptions: Record<string, string> = {
      basic:
        'species/race (e.g. lucario, pokemon, furry, anthro, feral, human, dog girl, cat boy, elf), gender (e.g. female, male, 1girl, 1boy), content rating (e.g. sfw, nsfw), and other foundational character attributes',
      head: 'hair color, hair style, eye color, animal ears, hat, facial decorations',
      body: 'body type, skin tone, fur color, tail, wings, height (excluding species and gender)',
      clothing: 'clothes, accessories, glasses, ribbon, jewelry',
      background: 'scene elements, background objects',
      pose: 'body posture, action',
      expression: 'facial expression, emotion',
    };

    // 合并系统分类 + 自定义分类
    const allCategories = [...SYSTEM_TRAIT_CATEGORIES, ...globalCategories];

    // 构建分类列表文本
    const categoryLines = allCategories
      .map((c) => {
        if (c.isSystem) {
          return `- ${c.id}: ${systemCategoryDescriptions[c.id] || c.name}`;
        }
        return `- ${c.id}: ${c.name} (custom category)`;
      })
      .join('\n');

    // 构建分类建议文本
    const systemGuidance = [
      '- Species/race (e.g. dog girl, cat boy, human, elf, lucario, pokemon, furry, anthro, feral) → basic',
      '- Gender (e.g. female, male, 1girl, 1boy) → basic',
      '- Content rating (e.g. sfw, nsfw) → basic',
      '- Fur color (e.g. white fur, black fur) → body',
      '- Hair color (e.g. black hair, blonde hair) → head',
      '- Eye color (e.g. blue eyes, red eyes) → head',
      '- Clothing (e.g. black shirt, school uniform, dress) → clothing',
      '- Accessories (e.g. glasses, ribbon, hat) → clothing',
      '- Animal ears (e.g. animal ears, dog ears) → head',
      '- Tail/wings (e.g. tail, wings) → body',
    ];
    const customGuidance = globalCategories.map((c) => `- ${c.name} → ${c.id}`);
    const categoryGuidance = [...systemGuidance, ...customGuidance].join('\n');

    return `You are a visual character analyst. Analyze the character image and extract visual features as English comma-separated "category:tag" pairs for Stable Diffusion. Each tag MUST be prefixed with one of these category labels:
${categoryLines}

Category guidance:
${categoryGuidance}

Output format requirements:
1. First, output ONE line of "category:tag" pairs separated by commas, no numbering, no explanations. Example: basic:cat girl, basic:female, head:white hair, head:red eyes, clothing:school uniform, head:cat ears
2. Then output a line "---DESCRIPTION---" as a separator.
3. Finally, output a Chinese character appearance description (2-4 sentences) describing the overall visual appearance, including species, gender, body type, hair color/style, eye color, clothing, accessories, etc.

Output example:
basic:cat girl, basic:female, head:white hair, head:red eyes, clothing:school uniform, head:cat ears
---DESCRIPTION---
一位猫耳少女，拥有白色长发和红色的眼睛。身穿学校制服，头上有一对白色的猫耳。体型纤细，整体风格偏清纯。`;
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
  private parseTraitsAndDescription(content: string): { traits: CategorizedTrait[]; appearanceDescription: string } {
    const separator = '---DESCRIPTION---';
    const parts = content.split(separator);
    const tagContent = parts[0] || content;
    const descContent = parts.length > 1 ? parts.slice(1).join(separator).trim() : '';
    const traits = this.parseTraitsFromContent(tagContent);
    return { traits, appearanceDescription: descContent };
  }

  /**
   * 解析 LLM 返回内容为「带分类」特征项数组。
   *
   * 处理步骤：
   *  1. 按逗号 / 换行 / 分号切分（兼容中英文标点）
   *  2. trim 每项
   *  3. 过滤空字符串
   *  4. 移除可能的前缀编号（如 "1. " / "- " / "* "）
   *  5. 解析「分类:tag」前缀：仅在 prefix 为已知系统分类 id 时剥离，否则视为无分类（兜底 uncategorized）
   *  6. 去重（按 text 文本，大小写敏感），保留首次出现的顺序与分类
   *
   * 鲁棒性：
   *  - LLM 偶尔会输出多行（每行一个 tag 或一段含逗号的句子），统一按逗号 + 换行切分
   *  - LLM 偶尔会输出编号列表，移除前缀
   *  - LLM 偶尔会输出尾部的句号/分号，trim 掉
   *  - LLM 未输出分类前缀时，整条 tag 作为 text、categoryId 兜底为 uncategorized
   *  - LLM 输出未知分类前缀（如 typo）时，整条 tag 作为 text、categoryId 兜底为 uncategorized
   *  - SD tag 内权重冒号（如 "(white hair:1.3)"）不会被误剥离，因为前缀 "(" 不是已知系统分类
   *
   * 【重点标记 - Bug 修复：tag 数量不符】
   * 原去重键为 `${categoryId}::${text}`（组合键），当 LLM 将同一 tag 归入不同分类时
   * （如 `basic:white fur` 与 `body:white fur`），两条均保留，导致下游 store 出现
   * 同一 text 的重复项，最终 SD 提示词中出现重复 tag。
   * 现改为仅按 `text` 去重，保留首次出现的分类，与 SD tag 语义一致（同一 tag 只应出现一次）。
   *
   * 【重点标记 - AI 不生成自定义分类 tag 的 bug 修复】Spec: fix-asset-trait-and-scene-defects / Task 5.4
   * 原 `validCategoryIds` 仅含 7 个系统分类 id，导致 LLM 返回 `tattoo:dragon tattoo` 等
   * 自定义分类前缀时被误判为「未知前缀」，整条 tag 兜底为 uncategorized，
   * 与 generateCharacterTraits / recognizeImageTraits 注入自定义分类到 prompt 的修复不匹配。
   * 现同步从全局字典加载自定义分类 id，使其成为合法前缀，确保 `tattoo:dragon tattoo` 能被
   * 正确解析为 `{ text: 'dragon tattoo', categoryId: 'tattoo' }`。
   */
  private parseTraitsFromContent(content: string): CategorizedTrait[] {
    // 合法分类 id 集合：系统分类 + 全局字典自定义分类
    const globalCategories = categoryDictionaryService.loadDictionary().categories;
    const validCategoryIds = new Set([
      ...SYSTEM_TRAIT_CATEGORIES.map((c) => c.id),
      ...globalCategories.map((c) => c.id),
    ]);

    // 同时按英文逗号、中文逗号、换行、分号切分
    const tokens = content.split(/[,，\n;；]+/);
    const seen = new Set<string>();
    const result: CategorizedTrait[] = [];
    let duplicateCount = 0;
    for (let raw of tokens) {
      let tag = raw.trim();
      if (!tag) continue;
      // 移除前缀编号：如 "1. " / "1) " / "- " / "* " / "1、"
      tag = tag.replace(/^[\d]+[.)、]\s*/, '').replace(/^[-*]\s*/, '');
      // 移除尾部句号（注意：不再统一移除尾部冒号，避免破坏「分类:tag」前缀；
      // 仅移除尾部多余句号，分号已在切分阶段处理）
      tag = tag.replace(/[.。]+$/, '').trim();
      if (!tag) continue;

      // 解析「category:tag」前缀格式
      let categoryId: string = UNCATEGORIZED_CATEGORY_ID;
      let text: string = tag;
      const colonIndex = tag.indexOf(':');
      if (colonIndex > 0) {
        const prefix = tag.substring(0, colonIndex).trim().toLowerCase();
        const remainder = tag.substring(colonIndex + 1).trim();
        // 仅当 prefix 是已知系统分类时才剥离，避免误剥离 SD tag 内的权重冒号（如 "(white hair:1.3)"）
        if (validCategoryIds.has(prefix) && remainder.length > 0) {
          categoryId = prefix;
          text = remainder;
        }
      }
      if (!text) continue;

      // 去重（按 text 文本，大小写敏感，与 SD 提示词语义一致）
      // 【Bug 修复】原为 `${categoryId}::${text}` 组合键，现改为仅 text，避免同 tag 跨分类重复
      if (seen.has(text)) {
        duplicateCount++;
        continue;
      }
      seen.add(text);
      result.push({ text, categoryId });
    }
    if (duplicateCount > 0) {
      console.log(
        '[CharacterTraitAI] parseTraitsFromContent: 去重移除',
        duplicateCount,
        '条同文本跨分类重复 tag，保留',
        result.length,
        '条唯一 tag',
      );
    }
    return result;
  }

  /**
   * 将自然语言指令解析为三组英文 SD tag（服装 / 动作 / 场景）。
   *
   * Spec: add-dynamic-scene-prompt-generation / Task 2
   *
   * 流程（与 `generateCharacterTraits` 非多模态路径一致）：
   *  1. 入参校验：`naturalLanguageInput` 空/纯空白 → 返回「请输入动态场景指令」（不调用 LLM）
   *  2. 读取 AI 引擎配置（baseUrl / apiKey / modelName / apiKeyTransmission / systemPrompt）
   *  3. 配置兜底校验：baseUrl / apiKey / modelName 缺失 → 返回友好错误
   *  4. 读取引擎运行时参数 temperature / max_tokens（缺失 → 友好错误，遵守「禁止 AI 参数默认值」规则）
   *  5. 构建 user message：包含自然语言指令 + 可选 baseTraits 上下文
   *  6. 构建 messages：`[system: DYNAMIC_SCENE_SYSTEM_PROMPT, user: userMessage]`
   *  7. 注入引擎级 systemPrompt（`enrichSystemPrompt`）
   *  8. 非流式 POST /v1/chat/completions
   *  9. 解析 `data.choices[0].message.content`（`parseDynamicSceneResponse`）
   *  10. 返回 `{ success: true, clothing, pose, scene }`
   *
   * 错误处理：try/catch 全包，任何异常均转为 `{ success: false, error }`，不抛出。
   * 日志前缀：`[DynamicSceneAI]`（与 `[CharacterTraitAI]` 区分，便于日志检索）。
   *
   * @param params 入参，详见 `GenerateDynamicScenePromptsParams`
   * @returns 详见 `GenerateDynamicScenePromptsResult`
   */
  async generateDynamicScenePrompts(
    params: GenerateDynamicScenePromptsParams
  ): Promise<GenerateDynamicScenePromptsResult> {
    const { naturalLanguageInput, baseTraits } = params;

    try {
      // 1. 入参校验（不调用 LLM）
      if (!naturalLanguageInput || !naturalLanguageInput.trim()) {
        return { success: false, error: '请输入动态场景指令' };
      }

      // 2. 读取 AI 引擎配置
      const aiConfig = aiConfigProvider.getAIConfig({ defaultTransmission: 'header' });
      const baseUrl = aiConfig.baseUrl;
      const apiKey = aiConfig.apiKey;
      const apiKeyTransmission = aiConfig.apiKeyTransmission;
      const engineSystemPrompt = aiConfig.systemPrompt || '';
      const modelName = aiConfig.modelName;

      // 3. 配置兜底校验
      if (!baseUrl) {
        console.warn('[DynamicSceneAI] AI 引擎未配置 baseUrl');
        return {
          success: false,
          error: 'AI 引擎未配置，请先在设置中配置 API',
        };
      }
      if (!apiKey) {
        console.warn('[DynamicSceneAI] AI 引擎未配置 apiKey');
        return {
          success: false,
          error: 'AI 引擎未配置，请先在设置中配置 API',
        };
      }
      if (!modelName) {
        console.warn('[DynamicSceneAI] AI 引擎未配置 modelName');
        return {
          success: false,
          error: 'AI 引擎未配置，请先在设置中配置 API',
        };
      }

      // 4. 读取引擎运行时参数（temperature / max_tokens）
      // 【项目最高优先级规则】禁止使用 AI 参数默认值，复用 getEngineRuntimeConfig
      // 缺失时返回友好错误，与 generateCharacterTraits / recognizeImageTraits 一致
      const runtimeConfig = this.getEngineRuntimeConfig();
      if (!runtimeConfig) {
        return {
          success: false,
          error: 'AI 引擎未配置 temperature 或 max_tokens 参数，请在设置中配置 AI 引擎',
        };
      }
      const { temperature, maxTokens } = runtimeConfig;

      // 5. 构建 user message：自然语言指令 + 可选 baseTraits 上下文
      const userMessage = this.buildDynamicSceneUserMessage(naturalLanguageInput, baseTraits);

      // 6. 构建 messages（纯文本，非多模态）
      const messages: Array<{ role: 'system' | 'user'; content: string }> = [
        { role: 'system', content: DYNAMIC_SCENE_SYSTEM_PROMPT },
        { role: 'user', content: userMessage },
      ];

      // 7. 注入引擎级 system prompt（与 generateCharacterTraits 一致）
      const enrichedMessages = this.enrichSystemPrompt(messages, engineSystemPrompt);

      // 8. 构建请求头与请求体
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

      console.log('[DynamicSceneAI] Calling LLM for dynamic scene parsing:', {
        baseUrl,
        modelName,
        apiKeyTransmission,
        temperature,
        maxTokens,
        inputLength: naturalLanguageInput.length,
        hasBaseTraits: !!baseTraits,
      });

      // 9. 非流式调用 LLM
      const response = await fetch(`${baseUrl}/v1/chat/completions`, {
        method: 'POST',
        headers,
        body: JSON.stringify(requestBody),
      });

      if (!response.ok) {
        const errorText = await response.text().catch(() => '');
        console.error(
          '[DynamicSceneAI] LLM request failed:',
          response.status,
          response.statusText,
          errorText
        );
        return {
          success: false,
          error: `AI 调用失败：HTTP ${response.status} ${response.statusText}`,
        };
      }

      const data = await response.json();
      const content: string | undefined = data?.choices?.[0]?.message?.content;

      if (!content || typeof content !== 'string' || !content.trim()) {
        console.error('[DynamicSceneAI] LLM returned empty content:', data);
        return {
          success: false,
          error: 'AI 返回内容无法解析为动态场景 tag',
        };
      }

      // 10. 解析响应：按分隔符切分三组 tag
      const { clothing, pose, scene } = this.parseDynamicSceneResponse(content);

      console.log('[DynamicSceneAI] Parsed dynamic scene tags:', {
        clothingLength: clothing.length,
        poseLength: pose.length,
        sceneLength: scene.length,
        clothingPreview: clothing.slice(0, 80),
        posePreview: pose.slice(0, 80),
        scenePreview: scene.slice(0, 80),
      });

      return { success: true, clothing, pose, scene };
    } catch (error) {
      console.error('[DynamicSceneAI] generateDynamicScenePrompts failed:', error);
      const message = error instanceof Error ? error.message : String(error);
      // 友好化常见错误（与 generateCharacterTraits 一致）
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
   * 构建动态场景解析的 user message。
   *
   * 结构：
   *  - 用户指令行（必填）：自然语言指令原文
   *  - 角色基础特征上下文（可选）：当 baseTraits 非空时附加以「角色基础特征」段落
   *  - 末尾请求行：要求 LLM 按系统提示词格式输出
   *
   * 设计要点：
   *  - 不在 user message 中重复 system prompt 的格式要求（避免噪声）
   *  - baseTraits 仅作为「避免生成矛盾 tag」的参考上下文，不要求 LLM 输出
   */
  private buildDynamicSceneUserMessage(
    naturalLanguageInput: string,
    baseTraits?: string
  ): string {
    const parts: string[] = [];
    parts.push(`用户指令：\n${naturalLanguageInput.trim()}`);
    if (baseTraits && baseTraits.trim()) {
      parts.push(`角色基础特征（仅供参考，避免生成矛盾 tag，不要在输出中重复）：\n${baseTraits.trim()}`);
    }
    parts.push('请按系统提示词的格式输出三组英文 SD tag。');
    return parts.join('\n\n');
  }

  /**
   * 解析 LLM 返回内容为三组英文 SD tag（服装 / 动作 / 场景）。
   *
   * Spec: add-dynamic-scene-prompt-generation / Task 2 / SubTask 2.4
   *
   * 内容结构（由 DYNAMIC_SCENE_SYSTEM_PROMPT 约定）：
   *  - 三个分隔符 `---CLOTHING---` / `---POSE---` / `---SCENE---`
   *  - 每个分隔符后跟随逗号分隔的英文 tag（可与分隔符同行或下一行）
   *  - 维度未提及时分隔符后留空
   *
   * 处理步骤：
   *  1. 初始化 `{ clothing: '', pose: '', scene: '' }`（始终返回三字段）
   *  2. 用正则匹配每个分隔符，捕获从分隔符后到下一个分隔符或字符串末尾的内容
   *     （分隔符大小写不敏感，可被前后空白包裹）
   *  3. 对每段捕获内容做归一化：
   *     - trim 首尾空白
   *     - 移除可能的前缀编号（如 `1. ` / `- ` / `* `）
   *     - 移除尾部多余句号/分号
   *     - 折叠多余空白（含换行）为单个空格（仅当 tag 内含空格分隔短语时保留）
   *     - 重新按逗号切分后逐项 trim，过滤空字符串，再用 `, ` 重组为标准逗号分隔串
   *
   * 鲁棒性：
   *  - 分隔符任意顺序出现均能解析（不依赖固定顺序）
   *  - 分隔符缺失时该字段保持空字符串（不抛错）
   *  - 内容中混合中英文也能解析（但 LLM 按指令应输出英文 tag）
   *  - 多余空白 / 换行 / 多余逗号均被归一化
   *  - 分隔符后同行有 tag（`---CLOTHING---gothic dress, ...`）与下一行有 tag 均支持
   *
   * @returns `{ clothing, pose, scene }` —— 始终包含三字段，可能为空字符串
   */
  private parseDynamicSceneResponse(content: string): {
    clothing: string;
    pose: string;
    scene: string;
  } {
    const result = { clothing: '', pose: '', scene: '' };

    // 三个维度的分隔符与对应 result key 的映射
    // 正则：匹配分隔符（大小写不敏感，前后可有空白），捕获从分隔符后到下一个分隔符或字符串末尾的内容
    // 使用正向预查 (?=...) 在遇到下一个分隔符时停止捕获
    const separators: Array<{ key: 'clothing' | 'pose' | 'scene'; pattern: RegExp }> = [
      // `---CLOTHING---` 后到下一个 `---POSE---` / `---SCENE---` 或字符串末尾
      {
        key: 'clothing',
        pattern: /---\s*CLOTHING\s*---\s*([\s\S]*?)(?=---\s*(?:POSE|SCENE)\s*---|$)/i,
      },
      {
        key: 'pose',
        pattern: /---\s*POSE\s*---\s*([\s\S]*?)(?=---\s*(?:CLOTHING|SCENE)\s*---|$)/i,
      },
      {
        key: 'scene',
        pattern: /---\s*SCENE\s*---\s*([\s\S]*?)(?=---\s*(?:CLOTHING|POSE)\s*---|$)/i,
      },
    ];

    for (const { key, pattern } of separators) {
      const match = content.match(pattern);
      if (!match || !match[1]) {
        // 分隔符未出现：该字段保持空字符串
        continue;
      }
      result[key] = this.normalizeDynamicSceneTags(match[1]);
    }

    return result;
  }

  /**
   * 归一化动态场景 tag 段落为标准逗号分隔的英文 tag 字符串。
   *
   * 处理步骤：
   *  1. 按英文/中文逗号、换行、分号切分（兼容 LLM 输出多行 / 多种标点）
   *  2. 每项 trim 首尾空白
   *  3. 移除前缀编号（`1. ` / `1) ` / `- ` / `* ` / `1、`）
   *  4. 移除尾部句号/中文句号
   *  5. 折叠内部多余空白为单个空格
   *  6. 过滤空字符串
   *  7. 用 `, ` 重组为标准逗号分隔串
   *
   * 与 `parseTraitsFromContent` 的区别：
   *  - 不解析「分类:tag」前缀（动态场景已按 clothing/pose/scene 三段切分，无需前缀）
   *  - 不做去重（同一维度的 tag 重复概率低，且用户可能希望保留如 "black lace, black lace gloves" 等相近 tag）
   *  - 返回字符串而非数组（下游 store / SD 生成期望字符串）
   */
  private normalizeDynamicSceneTags(raw: string): string {
    // 同时按英文逗号、中文逗号、换行、分号切分
    const tokens = raw.split(/[,，\n;；]+/);
    const cleaned: string[] = [];
    for (let token of tokens) {
      let tag = token.trim();
      if (!tag) continue;
      // 移除前缀编号：如 "1. " / "1) " / "- " / "* " / "1、"
      tag = tag.replace(/^[\d]+[.)、]\s*/, '').replace(/^[-*]\s*/, '');
      // 移除尾部句号 / 中文句号
      tag = tag.replace(/[.。]+$/, '').trim();
      // 折叠内部多余空白（含制表符）为单个空格
      tag = tag.replace(/\s+/g, ' ');
      if (!tag) continue;
      cleaned.push(tag);
    }
    return cleaned.join(', ');
  }
}

/**
 * 单例导出。与 characterTraitService / assetService / expressionService 单例模式一致。
 */
export const characterTraitAIService = new CharacterTraitAIService();
