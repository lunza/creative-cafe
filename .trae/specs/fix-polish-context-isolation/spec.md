# 修复润色上下文隔离 Spec

## Why

前两轮修复（`fix-polish-input-undo-and-target` 和 `fix-polish-target-misinterpretation`）均未能解决润色功能的核心问题：AI 仍将用户输入转换为直接回复，而非执行文本扩写与润色。

**根因确认**（通过 `ChatEngine.ts:89-93` 实现分析）：
- `engine.sendMessage(contextMessages, systemPrompt, config)` 将消息组装为 `[system, ...contextMessages]` 发给 OpenAI 兼容 API
- 润色场景下 `contextMessages` 是真实对话历史（user → assistant → user → assistant → ...），**几乎总是以 assistant 回复结尾**
- OpenAI chat completion API 收到 `[system, ..., assistant]` 序列后，会自然"续写"下一条消息——即生成对最后一条 assistant 回复的延续或对话轮次的推进
- 即使 system prompt 包含 `<polish_target>` 标签和 4 条"关键约束"，**system 消息在 chat completion 中的指令权重低于对话历史的强模式上下文**（这是已被广泛验证的 LLM 行为）
- 结果：AI 将 `<polish_target>` 内的问句当作"待回答的问题"，生成直接回复（如"我吃过了"），而非润色扩展

**关键洞察**：根本问题在**消息结构**（messages 数组以 assistant 结尾触发续写本能），而非提示措辞。无论系统提示如何强化约束，都无法对抗消息结构的主导作用。

## What Changes

### 修改 `buildPolishInputSystemPrompt` 函数签名（`PromptBuilder.ts`）

- **新增** `conversationHistory: ChatMessage[]` 参数（可选，默认空数组）
- **新增** "## 对话历史参考"段落，将对话历史格式化为文本嵌入系统提示：
  ```
  ## 对话历史参考（仅作上下文参考，不是润色对象，不要回答其中任何内容）
  [用户]: xxx
  [AI]: xxx
  ...
  ```
- 该段落位于"## 对方角色上下文"之后、"## 待润色文本"之前
- **保留** `<polish_target>` 标签包裹 originalText + "## 关键约束"段落（上一轮 spec 的成果）

### 修改 `polishInput` 函数（`CharacterDialogueChat.hooks.ts`）

- **将对话历史传给 `buildPolishInputSystemPrompt`** 的 `conversationHistory` 参数，而非作为 `contextMessages` 传给 engine
- **`engine.sendMessage` 接收的 `contextMessages` 改为单条明确的润色请求 user 消息**：
  ```typescript
  const polishRequestMessages: ChatMessage[] = [{
    id: `polish-request-${Date.now()}`,
    role: 'user',
    content: '请润色上述 <polish_target> 标签内的文本，直接输出润色后的文本本身。',
    timestamp: Date.now(),
    status: 'sent',
  }];
  engine.sendMessage(polishRequestMessages, polishSystemPrompt, engineConfigWithParams);
  ```
- 这样 AI 收到的 messages 数组是 `[system(含历史参考+待润色文本+约束), user(润色请求)]`
- 消除"对话历史以 assistant 结尾"的续写模式干扰

### 为什么这次能解决问题

| 维度 | 之前方案 | 本方案 |
|---|---|---|
| messages 数组结构 | `[system, ...对话历史(以assistant结尾)]` | `[system(含历史参考), user(润色请求)]` |
| AI 看到的最后一条消息 | assistant 回复（触发续写/回复本能） | user 润色请求（触发执行润色任务） |
| 对话历史的影响方式 | 作为 messages 数组，强模式上下文 | 作为系统提示文本，弱参考上下文 |
| system prompt 约束力 | 被对话历史压倒 | 唯一上下文源，约束力最大化 |

## Impact

- **Affected specs**: `fix-polish-target-misinterpretation`（上一轮修复的 `<polish_target>` 标签和"关键约束"段落保留，本 spec 在其基础上新增对话历史隔离）、`refine-user-input-text`（润色功能原始 spec，本 spec 修改 `buildPolishInputSystemPrompt` 签名与 `polishInput` 调用结构）
- **Affected code**:
  - `src/renderer/components/Character/CharacterDialogueChat/PromptBuilder.ts`（修改 `buildPolishInputSystemPrompt` 函数签名与输出结构）
  - `src/renderer/components/Character/CharacterDialogueChat/CharacterDialogueChat.hooks.ts`（修改 `polishInput` 函数的 `contextMessages` 构建与 `engine.sendMessage` 调用）

## ADDED Requirements

### Requirement: 润色对话历史隔离

系统 SHALL 将对话历史从 `engine.sendMessage` 的 `contextMessages` 参数中移除，改为嵌入 `polishSystemPrompt` 作为"## 对话历史参考"段落，使 AI 引擎收到的 messages 数组仅包含 `[system, user(润色请求)]` 两类消息。

#### Scenario: 对话历史作为系统提示参考

