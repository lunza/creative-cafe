# 表格分片整理实时刷新优化 Spec

## Why
当前表格分片整理功能中，虽然每个分片处理完成后数据已保存到文件，但前端使用了 500ms 的节流机制来限制表格数据刷新频率，导致用户需要等待多个分片处理完成后才能看到累积的更新结果。用户期望每个分片处理完成后能立即看到表格内容的实时更新。

## What Changes
- 将 `WritingTablePreviewModal.tsx` 中的表格数据加载节流时间从 500ms 降至 50ms
- 确保每个分片处理完成后，前端进度监听器能快速触发 `loadTableData()` 刷新表格显示
- 保持节流机制避免过于频繁的 DOM 更新

## Impact
- 受影响的文件：
  - `src/renderer/components/Creative/WritingMode/WritingTablePreviewModal.tsx`
- 后端数据持久化逻辑不变（已在 `executeTableEditCommands` 中每批分片处理后自动保存）

## MODIFIED Requirements
### Requirement: 表格分片整理进度显示
用户在进行表格分片整理时，系统应实时更新进度条和表格内容展示，确保每个分片处理完成后用户能立即看到最新的整理结果。

#### Scenario: 分片处理完成实时刷新
- **WHEN** 后端完成一个分片的 AI 处理并将结果录入表格文件后
- **THEN** 前端进度监听器应在极短时间内（≤50ms）触发表格数据重新加载
- **THEN** 用户能在表格中立即看到新增/更新的行数据
