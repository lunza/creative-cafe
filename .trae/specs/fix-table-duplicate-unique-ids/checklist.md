# Checklist

- [x] `executeTableEditCommands` 的 insertRow 执行前检查唯一 ID，重复则跳过或合并
- [x] organizeTable 所有 chapter 处理完成后，对每个 sheet 进行全局去重
- [x] 全局去重后保存数据到存储
- [x] buildWritingTableOrganizePrompt 中强化唯一 ID 去重指令
- [x] buildRowReorganizePrompt 中强制保持唯一 ID 不变
