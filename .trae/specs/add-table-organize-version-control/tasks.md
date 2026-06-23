# Tasks

- [x] Task 1: 定义版本控制相关类型
  - [x] SubTask 1.1: 在 `writing.types.ts` 中新增 `TableOrganizeVersionSnapshot` 类型，包含原始版本数据、新版本数据、创建时间戳、项目 ID、章节 ID
  - [x] SubTask 1.2: 新增 `TableOrganizeChangeRecord` 类型，记录变更明细（新增行、修改单元格、删除行）
  - [x] SubTask 1.3: 新增 `TableCellChange` 类型，记录单元格级别变更（行号、列名、旧值、新值）

- [x] Task 2: 实现临时存储机制（后端）
  - [x] SubTask 2.1: 在 `WritingStorageService.ts` 中添加临时存储管理方法：`saveVersionSnapshot()`、`getVersionSnapshot()`、`clearVersionSnapshot()`
  - [x] SubTask 2.2: 实现数据对比方法 `compareTableData()`，对比新旧版本数据，返回变更明细
  - [x] SubTask 2.3: 修改表格整理完成逻辑，整理完成后将新数据存入临时存储区，不直接覆盖原始数据
  - [x] SubTask 2.4: 实现临时存储过期清理逻辑（24 小时过期）

- [x] Task 3: 新增版本控制 IPC 接口
  - [x] SubTask 3.1: 在 `writingHandlers.ts` 中新增 handler：`writing:table:getVersionSnapshot`（获取版本快照）
  - [x] SubTask 3.2: 新增 handler：`writing:table:confirmVersion`（确认覆盖，将临时数据覆盖到原始数据）
  - [x] SubTask 3.3: 新增 handler：`writing:table:rollbackVersion`（回退到原始版本）
  - [x] SubTask 3.4: 新增 handler：`writing:table:getChangeRecord`（获取变更明细）- 已集成在 getVersionSnapshot 中
  - [x] SubTask 3.5: 在 `preload.ts` 中暴露上述接口

- [x] Task 4: 实现前端"回退"和"确认"按钮
  - [x] SubTask 4.1: 在 `WritingModeRightPanel.tsx` 中添加版本控制状态管理（是否有待确认版本）
  - [x] SubTask 4.2: 在表格整理操作完成后，显示"回退"和"确认"两个功能按钮
  - [x] SubTask 4.3: 实现"回退"按钮点击处理：调用 rollbackVersion 接口，恢复原始数据，清除临时存储，隐藏按钮
  - [x] SubTask 4.4: 实现"确认"按钮点击处理：打开对比弹窗
  - [x] SubTask 4.5: 添加按钮工具提示和状态提示

- [x] Task 5: 实现对比弹窗组件
  - [x] SubTask 5.1: 创建 `TableVersionCompareModal` 组件，左右分栏展示新旧版本表格
  - [x] SubTask 5.2: 实现变更高亮标识：新增行浅绿色背景、修改单元格浅黄色背景、删除行浅红色背景
  - [x] SubTask 5.3: 实现弹窗内编辑功能，支持双击编辑单元格、添加行、删除行
  - [x] SubTask 5.4: 实现变更明细统计展示（新增行数、修改单元格数量及位置、删除行数）
  - [x] SubTask 5.5: 实现"确认覆盖"按钮的二次确认对话框

- [x] Task 6: 实现异常处理与数据安全
  - [x] SubTask 6.1: 实现关闭对比弹窗时保留临时存储数据
  - [x] SubTask 6.2: 实现离开页面或切换章节时的提示逻辑（保留/放弃/取消）
  - [x] SubTask 6.3: 实现临时存储过期自动清理

- [x] Task 7: 实现操作指引与状态提示
  - [x] SubTask 7.1: 整理完成后显示状态提示和指引信息
  - [x] SubTask 7.2: 在表格上方显示状态栏，标识当前显示的是新版本数据（未确认）

# Task Dependencies

- [Task 2] depends on [Task 1]
- [Task 3] depends on [Task 2]
- [Task 4] depends on [Task 3]
- [Task 5] depends on [Task 3]
- [Task 6] depends on [Task 4]
- [Task 7] depends on [Task 4]
