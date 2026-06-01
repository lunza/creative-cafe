# Tasks
- [x] Task 1: 分析并定位所有 max_tokens 限制位置：识别 Settings.tsx 中所有涉及 max_tokens 限制的代码
  - [x] SubTask 1.1: 查找表单输入框的 max 属性限制
  - [x] SubTask 1.2: 查找验证逻辑中的 max_tokens 验证规则
  - [x] SubTask 1.3: 查找保存逻辑中的条件判断
- [x] Task 2: 移除 max_tokens 最大值限制：将所有 max_tokens 的最大值限制从 100000 提升到 1000000
  - [x] SubTask 2.1: 修改两处 max_tokens 输入框的 max 属性（第1021行和第1271行）
  - [x] SubTask 2.2: 为所有数值型输入框添加明确的范围提示（共16处）
- [x] Task 3: 修复设置保存逻辑：确保当验证失败时给出明确错误提示
  - [x] SubTask 3.1: 修改 handleSave 函数的 catch 块，检测表单验证错误
  - [x] SubTask 3.2: 显示具体验证失败的字段和错误信息
- [x] Task 4: 验证修改：确认所有修改已正确实施
  - [x] SubTask 4.1: 确认 max_tokens 输入框 max 属性已改为 1000000（两处）
  - [x] SubTask 4.2: 确认所有数值型输入框 placeholder 已添加范围提示
  - [x] SubTask 4.3: 确认 handleSave 函数已添加验证错误提示逻辑
- [x] Task 5: 修复数值字段类型转换问题（根本修复）
  - [x] SubTask 5.1: 在 handleSave 中使用 Number() 转换 max_tokens 等数值字段
  - [x] SubTask 5.2: 在引擎管理模态框保存中也添加类型转换
  - [x] SubTask 5.3: 在新引擎创建时添加类型转换

# Task Dependencies
- [Task 2] depends on [Task 1]
- [Task 3] depends on [Task 1]
- [Task 4] depends on [Task 2, Task 3]
- [Task 5] depends on [Task 1]
