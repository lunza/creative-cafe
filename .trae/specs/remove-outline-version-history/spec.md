# Remove Outline Version History Spec

## Why
章节大纲的版本历史功能当前未被使用且增加了系统复杂度。用户明确要求仅读取并展示章节大纲的唯一最新数据，移除所有历史版本相关的存储、显示和管理功能。

## What Changes
- 移除 `writingProjectStore` 中的 `outlineHistory`、`undoOutline`、`redoOutline`、`canUndo`、`canRedo` 相关代码
- 移除 `ManualOutlineEditor` 中的撤销/重做按钮和相关处理逻辑
- 移除 `OutlineEditPanel` 中的"版本历史"按钮和 `VersionHistoryPanel` 组件引用
- 删除 `VersionHistoryPanel.tsx` 文件
- 清理 `writingHandlers.ts` 中 `outlineHistory` 相关代码
- 清理 `writing.types.ts` 中的 `outlineHistory` 类型定义

## Impact
- Affected specs: 大纲编辑功能、章节大纲持久化
- Affected code:
  - src/renderer/stores/writingProjectStore.ts
  - src/renderer/components/Creative/WritingMode/ManualOutlineEditor.tsx
  - src/renderer/components/Creative/WritingMode/OutlineEditPanel.tsx
  - src/renderer/components/Creative/WritingMode/VersionHistoryPanel.tsx (删除)
  - src/main/ipc/handlers/writingHandlers.ts
  - src/shared/types/writing.types.ts

## REMOVED Requirements
### Requirement: 大纲版本历史管理
**Reason**: 用户明确要求仅保留最新数据，不需要历史版本功能
**Migration**: 无需迁移，历史版本数据在下次保存时自动清理
