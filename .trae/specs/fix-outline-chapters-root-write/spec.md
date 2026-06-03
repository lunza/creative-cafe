# 彻底移除根级别 project.chapters 写入 Spec

## Why
前期针对 `project.chapters` 到 `project.outline.chapters` 的迁移重构未能彻底清除所有写入路径。用户验证发现新生成的 `project.json` 中仍然同时存在根级别的 `chapters` 字段和 `outline.chapters` 字段。根本原因是在多个 UI 组件和 Hooks 调用 `updateProject` 时，错误地传递了形如 `{ chapters: [...], outline: { ... } }` 的参数，由于 Zustand store 的浅合并机制（`{ ...p, ...updates }`），导致 `chapters` 被错误地写入项目数据的根级别，违背了单一数据源的设计原则。

## What Changes
- **根除残留写入**：全面搜索并移除所有 `updateProject` 调用及 IPC 处理器中在根级别赋值 `chapters` 的代码。
- **统一数据路径**：确保所有涉及章节列表增删改查的操作，仅通过更新 `project.outline` 对象进行，章节数据始终位于 `project.outline.chapters`。
- **清理冗余字段**：移除 `WritingProject` 接口定义中可能误导开发的 `chapters` 字段（如果仍存在）。
- **修复模块覆盖**：
  - 生成大纲功能（`writing:saveOutline` 处理器）
  - 内容创作模块（`useChapterGeneration.ts` 中的生成、保存、清空、重新生成）
  - 章节结构模块（`useChapterStructure.ts` 中的拆分、合并）
  - 大纲设计模块（`OutlineEditPanel.tsx`、`usePlotCheck.ts` 等）

## Impact
- **受影响规格**：写作模式全流程（大纲生成、内容创作、结构编辑、大纲设计、数据持久化）。
- **受影响代码**：
  - `src/renderer/stores/writingProjectStore.ts` - 状态更新逻辑验证
  - `src/renderer/components/Creative/WritingMode/hooks/useChapterGeneration.ts`
  - `src/renderer/components/Creative/WritingMode/hooks/useChapterStructure.ts`
  - `src/renderer/components/Creative/WritingMode/OutlineEditor.tsx`
  - `src/renderer/components/Creative/WritingMode/OutlineEditPanel.tsx`
  - `src/renderer/components/Creative/WritingMode/hooks/usePlotCheck.ts`
  - `src/main/ipc/handlers/writingHandlers.ts`

## ADDED Requirements
### Requirement: 严格单一数据源写入
系统在任何情况下都不得向 `WritingProject` 对象的根级别写入 `chapters` 字段。

#### Scenario: 任意功能触发项目更新
- **WHEN** 任何功能（生成、编辑、拆分、合并、保存）调用 `updateProject` 时
- **THEN** 传入的 `updates` 对象中不得包含根级别 `chapters` 属性，章节数据变更必须包含在 `outline` 属性中（如 `{ outline: { ...oldOutline, chapters: newChapters } }`）。

## MODIFIED Requirements
### Requirement: 状态更新逻辑
**原要求**：允许通过传递 `chapters` 或 `outline` 任意字段来更新章节数据。
**修改为**：仅允许通过更新 `outline` 字段来变更章节数据，禁止直接更新根级别 `chapters`。

## REMOVED Requirements
### Requirement: 根级别 chapters 字段的维护
**原因**：该设计导致数据不一致，且已通过 `outline.chapters` 完全替代。
**迁移方案**：代码层面彻底停止写入，历史数据由用户清理（如用户所述：删除历史数据重新创建）。
