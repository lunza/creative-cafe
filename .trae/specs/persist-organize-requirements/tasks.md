# Tasks
- [ ] Task 1: WritingTableConfig 增加 organizeRequirements 字段
  - [ ] SubTask 1.1: 在 `WritingStorageService.ts` 的 `WritingTableConfig` 接口中增加 `organizeRequirements?: string` 字段

- [ ] Task 2: 前端 - 加载和保存整理要求
  - [ ] SubTask 2.1: 面板加载时从 tableConfig 读取 `organizeRequirements` 并显示在输入框中
  - [ ] SubTask 2.2: 输入框失去焦点时调用 saveTableConfig 保存整理要求

- [ ] Task 3: IPC - 支持保存整理要求（可选，如已有 saveTableConfig 则复用）
  - [ ] SubTask 3.1: 确认 `writing:table:saveTableConfig` 已支持更新 `organizeRequirements` 字段

- [ ] Task 4: 整理时使用保存的要求
  - [ ] SubTask 4.1: 点击"开始整理"时，如果输入框为空但 tableConfig 有保存的要求，则使用保存的要求
  - [ ] SubTask 4.2: 输入框内容优先于保存的要求

# Task Dependencies
- [Task 2] 依赖 [Task 1]
- [Task 3] 可独立执行
- [Task 4] 依赖 [Task 2]
