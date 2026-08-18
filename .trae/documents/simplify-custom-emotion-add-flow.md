# 计划：简化自定义情绪添加流程 — 用户仅输入中文词，AI 自动生成全部字段

## 摘要

当前添加自定义情绪需要用户手动输入英文键和中文标签，再手动点击"AI 生成提示词"按钮，流程繁琐。本次改造将流程简化为：用户仅需输入一个中文情绪词，点击"添加"按钮后系统自动调用 AI 生成英文键名 + SD 提示词 + NL 描述，并直接保存，无需用户额外输入或确认。

## 当前状态分析

### 现有流程（繁琐，3 步）
1. 用户输入英文键（如 `passionate_love`）— 需符合 `^[a-z][a-z0-9_]*$`
2. 用户输入中文标签（如"热恋"）
3. 用户点击"AI 生成提示词"按钮 → AI 生成 SD tag + NL 描述
4. 用户点击"添加" → 保存

### 涉及文件（基于 Phase 1 探索）
- `src/renderer/components/Character/CharacterDialogueChat/ExpressionManagerModal.tsx`（行 86-104 状态、行 289-312 AI 生成、行 321-367 提交、行 958-1050 添加弹窗 UI）
- `src/main/services/characterTraitAIService.ts`（行 2574-2736 `generateEmotionPrompts` 方法、行 2753+ `parseEmotionPromptResponse` 解析器）
- `src/main/ipc/handlers/characterTraitAIHandlers.ts`（行 201-214 IPC 通道，透传无需修改）
- `src/main/preload.ts`（透传无需修改）
- `src/renderer/types/electron.d.ts`（行 434-441 类型声明）

### 关键发现
- `generateEmotionPrompts` 当前仅生成 `{ positive, nlPrompt, auditDetails }`，**不生成英文键**
- 英文键由用户手动输入，经 `KEY_PATTERN = /^[a-z][a-z0-9_]*$/`（行 49）校验
- `handleAddCustomSubmit`（行 321-367）校验 key 格式 + 去重后调用 `addCustomEmotion`
- 添加弹窗当前有"英文键"输入框 + "中文标签"输入框 + "AI 生成提示词"按钮
- 编辑弹窗中英文键为只读（disabled），不可修改

## 提议改动

### 1. 修改 AI 服务：`generateEmotionPrompts` 增加英文键生成

**文件**: `src/main/services/characterTraitAIService.ts`

**改什么**:
- 修改系统提示词（行 2609-2637），要求 LLM 同时输出英文键（新增 `---KEY---` 段，置于首段）
- 修改 `parseEmotionPromptResponse` 解析逻辑（行 2753+），增加 key 字段解析
- 返回结果新增 `emotionKey` 字段

**为什么**: AI 需要根据中文情绪词自动生成符合 `^[a-z][a-z0-9_]*$` 格式的英文键名

**怎么做**:
- 系统提示词新增 `---KEY---` 段规则：输出一个符合 Danbooru tag 命名规则的英文键（小写字母开头，仅含小写字母/数字/下划线，如"热恋" → `passionate_love`）
- 解析器 `parseEmotionPromptResponse` 的 sections 数组首位插入 `---KEY---`，返回值新增 `key: string`
- `generateEmotionPrompts` 返回值新增 `emotionKey?: string`
- 容错兜底：若 AI 未输出 KEY 段或格式不合规，使用 `custom_` + 中文标签 UTF-8 字节的短 hash（如 `custom_a1b2c3`），确保符合 `KEY_PATTERN`

### 2. 修改类型声明

**文件**: `src/renderer/types/electron.d.ts`（行 434-441）

**改什么**: `generateEmotionPrompts` 返回类型新增 `emotionKey?: string`

### 3. 修改添加弹窗 UI — 简化为单输入 + 一键添加

**文件**: `src/renderer/components/Character/CharacterDialogueChat/ExpressionManagerModal.tsx`

