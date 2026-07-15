# Checklist

- [x] `AIParameterConfig` 接口包含 `assist_mode?: boolean` 字段
- [x] `ChatMessage` 接口包含 `suggestedOptions?: string[]` 字段
- [x] `PromptBuilder.ts` 中存在 `buildAssistModePrompt` 函数，返回包含 3 选项格式约束的提示词
- [x] ParameterPanel 中"辅助模式"开关使用 antd Switch 组件，默认关闭
- [x] 开关 Tooltip 包含功能说明文字
- [x] ConfigPanel 正确透传 assistMode 和 onAssistModeToggle props
- [x] CharacterDialogueChat 通过 handleParameterChange 将 assist_mode 存入 customParameters
- [x] assist_mode 开启时，requestAIResponse 中系统提示词末尾注入辅助模式约束
- [x] engine.onComplete 中正确解析 `<!-- <suggestedOptions>...</suggestedOptions> -->` 选项块
- [x] 选项块从 displayContent/finalContent 中剥离，正文无残留标记
- [x] 解析出的选项存入 AI 消息的 suggestedOptions 字段
- [x] AI 未生成选项时静默处理，不影响正常回复展示
- [x] ChatMessageBubble 在非流式状态下渲染 suggestedOptions 选项按钮
- [x] 选项按钮有清晰编号标识，与正文有视觉区分
- [x] 点击选项按钮后，选项文本填入输入框，输入框获得焦点
- [x] 流式生成中（isStreaming=true）不显示推荐选项
- [x] 开关状态持久化到 localStorage，刷新后恢复
- [x] 选项按钮在不同消息宽度下有良好的显示效果
