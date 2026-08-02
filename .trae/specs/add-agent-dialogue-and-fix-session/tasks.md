# Tasks

## 阶段 1：修复世界书 sessionId 时序问题（独立，无前端依赖）

- [x] Task 1: 修复 AuthoringProgressEvent 携带 sessionId
  - [x] SubTask 1.1: 在 `src/shared/types/worldbook-authoring.types.ts` 的 `AuthoringProgressEvent` 接口新增 `sessionId?: string` 字段
  - [x] SubTask 1.2: 在 `src/main/services/agent/worldbook/worldbookAuthoringService.ts` 的 `run()` 方法中，会话创建后立即通过 `onProgress` 推送一个携带 `sessionId` 的 progress 事件（在 PLANNING 阶段的第一个事件中包含 sessionId）
  - [x] SubTask 1.3: 确保后续所有 `emitProgress()` 调用也携带 sessionId（可通过闭包捕获或修改 emitProgress 签名）
  - [x] SubTask 1.4: 在 `src/renderer/components/WorldBook/hooks/useWorldBookAuthoring.ts` 的 `handleProgressEvent` 中，当事件携带 `sessionId` 时更新 `state.sessionId`
  - [x] 验证：`npx tsc --noEmit` 0 新增错误

## 阶段 2：智能体对话 Hook（依赖已有 agent:run IPC）

- [x] Task 2: 实现 useAgentDialogue hook
  - [x] SubTask 2.1: 新建 `src/renderer/components/AgentCenter/hooks/useAgentDialogue.ts`
  - [x] SubTask 2.2: 管理 `messages: Array<{role: 'user'|'assistant', content: string, streaming?: boolean}>` 状态
  - [x] SubTask 2.3: 实现 `sendMessage(content)` 方法 — 追加 user 消息 + 空 assistant placeholder（streaming=true），订阅 `agent.onToken` 累加到 assistant 消息，调用 `agent.run()` 传入完整对话历史 + agent 配置构建的 systemPrompt，`agent.run()` 返回后标记 streaming=false
  - [x] SubTask 2.4: 实现 `cancel()` 方法 — 调用 `agent.cancel()` IPC，标记当前 assistant 消息 streaming=false
  - [x] SubTask 2.5: 实现 `reset()` 方法 — 清空消息列表，取消任何进行中的 agent run
  - [x] SubTask 2.6: 从 AgentConfig 构建 systemPrompt — 包含 name/description/type/mode/identity，引导智能体以其身份和职责回答用户
  - [x] SubTask 2.7: 组件卸载时取消订阅 `agent.onToken` / `agent.onDone` 事件并取消进行中的 agent run
  - [x] 验证：`npx tsc --noEmit` 0 新增错误

## 阶段 3：智能体对话 Modal 组件（依赖阶段 2）

- [x] Task 3: 实现 AgentDialogueModal 组件
  - [x] SubTask 3.1: 新建 `src/renderer/components/AgentCenter/AgentDialogueModal.tsx` — antd Modal + 消息列表 + 输入框
  - [x] SubTask 3.2: Modal 标题显示智能体 emoji + name，宽度 720px
  - [x] SubTask 3.3: 消息列表区域 — 使用 antd List 或自定义 div 渲染，用户消息右对齐、助手消息左对齐，支持 Markdown 渲染（可复用现有 MarkdownRenderer 或简单 `<Text>` 渲染）
  - [x] SubTask 3.4: 流式渲染 — assistant 消息 streaming=true 时显示加载光标动画（typing indicator）
  - [x] SubTask 3.5: 输入区域 — antd Input.TextArea + 发送按钮，Enter 发送 / Shift+Enter 换行，streaming 时禁用输入并显示"停止"按钮
  - [x] SubTask 3.6: 空状态 — 无消息时显示智能体描述和欢迎语
  - [x] SubTask 3.7: Modal 关闭时调用 hook.reset() 清理状态
  - [x] 验证：`npx tsc --noEmit` 0 新增错误

## 阶段 4：AgentList 与 AgentCenter 集成（依赖阶段 3）

- [x] Task 4: 在 AgentList 新增"对话"按钮并集成到 AgentCenter
  - [x] SubTask 4.1: 在 `AgentList.tsx` 操作列新增"对话"按钮（MessageOutlined 图标，type="link" size="small"），所有智能体均显示（不区分 isSystem）
  - [x] SubTask 4.2: AgentList Props 新增 `onChat: (agent: AgentConfig) => void` 回调
  - [x] SubTask 4.3: 在 `AgentCenter.tsx` 新增对话 Modal 状态（dialogueOpen + chattingAgent），传递 onChat 回调给 AgentList
  - [x] SubTask 4.4: 在 AgentCenter 渲染 AgentDialogueModal，open={dialogueOpen}，agent={chattingAgent}
  - [x] 验证：`npx tsc --noEmit` 0 新增错误；界面"对话"按钮可点击打开 Modal

## 阶段 5：验证与文档

- [x] Task 5: 类型验证与回归测试
  - [x] SubTask 5.1: `npx tsc --noEmit` 0 新增错误
  - [x] SubTask 5.2: `npx vitest run` 现有测试无回归
  - [x] SubTask 5.3: 手动验证 — 智能体对话：发送消息 → 流式接收 → 多轮对话 → 停止 → 关闭
  - [x] SubTask 5.4: 手动验证 — 世界书编写：启动 → 回答澄清问题（不再报"无活跃会话"） → 编写继续

- [x] Task 6: 文档增量更新
  - [x] SubTask 6.1: `CODE_WIKI.md` 新增智能体对话功能章节
  - [x] SubTask 6.2: `CHANGELOG.md` 新增对应条目
  - [x] SubTask 6.3: `docs/FIX_RECORDS.md` 记录 sessionId 时序 Bug 并重点标记
  - [x] SubTask 6.4: `tasks.md` 各任务完成后勾选 checkbox

# Task Dependencies
- Task 1（sessionId 修复）独立，无依赖
- Task 2（对话 hook）独立，无依赖（复用已有 agent:run IPC）
- Task 3（对话 Modal）依赖 Task 2
- Task 4（集成）依赖 Task 3
- Task 5（验证）依赖 Task 1 + Task 4
- Task 6（文档）最后执行