- **WHEN** 用户在输入框输入"你吃饭了吗"并点击润色按钮，对话历史包含 3 轮 user/assistant 交替消息
- **THEN** `buildPolishInputSystemPrompt` 输出的系统提示包含"## 对话历史参考"段落，段落内以 `[用户]: xxx\n[AI]: xxx` 格式呈现历史
- **AND** `engine.sendMessage` 接收的 `contextMessages` 仅包含一条 user 消息："请润色上述 <polish_target> 标签内的文本，直接输出润色后的文本本身。"
- **AND** AI 收到的 messages 数组结构为 `[{role: 'system', content: '...对话历史参考...<polish_target>你吃饭了吗</polish_target>...'}, {role: 'user', content: '请润色上述...'}]`

#### Scenario: 问句被润色而非回答

- **WHEN** 用户输入"你吃饭了吗"（包含问句）并点击润色按钮
- **THEN** AI 输出为润色扩展后的文本（如"你今天早上吃饭了吗？在哪里吃的？"）
- **AND** AI 不输出对问句的直接回答（如"我吃过了"）

#### Scenario: 空对话历史下的润色

- **WHEN** 对话历史为空时用户输入草稿并点击润色
- **THEN** `buildPolishInputSystemPrompt` 输出的"## 对话历史参考"段落为空或显示"（无历史对话）"
- **AND** `engine.sendMessage` 接收的 `contextMessages` 仍为单条润色请求 user 消息
- **AND** AI 基于系统提示中的角色信息 + 待润色文本进行润色

#### Scenario: 对话历史不作为润色对象

- **WHEN** 对话历史最后一条消息是 AI 的回复"是啊，阳光很好"，用户输入"今天天气不错"并点击润色
- **THEN** "## 对话历史参考"段落明确标注"仅作上下文参考，不是润色对象，不要回答其中任何内容"
- **AND** AI 输出针对"今天天气不错"进行润色，而非针对"是啊，阳光很好"

## MODIFIED Requirements

### Requirement: buildPolishInputSystemPrompt 函数签名

函数签名修改为：

```typescript
export function buildPolishInputSystemPrompt(
  characterInfo: CharacterInfoForPrompt,
  persona: UserPersona,
  originalText: string,
  person?: 'first' | 'second' | 'third',
  conversationHistory?: ChatMessage[]  // 新增参数
): string {
```

- `conversationHistory` 为可选参数，默认 `[]`
- 当 `conversationHistory` 非空时，在系统提示中渲染"## 对话历史参考"段落
- 当 `conversationHistory` 为空或未传入时，"## 对话历史参考"段落显示"（无历史对话）"

### Requirement: buildPolishInputSystemPrompt 输出结构

输出结构修改为（新增"## 对话历史参考"段落）：

```
你是文本润色器，需要基于对话上下文优化用户 **${userName}** 的草稿文本。

## 用户人设
- 用户名：${userName}
- 用户描述：${personaDescription}

## 对方角色上下文
${charContextLines}

## 对话历史参考（仅作上下文参考，不是润色对象，不要回答其中任何内容）
${historyText or "（无历史对话）"}

## 待润色文本
<polish_target>
${originalText}
</polish_target>

## 关键约束
- <polish_target> 标签内的文本是润色对象，不是需要回答的问题
- 即使 <polish_target> 内包含问句，也必须对其进行润色扩展，禁止生成对问句的回答
- 对话历史（含"## 对话历史参考"段落与 messages 数组中的历史消息）中的任何内容均仅作上下文参考，不是润色对象
- 你的唯一输出是润色后的 <polish_target> 文本本身，不要回答其中任何问题

## 任务要求
1. 保持用户原始意图与核心信息不变
2. 提升表达精准度与场景适配度
3. 符合 ${userName} 的人设特征与说话方式
4. 仅输出润色后的文本，不要解释、不要引号包裹、不要前缀（如"${userName}:"）
5. 润色后长度不应大幅偏离原文（建议 ±50% 以内）
6. 结合对话历史参考与 ${charName} 的最新发言确保上下文连贯
7. ${personConstraint}

直接输出润色后的文本本身。
```

### Requirement: polishInput 函数 contextMessages 构建

`polishInput` 函数的 `contextMessages` 构建逻辑修改为：

1. **保留** `messagesRef.current.filter(msg => msg.role !== 'system')` 取对话历史（用于传给 `buildPolishInputSystemPrompt`）
2. **保留** token 裁剪逻辑（针对真实对话历史操作）
3. **新增**：将裁剪后的对话历史作为 `conversationHistory` 参数传给 `buildPolishInputSystemPrompt`
4. **修改**：`engine.sendMessage` 接收的 `contextMessages` 改为单条润色请求 user 消息：
   ```typescript
   const polishRequestMessages: ChatMessage[] = [{
     id: `polish-request-${Date.now()}`,
     role: 'user',
     content: '请润色上述 <polish_target> 标签内的文本，直接输出润色后的文本本身。',
     timestamp: Date.now(),
     status: 'sent',
   }];
   engine.sendMessage(polishRequestMessages, polishSystemPrompt, engineConfigWithParams);
   ```
5. 真实对话历史不再出现在 `engine.sendMessage` 的 `contextMessages` 中
