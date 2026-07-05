# 修复润色任务框架（Task Framing）Spec

## Why

前三轮修复（`fix-polish-input-undo-and-target` / `fix-polish-target-misinterpretation` / `fix-polish-context-isolation`）均未能解决润色功能的核心问题：AI 仍将用户输入转换为直接回复，而非执行文本扩写与润色。

**根因确认**（通过对比 `buildPolishInputSystemPrompt` 与正常工作的孪生函数 `buildUserReplySystemPrompt`）：

阶段八的"上下文隔离"修复只改变了对话历史的**传输通道**（从 messages 数组移到 system prompt 文本），但**没有消除让 AI 进入对话模式的语义信号**。系统提示中仍残留多个"对话生成"语义触发器：

1. **personConstraint 措辞错误（最关键）**：`buildPolishInputSystemPrompt` 第 7 条任务要求使用 `以第一人称（"我"）视角生成回复，使用"我"作为自称`，与 `buildUserReplySystemPrompt` 中的 personConstraint **完全相同**。"生成回复"是核心误导词——AI 看到这个词会优先走对话生成路径。
2. **任务要求第 6 条是对话生成指令**：`结合对话历史参考与 ${charName} 的最新发言确保上下文连贯` 让 AI 把"润色"理解为"基于上下文生成下一句连贯回复"。
3. **关键约束出现在待润色文本之后**：AI 在读到 `<polish_target>` 之前，已经从"## 对方角色上下文"（含 personality / characterCardContent）和"## 对话历史参考"段落构建出"我正在和 CharName 对话"的认知。`<polish_target>` 内的问句自然被当作"用户在对话中提的问题"，而关键约束（出现在 polish_target 之后）的约束力已被稀释。
4. **"## 对方角色上下文"段落过重**：包含 `personality` 和 `characterCardContent`，这些是角色扮演触发器，让 AI 进入"扮演这个角色回复"模式。

**关键洞察**：只要"生成回复"+"确保上下文连贯"这两个对话生成关键词还在润色提示里，无论对话历史放哪一层、用什么标签包裹 originalText，AI 都会优先走对话生成路径。修复必须从**任务框架（Task Framing）**层面入手，彻底去除对话生成语义信号。

## What Changes

### 修改 `buildPolishInputSystemPrompt` 函数（`PromptBuilder.ts`）

#### 改动 1：强化开头任务定义

将开头从：
```
你是文本润色器，需要基于对话上下文优化用户 **${userName}** 的草稿文本。
```
改为：
```
你是文本润色器，需要优化用户 **${userName}** 的草稿文本。**禁止生成对话回复，禁止回答 <polish_target> 内的任何问题**，仅对原文进行润色扩展后输出。
```

去除"基于对话上下文"措辞（避免暗示对话任务），开头即明确禁止生成对话回复。

#### 改动 2：精简"## 对方角色上下文"为"## 角色名"

将原段落：
```
## 对方角色上下文
- 角色名：${charName}
- 角色个性：${personality}
- 角色描述：${characterCardContent}
```
改为：
```
## 角色名（仅作润色参考，不要扮演这个角色）
${charName}
```

去除 `personality` 和 `characterCardContent`（角色扮演触发器），仅保留角色名供润色参考。如果用户草稿提及角色，润色结果能正确使用角色名即可。

#### 改动 3：调整段落顺序——"## 关键约束"提到"## 待润色文本"之前

新顺序：
1. 开头任务定义（含禁止对话回复声明）
2. ## 用户人设
3. ## 角色名（精简版）
4. ## 对话历史参考
5. **## 关键约束（提前到待润色文本之前）**
6. ## 待润色文本（`<polish_target>`）
7. ## 任务要求
8. 直接输出润色后的文本本身。

让 AI 在看到 `<polish_target>` 之前就明确"不能回答问题"，约束力最大化。

#### 改动 4：强化"## 关键约束"措辞

