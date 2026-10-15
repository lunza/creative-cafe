/**
 * 【Phase 3 / L1 - conversation-mode-optimization-report】PromptBuilder 拆分——用户回复与润色系统提示（buildUserReplySystemPrompt / buildPolishInputSystemPrompt）。
 * 原 PromptBuilder.ts 行段（1-based，逐字搬迁）：L510-L741。
 */
import { CharacterInfoForPrompt } from './promptTypes';
import { UserPersona, ChatMessage } from './CharacterDialogueChat.types';

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
  userInstruction?: string,
  conversationHistory?: ChatMessage[]
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

  // 格式化对话历史为文本（Spec: fix-user-reply-persona-echo）
  // 将对话历史嵌入系统提示而非作为 messages 数组传给 engine，避免以 assistant 结尾的
  // 对话历史被 llama.cpp 等后端视为续写前缀（prefill），导致模型直接回显上一条消息
  const historyText = (!conversationHistory || conversationHistory.length === 0)
    ? '（无历史对话）'
    : conversationHistory
        .map(msg => msg.role === 'user' ? `[${userName}]: ${msg.content}` : `[${charName}]: ${msg.content}`)
        .join('\n');

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

## 对话历史
${historyText}
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
