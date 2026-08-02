# Fix Records (Bug 修复记录)

> 本文件记录开发过程中出现的 Bug、反复调试问题及其修复方案。
> 注意：原文件内容因磁盘异常全部丢失（全为 null 字节），本文件由 2026-08-01 重建。历史修复记录请参考 git 历史记录。

---

## §1 智能体与技能用户管理（Spec: add-agent-and-skill-user-management）

### §1.1 【重点标记】消息重复 Bug — AgentFormModal / SkillFormModal 与父组件双重 message 调用

**现象：**
- 创建/编辑成功时弹出两次 `message.success` 提示
- 创建/编辑失败时同时弹出 `message.error` 和 `message.success`

**根因：**
子代理实现 `AgentFormModal.tsx` 和 `SkillFormModal.tsx` 时，组件内部和父组件（`AgentCenter.tsx` / `SkillMarketplace.tsx`）都调用了 `message.success/error`。

- `AgentFormModal` 内部 `handleOk` 成功后调用 `message.success('创建成功')`，同时 `AgentCenter.handleFormCreate` 也调用 `message.success('智能体创建成功')`
- `SkillFormModal` 内部 `handleOk` 成功后调用 `message.success`，同时 `SkillMarketplace.handleSkillCreate` 也调用 `message.success`
- 失败时同理，子组件和父组件都弹出 error

**修复方案：**
从 `AgentFormModal.tsx` 和 `SkillFormModal.tsx` 中移除 `message` 导入和所有 `message.success/error` 调用。消息提示职责完全交由父组件处理，子组件仅负责表单验证、数据提交和 loading 状态管理。

**修改文件：**
- `src/renderer/components/AgentCenter/AgentFormModal.tsx` — 移除 `import { message } from 'antd'` 中的 `message`，移除所有 `message.success/error` 调用
- `src/renderer/components/AgentCenter/SkillFormModal.tsx` — 同上

**经验教训：**
React 组件设计中，消息提示（全局反馈）的职责应明确归属单一层级。模态表单组件作为受控组件，应仅通过 `onCreate`/`onUpdate`/`onEdit` 回调将结果传递给父组件，由父组件统一处理成功/失败反馈。避免子组件和父组件同时调用全局 `message` 导致重复提示。

---

## §2 智能体对话与世界书会话修复（Spec: add-agent-dialogue-and-fix-session）

### §2.1 【重点标记】世界书编写 sessionId 时序 Bug — "无活跃会话，无法提交回答"

**现象：**
用户在世界书编写智能体的 PLANNING 阶段，回答澄清问题后点击"提交回答"按钮，弹出 `message.error('无活跃会话，无法提交回答')` 错误，导致智能体编写流程中断。

**根因：**
`worldbookAgent:run` IPC 是**阻塞调用** — 它在主进程 `worldbookAgentHandlers.ts` 中调用 `service.run(runRequest)`，该方法阻塞直到整个编写会话完成（PLANNING → AUTHORING → AUDITING → AWAITING_REVIEW → COMPLETE）。

在 `useWorldBookAuthoring.ts` 的 `start()` 函数中，`sessionId` 仅在 `worldBookAgent.run()` IPC 返回后才设置到 React state：

```typescript
// start() 中，sessionId 在 IPC 返回后才设置
const result = res.result;
setState((prev) => ({
  ...prev,
  result,
  running: false,
  sessionId: result.sessionId,  // ← 仅在此时设置
}));
```

但澄清问题在运行**期间**通过 `worldbookAgent:progress` 事件到达（`phase='planning_clarifying'`），`handleProgressEvent` 回调将 `clarifyQuestions` 设置到 state。当用户看到问题并点击"提交回答"时，`submitAnswers` 检查 `state.sessionId` — 此时 `sessionId` 仍为 `null`（因为 IPC 尚未返回），导致错误。

