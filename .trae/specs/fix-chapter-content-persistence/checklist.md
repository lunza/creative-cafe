# 验证清单

- [x] 章节内容在 project.json 中正确保存
- [x] WritingStorageService.loadProject 从磁盘加载章节内容到 outline.chapters
- [x] loadProjects 加载所有项目并更新 store
- [x] WritingModeEntry 正确订阅 store 数据变化
- [x] currentProject 从 subscribed projects 派生，确保数据更新后能重新计算
- [x] ContentWorkspace 接收包含章节内容的 outline
- [x] MarkdownEditor 正确显示章节内容
- [x] 编译通过无错误
- [x] 关闭写作模式对话框后章节内容正确加载
- [x] 应用重启后章节内容正确加载
- [x] 窗口刷新后章节内容正确加载