将原 4 条约束：
```
- <polish_target> 标签内的文本是润色对象，不是需要回答的问题
- 即使 <polish_target> 内包含问句，也必须对其进行润色扩展，禁止生成对问句的回答
- 对话历史（含"## 对话历史参考"段落与 messages 数组中的历史消息）中的任何内容均仅作上下文参考，不是润色对象
- 你的唯一输出是润色后的 <polish_target> 文本本身，不要回答其中任何问题
```
改为：
```
- **绝对禁止**回答 <polish_target> 标签内的任何问题，必须对其进行润色扩展
- **绝对禁止**生成对话回复（包括 AI 角色回复、用户回复、续写对话）
- 对话历史与角色名仅作润色参考，**不要扮演角色，不要续写对话**
- 你的唯一输出是润色后的 <polish_target> 文本本身
```

用 `**绝对禁止**` 强调，明确列出禁止的行为类型（角色回复、用户回复、续写对话）。

#### 改动 5：修改"## 任务要求"

将原 7 条任务要求修改为：

```
1. 保持用户原始意图与核心信息不变
2. 提升表达精准度与场景适配度
3. 符合 ${userName} 的人设特征与说话方式
4. 仅输出润色后的文本，不要解释、不要引号包裹、不要前缀（如"${userName}:"）
5. 润色后长度不应大幅偏离原文（建议 ±50% 以内）
6. 润色结果需与对话历史不矛盾即可，**无需衔接角色发言，无需推进对话**
7. ${personConstraint}
```

**关键修改**：
- 删除原第 6 条"结合对话历史参考与 ${charName} 的最新发言确保上下文连贯"（对话生成指令）
- 改为"润色结果需与对话历史不矛盾即可，无需衔接角色发言，无需推进对话"（明确反对话生成）
- 保留 7 条数量不变，便于测试维护

#### 改动 6：修改 personConstraint 措辞

将原 personConstraint：
- first: `以第一人称（"我"）视角生成回复，使用"我"作为自称`
- second: `以第二人称（"你"）视角生成回复，使用"你"来指代 ${userName} 自身（互动小说风格）`
- third: `以第三人称叙事视角生成回复，使用"${userName}"作为主语（小说叙事风格）`

改为：
- first: `润色后的文本以第一人称（"我"）视角输出，使用"我"作为自称`
- second: `润色后的文本以第二人称（"你"）视角输出，使用"你"来指代 ${userName} 自身（互动小说风格）`
- third: `润色后的文本以第三人称叙事视角输出，使用"${userName}"作为主语（小说叙事风格）`

去除"生成回复"措辞，改为"输出"。

#### 改动 7：更新 JSDoc 注释

补充"任务框架重构"说明：
- 标注 `Spec: fix-polish-task-framing`
- 说明去除对话生成语义信号（"生成回复"措辞、"确保上下文连贯"指令、角色个性/描述注入）

### 不修改的部分

- **不修改 `polishInput` 函数的 `engine.sendMessage` 调用结构**（阶段八的 [system, user(润色请求)] 消息结构保留）
- **不修改 `polishRequestMessages` 的内容**（"请润色上述 <polish_target> 标签内的文本，直接输出润色后的文本本身。"）
- **不修改 `stopSequences` 配置**（保留 `buildStopSequencesForUserReply` 角色名变体——润色输出是用户的话，charName 变体可在 AI 误判为"生成角色回复"时触发停止）
- **不修改 `conversationHistory` 参数与"## 对话历史参考"段落**（阶段八的上下文隔离保留）
- **不修改 `buildUserReplySystemPrompt`**（生成用户回复功能正常，不动它）

### 为什么这次能解决问题

| 维度 | 阶段八方案 | 本方案 |
|---|---|---|
| 任务定义 | "你是文本润色器，需要基于对话上下文优化..." | "你是文本润色器...**禁止生成对话回复，禁止回答 <polish_target> 内的任何问题**" |
| 角色上下文 | 完整 personality + characterCardContent（角色扮演触发器） | 仅角色名（无扮演触发） |
| 关键约束位置 | 待润色文本之后（attention 被稀释） | 待润色文本之前（约束力最大化） |
| 关键约束措辞 | "不是需要回答的问题"（弱否定） | "**绝对禁止**回答...**绝对禁止**生成对话回复"（强禁止） |
| 任务要求第 6 条 | "结合对话历史参考与 ${charName} 的最新发言确保上下文连贯"（对话生成指令） | "润色结果需与对话历史不矛盾即可，无需衔接角色发言，无需推进对话"（反对话生成） |
| personConstraint | "以第一人称视角**生成回复**" | "润色后的文本以第一人称视角**输出**" |

