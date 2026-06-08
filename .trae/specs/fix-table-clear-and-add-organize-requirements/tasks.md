# Tasks
- [x] Task 1: 修复清空当前表格功能
  - [x] SubTask 1.1: 修改 `handleClearCurrentSheet`，清空成功后直接重置本地状态（`allSheetData` 中对应 sheet 设为空、`tableData` 设为空），而不是依赖 `loadTableData`
  - [x] SubTask 1.2: 确保清空后 UI 正确更新

- [x] Task 2: 修复清空所有表格功能
  - [x] SubTask 2.1: 修改 `handleClearAll`，清空成功后重置所有本地状态（`sheets`、`allSheetData`、`allSheetHeaders`、`tableData`、`currentSheet`）
  - [x] SubTask 2.2: 确保清空后 UI 正确更新

- [x] Task 3: 添加整理要求输入框到 UI
  - [x] SubTask 3.1: 在"开始整理"按钮区域上方添加 `TextArea` 组件，带占位提示
  - [x] SubTask 3.2: 添加 `organizeRequirements` 状态管理输入内容
  - [x] SubTask 3.3: 整理要求输入框在两个位置（面板顶部和表格区域上方）均添加

- [x] Task 4: 修改 IPC 接口支持整理要求参数
  - [x] SubTask 4.1: 修改 `writingHandlers.ts` 中 `writing:table:organizeTable` handler，接收 `requirements` 参数
  - [x] SubTask 4.2: 修改 `preload.ts` 中 `organizeTable` 接口类型定义
  - [x] SubTask 4.3: 修改前端调用处 `handleStartOrganize`，传入用户输入的整理要求

- [x] Task 5: 修改后端 WritingStorageService.organizeTable 支持 requirements 参数
  - [x] SubTask 5.1: 修改方法签名增加 `requirements?` 参数
  - [x] SubTask 5.2: 将 requirements 传递给 processChapterWithAI

- [x] Task 6: 修改 TableOrganizer 提示词引用用户要求
  - [x] SubTask 6.1: 在提示词构建中增加"用户整理要求"段落
  - [x] SubTask 6.2: 当 requirements 为空时不添加该段落

# Task Dependencies
- [Task 4] 依赖 [Task 3]
- [Task 5] 依赖 [Task 4]
- [Task 6] 依赖 [Task 5]
- Task 1 和 Task 2 可并行执行
- Task 3 可独立执行
