# Tasks

- [x] Task 1: 删除分片检查前端组件
  - [x] SubTask 1.1: 删除 ChunkedCheckPanel.tsx 文件
  - [x] SubTask 1.2: 从 ContentWorkspace.tsx 中移除 ChunkedCheckPanel import
  - [x] SubTask 1.3: 从 ContentWorkspace.tsx 中移除 showChunkedCheckModal state
  - [x] SubTask 1.4: 从 ContentWorkspace.tsx 中移除 chunkedCheckResources 等配置变量
  - [x] SubTask 1.5: 从 ContentWorkspace.tsx 中删除"分片检查"按钮
  - [x] SubTask 1.6: 从 ContentWorkspace.tsx 中删除 ChunkedCheckPanel JSX 渲染

- [x] Task 2: 删除分片检查后端服务
  - [x] SubTask 2.1: 删除 ChunkedCheckService.ts 文件
  - [x] SubTask 2.2: 从 writingHandlers.ts 中移除 chunkedCheckService import
  - [x] SubTask 2.3: 从 writingHandlers.ts 中移除 6 个分片检查 IPC handler
  - [x] SubTask 2.4: 从 preload.ts 中移除 6 个分片检查 IPC API 暴露

- [x] Task 3: 扩展 WritingStorageService 整理功能
  - [x] SubTask 3.1: 添加 organizeTable 方法，调用 AI 对章节内容进行表格数据提取
  - [x] SubTask 3.2: 添加整理进度查询方法

- [x] Task 4: 添加表格整理 IPC handler 和 API 类型
  - [x] SubTask 4.1: 在 writingHandlers.ts 中添加 organizeTable IPC handler
  - [x] SubTask 4.2: 在 electron.d.ts 中添加 organizeTable API 类型
  - [x] SubTask 4.3: 在 preload.ts 中暴露 organizeTable API

- [x] Task 5: 在 WritingTablePreviewModal 中添加"模板绑定"按钮
  - [x] SubTask 5.1: 在底部操作栏添加"模板绑定"按钮
  - [x] SubTask 5.2: 点击按钮弹出模板选择对话框
  - [x] SubTask 5.3: 选择模板后调用 associateTableTemplate 创建表格结构
  - [x] SubTask 5.4: 绑定成功后刷新表格数据

- [x] Task 6: 在 WritingTablePreviewModal 中添加"开始整理"按钮
  - [x] SubTask 6.1: 在底部操作栏添加"开始整理"按钮
  - [x] SubTask 6.2: 点击按钮调用 organizeTable API
  - [x] SubTask 6.3: 显示整理进度（使用 Modal 进度条）
  - [x] SubTask 6.4: 整理完成后刷新表格数据并提示

- [x] Task 7: 构建验证
  - [x] SubTask 7.1: 运行 build 确保无编译错误
  - [x] SubTask 7.2: 验证分片检查功能已完全移除
  - [x] SubTask 7.3: 验证模板绑定和开始整理功能正常

# Task Dependencies

- Task 2 depends on Task 1
- Task 3 is independent
- Task 4 depends on Task 3
- Task 5 depends on Task 4
- Task 6 depends on Task 4 and Task 5
- Task 7 depends on Task 1, Task 2, Task 5, and Task 6