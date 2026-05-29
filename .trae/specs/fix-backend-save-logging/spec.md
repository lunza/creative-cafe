# Fix Chapter Save - Backend Logging Missing and Data Persistence Verification Spec

## Why
用户报告点击保存当前章节信息后，前端控制台有完整日志输出，但后端控制台没有任何信息。这说明后端 `WritingStorageService.saveProject()` 方法缺少成功日志，且需要验证数据是否真正持久化到磁盘。

## What Changes
- 在 `WritingStorageService.saveProject()` 添加成功日志输出
- 在 `writing:saveProject` IPC handler 添加日志输出
- 验证数据持久化流程完整性

## Impact
- Affected specs: 章节数据持久化、大纲编辑功能
- Affected code: 
  - src/main/services/WritingStorageService.ts
  - src/main/ipc/handlers/writingHandlers.ts

## ADDED Requirements
### Requirement: 后端保存成功日志
`WritingStorageService.saveProject()` SHALL 在保存成功后输出日志，包含项目 ID 和保存状态。

#### Scenario: 项目保存成功
- **WHEN** `saveProject()` 成功保存项目到磁盘
- **THEN** 后端控制台输出 `[WritingStorage] Project saved successfully: <projectId>`

### Requirement: IPC Handler 日志
`writing:saveProject` IPC handler SHALL 记录接收到请求和保存结果的日志。

#### Scenario: IPC 请求处理
- **WHEN** 渲染进程调用 `writing:saveProject`
- **THEN** 后端控制台输出接收请求和保存结果的日志

## MODIFIED Requirements
### Requirement: WritingStorageService.saveProject 日志输出
现有的 `saveProject` 方法仅在失败时输出日志，需要添加成功日志。

### Requirement: writingHandlers.ts writing:saveProject 日志输出
现有的 handler 缺少日志输出，需要添加请求接收和结果日志。

## REMOVED Requirements
### Requirement: None
没有需求被移除。
