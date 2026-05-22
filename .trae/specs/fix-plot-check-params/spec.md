# 剧情检查参数传输修复 Spec

## Why
剧情检查功能在调用 `writing:checkChapter` IPC handler 时，Handler 端从 `project.config?.modelConfig` 构建模型配置，但 `modelConfig` 可能为 `undefined` 或包含不完整字段，导致发送给 AI 引擎的请求缺少正确的参数（模型名称、temperature、maxTokens 等）。

## What Changes
- 修改 `writingHandlers.ts` 中 `writing:checkChapter` handler，使用与 `PlotCheckerService` 相同的逻辑从 active engine settings 读取 AI 参数
- 确保 `modelConfig` 始终包含完整的 model、temperature、maxTokens 字段
- 添加参数验证和错误日志

## Impact
- Affected specs: add-logic-validation
- Affected code:
  - `src/main/ipc/handlers/writingHandlers.ts`（修改）
  - `src/main/services/writing/PlotCheckerService.ts`（无需修改，已有正确的 getConfig 逻辑）

## ADDED Requirements

### Requirement: 参数验证
Handler 在构建 `modelConfig` 时，必须确保所有必需字段存在且有合法值。

#### Scenario: 参数缺失时回退到活跃引擎配置
- **WHEN** project.config.modelConfig 不存在或不完整
- **THEN** handler 从 storageService 读取活跃引擎配置作为默认值

## MODIFIED Requirements

### Requirement: writing:checkChapter handler
Handler 在构建 `modelConfig` 时，不再依赖 `project.config?.modelConfig`，而是直接从 active AI engine settings 中读取，与 `PlotCheckerService.getConfig()` 的逻辑保持一致。
