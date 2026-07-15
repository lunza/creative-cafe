# 修复翻译/润色/生成功能中字段内容截断问题

## 概述

角色卡编辑中的生成、翻译和润色功能在构建上下文参考时，将每个角色卡字段值截断到前 300 字符（`substring(0, 300)`），导致 AI 无法完整参考角色卡其他字段内容。日志系统本身不截断数据（`aiHandlers.ts` 明确标注"不截断"），问题根源在于前端 Hook 层的数据构建逻辑。

## 当前状态分析

### 截断点定位

经全链路排查（前端 Hook → `characterAIUtils.ts` → `AIService.tsx` → `preload.ts` → `aiHandlers.ts` → `fetch` → AI API），确认整个链路中**仅存在 2 处数据截断**，均位于 `useCharacterAIOperations.ts`：

| # | 文件 | 行号 | 截断代码 | 影响操作 |
|---|------|------|----------|---------|
| 1 | `useCharacterAIOperations.ts` | 146 | `displayValue.substring(0, 300)` | 翻译、润色 |
| 2 | `useCharacterAIOperations.ts` | 363 | `displayValue.substring(0, 300)` | 生成 |

### 不存在截断的环节（已确认）

- **目标字段文本本身**：翻译的 `text`、润色的 `currentPolishText` 不截断
- **系统提示词**：从 `promptTemplateService` 构建，不截断
- **`characterAIUtils.ts`**：`sendCharacterAIRequest` 直接传透，不截断
- **`AIService.tsx`**：`buildRequestBody` 直接使用 messages，不截断
- **`preload.ts`**：IPC 桥接直接传透，不截断
- **`aiHandlers.ts`**：主进程代理转发，日志明确标注"完整JSON，不截断"
- **`logger.ts`**：`writeLog` 使用 `JSON.stringify` 完整序列化，单条日志无长度限制（仅有 10MB 文件级轮转）
- **`promptTemplateService.ts`**：`buildPrompt` / `replaceVariables` 不截断变量值

### 日志排查结论

`aiHandlers.ts` 第 134 行 `logger.info(`[${requestId}] 请求体（完整JSON，不截断）`, fullBodyStr)` 将完整请求体写入日志文件。日志系统（`logger.ts`）的 `writeLog` 函数使用 `fs.appendFileSync` 完整写入，不截断单条日志。因此日志中看到的截断是**实际发送给 AI 的数据本身就已被截断**，而非日志记录过程中发生的截断。

## 修改方案

### 文件 1: `src/renderer/components/Character/hooks/useCharacterAIOperations.ts`

**目标**：移除 300 字符截断限制，完整传递角色卡字段内容

**修改内容**：

1. **修改 `buildCharacterContext` 函数**（第 146 行）：
   - 原代码：`return '- ${info.label}：${displayValue.substring(0, 300)}${displayValue.length > 300 ? '...' : ''}';`
   - 修改为：`return '- ${info.label}：${displayValue}';`
   - 移除 `substring(0, 300)` 截断和 `...` 省略号

2. **修改 `performGenerate` 中的 `existingFieldsInfo` 构建**（第 363 行）：
   - 原代码：`return '- ${info.label}：${displayValue.substring(0, 300)}${displayValue.length > 300 ? '...' : ''}';`
   - 修改为：`return '- ${info.label}：${displayValue}';`
   - 移除 `substring(0, 300)` 截断和 `...` 省略号

3. **更新 `buildCharacterContext` 函数注释**（第 133-137 行）：
   - 移除注释中"每个截断到 300 字符"的描述
   - 更新为"完整传递每个字段的值"

4. **添加诊断日志**（在 `handleTranslate`、`performPolish`、`performGenerate` 中）：
   - 在构建 `enhancedUserPrompt` / `existingFieldsInfo` 后，添加日志记录上下文数据的完整长度和字段数
   - 示例（翻译）：`addLog('[Character] 角色卡上下文参考: ${characterContext.length} 字符, ${contextFieldCount} 个字段', 'info');`
   - 示例（生成）：`addLog('[Character] existingFieldsInfo: ${existingFieldsInfo.length} 字符', 'info');`

### 文件 2: `doc/04-character-card-module.md`

**目标**：增量更新技术文档

**修改内容**：
- 更新 4.7 节中关于 `buildCharacterContext` 的描述（移除"截断 300 字符"）
- 添加 Bug 修复记录

## 不修改的文件

- `src/main/services/promptTemplateService.ts` — 不涉及
- `src/main/ipc/handlers/aiHandlers.ts` — 日志已正确（不截断），无需修改
- `src/main/services/logger.ts` — 日志系统无截断问题
- `src/renderer/utils/characterAIUtils.ts` — 无截断
- `src/renderer/components/Common/AIService.tsx` — 无截断

## 假设与决策

1. **决策**：完全移除 300 字符截断，而非提高限制（如 1000 或 2000）。原因：角色卡字段（如 description、system_prompt、first_mes）可能很长，任何固定截断长度都可能丢失关键信息。现代 AI 模型的上下文窗口通常足够大（128K-256K tokens），完整传递角色卡 9 个字段的文本不会超出上下文限制。
2. **决策**：不添加动态截断逻辑（如基于 token 预算的截断）。原因：角色卡编辑场景的上下文规模可控（9 个字段，总计通常不超过几万字符），添加 token 计算逻辑会引入不必要的复杂度。如未来出现超长内容问题，可再考虑。
3. **日志排查结论**：日志系统本身不截断数据。`aiHandlers.ts` 第 134 行将完整请求体以 JSON 字符串写入日志文件，`logger.ts` 的 `writeLog` 使用 `fs.appendFileSync` 完整写入。因此日志中看到的截断是实际发送数据的截断，已通过移除 `substring(0, 300)` 修复。

## 验证步骤

### 1. TypeScript 类型检查
```bash
npx tsc --noEmit
```

### 2. 功能测试场景

| # | 场景 | 操作 | 预期结果 |
|---|------|------|---------|
| 1 | 长描述字段翻译 | 填写超过 300 字符的"描述"字段 → 翻译"场景"字段 | AI 收到的上下文中"描述"字段完整，不被截断 |
| 2 | 长描述字段润色 | 填写超过 300 字符的"描述"字段 → 润色"个性"字段 | AI 收到的上下文中"描述"字段完整 |
| 3 | 长描述字段生成 | 填写超过 300 字符的"描述"字段 → 生成"场景"字段 | AI 收到的上下文中"描述"字段完整 |
| 4 | 日志验证 | 检查 ai-handler.log 中请求体 | 请求体中 messages 内容完整，无 `...` 截断标记 |
| 5 | 诊断日志验证 | 执行翻译/润色/生成操作 | 日志中显示上下文字符数和字段数 |
| 6 | 全空字段 | 其他字段全空时翻译/润色 | 行为不变（不追加上下文段落） |
| 7 | 所有字段均超长 | 9 个字段均超过 300 字符 → 生成 | 所有字段完整传递，AI 正常响应 |
