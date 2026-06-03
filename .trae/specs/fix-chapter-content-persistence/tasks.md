# Tasks
- [x] Task 1: 分析 loadAllProjects 数据加载流程
  - [x] Step 1.1: 检查 WritingStorageService.loadAllProjects 方法是否加载完整章节内容
  - [x] Step 1.2: 确认 loadProjects IPC handler 返回的数据是否包含章节内容
- [x] Task 2: 分析 writingProjectStore.loadProjects 数据流
  - [x] Step 2.1: 检查 store 接收的数据结构
  - [x] Step 2.2: 确认项目数据是否正确存储到 store
- [x] Task 3: 检查 useChapterGeneration 初始化逻辑
  - [x] Step 3.1: 验证 useEffect 中从 outline.chapters 恢复章节内容的逻辑
  - [x] Step 3.2: 确认 ch.content 字段是否正确加载
- [x] Task 4: 检查 WritingStorageService.loadProject 实现
  - [x] Step 4.1: 验证 chapter-*.md 文件内容是否正确加载到 outline.chapters
  - [x] Step 4.2: 确认 project.json 中的 chapters 数据是否被正确读取
- [x] Task 5: 实施必要的修复
  - [x] Step 5.1: 修复数据加载流程中缺失的环节
  - [x] Step 5.2: 确保三个场景（关闭对话框、重启应用、刷新窗口）内容都能正确恢复
- [x] Task 6: 编译验证和测试

# Task Dependencies
- [Task 2] depends on [Task 1]
- [Task 3] depends on [Task 2]
- [Task 4] depends on [Task 1]
- [Task 5] depends on [Task 3, Task 4]
- [Task 6] depends on [Task 5]
