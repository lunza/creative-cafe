/**
 * 【Phase 3 / L1 - conversation-mode-optimization-report】PromptBuilder 拆分——表情约束与 NL 表情提示（buildExpressionPrompt / parseExpressionFromContent / EMOTION_NL_PROMPT_MAP / NLExpressionPromptOptions / buildNLExpressionPrompt）。
 * 原 PromptBuilder.ts 行段（1-based，逐字搬迁）：L326-L450 L1813-L1945。
 */
import { EMOTION_PRESETS } from './emotionPromptMaps';

/**
 * 构建表情显示模式系统提示词约束。
 *
 * Spec: add-character-expression-system
 * 开启后，要求 AI 在回复正文末尾以结构化格式输出当前情绪键名，
 * 供系统解析后驱动角色卡表情图像渲染（替代原 emoji_enhanced 文本 emoji 方案）。
 *
 * 格式要求：在正文之后另起一行，严格按以下格式输出（包含开始和结束标记）：
 *
 * <<<EXPRESSION>>>emotion_key<<<END_EXPRESSION>>>
 *
 * emotion_key 必须来自传入的 availableEmotionKeys 列表（预置 + 当前角色卡自定义），
 * 不得自创键名。当情绪难以判断时使用 "neutral"。
 *
 * 【重点标记】此标记对用户不可见，系统会自动解析并剥离，不会显示在对话文本中。
 * 与 buildAssistModePrompt 的 <<<SUGGESTED_OPTIONS>>> 标记互不冲突（两者格式不同）。
 *
 * @param charName 角色名（缺省 'Character'）
 * @param availableEmotionKeys 当前可用的情绪键列表（预置 30 项 + 用户自定义）
 * @returns 表情约束系统提示字符串
 */
export function buildExpressionPrompt(
  charName: string = 'Character',
  availableEmotionKeys: string[] = []
): string {
  const name = charName || 'Character';
  // 防御性兜底：未传入 keys 时使用预置全部 key（保证 AI 输出的 key 可被解析）
  const keys = availableEmotionKeys && availableEmotionKeys.length > 0
    ? availableEmotionKeys
    : EMOTION_PRESETS.map(e => e.key);
  const keysList = keys.join(', ');
  return `\n【表情显示】${name} 的回复需根据当前对话语境与角色情绪，在回复正文末尾选择一个最匹配的情绪键名输出。可用情绪键：${keysList}。

格式要求：在正文之后另起一行，严格按以下格式输出（包含开始和结束标记），不要额外解释：

<<<EXPRESSION>>>情绪键名<<<END_EXPRESSION>>>

规则：
1. 情绪键名必须从上方可用列表中选择，不得自创
2. 当情绪难以判断或为中性时使用 "neutral"
3. 此标记对用户不可见，系统会自动解析并剥离
4. 标记必须位于回复最末尾，与正文之间空一行`;
}

/**
 * 从 AI 回复内容中解析情绪标记。
 *
 * Spec: add-character-expression-system
 * 多格式容错匹配 <<<EXPRESSION>>>key<<<END_EXPRESSION>>> 标记，参照
 * parseSuggestedOptions 的多模式匹配策略，兼容 AI 遗漏结束标记、
 * 大小写不一、空白字符等情况。
 *
 * 匹配优先级：
 * 1. 主格式：<<<EXPRESSION>>>key<<<END_EXPRESSION>>>（大小写不敏感）
 * 2. 容错：仅有开始标记 <<<EXPRESSION>>>key 到文本末尾（AI 遗漏结束标记或被截断）
 * 3. 兼容变体：<expression>key</expression>（纯标签）
 *
 * @param content AI 回复原始内容
 * @returns { emotion: 解析出的情绪键名（小写）或 null；cleanedContent: 剥离标记后的内容；matchedPattern: 匹配到的正则名称（诊断用） }
 */
