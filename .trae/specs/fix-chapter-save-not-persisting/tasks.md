# Tasks
- [x] Task 1: 修复 ManualOutlineEditor 中所有章节操作的 chaptersRef 同步问题
  - [x] SubTask 1.1: 修改 addChapter 在调用 onChange 前更新 chaptersRef
  - [x] SubTask 1.2: 修改 addSubChapter 在调用 onChange 前更新 chaptersRef
  - [x] SubTask 1.3: 修改 deleteChapter 在调用 onChange 前更新 chaptersRef
  - [x] SubTask 1.4: 修改 moveChapter 在调用 onChange 前更新 chaptersRef
  - [x] SubTask 1.5: 修改 mergeChapters 在调用 onChange 前更新 chaptersRef
  - [x] SubTask 1.6: 修改 splitChapter 在调用 onChange 前更新 chaptersRef
- [x] Task 2: 验证数据持久化流程
  - [x] SubTask 2.1: 确保 updateOutline 正确更新 store 并触发 auto-save
  - [x] SubTask 2.2: 验证保存后 project.json 文件中章节数据已更新

# Task Dependencies
- [Task 2] depends on [Task 1]
