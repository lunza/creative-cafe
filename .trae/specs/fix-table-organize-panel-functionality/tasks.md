# 修复辅助面板表格整理功能 任务列表

## Tasks
- [x] Task 1: 扩展TableOrganizePanelContent组件，迁移WritingTablePreviewModal的核心功能
  - [x] 添加模板绑定功能（关联模板按钮、模板选择对话框、绑定逻辑）
  - [x] 添加开始整理功能（检查模板绑定、调用organizeTable API、进度显示）
  - [x] 添加保存修改功能
  - [x] 添加导出CSV功能
  - [x] 添加清空当前表格和清空所有表格功能
  - [x] 添加同步到存储功能
  - [x] 添加整理进度条显示
- [x] Task 2: 更新WritingModeRightPanelProps接口，传递必要的数据和回调
  - [x] 添加chapterContent prop
  - [x] 添加onTableOrganizeStatusChange回调
- [x] Task 3: 更新ContentWorkspace传递必要的props到WritingModeRightPanel
  - [x] 传递chapterContent
  - [x] 处理onTableOrganizeStatusChange回调（锁定章节切换）
- [x] Task 4: 验证所有表格整理功能正常工作
  - [x] 验证模板绑定功能
  - [x] 验证开始整理功能及进度显示
  - [x] 验证保存、导出、清空功能
  - [x] 验证表格编辑和同步功能