**修复方案：**
1. 在 `AuthoringProgressEvent` 接口新增 `sessionId?: string` 字段
2. `worldbookAuthoringService.ts` 在所有 12 处 progress 事件（`emitProgress()` + `waitForClarifyAnswers` 的 extendedEvent）中携带 `session.id`
3. `useWorldBookAuthoring.handleProgressEvent` 从事件中提取 sessionId：
   ```typescript
   sessionId: event.sessionId ?? prev.sessionId,
   ```

**修改文件：**
- `src/shared/types/worldbook-authoring.types.ts` — `AuthoringProgressEvent` 新增 `sessionId?: string`
- `src/main/services/agent/worldbook/worldbookAuthoringService.ts` — 12 处 progress 事件携带 `sessionId: session.id`
- `src/renderer/components/WorldBook/hooks/useWorldBookAuthoring.ts` — `handleProgressEvent` 提取 `event.sessionId`

**经验教训：**
阻塞式 IPC 调用期间，渲染进程无法从返回值获取中间状态。当需要中途与主进程交互（如提交澄清回答）时，必须通过事件流（progress events）提前传递必要的标识符（如 sessionId）。设计阻塞式编排 IPC 时，应在会话创建后立即通过事件流推送 sessionId，而不是仅依赖最终返回值。

---

### §2.2 【重点标记】智能体对话不回复 — 模型名称为空 + token 重复推送

**现象：**
用户在智能体中心打开对话窗口，发送消息后智能体一直不回复（或回复内容重复两次）。

**根因（双重 Bug）：**

1. **模型名称为空**：`AgentLoop.resolveModelName()` 始终返回空字符串 `''`。`AIServiceAdapter.streamChat()` 将该空字符串作为 `model` 字段传给 `AIService.streamChatAPI()`，导致 API 请求体中 `model: ""`。大多数 OpenAI 兼容 API 会返回 400 Bad Request，请求失败。

2. **token 重复推送**：IPC handler 同时设置了两个 token 推送路径：
   - `AIServiceAdapter.onStreamChunk` — 流式期间逐 chunk 推送 `agent:token` 事件（正确）
   - `AgentCore.config.onTextChunk` — `streamChat` 返回后推送完整内容 `agent:token` 事件（重复）

   两者都向渲染进程发送 `agent:token` 事件，导致内容被推送两次。

**为什么 CharacterDialogueChat 的 Agent 模式不报错？**
`ChatEngine.runViaAgentCore` 在 `agent:run` 失败时自动降级到旧 `streamChatAPI` 路径（直接 fetch），旧路径使用 `config.model_name` 正确传递模型名。因此用户在角色对话中感知不到问题。

**修复方案：**

1. `src/main/services/agent/llm/llmProvider.ts` — `AIServiceAdapter.streamChat()` 在 `request.modelName` 为空时，回退到 `aiService.getConfig().model` 获取模型名：
   ```typescript
   let modelName = request.modelName;
   if (!modelName) {
     const config = await this.aiService.getConfig();
     modelName = config.model;
   }
   ```

2. `src/main/ipc/handlers/agentHandlers.ts` — 移除 `AgentCore` 配置中的 `onTextChunk` 回调，避免与 `AIServiceAdapter.onStreamChunk` 重复推送 token。流式 token 完全由 `AIServiceAdapter.onStreamChunk` 负责。

**修改文件：**
- `src/main/services/agent/llm/llmProvider.ts` — `streamChat()` 新增模型名回退逻辑
- `src/main/ipc/handlers/agentHandlers.ts` — 移除 `onTextChunk` 回调

**经验教训：**
适配器模式中，当上游（AgentLoop）无法提供必要参数（如模型名）时，适配器（AIServiceAdapter）应主动从下游服务（AIService）获取，而非透传空值。同时，流式推送应只有一个权威来源——当 `AIServiceAdapter.onStreamChunk` 已实时推送 token 时，不应再通过 `onTextChunk` 二次推送完整内容。

---

### §2.3 【重点标记】世界书条目生成失败 — 推理模型 content 为空

