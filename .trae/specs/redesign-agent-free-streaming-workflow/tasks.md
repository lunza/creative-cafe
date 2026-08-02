# Tasks

- [x] Task 1: 更新 worldbook-author SKILL.md 为自由流式工作模式 + 数据入库格式规范
  - [x] SubTask 1.1: 重写 `src/main/services/agent/skills/builtin-skills/worldbook-author/SKILL.md`：移除三阶段工作流描述，改为自由流式工作模式描述 + 数据入库格式规范

- [x] Task 2: 重写 handleWriteWorldbook 为流式对话路径
  - [x] SubTask 2.1: 在 `useAgentDialogue.ts` 中重写 `handleWriteWorldbook`：解析世界书名称和附加上下文后，不再调用 `worldBookAgent.run`，而是构建 systemPrompt（含技能格式规范 + 世界书路径上下文）并将编写请求作为用户消息通过 `agent.run` 流式路径发送
  - [x] SubTask 2.2: `handleWriteWorldbook` 改为返回 `void`（而非 string），因为它不再生成最终文本，而是通过流式 token 实时输出
  - [x] SubTask 2.3: 修改 `sendMessage` 中 `/编写` 分支：`handleWriteWorldbook` 返回 void 后不调用 `appendAssistantMessage(resultContent)`

- [x] Task 3: 移除进度面板机制
  - [x] SubTask 3.1: 删除 `buildAuthoringProgressPanel` 函数及其相关常量（`AUTHORING_PHASE_LABELS`、`THOUGHT_STEP_ICONS`）
  - [x] SubTask 3.2: 删除 `_progressPanelId` 字段使用（`DialogueMessage` 接口中字段保留但不再使用）
  - [x] SubTask 3.3: 删除 `worldbookWriting` 状态及其在 `handleWriteWorldbook` 中的 set 调用、return 中的导出
  - [x] SubTask 3.4: 删除 `handleWriteWorldbook` 中的 `progressEvents` / `thoughtStepsAccum` 累积逻辑、`onProgress` 订阅、`updateProgressPanel` 函数、残留会话清理逻辑

- [x] Task 4: 移除逐项提问弹窗集成
  - [x] SubTask 4.1: 删除 `clarifyQuestions` / `currentClarifyIndex` / `pendingAnswers` / `awaitingSessionId` 状态
  - [x] SubTask 4.2: 删除 `handleClarifyAnswer` 函数
  - [x] SubTask 4.3: 删除 `clarifyState` 计算和 return 导出
  - [x] SubTask 4.4: 删除 `planning_clarifying` 事件检测逻辑
  - [x] SubTask 4.5: 在 `AgentDialogueModal.tsx` 中移除 `AgentQuestionModal` import 和渲染、`clarifyState` / `handleClarifyAnswer` 解构、输入框 `clarifyState.currentQuestion != null` 禁用条件

- [x] Task 5: 移除 Loading 指示器和输出截断
  - [x] SubTask 5.1: 在 `AgentDialogueModal.tsx` 中移除 `worldbookWriting` 解构和进度面板 Loading 指示器渲染
  - [x] SubTask 5.2: 删除 `useAgentDialogue.ts` 中所有与进度面板相关的 `.slice(0, N)` 截断逻辑

- [x] Task 6: 验证与文档更新
  - [x] SubTask 6.1: `GetDiagnostics` 检查所有修改文件 0 新增错误
  - [x] SubTask 6.2: 更新 `CODE_WIKI.md` 记录本次重构

# Task Dependencies
- [Task 2] depends on [Task 1]（需要技能格式规范注入 systemPrompt）
- [Task 3] 和 [Task 4] 和 [Task 5] 可与 [Task 2] 并行（都是删除/移除操作）
- [Task 6] 依赖所有前置任务完成
