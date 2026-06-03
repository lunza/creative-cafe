# Checklist

- [x] useChapterStructure.ts 中 handleSplitConfirm 的 updateProject 调用不再传递根级别 chapters 字段
- [x] useChapterStructure.ts 中 handleMergeConfirm 的 updateProject 调用不再传递根级别 chapters 字段
- [x] useChapterGeneration.ts 中所有 updateProject 调用(4处)不再传递根级别 chapters 字段
- [x] usePlotCheck.ts 中所有 updateProject 调用(5处)不再传递根级别 chapters 字段
- [x] OutlineEditor.tsx 中 handleConfirmOutline 的 updateProject 调用不再传递根级别 chapters 字段
- [x] 全局搜索 updateProject 确认无其他在根级别传递 chapters 的调用
- [x] TypeScript 编译无新增错误（所有错误为重构前已存在）