**现象：**
世界书编写智能体在规划阶段（分析用户提示、生成澄清问题）正常，但进入条目生成阶段后报错：
```
[WorldBookAuthoringService] 维度 世界观背景 生成失败（第 1 次）: LLM 未返回任何条目
[WorldBookAuthoringService] generateEntriesForDimension failed: AI 返回内容为空
```

**根因：**
`AIService.callChatAPI` 的 `buildRequest` 未设置 `enable_thinking: false`。当用户使用推理模型（如 DeepSeek-R1、QwQ 等）时，模型默认启用思考过程，将内容放在 `reasoning_content` 字段中，而 `content` 字段为空。`callChatAPI` 仅读取 `data.choices[0].message.content`，因此抛出"AI 返回内容为空"错误。

非智能体的世界书 AI 操作（`useWorldBookAIOperations.ts`）统一使用 `enable_thinking: false` 禁用思考过程，但 `callChatAPI` 被智能体路径调用时未包含此参数。

**为什么规划阶段正常？**
规划阶段使用 `worldbookPlanningService`，它也调用 `callChatAPI`，但规划阶段的 LLM 响应可能较短（分析提示/生成问题），推理模型在短响应时仍可能将部分内容放入 `content` 字段。条目生成需要输出完整 JSON（可能较长），更容易触发思考模型将全部内容放入 `reasoning_content`。

**修复方案（双重防护）：**

1. `src/main/services/AIService.ts` — `callChatAPI` 的 `buildRequest` 后添加 `requestBody.enable_thinking = false`，与非智能体路径统一
2. `src/main/services/AIService.ts` — `callChatAPI` 的响应解析添加 fallback：`message?.content || message?.reasoning_content`，即使 `enable_thinking` 未被 API 支持，也能读取 `reasoning_content` 作为兜底

**修改文件：**
- `src/main/services/AIService.ts` — `callChatAPI` 方法

**经验教训：**
`callChatAPI` 作为通用 AI 调用方法，应与项目其他 AI 调用路径（`useWorldBookAIOperations`）保持参数一致，特别是 `enable_thinking` 这种影响响应结构的参数。同时，响应解析应具备防御性，处理推理模型可能返回的非标准字段（`reasoning_content`）。

---

### §2.4 【重点标记】Agent 路径全局参数一致性审计与修复（P0+P1 批量修复）

**现象：**
用户指出 `maxTokens: 2048` 硬编码问题后，进一步要求检查所有参数是否有类似的"写死本应从设置读取"问题。审计发现 Agent 路径存在 **4 类严重问题（P0）+ 4 类中等问题（P1）**，涉及 8 个文件。

**审计发现汇总：**

| 级别 | 编号 | 问题 | 影响范围 |
|------|------|------|---------|
| P0 | P0-1 | Agent 对话路径 `temperature`/`maxTokens` 硬编码回退（0.8/4096），忽略引擎配置 | `llmProvider.ts`, `agentLoop.ts`, `agentHandlers.ts`, `useAgentDialogue.ts`, `ChatEngine.ts` |
| P0 | P0-2 | 上次修复的 `aiConfig.maxTokens` 实际为 `undefined`（`AIConfig` 接口无此字段） | `worldbookAuthoringService.ts`, `worldbookPlanningService.ts`, `worldbookAuditService.ts` |
| P0 | P0-3 | Agent 路径完全忽略 `top_p`/`frequency_penalty`/`presence_penalty` | 同 P0-1 |
| P1 | P1-1 | `streamChatAPI` 不注入 `enable_thinking` | `AIService.ts` |
| P1 | P1-2 | `callChatAPI` 硬编码 `enable_thinking = false`，不读引擎配置 | `AIService.ts` |
| P1 | P1-3 | WorldBook Agent 服务 `temperature` 硬编码（0.7/0.3/0.2） | 3 个 worldbook 服务文件 |
| P1 | P1-4 | WorldBook Agent 服务未传 `top_p` | 同 P1-3 |

**修复方案：**