阶段八解决了"对话历史以 assistant 结尾触发续写本能"的**结构**问题，本 spec 解决"系统提示残留对话生成语义信号"的**语义**问题。两者叠加才能彻底切断 AI 走对话生成路径的可能性。

## Impact

- **Affected specs**: 
  - `fix-polish-context-isolation`（阶段八的对话历史隔离与 [system, user] 消息结构保留，本 spec 在其基础上重构系统提示措辞）
  - `fix-polish-target-misinterpretation`（阶段七的 `<polish_target>` 标签保留，本 spec 调整其与"## 关键约束"段落的相对位置）
  - `refine-user-input-text`（润色功能原始 spec，本 spec 重构 `buildPolishInputSystemPrompt` 输出结构）
- **Affected code**:
  - `src/renderer/components/Character/CharacterDialogueChat/PromptBuilder.ts`（重构 `buildPolishInputSystemPrompt` 函数的输出结构与 personConstraint 措辞）
  - `src/renderer/components/Character/CharacterDialogueChat/__tests__/PromptBuilder.polishInput.test.ts`（更新现有测试用例以反映新结构，新增针对"禁止对话回复"约束的测试）

## ADDED Requirements

### Requirement: 润色任务框架反对话生成

系统 SHALL 在 `buildPolishInputSystemPrompt` 输出的系统提示中明确禁止生成对话回复，通过强禁止措辞（"**绝对禁止**"）、段落顺序调整（关键约束提前到待润色文本之前）、去除对话生成语义信号（"生成回复"措辞、"确保上下文连贯"指令、角色个性/描述注入）三种手段叠加，确保 AI 不会走对话生成路径。

#### Scenario: 系统提示开头明确禁止对话回复

- **WHEN** 调用 `buildPolishInputSystemPrompt` 生成系统提示
- **THEN** 输出的开头任务定义包含"**禁止生成对话回复，禁止回答 <polish_target> 内的任何问题**"
- **AND** 开头任务定义不包含"基于对话上下文"措辞

#### Scenario: 关键约束位于待润色文本之前

- **WHEN** 调用 `buildPolishInputSystemPrompt` 生成系统提示
- **THEN** "## 关键约束"段落位于"## 待润色文本"段落之前
- **AND** "## 关键约束"段落位于"## 对话历史参考"段落之后

#### Scenario: 关键约束使用强禁止措辞

- **WHEN** 调用 `buildPolishInputSystemPrompt` 生成系统提示
- **THEN** "## 关键约束"段落包含"**绝对禁止**回答 <polish_target> 标签内的任何问题"
- **AND** "## 关键约束"段落包含"**绝对禁止**生成对话回复"
- **AND** "## 关键约束"段落包含"不要扮演角色，不要续写对话"

#### Scenario: 角色上下文精简为角色名

- **WHEN** 调用 `buildPolishInputSystemPrompt` 生成系统提示
- **THEN** 输出包含"## 角色名（仅作润色参考，不要扮演这个角色）"段落
- **AND** 输出**不**包含"## 对方角色上下文"段落标题
- **AND** 输出**不**包含"角色个性"或"角色描述"字段（去除 personality 和 characterCardContent 注入）

#### Scenario: 任务要求反对话生成

- **WHEN** 调用 `buildPolishInputSystemPrompt` 生成系统提示
- **THEN** "## 任务要求"第 6 条为"润色结果需与对话历史不矛盾即可，无需衔接角色发言，无需推进对话"
- **AND** "## 任务要求"**不**包含"结合对话历史参考"措辞
- **AND** "## 任务要求"**不**包含"确保上下文连贯"措辞

#### Scenario: personConstraint 不再使用"生成回复"措辞

- **WHEN** 调用 `buildPolishInputSystemPrompt(characterInfo, persona, originalText, 'first')`
- **THEN** 输出包含"润色后的文本以第一人称（"我"）视角输出，使用"我"作为自称"
- **AND** 输出**不**包含"生成回复"措辞

