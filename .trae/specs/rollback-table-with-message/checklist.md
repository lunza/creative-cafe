# Checklist

## 联动版本自动创建（Task 1）
- [x] `saveCharacterTestChat` 中保存对话时同步创建联动版本
- [x] 联动版本包含聊天版本和表格快照
- [x] 联动版本数量上限 10 个，超出时自动删除最旧版本
- [x] 版本索引和变更日志正确更新

## 表格恢复 IPC（Task 2）
- [x] `memory:restoreTableFromSnapshot` IPC handler 已注册
- [x] 从快照文件恢复表格数据到当前表格文件
- [x] 快照不存在时返回错误信息
- [x] `preload.ts` 中已暴露 `restoreTableFromSnapshot` 接口

## 卷回到输入框时表格回退（Task 3）
- [x] `rollbackToMessage` 通过时间戳查找匹配的联动版本
- [x] 找到版本且存在表格快照时，恢复表格数据
- [x] 恢复后刷新 `memoryTableDataRef`
- [x] 未找到版本或快照不存在时不阻塞卷回流程
- [x] 函数改为 async，调用方同步调整

## 从版本重新生成时表格回退（Task 4）
- [x] `retryMessageFromVersion` 恢复消息后恢复对应表格快照
- [x] 恢复后刷新 `memoryTableDataRef`
- [x] 失败时不阻塞重新生成流程

## 测试验证（Task 5）
- [x] `VersionLinkerService.test.ts` 10 个测试全部通过
- [x] `TableRestore.test.ts` 8 个测试全部通过
- [ ] 手动测试：卷回到输入框 → 表格数据回退到对应版本（需运行应用）
- [ ] 手动测试：从版本重新生成 → 表格数据回退到对应版本（需运行应用）
- [ ] 手动测试：超过 10 个版本时最旧版本被自动删除（需运行应用）