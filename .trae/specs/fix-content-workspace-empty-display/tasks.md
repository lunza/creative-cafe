# Tasks
- [x] Task 1: 修复 writingProjectStore.loadProjects 确保项目数据正确更新
  - [x] Step 1.1: 检查 loadProjects action 中 set() 调用是否创建新引用
  - [x] Step 1.2: 确保 loadProjects 后当前项目引用更新
- [x] Task 2: 修复 WritingModeEntry 中 currentProject 的订阅方式
  - [x] Step 2.1: 将 `getCurrentProject()` 改为直接订阅 store 数据
  - [x] Step 2.2: 确保 outline 数据更新后 ContentWorkspace 能正确接收
- [x] Task 3: 编译验证和测试

# Task Dependencies
- [Task 2] depends on [Task 1]
- [Task 3] depends on [Task 1, Task 2]
