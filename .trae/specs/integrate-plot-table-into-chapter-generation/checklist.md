# Checklist

- [x] ContentGenerationRequest 类型包含 writingTableData 字段
- [x] ContentGenerator 包含 buildTableContextForPrompt 方法
- [x] buildTableContextForPrompt 格式化表格数据为 AI 可读格式
- [x] buildPrompt 方法中调用 buildTableContextForPrompt 并整合到 prompt 中
- [x] PromptBuilder 的 buildContentPrompt 接受 tableContext 参数
- [x] 表格上下文在 prompt 中插入到前序章节和章节概要之间
- [x] IPC handler writing:generateContentStream 读取并传递表格数据
- [x] 无表格数据时不添加表格上下文（返回空字符串）
- [x] 构建无错误
