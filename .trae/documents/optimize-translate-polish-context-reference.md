# 优化翻译和润色的参数参考机制 — 与生成按钮保持一致

## 概述

当前角色卡编辑中，**生成**操作会自动收集角色卡其他已填字段作为上下文传入 AI，而**翻译**和**润色**操作仅处理当前字段的文本，不传入任何角色卡其他字段信息。需求是让翻译和润色也像生成一样，自动参考角色卡其他相关字段内容，确保结果与角色卡整体设定保持一致。

## 当前状态分析

### 三种操作的上下文差异

| 维度 | 翻译 (translate) | 润色 (polish) | 生成 (generate) |
|------|-----------------|--------------|----------------|
| 传入模板变量 | 空对象 `{}` | `{ polish_requirements }` | 9 个变量（含 `existing_fields_info`） |
| user prompt | 直接传字段原文 | 直接传字段原文 | 模板构建的结构化提示词 |
| 引用其他字段 | **否** | **否** | **是**（9 个字段，每个截断 300 字符） |

### 关键约束

1. **模板持久化机制**：`promptTemplateService.ts` 的 `SCHEMA_VERSION = 5`，修改默认模板结构（新增 part/变量）不会自动更新已持久化的用户模板（`mergeNewDefaultTemplates` 只添加缺失模板，不更新已有模板）。要提高 SCHEMA_VERSION 会触发破坏性重置，清除用户自定义。
2. **翻译/润色的 user prompt 来源**：直接把字段文本作为 user 消息发送（`sendCharacterAIRequest(activeEngine, finalSystemPrompt, text)`），不是从模板构建。
3. **`FIELD_DESCRIPTIONS`**（hook 第 94-131 行）：定义了 9 个可生成字段的 label 和 guide，生成操作用它来收集上下文。

## 修改方案

**核心思路**：不修改 `promptTemplateService.ts` 的模板结构（避免破坏性重置），而是在 hook 层将角色卡其他字段上下文拼接到 user prompt 中。这样翻译和润色发送给 AI 的 user prompt 从"纯字段文本"变为"字段文本 + 角色卡上下文参考"。

### 文件 1: `src/renderer/components/Character/hooks/useCharacterAIOperations.ts`

**目标**：在翻译和润色操作中构建角色卡上下文，拼接到 user prompt

**修改内容**：

1. **新增辅助函数 `buildCharacterContext`**（在 `FIELD_DESCRIPTIONS` 定义之后，约第 132 行）：
   ```ts
   /**
    * 构建角色卡其他字段的上下文信息，供翻译和润色操作参考。
    * 与 generate 操作的 existingFieldsInfo 构建逻辑一致：
    * 遍历 FIELD_DESCRIPTIONS 中除目标字段外的已填字段，每个截断到 300 字符。
    */
   function buildCharacterContext(formValues: Record<string, any>, excludeField: string): string {
     const existingFieldsInfo = Object.entries(FIELD_DESCRIPTIONS)
       .filter(([key]) => key !== excludeField)
       .map(([key, info]) => {
         const value = formValues[key];
         const displayValue = Array.isArray(value) ? value.join('\n') : (value || '');
         if (!displayValue) return null;
         return `- ${info.label}：${displayValue.substring(0, 300)}${displayValue.length > 300 ? '...' : ''}`;
       })
       .filter(Boolean)
       .join('\n');
     return existingFieldsInfo;
   }
   ```

2. **修改 `handleTranslate` 中的 user prompt 构建**（第 226 行附近）：
   - 原代码：`const translatedText = await sendCharacterAIRequest(activeEngine, finalSystemPrompt, text);`
   - 修改为：构建包含角色卡上下文的增强 user prompt
   ```ts
   // 构建包含角色卡上下文的 user prompt（与 generate 操作保持一致的参数参考机制）
   const characterContext = buildCharacterContext(formValues, field);
   const enhancedUserPrompt = characterContext
     ? `${text}\n\n【角色卡其他字段参考】\n${characterContext}\n\n请在翻译时参考上述角色卡上下文信息，确保翻译用词与角色卡整体设定保持一致。`
     : text;
   const translatedText = await sendCharacterAIRequest(activeEngine, finalSystemPrompt, enhancedUserPrompt);
   ```

