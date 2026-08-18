# Tasks

## Task 1: 对话保存时自动创建联动版本
- [x] SubTask 1.1: 修改 `characterChatHandlers.ts` 的 `saveCharacterTestChat` 函数，保存对话时创建联动版本
- [x] SubTask 1.2: 修改 `VersionLinkerService.ts` 新增 `MAX_LINKED_VERSIONS = 10` 版本上限控制

## Task 2: 新增表格恢复 IPC
- [x] SubTask 2.1: 在 `memoryTableHandlers.ts` 中新增 `memory:restoreTableFromSnapshot` IPC handler
- [x] SubTask 2.2: 在 `preload.ts` 的 `memory` 接口中新增 `restoreTableFromSnapshot`

## Task 3: 卷回到输入框时恢复表格
- [x] SubTask 3.1: 在 `rollbackToMessage` 中查找对应版本并恢复表格快照
- [x] SubTask 3.2: 更新依赖数组，函数改为 async

## Task 4: 从版本重新生成时恢复表格
- [x] SubTask 4.1: 在 `retryMessageFromVersion` 中恢复表格快照
- [x] SubTask 4.2: 更新依赖数组

## Task 5: 测试验证
- [x] SubTask 5.1: 编写 `VersionLinkerService.test.ts`（10 个测试用例）
- [x] SubTask 5.2: 编写 `TableRestore.test.ts`（8 个测试用例）
- [ ] SubTask 5.3: 手动验证卷回到输入框时表格回退（需运行应用）
- [ ] SubTask 5.4: 手动验证从版本重新生成时表格回退（需运行应用）
- [ ] SubTask 5.5: 手动验证联动版本数量上限 10 个（需运行应用）

# Task Dependencies
- [Task 1] 无依赖 ✅
- [Task 2] 无依赖 ✅
- [Task 3] 依赖 [Task 2] ✅
- [Task 4] 依赖 [Task 2] ✅
- [Task 5] 依赖 [Task 1]~[Task 4] ✅（18/18 测试通过）