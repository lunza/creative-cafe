# 修复润色目标被误判为问题 Spec

## Why

上一轮 spec `fix-polish-input-undo-and-target` 修复 Bug 2 时，在 `polishInput` 函数的 `contextMessages` 末尾追加了一条合成 user 消息 `{role: 'user', content: originalText}`，意图是让 AI 引擎看到对话以"用户草稿文本"结尾，从而正确识别润色对象。但该修复引入了新的功能异常：

**问题表现**：AI 模型在 chat completion 场景下，看到对话历史以 user 消息结尾时，会自然地"回复"该消息——即使 `polishSystemPrompt` 中明确"你是文本润色器"，user 消息的"提问"语义压倒了系统提示的润色指令。结果 AI 将待润色的用户输入错误处理为需要直接回答的问题，而非润色对象。

**具体示例**：
- 用户输入："你吃饭了吗"
- 期望输出（润色扩展）："你今天早上吃饭了吗？在哪里吃的？"
- 实际输出（直接回答）："我吃过了"

**根因**：在 OpenAI 风格的 chat completion API 中，`messages` 数组末尾的 user 消息被视为"当前轮次用户输入"，AI 的职责是"回复"该消息。将 `originalText` 作为合成 user 消息追加到末尾，等价于让 AI"回答"这段文本，而非"润色"它。系统提示中的"你是润色器"约束力不足以对抗这种强语义。

## What Changes

### 回退合成 user 消息（`CharacterDialogueChat.hooks.ts`）

- **移除** `polishInput` 函数中向 `contextMessages` 末尾追加合成 user 消息的逻辑（即上一轮 spec 的 Bug 2 修复代码，第 1889-1898 行）
- `contextMessages` 恢复为 `messagesRef.current.filter(msg => msg.role !== 'system')` + token 裁剪后的真实对话历史
- 对话历史以 AI 回复结尾的状态恢复原状（这是正常的对话轮次结束状态）

### 强化系统提示润色对象锚定（`PromptBuilder.ts`）

- 修改 `buildPolishInputSystemPrompt` 函数，通过以下手段强化润色对象识别：
  - **标签包裹**：用 `<polish_target>` / `</polish_target>` 标签包裹 `originalText`，明确标识润色对象的边界
  - **新增"关键约束"段落**：在"任务要求"之前插入明确的反误判约束：
    - `<polish_target>` 标签内的文本是润色对象，**不是**需要回答的问题
    - 即使 `<polish_target>` 内包含问句，也必须对其进行润色扩展，**禁止**生成对问句的回答
    - 对话历史中的最后一条 AI 回复仅作为上下文参考，**不是**润色对象
    - 你的唯一输出是润色后的 `<polish_target>` 文本本身，不要回答其中任何问题
  - **保留**原有任务要求 1-7（保持原始意图 / 提升表达 / 符合人设 / 仅输出 / 长度约束 / 上下文连贯 / 人称视角）

### 为什么不在合成消息中使用标记

考虑过在合成 user 消息的 content 中用 `[待润色]xxx[/待润色]` 标记包裹，但即使有标记，user 消息作为对话末尾仍会触发 AI 的"回复"本能。根本问题是**消息角色**（user）而非**消息内容**。因此选择移除合成消息，回到"对话以 AI 回复结尾"的正常状态，通过系统提示的标签和约束来锚定润色对象。

## Impact

- **Affected specs**: `fix-polish-input-undo-and-target`（上一轮 Bug 2 修复引入此问题，本 spec 回退其 contextMessages 修改并改用系统提示方案）、`refine-user-input-text`（润色功能原始 spec，本 spec 强化其 `buildPolishInputSystemPrompt` 实现）
- **Affected code**:
  - `src/renderer/components/Character/CharacterDialogueChat/CharacterDialogueChat.hooks.ts`（移除 `polishInput` 中合成 user 消息追加逻辑，第 1889-1898 行）
  - `src/renderer/components/Character/CharacterDialogueChat/PromptBuilder.ts`（强化 `buildPolishInputSystemPrompt`，用 `<polish_target>` 标签包裹 + 新增关键约束段落）

## ADDED Requirements

