# 修复聊天对话框主题背景检查清单

- [x] ui-variables.css中添加了聊天对话框专用的CSS变量（亮色和暗色主题）
- [x] CharacterDialogueChat.tsx中Modal body背景色使用CSS变量
- [x] CharacterDialogueChat.tsx中.chat-area-bg::before和::after使用CSS变量
- [x] CharacterDialogueChat.tsx中.chat-bg-grid颜色使用CSS变量
- [x] CharacterDialogueChat.tsx中滚动条样式使用CSS变量
- [x] CharacterDialogueChat.tsx中空状态、错误提示等颜色使用CSS变量
- [x] ChatMessageBubble.tsx中助手消息气泡背景色使用CSS变量
- [x] ChatMessageBubble.tsx中编辑框样式使用CSS变量
- [x] ChatMessageBubble.tsx中操作按钮背景色使用CSS变量
- [x] ChatMessageBubble.tsx中光标颜色使用CSS变量
- [x] ChatInputBar.tsx中输入框颜色跟随主题变化
- [x] 亮色模式下聊天对话框背景为浅色（白色/浅灰色）
- [x] 暗色模式下聊天对话框保持紫色渐变背景
- [x] 主题切换时颜色过渡平滑自然
- [x] 亮色模式下文字与背景对比度达到WCAG AA级标准（至少4.5:1）
- [x] 暗色模式下文字与背景对比度良好
- [x] 两种模式下UI元素（边框、阴影、分隔线）样式协调统一