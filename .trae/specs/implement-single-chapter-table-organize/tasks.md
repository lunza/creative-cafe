# Tasks
- [ ] Task 1: 修改 WritingTablePreviewModal 组件接口，接收当前章节信息
  - [ ] SubTask 1.1: 修改组件 props，添加 chapterId、chapterTitle、chapterContent 参数
  - [ ] SubTask 1.2: 在组件内部存储当前章节信息
  - [ ] SubTask 1.3: 修改 WritingTablePreviewModal 类型定义（electron.d.ts）

- [ ] Task 2: 修改 ContentWorkspace 中的表格整理按钮，传递当前章节信息
  - [ ] SubTask 2.1: 获取当前选中章节的 index、title、content
  - [ ] SubTask 2.2: 将章节信息通过 props 传递给 WritingTablePreviewModal

- [ ] Task 3: 修改 WritingTablePreviewModal 的 handleStartOrganize 函数
  - [ ] SubTask 3.1: 修改 IPC 调用，传递当前章节信息而非遍历所有项目章节
  - [ ] SubTask 3.2: 添加整理过程中的章节锁定逻辑

- [ ] Task 4: 修改 WritingStorageService.organizeTable 后端方法
  - [ ] SubTask 4.1: 增加 chapterIndex 可选参数
  - [ ] SubTask 4.2: 当 chapterIndex 有值时，仅处理指定章节
  - [ ] SubTask 4.3: 当 chapterIndex 为 undefined 时，保留原有遍历所有章节的行为

- [ ] Task 5: 添加章节锁定机制
  - [ ] SubTask 5.1: 在 WritingTablePreviewModal 中添加 isOrganizing 状态传递给 ContentWorkspace
  - [ ] SubTask 5.2: 在 ContentWorkspace 中根据 isOrganizing 禁用章节切换

- [ ] Task 6: 构建验证
  - [ ] SubTask 6.1: 运行 build 确保无编译错误
  - [ ] SubTask 6.2: 手动验证单章节整理功能正常

# Task Dependencies
- Task 1 has no dependencies
- Task 2 depends on Task 1
- Task 3 depends on Task 1 and Task 2
- Task 4 depends on Task 3
- Task 5 depends on Task 3 and Task 4
- Task 6 depends on all previous tasks