1. **`AIConfig` 接口扩展**（`AIService.ts`）— 新增 `temperature`、`maxTokens`、`topP`、`frequencyPenalty`、`presencePenalty`、`enableChainOfThought` 6 个可选字段，`getConfig()` 从引擎对象读取填充

2. **`buildRequest` 统一注入采样参数**（`AIService.ts`）— 在请求体中自动注入 `top_p`、`frequency_penalty`、`presence_penalty`（条件发送，仅当引擎配置了这些参数时）。`callChatAPI` 和 `streamChatAPI` 均通过 `buildRequest` 自动获益

3. **`enable_thinking` 条件注入**（`AIService.ts`）— `callChatAPI` 和 `streamChatAPI` 统一改为 `config.enableChainOfThought === true`，默认禁用（与非 Agent 路径一致）

4. **`llmProvider.ts` 回退值改为引擎配置**（`llmProvider.ts`）— `temperature: request.temperature ?? config.temperature ?? 0.8`，`maxTokens: request.maxTokens ?? config.maxTokens ?? 4096`

5. **WorldBook Agent 服务参数读取**（3 个文件）— `temperature` 从 `aiConfig.temperature ?? 任务默认值` 读取，`maxTokens` 从 `aiConfig.maxTokens ?? 4096` 读取

**修改文件：**
- `src/main/services/AIService.ts` — `AIConfig` 接口 + `getConfig()` + `buildRequest()` + `callChatAPI` + `streamChatAPI`
- `src/main/services/agent/llm/llmProvider.ts` — `streamChat()` 回退值
- `src/main/services/agent/worldbook/worldbookAuthoringService.ts` — `createDefaultEntryGenerator` 参数
- `src/main/services/agent/worldbook/worldbookPlanningService.ts` — `createDefaultLLMCallFn` 参数
- `src/main/services/agent/worldbook/worldbookAuditService.ts` — `defaultLLMCompare` 参数

**验证结果：**
- `npx tsc --noEmit` — 修改文件零新增错误
- `npx vitest run` — 68/69 文件，1634/1635 测试通过（唯一失败为预存 `skills.test.ts`）

**经验教训：**
这是"一致性检查"规则（Rule #14）的典型应用案例。实现新功能时必须先检查已有路径如何获取参数，从引擎配置读取而非硬编码。`AIConfig` 接口应包含所有引擎配置字段，`buildRequest` 应统一注入所有采样参数，避免每个调用点重复处理。

---

## §3 智能体对话参数配置面板（Spec: add-agent-dialogue-parameter-panel）

### §3.1 【重点标记】/编写 指令秒回"已完成"但世界书未实际编写 — IPC 返回值字段不匹配 + 缺少 config 参数

**现象：**
用户在智能体对话中输入 `/编写 神秘别墅.json，有任何问题随时向我提问`，智能体瞬间回复"✅ 世界书「神秘别墅」编写流程已完成。"，但世界书并未进行任何分析和编写。

**根因（双重 Bug）：**

1. **IPC 返回值字段不匹配**：`worldbookAgent:run` IPC handler 返回 `{ ok: boolean, result?: WorldBookAuthoringRunResult, error?: string, reason?: string }`，其中 `success` 字段位于嵌套的 `result.result` 对象上。但 `handleWriteWorldbook` 中错误地检查 `result?.success !== false`：
   - `result` 是 IPC 响应对象 `{ ok, result?, error? }`，没有 `success` 字段
   - `result?.success` 始终为 `undefined`
   - `undefined !== false` 始终为 `true`
   - 因此**无论成功还是失败，永远报"已完成"**

2. **缺少 `config` 参数**：`worldbookAuthoringService.runPlanning()` 在 `config` 为空时抛出 `'PLANNING 缺少 userPrompt 或 config'`。`handleWriteWorldbook` 调用 `worldBookAgent.run()` 时未传递 `config` 参数，导致服务端必然失败。