**改什么**:
- 移除"英文键"输入框（行 970-980）
- 弹窗仅保留一个"情绪关键词"输入框（中文）
- 移除独立的"AI 生成提示词"按钮（行 992-1000）
- 移除生成结果预览区（行 1003-1048）— 生成后直接保存，无需预览确认
- "添加"按钮点击后自动执行完整流程：调用 AI → 生成 key + prompts → 校验 → 保存 → 关闭弹窗
- 新增 `autoGenerating` 状态控制一键流程的 loading（替代原 `generatingPrompts` + `addCustomLoading`）

**为什么**: 用户仅需输入中文情绪词，其余完全由 AI 自动完成，无需额外输入或确认

**怎么做**:
- `handleAddCustomSubmit`（行 321-367）改造为异步一键流程：
  1. 校验中文标签非空
  2. 设置 `autoGenerating = true`
  3. 调用 `ai.generateEmotionPrompts(label)` → 获取 `emotionKey` + `positive` + `nlPrompt`
  4. 校验返回的 `emotionKey`：格式匹配 `KEY_PATTERN` + 与预置/已有自定义不冲突
     - 若格式不合规或冲突，使用兜底策略：`custom_` + 短 hash
  5. 组装 `prompts = { positive, nlPrompt }`
  6. 调用 `addCustomEmotion(characterCardId, emotionKey, label, prompts)` 保存
  7. 成功后关闭弹窗 + 重置状态
  8. 失败时显示错误提示，用户可重试
- 移除状态：`newCustomKey`、`generatedPositive`、`generatedNlPrompt`、`auditDetails`、`generatingPrompts`、`addCustomLoading`
- 新增状态：`autoGenerating`（一键流程 loading）
- 保留 `newCustomLabel` 作为唯一输入

**新交互流程**:
1. 用户点击"添加自定义情绪" → 弹窗显示一个中文输入框 + "添加"按钮
2. 用户输入中文情绪词（如"热恋"）
3. 点击"添加" → 按钮 loading → AI 生成全部字段 → 自动保存 → 弹窗关闭 + 成功提示
4. 若 AI 失败 → 错误提示 + 用户可重试
5. 用户可在列表中点击"编辑"查看/修改已生成的提示词

### 4. 编辑弹窗 UI — 保持不变

**文件**: `src/renderer/components/Character/CharacterDialogueChat/ExpressionManagerModal.tsx`

**改什么**: 编辑弹窗（行 1052-1120）保持现有逻辑不变（英文键只读、可重新生成提示词、可编辑 SD 提示词）

**为什么**: 编辑时情绪已创建，英文键不可更改，用户可在此检视/修改 AI 生成的内容

## 假设与决策

1. **一键流程（无预览确认）**: 用户输入中文词 → 点击"添加" → AI 生成 + 自动保存 → 完成。无需中间预览步骤，用户可在"编辑"功能中查看/修改生成结果。这最贴合"无需用户额外输入"的要求。
2. **英文键生成兜底策略**: AI 应能可靠生成英文键，但若 AI 未返回或格式不合规/冲突，使用 `custom_` + 中文标签 UTF-8 字节短 hash 作为兜底（如 `custom_a1b2c3`），确保符合 `KEY_PATTERN` 且不冲突。
3. **编辑弹窗不改**: 编辑时仅重新生成提示词，不重新生成英文键（键不可变）。用户可通过编辑功能检视 AI 生成结果。
4. **失败处理**: AI 生成失败时，弹窗保持打开，显示错误提示，用户可重试或取消。不自动使用空 prompts 保存。

## 验证步骤

1. 打开表情管理 → 点击"添加自定义情绪" → 弹窗仅显示一个中文输入框 + "添加"按钮
2. 输入"热恋" → 点击"添加" → 按钮 loading → 成功提示 → 弹窗关闭
3. 检查 manifest 中新增条目：key 为 AI 生成的英文键（如 `passionate_love`），prompts 含 positive + nlPrompt
4. 验证生成的英文键符合 `^[a-z][a-z0-9_]*$` 且不与预置/已有自定义重复
5. 验证 AI 生成失败时显示错误提示，弹窗保持打开，用户可重试
6. 验证编辑弹窗功能不受影响（可查看/修改已生成的提示词）
7. 验证批量生成仍包含新增的自定义情绪
