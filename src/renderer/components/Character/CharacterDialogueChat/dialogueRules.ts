/**
 * 【Phase 3 / L1 - conversation-mode-optimization-report】PromptBuilder 拆分——底层对话规则工具（stop sequences / 角色锚点 / 续写提示 / 长度引导 / emoji / 辅助模式 / 语言 / 精简指令集与旧块剥离）。
 * 原 PromptBuilder.ts 行段（1-based，逐字搬迁）：L83-L324 L452-L508 L980-L1063。
 */
import { DEFAULT_USER_NAME } from './promptTypes';

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
 * 通过在系统提示末尾注入长度引导约束，防止 AI 在持续对话中因上下文学习
 * 复制逐渐缩短的回复模式（LLM 固有特性）。
 *
 * Spec: reduce-dialogue-ai-flavor-and-repetition / Phase 2
 * 日常约束段改为信息密度引导：`【回复要求】{{char}} 的每次回复通常在 X 字左右
 * ——重点是有实质推进：新的情节点、情绪变化或信息，而不是堆砌描写。`
 * （硬性字数下限会引发填充式写作，是"AI 味"成因之一，故降为软参考）
 *
 * 当 `strengthen=true` 时（由 Task 4 检测到连续 3 轮短回复触发），追加
 * 强化约束段：`【重要提醒】你最近的回复过短。请务必每次回复至少 X 字，
 * 展开细节描写，包括动作、神态、语言和内心活动。`（救火机制，原样保留）
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
  // Spec: reduce-dialogue-ai-flavor-and-repetition / Phase 2
  // 日常模式从"字数下限 + 三要素"改为信息密度引导：
  // 硬性字数下限会引发填充式写作（堆砌形容词凑字数），是"AI 味"成因之一。
  // 字数降为软参考，核心约束改为"每次推进至少一个新的情节点或情绪变化"。
  // 强化模式（strengthen=true）保留原硬性字数下限——它是连续 3 轮短回复时的
  // 救火机制（Spec: fix-ai-response-length-degradation），字符数检测逻辑不动。
  let prompt = `\n【回复要求】${name} 的每次回复通常在 ${minResponseChars} 字左右——重点是有实质推进：新的情节点、情绪变化或信息，而不是堆砌描写。`;
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

// ==================== 旧版规则块运行时剥离（Spec: reduce-dialogue-ai-flavor-and-repetition / Phase 2） ====================

/**
 * 精简指令集锚点（新指令集标题）。
 * 存在于新默认模板或已注入的提示词中时，跳过剥离与追加，防止重复注入。
 */
const MINIMAL_DIALOGUE_RULES_ANCHOR = '【对话方式】';

/**
 * 精简指令集（3 条核心规则）。
 *
 * Spec: reduce-dialogue-ai-flavor-and-repetition / Phase 2（用户已确认"激进精简"）
 * 原 19+ 条规则（8 约束 + 7 禁止 + 4 白名单 + 输出格式段）的收敛映射：
 * - 规则 1/2/5/12（四条语义重复的"代入角色"）→ 核心规则 1
 * - 规则 3/4 + 负面禁令 9-13 → 核心规则 2（自然度正面引导，负面禁令转正面特征）
 * - 规则 7/8/15 + 输出格式段（格式规则模板内 2 次重复）→ 核心规则 3（单次注入）
 * - 规则 6/14（变量替换）→ 由【对话任务说明】既有说明句覆盖 + 显示层 replaceTemplates 兜底
 * - 白名单 16-19 → tableEdit 由 {{table_edit_instruction}} 变量自带说明承接；
 *   其余白名单守护的"禁止额外标记"类禁令已同步移除，冲突源消失
 */
const MINIMAL_DIALOGUE_RULES = `\n${MINIMAL_DIALOGUE_RULES_ANCHOR}
1. 你就是 {CHAR_NAME}，以你的身份思考、说话、行动——不是助手，不是系统
2. 像真人一样交流：句子有长有短，会犹豫、会开玩笑、会跑题；不必回应每一个问题，也不必刻意展示设定；情绪不同，说话的节奏也不同
3. 对话内容用英文双引号（" "）包裹；动作、神态、心理描写用星号（* *）包裹，两者可自然交替`;

/**
 * ⚠️【重点标记】剥离旧版对话规则块。
 *
 * 背景（存量模板迁移风险）：mergeNewDefaultTemplates 不更新数据库中已有模板
 * （removeOldFormatProhibition hack 即此坑的历史证据）。若仅更新默认模板，
 * 存量用户会话将永远使用旧版 19+ 条规则。此函数在运行时统一剥离旧块，
 * 对新装 / 存量 / 用户轻度自定义的模板一致生效。
 *
 * 剥离范围（块标题到下一个【标题】或文本末尾）：
 * - 【对话约束规则】（8 条规则，含 2 次格式规则重复中的第 1 次）
 * - 【严格禁止】（7 条负面禁令，"越禁越像 AI"的反噬源）
 * - 【白名单例外…】（4 条，随禁令移除失去对抗对象）
 * - 【输出格式】（格式规则第 2 次重复）
 *
 * 安全边界：用户深度自定义的模板（不含上述已知块标题）不做任何剥离，
 * 仅在缺少新指令集锚点时追加精简指令集。
 */
export function stripLegacyDialogueRuleBlocks(systemPrompt: string): string {
  if (!systemPrompt) return systemPrompt;

  let result = systemPrompt;
  result = result.replace(/【对话约束规则】[\s\S]*?(?=【|$)/g, '');
  result = result.replace(/【严格禁止】[\s\S]*?(?=【|$)/g, '');
  result = result.replace(/【白名单例外[^】]*】[\s\S]*?(?=【|$)/g, '');
  result = result.replace(/【输出格式】[\s\S]*?(?=【|$)/g, '');

  // 清理剥离后残留的多余空行
  result = result.replace(/\n{3,}/g, '\n\n');

  return result.trimEnd();
}

/**
 * 应用精简指令集：剥离旧规则块后追加新指令集（锚点守卫防重复）。
 *
 * 插入位置：模板含【角色信息】段时插到其前（紧跟任务说明，保持
 * "指令 → 规则 → 角色信息"的自然分组）；否则追加到末尾。
 *
 * @param systemPrompt 模板系统产出的对话模式指令
 * @param charName 角色名（注入核心规则 1）
 * @returns 处理后的指令文本
 */
export function applyMinimalDialogueRules(systemPrompt: string, charName: string): string {
  if (!systemPrompt) return systemPrompt;

  // 新模板（已含锚点）原样通过，不剥离不追加
  if (systemPrompt.includes(MINIMAL_DIALOGUE_RULES_ANCHOR)) {
    return systemPrompt;
  }

  const stripped = stripLegacyDialogueRuleBlocks(systemPrompt);
  const rules = MINIMAL_DIALOGUE_RULES.replace(/\{CHAR_NAME\}/g, charName || 'Character');

  const charInfoIdx = stripped.indexOf('【角色信息】');
  if (charInfoIdx > 0) {
    return stripped.slice(0, charInfoIdx).trimEnd() + '\n' + rules + '\n\n' + stripped.slice(charInfoIdx);
  }
  return stripped + '\n' + rules;
}