**最可能的实际场景：**
Agent 模式未开启 → IPC handler 立即返回 `{ ok: false, error: 'AGENT_MODE_DISABLED' }` → 前端因字段不匹配误判为成功 → 秒回"已完成"。

**修复方案：**

1. `useAgentDialogue.ts` `handleWriteWorldbook`：
   - 正确检查 `result?.ok`（IPC 响应顶层字段）
   - 嵌套检查 `result.result?.success`（编排服务返回值）
   - 传递 `config` 参数（使用 `DEFAULT_AUTHORING_CONFIG` 默认值）
   - 传递 `allowedWorldBookPaths`
   - 针对 `AGENT_MODE_DISABLED` 错误提供专门的提示文案

2. `worldbookAgentHandlers.ts` IPC handler：
   - 当 `request.config` 为 `undefined` 时，回退到 `DEFAULT_AUTHORING_CONFIG`（修复注释承诺但代码未实现的"未提供时使用默认配置"）

**修改文件：**
- `src/renderer/components/AgentCenter/hooks/useAgentDialogue.ts` — `handleWriteWorldbook` 返回值检查 + config 参数
- `src/main/ipc/handlers/worldbook/worldbookAgentHandlers.ts` — IPC handler 默认 config 回退

**对比参考：**
`useWorldBookAuthoring.ts` 的 `start()` 函数正确处理了 IPC 返回值：
```typescript
if (!res?.ok || !res.result) { /* 失败处理 */ }
const result = res.result;  // 正确提取嵌套的 WorldBookAuthoringRunResult
```

**经验教训：**
跨进程 IPC 调用的返回值结构通常有包装层（如 `{ ok, result, error }`），不能直接将包装层当作业务结果使用。在调用方代码中应明确区分"IPC 传输层成功"（`ok`）和"业务逻辑成功"（`result.success`）两个层级。同时，IPC handler 的注释文档承诺的行为（如"未提供 config 时使用默认值"）必须在代码中实际实现。

### §3.2 【重点标记】/编写 指令报错"already has an active authoring session" — 残留会话阻塞

**现象：**
用户执行 `/编写 神秘别墅.json` 时报错：`❌ 世界书编写失败：WorldBook ...神秘别墅.json already has an active authoring session: wba_1785678820258_7eru6j`

**根因：**
`worldbookAuthoringService` 实现了 `worldBookPath` 维度的单实例守卫：同一世界书路径不允许同时运行多个编排会话。之前的会话（因 Bug §3.1 导致的虚假"已完成"或用户中途关闭对话框）未正常结束，`pathToSession` 映射仍指向旧会话 ID，新 `run` 请求被拒绝。

**修复方案：**
在 `handleWriteWorldbook` 中新增"自动清理残留会话"逻辑：
1. 首次 `run` 失败且 `reason` 包含 `already has an active authoring session` 时
2. 用正则 `/session:\s*(wba_\S+)/` 从错误消息中提取残留 sessionId
3. 调用 `worldBookAgent.cancel(staleSessionId)` 取消残留会话
4. 清空进度事件缓冲，重新调用 `run`（仅重试一次）

```typescript
if (!result?.ok && result?.reason?.includes('already has an active authoring session')) {
  const sessionMatch = result.reason.match(/session:\s*(wba_\S+)/);
  if (sessionMatch) {
    await window.electronAPI.worldBookAgent.cancel(sessionMatch[1]);
    progressEvents.length = 0;
    thoughtStepsAccum.length = 0;
    result = await window.electronAPI.worldBookAgent.run({ ... });
  }
}
```

**修改文件：**
- `src/renderer/components/AgentCenter/hooks/useAgentDialogue.ts` — `handleWriteWorldbook` 新增残留会话自动清理 + 重试

**经验教训：**
单实例守卫模式（path → session 映射）在客户端应用中容易产生"僵尸会话"问题——用户中途退出或前序 Bug 导致会话未正常终结。调用方应具备自动检测"资源占用"错误并清理重试的能力，而非直接将错误暴露给用户。