export function parseExpressionFromContent(content: string): { emotion: string | null; cleanedContent: string; matchedPattern: string | null } {
  if (!content || typeof content !== 'string') {
    return { emotion: null, cleanedContent: content || '', matchedPattern: null };
  }

  const patterns: Array<{ regex: RegExp; name: string }> = [
    // 主格式：<<<EXPRESSION>>>key<<<END_EXPRESSION>>>（大小写不敏感）
    { regex: /<<<EXPRESSION>>>\s*([a-z_][a-z0-9_]*)\s*<<<END_EXPRESSION>>>/i, name: 'text-marker' },
    // 容错：仅有开始标记 <<<EXPRESSION>>>key 到文本末尾
    { regex: /<<<EXPRESSION>>>\s*([a-z_][a-z0-9_]*)\s*$/i, name: 'text-marker-unclosed' },
    // ⚠️【重点标记 - Bug 修复】容错：AI 输出缩写结束标记
    // 实测 AI（尤其是 Claude/GLM 系列）会自发缩写结束标记为 <<<END_EXPR>>> / <<<END_EXP>>> 等
    // 而非完整 <<<END_EXPRESSION>>>。这导致 emotion 解析失败 → 消息保存 emotion=undefined
    // → 渲染回退默认头像（非用户期望的情绪表情）。详见 docs/FIX_RECORDS.md §7.26
    // 策略：开始标记严格 <<<EXPRESSION>>>，结束标记匹配 <<<END_EXP + 任意大写字母 + >>>
    // 覆盖 END_EXPRESSION / END_EXPR / END_EXP / END_EXPRESSIONS 等所有前缀变体
    { regex: /<<<EXPRESSION>>>\s*([a-z_][a-z0-9_]*)\s*<<<END_EXP[A-Z]*>>>/i, name: 'text-marker-end-exp-abbreviated' },
    // ⚠️ 容错：AI 输出残缺标记（如 <<>>key<<<_EXPRESSION>>>）
    // 策略：忽略尖括号数量，匹配 EXPRESSION 字样前后的有效情绪键名
    { regex: /[<>_]+EXPRESSION[<>_]+\s*([a-z_][a-z0-9_]*)\s*[<>_]+(?:END[_]*EXPRESSION|EXPRESSION)[<>_]+/i, name: 'text-marker-malformed' },
    // ⚠️【重点标记 - Bug 修复】容错：残缺+缩写结束标记组合（如 <<<EXPRESSION>>>key<<END_EXPR>>）
    // 上述 text-marker-malformed 要求结束标记为完整 END_EXPRESSION 或 EXPRESSION，
    // 无法覆盖 <<END_EXPR>> / <END_EXP> 等残缺+缩写组合。此模式独立处理：
    // 开始标记严格 <<<EXPRESSION>>>，结束标记为任意 < > _ 包围的 END_EXP 前缀
    { regex: /<<<EXPRESSION>>>\s*([a-z_][a-z0-9_]*)\s*[<>_]+END_EXP[A-Z]*[<>_]+/i, name: 'text-marker-malformed-end-exp' },
    // ⚠️【重点标记 - Bug 修复 - 反复修复】终极 EXPR 兜底正则
    // 用户反复反馈"从第 3 条消息起表情渲染失效"，根因排查发现：
    // 1. AI 输出的结束标记格式不可预测（END_EXPR / _EXPRESSION / END_EXP 等）
    // 2. 即使添加了上述容错正则，仍可能有未覆盖的变体
    // 3. 此正则匹配 <<<EXPRESSION>>>key<<<任意含 EXPR 字样的标记>>>
    // 覆盖所有结束标记中包含 EXPR 子串的情况（END_EXPRESSION / END_EXPR / _EXPRESSION 等）
    // 详见 docs/FIX_RECORDS.md §7.26
    { regex: /<<<EXPRESSION>>>\s*([a-z_][a-z0-9_]*)\s*<<<[^>]*EXPR[^>]*>>>/i, name: 'text-marker-expr-fallback' },
    // ⚠️ 容错：残缺开始标记 + key 到末尾（无结束标记）
    { regex: /[<>_]+EXPRESSION[<>_]+\s*([a-z_][a-z0-9_]*)\s*$/i, name: 'text-marker-malformed-unclosed' },
    // ⚠️ 终极兜底：文本末尾任意位置出现 EXPRESSION 字样，取其附近的情绪键名
    // 匹配 key 在 EXPRESSION 之前或之后的情况（key 必须是有效情绪词格式）
    { regex: /\b([a-z_][a-z0-9_]*)\s*[<>_]+(?:END[_]*EXPRESSION|EXPRESSION)[<>_]+\s*$/i, name: 'text-marker-fallback-before' },
    { regex: /EXPRESSION[<>_]+\s*([a-z_][a-z0-9_]*)\s*[<>_]*\s*$/i, name: 'text-marker-fallback-after' },
    // ⚠️【重点标记 - SSE 跨 chunk 标签损坏防御】
    // 兜底：匹配任何 <<<TAG>>>key<<<END_TAG>>> 格式的表情标记（标签名 ≥4 字符）
    // 覆盖 EXPRESSION 被截断为 EXESSION 等损坏变体
    // 根因已在 ChatEngine.handleStream 修复（行计数→字节偏移），此处为防御性兜底
    { regex: /<<<[A-Z_]{4,}>>>\s*([a-z_][a-z0-9_]*)\s*<<<END_[A-Z_]{4,}>>>\s*$/i, name: 'text-marker-generic' },
    { regex: /<<<[A-Z_]{4,}>>>\s*([a-z_][a-z0-9_]*)\s*$/i, name: 'text-marker-generic-unclosed' },
    // 兼容变体：纯标签 <expression>key</expression>
    { regex: /<expression>\s*([a-z_][a-z0-9_]*)\s*<\/expression>/i, name: 'plain-tag' },
    // 兼容变体：仅有 <expression>key 到末尾
    { regex: /<expression>\s*([a-z_][a-z0-9_]*)\s*$/i, name: 'plain-tag-unclosed' },
  ];

  for (const pattern of patterns) {
    pattern.regex.lastIndex = 0;
    const m = content.match(pattern.regex);
    if (m) {
      const emotion = m[1].toLowerCase();
      let cleanedContent = content.replace(m[0], '').trim();
      // ⚠️ 清理残留的孤立尖括号/下划线标记（如 <<>> 等残缺开始标记碎片）
      cleanedContent = cleanedContent.replace(/[<>_]{2,}\s*$/, '').trim();
      return { emotion, cleanedContent, matchedPattern: pattern.name };
    }
  }

  return { emotion: null, cleanedContent: content, matchedPattern: null };
}

