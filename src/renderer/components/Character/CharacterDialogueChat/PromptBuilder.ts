import { UserPersona, ChatMessage } from './CharacterDialogueChat.types';

const DEFAULT_USER_NAME = 'User';

// ==================== 类型定义 ====================

export interface CharacterInfoForPrompt {
  characterCardName?: string;
  personality?: string;
  characterCardContent?: string;
  scenario?: string;
  mes_example?: string;
  system_prompt?: string;
  creator_notes?: string;
}

export interface PromptCoreResult {
  characterContext: string;
  personaSection: string;
  charName: string;
}

export interface ContextVectorItem {
  source: string;
  score: number;
  content: string;
  metadata?: {
    source?: string;
    text?: string;
    entryUid?: string;
    matchedKeys?: string[];
    matchType?: string;
    matchScore?: number;
    entryName?: string;
    entryComment?: string;
    [key: string]: any;
  };
}

// ==================== 预置常量 ====================

/**
 * 预置情绪类别清单（Spec: add-character-expression-system）。
 *
 * 基于 GoEmotions 分类（27 项）+ default（默认）+ cheerfulness（快乐）共 30 项。
 * 每项含唯一英文键（AI 输出用）与中文标签（UI 展示用）。
 * 预置类别不可删除，用户可在此基础上追加自定义情绪。
 */
export const EMOTION_PRESETS: ReadonlyArray<{ key: string; label: string }> = [
  { key: 'default', label: '默认' },
  { key: 'admiration', label: '钦佩' },
  { key: 'amusement', label: '愉悦' },
  { key: 'anger', label: '愤怒' },
  { key: 'annoyance', label: '恼怒' },
  { key: 'approval', label: '赞同' },
  { key: 'caring', label: '关切' },
  { key: 'confusion', label: '困惑' },
  { key: 'curiosity', label: '好奇' },
  { key: 'desire', label: '渴望' },
  { key: 'disappointment', label: '失望' },
  { key: 'disapproval', label: '不赞同' },
  { key: 'disgust', label: '厌恶' },
  { key: 'embarrassment', label: '尴尬' },
  { key: 'excitement', label: '兴奋' },
  { key: 'fear', label: '恐惧' },
  { key: 'gratitude', label: '感激' },
  { key: 'grief', label: '悲痛' },
  { key: 'joy', label: '喜悦' },
  { key: 'love', label: '喜爱' },
  { key: 'nervousness', label: '紧张' },
  { key: 'neutral', label: '中性' },
  { key: 'optimism', label: '乐观' },
  { key: 'pride', label: '自豪' },
  { key: 'realization', label: '顿悟' },
  { key: 'relief', label: '宽慰' },
  { key: 'remorse', label: '懊悔' },
  { key: 'sadness', label: '悲伤' },
  { key: 'surprise', label: '惊讶' },
  { key: 'cheerfulness', label: '快乐' },
  { key: 'in_heat', label: '发情' },
];

// ==================== 底层工具函数 ====================

/**
 * 构建 stop sequences 防抢话停止序列数组。
 *
 * Spec: optimize-chat-ai-intelligence / Task 3
 * Spec: fix-ai-response-length-degradation / Task 6（停止序列优化）
 * 借鉴 SillyTavern `names_as_stop_strings` 机制（public/script.js:2946 getStoppingStrings）。
 *
 * 默认返回 6 个用户名变体（含中英文冒号），阻断 AI 代替用户发言。
 * 仅使用双换行前缀（\n\n），匹配段落分隔（用户名通常出现在新段落开头）。
 *
 * 🐛 Bug修复（重点）：原实现包含 6 项单换行前缀变体（\n用户: / \nUser: 等），
 * 作为"兜底防止后端按子串匹配时漏判"。但大多数 OpenAI-compatible 后端
 * （vLLM / textgen-webui / koboldcpp 等）的 stop 字段使用子串匹配，只要
 * AI 输出文本中出现该子串即终止生成。单换行变体在以下场景误触发导致截断：
 *   - AI 在回复中引用用户话语（如"用户: '我喜欢这个'"）
 *   - AI 写内心独白提及用户代词
 *   - AI 列举对话片段或写对话剧本
 * 经评估，单换行变体误触发的风险远大于其"兜底"价值，故移除。
 *
 * 当传入 customStops（用户在 ParameterPanel 自定义）时，合并到数组末尾并去重。
 * 去重保留首次出现顺序，确保默认用户名变体优先。
 *
 * @param userName 当前用户名（来自 selectedPersona.name，缺省 'User'）
 * @param customStops 用户自定义停止串数组（可选，每行一个）
 * @returns 去重后的 stop sequences 数组
 */
export function buildStopSequences(userName: string, customStops?: string[]): string[] {
  const safeUserName = (userName && userName.trim()) || DEFAULT_USER_NAME;
  // 仅保留双换行前缀，匹配段落分隔，避免 AI 在回复中间引用用户话语时被误截断
  const defaultStops = [
    `\n\n${safeUserName}:`,
    `\n\n${safeUserName}：`,
    '\n\n用户:',
    '\n\n用户：',
    '\n\nUser:',
    '\n\nUser：',
  ];

  // 合并并去重（保留首次出现顺序）；同时过滤空串与纯空白串。
  // 注：默认数组内部在 userName 恰为 "User"/"用户" 时也会产生重复，需统一去重。
  const merged: string[] = [];
  const pushIfValid = (s: string) => {
    if (typeof s === 'string' && s.trim().length > 0 && !merged.includes(s)) {
      merged.push(s);
    }
  };
  defaultStops.forEach(pushIfValid);
  if (Array.isArray(customStops)) {
    customStops.forEach(pushIfValid);
  }
  return merged;
}

/**
 * 用户回复生成专用停止序列——以角色名变体防止 AI 越权生成角色回复。
 *
 * Spec: add-ai-user-reply-button / Task 1.2
 * 与 `buildStopSequences`（用户名变体）对称：`buildStopSequences` 阻断 AI
 * 代替用户发言，本函数阻断 AI 在用户回复生成场景下越权代替角色发言。
 *
 * 默认返回 4 项数组，仅使用双换行前缀（\n\n），匹配段落分隔。
 *
 * 🐛 Bug修复（重点）：与 buildStopSequences 同步，移除单换行前缀变体。
 * 原实现的单换行变体（\n${charName}: 等）会被 OpenAI-compatible 后端按子串匹配
 * 误触发，当 AI 在用户回复中引用角色话语时导致截断。
 *
 * 当传入 customStops（用户在 ParameterPanel 自定义）时，合并到数组末尾并去重。
 * 去重保留首次出现顺序，确保默认角色名变体优先。
 *
 * @param charName 当前角色名（来自 characterInfo.characterCardName，缺省 'Character'）
 * @param customStops 用户自定义停止串数组（可选，每行一个）
 * @returns 去重后的 stop sequences 数组
 */
export function buildStopSequencesForUserReply(charName: string, customStops?: string[]): string[] {
  const safeCharName = (charName && charName.trim()) || 'Character';
  // 仅保留双换行前缀，避免 AI 在回复中间引用角色话语时被误截断
  const defaultStops = [
    `\n\n${safeCharName}:`,
    `\n\n${safeCharName}：`,
    '\n\n{{char}}:',
    '\n\n{{char}}：',
  ];

  // 合并并去重（保留首次出现顺序）；同时过滤空串与纯空白串。
  // 注：默认数组内部在 charName 恰为 '{{char}}' 时会产生重复，需统一去重。
  const merged: string[] = [];
  const pushIfValid = (s: string) => {
    if (typeof s === 'string' && s.trim().length > 0 && !merged.includes(s)) {
      merged.push(s);
    }
  };
  defaultStops.forEach(pushIfValid);
  if (Array.isArray(customStops)) {
    customStops.forEach(pushIfValid);
  }
  return merged;
}

/**
 * 角色卡字段接口（buildRoleAnchorMessage 输入）。
 *
 * 仅声明所需字段，兼容 CharacterInfo 与角色卡原始数据：
 * - `name`：角色名（缺省 'Character'）
 * - `personality`：角色个性（首选锚定来源）
 * - `description`：角色描述（personality 为空时的 fallback）
 */
export interface RoleAnchorCharacterCard {
  name?: string;
  personality?: string;
  description?: string;
}

/**
 * 角色深度锚定消息内容上限（按字符计）。
 *
 * Spec: optimize-chat-ai-intelligence / Task 4.1
 * `personality` 前 200 字符作为锚定摘要；`personality` 为空时 fallback 到 `description`。
 * 200 中文字 ≈ 260-280 tokens（cl100k_base 实测），加上固定文案约 350 tokens。
 */
const ROLE_ANCHOR_SUMMARY_MAX_CHARS = 200;

/**
 * 构建角色深度锚定（depth_prompt）的 system 消息。
 *
 * Spec: optimize-chat-ai-intelligence / Task 4.1
 * 借鉴 SillyTavern `data.extensions.depth_prompt`（默认 depth=4，public/script.js:549, 4400-4402），
 * 在裁剪后消息列表深处周期性注入角色精简摘要，防止长上下文截断后早期角色设定被"稀释"。
 *
 * 摘要提取规则（spec Scenario: 长对话角色一致性）：
 *   1. 提取 `characterCard.personality` 前 200 字符
 *   2. 若 `personality` 为空（undefined / null / 空白），fallback 到 `description` 前 200 字符
 *   3. 若两者都为空，summary 为空字符串（仍输出锚定文案，但缺核心设定）
 *
 * 格式（spec 原文）：
 *   `[角色锚定] {{char}} 的核心设定：{{summary}}。始终以 {{char}} 视角回复，禁止替 {{user}} 发言。`
 *
 * {{char}} 替换为 characterCard.name（缺省 'Character'），{{user}} 替换为 userName（缺省 'User'）。
 *
 * @param characterCard 角色卡（name / personality / description）
 * @param userName 当前用户名（缺省 'User'）
 * @returns 角色锚定 system 消息（role: 'system'）
 */
export function buildRoleAnchorMessage(
  characterCard: RoleAnchorCharacterCard,
  userName: string = DEFAULT_USER_NAME
): { role: 'system'; content: string } {
  const charName = (characterCard.name && characterCard.name.trim()) || 'Character';
  const safeUserName = (userName && userName.trim()) || DEFAULT_USER_NAME;

  // 摘要提取：personality 优先，空则 fallback 到 description，取前 200 字符
  const personality = (characterCard.personality ?? '').trim();
  const description = (characterCard.description ?? '').trim();
  const rawSummary = personality || description;
  const summary = rawSummary.slice(0, ROLE_ANCHOR_SUMMARY_MAX_CHARS);

  // 格式化锚定文案（{{char}} / {{user}} 替换）
  const content = `[角色锚定] ${charName} 的核心设定：${summary}。始终以 ${charName} 视角回复，禁止替 ${safeUserName} 发言。`;

  return { role: 'system', content };
}

/**
 * 构建续写去重提示词（continue_nudge_prompt）。
 *
 * Spec: optimize-chat-ai-intelligence / Task 5.4 + Task 8.1 + Scenario: 续写去重
 * 借鉴 SillyTavern `continue_nudge_prompt` 机制（public/scripts/openai.js:109，
 * 提示词 `[Continue your last message without repeating its original content.]`），
 * 当续写检测到新内容与 initialContent 重叠率 > 60%（Task 5.3）时，
 * 注入该提示词约束 AI "继续而非重写"。
 *
 * Task 5.4：本函数返回 spec 原文提示词，作为 nudge 文本来源。
 * Task 8.1（已完成）：在 buildContinuationPrompt 末尾追加本提示词段落，
 *   让所有续写请求首次即含 nudge 约束（提示层防线）。
 * Task 8.2（已完成）：continueConversation 在 overlapRate > 0.6 触发重试时，
 *   通过 dedupConfig.injectContinueNudge=true 在消息数组末尾追加本提示词作为
 *   system 消息（hooks.ts::requestAIResponse，检测层防线 + 重试时强提示）。
 *
 * 返回内容（spec 原文）：
 *   `[Continue your last message without repeating its original content.]`
 *
 * @returns continue_nudge_prompt 字符串
 */
export function buildContinueNudgePrompt(): string {
  return '[Continue your last message without repeating its original content.]';
}

