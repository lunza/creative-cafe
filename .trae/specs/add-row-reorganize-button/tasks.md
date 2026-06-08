# Tasks
- [ ] Task 1: 前端 - 添加重新整理状态管理
  - [ ] SubTask 1.1: 添加 `reorganizingRowKey` 状态（记录当前正在整理的行 key，null 表示无）
  - [ ] SubTask 1.2: 添加 `reorganizeModalVisible` 和 `reorganizeDescription` 状态（用于输入框弹窗）

- [ ] Task 2: 前端 - 在操作栏添加"重新整理"按钮
  - [ ] SubTask 2.1: 在 fullTableColumns 操作列中，在删除按钮前添加"重新整理"按钮（SyncOutlined 图标）
  - [ ] SubTask 2.2: 点击按钮时打开重新整理输入框弹窗，显示行号

- [ ] Task 3: 前端 - 实现重新整理输入框弹窗
  - [ ] SubTask 3.1: 创建 Modal 对话框，包含 TextArea 输入整理要求
  - [ ] SubTask 3.2: "确定"按钮验证非空输入，调用 `writing:table:reorganizeRow` IPC
  - [ ] SubTask 3.3: 整理过程中按钮显示加载状态
  - [ ] SubTask 3.4: 整理成功后更新该行数据并关闭弹窗，显示成功提示
  - [ ] SubTask 3.5: 整理失败显示错误提示，数据不变

- [ ] Task 4: IPC - 新增 `writing:table:reorganizeRow` 接口
  - [ ] SubTask 4.1: 在 `preload.ts` 中添加 `reorganizeRow` 接口定义
  - [ ] SubTask 4.2: 在 `writingHandlers.ts` 中添加 `writing:table:reorganizeRow` handler

- [ ] Task 5: 后端 - 实现单行重新整理逻辑
  - [ ] SubTask 5.1: 在 `WritingStorageService.ts` 中添加 `reorganizeRow` 方法
  - [ ] SubTask 5.2: 构建提示词，包含模板结构、当前行数据、用户整理要求
  - [ ] SubTask 5.3: 调用 AI 生成新的行数据，保持唯一 ID 不变
  - [ ] SubTask 5.4: 将新数据更新到存储并返回

# Task Dependencies
- [Task 2] 依赖 [Task 1]
- [Task 3] 依赖 [Task 2]
- [Task 4] 可独立执行
- [Task 5] 依赖 [Task 4]
- Task 1 和 Task 4 可并行执行