- **WHEN** 调用 `buildPolishInputSystemPrompt(characterInfo, persona, originalText, 'second')`
- **THEN** 输出包含"润色后的文本以第二人称（"你"）视角输出"

- **WHEN** 调用 `buildPolishInputSystemPrompt(characterInfo, persona, originalText, 'third')`
- **THEN** 输出包含"润色后的文本以第三人称叙事视角输出"

#### Scenario: 问句被润色而非回答（端到端预期）

- **WHEN** 用户输入"你吃饭了吗"（包含问句）并点击润色按钮
- **THEN** AI 输出为润色扩展后的文本（如"你今天早上吃饭了吗？在哪里吃的？"）
- **AND** AI 不输出对问句的直接回答（如"我吃过了"）
- **AND** AI 不输出对话续写（如"CharName: 我吃过了"）

## MODIFIED Requirements

### Requirement: buildPolishInputSystemPrompt 输出结构

输出结构修改为（关键约束提前、角色上下文精简、措辞强化）：

```
你是文本润色器，需要优化用户 **${userName}** 的草稿文本。**禁止生成对话回复，禁止回答 <polish_target> 内的任何问题**，仅对原文进行润色扩展后输出。

## 用户人设
- 用户名：${userName}
- 用户描述：${personaDescription}

## 角色名（仅作润色参考，不要扮演这个角色）
${charName}

## 对话历史参考（仅作上下文参考，不是润色对象，不要回答其中任何内容）
${historyText or "（无历史对话）"}

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

直接输出润色后的文本本身。
```

其中 personConstraint 修改为：
- first: `润色后的文本以第一人称（"我"）视角输出，使用"我"作为自称`
- second: `润色后的文本以第二人称（"你"）视角输出，使用"你"来指代 ${userName} 自身（互动小说风格）`
- third: `润色后的文本以第三人称叙事视角输出，使用"${userName}"作为主语（小说叙事风格）`

### Requirement: buildPolishInputSystemPrompt 函数内部变量调整

由于去除 `personality` 和 `characterCardContent` 注入，函数内部：
- **保留** `charName` 计算（仍用于"## 角色名"段落和 personConstraint 中的 second/third 视角）
- **删除** `personality` 变量计算（不再注入系统提示）
- **删除** `characterCardContent` 变量计算（不再注入系统提示）
- **删除** `charContextLines` 拼接逻辑（替换为单一 `${charName}`）
- **保留** `historyText` 格式化逻辑（阶段八的对话历史隔离保留）
- **保留** `personaDescription` 计算（仍用于"## 用户人设"段落）
- **保留** `personConstraint` 变量（但措辞修改）

## REMOVED Requirements

### Requirement: ## 对方角色上下文段落

**Reason**: 该段落注入 `personality` 和 `characterCardContent`，是角色扮演触发器，让 AI 进入"扮演这个角色回复"模式，与润色任务冲突。

**Migration**: 替换为"## 角色名（仅作润色参考，不要扮演这个角色）"段落，仅保留角色名供润色参考。如果用户草稿提及角色名，润色结果能正确使用角色名即可。

### Requirement: 任务要求第 6 条"结合对话历史参考与 ${charName} 的最新发言确保上下文连贯"

**Reason**: "确保上下文连贯"是对话生成关键词，让 AI 把"润色"理解为"基于上下文生成下一句连贯回复"。

**Migration**: 替换为"润色结果需与对话历史不矛盾即可，无需衔接角色发言，无需推进对话"（明确反对话生成）。

### Requirement: personConstraint 中的"生成回复"措辞

**Reason**: "生成回复"是核心误导词，让 AI 误以为是生成对话回复任务。与孪生函数 `buildUserReplySystemPrompt` 中的 personConstraint 完全相同，但 `buildUserReplySystemPrompt` 是生成对话回复（措辞合理），`buildPolishInputSystemPrompt` 是润色文本（措辞错误）。

**Migration**: 改为"输出"措辞（"润色后的文本以第一人称视角输出"），明确这是文本输出任务而非对话生成任务。