// ==================== NL（自然语言）表情生成：情绪 → NL 提示词映射 ====================
// Spec: integrate-nl-driven-sd-models / Task 4
// 用于 NL 驱动 SD 模型（qwen-image / qwen-image-edit / flux2）的表情生成，
// 与上方 `buildExpressionGenerationPrompt`（SDXL tag 风格）为两套独立机制。

/**
 * 31 种预置情绪 → 自然语言描述映射（Spec: integrate-nl-driven-sd-models / Task 4.1）。
 *
 * 用于 NL 驱动 SD 模型：以自然语言句子描述表情，替代 SDXL 的 tag 风格提示词。
 * 键名严格对齐 `EMOTION_PRESETS` 的 31 个 key。
 */
export const EMOTION_NL_PROMPT_MAP: Record<string, string> = {
  default: 'a calm and neutral expression with a serene face',
  admiration: 'an admiring expression with awestruck eyes and a reverent look',
  amusement: 'an amused expression with a playful smile and twinkling eyes',
  anger: 'an angry expression with furrowed brows and an intense glare',
  annoyance: 'an annoyed expression with a slight frown and an irritated look',
  approval: 'an approving expression with a satisfied smile and a warm look',
  caring: 'a caring expression with a tender look and a soft smile',
  confusion: 'a confused expression with a tilted head and a raised eyebrow',
  curiosity: 'a curious expression with wide eyes and an eager look',
  desire: 'a desiring expression with a longing gaze and intense eyes',
  disappointment: 'a disappointed expression with downcast eyes and a sad smile',
  disapproval: 'a disapproving expression with a frown and a stern look',
  disgust: 'a disgusted expression with a wrinkled nose and a grimace',
  embarrassment: 'an embarrassed expression with blushing cheeks and an averted gaze',
  excitement: 'an excited expression with a wide grin and sparkling eyes',
  fear: 'a fearful expression with wide eyes and a pale, trembling face',
  gratitude: 'a grateful expression with a warm smile and thankful eyes',
  grief: 'a grief expression with teary eyes and a sorrowful face',
  joy: 'a joyful expression with a bright smile and radiant happiness',
  love: 'a loving expression with a tender gaze and a warm smile',
  nervousness: 'a nervous expression with lip biting and anxious eyes',
  neutral: 'a neutral expression with a calm and composed face',
  optimism: 'an optimistic expression with a hopeful smile and a bright outlook',
  pride: 'a proud expression with a confident smile and chin raised',
  realization: 'a realization expression with widened eyes and an open mouth',
  relief: 'a relieved expression with a sigh and relaxed shoulders',
  remorse: 'a remorseful expression with a guilty look and downcast eyes',
  sadness: 'a sad expression with teary eyes and a downturned mouth',
  surprise: 'a surprised expression with wide eyes and an open mouth',
  cheerfulness: 'a cheerful expression with a bright smile and a sunny disposition',
  in_heat: 'an expression of being in heat with an open smiling mouth, drooling saliva, tongue out, blushing cheeks, heavy breathing, half-closed eyes, sweating, and heart symbols',
};

/**
 * NL 表情生成提示词构建选项（Spec: integrate-nl-driven-sd-models / Task 4.2）。
 *
 * @param nlPromptTemplate - NL 提示词模板（含 {traits} / {emotion} 占位符）
 * @param customNegativePrompt - 用户自定义负面提示词
 * @param customLabel - 自定义情绪的标签（用于兜底生成 NL 描述）
 * @param characterTraits - 角色视觉特征描述数组（自然语言，如 ['blue eyes', 'long black hair']）
 * @param modelType - SD 模型类型，影响提示词风格（qwen-image-edit 使用编辑指令风格）
 */
