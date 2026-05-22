# Fix Chapter Merge Logic Spec

## Why
章节合并功能存在严重的逻辑错误：合并后只有单个章节可见，其他章节全部消失。经分析发现 `handleMergeConfirm` 函数中的 `remainingChapters.filter()` 条件存在逻辑错误，导致所有非合并章节都被过滤掉。

## What Changes
- 修复 `ContentWorkspace.tsx` 中 `handleMergeConfirm` 的章节过滤逻辑
- 在 `ChapterMergeModal.tsx` 中添加连续章节选择验证
- 修正合并后 `project.chapters` 的更新逻辑

## Impact
- Affected specs: `manual-outline-editing`, `writing-mode-ui-redesign`
- Affected code: `ContentWorkspace.tsx`, `ChapterMergeModal.tsx`

## MODIFIED Requirements

### Requirement: Chapter Merge Logic
The system SHALL correctly merge consecutive chapters without affecting other chapters.

#### Scenario: Merge chapters 3,4,5
- **WHEN** user selects chapters 3, 4, 5 for merging
- **THEN** the result should be chapters 1, 2, [merged], 6, 7...
- **AND** chapters 6, 7 and all subsequent chapters remain unchanged

#### Scenario: Non-consecutive chapter selection
- **WHEN** user attempts to select non-consecutive chapters (e.g., 3, 5, 6)
- **THEN** the system SHALL show a warning and prevent the merge operation
- **AND** only consecutive chapters can be selected for merging

### Requirement: Chapter Index After Merge
After merging chapters, the merged chapter SHALL take the first chapter's index position.
All other chapters SHALL remain at their original positions (no index renumbering).

**Example**: Merging chapters at indices 3, 4, 5 (array positions)
- Before: [ch1, ch2, ch3, ch4, ch5, ch6, ch7]
- After: [ch1, ch2, mergedChapter, ch6, ch7]
- Array position 2 now contains the merged chapter
- Array positions 3+ contain the remaining chapters

## Migration
No data migration needed. This is a logic fix only.
