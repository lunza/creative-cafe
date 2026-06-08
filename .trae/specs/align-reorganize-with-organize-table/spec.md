# 重新整理功能对齐现有表格整理逻辑 Spec

## Why

当前 `reorganizeRow` 的实现与 `organizeTable` 在多个关键方面不一致：
1. 使用 `this.getActiveEngine()` 获取引擎配置，而非从前端传入 `modelConfig`
2. 提示词仅包含行数据，缺少章节内容上下文
3. 未携带 `organizeTable` 中使用的完整参数链（modelConfig → apiEndpoint → callAIAPI）

需要重新整理功能与现有表格整理功能保持完全一致，唯一差异是仅更新单条数据。

## What Changes

- `reorganizeRow` 方法签名增加 `modelConfig: ModelConfig` 参数（与 organizeTable 一致）
- IPC handler 从前端接收 `modelConfig` 并传递
- 前端调用时从引擎配置获取 `modelConfig`
- 提示词构建改为包含章节内容上下文（与 organizeTable 一致）
- 使用 `this.callAIAPI(prompt, modelConfig, apiEndpoint)` 而非直接从 engine 获取配置
- 移除 `getActiveEngine` 和自建 `modelConfig` 的逻辑

## Impact

- 受影响的文件：
  - `WritingStorageService.ts` — `reorganizeRow` 方法签名和内部逻辑
  - `writingHandlers.ts` — IPC handler 增加 modelConfig 参数
  - `preload.ts` — `reorganizeRow` 接口增加 modelConfig 参数
  - `WritingModeRightPanel.tsx` — 前端调用增加 modelConfig

## MODIFIED Requirements

### Requirement: reorganizeRow 方法签名
原方法签名：`reorganizeRow(projectId, sheet, rowIndex, rowData, requirements)`
修改为：`reorganizeRow(projectId, sheet, rowIndex, rowData, requirements, modelConfig, chapterIndex?)`

与 `organizeTable(projectId, modelConfig, chapterIndex?, onProgress?, requirements)` 保持参数风格一致。

### Requirement: 提示词构建
原提示词仅包含行数据和模板结构。修改为包含：
- 项目大纲上下文（项目名称、风格、主题等）
- 当前章节内容（作为整理参考上下文）
- 表格模板结构
- 当前行数据
- 用户整理要求

与 `buildWritingTableOrganizePrompt` 的结构保持一致。

### Requirement: AI 调用方式
原使用 `getActiveEngine()` 自建 modelConfig。修改为使用前端传入的 `modelConfig`，通过 `buildApiEndpoint(modelConfig)` 构建端点，调用 `callAIAPI(prompt, modelConfig, apiEndpoint)`，与 `processChapterWithAI` 完全一致。

## REMOVED Requirements

无。