export interface NLExpressionPromptOptions {
  nlPromptTemplate?: string;
  customNegativePrompt?: string;
  customLabel?: string;
  customNlPrompt?: string;
  characterTraits?: Array<{ text: string; weight?: number }>;
  modelType?: 'sdxl' | 'qwen-image' | 'qwen-image-edit' | 'flux2';
}

/**
 * 构建 NL（自然语言）驱动的表情生成提示词（Spec: integrate-nl-driven-sd-models / Task 4.2）。
 *
 * 与 `buildExpressionGenerationPrompt`（SDXL tag 风格）对称，本函数生成自然语言句子风格的
 * 提示词，适用于 qwen-image / qwen-image-edit / flux2 等 NL 驱动 SD 模型。
 *
 * 提示词组合规则：
 *   - 默认模板：`"A portrait of a character. {traits} The character has {emotion}, looking at the viewer. High quality, detailed."`
 *   - `{traits}` 替换为自然语言特征描述（如 "with blue eyes and long black hair"）
 *   - `{emotion}` 替换为 `EMOTION_NL_PROMPT_MAP[emotionKey]`
 *   - 预置情绪：从 `EMOTION_NL_PROMPT_MAP` 取 NL 描述
 *   - 自定义情绪（key 不在 MAP 中）：以 customLabel 兜底，组成 `${customLabel} expression`
 *
 * 【重点标记 - qwen-image-edit 编辑指令风格】
 * 当 modelType 为 `qwen-image-edit` 时，提示词重构为编辑指令风格：
 *   `"Change the character's expression to {emotion}. Maintain the character's identity, facial features, hairstyle, and clothing."`
 * 因为 qwen-image-edit 是 img2img 编辑模型，需要明确的编辑指令而非描述性提示词。
 *
 * @param emotionKey - 情绪键名（EMOTION_PRESETS 的 key 或用户自定义 key）
 * @param options - 可选配置（见 NLExpressionPromptOptions）
 * @returns `{ prompt: string; negativePrompt: string }`
 */
export function buildNLExpressionPrompt(
  emotionKey: string,
  options?: NLExpressionPromptOptions
): { prompt: string; negativePrompt: string } {
  const modelType = options?.modelType ?? 'qwen-image-edit';
  // 情绪 NL 提示词解析（Spec: enhance-custom-emotion-system）：
  // 优先级：customNlPrompt > EMOTION_NL_PROMPT_MAP[key] > customLabel 兜底 > neutral
  const emotionNl = (options?.customNlPrompt && options.customNlPrompt.trim())
    || EMOTION_NL_PROMPT_MAP[emotionKey]
    || (options?.customLabel ? `${options.customLabel.toLowerCase()} expression` : 'a neutral expression');

  // 【Spec: add-sdxl-prompt-weight-support / Task 3】characterTraits 升级为
  // Array<{ text: string; weight?: number }>，此处仅取 .text 拼接（NL 模型不适用权重语法）。
  const traitsStr = (options?.characterTraits || [])
    .map(t => t.text.trim())
    .filter(Boolean)
    .join(', ');
  const traitsDescription = traitsStr ? `with ${traitsStr}` : '';

  const template = options?.nlPromptTemplate
    || 'A portrait of a character. {traits} The character has {emotion}, looking at the viewer. High quality, detailed.';

  let prompt = template;
  // Replace {traits}
  if (prompt.includes('{traits}')) {
    prompt = prompt.replace(/\{traits\}/g, traitsDescription);
  } else if (traitsDescription) {
    // If no placeholder, prepend traits description
    prompt = `${traitsDescription}. ${prompt}`;
  }
  // Replace {emotion}
  if (prompt.includes('{emotion}')) {
    prompt = prompt.replace(/\{emotion\}/g, emotionNl);
  } else {
    // If no placeholder, append emotion
    prompt = `${prompt} The character has ${emotionNl}.`;
  }

  // For qwen-image-edit, use edit instruction style
  if (modelType === 'qwen-image-edit') {
    prompt = `Change the character's expression to ${emotionNl}. Maintain the character's identity, facial features, hairstyle, and clothing. ${traitsDescription ? `The character has ${traitsDescription}.` : ''}`.trim();
  }

  const negativePrompt = options?.customNegativePrompt
    || 'blurry, low quality, distorted, deformed, disfigured, bad anatomy, watermark, text';

  return { prompt, negativePrompt };
}
