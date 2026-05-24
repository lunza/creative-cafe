# Tasks

- [ ] Task 1: 回滚 refactor-chunked-check-to-table 中的错误修改
  - [ ] SubTask 1.1: ContentWorkspace 中按钮名称从"表格整理"改回"分片检查"
  - [ ] SubTask 1.2: ChunkedCheckPanel Modal 标题从"表格整理"改回"分片检查"
  - [ ] SubTask 1.3: ChunkedCheckPanel Modal 宽度从 1200px 改回 900px
  - [ ] SubTask 1.4: ChunkedCheckPanel 中 Table 恢复为 Collapse 手风琴组件
  - [ ] SubTask 1.5: 移除新增的表格相关 imports 和类型定义
  - [ ] SubTask 1.6: 验证回滚后构建成功

- [ ] Task 2: 定义写作模式表格数据类型和 IPC 接口
  - [ ] SubTask 2.1: 在 writing.types.ts 中添加表格相关类型定义
  - [ ] SubTask 2.2: 在 writing.ipc.ts 中添加表格数据 IPC 通道
  - [ ] SubTask 2.3: 在 WritingStorageService.ts 中添加表格数据存储方法

- [ ] Task 3: 实现写作模式表格数据存储服务
  - [ ] SubTask 3.1: 创建 WritingTableStorageService，按项目 ID 管理表格数据
  - [ ] SubTask 3.2: 实现 getTableData/saveTableData/clearTableData 等方法
  - [ ] SubTask 3.3: 实现表格模板关联功能

- [ ] Task 4: 实现写作模式 IPC handler
  - [ ] SubTask 4.1: 在 writingHandlers.ts 中实现表格数据相关 handler
  - [ ] SubTask 4.2: 实现关联模板、获取模板列表等 handler

- [ ] Task 5: 创建写作模式记忆表格配置面板
  - [ ] SubTask 5.1: 创建 WritingMemoryTablePanel 组件（类似 MemoryTablePanel）
  - [ ] SubTask 5.2: 集成到写作模式侧边栏或配置面板中
  - [ ] SubTask 5.3: 实现启用/禁用、整理模式选择、模板关联功能

- [ ] Task 6: 创建写作模式表格预览弹窗
  - [ ] SubTask 6.1: 创建 WritingTablePreviewModal 组件（复用 TablePreviewModal 逻辑）
  - [ ] SubTask 6.2: 修改 ContentWorkspace 中"表格整理"按钮，点击打开 WritingTablePreviewModal
  - [ ] SubTask 6.3: 实现表格数据加载、编辑、导出、清空功能

- [ ] Task 7: 构建验证
  - [ ] SubTask 7.1: 运行 build 确保无编译错误
  - [ ] SubTask 7.2: 手动验证回滚后分片检查功能正常
  - [ ] SubTask 7.3: 手动验证表格整理功能正常

# Task Dependencies

- Task 2 depends on Task 1
- Task 3 depends on Task 2
- Task 4 depends on Task 2 and Task 3
- Task 5 depends on Task 2 and Task 4
- Task 6 depends on Task 5
- Task 7 depends on Task 1, Task 5, and Task 6
