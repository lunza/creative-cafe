# Checklist

## 世界书 sessionId 时序修复

- [x] `AuthoringProgressEvent` 接口新增 `sessionId?: string` 字段
- [x] `worldbookAuthoringService.run()` 会话创建后第一个 progress 事件携带 sessionId
- [x] 后续所有 progress 事件也携带 sessionId
- [x] `useWorldBookAuthoring.handleProgressEvent` 从事件中提取 sessionId 更新 state
- [x] `submitAnswers` 在 PLANNING 阶段能获取到有效的 sessionId（不再报"无活跃会话"）

## 智能体对话 Hook

- [x] `useAgentDialogue.ts` 已创建，管理 messages 状态
- [x] `sendMessage(content)` 追加 user 消息 + assistant placeholder，调用 `agent.run()` 传入完整对话历史
- [x] 订阅 `agent.onToken` 流式累加到 assistant 消息内容
- [x] `agent.run()` 返回后标记 assistant 消息 streaming=false
- [x] `cancel()` 调用 `agent.cancel()` IPC，停止流式接收
- [x] `reset()` 清空消息列表，取消进行中的 agent run
- [x] systemPrompt 从 AgentConfig 构建（name/description/type/mode/identity）
- [x] 组件卸载时取消订阅事件并取消 agent run

## 智能体对话 Modal

- [x] `AgentDialogueModal.tsx` 已创建
- [x] Modal 标题显示智能体 emoji + name
- [x] 消息列表：用户消息右对齐、助手消息左对齐
- [x] 流式渲染：streaming=true 时显示 typing indicator
- [x] 输入区域：TextArea + 发送按钮，Enter 发送 / Shift+Enter 换行
- [x] streaming 时禁用输入并显示"停止"按钮
- [x] 空状态显示智能体描述和欢迎语
- [x] Modal 关闭时调用 reset() 清理状态

## AgentList 与 AgentCenter 集成

- [x] AgentList 操作列新增"对话"按钮（所有智能体均显示）
- [x] AgentList Props 新增 `onChat` 回调
- [x] AgentCenter 新增对话 Modal 状态管理
- [x] AgentCenter 渲染 AgentDialogueModal

## 交互与数据验证

- [x] 对话按钮样式与现有操作按钮一致（type="link" size="small"）
- [x] 发送空消息时阻止提交
- [x] streaming 时禁用发送按钮
- [x] 错误情况（agent:run 失败）显示 message.error 提示
- [x] Modal 关闭时取消进行中的 agent run

## 测试与验证

- [x] `npx tsc --noEmit` 0 新增错误
- [x] `npx vitest run` 现有测试无回归
- [x] 智能体对话全流程：发送 → 流式接收 → 多轮 → 停止 → 关闭
- [x] 世界书编写：启动 → 回答澄清问题 → 编写继续（不再报"无活跃会话"）

## 文档

- [x] `CODE_WIKI.md` 新增智能体对话功能章节
- [x] `CHANGELOG.md` 新增对应条目
- [x] `docs/FIX_RECORDS.md` 记录 sessionId 时序 Bug 并重点标记
- [x] `tasks.md` 所有完成任务已勾选
