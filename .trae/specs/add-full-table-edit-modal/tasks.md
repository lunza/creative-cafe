# Tasks
- [x] Task 1: 在 TableOrganizePanelContent 中新增"查看全部数据"按钮
  - [x] SubTask 1.1: 在操作按钮区域添加"查看全部数据"按钮，当有表格数据时可用，无数据时禁用
  - [x] SubTask 1.2: 添加 `fullTableModalVisible` 状态控制模态框显示

- [x] Task 2: 实现 FullTableModal 模态框组件（内嵌在 TableOrganizePanelContent 中）
  - [x] SubTask 2.1: 创建模态框基础结构，使用 Ant Design Modal，宽度90vw
  - [x] SubTask 2.2: 在模态框顶部添加 sheet 切换 Tabs
  - [x] SubTask 2.3: 使用 Ant Design Table 展示完整数据，支持分页（每页10/20/50/100行）
  - [x] SubTask 2.4: 实现搜索框功能，在所有列中搜索匹配文字
  - [x] SubTask 2.5: 实现单元格双击编辑功能，编辑后同步到存储
  - [x] SubTask 2.6: 实现"新增行"功能
  - [x] SubTask 2.7: 实现"删除行"功能（带确认对话框）
  - [x] SubTask 2.8: 实现"保存全部"功能
  - [x] SubTask 2.9: 复用已有的 handleExport 导出 CSV 功能
  - [x] SubTask 2.10: 实现"同步到存储"功能

- [x] Task 3: 确保模态框内数据修改后同步到面板主区域状态
  - [x] SubTask 3.1: 模态框内的编辑/新增/删除操作同时更新 `allSheetData`、`tableData` 状态
  - [x] SubTask 3.2: 模态框关闭时，面板主区域重新加载表格数据

# Task Dependencies
- [Task 2] 依赖 [Task 1]
- [Task 3] 依赖 [Task 2]
- Task 2 的各 SubTask 可按需顺序执行
