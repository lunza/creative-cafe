# 对话模式：人设生成回复支持输入框内容作为用户指令

## 概述

当前"以当前用户人设生成对话回复"功能在点击按钮时，仅基于对话历史和人设信息从零生成回复，完全忽略输入框中的已有内容。需求是：如果输入框中有内容，则将其作为用户指令传入 AI，影响生成结果；输入框为空时保持现有行为不变。

## 当前状态分析

### 功能流程

1. 用户点击 AI回复按钮 → `ChatInputBar` 调用 `onGenerateUserReply()`（无参数）
2. `CharacterDialogueChat.tsx` 的 `handleGenerateUserReply` 调用 `generateUserReply()`（无参数）
3. `generateUserReply()`（hooks.ts 第 1580-1763 行）：
   - 构建 `userReplySystemPrompt`（PromptBuilder.ts 第 317-385 行）
   - 取 `messagesRef.current` 作为 `contextMessages`
   - 调用 `engine.sendMessage(contextMessages, userReplySystemPrompt, ...)`
4. 生成文本通过 `generatedReplyText` prop 填入输入框（不自动发送）

### 关键约束

- `generateUserReply` 当前**不接收任何参数**，无法感知输入框内容
- `ChatInputBar` 中的 `input` state 是组件内部局部状态，外部无法直接读取
- 系统提示 `buildUserReplySystemPrompt` 当前不包含任何"用户指令"段落
- `handleGenerateUserReply` 是无参 `() => void` 回调

## 修改方案

### 文件 1: `src/renderer/components/Character/CharacterDialogueChat/CharacterDialogueChat.hooks.ts`

**目标**：让 `generateUserReply` 接收可选的用户指令参数，并将其注入系统提示

**修改内容**：

1. **修改 `generateUserReply` 签名**（第 1580 行）：
   ```ts
   const generateUserReply = useCallback(async (userInstruction?: string): Promise<string> => {
   ```
   - 新增可选参数 `userInstruction`，为输入框中的文本内容

2. **将 `userInstruction` 传入 `buildUserReplySystemPrompt`**（第 1612-1624 行）：
   ```ts
   const userReplySystemPrompt = buildUserReplySystemPrompt(
     { ... },           // characterInfo 不变
     selectedPersona,   // persona 不变
     characterConfig?.userReplyPerson,  // 人称不变
     userInstruction    // 新增第四参数
   );
   ```

3. **更新 `useCallback` 依赖数组**（第 1763 行）：无需新增依赖（`userInstruction` 是参数而非闭包变量）

### 文件 2: `src/renderer/components/Character/CharacterDialogueChat/PromptBuilder.ts`

**目标**：`buildUserReplySystemPrompt` 接收用户指令参数，注入到系统提示中

**修改内容**：

1. **修改函数签名**（第 317-321 行）：
   ```ts
   export function buildUserReplySystemPrompt(
     characterInfo: CharacterInfoForPrompt,
     persona: UserPersona,
     person?: 'first' | 'second' | 'third',
     userInstruction?: string  // 新增
   ): string {
   ```

2. **在系统提示中注入用户指令**（在"任务要求"列表后、"直接输出回复内容本身"前）：
   - 当 `userInstruction` 非空时，追加一个"用户指令"段落：
   ```
   ## 用户指令
   {userInstruction}
   
   请在生成回复时参考上述用户指令，使回复内容符合用户的意图。
   ```
   - 当 `userInstruction` 为空或纯空白时，不追加该段落（保持现有行为）

3. **修改任务要求第 5 条**（第 380 行），在有用户指令时增加提示：
   - 原文：`5. 结合对话历史与 ${charName} 的最新发言自然衔接`
   - 有指令时追加：`5. 结合对话历史与 ${charName} 的最新发言自然衔接，并遵循上方"用户指令"的要求`

### 文件 3: `src/renderer/components/Character/CharacterDialogueChat/CharacterDialogueChat.tsx`

**目标**：将输入框内容传递给 `generateUserReply`

**修改内容**：

1. **修改 `handleGenerateUserReply`**（第 236-246 行）：
   - 新增 `currentInput` 参数，传递给 `generateUserReply`
   ```ts
   const handleGenerateUserReply = useCallback(async (currentInput?: string) => {
     try {
       const text = await generateUserReply(currentInput);
       if (text && text.length > 0) {
         setGeneratedReplyText(text);
       }
     } catch (error) {
       console.error('[CharacterDialogueChat] handleGenerateUserReply error:', error);
     }
   }, [generateUserReply]);
   ```

### 文件 4: `src/renderer/components/Character/CharacterDialogueChat/ChatInputBar.tsx`

**目标**：点击 AI回复按钮时传入当前输入框内容

**修改内容**：

1. **修改 `onGenerateUserReply` prop 类型**（第 14 行）：
   ```ts
   onGenerateUserReply?: (currentInput?: string) => void;
   ```

2. **修改按钮 onClick**（第 251-256 行）：
   ```tsx
   onClick={() => {
     if (isGeneratingUserReply) {
       onCancel?.();
     } else {
       onGenerateUserReply?.(input.trim() || undefined);
     }
   }}
   ```
   - 传入 `input.trim()`，若为空字符串则传 `undefined`（保持原有行为）

### 文件 5: `doc/04b-character-dialogue-chat-module.md`（增量更新）

**目标**：更新技术文档

**修改内容**：
- 在功能描述中补充"输入框内容作为用户指令"的说明
- 标记此为新增功能

## 不修改的文件

- `CharacterDialogueChat.types.ts` — 无需新增类型
- `usePromptBuilder.ts` — 不涉及
- 主进程任何文件 — 纯渲染层修改

## 假设与决策

1. **决策**：用户指令通过系统提示注入而非作为 contextMessages 中的 user 消息。原因：系统提示方式更灵活，AI 能更好地理解"这是用户对生成方向的指导"而非"这是我要发送的消息"。
2. **决策**：输入框为空时传 `undefined`，保持完全向后兼容。
3. **决策**：不在 `generateUserReply` 中清空输入框。生成完成后文本通过 `generatedReplyText` 机制替换输入框内容（现有行为），用户可编辑后发送。

## 验证步骤

### 1. TypeScript 类型检查
```bash
npx tsc --noEmit
```

### 2. 功能测试场景

| # | 场景 | 操作 | 预期结果 |
|---|------|------|---------|
| 1 | 输入框有内容 | 输入"用温柔的语气" → 点击 AI回复 | 生成的回复受"用温柔的语气"指令影响 |
| 2 | 输入框为空 | 不输入任何内容 → 点击 AI回复 | 行为与修改前完全一致 |
| 3 | 输入框有具体对话内容 | 输入"我想问他今天吃了什么" → 点击 AI回复 | 生成的回复围绕"问今天吃了什么"展开 |
| 4 | 生成后编辑发送 | 输入指令 → 点击 AI回复 → 编辑生成内容 → 发送 | 发送的是编辑后的内容 |
| 5 | 连续生成 | 输入指令 → 生成 → 再次输入新指令 → 生成 | 每次生成都使用当前输入框内容 |
| 6 | 生成中取消 | 输入指令 → 点击生成 → 点击停止 | 正常取消，无异常 |
