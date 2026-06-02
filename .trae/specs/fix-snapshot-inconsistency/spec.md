# 修复写作模式数据快照不一致问题 Spec

## Why
写作模式中存在多个数据快照（stale snapshot）导致的数据不一致问题。用户在编辑器中修改的内容未能正确同步到各个操作函数中，导致自动修正、批量修正、章节拆分、章节合并等操作基于过时的内容执行，造成数据丢失或功能异常。

## What Changes
- 修复 `ContentWorkspace` 中所有空函数替代 `setChapterContents` 的调用（共4处）
- 修复 `ContentWorkspace` 中 `handleAutoFix` 调用未传递正确 `setChapterContents` 的问题
- 确保所有需要更新章节内容的操作都使用正确的 setter

## Impact
- Affected specs: 写作模式、章节内容管理、快速修复、自动修正、批量修正
- Affected code:
  - `src/renderer/components/Creative/WritingMode/ContentWorkspace.tsx`
  - `src/renderer/components/Creative/WritingMode/hooks/useChapterGeneration.ts`

## ADDED Requirements
### Requirement: 使用最新编辑器内容
系统 SHALL 在所有内容修改操作（自动修正、批量修正、快速修复）中使用编辑器当前的最新内容，而非使用操作触发时捕获的内容快照。

#### Scenario: 编辑器内容同步
- **WHEN** 用户在编辑器中修改了内容后触发任何修正操作
- **THEN** 操作应基于用户修改后的最新内容执行

### Requirement: setChapterContents 正确传递
系统 SHALL 在所有需要更新章节内容的操作中传递正确的 `setChapterContents` setter，确保章节内容更新能够正确持久化到 store 和项目文件中。

#### Scenario: 修正内容持久化
- **WHEN** 用户接受自动修正、批量修正或快速修正
- **THEN** 修正后的内容应被正确保存到项目存储中
