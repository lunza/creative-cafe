# Tasks

- [x] Task 1: 扩展 ClarifyingQuestion 类型，新增 options 字段
  - [x] SubTask 1.1: 在 `src/shared/types/worldbook-authoring.types.ts` 的 `ClarifyingQuestion` 接口中新增 `options?: string[]` 字段，注释说明为"预设解决方案选项（至少 3 个）"
  - [x] SubTask 1.2: 在 `src/main/services/agent/worldbook/worldbookPlanningService.ts` 的 `generateClarifyingQuestions` 提示词中，要求 LLM 为每个问题生成至少 3 个预设选项，填入 options 字段

- [x] Task 2: 创建 AgentQuestionModal 逐项问答弹窗组件
  - [x] SubTask 2.1: 创建 `src/renderer/components/AgentCenter/AgentQuestionModal.tsx` 和 `AgentQuestionModal.css`
  - [x] SubTask 2.2: 弹窗包含：标题"智能体需要确认"、问题序号（如"问题 1/3"）、问题内容、上下文说明（why）、预设选项卡片列表（≥3 个，可点击选中）、"其他"选项（点击展开文本输入框）、"跳过"按钮、"确认"按钮。ESC 键和点击外部不关闭弹窗（必须显式操作）。

- [x] Task 3: useAgentDialogue 集成逐项提问逻辑
  - [x] SubTask 3.1: 在 `useAgentDialogue.ts` 中新增澄清问题状态：`clarifyQuestions`、`currentClarifyIndex`、`pendingAnswers`、`awaitingSessionId`
  - [x] SubTask 3.2: 在进度事件回调中检测 `phase='planning_clarifying'` 事件，提取 `clarifyingQuestions` 扩展字段，设置问题队列并触发第 1 个问题弹窗
  - [x] SubTask 3.3: 实现 `handleClarifyAnswer(answer?: string, skipped: boolean)` 函数：记录当前问题回答，若还有下一个问题则切换到下一个，若全部完成则调用 `worldBookAgent.answer(sessionId, answers)` 提交全部回答并清空状态
  - [x] SubTask 3.4: hook 返回值新增 `clarifyState`（含 currentQuestion/currentIndex/totalCount）和 `handleClarifyAnswer` 供 UI 调用
  - [x] SubTask 3.5: 在 `planning_clarifying` 事件到达时禁用对话输入框

- [x] Task 4: AgentDialogueModal 集成问答弹窗
  - [x] SubTask 4.1: 在 `AgentDialogueModal.tsx` 中从 `useAgentDialogue` 解构 `clarifyState` 和 `handleClarifyAnswer`
  - [x] SubTask 4.2: 当 `clarifyState.currentQuestion` 非空时，渲染 `AgentQuestionModal` 组件，传入问题内容、why、options、当前序号/总数、onAnswer 回调
  - [x] SubTask 4.3: 问答弹窗展示期间禁用对话输入框（disabled 条件新增 `clarifyState.currentQuestion != null`）

- [x] Task 5: 进度面板简化 planning_clarifying 展示
  - [x] SubTask 5.1: 修改 `buildAuthoringProgressPanel` 中 `planning_clarifying` 阶段的展示，移除一次性展示所有问题的逻辑，改为仅显示"🤔 智能体正在逐项确认问题，请通过弹窗回答..."状态提示

# Task Dependencies
- [Task 2] depends on [Task 1]（需要 ClarifyingQuestion.options 类型定义）
- [Task 3] depends on [Task 1]（需要 ClarifyingQuestion.options 类型定义）
- [Task 4] depends on [Task 2] and [Task 3]（需要弹窗组件和 hook 状态）
- [Task 5] depends on [Task 3]（需要确认逐项提问逻辑已实现）