### Requirement: 润色对象标签标识

系统 SHALL 在 `buildPolishInputSystemPrompt` 输出的系统提示中，用 `<polish_target>` / `</polish_target>` 标签明确包裹 `originalText`，使 AI 引擎能清晰识别润色对象的边界。

#### Scenario: 标签包裹格式

- **WHEN** 调用 `buildPolishInputSystemPrompt(characterInfo, persona, '你吃饭了吗', 'first')`
- **THEN** 输出包含 `<polish_target>\n你吃饭了吗\n</polish_target>` 标签段落
- **AND** 标签内的文本与 `originalText` 完全一致

### Requirement: 润色反误判约束

系统 SHALL 在 `buildPolishInputSystemPrompt` 输出的系统提示中，包含明确的反误判约束段落，防止 AI 将待润色文本中的问句误判为需要回答的问题。

#### Scenario: 问句润色

- **WHEN** 用户输入"你吃饭了吗"（包含问句）并点击润色按钮
- **THEN** AI 引擎收到的系统提示包含约束："即使 `<polish_target>` 内包含问句，也必须对其进行润色扩展，禁止生成对问句的回答"
- **AND** AI 输出为润色扩展后的文本（如"你今天早上吃饭了吗？在哪里吃的？"），而非直接回答（如"我吃过了"）

#### Scenario: 非问句润色

- **WHEN** 用户输入"今天天气不错"（非问句）并点击润色按钮
- **THEN** AI 输出为润色扩展后的文本（如"今天天气真不错，阳光明媚"），润色功能正常工作

### Requirement: 上下文参考边界

系统 SHALL 在系统提示中明确说明对话历史中最后一条 AI 回复的角色——仅作为上下文参考，不是润色对象。

#### Scenario: AI 回复不被润色

- **WHEN** 对话历史最后一条消息是 AI 的回复"是啊，阳光很好"，用户输入"今天天气不错"并点击润色
- **THEN** AI 引擎收到的系统提示包含约束："对话历史中的最后一条 AI 回复仅作为上下文参考，不是润色对象"
- **AND** AI 输出针对"今天天气不错"进行润色，而非针对"是啊，阳光很好"

## MODIFIED Requirements

### Requirement: polishInput contextMessages 构建

**回退**上一轮 spec 的修改：`polishInput` 函数中**移除**向 `contextMessages` 末尾追加合成 user 消息的逻辑。`contextMessages` 恢复为：

1. `messagesRef.current.filter(msg => msg.role !== 'system')` 取对话历史
2. token 裁剪逻辑保持不变
3. **不再追加**合成 user 消息（移除 `polish-target-${Date.now()}` 相关代码块）
4. `engine.sendMessage(contextMessages, polishSystemPrompt, engineConfigWithParams)` 接收的 `contextMessages` 为真实对话历史（可能以 AI 回复结尾）

### Requirement: buildPolishInputSystemPrompt 输出结构

`buildPolishInputSystemPrompt` 函数的输出结构修改为：

```
你是文本润色器，需要基于对话上下文优化用户 **${userName}** 的草稿文本。

## 用户人设
- 用户名：${userName}
- 用户描述：${personaDescription}

## 对方角色上下文
${charContextLines}

## 待润色文本
<polish_target>
${originalText}
</polish_target>

## 关键约束
- <polish_target> 标签内的文本是润色对象，不是需要回答的问题
- 即使 <polish_target> 内包含问句，也必须对其进行润色扩展，禁止生成对问句的回答
- 对话历史中的最后一条 AI 回复仅作为上下文参考，不是润色对象
- 你的唯一输出是润色后的 <polish_target> 文本本身，不要回答其中任何问题

## 任务要求
1. 保持用户原始意图与核心信息不变
2. 提升表达精准度与场景适配度
3. 符合 ${userName} 的人设特征与说话方式
4. 仅输出润色后的文本，不要解释、不要引号包裹、不要前缀（如"${userName}:"）
5. 润色后长度不应大幅偏离原文（建议 ±50% 以内）
6. 结合对话历史与 ${charName} 的最新发言确保上下文连贯
7. ${personConstraint}

直接输出润色后的文本本身。
```
