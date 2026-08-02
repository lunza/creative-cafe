# Checklist

## 类型定义

- [x] `ClarifyingQuestion` 接口新增 `options?: string[]` 字段，注释说明为"预设解决方案选项（至少 3 个）"
- [x] `worldbookPlanningService.generateClarifyingQuestions` 提示词要求 LLM 为每个问题生成 ≥3 个预设选项
- [x] `npx tsc --noEmit` 0 新增错误

## AgentQuestionModal 弹窗组件

- [x] `AgentQuestionModal.tsx` 和 `AgentQuestionModal.css` 已创建
- [x] 弹窗标题显示"🤔 智能体需要确认"
- [x] 弹窗显示问题序号（如"问题 1/3"）
- [x] 弹窗显示问题内容（question 字段）
- [x] 弹窗显示上下文说明（why 字段，解释为什么需要这个信息）
- [x] 弹窗显示至少 3 个预设选项作为可点击的卡片/按钮
- [x] 弹窗包含"其他"选项，点击后展开文本输入框
- [x] 弹窗包含"跳过"按钮
- [x] 弹窗包含"确认"按钮
- [x] ESC 键和点击弹窗外部不关闭弹窗（必须显式选择"跳过"或"确认"）
- [x] 选中预设选项后高亮显示
- [x] 点击"确认"时提交选中的预设选项或自定义输入作为回答
- [x] 点击"跳过"时标记 skipped=true 并继续下一个问题

## useAgentDialogue 逐项提问逻辑

- [x] hook 新增 `clarifyQuestions`、`currentClarifyIndex`、`pendingAnswers`、`awaitingSessionId` 状态
- [x] 进度事件回调检测 `phase='planning_clarifying'`，提取 `clarifyingQuestions` 扩展字段
- [x] 检测到澄清问题后设置问题队列，触发第 1 个问题弹窗
- [x] `handleClarifyAnswer(answer?, skipped)` 记录当前问题回答
- [x] 还有下一个问题时切换到下一个问题
- [x] 全部问题回答完毕后调用 `worldBookAgent.answer(sessionId, answers)` 提交全部回答
- [x] 回答提交后清空澄清问题状态
- [x] hook 返回值新增 `clarifyState` 和 `handleClarifyAnswer`
- [x] `planning_clarifying` 事件到达时禁用对话输入框

## AgentDialogueModal 集成

- [x] 从 `useAgentDialogue` 解构 `clarifyState` 和 `handleClarifyAnswer`
- [x] `clarifyState.currentQuestion` 非空时渲染 `AgentQuestionModal` 组件
- [x] 问答弹窗展示期间禁用对话输入框
- [x] 弹窗传入问题内容、why、options、当前序号/总数、onAnswer 回调

## 进度面板简化

- [x] `buildAuthoringProgressPanel` 中 `planning_clarifying` 阶段不再一次性展示所有问题
- [x] 进度面板仅显示"🤔 智能体正在逐项确认问题，请通过弹窗回答..."状态提示

## 回答提交流程

- [x] 所有问题回答完毕后通过 `worldBookAgent.answer` IPC 一次性提交全部回答
- [x] 回答提交后对话输入框恢复可用状态
- [x] 编排会话继续执行（进入 building plan 阶段）

## 验证

- [x] `GetDiagnostics` 4 个文件 0 新增错误
- [x] 多问题逐项展示正常（每次仅显示 1 个问题）
- [x] 预设选项可点击选中并提交
- [x] "其他"选项可展开自定义输入
- [x] "跳过"按钮正常工作
- [x] 回答提交后编排会话继续执行
