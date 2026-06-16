# Tasks
- [x] Task 1: WritingStorageService 增加 organizeSingleSheet 方法
  - [x] SubTask 1.1: 新增 `organizeSingleSheet` 方法，只处理指定的单个 sheet
  - [x] SubTask 1.2: 新增 `buildSingleSheetOrganizePrompt` 方法，构建只包含所选表格信息的提示词
  - [x] SubTask 1.3: 复用现有的 `processChapterWithAI` 逻辑，但只更新指定 sheet 的数据

- [x] Task 2: IPC handler 支持 organizeSingleSheet
  - [x] SubTask 2.1: 在 `writingHandlers.ts` 中新增 `writing:table:organizeSingleSheet` handler
  - [x] SubTask 2.2: 接收参数：projectId, sheetName, modelConfig, chapterIndex?, requirements?

- [x] Task 3: preload.ts 增加 organizeSingleSheet 接口
  - [x] SubTask 3.1: 在 `preload.ts` 中暴露 `organizeSingleSheet` 方法

- [x] Task 4: 前端添加"整理单个表格"按钮和选择界面
  - [x] SubTask 4.1: 在操作按钮区域添加"整理单个表格"按钮（与"整理全部表格"样式一致）
  - [x] SubTask 4.2: 点击按钮后显示 Modal 让用户选择要整理的 sheet（从当前绑定的模板中读取 sheet 列表）
  - [x] SubTask 4.3: 选择 sheet 后调用 `organizeSingleSheet` IPC 接口
  - [x] SubTask 4.4: 显示整理进度（复用现有进度机制）

# Task Dependencies
- [Task 2] 依赖 [Task 1]
- [Task 3] 依赖 [Task 2]
- [Task 4] 依赖 [Task 3]
