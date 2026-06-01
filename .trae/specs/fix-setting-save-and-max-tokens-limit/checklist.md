# Checklist

- [x] 所有 max_tokens 输入框的 max 属性已从 100000 提升到 1000000（两处：第1021行和第1271行）
- [x] 所有数值型输入框的 placeholder 已添加明确的范围提示（共16处）
- [x] 设置保存逻辑在验证失败时给出明确错误提示（handleSave 函数 catch 块已修改）
- [x] handleSave 函数中已使用 Number() 转换数值字段（max_tokens、temperature 等）
- [x] 引擎管理模态框保存时已使用 Number() 转换数值字段
- [x] 新引擎创建时已使用 Number() 转换数值字段
- [x] spec.md 已更新，包含类型转换需求和根本原因分析
- [x] tasks.md 已更新，Task 5 已标记为完成