/**
 * 构建回复长度引导约束提示词。
 *
 * Spec: fix-ai-response-length-degradation / Task 3.2
 * 通过在系统提示末尾注入字数下限约束，防止 AI 在持续对话中因上下文学习
 * 复制逐渐缩短的回复模式（LLM 固有特性）。
 *
 * 默认约束段：`【回复要求】{{char}} 的每次回复应不少于 X 字，包含详细的
 * 动作描写、语言对话和内心活动，避免简短敷衍的回复。`
 *
 * 当 `strengthen=true` 时（由 Task 4 检测到连续 3 轮短回复触发），追加
 * 强化约束段：`【重要提醒】你最近的回复过短。请务必每次回复至少 X 字，
 * 展开细节描写，包括动作、神态、语言和内心活动。`
 *
 * 注：`charName` 参数与 `buildCharacterContext` 中 `charName = name || 'Character'`
 * 保持一致（直接使用实际角色名而非 `{{char}}` 模板变量，避免下游未替换时残留）。
 *
 * @param minResponseChars 最小回复字数（中文字符数）
 * @param strengthen 是否启用强化模式（连续 3 轮短回复时触发）
 * @param charName 角色名（缺省 'Character'，与 buildCharacterContext 一致）
 * @returns 长度引导约束字符串（minResponseChars<=0 时返回空串）
 */
export function buildLengthGuidancePrompt(
  minResponseChars: number,
  strengthen: boolean = false,
  charName: string = 'Character'
): string {
  if (!minResponseChars || minResponseChars <= 0) return '';
  const name = charName || 'Character';
  let prompt = `\n【回复要求】${name} 的每次回复应不少于 ${minResponseChars} 字，包含详细的动作描写、语言对话和内心活动，避免简短敷衍的回复。`;
  if (strengthen) {
    prompt += `\n【重要提醒】你最近的回复过短。请务必每次回复至少 ${minResponseChars} 字，展开细节描写，包括动作、神态、语言和内心活动。`;
  }
  return prompt;
}

/**
 * 构建 emoji 增强模式系统提示约束。
 *
 * 开启后引导 AI 在回复中适度使用 emoji 表达情感与语气，增强对话表现力。
 * emoji 应自然融入文本，不堆砌；每条回复 1-3 个为宜。
 */
export function buildEmojiEnhancedPrompt(charName: string = 'Character'): string {
  const name = charName || 'Character';
  return `\n【表情增强】${name} 的回复中应适度使用 emoji 表达情感与语气，例如喜悦😊、思考🤔、害羞😳、惊讶😲、无奈😅、调皮😜等。emoji 应自然融入对话文本与动作描写中，不得滥用或堆砌，每条回复使用 1-3 个 emoji 为宜。也可适度使用颜文字（如 (≧▽≦)、(╯‵□′)╯︵┻━┻）增强表现力。`;
}

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
 * @returns { emotion: 解析出的情绪键名（小写）或 null；cleanedContent: 剥离标记后的内容 }
 */
export function parseExpressionFromContent(content: string): { emotion: string | null; cleanedContent: string } {
  if (!content || typeof content !== 'string') {
    return { emotion: null, cleanedContent: content || '' };
  }

  const patterns: Array<{ regex: RegExp; name: string }> = [
    // 主格式：<<<EXPRESSION>>>key<<<END_EXPRESSION>>>（大小写不敏感）
    { regex: /<<<EXPRESSION>>>\s*([a-z_][a-z0-9_]*)\s*<<<END_EXPRESSION>>>/i, name: 'text-marker' },
    // 容错：仅有开始标记 <<<EXPRESSION>>>key 到文本末尾
    { regex: /<<<EXPRESSION>>>\s*([a-z_][a-z0-9_]*)\s*$/i, name: 'text-marker-unclosed' },
    // ⚠️ 容错：AI 输出残缺标记（如 <<>>key<<<_EXPRESSION>>>）
    // 策略：忽略尖括号数量，匹配 EXPRESSION 字样前后的有效情绪键名
    { regex: /[<>_]+EXPRESSION[<>_]+\s*([a-z_][a-z0-9_]*)\s*[<>_]+(?:END[_]*EXPRESSION|EXPRESSION)[<>_]+/i, name: 'text-marker-malformed' },
    // ⚠️ 容错：残缺开始标记 + key 到末尾（无结束标记）
    { regex: /[<>_]+EXPRESSION[<>_]+\s*([a-z_][a-z0-9_]*)\s*$/i, name: 'text-marker-malformed-unclosed' },
    // ⚠️ 终极兜底：文本末尾任意位置出现 EXPRESSION 字样，取其附近的情绪键名
    // 匹配 key 在 EXPRESSION 之前或之后的情况（key 必须是有效情绪词格式）
    { regex: /\b([a-z_][a-z0-9_]*)\s*[<>_]+(?:END[_]*EXPRESSION|EXPRESSION)[<>_]+\s*$/i, name: 'text-marker-fallback-before' },
    { regex: /EXPRESSION[<>_]+\s*([a-z_][a-z0-9_]*)\s*[<>_]*\s*$/i, name: 'text-marker-fallback-after' },
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
      return { emotion, cleanedContent };
    }
  }

  return { emotion: null, cleanedContent: content };
}

/**
 * 构建辅助模式系统提示词约束。
 *
 * Spec: add-assist-mode-options
 * 开启后，要求 AI 在回复正文末尾以结构化格式输出 3 个推荐选项，
 * 供用户点击选择以推进对话。选项需与当前对话上下文高度相关，
 * 具有 Galgame 风格的对话分支导向性。
 *
 * 【重点标记】修复：原使用 HTML 注释格式 `<!-- <suggestedOptions> -->`，
 * 但多数 AI 模型不会自然生成 HTML 注释，导致功能不生效。
 * 改用纯文本标记格式 `<<<SUGGESTED_OPTIONS>>>` ... `<<<END_OPTIONS>>>`，
 * 并在解析端增加多格式容错匹配。
 *
 * 【重点标记】强化：3 个选项分别具有不同特点，提供稳定/平衡/发散三种对话推进方向。
 */
export function buildAssistModePrompt(charName: string = 'Character'): string {
  const name = charName || 'Character';
  return `\n【辅助模式】在回复正文完成后，${name} 必须在末尾附加 3 个推荐对话选项，供用户选择以推进对话。每个选项为一句用户可能说出的话或做出的行动。

三个选项必须各有侧重：
1. 稳妥推进——贴合当前剧情走向，延续已有话题或情感线，风险最低、最自然的回应
2. 平衡探索——在当前语境中适度转换角度，既不完全脱离也不纯跟风，保持对话张力
3. 发散创新——引入新元素、新话题或意外行动，可能开启全新剧情分支或转折

选项内容格式要求（必须严格遵守）：
- 用圆括号()包裹人物的动作、状态、表情及周围环境描写等非语言元素，如(微微一笑)、(看向窗外)、(心中一紧)
- 用双引号""包裹人物的语言、心理活动等对话及内心独白内容，如"你好啊"、"好想再见他一面"
- 两种描述交替使用，使选项生动具象

示例：(微微一笑)"今天天气真好呢，要一起出去走走吗？"

格式要求：在正文之后另起一行，严格按以下格式输出（包含开始和结束标记），不要额外解释：

<<<SUGGESTED_OPTIONS>>>
1. (动作描写)"对话内容"
2. (动作描写)"对话内容"
3. (动作描写)"对话内容"
<<<END_OPTIONS>>>

注意：选项内容应简洁（通常 10-50 字），三个选项必须内容不同、方向各异。此选项块对用户不可见，系统会自动解析并展示为可点击按钮。`;
}

/**
 * 构建 AI 回复语言约束。
 *
 * 根据用户选择的语言，在系统提示词中注入语言要求。
 * 默认中文（undefined 视为中文）。
 */
export function buildLanguagePrompt(language: 'zh' | 'en' | 'ja' = 'zh'): string {
  const langMap: Record<string, string> = {
    zh: '中文',
    en: '英文',
    ja: '日文',
  };
  const langName = langMap[language] || '中文';
  return `\n【语言要求】你的回复必须使用${langName}。无论用户使用什么语言提问，你都应当使用${langName}进行回复。`;
}

/**
 * 构建用户回复生成专用系统提示。
 *
 * Spec: add-ai-user-reply-button / Task 1.1
 * 用于"AI回复"按钮：让 AI 扮演用户人设，仅生成用户侧的下一句回复，
 * 填入输入框供用户编辑后发送（不自动发送）。
 *
 * 与 `buildDialoguePrompt`（角色扮演对话）对称——后者让 AI 扮演 {{char}}，
 * 本函数让 AI 扮演 {{user}}，并结合对方角色上下文（characterCardName /
 * personality / characterCardContent）确保回复自然衔接。
 *
 * 防御性返回：当 `persona` 为空或 `persona.name` 为空时返回空串，
 * 由调用方（hooks.ts::generateUserReply）做前置校验后调用。
 *
 * 长度约束：50-200 字（用户回复通常较短，避免长篇大论），与
 * `buildLengthGuidancePrompt` 的下限约束不同——此处为上限引导。
 *
 * @param characterInfo 对方角色信息（characterCardName / personality / characterCardContent）
 * @param persona 当前用户人设（name / description）
 * @param person 人称视角（'first' 第一人称默认 / 'second' 第二人称 / 'third' 第三人称），缺省 'first'
 * @returns 系统提示字符串；persona 缺失或 name 为空时返回空串
 */
export function buildUserReplySystemPrompt(
  characterInfo: CharacterInfoForPrompt,
  persona: UserPersona,
  person?: 'first' | 'second' | 'third',
  userInstruction?: string
): string {
  // 防御性校验：persona 缺失或 name 为空时返回空串
  if (!persona || !persona.name || !persona.name.trim()) return '';

  const userName = persona.name.trim();
  // 人称视角归一化（Spec: add-person-attribute-to-ai-reply）
  // 默认 'first'（向后兼容，不传时行为不变）
  const personValue = person || 'first';
  const charName = (characterInfo.characterCardName && characterInfo.characterCardName.trim()) || 'Character';
  const personaDescription = persona.description && persona.description.trim()
    ? persona.description.trim()
    : '（未提供用户描述）';

  // 角色个性（如存在）
  const personality = characterInfo.personality && characterInfo.personality.trim()
    ? characterInfo.personality.trim()
    : '';

  // 角色描述（如存在，截断到前 300 字）
  let characterCardContent = '';
  if (characterInfo.characterCardContent && characterInfo.characterCardContent.trim()) {
    const raw = characterInfo.characterCardContent.trim();
    characterCardContent = raw.length > 300 ? raw.slice(0, 300) + '...' : raw;
  }

  // 构建对方角色上下文段落（按字段存在性追加，避免空行）
  let charContextLines = `- 角色名：${charName}`;
  if (personality) {
    charContextLines += `\n- 角色个性：${personality}`;
  }
  if (characterCardContent) {
    charContextLines += `\n- 角色描述：${characterCardContent}`;
  }

  // 人称视角约束（Spec: add-person-attribute-to-ai-reply / Task 1.2）
  let personConstraint: string;
  if (personValue === 'second') {
    personConstraint = `以第二人称（"你"）视角生成回复，使用"你"来指代 ${userName} 自身（互动小说风格）`;
  } else if (personValue === 'third') {
    personConstraint = `以第三人称叙事视角生成回复，使用"${userName}"作为主语（小说叙事风格）`;
  } else {
    // 'first' 或默认值
    personConstraint = `以第一人称（"我"）视角生成回复，使用"我"作为自称`;
  }

  // 用户指令段落（输入框有内容时注入，引导 AI 按用户意图生成回复）
  const trimmedInstruction = userInstruction && userInstruction.trim() ? userInstruction.trim() : '';
  const instructionSection = trimmedInstruction
    ? `\n\n## 用户指令\n${trimmedInstruction}\n\n请在生成回复时参考上述用户指令，使回复内容符合用户的意图。`
    : '';

  // 任务要求第 5 条：有用户指令时追加遵循提示
  const requirement5 = trimmedInstruction
    ? `5. 结合对话历史与 ${charName} 的最新发言自然衔接，并遵循上方"用户指令"的要求`
    : `5. 结合对话历史与 ${charName} 的最新发言自然衔接`;

  return `你是对话模拟器，需要扮演用户 **${userName}** 生成下一句回复。

## 用户人设
- 用户名：${userName}
- 用户描述：${personaDescription}

## 对方角色上下文
${charContextLines}
${instructionSection}
## 任务要求
1. 仅输出 ${userName} 的下一句回复内容
2. 不要输出 ${charName} 的回复
3. 不要解释、不要引号包裹、不要前缀（如"${userName}:"）
4. 回复内容应符合 ${userName} 的人设特征与说话方式
${requirement5}
6. 回复长度建议 50-200 字（用户回复通常较短，避免长篇大论）
7. ${personConstraint}

直接输出回复内容本身。`;
}

