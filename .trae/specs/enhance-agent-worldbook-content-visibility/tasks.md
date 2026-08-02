# Tasks

- [x] Task 1: 扩展 AuthoringProgressEvent 类型，新增 generatedEntries 和 auditDetail 字段
  - [x] SubTask 1.1: 在 `src/shared/types/worldbook-authoring.types.ts` 的 `AuthoringProgressEvent` 接口中新增 `generatedEntries?: Array<{ name: string; content: string }>` 字段
  - [x] SubTask 1.2: 在 `AuthoringProgressEvent` 接口中新增 `auditDetail?` 联合类型字段（mini 和 full 两种）
  - [x] SubTask 1.3: 验证 `npx tsc --noEmit` 0 新增错误

- [x] Task 2: 后端在关键节点填充 generatedEntries 和 auditDetail
  - [x] SubTask 2.1: 在 `worldbookAuthoringService.ts` 条目生成完成后的 `emitProgress` 调用中填充 `generatedEntries` 字段
  - [x] SubTask 2.2: 在微型审计完成后的 `emitProgress` 调用中填充 `auditDetail` 字段（type='mini'）
  - [x] SubTask 2.3: 在完整审计完成后的 `emitProgress` 调用中填充 `auditDetail` 字段（type='full'）
  - [x] SubTask 2.4: 验证 `npx tsc --noEmit` 0 新增错误

- [x] Task 3: 前端 buildAuthoringProgressPanel 展示实际内容和审计结果
  - [x] SubTask 3.1: 在 `useAgentDialogue.ts` 的 `buildAuthoringProgressPanel` 函数中新增"📝 最近生成条目"区块
  - [x] SubTask 3.2: 新增"🔍 审计结果"区块，根据 `type` 分别展示微型审计或完整审计的结果详情
  - [x] SubTask 3.3: 微型审计展示维度名、完整性问题数、一致性问题数、关键问题列表
  - [x] SubTask 3.4: 完整审计展示通过/未通过标签、综合分数、三维度摘要、自动修复数、需用户决策项列表
  - [x] SubTask 3.5: 将思考步骤的 inputSummary/outputSummary 展示长度从 120 字符提升到 300 字符
  - [x] SubTask 3.6: 验证 `GetDiagnostics` 0 新增错误

- [x] Task 4: 添加 Loading 状态指示器
  - [x] SubTask 4.1: 在 `useAgentDialogue.ts` 新增 `worldbookWriting` 状态，在 `handleWriteWorldbook` 开始时设为 true，finally 中设为 false，返回给 UI
  - [x] SubTask 4.2: 在 `AgentDialogueModal.tsx` 中解构 `worldbookWriting`，进度面板消息渲染时显示 LoadingOutlined 旋转图标（编写中）或状态图标（完成时 ✅/❌/🚫）
  - [x] SubTask 4.3: 验证 `GetDiagnostics` 0 新增错误

# Task Dependencies
- [Task 2] depends on [Task 1]（需要类型定义）
- [Task 3] depends on [Task 1]（需要类型定义）
- [Task 4] depends on [Task 3]（需要确认进度面板消息结构）
