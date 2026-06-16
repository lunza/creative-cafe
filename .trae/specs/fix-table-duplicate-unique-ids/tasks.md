# Tasks
- [x] Task 1: 在 executeTableEditCommands 的 insertRow 中增加唯一 ID 去重检查
  - [x] SubTask 1.1: 解析模板的 headers 找到唯一 ID 字段（"唯一id"）的索引
  - [x] SubTask 1.2: 在执行 insertRow 前，检查该 sheet 中是否已存在相同唯一 ID 的行
  - [x] SubTask 1.3: 如果存在，跳过插入或合并更新该行；如果不存在，正常插入

- [x] Task 2: 整理完成后增加全局去重清理
  - [x] SubTask 2.1: 在 `organizeTable` 所有 chapter 处理完成后，增加全局去重扫描
  - [x] SubTask 2.2: 对每个 sheet 扫描，发现并移除唯一 ID 重复的行（保留第一条）
  - [x] SubTask 2.3: 保存去重后的数据

- [x] Task 3: 提示词强化去重说明
  - [x] SubTask 3.1: 在 `buildWritingTableOrganizePrompt` 中强化唯一 ID 去重指令
  - [x] SubTask 3.2: 在 `buildRowReorganizePrompt` 中已强制保持唯一 ID 不变（不涉及插入，无需额外去重）

# Task Dependencies
- [Task 2] 依赖 [Task 1]
- [Task 3] 可独立执行