/**
 * 构建润色输入专用系统提示。
 *
 * Spec: refine-user-input-text / Task 1
 * 用于"润色"按钮：让 AI 作为文本润色器，基于对话上下文优化用户草稿文本，
 * 替换输入框内容供用户编辑后发送（不自动发送）。
 *
 * 与 `buildUserReplySystemPrompt` 的区别：后者从零生成全新回复，
 * 本函数在用户已有草稿基础上进行润色优化，保持原始意图。
 *
 * 防御性返回：当 `persona` 为空 / `persona.name` 为空 / `originalText` 为空时返回空串，
 * 由调用方（hooks.ts::polishInput）做前置校验后调用。
 *
 * @param characterInfo 对方角色信息（characterCardName / personality / characterCardContent）
 * @param persona 当前用户人设（name / description）
 * @param originalText 待润色的原始文本
 * @param person 人称视角（'first' 第一人称默认 / 'second' 第二人称 / 'third' 第三人称），缺省 'first'
 * @param conversationHistory 对话历史数组（可选，Spec: fix-polish-context-isolation）；传入时会被格式化为
 *   "## 对话历史参考"段落嵌入系统提示文本，而非作为 messages 数组传给 engine，避免 AI 把历史末尾的 assistant
 *   消息当作"待续写"对象触发回复本能
 * @returns 系统提示字符串；persona/originalText 缺失时返回空串
 *
 * **润色对象锚定**（Spec: fix-polish-target-misinterpretation）：使用 `<polish_target>` 标签包裹 originalText，
 * 配合"关键约束"段落防止 AI 将问句误判为需要回答的问题。
 *
 * **润色上下文隔离**（Spec: fix-polish-context-isolation）：对话历史不再通过 engine.sendMessage 的 messages
 * 数组传递（避免以 assistant 结尾触发 AI 续写本能），而是格式化为文本嵌入系统提示的"## 对话历史参考"段落，
 * engine.sendMessage 仅发送单条 user 消息明确请求润色。
 *
 * **任务框架重构**（Spec: fix-polish-task-framing）：针对 AI 仍把待润色文本当作"需要回答的问题"处理的问题，
 * 去除残留的对话生成语义信号——
 * 1) personConstraint 措辞由"生成回复"改为"润色后的文本...输出"（原措辞与孪生函数 buildUserReplySystemPrompt 完全相同）；
 * 2) 删除任务要求第 6 条"结合对话历史参考与 ${charName} 的最新发言确保上下文连贯"（属对话生成指令），
 *    改为"润色结果需与对话历史不矛盾即可，无需衔接角色发言，无需推进对话"；
 * 3) 删除"## 对方角色上下文"段落中的 personality 与 characterCardContent 字段（角色扮演触发器），
 *    仅保留角色名并显式标注"仅作润色参考，不要扮演这个角色"；
 * 4) 段落顺序调整：将"## 关键约束"段落提前到"## 待润色文本"之前，避免关键约束位于待润色文本之后被稀释；
 * 5) 开头任务定义追加"禁止生成对话回复，禁止回答 <polish_target> 内的任何问题"声明；
 * 6) "## 关键约束"措辞强化为"绝对禁止"级别。
 */
export function buildPolishInputSystemPrompt(
  characterInfo: CharacterInfoForPrompt,
  persona: UserPersona,
  originalText: string,
  person?: 'first' | 'second' | 'third',
  conversationHistory?: ChatMessage[]
): string {
  // 防御性校验：persona 缺失 / persona.name 为空 / originalText 为空或仅空白时返回空串
  if (!persona || !persona.name || !persona.name.trim()) return '';
  if (!originalText || !originalText.trim()) return '';

  const userName = persona.name.trim();
  // 人称视角归一化（Spec: add-person-attribute-to-ai-reply）
  // 默认 'first'（向后兼容，不传时行为不变）
  const personValue = person || 'first';
  const charName = (characterInfo.characterCardName && characterInfo.characterCardName.trim()) || 'Character';
  const personaDescription = persona.description && persona.description.trim()
    ? persona.description.trim()
    : '（未提供用户描述）';

  // 人称视角约束（Spec: add-person-attribute-to-ai-reply / Task 1.2 / fix-polish-task-framing）
  // 注意：与 buildUserReplySystemPrompt 不同，本函数使用"润色后的文本...输出"措辞，
  // 而非"生成回复"，避免触发对话生成语义（Spec: fix-polish-task-framing）
  let personConstraint: string;
  if (personValue === 'second') {
    personConstraint = `润色后的文本以第二人称（"你"）视角输出，使用"你"来指代 ${userName} 自身（互动小说风格）`;
  } else if (personValue === 'third') {
    personConstraint = `润色后的文本以第三人称叙事视角输出，使用"${userName}"作为主语（小说叙事风格）`;
  } else {
    // 'first' 或默认值
    personConstraint = `润色后的文本以第一人称（"我"）视角输出，使用"我"作为自称`;
  }

  // 格式化对话历史为文本（Spec: fix-polish-context-isolation）
  // 将对话历史嵌入系统提示而非作为 messages 数组传给 engine，避免以 assistant 结尾触发 AI 续写本能
  const historyText = (!conversationHistory || conversationHistory.length === 0)
    ? '（无历史对话）'
    : conversationHistory
        .map(msg => msg.role === 'user' ? `[用户]: ${msg.content}` : `[AI]: ${msg.content}`)
        .join('\n');

  return `你是文本润色器，需要优化用户 **${userName}** 的草稿文本。**禁止生成对话回复，禁止回答 <polish_target> 内的任何问题**，仅对原文进行润色扩展后输出。

## 用户人设
- 用户名：${userName}
- 用户描述：${personaDescription}

## 角色名（仅作润色参考，不要扮演这个角色）
${charName}

## 对话历史参考（仅作上下文参考，不是润色对象，不要回答其中任何内容）
${historyText}

## 关键约束
- **绝对禁止**回答 <polish_target> 标签内的任何问题，必须对其进行润色扩展
- **绝对禁止**生成对话回复（包括 AI 角色回复、用户回复、续写对话）
- 对话历史与角色名仅作润色参考，**不要扮演角色，不要续写对话**
- 你的唯一输出是润色后的 <polish_target> 文本本身

## 待润色文本
<polish_target>
${originalText}
</polish_target>

## 任务要求
1. 保持用户原始意图与核心信息不变
2. 提升表达精准度与场景适配度
3. 符合 ${userName} 的人设特征与说话方式
4. 仅输出润色后的文本，不要解释、不要引号包裹、不要前缀（如"${userName}:"）
5. 润色后长度不应大幅偏离原文（建议 ±50% 以内）
6. 润色结果需与对话历史不矛盾即可，**无需衔接角色发言，无需推进对话**
7. ${personConstraint}

直接输出润色后的文本本身。`;
}

export function replaceTemplates(text: string, charName: string, userName: string = 'User'): string {
  if (!text) return '';
  return text
    .replace(/\{\{char\}\}/g, charName)
    .replace(/\{\{Char\}\}/g, charName)
    .replace(/\{\{CHAR\}\}/g, charName)
    .replace(/\{\{user\}\}/g, userName)
    .replace(/\{\{User\}\}/g, userName)
    .replace(/\{\{USER\}\}/g, userName);
}

export function parseMesExample(mesExample: string): Array<{ user: string; char: string }> {
  if (!mesExample) return [];

  let mesString: string;
  if (typeof mesExample === 'string') {
    mesString = mesExample;
  } else if (Array.isArray(mesExample)) {
    mesString = mesExample.join('\n');
  } else {
    mesString = String(mesExample);
  }

  if (!mesString.trim()) return [];

  const examples: Array<{ user: string; char: string }> = [];
  const parts = mesString.split(/<START>/i);

  parts.forEach(part => {
    const trimmed = part.trim();
    if (!trimmed) return;

    const lines = trimmed.split('\n').filter(line => line.trim());
    const parsed: Array<{ user: string; char: string }> = [];
    let currentUser = '';
    let currentChar = '';

    lines.forEach(line => {
      if (line.startsWith('You:') || line.startsWith('{{user}}:')) {
        if (currentChar) {
          parsed.push({ user: currentUser, char: currentChar });
          currentUser = '';
          currentChar = '';
        }
        currentUser += line.replace(/^(You|{{user}}):\s*/, '') + '\n';
      } else if (line.includes(':')) {
        currentChar += line.replace(/^[^:]+:\s*/, '') + '\n';
      } else {
        currentChar += line + '\n';
      }
    });

    if (currentChar) {
      parsed.push({ user: currentUser.trim(), char: currentChar.trim() });
    }

    examples.push(...parsed);
  });

  return examples;
}

// ==================== 第一步：构建角色上下文 ====================
// 数据来源：角色卡信息（characterCardName、personality、description、scenario、mes_example、system_prompt、creator_notes）

export function buildCharacterContext(
  characterInfo: {
    name?: string;
    personality?: string;
    description?: string;
    scenario?: string;
    mes_example?: string;
    system_prompt?: string;
    creator_notes?: string;
  },
  userName: string = 'User',
  /**
   * 长度引导约束选项（Spec: fix-ai-response-length-degradation / Task 3.3）。
   * 可选；未传入时不追加任何长度引导约束，保持向后兼容。
   * - `minResponseChars`：最小回复字数（中文字符数），>0 时追加约束
   * - `strengthenLength`：是否启用强化模式（连续 3 轮短回复时为 true）
   */
  options?: {
    minResponseChars?: number;
    strengthenLength?: boolean;
  }
): string {
  const { name, personality, description, scenario, mes_example, system_prompt, creator_notes } = characterInfo;
  const charName = name || 'Character';
  let context = '';

  context += `角色名称：${charName}\n`;

  if (personality) {
    context += `角色个性：${personality}\n`;
  }

  if (description) {
    context += `角色描述：${description}\n`;
  }

  if (scenario) {
    context += `场景背景：${scenario}\n`;
  }

  if (creator_notes) {
    context += `创作者备注：${creator_notes}\n`;
  }

  if (system_prompt) {
    context += `系统提示：${system_prompt}\n`;
  }

  if (mes_example) {
    const examples = parseMesExample(mes_example);
    if (examples.length > 0) {
      context += `示例对话：\n`;
      examples.forEach((ex, i) => {
        if (i > 0) context += `<START>\n`;
        if (ex.user) context += `${userName}: ${ex.user}\n`;
        if (ex.char) context += `${charName}: ${ex.char}\n`;
      });
    }
  }

  // 角色卡为绝对权威约束（Spec: optimize-chat-ai-intelligence / Task 4.3）
  // 与深度锚定（Task 4.1/4.2）形成"系统提示 + 深度锚定"双重角色一致性保障：
  // 头部 system prompt 显式声明角色卡权威性，深处 depth=4 注入精简摘要防止长对话漂移。
  // 注：{{char}} 在此处已替换为实际 charName，避免模板变量残留。
  context += `\n【重要】角色卡设定为绝对权威，必须严格遵循 ${charName} 的性格、背景与说话方式，不得偏离。`;

  // 回复长度引导约束（Spec: fix-ai-response-length-degradation / Task 3.3）
  // 在角色卡权威约束之后追加字数下限引导，防止 AI 在持续对话中复制逐渐缩短的回复模式。
  // strengthenLength=true 时（连续 3 轮短回复）追加强化约束段落。
  if (options?.minResponseChars && options.minResponseChars > 0) {
    context += buildLengthGuidancePrompt(
      options.minResponseChars,
      options.strengthenLength === true,
      charName
    );
  }

  return context.trim();
}

// ==================== 第二步：构建用户人设部分 ====================
// 数据来源：用户人设信息（selectedPersona 的 name 和 description 字段）

