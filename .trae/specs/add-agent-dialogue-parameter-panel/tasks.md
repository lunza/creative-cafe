# Tasks

- [x] Task 1: 创建 useAgentParams 持久化 hook
  - [x] SubTask 1.1: 定义 `AgentParams` 接口（customPersonality: string, assistMode: boolean, assistModeIntensity: 'low'|'medium'|'high'）
  - [x] SubTask 1.2: 实现 localStorage 读写（key: `agent-params-{agentId}`），加载/保存/重置逻辑
  - [x] SubTask 1.3: 切换 agentId 时自动加载对应配置

- [x] Task 2: 创建 AgentParamPanel 参数面板组件
  - [x] SubTask 2.1: 创建 `AgentParamPanel.tsx` 和 `AgentParamPanel.css`
  - [x] SubTask 2.2: 实现人格自定义 TextArea 区块（折叠卡片，placeholder 引导文本）
  - [x] SubTask 2.3: 实现辅助模式 Switch 开关 + 强度 Radio 选择（低/中/高）
  - [x] SubTask 2.4: 实现"重置为默认"按钮
  - [x] SubTask 2.5: 所有参数变更通过 onParamsChange 回调实时上抛

- [x] Task 3: 集成参数面板到 AgentDialogueModal
  - [x] SubTask 3.1: AgentDialogueModal 布局改为左右双列（对话区 + 参数面板），参数面板默认折叠
  - [x] SubTask 3.2: 头部添加齿轮图标按钮控制面板展开/折叠，面板展开时 Modal 宽度变为 1200px
  - [x] SubTask 3.3: 头部添加人格标签（紫色胶囊）和辅助模式标签（橙色胶囊）视觉标识
  - [x] SubTask 3.4: AgentDialogueModal.css 添加双列布局和面板滑入/滑出过渡动画

- [x] Task 4: useAgentDialogue 集成人格注入和辅助模式
  - [x] SubTask 4.1: buildSystemPrompt 追加「人格风格」段落（customPersonality 非空时注入）
  - [x] SubTask 4.2: buildSystemPrompt 追加「辅助模式」段落（assistMode 开启时注入 <<<SUGGESTED_OPTIONS>>> 格式约束）
  - [x] SubTask 4.3: 辅助模式提示词根据 intensity（low/medium/high）调整选项生成策略
  - [x] SubTask 4.4: sendMessage 中 agent.run 返回后解析 <<<SUGGESTED_OPTIONS>>> 标记，剥离选项块，存入 DialogueMessage.suggestedOptions
  - [x] SubTask 4.5: DialogueMessage 接口添加 suggestedOptions?: string[] 字段

- [x] Task 5: 辅助模式选项渲染与交互
  - [x] SubTask 5.1: AgentDialogueModal 消息气泡下方渲染 suggestedOptions 选项卡片（三色差异化：绿/紫/橙红）
  - [x] SubTask 5.2: 选项卡片点击后文本填入输入框
  - [x] SubTask 5.3: 选项区域上方显示"AI 推荐了以下对话方向"提示文本
  - [x] SubTask 5.4: 流式生成中不显示选项，仅在回复完成后展示

# Task Dependencies
- [Task 3] depends on [Task 1] and [Task 2]
- [Task 4] depends on [Task 1]
- [Task 5] depends on [Task 4]
