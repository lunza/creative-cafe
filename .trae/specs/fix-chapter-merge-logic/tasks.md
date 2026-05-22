# Tasks
- [x] Task 1: Fix `handleMergeConfirm` logic in ContentWorkspace.tsx
  - [x] SubTask 1.1: Fix the broken `remainingChapters.filter()` logic that removes all non-merged chapters
  - [x] SubTask 1.2: Fix `project.chapters` update to correctly replace merged chapters with the single merged chapter
  - [x] SubTask 1.3: Ensure `selectedChapterIndex` is updated correctly after merge
- [x] Task 2: Add consecutive chapter validation in ChapterMergeModal.tsx
  - [x] SubTask 2.1: Add validation to only allow selecting consecutive chapters
  - [x] SubTask 2.2: Show warning message when user selects non-consecutive chapters
- [x] Task 3: Verify build compiles successfully

# Task Dependencies
- Task 2 depends on Task 1 (optional, can be done in parallel)
- Task 3 depends on Task 1 and Task 2