export function buildPersonaSection(persona?: UserPersona): string {
  if (!persona || !persona.name) return '';

  // 通用人设：不注入固定人设描述，而是引导 AI 根据角色卡中 {{user}} 的设定动态确定用户身份
  if (persona.isGeneric) {
    return `
## 用户人设（通用人设）

用户当前使用的是"通用人设"，没有预设特定的身份背景。请根据角色卡中关于 {{user}} 的描述（如身份、关系、背景等）来确定用户在当前对话中的角色定位。

角色卡中关于 {{user}} 的设定即为用户的身份依据；角色卡中未指定的细节，你可以根据对话场景自由发挥，但需保持与世界观和角色关系的一致性。
`;
  }

  return `
## 用户人设

你正在与用户 **${persona.name}** 进行对话。

${persona.description ? `### 用户信息\n${persona.description}` : ''}

请根据上述用户人设信息调整你的对话风格和回应方式。
`;
}

// ==================== 第三步：组合核心上下文 ====================
// 数据来源：第一步（角色上下文）+ 第二步（用户人设）

export function buildPromptCore(
  characterInfo: CharacterInfoForPrompt,
  selectedPersona?: UserPersona
): PromptCoreResult {
  const charName = characterInfo.characterCardName || 'Character';
  const characterContext = buildCharacterContext({
    name: charName,
    personality: characterInfo.personality,
    description: characterInfo.characterCardContent,
    scenario: characterInfo.scenario,
    mes_example: characterInfo.mes_example,
    system_prompt: characterInfo.system_prompt,
    creator_notes: characterInfo.creator_notes,
  }, DEFAULT_USER_NAME);

  const personaSection = buildPersonaSection(selectedPersona);

  return { characterContext, personaSection, charName };
}

/**
 * ⚠️【重点标记】对话格式指令注入器
 *
 * 修复 Bug：系统提示词模板可能来自数据库旧版（mergeNewDefaultTemplates 不更新已有模板），
 * 旧模板写着"不要添加任何额外的标记或说明"，导致 AI 不使用 *动作* 格式，
 * 动作描写渲染样式（message-renderer-action）永远不触发。
 *
 * 此函数在提示词返回前做后处理：
 * 1. 移除"不要添加任何额外的标记或说明"语句
 * 2. 追加格式要求指令（对话用双引号，动作用星号）
 */
function injectDialogueFormatInstructions(systemPrompt: string): string {
  let result = systemPrompt;

  // 移除旧版禁止标记语句（覆盖多种变体写法）
  result = result.replace(
    /不要添加任何额外的标记或说明[。\n]?/g,
    ''
  );

  // 追加格式指令（若已包含则不重复注入）
  const formatInstruction = `\n【输出格式要求】
- 角色直接说出的对话内容必须用标准英文双引号（" "）完整包裹
- 角色的动作、神态、心理活动等非对话描写必须用星号包裹（如 *微微一笑* 或 *她低下头，脸微微泛红*）
- 对话与动作描写可自然交替，像真实的人在说话一样
- 星号 *动作描写* 是格式标记，不属于"额外标记或说明"`;

  if (!result.includes('角色的动作、神态、心理活动等非对话描写必须用星号包裹')) {
    result = result.trimEnd() + '\n' + formatInstruction;
  }

  return result;
}

// ==================== 第四步：构建基础任务提示词 ====================
// 数据来源：第三步（核心上下文）+ 任务类型（对话/续写）+ 约束规则

export async function buildDialoguePrompt(
  characterInfo: CharacterInfoForPrompt,
  selectedPersona?: UserPersona,
  organizeMode?: 'sync' | 'async'
): Promise<string> {
  // 第一步：获取角色上下文和人设
  const { characterContext, personaSection, charName } = buildPromptCore(characterInfo, selectedPersona);
  // 第二步：获取用户名（来自人设或使用默认值）
  const userName = selectedPersona?.name || DEFAULT_USER_NAME;

  // 根据 organizeMode 生成动态任务说明
  const tableEditInstruction = organizeMode === 'async'
    ? `并在续写完成后通过tableEdit完成数据整理。系统将在提示词末尾提供详细的表格整理指令，请严格按照指令要求在回复末尾生成详细的tableEdit标签，认真解析对话内容（时空、角色、社交、物品、事件等），不要忽略任何细节。`
    : '';

  // 从模板系统获取提示词
  try {
    const promptResult = await window.electronAPI.prompt.build('creative-chat.dialogue', {
      char_name: charName,
      user_name: userName,
      table_edit_instruction: tableEditInstruction,
      character_context: characterContext,
      persona_section: personaSection
    });
    if (promptResult.success && promptResult.data) {
      return injectDialogueFormatInstructions(promptResult.data.systemPrompt);
    }
  } catch (e) {
    console.error('[PromptBuilder] 获取对话模式模板失败，使用硬编码回退:', e);
  }

  // 回退：使用硬编码内容（保留原始逻辑）
  return `【主要任务类型：角色扮演对话】

【对话任务说明】
你正在扮演 {{char}} 这个角色，与 ${userName} 进行角色扮演对话。${tableEditInstruction}
在提示词中，{{char}} 代表 ${charName}，${userName} 代表当前对话用户。
你需要完全代入角色，以角色的身份与用户进行自然的交流。${tableEditInstruction}
【对话约束规则】
1. 你就是 ${charName} 这个角色本人，不是AI助手，不是翻译工具，不是任何系统
2. 以角色的口吻、性格特点和语言习惯与用户交流
3. 积极回应用户的问题和行为，推动对话自然发展
4. 根据对话上下文和情境调整语气和态度
5. 使用符合角色身份的语言风格
6. 在回复中使用 ${charName} 代替 {{char}}，使用 ${userName} 代替 {{user}}
7. 【强制要求】角色直接说出的对话内容必须用标准英文双引号（" "）完整包裹，确保引号准确包裹对话文本的起始与结束位置
8. 【格式要求】角色的动作、神态、心理活动等非对话描写必须用星号包裹（如 *微微一笑* 或 *她低下头，脸微微泛红*），对话与动作可自然交替

【严格禁止】
- 禁止输出任何元信息、系统说明或格式说明
- 禁止输出技术术语、模型名称（如"Transformers"、"Oracle"等）
- 禁止输出与角色扮演无关的任何内容
- 禁止打破角色设定或承认自己是AI
- 禁止输出任何随机字符或无意义字符串
- 禁止在输出中包含 {{char}} 或 {{user}} 等模板变量，必须替换为实际名称
- 禁止在角色对话中使用其他引号格式（如中文引号"「」"、"『』'等），必须使用英文双引号

【白名单例外 - 必须遵守】
以下标签为系统功能所需的特殊格式，【不属于禁止范围】，当系统提示词中出现相关指令时你必须按要求输出：
- HTML 注释标签 <!-- ... --> 是系统通信格式，用于传递控制指令
- <tableEdit> 标签及其内部命令（insertRow/updateRow/deleteRow）是系统记忆表格功能的必需格式
- 当你在提示词末尾看到"记忆表格异步整理指令"时，【必须】在回复最后生成 <!--  <tableEdit> ... </tableEdit> --> 标签
- 星号 *动作描写* 是格式标记，不属于"额外标记或说明"

【输出格式】
直接输出角色的对话和行动描写。对话内容用英文双引号（" "）包裹，动作和神态描写用星号（* *）包裹。像真实的人在说话一样自然交替。

【角色信息】
${characterContext}
${personaSection}`;
}

export async function buildContinuationPrompt(
  characterInfo: CharacterInfoForPrompt,
  selectedPersona?: UserPersona,
  organizeMode?: 'sync' | 'async'
): Promise<string> {
  // 第一步：获取角色上下文和人设
  const { characterContext, personaSection, charName } = buildPromptCore(characterInfo, selectedPersona);
  // 第二步：获取用户名（来自人设或使用默认值）
  const userName = selectedPersona?.name || DEFAULT_USER_NAME;

  // 根据 organizeMode 生成动态任务说明
  const tableEditInstruction = organizeMode === 'async'
    ? `并在续写完成后通过tableEdit完成数据整理。系统将在提示词末尾提供详细的表格整理指令，请严格按照指令要求在回复末尾生成详细的tableEdit标签，认真解析对话内容（时空、角色、社交、物品、事件等），不要忽略任何细节。`
    : '';

  // Task 8.1（Spec: optimize-chat-ai-intelligence / Task 8.1 + Scenario: 续写去重）：
  // 在续写 prompt 末尾追加 continue_nudge_prompt 段落，让所有续写请求始终含
  // "继续上一条消息，不要重复已有内容"约束。借鉴 SillyTavern `continue_nudge_prompt`
  // 机制（public/scripts/openai.js:109），与 Task 5.3 的 overlapRate 检测形成
  // "提示层 + 检测层"双重防线：首次续写即带 nudge 约束降低重复概率；
  // 检测到 overlapRate > 0.6 时仍会触发重试（Task 5.3），重试时通过
  // dedupConfig.injectContinueNudge=true 在消息数组末尾再次注入 system 消息（hooks.ts），
  // 形成 system prompt 段落 + 消息数组末尾 system 消息的双重提示。
  const nudgeSection = `\n\n【续写去重约束】\n${buildContinueNudgePrompt()}`;

  // 从模板系统获取提示词
  try {
    const promptResult = await window.electronAPI.prompt.build('creative-chat.continuation', {
      char_name: charName,
      user_name: userName,
      table_edit_instruction: tableEditInstruction,
      character_context: characterContext,
      persona_section: personaSection
    });
    if (promptResult.success && promptResult.data) {
      return promptResult.data.systemPrompt + nudgeSection;
    }
  } catch (e) {
    console.error('[PromptBuilder] 获取续写模式模板失败，使用硬编码回退:', e);
  }

  // 回退：使用硬编码内容（保留原始逻辑）+ Task 8.1 追加 continue_nudge_prompt 段落
  return `【任务类型：内容续写】

【续写任务说明】
你需要续写以下角色的叙述内容。请仔细阅读前文，然后自然地继续写下去，保持风格和上下文的连贯性。${tableEditInstruction}
在提示词中，{{char}} 代表 ${charName}，${userName} 代表当前对话用户。

【续写约束规则】
1. 自然地从已有内容继续，不要重复已写过的部分
2. 保持与原文相同的叙述风格、语气和节奏
3. 确保续写内容与前面的情节逻辑衔接
4. 严格遵守角色设定，不偏离角色性格
5. 像小说作者一样续写，直接输出故事内容
6. 在回复中使用 ${charName} 代替 {{char}}，使用 ${userName} 代替 {{user}}
7. 【强制要求】角色直接说出的对话内容必须用标准英文双引号（" "）完整包裹，确保引号准确包裹对话文本的起始与结束位置

【严格禁止】
- 禁止添加任何标签、前缀或格式标记（如"Plain:"、"Article:"、"Terminate:"等）
- 禁止输出任何元说明文字（如"续写"、"继续"、"接下来"等）
- 禁止输出技术术语、模型名称
- 禁止输出与故事无关的任何内容
- 禁止解释、评论或总结已写内容
- 禁止输出任何随机字符或无意义字符串
- 禁止在输出中包含 {{char}} 或 {{user}} 等模板变量
- 禁止在角色对话中使用其他引号格式（如中文引号"「」"、"『』'等），必须使用英文双引号

【白名单例外 - 必须遵守】
以下标签为系统功能所需的特殊格式，【不属于禁止范围】，当系统提示词中出现相关指令时你必须按要求输出：
- HTML 注释标签 <!-- ... --> 是系统通信格式，用于传递控制指令
- <tableEdit> 标签及其内部命令（insertRow/updateRow/deleteRow）是系统记忆表格功能的必需格式
- 当你在提示词末尾看到"记忆表格异步整理指令"时，【必须】在回复最后生成 <!--  <tableEdit> ... </tableEdit> --> 标签

【输出格式】
只输出纯粹的续写内容，不要有任何开场白、结束语或其他多余文字。直接从故事断点处继续叙述，保持原文的视角和时态。

【角色信息】
${characterContext}
${personaSection}${nudgeSection}`;
}

// ==================== 第五步：格式化向量检索结果 ====================
// 数据来源：向量检索接口返回的 ContextVectorItem 数组（source、score、content）

export function formatVectorContextItems(items: ContextVectorItem[]): string {
  if (!items || items.length === 0) return '';

  console.log('[PromptBuilder] formatVectorContextItems - items:', items.map(item => ({
    source: item.source,
    content: item.content ? item.content.substring(0, 50) + '...' : '(empty)',
    metadata: item.metadata ? { entryName: item.metadata.entryName, source: item.metadata.source } : undefined,
  })));

  return items
    .map((item, index) => {
      const meta = item.metadata || {};
      // World book keyword match entries get special formatting
      if (meta.source === 'worldbook' || meta.matchType) {
        const entryName = meta.entryName || meta.entryComment || '世界书条目';
        const matchedKeys = meta.matchedKeys && meta.matchedKeys.length > 0 ? meta.matchedKeys.join(', ') : '';
        const header = matchedKeys 
          ? `[相关背景 ${index + 1}] ${entryName} (触发关键词: ${matchedKeys})`
          : `[相关背景 ${index + 1}] ${entryName}`;
        console.log(`[PromptBuilder] Formatting worldbook item ${index+1}: ${header}, content length=${item.content?.length || 0}`);
        return `${header}\n${item.content}`;
      }
      // Vector retrieval entries
      return `[相关上下文 ${index + 1}] (来源: ${item.source}, 相关性: ${(item.score * 100).toFixed(1)}%)\n${item.content}`;
    })
    .join('\n\n');
}

// ==================== 第六步：将向量上下文追加到提示词末尾 ====================
// 数据来源：第四步（基础任务提示词）+ 第五步（向量检索结果）

export async function buildFinalSystemPrompt(
  systemPrompt: string,
  vectorContextItems: ContextVectorItem[],
  memoryTableData?: string,
  organizeMode?: 'sync' | 'async',
  tableStructure?: { sheets: string[]; headers: Record<string, string[]>; descriptions: Record<string, string> },
  /**
   * 本会话相关历史片段（Spec: optimize-chat-ai-intelligence / Task 7.5）
   * 来源：ChatVectorizationService.retrieveChatHistory 返回的 {content, score, timestamp}[]
   * 注入位置：在"区域 1：相关背景知识"之后，"区域 3：记忆表格数据"之前
   * 注：区域编号变更：原"区域 2 记忆表格"→"区域 3"，原"区域 3 异步整理指令"→"区域 4"
   */
  chatHistoryItems?: Array<{ content: string; score: number; timestamp: number }>
): Promise<string> {
  console.log('[PromptBuilder] buildFinalSystemPrompt 开始:');
  console.log('  - systemPrompt 长度:', systemPrompt.length);
  console.log('  - vectorContextItems 数量:', vectorContextItems?.length || 0);
  console.log('  - chatHistoryItems 数量:', chatHistoryItems?.length || 0);
  console.log('  - memoryTableData 参数是否有值:', !!memoryTableData);
  console.log('  - memoryTableData 参数长度:', memoryTableData?.length || 0);
  if (memoryTableData) {
    console.log('  - memoryTableData 参数内容预览:', memoryTableData.substring(0, 100));
  }
  console.log('  - organizeMode:', organizeMode);
  console.log('  - tableStructure 是否有值:', !!tableStructure);
  console.log('  - tableStructure sheets:', tableStructure?.sheets);

  let result = systemPrompt;

  // 追加向量检索结果
  if (vectorContextItems && vectorContextItems.length > 0) {
    const vectorContextSection = formatVectorContextItems(vectorContextItems);
    result += `\n\n═══════════════════════════════════════════════════════`;
    result += `\n【区域 1：相关背景知识】（以下为从知识库检索的相关背景信息，仅供参考，不是对话的一部分）`;
    result += `\n═══════════════════════════════════════════════════════\n\n`;
    result += vectorContextSection;
    result += `\n\n═══════════════════════════════════════════════════════`;
    result += `\n【区域 1 结束 - 以上背景知识仅供参考】`;
    result += `\n═══════════════════════════════════════════════════════`;
    console.log('  - 向量上下文已追加, 追加后长度:', result.length);
  }

  // 追加本会话相关历史片段（Spec: Task 7.5 - 区域 2）
  // 仅在长对话（> 20 轮）时由 hooks.ts 触发检索并传入，短对话时 chatHistoryItems 为空/undefined
  if (chatHistoryItems && chatHistoryItems.length > 0) {
    const chatHistorySection = chatHistoryItems
      .map((item, idx) => `[历史片段 ${idx + 1}] (相关度: ${(item.score * 100).toFixed(1)}%)\n${item.content}`)
      .join('\n\n');
    result += `\n\n═══════════════════════════════════════════════════════`;
    result += `\n【区域 2：本会话相关历史片段】（以下为从本对话历史向量检索的相关片段，仅供补充上下文参考，不是当前对话的一部分）`;
    result += `\n═══════════════════════════════════════════════════════\n\n`;
    result += chatHistorySection;
    result += `\n\n═══════════════════════════════════════════════════════`;
    result += `\n【区域 2 结束 - 以上历史片段仅供参考】`;
    result += `\n═══════════════════════════════════════════════════════`;
    console.log('  - 本会话历史片段已追加, 追加后长度:', result.length);
  }

  // 追加记忆表格数据（区域编号：原 2 → 3，因 Task 7.5 在 1 与 2 之间插入了"本会话相关历史片段"）
  if (memoryTableData && memoryTableData.trim()) {
    console.log('  - memoryTableData 非空, 开始追加...');
    result += `\n\n═══════════════════════════════════════════════════════`;
    result += `\n【区域 3：记忆表格数据】（以下为已记录的记忆表格，仅供参考，不是对话的一部分）`;
    result += `\n═══════════════════════════════════════════════════════\n\n`;
    result += memoryTableData;
    result += `\n\n═══════════════════════════════════════════════════════`;
    result += `\n【区域 3 结束 - 以上记忆表格数据仅供参考】`;
    result += `\n═══════════════════════════════════════════════════════`;
    console.log('  - 记忆表格数据已追加, 最终长度:', result.length);
    console.log('  - 最终末尾 300 字符:', result.substring(Math.max(0, result.length - 300)));
  } else {
    console.log('  - memoryTableData 为空或 undefined, 跳过追加');
    console.log('    - memoryTableData === undefined:', memoryTableData === undefined);
    console.log('    - memoryTableData === "":', memoryTableData === '');
    console.log('    - memoryTableData?.trim():', memoryTableData?.trim());
  }

  // 异步整理模式：将完整指令拼接到 system prompt 末尾（区域编号：原 3 → 4）
  if (organizeMode === 'async') {
    result += `\n\n═══════════════════════════════════════════════════════`;
    result += `\n【区域 4：记忆表格异步整理指令】（以下为系统指令，不是对话内容，请严格按照要求执行）`;
    result += `\n═══════════════════════════════════════════════════════`;

    const asyncInstructions = await buildAsyncTableOrganizeInstructions(memoryTableData, tableStructure);
    result += asyncInstructions;

    result += `\n═══════════════════════════════════════════════════════`;
    result += `\n【区域 4 结束 - 以上为系统指令】`;
    result += `\n═══════════════════════════════════════════════════════`;
    console.log('  - 异步整理指令已追加到 system prompt, 最终长度:', result.length);
  }

  return result;
}

/**
 * 构建异步表格整理指令（完整版，与同步模式规则一致）
 * 固定指令部分从模板系统获取（creative-chat.async-table-instructions），
 * 动态部分（表格结构、当前表格状态、最终提醒）由代码构建并追加。
 */
export async function buildAsyncTableOrganizeInstructions(
  memoryTableData?: string,
  tableStructure?: { sheets: string[]; headers: Record<string, string[]>; descriptions: Record<string, string> }
): Promise<string> {
  // 从模板系统获取固定指令部分
  let baseInstructions = '';
  try {
    const promptResult = await window.electronAPI.prompt.build('creative-chat.async-table-instructions', {});
    if (promptResult.success && promptResult.data) {
      baseInstructions = promptResult.data.systemPrompt;
    }
  } catch (e) {
    console.error('[PromptBuilder] 获取异步表格指令模板失败，使用硬编码回退:', e);
  }

  // 如果模板获取失败，使用硬编码回退（固定指令部分）
  if (!baseInstructions) {
    baseInstructions = `\n\n【强制要求 - MANDATORY】
无论你输出了什么对话内容，你【必须】在回复的最后生成tableEdit命令标签。
这是系统功能的核心部分，不生成会导致数据处理失败！
即使没有新信息需要提取，也要生成空标签：<!--  <tableEdit>
</tableEdit> -->

【输出顺序 - 必须遵守】
1. 先输出完整的角色对话内容
2. 对话结束后换行，在文本末尾追加表格整理命令
3. 【最终确认】在输出结束前，检查是否已包含tableEdit标签，如果没有请立即生成

【tableEdit命令格式 - 严格遵循】
你需要将操作指令放在<tableEdit>标签内，使用HTML注释格式：

<!--  <tableEdit>
insertRow(表格索引, {"字段索引":"值", ...})
updateRow(表格索引, 行索引, {"字段索引":"值", ...})
deleteRow(表格索引, 行索引)
</tableEdit> -->

参数说明：
- 表格索引：从1开始，对应模板中页签的顺序
- 行索引：从1开始，对应该表格中的数据行索引
- 字段索引：从1开始，对应该表格表头的字段索引
- 每个表格的字段结构固定为：[1:流水号, 2:唯一id, 3+:自定义字段]
- 流水号(字段1)由系统自动递增，通常不需要手动填写
- 唯一id(字段2)由AI根据实体名称生成，需具有语义且保持一致性

示例(以角色表格为例，字段为[1:流水号,2:唯一id,3:角色名,4:身份,5:关系]):
- insertRow(1, {"2":"zhudi_001","3":"朱迪·霍普斯","4":"警官","5":"主角"})
  → 在第1个表格新增一行：唯一id=zhudi_001,角色名=朱迪·霍普斯,身份=警官,关系=主角
- updateRow(1, 2, {"4":"警长"})
  → 修改第1个表格的第2条数据，只更新身份字段为"警长"
- deleteRow(1, 3)
  → 删除第1个表格的第3条数据

【增量更新策略 - 重中之重】
这是增量更新操作，不是从头整理！你必须遵循以下规则：

1. **强制重复性检查**：在生成任何insertRow命令前，必须执行以下检查流程：
   - 步骤1：查看当前消息中的实体（物品名、角色名、地点等）
   - 步骤2：在"当前已有数据"中搜索相同或高度相似的实体
   - 步骤3：使用"唯一ID快速查找索引"确认该实体的唯一ID是否已存在
   - 步骤4：如果已存在 → 使用updateRow；如果不存在 → 使用insertRow

2. **唯一ID匹配规则**：如果现有数据中已有相同唯一ID的记录，必须使用updateRow而非insertRow

3. **名称相似度匹配**（关键！）：即使唯一ID不完全相同，如果出现以下情况也必须使用updateRow：
   - 物品名相同或高度相似（如"电子面罩"和"电子面具"）
   - 角色名相同或高度相似（如"朱迪"和"朱迪·霍普斯"）
   - 描述内容高度一致
   - 类型和关键属性相同

4. **避免重复插入**：绝不要为已存在的实体生成新的insertRow命令，这是最严重的错误！

5. **只更新变化部分**：使用updateRow时，只更新发生变化的字段，不要重复填写未变化的字段


增量更新决策流程：
1. 从当前消息中识别实体（角色、物品、地点、事件等）
2. 检查表格中是否已有该实体（通过唯一ID或关键特征匹配）
   a. 首先在"唯一ID快速查找索引"中查找
   b. 如果没找到，在"当前已有数据"中通过名称相似度查找
3. 如果存在 → 使用updateRow(表格索引, 行索引, {变化的字段})更新该实体信息
4. 如果不存在 → 使用insertRow(表格索引, {新实体字段})创建新记录
5. 如果实体不再相关 → 使用deleteRow(表格索引, 行索引)删除（谨慎使用）

正确示例：
- 现有数据：行1: 唯一ID=zhudi_001, 角色名=朱迪·霍普斯, 身份=警官
- 当前消息："朱迪说她今天升官了"
- 正确操作：updateRow(1, 1, {"4":"警长"})  ← 只更新身份字段
- 错误操作：insertRow(1, {"2":"zhudi_001","3":"朱迪·霍普斯","4":"警长"})  ← 重复插入，绝对禁止！

【核心任务：唯一ID策略与变体称呼识别】
这是你的首要任务！请认真遵循以下准则：

1. **唯一ID的重要性**：
   - 唯一ID是识别同一实体的关键标识，必须在整个对话中保持一致
   - 即使同一实体在对话中被不同称呼指代，也必须使用相同的唯一ID
   - 唯一ID应该具有语义化，但又足够唯一，避免与其他实体混淆

2. **变体称呼识别与链接**（重点！）：
   - **同一实体的不同称呼必须共用同一个唯一ID**
   - 全名 vs 缩写 vs 昵称："朱迪·霍普斯" = "朱迪" = "Judy" = "兔子" → 同一个唯一ID zhudi_001
   - 全名 vs 敬称："张三" = "张先生" → 同一个唯一ID
   - 代词回指："她"/"他"/"那个女孩" → 根据上下文指向判断对应的实体
   - 关键判断原则：如果上下文表明这些称呼指向同一个具体人物/物品/事件，则共用一个唯一ID

3. **唯一ID命名规范**：
   - 使用有意义的语义前缀 + 序号，如 "zhudi_001"、"zhangsan_001"
   - 对于英文名，可以使用拼音或英文缩写，如 "judy_001"、"jbond_001"
   - 确保ID简洁、可读、全局唯一


【约束规则】
- 标签必须用 <!--  <tableEdit> 开头，</tableEdit> --> 结尾，必须位于回复文本最后
- 标签内只含tableEdit命令，不含其他内容
- 只提取当前消息中明确提到的信息，不要造
- 已存在实体必须用updateRow，禁止insertRow重复插入
- 所有值必须是字符串类型，用双引号包裹
- 表格索引、行索引必须是数字，不是字符串


【错误格式示例 - 绝对禁止】

✗ insertRow(1, {"2":"zhudi_001","3":"朱迪·霍普斯","4":"警长"})
  错误原因：如果唯一id=zhudi_001已存在，应使用updateRow而非insertRow

✗ updateRow(1, 1, {"2":"zhudi_001","3":"朱迪·霍普斯","4":"警长","5":"兔子"})
  错误原因：重复填写了未变化的字段(唯一id、角色名)，只更新变化的字段即可

✗ insertRow("1", {"2":"badge_001","3":"金色徽章"})
  错误原因：表格索引必须是数字，不是字符串

 insertRow(2, {"2":"judy_badge","3":"警官徽章","4":"身份证明"})  ← 把物品放到角色表格！
  错误原因：警官徽章是物品不是角色，应该用insertRow(4, ...)放到物品表格（索引4），角色表格（索引2）只放人物

 updateRow(1, "1", {"4":"警长"})
  错误原因：行索引必须是数字，不是字符串


【表格分类快速判断】
在生成任何insertRow命令前，先问自己："这个实体是什么类型？"
- 是人/角色/生物？ → 角色表格（索引2）
- 是物品/装备/道具？ → 物品表格（索引4）
- 是时间/地点？ → 时空表格（索引1）
- 是事件/互动？ → 社交表格（索引3）或事件表格（索引5）
- 如果不确定，记住：角色持有的物品仍然是物品，不是角色！


【输出要求】
1. 只分析当前这条消息，不要分析其他消息
2. 从当前消息中提取关键信息，生成对应的tableEdit命令
3. 将命令放在<tableEdit>标签内
4. 如果没有需要提取的信息，返回空的<tableEdit></tableEdit>
5. 确保使用正确的表格索引、行索引和字段索引
6. 参考现有表格数据，避免重复添加相同信息
7. 识别变体称呼，使用唯一ID保持一致性
8. 只提取当前消息中明确提到的信息，不要臆造
9. 【最重要】增量更新：已存在的实体必须使用updateRow，禁止使用insertRow重复插入！
10. 重复检测：在生成insertRow前，必须先在"唯一ID快速查找索引"中查找，并在"当前已有数据"中通过名称相似度查找
11. 合并重复记录：如果发现表格中存在多个相同或高度相似的记录，应使用updateRow更新其中一条，并使用deleteRow删除其他重复记录
12. 【分类规则】人物/角色 → 角色表格(索引2)；物品/装备/道具 → 物品表格(索引4)；时间/地点 → 时空表格(索引1)；事件/互动 → 社交表格(索引3)或事件表格(索引5)
`;
  }

  // 动态追加表格结构信息（不纳入模板）
  let instructions = `\n\n` + baseInstructions;

  // 追加表格模板结构信息
  if (tableStructure && tableStructure.sheets && tableStructure.sheets.length > 0) {
    instructions += `\n\n【表格模板结构】\n`;
    instructions += `当前系统配置的模板包含以下表格（请严格按照此结构提取信息）：\n\n`;
    tableStructure.sheets.forEach((sheetName: string, index: number) => {
      const headers = tableStructure.headers?.[sheetName] || [];
      const description = tableStructure.descriptions?.[sheetName] || '';
      // 提取自定义字段（排除流水号和唯一id）
      const customFields = headers.filter((h: string) => h !== '流水号' && h !== '唯一id');
      instructions += `${index + 1}. **${sheetName}**\n`;
      if (description) {
        instructions += `   - 表格用途：${description}\n`;
      }
      instructions += `   - 字段结构：[1:流水号, 2:唯一id`;
      customFields.forEach((field: string, fi: number) => {
        instructions += `, ${fi + 3}:${field}`;
      });
      instructions += `]\n`;
      instructions += `   - 需要提取的字段：${customFields.join('、')}\n\n`;
    });
    instructions += `\n`;
  } else {
    // 默认模板结构（备用）
    instructions += `\n\n【表格模板结构】\n`;
    instructions += `当前系统使用默认模板，包含以下表格（请严格按照此结构提取信息）：\n\n`;
    instructions += `1. **时空表格**\n`;
    instructions += `   - 表格用途：记录对话中提到的**时间和地点信息**（注意：只记录时间/地点，不包括在这些时间地点发生的角色行为或物品）\n`;
    instructions += `   - 字段结构：[1:流水号, 2:唯一id, 3:日期, 4:时间, 5:地点, 6:此地角色]\n`;
    instructions += `   - 需要提取的字段：日期、时间、地点、此地角色\n`;
    instructions += `   - **分类判断**：如果实体是"时间"（日期/时刻）、"地点"（位置/场所），放入此表格；如果是角色/物品/事件，则分别放入对应表格\n`;
    instructions += `   - 关键示例：\n`;
    instructions += `     * "2024年1月15日晚上8点" → 放入时空表格（索引1）\n`;
    instructions += `     * "纽约中央公园" → 放入时空表格（索引1）\n`;
    instructions += `     * "朱迪在中央公园" → 地点放入时空表格，角色放入角色表格\n\n`;
    instructions += `2. **角色表格**\n`;
    instructions += `   - 表格用途：记录对话中出现的**人物角色**（注意：只记录真实的人物/生物/角色，不包括他们持有的物品）\n`;
    instructions += `   - 字段结构：[1:流水号, 2:唯一id, 3:角色名, 4:身份, 5:关系, 6:特征, 7:备注]\n`;
    instructions += `   - 需要提取的字段：角色名、身份、关系、特征、备注\n`;
    instructions += `   - **分类判断**：如果实体是"人"、"角色"、"生物"、"动物"等**有生命的存在**，放入此表格；如果是无生命的物品/装备/道具，则必须放入物品表格\n\n`;
    instructions += `3. **社交表格**\n`;
    instructions += `   - 表格用途：记录对话中发生的**社交互动和日常事件**（注意：记录人与人之间的互动、对话、关系变化，不包括重大事件或物品）\n`;
    instructions += `   - 字段结构：[1:流水号, 2:唯一id, 3:时间, 4:参与人, 5:事件, 6:结果, 7:备注]\n`;
    instructions += `   - 需要提取的字段：时间、参与人、事件、结果、备注\n`;
    instructions += `   - **分类判断**：如果实体是"互动行为"（对话/见面/合作/冲突）、"关系变化"、"日常活动"，放入此表格；如果是重大事件（如犯罪/事故/任务），则放入事件表格\n`;
    instructions += `   - 关键示例：\n`;
    instructions += `     * "朱迪和尼克一起调查案件" → 放入社交表格（索引3）\n`;
    instructions += `     * "朱迪向牛局长汇报工作" → 放入社交表格（索引3）\n`;
    instructions += `     * "朱迪获得了警官徽章" → 物品放入物品表格，获得行为可放入社交表格\n\n`;
    instructions += `4. **物品表格**\n`;
    instructions += `   - 表格用途：记录对话中提到的**物品、装备、道具等**（注意：角色持有的物品、装备、道具等必须放在此表格，不要放入角色表格）\n`;
    instructions += `   - 字段结构：[1:流水号, 2:唯一id, 3:物品名, 4:类型, 5:描述, 6:状态, 7:备注/持有人]\n`;
    instructions += `   - 需要提取的字段：物品名、类型、描述、状态、备注/持有人\n`;
    instructions += `   - **分类判断**：如果实体是"物品"、"装备"、"道具"、"工具"、"武器"、"服装"、"饰品"等**无生命的物体**，放入此表格；如果实体是人物/角色，则放入角色表格\n`;
    instructions += `   - 关键示例：\n`;
    instructions += `     * "朱迪的警官徽章" → 放入物品表格（索引4），不是角色表格！\n`;
    instructions += `     * "胡萝卜录音笔" → 放入物品表格（索引4），不是角色表格！\n`;
    instructions += `     * "防狼喷雾" → 放入物品表格（索引4），不是角色表格！\n`;
    instructions += `     * 持有人信息应放在"备注/持有人"字段中，例如：{"3":"警官徽章","4":"身份证明","5":"朱迪的警官身份象征","6":"完好","7":"朱迪持有"}\n\n`;
    instructions += `5. **事件表格**\n`;
    instructions += `   - 表格用途：记录对话中发生的**重要事件**（注意：记录具有重大影响的事件，如犯罪/事故/任务/转折点，不包括日常社交互动）\n`;
    instructions += `   - 字段结构：[1:流水号, 2:唯一id, 3:时间, 4:事件名, 5:参与人, 6:描述, 7:影响, 8:备注]\n`;
    instructions += `   - 需要提取的字段：时间、事件名、参与人、描述、影响、备注\n`;
    instructions += `   - **分类判断**：如果实体是"重大事件"（犯罪/事故/任务/转折点/冲突爆发），放入此表格；如果是日常互动/对话/关系变化，则放入社交表格\n`;
    instructions += `   - 关键示例：\n`;
    instructions += `     * "中央公园发生抢劫案" → 放入事件表格（索引5）\n`;
    instructions += `     * "朱迪成功破获重大案件" → 放入事件表格（索引5）\n`;
    instructions += `     * "朱迪和尼克一起吃午饭" → 放入社交表格（索引3），不是事件表格！\n\n`;
  }

  // 追加当前表格状态
  if (memoryTableData && memoryTableData.trim()) {
    instructions += `\n【当前表格状态】\n${memoryTableData}\n`;
  } else {
    instructions += `\n【当前表格状态】当前无表格数据。发现新实体请用insertRow创建。\n`;
  }

  instructions += `\n【最终提醒】请务必在回复最后生成tableEdit标签，这是强制要求！\n`;

  return instructions;
}

// ==================== 统一入口：一键构建完整 System Prompt ====================
// 完整拼接流程：第一步→第二步→第三步→第四步→第五步→第六步

export async function buildSystemPrompt(
  characterInfo: CharacterInfoForPrompt,
  selectedPersona: UserPersona | undefined,
  promptType: 'dialogue' | 'continuation',
  vectorContextItems: ContextVectorItem[],
  memoryTableData?: string,
  organizeMode?: 'sync' | 'async',
  tableStructure?: { sheets: string[]; headers: Record<string, string[]>; descriptions: Record<string, string> },
  /**
   * 本会话相关历史片段（Spec: optimize-chat-ai-intelligence / Task 7.5）
   * 由 hooks.ts::requestAIResponse 步骤 A2 调用 chatHistory.retrieve 获取，
   * 仅在对话历史 > 20 轮时传入（短对话跳过 RAG 检索）。
   */
  chatHistoryItems?: Array<{ content: string; score: number; timestamp: number }>
): Promise<string> {
  // 第四步：根据任务类型构建基础提示词
  const systemPrompt = promptType === 'continuation'
    ? await buildContinuationPrompt(characterInfo, selectedPersona, organizeMode)
    : await buildDialoguePrompt(characterInfo, selectedPersona, organizeMode);

  // 第六步：将向量上下文和记忆表格数据追加到提示词末尾
  return await buildFinalSystemPrompt(systemPrompt, vectorContextItems, memoryTableData, organizeMode, tableStructure, chatHistoryItems);
}

// ==================== AI 表情生成：情绪 → SD 提示词映射 ====================
// Spec: add-ai-expression-generation / Task 3
// 用于 AI 表情生成（img2img）：以角色卡基底图片 + 情绪提示词生成对应表情图像，
// 与上方 `buildExpressionPrompt`（让 AI 在回复文本中输出情绪标记）为两套独立机制。

/**
 * 31 种预置情绪 → Stable Diffusion 提示词映射（Spec: add-ai-expression-generation / Task 3）。
 *
 * 用于 AI 表情生成：以角色卡基底图片 + img2img + 情绪提示词生成对应表情。
 * positive 为情绪正面提示词（英文，SD 语义），negative 为该情绪特有的负面提示词（可选）。
 *
 * 键名严格对齐 `EMOTION_PRESETS` 的 31 个 key（default / admiration / ... / cheerfulness / in_heat），
 * 自定义情绪（不在预置清单内）由 `buildExpressionGenerationPrompt` 通过 customLabel 兜底处理。
 *
 * 【Spec: optimize-expression-preset-prompts】
 * 由 scripts/optimize-expression-prompts.ts 生成，最后更新日期 2026-08-07，请勿手动修改。
 * 4 维度结构：面部表情（FACE）/ 人物动作（ACTION）/ 符号元素（SYMBOL）/ 简单背景（BACKGROUND）。
 * 所有 tag 已通过 L1-L3b 审计链验证（Danbooru/e621 标签库，317600 tags / 81700 aliases）。
 * 重新生成：`npx tsx scripts/optimize-expression-prompts.ts`（需配置 AI 引擎）。
 * 审计详情见 scripts/expression-prompt-optimization-report.json。
 */
export const EMOTION_PROMPT_MAP: Record<string, { positive: string; negative?: string }> = {
  default: { positive: 'neutral_expression, closed_mouth, light_smile, looking_at_viewer, standing, arms_at_sides, sparkle, simple_background, white_background, depth_of_field' },
  admiration: { positive: 'sparkling_eyes, wide-eyed, smile, blush, open_mouth, dilated_pupils, happy, looking_up, looking_at_viewer, leaning_forward, hands_together, clenched_hands, head_tilt, sparkle, star, heart, exclamation_point, simple_background, white_background, gradient_background, light_rays, ambient_lighting' },
  amusement: { positive: 'smile, grin, laughing, closed_eyes, happy, open_mouth, sparkling_eyes, playful_expression, looking_at_viewer, hand_on_mouth, head_tilt, leaning_back, wink, sparkle, musical_note, heart, simple_background, white_background, gradient_background, soft_lighting' },
  anger: { positive: 'angry, scowl, open_mouth, shouting, clenched_teeth, glaring, flushed_face, looking_at_viewer, clenched_hand, pointing, crossed_arms, leaning_forward, shaking, anger_vein, exclamation_point, fire, lightning, symbol, simple_background, red_background, speed_lines, motion_blur, ambient_lighting' },
  annoyance: { positive: 'scowl, frown, narrowed_eyes, pouting, annoyed, crossed_arms, looking_away, rolling_eyes, sighing, hand_on_hip, head_tilt, anger_vein, sweatdrop, exclamation_point, simple_background, white_background, gradient_background' },
  approval: { positive: 'smile, closed_eyes, pleased, closed_mouth, blush, happy, nodding, looking_at_viewer, thumbs_up, head_tilt, hands_on_hips, sparkle, heart, star, simple_background, white_background, gradient_background' },
  caring: { positive: 'blush, looking_at_viewer, reaching_out, hand_on_cheek, head_tilt, leaning_forward, hand_to_face, sparkle, heart, floating_heart, simple_background, white_background, blurred_background, soft_lighting, ambient_lighting' },
  confusion: { positive: 'open_mouth, squinting, blank_stare, head_tilt, scratching_head, hand_on_chin, hand_on_cheek, looking_away, looking_at_viewer, question_mark, sweatdrop, ellipsis, simple_background, white_background, gradient_background' },
  curiosity: { positive: 'wide-eyed, raised_eyebrows, parted_lips, slight_smile, open_mouth, looking_sideways, head_tilt, leaning_forward, hand_on_chin, looking_at_viewer, hand_on_cheek, finger_to_own_chin, question_mark, sparkle, thought_bubble, exclamation_point, emoji, simple_background, white_background, depth_of_field, ambient_lighting, gradient_background' },
  desire: { positive: 'blush, dilated_pupils, parted_lips, flushed_face, sweatdrop, panting, looking_at_viewer, leaning_forward, biting_lip, hand_on_cheek, hand_on_own_breast, head_tilt, reaching_out, heart, sparkle, simple_background, gradient_background, ambient_lighting, depth_of_field' },
  disappointment: { positive: 'sad, disappointed, frown, pout, downcast_eyes, unhappy, looking_away, looking_down, sigh, head_down, hand_on_face, sweatdrop, tears, blue_lines, simple_background, white_background, grey_background, dim_lighting' },
  disapproval: { positive: 'narrowed_eyes, scowl, frown, side_eye, displeased, closed_mouth, pout, crossed_arms, looking_away, hand_on_hip, head_tilt, looking_at_viewer, sighing, anger_vein, sweatdrop, exclamation_point, question_mark, simple_background, white_background, gradient_background' },
  disgust: { positive: 'disgust, scowl, sneer, frown, looking_down, looking_away, covering_mouth, crossed_arms, shrugging, sweatdrop, vein, exclamation_point, simple_background, white_background, depth_of_field' },
  embarrassment: { positive: 'blush, awkward_smile, open_mouth, flushed_face, looking_away, covering_mouth, scratching_head, fidgeting, shrugging, hand_on_cheek, sweatdrop, question_mark, exclamation_point, speech_bubble, simple_background, white_background, gradient_background, depth_of_field' },
  excitement: { positive: 'wide_eyed, open_mouth, blush, smile, grin, sparkling_eyes, dilated_pupils, flushed_face, looking_at_viewer, leaning_forward, arms_up, clenched_hands, jumping, hand_on_cheek, sparkle, exclamation_point, heart, musical_note, star, simple_background, white_background, gradient_background, depth_of_field' },
  fear: { positive: 'wide_eyed, dilated_pupils, open_mouth, trembling, pale_skin, teary_eyes, sweatdrop, shaking, cowering, covering_mouth, self_hug, looking_away, hand_on_face, exclamation_point, shadow, dark_aura, simple_background, dark_background, vignette, depth_of_field' },
  gratitude: { positive: 'smile, closed_eyes, blush, happy, sparkling_eyes, clasped_hands, bowing, looking_at_viewer, hand_on_chest, head_tilt, sparkle, heart, floating_heart, simple_background, white_background, soft_lighting, bokeh, ambient_lighting' },
  grief: { positive: 'crying, tears, streaming_tears, sad, sorrow, closed_eyes, open_mouth, trembling, covering_face, hand_on_face, looking_down, shaking, clutching_chest, kneeling, sobbing, rain, broken_heart, dark_aura, gloom_(expression), simple_background, dark_background, depth_of_field' },
  joy: { positive: 'smile, laughing, open_mouth, blush, closed_eyes, sparkling_eyes, wide_smile, looking_at_viewer, arms_up, jumping, head_tilt, clenched_hands, heart, sparkle, musical_note, flower, confetti, star, simple_background, white_background, gradient_background, colorful_background' },
  love: { positive: 'blush, closed_eyes, sparkling_eyes, happy, joyful, open_mouth, looking_at_viewer, leaning_forward, hand_on_cheek, head_tilt, self_hug, heart, heart_bubbles, sparkle, musical_note, flower, simple_background, white_background, pink_background, gradient_background, pastel_background' },
  nervousness: { positive: 'blush, sweatdrop, nervous_smile, wide-eyed, worried, looking_away, interlocked_fingers, hand_to_mouth, hand_to_face, exclamation_point, question_mark, swirl, speech_bubble, simple_background, white_background, gradient_background, depth_of_field' },
  neutral: { positive: 'neutral_expression, expressionless, closed_mouth, blank_stare, looking_at_viewer, standing, arms_at_sides, staring, sparkle, simple_background, white_background, grey_background, flat_color, ambient_lighting' },
  optimism: { positive: 'smile, happy, sparkling_eyes, open_mouth, wide_eyed, cheerful, looking_at_viewer, waving, head_tilt, arms_up, jumping, v_sign, sparkle, star, musical_note, sun, heart, simple_background, white_background, sunny, blue_sky' },
  pride: { positive: 'smug, raised_eyebrow, grin, looking_down, smirk, crossed_arms, hand_on_hip, chin_up, leaning_back, looking_at_viewer, sparkle, star, light_rays, shining, simple_background, white_background, spotlight, gradient_background' },
  realization: { positive: 'wide-eyed, open_mouth, raised_eyebrows, dilated_pupils, surprised, staring, looking_up, raised_finger, hand_on_forehead, gasp, head_tilt, looking_at_viewer, exclamation_point, sparkle, sweatdrop, light_bulb, simple_background, white_background, speed_lines, gradient_background' },
  relief: { positive: 'closed_eyes, light_smile, relaxed_expression, serene, slight_blush, sighing, hand_on_chest, leaning_back, looking_up, hand_on_forehead, closing_eyes, sweatdrop, sparkle, light_particles, musical_note, simple_background, white_background, gradient_background, soft_lighting' },
  remorse: { positive: 'sad, frown, downcast_eyes, tears, pained_expression, crying, looking_down, hand_on_face, covering_face, head_down, kneeling, curled_up, clenched_hands, teardrop, dark_aura, rain, shadow, broken_heart, simple_background, grey_background, dim_lighting, dark_background' },
  sadness: { positive: 'tears, crying, sad, frown, downcast_eyes, watery_eyes, sobbing, pout, looking_down, covering_face, self_hug, wiping_tears, curled_up, slouching, looking_away, teardrop, broken_heart, rain, gloom_(expression), simple_background, grey_background, dark_background, depth_of_field, ambient_lighting' },
  surprise: { positive: 'surprised, wide_eyed, open_mouth, raised_eyebrows, shocked, blush, dilated_pupils, looking_at_viewer, covering_mouth, hands_up, leaning_back, startled, head_tilt, exclamation_point, sweatdrop, sparkle, simple_background, white_background, gradient_background, depth_of_field' },
  cheerfulness: { positive: 'smile, open_mouth, happy, blush, closed_eyes, sparkling_eyes, wide_eyed, looking_at_viewer, laughing, v, waving, jumping, head_tilt, arms_up, sparkle, heart, musical_note, star, petals, confetti, simple_background, white_background, sunlight, colorful_background, gradient_background' },
  in_heat: { positive: 'blush, saliva, tongue_out, parted_lips, flushed_face, sweatdrop, dilated_pupils, panting, looking_at_viewer, biting_lip, hand_on_breast, hand_on_thigh, leaning_forward, arched_back, heart, sparkle, steam, simple_background, white_background, gradient_background, depth_of_field' },
};

/**
 * 构建 AI 表情生成的 SD 提示词（Spec: add-ai-expression-generation / Task 3）。
 *
 * 【重点标记 - 提示词可编辑】
 * 原实现使用角色卡 description 字段（自然语言长文本）作为 SD 提示词基底，
 * 但 description 通常是完整的段落描述（如"她是一个温柔的女孩..."），不适合 SD 的
 * tag 格式。修改后改为使用用户可编辑的正面提示词模板（含 {emotion} 占位符），
 * 用户可在设置页或生成弹窗中自定义角色外观 tag（如 "1girl, silver hair, blue eyes"）。
 *
 * 【重点标记 - 特征携带机制（Spec: add-asset-and-trait-management / Task 5）】
 * 函数签名新增 `characterTraits?: Array<{ text: string; weight?: number }>` 参数，用于将角色视觉特征 tag
 * （如 `['white fur', 'dog girl']`）注入到正面提示词模板的 `{traits}` 占位符中。
 *
 * 提示词组合规则：
 *   - 正面提示词：先替换 `{traits}` 占位符为特征 tag 字符串，再替换 `{emotion}` 占位符为情绪专用提示词
 *   - 预置情绪：从 `EMOTION_PROMPT_MAP` 取 positive / negative
 *   - 自定义情绪（key 不在 MAP 中）：以 customLabel 兜底，组成 `${customLabel} expression, emotional face`
 *   - 负面提示词：用户自定义负面词优先；否则使用通用默认 + 情绪特有负面（若有）
 *
 * 【重点标记 - 特征携带机制 - 占位符注入逻辑】
 * - 若模板含 `{traits}` 占位符：将 traits 拼接为逗号分隔字符串替换占位符
 *   （空 traits 替换为空字符串，并清理多余逗号与空格）
 * - 若模板不含 `{traits}` 占位符（旧配置兼容）：traitsStr 非空时在 prompt 开头
 *   追加 `traitsStr + ', '`；traitsStr 为空时不追加，保持原模板行为
 * - 与 sdGenerationService.generateExpression 的清理逻辑形成"上游 + 下游"双重保险：
 *   本函数（上游）先做一次清理，sdGenerationService（下游）再做一次清理，
 *   两处都清理是安全的（幂等操作，不会引入副作用）
 *
 * @param emotionKey - 情绪键名（EMOTION_PRESETS 的 key 或用户自定义 key）
 * @param options - 可选配置
 *   - positivePromptTemplate: 正面提示词模板（含 {emotion} / {traits} / {camera} 占位符），默认使用内置模板
 *     【2026-08-06 重构】默认模板移除写死的 portrait + looking at viewer，改为 {camera} 占位符（由视角镜头下拉默认值注入）；
 *     {camera} 由下游 sdGenerationService.applyTraitsAndLora 替换（本函数仅替换 {traits} / {emotion}）
 *   - customNegativePrompt: 用户自定义负面提示词，为空时使用默认负面
 *   - customLabel: 自定义情绪的中文标签
 *   - characterTraits: 角色视觉特征 tag 数组（Spec: add-asset-and-trait-management / Task 5），用于替换 {traits} 占位符
 * @returns `{ prompt: string; negativePrompt: string }`
 */
export function buildExpressionGenerationPrompt(
  emotionKey: string,
  options?: {
    positivePromptTemplate?: string;
    customNegativePrompt?: string;
    customLabel?: string;
    characterTraits?: Array<{ text: string; weight?: number }>;
  },
): { prompt: string; negativePrompt: string } {
  const {
    positivePromptTemplate,
    customNegativePrompt,
    customLabel,
    characterTraits,
  } = options || {};

  // 情绪提示词解析：预置情绪 → MAP；自定义情绪 → customLabel 兜底
  let emotionPositive: string;
  let emotionNegative: string | undefined;
  const mapped = EMOTION_PROMPT_MAP[emotionKey];
  if (mapped) {
    emotionPositive = mapped.positive;
    emotionNegative = mapped.negative;
  } else if (customLabel && customLabel.trim()) {
    emotionPositive = `${customLabel.trim()} expression, emotional face`;
  } else {
    emotionPositive = EMOTION_PROMPT_MAP.neutral.positive;
  }

  // 【重点标记 - 特征携带机制】拼接角色特征 tag 字符串
  // 过滤空字符串与纯空白串，trim 后以逗号 + 空格连接（SD tag 标准格式）
  // 【Spec: add-sdxl-prompt-weight-support / Task 3】characterTraits 升级为
  // Array<{ text: string; weight?: number }>，此处仅取 .text 拼接（权重由
  // sdGenerationService.applyTraitsAndLora 在下游格式化为 (text:weight) 语法）。
  const traitsStr = (characterTraits || [])
    .map((t) => t.text.trim())
    .filter((t) => t.length > 0)
    .join(', ');

  // 正面提示词：使用模板，将 {traits} 与 {emotion} 占位符依次替换
  // 默认模板同时含 {camera} / {traits} / {emotion} 三个占位符
  // 【2026-08-06 重构】移除写死的 `portrait` + `looking at viewer`（改为由 {camera} 下拉默认值注入），
  //   避免与用户选的 full body / close-up 等同类 tag 冲突；
  //   弹窗打开时表情模式默认初始化 selectedCameraAngle='portrait, looking at viewer'
  //   （由 AssetGenerateModal getCameraDefaultForMode 提供），用户可改选/加选 from above 等
  //   {camera} 由下游 sdGenerationService.applyTraitsAndLora 替换（本函数仅替换 {traits} / {emotion}，
  //   {camera} 保持字面量传给下游，applyTraitsAndLora 会替换并清理逗号）
  // 【2026-08-06 标签库审计】simple background → simple_background（Danbooru 标准下划线格式）
  // high quality / best quality / masterpiece / detailed face 虽不在标签库，但 NoobAI 训练时注入，模型理解
  const defaultTemplate = '{camera}, {traits}, simple_background, {emotion}, high quality, best quality, masterpiece, detailed face';
  const template = (positivePromptTemplate && positivePromptTemplate.trim()) || defaultTemplate;

  // 【重点标记 - 特征携带机制 - 占位符注入逻辑】
  // 1. 若模板含 {traits} 占位符：替换为 traitsStr（可能为空字符串）
  // 2. 若模板不含 {traits} 占位符（旧配置兼容）：traitsStr 非空时在开头追加，为空时保持原样
  let prompt: string;
  if (template.includes('{traits}')) {
    // 使用函数形式替换，避免 $ 等特殊字符干扰（与 sdGenerationService 保持一致）
    prompt = template.replace(/\{traits\}/g, () => traitsStr);
  } else if (traitsStr) {
    // 旧配置兼容：模板不含 {traits} 占位符，但传入了非空特征 → 在开头追加
    prompt = `${traitsStr}, ${template}`;
  } else {
    // 旧配置兼容：模板不含 {traits} 占位符，且特征为空 → 保持原模板
    prompt = template;
  }

  // 替换 {emotion} 占位符
  // 若模板含 {emotion}：替换为情绪提示词；否则追加到末尾（与原行为一致）
  prompt = prompt.includes('{emotion}')
    ? prompt.replace(/\{emotion\}/g, emotionPositive)
    : `${prompt}, ${emotionPositive}`;

  // 【重点标记 - 特征携带机制 - 清理多余逗号与空格】
  // 场景：模板 `{camera}, {traits}, simple background` + 空 traits → `{camera}, , simple background`
  // 循环处理连续逗号（如 `a, , , b` 需多次匹配才能完全收敛）
  // 注：{camera} 占位符是字面字符串（含花括号），不参与逗号清理，保持原样传给下游
  // 与 sdGenerationService.generateExpression 的清理逻辑保持一致（下游会再清理一次，幂等安全）
  let prevPrompt: string;
  do {
    prevPrompt = prompt;
    prompt = prompt.replace(/,\s*,/g, ',');
  } while (prompt !== prevPrompt);
  prompt = prompt.replace(/^\s*,\s*/, ''); // 清理开头逗号
  prompt = prompt.replace(/\s*,\s*$/, ''); // 清理结尾逗号

  // 负面提示词：用户自定义优先；否则使用默认 + 情绪特有负面
  // 【2026-08-06 标签库审计】多词 tag 改为下划线版本（bad_anatomy / multiple_faces / extra_digits / bad_proportions）
  // ugly / low quality / mutated_hands / missing_fingers 虽不在 Danbooru 标签库，但 SD 社区通用负面，模型理解
  const baseNegative = 'deformed, ugly, bad_anatomy, multiple_faces, text, watermark, low quality, blurry, mutated_hands, extra_digits, missing_fingers, bad_proportions';
  const userNegative = (customNegativePrompt && customNegativePrompt.trim()) || '';
  const negativePrompt = userNegative
    ? (emotionNegative ? `${userNegative}, ${emotionNegative}` : userNegative)
    : (emotionNegative ? `${baseNegative}, ${emotionNegative}` : baseNegative);

  return { prompt, negativePrompt };
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
  const emotionNl = EMOTION_NL_PROMPT_MAP[emotionKey]
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

// ==================== 素材生成提示词模板（illustration / general / three-view）====================
// Spec: add-asset-and-trait-management / Task 10（原始实现，原位于 AssetGenerateModal.tsx）

/**
 * 裸体版三视图固定 tag 列表（Spec: fix-asset-trait-and-scene-defects / Task 1）。
 *
 * 【重点标记 - 固定包含】这些 tag 在生成 *-nude 槽位三视图时强制拼接，
 * 不可被用户配置覆盖，确保生成结果始终包含裸体特征。
 *
 * 扩展原因：原 spec 仅硬编码 `nude, naked, bare skin` 三个 tag，覆盖面不足，
 * 补充 `completely naked` / `no clothes` / `nsfw` 增强 SD 模型对裸体语义的理解。
 *
 * 本常量是 nude tag 的唯一数据源（single source of truth），`buildAssetPromptTemplate`
 * 的 three-view 分支通过 `NUDE_FIXED_TAGS.join(', ')` 拼接，禁止在其它位置重复硬编码。
 */
export const NUDE_FIXED_TAGS: readonly string[] = [
  // 【2026-08-06 标签库审计精简】原含 naked/completely naked/no clothes，但 Danbooru/e621 标签库
  // 验证确认这三个均为 nude 的别名（alias），重复注入无增益。精简为：
  // - nude（核心 tag，count≈2.1M）
  // - bare_skin（下划线版本，count=76，低频但有独特语义）
  // - nsfw（虽不在 Danbooru 标签库，但 NoobAI 训练时注入，模型理解）
  'nude',
  'bare_skin',
  'nsfw',
];

/**
 * 根据 mode 与目标构建素材生成的正面提示词模板（不含表情）。
 *
 * 【重点标记 - 函数迁移说明】
 * 原实现位于 `AssetGenerateModal.tsx` 内部（非导出函数），后迁移至 `PromptBuilder.ts`
 * 并改为导出函数，与其它 build* 工具函数集中管理。`AssetGenerateModal.tsx` 改为从本文件导入。
 *
 * 模板规则：
 * - 立绘（illustration）：`{camera}, {traits}, high quality, best quality, masterpiece`
 *   【2026-08-06 初版】追加 `{camera}` 占位符，由 AssetGenerateModal 视角镜头下拉选择填充
 *   【2026-08-06 重构】移除写死的 `full body`（改为 {camera} 下拉默认值注入），避免与用户选的 close-up 等同类 tag 冲突；
 *   弹窗打开时默认初始化 selectedCameraAngle='full body'（AssetGenerateModal getCameraDefaultForMode），用户可改选 upper body 等
 * - 一般图像（general）：`{traits}, {camera}, high quality, best quality`
 *   【2026-08-06 新增】追加 `{camera}` 占位符，由 AssetGenerateModal 的视角镜头下拉选择填充
 * - 三视图（three-view）：根据 targetSlot 选择 front / side / back view 模板
 *   （已有穿衣/裸体分组逻辑）
 *   【2026-08-06 重点标记 - 三视图多角色 bug 修复】移除 `character sheet`（Danbooru 训练数据中天然指多视角合集图，
 *   导致一张三视图出现多个角色/多视角 collage），改为 `solo`（强化单角色）；保留 `white background` 干净参考风格。
 *   配合 AssetGenerateModal 负面提示词追加多角色/多视角约束。详见 docs/FIX_RECORDS.md §5.10
 *
 * 【重点标记 - 固定包含（Spec: fix-asset-trait-and-scene-defects / Task 1）】
 * 三视图的 `*-nude` 槽位（front-nude / side-nude / back-nude）会强制拼接 `NUDE_FIXED_TAGS`
 * 常量数组中的全部 tag（`nude, bare_skin, nsfw`），
 * **固定包含，不可被用户配置覆盖**，确保生成结果始终包含裸体特征。
 * `NUDE_FIXED_TAGS` 是 nude tag 的唯一数据源（single source of truth），禁止在其它位置重复硬编码。
 *
 * 【占位符替换链路】
 * `{traits}` / `{camera}` 占位符均由 `sdGenerationService.applyTraitsAndLora`
 * 在 SD 调用前统一替换：
 *   - `{traits}`：options.characterTraits 拼接字符串（已有逻辑，Spec: add-asset-and-trait-management / Task 5）
 *   - `{camera}`：options.dynamicCamera（来自 AssetGenerateModal 视角镜头下拉选择；空则替换为空串并清理多余逗号）
 *     【2026-08-06 初版】illustration / general 模板含此占位符；three-view 模板不含（固定 view 不冲突）
 *     【2026-08-06 重构】表情模板（buildExpressionGenerationPrompt 默认模板）也含此占位符；
 *     各模式默认值：立绘='full body'，表情='portrait, looking at viewer'，一般图像=无默认（由 getCameraDefaultForMode 提供）
 *     移除立绘写死的 full body 与表情写死的 portrait/looking at viewer，改为 {camera} 默认值注入，避免同类 tag 冲突
 *
 * @param mode 生成模式（illustration / general / three-view）
 * @param targetSlot 三视图模式下的目标槽位（front / side / back / front-nude / side-nude / back-nude）
 * @returns 提示词模板字符串（含 {traits} / {camera} 占位符）
 */
export function buildAssetPromptTemplate(
  mode: 'illustration' | 'general' | 'three-view',
  targetSlot?: 'front' | 'side' | 'back' | 'front-nude' | 'side-nude' | 'back-nude',
): string {
  switch (mode) {
    case 'illustration':
      // 立绘模板：{camera}（视角镜头，默认含 full body）+ 特征 + 高质量
      // 【2026-08-06 初版】追加 {camera} 占位符
      // 【2026-08-06 重构】移除写死的 `full body`（改为由 {camera} 下拉默认值注入），避免 full body 与用户选的 close-up 等同类 tag 冲突
      //   立绘模式弹窗打开时 selectedCameraAngle 默认初始化为 'full body'（由 AssetGenerateModal getCameraDefaultForMode 提供）
      //   用户可改选 upper body（半身立绘）等，无冲突（覆盖而非叠加）
      return '{camera}, {traits}, high quality, best quality, masterpiece';
    case 'general': {
      // 一般图像模板：特征 + {camera}（视角镜头，2026-08-06 新增）+ 高质量
      // 【2026-08-06 新增】{camera} 占位符由 AssetGenerateModal 视角镜头下拉填充
      return '{traits}, {camera}, high quality, best quality';
    }
    case 'three-view': {
      // 三视图模板：根据 targetSlot 选择 front / side / back（不改，已有穿衣/裸体分组逻辑）
      // 裸体变体（*-nude）剥离后缀取 viewName，并拼接 NUDE_FIXED_TAGS 常量数组（Spec: fix-asset-trait-and-scene-defects / Task 1）
      // 注：NUDE_FIXED_TAGS 为 nude tag 的唯一数据源，固定包含不可被用户配置覆盖
      //
      // 【2026-08-06 重点标记 - 三视图多角色 bug 修复】
      // 原模板含 `character sheet` tag，但该 tag 在 Danbooru 训练数据中天然指"角色设定合集图"——
      // 典型样式是一张图上展示多视角/多表情/多服装（如主视图+上半身+特写，或穿衣/不穿衣左右布局）。
      // SDXL/Pony 模型会优先生成 collage，导致一张三视图出现多个角色/多视角。
      // 修复：移除 `character sheet`，改为 `solo`（强化单角色），保留 `white background`（干净参考风格）。
      // 同时在 AssetGenerateModal 负面提示词追加多角色/多视角约束（见 buildSdOptions 上方负面初始化）。
      const isNude = !!targetSlot?.endsWith('-nude');
      const viewName = (isNude ? targetSlot!.replace('-nude', '') : targetSlot) || 'front';
      const nudeTags = isNude ? `, ${NUDE_FIXED_TAGS.join(', ')}` : '';
      // 【2026-08-06 标签库审计】full body → full_body, white background → white_background, viewName view → viewName_view
      return `${viewName}_view, full_body, solo, {traits}${nudeTags}, white_background, high quality`;
    }
    default:
      return '{traits}, high quality, best quality';
  }
}