3. **修改 `performPolish` 中的 user prompt 构建**（第 502 行附近）：
   - 原代码：`const polishedText = await sendCharacterAIRequest(activeEngine, finalSystemPrompt, currentPolishText);`
   - 修改为：构建包含角色卡上下文的增强 user prompt
   ```ts
   // 构建包含角色卡上下文的 user prompt（与 generate 操作保持一致的参数参考机制）
   const characterContext = buildCharacterContext(formValues, currentPolishField);
   const enhancedUserPrompt = characterContext
     ? `${currentPolishText}\n\n【角色卡其他字段参考】\n${characterContext}\n\n请在润色时参考上述角色卡上下文信息，确保润色结果与角色卡整体设定保持一致。`
     : currentPolishText;
   const polishedText = await sendCharacterAIRequest(activeEngine, finalSystemPrompt, enhancedUserPrompt);
   ```

4. **更新 `performPolish` 的依赖数组**：`formValues` 需要在依赖数组中（如尚未包含）。检查第 540 行附近的 `useCallback` 依赖数组，确保包含 `formValues`。

### 文件 2: `doc/04-character-card-module.md`

**目标**：增量更新技术文档

**修改内容**：
- 在 AI 增强功能描述中补充翻译/润色的上下文参考机制
- 在 4.1 技术难点表中添加条目
- 标记此为优化功能

## 不修改的文件

- `src/main/services/promptTemplateService.ts` — 不修改模板结构，避免触发破坏性重置清除用户自定义
- `src/renderer/utils/characterAIUtils.ts` — `sendCharacterAIRequest` 接口不变
- `src/renderer/components/Character/FieldEditor.tsx` — UI 不变
- `src/renderer/components/Character/CharacterEditModal.tsx` — 不变

## 假设与决策

1. **决策**：不修改 `promptTemplateService.ts` 的模板结构。原因：修改已有模板的 parts/variables 不会自动更新已持久化的用户模板（`mergeNewDefaultTemplates` 只添加缺失模板），而提高 `SCHEMA_VERSION` 会触发破坏性重置清除所有用户自定义。在 hook 层拼接 user prompt 是最安全、最小侵入的方案。
2. **决策**：上下文信息追加到 user prompt 末尾而非 system prompt。原因：user prompt 是发送给 AI 的"待处理内容"，在原文后追加上下文参考段落符合 AI 的理解模式（"这是要翻译的文本"+"这是参考信息"），且不干扰 system prompt 中的翻译/润色规则。
3. **决策**：当角色卡其他字段全部为空时，不追加上下文段落（直接传原文），保持与原行为一致，避免无意义的 token 消耗。
4. **决策**：`buildCharacterContext` 复用 `FIELD_DESCRIPTIONS` 和与 generate 完全一致的截断逻辑（300 字符），确保三种操作的上下文参考标准统一。

## 验证步骤

### 1. TypeScript 类型检查
```bash
npx tsc --noEmit
```

### 2. 功能测试场景

| # | 场景 | 操作 | 预期结果 |
|---|------|------|---------|
| 1 | 翻译"场景"字段（其他字段有内容） | 填写"描述""个性"等字段 → 翻译"场景"字段 | AI 收到的 user prompt 包含其他字段参考，翻译用词与角色卡设定一致 |
| 2 | 翻译字段（其他字段全空） | 仅填写目标字段 → 翻译 | 行为与修改前一致（不追加上下文段落） |
| 3 | 润色"描述"字段（其他字段有内容） | 填写"个性""场景"等 → 润色"描述" | AI 收到的 user prompt 包含其他字段参考，润色风格与角色卡整体一致 |
| 4 | 润色字段（其他字段全空） | 仅填写目标字段 → 润色 | 行为与修改前一致 |
| 5 | 生成操作不受影响 | 使用生成按钮 | 生成操作行为不变（已有自己的上下文机制） |
| 6 | 翻译tags字段 | 填写其他字段 → 翻译tags | 翻译后tags仍经过顿号转逗号后处理 |
| 7 | 润色tags字段 | 填写其他字段 → 润色tags | 润色后tags仍经过顿号转逗号后处理 |
