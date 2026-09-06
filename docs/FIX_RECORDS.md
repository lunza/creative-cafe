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

---

## §4 角色卡素材生成路径修复（Spec: add-asset-and-trait-management / Task 10）

### §4.1 【重点标记】一般图像 / 三视图错误使用图像参考（img2img）生成 — 应改为提示词 + LoRA

**现象：**
用户反馈：角色卡素材管理中，"一般图像"和"三视图"生成图片时仍使用图像参考（img2img，从角色卡提取基底图作为参考），与"角色立绘"的生成方式不一致。立绘已强制走 txt2img（提示词 + LoRA），但 general / three-view 仍走 img2img，导致生成结果受基底图约束，无法完全按提示词 + LoRA 自由生成。

**根因：**
`AssetGenerateModal.handleSingleGenerate` 的 IPC 分流条件错误——仅 `illustration` 模式调用 `sd.generateTxt2Img`，其余模式（single-expression / general / three-view）落入 `else` 分支统一调用 `sd.generateExpression`（img2img）。该 IPC 内部通过 `sdGenerationService.extractBaseImage(characterCardPath)` 提取角色卡 PNG 基底图，再走 img2img 路径生成，因此 general / three-view 实际使用了图像参考。

历史背景：注释原写"其他模式仍走 sd.generateExpression，由其内部按 modelType 分流到 txt2img 或 img2img"——但 modelType 分流仅对 qwen-image / flux2 等 NL 模型在无基底图时生效，SDXL 等主流模型仍走 img2img，导致 general / three-view 在默认配置下使用了图像参考。

**修复方案：**
翻转分流条件：仅 `single-expression` 保留 `sd.generateExpression`（img2img，表情生成需在已有角色图基础上变换表情以保持人物一致性），`illustration` / `general` / `three-view` 统一改为 `sd.generateTxt2Img`（纯文生图，提示词 + 角色 LoRA，不使用图像参考）。

可行性依据：
- `buildAssetPromptTemplate` 的 general / three-view 模板已含 `{traits}` 占位符，与 illustration 一致
- `sdGenerationService.generateTxt2Img` 内部调用 `applyTraitsAndLora` 处理 `{traits}` 替换 + LoRA 注入，与 img2img 路径逻辑一致
- `buildSdOptions()` 已透传 `characterTraits` 与 `selectedLoras: characterLoras`，txt2img 路径可直接读取
- `generateTxt2Img` 使用 `options.txt2imgWidth/txt2imgHeight` 控制尺寸，`buildSdOptions` 已提供（弹窗内 SizeSelector）

**修改文件：**
- `src/renderer/components/Character/CharacterDialogueChat/AssetGenerateModal.tsx`
  - `handleSingleGenerate` 分流条件翻转（single-expression → `generateExpression`，illustration/general/three-view → `generateTxt2Img`）
  - 生成中提示文案：素材模式显示"SD 文生图生成中"，表情模式保留"SD img2img 生成中"
  - idleDesc：illustration / general / three-view 描述改为"SD 文生图（提示词 + 角色 LoRA），不使用图像参考"
  - 文件头注释与 `buildAssetPromptTemplate` 注释更新，反映新的分流逻辑

**验证结果：**
- `npx tsc --noEmit` — 修改文件零新增错误（项目预存错误均位于无关文件：characterService / ChatStorageService / DocumentProcessorService 等）

**经验教训：**
当一个模块存在多种生成模式共享同一入口时，技术路径（txt2img vs img2img）的分流条件应严格按"是否需要图像参考"这一语义划分，而非按 mode 枚举硬编码例外。img2img 仅适用于"在已有图像基础上做局部变换"（如表情变换保持人物一致性），而素材生成（立绘/一般图像/三视图）应完全由提示词 + LoRA 驱动，避免基底图约束导致生成结果偏离用户提示词意图。

---

### §4.2 表情 Tab 缺失缩略图预览按钮 — 补齐与其他 Tab 一致的 hover 预览

**现象：**
素材管理弹窗中，立绘 / 一般图像 / 三视图 三个 Tab 的缩略图 hover 时显示眼睛图标，点击可全尺寸预览；但「表情」Tab 的情绪卡片没有此预览交互，用户无法放大查看已上传的表情图。

**根因：**
`ExpressionTabContent.renderEmotionCard` 的缩略图容器（原 `<div>` 仅包裹 `{thumbnail}`）未实现 hover 预览覆盖层，也未挂载全尺寸预览 Modal。而 `AssetGridTabContent`（立绘/一般图像）与 `ThreeViewTabContent`（三视图）均已在 Task 3 实现「缩略图 hover 眼睛图标 → 点击打开预览 Modal」模式。表情 Tab 由 ExpressionManagerModal 重构而来，重构时未同步该预览交互。

**修复方案：**
为 `ExpressionTabContent` 补齐与其他 Tab 一致的预览交互：
1. 新增 `previewImage` state + 全尺寸预览 Modal（与 `AssetGridTabContent` / `ThreeViewTabContent` 同构）
2. `renderEmotionCard` 计算 `previewUrl`（默认头像取 `avatarPath`，已上传情绪取 `imageCache[emotionKey]`，未上传为 `undefined`）
3. 缩略图容器加 `position: relative` + hover overlay（`thumbnail-hover-overlay` class，`EyeOutlined` 眼睛图标），仅当 `previewUrl` 存在时渲染
4. `setPreviewImage` 为稳定 setState setter，无需加入 `renderEmotionCard` 的 useCallback deps；`previewUrl` 依赖的 `imageCache`/`avatarPath` 已在 deps 中

**顺带清理：**
三处预览 Modal（表情/立绘/一般图像 + 三视图）的 `styles` 原写 `{ content: { padding: 0 }, body: { padding: 0 } }`，但 `content` 键在当前 antd 版本 Modal `styles` 类型中无效（TS2353，运行时被忽略，实际去 padding 靠 `body`）。统一移除无效的 `content` 键，消除 3 个 TS 错误，运行时无变化。

**修改文件：**
- `src/renderer/components/Character/CharacterDialogueChat/AssetManagerModal.tsx`
  - `ExpressionTabContent`：新增 `previewImage` state + 预览 Modal + `renderEmotionCard` 缩略图 hover 覆盖层
  - 三处预览 Modal 移除无效 `styles.content` 键（顺带清理 TS2353）

**验证结果：**
- `npx tsc --noEmit` — `AssetManagerModal.tsx` 零错误（修复前 3 个 TS2353 `styles.content` 错误，修复后清零）

**经验教训：**
组件重构（ExpressionManagerModal → `AssetManagerModal.ExpressionTabContent`）时，若原组件后续由其他 Task 增强了交互（如 Task 3 的缩略图预览），重构出的子组件需同步该增强，否则会产生 Tab 间功能不一致。同一文件内多个同构子组件的交互模式应保持统一，便于维护。

---

### §4.3 【重点标记】AI 生成特征全部落入「未分类」— Spec 显式延迟的「未来增强项」实施

**现象：**
用户点击特征管理 Tab 的「生成特征」按钮后，AI 生成的所有特征都进入「未分类」分类，其他系统分类（头部特征 / 身体特征 / 衣物配饰 / 背景环境 / 人物姿势 / 人物表情）始终为空，用户需手动逐条归类，体验差。

**根因：**
并非 Bug，而是 Spec `add-trait-category-grouping` 的「AI 集成适配」一节显式延迟的功能：

> AI 特征生成（Task 13）仍返回 `string[]`，新特征落入「未分类」桶且 `enabled=true`，用户随后手动归类（AI 自动归类为未来增强项，本期不做）。

具体技术链路：
1. `characterTraitAIService.CHARACTER_TRAIT_SYSTEM_PROMPT` 输出扁平 `tag` 列表（`white fur, dog girl, ...`），prompt 内无分类指令
2. `parseTraitsFromContent` 返回 `string[]`，无 categoryId 信息
3. `GenerateCharacterTraitsResult.traits` 类型为 `string[]`
4. `characterTraitStore.setTraits(string[])` 的 MERGE 策略第 4 步：新增项固定追加为 `{ categoryId: UNCATEGORIZED_CATEGORY_ID, enabled: true }`

因此即便 store 已支持分类体系，AI 路径产出的特征也没有分类信息可用，必然全部落入未分类。

**修复方案：** 实施 Spec 显式延迟的「AI 自动归类」增强，让 LLM 输出携带分类前缀，全链路透传到 store。

**类型契约升级：**
- 新增共享类型 `CategorizedTrait`（`{ text, categoryId }`），是 `CharacterTraitItem` 的轻量子集（无 id / enabled）
- `GenerateCharacterTraitsResult.traits`：`string[]` → `CategorizedTrait[]`
- `characterTraitStore.setTraits` 签名：`(string[])` → `(CategorizedTrait[])`
- IPC `ai:generateCharacterTraits` / `ai:recognizeImageTraits` 返回值类型同步（preload.ts / electron.d.ts），handler 透传 typed 对象无结构变化

**LLM Prompt 升级（`characterTraitAIService.ts`）：**
- `CHARACTER_TRAIT_SYSTEM_PROMPT`：输出格式由 `white fur, dog girl, ...` 改为 `head:white hair, body:dog girl, ...`，prompt 内嵌 6 个系统分类的语义说明 + 归类建议（物种→body、发色→head、瞳色→head、服饰/配饰→clothing、动物耳朵→head、尾巴/翅膀→body）
- `IMAGE_TRAIT_SYSTEM_PROMPT`：同步升级为 `category:tag` 英文格式
- 多模态 `includeImage=true` 分支的内联 system 补充语也改为「categorized tags」

**解析逻辑升级（`parseTraitsFromContent`）：**
- 返回 `CategorizedTrait[]`
- 解析「category:tag」前缀：仅在 prefix 为已知系统分类 id 时剥离，否则兜底 uncategorized
- 鲁棒性：LLM 未输出前缀 / 未知前缀 / SD tag 权重冒号（`(white hair:1.3)`）均不被误剥离
- 去重键由 `text` 升级为 `${categoryId}::${text}`

**Store MERGE 策略升级（`characterTraitStore.setTraits`）：**
1. 现有已分类项（`categoryId !== uncategorized`）→ 原样保留
2. 现有未分类项 + text 在新集合中 → **用 AI 的 categoryId 更新**（关键修复点，原策略仅保留）
3. 现有未分类项 + text 不在新集合中 → 移除
4. 新集合中不存在于现有 traits 的 → 追加为 `{ id, text, categoryId: AI's, enabled: true }`

**调用方适配：**
- `AssetManagerModal.handleAIGenerateTraits`：无代码改动（`setTraits(result.traits)` 类型自动匹配）
- `AssetGenerateModal.handleImageRecognize`：原传 `string[]`，现传 `CategorizedTrait[]`（现有 trait 透传自身 categoryId 保持原状 + 新增 trait 携带 AI categoryId）

**修改文件：**
- `src/shared/types/characterTrait.types.ts` — 新增 `CategorizedTrait` 接口
- `src/main/services/characterTraitAIService.ts` — Prompt 升级 + `parseTraitsFromContent` 返回 `CategorizedTrait[]` + `GenerateCharacterTraitsResult.traits` 类型升级 + 多模态内联补充语
- `src/main/preload.ts` — `generateCharacterTraits` / `recognizeImageTraits` 注释更新（类型透传，无运行时变化）
- `src/renderer/types/electron.d.ts` — 两个 IPC 方法返回值类型 `traits?: string[]` → `traits?: CategorizedTrait[]`，新增 `CategorizedTrait` import
- `src/renderer/stores/characterTraitStore.ts` — `setTraits` 签名升级 + MERGE 策略第 2 步改为「用 AI categoryId 更新未分类项」+ 防御性 categoryId 兜底
- `src/renderer/components/Character/CharacterDialogueChat/AssetGenerateModal.tsx` — `handleImageRecognize` 改传 `CategorizedTrait[]`，新增 `CategorizedTrait` import

**验证结果：**
- `npm run typecheck` — 所有修改文件零新增错误（项目预存错误均位于无关文件：Vector / WorldBook / setting.ts 重复标识符 / vectorStore 等）
- 业务流程：用户点击「生成特征」→ AI 输出 `head:white hair, body:dog girl, clothing:black shirt, ...` → store 据 categoryId 将特征分别放入头部特征 / 身体特征 / 衣物配饰分类，未分类桶保持空（除非 AI 未输出前缀的兜底项）

**经验教训：**
Spec 中显式标注「未来增强项，本期不做」的功能，其涉及的契约设计应在初版就预留扩展点。本次 Spec 在 v2 升级时已设计 `CharacterTraitItem.categoryId` 字段，但 AI 路径（`generateCharacterTraits` / `setTraits`）仍沿用了 v1 的 `string[]` 扁平契约，导致增强时需联动修改 service / IPC / preload / store / 两个调用方共 7 处文件。若初版即将 AI 返回类型设计为 `{ text, categoryId }[]`，本次增强仅需改 prompt + 解析逻辑两处。**类型契约的扩展点设计应与数据模型的扩展点设计同步**，避免数据模型已升级但 IO 契约仍停留在旧版本的「半升级」状态。

---

### §4.4 新增「基本特征」系统分类 — 物种/性别/内容分级独立成桶

**需求：**
原 6 个系统分类（头部 / 身体 / 衣物 / 背景 / 姿势 / 表情）中，物种（如 lucario, pokemon, furry, anthro, feral, human）与性别（female, 1girl, 1boy）、内容分级（sfw, nsfw）等角色基底属性被归入 `body`，与体型 / 肤色 / 毛色等纯身体特征混在一起。用户希望独立出一个最前置的「基本特征」分类，专门存放种族、性别、是否成人向等「整个角色的基底特征」，作为角色定义的根基。

**修复方案：** 在 `SYSTEM_TRAIT_CATEGORIES` 最前面新增 `basic`（基本特征）系统分类，将物种 / 性别 / 内容分级等基底属性从 `body` 迁移至 `basic`，`body` 收缩为纯身体特征。

**变更内容：**

1. `src/shared/types/characterTrait.types.ts`：
   - `SYSTEM_TRAIT_CATEGORIES` 由 6 个扩为 7 个，新增 `basic`（order 0），原 6 个 order 由 0..5 顺移为 1..6
   - `basic` 置于数组首位，UI 通过 `order` 升序排序后自动渲染在最前
   - 注释更新：`body` 描述移除「物种/种族」，新增「不含物种与性别，已移至 basic」

2. `src/main/services/characterTraitAIService.ts`：
   - `CHARACTER_TRAIT_SYSTEM_PROMPT`：分类体系新增 `basic`（物种 / 性别 / 内容分级）；归类建议中「物种/种族 → basic」「性别 → basic」「内容分级 → basic」；`body` 描述移除「物种/种族」改为「不含物种与性别」；示例输出新增 `basic:dog girl, basic:female`
   - `IMAGE_TRAIT_SYSTEM_PROMPT`：同步升级，并修正原示例中 `body:cat ears`（猫耳应为 head 而非 body）为 `head:cat ears`
   - 顶部 JSDoc 注释的分类标签列表新增 `basic`

**为什么不需要数据迁移：**
- 系统分类由 `SYSTEM_TRAIT_CATEGORIES` 常量定义，不写入每张角色卡的 traits.json（仅 `customCategories` 持久化），新增 `basic` 后所有角色卡立即可见该分类
- 已有 v2 数据中归入 `body` 的物种特征（如旧 AI 生成的 `body:dog girl`）保持原状不自动迁移——用户可通过 UI 的「移动特征」功能手动归入 `basic`
- 仅影响新 AI 生成的特征：新 prompt 指示物种 / 性别 / 内容分级归入 `basic`，新生成特征将自动落入该分类

**为什么不需要改 store / IPC / 解析逻辑：**
- `parseTraitsFromContent` 通过 `SYSTEM_TRAIT_CATEGORIES.map(c => c.id)` 动态构建 `validCategoryIds` 集合，新增 `basic` 自动被识别为合法前缀
- `characterTraitStore.setTraits` 的 `validCategoryIds` 同样动态构建，新增 `basic` 自动通过校验
- `AssetManagerModal.allCategories` 通过 `[...SYSTEM_TRAIT_CATEGORIES, ...customCategories, UNCATEGORIZED_CATEGORY].sort((a,b) => a.order - b.order)` 动态渲染，新增 `basic` 自动出现在最前
- IPC 通道透传 typed 对象，与具体分类 id 无关

**修改文件：**
- `src/shared/types/characterTrait.types.ts` — `SYSTEM_TRAIT_CATEGORIES` 新增 `basic`，其余 6 个 order 顺移
- `src/main/services/characterTraitAIService.ts` — 两个 prompt 新增 `basic` 分类与归类建议、示例更新、JSDoc 注释更新

**验证结果：**
- `npm run typecheck` — 修改文件零新增错误（向 `readonly TraitCategory[]` 数组追加元素 + 更新 prompt 字符串，类型不变）
- 业务流程：用户点击「生成特征」→ AI 输出 `basic:dog girl, basic:female, head:white hair, ...` → 物种 / 性别落入「基本特征」分类，体型 / 毛色等仍落入「身体特征」

**经验教训：**
系统分类体系作为「数据驱动的可扩展枚举」（`SYSTEM_TRAIT_CATEGORIES` 常量数组 + 全链路动态消费），新增分类时只要所有消费方都通过 `.map` / `.some` / spread 等动态方式迭代，就无需改动 store / IPC / 解析逻辑 / UI 渲染，仅修改常量定义与 prompt 即可。本次新增 `basic` 验证了 Spec「扩展性 Requirement: 新增系统分类 → 所有角色卡立即可见，无需迁移已有 traits.json，下游 `applyTraitsAndLora` 不受影响」的设计承诺。**数据驱动 + 动态消费是降低扩展成本的关键**，应作为分类体系 / 枚举类设计的一致模式。

---

### §4.5 【重点标记】AI 图片生成阶段 tag 数量与特征生成阶段不符 — 跨分类同文本去重键错误

**现象：**
用户反馈「特征生成阶段」AI 提取的 tag 数量与「AI 图片生成阶段」实际拼入 SD 提示词的 tag 数量不一致。具体表现为：特征管理面板显示 N 个特征，但 SD 提示词中出现重复 tag 或特征计数偏大。

**根因分析：**

特征从 AI 生成到 SD 提示词的完整链路为：
```
LLM 输出「分类:tag」列表
  → characterTraitAIService.parseTraitsFromContent 解析为 CategorizedTrait[]
  → characterTraitStore.setTraits MERGE 合并入 store（CharacterTraitItem[]）
  → AssetGenerateModal 派生 enabledTraitTexts（仅 enabled=true 项的 text 扁平化 string[]）
  → buildSdOptions 透传到 options.characterTraits
  → sdGenerationService.applyTraitsAndLora 拼接为逗号分隔字符串替换 {traits} 占位符
```

经全链路审计，**去重键不一致**是根因：

1. **`parseTraitsFromContent`（characterTraitAIService.ts）** 原去重键为 `${categoryId}::${text}`（组合键）。当 LLM 将同一 tag 归入不同分类时（如 `basic:white fur` 与 `body:white fur`），两条均通过去重保留，导致 `result.traits.length` 虚高。

2. **`setTraits`（characterTraitStore.ts）** 原入参去重键同为 `${categoryId}::${text}`。`safeTraits` 中可能出现同 `text` 不同 `categoryId` 的多条目，而 `traitsToAdd` 仅按 `text` 校验是否已存在于 `existingTexts`：
   ```typescript
   const traitsToAdd = safeTraits
     .filter((t) => !existingTexts.has(t.text))  // 按 text 校验
   ```
   若 `safeTraits` 含两条同 `text` 不同 `categoryId` 且均不在 `existingTexts`，**两条均通过 filter**，导致 store 中出现同 `text` 重复 `CharacterTraitItem`。

3. **下游消费无去重**：`enabledTraitTexts` 直接 `.map((t) => t.text)`，`applyTraitsAndLora` 直接 `.join(', ')`，均不按 `text` 去重，重复项原样进入 SD 提示词。

**SD tag 语义**：SD 提示词中 `white fur` 就是 `white fur`，与所属分类无关。同一 tag 只应出现一次。组合键去重违背此语义。

**修复方案：**

将两处去重键统一改为仅 `text`（大小写敏感），保留首次出现的 `categoryId`：

1. `characterTraitAIService.ts` → `parseTraitsFromContent`：
   ```typescript
   // 修改前：const dedupeKey = `${categoryId}::${text}`;
   // 修改后：
   if (seen.has(text)) { duplicateCount++; continue; }
   seen.add(text);
   ```
   新增 `duplicateCount` 统计，去重发生时输出日志 `[CharacterTraitAI] parseTraitsFromContent: 去重移除 X 条同文本跨分类重复 tag`。

2. `characterTraitStore.ts` → `setTraits` 入参防御性去重：
   ```typescript
   // 修改前：const key = `${t.categoryId}::${t.text}`;
   // 修改后：
   if (seen.has(t.text)) { duplicateCount++; return false; }
   seen.add(t.text);
   ```
   同样新增日志 `[characterTraitStore] setTraits: 去重移除 X 条...`。

3. `sdGenerationService.ts` → `applyTraitsAndLora` 新增诊断日志：
   ```
   [sdGenerationService] applyTraitsAndLora: 输入特征 N 条，拼接为: ...
   ```
   便于用户在主进程日志中对照「特征生成阶段 tag 数」与「图片生成阶段 tag 数」是否一致。

**为什么不需要改 `traitsToAdd` / `preservedTraits` / `newByText` 逻辑：**

- `newByText` Map 原本就按 `text` 作为 key（`if (!newByText.has(t.text))`），取首次 `categoryId`，语义正确
- `existingTexts` 原本就按 `text` 校验，语义正确
- `preservedTraits` 中 `existingTraits` 不含同 `text` 重复项（`addTrait` 已按 `text` 去重，`setTraits` 修复后也不产生重复）
- 修复 `safeTraits` 的去重键后，`traitsToAdd` 中不会再出现同 `text` 多条目，`traitsToAdd` 的 `text` 唯一性自然成立

**修改文件：**
- `src/main/services/characterTraitAIService.ts` — `parseTraitsFromContent` 去重键改为 `text` + 新增去重日志
- `src/renderer/stores/characterTraitStore.ts` — `setTraits` 入参去重键改为 `text` + 新增去重日志 + 接口 JSDoc 更新
- `src/main/services/sdGenerationService.ts` — `applyTraitsAndLora` 新增输入特征数与拼接字符串诊断日志

**验证结果：**
- `npm run typecheck` — 修改文件零新增错误（去重键从字符串拼接改为单字段比较，类型不变）
- 业务流程：AI 输出 `basic:white fur, body:white fur, head:blue eyes` → 解析去重为 2 条（`white fur` 取 `basic` 分类 + `blue eyes`）→ store 不产生重复项 → SD 提示词含 2 个唯一 tag

**经验教训：**
**去重键必须与下游消费语义对齐**。本系统中 SD tag 的语义是「同一 text 只出现一次」，与分类无关，因此全链路去重键应统一为 `text` 而非 `${categoryId}::${text}`。组合键去重在「分类+特征」数据模型中是常见陷阱——分类是元数据（组织 / 展示用），不应参与唯一性判定。设计数据模型去重键时，应从下游消费视角（「什么会被实际使用」）而非存储视角（「什么字段组合唯一」）出发。

---

### §4.6 「携带角色特征」面板分类分组 + 临时编辑/新增/删除（不持久化）

**需求：**
用户反馈 AI 图片生成弹窗（`AssetGenerateModal`）中的「携带角色特征」区域原来是一排扁平 Tag 列表，希望改进为：
1. 按分类分组展示（与素材管理面板 `AssetManagerModal` 的特征 Tab 一致，系统分类 + 自定义分类 + 未分类折叠面板）
2. 支持用户临时编辑特征文本（如特征分析时的 tag 是 `sitting`，用户可在生成图片时临时改成 `standing`）与临时启用/禁用，**仅影响本次生成，不回写 store / 角色卡**
3. 每个分类下可新增临时标签（如临时给「动作」分类加一个 `standing` 标签），也可临时删除任意标签（store 特征重置后恢复），均为临时操作不持久化

**设计要点：**

**工作副本模式（而非直接订阅 store）**：
- 新增 `editedTraits: CharacterTraitItem[] | null` 本地状态
- 弹窗打开时从 `characterTraitStore.traits` 深拷贝初始化（`characterTraits.map(t => ({...t}))`）
- `effectiveTraits = editedTraits ?? characterTraits` 驱动 `enabledTraitTexts` 派生与 UI 展示
- 弹窗关闭时置 `null`，下次打开重新从 store 同步（自动丢弃上次临时编辑）
- 用户可随时点击「重置」按钮手动从 store 重新深拷贝

**为什么不直接改 store**：store 是全局共享状态，`AssetManagerModal` 的特征 Tab 也订阅同一 store。若直接改 store 的 trait.text，用户关闭生成弹窗后修改仍保留，违背「临时编辑」语义。工作副本模式确保临时修改完全隔离在 `AssetGenerateModal` 生命周期内。

**为什么不每次 store 变化都重新深拷贝**：若用户正在编辑 `standing`，此时 store 因其他原因更新（如 AI 图片识别追加了新特征），重新深拷贝会丢失用户的 `standing` 编辑。因此采用「首次同步 + 手动重置」策略，编辑期间不自动覆盖。

**UI 交互**：
- `Collapse` 折叠面板按分类分组，每面板 header 显示分类名 + `启用数/总数`
- 所有分类默认展开（含空分类），允许用户在任意分类下新增临时标签
- 每个 trait 渲染为 `Tag`：
  - 点击 Tag 本体 → 切换 `enabled`（临时）
  - 点击 `EditOutlined` 图标 → 进入行内 `Input` 编辑模式（Enter 确认 / Esc 取消）
  - 点击 Tag 右侧 × → 临时删除（store 特征重置后恢复，临时特征永久移除）
  - 颜色：`enabled + 原始` = purple，`enabled + 已修改` = orange，`enabled + 临时新增` = cyan，`disabled` = default（灰显）
- 每个分类面板底部显示「+ 新增临时标签」虚线 Tag，点击后变为行内 Input（Enter 确认 / Esc 取消）
- 顶部显示「可临时编辑」提示 Tag + 「有未保存的临时修改」标记 + 「重置」按钮
- `hasEdits` 检测三类修改：`hasTempAdditions`（临时新增）、`hasTempDeletions`（临时删除）、`hasTextEdits`（文本修改），任一为 true 则启用「重置」按钮
- 临时新增的 trait 用 `genTraitId()` 生成 id（与 store 一致格式），但不会写入磁盘——通过 `storeIds = new Set(characterTraits.map(t => t.id))` 区分 store 特征与临时特征

**数据流**（临时编辑 → SD 提示词）：
```
用户编辑 editedTraits[i].text = 'standing'
  → effectiveTraits = editedTraits（非 null）
  → enabledTraitTexts = effectiveTraits.filter(enabled).map(text)  // 含 'standing'
  → buildSdOptions().characterTraits = enabledTraitTexts
  → applyTraitsAndLora 拼接为 '... standing ...' 替换 {traits}
```
`buildEmotionPrompt`（表情 img2img 路径）与 `buildAssetPromptTemplate`（立绘/一般图像/三视图 txt2img 路径）均通过 `enabledTraitTexts` 间接消费 `effectiveTraits`，无需额外改动。

**修改文件：**
- `src/renderer/components/Character/CharacterDialogueChat/AssetGenerateModal.tsx`：
  - 新增 `Collapse` / `EditOutlined` / `CheckOutlined` / `CloseOutlined` / `UndoOutlined` / `PlusOutlined` 导入
  - 新增 `SYSTEM_TRAIT_CATEGORIES` / `UNCATEGORIZED_CATEGORY` / `genTraitId` / `TraitCategory` / `CharacterTraitItem` 导入
  - store 订阅新增 `customCategories: traitCustomCategories`
  - 新增 `editedTraits` / `editingTraitId` / `editingText` / `addingCategoryId` / `addingText` 状态 + `effectiveTraits` 派生
  - `enabledTraitTexts` 改为从 `effectiveTraits` 派生（原为 `characterTraits`）
  - 初始化 useEffect 改用 `traitStoreCardId === characterCardId` 判断就绪（替代 `characterTraits.length > 0`），支持 0 特色角色卡也能初始化工作副本
  - 新增 handlers：`handleResetTraits` / `handleStartEditTrait` / `handleConfirmEditTrait` / `handleCancelEditTrait` / `handleToggleTraitEnabledLocal` / `handleDeleteTrait` / `handleStartAddTrait` / `handleConfirmAddTrait` / `handleCancelAddTrait`
  - 重写 `renderTraitsPanel` 为分类折叠 + 可编辑/可删除 Tag + 新增临时标签 Input 布局
  - 摘要栏 `characterTraits.length` 改为 `effectiveTraits.length`

**验证结果：**
- `npm run typecheck` — `AssetGenerateModal.tsx` 零错误（修复未使用的 `UNCATEGORIZED_CATEGORY_ID` 导入后）
- 数据流：用户临时改 `sitting → standing` → `enabledTraitTexts` 含 `standing` → SD 提示词含 `standing` → 关闭弹窗 → `editedTraits = null` → 下次打开仍为 store 原值 `sitting`

**经验教训：**
**「临时编辑」需求应使用工作副本模式而非直接修改共享 store**。工作副本（`editedTraits`）+ 优雅降级（`effectiveTraits = editedTraits ?? characterTraits`）+ 首次同步策略（避免编辑中被覆盖）三要素是处理此类「局部临时状态」的标准模式。关键决策点：何时同步 store → 工作副本（首次打开 + 手动重置），何时不同步（编辑期间），避免「自动同步覆盖用户编辑」与「修改泄漏到 store」两个极端。

### §4.7 动态场景提示词生成 IPC 通道扩展（Spec: add-dynamic-scene-prompt-generation / Task 3）

**日期：** 2026-08-05

**需求：**
Spec `add-dynamic-scene-prompt-generation` Task 2 已在主进程 `characterTraitAIService.ts` 新增 `generateDynamicScenePrompts(params)` 方法，将自然语言指令解析为三组英文 SD tag（`clothing` / `pose` / `scene`）。Task 3 需要将此能力通过 IPC 通道暴露给渲染进程，使前端 UI（Task 6 实现）能调用。

**修改文件：**
- `src/main/ipc/handlers/characterTraitAIHandlers.ts` — 在 `registerCharacterTraitAIHandlers()` 内注册新 `ipcMain.handle('ai:generateDynamicScenePrompts', ...)` handler，调用 `characterTraitAIService.generateDynamicScenePrompts(args)`，外层 try/catch 兜底返回 `{ success: false, error }`，与现有 `generateCharacterTraits` / `recognizeImageTraits` 一致
- `src/main/ipc/index.ts` — 无代码改动，仅更新注释说明 `registerCharacterTraitAIHandlers()` 已涵盖三个通道
- `src/main/preload.ts` — 在 `ai:` 命名空间内追加 `generateDynamicScenePrompts` 方法，调用 `ipcRenderer.invoke('ai:generateDynamicScenePrompts', args)`
- `src/renderer/types/electron.d.ts` — 在 `ai:` 接口内追加 `generateDynamicScenePrompts` 类型声明

**设计决策：**

1. **沿用 `ai:` 命名空间**：与现有 `generateCharacterTraits` / `recognizeImageTraits` 同组，不单独建立 `characterTraitAI` 命名空间。原因：现有 preload / electron.d.ts 已将这三个高层业务通道放在 `ai:` 下，与 `aiHandlers.ts` 的低层 `ai:request` / `ai:cancel` / `ai:listModels` 区分。

2. **类型声明策略 — 内联 vs 共享类型重导出**：
   - 主进程 `GenerateDynamicScenePromptsParams` / `GenerateDynamicScenePromptsResult` 定义于 `src/main/services/characterTraitAIService.ts`
   - 渲染进程不直接引用主进程类型（`electron.d.ts` 顶部注释已说明「主进程类型不可直接被渲染进程引用」）
   - 现有 `generateCharacterTraits` / `recognizeImageTraits` 在 `electron.d.ts` / `preload.ts` 中均使用内联类型签名
   - **决策：跟随现有模式使用内联类型**，不引入共享类型重导出。Task 3 不强制做此重构，未来若需要类型共享可移至 `src/shared/types/characterTrait.types.ts`（Spec 已为 `DynamicScenePrompt` 数据模型建立此路径）

3. **日志前缀选择**：handler 内沿用 `[CharacterTraitAIHandler]` 前缀（与文件内现有 handler 一致），service 内部使用 `[DynamicSceneAI]` 前缀以区分方法。两者在日志中可清晰区分来源。

4. **错误兜底模式**：handler 外层 try/catch 使用 `error instanceof Error ? error.message : 'Unknown error'`（与现有 handler 一致，与 spec 描述的 `error.message ?? 'Unknown error'` 语义等价）。service 内部已 try/catch 兜底所有错误为 `{ success: false, error }`，handler 再 try/catch 提供 IPC 序列化兜底，保证渲染进程永不收到 reject。

**验证结果：**
- `npx tsc --noEmit` 在四个修改文件中仅有 2 个预存在错误（`ipc/index.ts(1,1)` 的 `ipcMain` 未使用 + `preload.ts(46,43)` 的 `off` 方法类型不匹配），均与 Task 3 修改无关（`ipc/index.ts` 仅修改注释，`preload.ts` 未修改 `off` 方法）
- `characterTraitAIHandlers.ts` / `electron.d.ts` 零错误
- Task 3 修改未引入任何新的 TypeScript 错误

**无 bug，无用户反复提示。**

---

### §4.8 动态场景提示词生成 Spec 整体实施记录（Spec: add-dynamic-scene-prompt-generation / Task 1-9）

**日期：** 2026-08-05

**Spec 概述：**
为角色特征管理系统新增「动态场景提示词生成」能力，让用户通过自然语言指令让 AI 解析为三组独立的英文 SD tag（`clothing` / `pose` / `scene`），保存为命名方案后可在生成图片时一键切换，与基础特征组合后注入 SD 生成流程。该能力独立于角色「固有」基础特征，不污染基础特征数据。

**Task 实施清单（Task 1-9 全部完成）：**

| Task | 实施内容 | 实施方式 |
| --- | --- | --- |
| 1 | `DynamicScenePrompt` 共享类型 + `CharacterTraitManifestV2` 扩展 2 字段 | 子代理实施，无 bug |
| 2 | `characterTraitAIService.generateDynamicScenePrompts()` + `DYNAMIC_SCENE_SYSTEM_PROMPT` + `parseDynamicSceneResponse()` | 子代理实施，无 bug |
| 3 | IPC 通道 `ai:generateDynamicScenePrompts` 注册 + preload 暴露 + electron.d.ts 类型声明 | 子代理实施，详见 §4.7 |
| 4 | `characterTraitService.loadTraitData` / `saveTraitData` 扩展两新字段 | 子代理实施，无 bug |
| 5 | `characterTraitStore` 新增 2 state + 4 actions，修复 TS2739 | 子代理实施，无 bug |
| 6 | `AssetManagerModal` `CharacterTraitTabContent` 新增动态场景指令折叠面板 | 子代理实施，无 bug |
| 7 | `PromptBuilder.ts` 新增导出 `buildAssetPromptTemplate`，模板加占位符 | 子代理实施，最小程度突破 Task 7 指令（详见 CHANGELOG Deviations） |
| 8 | `sdGenerationService.SDGenerationOptions` 新增 3 字段 + `applyTraitsAndLora` 替换占位符 + `buildSdOptions` 透传 + 兜底 | 子代理实施，无 bug |
| 9 | 集成验证 + 文档同步 + 4 个分散 CHANGELOG 条目合并 | 当前任务 |

**Task 9 集成验证报告：**

1. **TypeScript 验证**：`npx tsc --noEmit` 总错误数 724（与项目 baseline 一致，无新增）。12 个 spec 修改文件中 9 个零错误，3 个仅含预存在错误：
   - `src/main/ipc/index.ts(1,1)` — `ipcMain` declared but never read（Task 3 仅改注释，未引入代码）
   - `src/main/preload.ts(46,43)` — `off` 方法 `Function | undefined` 类型不匹配（Task 3 仅在 ai 命名空间追加方法，未触碰 off）
   - `src/renderer/components/Character/CharacterDialogueChat/PromptBuilder.ts(703,28)` — `parseMesExample` 函数 `Property 'join' does not exist on type 'never'`（Task 7 未触碰该函数，迁移的是 `buildAssetPromptTemplate`）

2. **端到端流程静态验证（5 流程全部通过）**：
   - **类型流**：`DynamicScenePrompt` (shared) → `characterTraitService` (持久化) → `characterTraitStore` (state) → `AssetManagerModal` (UI)，各层类型对齐
   - **IPC 流**：UI 调 `window.electronAPI.ai.generateDynamicScenePrompts({ naturalLanguageInput, baseTraits })` → preload `ipcRenderer.invoke('ai:generateDynamicScenePrompts', args)` → handler → `characterTraitAIService.generateDynamicScenePrompts(args)` → 返回 `{ success, clothing, pose, scene }`，参数/返回类型对齐
   - **持久化流**：`saveDynamicScenePrompt` action → 本地 state 更新 → `get().saveTraits()` → `saveTraitData(cardId, manifest)` IPC → `characterTraitService.saveTraitData` 写盘，`dynamicScenePrompts` / `activeDynamicScenePromptId` 完整往返（loadTraitData 兜底 + saveTraitData 完整写入）
   - **SD 生成流**：激活动态方案 → `buildSdOptions` 读取 `activeDynamicScheme` → 填充 `dynamicClothing/Pose/Scene` → IPC → `applyTraitsAndLora` 替换 `{clothing}` / `{pose}` / `{scene}` 占位符，占位符名与 `PromptBuilder.ts` 一致
   - **兜底流**：无激活方案 → illustration 模式 `dynamicPose='standing'` / `dynamicScene='simple background'`（保持原模板行为）；general 模式回退 `userScene`；three-view 模板无占位符无副作用

3. **文档同步状态**：
   - `CODE_WIKI.md`：新增「动态场景提示词生成（Spec: add-dynamic-scene-prompt-generation）— 综述」章节（五层架构图 + 各 Task 实施要点表 + Task 1 / 2 / 4 / 9 详细章节），与既有 Task 3 / 5 / 6 三个独立章节互补
   - `docs/FIX_RECORDS.md`：§4.7 已记录 Task 3 实施细节，§4.8（本节）记录整体 spec 实施清单与集成验证
   - `CHANGELOG.md`：原 Task 3 / 5 / 6 / 7 四个分散条目合并为单条版本条目 `## [功能增强] - 2026-08-05 - 动态场景提示词生成（Spec: add-dynamic-scene-prompt-generation / Task 1-9）`

**无 bug，无用户反复提示。**

**经验教训：**
- **Spec 多 Task 实施时，CHANGELOG 应按 spec 维度而非 Task 维度记录**：本次 4 个分散条目（Task 3 / 5 / 6 / 7）合并为单条版本条目，便于版本追踪与回溯。Task 维度过于细碎，且同一 spec 的 Task 在同一天完成时无独立版本意义。
- **跨 Task 类型契约变更应在 Task 1 即同步修复下游**：Task 1 扩展 `CharacterTraitManifestV2` 后引入的 TS2739（v2 manifest 构造缺失两新字段）在 Task 5 才修复，期间 Task 2-4 的子代理可能遇到过类型错误。应在 Task 1 完成后立即扫描所有 `CharacterTraitManifestV2 = { ... }` 构造点并补全新字段。
- **占位符命名应在 Task 7 与 Task 8 之间保持一致**：`PromptBuilder.ts` 中 `{clothing}` / `{pose}` / `{scene}` 字面占位符必须与 `applyTraitsAndLora` 的 `result.replace(/\{clothing\}/g, ...)` 完全匹配。本次静态验证已确认两者一致，未发现命名偏差。
- **预存在错误的判定需基于 git diff 而非猜测**：Task 9 验证 3 个"预存在错误"时，通过 `git diff HEAD -- <file>` 确认错误位置均位于未修改区域（`parseMesExample` 函数、`off` 方法、`ipcMain` import），而非凭直觉判定。这是科学调试流程的体现。

---

## §5 素材/特征/动态场景缺陷修复（Spec: fix-asset-trait-and-scene-defects）

### §5.1 【重点标记】动态场景选择 UI 缺失 — AssetGenerateModal 无法直接选择方案（Task 6 + Task 7）

**现象：**
`add-dynamic-scene-prompt-generation` spec 为 `AssetManagerModal` 添加了动态场景管理 UI（保存/激活/删除方案），但**遗漏了**在 `AssetGenerateModal`（图片生成弹窗）中添加方案选择入口。用户必须先返回 `AssetManagerModal` 激活方案，再回到生成弹窗生成图片，UX 流程断裂。同时 `AssetGenerateModal` 中残留的 `userScene` 文本输入框（原 general 模式的场景输入）与动态场景方案功能重复，造成混乱。

**根因：**
`add-dynamic-scene-prompt-generation` spec 的 Task 8 已在 `AssetGenerateModal.buildSdOptions` 中订阅了 `dynamicScenePrompts` / `activeDynamicScenePromptId` state（用于填充 `dynamicClothing` / `dynamicPose` / `dynamicScene` 选项），但未订阅 `applyDynamicScenePrompt` action，也未在 UI 中添加 `<Select>` 下拉。用户在生成弹窗中无法切换激活方案。

**修复方案：**

1. **Task 6 — 新增动态场景下拉 UI：**
   - 在 `AssetGenerateModal.tsx` 的 `useCharacterTraitStore()` destructure 中补订阅 `applyDynamicScenePrompt` action
   - 在 `renderSingleMode` 的生成参数面板中（Alert 与参数概览之间）新增 `<Select>` 下拉：
     - `value` = `activeDynamicScenePromptId ?? undefined`（当前激活方案）
     - `onChange` 调用 `applyDynamicScenePrompt(id)`（allowClear 触发 `undefined` 时为 no-op，避免误清空激活状态）
     - `options` 来自 `dynamicScenePrompts.map(p => ({ label: p.name, value: p.id }))`
     - 空状态：`disabled` + `notFoundContent` = 「暂无动态场景方案，请在素材管理中添加」
   - 从 antd 导入 `Select` 组件

2. **Task 7 — 移除 userScene 文本输入框：**
   - 移除 `renderSingleMode` 中 `mode === 'general'` 条件下的 `userScene` `<Input>` UI 元素
   - 保留 `userScene` state 声明（默认 `''`），添加 `@deprecated` JSDoc 标记，仍传给 `buildAssetPromptTemplate` 作为兼容参数
   - 在 `buildSdOptions` 中移除 `else if (mode === 'general' && !dynamicScene && userScene.trim())` 回退分支，改为 general 模式无激活方案时 `dynamicScene = undefined`（`{scene}` 替换为空字符串）
   - 从 `buildSdOptions` 的 useCallback 依赖数组中移除 `userScene`
   - 更新 `handleSingleGenerate` 中的警告检查：原 `!userScene.trim()` 改为 `!activeDynamicScenePromptId`，依赖数组同步更新
   - 在 `PromptBuilder.ts` 的 `buildAssetPromptTemplate` JSDoc 中为 `_userScene` 参数添加 `@deprecated` 标签

**修改文件：**
- `src/renderer/components/Character/CharacterDialogueChat/AssetGenerateModal.tsx`
  - 导入 `Select`
  - 补订阅 `applyDynamicScenePrompt`
  - `userScene` state 添加 `@deprecated` JSDoc
  - `buildSdOptions`：移除 userScene 回退分支 + 依赖数组移除 userScene
  - `handleSingleGenerate`：警告检查改为 `activeDynamicScenePromptId` + 依赖数组更新
  - `renderSingleMode`：移除 userScene `<Input>`，新增动态场景 `<Select>` 下拉
  - `renderHeader`：更新 general 模式模板描述字符串（`{userScene}` → `{clothing}/{pose}/{scene}`）
- `src/renderer/components/Character/CharacterDialogueChat/PromptBuilder.ts`
  - `buildAssetPromptTemplate` 的 `_userScene` 参数 JSDoc 添加 `@deprecated` 标签
  - 更新 `{scene}` 占位符说明（移除「回退到 userScene」描述）

**验证：**
- `npx tsc --noEmit` 对 `AssetGenerateModal.tsx` 零错误
- `PromptBuilder.ts` 仅有预存在错误（`parseMesExample` 函数 line 703，与本次修改无关）
- 动态场景下拉在所有单次生成模式（illustration / general / three-view / single-expression）中可见
- 空状态正确显示「暂无动态场景方案，请在素材管理中添加」且不阻塞生成

**经验教训：**
- **Spec 跨组件功能添加时应同步检查所有消费方 UI**：`add-dynamic-scene-prompt-generation` 的 Task 8 已在 `AssetGenerateModal.buildSdOptions` 中订阅了动态场景 state，但遗漏了在 UI 中添加选择入口。Spec 实施时应列出所有消费同一 store state 的组件，确保 UI 入口与数据订阅同步交付。
- **废弃参数应保留签名 + 标记 @deprecated**：`userScene` state 和 `buildAssetPromptTemplate` 的 `_userScene` 参数虽不再由用户输入，但保留签名避免破坏调用方（按位置传参的调用点）。通过 `@deprecated` JSDoc 标记明确废弃原因与替代方案，便于后续维护者理解。

---

### §5.2 【重点标记】AI 生成不包含自定义分类的 tag — 系统提示词硬编码 7 个系统分类（Task 5）

**Spec:** fix-asset-trait-and-scene-defects / Task 5（实施日期 2026-08-06）

**现象：**
用户在角色特征管理中创建了自定义分类（如「纹身」id=`tattoo`、「武器装备」id=`weapon`），但 AI 生成特征时**不会为这些自定义分类生成 tag**。LLM 返回的 tag 列表仅包含 7 个系统分类（`basic` / `head` / `body` / `clothing` / `background` / `pose` / `expression`）的前缀，自定义分类下的特征完全缺失。

**根因（双端缺陷）：**

1. **系统提示词端 — `CHARACTER_TRAIT_SYSTEM_PROMPT` / `IMAGE_TRAIT_SYSTEM_PROMPT` 硬编码**：
   两个常量在 `characterTraitAIService.ts` 中以 `const` 字符串硬编码，分类体系列表与分类建议均只列出 7 个系统分类。LLM 完全不知道用户创建的自定义分类的存在，因此不会为「纹身」「武器装备」等分类生成 `tattoo:dragon tattoo` / `weapon:katana` 等带前缀的 tag。

2. **解析器端 — `parseTraitsFromContent` 的 `validCategoryIds` 仅含系统分类 id**：
   即便 LLM 偶发生成了 `tattoo:dragon tattoo`，解析器也会因为 `tattoo` 不在 `validCategoryIds` 集合中（该集合仅由 `SYSTEM_TRAIT_CATEGORIES.map(c => c.id)` 构造），将其误判为「未知前缀」，整条 tag 兜底为 `uncategorized`，前缀信息丢失。

这是一个**双端不匹配**的缺陷：提示词端不告诉 LLM 自定义分类存在，解析器端也不接受自定义分类前缀。即使其中一端修复，另一端仍会阻断功能。

**修复方案：**

1. **SubTask 5.1 — 新增动态 prompt 构建方法**：
   - `buildDynamicTraitSystemPrompt(globalCategories: TraitCategory[]): string`：合并 `[...SYSTEM_TRAIT_CATEGORIES, ...globalCategories]`，系统分类保留原详细描述（物种/性别/发色等示例），自定义分类标注「（自定义分类）」。分类建议同步追加自定义分类的「名称 → id」映射。
   - `buildDynamicImageTraitSystemPrompt(globalCategories: TraitCategory[]): string`：英文版本，与上述结构对称，面向多模态视觉模型。
   - 原 `CHARACTER_TRAIT_SYSTEM_PROMPT` / `IMAGE_TRAIT_SYSTEM_PROMPT` 常量改为 `export` 导出，保留作为**基线参考**（文档化 prompt 结构），不再直接用于生产调用。

2. **SubTask 5.2 — `generateCharacterTraits` 使用动态 prompt**：
   构建 messages 前调用 `categoryDictionaryService.loadDictionary().categories` 获取全局自定义分类，再调用 `this.buildDynamicTraitSystemPrompt(globalCategories)` 生成动态 system prompt。三个 messages 构建分支（includeImage=true 多模态 / 图片读取失败回退 / 纯文本）均使用 `dynamicSystemPrompt` 替换原硬编码常量。

3. **SubTask 5.3 — `recognizeImageTraits` 使用动态 prompt**：
   同样调用 `categoryDictionaryService.loadDictionary().categories` + `this.buildDynamicImageTraitSystemPrompt(globalCategories)`，替换原 `IMAGE_TRAIT_SYSTEM_PROMPT`。

4. **SubTask 5.4 — `parseTraitsFromContent` 接受自定义分类 id**：
   ```typescript
   // 修改前：
   const validCategoryIds = new Set(SYSTEM_TRAIT_CATEGORIES.map((c) => c.id));
   // 修改后：
   const globalCategories = categoryDictionaryService.loadDictionary().categories;
   const validCategoryIds = new Set([
     ...SYSTEM_TRAIT_CATEGORIES.map((c) => c.id),
     ...globalCategories.map((c) => c.id),
   ]);
   ```
   使 `tattoo` / `weapon` 等自定义分类 id 成为合法前缀，LLM 返回的 `tattoo:dragon tattoo` 能被正确解析为 `{ text: 'dragon tattoo', categoryId: 'tattoo' }`。

**修改文件：**
- `src/main/services/characterTraitAIService.ts`
  - 新增 import：`categoryDictionaryService` / `type TraitCategory`
  - `CHARACTER_TRAIT_SYSTEM_PROMPT` / `IMAGE_TRAIT_SYSTEM_PROMPT` 改为 `export`（基线参考）+ JSDoc 标注动态构建迁移说明
  - 新增 `buildDynamicTraitSystemPrompt(globalCategories)` 方法（中文 prompt，保留系统分类详细描述 + 自定义分类标注）
  - 新增 `buildDynamicImageTraitSystemPrompt(globalCategories)` 方法（英文 prompt，与中文版对称）
  - `generateCharacterTraits`：messages 构建前加载全局字典 + 调用动态构建方法，三个分支均使用 `dynamicSystemPrompt`
  - `recognizeImageTraits`：systemContent 构建前加载全局字典 + 调用动态构建方法
  - `parseTraitsFromContent`：`validCategoryIds` 合并全局字典自定义分类 id

**端到端追踪验证（SubTask 5.5）：**

假设全局字典有「纹身」(id: `tattoo`) 和「武器装备」(id: `weapon`)：
1. `generateCharacterTraits` 调用 `loadDictionary()` → 返回 `{ categories: [{ id: 'tattoo', name: '纹身', ... }, { id: 'weapon', name: '武器装备', ... }] }`
2. `buildDynamicTraitSystemPrompt([tattoo, weapon])` 构建的 prompt 分类列表包含 9 项（7 系统 + 2 自定义），分类建议追加「纹身 → tattoo」「武器装备 → weapon」
3. LLM 看到 prompt 后返回：`tattoo:dragon tattoo, weapon:katana, head:white hair\n---DESCRIPTION---\n...`
4. `parseTraitsAndDescription` 按 `---DESCRIPTION---` 切分，tag 部分传入 `parseTraitsFromContent`
5. `parseTraitsFromContent` 中 `validCategoryIds = Set{ 'basic', 'head', 'body', 'clothing', 'background', 'pose', 'expression', 'tattoo', 'weapon' }`
6. 解析 `tattoo:dragon tattoo`：`prefix='tattoo'` ∈ validCategoryIds → `categoryId='tattoo'`, `text='dragon tattoo'`
7. 解析 `weapon:katana`：`prefix='weapon'` ∈ validCategoryIds → `categoryId='weapon'`, `text='katana'`
8. 解析 `head:white hair`：`prefix='head'` ∈ validCategoryIds → `categoryId='head'`, `text='white hair'`
9. 最终结果：`[{ text: 'dragon tattoo', categoryId: 'tattoo' }, { text: 'katana', categoryId: 'weapon' }, { text: 'white hair', categoryId: 'head' }]`

**验证结果：**
- `npx tsc --noEmit` 对 `characterTraitAIService.ts` 零错误（原 `CHARACTER_TRAIT_SYSTEM_PROMPT` / `IMAGE_TRAIT_SYSTEM_PROMPT` 因改为 `export` 不再触发 `noUnusedLocals`）
- `categoryDictionaryService.ts` 零错误（依赖项无新增错误）
- 项目其他文件预存在错误与本次修改无关

**经验教训：**
- **Prompt 与解析器必须同步演进**：本 bug 的根因是「提示词端告诉 LLM 的分类集合」与「解析器端接受的分类前缀集合」不同步。当引入自定义分类功能时，只改解析器或只改提示词都无法修复——LLM 不会生成自定义分类前缀（提示词没告诉它），即便生成了也会被解析器丢弃。设计 LLM 驱动的功能时，提示词（指令 LLM 输出什么）与解析器（理解 LLM 输出了什么）是同一契约的两端，必须同步变更。
- **硬编码 prompt 是维护陷阱**：原 `CHARACTER_TRAIT_SYSTEM_PROMPT` 以 `const` 字符串硬编码分类列表，新增分类需修改常量字符串本身，无法在运行时注入动态数据。动态构建方法（`buildDynamicTraitSystemPrompt`）将分类列表从「编译期常量」改为「运行时拼接」，使自定义分类无需改代码即可被 LLM 识别。保留原常量作为 `export` 基线参考，既满足 `noUnusedLocals` 约束，又文档化了 prompt 的基线结构。
- **全局字典是分类的唯一真源**：本修复复用 Task 3 的 `categoryDictionaryService.loadDictionary()`，不重新实现分类读取逻辑。这与 spec「全局字典是分类的唯一读取源」设计一致——所有需要分类信息的服务（store 加载、AI prompt 构建、解析器前缀校验）都应从同一源头读取，避免数据分散导致的不一致。

---

### §5.3 【重点标记】高分辨率生成多个角色 — SD 模型在 ≥1024×1024 时缺少人物数量约束（Task 2）

**Spec:** fix-asset-trait-and-scene-defects / Task 2（实施日期 2026-08-06）

**现象：**
用户在素材生成弹窗中选择 1024×1024 或更高分辨率生成立绘/三视图时，SD 模型经常生成**多个角色**（如双胞胎、镜像分身），而非单一角色。生成结果与角色卡「单一角色」语义不符，立绘与三视图均受影响。

**根因：**
SD 模型在高分辨率（≥1024×1024）下倾向生成多个主体以填满画布。SD 1.5 系列在 512×512 ~ 768×768 区间通常生成单一角色，但分辨率提升后该倾向增强。原 `buildSdOptions` 仅透传 `{traits}` + LoRA，未注入 `1girl` / `1boy` 等人物数量约束 tag，模型自由发挥导致多角色生成。

**修复方案：**

1. **新增 `detectGenderTag(traits: CharacterTraitItem[]): '1girl' | '1boy' | null` 工具函数**（`AssetGenerateModal.tsx:277-294`）：
   - 从 `categoryId='basic' && enabled=true` 的特征中查找性别相关 tag
   - 按优先级匹配：`1girl` > `1boy` > `female` > `male` > `girl` > `boy`
   - 返回归一化的 `'1girl'` / `'1boy'` / `null`（无法判断时不注入，避免错误约束）

2. **`buildSdOptions` 新增分辨率检测**（`AssetGenerateModal.tsx:771-788`）：
   ```typescript
   const pixelCount = selectedSize.width * selectedSize.height;
   if (pixelCount >= 1024 * 1024) {
     const genderTag = detectGenderTag(effectiveTraits);
     if (genderTag && !basicTraitTexts.includes(genderTag)) {
       options.characterGenderTag = genderTag;
     } else if (!genderTag) {
       console.warn('[AssetGenerateModal] 无法从基础特征推断性别，跳过 1girl/1boy 注入');
     }
   }
   ```
   - 重复注入防护：若基础特征已含 `1girl` / `1boy`，不重复注入
   - 兜底：无法判断性别时记录警告日志，不注入（避免错误约束）

3. **`SDGenerationOptions` 新增 `characterGenderTag?: string` 字段**（`sdGenerationService.ts:160`）

4. **`applyTraitsAndLora` 在 `{traits}` 替换后注入 `characterGenderTag`**（`sdGenerationService.ts:824-833`）：
   ```typescript
   if (options.characterGenderTag && !result.includes(options.characterGenderTag)) {
     result = `${options.characterGenderTag}, ${result}`;
   }
   ```
   - 注入到 prompt 开头（SD 对 tag 位置不敏感）
   - 重复防护：`!result.includes(genderTag)` 避免与 `{traits}` 中已有的 tag 重复

**修改文件：**
- `src/renderer/components/Character/CharacterDialogueChat/AssetGenerateModal.tsx`
  - 新增 `detectGenderTag(traits)` 工具函数
  - `buildSdOptions` 新增分辨率检测 + `characterGenderTag` 填充
- `src/main/services/sdGenerationService.ts`
  - `SDGenerationOptions` 新增 `characterGenderTag?: string` 字段
  - `applyTraitsAndLora` 新增 `characterGenderTag` 注入逻辑

**验证（Task 8 静态验证 PASS）：**
- `detectGenderTag` 函数存在（`AssetGenerateModal.tsx:277-294`）
- 分辨率检测 `pixelCount >= 1024 * 1024`（`AssetGenerateModal.tsx:771-788`）
- `characterGenderTag` 字段在 `SDGenerationOptions` 中定义（`sdGenerationService.ts:160`）
- `applyTraitsAndLora` 注入逻辑在 `{traits}` 替换后（`sdGenerationService.ts:824-833`）
- 重复注入防护：`!basicTraitTexts.includes(genderTag)` + `!result.includes(genderTag)` 双重检查
- 低分辨率（<1024×1024）不注入
- 无法判断性别时 `console.warn` 记录警告，不注入

**经验教训：**
- **SD 模型分辨率与生成倾向强相关**：高分辨率画布下，SD 模型倾向生成多个主体以填满空间。在用户语义为「单一角色」的场景（立绘、三视图、表情）中，必须显式注入 `1girl` / `1boy` 人物数量约束，不能依赖模型的默认行为。
- **性别推断应从已有特征提取，而非额外询问用户**：基础特征已包含 `1girl` / `1boy` / `female` / `male` 等性别 tag（AI 特征生成会输出），从中推断比要求用户额外配置更自然。无法推断时**不注入**而非**注入默认值**（如默认 `1girl`），避免对男性角色错误约束。
- **tag 重复防护需在两处检查**：`buildSdOptions` 检查基础特征是否已含该 tag（避免设置 `characterGenderTag`），`applyTraitsAndLora` 检查 prompt 是否已含该 tag（避免 `{traits}` 展开后重复）。两处检查互补，覆盖「特征列表已含」与「prompt 文本已含」两种场景。

---

### §5.4 全局分类字典服务 + store 重构 — 自定义分类跨角色卡共享（Task 3 + Task 4）

**Spec:** fix-asset-trait-and-scene-defects / Task 3 + Task 4（实施日期 2026-08-06）

**背景：**
原 `add-trait-category-grouping` spec 将自定义分类存储在各角色卡 manifest 的 `customCategories` 字段中，导致**跨角色卡不共享**：用户在角色 A 中创建的「纹身」分类不会出现在角色 B 的分类列表中。同时，AI 特征生成（Task 5 修复的 bug）与 store 分类加载都依赖同一数据源，分散存储导致不一致风险。

**架构变更：**

1. **新建 `categoryDictionaryService.ts`**（主进程服务）：
   - 持久化路径：`{userData}/data/trait-categories.json`
   - 接口：`loadDictionary()` / `saveDictionary()` / `addCategory(name)` / `deleteCategory(id)` / `renameCategory(id, newName)` / `hasCategory(name)` / `migrateFromManifest(customCategories)`
   - 数据结构：`GlobalTraitCategoryDictionary = { version: 1, categories: TraitCategory[], updatedAt: number }`
   - 迁移逻辑：`migrateFromManifest` 按 name 大小写不敏感去重，仅追加字典中不存在的分类；全部已存在时不写盘（幂等）

2. **新建 `categoryDictionaryHandlers.ts`**（IPC handlers）：
   - 注册 `category-dictionary:load` / `:add` / `:delete` / `:rename` / `:has` 五个 IPC 通道
   - 在 `src/main/ipc/index.ts` 调用 `registerCategoryDictionaryHandlers()`
   - `preload.ts` 暴露 `window.electronAPI.categoryDictionary.*` 方法
   - `electron.d.ts` 补全类型声明

3. **重构 `characterTraitStore.ts`**：
   - 新增 `globalCategories: TraitCategory[]` state（替代从 manifest 读取 `customCategories`）
   - `loadTraits` 调用 `categoryDictionary.load()` 填充 `globalCategories`，不再从 manifest 读取 `customCategories`
   - 新增异步 actions：`createCategory(name)` / `renameCategory(id, newName)` / `deleteCategory(id)`（调用 IPC + 更新 state）
   - 删除分类时其下特征回退 `uncategorized`（与旧逻辑一致）+ 调用 `saveTraits` 持久化 traits 变更
   - `moveTrait` 校验目标分类改为读 `globalCategories`
   - `clear` 重置 `globalCategories: []`
   - `saveTraits` 不再写入 `customCategories` 字段（保留旧值以兼容）

4. **既有数据迁移**（`characterTraitService.ts`）：
   - `loadTraitData` v2 分支：当 manifest 含非空 `customCategories` 时调用 `migrateFromManifest(customCategories)` 合并到全局字典
   - 迁移失败不阻塞特征加载（catch 兜底，仅记录 warn 日志）
   - 迁移后 manifest 的 `customCategories` 字段不再作为读取源，但保留以兼容旧文件读取

5. **修改 `AssetManagerModal.tsx`**：
   - `CharacterTraitTabContent` 的 store 订阅从 `customCategories` / `addCategory` / `updateCategory` / `deleteCategory` 改为 `globalCategories` / `createCategory` / `renameCategory` / `deleteCategory`
   - `allCategories` 派生改为从 `globalCategories` 取自定义分类
   - 三个分类 CRUD handler 的 `onOk` 改为 `async` + `await` 异步 actions

**修改文件：**
- `src/shared/types/characterTrait.types.ts` — 新增 `GlobalTraitCategoryDictionary` 接口（新建文件）
- `src/main/services/categoryDictionaryService.ts` — 新建全局字典服务（新建文件）
- `src/main/ipc/handlers/categoryDictionaryHandlers.ts` — 新建 IPC handlers（新建文件）
- `src/main/ipc/index.ts` — 注册 `registerCategoryDictionaryHandlers()`
- `src/main/preload.ts` — 暴露 `categoryDictionary` 命名空间
- `src/renderer/types/electron.d.ts` — 补全 `categoryDictionary` 类型声明
- `src/main/services/characterTraitService.ts` — `loadTraitData` 新增迁移逻辑
- `src/renderer/stores/characterTraitStore.ts` — `globalCategories` state + 异步 actions + `moveTrait` / `clear` 更新
- `src/renderer/components/Character/CharacterDialogueChat/AssetManagerModal.tsx` — 订阅 + CRUD handler 适配

**验证：**
- `npx tsc --noEmit` 对所有修改文件零新增错误
- 全局字典文件 `{userData}/data/trait-categories.json` 跨角色卡共享、重启后保留
- 既有数据迁移幂等：多次加载含 `customCategories` 的旧 manifest 不会产生重复分类
- 删除分类时其下特征正确回退 `uncategorized` 并持久化

**经验教训：**
- **全局配置应独立于角色卡存储**：自定义分类是用户的偏好设置（如「纹身」「武器装备」），跨角色卡通用，不应绑定到具体角色卡。原设计将其存入 manifest 的 `customCategories` 字段，导致跨角色卡不共享且需为每张卡重复创建。提取到独立的 `{userData}/data/trait-categories.json` 后，一次创建全局生效。
- **既有数据迁移要幂等**：迁移逻辑可能在用户多次重启应用时被多次执行。`migrateFromManifest` 按 name 去重确保多次调用结果一致，全部已存在时不写盘，避免产生重复分类或冗余 I/O。
- **异步 IPC actions 需保留 state 一致性**：`createCategory` / `renameCategory` / `deleteCategory` 调用 IPC 后需同步更新本地 `globalCategories` state。`deleteCategory` 还需将受影响特征回退 `uncategorized` 并调用 `saveTraits` 持久化 traits 变更（否则下次加载会重新出现已删除分类的 trait 引用）。

---

### §5.5 裸体版三视图固定 nude tag 常量化（Task 1）

**Spec:** fix-asset-trait-and-scene-defects / Task 1（实施日期 2026-08-06）

**背景：**
原 `buildAssetPromptTemplate` 的 three-view 模板对 `*-nude` 槽位（`front-nude` / `side-nude` / `back-nude`）硬编码 `nude, naked, bare skin` 三个 tag。该列表不够完整，未包含 `completely naked` / `no clothes` / `nsfw` 等核心 nude 相关 tag，导致裸体版三视图生成结果可能不充分体现裸体特征。

**修复方案：**

1. **新增 `NUDE_FIXED_TAGS` 常量数组**（`PromptBuilder.ts:1779`）：
   ```typescript
   export const NUDE_FIXED_TAGS: readonly string[] = [
     'nude', 'naked', 'bare skin', 'completely naked', 'no clothes', 'nsfw',
   ];
   ```
   - `readonly` 防止运行时篡改
   - `export` 导出供其他模块引用（如未来需要在 UI 显示固定 tag 列表）
   - JSDoc 标注「固定包含，不可被用户配置覆盖」「nude tag 的唯一数据源（single source of truth）」

2. **修改 `buildAssetPromptTemplate` 的 three-view 模板**（`PromptBuilder.ts:1855-1864`）：
   ```typescript
   const isNude = !!targetSlot?.endsWith('-nude');
   const viewName = (isNude ? targetSlot!.replace('-nude', '') : targetSlot) || 'front';
   const nudeTags = isNude ? `, ${NUDE_FIXED_TAGS.join(', ')}` : '';
   return `${viewName} view, full body, {traits}${nudeTags}, character sheet, white background, high quality`;
   ```
   - `*-nude` 槽位拼接 `NUDE_FIXED_TAGS.join(', ')`（6 个 tag）
   - 穿衣版（`front` / `side` / `back`）不拼接 nude tag，行为与原一致

**修改文件：**
- `src/renderer/components/Character/CharacterDialogueChat/PromptBuilder.ts`
  - 新增 `NUDE_FIXED_TAGS` 常量数组（line 1779）
  - three-view 模板 `*-nude` 槽位使用 `NUDE_FIXED_TAGS.join(', ')`（line 1863）
  - JSDoc 注释说明「固定包含，不可被用户配置覆盖」+ spec 引用

**验证：**
- `NUDE_FIXED_TAGS` 常量在 `PromptBuilder.ts` 中定义，包含 6 个 tag
- three-view 模板对 `*-nude` 槽位拼接 `NUDE_FIXED_TAGS.join(', ')`
- 穿衣版三视图不包含 nude tag，行为与原一致
- JSDoc 注释说明「固定包含，不可被用户配置覆盖」

**经验教训：**
- **固定 tag 应使用常量数组而非硬编码字符串**：原 `nude, naked, bare skin` 硬编码在模板字符串中，修改需定位具体位置，且无法在 UI 或其他模块引用。提取为 `NUDE_FIXED_TAGS` 常量后，tag 列表集中管理，新增/删除 tag 只需改一处。
- **`readonly` 防止运行时篡改**：固定 tag 列表不应在运行时被修改（如用户配置或代码 bug 导致的 push/splice）。`readonly string[]` 类型在编译期阻止修改操作，保证数据不变性。

---

### §5.6 端到端验证总结（Task 8 + Task 9）

**Spec:** fix-asset-trait-and-scene-defects / Task 8 + Task 9（实施日期 2026-08-06）

**Task 8 验证结果（静态代码审查 PASS）：**

| 检查点 | 状态 | 验证位置 |
|--------|------|----------|
| 8.1 illustration + 激活动态场景 | PASS | `AssetGenerateModal.tsx:742-751` + `PromptBuilder.ts:1848` + `sdGenerationService.ts:814-816` |
| 8.2 general + 激活动态场景 | PASS | 同上（general 模板 `PromptBuilder.ts:1853`） |
| 8.3 three-view 不含新占位符 | PASS | `PromptBuilder.ts:1855-1864`（仅含 `{traits}` + nudeTags） |
| 8.4 无激活方案兜底 | PASS | illustration: `standing` / `simple background`（`AssetGenerateModal.tsx:754-759`）；general: `{scene}` 替换为空字符串（`sdGenerationService.ts:805-807`） |
| 8.5 空逗号清理 | PASS | `sdGenerationService.ts:838-846` do-while 循环 |

**Task 9 集成验证结果：**

1. **tsc 验证（SubTask 9.1）PASS**：
   - `npx tsc --noEmit` 对所有 spec 修改文件**零新增错误**
   - 项目预存在错误（与本次修改无关）：
     - `ipc/index.ts:1` `ipcMain` unused（预存在）
     - `preload.ts:46` `off` 方法类型不兼容（预存在）
     - `writing/PromptBuilder.ts` 4 个 unused import 错误（不同文件，预存在）
     - `CharacterDialogueChat/PromptBuilder.ts:703` `parseMesExample` `Array.isArray` 类型收窄错误（预存在，Task 1 diff 未触及该函数 — 经 git stash + git diff 验证）

2. **端到端流程验证（SubTask 9.2）**：
   - 三视图 nude tag：`NUDE_FIXED_TAGS` 在 `*-nude` 槽位正确拼接
   - 高分辨率 1girl 注入：`detectGenderTag` + `characterGenderTag` 链路完整
   - 自定义分类跨角色：`categoryDictionaryService` 全局字典 + `globalCategories` state
   - 动态场景选择 → 生成：`<Select>` 下拉 + `applyDynamicScenePrompt` + `buildSdOptions` 透传
   - 运行时验证（Electron 集成测试）推迟到用户手动测试

3. **既有数据迁移验证（SubTask 9.3）**：
   - `characterTraitService.loadTraitData` v2 分支调用 `migrateFromManifest` 合并 `customCategories` 到全局字典
   - 迁移幂等：按 name 去重，多次调用结果一致
   - 迁移失败不阻塞特征加载（catch 兜底）
   - 运行时验证（真实旧 traits.json 文件）推迟到用户手动测试

4. **文档更新（SubTask 9.4 + 9.5）**：
   - `CODE_WIKI.md`：Task 5 已更新（lines 1208, 1213）；本次新增 Task 1/2/3/4 架构描述
   - `docs/FIX_RECORDS.md`：§5.1（Task 6+7）+ §5.2（Task 5）已有；本次新增 §5.3（Task 2）+ §5.4（Task 3+4）+ §5.5（Task 1）+ §5.6（Task 8+9 验证）
   - `CHANGELOG.md`：Task 5 已有独立条目；本次整合为 spec 级别条目覆盖全部 9 个 Task

**重点标记的三个 bug 修复（SubTask 9.5）：**

1. **动态场景选择缺失**（§5.1，Task 6+7）：`AssetGenerateModal` 缺少动态场景方案选择 UI，用户必须返回 `AssetManagerModal` 激活方案
2. **AI 不生成自定义分类 tag**（§5.2，Task 5）：系统提示词硬编码 7 个系统分类，LLM 不知道用户自定义分类
3. **高分辨率多角色**（§5.3，Task 2）：SD 模型在 ≥1024×1024 时缺少 `1girl`/`1boy` 人物数量约束，生成多个角色

**经验教训：**
- **Spec 驱动开发应在 spec 阶段列出所有消费同一 store state 的组件**：`add-dynamic-scene-prompt-generation` 的 Task 8 已在 `buildSdOptions` 中订阅动态场景 state，但遗漏了 UI 选择入口（§5.1 bug）。Spec 实施时应列出所有消费同一 state 的组件，确保 UI 入口与数据订阅同步交付。
- **LLM 驱动功能的提示词与解析器必须同步演进**（§5.2 bug）：提示词告诉 LLM 输出什么、解析器理解 LLM 输出了什么，是同一契约的两端，必须同步变更。
- **SD 模型分辨率与生成倾向强相关**（§5.3 bug）：高分辨率画布下 SD 倾向生成多个主体，单一角色场景必须显式注入人物数量约束。

---

### §5.7 【重点标记】自定义分类下特征仍被归入「未分类」+「携带角色特征」面板不显示自定义分类（Task 5 半成品 bug）

**Spec:** fix-asset-trait-and-scene-defects / Task 5 后续修复（实施日期 2026-08-06）

**现象（用户反馈）：**
用户在角色特征管理中新建自定义分类「武器」(id=`weapon`)，让 AI 生成特征时：
1. AI 正确返回了 `weapon:gun`（说明 §5.2 的 Task 5 修复生效，prompt 端 + parseTraitsFromContent 端都已识别 `weapon` 分类）
2. **但** `gun` 特征最终被存入「未分类」(uncategorized) 而非「武器」分类
3. **同时** 在 `AssetGenerateModal` 的「携带角色特征」面板中，自定义分类「武器」的折叠面板不显示，导致用户无法在生成图片时勾选 / 编辑 `gun` 特征

**根因分析（双端残留缺陷）：**

§5.2 修复 Task 5 时只覆盖了**两端**（提示词端 + parseTraitsFromContent 解析端），但**遗漏了下游的两处二次消费点**：

1. **`characterTraitStore.setTraits` 的二次校验**（`characterTraitStore.ts:726-729`）：

   ```typescript
   // 修复前：
   const validCategoryIds = new Set([
     ...SYSTEM_TRAIT_CATEGORIES.map((c) => c.id),
     UNCATEGORIZED_CATEGORY_ID,
   ]);
   ```

   `setTraits` 在合并 AI 返回的 `CategorizedTrait[]` 到 store 前，对每个 `categoryId` 做防御性兜底：不在 `validCategoryIds` 中的归为 `UNCATEGORIZED_CATEGORY_ID`。但这个 `validCategoryIds` **没有合并 `get().globalCategories` 中的自定义分类 id**，导致 `parseTraitsFromContent` 正确产出的 `{ text: 'gun', categoryId: 'weapon' }` 在 `setTraits` 二次校验时被兜底为 `uncategorized`。

   这构成一个**半成品 bug**：上游解析器修了，下游 store 校验没修，最终用户感知与未修复一致。

2. **`AssetGenerateModal.renderTraitsPanel` 的分类列表派生**（`AssetGenerateModal.tsx:347, 1600-1604`）：

   ```typescript
   // 修复前：
   const { traits: characterTraits, customCategories: traitCustomCategories, ... } = useCharacterTraitStore();
   // ...
   const allCategories: TraitCategory[] = [
     ...SYSTEM_TRAIT_CATEGORIES,
     ...traitCustomCategories,  // ← 旧字段，Task 4 后 store 不再写入新值
     UNCATEGORIZED_CATEGORY,
   ].sort((a, b) => a.order - b.order);
   ```

   Task 4 重构了 `characterTraitStore`，将自定义分类从 `customCategories`（角色卡 manifest 字段）迁移到 `globalCategories`（全局字典 state），但 `AssetGenerateModal` 的 `renderTraitsPanel` **没有跟随重构**：仍订阅旧字段 `customCategories`，而 store 中 `customCategories` 永远为 `[]`（Task 4 后不再更新）。结果 `allCategories` 不包含自定义分类，折叠面板不显示「武器」「纹身」等分类，用户无法在生成弹窗中管理这些分类下的特征。

   `AssetManagerModal.tsx` 的 `CharacterTraitTabContent` 在 Task 4 时已正确改为订阅 `globalCategories`，但同一文件夹下的 `AssetGenerateModal` 被遗漏。

**修复方案：**

1. **`characterTraitStore.ts:726-734` — `setTraits` 合并 `globalCategories`**：

   ```typescript
   // 修复后：
   const validCategoryIds = new Set([
     ...SYSTEM_TRAIT_CATEGORIES.map((c) => c.id),
     ...get().globalCategories.map((c) => c.id),  // 新增
     UNCATEGORIZED_CATEGORY_ID,
   ]);
   ```

   使 `weapon` / `tattoo` 等自定义分类 id 通过二次校验，AI 返回的 `weapon:gun` 完整保留 `categoryId: 'weapon'` 进入 store。

2. **`AssetGenerateModal.tsx:345-357` — 订阅改为 `globalCategories`**：

   ```typescript
   // 修复后：
   const {
     traits: characterTraits,
     globalCategories: traitGlobalCategories,  // 改订阅新字段
     ...
   } = useCharacterTraitStore();
   ```

3. **`AssetGenerateModal.tsx:1602-1610` — `allCategories` 派生改为 `traitGlobalCategories`**：

   ```typescript
   // 修复后：
   const allCategories: TraitCategory[] = [
     ...SYSTEM_TRAIT_CATEGORIES,
     ...traitGlobalCategories,  // 改用新字段
     UNCATEGORIZED_CATEGORY,
   ].sort((a, b) => a.order - b.order);
   ```

   使「武器」「纹身」等自定义分类的折叠面板在「携带角色特征」面板中正确显示。

**修改文件：**
- `src/renderer/stores/characterTraitStore.ts` — `setTraits` 的 `validCategoryIds` 合并 `get().globalCategories`
- `src/renderer/components/Character/CharacterDialogueChat/AssetGenerateModal.tsx` — store 订阅从 `customCategories` 改为 `globalCategories`；`allCategories` 派生改用 `traitGlobalCategories`

**验证结果：**
- `npx tsc --noEmit` — 两个修改文件零错误（项目预存在错误不变：`writing/PromptBuilder.ts` 4 个 + `CharacterDialogueChat/PromptBuilder.ts:703` 1 个，与本次修改无关）
- 端到端追踪验证（静态 PASS）：
  1. AI 返回 `weapon:gun, head:white hair` →
  2. `parseTraitsFromContent`（§5.2 Task 5 已修）解析为 `[{ text: 'gun', categoryId: 'weapon' }, { text: 'white hair', categoryId: 'head' }]` →
  3. `setTraits` 二次校验 `weapon` ∈ `validCategoryIds`（含 `globalCategories` 的 `weapon`）✓，保留 `categoryId: 'weapon'` →
  4. `AssetGenerateModal.renderTraitsPanel` 派生 `allCategories` 含「武器」分类（来自 `traitGlobalCategories`）✓，渲染「武器」折叠面板 →
  5. `gun` 特征出现在「武器」面板下，用户可勾选 / 编辑 / 临时新增同类标签

**经验教训：**
- **数据流的每一层校验都需同步更新数据源**：本 bug 与 §5.2 同源——分类体系的「合法 id 集合」从「系统分类」扩展为「系统分类 + 全局字典自定义分类」时，所有用到该校验的消费点都必须同步更新。§5.2 修了 `parseTraitsFromContent` 的 `validCategoryIds`，但漏修了 `setTraits` 的同名 `validCategoryIds`（变量名相同但作用域不同，容易遗漏）。**审计时应全局搜索 `validCategoryIds` / `SYSTEM_TRAIT_CATEGORIES` 等关键变量，逐处确认是否需要合并 `globalCategories`**。
- **Store 重构时所有消费方必须同步迁移**：Task 4 将 `customCategories` 迁移到 `globalCategories` 时，`AssetManagerModal` 已同步迁移，但 `AssetGenerateModal` 被遗漏。**重构 store 字段时应全局搜索所有订阅该字段的组件**（`grep customCategories src/renderer/`），逐个迁移，避免「同一文件夹下两个组件一个迁移一个没迁移」的半成品状态。
- **半成品 bug 的隐蔽性**：本 bug 在 §5.2 Task 5 静态验证时未被发现，因为 Task 5 的端到端追踪验证止于 `parseTraitsFromContent` 输出，没有继续追踪到 `setTraits` 的二次校验。**端到端验证应覆盖完整数据流**（AI 输出 → 解析器 → store action → store state → UI 派生），而非止于中间某一环。

---

### §5.8 【重点标记】生成中参数面板被 loading 遮挡 — `AssetGenerateModal` 重构为左右两栏布局

**Spec:** fix-asset-trait-and-scene-defects / 后续 UX 改进（实施日期 2026-08-06）

**现象（用户反馈，两轮）：**
1. 第一轮：用户在 `AssetGenerateModal` 中点击「生成」按钮后，「正在生成xxx图」的 loading 框替代了参数面板（动态场景下拉、参数概览、正/负面提示词、生成按钮），用户在生成过程中无法查看参数。
2. 第二轮（澄清）：用户进一步指出要做**整个参数区域**（包括「携带角色特征」面板、SizeSelector、警告等所有未被遮挡的部分）与图片的左右布局，而不仅仅是 `renderSingleMode` 内部的左右分栏。

**根因：**
原 Modal body 结构是**上下垂直堆叠**——`renderHeader` / `renderTraitsPanel` / `SizeSelector` / 警告 / `renderSingleMode` 顺序排列，而 `renderSingleMode` 内部又是**互斥分支**（idle / generating / success / failed 四个分支各自返回完整 JSX）。参数面板只在 idle 分支中存在，`generating` / `success` / `failed` 分支都不包含参数面板，导致状态切换时参数面板被完全替代。

```typescript
// 原 Modal body 结构（上下堆叠）
{!initializing && (
  <>
    {renderHeader()}
    {renderTraitsPanel()}
    <SizeSelector ... />
    {renderSdUnavailableAlert()}
    {renderAdetailerWarning()}
    {mode === 'batch-expression' ? renderBatchMode() : renderSingleMode()}
    {/* ↑ renderSingleMode 内部互斥分支：idle 含参数面板，generating/success/failed 不含 */}
  </>
)}
```

**修复方案：Modal body 整体左右两栏布局**

将 Modal body（single 模式）重构为左右两栏，**所有参数区域**（包括 `renderHeader` / `renderTraitsPanel` / `SizeSelector` / 警告 / 参数面板）都在左栏永远显示，右栏只显示状态/图片：

```
┌────────────────────────────────────┬──────────────────────────┐
│ 左栏：所有参数区域（永远显示）        │ 右栏：状态/图片（互斥）   │
│  - renderHeader（角色名 + 模式说明） │  - idle: 引导提示 + 图标  │
│  - renderTraitsPanel（携带角色特征） │  - generating: Spin      │
│  - SizeSelector（尺寸选择）          │  - success: 图片预览      │
│  - renderSdUnavailableAlert         │  - failed: 错误提示       │
│  - renderAdetailerWarning           │                          │
│  - renderParamsColumn:              │                          │
│      Alert + 动态场景下拉 + 参数概览 │                          │
│      + 正/负面提示词 + 生成按钮      │                          │
└────────────────────────────────────┴──────────────────────────┘
```

**关键改动：**

1. **提取 `renderParamsColumn` 与 `renderStatusColumn` 为顶层方法**：
   - 原 `renderSingleMode` 内部的 `renderParamsColumn` / `renderStatusColumn` 是闭包，提取为组件级方法，移除各自分支上的列级样式（`flex` / `padding` / `borderRight`），由 Modal body 的列容器统一提供
   - 删除 `renderSingleMode` 函数（不再需要）

2. **Modal body 重构为左右两栏**（仅 single 模式）：
   ```typescript
   {!initializing && (
     mode === 'batch-expression' ? (
       // 批量模式：保持原上下式（无「参数 + 状态」并行需求）
       <>{renderHeader()}{renderTraitsPanel()}<SizeSelector/>{...}{renderBatchMode()}</>
     ) : (
       // 单次模式：左右两栏
       <div style={{ display: 'flex', gap: 0, alignItems: 'stretch' }}>
         {/* 左栏：所有参数区域（60% 宽，包括携带角色特征等） */}
         <div style={{
           flex: '1 1 60%', minWidth: 0,
           display: 'flex', flexDirection: 'column', gap: 12,
           padding: '0 12px 0 0',
           borderRight: '1px solid rgba(255, 255, 255, 0.06)',
         }}>
           {renderHeader()}
           {renderTraitsPanel()}
           <SizeSelector ... />
           {renderSdUnavailableAlert()}
           {renderAdetailerWarning()}
           {renderParamsColumn()}
         </div>
         {/* 右栏：状态/图片（40% 宽） */}
         <div style={{
           flex: '1 1 40%', minWidth: 0,
           display: 'flex', flexDirection: 'column', gap: 12,
           padding: '0 0 0 12px',
         }}>
           {renderStatusColumn()}
         </div>
       </div>
     )
   )}
   ```

3. **左栏宽度 60% / 右栏 40%**：
   - 左栏需要更多空间容纳 `renderTraitsPanel`（携带角色特征折叠面板，可能含很多分类与特征 chip）+ 提示词 TextArea
   - 右栏只需容纳 256×256 图片预览或 Spin loading，40% 足够
   - `flex: '1 1 60%'` + `minWidth: 0` 确保两栏能正确收缩
   - `alignItems: 'stretch'` 使两栏等高，避免某一栏内容少时出现空白底部
   - `borderRight` 半透明分隔线符合暗色主题

4. **`renderParamsColumn` 生成中行为**（与第一轮实现一致）：
   - `isGenerating` 时所有输入控件（动态场景下拉、正/负面提示词）`disabled`
   - 生成按钮 `disabled={sdStatus !== 'available' || isGenerating}` + `loading={isGenerating || initializing}` + 文案切换（idle: 「生成」/ generating: 「生成中...」）

5. **`renderStatusColumn` 状态互斥**（与第一轮实现一致）：
   - `success` → 图片预览 + 计数器 + 保存/重新生成/关闭按钮
   - `failed` → 错误 Alert + 重新生成/关闭按钮
   - `generating` → Spin loading + 进度文字
   - `idle` → 引导提示「RobotOutlined 图标 + 点击左侧「生成」按钮开始 + 生成过程中参数面板始终可见，可随时查看与调整」

6. **Modal width**：620px → 960px（容纳两栏）

**未改动的部分：**
- `renderHeader` / `renderTraitsPanel` / `SizeSelector` / `renderSdUnavailableAlert` / `renderAdetailerWarning` 的内部实现不变，只是从「上下堆叠」改为「统一放入左栏」
- `renderBatchMode` 完全不变（批量模式仍是上下式）
- `Modal` 的 `styles.body` 配置不变（`maxHeight: calc(100vh - 160px)` + `overflowY: auto`）
- `footer` 的「关闭」按钮逻辑不变（生成中 disabled）

**修改文件：**
- `src/renderer/components/Character/CharacterDialogueChat/AssetGenerateModal.tsx`
  - `Modal width: 620 → 960`
  - 删除 `renderSingleMode` 函数，提取 `renderParamsColumn` + `renderStatusColumn` 为顶层方法
  - Modal body 的 `{!initializing && (...)}` 块重构：batch 模式保持原结构，single 模式改为左右两栏（左栏 60% 放所有参数区域，右栏 40% 放状态/图片）
  - 左栏参数面板在 `isGenerating` 时所有输入 `disabled`，生成按钮 `loading` + 文案切换
  - 右栏新增 idle 提示状态（图标 + 引导文字）

**验证结果：**
- `npx tsc --noEmit` — `AssetGenerateModal.tsx` 零错误（项目预存在错误均位于无关文件）
- 静态布局验证：
  - idle 状态：左栏显示所有参数（renderHeader + 携带角色特征 + SizeSelector + 警告 + 参数面板），右栏显示「点击左侧生成按钮开始」引导
  - generating 状态：**左栏所有参数区域仍可见**（包括携带角色特征面板，输入控件 disabled，生成按钮 loading），右栏显示 Spin
  - success 状态：左栏参数仍可见（用户可调整参数后点「重新生成」），右栏显示图片预览
  - failed 状态：左栏参数仍可见（用户可调整参数后重试），右栏显示错误
- 端到端追踪（静态 PASS）：用户在生成中可查看**整个参数区域**（包括携带角色特征、SizeSelector、动态场景下拉、参数概览、正/负面提示词），不会被 loading 遮挡

**经验教训：**
- **状态机 UI 设计应区分「参数」与「状态展示」**：原设计把参数面板作为 idle 状态的一部分，与 generating / success / failed 互斥，导致参数在状态切换时被替代。正确做法是把**永远需要可见的内容**（参数面板）与**状态相关的内容**（loading / 结果 / 错误）分离到不同区域，状态切换只影响状态区域。
- **左右布局的范围要覆盖所有参数区域，而非只覆盖参数面板**：第一轮修复只把 `renderSingleMode` 内部改为左右两栏，但 `renderHeader` / `renderTraitsPanel` / `SizeSelector` / 警告仍在两栏之上，用户感觉布局不一致。**左右布局的范围应该是「整个参数区域」与「图片/状态」**，包括所有参数相关的 UI 元素（携带角色特征、SizeSelector 等），而非只覆盖最底层的参数面板。用户反馈「包括没有被遮挡的部分」明确指出了这一点。
- **互斥分支与并行展示的取舍**：当 UI 有多个状态且某些内容需要跨状态保持可见时，应使用**分区布局**（左右 / 上下）而非**互斥分支**。互斥分支适合「每个状态完全独立」的场景（如批量生成模式的 idle / generating / complete），并行展示适合「参数 + 状态」类工作流。
- **生成中禁用输入控件而非隐藏**：生成中用户不能修改参数（会导致状态不一致），但应能**查看**参数。正确做法是 `disabled` 输入控件而非隐藏，让用户在等待时仍可预览当前参数配置，便于规划下一次生成。

---

### §5.9 视角镜头下拉选择（CameraAngleSelector + {camera} 占位符）

**Spec:** 无独立 spec（用户直接需求，实施日期 2026-08-06）

**需求背景：**
用户希望在图片生成组件（`AssetGenerateModal`）中加入「视角镜头」下拉选择，预置 SDXL/Pony 系列模型支持的所有视角镜头标签（如 `wide shot` / `from above` / `dutch angle` 等），选中后注入到生成提示词。

**【重点标记 - 经用户反馈重构】选择模式演进：**
- **初版（已废弃）**：单选 `Select` + 4 个 `OptGroup` 分组，每次只能选 1 个 tag。用户反馈「四个类别是不是可以混用？比如 full body + from above」，经分析确认**不同类别之间可自由组合**（距离 + 角度 + 方向 = 完整视角描述），**同一类别内大多互斥**（full body vs close-up 冲突）。
- **二版（4 独立下拉）**：4 个独立单选下拉（2x2 grid），每个类别各选 1 个（或「不指定」），选中的非空 tag 按顺序拼接为逗号分隔字符串注入 `{camera}`。天然避免同类互斥，又支持跨类组合。
- **终版（模式默认值注入）**：用户进一步指出「既然有视角镜头下拉，模板里写死的视角 tag（立绘的 full body、表情的 portrait+looking at viewer）就不需要写死了」。经分析确认这还能修复一个**真实冲突 bug**——立绘模板写死 `full body` + 用户在 {camera} 选 `close-up` → prompt 含 `full body, ..., close-up` 自相矛盾。重构为：
  - 立绘模板移除 `full body`，`{camera}` 提到最前；表情模板移除 `portrait` + `looking at viewer`，加 `{camera}`
  - `AssetGenerateModal.getCameraDefaultForMode(mode)` 按模式返回默认值：立绘=`full body`，表情=`portrait, looking at viewer`，一般图像=无默认
  - 弹窗打开 / 模式切换时 `useEffect([open, mode])` 自动初始化 `selectedCameraAngle` 为模式默认值
  - 不调整 = 原行为（默认值等价原写死 tag）；调整 = 覆盖（非叠加），无冲突
- **教训**：视角镜头本质是多维度组合，单选会限制表达能力；按维度拆分独立下拉才符合 SD prompt 工程的实际用法。模式语义核心 tag（如立绘的 full body）可改为下拉默认值而非写死，既保留模式语义又支持用户自定义。

**注入方式（用户确认）：**
新增 `{camera}` 占位符（与现有 `{clothing}` / `{pose}` / `{scene}` 模式一致），由 `sdGenerationService.applyTraitsAndLora` 统一替换。不采用「追加到正面提示词末尾」的简单方案，以保持架构规整。

**SDXL/Pony 视角镜头标签来源：**
基于 Danbooru 训练标签（Pony / SDXL anime 系列模型语义基础），共 4 组 38 个预设标签：

| 分组 | 标签数 | 示例 |
| --- | --- | --- |
| 镜头距离 / 取景范围（Shot Scale） | 12 | extreme long shot / wide shot / full body / cowboy shot / close-up / extreme close-up ... |
| 垂直角度（Camera Angle - 高低） | 9 | eye-level shot / high angle shot / from above / from below / bird's-eye view / worm's-eye view / top-down view ... |
| 水平视角（Direction） | 5 | from front / from side / profile / 3/4 view / from behind |
| 特殊构图 / 镜头风格（Special） | 6 | dutch angle / dynamic angle / pov / over-the-shoulder shot / fisheye / looking at viewer |

**实现链路（与现有动态场景占位符完全对称）：**

1. **`CameraAngleSelector.tsx`**（新建，`src/renderer/components/Character/CharacterDialogueChat/`）
   - **4 个独立单选 `Select`**（2x2 grid 布局），分别对应镜头距离 / 垂直角度 / 水平视角 / 特殊构图四个类别
   - 每个 `Select` 含「不指定」placeholder + `allowClear`，每项含中文标签 + 英文 tag + Tooltip 说明
   - 选中的非空 tag 按 `shotScale → verticalAngle → direction → special` 顺序拼接为逗号分隔字符串
   - **完全受控组件**：无内部 state，`parseValue(value)` 从拼接字符串反向解析 4 个类别选中状态；`handleCategoryChange` 替换该类别 tag 后重新拼接调用 `onChange`。弹窗重置（value=''）可立即同步
   - Props: `value: string`（逗号分隔拼接串，如 `"full body, from above, from front"`）/ `onChange: (combined: string) => void` / `disabled?: boolean`
   - 设计参考 `SizeSelector.tsx`（暗色主题 + inline styles + 项目 CSS 变量）
2. **`PromptBuilder.ts` `buildAssetPromptTemplate`**
   - illustration 模板追加 `{camera}`：`full body, {pose}, {traits}, {clothing}, {scene}, {camera}, high quality, best quality, masterpiece`
   - general 模板追加 `{camera}`：`{traits}, {clothing}, {pose}, {scene}, {camera}, high quality, best quality`
   - three-view 模板**不含** `{camera}`（固定 front/side/back view，避免与视角冲突）
3. **`sdGenerationService.ts`**
   - `SDGenerationOptions` 接口新增 `dynamicCamera?: string` 字段
   - `applyTraitsAndLora` 新增 `result.replace(/\{camera\}/g, () => cameraStr)`（与 `{clothing}` / `{pose}` / `{scene}` 共用替换 + 逗号清理路径）
4. **`AssetGenerateModal.tsx`**
   - 新增 `selectedCameraAngle` state（空字符串 = 未选择）
   - 左栏 `SizeSelector` 下方渲染 `CameraAngleSelector`（仅单次模式显示，批量模式不显示以避免无副作用的误导）
   - `buildSdOptions` 透传 `dynamicCamera: selectedCameraAngle.trim() || undefined`（空字符串转 undefined，与 dynamicClothing 等保持一致语义）
   - 弹窗关闭时重置 `selectedCameraAngle` 为空字符串

**no-op 语义说明（与现有动态场景 Select 行为一致）：**
- three-view 模板不含 `{camera}` → 选择视角后 `{camera}` 替换为 no-op（字符串中无占位符，replace 不生效）
- 表情模板（`buildExpressionGenerationPrompt`）默认不含 `{camera}` → 选择视角后同样 no-op
- 这与现有动态场景 Select 在 three-view / 表情模式的 no-op 行为完全一致（见 §5.1 注释「三视图模式：模板不含 {clothing}/{pose}/{scene} 占位符，选择方案无副作用」）

**修改文件：**
- `src/renderer/components/Character/CharacterDialogueChat/CameraAngleSelector.tsx` — 新建组件（4 组 38 个预设标签）
- `src/renderer/components/Character/CharacterDialogueChat/PromptBuilder.ts` — `buildAssetPromptTemplate` illustration / general 模板追加 `{camera}` + 占位符链路文档更新
- `src/main/services/sdGenerationService.ts` — `SDGenerationOptions` 新增 `dynamicCamera?: string` + `applyTraitsAndLora` 新增 `{camera}` 替换 + 逗号清理注释更新
- `src/renderer/components/Character/CharacterDialogueChat/AssetGenerateModal.tsx` — 导入组件 + `selectedCameraAngle` state + 左栏 UI（仅单次模式）+ `buildSdOptions` 透传 `dynamicCamera` + 关闭重置 + 依赖数组更新 + renderHeader 模板预览文案更新

**验证结果：**
- `npx tsc --noEmit` — 修改文件零新增错误（`CameraAngleSelector.tsx` 重构后无错误；`PromptBuilder.ts:703` 的 `parseMesExample` 类型错误为预存在，与本次改动无关）
- 静态链路验证（PASS）：用户在 4 个下拉分别选 `full body` / `from above` / `from front` / 不指定 → `selectedCameraAngle='full body, from above, from front'` → `buildSdOptions` 透传 `dynamicCamera` → `applyTraitsAndLora` 替换 `{camera}` → 最终 prompt 含 `full body, from above, from front` 三个 tag
- 空选择验证（PASS）：全部未选择时 `selectedCameraAngle=''` → `dynamicCamera=undefined` → `cameraStr=''` → `{camera}` 替换为空串 → 逗号清理移除多余逗号
- 重置同步验证（PASS）：弹窗关闭 `setSelectedCameraAngle('')` → `parseValue('')` 返回 4 个类别全空 → 4 个 Select 显示 placeholder「不指定」（完全受控组件，无内部 state 滞留）

**经验教训：**
- **【重点标记】多维度标签应按维度拆分独立下拉，而非单选+分组**：视角镜头由距离/角度/方向/特殊构图 4 个独立维度组成，不同维度可自由组合（full body + from above），同维度内互斥（full body vs close-up）。初版做成单选+OptGroup 分组导致无法组合（选 full body 就不能加 from above），经用户反馈才重构为 4 独立下拉。教训：设计标签选择 UI 前应先分析标签的维度结构与互斥关系，维度独立则下拉独立。
- **完全受控组件优于内部 state + useEffect 同步**：4 个下拉的选中状态完全派生自 `props.value`（`parseValue` 反向解析），任一下拉变更时重新拼接调用 `onChange`。无需 `useState` + `useEffect` 监听外部 value，避免了「内部 state 与 props 不同步」和「useEffect 循环更新」两类常见 bug。弹窗重置（value=''）能立即反映到 UI。
- **新增占位符应完全复用现有替换 + 清理路径**：`{camera}` 没有独立实现替换逻辑，而是与 `{clothing}` / `{pose}` / `{scene}` 共用同一段 `result.replace(...)` + `do-while` 逗号清理代码。这保证了空值处理的幂等性，避免引入新的清理 bug。从单选重构为 4 独立下拉时，下层链路（PromptBuilder / sdGenerationService / AssetGenerateModal 透传）零改动，因为 `{camera}` 替换逻辑本就支持任意逗号分隔字符串。
- **下拉组件的 no-op 语义应与现有同类组件一致**：动态场景 Select 已确立「三视图/表情模式选择无副作用」的先例。`CameraAngleSelector` 终版扩展到 illustration / general / 表情（SDXL）模板均含 `{camera}`，仅三视图不渲染（视角程序化）+ NL 表情模板不含（句子语义）为 no-op。
- **【终版更新】模式默认值注入修复了 full body+close-up 冲突 bug**：初版给立绘加 `{camera}` 但未移除写死的 `full body`，导致用户选 `close-up` 时 prompt 含 `full body, ..., close-up` 自相矛盾。终版移除写死 tag 改为 `{camera}` 默认值注入（立绘默认 full body，表情默认 portrait+looking at viewer），用户改选时是覆盖而非叠加，根除冲突。教训：新增可配置参数后须检查与模板写死值的同类冲突。

---

### §5.10 【重点标记】三视图多角色/多视角 collage bug — `character sheet` tag 根因修复

**Spec:** 无独立 spec（用户反馈 bug，实施日期 2026-08-06）

**Bug 现象（用户反馈）：**
三视图生成经常出现「一张图上出现多个角色」的情况：
- 一张主视图图片上同时出现角色的主视图 + 上半身 + 身体部位特写
- 一张图里出现该角色的穿衣/不穿衣立绘（通常是左右布局）

**根因分析：**
三视图正面模板原为：`` `{viewName} view, full body, {traits}, character sheet, white background, high quality` ``

其中 **`character sheet`** tag 是元凶。在 Danbooru 训练数据（Pony / SDXL anime 系列模型语义基础）中，`character sheet`（又名 `reference sheet` / `turnaround`）天然指「角色设定合集图」——典型样式就是**一张图上展示多视角/多表情/多服装**。当 prompt 同时含 `front view`（单视角）和 `character sheet`（多视角合集），模型收到矛盾信号：
- `front view` + `full body` → 单一正面全身视图
- `character sheet` → 多视角合集（front + side + back + closeups + 穿衣/不穿衣）

`character sheet` 作为更强的构图指令通常会胜出，导致模型生成 collage（多角色/多视角/多服装并排）。

**修复方案（正面 + 负面双管齐下）：**

1. **正面模板修复**（`PromptBuilder.ts` `buildAssetPromptTemplate` three-view 分支）：
   - 移除 `character sheet`（根因 tag）
   - 新增 `solo`（Danbooru 标准 tag，强化「图中只有单个角色」）
   - 保留 `white background`（干净参考风格，不引导多视角）
   - 保留 `full body`（角色设定图标准，三视图固定全身）
   - 修复后模板：`` `{viewName} view, full body, solo, {traits}{nudeTags}, white background, high quality` ``
2. **负面提示词修复**（`AssetGenerateModal.tsx` 负面初始化 effect）：
   - 三视图模式（`mode === 'three-view'`）无论用户是否自定义负面，都追加多角色/多视角约束：
     `multiple views, multiple characters, multiple girls, multiple boys, split screen, collage, character sheet, 2girls, 3girls`
   - 覆盖 default 与 userNegative 两种来源（bug 修复优先于用户配置的完全自由）
   - 其它模式不追加（不影响立绘/表情/一般图像）

**为什么三视图不能改用 {camera} 下拉（与 §5.9 立绘/表情不同）：**
三视图的 `{viewName} view` 是**程序化循环**的（按 targetSlot 取 front/side/back），不是用户可选的。角色设定图要求三个视角正交对齐，若用户能给「侧视图」槽位选 `from above`，会破坏 character sheet 一致性。故三视图视角固定写死，不接入 `{camera}` 下拉（下拉在三视图模式不渲染）。

**修改文件：**
- `src/renderer/components/Character/CharacterDialogueChat/PromptBuilder.ts` — `buildAssetPromptTemplate` three-view 分支：移除 `character sheet`，加 `solo` + 注释说明根因
- `src/renderer/components/Character/CharacterDialogueChat/AssetGenerateModal.tsx` — 负面提示词初始化 effect：三视图模式追加 `threeViewExtraNegative`；renderHeader 三视图模板预览文案更新；idleDesc 三视图描述更新（移除「character sheet 风格」）

**验证结果：**
- `npx tsc --noEmit` — 修改文件零新增错误（`PromptBuilder.ts:703` 的 `parseMesExample` 类型错误为预存在）
- 静态链路验证（PASS）：三视图生成 → 正面 `front view, full body, solo, {traits}, white background, high quality` + 负面追加 `..., multiple views, multiple characters, ..., collage, character sheet, ...` → 模型收到「单角色 + 单视角」强信号
- **待用户运行时验证**：实际 SD 生成效果（多角色/多视角 collage 是否消除）需启动 SD WebUI 手动测试三视图，符合项目「Native Module Test Gap Convention」

**经验教训：**
- **【重点标记】SD tag 的训练数据语义可能与其字面含义不符**：`character sheet` 字面看是「角色设定图」（我们想要的），但在 Danbooru 训练数据中它实际指「多视角合集图」（我们不想要的）。选用 SD tag 时不能只看字面含义，必须了解其在训练数据中的实际语义。类似陷阱：`reference sheet` / `turnaround` / `model sheet` 也有同样的多视角合集倾向。
- **正面 + 负面双管齐下修复 SD 生成偏差**：仅移除正面 `character sheet` 可能不够（模型仍可能从 `full body` + `white background` 联想到设定图风格），故同时在负面追加 `multiple views` / `collage` / `character sheet` 等约束，从两个方向强化「单角色单视角」信号。这是 SD prompt 工程的常见做法。
- **bug 修复类负面约束应覆盖用户自定义配置**：三视图多角色是已知 bug，即使用户自定义了负面提示词，也应追加多角色约束（而非完全尊重用户配置放任 bug）。这与「用户自定义优先」的一般原则有张力，但 bug 修复优先级更高。

### §5.11 【重点标记】Danbooru/e621 标签库审计 — 系统全局 tag 下划线格式修正 + 无效 tag 清理

**背景：**
用户下载了 Danbooru/e621 merged autocomplete tag list（Civitai 模型 950325，2026-03-01 版，317,600 个 tag），保存于 `G:\AI\sd-webui-forge-neo\models\Stable-diffusion\Furry\tags\`。用于验证系统中所有写死的 SD prompt tag 是否被 NoobAI（molKeunMix 的基础模型，用完整 Danbooru + e621 数据集训练）覆盖。

**审计过程：**
编写 Python 脚本批量在 merged CSV 中验证 87 个写死 tag（CameraAngleSelector 32 + PromptBuilder 模板 14 + NUDE_FIXED_TAGS 6 + baseNegative 12 + threeViewExtraNegative 9 + EMOTION_PROMPT_MAP in_heat 条目 14）。

验证策略：先查下划线版本（`full_body`），再查原始版本（`full body`），最后查别名。

**审计结果：**

| 维度 | 数量 | 说明 |
|---|---|---|
| 总 tag 数 | 87 | |
| 有效 | 67 (77%) | 在标签库中找到（下划线版本或别名匹配） |
| 无效 | 20 (23%) | 不在标签库中，需替换或删除 |
| 需改下划线 | 44 | 当前用空格版本，Danbooru 标准是下划线 |

**关键发现：**
1. **Danbooru tag 用下划线 `_`，不是空格**：`full body` → `full_body`。SD 的 CLIP tokenizer 将下划线当作字符处理，与训练数据格式一致时效果最佳。
2. **电影术语 tag 不被 Danbooru 支持**：`extreme long shot` / `medium shot` / `eye-level shot` / `over-the-shoulder shot` / `dynamic angle` / `ground level shot` 等是电影分镜术语，不在 Danbooru（动漫图库）标签体系中，模型几乎不响应。
3. **质量前缀虽不在标签库但模型理解**：`high quality` / `best quality` / `masterpiece` 不在 Danbooru 标签库中，但 NoobAI 训练时将它们作为质量标签注入每张图片的 caption（NoobAI README 推荐前缀 `masterpiece, best quality, newest`），模型理解这些 tag。**保留不变**。
4. **NUDE_FIXED_TAGS 含 3 个重复别名**：`naked` / `completely naked` / `no clothes` 在标签库中均为 `nude` 的别名（alias），重复注入浪费 prompt token 预算，无增益。
5. **`character sheet` 的 Danbooru 标准名是 `model_sheet`**：在负面提示词中应使用 `model_sheet`（count=45203）。

**修正措施：**

CameraAngleSelector.tsx（32 → 24 个 tag）：
- **删除 9 个无效 tag**：extreme long shot / medium wide shot / medium shot / medium close-up / eye-level shot / top-down view（count=55 极低频）/ ground level shot / dynamic angle / over-the-shoulder shot
- **替换 5 个名称**：`from front` → `front_view`（count=193K）/ `high angle shot` → `high-angle_view`（count=31K）/ `low angle shot` → `low-angle_view`（count=67K）/ `3/4 view` → `three-quarter_view`（count=55K）/ `back view` → `from_behind`（别名匹配，count=295K）
- **全部改为下划线版本**：full_body / wide_shot / cowboy_shot / upper_body / lower_body / from_above / from_below / bird's-eye_view / worm's-eye_view / from_side / dutch_angle / looking_at_viewer / extreme_close-up
- **补充 1 个新 tag**：`selfie`（自拍视角，count=45K）

PromptBuilder.ts：
- NUDE_FIXED_TAGS 精简：6 个 → 3 个（删除 naked / completely naked / no clothes 三个 nude 别名，保留 nude + bare_skin + nsfw）
- 表情模板 defaultTemplate：`simple background` → `simple_background`
- baseNegative：多词 tag 改下划线（bad_anatomy / multiple_faces / extra_digits / bad_proportions / mutated_hands / missing_fingers）
- 三视图模板：`full body` → `full_body` / `white background` → `white_background` / `${viewName} view` → `${viewName}_view`

AssetGenerateModal.tsx（6 处同步修改）：
- 表情模板 positivePromptTemplate 默认值：`looking at viewer` → `looking_at_viewer` / `simple background` → `simple_background`
- baseNegative：与 PromptBuilder 同步改下划线
- threeViewExtraNegative：改下划线 + `character sheet` → `model_sheet` + 删除 `multiple characters`（不在标签库，已有 multiple_girls/boys 替代）
- 兜底值：`simple background` → `simple_background`
- getCameraDefaultForMode：`full body` → `full_body` / `portrait, looking at viewer` → `portrait, looking_at_viewer`

**保留不变的 tag（不在标签库但 SD 社区通用，模型理解）：**
- 质量前缀：`high quality` / `best quality` / `masterpiece` / `detailed face`（NoobAI 训练时注入，README 推荐使用）
- 负面通用：`ugly` / `low quality` / `mutated_hands` / `missing_fingers`（SD 社区通用负面，NoobAI README 负面含 `low quality`）
- 分级 tag：`nsfw`（NoobAI 训练时注入，README 负面含 `nsfw`）

**验证结果：**
- `npx tsc --noEmit` — 修改的 3 个文件零新增错误（`PromptBuilder.ts:703` 的 `parseMesExample` 类型错误为预存在，与本次修改无关）
- 修正后 CameraAngleSelector 24 个 tag 全部在标签库中确认有效（附 count 值在 desc 中供参考）
- **待用户运行时验证**：下划线版本 vs 空格版本的实际生成差异需手动对比测试（符合 Native Module Test Gap Convention）

**经验教训：**
- **【重点标记】Danbooru tag 标准格式是下划线 `_`**：训练数据中 tag 用下划线连接（如 `full_body` / `from_above`），推理时也应使用下划线版本与训练数据一致。虽然 SD 的 CLIP tokenizer 有时能将空格版本分词为等效 token，但下划线版本更精确可靠。**选用 tag 时务必查阅标签库确认标准格式**。
- **电影/摄影术语 ≠ Danbooru tag**：`medium shot` / `eye-level shot` / `over-the-shoulder shot` 等是电影分镜术语，Danbooru（动漫图库）不使用这些 tag。Danbooru 有自己的视角描述体系（`cowboy_shot` / `from_above` / `dutch_angle`）。**选用视角 tag 时应以 Danbooru 标签库为准，而非摄影教材**。
- **别名重复注入无增益**：`naked` / `completely naked` / `no clothes` 都是 `nude` 的 Danbooru 别名。CLIP 编码后它们可能映射到相同或相似的 token，重复注入不会增强效果，反而浪费 prompt token 预算。**应使用标准名（canonical name），一个概念一个 tag 即可**。
- **标签库是验证 tag 有效性的权威工具**：Danbooru/e621 merged 标签库（317,600 tags）包含每个 tag 的出现次数（count），count 越高模型越敏感。通过对比标签库可以快速发现无效 tag 和低频 tag（如 `top_down` count=55，模型几乎不响应；`extreme_close-up` count=111，低频但保留因无替代）。
- **质量前缀是 SD 训练框架注入的「元 tag」**：`masterpiece` / `best quality` 等不在 Danbooru 标签库中，但 kohya 等训练框架会在训练时将它们作为质量标签注入到每张图片的 caption。这类 tag 对所有 Danbooru 训练的模型有效，不需要在标签库中查找验证。

---

## §6 本地标签自动推荐（Spec: implement-local-tag-autocomplete）

### §6.1 实现记录 — 8 个 Task 完整执行（无 Bug）

**Spec 范围**：开发本地标签自动推荐功能，覆盖数据处理、输入交互、推荐逻辑、排序规则、界面展示、性能、错误处理 7 个需求点。基于本地 Danbooru/e621 标签库（317,600 tags，§5.11 审计时使用的同一份 CSV）提供实时标签推荐。

**Task 清单**：
- Task 1：共享类型定义（`src/shared/types/tag.types.ts`，8 个类型：TagInfo / TagMatchType / TagSearchResult / TagSortBy / TagSearchRequest / TagSearchResponse / TagLoadStatus / TagReloadResult）
- Task 2：主进程 TagAutocompleteService（CSV 解析 + Map 索引 + 子串匹配 + 三种排序 + 延迟加载 + reload）
- Task 3：IPC 通道注册（`tag:search` / `tag:getLoadStatus` / `tag:reload` / `tag:setCsvPath` 共 4 个 handler + preload 暴露 + electron.d.ts 类型声明）
- Task 4：AppSetting 配置块（`TagAutocompleteConfig` 接口：`{ enabled, csvPath, sortBy }` + `defaultSetting.tagAutocomplete` 默认值）
- Task 5：TagAutocomplete 组件（`Common/TagAutocomplete.tsx`，antd AutoComplete + debounce 150ms + 排序切换 Dropdown + notFoundContent 优先级 + 降级 Input）
- Task 6：Settings 配置面板（`TagAutocompleteSettings.tsx`，CSV 路径选择 + 开关 + 排序 + 加载状态展示 + 重新加载按钮）
- Task 7：集成到 AssetGenerateModal（替换「输入临时标签」Input 为 TagAutocomplete，L1938-1978）
- Task 8：性能验证 + 文档更新

**关键设计决策**：

1. **延迟加载采用 await 模式（非同步返回 loading）**：spec 描述「加载期间返回 loading 状态」，但实现选择 `await ensureLoaded()` 让首次查询阻塞等待加载完成后自动执行。原因：避免前端需要轮询/重试，简化交互。`getLoadStatus()` 单独暴露 loading 态供设置面板使用。

2. **matchType 简化为三种（非四种）**：spec 描述四种匹配类型（prefix > startsWith > includes > alias），实现合并 prefix 与 startsWith（startsWith 是 prefix 的子集，`lowerName.startsWith(queryLower)` 已覆盖），简化为 prefix > includes > alias。

3. **onTagSelect 行为：不退出新增模式**：spec 要求「选中后清空输入框 + 触发回调」，AssetGenerateModal 集成时选择「清空输入框但保留新增模式」，允许用户连续添加多个 tag（体验更流畅）。退出新增模式仍可通过 Escape / ✓ / ✗ 按钮触发。详见 CODE_WIKI.md Task 7 章节「onTagSelect 选中后不退出新增模式（方案 A）」。

4. **TagAutocomplete 透传 onPressEnter / onKeyDown / autoFocus**：原 AssetGenerateModal 的 Input 有 `onPressEnter`（Enter 确认）和 `onKeyDown`（Escape 取消）回调。TagAutocomplete 内嵌 Input 不直接暴露这些，需扩展 props 透传，确保降级开关关闭时（普通 Input 模式）行为一致。

5. **tag:setCsvPath 与 tag:reload 语义等价**：两者内部都调用 `tagAutocompleteService.reload(csvPath)`，差别仅在入参是否必填。提供独立通道便于语义区分（「切换路径」vs「重新加载」）。

6. **AutoComplete 不绑定 onChange（Task 5 重点标记）**：antd AutoComplete 选中后先触发 `onSelect` 再触发内部 `onChange`（携带选中值）。若同时绑定 `onSearch`（内含 `onChange?.(query)`）与 AutoComplete 的 `onChange`，选中后内部 onChange 会用选中值覆盖 `onSelect` 中设置的 `''`，导致输入框无法清空。故组件仅在 `onSearch` 中同步输入值，AutoComplete 不绑定 `onChange`，清空逻辑由 `onSelect` 独占处理。

7. **query state + queryRef 双轨（Task 5 重点标记）**：`notFoundContent` 需根据当前 query 是否为空决定文案，而 ref 变更不触发重渲染。故维护 `query` state（驱动渲染）+ `queryRef`（供 `sortBy` useEffect 读取最新值，避免把 query 列入依赖造成搜索抖动）。

**性能验证**（静态分析，Task 8）：
- 主进程子串匹配延迟：< 50ms（31.7 万条 Map 遍历 + `includes`，复杂度 O(n)，n=317,600）
- 端到端输入响应延迟：~210ms（debounce 150ms + IPC 传输 ~5ms + 主进程查询 ~50ms + 渲染 ~5ms）< 300ms ✓
- 内存占用：约 50-80MB（Map 索引 31.7 万条 TagInfo）
- 加载耗时：约 1-2 秒（`readline` 流式逐行解析 + Map.set，不阻塞主进程其他 IPC）
- ⚠️ 真实运行时性能依赖 Electron 集成测试（参照 Native Module Test Gap Convention）

**无 Bug 记录**：本次实现过程顺利，无反复调试问题，无需重点标记。Task 5 的两个「重点标记」（AutoComplete 不绑定 onChange + query state/queryRef 双轨）属于设计决策而非 Bug，标记原因是为后续维护者解释「为什么不按 antd 常规用法绑定 onChange」。

### §6.2 补充优化 — CSV 标签库预置到 docs/ 目录

**变更背景**：原始实现中 `DEFAULT_CSV_PATH` 硬编码为开发机绝对路径（`G:\AI\sd-webui-forge-neo\...`），用户在其他机器上首次使用时必然因文件不存在而失败。用户反馈「CSV 预置在本系统内的 docs 文件夹下」，要求将标签库随项目分发。

**修改内容**：
1. 将 CSV 文件（`danbooru_e621_merged_2026-03-01_pt20-ia-dd-ed-spc.csv`，约 8MB）复制到 `docs/` 目录
2. `src/main/services/tagAutocompleteService.ts` 新增 `resolveBundledCsvPath()` 函数动态解析路径：
   - 优先 `app.getAppPath()/docs/<filename>`（生产环境 = 安装目录）
   - 降级 `__dirname/../../../docs/<filename>`（开发环境 = 项目根目录）
   - 与 `logPathService.getLogBaseDir` 路径解析策略一致
3. `src/renderer/components/Settings/TagAutocompleteSettings.tsx` UI 优化：
   - 顶部说明改为「系统已内置标签库，无需额外配置」
   - CSV 路径 placeholder 改为「留空使用内置标签库，或点击右侧按钮选择自定义 CSV 文件」
   - `handleReload` 允许空路径（不再报「请先选择 CSV 标签库文件」警告，改为重新加载内置标签库）

**csvPath 留空语义**：`setting.tagAutocomplete.csvPath=''` 时主进程 `TagAutocompleteService` 自动回退到内置 `docs/` 标签库。用户可在 Settings 面板选择自定义 CSV 文件覆盖内置库。

### §6.3 ⚠️ 重点 — 集成遗漏修复：AssetManagerModal「输入新特征 tag」入口未集成 TagAutocomplete

**发现过程**：用户反馈「自动提示功能无效，通过角色特征——输入新特征的输入框测试的」。经排查发现：
- Spec `implement-local-tag-autocomplete` Task 7 仅将 TagAutocomplete 集成到 `AssetGenerateModal.tsx` 的「新增临时标签」入口（L1946）
- **遗漏了 `AssetManagerModal.tsx` 中 `CharacterTraitTabContent` 的「输入新特征 tag」入口**（L2982，placeholder=`"输入新特征 tag，如 white fur, blue eyes"`）
- 该入口使用普通 antd `<Input>` 组件，未接入 TagAutocomplete，因此用户在此输入框中键入文字时不会出现推荐下拉

**根因**：Spec Task 7 的集成清单不完整。原 Spec 只提到「AssetGenerateModal 的临时标签 Input」，未覆盖 AssetManagerModal 的特征管理面板中的同类输入框。这是 Spec 编写时的覆盖盲区，非组件本身 Bug。

**排查方法（TRAE-debugger 科学调试）**：
1. 静态审计 IPC 注册 / preload 暴露 / 组件实现 / rc-select onSearch 触发条件 — 均正常，未发现断点
2. 在 TagAutocomplete 组件中添加 6 处 `console.log` 插桩 + 主进程 6 处 `logger.info` 插桩
3. 用户重启应用复现后反馈「DevTools Console 中完全没有 `[TagAutocomplete-DBG]` 日志输出」
4. **关键证据**：TagAutocomplete 组件根本未渲染 → 用户测试的输入框不是集成了 TagAutocomplete 的那个
5. 全局搜索 placeholder 包含 "tag" 或 "特征" 的 Input → 定位到 `AssetManagerModal.tsx:2982` 的遗漏点
6. 间接佐证：`logs/tag-autocomplete-service/` 目录不存在 = `tagAutocompleteService.search()` 从未被调用

**修复内容**：
1. `AssetManagerModal.tsx` 新增 `import { TagAutocomplete } from '../../Common'`（L66）
2. 将 `CharacterTraitTabContent` 底部添加区的 `<Input>`（L2979-2990）替换为 `<TagAutocomplete>`（L2992-3009）：
   - `onTagSelect`：选中推荐 tag 后直接调用 `store.addTrait(tag.name, newTraitCategoryId)` 添加到当前分类并清空输入框，保留焦点允许连续添加（与 AssetGenerateModal 集成模式一致）
   - `onPressEnter`：透传 `handleAddTrait`，用户输入自定义文本后回车仍可添加
   - `showSortButton={false}`：简化底部添加区 UI
   - `style={{ flex: '1 1 200px' }}`：保留原有 flex 布局
3. 清理调试插桩代码（10 处，确认根因后全部移除）

**经验教训**：
- ⚠️ Spec 编写集成类任务时，必须全局搜索所有同类输入框（按 placeholder / 组件类型 / 功能场景），避免「只集成一个入口」的覆盖盲区
- 当用户反馈某功能"无效"时，首先确认用户测试的具体入口是否在集成清单内，而非直接假设组件本身有 Bug
- 本问题排查耗时较长，根因是 Spec 集成清单不完整导致用户测试了未集成的入口；若一开始询问「具体在哪个输入框测试」可大幅缩短排查路径

### §6.4 ⚠️ 重点 — CSV 解析正则导致 96% 标签被丢弃（31.7 万仅加载 1.2 万）

**发现过程**：用户反馈「为啥 32 万标签实际只加载了一万多」。检查主进程日志：
```
[INFO] [tag-autocomplete-service] 标签库加载完成: 12182 tags from ...danbooru_e621_merged_2026-03-01_pt20-ia-dd-ed-spc.csv
```
CSV 文件实际 317,600 行，但只加载了 12,182 条（3.84%），**96% 的行被丢弃**。

**根因**：`tagAutocompleteService.ts` 的 `CSV_LINE_REGEX` 正则要求第 4 列（别名）必须用双引号包裹：
```typescript
// 旧正则（只匹配带引号的别名）
const CSV_LINE_REGEX = /^([^,]+),(\d+),(\d+)(?:,"([^"]*)")?$/;
```

但实际 CSV 文件有**两种别名格式**：
| 格式 | 样本 | 占比 | 旧正则 |
|------|------|------|--------|
| 带引号 | `solo,0,9074865,"alone,female_solo,single,solo_female"` | 3.8% | ✅ 匹配 |
| **不带引号** | `shirt,0,2937876,shirts` | 11.0% | ❌ 丢弃 |
| 末尾逗号空别名 | `closed_mouth,0,1671151,` | 85.1% | ❌ 丢弃 |

旧正则的 `(?:,"([^"]*)")?` 要求第 4 列必须以 `,"` 开头且以 `"` 结尾，导致不带引号的别名和空别名行全部不匹配。

**修复内容**：
1. 正则改为只匹配前 3 列 + 可选的第 4 列原始字符串（不强制引号）：
   ```typescript
   const CSV_LINE_REGEX = /^([^,]+),(\d+),(\d+)(?:,(.*))?$/;
   ```
2. 新增 `parseAliases(raw)` 方法，兼容 4 种别名列格式：
   - 带引号（`"alone,female_solo"`）→ 剥离引号 + 还原 `""` 转义
   - 不带引号（`shirts`）→ 直接使用
   - 空字符串（末尾逗号）→ 返回 `[]`
   - undefined（无第 4 列）→ 返回 `[]`

**验证**：用分析脚本对 317,600 行全量验证，修复后匹配率 **100%**（317,600/317,600，0 丢弃）。

**性能影响**：
- 内存：tagMap 从 1.2 万条增至 31.7 万条（预估 50-80MB，可接受）
- 查询：遍历量从 1.2 万增至 31.7 万，预估单次 search 50-150ms（仍在 spec 要求的 300ms 以内）
- 加载时间：预估 1-2 秒（readline 流式 + Map.set）

**经验教训**：
- ⚠️ 编写 CSV/数据解析正则时，**必须先用样本数据验证匹配率**，不能假设数据格式统一。本次 CSV 中 96% 的行用了与正则假设不同的格式，导致大量数据静默丢弃。
- ⚠️ 加载日志只输出 `count`（匹配条数），**没有同时输出 `total lines` 和 `skipped lines`**，导致"只加载了 3.8%"的问题无法在日志层面被发现。今后数据加载日志应同时输出「总行数 / 成功 / 跳过」三项。
- 当用户报告"数据量不对"时，**第一步应对比文件实际行数与加载日志中的 count**，差值即为被解析逻辑丢弃的数据量。

## §7 RAG 标签库（Spec: rag-tag-library-for-ai-trait-generation）

> Spec: `.trae/documents/rag-tag-library-for-ai-trait-generation.md`
> 创建日期: 2026-08-06
> 目标：防止 AI 生成 Danbooru/e621 标签库以外的无效 tag。基于已有 31.7 万标签的 `tagAutocompleteService.tagMap`，将标签向量化后语义检索，AI 生成特征时注入 top-K 相关标签作为参考，引导 LLM 使用有效标签。

### §7.1 方案选型 — RAG 向量检索（vs Prompt 注入 / 后置过滤）

用户提出需求后，分析了三种方案：

| 方案 | 实现复杂度 | Token 成本 | 准确性 | 用户体验 |
|------|----------|----------|------|--------|
| 1. 全量标签注入 Prompt | 低 | 极高（32 万 tag ~ 200 万 token） | 高 | 不可行（超模型上下文） |
| 2. 后置过滤（LLM 输出后筛除无效 tag） | 中 | 0 | 低（删完可能剩很少） | 差（输出被大幅删改） |
| 3. **RAG 向量检索**（用户选定） | 高 | 中（仅 top-K ~ 40 tag） | 高 | 好（LLM 主动输出有效 tag） |

最终选定方案 3：基于 EmbeddingService + VectorStoreService 现有基础设施，将标签库向量化后用角色描述语义检索，注入参考段落。

### §7.2 实现记录 — 12 个 Task 完整执行（无 Bug）

| # | 任务 | 文件 | 状态 |
|---|------|------|------|
| 1 | 共享类型定义 | `src/shared/types/tagRag.types.ts` | ✅ |
| 2 | 扩展 VectorSourceType.TAG_LIBRARY | `src/main/types/vectorConfig.ts` | ✅ |
| 3 | defaultSetting 追加 tagRag 配置块 | `src/shared/settings.ts` | ✅ |
| 4 | TagRagProgressEmitter 实现 | `src/main/services/tagRagProgressEmitter.ts` | ✅ |
| 5 | **TagRagService 核心实现** | `src/main/services/tagRagService.ts` | ✅ |
| 6 | tagAutocompleteService 新增 getAllTags + 事件广播 | `src/main/services/tagAutocompleteService.ts` | ✅ |
| 7 | IPC handlers 注册（tagRag:* 命名空间） | `src/main/ipc/handlers/tagRagHandlers.ts` | ✅ |
| 8 | preload 暴露 tagRag API | `src/main/preload.ts` + `src/renderer/types/electron.d.ts` | ✅ |
| 9 | characterTraitAIService 注入 RAG 参考段落 | `src/main/services/characterTraitAIService.ts` | ✅ |
| 10 | TagRagSettings 渲染面板 | `src/renderer/components/Settings/TagRagSettings.tsx` | ✅ |
| 11 | 单元测试（24 个用例全部通过） | `src/main/services/__tests__/tagRagService.test.ts` | ✅ |
| 12 | 文档增量更新 | CODE_WIKI.md / FIX_RECORDS.md / CHANGELOG.md | ✅ |

### §7.3 核心架构

```
一次性向量化（用户手动触发，带进度反馈）：
  tagAutocompleteService.tagMap (31.7万 TagInfo)
    → 分批 500条/批 × 并发3（远程）/ 32条/批 顺序（本地 ONNX）
    → EmbeddingService.generateBatchEmbeddings(texts)
    → VectorStoreService.addBatch() source='tag_library'
    → {databaseDir}/vectors/tag_library/<csvHash>/<dim>/vectors.db
    → 写入 meta 到 {databaseDir}/tag_rag_meta.json

检索 + Prompt 注入（每次 AI 生成特征时）：
  characterTraitAIService.generateCharacterTraits(description)
    → tagRagService.buildRagReferenceSection(description)
      → embeddingService.generateEmbedding(description)
      → vectorStoreService.search(queryVec, 40, undefined, {sourceType: 'tag_library'})
      → buildRagReferencePrompt(relevantTags)
    → 追加到 system prompt 尾部
    → LLM 调用
```

**降级保证**（核心契约）：
- `settings.tagRag.enabled=false` → searchRelevantTags / buildRagReferencePrompt 返回空
- 未向量化（status=idle/stale/error）→ searchRelevantTags 返回空数组
- EmbeddingService 未配置 / 向量化失败 → 不阻塞主流程，仅返回空结果
- 任何异常捕获后写日志，不向调用方抛错

### §7.4 索引指纹与 stale 检测

`csvHash + dimension + model` 三元组任一变更即标记 stale：

- **csvHash**：`sha256(csvPath + ':' + fileSize + ':' + mtimeMs).slice(0,16)`，不读取文件内容（8MB 哈希耗时 ~50ms）
- **dimension**：从 `vectorConfigManager.get('dimension')` 读取，与 meta 比对
- **model**：从 `vectorConfigManager.get('remoteModel'/'localModel')` 读取

事件监听（initialize 时注册）：
- `tagCsvEmitter 'tag-csv-loaded'` → 若 csvHash 变更则标记 stale
- `vectorConfigManager.onDimensionChange` → 若 autoRevectorizeOnDimensionChange 则标记 stale

### §7.5 单测经验 — vi.spyOn 在 ESM 模块上的限制

⚠️ **重点标记**：编写 `tagRagService.test.ts` 时遇到 `TypeError: Cannot spy on export "existsSync". Module namespace is not configurable in ESM`。

根因：`fs` 在 vitest ESM 环境下是 namespace import，其属性不可配置（non-configurable），`vi.spyOn(fs, 'existsSync')` 会尝试 `Object.defineProperty` 重定义属性，触发 TypeError。

修复：改用 `vi.mock('fs', () => ({...}))` 配合 `vi.hoisted` 提前定义 mock 实现。区别于 `ChatVectorizationService.test.ts` 中对 `EmbeddingService` 的 mock 模式（那是默认导出，可 spyOn），`fs` 是命名导出 + ESM namespace，必须用 `vi.mock`。

### §7.6 单测经验 — `vi.clearAllMocks` 与模块级单例状态污染

⚠️ **重点标记**：`tagRagService` 内部使用模块级变量 `currentState` 维护状态（单例模式），与 `vectorConfigManager` 一致。测试时遇到状态污染问题：

- 测试 1 设置 `meta.csvHash='abc123def456'`，但 `computeCsvHash()` 实际计算得到不同 hash（因为 `tagAutocompleteService.getLoadStatus().csvPath` 被 mock 为真实路径，`fs.statSync` 返回真实 size+mtimeMs）
- `computeFreshness()` 判定 csvHash 不匹配 → 状态降级为 'stale' → 后续正常路径测试失败（searchRelevantTags 返回空数组）

修复：将 mock `tagAutocompleteService.getLoadStatus` 的 `csvPath` 设为空字符串 `''`，触发 `computeFreshness` 中的 `if (currentCsvHash && ...)` 短路保护，跳过 csvHash 比对。

经验教训：
- 测试模块级单例服务时，**所有影响 `computeFreshness` 的输入必须可控**（csvHash / dimension / model 三元组都要 mock 一致）
- `vi.clearAllMocks()` 仅清除调用历史，不重置 mock 实现；但模块级状态（如 `currentState`）需要显式重置或通过 `initialize()` 恢复

### §7.7 涉及文件清单

**新增文件**（6 个）：
- `src/shared/types/tagRag.types.ts` — 共享类型定义
- `src/main/services/tagRagService.ts` — 核心服务（~700 行）
- `src/main/services/tagRagProgressEmitter.ts` — 进度事件发射器
- `src/main/ipc/handlers/tagRagHandlers.ts` — IPC 处理器（5 个通道）
- `src/renderer/components/Settings/TagRagSettings.tsx` — 设置面板
- `src/main/services/__tests__/tagRagService.test.ts` — 单元测试（24 个用例）

**修改文件**（8 个）：
- `src/main/types/vectorConfig.ts` — 新增 `VectorSourceType.TAG_LIBRARY` 枚举 + 配套 Label/StorageConfig
- `src/shared/settings.ts` — `defaultSetting` 追加 `tagRag` 配置块
- `src/main/services/tagAutocompleteService.ts` — 新增 `getAllTags()` + `tagCsvEmitter` 事件广播（Task 6 已完成）
- `src/main/services/characterTraitAIService.ts` — 三个生成方法注入 RAG 参考段落
- `src/main/ipc/index.ts` — 注册 `registerTagRagHandlers()` + 调用 `tagRagService.initialize()`
- `src/main/preload.ts` — 暴露 `tagRag` 命名空间（5 个 IPC + onProgress 订阅）
- `src/renderer/types/electron.d.ts` — 补全 `tagRag` API 类型声明
- `src/renderer/components/Settings/Settings.tsx` — 追加 `<TagRagSettings>` 子面板
- `src/renderer/types/setting.ts` — 新增 `TagRagConfig` 类型

### §7.8 待 Electron 集成测试验证项

⚠️ 单元测试覆盖了状态管理、降级路径、Prompt 构建、过滤逻辑，但以下场景需 Electron 集成测试补位（与 `SqliteVecBackend.test.ts` 一致的约定）：

1. **向量化端到端**：标签库加载 → 分批+并发向量化 → 落盘到 `{databaseDir}/vectors/tag_library/<csvHash>/<dim>/vectors.db` → meta 文件写入
2. **vec0 MATCH KNN 查询语义**：sqlite-vec 真实 cosine 距离计算 + post-filter 行为（已知盲区，详见 CODE_WIKI.md §8.1）
3. **维度变更触发 stale 的事件链路**：用户在「向量设置」中切换 embedding 模型 → `VECTOR_DIMENSION_CHANGE_EVENT` 事件 → `tagRagService` 监听 → 状态降级为 stale
4. **CSV 文件替换触发 stale**：用户切换 CSV 路径 → `tagAutocompleteService.reload` → `tagCsvEmitter.emit('tag-csv-loaded')` → `tagRagService` 监听 → 状态降级为 stale
5. **AI 生成端到端**：`tagRag.enabled=true` + 索引 ready → 触发 AI 生成特征 → system prompt 含「标签库参考」段落 → 返回的 traits 全在标签库中
6. **取消向量化**：vectorizing 中点击取消 → 主循环下批开始检查 `cancelRequested` → 状态转 idle → 已写入数据保留
7. **并发向量化**：远程模式 batchSize=500 + concurrency=3 → 317600 条标签预计 ~20 分钟（vs 旧版 100/批顺序 ~1.7 小时）

### §7.9 向量化进度条不显示 + 并发优化 + 路径迁移（2026-08-06）

⚠️ **重点标记 — 用户反馈三个问题一并修复**：

#### 问题 1：向量化进度条未显示

**根因**：`TagRagSettings.tsx` 中进度条显示条件为 `{isVectorizing && progress && ...}`，其中 `isVectorizing` 派生自 `status.status === 'vectorizing'`。但 `startVectorization` IPC 是长任务（`await` 直到完成），vectorizing 期间 `status` 状态不会自动刷新（仅在 done/error/cancelled 阶段刷新），导致 `isVectorizing` 始终为 `false` → 进度条条件不满足 → 进度条不显示。

**修复**：
1. `onProgress` 回调中，首个活跃阶段（starting/embedding/storing）事件到达时立即调用 `refreshStatus()`，确保 `status.status` 切换到 `'vectorizing'`
2. 进度条显示条件改为综合判断：`vectorizing`（按钮 loading 态）OR `status.status === 'vectorizing'` OR `progress.phase` 属于活跃阶段，三者任一满足即显示
3. `renderVectorizationControls` 中的按钮组判断同步改为综合条件，确保 vectorizing 期间显示「取消向量化」按钮

**涉及文件**：`src/renderer/components/Settings/TagRagSettings.tsx`

#### 问题 2：远程向量化速度优化

**原实现**：顺序处理，batchSize=100，317600 条标签需 3176 次串行 API 调用，约 1.7 小时。

**优化方案**：
1. `batchSize` 默认值从 100 提升至 500（OpenAI 支持最高 2048/批）
2. 新增 `concurrency` 配置项（默认 3），实现并发池处理：预切分所有批次 → 启动 N 个 worker 并发消费 → `Promise.all` 等待全部完成
3. 本地 ONNX 模式 `concurrency` 强制为 1（单线程推理，并发无益）
4. `EmbeddingService.generateBatchEmbeddings` 超时时间从固定 60s 改为动态计算：`min(300, max(60, validTexts.length * 0.3))` 秒，500 条 batch 约 150s

**性能预估**：500/批 × 并发 3 → 317600 条标签约 20 分钟（5 倍提速）

**涉及文件**：
- `src/main/services/tagRagService.ts` — 并发池实现
- `src/main/services/EmbeddingService.ts` — 动态超时
- `src/renderer/types/setting.ts` — `TagRagConfig` 新增 `concurrency` 字段
- `src/shared/settings.ts` — 默认值更新
- `src/renderer/components/Settings/TagRagSettings.tsx` — 并发数 UI 控件
- `src/main/services/__tests__/tagRagService.test.ts` — mock 配置补全 `concurrency`

#### 问题 3：向量文件保存路径迁移到项目根目录 database 文件夹

**原实现**：向量 DB 文件路径硬编码到 `app.getPath('userData')`，开发环境不便于查看。

**修复**：新增 `getDatabaseDir()`（`src/main/utils/appPath.ts`），根据 `app.isPackaged` 判断环境：
- 开发环境：`项目根目录/database`（用户可直观查看 vectors.db / tag_rag_meta.json）
- 生产环境：`userData/database`（app.asar 只读，无法写入项目根目录）

**路径变更清单**：
- `SqliteVecBackend.getStoreFilePath()` — `app.getPath('userData')` → `getDatabaseDir()`
- `tagRagService.getMetaFilePath()` — `app.getPath('userData')` → `getDatabaseDir()`
- `tagRagService.saveMetaToDisk()` — 新增 `mkdirSync(metaDir, {recursive:true})` 确保目录存在

**涉及文件**：`src/main/utils/appPath.ts` / `src/main/services/SqliteVecBackend.ts` / `src/main/services/tagRagService.ts`

### §7.10 vec_items UNIQUE constraint 失败 — 重复标签 + vec0 不支持 INSERT OR REPLACE（2026-08-06）

⚠️ **重点标记 — 运行时报错**：

**错误**：`批次 7/3176 写入 DB 失败: UNIQUE constraint failed on vec_items primary key`

**根因（双重问题）**：

1. **标签库存在同名（忽略大小写）重复标签**：Danbooru/e621 合并标签库中，同一 tag 名可能出现在不同 category 下或 CSV 合并时产生重复。ID 生成规则 `tag:${name.toLowerCase()}` 导致同名标签生成相同 ID，触发主键冲突。

2. **vec0 虚拟表不支持 INSERT OR REPLACE 冲突解决**：SQLite 虚拟表的冲突解决由虚拟表实现控制，vec0 不实现 `OR REPLACE` 语义。`upsertInternal` 的 TEXT PK 路径使用了 `INSERT OR REPLACE INTO vec_items(id, embedding) VALUES (?, ?)`，vec0 直接抛出 UNIQUE constraint 错误而非替换旧记录。

**修复**：

1. **标签去重**（`tagRagService.vectorizeAll`）：加载标签后按 `name.toLowerCase()` 去重，保留 count 最高的条目（count 高 = 模型训练时见过更多次 = 更有参考价值）。日志输出去重统计：`标签去重: 317600 → NNNNNN（移除 X 条同名重复）`

2. **upsertInternal TEXT PK 路径改为 DELETE + INSERT**（`SqliteVecBackend.ts`）：
   ```typescript
   // 旧（vec0 不支持）：
   INSERT OR REPLACE INTO vec_items(id, embedding) VALUES (?, ?)
   // 新（与 rowid 方案一致）：
   DELETE FROM vec_items WHERE id = ?
   INSERT INTO vec_items(id, embedding) VALUES (?, ?)
   ```

**涉及文件**：
- `src/main/services/tagRagService.ts` — 新增标签去重逻辑
- `src/main/services/SqliteVecBackend.ts` — upsertInternal TEXT PK 路径修复
- `src/main/services/__tests__/SqliteVecBackend.test.ts` — FakeVectorDb 支持 INSERT（非 OR REPLACE）模式 + 路径期望更新

**经验教训**：
- ⚠️ SQLite 虚拟表（vec0）的冲突解决行为与普通表不同，`INSERT OR REPLACE` / `INSERT OR IGNORE` 可能不被虚拟表实现支持。对虚拟表的 upsert 必须使用显式 DELETE + INSERT 模式。
- ⚠️ 大规模标签库（31.7 万条）合并时必须预期存在重复，向量化前应做去重预处理，避免主键冲突。

### §7.11 RAG 质检报告 — 直观对比「质检前/后」标签有效性（2026-08-06）

**用户需求**：向量化完成后，用户无法直观看出 AI 生成的特征是否真的根据 RAG 标签库进行了检测。需要一个直观的「质检前 vs 质检后」数据对比。

**实现方案**：

1. **主进程 — RAG 检索调试信息**（`tagRagService.ts`）：
   - 新增 `buildRagReferenceWithDebug()`：与 `buildRagReferenceSection` 相同的检索逻辑，但额外返回 `{ enabled, status, retrievedTags }` 调试上下文
   - 新增 `validateTagsAgainstLibrary(tags)`：对 AI 生成的每条 tag 做标签库验证（精确匹配 + 空格→下划线转换匹配），返回 `{ tag, isValid, canonicalName?, category?, count? }[]`
   - `tagAutocompleteService` 新增 `getTagByName(name)` 方法（大小写不敏感查找 tagMap）

2. **主进程 — 生成响应增强**（`characterTraitAIService.ts`）：
   - `GenerateCharacterTraitsResult` 新增 `ragDebug` 字段
   - `generateCharacterTraits` 使用 `buildRagReferenceWithDebug` 获取检索上下文
   - 生成完成后调用 `validateTagsAgainstLibrary` 验证每条 tag
   - 日志输出：`[RAG质检] 检索完成: 查询="..." → 命中 N 条标签, top3: ...` + `[RAG质检] 标签验证: X/Y 条在标签库中`

3. **渲染进程 — 质检报告面板**（`RagQualityReport.tsx`）：
   - AI 生成特征后自动展开，可折叠
   - 头部：RAG 状态（已生效/未启用/索引未就绪）+ 命中率统计
   - 命中率进度条：绿（≥80%）/黄（50-80%）/红（<50%）
   - 生成标签验证区：每条 tag 附 ✅（在库中）/ ❌（不在库中）徽标，hover 显示标准名+count
   - RAG 检索参考区：按 score 降序展示注入到 prompt 的 top-K 标签（含分类/score/count）

4. **IPC 类型声明**（`electron.d.ts`）：
   - `generateCharacterTraits` 返回类型新增 `ragDebug` 字段

**质检前 vs 质检后对比**：
- **质检前**（RAG 未启用）：AI 生成的 tag 全部原样保留，可能包含标签库以外的不存在 tag
- **质检后**（RAG 启用）：① system prompt 注入 top-K 参考标签引导 LLM ② 生成后验证每条 tag 是否在库中 ③ UI 可视化展示命中率

**涉及文件**：
- `src/main/services/tagRagService.ts` — `buildRagReferenceWithDebug` + `validateTagsAgainstLibrary`
- `src/main/services/tagAutocompleteService.ts` — `getTagByName`
- `src/main/services/characterTraitAIService.ts` — `GenerateCharacterTraitsResult.ragDebug` + 生成流程集成
- `src/renderer/components/Character/CharacterDialogueChat/RagQualityReport.tsx` — 新建质检报告组件
- `src/renderer/components/Character/CharacterDialogueChat/AssetManagerModal.tsx` — 集成 RagQualityReport
- `src/renderer/types/electron.d.ts` — IPC 返回类型扩展

### §7.12 ⚠️ 重点 — 标签纠错自动替换 + await bug 修复（2026-08-06）

**用户需求**：RAG 质检报告显示标签库命中率仅 57%（12/21），9 个 invalid tag（如 `light grey hair`、`slender`、`black eyelashes`）不在标签库中。用户希望这些 invalid tag 自动匹配到语义最相似的库内标签并替换，而非保留无效 tag。

#### 问题 A：await bug — tagValidation 序列化为 {} 静默失败

- **根因**：`validateTagsAgainstLibrary` 在 §7.11 改为 `async`（内部 `ensureLoaded` 加载标签库）后，调用方 `characterTraitAIService.ts` **漏加 `await`**，导致 `tagValidation` 是 Promise 对象而非数组，IPC 序列化后前端拿到 `{}`。
- **症状**：主进程日志正确输出 `[RAG质检] 标签验证: 12/21`（函数内部执行了），但前端 ragDebug.tagValidation 是空对象，质检报告拿不到数组数据。
- **修复**：`const tagValidation = await tagRagService.validateTagsAgainstLibrary(tagTexts);`
- **经验教训**：将同步函数改为 async 后，必须全局搜索所有调用点补 `await`，否则返回 Promise 对象在 IPC 序列化后变成 `{}`，前端静默失败且无报错。

#### 问题 B：标签纠错 — invalid tag 自动替换为相似库内标签

**实现方案**（用户决策：自动替换 + 跳过评级词）：

1. **`tagRagService.validateTagsAgainstLibrary` 增强**：
   - 返回类型新增 `suggestions`（top-3 语义相似库内标签）+ `skipReason`（'rating' | 'no_suggestion'）
   - 评级词集合（`RATING_TAGS`：`nsfw`/`safe`/`explicit`/`questionable`/`rating:*`）：对 SD 有效但非视觉标签，标记 `skipReason='rating'` 跳过纠错
   - 其余 invalid tag：调用 `searchRelevantTags({ query: tag, topK: 3, minScore: 0.25 })` 做语义 KNN 检索（复用已建好的 31.7 万向量库）
   - 两遍处理：第一遍精确匹配 + 评级词标记（不触发 embedding），第二遍串行查 suggestion（避免 embedding 服务并发压力）

2. **`characterTraitAIService.generateCharacterTraits` 自动替换**：
   - 对 invalid 非评级词 tag，若 `top1.score >= REPLACE_MIN_SCORE(0.3)`，将 `trait.text` 替换为库内标签，记录 `replacedBy`
   - 通过 tag 文本反查 trait（`traits.find(t => t.text === v.tag)`），避免索引错位
   - 评级词 / 无 suggestion / score 不足：保留原 tag，记录 skipReason

3. **`RagQualityReport.tsx` 五态展示 + 撤销**：
   - ✅ valid（绿色）| 🔄 replaced（蓝色，显示 `xxx → grey_hair` + ↩ 撤销按钮）| ⊘ rating（灰色，评级词）| ❌ no_suggestion（红色）| ⚠ has_suggestion（橙色，相似度不足未替换）
   - 撤销回调 `onRevertTrait(originalTag, replacedBy)`：前端在 store.traits 按 `text === replacedBy` 反查 trait，调 `updateTrait(trait.id, originalTag)` 还原，同步更新 ragDebug 清除 replacedBy 标记

4. **类型同步**（4 处）：`characterTraitAIService` 本地接口 + `electron.d.ts` + `RagQualityReport` RagDebugData + `AssetManagerModal` ragDebug state

**性能**：每个 invalid 非评级词 tag 触发一次 embedding + KNN（~200ms），串行执行。典型 8 个 invalid tag ≈ 1.6s，在 AI 生成特征后做，可接受。

**涉及文件**：
- `src/main/services/tagRagService.ts` — `RATING_TAGS` / `SUGGESTION_MIN_SCORE` 常量 + `validateTagsAgainstLibrary` 增强（suggestions/skipReason）
- `src/main/services/characterTraitAIService.ts` — `REPLACE_MIN_SCORE` 常量 + await bug 修复 + 自动替换循环
- `src/renderer/components/Character/CharacterDialogueChat/RagQualityReport.tsx` — 五态渲染 + 撤销按钮 + `onRevertTrait` 回调
- `src/renderer/components/Character/CharacterDialogueChat/AssetManagerModal.tsx` — `handleRevertTrait` + ragDebug state 类型扩展
- `src/renderer/types/electron.d.ts` — tagValidation 类型扩展（suggestions/skipReason/replacedBy）

**待 Electron 集成测试验证**：
- invalid tag 的 suggestion 语义匹配准确率（`light grey hair` → `grey_hair`？`slender` → `slim`？）
- REPLACE_MIN_SCORE=0.3 阈值是否合理（过高=少替换，过低=误替换）
- 撤销后 ragDebug UI 同步 + store 还原正确性
- 评级词列表覆盖度（是否有遗漏的评级词）

### §7.13 ⚠️ 重点 — 标签同义词匹配增强（aliasMap + 颜色剥离分层匹配）（2026-08-06）

**现象**：§7.12 的标签纠错自动替换上线后，用户反馈 7 个颜色相关 tag 在质检报告中全部显示「无匹配结果」（`skipReason='no_suggestion'`），纠错功能完全失效：

| 用户输入 tag | 期望匹配 |
|---|---|
| `light gray hair` | grey_hair |
| `light gray drooping ears` | drooping_ears |
| `light gray beanie` | beanie |
| `black eyelashes` | eyelashes |
| `slender` | slim |
| `light gray short tail` | short_tail |
| `light gray open hoodie` | open_hoodie |

**根因**：`validateTagsAgainstLibrary`（tagRagService.ts）只按 tag `name` 匹配（`getTagByName`），完全未利用 CSV 自带的 `aliases` 字段。CSV 的 aliases 字段已包含大量同义词映射（如 `slim` 别名含 `slender`、`grey_hair` 别名含 `light_gray_hair`、`eyelashes` 别名含 `black_eyelashes`），但验证逻辑只查 name 不查 alias，导致：
- 含颜色前缀的复合 tag（`light gray hair`）因 name 列无对应条目而 invalid
- 纯同义词（`slender`）因 name 列只有 `slim` 而 invalid
- 语义 KNN（L4）阈值 0.25 过高，颜色前缀干扰下余弦相似度不足 0.25，suggestions 为空 → `no_suggestion`

**修复方案**（一劳永逸，无需手动维护同义词表）：

#### 1. aliasMap 反向索引（tagAutocompleteService.ts）

- CSV 加载时（`loadInternal`）构建 `aliasMap`：`Map<alias.toLowerCase(), TagInfo>`，遍历每条 TagInfo 的 aliases 数组，建立 alias → TagInfo 反向映射
- 新增 `getTagByAlias(alias)` 方法，供 tagRagService L2 层调用
- **冲突策略**：同一 alias 被多个 tag 标注时，保留 `count` 更高的 TagInfo（高频 tag 优先，避免低频 tag 抢占别名）

#### 2. 颜色/修饰词剥离（tagRagService.ts）

- 新增常量 `COLOR_BRIGHTNESS_MODIFIERS`（`light`/`dark`/`pale`/`bright`/`deep` 等）+ `COLOR_BASE_NAMES`（`gray`/`grey`/`black`/`white`/`brown`/`red`/`blue`/`green`/`yellow`/`pink`/`purple`/`orange` 等）
- 新增 `stripColorModifier(tag)` 函数：剥离 `light gray`/`black`/`dark brown` 等颜色前缀，返回核心词（如 `light gray drooping ears` → `drooping_ears`）
- 剥离后再次走 name 匹配（L3）

#### 3. 四层降级匹配链（validateTagsAgainstLibrary 重构）

| 层级 | 匹配方式 | 说明 |
|---|---|---|
| L1 name | `getTagByName(tag)` | 原有精确匹配 + 空格/下划线互转 |
| L2 alias | `getTagByAlias(tag)` | 新增，查 aliasMap 反向索引 |
| L3 颜色剥离 | `stripColorModifier(tag)` → `getTagByName(core)` | 剥离颜色前缀后重新 name 匹配 |
| L4 语义 KNN | `searchRelevantTags({ query, topK:3, minScore:0.15 })` | 阈值 0.25→0.15 放宽 |

任一层命中即 `isValid=true` 并记录 `canonicalName`（命中库内标签名）。L1-L3 不触发 embedding（零延迟），仅 L4 需向量化（~200ms/tag，串行）。

#### 4. SUGGESTION_MIN_SCORE 阈值调整

`SUGGESTION_MIN_SCORE` 由 0.25 降至 0.15，与 `TagRagConfig.minScore` 默认值对齐，避免颜色前缀干扰下语义相似度被压低而误判为无建议。

**7 个 tag 验证结果**（已核实 CSV aliases 字段）：

| 用户输入 tag | 命中层 | canonicalName |
|---|---|---|
| `light gray hair` | L2 alias | grey_hair |
| `light gray drooping ears` | L3 颜色剥离 | drooping_ears |
| `light gray beanie` | L3 颜色剥离 | beanie |
| `black eyelashes` | L2 alias | eyelashes |
| `slender` | L2 alias | slim |
| `light gray short tail` | L3 颜色剥离 | short_tail |
| `light gray open hoodie` | L3 颜色剥离 | open_hoodie |

**关键代码位置**：
- `src/main/services/tagAutocompleteService.ts` — `aliasMap` 字段 + `loadInternal` 构建 + `getTagByAlias(alias)` 方法 + 加载日志增强（aliasMap 条目数）
- `src/main/services/tagRagService.ts` — `COLOR_BRIGHTNESS_MODIFIERS` / `COLOR_BASE_NAMES` 常量 + `stripColorModifier(tag)` 函数 + `SUGGESTION_MIN_SCORE` 0.25→0.15 + `validateTagsAgainstLibrary` 四层降级链重构

**内存/性能影响**：
- aliasMap 约 80-100 万条目（31.7 万 tag 平均每条 3-4 个 alias），额外占用约 50-80MB 内存
- CSV 加载耗时 +约 1s（遍历 aliases 数组构建 Map），首次 search 延迟从 ~1-2s 增至 ~2-3s，可接受（一次性成本，后续命中内存索引）
- L1-L3 匹配零延迟（纯 Map 查找），仅 L4 触发 embedding

**教训**（⚠️ 重点标记）：
1. **标签库 CSV 自带的 `aliases` 字段是最权威的同义词映射源**，验证逻辑应优先利用现成数据（aliasMap 反向索引）而非手动维护映射表。本次 7 个 tag 中 2 个（`light gray hair`→grey_hair、`slender`→slim）直接命中 CSV aliases，零额外维护成本。
2. **颜色复合 tag 应通过剥离前缀复用核心词匹配**，而非为每种「颜色+特征」组合维护条目。CSV 中 `drooping_ears`/`beanie`/`short_tail`/`open_hoodie` 均为独立 tag，颜色只是修饰，剥离后即可命中。
3. **语义 KNN 阈值（minScore）需与实际数据分布对齐**：颜色前缀会显著拉低余弦相似度（`light gray hair` vs `grey_hair` 的向量距离 > `hair` vs `grey_hair`），0.25 阈值在颜色复合 tag 场景下过高，降至 0.15 与 RAG 检索默认值一致。

**涉及文件**：
- `src/main/services/tagAutocompleteService.ts` — aliasMap 字段 + loadInternal 构建 + getTagByAlias 方法 + 日志增强
- `src/main/services/tagRagService.ts` — COLOR 常量 + stripColorModifier 函数 + SUGGESTION_MIN_SCORE 调整 + validateTagsAgainstLibrary 四层降级链

**待 Electron 集成测试验证**：
- 7 个 tag 实际命中层与上表一致（特别是 L2 alias vs L3 颜色剥离的判定）
- aliasMap 内存占用实测（预估 50-80MB）
- CSV 加载耗时实测（预估 +1s）
- L4 语义 KNN 阈值 0.15 是否引入误匹配（低频 tag 的相似度噪声）

### §7.14 ⚠️ 重点 — 匹配成功后特征区未替换（valid tag 规范化缺失）（2026-08-06）

> Spec: `.trae/specs/enhance-tag-synonym-matching/` — §7.13 实现后暴露的下游 Bug
> 用户反馈：「审核成功了，怎么替换到下面的特征区域？没有相关的按钮也没有自动替换」

**现象**：§7.13 的 aliasMap + 颜色剥离分层匹配上线后，用户反馈的 7 个 tag（slender、light gray hair 等）在质检报告中显示 ✅ 匹配成功（isValid=true，canonicalName 正确如 slim/grey_hair），但下方特征区的文本仍是原始非标准写法（slender/light gray hair），既没有自动替换也没有替换按钮。

**根因**：`characterTraitAIService.generateCharacterTraits` 的自动替换循环存在逻辑缺陷：
```typescript
for (const v of tagValidation) {
  if (v.isValid || v.skipReason === 'rating' || ...) continue;  // ⚠️ valid 直接跳过
  // 仅 invalid tag 走 suggestion 替换
}
```
- §7.13 前：7 个 tag 全部 invalid（无匹配）→ 走 L4 suggestion，score 达 0.3 才替换（多数未达阈值，显示「无匹配」）
- §7.13 后：7 个 tag 全部 valid（L2/L3 命中）→ `if (v.isValid) continue` 直接跳过，**特征区文本保持原始写法不规范化**
- 前端 `RagQualityReport.tsx` 的 `isReplaced = !item.isValid && !!item.replacedBy` 同样要求 `!isValid`，导致 valid tag 即使有 canonicalName 也不显示替换徽标/撤销按钮（仅展示一个灰色 `→ canonicalName` 提示，纯展示不替换）

**修复方案**：
1. **service 新增「场景1：valid 规范化替换」**（`characterTraitAIService.ts`）：valid + `tag !== canonicalName`（大小写敏感，含空格/下划线/同义词差异）时，将 `trait.text` 替换为 `canonicalName` 并设 `replacedBy`。无需相似度阈值（canonicalName 是精确匹配结果，可信度高）。原 invalid suggestion 替换保留为「场景2」。
2. **前端 `isReplaced` 改为 `!!item.replacedBy`**（不依赖 isValid）：valid+replaced（规范化）和 invalid+replaced（语义替换）统一显示蓝色 🔄 徽标 + 撤销按钮；tooltip 区分两种场景。
3. **if-else 展示顺序调整**：isReplaced 优先于 isValid，避免 valid+replaced 落入绿色 ✅ 分支。
4. **`validateTagsAgainstLibrary` 返回类型补 `replacedBy?: string`**：原返回类型缺失此字段（replacedBy 由调用方 characterTraitAIService 写入），导致 `v.replacedBy = ...` 一直有 tsc 错误（pre-existing，本次一并修复）。
5. 撤销逻辑 `handleRevertTrait` 无需改动：还原 trait.text 为 originalTag + 清除 replacedBy，对 valid 规范化场景同样适用。

**修改文件**：
- `src/main/services/characterTraitAIService.ts` — 替换循环新增场景1（valid 规范化）+ ⚠️ Bug 注释
- `src/renderer/components/Character/CharacterDialogueChat/RagQualityReport.tsx` — isReplaced 不依赖 isValid + 展示顺序调整 + 头部提示文案
- `src/main/services/tagRagService.ts` — validateTagsAgainstLibrary 返回类型补 replacedBy 字段

**验证**：tsc 类型检查通过（4 个文件无新错误）；43 个单元测试通过（含 7-tag 命中 + L1 回归）。

**教训**（⚠️ 重点标记）：
1. **标签替换逻辑不能只针对 invalid tag**：valid + canonicalName≠tag 的情况（同义词 slender→slim、颜色变体 light gray hair→grey_hair、空格/大小写差异 blue eyes→blue_eyes）同样需要规范化替换为库内标准名，否则特征区保留非标准写法，降低 SD 生成质量。修复「匹配率」类问题时，必须同步检查下游「替换应用」链路是否覆盖新产生的 valid 状态。
2. **前后端 isReplaced 判定必须一致**：service 设 replacedBy 的条件与前端识别 replacedBy 的条件必须对齐。原前端 `!item.isValid && !!item.replacedBy` 比 service 的替换条件更严格，导致 service 替换了但前端不展示撤销按钮。
3. **函数返回类型应包含调用方会追加的可选字段**：validateTagsAgainstLibrary 的返回类型长期缺失 `replacedBy`（由调用方 mutation 写入），tsc 一直报错却被忽略。返回类型应如实反映对象在生命周期中可能具有的全部字段。

### §7.15 ⚠️ 重点 — L3 颜色拆分重构（颜色剥离丢弃 → 拆分保留）（2026-08-06）

> Spec: `.trae/specs/refine-color-tag-splitting/spec.md`
> 用户反馈：颜色复合 tag（light gray drooping ears）的「灰色」语义被完全丢弃，应拆成 grey_ears + drooping_ears 两条进入 SD 生成链路。

**现象**：§7.13 上线的 L3 颜色剥离策略（`stripColorModifier`）只剥离不保留颜色信息 —— `light gray drooping ears` 剥离 `light gray` 后只剩 `drooping_ears`，而 Danbooru 标签库实际有丰富的「颜色+部位」组合标签（`grey_ears` count=11299、`grey_tail` count=24542、`grey_hoodie` count=12057、`grey_hat` 等），颜色信息进入 SD 生成能显著提升色彩还原度，但被白白丢弃。

**根因**：`stripColorModifier` 设计目标是「剥离颜色前缀让核心词命中标签库」，剥离的颜色前缀直接丢弃（返回核心词字符串），未保留颜色信息用于构造颜色+部位组合标签。而标签库自带的 `grey_ears` / `grey_tail` 等组合标签是最权威的颜色映射源 —— 它们是模型训练时实际见过的颜色+部位共现标签，比把颜色拼到 prompt 自然语言里更直接、权重更高。

**修复方案**（5 个 Task，L3 从「剥离丢弃」升级为「颜色拆分保留」）：
1. **新增 `splitColorTag(tag)` 函数**（`tagRagService.ts`）：
   - 算法：统一空格分隔 → 识别「可选亮度修饰词（light/dark/pale/bright/deep/neon/pastel/vivid/dull）+ 基础颜色」→ 颜色归一化（`gray`→`grey`、`blond`→`blonde`，标签库用 grey/blonde 拼写）→ 亮度词丢弃（标签库是 `grey_ears` 而非 `light_grey_ears`）→ 剩余部分=核心特征（`drooping_ears`），部位词=特征最后一个词（`ears`）→ 构造颜色+部位标签 `baseColor + '_' + partWord`（`grey_ears`）
   - 返回 `{ baseColor, feature, partWord, colorPartTag } | null`（纯颜色词 `black` 或非颜色前缀 `slender` 返回 null）
2. **L3 重构**（`validateTagsAgainstLibrary`）：L3 从调 `stripColorModifier` 改为调 `splitColorTag`，拆分后分别查 `colorPartTag` 与 `feature` 是否命中 name/alias（含空格/下划线互转，与 L1/L2 一致）：
   - 两者都命中 → `isValid=true`、`canonicalName=feature`、`splitTags={colorPartTag, feature}`
   - 仅 feature 命中 → `isValid=true`、`canonicalName=feature`、无 splitTags（退化为原剥离丢弃颜色行为，向后兼容）
   - 仅 colorPartTag 命中 → `isValid=true`、`canonicalName=colorPartTag`、无 splitTags
   - 都不命中 → 走 L4 语义 KNN
3. **返回类型新增 `splitTags?: { colorPartTag: string; featureTag: string }` 字段**：L3 拆分两条都命中时携带，供下游 characterTraitAIService 拆 trait。
4. **`characterTraitAIService` 替换循环新增「场景1：颜色拆分」**（在原「场景2 valid 规范化」之前）：`v.splitTags` 存在时，原 trait.text 替换为 `featureTag`，`traits.push({ text: colorPartTag, categoryId: trait.categoryId })` 新增颜色+部位 trait，设 `replacedBy = featureTag`。一个 trait 拆成两个，颜色语义进入 SD 生成链路。
5. **前端展示拆分 + 撤销**：`RagQualityReport` 对有 splitTags 的项显示蓝色 🔄 徽标 + 文案「已拆分：tag → colorPartTag + featureTag」；`onRevertTrait` 签名扩展 `(originalTag, replacedBy, splitColorTag?)`；`AssetManagerModal.handleRevertTrait` 接收 `splitColorTag` 时，还原 featureTag trait 为 originalTag（现有逻辑）+ 找到 `text === splitColorTag` 的 trait 调 `removeTrait` 删除 + 清除 ragDebug 对应项的 replacedBy 与 splitTags。

`stripColorModifier` 保留不删除（被 `splitColorTag` 概念覆盖，现有 7 个剥离测试仍验证剥离行为，避免破坏回归）。

**验证脚本结论**（`verify-color-split.mjs`，功能已固化到单元测试后删除）：
7/7 命中，用户反馈的 4 个颜色复合 tag 全部可拆成「颜色+部位标签 + 核心特征标签」两条且两条都在库中。

**拆分结果表**：

| 原 tag（AI 输出） | colorPartTag（颜色+部位） | featureTag（核心特征） | 库内 count（colorPartTag / featureTag） |
|---|---|---|---|
| `light gray drooping ears` | `grey_ears` | `drooping_ears` | 11299 / 34 |
| `light gray short tail` | `grey_tail` | `short_tail` | 24542 / 81568 |
| `light gray beanie` | `grey_beanie` | `beanie` | — / 46285 |
| `light gray open hoodie` | `grey_hoodie` | `open_hoodie` | 12057 / 10875 |

**修改文件**：
- `src/main/services/tagRagService.ts` — 新增 `splitColorTag` 函数 + `COLOR_NORMALIZE` 常量 + `SplitColorTagResult` 接口；L3 重构为拆分；返回类型新增 `splitTags` 字段
- `src/main/services/characterTraitAIService.ts` — 替换循环新增「场景1 颜色拆分」+ ragDebug 透传 splitTags
- `src/renderer/components/Character/CharacterDialogueChat/RagQualityReport.tsx` — 展示拆分徽标 + `onRevertTrait` 签名扩展
- `src/renderer/components/Character/CharacterDialogueChat/AssetManagerModal.tsx` — `handleRevertTrait` 撤销拆分（删除新增 colorPartTag trait）
- `src/main/services/__tests__/tagRagService.test.ts` — `splitColorTag` 6 个用例 + `validateTagsAgainstLibrary` 颜色拆分 3 场景

**验证**：tsc 类型检查无新错误（4 个目标文件均无错误）；vitest 52 个测试通过（tagRagService 42 + tagAutocompleteService 10）。

**教训**（⚠️ 重点标记）：
1. **颜色信息应保留为独立标签而非丢弃**：颜色复合 tag（`light gray drooping ears`）的「灰色」不是冗余信息，而是 SD 生成所需的有效颜色语义。剥离策略只解决「让核心词命中标签库」的匹配率问题，却丢失了颜色本身。应改为拆分保留 —— 构造标签库已有的颜色+部位组合标签（`grey_ears`），让颜色以标签形式（而非自然语言）进入 prompt，模型权重更高、更可控。
2. **标签库自带的颜色+部位组合标签是最权威的映射源**：`grey_ears`（count=11299）是模型训练时实际见过的颜色+部位共现标签，比把 `light gray` 拼到自然语言描述里更直接、更标准。重构颜色相关 tag 时，应优先查询标签库是否已有对应的颜色+部位组合标签，而非凭空构造或丢弃。
3. **「剥离」与「拆分」是不同决策**：剥离（strip）用于匹配率场景（让核心词命中），拆分（split）用于语义保留场景（让颜色信息进入生成链路）。L3 同时承担两个目标时，应优先拆分 —— 拆分天然包含剥离的匹配能力（拆分后的 feature 即剥离后的核心词），且额外保留颜色信息。

### §7.16 ⚠️ 重点 — 多轮标签审计与替换机制（L0 自定义映射 + L3b 修饰词剥离 + 末轮人工审核）（2026-08-06）

> Spec: `.trae/specs/add-multi-round-tag-audit/spec.md`
> 用户反馈：经 §7.13（同义词增强）+ §7.15（颜色拆分）后，仍有两类 tag 无法命中：`brimless cap`（非颜色否定性修饰词复合）+ `B-cup`（领域术语，非字符串拆分能解决）。

**现象**：经 L1-L4 四层匹配链后，以下两类 tag 仍 `isValid=false`：

| 输入 tag | 失败原因 | 期望行为 |
|---|---|---|
| `brimless cap` | L3 颜色拆分仅处理颜色前缀，`brimless` 是非颜色否定性修饰词（无帽檐），L4 KNN 相似度不足 | 剥离 `brimless` → 核心词 `cap` → `cap` 是 `hat` 的 alias → 命中 `hat` |
| `B-cup` | 杯罩尺寸是领域术语，Danbooru 用 `medium_breasts`/`small_breasts` 表达，非字符串拆分能解决 | 需领域映射或人工指定 → `medium_breasts`，且人工指定结果需持久化复用 |

**根因**：
1. **L3 仅处理颜色前缀**：`stripColorModifier` / `splitColorTag` 只识别 `COLOR_BASE_NAMES` + `COLOR_BRIGHTNESS_MODIFIERS`，无法处理 `brimless`/`sleeveless`/`strapless` 等否定性前缀（`-less` 后缀，表示「无/不」语义）。
2. **领域术语需人工映射**：`B-cup` → `medium_breasts` 是跨词汇表的语义等价映射，标签库不收录 `B-cup`，KNN 检索也因语义距离过大无法命中。
3. **无持久化机制导致人工替换无法复用**：§7.12 的标签纠错自动替换仅在当次生成有效，用户下次 AI 生成 `B-cup` 时仍需手动替换 —— 缺乏跨会话持久化的同义词映射表，人工审核结果无法形成闭环。

**修复方案**（5 个 Task，扩展为多轮审计闭环 + 持久化机制）：

1. **L0 自定义映射表**（Task 1，新增 `src/main/services/userSynonymMapService.ts`）：
   - 持久化路径：`{userData}/data/user-synonym-map.json`，扁平结构 `Record<originalTagLowercase, replacementTag>`（key 小写、value 原样保留 canonicalName 大小写）
   - 内存缓存：`Map<string, string>`（key 小写），`load()` 加载到内存，所有写操作（`addMapping`/`removeMapping`）同步更新内存 + 落盘
   - 错误处理：文件不存在/JSON 损坏 → 返回空 Map（不抛异常）；写入失败 → 静默返回（下次 load 仍能返回上次成功状态）
   - 与 `categoryDictionaryService` 一致采用同步 I/O（映射表预期很小，数十到数百条）
   - `tagRagService.initialize()` 显式调用 `userSynonymMapService.load()` 加载映射表

2. **L0 自定义映射查询**（Task 1.4，`validateTagsAgainstLibrary` 新增 L0 分支）：
   - 在 L1 name 之前查询 `userSynonymMapService.lookup(tag)`
   - 命中则 `isValid=true, canonicalName=映射目标, source='user-map'`，跳过 L1-L4（短路）
   - `lookup` 异常时降级到 L1-L4（兜底容错）

3. **L3b 否定性修饰词剥离**（Task 2，新增 `stripNegationModifier` + L3b 分支）：
   - 保守修饰词列表（8 词，仅 `-less` 后缀的否定性词）：`brimless`/`sleeveless`/`strapless`/`topless`/`bottomless`/`hairless`/`wireless`/`collarless`
   - 算法：`stripNegationModifier(tag)` 用正则 `^(?:修饰词)[\s_]+` 剥离开头修饰词（空格/下划线兼容），返回核心词；核心词为空或与原 tag 相同 → 返回空串（不可剥离）
   - L3b 分支在 L3 颜色拆分之后、L4 KNN 之前：`stripNegationModifier(tag)` → 核心词查 name/alias（含空格/下划线互转）→ 命中则 `source='negation-strip'`
   - **保守选择的原因**：不收录 `short`/`open`/`long` 等修饰词 —— 这些词与核心词组合常常本身是独立标签（`short_hair`/`open_hoodie`/`long_sleeves`），剥离会破坏语义。仅当 L0-L3 全部未命中时才触发 L3b（避免误伤本身是标签的复合词）。

4. **末轮人工审核入口**（Task 3-4，前端 `RagQualityReport.tsx` + `AssetManagerModal.tsx`）：
   - 对 `isValid=false` 的项显示「手动替换」按钮 → 展开 inline 输入框 → 用户输入替换词回车确认
   - 系统：替换 `trait.text` 为输入词 + 调 IPC `tagRag.addUserSynonymMapping(originalTag, replacement)` 持久化
   - 显示「🟣 已手动替换：tag → manualReplacement」徽标 + 撤销按钮
   - 撤销：还原 `trait.text` 为 originalTag + 调 IPC `tagRag.removeUserSynonymMapping` 删除映射

5. **source 字段**（Task 2.4，`validateTagsAgainstLibrary` 返回类型新增）：
   - `'user-map'`（L0 自定义映射）/ `'name'`（L1）/ `'alias'`（L2）/ `'color-split'`（L3）/ `'negation-strip'`（L3b）/ `'knn'`（L4）
   - 前端 RagQualityReport 在 tooltip 中展示命中轮次，辅助用户判断匹配来源 + 统计匹配率

**三轮审计设计**：

| 轮次 | 触发时机 | 匹配层 | 典型场景 |
|---|---|---|---|
| **首轮**（自动） | AI 生成 tag 后立即执行 | L0 自定义映射 + L1 name + L2 alias | 已持久化的映射（`B-cup→medium_breasts`）下次同词首轮命中；常规 tag name/alias 精确匹配 |
| **次轮**（自动） | 首轮未命中的 tag 继续降级 | L3 颜色拆分 + L3b 修饰词剥离 | `light gray drooping ears` → `grey_ears + drooping_ears`（L3）；`brimless cap` → `cap` → `hat`（L3b） |
| **末轮**（人工） | L0-L4 全失败的 tag | 人工审核 inline 替换 + 持久化 | `B-cup` → 用户手动输入 `medium_breasts` → 写入映射表 → **下次首轮 L0 命中**（闭环） |

**两个目标词的处理链路**：

1. **`brimless cap` → L3b → `hat`**（自动，无需人工）：
   - L0 lookup('brimless cap') → null（无映射）
   - L1 name('brimless cap' / 'brimless_cap') → null
   - L2 alias('brimless cap' / 'brimless_cap') → null
   - L3 splitColorTag('brimless cap') → null（brimless 非颜色词）
   - L3b stripNegationModifier('brimless cap') → 'cap' → getTagByAlias('cap') → `hat`（alias 命中）
   - 结果：`isValid=true, canonicalName='hat', source='negation-strip'`

2. **`B-cup` → 人工审核 → `medium_breasts` → 持久化 → 下次 L0 命中**（闭环）：
   - **首次**：L0-L4 全失败 → `isValid=false` → 前端显示「手动替换」输入框
   - 用户输入 `medium_breasts` → trait.text 替换 + IPC `addUserSynonymMapping('B-cup', 'medium_breasts')` → 写入 `user-synonym-map.json`
   - **下次**：AI 生成 `B-cup` → L0 lookup('B-cup') → `'medium_breasts'`（命中持久化映射）→ `isValid=true, source='user-map'`

**修改文件**：
- `src/main/services/userSynonymMapService.ts`（新增）— 映射表持久化服务（load/addMapping/removeMapping/lookup/getMap）
- `src/main/services/tagRagService.ts` — `NEGATION_MODIFIERS` 常量 + `stripNegationModifier` 函数 + `validateTagsAgainstLibrary` L0/L3b 分支 + `source` 字段 + `initialize` 调 `userSynonymMapService.load()`
- `src/main/ipc/handlers/tagRagHandlers.ts` — 新增 `tagRag:getUserSynonymMap` / `tagRag:addUserSynonymMapping` / `tagRag:removeUserSynonymMapping` IPC
- `src/preload.ts` — 暴露新 IPC
- `src/renderer/components/Character/CharacterDialogueChat/RagQualityReport.tsx` — 手动替换入口（inline 输入框 + 撤销按钮）
- `src/renderer/components/Character/CharacterDialogueChat/AssetManagerModal.tsx` — `handleManualReplace` / `handleRevertManualReplace` 处理
- `src/main/services/__tests__/tagRagService.test.ts` — L0 + L3b 测试（16 个用例）
- `src/main/services/__tests__/userSynonymMapService.test.ts`（新增）— 28 个单元测试

**验证**：tsc 类型检查无新错误（仅 `preload.ts:46` 预先存在错误，与本次无关）；vitest 96 个测试全部通过（tagRagService 58 + userSynonymMapService 28 + tagAutocompleteService 10）。

**教训**（⚠️ 重点标记）：
1. **人工审核结果必须持久化形成闭环**：若末轮人工替换仅在当次生效（如 §7.12 的自动替换），用户下次遇到同词仍需手动替换 —— 匹配率无法持续优化。L0 自定义映射表的持久化让「人工审核 → 持久化 → 下次自动命中」形成闭环，每次人工替换都永久提升后续匹配率，是匹配率持续优化的核心机制。
2. **修饰词剥离需保守列表避免误伤**：`brimless`/`sleeveless` 等否定性修饰词剥离后核心词本身大概率是有效标签（`cap`/`dress`），可安全剥离；但 `short`/`open`/`long` 等修饰词与核心词组合常常本身是独立标签（`short_hair`/`open_hoodie`），剥离会破坏语义。保守列表（仅 `-less` 后缀的 8 词）确保仅在「完整 tag 未被 L0-L3 命中」时才触发，最大限度避免误伤。
3. **`source` 字段是匹配链可观测性的关键**：六层匹配链的命中轮次（L0-L4）通过 `source` 字段透传到前端，让用户在质检报告中直观看到每个 tag 是「用户映射命中」/「name 精确」/「alias 同义词」/「颜色拆分」/「修饰词剥离」/「KNN 语义」中的哪一层 —— 既是用户判断匹配来源的依据，也是统计匹配率分布（如「L0 命中占比」反映人工审核积累程度）的基础。

### §7.17 ⚠️ 重点 — AI 兜底标签审核（L0-L4 全失败后的 LLM 最后一道防线）（2026-08-06）

> Spec: `.trae/specs/add-ai-fallback-tag-audit/spec.md`
> 用户反馈：经 §7.16（多轮审计 L0-L4 + 末轮人工审核）后，`B-cup` 等领域术语仍需用户手动输入替换词，体验差；希望「为人工审核添加最后一道防线」—— L0-L4 全失败的 tag 自动调 LLM 生成候选词并二次匹配，仍未命中才交给用户手动编辑。

**现象**：§7.16 的末轮人工审核虽能持久化映射形成闭环，但首次遇到顽固未匹配词（如 `B-cup`/`brimless cap` 在某些 CSV 配置下 L3b 也漏命中）时仍需用户手动输入替换词，用户未必知道目标 tag（`medium_breasts`），体验不佳。

**根因**：缺乏「自动生成候选词」的中间层。L0-L4 都是「在标签库中查找匹配」，无法为标签库中根本不存在的词（`B-cup`）生成候选；而 LLM 具备领域知识（`B-cup` ≈ `medium_breasts`/`small_breasts`），可生成候选词后再走 L0-L4 验证 —— 这正是一道天然的「LLM 兜底」防线。

**修复方案**（5 个改动点，L5 紧随 L4，复用 userSynonymMap 持久化机制）：

1. **AI 兜底专用系统提示词**（`AI_FALLBACK_SYSTEM_PROMPT`）：
   - 任务不是「提取特征」而是「为未匹配 tag 生成候选同义词/拆分词」
   - 输出格式 `<original_tag> | candidate1, candidate2`（便于 `parseAiFallbackResponse` 按 `|` 切分）
   - 覆盖 6 类候选词生成策略：同义词替换 / 下划线规范化 / 复合词拆分 / 别名转正名 / 描述性词转标签 / 颜色复合拆分
   - 候选词要求：英文、下划线分隔、优先 Danbooru/e621 常用词、每 tag 2-4 个候选词、不复述原 tag

2. **批量上限 `AI_FALLBACK_MAX_TAGS=10`**：超出跳过整个兜底环节（避免 LLM 上下文过大导致响应慢/截断）。典型场景 8-15 个特征经 L0-L4 后仅 1-3 个未命中，10 上限覆盖所有现实场景。

3. **4 个私有方法**（`characterTraitAIService.ts`）：
   - `buildAiFallbackUserMessage(unmatchedTags, description, personality?, scenario?)` — 构建角色上下文 + 未匹配 tag 列表的 user 消息
   - `parseAiFallbackResponse(content, unmatchedTags)` — 按行解析 `<original_tag> | candidate1, candidate2` 为 `Map<originalTag, candidates[]>`；每 tag 保留前 4 个候选词（去重）；只解析 unmatchedTags 中存在的 tag（防 LLM 臆造）
   - `generateTagSynonymsBatch(unmatchedTags, params, aiConfig, runtimeConfig)` — 复用主调用配置（baseUrl/apiKey/modelName/temperature/maxTokens），系统提示词换为 `AI_FALLBACK_SYSTEM_PROMPT`，非流式 POST `/v1/chat/completions`；失败降级返回空 Map
   - `applyAiFallback(aiFallbackTargets, candidatesMap, traits)` — 收集所有候选词（跨 tag 去重），一次性调 `validateTagsAgainstLibrary` 走 L0-L4；按候选词顺序找首个 `isValid=true` 的，替换 `trait.text` 为 `canonicalName || candidateName`；写 `replacedBy`/`source='ai-fallback'`/`aiFallbackAttempted=true`/`aiFallbackCandidates`；调 `userSynonymMapService.addMapping(tag, replacement)` 持久化（与人工审核持久化机制一致）

4. **兜底环节插入位置**（`generateCharacterTraits` 中 `validateTagsAgainstLibrary` 之后）：
   - 过滤 `aiFallbackTargets = tagValidation.filter(v => !v.isValid && v.skipReason !== 'rating' && !v.replacedBy)`
   - `0 < length ≤ 10` → 调 `generateTagSynonymsBatch` + `applyAiFallback`
   - `length > 10` → 写 warn 日志跳过
   - LLM 调用异常 → 所有目标标记 `aiFallbackAttempted=true`，不阻塞主流程

5. **前端展示与撤销**（`RagQualityReport.tsx` + `AssetManagerModal.tsx`）：
   - 新增颜色 `COLORS.aiFallback = '#f97316'`（橙色）+ `SOURCE_LABELS['ai-fallback'] = 'L5 AI 兜底'`
   - 三种状态展示：
     - **命中**（`source='ai-fallback' && replacedBy`）：橙色 🤖 + `→ replacedBy` + ↩ 撤销按钮（调 `onRevertAiFallback`）
     - **未命中**（`aiFallbackAttempted=true && !replacedBy && !isValid`）：橙色淡 🤖 + tooltip 展示候选词，保留 ✏ 手动入口
     - **未尝试**（`aiFallbackAttempted === undefined`）：维持原 invalid 红色 ❌ + ✏ 入口
   - 优先级链：手动替换（紫🟣） > AI 兜底命中（橙🤖） > 自动替换（蓝🔄） > valid（绿✅） > rating > noSuggestion > hasSuggestionOnly > AI 兜底未命中（橙淡🤖） > invalid
   - `isReplaced` 排除 `source='ai-fallback'`：AI 兜底命中走独立橙色分支，避免与蓝色自动替换混淆
   - `handleRevertAiFallback(originalTag, replacement)`：还原 trait + 删除 IPC 映射 + 清除 ragDebug 的 `replacedBy`/`source`/`aiFallbackCandidates`，**保留 `aiFallbackAttempted=true`**（避免下次再触发 LLM 调用，UI 显示 invalid 红色 ❌，不再展示 ✏ 入口避免循环）

**多轮审计闭环（含 L5 AI 兜底）**：

| 轮次 | 触发时机 | 匹配层 | 典型场景 |
|---|---|---|---|
| **首轮**（自动） | AI 生成 tag 后立即执行 | L0 自定义映射 + L1 name + L2 alias | 已持久化的映射下次同词首轮命中；常规 tag name/alias 精确匹配 |
| **次轮**（自动） | 首轮未命中的 tag 继续降级 | L3 颜色拆分 + L3b 修饰词剥离 | `light gray drooping ears` → `grey_ears + drooping_ears`（L3）；`brimless cap` → `cap` → `hat`（L3b） |
| **末轮**（LLM 兜底） | L0-L4 全失败的 tag | **L5 AI 兜底**：LLM 生成候选词 → 再走 L0-L4 | `B-cup` → LLM 返回 `medium_breasts, small_breasts` → `medium_breasts` 命中标签库 → 替换 + 持久化 |
| **末轮**（人工） | L5 仍未命中的 tag | 人工审核 inline 替换 + 持久化 | LLM 候选词全部未命中 → 用户参考候选词手动输入 → 写入映射表 → 下次首轮 L0 命中（闭环） |

**`B-cup` 的完整处理链路**（含 L5）：

1. **首次 AI 生成 `B-cup`**：
   - L0 lookup('B-cup') → null（无映射）
   - L1/L2/L3/L3b/L4 全失败 → `isValid=false`
   - **L5 AI 兜底**：LLM 返回 `B-cup | medium_breasts, small_breasts, breasts`
   - 候选词 `medium_breasts` 经 L0-L4 验证 → `isValid=true`
   - trait.text 替换为 `medium_breasts`，`source='ai-fallback'`，`addMapping('B-cup', 'medium_breasts')` 持久化
   - 前端显示橙色 🤖 `B-cup → medium_breasts` + ↩ 撤销按钮

2. **下次 AI 生成 `B-cup`**：
   - L0 lookup('B-cup') → `'medium_breasts'`（命中持久化映射）→ `isValid=true, source='user-map'`
   - 不再触发 L5（L0 已命中）

**修改文件**：
- `src/main/services/characterTraitAIService.ts` — 新增 `AI_FALLBACK_MAX_TAGS`/`AI_FALLBACK_SYSTEM_PROMPT` 常量 + `GenerateCharacterTraitsResult.ragDebug.tagValidation` 类型扩展（`aiFallbackAttempted`/`aiFallbackCandidates`/`source` 联合类型新增 `'ai-fallback'`）+ 4 个私有方法（`buildAiFallbackUserMessage`/`parseAiFallbackResponse`/`generateTagSynonymsBatch`/`applyAiFallback`）+ `generateCharacterTraits` 插入兜底环节
- `src/main/services/tagRagService.ts` — `TagValidationItem` 类型扩展 `aiFallbackAttempted`/`aiFallbackCandidates` 字段（由调用方 `applyAiFallback` 写入，`validateTagsAgainstLibrary` 不设置）
- `src/renderer/components/Character/CharacterDialogueChat/RagQualityReport.tsx` — `RagDebugData` 接口扩展 + `RobotOutlined` 图标导入 + `COLORS.aiFallback` + `SOURCE_LABELS['ai-fallback']` + `onRevertAiFallback` prop + `isAiFallbackHit`/`isAiFallbackMiss` 标志 + 优先级链新增两个 AI 兜底分支 + 撤销按钮
- `src/renderer/components/Character/CharacterDialogueChat/AssetManagerModal.tsx` — `ragDebug` state 类型扩展 + `handleRevertAiFallback` 实现 + `onRevertAiFallback` prop 传递

**验证**：tsc 类型检查无新错误（仅 `writing.constants.ts:9` 预先存在错误，与本次无关）；vitest 96 个测试全部通过（tagRagService 58 + userSynonymMapService 28 + tagAutocompleteService 10，无回归）。

**教训**（⚠️ 重点标记）：
1. **LLM 兜底必须设置批量上限**：未匹配 tag 数过多时 LLM 上下文会膨胀导致响应慢/截断，且大部分场景仅 1-3 个顽固未匹配词。`AI_FALLBACK_MAX_TAGS=10` 在覆盖现实场景与控制 LLM 成本间取得平衡，超出跳过整个兜底环节并写日志（而非逐个跳过，避免 N 次 LLM 调用）。
2. **候选词验证必须复用 L0-L4 全链路**：LLM 生成的候选词本身可能已被 `userSynonymMap` 持久化（上次 AI 兜底写入），L0 命中；或候选词是某个 tag 的 alias，L2 命中。一次性调 `validateTagsAgainstLibrary` 走 L0-L4 既能复用全部分层匹配逻辑，又能让候选词的命中来源（`source`）正确透传 —— 不能为候选词单独写「只查 name」的简化逻辑。
3. **AI 兜底命中必须立即持久化**：与人工审核持久化机制一致，AI 兜底命中时调 `addMapping` 写入 `user-synonym-map.json`，下次同词 L0 首轮命中 —— 这是「LLM 兜底」从「单次生效」升级为「持续优化」的关键。持久化失败不阻塞替换（trait.text 已更新），但下次同词仍需走 L5。
4. **撤销 AI 兜底需保留 `aiFallbackAttempted=true`**：与撤销人工替换（清除 `manuallyReplaced`）不同，撤销 AI 兜底后保留 `aiFallbackAttempted=true` 标识「已尝试过 LLM 兜底」，避免下次同词再次触发 LLM 调用（用户撤销 = 认为映射不正确，不应再自动尝试）；UI 显示 invalid 红色 ❌ 且不再展示 ✏ 入口（避免循环），用户如需重新指定需重新生成或改用其他入口。
5. **前端 `isReplaced` 必须排除 `source='ai-fallback'`**：AI 兜底命中虽设置 `replacedBy`，但语义上独立于 L1-L4 自动替换（LLM 生成 vs 标签库匹配）。若 `isReplaced` 不排除，AI 兜底命中会错误走蓝色 🔄 分支而非橙色 🤖 分支，导致撤销按钮调错回调（`onRevertTrait` 而非 `onRevertAiFallback`），不会删除 userSynonymMap 映射，下次同词仍 L0 命中错误映射。

### §7.18 ⚠️ 重点 — 动态场景标签审计（L0-L5 审计链复用 + applyTagAudit 提取）（2026-08-06）

> Spec: `.trae/specs/add-dynamic-scene-tag-audit/spec.md`
> 用户反馈：动态场景指令的 AI 解析按钮生成的提示词（clothing/pose/scene 三组 tag）未经标签库审计，无效 tag 直接进入 SD 生成链路；要求「也要符合上面的审计规则」（即 L0-L5 多轮审计 + AI 兜底）。

**现象**：`generateDynamicScenePrompts` 仅做了 RAG 标签库参考注入（引导 LLM 优先用库内 tag），但生成的 tag 未经验证/纠错，`brimless cap`、`B-cup` 等无效 tag 会直接写入 clothing/pose/scene 字符串，用户需手动逐个排查修改。

**根因**：审计逻辑（validateTagsAgainstLibrary + 自动替换 + AI 兜底）此前仅存在于 `generateCharacterTraits` 中，与 `CategorizedTrait[]` 强耦合（通过 `traits.find(t => t.text === v.tag)` 反查并修改 trait），无法直接复用于动态场景的「逗号分隔字符串」tag 格式。

**修复方案**（4 个改动点，提取公共方法 + 按维度审计）：

1. **提取 `applyTagAudit` 辅助方法**（`characterTraitAIService.ts`）：
   - 将 `generateCharacterTraits` 中 ~120 行审计逻辑（validateTagsAgainstLibrary + L3 颜色拆分 + L2/L3 规范化 + L4 KNN 语义替换 + L5 AI 兜底）提取为独立私有方法
   - 签名：`applyTagAudit(traits: CategorizedTrait[], context, aiConfig, runtimeConfig) → tagValidation[]`
   - `traits` 被原地修改（text 替换 + L3 拆分 push 新 trait），调用方提取 text 即可得到审计后的 tag 列表
   - `context` 参数泛化：`description`（必填，AI 兜底语义参考）/ `personality` / `scenario` / `characterCardId` / `includeImage` —— 动态场景传 `description: naturalLanguageInput, personality: baseTraits, includeImage: false`

2. **`generateCharacterTraits` 重构为调用 `applyTagAudit`**（DRY）：
   - 原 ~120 行内联审计代码替换为一行 `const tagValidation = await this.applyTagAudit(traits, {...}, {...}, {...});`
   - 行为完全等价（机械提取，无逻辑变更），17 个单测 + 58 个 tagRag 单测全通过验证无回归

3. **`generateDynamicScenePrompts` 集成审计**：
   - `buildRagReferenceSection` → `buildRagReferenceWithDebug`（获取 enabled/status/retrievedTags 调试信息）
   - 解析三组 tag 后，按维度分别调 `applyTagAudit`（clothing/pose/scene 各一次）：
     - 构造临时 `CategorizedTrait[]`（categoryId=uncategorized）→ `applyTagAudit` 原地修改 → 提取 text 重组字符串
     - tagValidation 项标注 `dimension` 字段（clothing/pose/scene）
   - AI 兜底上下文：`naturalLanguageInput` 作为 description（语义参考），`baseTraits` 作为 personality
   - 审计后 clothing/pose/scene 字符串中的无效 tag 已被替换为库内标签，ragDebug 记录全部验证/替换结果

4. **前端展示**（`AssetManagerModal.tsx` + `RagQualityReport.tsx`）：
   - 新增 `dynamicSceneRagDebug` state（与角色特征 `ragDebug` 分离，因 tagValidation 携带 dimension 字段）
   - `handleParseDynamicScene` 成功后存储 ragDebug + 自动展开报告面板
   - 在动态场景三组 tag 编辑器下方渲染 `RagQualityReport`（**只读模式**：不传 `onRevertTrait`/`onManualReplace`/`onRevertAiFallback` 回调，tag 在文本框可手动编辑）
   - `RagQualityReport` 新增 `dimension` 字段支持：tag 前展示维度徽标（👕 服装 / 🏃 动作 / 🌐 场景），辅助用户定位 tag 归属
   - `handleClearAll`（清空按钮）同步清空 `dynamicSceneRagDebug`

**类型扩展**：
- `GenerateDynamicScenePromptsResult` 新增 `ragDebug?` 字段（结构与 `GenerateCharacterTraitsResult.ragDebug` 兼容，tagValidation 项额外携带 `dimension?: 'clothing' | 'pose' | 'scene'`）
- `electron.d.ts` 同步扩展 IPC 返回类型
- `RagQualityReport.RagDebugData` 接口新增 `dimension?` 字段

**动态场景审计流程图**：
```
用户输入 NL 指令 → LLM 解析为 clothing/pose/scene 三组 tag
                                    ↓
                    按维度分别调 applyTagAudit：
                    ┌─ clothing tags → validateTagsAgainstLibrary
                    │   → L3 颜色拆分 / L2-L3 规范化 / L4 KNN 替换
                    │   → L5 AI 兜底（LLM 生成候选词 → 再走 L0-L4）
                    │   → 重组 clothing 字符串（无效 tag 已替换）
                    ├─ pose tags → 同上
                    └─ scene tags → 同上
                                    ↓
                    返回 auditedClothing/Pose/Scene + ragDebug
                                    ↓
                    前端展示 RagQualityReport（只读 + 维度徽标）
                    用户可在文本框手动编辑 → 保存为方案
```

**修改文件**：
- `src/main/services/characterTraitAIService.ts` — 新增 `applyTagAudit` 辅助方法（~140 行）+ `generateCharacterTraits` 重构为调用它 + `GenerateDynamicScenePromptsResult` 扩展 ragDebug + `generateDynamicScenePrompts` 集成审计
- `src/renderer/types/electron.d.ts` — `generateDynamicScenePrompts` 返回类型扩展 ragDebug
- `src/renderer/components/Character/CharacterDialogueChat/RagQualityReport.tsx` — `RagDebugData` 接口新增 `dimension?` + `DIMENSION_LABELS` 常量 + tag 前维度徽标渲染
- `src/renderer/components/Character/CharacterDialogueChat/AssetManagerModal.tsx` — `dynamicSceneRagDebug`/`dynamicSceneRagVisible` state + `handleParseDynamicScene` 存储 ragDebug + RagQualityReport 只读渲染 + `handleClearAll` 同步清空

**验证**：tsc 类型检查无新错误（仅 `writing.constants.ts` 预存错误）；vitest 113 个测试全通过（characterTraitAIService 17 + tagRagService 58 + userSynonymMapService 28 + tagAutocompleteService 10，含重构后回归验证）。

**教训**（⚠️ 重点标记）：
1. **审计逻辑应与数据结构解耦**：原审计逻辑通过 `traits.find(t => t.text === v.tag)` 反查 `CategorizedTrait[]` 并修改 text，与具体数据结构强耦合。提取 `applyTagAudit` 后，调用方只需构造临时 `CategorizedTrait[]`（任何 tag 来源都可适配），审计后提取 text 即可 —— 动态场景的「逗号分隔字符串」tag 也能复用完整 L0-L5 审计链。⚠️ 编写可复用业务逻辑时，应避免与特定数据结构（如 store 的 CategorizedTrait[]）强耦合，用「临时对象 + 原地修改 + 提取结果」模式解耦。
2. **按维度分别审计优于批量审计**：动态场景有 clothing/pose/scene 三个维度，最初考虑「全部 tag 合并一次性审计 + 维度追踪」，但 L3 颜色拆分会新增 tag（维度归属需额外追踪），复杂度高。改为「按维度分别审计」后，每个维度的 tag 独立验证/替换/重组，无需维度追踪逻辑 —— 牺牲少量性能（3 次 validateTagsAgainstLibrary 而非 1 次，每次 <100ms）换取代码简洁性，是正确的工程权衡。
3. **只读报告 vs 交互式报告的选型**：角色特征的 RagQualityReport 是交互式（撤销/手动替换按钮），因为 traits 是结构化对象数组（`updateTrait(id, text)` 精确操作）。动态场景的 tag 是逗号分隔字符串（在可编辑文本框中），撤销/替换需做字符串替换（fragile，tag 可能重复出现），故采用**只读报告**——审计在后端自动完成（无效 tag 已替换），用户在文本框手动编辑即可。⚠️ 复用组件时需根据数据结构特性选择交互模式，不能强行套用。
4. **`buildRagReferenceSection` vs `buildRagReferenceWithDebug`**：前者仅返回 prompt 字符串（用于注入 system prompt），后者额外返回 enabled/status/retrievedTags（用于质检报告）。动态场景原仅用前者（只需注入 prompt），审计集成后改用后者以获取调试信息。⚠️ 两个方法职责不同，新增「质检报告」需求时需切换到 Debug 版本。

### §7.19 ⚠️ 重点 — AssetGenerateModal 动态场景方案下拉 × 清除不生效（2026-08-07）

> 用户反馈：在 AI 素材生成页面（AssetGenerateModal）中，动态场景方案如果有方案的话会被自动选择且无法删除（点击后面的 × 不生效）。

**现象**：AssetGenerateModal 的动态场景方案 `<Select allowClear>` 下拉，点击 × 清除按钮无反应，`activeDynamicScenePromptId` 保持原值，用户无法在生成弹窗内取消激活方案。

**根因**：[AssetGenerateModal.tsx:2390-2397](file:///g:/AI/creative-cafe/src/renderer/components/Character/CharacterDialogueChat/AssetGenerateModal.tsx#L2390) 的 `onChange` 回调实现：
```tsx
onChange={(id) => {
  // allowClear 触发时 id 为 undefined，此时不调用 applyDynamicScenePrompt
  // （store 的 activeDynamicScenePromptId 保持原值，用户需在 AssetManagerModal
  //   显式删除方案才会重置为 null；此处清除为 no-op，避免误清空激活状态）
  if (typeof id === 'string' && id) {
    applyDynamicScenePrompt(id);
  }
}}
```
- antd Select 的 `allowClear` 触发时 `id` 为 `undefined`，被 `if (typeof id === 'string' && id)` 短路成 no-op
- 原注释「避免误清空激活状态」的设计假设是错的：用户在生成弹窗点 × 就是想取消激活，不应强制用户去 AssetManagerModal 删除方案才能取消
- store 层 `applyDynamicScenePrompt(id: string)` 签名只接受 string，无法表达「取消激活」语义，是导致前端用 `if` 短路的根本原因

**关于「自动选择」**：`saveDynamicScenePrompt` 创建方案时自动设 `activeDynamicScenePromptId` 为新 id（[characterTraitStore.ts:1195](file:///g:/AI/creative-cafe/src/renderer/stores/characterTraitStore.ts#L1195)），这是 Spec Scenario「保存为方案并自动激活」的明确设计，非 bug。问题在于激活后用户无法在 AssetGenerateModal 内取消激活（× 不生效），给人「被自动选择且无法删除」的错觉。

**修复方案**（3 个改动点，store 接口扩展 + 透传 null）：

1. **`characterTraitStore.ts` — `applyDynamicScenePrompt` 签名扩展为 `string | null`**：
   - 接口：`applyDynamicScenePrompt: (id: string | null) => Promise<{success, error?}>`
   - 实现新增 `id === null` 分支：`set({ activeDynamicScenePromptId: null })` + `saveTraits()` 持久化
   - 已是 null 时短路（无需重复持久化）
   - 非 null 分支行为不变（防御性校验 id 在列表中 + 已激活短路 + set + 持久化）

2. **`AssetGenerateModal.tsx` — onChange 透传 null**：
   ```tsx
   onChange={(id) => {
     // ⚠️ 2026-08-07 修复：allowClear 触发时 id 为 undefined，
     // 透传 null 给 applyDynamicScenePrompt 取消激活。
     applyDynamicScenePrompt(id ?? null);
   }}
   ```
   - 删除原 `if (typeof id === 'string' && id)` 短路逻辑
   - 同步更新上方注释块中关于 allowClear 的描述

3. **`AssetManagerModal.tsx` — `handleApplyDynamicScene` 签名同步**：
   - 该 Select 无 `allowClear`，实际只会传 string，但 TS 签名需匹配 store 接口扩展
   - `async (id: string) => ` → `async (id: string | null) => `

**修改文件**：
- `src/renderer/stores/characterTraitStore.ts` — `applyDynamicScenePrompt` 接口签名 + 实现新增 null 分支
- `src/renderer/components/Character/CharacterDialogueChat/AssetGenerateModal.tsx` — onChange 透传 `id ?? null` + 注释更新
- `src/renderer/components/Character/CharacterDialogueChat/AssetManagerModal.tsx` — `handleApplyDynamicScene` 签名同步为 `string | null`

**验证**：tsc 类型检查无新错误（仅预存错误）；characterTraitAIService 17 个单测全通过（无回归）。

**教训**（⚠️ 重点标记）：
1. **`allowClear` 的 `undefined` 语义必须被正确处理**：antd Select 的 `allowClear` 触发时 `onChange` 收到 `undefined`，这是「用户想清除」的明确语义。用 `if (typeof id === 'string')` 短路掉 undefined 等于废掉 allowClear 功能。⚠️ 凡是带 `allowClear` 的 Select，其 onChange 必须显式处理 `undefined` 分支（透传 null/空给 store action），不能当 no-op。
2. **store action 签名应支持「取消」语义**：原 `applyDynamicScenePrompt(id: string)` 只能「激活」，无法「取消激活」，迫使前端用 if 短路 undefined。扩展为 `id: string | null` 后，null 表达「取消」语义，前端直接透传 `id ?? null` 即可。⚠️ 设计 store action 时需考虑「置空」场景，签名应支持 `T | null`（而非仅 `T`），否则前端会被迫写防御性短路逻辑。
3. **「避免误清空」是错误的设计假设**：原注释「清除为 no-op，避免误清空激活状态」看似防御性，实则剥夺了用户的取消能力。用户点 × 就是想清除，不应替用户决定「不能清空」。⚠️ 防御性逻辑应针对「意外触发」（如误点击），而非「用户明确意图」；对于用户的显式操作（点 × 清除），应直接执行，不应用 no-op 吞掉。

### §7.20 — AssetGenerateModal 保存后不再关闭弹窗（支持连续生成多张图像）（2026-08-07）

> 用户反馈：图片生成后点击保存按钮会让弹窗关闭，但用户可能需要一次多生成几个图像，每次保存都要重新打开弹窗很繁琐。

**现象**：`AssetGenerateModal` 单次生成成功后点击「保存」按钮，保存成功即调 `onClose()` 关闭弹窗。用户若想连续生成多张立绘/一般图像，每次保存后都需重新打开弹窗、重选参数，体验割裂。

**根因**：[AssetGenerateModal.tsx:1249](file:///g:/AI/creative-cafe/src/renderer/components/Character/CharacterDialogueChat/AssetGenerateModal.tsx#L1249) `handleSingleSave` 的 4 个模式分支（single-expression / illustration / general / three-view）在 `result.success` 后都调用 `onClose()`，强制关闭弹窗。原设计假设「保存 = 流程结束」，但立绘/一般图像场景常见「一次生成多张」需求（每次生成独立 ID，line 957-958），保存后关闭打断连续生成流程。

**修复方案**：移除 `handleSingleSave` 4 个分支中的 `onClose()` 调用，保留 `onGenerated?.()`（通知父组件刷新）+ `message.success`（用户反馈）。

- 用户保存后弹窗保持打开，可点击「重新生成」追加新图到历史，或点击「关闭」主动退出
- `useCallback` 依赖数组同步移除 `onClose`
- 成功状态 Alert 提示文案补充「保存后弹窗保持打开，可继续生成更多图像」
- 顶部新增注释说明行为变更

**各模式重复保存的安全性分析**（为何移除 onClose 不会引入副作用）：
- **illustration / general**：每次保存用 `ill_{timestamp}` / `gen_{timestamp}` 独立 ID（line 957-958），重复保存产生独立素材文件，用户可在素材管理删除多余项；这正是「连续生成多张」的预期行为
- **single-expression**：`saveExpression` 按 emotion key 覆盖保存，同 key 同图重复保存幂等，无副作用
- **three-view**：按 slot（front/side/back）覆盖保存，同 slot 同图重复保存幂等，无副作用
- **batch-expression**：不经 `handleSingleSave`（批量生成自动保存，line 1035），不受本次改动影响

**修改文件**：
- `src/renderer/components/Character/CharacterDialogueChat/AssetGenerateModal.tsx` — `handleSingleSave` 4 个分支移除 `onClose()` + 依赖数组同步 + Alert 文案补充 + 顶部注释

**验证**：tsc 类型检查无新错误（仅预存错误）。

**教训**：
1. **「保存 = 流程结束」是错误假设**：原设计把保存作为弹窗生命周期的终点，但图像生成场景常见「连续生成多张」需求（每次独立 ID）。⚠️ 保存操作不应隐含关闭弹窗的副作用，应让用户显式点击「关闭」退出，保留继续操作的可能性。
2. **重复保存的幂等性/独立性应提前分析**：移除关闭逻辑后，用户可能误点保存产生重复。本次改动前已分析各模式保存语义（独立 ID vs 覆盖幂等），确认无副作用才移除。⚠️ 修改「保存后行为」时需同步分析「重复保存」的影响：覆盖语义幂等无碍，独立 ID 语义产生重复项但可由用户在管理界面删除。

### §7.21 AI 生成标签中文翻译功能（Spec: add-ai-tag-chinese-translation）

> 实施日期：2026-08-07 | Spec: `.trae/specs/add-ai-tag-chinese-translation/spec.md`（Task 1-9 全量实施）
> 本节归档 AI 生成标签中文翻译功能的完整实施记录，含两个 Task 8 验证阶段发现的重点 Bug。

#### 1. 背景与需求

- **用户需求**：AI 生成的角色特征标签（角色特征页签）和动态场景提示词（图片生成页签）需要在鼠标 hover 时显示中文翻译，降低用户理解成本。
- **覆盖范围**：
  - 角色特征页签（`AssetManagerModal`）— AI 生成的 `CharacterTraitItem`
  - 图片生成页签（`AssetGenerateModal`）— AI 生成的动态场景三组 tag（clothing/pose/scene）
- **范围限定**：仅 AI 原创生成的标签携带翻译；标签库中的标准 tag（经审计替换后）无翻译。手动编辑 / AI 审计替换 / 颜色拆分 / 人工审核替换后清空 `translation`，避免翻译与新 tag 文本不符。

#### 2. 设计决策

- **翻译存储策略**：
  - `CategorizedTrait` / `CharacterTraitItem` 新增 `translation?: string` 字段（单一字符串，与 `text` 一一对应）
  - `DynamicScenePrompt` 新增 `clothingTranslations?` / `poseTranslations?` / `sceneTranslations?` 三个逗号分隔字符串字段（与 `clothing`/`pose`/`scene` 一一对应，按索引对齐）
- **AI prompt 输出格式**：
  - 角色特征：从 `分类:tag` 改为 `分类:tag|中文翻译`
  - 动态场景：从 `tag` 改为 `tag|中文翻译`
  - 解析时按第一个 `|` 切分，翻译中可含 `|`（避免误切）
- **翻译清空时机**（避免翻译与新 tag 不符）：
  - 手动编辑 `trait.text`（行内编辑保存）
  - AI 审计替换（L2-L5 全链路：L2 规范化 / L3 颜色拆分 / L4 KNN / L5 AI 兜底）
  - 颜色拆分（L3 颜色剥离分词时，拆分产物无原翻译）
  - 人工审核替换（末轮 user-map 替换）
  - 动态场景对应位置翻译置为空字符串（保持索引一一对应）
- **前端展示**：antd `<Tooltip title={trait.translation || ''}>` 包裹标签文本。空 title 不弹出（antd Tooltip 默认行为），不影响点击进入编辑态的行为。

#### 3. 实施步骤（对应 tasks.md Task 1-9）

| Task | 内容 | 涉及文件 |
| --- | --- | --- |
| Task 1 | 类型扩展（`CategorizedTrait` / `CharacterTraitItem` / `DynamicScenePrompt` 新增翻译字段） | `src/shared/types/characterTrait.types.ts` |
| Task 2 | AI prompt 输出格式调整 + 解析逻辑（`CHARACTER_TRAIT_SYSTEM_PROMPT` / `DYNAMIC_SCENE_SYSTEM_PROMPT` 输出 `分类:tag\|中文翻译` / `tag\|中文翻译`；`parseTraitsFromContent` / `parseDynamicSceneResponse` / `normalizeDynamicSceneTagsWithTranslations` 解析翻译） | `src/main/services/characterTraitAIService.ts` |
| Task 3 | `applyTagAudit` 替换 trait.text 时同步清空 translation（L2/L3 规范化、L3 颜色拆分、L4 KNN、L5 AI 兜底） | `src/main/services/characterTraitAIService.ts` |
| Task 4 | store 编辑/替换清空翻译（`characterTraitStore.updateTrait` 清空 / `setTraits` 透传 / `saveDynamicScenePrompt` 透传） | `src/renderer/stores/characterTraitStore.ts` |
| Task 5 | `AssetManagerModal.renderTraitChip` Tooltip 展示翻译 | `src/renderer/components/Character/CharacterDialogueChat/AssetManagerModal.tsx` |
| Task 6 | `AssetGenerateModal` 特征 Tag Tooltip 展示翻译 + 行内编辑清空翻译 | `src/renderer/components/Character/CharacterDialogueChat/AssetGenerateModal.tsx` |
| Task 7 | `AssetManagerModal` 动态场景三组改为 Tag 列表展示（Tag hover Tooltip + × 删除 + 双击行内编辑 + 添加按钮） | `src/renderer/components/Character/CharacterDialogueChat/AssetManagerModal.tsx` |
| Task 8 | 持久化与向后兼容验证（详见下方两个重点 Bug） | `src/main/services/characterTraitService.ts` / `src/renderer/types/electron.d.ts` |

#### 4. ⚠️ 重点标记 Bug：`normalizeTraitItem` 丢弃 translation 字段（Task 8 验证阶段发现）

**现象**：AI 生成的特征标签翻译在重启应用后丢失（加载时被丢弃），保存到磁盘时也被丢弃。

**根因**：`characterTraitService.normalizeTraitItem`（`characterTraitService.ts:165`）在构造返回对象时只包含 `id` / `text` / `categoryId` / `enabled` 四个字段，遗漏了 `translation` 字段。该方法在 `loadTraitData`（加载 v2 manifest）和 `saveTraitData`（保存 v2 manifest）中都被调用，导致 translation 在加载和保存两个路径上都被剥离。

**修复**：在 `normalizeTraitItem` 返回对象中新增 `translation` 透传，使用 `typeof r.translation === 'string' && r.translation ? r.translation : undefined` 做类型校验和兜底。

**教训**：⚠️ 新增可选字段到持久化数据结构时，必须检查所有「对象重构」路径（如 normalize/sanitize/migrate 函数），不能假设 JSON.parse/JSON.stringify 会自动处理——显式构造新对象的方法会丢弃未列出的字段。这与之前 `globalCategories` 合并 bug（需全局搜索 `validCategoryIds`）是同类问题：数据流每层校验都需要同步更新数据源。

#### 5. ⚠️ 重点标记 Bug：`electron.d.ts` IPC 返回类型未同步扩展（Task 8 验证阶段发现）

**现象**：渲染进程访问 `result.clothingTranslations` 等 IPC 返回字段时 TypeScript 报错「Property does not exist」。

**根因**：主进程 `GenerateDynamicScenePromptsResult` 类型已扩展 `clothingTranslations?` 等字段，但 `electron.d.ts` 中 `generateDynamicScenePrompts` 的内联返回类型签名未同步扩展（仍只有 clothing/pose/scene/error/ragDebug）。

**临时绕过**：渲染进程用 `result as typeof result & {...}` 类型断言访问。

**修复**：在 `electron.d.ts` 的 `generateDynamicScenePrompts` 返回类型中新增三个翻译字段，移除 `AssetManagerModal` 中的类型断言。

**教训**：⚠️ 主进程类型扩展后，必须同步检查 `electron.d.ts` 中对应的内联类型签名是否需要同步扩展。`electron.d.ts` 是渲染进程的 IPC 类型真源，主进程类型不能直接被渲染进程引用（详见 `electron.d.ts` 顶部注释），所以主进程类型扩展不会自动反映到渲染进程。

#### 6. 向后兼容

- **旧 v2 manifest**（无 `translation` 字段）加载时由 `normalizeTraitItem` 兜底 `undefined`，前端 Tooltip 不显示。
- **旧 `DynamicScenePrompt`**（无 `*Translations` 字段）加载时直接透传（`undefined`），UI `useEffect` 兜底为空字符串。
- **旧 LLM 输出**（无 `|中文翻译` 后缀）解析时 translation 为 `undefined` / 空字符串，与 clothing/pose/scene 一一对应。

#### 7. 涉及文件清单

- `src/shared/types/characterTrait.types.ts` — `CategorizedTrait` / `CharacterTraitItem` / `DynamicScenePrompt` 类型扩展
- `src/main/services/characterTraitAIService.ts` — prompt + 解析 + `applyTagAudit` 清空翻译
- `src/main/services/characterTraitService.ts` — `normalizeTraitItem` 透传 translation（Task 8 bug 修复）
- `src/renderer/types/electron.d.ts` — `generateDynamicScenePrompts` 返回类型扩展（Task 8 bug 修复）
- `src/renderer/stores/characterTraitStore.ts` — `updateTrait` 清空翻译 / `setTraits` 透传翻译 / `saveDynamicScenePrompt` 透传翻译
- `src/renderer/components/Character/CharacterDialogueChat/AssetManagerModal.tsx` — `renderTraitChip` Tooltip + 动态场景 Tag 列表 + 移除类型断言
- `src/renderer/components/Character/CharacterDialogueChat/AssetGenerateModal.tsx` — 特征 Tag Tooltip + 行内编辑清空翻译

## §8 性能优化基线（optimize-system-rendering-performance）

> Spec: `.trae/specs/optimize-system-rendering-performance/spec.md` — Task 1
> 创建日期: 2026-08-06
> 遵循"先测量后优化"原则：在执行任何渲染性能优化（路由懒加载、虚拟滚动、图片懒加载等）之前，先固化基线数据。

### §8.1 基线指标表

| 指标 | 基线值（待采集） | 优化后值（待采集） | 提升幅度 | 达标 |
|------|------------------|---------------------|----------|------|
| 列表滚动平均帧间隔(ms) | _待回填_ | _待回填_ | _待计算_ | ≤100ms |
| 列表滚动FPS | _待回填_ | _待回填_ | _待计算_ | ≥60fps |
| 图片网格首屏完成时间(ms) | _待回填_ | _待回填_ | _待计算_ | 基线×50% |
| 初始chunk体积(KB) | _待回填_ | _待回填_ | _待计算_ | 基线×70% |
| 长任务数(>50ms) | _待回填_ | _待回填_ | _待计算_ | 0 |

### §8.2 基线采集步骤

> ⚠️ 基线值待用户在 dev 模式采集后回填。在基线回填前，Task 10 的优化后验证无法判定达标。

1. **启动应用**：`npm run dev` 启动开发服务器，Electron 主进程自动拉起。
2. **准备大数据集**：
   - 100+ 资产的角色卡（在 `AssetManagerModal` 立绘 / 一般图像 Tab 中导入或生成足够素材）
   - 50+ 角色卡（在 `CharacterManager` 中准备大量角色卡条目）
3. **采集运行时指标**（在 DevTools Console 中操作）：
   - 打开 DevTools（`Ctrl+Shift+I`）
   - 临时将 perfBaseline 工具挂到 `window` 上以便调用：
     ```ts
     // 在 Console 中执行
     import('@renderer/utils/perfBaseline').then(m => { window.perfBaseline = m; });
     ```
   - 测量滚动 FPS — 先定位到目标滚动容器（如 AssetManagerModal 的网格 ScrollContainer），然后在 Console 执行：
     ```ts
     const container = document.querySelector('.ant-modal-body .asset-grid-scroll') as HTMLElement;
     window.perfBaseline.measureScrollFPS(container, 3000).then(r => console.log(window.perfBaseline.formatBaselineReport(r)));
     // 执行后立即在 UI 中滚动目标容器，持续 3 秒
     ```
   - 测量首屏完成时间 — 打开 AssetManagerModal 立绘 Tab 后立即执行：
     ```ts
     window.perfBaseline.measureFirstScreenComplete('.ant-modal-body').then(r => console.log(window.perfBaseline.formatBaselineReport(r)));
     ```
   - 测量长任务 — 注册观察者后操作 UI：
     ```ts
     const stop = window.perfBaseline.startLongTaskObserver(d => console.warn('[longtask]', d, 'ms'));
     // 操作 UI 后调用 stop() 停止
     ```
4. **采集 bundle 体积**：
   - `npm run build` 执行生产构建
   - 打开 `dist/stats.html`（visualizer 自动生成的 treemap 报告）
   - 记录初始 chunk（main entry）体积（KB），以及 gzip / brotli 压缩后体积
5. **回填基线值**：将采集到的数值填入上方 §8.1 表格的「基线值」列。

### §8.3 工具文件

| 文件 | 说明 |
|------|------|
| `src/renderer/utils/perfBaseline.ts` | 性能基线测量工具（Performance API），仅 dev 模式生效 |
| `vite.config.ts` | 新增 `rollup-plugin-visualizer` 插件（renderer build only），输出 `dist/stats.html`（filename 相对 outDir，勿再写 `dist/stats.html`） |

### §8.4 达标判定标准

- **列表滚动平均帧间隔** ≤ 100ms（对应 FPS ≥ 10，但实际目标 ≥ 60fps 即 ≤16.67ms 间隔）
- **列表滚动FPS** ≥ 60fps
- **图片网格首屏完成时间** ≤ 基线 × 50%（下降 ≥ 50%）
- **初始chunk体积** ≤ 基线 × 70%（下降 ≥ 30%）
- **长任务数(>50ms)** = 0

> 优化后验证将在 Spec Task 10 中执行，对比基线与优化后数据判定是否达标。

### §8.5 ⚠️ 重点标记：visualizer 静态 import 构建失败（Task 1 → Task 2 修复）

**现象**：Task 1 在 `vite.config.ts` 用静态 `import { visualizer } from 'rollup-plugin-visualizer'`，`npm run build` 直接报错（模块无法加载）。

**根因**：`rollup-plugin-visualizer@7` 是 **ESM-only** 包，而本项目 `package.json` 未设 `"type": "module"`，esbuild 将 `vite.config.ts` 编译为 CJS 后用 `require()` 加载该 ESM 包，运行时失败。Task 1 子代理未实际跑 `npm run build` 验证，仅 `tsc --noEmit`（类型层面通过，掩盖了运行时加载问题）。

**修复（Task 2 执行）**：将 `defineConfig({...})` 改为 `defineConfig(async (): Promise<UserConfig> => { const { visualizer } = await import('rollup-plugin-visualizer'); return {...} })`，用动态 `import()` 绕过 CJS `require` 路径。

**附带 bug**：Task 1 原写 `filename: 'dist/stats.html'` + `emitFile: true`，因 `emitFile` 时 filename 相对 rollup `outDir`（即 `dist`），实际生成 `dist/dist/stats.html`。已修正为 `filename: 'stats.html'`。

**经验教训（重点）**：
- 引入仅 ESM 的 dev 依赖到 CJS 项目时，必须用动态 `import()`，并在 PR 中**实际运行 `npm run build`** 验证，不能只靠 `tsc`。
- `emitFile: true` 的 filename 是相对 outDir 的，不要再带 outDir 前缀。
- 子代理交付构建类改动时，强制要求「跑一次 build」而非仅类型检查——已纳入后续 Task 验收标准。

### §8.6 zustand store selector 审计（Task 9.1）

**审计目标**：renderer 组件中 `useXxxStore()` 无参订阅（订阅整个 store，任意 state 变更均触发 re-render）改为基于 selector 的精准订阅。zustand v5 中无参 `useStore()` 已废弃/不推荐。

**审计范围**：`src/renderer/` 下所有 `.ts/.tsx` 文件，共扫描出 **105** 处无 selector 调用点。

#### 统计汇总

| 分类 | 数量 |
|------|------|
| 无 selector 调用点总数 | 105 |
| 已修复（转为 selector） | 93 |
| 暂缓（>5 字段，加 TODO 注释） | 12 |

**转换策略**：项目中未引入 `zustand/shallow`，故统一采用「每字段独立 selector」方式（最安全、无新 import）：
- 单字段：`const field = useXxxStore(s => s.field);`
- 多字段（2-5）：每个字段一行独立 selector
- 多字段（>5）：保留原订阅，上方/下方加 `// TODO(perf): 整体订阅，待拆分为 selector（N 字段，>5 暂缓）`

#### 已修复站点（93 处，按文件分组）

| 文件 | 修复的订阅（store → 字段数） |
|------|------|
| `src/renderer/App.tsx` | useUIStore → 3 |
| `src/renderer/hooks/useAiConfig.ts` | useSettingStore → 1 |
| `components/AgentCenter/AgentCenter.tsx` | useUIStore → 1 |
| `components/Avatar/AvatarManager.tsx` | useDataStore → 1, useLogStore → 1 |
| `components/Chat/SingleChatDialog.tsx` | useDataStore → 3 |
| `components/Chat/CreationCenter.tsx` | useDataStore → 3, useFavoritesStore → 2 |
| `components/Character/CharacterManager.tsx` | useDataStore → 3, useWorldBookStore → 2, useUIStore → 1, useSettingStore → 2, useLogStore → 1 |
| `components/Character/CharacterCardGenerateModal.tsx` | useSettingStore → 2 |
| `components/Character/CharacterDialogueChat/CharacterDialogueChat.tsx` | useFavoritesStore → 3 |
| `components/Character/CharacterDialogueChat/CharacterDialogueChat.hooks.ts` | useCharacterChatStore → 1 |
| `components/Character/CharacterDialogueChat/AssetManagerModal.tsx` | useAssetStore → 5（ThreeViewTab）, useSettingStore → 1, useCharacterLoraStore → 3 |
| `components/Character/CharacterDialogueChat/AssetGenerateModal.tsx` | useExpressionStore → 2, useAssetStore → 1, useSettingStore → 1, useCharacterLoraStore → 3 |
| `components/Character/CharacterDialogueChat/ExpressionGenerateModal.tsx` | useExpressionStore → 2, useCharacterLoraStore → 3, useCharacterTraitStore → 3 |
| `components/Common/ThemeProvider.tsx` | useUIStore → 1 |
| `components/Common/TagAutocomplete.tsx` | useSettingStore → 2 |
| `components/Common/MarkdownEditor/MarkdownEditor.tsx` | useSettingStore → 1, useLogStore → 1 |
| `components/Common/MarkdownEditor/MarkdownAITools.tsx` | useSettingStore → 1, useLogStore → 1 |
| `components/Creative/CreativeManager.tsx` | useUIStore → 3 |
| `components/Creative/CreativeSubNav.tsx` | useUIStore → 2 |
| `components/Creative/CreativeListPage.tsx` | useUIStore → 3 |
| `components/Creative/CreativeEditPage.tsx` | useUIStore → 3, useCreativeStore → 4 |
| `components/Creative/WorldBookListPage.tsx` | useUIStore → 3 |
| `components/Creative/WorldBookEditPage.tsx` | useCreativeStore → 4, useUIStore → 3 |
| `components/Creative/WorldBookEditor.tsx` | useCreativeStore → 5, useSettingStore → 2, useLogStore → 1, useUIStore → 1 |
| `components/Creative/CharacterCardListPage.tsx` | useUIStore → 4, useCreativeStore → 4 |
| `components/Creative/CharacterCardEditPage.tsx` | useUIStore → 3, useCreativeStore → 4 |
| `components/Creative/hooks/useCreativeAI.ts` | useSettingStore → 1, useLogStore → 1 |
| `components/Creative/FormatExport/WorldBookExport.tsx` | useCreativeStore → 1, useLogStore → 1 |
| `components/Creative/FormatExport/CharacterCardExport.tsx` | useCreativeStore → 2, useLogStore → 1 |
| `components/Dashboard/Dashboard.tsx` | useDataStore → 5, useWorldBookStore → 3, useSettingStore → 3, useUIStore → 1, useLogStore → 1, useVectorStore → 4 |
| `components/KnowledgeBase/VectorSearchPanel.tsx` | useVectorStore → 1 |
| `components/KnowledgeBase/UploadDocumentModal.tsx` | useKnowledgeBaseStore → 5 |
| `components/Layout/Sidebar.tsx` | useUIStore → 5, useSettingStore → 1 |
| `components/Layout/Header.tsx` | useUIStore → 2, useSettingStore → 1 |
| `components/Layout/PageTransition.tsx` | useUIStore → 1 |
| `components/MemoryChat/MemoryChatManager.tsx` | useUIStore → 1 |
| `components/MemoryChat/ChatManager.tsx` | useLogStore → 1, useSettingStore → 1 |
| `components/PromptManagement/PromptAssemblyView.tsx` | useUIStore → 1 |
| `components/Settings/Settings.tsx` | useSettingStore → 4, useLogStore → 1 |
| `components/Settings/hooks/useAIEngineSettings.ts` | useSettingStore → 3, useLogStore → 1 |
| `components/Settings/WebSearchSettings.tsx` | useSettingStore → 1 |
| `components/Settings/TagAutocompleteSettings.tsx` | useSettingStore → 1 |
| `components/Settings/SDWebuiSettings.tsx` | useSettingStore → 1 |
| `components/Settings/AIEngineSettingsPanel.tsx` | useSettingStore → 1 |
| `components/Test/TestPage.tsx` | useUIStore → 2 |
| `components/Vector/VectorScopeSelector.tsx` | useVectorStore → 1（VectorScopeTag 组件） |
| `components/Vector/VectorConfigPanel.tsx` | useSettingStore → 1 |
| `components/WorldBook/WorldBookManager.tsx` | useWorldBookStore → 4, useUIStore → 1, useSettingStore → 2, useLogStore → 1 |
| `components/WorldBook/WorldBookList.tsx` | useWorldBookStore → 4, useUIStore → 1, useLogStore → 1 |
| `components/WorldBook/WorldBookAuthoringModal.tsx` | useWorldBookStore → 1, useSettingStore → 1 |
| `components/WorldBook/TagManager.tsx` | useLogStore → 1 |

#### 暂缓站点（12 处，已加 `// TODO(perf): 整体订阅，待拆分为 selector` 注释）

| 文件:行 | store | 字段数 | 暂缓原因 |
|------|------|------|------|
| `Vector/VectorScopeSelector.tsx:30` | useVectorStore | 6 | >5 字段 |
| `Vector/VectorConfigPanel.tsx:98` | useVectorStore | 6 | >5 字段 |
| `Settings/GeneralSettingsPanel.tsx:31` | useUIStore | 6 | >5 字段 |
| `PromptManagement/PromptManagement.tsx:106` | usePromptStore | 9 | >5 字段 |
| `KnowledgeBase/KnowledgeItemList.tsx:46` | useKnowledgeBaseStore | 6 | >5 字段 |
| `Creative/WorldBookListPage.tsx:20` | useCreativeStore | 6 | >5 字段 |
| `Creative/CreativeListPage.tsx:25` | useCreativeStore | 6 | >5 字段 |
| `Character/CharacterDialogueChat/ExpressionManagerModal.tsx:66` | useExpressionStore | 7 | >5 字段 |
| `Character/CharacterDialogueChat/AssetManagerModal.tsx:259` | useExpressionStore | 8 | >5 字段（列表组件，Task 3-5 处理） |
| `Character/CharacterDialogueChat/AssetManagerModal.tsx:1092` | useAssetStore | 6 | >5 字段（列表组件，Task 3-5 处理） |
| `Character/CharacterDialogueChat/AssetManagerModal.tsx:2079` | useCharacterTraitStore | 25+ | >5 字段，字段极多（列表组件，Task 3-5 处理） |
| `Character/CharacterDialogueChat/AssetGenerateModal.tsx:360` | useCharacterTraitStore | 8 | >5 字段 |

#### 改动约束遵守情况

- ✅ 仅修改 store 订阅调用点，未触碰组件渲染逻辑 / 列表渲染
- ✅ 未添加 React.memo / useCallback（属 Task 3-5）
- ✅ 未修改 store 定义（`src/renderer/stores/*.ts`）
- ✅ AssetManagerModal / CharacterManager 等列表组件：仅转换订阅调用点，渲染逻辑未动
- ✅ 重命名变量保持一致（如 `{ theme: appTheme }` → `const appTheme = useUIStore(s => s.theme)`）

#### 预估 re-render 优化影响

- **高频受益组件**：`Header`、`Sidebar`、`Dashboard`、`PageTransition`、`ThemeProvider` 等全局/常驻组件，原订阅整个 uiStore/settingStore，任意 UI state 变更（如 `activeTab`、`sidebarCollapsed`）均触发 re-render；改为 selector 后仅订阅 `theme`/`animationEnabled` 等单字段，re-render 大幅减少。
- **settingStore 全局污染消除**：项目约 20+ 组件订阅 settingStore（仅用 `setting` 字段），原任意 setting 子字段变更（如 sdWebui、tagAutocomplete）均触发所有这些组件 re-render；改 selector 后仅 `setting` 引用变更时才 re-render。
- **logStore addLog 隔离**：约 15 处 `{ addLog } = useLogStore()` 改为 selector，新增日志不再触发订阅 addLog 的组件 re-render（addLog 为稳定 action 引用，selector 比较 Object.is 永远不变）。
- **未量化**：暂缓的 12 处（尤其 AssetManagerModal 的 25+ 字段订阅）仍是整体订阅，待 Task 3-5 列表组件优化时一并处理。

#### TypeScript 验证

- `npx tsc --noEmit`：修改后 726 个错误，与修改前基线（~725 / stash 后 747 含其他工作区改动）基本持平，**未引入新错误**。唯一位于修改行的错误 `AvatarManager.tsx(67,9): 'fetchAvatars' is declared but its value is never read` 为**预存问题**（原解构 `const { fetchAvatars } = useDataStore()` 同样触发 TS6133）。

### §8.7 AssetManagerModal 素材网格虚拟化（Task 3 + SubTask 9.2）

**Spec:** optimize-system-rendering-performance / Task 3 + SubTask 9.2（实施日期 2026-08-06）

**目标**：虚拟化 `AssetManagerModal.tsx` 中 `AssetGridTabContent`（立绘 / 一般图像）的素材网格，使 100+ 资产滚动响应 ≤ 100ms（原 1-2s）。同时合并 SubTask 9.2（React.memo + useCallback on grid items）。

**修改文件**：
- `src/renderer/components/Character/CharacterDialogueChat/AssetManagerModal.tsx`（唯一修改文件）

#### 虚拟化方案（SubTask 3.1）

采用「行虚拟化 + 行内多列」模式（grid virtualization），参照项目已有 `VirtualizedMessageList.tsx` 的 `useVirtualizer` 模式改造为网格多列：

1. **`AssetVirtualGrid` 组件**（文件内联，不新增文件）：
   - 滚动容器：组件自身持有 `overflowY: auto` 的 div（`maxHeight: calc(100vh - 280px)`，`minHeight: 200`），不依赖父级 Modal body 滚动，保证 `getScrollElement` 稳定。`className="asset-grid-scroll"` 与 §8.2 基线采集步骤中的 selector 对齐。
   - 列数计算：`columns = floor((containerWidth + gap) / (minColWidth + gap))`，`minColWidth=160`、`gap=12`（与原 CSS `repeat(auto-fill, minmax(160px, 1fr))` 视觉等价）。容器宽度由 `ResizeObserver` + 首帧 `el.clientWidth` 测量；未测量时用兜底列数 3（下一帧修正）。
   - 虚拟化器：`useVirtualizer({ count: ceil(assetIds.length / columns), estimateSize: () => 260, overscan: 4, measureElement })`。`estimateSize` 粗估行高（160px 宽卡 = 图片 213px + padding/按钮 ~47px ≈ 260px），`measureElement` 动态校正（卡宽随容器变化时高度自适应）。Firefox 降级用 estimate（与 VirtualizedMessageList 一致）。
   - 行渲染：每个虚拟行 `position: absolute` + `translateY(start)`，内部 CSS grid `repeat(columns, 1fr)` 排布 columns 张卡片，`paddingBottom: gap` 模拟行间距。
   - **阈值回退**：`assetIds.length < 50` 时走原 `.map()` + CSS grid 路径（`ASSET_VIRTUALIZATION_THRESHOLD = 50`，与 `VirtualizedMessageList.VIRTUALIZATION_THRESHOLD` 对齐），避免短列表虚拟化开销。

2. **`AssetGridTabContent` 改造**：将原 `.map()` 内联 JSX 替换为 `<AssetVirtualGrid assetIds={assetIds} renderCard={renderCard} />`。`renderCard` 为 `useCallback`，返回 `<AssetCard>`。

#### React.memo + useCallback（SubTask 3.2 / Task 9.2）

1. **`AssetCard` 组件**（文件内联）：从原 `.map()` 回调抽取为命名组件，`React.memo` 包装（默认浅比较，无需自定义比较函数——所有 props 为基本类型或 useCallback 稳定引用）。`displayName = 'AssetCard'`。
   - Props：`assetId` / `dataUrl` / `assetType` / `replacingCardImage` / `onPreview` / `onDelete` / `onReplaceCardImage?`
   - 保留全部原有交互：hover 边框高亮、缩略图 hover 眼睛预览（`thumbnail-hover-overlay`）、删除按钮、立绘「设为角色卡图片」按钮（`loading={replacingCardImage}`）。
   - `<img>` 暂保留原样，Task 6 将替换为 `<LazyImage>`。

2. **handler 稳定性**：`handlePreview` / `handleDeleteAsset` / `handleReplaceCardImage` 均已在 Task 9 用 `useCallback` 包装（deps 为 store actions + characterCardId 等基本类型），无需额外改动。`renderCard` 的 `useCallback` deps 包含 `typeImageCache`（图片加载完成后 dataUrl 变化需重渲染对应卡片）、`replacingCardImage`、`assetType` 及三个稳定 handler。

#### 未虚拟化的站点（有意保留，附理由）

| 站点 | 原因 |
|------|------|
| `ExpressionTabContent`（表情网格） | 预置 30 情绪 + 自定义情绪。预置 30 张远低于阈值 50；自定义情绪理论上可超 50 但实际罕见（用户手动添加，数量有限）。按「最小实现优先 + 不确定则保留」原则，本轮不虚拟化。若后续自定义情绪增长可复用 `AssetVirtualGrid`。 |
| `ThreeViewTabContent`（三视图） | 6 个固定槽位（穿衣 3 + 裸体 3），数量固定不增长，无需虚拟化。 |
| `CharacterTraitTabContent`（特征 Tag 编辑器） | 特征以 chip 形式 `flex-wrap` 排布于折叠面板内，非长列表网格；数量通常 < 100 且已分组折叠。不适用行虚拟化。 |

#### 约束遵守

- ✅ 仅修改 `AssetManagerModal.tsx`（仅 AssetCard / AssetVirtualGrid / AssetGridTabContent 三处）
- ✅ 未触碰 `ThreeViewTabContent` / `CharacterTraitTabContent` / `ExpressionTabContent` 渲染逻辑
- ✅ 未触碰 3 处 `// TODO(perf): 整体订阅` 延迟订阅（useExpressionStore 8 字段 / useAssetStore 6 字段 / useCharacterTraitStore 25+ 字段，属 Task 9.1 暂缓项）
- ✅ 未新增依赖（`@tanstack/react-virtual` v3.14.9 已安装）
- ✅ 匹配文件既有 inline-style + antd + dark-theme 风格

#### TypeScript 验证

- `npx tsc --noEmit`（pretty false）：全项目 906 个预存在错误（均为 main 进程 / 其他文件），`AssetManagerModal.tsx` **零错误**，`AssetCard` / `AssetVirtualGrid` / `useVirtualizer` / `renderCard` 关键字在 tsc 输出中无任何匹配。**未引入新错误**。

#### 待 Task 10 量化验证项

- 100+ 资产滚动平均帧间隔 ≤ 100ms（§8.4 达标标准）
- 虚拟化前后对比需用户在 dev 模式用 `perfBaseline.measureScrollFPS` 采集（§8.2 步骤，selector `.asset-grid-scroll`）
- 本次仅静态推理验证（无运行环境）：虚拟化器 setup 与 `VirtualizedMessageList.tsx` 模式一致；列数逻辑 `floor((width+gap)/(minColWidth+gap))` 与原 `minmax(160px,1fr)` 等价；memo 浅比较不会破坏交互（handler 均 useCallback 稳定）

### §8.8 其余列表页虚拟化评估与改造（Task 5 + SubTask 9.2）

**Spec:** optimize-system-rendering-performance / Task 5 + SubTask 9.2（实施日期 2026-08-06）

**目标**：评估并（在达标时）虚拟化 4 个剩余列表页（PromptManagement / KnowledgeBase / Avatar / Favorites），统一应用 SubTask 9.2（列表项 `React.memo` + handler `useCallback`）。

**修改文件**：
- `src/renderer/components/PromptManagement/PromptManagement.tsx`
- `src/renderer/components/KnowledgeBase/KnowledgeItemList.tsx`
- `src/renderer/components/Avatar/AvatarManager.tsx`
- `src/renderer/components/Chat/CreationCenter.tsx`（仅 Favorites 内联段）

#### 逐页评估与决策

| 页面 | 数据结构 | 渲染方式 | 典型数据量 | 决策 | 理由 |
|------|----------|----------|------------|------|------|
| **PromptManagement** | 静态模块列表（`MODULE_GROUPS`） | `.map()` + 自定义 div | ~20 项（固定，3 组） | **跳过虚拟化** | `MODULE_GROUPS` 为模块级常量，固定 ~20 项远低于阈值 50；不会动态增长。已应用 React.memo + useCallback。 |
| **KnowledgeBase** | 已向量化文档树（树形 Table） | antd `<Table>` + `scroll={{ y: 500 }}` | 可超 50（用户多文档/世界书） | **启用 antd v6 内置 `virtual` prop** | 项目已安装 antd v6.5.3，Table 内置 `virtual` prop（`InternalTable.d.ts:64` 确认）。比自定义 `useVirtualizer` 更轻量、与树形展开/选择/分页天然兼容。同时设置 `scroll={{ x: 860, y: 500 }}`（列宽合计 860px）。 |
| **Avatar** | 用户人设卡片网格 | `<Row>/<Col>` + `.map()` | <50（手工创建） | **跳过虚拟化** | 用户人设为手工创建的少量条目，典型 <50；响应式网格布局（`xs/sm/md/lg`）不适合行虚拟化。已应用 React.memo + useCallback。 |
| **Favorites** | 收藏角色卡网格（CreationCenter 内联） | `.map()` + 自定义 div | <50（用户手工标记子集） | **跳过虚拟化** | 收藏是用户手工标记的角色卡子集，典型 <50；内联于 CreationCenter 聊天面板内，非独立长列表。已应用 React.memo + useCallback。 |

#### React.memo + useCallback 改造明细（SubTask 9.2）

**1. PromptManagement.tsx**
- 新增 `ModuleListItem`（`React.memo`）：接收 `module` / `template` / `isActive` / `onSelect`。将原 `renderSidebar` 内联 `.map()` JSX 抽离。
- `handleSelectModule` 已在 Task 9 用 `useCallback` 包装，直接复用。
- 文件头新增 `// [perf]` 阈值跳过注释。

**2. KnowledgeItemList.tsx**
- 新增 `DocumentActions`（`React.memo`）：根节点行的「更新 + 删除整个文档」操作组。
- 新增 `LeafActions`（`React.memo`）：叶子节点行的操作组（根据只读状态切换「查看」或「编辑/向量化」）。
- 11 个 handler 全部 `useCallback` 包装：`loadDocumentChildren` / `handleExpand` / `handleDeleteDocumentTree` / `handleDeleteSelected` / `handleDeleteItem` / `handleCreate` / `handleViewItem` / `handleEdit` / `handleVectorize` / `handleUpdateDocument` / `handleUpdateAll` / `handleSubmit`。
- `treeColumns` useMemo deps 扩展为包含全部 handler（满足 exhaustive-deps；handler 引用稳定时不触发重算）。
- antd Table 启用 `virtual` prop + `scroll={{ x: 860, y: 500 }}`。
- 文件头新增 `// [perf]` 说明注释。

**3. AvatarManager.tsx**
- `AvatarCard` 从 `React.FC` 改为 `React.memo`（原组件未 memo 化）。
- 新增 `ProfileCard`（`React.memo`）：抽取原 `.map()` 内联的 `<Card>` + cover/actions/meta。
- `handleEditProfile` / `handleDeleteProfile` / `handleSaveProfile` / `handleSelectAvatar` / `handleBackToList` / `loadProfiles` / `handleCreateProfile` 均已 `useCallback`（原已存在，未改动）。
- 文件头新增 `// [perf]` 阈值跳过注释。

**4. CreationCenter.tsx（Favorites 段）**
- 新增 `FavoriteItem`（`React.memo`）：抽取原 `.map()` 内联的 Tooltip + 头像 + 名称 + 取消喜爱按钮。
- `handleCharacterClick` 已 `useCallback`；`toggleFavorite` 来自 `useFavoritesStore` selector（引用稳定）。
- `FavoriteCharacterData` 接口下方新增 `// [perf]` 阈值跳过注释。

#### 约束遵守

- ✅ 仅修改 4 个目标文件（PromptManagement / KnowledgeItemList / Avatar / CreationCenter Favorites 段），未触碰 AssetManagerModal（Task 3）/ CharacterManager（Task 4）/ WorldBook（已虚拟化）。
- ✅ 未回退 Task 9.1 selector 转换，未触碰 `// TODO(perf)` 延迟订阅站点（PromptManagement.tsx:144 9 字段、KnowledgeItemList.tsx:47 6 字段）。
- ✅ 未新增依赖（`@tanstack/react-virtual` 已安装但本轮 KnowledgeBase 改用 antd 内置 `virtual`，无需引入）。
- ✅ 遵循「最小实现优先」：KnowledgeBase 优先启用 antd Table 内置 `virtual` 而非自定义虚拟化器。
- ✅ 匹配既有代码风格（`React.memo<T>` 泛型 + inline-style + antd）。

#### TypeScript 验证

- `npx tsc --noEmit`（cwd `g:/AI/creative-cafe`）：全项目 732 个错误（基线约 762，本轮未引入新错误）。
- 4 个修改文件中的错误均为**预存在**（未使用 import / 树形节点类型 `category: []` 与 `TreeKnowledgeItem` 类型定义不符 / `record.metadata` possibly undefined 等），全部位于**未改动**的代码区域（`loadTreeData` 树构建、`type`/`分类标签` 列 render、原始 import 列表）。
- 新增的 memo 组件（`ModuleListItem` / `DocumentActions` / `LeafActions` / `AvatarCard` / `ProfileCard` / `FavoriteItem`）与 `useCallback` 包装的 handler 在 tsc 输出中**无任何错误匹配**。
- `virtual` prop 已在 `node_modules/antd/es/table/InternalTable.d.ts:64` 确认为 `virtual?: boolean`。

#### 待 Task 10 量化验证项

- KnowledgeBase 50+ 文档滚动平均帧间隔 ≤ 100ms（§8.4 达标标准，selector `.table-container .ant-table-body`）。
- antd Table `virtual` prop 在树形展开/选择/分页下的行为需 dev 模式人工验证（虚拟化 + 树展开为 antd 内部实现，本轮仅静态启用 prop）。
- 本次仅静态推理验证（无运行环境）。

### §8.9 LazyImage + 渲染进程图片缓存（Task 6 + Task 8，紧耦合合并实施）

**目标：** 创建 `<LazyImage>` 组件 + 渲染进程侧缩略图 dataUrl LRU 缓存，复用 Task 7 已完成的主进程
`thumbnail:get` / `thumbnail:invalidate` IPC，将 AssetManagerModal 素材网格「直显全尺寸 dataUrl」
替换为「滚动进入视口时按需加载压缩缩略图」，缓解图片密集页滚动卡顿。

**新增文件：**

- `src/renderer/utils/imageCache.ts` — 渲染进程 LRU（`lru-cache` ^11，容量 300），key=`${sourcePath}::${size}`，
  value=dataUrl 字符串。导出 `getCachedThumbnail` / `setCachedThumbnail` / `invalidateImageCache`。
  `invalidateImageCache` 选择「双清」：同步清渲染 LRU + 异步调 `thumbnail:invalidate` IPC 清主进程内存/磁盘。
- `src/renderer/components/Common/LazyImage.tsx` — 懒加载组件。IntersectionObserver（rootMargin=200px 预加载）
  触发后：查 `imageCache` → 未命中调 `thumbnail:get` IPC → 缓存 + 渲染。`onLoad` 淡入；失败显示错误占位 +
  点击重试；`src` 变化（虚拟化器回收）重置内部状态并重新 observe。`React.memo` 按 `src`+`size` 浅比较。
  DEV 慢加载（>500ms）告警（可选）。

**修改文件：**

- `src/main/preload.ts` — 新增 `thumbnail` 命名空间（`get` / `invalidate`），跟随既有 asset/tag/tagRag
  等命名空间模式（`ipcRenderer.invoke('thumbnail:get', args)`）。
- `src/renderer/types/electron.d.ts` — 新增 `thumbnail` 命名空间类型声明（`ElectronAPI` 接口的类型镜像，
  与 preload 暴露不可分割；不加则 `window.electronAPI.thumbnail` 在 strict 模式下报错）。
- `src/renderer/components/Character/CharacterDialogueChat/AssetManagerModal.tsx`：
  - `AssetCard` 新增 `imagePath` prop；网格缩略图 `<img src={dataUrl}>` 替换为 `<LazyImage src={imagePath} size={256}>`；
    hover 眼睛预览覆盖层 + 「设为角色卡图片」仍使用全尺寸 `dataUrl`（不缩略图化）。
  - `AssetGridTabContent` 新增磁盘绝对路径解析：通过既有 `asset.getImagePath` IPC（纯路径构造 + existsSync，
    无文件读取）解析每个 assetId 的路径，缓存在本地 `imagePaths` state；`renderCard` 按优先级计算 `imagePath`
    （已解析路径 → 路径解析完成后回退 dataUrl → 解析中传空串显示占位避免闪烁）。

**关键设计决策：**

1. **dataUrl vs Blob URL（最小实现优先）：** Task 7 的 thumbnail IPC 直接返回 dataUrl 字符串，可直接作
   `<img src>`（CSP 兼容），**无需创建 Blob URL**。故 imageCache 缓存 dataUrl 字符串，省去
   revokeObjectURL 生命周期管理。代价：dataUrl（base64）比 Blob URL 大 ~33%，但缩略图已压缩到 ≤256/384px，
   单条 10-30KB 量级，300 条 ≈ 数 MB，可接受。详见 imageCache.ts 文件头。

2. **IPC 桥接模式：** 复用项目既有「命名空间」模式（asset/tag 等均如此），在 preload 暴露 `thumbnail.get/invalidate`
   + electron.d.ts 镜像类型。LazyImage 内部 `fetchThumbnail` 优先走 `window.electronAPI.thumbnail.get`，
   不可用时回退通用 `window.electronAPI.invoke('thumbnail:get', ...)`（防御性兜底）。

3. **路径解析冗余（已记录，不视为 bug）：** `assetStore.imageCache` 仅存 dataUrl（CSP 兼容设计，刻意不存磁盘
   路径），但 LazyImage 需磁盘路径才能走 thumbnail IPC。受「不可修改 assetStore」约束，`AssetGridTabContent`
   通过 `asset.getImagePath` IPC 重新解析路径，与 `assetStore.loadAssets` 内部调用存在冗余。该 IPC 为纯路径
   操作（无文件读取），且仅 assetIds 变化时并行触发一次，开销可接受。

4. **dataUrl-only 回退（Task 5 要求的边界场景）：** 若某素材仅有 dataUrl 无磁盘路径（文件缺失等），
   `imagePath` 回退为 dataUrl，LazyImage 检测 `data:` 前缀后直接渲染 `<img src={dataUrl}>`（不走 IPC、不缩略图化）。
   本项目素材均由 `asset.save` 落盘，常态下均有路径，此回退极少触发。

5. **预加载策略（Task 8.2，最小实现优先）：** 相邻行预加载依赖 LazyImage 自身 IntersectionObserver
   rootMargin=200px 提前触发 IPC，**未**额外做「投机性预取下一 overscan 行」的 IPC 调用（增加 IPC 噪声与
   状态管理复杂度，收益有限）。

**约束遵守：**

- ✅ 仅创建 LazyImage.tsx / imageCache.ts，修改 AssetManagerModal.tsx / preload.ts，并新增 thumbnail 类型镜像
  于 electron.d.ts（preload 暴露的类型镜像，不可分割）。未触碰其他业务文件。
- ✅ 未新增依赖（`lru-cache` ^11 已安装）。
- ✅ 未回退 Task 3 虚拟化 / Task 9.1 selector 转换；AssetCard 仍为 React.memo，renderCard 仍为 useCallback。
- ✅ 匹配既有 IPC 调用模式（命名空间 + `ipcRenderer.invoke`）。

**TypeScript 验证：**

- `npx tsc --noEmit`（cwd `g:/AI/creative-cafe`）：本轮新增/修改文件中**无新错误**。
- 过滤 `LazyImage|imageCache|AssetManagerModal|preload.ts|electron.d.ts` 仅命中 `src/main/preload.ts(46,43)`
  一条**预存在**错误（`off` 方法的 `ipcMain.removeListener` 参数 `Function | undefined`，位于文件顶部既有代码，
  与本轮 thumbnail 命名空间新增无关）。
- LazyImage 初版 `import.meta.env` 报 TS2339（项目未引用 `vite/client` 类型），已用 `import.meta as any`
  规避（dev 守卫为可选项，不引入新类型引用）。

**待 Electron 集成测试验证项：**

- nativeImage 缩略图生成/缓存命中的真实行为依赖 Electron 运行时（vitest 无法覆盖，见 thumbnailService.ts
  「Native Module Test Gap Convention」）。
- 100+ 素材网格滚动平均帧间隔 ≤ 100ms（§8.4 达标标准）需 dev 模式人工验证。
- 本次仅静态推理验证（无运行环境）。

### §8.10 优化前后对比总结（Task 10 — 最终验证与文档归档）

> 实施日期：2026-08-06 | Spec: optimize-system-rendering-performance / Task 10
> 本节为性能优化 Spec 的收尾总结，归档优化前后量化对比、nativeImage 选型理由、重点标记项汇总，并明确运行时验证遗留。

#### 优化前后对比表

| 指标 | 优化前（基线） | 优化后 | 达标 |
|------|---------------|--------|------|
| 初始 chunk 体积 | ~4,070 kB（单 chunk） | ~1,750 kB（entry 274.59 + react 142.37 + antd 1,333.23） | ✅ **-57%**（目标 -30%） |
| 列表滚动响应 | 1-2s（用户反馈卡顿） | ⏳ 待用户实测（目标 ≤100ms / FPS≥60） | ⏳ 待运行时验证 |
| 图片网格首屏完成时间 | 卡顿（用户反馈，无量化基线） | ⏳ 待用户实测（目标较基线 -50%） | ⏳ 待运行时验证 |
| 长任务数（>50ms） | 未知（基线未采集） | ⏳ 待用户实测（目标 0） | ⏳ 待运行时验证 |
| zustand 无 selector 调用点 | 105 处 | 93 处转 selector + 12 处暂缓（>5 字段加 TODO 注释） | ✅ 已完成静态改造 |
| 列表项 React.memo 覆盖率 | 0%（原内联 .map()） | 100%（8 个列表项组件均 memo） | ✅ |

**构建验证数据**（`npm run build`，5669 modules transformed）：

| Chunk | 体积 | gzip | 加载时机 |
|-------|------|------|----------|
| entry `index-BOkPa-8-.js` | 274.59 kB | 79.71 kB | 初始 |
| vendor-react | 142.37 kB | 45.63 kB | 初始 |
| vendor-antd | 1,333.23 kB | 420.04 kB | 初始（App shell 用 antd） |
| vendor-milkdown | 1,364.44 kB | 434.44 kB | 懒加载（WorldBook/编辑器） |
| vendor-markdown | 573.56 kB | 159.21 kB | 懒加载 |
| vendor-ai | 382.28 kB | 98.02 kB | 懒加载 |
| 路由懒 chunks | 31~188 kB | — | 各路由打开时 |

#### nativeImage 选型理由（vs sharp）

优先采用 Electron 内置 `nativeImage`，**零新原生依赖**：

1. **Electron 33 内置**：`nativeImage.createFromPath` / `resize` / `toJPEG` / `toPNG` 为 Electron 运行时 API，无需额外安装/编译。
2. **避免 sharp 的原生模块开销**：`sharp` 需 `electron-rebuild` + 平台预编译二进制，引入后受 Native Module Test Gap Convention 约束（vitest 无法加载，CI 复杂度上升）。nativeImage 同样不可在 vitest 加载（运行时 API），但至少不新增构建链复杂度。
3. **WebP 不可靠 → JPEG/PNG**：`nativeImage.toDataURL()` 的 WebP 支持随版本/平台变化不可靠，故采用稳妥策略：PNG 源（可能含透明通道）→ 输出 PNG（无损保留透明）；其余（jpg/webp/bmp/gif 等照片类）→ 输出 JPEG(80)（体积小）。以扩展名判定是否为 PNG（保守策略）。
4. **质量不足的退路**：若 nativeImage 缩略图质量不足，可切换至 `sharp`，但需 electron-rebuild + 同样受 Native Module Test Gap Convention 约束。当前优先 nativeImage 以零新原生依赖满足「最小实现优先」。

#### 重点标记项汇总

| # | 重点标记项 | 位置 | 说明 |
|---|-----------|------|------|
| 1 | visualizer ESM 静态 import 构建失败 | §8.5 | `rollup-plugin-visualizer@7` 为 ESM-only，CJS 项目静态 import 导致 `npm run build` 失败；改用动态 `import()`。子代理 Task 1 仅 `tsc --noEmit` 未跑 build，掩盖运行时问题。 |
| 2 | nativeImage Native Module 约束 | §8.9 / 本节 | `nativeImage` 为 Electron 运行时 API，vitest 无法加载，真实行为依赖 Electron 集成测试。已在 `thumbnailService.ts` + `thumbnailHandlers.ts` 文件头标注 Native Module Test Gap Convention。 |
| 3 | dataUrl vs Blob URL 设计调整 | §8.9 / 本节 | 原 spec 提及「Blob URL 缓存 + revokeObjectURL 释放」。实际 thumbnail IPC 返回 dataUrl 字符串可直接作 `<img src>`（CSP 兼容），无需 Blob URL，省去生命周期管理。代价：dataUrl 比 Blob URL 大 ~33%，但缩略图已压缩到 ≤256/384px，300 条 ≈ 数 MB，可接受。 |
| 4 | Task 4 CharacterListView 委托发现 | 本节 | `CharacterManager` 不直接渲染角色卡列表，**委托给子组件 `CharacterListView`**。虚拟化改造须落在 `CharacterListView`（antd Table `virtual` prop + `scroll.y`）而非 `CharacterManager`。Task 4 实施时发现该委托关系，故 CharacterManager 自身仅做 `React.memo` + `useCallback`，虚拟化下沉到 CharacterListView。 |

#### 运行时验证遗留（待用户）

⚠️ **基线从未采集**（Task 1.3 显式延迟至用户），故以下运行时指标无法在本轮判定达标，需用户在 dev 模式用 `perfBaseline.ts` 工具采集后回填 §8.1 基线表：

1. **列表滚动平均帧间隔 ≤ 100ms**（对应 FPS ≥ 60）— 采集步骤见 §8.2，selector `.asset-grid-scroll` / `.ant-table-body`。
2. **图片网格首屏完成时间较基线下降 ≥ 50%** — `measureFirstScreenComplete('.ant-modal-body')`。
3. **长任务数（>50ms）= 0** — `startLongTaskObserver`。

采集后请将数值回填 §8.1 表格「基线值」与「优化后值」列，方可完成达标判定。`perfBaseline.ts` 工具已在生产环境 no-op（dev 双守卫），零性能开销，可安全常驻代码。

#### Task 10 验证清单归档

checklist.md 全部 checkpoint 已验证：22 项静态/构建可验证项已勾选 `[x]`（含证据行号；其中 thumbnailService/磁盘缓存/IPC 注册 3 项为原已勾选、本轮复核确认，其余 19 项本轮新增验证），3 项运行时指标标记 `[⏳]`（待用户运行时验证），sharp 项标记 N/A（改用 nativeImage），Blob URL 项标记 N/A（改用 dataUrl）。详见 `.trae/specs/optimize-system-rendering-performance/checklist.md`。

## §9 设置页页签化重构（Spec: refactor-settings-into-tabbed-groups）

### 背景
`src/renderer/components/Settings/Settings.tsx` 原将 7 个设置子面板（外观/高级、AI 引擎、SD WebUI、向量模型、网络搜索、标签自动推荐、RAG 标签库）纵向堆叠在单页长滚动页面中，功能边界模糊、定位效率低。重构为按功能相关性分组的 antd `Tabs` 页签布局，纯 UI 层改动，未修改任何子面板组件、store、IPC、类型。

### 5 个页签分组
| key | label | 子面板 |
| --- | --- | --- |
| `general` | 通用 | `GeneralSettingsPanel`（共享 `form`） |
| `ai-engine` | AI 引擎 | `AIEngineSettingsPanel`（共享 `form`） |
| `image-gen` | 图像生成 | `SDWebuiSettings`（ref: `sdWebuiConfigRef`） |
| `vector-rag` | 向量与 RAG | `VectorConfigPanel`（ref: `vectorConfigRef`）+ `TagRagSettings`（ref: `tagRagConfigRef`） |
| `tags-search` | 标签与搜索 | `TagAutocompleteSettings`（ref: `tagAutocompleteConfigRef`）+ `WebSearchSettings`（ref: `webSearchConfigRef`） |

分组依据：`VectorConfigPanel`（向量模型/embedding/检索参数）与 `TagRagSettings`（基于向量库的 RAG 标签库）共用 `getDatabaseDir()` 路径与 sqlite-vec 后端，属同一基础设施栈；`TagAutocompleteSettings`（本地 CSV 标签补全）与 `WebSearchSettings`（智能体网络搜索工具）均为可选辅助增强功能。

### ⚠️ 重点标记：`forceRender: true` 是硬性约束（违反会丢数据）
这是本次重构唯一可能导致数据丢失的约束，必须长期保留。

- 父组件 `handleSave` 通过 5 个 ref 的 `getFormValues()` 收集子面板表单值，使用条件展开合并：`...(sdWebuiConfig ? { sdWebui: sdWebuiConfig } : {})`。
- 若某 ref 对应子面板未挂载，`ref.current` 为 `null`，`getFormValues()` 返回 `undefined`，该配置字段被**静默丢弃**，导致 `settings.json` 中 `sdWebui` / `vector` / `webSearch` / `tagAutocomplete` / `tagRag` 字段缺失 → 数据丢失。
- 因此 5 个页签 item **必须全部设置 `forceRender: true`**，确保所有子面板首屏即挂载（即使页签未激活）。
- 经验教训：ref-based 子面板 + 父组件条件展开收集的架构下，懒加载/销毁非激活页签会引发静默数据丢失，必须用 `forceRender` 强制全量挂载。

### antd v6 API 适配要点
- `Tabs` 使用 `items` API（非旧版 `<Tabs.TabPane>` 子元素写法）。
- `tabPosition` 已废弃 → 改用 `tabPlacement="top"`。
- `destroyInactiveTabPane` 已废弃 → 不设置 `destroyOnHidden`（默认 false = 非激活页签保持挂载，符合状态保留需求）。

### 状态保留与跨页签保存
- `forceRender: true` + `destroyOnHidden` 默认 false → 所有页签全程挂载，切换页签已填表单值不丢失。
- 底部操作栏（保存 / 打开配置文件 / 重置）位于 `<Tabs>` 之外，`handleSave` / `handleOpenConfigFile` / `handleReset` 与 5 个 ref、共享 `form` 实例均未改动。
- 即使仅停留在「通用」页签直接点保存，其余页签面板配置也能被正确收集保存（因 `forceRender` 保证首屏全挂载）。

### CSS 增量（`Settings.css` 末尾追加，未删除既有规则）
- `.settings .ant-tabs-tabpane > .ant-card:first-child { margin-top: 0 !important; }` — 多个子面板 Card 用 `style={{ marginTop: 16 }}`，页签化后首个卡片顶部多余空白需置零。
- `.settings .ant-tabs-tabpane { padding-top: 4px; }` — 内容区顶部留白。
- `.settings .ant-tabs-tab { color: var(--text-secondary); }` / `.settings .ant-tabs-tab-active .ant-tabs-tab-btn { color: var(--color-primary, #1677ff); font-weight: 500; }` — 标签文字主题色适配明暗主题。

### 涉及文件
- `src/renderer/components/Settings/Settings.tsx` — 导入 `Tabs` + 新增 `activeTab` 状态 + 5 页签 `Tabs`（每项 `forceRender: true`）+ 底部按钮区外置。
- `src/renderer/components/Settings/Settings.css` — 末尾追加 4 条页签样式。

### 验证状态
- 静态检查：`tabPosition` / `destroyInactiveTabPane` 均未出现；`tabPlacement="top"` 存在；`forceRender: true` 出现 5 次；`handleSave` 收集 5 ref 的逻辑完整保留；`tsc --noEmit` 对 `Settings.tsx` 零新增错误（唯一报错为 `writing.constants.ts` 预先存在错误，与本次无关）。
- 运行时回归（待用户 dev 模式验证）：逐页签切换流畅性 + 执行一次「保存设置」后检查 `settings.json` 中 `sdWebui` / `vector` / `webSearch` / `tagAutocomplete` / `tagRag` 字段完整保留（验证 `forceRender` 生效、未丢字段）+ 明暗主题与窄屏响应式表现。

### 架构文档联动
- `CODE_WIKI.md` §16 已补充「设置页页签化重构」架构章节（页签分组表 + forceRender 硬性约束 + antd v6 适配 + 涉及文件）。

---

## §7.22 表情预置提示词优化脚本 + 表情生成过滤 expression 分类特征（Spec: optimize-expression-preset-prompts，2026-08-07）

### 背景

`PromptBuilder.ts:1480-1512` 中硬编码的 `EMOTION_PROMPT_MAP`（31 种预置情绪 → SD 提示词）存在两类问题：

1. **提示词质量不佳**：大量 tag 不在 Danbooru/e621 标签库中（如 `aroused` / `lustful` / `heavy_breathing` 等评级词或自然语言短语），SD 模型无法准确识别；缺乏 4 维度结构（面部表情 / 动作 / 符号 / 背景），生成的表情图像表现力不足。
2. **提示词冲突**：角色特征的 `expression` 分类 tag 与 `EMOTION_PROMPT_MAP` 的 `{emotion}` 占位符注入的 tag 同时进入 positive prompt，语义重复或矛盾（如角色特征含 `smile`，情绪预设也含 `smile`）。

### 设计决策

#### 决策 1：独立一次性脚本（非应用内功能）

- **选择**：创建 `scripts/optimize-expression-prompts.ts` 独立脚本，通过 `npx tsx` 执行
- **理由**：提示词优化是一次性运维任务，无需常驻应用；脚本可直接复用主进程服务（tagAutocompleteService），避免在渲染进程引入额外 IPC；生成结果为可粘贴的 TypeScript 代码片段，人工审核后替换硬编码值

#### 决策 2：路径处理采用 B+C 混合方案（⚠️ 偏离 spec 原设想）

spec 原设想「直接 import 所有主进程服务（tagAutocompleteService / tagRagService / userSynonymMapService / aiConfigProvider）」，但实际实现中发现部分服务无法在 Node.js 环境下直接 import：

| 服务 | 处理方式 | 原因 |
|---|---|---|
| `tagAutocompleteService` | **方案 C：直接 import** | 内部 `resolveBundledCsvPath()` 有 `__dirname` 兜底，Node.js 下可加载 `docs/` CSV（smoke test 验证：317600 tags / 81700 aliases） |
| `aiConfigProvider` / `storageService` | **方案 B：直接读 settings.json** | import `ipcMain` 等 Electron 模块，Node.js 下无法加载；脚本改为读取 `%APPDATA%/creative-cafe/data/settings.json` |
| `userSynonymMapService` | **方案 B：跳过 L0** | Node.js 下 `getUserDataPath()` 路径缺 `creative-cafe` 后缀，可能读到错误位置 |
| `tagRagService` / `characterTraitAIService` | **方案 B：脚本内重实现** | 依赖 sqlite-vec 向量数据库与 storageService，无法直接 import |

#### 决策 3：审计链降级为 L1-L3b（⚠️ 偏离 spec 原设想）

spec 要求「复用 L0-L5 完整审计链」，但因 `tagRagService` 依赖 sqlite-vec 无法 import，脚本内仅重实现 4 层：

| 层级 | 实现 | 说明 |
|---|---|---|
| L0 用户映射 | ❌ 跳过 | userSynonymMapService 路径不一致 |
| L1 name 精确匹配 | ✅ 复用 `tagAutocompleteService.getTagByName` | 含空格/下划线互转 |
| L2 alias 精确匹配 | ✅ 复用 `tagAutocompleteService.getTagByAlias` | 含空格/下划线互转 |
| L3 颜色拆分 | ✅ 脚本内重实现 `splitColorTag` | 与 `tagRagService.splitColorTag` 等价 |
| L3b 否定性修饰词剥离 | ✅ 脚本内重实现 `stripNegationModifier` | 与 `tagRagService.stripNegationModifier` 等价 |
| L4 KNN 语义检索 | ❌ 跳过 | 依赖 sqlite-vec 向量库 |
| L5 AI 兜底 | ❌ 跳过 | 保留人工审核入口（应用内 RagQualityReport UI） |

未通过 L1-L3b 的 tag 标记为 `failed: true`，写入报告 `abnormalPrompts` 列表供人工处理。

#### 决策 4：表情生成过滤 expression 分类特征（Task 7）

- **选择**：在 `AssetGenerateModal` 的 `enabledTraitTexts` useMemo 派生层过滤，而非 `buildSdOptions` 函数体内过滤
- **理由**：`enabledTraitTexts` 为 `buildSdOptions` / `buildEmotionPrompt` / single-expression 提示词构建器共用的派生值，在 useMemo 层统一过滤可确保所有下游消费者一致地不携带 expression 分类 tag（与既有 `isNudeSlot` 过滤 `clothing` 分类同模式）

### 实现步骤

#### Task 1-5：优化脚本（`scripts/optimize-expression-prompts.ts`，1016 行）

1. **脚本骨架**（L1-186）：文件头注释（用途 / 执行方式 / 依赖 / 路径处理方案 / 审计链实现方式）；`EMOTION_PRESETS` 常量（31 项，从 PromptBuilder.ts 复制避免 import 渲染进程模块）；`ORIGINAL_EMOTION_PROMPT_MAP` 常量（保留 negative 字段）；`EXPRESSION_OPTIMIZATION_SYSTEM_PROMPT` 系统提示词（4 维度 + Danbooru 下划线格式 + NSFW 保留 + 分隔符输出格式 + 2 个示例）
2. **类型定义**（L188-238）：`AIConfig` / `CandidateTags` / `TagAuditDetail` / `EmotionResult` / `OptimizationReport`
3. **配置加载**（L240-340）：`getSettingsPath()` 跨平台路径解析；`loadAIConfig()` 读取 settings.json 并校验 baseUrl / apiKey / modelName
4. **AI 生成**（L342-510）：`generateCandidateTags(emotionKey, emotionLabel, aiConfig)` 调用 `${baseUrl}/v1/chat/completions`（非流式），解析 4 段分隔符响应；`parseCandidateTags(content)` 容错解析（段落缺失→空数组、空格转下划线、过滤自然语言句子）
5. **质检审计**（L512-777）：`splitColorTag` / `stripNegationModifier` / `findTagInLibrary`（L1-L2 含空格/下划线互转）/ `auditTag`（L1-L3b + 评级词 + failed）/ `auditCandidateTags`（合并 4 维度 → 逐 tag 审计 → 去重）
6. **报告输出**（L779-893）：`writeReport()` 写 JSON 报告；`writeGeneratedMap()` 生成可粘贴 TS 代码片段（含 JSDoc「脚本生成」标注）；`printSummary()` 控制台摘要（总数 / 成功 / 失败 / 通过率 / 异常 tag 预览）
7. **主流程**（L895-1005）：`main()` 依次执行 [1/5] 加载标签库 → [2/5] 读取 AI 配置 → [3/5] 遍历 31 情绪生成+审计 → [4/5] 汇总统计 → [5/5] 写报告+生成代码；每情绪 try/catch 错误恢复；入口 `if (require.main === module) main().catch(...)`

#### Task 7：表情生成过滤 expression 分类特征（`AssetGenerateModal.tsx`）

在 `enabledTraitTexts` 的 useMemo 派生层（约 L399-410）新增 `isExpressionMode` 判断：

```typescript
const isExpressionMode = mode === 'single-expression' || mode === 'batch-expression';
const enabledTraitTexts = useMemo(
  () =>
    effectiveTraits
      .filter(
        (t) =>
          t.enabled &&
          (!isNudeSlot || t.categoryId !== 'clothing') &&
          !(isExpressionMode && t.categoryId === 'expression'),  // 新增
      )
      .map((t) => t.text),
  [effectiveTraits, isNudeSlot, isExpressionMode],
);
```

非表情模式（`illustration` / `general` / `three-view`）时 `isExpressionMode` 为 false，过滤条件恒为 true，expression 分类特征正常携带。

#### ⚠️ UI 层同步修复（2026-08-07 用户反馈）

**问题**：Task 7 初版仅在 `enabledTraitTexts`（发给 SD 的提示词）层面过滤了 expression 分类，但 `renderTraitsPanel`（UI 渲染）使用的是 `effectiveTraits`（未过滤），导致用户在表情生成页面上仍看到「人物表情」分类特征显示为启用状态（紫色 Tag），与「已清空」的预期不符。

**根因**：`enabledTraitTexts` 只影响 `buildSdOptions` 的 `characterTraits` 字段（发给 SD 的提示词），不影响 UI 展示。`renderTraitsPanel` 直接遍历 `effectiveTraits` 渲染 Tag，未感知 `isExpressionMode`。

**修复**（`renderTraitsPanel` 函数内，L1696-2000）：
1. 新增 `isTraitAutoFiltered(t)` 辅助函数 = `isExpressionMode && t.categoryId === 'expression'`
2. `enabledCount` 排除自动过滤的特征（头部统计「启用 X/Y」准确反映）
3. 头部新增「表情特征已自动清空」橙色 Tag（Tooltip 说明原因）
4. expression 分类面板标题新增「已自动清空」橙色 Tag
5. `enabledInCat` 排除自动过滤的特征（分类统计准确）
6. 单个特征 Tag 渲染：自动过滤时 → `color='default'`（灰）+ `opacity:0.35` + `textDecoration:'line-through'`（删除线）+ `cursor:'not-allowed'` + 不可点击/不可关闭/隐藏编辑图标 + Tooltip 改为「表情模式下已自动清空」

**验证**：类型检查无新增错误（预先存在的 React/jsx/electronAPI 配置错误不受影响）。

### Bug 根因分析

本次开发无 Bug，但有两个**偏离 spec 的实现决策**需记录（见上方决策 2 / 决策 3），原因是 spec 编写时未充分考虑 Electron 模块在 Node.js 环境下的可 import 性。

### 验证状态

- **类型检查**：`npx tsc --noEmit --skipLibCheck --target ES2020 --module commonjs --moduleResolution node --strict --esModuleInterop scripts/optimize-expression-prompts.ts` → EXITCODE=0（脚本顶部有 `// @ts-nocheck` 兜底，但本机环境移除也能通过）
- **加载验证**：`npx tsx -e "require('./scripts/optimize-expression-prompts.ts')"` → 无运行时错误
- **审计链 smoke test**：16 个测试 tag 走 L1-L3b，结果符合预期：
  - `open_mouth` / `blue_eyes` / `blush` / `smile` / `looking_at_viewer` / `panting` / `half-closed_eyes` → L1 name 命中
  - `sweat_drops` → L2 alias 命中（canonicalName=`sweatdrop`）
  - `light_gray_drooping_ears` → L3 颜色拆分（split 为 `grey_ears` + `drooping_ears`）
  - `lustful` / `flushed_skin` → FAILED（标记为异常 tag）
  - `nsfw` → source='rating'（评级词，不视为 failed）
- **未执行完整 LLM 调用**：避免消耗 API 配额，`main()` 由用户自行执行 `npx tsx scripts/optimize-expression-prompts.ts`
- **Task 7 静态验证**：`isExpressionMode` 仅在 `single-expression` / `batch-expression` 模式下为 true；非表情模式时过滤条件恒 true，expression 分类特征正常携带

### 待用户执行（Task 6）

1. 执行 `npx tsx scripts/optimize-expression-prompts.ts` 生成 `scripts/expression-prompt-map.generated.ts`
2. 人工审核生成内容（NSFW 语义保留 / 4 维度覆盖 / 无异常 tag）
3. 将生成内容粘贴替换 `PromptBuilder.ts:1480-1512` 中 `EMOTION_PROMPT_MAP` 的 positive 字段值
4. 在 `EMOTION_PROMPT_MAP` 上方注释标注「由 scripts/optimize-expression-prompts.ts 生成，最后更新日期 YYYY-MM-DD」

### 教训

- ⚠️ **编写独立脚本 spec 时，必须先验证目标服务在 Node.js（非 Electron）环境下的可 import 性**——本次 spec 假设所有主进程服务可直接 import，实际 `aiConfigProvider` / `storageService` / `tagRagService` / `characterTraitAIService` 均因依赖 Electron 模块（`ipcMain`）或原生模块（`sqlite-vec`）而无法 import，导致路径处理与审计链实现均偏离 spec
- ⚠️ **审计链复用类需求，必须区分「服务级复用」与「逻辑级复用」**——`tagRagService.validateTagsAgainstLibrary` 无法直接调用时，仍可通过重实现 `splitColorTag` / `stripNegationModifier` 等纯函数实现逻辑级复用（L1-L3b），但 L4 KNN / L5 AI 兜底因依赖向量库与额外 LLM 调用无法复用
- **共用派生值的过滤应统一在 useMemo 派生层处理**，而非各下游消费函数内重复过滤（与既有 `isNudeSlot` 过滤 `clothing` 同模式），确保所有消费者行为一致

### 涉及文件

- `scripts/optimize-expression-prompts.ts` — 新增（1016 行），独立优化脚本
- `src/renderer/components/Character/CharacterDialogueChat/AssetGenerateModal.tsx` — 修改 `enabledTraitTexts` useMemo，新增 `isExpressionMode` 过滤 expression 分类特征
- `CODE_WIKI.md` — 末尾新增 §17「表情预置提示词优化脚本」架构章节（约 100 行）

### 架构文档联动

- `CODE_WIKI.md` §17 已补充「表情预置提示词优化脚本」架构章节（概述 / 执行方式 / 输出文件 / 路径处理方案 / 审计链实现 / 关键函数 / 错误恢复 / 已知限制 / 涉及文件清单 / 验证状态）。

### §7.23 拆分标签视觉标识 + 组合方案下拉支持 traitSnapshot（Spec: optimize-trait-translation-and-temp-scheme / Task 4 + Task 8）

> 实施日期：2026-08-07 | Spec: `.trae/specs/optimize-trait-translation-and-temp-scheme/spec.md`
> 本节为增量记录：Task 1（类型扩展）/ Task 7（store `applyCombination` traitSnapshot 分支）已由前序任务完成，本节仅归档 AssetManagerModal 侧的 Task 4（拆分标签 UI 标识）+ Task 8（组合方案下拉支持 traitSnapshot）实施。AssetGenerateModal 侧的 Task 4.3 / Task 5 / Task 6 由并行 agent 处理，不在本节范围内。

#### 1. 背景与需求

- **Task 4 背景**：L3 颜色拆分（§7.15）会将复合标签（如 `grey long hair`）拆分为 `grey_hair` + `long_hair`，两者 `originalText` 均为 `grey long hair`（Task 1 新增字段）。原 AssetManagerModal 的特征 chip 仅显示 `trait.text`，用户无法识别哪些 tag 是拆分产物，也无法看到原始复合标签文本。
- **Task 8 背景**：Task 7 已在 store `applyCombination` 中实现 traitSnapshot 分支（含快照的方案 → 完整替换 traits；无快照的方案 → 仅切换 enabled），但 AssetManagerModal 的组合方案下拉未对两类方案做视觉区分，用户无法预知「应用此方案会完整替换特征」还是「仅切换启用状态」。

#### 2. 设计决策

- **特征 chip 渲染结构**：AssetManagerModal 的特征 chip **不是 antd `<Tag>`**，而是自定义 `<span>` chip（启用圆点 + 文字 + 移动下拉 + 删除按钮）。spec 任务描述中提到的 `<Tag>` 是泛指，实际改动需适配 chip 结构：
  - 拆分图标 `SplitCellsOutlined` 放在文字 span 内部、`{trait.text}` 之前
  - 文字 span 的 `style` 新增 `display: 'inline-flex'` + `alignItems: 'center'`，确保图标与文字垂直对齐
- **Tooltip 多行内容**：当 `trait.originalText` 存在时，Tooltip title 改为 ReactNode（`<div>` 包裹三行：原标签 / 拆分为 / 翻译），覆盖原 `trait.translation || ''` 单行展示；`originalText` 不存在时维持原行为（仅显示 translation，空字符串不弹出）。
- **组合方案下拉标识**：含 `traitSnapshot` 的方案名后加 📋 emoji 后缀，无 traitSnapshot 的方案维持原名。`handleApplyCombination` **无需修改** —— store 的 `applyCombination(id|null)` 已在 Task 7 中实现 traitSnapshot vs traitIds 自动分支，前端透传即可。`'__manual__'`（手动模式）守卫保留不变。

#### 3. 实施步骤

| 步骤 | 内容 | 涉及位置 |
| --- | --- | --- |
| 1 | 导入 `SplitCellsOutlined`（from `@ant-design/icons`），加注释引用 Spec | `AssetManagerModal.tsx` L44-46 |
| 2 | `renderTraitChip` 文字 span：Tooltip title 三元（originalText ? 多行 div : translation\|\|'')；span 内 originalText 存在时渲染 `<SplitCellsOutlined fontSize={10} marginRight={2} opacity={0.7} />` + `{trait.text}`；span style 新增 `display:'inline-flex', alignItems:'center'` | `AssetManagerModal.tsx` L3779-3815（renderTraitChip 内） |
| 3 | 组合方案下拉 options：含 `traitSnapshot` 的方案 label 改为 `${c.name} 📋`，否则维持 `c.name` | `AssetManagerModal.tsx` L3947-3956（组合方案下拉 Select） |
| 4 | `handleApplyCombination` **未修改**（store 已处理 traitSnapshot 分支，前端透传） | `AssetManagerModal.tsx` L3127-3136 |

#### 4. 验证

- **TypeScript 类型检查**：`npx tsc --noEmit -p tsconfig.json` 全量类型检查 → 整个项目仅 1 处与本次改动无关的预存错误（`src/shared/constants/writing.constants.ts:9` ProjectStatus.ARCHIVED），`AssetManagerModal.tsx` 零错误。
- **未引入新 Bug**：本次改动为纯 UI 渲染层（Tooltip title + span 内插图标 + options label 派生），未触碰 store / IPC / 持久化逻辑。

#### 5. 涉及文件清单

- `src/renderer/components/Character/CharacterDialogueChat/AssetManagerModal.tsx` — 导入 `SplitCellsOutlined` / `renderTraitChip` Tooltip + 拆分图标 / 组合方案下拉 options 📋 标识

#### 6. 待后续 Task 补全项

- Task 4.3（AssetGenerateModal 同步实现拆分图标 + Tooltip 多行）— 已完成，见 §7.24
- Task 5（AssetGenerateModal「AI 图片识别」按钮替换为「临时方案保存」按钮）— 已完成，见 §7.24
- Task 6（AssetGenerateModal 新增组合方案下拉）— 已完成，见 §7.24
- Task 9（文档全量更新：FIX_RECORDS.md / CODE_WIKI.md 全量章节）— 已完成，见 §7.24 + CODE_WIKI.md 同步

---

### §7.24 标签翻译继承 + 临时方案保存 + 组合方案联动全量实施（Spec: optimize-trait-translation-and-temp-scheme / Task 1+2+3+5+6+7+9）

> 实施日期：2026-08-07 | Spec: `.trae/specs/optimize-trait-translation-and-temp-scheme/spec.md`
> 本节为 §7.23 的补全记录：覆盖 Task 1（类型扩展）/ Task 2（翻译继承）/ Task 3（normalizeTraitItem 兜底）/ Task 5+6（AssetGenerateModal 按钮替换 + 组合方案下拉）/ Task 7（store traitSnapshot 支持）/ Task 9（本文档）。§7.23 已归档 AssetManagerModal 侧的 Task 4 + Task 8，不再重复。

#### 1. 背景与需求

用户反馈两个核心问题：
1. **翻译丢失**：AI 生成特征时返回的中文翻译，在标签审计替换（L2/L3/L4）和颜色拆分（L3）后被清空为 `undefined`，用户无法看到拆分/替换后标签的中文含义。原 `applyTagAudit` 三处替换场景均执行 `trait.translation = undefined`，假设「标签库标准 tag 无需翻译」——但用户需要翻译作为参考。
2. **临时编辑数据丢失**：用户在 AssetGenerateModal 弹窗中临时新增/编辑的特征标签（不在角色卡持久特征列表中），关闭弹窗后丢失。原「AI 图片识别」按钮位置未被充分利用，且与角色特征页签的「组合方案」下拉缺乏跨页面联动。

#### 2. 设计决策

**翻译继承策略**：所有审计替换场景（L3 颜色拆分 / L2-L3 规范化 / L4 KNN 语义 / L5 AI 兜底）均继承源标签的 AI 翻译，不再清空。新增 `originalText` 字段记录拆分前的原始复合标签文本，供 UI 展示溯源信息（仅 L3 颜色拆分设置 originalText，L2/L4/L5 为语义替换不设置）。

**临时方案保存策略**：扩展 `TraitCombination` 类型新增 `traitSnapshot?: CharacterTraitItem[]` 字段，从 AssetGenerateModal 保存时写入完整特征快照（含临时标签），从 AssetManagerModal 保存时不写入（仅 traitIds，向后兼容）。应用方案时优先使用 traitSnapshot（完整替换 traits），否则回退到 traitIds 逻辑（仅切换 enabled）。

**跨页面联动**：AssetGenerateModal 与 AssetManagerModal 共享同一个 `characterTraitStore`，组合方案数据通过 v2 manifest 持久化（`saveTraits` → `traits.json`），两侧下拉自动同步。

**UI 整合**：Task 5（保存按钮）与 Task 6（下拉）整合为一处 UI——移除原「AI 图片识别」按钮，替换为「组合方案」下拉 + 存方案/删方案按钮组合。不再单独放「临时方案保存」按钮，避免重复入口。`handleImageRecognize` 函数与 `supportsVision`/`imageRecognizing` 状态保留不删（spec 要求，便于未来恢复），通过 `void` 引用避免 TS6133。

#### 3. 实施步骤

| Task | 内容 | 涉及文件 | 关键位置 |
| --- | --- | --- | --- |
| 1 | `CategorizedTrait` / `CharacterTraitItem` 新增 `originalText?: string`；`TraitCombination` 新增 `traitSnapshot?: CharacterTraitItem[]` | `src/shared/types/characterTrait.types.ts` | L89-114 / L123-142 |
| 2 | `applyTagAudit` 三处替换场景保留 translation + L3 拆分设置 originalText | `src/main/services/characterTraitAIService.ts` | L1172-1219 |
| 3 | `normalizeTraitItem` 返回值新增 `originalText` 兜底 + JSDoc | `src/main/services/characterTraitService.ts` | L176-195 |
| 5+6 | import 新增 `SplitCellsOutlined`/`SaveOutlined`/`DeleteOutlined`，移除 `EyeOutlined`；store 订阅扩展 5 字段；新增 `handleSaveTempScheme`/`handleApplyCombination`/`handleDeleteCombination`；`handleConfirmEditTrait` 清空 originalText；`renderTraitsPanel` 组合方案下拉替换 AI 图片识别按钮 | `src/renderer/components/Character/CharacterDialogueChat/AssetGenerateModal.tsx` | L33-37 / L362-371 / L1483-1500 / L1601-1694 / L1933-1981 |
| 7 | `saveCombination` 新增 `snapshot?` 参数写入 traitSnapshot + 立即持久化；`applyCombination` 新增 traitSnapshot 分支（完整替换 traits）+ 支持 null 取消激活；`deleteCombination` 立即持久化 | `src/renderer/stores/characterTraitStore.ts` | L1138-1192 / L1194-1240 / L1242-1279 |

#### 4. 关键代码

**Task 2 — applyTagAudit 三场景翻译继承（`characterTraitAIService.ts` L1172-1219）：**

```typescript
// 场景1：L3 颜色拆分 — 两个子标签均继承源翻译 + 记录原始标签
const sourceTranslation = trait.translation;
const sourceOriginalText = v.tag;
trait.text = v.splitTags.featureTag;
trait.translation = sourceTranslation;        // 继承而非 undefined
trait.originalText = sourceOriginalText;
traits.push({
  text: v.splitTags.colorPartTag,
  categoryId: trait.categoryId,
  translation: sourceTranslation,             // 继承翻译
  originalText: sourceOriginalText,           // 记录原始标签
});

// 场景2：L2/L3 规范化替换 — 删除 trait.translation = undefined，translation 保持不变
// 场景3：L4 KNN 语义替换 — 删除 trait.translation = undefined，translation 保持不变
// 场景4：L5 AI 兜底替换 — 删除 trait.translation = undefined，translation 保持不变（后补修复，见下方）
```

**⚠️ L5 AI 兜底翻译继承补修复**：Task 2 初版仅处理 L3/L2-L3/L4 三场景，明确留下 L5 `applyAiFallback` 未处理（原文档标注「不在本次范围」）。用户反馈「AI 兜底命中：grey brimless cap → grey_beanie 后无中文翻译」后，确认 L5 同样需要翻译继承。修复方式与场景2/3一致——删除 `trait.translation = undefined`，translation 保持不变。L5 为语义替换不设置 `originalText`（仅 L3 颜色拆分设置）。

修复位置：`characterTraitAIService.ts` `applyAiFallback` 方法内（约 L1099-1101），原代码：
```typescript
// 修复前（清空翻译）
trait.text = replacement;
trait.translation = undefined;

// 修复后（继承翻译）
trait.text = replacement;
// translation 保持不变（继承源标签 AI 翻译）
```

### §7.26 ⚠️ 重点 — 反复修复 — EXPRESSION 情绪标记解析失败导致表情渲染失效（2026-08-09）

**症状**：用户反复反馈"首次 EXPRESSION 表情能正常渲染，但从第 3 条对话起表情渲染失效"。日志显示 AI 正常生成 `<<<EXPRESSION>>>annoyance<<<END_EXPRESSION>>>` 标记，但保存的聊天版本文件中既无 `emotion` 字段，`content` 也未剥离 EXPRESSION 标记。

**注意**：本节合并记录了两轮修复。代码注释中原引用的 §7.18 / §7.19 实际指向其他主题（动态场景标签审计 / AssetGenerateModal 下拉），为已纠正的错误引用，正确引用为本节 §7.26。

#### 第一轮修复（2026-08-08）：缩写结束标记容错

**根因**：AI（尤其是 Claude/GLM 系列）会自发缩写结束标记为 `<<<END_EXPR>>>` / `<<<END_EXP>>>` 等，而非完整的 `<<<END_EXPRESSION>>>`。原有正则仅匹配完整结束标记，导致解析失败 → `emotion=undefined` → 渲染回退默认头像。

**修复**：在 `parseExpressionFromContent` 中新增两个容错正则：
- `text-marker-end-exp-abbreviated`：匹配 `<<<END_EXP` + 任意大写字母 + `>>>`
- `text-marker-malformed-end-exp`：匹配残缺+缩写组合（如 `<<END_EXPR>>`）

**验证**：独立 Node.js 脚本验证所有格式均能正确匹配。

#### 第二轮修复（2026-08-09）：全面排查 + 增强 + 兜底

**排查结论**（逐层验证，全部正确）：
1. ✅ 正则模式正确 — 独立脚本验证 `<<<END_EXPRESSION>>>` / `<<<END_EXPR>>>` / `<<<_EXPRESSION>>>` 均匹配
2. ✅ 持久化代码保留 emotion — `characterChatStore.ts` L116 白名单含 `emotion`
3. ✅ 状态管理保留 emotion — 所有 dispatch 路径使用 `...msg` 展开
4. ✅ `stripThinkingTags` 不影响 EXPRESSION 标签 — 仅匹配 `think|thinking|thought`
5. ✅ `ChatMessageBubble` 未 memo 化 — 无陈旧渲染风险
6. ❌ 保存的文件无 emotion 字段 + content 含原始标记 — 唯一解释：`parseExpressionFromContent` 运行时返回 null

**根因定位**：保存的版本文件（2026-08-08 13:xx）中 AI 输出的结束标记为 `<<<END_EXPR>>>`（缩写）和 `<<<_EXPRESSION>>>`（残缺），这些格式在第一轮修复前的旧正则下无法匹配。第一轮修复已添加正则到文件，但如果代码未重新构建/热重载，运行时仍执行旧代码。

**增强修复**（4 项）：

1. **EXPR 兜底正则**（`PromptBuilder.ts` L410）：
   ```typescript
   { regex: /<<<EXPRESSION>>>\s*([a-z_][a-z0-9_]*)\s*<<<[^>]*EXPR[^>]*>>>/i, name: 'text-marker-expr-fallback' },
   ```
   匹配 `<<<EXPRESSION>>>key<<<任意含 EXPR 字样的标记>>>`，覆盖所有结束标记中包含 EXPR 子串的变体（END_EXPRESSION / END_EXPR / _EXPRESSION / END_EXP 等）。作为最后一道正则防线，位于所有特定模式之后。

2. **`matchedPattern` 诊断返回值**（`PromptBuilder.ts` L378）：
   `parseExpressionFromContent` 返回值新增 `matchedPattern: string | null` 字段，标识匹配到的正则名称。`onComplete` 日志增强为：
   ```
   [CharacterDialogueChat] 表情系统：解析到情绪键 "annoyance"（匹配模式: text-marker-expr-fallback）
   ```
   解析失败时输出 `JSON.stringify(末尾300字)` + `含 EXPRESSION 关键字: true/false`，区分"AI 未生成标记"和"生成了标记但正则未匹配"两种场景。

3. **`resolveExpressionImage` 始终传递**（`CharacterDialogueChat.tsx` L782）：
   原实现仅在 `msg.imageAttachment` 存在时传递 `resolveExpressionImage` prop，纯文本 AI 消息传 `undefined`。虽 `expressionImage` prop 兜底覆盖，但始终传递更可靠：
   ```typescript
   // 修复前（条件传递）
   resolveExpressionImage={msg.imageAttachment ? (emotion) => resolveExpressionImage(emotion) ?? undefined : undefined}
   // 修复后（始终传递）
   resolveExpressionImage={(emotion: string) => resolveExpressionImage(emotion) ?? undefined}
   ```

4. **`stripSystemTags` 同步增强**（`messageProcessor.ts` L235）：
   渲染层防御性兜底也添加 EXPR 正则，确保即使 hooks 层解析失败，渲染层仍能剥离原始标记不进入 HTML 管线：
   ```typescript
   result = result.replace(/<<<EXPRESSION>>>\s*[a-z_][a-z0-9_]*\s*<<<[^>]*EXPR[^>]*>>>/gi, '');
   ```

5. **STREAM_COMPLETE 诊断日志**（`CharacterDialogueChat.hooks.ts` L1606-1615）：
   在 dispatch 前打印 `parsedEmotion` / `finalEmotion` / `contentLength`，确认 emotion 字段在状态更新前的最终值。

**修改文件清单**：
| 文件 | 修改内容 |
|------|---------|
| `src/renderer/components/Character/CharacterDialogueChat/PromptBuilder.ts` | 新增 `text-marker-expr-fallback` 正则；返回值新增 `matchedPattern` 字段 |
| `src/renderer/components/Character/CharacterDialogueChat/CharacterDialogueChat.hooks.ts` | `onComplete` 日志增强（matchedPattern + JSON.stringify + hasExpressionKeyword）；STREAM_COMPLETE 诊断日志 |
| `src/renderer/components/Character/CharacterDialogueChat/CharacterDialogueChat.tsx` | `resolveExpressionImage` 从条件传递改为始终传递 |
| `src/renderer/components/Character/CharacterDialogueChat/utils/messageProcessor.ts` | `stripSystemTags` 新增 EXPR 兜底正则 |

**⚠️ 教训**：
1. **正则容错必须有"最后防线"** — 逐个添加特定变体正则（END_EXPR / END_EXP / _EXPRESSION）总有遗漏，最终的 `<<<[^>]*EXPR[^>]*>>>` 通配模式才是终极兜底。设计正则容错链时应先穷举已知变体，再添加一个"包含关键字即匹配"的通配模式。
2. **代码修改后必须验证运行时生效** — 文件已保存 ≠ 运行时已生效。Electron + Vite HMR 可能不自动热重载所有模块，特别是被间接导入的工具函数。修改后应重启 dev server 或刷新渲染进程。
3. **诊断日志应返回"哪个模式匹配"** — 仅记录"匹配成功/失败"不足以定位问题，必须记录匹配到的具体模式名称，才能判断是哪条正则起了作用。
4. **代码注释中的文档引用必须正确** — 原代码注释引用 §7.18 / §7.19 实际指向其他主题，导致文档溯源失败。添加文档引用时应先确认目标章节确实存在且主题匹配。
5. **防御性兜底应分层** — hooks 层（解析+剥离）和渲染层（stripSystemTags）都应有完整的正则覆盖，避免单点失效导致原始标记泄露到用户可见内容。

#### 8. 补充：组合方案覆盖功能（2026-08-07）

用户反馈保存临时方案时无法覆盖同名方案，必须重命名，体验不佳。新增 `overwriteCombination` store action + 双弹窗确认交互：

- **store 层**（`characterTraitStore.ts`）：新增 `overwriteCombination(name, snapshot?)` —— 按名称精确匹配已有方案，保留原 id / createdAt，更新 traitIds / traitSnapshot / updatedAt，立即 fire-and-forget 持久化。找不到时返回 `{ success: false, error }`。
- **AssetGenerateModal**（`handleSaveTempScheme`）：输入方案名后若重名，弹出二次确认框「已存在同名方案「xxx」，是否覆盖其内容？」，确认后调 `overwriteCombination`，取消则不操作。
- **AssetManagerModal**（`handleOpenSaveCombination`）：同步实现重名覆盖确认（保持两个入口行为一致）。
- **向后兼容**：不重名时走原 `saveCombination` 逻辑（新增方案），重名时才走 `overwriteCombination`（覆盖方案），无破坏性变更。

#### 9. 补充修复：手动模式（`__manual__`）下拉不生效（2026-08-07）

**现象**：用户报告「切换到手动方案，角色特征列表不变，且组合方案下拉组件仍旧显示为自定义方案」。

**根因**：`AssetManagerModal.handleApplyCombination` 在 `combinationId === '__manual__'` 时直接 `return`，未调 `applyCombination(null)`。原注释称「手动模式由 toggleTraitEnabled 自动触发 activeCombinationId=null」，但这只覆盖用户手动 toggle 特征的场景，不覆盖用户从下拉显式选择「手动模式」的场景。导致 `activeCombinationId` 仍为上一个方案 ID，下拉不刷新、特征列表也不变。

**修复**：将 `if (combinationId === '__manual__') return;` 改为 `if (combinationId === '__manual__') { applyCombination(null); return; }`，与 `AssetGenerateModal.handleApplyCombination` 行为对齐（后者原本就正确调用了 `applyCombination(null)`）。

**手动模式特征列表行为**：切换到手动模式时特征列表保持当前状态不变（不恢复原始特征），这是设计预期——手动模式 = 取消方案激活 + 保留当前特征供用户手动编辑。如需恢复原始特征，用户可使用「重置」按钮。

#### 10. 补充修复：traitSnapshot 方案切换到手动模式后原始特征丢失（2026-08-07）

**现象**：用户反馈「从自定义模式切换到手动模式完全不可用，相关的 tag 都没有加载」。上一条修复（`applyCombination(null)`）仅解决了下拉不刷新问题，但特征列表仍不恢复。

**根因**：`applyCombination(traitSnapshot 方案)` 会用快照**完整替换** store 的 `traits` 数组（L1275-1279）。当快照只包含部分原始特征时（如用户在 AssetGenerateModal 中删除了某些特征后保存的方案），原始特征在替换后丢失。切换到手动模式（`applyCombination(null)`）仅设 `activeCombinationId = null`，不恢复原始 `traits`，导致用户看不到完整的原始特征列表。

**修复方案**：在 store 中新增 `preCombinationTraits` 内存备份字段（不持久化）：

```typescript
// store state 新增
preCombinationTraits: CharacterTraitItem[] | null;

// applyCombination(traitSnapshot 分支)：替换前备份
if (combination.traitSnapshot && combination.traitSnapshot.length > 0) {
  set({
    preCombinationTraits: traits.map((t) => ({ ...t })),  // ← 备份当前 traits
    traits: combination.traitSnapshot.map((t) => ({ ...t })),
    activeCombinationId: combinationId,
  });
}

// applyCombination(null 分支)：从备份恢复
if (combinationId === null) {
  const { preCombinationTraits } = get();
  set({
    ...(preCombinationTraits
      ? { traits: preCombinationTraits.map((t) => ({ ...t })) }  // ← 恢复
      : {}),
    activeCombinationId: null,
    preCombinationTraits: null,  // ← 清空备份
  });
}
```

**AssetGenerateModal 同步修复**：`handleApplyCombination` 和 `handleDeleteCombination` 在调用 store 后，需通过 `useCharacterTraitStore.getState().traits` 读取恢复后的 traits 并同步到本地 `editedTraits`（否则本地状态仍停留在上一个方案的快照）：

```typescript
if (combinationId === '__manual__') {
  applyCombination(null);
  const restoredTraits = useCharacterTraitStore.getState().traits;
  setEditedTraits(restoredTraits.map((t) => ({ ...t })));
  return;
}
```

**备份字段清理时机**（`preCombinationTraits = null`）：
- `loadTraits` 成功/失败：从磁盘加载时无备份
- `clear()`：清空 store 时无备份
- `toggleTraitEnabled`：用户手动编辑意味着接受当前特征，无需恢复旧备份
- `applyCombination(null)`：恢复后清空，避免多次切换累积
- `deleteCombination`（删除激活方案时）：恢复后清空
- traitIds 方案应用：不修改备份（仅切换 enabled，不替换 traits 数组）

**deleteCombination 增强**：删除激活的 traitSnapshot 方案时，也从备份恢复 traits（与切换到手动模式行为一致），避免删除方案后特征列表停留在快照状态。

**`preCombinationTraits` 不持久化**：`saveTraits` 手动构建 `CharacterTraitManifestV2` 对象（L669-679），只包含 manifest 定义的字段，`preCombinationTraits` 不在其中，不会写入磁盘。

**涉及文件**：
- `src/renderer/stores/characterTraitStore.ts`：新增 `preCombinationTraits` 字段 + `applyCombination`/`deleteCombination`/`toggleTraitEnabled`/`loadTraits`/`clear` 修改
- `src/renderer/components/Character/CharacterDialogueChat/AssetGenerateModal.tsx`：`handleApplyCombination`/`handleDeleteCombination` 同步 `editedTraits`

**Task 7 — store saveCombination/applyCombination traitSnapshot 支持（`characterTraitStore.ts`）：**

```typescript
// saveCombination：新增 snapshot 参数，写入 traitSnapshot + 立即持久化
saveCombination: (name: string, snapshot?: CharacterTraitItem[]) => {
  const traitIds = traits.filter((t) => t.enabled).map((t) => t.id);
  const newCombination: TraitCombination = {
    id: genTraitId(), name: trimmed, traitIds,
    ...(snapshot ? { traitSnapshot: snapshot.map((t) => ({ ...t })) } : {}),
    createdAt: now, updatedAt: now,
  };
  set({ combinations: [...combinations, newCombination] });
  void get().saveTraits().catch(...);  // 立即持久化（fire-and-forget）
}

// applyCombination：traitSnapshot 分支完整替换 traits，traitIds 分支仅切换 enabled
applyCombination: (combinationId: string | null) => {
  if (combinationId === null) { set({ activeCombinationId: null }); return; }
  if (combination.traitSnapshot?.length) {
    set({ traits: combination.traitSnapshot.map((t) => ({ ...t })), activeCombinationId });
  } else {
    const enabledIdSet = new Set(combination.traitIds);
    set({ traits: traits.map((t) => ({ ...t, enabled: enabledIdSet.has(t.id) })), activeCombinationId });
  }
}
```

**Task 5+6 — AssetGenerateModal handleApplyCombination（L1651-1671）：**

```typescript
const handleApplyCombination = useCallback((combinationId: string) => {
  if (combinationId === '__manual__') { applyCombination(null); return; }
  const combination = combinations.find((c) => c.id === combinationId);
  if (!combination) return;
  if (combination.traitSnapshot?.length) {
    // traitSnapshot 方案：用快照替换 editedTraits（深拷贝）
    setEditedTraits(combination.traitSnapshot.map((t) => ({ ...t })));
    applyCombination(combinationId);
  } else {
    // traitIds 方案（旧）：切换 enabled 状态
    const traitIds = new Set(combination.traitIds);
    setEditedTraits((prev) => prev?.map((t) => ({ ...t, enabled: traitIds.has(t.id) })) ?? prev);
    applyCombination(combinationId);
  }
}, [combinations, applyCombination]);
```

#### 5. 验证

- **TypeScript 类型检查**：`npx tsc --noEmit -p tsconfig.json` 仅剩预先存在的 tsconfig 配置错误（`esModuleInterop` / `--jsx` / `electronAPI` / `@shared/types` 路径别名），无本次修改引入的新增类型错误。`AssetGenerateModal.tsx` 移除 `EyeOutlined` import + `void` 引用三个保留变量后 TS6133 unused 错误已消除。
- **向后兼容**：旧角色卡（无 `originalText` / 无 `traitSnapshot` 字段）加载时由 `normalizeTraitItem` 兜底为 `undefined`，前端不显示拆分图标、applyCombination 自动走 traitIds 分支，无异常。
- **跨页面联动**：AssetGenerateModal 与 AssetManagerModal 共享同一 `characterTraitStore`，组合方案通过 `saveTraits` 持久化到 v2 manifest，两侧下拉自动同步。

#### 6. 涉及文件清单

| 文件 | 改动概述 |
| --- | --- |
| `src/shared/types/characterTrait.types.ts` | `CategorizedTrait` / `CharacterTraitItem` 新增 `originalText?`；`TraitCombination` 新增 `traitSnapshot?`；JSDoc 注释 |
| `src/main/services/characterTraitAIService.ts` | `applyTagAudit` L1172-1219 三处场景翻译继承 + L3 拆分 originalText 记录；注释统一更新 |
| `src/main/services/characterTraitService.ts` | `normalizeTraitItem` L176-195 新增 originalText 兜底 + JSDoc |
| `src/renderer/stores/characterTraitStore.ts` | `saveCombination` L1138-1192 新增 snapshot 参数 + 立即持久化；`applyCombination` L1194-1240 traitSnapshot 分支 + null 支持；`deleteCombination` L1242-1279 立即持久化 |
| `src/renderer/components/Character/CharacterDialogueChat/AssetGenerateModal.tsx` | import 扩展；store 订阅 5 字段；3 个新 handler；handleConfirmEditTrait 清空 originalText；组合方案下拉替换 AI 图片识别按钮；拆分标签 Tooltip + SplitCellsOutlined |

#### 7. 教训

- ⚠️ **「标签库标准 tag 无需翻译」是错误假设**：用户需要翻译作为参考，即使标签已被替换为标准名。翻译继承策略应优先保留 AI 原始翻译，而非以「标准 tag 自解释」为由清空。
- ⚠️ **保存方案 ≠ 仅保存启用 id 集合**：AssetGenerateModal 的临时编辑场景中，特征本身（text/translation/originalText）是临时数据，仅保存 traitIds 无法恢复完整状态。traitSnapshot 完整快照是必要的，traitIds 仅作为向后兼容。
- **UI 入口整合**：当多个功能（保存 + 下拉 + 删除）共享同一区域时，整合为一行 UI（下拉 + 两个小按钮）比分散放置多个按钮更直观，避免重复入口。
- **保留未使用代码的技巧**：spec 要求保留 `handleImageRecognize` 但移除按钮入口时，通过 `void handleImageRecognize;` 引用避免 TS6133 unused 报错，比删除代码更安全（便于未来恢复）。

## §7.23 提示词生成功能（Spec: add-prompt-generation-in-asset-modal，2026-08-07）

### 1. 背景

用户在 AI 素材生成弹窗（`AssetGenerateModal`）中需要快速生成额外的特征 tag，但原流程需要回到「角色特征」页签才能调用 AI 生成。本次在「携带角色特征」区域正上方新增「提示词生成」面板，让用户直接输入自由文本提示词（如 `red hair, blue dress, forest background` 或自然语言），由主进程 LLM 解析为分类特征 tag 列表，应用后追加到当前特征列表。

视觉风格参考「角色特征」页签中「动态场景指令」面板的交互模式（紫色渐变边框 + `ThunderboltOutlined` 图标 + `Input.TextArea` + 主按钮 + 结果展示 + 应用按钮）。

### 2. 实现方案

#### 2.1 主进程服务扩展（`src/main/services/characterTraitAIService.ts`）

新增 `generateTraitPrompts(params)` 方法 + `GenerateTraitPromptsParams` / `GenerateTraitPromptsResult` 接口 + `buildTraitPromptUserMessage` 私有辅助方法。

**与现有方法的区别：**
- 与 `generateCharacterTraits` 的区别：不读取角色卡图片（无需 `characterCardId`），输入是用户自由文本提示词，不生成 `appearanceDescription`
- 与 `generateDynamicScenePrompts` 的区别：生成的是分类特征（`CategorizedTrait[]`，含 `categoryId`），不是三组维度 tag；使用 `parseTraitsAndDescription` 解析「分类:tag|中文翻译」格式

**复用基础设施：**
- `buildDynamicTraitSystemPrompt(globalCategories)` — 动态构建系统提示词（系统分类 + 自定义分类）
- `buildRagReferenceWithDebug(prompt)` — RAG 标签库参考注入
- `applyTagAudit(traits, ctx, aiCfg, rtCfg)` — L0-L5 完整审计链（与 `generateCharacterTraits` 完全一致）
- `parseTraitsAndContent(content)` — 解析 LLM 响应为 `CategorizedTrait[]`
- `enrichSystemPrompt(messages, engineSystemPrompt)` — 注入引擎级 system prompt
- `getEngineRuntimeConfig()` — 读取 temperature / max_tokens

#### 2.2 IPC 通道扩展

新增 `ai:generateTraitPrompts` 通道，注册于 `src/main/ipc/handlers/characterTraitAIHandlers.ts`，由 `registerCharacterTraitAIHandlers()` 统一注册。

| 文件 | 改动 |
| --- | --- |
| `src/main/ipc/handlers/characterTraitAIHandlers.ts` | 注册 `ai:generateTraitPrompts` handler，复用 try/catch 兜底模式；导入 `GenerateTraitPromptsParams` 类型 |
| `src/main/preload.ts` | 在 `ai:` 命名空间内 `generateDynamicScenePrompts` 之后追加 `generateTraitPrompts` 方法，沿用内联类型签名 |
| `src/renderer/types/electron.d.ts` | 在 `ai:` 接口内 `generateDynamicScenePrompts` 之后追加 `generateTraitPrompts` 类型声明（内联入参与返回值类型，与现有 ai 命名空间方法一致） |

#### 2.3 前端 UI 实现（`src/renderer/components/Character/CharacterDialogueChat/AssetGenerateModal.tsx`）

**新增 state（7 个）：**
- `promptGenInput` — 用户输入的提示词文本
- `promptGenResult` — AI 生成的分类特征（`CategorizedTrait[] | null`，应用前暂存）
- `promptGenLoading` — AI 调用 loading
- `promptGenRagDebug` — RAG 质检报告
- `promptGenRagVisible` — RAG 面板可见性
- `appliedPromptTraitIds` — 已应用的提示词生成特征 ID 集合（`Set<string>`，用于 ✨ 徽标）

**新增 handler（3 个）：**
- `handleGenerateTraitPrompts` — 调用 `ai:generateTraitPrompts` IPC，`baseTraits` 取 `enabledTraitTexts.join(', ')`
- `handleApplyGeneratedTraits` — 为每个 `CategorizedTrait` 分配 `id`（`genTraitId()`）+ `enabled=true`，追加到 `editedTraits` 末尾；记录新 `id` 到 `appliedPromptTraitIds`
- `handleDiscardGeneratedTraits` — 清空生成结果与 RAG 报告

**新增渲染函数 `renderPromptGenPanel()`：**
- 紫色渐变边框容器（`rgba(139, 92, 246, 0.05)` 背景 + `rgba(139, 92, 246, 0.2)` 边框）
- 标题行：`ThunderboltOutlined` 图标 + 「提示词生成」+ 描述文字
- 输入区：`Input.TextArea`（minRows=2, maxRows=4）+ 「生成提示词」按钮（紫色渐变 + loading）
- 结果区（`promptGenResult` 非空时渲染）：
  - 按分类分组展示（`allCategories` 过滤有特征的分类）
  - 每个 trait 为 `Tag`（紫色）+ `Tooltip`（翻译 + originalText 溯源）
  - 「应用到特征列表」按钮（`CheckOutlined`）+ 「放弃」按钮（`CloseOutlined`）
  - `RagQualityReport` 组件（只读模式，不传 `onRevert` / `onManualReplace` 回调）

**JSX 插入点（2 处）：**
- 批量模式（`mode === 'batch-expression'`）：`{renderHeader()}` 之后、`{renderTraitsPanel()}` 之前
- 单次模式（其他 mode）：左栏 `{renderHeader()}` 之后、`{renderTraitsPanel()}` 之前

**✨ 徽标渲染（`renderTraitsPanel` 内）：**
- 新增 `isPromptGenerated = appliedPromptTraitIds.has(trait.id)` 判断
- 在 `Tag` 内容中 `trait.text` 之前渲染 `✨` emoji（`title="AI 提示词生成追加"`）
- 与 `SplitCellsOutlined` 拆分图标并列，让用户直观区分「AI 生成追加」与「手动临时新增」（两者 Tag 颜色均为 cyan）

**弹窗关闭清理：**
- 在 `useEffect([open])` 的 `!open` 分支中清空所有提示词生成状态（`promptGenInput` / `promptGenResult` / `promptGenLoading` / `promptGenRagDebug` / `promptGenRagVisible` / `appliedPromptTraitIds`）
- `handleResetTraits` 中同步清除 `appliedPromptTraitIds`（特征重置后 ✨ 徽标不再显示）

### 3. 审计流程（L0-L5 完整审计链，与 `generateCharacterTraits` 完全一致）

- **L0** 自定义同义词映射（`userSynonymMapService`）— 人工审核 / AI 兜底持久化的映射
- **L1** name 精确匹配（`tagAutocompleteService.tagMap`）
- **L2** alias 精确匹配（`tagAutocompleteService.aliasMap`）
- **L3** 颜色复合词拆分（`splitColorTag`，如 `light gray drooping ears` → `grey_ears` + `drooping_ears`）
- **L3b** 否定性修饰词剥离（`brimless` / `sleeveless` 等 8 词）
- **L4** 语义 KNN 替换（`score >= 0.3` 自动替换为库内标签）
- **L5** AI 兜底（LLM 生成候选词 → 再走 L0-L4 → 命中替换 + `userSynonymMapService.addMapping` 持久化）

`ragDebug` 字段含 `tagValidation` 数组，每项记录 `isValid` / `canonicalName` / `replacedBy` / `source` / `splitTags` / `aiFallbackAttempted` / `aiFallbackCandidates` 等字段，前端 `RagQualityReport` 组件据此展示质检报告。

### 4. 错误兜底

- 空输入：`prompt` 为空或纯空白 → 「请输入提示词」（不调用 LLM，service 短路返回）
- AI 引擎未配置：baseUrl / apiKey / modelName 任一缺失 → 「AI 引擎未配置，请先在设置中配置 API」
- 引擎参数缺失：temperature / max_tokens 未配置 → 「AI 引擎未配置 temperature 或 max_tokens 参数」
- 调用失败：网络 / 超时 / HTTP 错误 → 「AI 调用失败：<具体原因>」（含 timeout 专项兜底）
- 解析失败：LLM 返回空内容 / 无法解析为分类 tag → 「AI 返回内容无法解析为 tag 列表」
- IPC 序列化兜底：handler 外层 try/catch 保证渲染进程永不收到 reject
- 前端 try/catch：`handleGenerateTraitPrompts` 内 try/catch 兜底 IPC 异常，`message.error` 展示

### 5. 涉及文件清单

| 文件 | 改动概述 |
| --- | --- |
| `src/main/services/characterTraitAIService.ts` | 新增 `generateTraitPrompts` 方法 + `GenerateTraitPromptsParams` / `GenerateTraitPromptsResult` 接口 + `buildTraitPromptUserMessage` 私有方法；复用 `buildDynamicTraitSystemPrompt` / `applyTagAudit` / `buildRagReferenceWithDebug` / `parseTraitsAndDescription` |
| `src/main/ipc/handlers/characterTraitAIHandlers.ts` | 注册 `ai:generateTraitPrompts` handler + 导入 `GenerateTraitPromptsParams` 类型 + 更新通道列表注释 |
| `src/main/preload.ts` | 在 `ai:` 命名空间追加 `generateTraitPrompts` 方法 |
| `src/renderer/types/electron.d.ts` | 在 `ai:` 接口追加 `generateTraitPrompts` 类型声明（内联入参与返回值类型） |
| `src/renderer/components/Character/CharacterDialogueChat/AssetGenerateModal.tsx` | import `RagQualityReport`；新增 7 个 state + 3 个 handler + `renderPromptGenPanel` 函数；2 处 JSX 插入 `{renderPromptGenPanel()}`；`renderTraitsPanel` 内新增 ✨ 徽标；弹窗关闭 / 重置时清理状态 |
| `CODE_WIKI.md` | 新增「提示词生成功能」章节（IPC 通道表 + 服务表增量 + 审计流程 + UI 交互流程 + 错误兜底） |

### 6. 设计要点

- **结果暂存策略**：`promptGenResult` 在应用前仅暂存，不直接写入 `editedTraits`。用户可在应用前查看 RAG 质检报告，确认审计结果后再决定应用或放弃，避免无效 tag 进入特征列表。
- **应用后清空**：`handleApplyGeneratedTraits` 应用后立即清空 `promptGenResult`，避免重复应用导致重复追加。用户需重新输入提示词才能再次生成。
- **baseTraits 上下文**：`handleGenerateTraitPrompts` 将 `enabledTraitTexts.join(', ')` 作为 `baseTraits` 传入，让 LLM 知道当前已有特征，避免重复生成（如已有 `white fur` 时不再生成 `white fur`）。
- **✨ 徽标 vs cyan 颜色**：应用的新增 trait 与手动临时新增的 trait 都为 cyan 颜色（`!isStoreTrait` 分支），但前者额外显示 ✨ 徽标，让用户直观区分来源。
- **RagQualityReport 只读模式**：提示词生成场景下，tag 已在主进程审计阶段自动替换为库内标签（L0-L5），前端无需提供撤销 / 手动替换入口，故不传 `onRevert` / `onManualReplace` / `onRevertAiFallback` 回调。

### 7. 教训

- **复用而非重复**：`generateTraitPrompts` 完整复用 `generateCharacterTraits` 的审计基础设施（`applyTagAudit` / `buildRagReferenceWithDebug` / `buildDynamicTraitSystemPrompt`），仅差异在入参（自由文本 vs 角色卡字段）与输出（不生成 `appearanceDescription`）。新增方法仅 ~160 行，无重复审计逻辑。
- **类型签名同步**：主进程类型扩展（`GenerateTraitPromptsParams` / `GenerateTraitPromptsResult`）不会自动反映到渲染进程，必须手动同步 `electron.d.ts` 内联类型签名（与 §7.21 `generateDynamicScenePrompts` 翻译字段同步 bug 同类问题，本次主动同步避免后续 TS 错误）。
- **state 清理时机**：弹窗关闭时必须清空所有提示词生成状态，避免下次打开时残留上次的生成结果 / RAG 报告 / ✨ 徽标。`handleResetTraits` 仅清空 `appliedPromptTraitIds`（特征重置后 ✨ 徽标不再显示），但保留 `promptGenResult`（用户仍可重新应用）。

### 8. ⚠️ 【重点标记 - Bug 修复】应用时未去重导致标签重复（2026-08-07 用户反馈）

**问题现象：** 用户点击「应用到特征列表」按钮时，如果 AI 生成的提示词中包含与当前 `editedTraits` 已有特征相同的 tag（如 `dog_girl`），未进行去重直接追加，导致特征列表出现多个相同的 tag（如两个 `dog_girl`）。AI 生成结果内部也可能包含多条相同 tag，同样会全部追加。

**根因分析：**

`handleApplyGeneratedTraits` 初版实现直接 `promptGenResult.map(...)` 转换全部生成结果并追加到 `editedTraits`，未检查：
1. 生成结果与 `editedTraits` 已有特征的重复
2. 生成结果内部的重复（AI 可能返回多条相同 tag）

虽然 `handleGenerateTraitPrompts` 传入了 `baseTraits`（当前已启用特征文本）给 LLM 作为上下文以「避免重复生成」，但：
- `baseTraits` 仅含 `enabled` 的特征，`disabled` 的特征不在上下文中 → LLM 仍可能生成已存在但禁用的 tag
- LLM 不保证严格遵守「不重复」指令，仍可能生成已存在的 tag
- 生成结果内部也可能因 LLM 输出问题出现重复

**修复方案：**

在 `handleApplyGeneratedTraits` 中增加两层去重（`src/renderer/components/Character/CharacterDialogueChat/AssetGenerateModal.tsx`）：

```typescript
// 构建已有特征的 text 集合（小写 + trim），用于与生成结果去重
const existingTextKeys = new Set(
  effectiveTraits.map((t) => t.text.trim().toLowerCase())
);
// 生成结果内部也需要去重（AI 可能返回多条相同 tag）
const seenInBatch = new Set<string>();
const newItems: CharacterTraitItem[] = [];
let skipCount = 0;
for (const trait of promptGenResult) {
  const key = trait.text.trim().toLowerCase();
  if (existingTextKeys.has(key) || seenInBatch.has(key)) {
    skipCount++;
    continue;
  }
  seenInBatch.add(key);
  newItems.push({ id: genTraitId(), text: trait.text, ... });
}
```

**去重 key 设计：**
- 使用 `text.trim().toLowerCase()` 作为 key（忽略大小写 + 前后空白）
- **text-only key**（非 category+text 组合），与项目 SD 标签去重语义一致——`dog_girl` 在不同分类中语义相同，不应因分类不同而保留多份
- 与 project_memory 中记录的教训一致：「AI-generated tag deduplication must use text-only keys (not category+text combinations)」

**用户体验处理：**
- 部分重复：`message.success(\`已追加 ${newItems.length} 条特征，跳过 ${skipCount} 条重复项\`)` —— 明确告知跳过条数，避免静默丢弃（与 §7.16 CSV 加载「只输出成功条数导致静默丢弃」同类教训）
- 全部重复（`newItems.length === 0`）：`message.info('生成的 N 条特征均已存在于当前列表，未追加重复项')`，**保留 `promptGenResult` 不清空**，让用户仍可查看 RAG 报告与生成结果
- 全新特征（无重复）：`message.success('已追加 N 条 AI 生成特征到下方列表')`（原行为不变）

**依赖数组更新：**
`useCallback` 依赖数组从 `[promptGenResult]` 扩展为 `[promptGenResult, effectiveTraits]`，确保去重使用最新的 `editedTraits` 工作副本（用户可能在上次生成后手动新增/删除了特征）。

**教训：**
- ⚠️ **「LLM 会遵守不重复指令」是错误假设**：即使 `baseTraits` 上下文明确列出已有特征，LLM 仍可能生成重复 tag。应用层必须做防御性去重，不能依赖 LLM 的指令遵守。
- ⚠️ **应用追加类操作必须考虑与现有数据的去重**：本次与 §7.16（CSV 加载静默丢弃）、project_memory 中「globalCategories 合并 bug」同类问题——凡是「新增数据拼接到现有列表」的操作，都必须检查与现有数据的冲突/重复。
- **去重范围应覆盖 disabled 项**：`baseTraits` 仅含 enabled 特征传给 LLM，但去重应覆盖 ALL 特征（含 disabled），否则会追加一个与 disabled 项重复的新项。

### 9. ⚠️ 【重点标记 - Bug 修复】SD 生成前未去重导致重复 tag 多次加权（2026-08-07 用户反馈）

**问题现象：** 调用 AI 生成图片时，若 `characterTraits` 数组中存在重复 tag（如 `['dog_girl', 'dog_girl', 'white_fur']`），最终拼接的 SD prompt 会包含 `dog_girl, dog_girl, white_fur`，导致 SD 模型对 `dog_girl` 双倍加权，影响生成质量（该特征过度强化，其他特征相对弱化）。

**根因分析：**

整条 prompt 构建链路无任何去重环节：

1. **前端 `enabledTraitTexts`**（`AssetGenerateModal.tsx:458-469`）：从 `effectiveTraits` 过滤 enabled 项 + map 取 `.text`，**无去重**
2. **前端 `buildSdOptions`**（`AssetGenerateModal.tsx:900-1032`）：透传 `characterTraits: enabledTraitTexts`，**无去重**
3. **后端 `sdGenerationService.applyTraitsAndLora`**（`sdGenerationService.ts:794-810`）：仅 `.map(trim).filter(非空).join(', ')`，**无去重**

虽然 §8 修复了 `handleApplyGeneratedTraits` 的「应用时去重」，但以下场景仍可能在 `characterTraits` 中产生重复：
- 历史数据中已存在的重复 trait（§8 修复前追加的）
- 用户手动新增的重复 tag
- 角色卡 v1 → v2 迁移时产生的重复
- 其他未经过 `handleApplyGeneratedTraits` 的数据来源

**修复方案：双层防御性去重**

#### 层 1：前端源头去重（`AssetGenerateModal.tsx` — `enabledTraitTexts`）

在 `enabledTraitTexts` useMemo 中追加 `.filter()` 做大小写不敏感去重，保留首次出现的项：

```typescript
const enabledTraitTexts = useMemo(
  () =>
    effectiveTraits
      .filter((t) => t.enabled && ...模式过滤...)
      .map((t) => t.text)
      // ⚠️ SD 生成前去重：text 小写 + trim 作为 key，保留首次出现
      .filter((text, _index, arr) => {
        const key = text.trim().toLowerCase();
        return arr.findIndex((t) => t.trim().toLowerCase() === key) === _index;
      }),
  [effectiveTraits, isNudeSlot, isExpressionMode],
);
```

**效果：**
- `buildSdOptions` 的 `characterTraits` 字段去重
- `handleGenerateTraitPrompts` 的 `baseTraits` 上下文去重（避免 LLM 因看到重复上下文生成重复 tag）
- `buildEmotionPrompt` 等其他消费者也受益

#### 层 2：后端防御性去重（`sdGenerationService.ts` — `applyTraitsAndLora`）

在 `{traits}` 占位符替换前增加 `Set` 去重，保护所有调用方（含 expression 生成等其他路径）：

```typescript
const seenKeys = new Set<string>();
const traitsStr = traitsRaw
  .map((t) => (typeof t === 'string' ? t.trim() : ''))
  .filter((t) => {
    if (t.length === 0) return false;
    const key = t.toLowerCase();
    if (seenKeys.has(key)) return false;
    seenKeys.add(key);
    return true;
  })
  .join(', ');
// 重复检测日志：去重前后数量不一致时 console.warn
if (dedupedCount < nonEmptyTraitCount) {
  console.warn(`检测到 ${nonEmptyTraitCount - dedupedCount} 条重复 tag，已去重（${nonEmptyTraitCount} → ${dedupedCount}）`);
}
```

**双层防御的必要性：**
- 前端去重覆盖 AssetGenerateModal 的所有下游消费者（SD 生成 / LLM 上下文 / 表情生成）
- 后端去重覆盖所有调用 `sdGenerationService` 的入口（含未来可能新增的调用方），作为最后防线
- 两层独立运作，任一层失效不会导致重复 tag 进入 SD

**去重 key 设计（与 §8 一致）：**
- `text.trim().toLowerCase()` —— 忽略大小写 + 前后空白
- **text-only key**（非 category+text 组合）—— `dog_girl` 在不同分类中语义相同，SD 会统一处理
- 保留首次出现的项 —— 维持原有顺序，不改变 prompt 结构

**可观测性：**
- 后端检测到重复时 `console.warn` 输出「检测到 N 条重复 tag，已去重（X → Y）」
- 原有 `console.log` 扩展为「输入特征 N 条（去重后 M 条），拼接为: ...」，便于用户对照

**涉及文件：**

| 文件 | 改动 |
| --- | --- |
| `src/renderer/components/Character/CharacterDialogueChat/AssetGenerateModal.tsx` | `enabledTraitTexts` useMemo 追加 `.filter()` 去重（L468-477） |
| `src/main/services/sdGenerationService.ts` | `applyTraitsAndLora` 方法（L794-830）增加 `Set` 去重 + 重复检测 `console.warn` + 日志扩展 |

**教训：**
- ⚠️ **「应用层去重已足够」是错误假设**：§8 修复了「应用追加时去重」，但历史数据 / 其他来源仍可能引入重复。prompt 构建链路的最后一环（注入 SD prompt 前）必须做防御性去重，不能假设上游数据已干净。
- ⚠️ **prompt 拼接类操作必须考虑重复 tag 对权重的影响**：SD 模型对 prompt 中每个 tag 独立加权，重复 tag 会导致该特征权重倍增。这与「翻译字段拼接」「日志拼接」等纯文本场景不同——SD prompt 的重复是**语义错误**而非仅格式问题。
- **双层防御优于单点修复**：前端源头去重 + 后端兜底去重，两层独立运作，任一层失效不会导致问题。与项目 `vec_items` 的 `DELETE + INSERT` 模式（§7.16）同理——关键操作需要多层保障。

## §7.24 审计环节 weight 继承策略（Spec: add-sdxl-prompt-weight-support / Task 5，2026-08-07）

**背景：** SDXL per-tag 权重支持（Spec: add-sdxl-prompt-weight-support）已由 Task 1（数据模型 `CharacterTraitItem.weight` / `CategorizedTrait.weight`）+ Task 4（AI 生成 LLM prompt 输出 `分类:tag|中文翻译|权重` 三段格式）落地。Task 5 负责打通 L0-L5 审计链对 `weight` 字段的正确处理：替换时继承 / 拆分时重置，避免审计纠错环节意外丢失或误用用户/AI 设定的权重。

**核心策略：四类替换路径的 weight 处理**

`applyTagAudit` 内有四类 trait.text 替换路径，每类对 weight 的处理策略不同（与 translation 继承策略既一致又有差异）：

| 路径 | 触发条件 | text | translation | weight | 理由 |
| --- | --- | --- | --- | --- | --- |
| L3 颜色拆分 | `v.splitTags` 命中 | 替换为 featureTag + push colorPartTag | 继承（保留 AI 原始翻译） | **重置 undefined** | 拆分后语义已变化（`light gray drooping ears` → `grey_ears` + `drooping_ears`），原权重针对复合概念，不适用于拆分后的单一子标签 |
| L2/L3 规范化 | `v.isValid && canonicalName !== tag` | 替换为 canonicalName | 继承 | **继承（不动）** | 规范化仅替换文本（如 `slender`→`slim`），语义未变，原 weight 应继续生效 |
| L4 KNN 语义替换 | `!isValid && top1.score >= REPLACE_MIN_SCORE` | 替换为 suggestion.name | 继承 | **继承（不动）** | KNN 语义等价替换（如 `slender`→`slim`），用户对原 tag 设定的权重强度应传递到库内标签 |
| L5 AI 兜底 | LLM 候选词重跑 L0-L4 命中 | 替换为 candidate.canonicalName | 继承 | **继承（不动）** | replacement 来自 LLM 候选词重跑 L0-L4 命中，语义等价，与 L4 一致 |

**关键代码改动（`src/main/services/characterTraitAIService.ts`）：**

L3 颜色拆分（`applyTagAudit` 场景1）——显式重置两个新 trait 的 weight：

```typescript
// featureTag（原 trait 原地修改）：
trait.text = v.splitTags.featureTag;
trait.translation = sourceTranslation; // 继承翻译
trait.originalText = sourceOriginalText;
trait.weight = undefined; // 【Task 5.2】重置：拆分后语义变化，原权重不适用

// colorPartTag（push 新 trait）：
traits.push({
  text: v.splitTags.colorPartTag,
  categoryId: trait.categoryId,
  translation: sourceTranslation, // 继承翻译
  originalText: sourceOriginalText,
  weight: undefined, // 【Task 5.2】重置（与 featureTag 一致）
});
```

L2/L3 规范化 + L4 KNN + L5 AI 兜底——继承策略（不写入 `trait.weight` 即继承原值，仅替换 `trait.text`）：

```typescript
// L4 KNN（场景3）：
trait.text = top1.name; // weight 未 touched，继承源标签 weight
// L5 AI 兜底：
trait.text = replacement; // weight 未 touched，继承源标签 weight
```

**与 translation 继承策略的对比：**

| 字段 | L3 拆分 | L2/L3 规范化 / L4 KNN / L5 AI 兜底 |
| --- | --- | --- |
| translation | 继承（保留 AI 原始翻译，与 `optimize-trait-translation-and-temp-scheme` 一致） | 继承 |
| weight | **重置 undefined**（语义变化，原权重不适用） | 继承（语义等价，权重应传递） |

差异原因：translation 是「描述性元数据」（用户参考用），继承无害；weight 是「生成时语义强度参数」，与 tag 所指概念绑定 —— 拆分后概念已变（复合 → 单一），原权重失去语义对应关系，必须重置；而规范化/KNN/AI 兜底替换的概念语义等价，原权重应继续生效。

**SubTask 5.4 / 5.5 验证结论（无需改动）：**

- **SubTask 5.4（手动编辑）**：`characterTraitAIService.ts` 内不包含手动替换逻辑 —— `manuallyReplaced` / `manualReplacement` 字段仅在 `ragDebug.tagValidation` 类型定义中声明（L195-197 / L318-319 / L375-376），注释明确「由前端 AssetManagerModal.handleManualReplace 写入，非 main 进程设置」。手动编辑 trait.text 时 weight 保持不变的实际逻辑在 `characterTraitStore.updateTrait`（Task 6.3 已验证），AI 服务文件无相关代码路径。
- **SubTask 5.5（validateTagsAgainstLibrary）**：`applyTagAudit` 仅传 `traits.map((t) => t.text)`（L1237）给 `validateTagsAgainstLibrary`，`applyAiFallback` 仅传候选词字符串数组（L1137）—— 验证输入纯文本，不涉及 weight。审计基于 tag text 匹配，weight 不影响验证结果，符合 spec「审计基于 tag text，不涉及权重」。

**重点标记（⚠️ 项目记忆相关）：**

- ⚠️ **标签替换逻辑不能只针对 invalid tag**（项目记忆 2026-08-06）：历史 bug 中 `if (v.isValid) continue` 跳过了 valid+canonicalName≠tag 的规范化替换。当前代码已修复 —— L2/L3 规范化（场景2）显式处理 `v.isValid && v.canonicalName && v.tag !== v.canonicalName`，weight 继承策略同步覆盖此路径（注释明确「规范化仅替换 text，weight 保持不变」），避免规范化路径意外清空 weight。
- ⚠️ **「翻译继承策略应优先保留 AI 原始翻译」原则扩展到 weight**（项目记忆）：L4/L5 替换时 translation 继承已落地（`optimize-trait-translation-and-temp-scheme`），本次 Task 5 将同原则扩展到 weight —— 当 L4/L5 替换 tag 时继承原 weight（不重置），仅在 L3 拆分（语义变化）时重置。L3 拆分重置 weight 不与 translation 继承冲突：translation 是描述性元数据可继承，weight 是语义强度参数需随概念变化重置。

**涉及文件：**

| 文件 | 改动 |
| --- | --- |
| `src/main/services/characterTraitAIService.ts` | `applyTagAudit` L3 颜色拆分（L1260-1270）：featureTag 显式 `trait.weight = undefined`、colorPartTag push 显式 `weight: undefined`；L2/L3 规范化（L1284-1285）+ L4 KNN（L1300-1302）+ L5 AI 兜底（L1178-1180）：添加 weight 继承策略注释（代码本身无需改动，不写入 weight 即继承） |

**教训：**
- **替换类操作的元数据继承策略需按字段语义分别决定，而非统一处理**：translation（描述性）与 weight（语义强度参数）虽同为可选元数据，但 L3 拆分时翻译可继承、权重必须重置 —— 拆分后翻译仍可参考（如「浅灰下垂耳朵」对应 `grey_ears`），但权重针对的是复合概念，不适用于拆分后的子标签。
- **审计链的「不动」即「继承」**：L4 KNN / L5 AI 兜底的 weight 继承无需显式代码（不写入 `trait.weight` 即保留原值），但必须添加注释明确策略 —— 否则后续维护者可能误以为「未处理 weight」是遗漏，反而引入 bug。这与 §7.23 的「注释明确 no-op 语义」原则一致。

## §7.25 ⚠️ 默认权重徽标始终显示（用户反馈修复，Spec: add-sdxl-prompt-weight-support，2026-08-07）

**背景：** Task 7 / Task 8 上线后，用户反馈「1.0 的权重也应该在 tag 上显示，方便用户修改，现在 1.0 的权重无法修改」。

**根因分析：**

原设计为「默认权重（1.0 或 undefined）不显示权重徽标，保持 UI 简洁」（checklist `## UI 权重编辑 — AssetGenerateModal` 原条目 `默认权重（1.0 或 undefined）不显示权重数值`）。该设计的盲区是：**权重徽标同时是「权重值展示」与「权重编辑入口」**——隐藏徽标等于隐藏编辑入口，导致默认权重的 tag 无法进入 Popover 编辑器修改权重。

**修复方案：**

| 权重状态 | 修复前 | 修复后 |
| --- | --- | --- |
| 默认权重（1.0 或 undefined） | ❌ 不显示徽标（无编辑入口） | ✅ 显示 `×1.0` 灰色弱化徽标 + 虚线边框，点击可进入编辑器 |
| 非默认 >1.0 | ✅ 暖橙色徽标 `×1.5` | ✅ 保持不变 |
| 非默认 <1.0 | ✅ 冷蓝色徽标 `×0.5` | ✅ 保持不变 |

默认权重视觉弱化策略（避免界面噪点）：
- 文字色：`var(--text-tertiary, #8c8c8c)`（次级文本灰）
- 背景：`transparent`（无填充）
- 边框：`1px dashed rgba(255, 255, 255, 0.2)`（虚线，暗示「可点击调整」）
- 不透明度：`0.7`（弱化）

**关键代码改动：**

`AssetGenerateModal.tsx`（renderTraitsPanel）+ `AssetManagerModal.tsx`（renderTraitChip）同步调整：

```typescript
const weightValue = trait.weight ?? 1.0;
const isDefaultWeight = trait.weight === undefined || trait.weight === 1.0;

// Popover 始终渲染（原 {hasWeight && (...)} 改为 {!isAutoFiltered && (...)}）
{!isAutoFiltered && (
  <Popover ...>
    <span style={{
      color: isDefaultWeight
        ? 'var(--text-tertiary, #8c8c8c)'
        : weightValue > 1.0 ? '#fa8c16' : '#1677ff',
      background: isDefaultWeight ? 'transparent' : /* 橙/蓝半透明 */,
      border: isDefaultWeight
        ? '1px dashed rgba(255, 255, 255, 0.2)'
        : /* 橙/蓝实线 */,
      opacity: isDefaultWeight ? 0.7 : 1,
    }}>
      ×{weightValue.toFixed(1)}
    </span>
  </Popover>
)}
```

Tooltip 也同步调整：当 `trait.originalText || trait.translation || !isDefaultWeight` 时展示多行 Tooltip，内含「权重：{weightValue.toFixed(1)}」行（默认权重用次级文本色弱化，非默认权重用橙/蓝色）。

**涉及文件：**

| 文件 | 改动 |
| --- | --- |
| `src/renderer/components/Character/CharacterDialogueChat/AssetGenerateModal.tsx` | renderTraitsPanel：新增 `weightValue` / `isDefaultWeight` 变量；Popover 条件从 `hasWeight` 改为 `!isAutoFiltered`（始终渲染）；徽标样式按 `isDefaultWeight` 分支（灰色虚线 vs 橙/蓝实线）；Tooltip 权重行始终展示 |
| `src/renderer/components/Character/CharacterDialogueChat/AssetManagerModal.tsx` | renderTraitChip：同上调整（无 `isAutoFiltered` 概念，Popover 无条件渲染） |

**重点标记（⚠️ 用户反馈才解决的问题）：**

- ⚠️ **「默认值不显示」≠「保持 UI 简洁」**：当 UI 元素同时承担「展示」与「编辑入口」双重职责时，隐藏默认值等于剥夺修改入口。原设计只考虑了视觉简洁，忽略了「用户如何修改默认值」的操作路径。类似教训：「保存=流程结束」是错误假设（项目记忆 2026-08-07）—— 设计时必须考虑「用户如何从默认状态过渡到自定义状态」的完整路径。
- ⚠️ **「保持 UI 简洁」类设计决策必须验证「是否会阻断操作」**：本次 bug 的根因是 spec 中「默认权重不显示权重数值，保持 UI 简洁」的需求条目直接导致了编辑入口缺失。后续设计「条件渲染 UI 元素」时，必须额外验证「该元素隐藏后，用户是否还有其他路径完成对应操作」。

**教训：**
- **徽标/按钮等交互入口不应按「值是否默认」条件渲染**：当交互入口与值展示耦合时（如权重徽标既是展示也是编辑入口），应始终渲染入口，用视觉弱化（灰色/虚线/低透明度）区分默认与非默认状态，而非完全隐藏。
- **「保持 UI 简洁」的正确做法是「弱化」而非「隐藏」**：默认权重的 `×1.0` 徽标使用灰色 + 虚线边框 + 0.7 透明度，视觉上不抢眼但始终可见可点击，既保持了界面整洁感，又保留了操作入口。

---

## §7.26 移除 AssetGenerateModal 动态场景方案 UI 与逻辑（Spec: replace-dynamic-scene-with-prompt-gen / Task 6，2026-08-07）

**背景：**

`AssetGenerateModal.tsx` 原本通过 Spec `add-dynamic-scene-prompt-generation / Task 8` + `fix-asset-trait-and-scene-defects / Task 6+7` 引入了「动态场景方案」功能：在生成弹窗内提供 `<Select>` 下拉切换激活动态场景方案，方案中的 `clothing` / `pose` / `scene` 三组 tag 会替换提示词模板里的 `{clothing}` / `{pose}` / `{scene}` 占位符。

Spec `replace-dynamic-scene-with-prompt-gen` 决定将该功能整体移除（由「提示词生成面板」promptGenPanel 替代），Task 6 负责从 `AssetGenerateModal.tsx` 中清除所有动态场景相关的 UI、state、handler、store 订阅与 `buildSdOptions` 字段。

**移除内容清单：**

| 类别 | 移除项 | 原位置（移除前） |
| --- | --- | --- |
| store 订阅 | `dynamicScenePrompts` / `activeDynamicScenePromptId` / `applyDynamicScenePrompt` 三个字段订阅 + 相关注释 | `useCharacterTraitStore()` 解构 |
| state | `userScene` state 声明 + `@deprecated` JSDoc | 单次生成状态区 |
| useEffect | 「general 模式：userScene 变化时重新构建提示词」整个 effect | 紧随提示词初始化 effect 之后 |
| setter 调用 | 关闭弹窗重置 effect 中的 `setUserScene('')` | 重置状态 useEffect |
| `buildSdOptions` 字段读取 | `activeDynamicScheme` 查找 + `dynamicClothing` / `dynamicPose` / `dynamicScene` 变量声明 + illustration 模式兜底（`standing` / `simple_background`）+ userScene 回退注释 | `buildSdOptions` 函数顶部 |
| `buildSdOptions` 返回字段 | `dynamicClothing` / `dynamicPose` / `dynamicScene` 三个返回字段 + 相关注释 | `buildSdOptions` return 对象 |
| `buildSdOptions` 依赖数组 | `dynamicScenePrompts` / `activeDynamicScenePromptId` 两个依赖项 | `useCallback` deps |
| `handleSingleGenerate` 守卫 | general 模式无激活动态方案时的 `console.warn` 警告块 + 相关注释 | `handleSingleGenerate` 函数顶部校验区 |
| `handleSingleGenerate` 依赖 | `activeDynamicScenePromptId` 依赖项 | `useCallback` deps |
| `buildAssetPromptTemplate` 调用 | 入参从 `userScene` 改为 `''` 字面量（保留签名兼容，函数内部已不使用 `_userScene` 参数） | 提示词初始化 effect |
| UI | 动态场景方案 `<Select>` 下拉 + 标签 + 说明文字 + 整段 JSX 注释（含 allowClear 修复说明） | `renderParamsColumn` 顶部 |
| UI 文案 | general 模式 `idleDesc` 中的「在左侧选择动态场景方案（可选）」前缀 | `renderParamsColumn` 的 `idleDesc` |
| 函数注释 | `renderParamsColumn` JSDoc 中「动态场景下拉」描述 | `renderParamsColumn` 顶部注释 |
| 文件头注释 | general 模式描述中的「场景由动态场景方案下拉选择」 | 文件顶部 Spec 说明 |

**保留内容（不在本次移除范围）：**

- 「提示词生成面板」（`renderPromptGenPanel` / `handleGenerateTraitPrompts` / `handleApplyGeneratedTraits` 等）相关代码完整保留
- promptGenPanel 相关代码中描述视觉风格的「动态场景指令面板」引用注释（`视觉风格参考 AssetManagerModal 的「动态场景指令」面板` 等）保留——这些是 promptGenPanel 的样式说明，不是动态场景功能本身
- 「携带角色特征」区域其他 UI 完整保留
- SDXL 权重徽标相关代码完整保留
- `buildAssetPromptTemplate` 函数签名中的 `_userScene` 参数保留（避免破坏调用方签名，函数内部已不使用）

**修改后 `buildSdOptions` 关键字段列表：**

```
endpoint, denoisingStrength, steps, cfgScale, sampler, scheduler, clipSkip,
adetailerEnabled, model, characterTraits, characterGenderTag, dynamicCamera,
[ADetailer 参数: adModel/adConfidence/adDenoisingStrength/adMaskBlur/
 adDilateErode/adInpaintOnlyMasked/adInpaintOnlyMaskedPadding/
 adUseInpaintWidthHeight/adInpaintWidth/adInpaintHeight/adUseSteps/adSteps/
 adUseCfgScale/adCfgScale/adUseSampler/adSampler/adScheduler/
 adNegativePrompt/adUseNoiseMultiplier/adNoiseMultiplier],
modelType, txt2imgWidth, txt2imgHeight, width, height, selectedLoras,
[Hires.fix 参数: hrFixEnabled/hrUpscaler/hrSteps/hrScale/hrDenoisingStrength/
 hrPrompt/hrNegativePrompt/hrCfg/hrSamplerName/hrScheduler],
img2imgExtraNoise, initialNoiseMultiplier, img2imgHiresMode
```

依赖数组：`[sdConfig, enabledTraitTexts, effectiveTraits, characterLoras, selectedSize, selectedCameraAngle, mode]`

**涉及文件：**

| 文件 | 改动 |
| --- | --- |
| `src/renderer/components/Character/CharacterDialogueChat/AssetGenerateModal.tsx` | 移除动态场景方案 UI / state / store 订阅 / `buildSdOptions` 字段 / `handleSingleGenerate` 守卫；`buildAssetPromptTemplate` 调用入参改为空字符串；新增两段「移除动态场景字段」与「移除动态场景依赖」说明注释（Spec: replace-dynamic-scene-with-prompt-gen / Task 6） |

**注意事项：**

- ⚠️ **不运行 `tsc` / `npm run typecheck`**：其他并行子任务也在修改文件（如 PromptBuilder 模板占位符清理、sdGenerationService.applyTraitsAndLora 字段读取清理、characterTraitStore 类型定义清理），本任务完成后由集成阶段统一类型检查
- ⚠️ **`buildAssetPromptTemplate` 签名暂未收缩**：第三个参数 `_userScene` 在 PromptBuilder.ts 中保留（标记 `@deprecated`），由后续子任务统一清理调用方与函数签名
- ⚠️ **提示词模板中的 `{clothing}` / `{pose}` / `{scene}` 占位符由其他子任务清理**：本任务仅移除 AssetGenerateModal 侧的动态场景功能，模板与 `applyTraitsAndLora` 的占位符替换逻辑由 PromptBuilder / sdGenerationService 子任务统一处理（移除占位符后 `applyTraitsAndLora` 的字面替换为 no-op，无副作用）

---

## §7.27 移除动态场景方案并以提示词生成面板替代（Spec: replace-dynamic-scene-with-prompt-gen / Task 1-10，2026-08-07）

**背景：**

用户反馈证实 AI 素材生成页面的「提示词生成」面板（动态指令生成 + L0-L5 审计 + 自动拼接）已能完全替代「动态场景方案」功能。动态场景方案引入了独立的类型定义、store action、IPC 通道、service 方法、UI 面板及 prompt 模板占位符（`{clothing}` / `{pose}` / `{scene}`），增加了系统复杂度却不再提供额外价值。Spec `replace-dynamic-scene-with-prompt-gen` 决定将该功能整体移除，统一通过 `{traits}` 占位符 + 分类特征体系（`clothing` / `pose` / `background` 等 `categoryId`）实现等效甚至更灵活的提示词组织能力；同时在 `CharacterTraitTabContent`（角色特征页签）添加与 AI 素材生成页面功能完全一致的提示词生成面板。

本节为该 spec 的整体移除/新增记录，Task 6（`AssetGenerateModal` 动态场景 UI 移除）的详细清单见 §7.26。

**变更清单（按文件列出移除/新增内容）：**

| # | 文件 | 改动类型 | 说明 |
| --- | --- | --- | --- |
| 1 | `src/shared/types/characterTrait.types.ts` | 移除 | `DynamicScenePrompt` 接口、`CharacterTraitManifestV2.dynamicScenePrompts` / `activeDynamicScenePromptId` 字段及相关 JSDoc |
| 2 | `src/main/services/characterTraitService.ts` | 移除 | `loadTraitData` / `saveTraitData` / `createEmptyTraitData` / v1→v2 迁移路径中对 `dynamicScenePrompts` / `activeDynamicScenePromptId` 的读写与兜底逻辑；`DynamicScenePrompt` import |
| 3 | `src/renderer/stores/characterTraitStore.ts` | 移除 | `dynamicScenePrompts` / `activeDynamicScenePromptId` state + `DynamicScenePrompt` import + 初始值 / `loadTraits` 兜底 / `saveTraits` 构造与回滚中的动态场景字段 / `reset` 重置逻辑 + 4 个 action（`saveDynamicScenePrompt` / `applyDynamicScenePrompt` / `updateDynamicScenePrompt` / `deleteDynamicScenePrompt`）的接口声明与实现 |
| 4 | `src/main/services/characterTraitAIService.ts` | 移除 | `GenerateDynamicScenePromptsParams` / `GenerateDynamicScenePromptsResult` 接口、`DYNAMIC_SCENE_SYSTEM_PROMPT` 常量、`generateDynamicScenePrompts` 方法、`buildDynamicSceneUserMessage` / `parseDynamicSceneResponse` / `normalizeDynamicSceneTagsWithTranslations` 辅助方法（约 700 行）；清理 `applyTagAudit` / `generateTraitPrompts` / `generateCharacterTraits` JSDoc 中的动态场景对比说明 |
| 5 | `src/main/ipc/handlers/characterTraitAIHandlers.ts` | 移除 | `ai:generateDynamicScenePrompts` handler 注册及 `GenerateDynamicScenePromptsParams` import |
| 6 | `src/main/ipc/index.ts` | 移除 | 动态场景 IPC 通道注册注释 |
| 7 | `src/main/preload.ts` | 移除 | `generateDynamicScenePrompts` 方法 |
| 8 | `src/renderer/types/electron.d.ts` | 移除 | `generateDynamicScenePrompts` 类型定义及动态场景返回类型（含 `dimension` 字段的 ragDebug 类型） |
| 9 | `src/main/services/sdGenerationService.ts` | 移除 | `SDGenerationOptions.dynamicClothing` / `dynamicPose` / `dynamicScene` 字段及 JSDoc；`applyTraitsAndLora` 中 `clothingStr` / `poseStr` / `sceneStr` 变量及 `{clothing}` / `{pose}` / `{scene}` 占位符替换逻辑 |
| 10 | `src/renderer/components/Character/CharacterDialogueChat/PromptBuilder.ts` | 简化 | 立绘模板从 `'{camera}, {pose}, {traits}, {clothing}, {scene}, high quality, best quality, masterpiece'` 简化为 `'{camera}, {traits}, high quality, best quality, masterpiece'`；一般图像模板从 `'{traits}, {clothing}, {pose}, {scene}, {camera}, high quality, best quality'` 简化为 `'{traits}, {camera}, high quality, best quality'`；移除 `userScene` 参数及 fallback 逻辑；更新 JSDoc |
| 11 | `src/renderer/components/Character/CharacterDialogueChat/AssetGenerateModal.tsx` | 移除 | 动态场景方案下拉 UI、`buildSdOptions` 中 `dynamicClothing` / `dynamicPose` / `dynamicScene` 字段读取与透传、`userScene` state、相关 handler 与 useEffect（详见 §7.26） |
| 12 | `src/renderer/components/Character/CharacterDialogueChat/AssetManagerModal.tsx` | 移除 + 新增 | 移除动态场景指令面板（约 279 行：JSX + state + handlers + `renderDynamicSceneTagList` + `useEffect` + store 订阅 + `handleClearAll` 清空逻辑）；**新增** 提示词生成面板（约 460 行）：复用 `AssetGenerateModal.renderPromptGenPanel` 实现，紫色渐变主题（`rgba(139, 92, 246, 0.05)` 背景 + `rgba(139, 92, 246, 0.2)` 边框），调用 `ai:generateTraitPrompts` IPC，应用结果调 `characterTraitStore.setTraits` 合并到现有特征列表 |
| 13 | `src/renderer/components/Character/CharacterDialogueChat/RagQualityReport.tsx` | 移除 | `dimension` 字段类型定义、`DIMENSION_LABELS` 常量、维度徽标渲染逻辑（动态场景审计专用，已无来源填充） |

**重点标记：**

- ⚠️ **Windows 环境下 Edit 工具对 CRLF 文件的多行块匹配可能失败**：`AssetManagerModal.tsx` 使用 CRLF 换行符（4418 CRLF / 1 LF），Edit 工具在匹配多行 `old_string` 时因 LF/CRLF 不一致导致 "String to replace not found" 失败（单行 Edit 工作正常），部分场景下甚至会「报告成功但未持久化」。**判断方法**：Edit 后立即 Read 验证。**解决方案**：Node.js 脚本按行数组操作 + `\r\n` 重新拼接，或 PowerShell `[System.IO.File]::WriteAllText` 直接写入；不要依赖 Edit 工具做多行 CRLF 文件的大块替换。
- ⚠️ **`setTraits` 的 MERGE 策略**：`characterTraitStore.setTraits` 非简单替换，而是「保留已分类项 / 替换未分类项 / 追加新项」的合并语义。为安全追加新特征，需传入完整列表 `[...traits, ...newTraits]`，否则可能误覆盖既有分类特征。
- ⚠️ **`setTraits` path 4 为新项重新生成 id，无法预知**：`setTraits` 内部对新增项（path 4：传入了原列表不存在的 text）会调用 `genTraitId()` 重新生成 id，调用方无法预知新 id。**解决方案**：通过 `useCharacterTraitStore.getState().traits` 在 `setTraits` 后 diff 出实际写入的新 id（对比 setTraits 前后 traits 数组的 id 集合差集），填入 `appliedPromptTraitIds` Set 以驱动「✨ 新增」徽标。
- ⚠️ **功能替代迁移需同步清理全链路**：本 spec 涉及 13 个源文件的全量清理，遗漏任一环节会导致悬空引用或 TS 编译错误。完整链路包括：prompt 模板占位符 + SD 生成管线字段 + IPC 通道 + preload + electron.d.ts + store action + service 方法 + UI 面板 + 质检组件字段。

**验证结果：**

- 全局 `rg` 搜索零动态场景引用残留（`动态场景` / `dynamicScene` / `DynamicScene` / `generateDynamicScenePrompts` 等关键词在源码中无命中，仅文档与 FIX_RECORDS 历史记录中有保留）
- TypeScript 编译零动态场景相关错误（`npx tsc --noEmit` 无新增错误）
- `CharacterTraitTabContent` 提示词生成面板与 `AssetGenerateModal.renderPromptGenPanel` 行为一致：输入 → 生成 → 应用 / 放弃 → RAG 质检报告展示

**涉及文件：**

详见上方「变更清单」表（13 个源文件）。

**注意事项：**

- 旧数据文件（含 `dynamicScenePrompts`）加载时不崩溃：`JSON.parse` 自动忽略未知字段，`loadTraitData` 不再显式处理这两个字段，下次 `saveTraitData` 自然丢弃（manifest 不再包含这两个字段）
- 用户如需保留原动态场景方案中的 tag，可手动将其作为特征添加到对应分类（`clothing` / `pose` / `background`）
- prompt 模板的 `{clothing}` / `{pose}` / `{scene}` 占位符移除后，原通过动态场景注入的内容改由 `{traits}` 统一携带
- `buildAssetPromptTemplate` 函数签名中的 `_userScene` 参数已移除（Task 5 统一清理调用方与函数签名）

---

### §7.25 Furry/拟人生物面部识别 ADetailer 模型扩展（2026-08-07）

**问题背景：** 当前系统图生图 YOLO 检测模型在识别人类面部时效果良好，但在识别动物和兽人等类人生物（furry/kemono/anthro）时表现不佳。原因：项目预设的 9 个检测模型（`face_yolov8n.pt` 等）全部针对人类面部训练，对兽人特有的吻部、长耳、毛发等结构识别率低。

**研究结论：** 目前**没有公开的、专门为 furry/拟人生物面部识别训练的 ADetailer YOLO 模型**（学术界 Fursee 论文有相关研究但不公开 .pt 文件）。但存在 3 类可行方案，用户决策全部实施：

| 方案 | 模型文件 | 类型 | 精度/特点 | 来源 |
|------|----------|------|-----------|------|
| A（推荐） | `yolov8x-worldv2.pt` | YOLO-World 开放词汇 | 零样本检测任意类别（配合 `ad_model_classes` 文本提示） | ADetailer-Neo 预装 |
| B | `Anzhc HeadHair seg y8m.pt` | 头部+毛发分割 | mAP50=0.867，兽人头部覆盖更全（含耳朵/毛发） | [Anzhc/Anzhcs_YOLOs](https://huggingface.co/Anzhc/Anzhcs_YOLOs) |
| C | `Anzhc Face seg 640 v4 y11n.pt` | 高精度插画人脸 | mAP50=0.835（远超 `face_yolov8n.pt` 的 0.660） | 同上 |

**关键技术证据：**
- ADetailer-Neo 已预装 `yolov8x-worldv2.pt`，且 `args.py` 已支持 `ad_model_classes` 字段（从 [Haoming02/ADetailer-Neo issue #9](https://github.com/Haoming02/ADetailer-Neo/issues/9) 错误堆栈证实：`classes=args.ad_model_classes` 透传给 `ultralytics_predict`）。
- `ad_model_classes` 是 `ADetailerArgs` 的合法字段，不会触发 pydantic `extra="forbid"` 报错。
- YOLO-World 的 `classes` 参数仅在模型为 YOLO-World 实例时被消费，非 YOLO-World 模型忽略此字段。

**全链路改动清单（6 个源文件）：**

| # | 文件 | 改动 |
|---|------|------|
| 1 | `src/renderer/types/setting.ts` | `SDWebuiConfig` 接口新增 `adModelClasses?: string` 字段（`adModel` 后） |
| 2 | `src/main/services/sdGenerationService.ts` | `SDGenerateParams` 接口新增 `adModelClasses?: string`；adArgs 构建处条件透传 `ad_model_classes`（仅 YOLO-World 模型 + 非空时） |
| 3 | `src/shared/settings.ts` | `defaultSetting.sdWebui` 新增 `adModelClasses: ''` |
| 4 | `src/renderer/components/Settings/SDWebuiSettings.tsx` | `DEFAULT_SD_WEBUI_CONFIG` 新增 `adModelClasses: ''`；`ADETAILER_MODEL_OPTIONS` 新增 3 项；`Form.useWatch('adModel')` 条件渲染「检测类别」TextArea + Anzhc 下载提示 Alert |
| 5 | `src/renderer/components/Character/CharacterDialogueChat/ExpressionGenerateModal.tsx` | `DEFAULT_SD_CONFIG` 新增 `adModelClasses: ''`；参数构建处透传 `adModelClasses: sdConfig.adModelClasses` |
| 6 | `src/renderer/components/Character/CharacterDialogueChat/AssetGenerateModal.tsx` | 同上 |

**条件透传逻辑（sdGenerationService.ts）：**
```ts
const isYoloWorldModel = adModel.toLowerCase().includes('world');
const adModelClassesValue = options.adModelClasses?.trim();
if (isYoloWorldModel && adModelClassesValue) {
  adArgs.ad_model_classes = adModelClassesValue;
}
```
- YOLO-World 识别：`adModel.toLowerCase().includes('world')`，覆盖 `yolov8x-worldv2.pt` / `yolov8s-world.pt` 等所有变体。
- 仅 `_world` 模型 + 非空时透传，避免对非 `_world` 模型传递无效字段。

**UI 条件渲染（SDWebuiSettings.tsx）：**
- `Form.useWatch('adModel')` 监听当前检测模型选择。
- `isYoloWorldModel`（文件名含 "world"）→ 显示「检测类别（ad_model_classes）」TextArea，placeholder 为 `furry face, anthro head, animal head, kemono face`。
- `isAnzhcModel`（文件名以 "Anzhc" 开头）→ 显示下载提示 Alert，引导用户从 HuggingFace 下载模型放入 `models/adetailer/` 目录。

**注意事项：**
- Anzhc 模型未下载时 ADetailer-Neo 会报「模型未找到」错误，下载提示 Alert 已显式引导。
- YOLO-World 零样本检测精度可能不如专门训练的模型，用户可通过降低 `ad_confidence`（默认 0.3，可降至 0.2）提升召回率。
- `adModelClasses` 默认空字符串（`''`），空=使用 YOLO-World 模型默认 COCO 80 类，不影响现有 face/hand/person 模型行为。

**验证结果：**
- TypeScript 编译零新增错误（`npx tsc --noEmit` 对 6 个修改文件无报错，仅有项目既存的无关错误）。
- 4 处 DEFAULT_CONFIG 均已同步 `adModelClasses: ''`，旧配置缺失字段时由 DEFAULT 兜底，不会 undefined。
- 检测模型下拉现有 12 个选项（原 9 + 新增 3）。

#### ⚠️ 重点 Bug — AutoComplete filterOption 导致下拉只显示 1 个选项（用户反复提示才定位）

**现象：** 代码已新增 3 个模型（共 12 个选项），Vite HMR 也确认返回最新代码，但用户反馈"下拉还是只有一个 face_yolov8n.pt，没有其他的"。用户第一次反馈时误判为「位置不对 / HMR 未生效」，给了导航指引后用户第二次反馈仍然只显示 1 个，才定位到真正根因。

**根因：** `AutoComplete` 组件的 `filterOption` 使用输入框当前值（`inputValue`）过滤选项。当输入框有默认值 `face_yolov8n.pt`（`DEFAULT_SD_WEBUI_CONFIG.adModel`）时，`filterOption` 检查每个选项的 `value` 是否 `.includes('face_yolov8n.pt')`——只有 `face_yolov8n.pt` 本身包含该子串，其余 11 个选项均不匹配，导致下拉只显示 1 项。

**修复方案：** 分离「输入框值」与「搜索词」，禁用 AutoComplete 内部过滤，改由独立的 `adModelSearch` state + `filteredAdModelOptions` useMemo 手动过滤：
```tsx
// 新增 state：追踪用户主动输入的搜索词（与 Form 输入框值分离）
const [adModelSearch, setAdModelSearch] = useState('');
const filteredAdModelOptions = useMemo(() => {
  const search = adModelSearch.toLowerCase().trim();
  if (!search) return ADETAILER_MODEL_OPTIONS;  // 空搜索=显示全部
  return ADETAILER_MODEL_OPTIONS.filter((opt) =>
    (opt.value ?? '').toLowerCase().includes(search),
  );
}, [adModelSearch]);

// AutoComplete 改为：
<AutoComplete
  options={filteredAdModelOptions}     // 手动过滤后的选项
  onSearch={setAdModelSearch}           // 用户输入时更新搜索词
  onFocus={() => setAdModelSearch('')}  // 聚焦时清空搜索词=显示全部
  filterOption={false}                  // 禁用内部过滤（避免用 inputValue 二次过滤）
  allowClear
/>
```

**经验教训：**
- ⚠️ **AutoComplete 的 filterOption 用 inputValue 过滤是常见陷阱**：当 Form 字段有默认值时，filterOption 会用默认值过滤，导致下拉只显示 1 个匹配项。这与 Select 组件不同（Select 点击即显示全部，不依赖输入框值过滤）。
- ⚠️ **用户反馈"功能无效"时，不要只考虑「位置不对 / 未刷新」**：第一轮反馈后给了导航指引，但用户第二轮仍反馈同样问题，才转向检查组件本身的运行时行为。排查 UI 问题时，如果代码确认正确 + HMR 确认生效，应立即检查组件的交互行为（filterOption / dropdownRender / open 等配置）。
- ⚠️ **AutoComplete vs Select 的行为差异**：AutoComplete 设计为「输入时过滤」，Select 设计为「点击展示全部」。当 AutoComplete 有默认值时，需要在 onFocus 时清空搜索词才能模拟 Select 的「点击展示全部」行为。

---

## §7.28 对话图片气泡 IPC 进度事件 ai:traitPromptProgress（Spec: enhance-conversation-image-bubble / Task 3，2026-08-09）

### 背景

Spec `enhance-conversation-image-bubble` 将对话图片从独立消息重构为文本消息的嵌套附属内容（`imageAttachment`），并要求生成过程显示分阶段状态（「标签生成中…」「标签审核中…」「图片生成中…」）。Task 3 负责主进程在 `ai:generateTraitPrompts` IPC 调用期间向渲染进程推送进度事件 `ai:traitPromptProgress`，使渲染进程能在 LLM 生成完成、进入 L0-L5 审核时切换占位文案。

### 修改文件

- `src/main/ipc/handlers/characterTraitAIHandlers.ts` — 在 `ai:generateTraitPrompts` handler 内新增 `event.sender.send('ai:traitPromptProgress', { phase })` 进度推送；handler 回调签名由 `_event` 改为 `event`（需使用 sender）；文件头注释补充「事件通道」段落
- `src/main/preload.ts` — `ai:` 命名空间内追加 `onTraitPromptProgress` / `offTraitPromptProgress` 两个方法（订阅/取消模式参照 `sd.onGenerationProgress` / `sd.removeProgressListeners`）
- `src/renderer/types/electron.d.ts` — `ai:` 接口内追加 `onTraitPromptProgress` / `offTraitPromptProgress` 类型声明

### 设计决策

#### 决策 1：采用方案 (b) 最小改动（service 不支持进度回调）

`characterTraitAIService.generateTraitPrompts` 内部串行执行「LLM 生成 tag」+「`applyTagAudit`（L0-L5 审核）」两阶段，且不提供进度回调入参。handler 无法在两阶段之间精确插入事件。Spec Task 3.1 明确给出两个备选方案，本次选择方案 (b)：

- 调用 service 前推送 `{ phase: 'tag-generating' }`
- service 返回后、`return` 前推送 `{ phase: 'tag-auditing' }`

这样渲染进程在 service 调用期间显示「标签生成中…」，service 返回后到发起 `sd.generateTxt2Img` 之间显示「标签审核中…」（此时实际审核已在 service 内完成，但渲染进程仍能感知「LLM 调用已返回，进入后处理」的阶段切换）。`'image-generating'` 阶段由渲染进程本地设置（调用 `sd.generateTxt2Img` 前），非主进程推送。

未选择方案 (a)（向 service 传入回调/event sender）的原因：会打破 service「永不抛异常 + 单一返回值」的现有契约，改动面大且与 `generateCharacterTraits` 等同族方法签名不一致。方案 (b) 仅改 handler，service 零改动。

#### 决策 2：phase 命名使用 'tag-auditing' 而非 spec 场景文字的 'auditing'

⚠️ **重点标记 — spec 内部命名不一致**：`spec.md` 的「标签审核阶段」Scenario 文字写 `{ phase: 'auditing' }`，但同 spec 的 `ImageAttachment.phase` 类型（Task 1.2）、`preload.ts` 类型契约（Task 3.2）、Task 9.2 消费端（`onTraitPromptProgress` 事件接收 `phase='tag-auditing'`）均使用 `'tag-auditing'`。若主进程推送 `'auditing'`，渲染进程 `phase === 'tag-auditing'` 判断永不命中，端到端功能失效。**决策：以类型契约为准，统一使用 `'tag-auditing'`**，并在 handler 注释中说明 spec 文字的简写关系。

### ⚠️ 重点标记 — Spec 文件路径与实际不符

Spec `spec.md` Impact 段及 Task 3.1 均写「修改 `src/main/ipc/handlers/aiHandlers.ts` 的 `ai:generateTraitPrompts` handler」，但 `ai:generateTraitPrompts` 实际注册在 `src/main/ipc/handlers/characterTraitAIHandlers.ts`（`aiHandlers.ts` 仅含 `ai:request` / `ai:cancel` / `ai:listModels` / `ai:probeCapabilities` 等低层通用通道）。本次按实际位置修改 `characterTraitAIHandlers.ts`。后续维护者注意：`ai:` 命名空间下的高层业务通道（`generateCharacterTraits` / `recognizeImageTraits` / `generateTraitPrompts`）均在此文件，`aiHandlers.ts` 是低层 HTTP 转发器。

### 实现细节

handler 内抽取 `sendProgress(phase)` 内联辅助函数，封装：
1. `event.sender.isDestroyed()` 守卫（参照 `aiHandlers.ts:399` 流式转发的渲染进程销毁检查），避免渲染进程已关闭时 `send` 抛异常
2. try/catch 兜底，发送失败仅 `console.warn` 不影响主流程
3. phase 参数类型为 `'tag-generating' | 'tag-auditing' | 'image-generating'` 联合，与 preload / electron.d.ts 类型契约一致

进度事件推送与 `return result` 完全独立：即使两次 `sendProgress` 均失败，handler 仍正常返回 service 结果；错误处理保留原有 try/catch（catch 返回 `{ success: false, error }`），进度事件不在 catch 分支推送（失败时渲染进程由 IPC 返回值感知错误）。

---

## § 推理模型兼容性修复（2026-08-10）

### ⚠️【重点标记】DeepSeek-V4-Pro / x-deepseek-reasoner 推理模型不输出 <<<EXPRESSION>>> 和 <<<SUGGESTED_OPTIONS>>> 标签

**现象：**
- 使用 crec 引擎（`x-deepseek-reasoner` 模型）或直连 DeepSeek V4 Pro 时，AI 回复中不包含 `<<<EXPRESSION>>>` 和 `<<<SUGGESTED_OPTIONS>>>` 标签
- 日志中原始响应数据也确认标签未返回
- 本地模型（如 `sprinkle-gemma-4-31b`）正常返回所有标签

**排查过程：**
1. 初始假设：推理模型使用 `delta.reasoning_content` 字段而非 `delta.content`，导致 SSE 解析丢失内容 —— **错误**
2. 实际测试（使用 crec 引擎配置）：
   - 非流式 + 简化提示词：标签全部正常返回 ✅
   - 流式 + 简化提示词：标签全部正常返回 ✅，所有内容在 `content` 字段中（`reasoning_content` 为空）
   - 流式 + 长系统提示词 + 多轮对话：**标签未返回** ❌，`finish_reason: "stop"`
   - 流式 + 长系统提示词 + 单轮对话：**标签未返回** ❌，`finish_reason: "stop"`
   - 流式 + 长系统提示词 + 单轮对话 + **末尾标签提醒**：标签全部返回 ✅

**根因：**
推理模型（`x-deepseek-reasoner` / `deepseek-v4-pro`）在长系统提示词（2600+ 字符）场景下，生成 `PMID` 思考内容 + 故事正文后倾向于**主动停止**（`finish_reason: "stop"`），不输出末尾的结构化标签。这不是 token 限制问题，也不是 `reasoning_content` vs `content` 字段问题。

**关键发现：**
- 推理模型的思考过程以 `PMID...nascitu` 标签包裹，混在 `content` 字段中（非独立 `reasoning_content` 字段）
- `PMID` 标签剥离已由 `ThinkTagPlugin`（priority 100）和 `stripThinkingTags()` 处理，无需额外修改
- 在消息列表末尾注入简短提醒消息可显著提升标签返回率
- 推理模型的标签输出是**非确定性**的 — 有时输出有时不输出，提醒消息起到强化作用

**修复方案：**
1. **注入标签输出提醒**（`CharacterDialogueChat.hooks.ts`）：
   - ⚠️ **第一版方案（失败）**：向消息列表末尾追加 `role: 'system'` 消息 — 被 `ChatEngine.sanitizeChatHistory()` 过滤（line 424: `if (msg.role === 'system') continue;`），提醒从未发送到 API
   - **最终方案**：将标签提醒追加到最后一条 `role: 'user'` 消息的内容末尾（类似异步整理模式的做法），不会被 `sanitizeChatHistory` 过滤
   - 提醒内容：`\n\n【系统提醒】请在回复正文末尾严格按格式输出 <<<EXPRESSION>>>情绪键名<<<END_EXPRESSION>>> 标签。`
   - 辅助模式开启时追加：`并在表情标签之前输出 <<<SUGGESTED_OPTIONS>>> 选项块（3个选项，含 <<<END_OPTIONS>>> 结束标记）。`
   - 仅对 `promptType === 'dialogue'` 注入（续写/用户回复/润色不需要）

2. **`PMID` 标签剥离**：已由现有 `ThinkTagPlugin` 和 `stripThinkingTags()` 处理，无需额外修改

**修改文件：**
- `src/renderer/components/Character/CharacterDialogueChat/CharacterDialogueChat.hooks.ts` — 在 `requestAIResponse` 中将标签提醒追加到末尾 user 消息

### ⚠️【重点标记】ai-handler 日志过大导致后续日志不记录

**现象：**
- `ai-handler` 日志在记录某些请求的"流式响应原始数据"后，后续请求的日志不再出现在同一日志文件中
- 原始数据日志可达 200KB+（推理模型的 SSE 响应包含大量 `PMID` 思考内容 chunk）

**根因：**
`aiHandlers.ts` 中 `logger.info` 将完整 `accumulatedData`（可达 200KB+）作为 `details` 参数传入，日志文件快速达到 10MB 限制并轮转到新文件，用户查看旧文件时看似"后续日志不记录"。同时 `details.split('\n').join('\n  ')` 对 200KB 字符串的操作增加性能开销。

**修复方案：**
- 原始数据日志限制为 50KB，超出部分截断并记录总长度
- `fullContent` 和 `parsedData` 日志字段限制为 20KB
- 错误路径中的 `rawData` 同样截断

**修改文件：**
- `src/main/ipc/handlers/aiHandlers.ts` — 添加 `MAX_RAW_LOG_SIZE`（50KB）、`MAX_CONTENT_LOG_SIZE`（20KB）和 `truncateForLog()` 函数，对原始数据日志和内容日志进行截断

### 验证状态

- `npx tsc --noEmit` 在三个修改文件中**零新增错误**：
  - `characterTraitAIHandlers.ts` — 零错误
  - `electron.d.ts` — 零错误
  - `preload.ts` — 仅 `preload.ts(46,43)` 一个预存在错误（`off` 方法的 `subscriptionMap.get` 返回 `Function | undefined` 与 `removeAllListeners` 参数类型不匹配，与本次修改无关，`git stash` 验证确认预存）
- ⚠️ **Edit 工具误删 `}>;` 行**：首次编辑 `electron.d.ts` 时，Edit 工具的字符串匹配误删了 `generateTraitPrompts` 返回类型 `Promise<{...}>` 的闭合符 `}>;`（导致 `tsc` 报 `TS1005: '>' expected`）。通过 `git diff` 定位后立即补回 `}>;`，复查 `tsc` 通过。根因：old_string 跨越多层 `};` 闭合，匹配时吞掉了 Promise 闭合行。**教训：编辑深度嵌套的类型声明时，old_string 应显式包含所有层级的闭合符，并在编辑后立即 `tsc` 验证。**

### 无 bug，无用户反复提示。

### 涉及文件

- `src/main/ipc/handlers/characterTraitAIHandlers.ts` — handler 内新增进度推送 + 文件头注释补充事件通道说明
- `src/main/preload.ts` — `ai:` 命名空间新增 `onTraitPromptProgress` / `offTraitPromptProgress`
- `src/renderer/types/electron.d.ts` — `ai:` 接口新增两个方法类型声明
- `docs/FIX_RECORDS.md` — 本节记录（§7.28）


## §7.29 角色特征「衣物配饰」分类拆分为「上装/下装/配饰/内衣」（Spec: split-clothing-trait-category，2026-08-09）

### 背景

用户需求：将「素材管理」中角色特征的「衣物配饰」（`clothing`）分类进一步拆分为 4 个细分类，提升 AI 自动归类的精度与裸体三视图过滤的准确性。

原 `clothing` 分类语义过宽（服装 + 配饰 + 眼镜 + 首饰），导致：
1. **AI 归类精度不足**：LLM 在生成特征时无法区分上装/下装/配饰/内衣，所有衣物相关 tag 均归入同一 `clothing` 分类，用户无法按需启用/禁用某子类。
2. **裸体三视图过滤不精确**：原逻辑过滤整个 `clothing` 分类（含配饰），但裸体图仍应保留眼镜/首饰等配饰（无衣物遮挡的饰物在裸体图中同样合理）。原方案一刀切移除所有 `clothing` tag 导致裸体图丢失配饰特征。

### 分类体系变更

`SYSTEM_TRAIT_CATEGORIES` 常量（`src/shared/types/characterTrait.types.ts`）：

| 旧分类 | 新分类（4 个细分类，order 3-6） | 语义 |
| --- | --- | --- |
| `clothing` 衣物配饰（order 3） | `top` 上装（order 3） | 上衣/衬衫/外套/连衣裙/校服等上身衣物（dress/school uniform 等连体衣物归入上装） |
| | `bottom` 下装（order 4） | 裤子/裙子/短裤等下身衣物 |
| | `accessories` 配饰（order 5） | 眼镜/缎带/首饰/帽子/围巾等装饰物 |
| | `underwear` 内衣（order 6） | 胸罩/内裤/内衣套装等贴身衣物 |

后续系统分类 `background` / `pose` / `expression` 的 order 顺延为 7 / 8 / 9（原 4 / 5 / 6）。系统分类总数由 7 → 10。

### 数据迁移策略

**用户决策：迁移到「未分类」**（用户手动重新归类到 top/bottom/accessories/underwear）。

`characterTraitService.loadTraitData` 加载 v2 数据时执行一次性迁移：
- 检测 `trait.categoryId === 'clothing'` 的特征 → 重写为 `UNCATEGORIZED_CATEGORY_ID`
- 迁移幂等：重写后下次保存落盘不再有 `clothing` id，再次加载 `migratedCount === 0`
- 迁移失败不阻塞特征加载（仅记录 warn 日志）
- 控制台输出迁移条数：`[CharacterTraitService] loadTraitData: migrated N legacy clothing traits -> uncategorized (clothing category split into top/bottom/accessories/underwear)`

### 裸体三视图过滤调整

**用户决策：过滤上装/下装/内衣**（保留配饰）。

`AssetGenerateModal.tsx` 中 `enabledTraitTexts` 派生层：
```ts
// 旧逻辑：过滤整个 clothing 分类
(!isNudeSlot || t.categoryId !== 'clothing')

// 新逻辑：仅过滤 top/bottom/underwear（保留 accessories）
const NUDE_FILTER_CATEGORY_IDS = new Set(['top', 'bottom', 'underwear']);
(!isNudeSlot || !NUDE_FILTER_CATEGORY_IDS.has(t.categoryId))
```

效果：裸体版三视图保留眼镜/首饰/帽子/围巾等配饰（裸体图中饰物仍合理），仅移除上装/下装/内衣 tag。

### AI 提示词同步升级

`characterTraitAIService.ts` 中 4 处提示词定义（`CHARACTER_TRAIT_SYSTEM_PROMPT` / `IMAGE_TRAIT_SYSTEM_PROMPT` 基线常量 + `buildDynamicTraitSystemPrompt` / `buildDynamicImageTraitSystemPrompt` 动态构建函数）：
- 系统分类语义说明：`clothing：衣物配饰（...）` → `top：上装（...）` + `bottom：下装（...）` + `accessories：配饰（...）` + `underwear：内衣（...）`
- 归类建议示例：`服饰/配饰 → clothing` → 拆为「上衣/外套/连衣裙 → top」「裤子/裙子 → bottom」「眼镜/首饰/帽子 → accessories」「胸罩/内裤 → underwear」
- 英文 prompt 示例同步：`top:school uniform, ...` / `bottom:jeans, ...` / `accessories:glasses, ...` / `underwear:bra, ...`

### 验证状态

- `npx tsc --noEmit` 在本次涉及源文件中**零新增错误**：
  - `src/shared/types/characterTrait.types.ts` — 零错误
  - `src/main/services/characterTraitService.ts` — 零错误
  - `src/main/services/characterTraitAIService.ts` — 零错误
  - `src/renderer/components/Character/CharacterDialogueChat/AssetGenerateModal.tsx` — 零错误
  - `src/renderer/components/Character/CharacterDialogueChat/AssetManagerModal.tsx` — 零错误
  - `src/main/services/assetService.ts` — 零错误
  - `src/renderer/stores/assetStore.ts` — 零错误
- 预存在错误（与本次修改无关）：`characterTraitAIService.test.ts` 中 22 个错误（`replacedBy` / `source` / `aiFallbackAttempted` / `aiFallbackCandidates` 属性不存在）为更早 Spec（fix-asset-trait-and-scene-defects Task 5.1）的测试代码遗留，`git stash` 验证确认预存
- ⚠️ **未做 Electron 集成测试**：分类拆分后 AI 实际归类行为（LLM 是否能正确输出 `top:` / `bottom:` 等前缀）依赖真实 LLM 调用，建议用户在「素材管理 → 角色特征 → 生成特征」流程中实际测试一轮验证

### 无 bug，无用户反复提示。

### 涉及文件

- `src/shared/types/characterTrait.types.ts` — `SYSTEM_TRAIT_CATEGORIES` 常量更新（移除 `clothing`，新增 `top`/`bottom`/`accessories`/`underwear`）；分类说明 JSDoc 同步
- `src/main/services/characterTraitService.ts` — `loadTraitData` 新增 `clothing → uncategorized` 迁移逻辑
- `src/main/services/characterTraitAIService.ts` — 4 处提示词（2 个基线常量 + 2 个动态构建函数）的分类描述与示例更新
- `src/renderer/components/Character/CharacterDialogueChat/AssetGenerateModal.tsx` — 裸体过滤逻辑从 `!== 'clothing'` 改为 `!NUDE_FILTER_CATEGORY_IDS.has(categoryId)`（集合 `['top', 'bottom', 'underwear']`）
- `src/renderer/components/Character/CharacterDialogueChat/AssetManagerModal.tsx` — 裸体版三视图面板说明文案更新（用户可见）+ 注释同步
- `src/main/services/assetService.ts` — 三视图槽位注释同步（裸体变体过滤上装/下装/内衣，配饰保留）
- `src/renderer/stores/assetStore.ts` — `ThreeViewSlot` 类型注释同步
- `CODE_WIKI.md` — 「AI 生成特征自动归类」章节系统分类体系描述更新（7 → 10 个分类）；分类列表顺序同步；裸体过滤同模式说明同步
- `docs/FIX_RECORDS.md` — 本节记录（§7.29）
- `CHANGELOG.md` — 新增分类拆分条目

---

## §7.30 旧图片消息迁移为 imageAttachment 附属字段（Spec: enhance-conversation-image-bubble / Task 2，2026-08-09）

### 背景

Spec `enhance-conversation-image-bubble` 将对话图片从独立消息（`isImageMessage=true` + `generatedImage=assetId`）重构为父文本消息的嵌套附属字段 `imageAttachment`（Task 1 已完成类型定义）。Task 2 负责旧数据迁移：在聊天记录加载时，将历史独立图片消息自动转换为父 assistant 文本消息的 `imageAttachment`，并持久化迁移结果，使旧数据无缝升级为新数据模型。

### 修改文件

- `src/renderer/components/Character/CharacterDialogueChat/CharacterDialogueChat.hooks.ts` — 新增导出纯函数 `migrateLegacyImageMessages`（L104-186）；在 `loadChatHistory` 加载分支调用迁移（L591-608）
- `src/renderer/components/Character/CharacterDialogueChat/__tests__/migrateLegacyImageMessages.test.ts` — 新建单元测试（13 用例，覆盖 6 个核心场景 + 综合场景）

### 设计决策

#### 决策 1：「前一条」语义 = 原列表中紧邻的前一条消息（非运行时跟踪的最新 assistant）

Spec 同时给出两条规则：「遍历时维护'上一条 assistant 非图片消息'的索引」与「若前一条非 assistant 或不存在，跳过迁移保留原样」。两者存在张力：

- 解释 (a)：检查原列表中**紧邻的前一条**消息（`messages[i-1]`）。若是 assistant 非图片消息 → 迁移；否则跳过。
- 解释 (b)：维护运行时「最近一条 assistant 非图片消息」索引，遇到图片消息即尝试挂到该父消息（无论是否紧邻）。

**选择解释 (a)**，依据：
1. Spec 文字「若前一条非 assistant」中「前一条」最自然的读法是「紧邻前一条」；若为解释 (b)，spec 应写「若未找到前一条 assistant 非图片消息」。
2. Task 2.4 测试用例 3 描述「[文本, 图片1, 图片2] → 第二个图片消息无前驱 assistant 文本（因前一条是图片消息）」明确指出图片2 的「前一条」是图片1（原列表紧邻），而非运行时跟踪的文本消息。仅解释 (a) 满足此描述。
3. 解释 (a) 行为可预测、可推理；解释 (b) 在连续图片场景会把图片2 挂到已有 imageAttachment 的文本上触发幂等丢弃，导致图片2 数据丢失，与「不丢失数据」原则冲突。

「维护索引」的实现意义：用于在结果数组 `result` 中快速定位父消息写入 `imageAttachment`（非图片消息始终被保留，故 `lastAssistantNonImageIdx` 指向的必然是紧邻前一条 assistant 非图片消息的拷贝）。

#### 决策 2：幂等场景「直接移除」而非「保留」

Spec 明确「若父消息已有 imageAttachment（幂等场景），跳过该图片消息（直接移除，不重复写入）」。即：当 `[文本(已含 imageAttachment), 图片]` 时，图片消息被移除（父消息的 imageAttachment 不被覆盖）。这与「无前驱兜底保留原样」不同——幂等是「父消息已有图片，冗余图片丢弃」，兜底是「找不到父消息，保留原样不丢失」。`migrated` 布尔值在两种「移除」场景均返回 `true`（列表发生了变更）。

#### 决策 3：纯函数不依赖 addLog，调用方记录孤立图片警告

`migrateLegacyImageMessages` 是纯函数（无副作用、不依赖 IPC/addLog），便于单元测试。无前驱 assistant 文本的孤立图片消息会被保留原样（SubTask 2.2 兜底）。调用方（`loadChatHistory`）在迁移后检测 `migratedMessages` 中仍存在的 `isImageMessage` 数量，若 > 0 则 `addLog(..., 'warn')` 记录警告，使用户可在日志中感知未迁移的孤立图片。

### 实现细节

#### `migrateLegacyImageMessages` 纯函数（L104-186）

```
输入: ChatMessage[]  →  输出: { messages: ChatMessage[], migrated: boolean }
```

遍历逻辑：
1. 维护 `result` 数组与 `lastAssistantNonImageIdx`（result 中最近 assistant 非图片消息索引，初始 -1）
2. 对每条消息：
   - 若 `isImageMessage=true`：
     - 检查原列表紧邻前一条 `messages[i-1]`：是否 `role==='assistant' && !isImageMessage`
     - 是 + `lastAssistantNonImageIdx >= 0`：
       - 父消息（`result[lastAssistantNonImageIdx]`）已有 `imageAttachment` → 幂等移除，`migrated=true`
       - 否则 → 构造 `imageAttachment`（currentAssetId=generatedImage, emotion=父emotion||'default', createdAt=图片timestamp, history=[{assetId,createdAt:图片timestamp}], currentIndex=0, status='idle'）写入父消息，移除图片消息，`migrated=true`
     - 否（无前驱/前驱非 assistant/前驱是图片消息）→ 保留图片消息原样（浅拷贝），不计入 `lastAssistantNonImageIdx`
   - 否（非图片消息）：浅拷贝追加到 `result`；若 `role==='assistant'` 更新 `lastAssistantNonImageIdx`
3. 返回 `{ messages: result, migrated }`

不变性保证：非图片消息通过 `{ ...msg }` 浅拷贝，`imageAttachment` 写入的是拷贝而非原消息；原数组元素与字段不被修改（测试用例 1「不修改原数组」显式验证）。

#### 加载时调用迁移（L591-608）

`loadChatHistory` 的 `savedChat.messages.length > 0` 分支：
1. `migrateLegacyImageMessages(loadedMessages)` 得到 `{ migratedMessages, didMigrate }`
2. `finalMessages = didMigrate ? migratedMessages : loadedMessages`（避免无迁移时返回新数组导致引用变化）
3. `dispatch(UPDATE_MESSAGES)` + `messagesRef.current = finalMessages`（无论是否迁移都执行，保持原有加载流程）
4. 仅 `didMigrate=true` 时：检测孤立图片数量并 warn 日志 → `await saveChatToStore(migratedMessages)` 持久化 → info 日志记录迁移完成

### 测试覆盖（13 用例全部通过）

| 用例 | 输入 | 期望输出 | migrated |
|------|------|----------|----------|
| 1 正常迁移 | [assistant文本, 图片] | [assistant文本(含imageAttachment)] | true |
| 1 imageAttachment 字段值 | 同上 | currentAssetId/emotion/createdAt/history/currentIndex/status 全部正确 | true |
| 1 emotion 回退 | [assistant文本(无emotion), 图片] | imageAttachment.emotion='default' | true |
| 1 不修改原数组 | 同上 | 原数组元素与字段不变 | true |
| 2 无前驱兜底 | [图片] | [图片]（不变） | false |
| 3 连续图片 | [文本, 图片1, 图片2] | [文本(含img1), 图片2保留] | true |
| 4 幂等(无图片消息) | [文本(已含imageAttachment)] | 不变 | false |
| 4 幂等(有图片消息) | [文本(已含imageAttachment), 图片] | [文本]（图片被移除，imageAttachment不被覆盖） | true |
| 5 空数组 | [] | [] | false |
| 6 前驱是 user | [user, 图片] | [user, 图片]（不变） | false |
| 6 前驱是 system | [system, 图片] | [system, 图片]（不变） | false |
| 综合 多轮混合 | [u,a,img,u,a,img] | [u,a(含img1),u,a(含img2)] | true |
| 综合 generatedImage 缺失 | [文本, 图片(无generatedImage)] | [文本(imageAttachment.currentAssetId='')] | true |

### 验证状态

- `npx vitest run migrateLegacyImageMessages.test.ts`：**13/13 通过**（Duration 1.45s）
- `npx vitest run responseLengthDiagnostics.test.ts`（同样从 hooks 文件导入）：**18/18 通过**（验证未破坏既有导入）
- `npx tsc --noEmit`：`CharacterDialogueChat.hooks.ts` 新增代码（L104-186, L591-608）**零新增类型错误**；既有错误（TS7006 implicit-any / TS6133 unused / TS2339 electron API 缺失等）均经核对为预存，与本次改动无关

### 无 bug，无用户反复提示。

### 涉及文件

- `src/renderer/components/Character/CharacterDialogueChat/CharacterDialogueChat.hooks.ts` — 新增 `migrateLegacyImageMessages` 纯函数 + `loadChatHistory` 调用迁移
- `src/renderer/components/Character/CharacterDialogueChat/__tests__/migrateLegacyImageMessages.test.ts` — 新建单元测试
- `docs/FIX_RECORDS.md` — 本节记录（§7.30）
- `CHANGELOG.md` — 新增 Task 2 迁移逻辑条目

## §7.31 hooks 新增 updateImageAttachment / deleteImageAttachment / navigateImageHistory（Spec: enhance-conversation-image-bubble / Task 10，2026-08-09）

### 背景

Spec `enhance-conversation-image-bubble` Task 1（类型定义）与 Task 2（旧数据迁移）已完成。Task 10 在 `useCharacterDialogueChat` hook 中新增三个图片附件管理函数，为 Task 9（handleGenerateImage 重构）提供阶段状态更新能力，为 Task 11（ChatMessageBubble props 接线）提供删除/导航回调实现。同时将旧 `addImageMessage` 标记为 `@deprecated`（保留函数体供向后兼容与迁移兜底）。

### 修改文件

- `src/renderer/components/Character/CharacterDialogueChat/CharacterDialogueChat.hooks.ts` — import 新增 `ImageAttachment` 类型；`addImageMessage` JSDoc 新增 `@deprecated` 标记（函数体未改）；新增三个 `useCallback` 函数（`updateImageAttachment` / `deleteImageAttachment` / `navigateImageHistory`）；hook 返回值对象新增三个函数导出

### 新增函数签名与行号

| 函数 | 行号 | 签名 | 用途 |
|------|------|------|------|
| `updateImageAttachment` | L2503-2532 | `(messageId: string, updater: (prev: ImageAttachment \| undefined) => ImageAttachment \| undefined) => Promise<void>` | 通用工具：读取消息 → 应用 updater → dispatch UPDATE_MESSAGES → saveChatToStore。供 Task 9 阶段状态更新与 deleteImageAttachment/navigateImageHistory 复用 |
| `deleteImageAttachment` | L2534-2567 | `(messageId: string) => Promise<void>` | 遍历 `imageAttachment.history` 逐个调用 `asset:delete` 删除磁盘 PNG + manifest，清空 imageAttachment 字段（设为 undefined） |
| `navigateImageHistory` | L2569-2590 | `(messageId: string, direction: 'prev' \| 'next') => Promise<void>` | 切换 currentIndex/currentAssetId，边界保护：越界时保持当前索引不变 |

返回值导出位置：L3013-3020（在 `addImageMessage` 之后、`clearChat` 之前）。

### 设计决策

#### 决策 1：`updateImageAttachment` 设为 async（即使内部无显式 await）

`updateImageAttachment` 函数体内部调用 `saveChatToStore`（async 函数），但不显式 `await`（与 `addImageMessage`/`editMessage` 等既有函数一致——`saveChatToStore` 内部有 `isSavingRef` 防抖锁，未 await 不会丢失保存）。函数标记为 `async` 是为了：
1. 与 `deleteImageAttachment`/`navigateImageHistory` 调用方约定一致（调用方 `await updateImageAttachment(...)` 确保状态更新完成后再继续）；
2. 未来若需在 dispatch 后追加异步逻辑（如 IPC 通知），无需改签名。

`deleteImageAttachment` 在调用 `updateImageAttachment` 清空字段前先 `for...of` 串行 `await asset.delete`（非并行），原因：避免磁盘 IO 高峰 + 单个失败不影响其他删除（catch 兜底）。

#### 决策 2：`deleteImageAttachment` 边界保护 — 无 imageAttachment 时仅 warn 不抛错

若 `messagesRef.current` 中找不到 `messageId` 或消息无 `imageAttachment`，仅记录 warn 日志并早返，不抛异常。原因：UI 删除按钮的二次确认与实际删除之间可能有状态延迟（如连续点击），早返保证幂等安全。

#### 决策 3：`navigateImageHistory` 边界保护 — 越界时保持当前索引

`newIndex < 0 || newIndex >= prev.history.length` 时直接返回 `prev`（不抛错、不修改）。原因：UI 层导航按钮已根据 `currentIndex===0` / `currentIndex===history.length-1` 禁用，此保护为防御性编程，避免竞态条件导致越界。

#### 决策 4：`addImageMessage` 仅加 @deprecated 不删函数体

Spec 要求「保留函数体供向后兼容与迁移兜底」。`addImageMessage` 是 `add-conversation-image-generation` spec 的实现，被 `CharacterDialogueChat.tsx` 引用（Task 11 接线时移除引用）。Task 10 仅添加 `@deprecated` JSDoc 标记，函数体完全保留，避免破坏既有引用导致编译错误。

### 验证状态

- `npx tsc --noEmit`：`CharacterDialogueChat.hooks.ts` 新增代码（L11 import、L2503-2590 三个函数、L3013-3020 返回值导出）**零新增类型错误**；既有错误（TS7006 implicit-any / TS6133 unused / TS2339 electron API chatVersion/stopOrganizing/failover/parseTableEdit 缺失等）均经核对为预存，与本次改动无关

### 无 bug，无用户反复提示。

### 涉及文件

- `src/renderer/components/Character/CharacterDialogueChat/CharacterDialogueChat.hooks.ts` — import 新增 ImageAttachment；addImageMessage @deprecated；新增三个 useCallback 函数；返回值导出三个函数
- `docs/FIX_RECORDS.md` — 本节记录（§7.31）
- `CHANGELOG.md` — 新增 Task 10 hooks 函数条目

## §7.32 sourceContext 接线 — executeImageGeneration 传入来源标识（Spec: enhance-conversation-image-auditability / Task 3，2026-08-09）

**Spec:** `.trae/specs/enhance-conversation-image-auditability/tasks.md` Task 3

**背景：** Task 1 已在 `SDGenerationOptions` 接口新增 `sourceContext?` 字段（`source: 'conversation' | 'asset-manager'` + `messageId?` / `characterCardId?` / `round?`），Task 2 已在 `sdGenerationService.generateTxt2Img` 内新增 `image-generation` logger 读取 `options.sourceContext` 落盘。本 Task 将 sourceContext 在渲染进程接线：对话图片生成标注 `'conversation'`，素材管理弹窗标注 `'asset-manager'`。

### 改动清单

1. **`src/renderer/components/Character/CharacterDialogueChat/buildSdOptions.ts`**（SubTask 3.2）
   - 新增 `import type { SDGenerationOptions } from '@main/services/sdGenerationService';`（type-only import，编译期擦除，不引入运行时主进程依赖）
   - `buildSdOptionsFromConfig` 函数新增显式返回类型标注 `: SDGenerationOptions`（原为推断类型，不含 `sourceContext` 字段，导致调用处 `sdOptions.sourceContext = ...` 赋值报 TS2339）

2. **`src/renderer/components/Character/CharacterDialogueChat/CharacterDialogueChat.tsx`**（SubTask 3.1，L543-549）
   - `executeImageGeneration` 内 `buildSdOptionsFromConfig` 调用后、`sd.generateTxt2Img` 调用前，向 `sdOptions.sourceContext` 赋值：`{ source: 'conversation', messageId, characterCardId: characterInfo.characterCardId, round: (parentMsg.imageAttachment?.history?.length || 0) + 1 }`
   - `round` 计算逻辑：当前 history 长度 + 1（1-based），首次生成时 history 为空 → round=1

3. **`src/renderer/components/Character/CharacterDialogueChat/AssetGenerateModal.tsx`**（SubTask 3.3，L1191-1195）
   - `sd.generateTxt2Img` 调用处的 `options` 从 `buildSdOptions()` 改为 `{ ...buildSdOptions(), sourceContext: { source: 'asset-manager' as const } }`
   - 使用 `as const` 确保 `source` 字段推断为字面量类型 `'asset-manager'` 而非 `string`，匹配 `SDGenerationOptions.sourceContext.source` 联合类型

### 设计决策

#### 决策 1：buildSdOptionsFromConfig 返回类型标注 vs 返回对象内加 sourceContext: undefined

spec 给出两个选项：(A) 在返回对象字面量中加 `sourceContext: undefined as SDGenerationOptions['sourceContext']`；(B) 加显式返回类型标注 `: SDGenerationOptions`（preferred）。

选择 B：返回类型标注更清晰，且 SDGenerationOptions 所有字段均为可选，`buildSdOptionsFromConfig` 返回的对象（子集）天然可赋值给 `SDGenerationOptions`，无需修改函数体内返回对象字面量。

#### 决策 2：渲染进程 import type 从 @main/services/sdGenerationService

项目惯例（electron.d.ts 注释）称「主进程类型不可直接被渲染进程引用」，但该约束针对运行时 import。`import type` 在 TypeScript 编译期被完全擦除，Vite/esbuild 不会生成运行时依赖，仅 tsc 需要解析路径（tsconfig `@main/*` 已映射）。因此 type-only import 安全可用，且比在 buildSdOptions.ts 内重复定义 SourceContext 类型更 DRY。

#### 决策 3：AssetGenerateModal 仅在 generateTxt2Img 调用处加 sourceContext

AssetGenerateModal 的 `buildSdOptions()` wrapper 被 3 处调用：`generateAllExpressions`（批量表情 img2img）、`generateExpression`（单表情 img2img）、`generateTxt2Img`（素材 txt2img）。spec 要求仅 `sd.generateTxt2Img` 调用方传入 sourceContext。选择在 generateTxt2Img 调用处 spread + override，而非修改 `buildSdOptions()` wrapper，精确匹配 spec 要求范围。`generateExpression` 路径的 logger 未在 Task 2 实现，暂不标注。

### 验证状态

- `npx tsc --noEmit` 过滤 `CharacterDialogueChat.ts` / `buildSdOptions` / `AssetGenerateModal` / `AssetManagerModal`：**零新增类型错误**
- 6 个 CharacterDialogueChat.tsx 报错（TS6133 unused imports + TS6192 + TS2345 null 参数）均为预存，与本次改动无关（改动行在 L534+，报错行在 L2-525）
- `buildSdOptions.ts` / `AssetGenerateModal.tsx` 零报错

### 无 bug，无用户反复提示。

### 涉及文件

- `src/renderer/components/Character/CharacterDialogueChat/buildSdOptions.ts` — import SDGenerationOptions；函数返回类型标注
- `src/renderer/components/Character/CharacterDialogueChat/CharacterDialogueChat.tsx` — executeImageGeneration 内 sdOptions.sourceContext 赋值（L543-549）
- `src/renderer/components/Character/CharacterDialogueChat/AssetGenerateModal.tsx` — generateTxt2Img 调用处 options spread + sourceContext override（L1191-1195）
- `docs/FIX_RECORDS.md` — 本节记录（§7.32）

---

## §7.33 sessionTraits store 扩展 — characterChatStore 新增临时特征状态与 actions（Spec: enhance-conversation-image-auditability / Task 7，2026-08-09）

### 背景

Task 1 已为 `CharacterTestChat` 接口新增 `sessionTraits?: CharacterTraitItem[]` 字段（会话级临时特征覆盖）。Task 7 负责让该字段真正可读写、可持久化、可在 ConfigPanel 中编辑。

`sessionTraits` 与 `characterTraitStore.traits` 的核心区别：
- `characterTraitStore.traits` → 持久化到角色卡 manifest（`traits.json`），跨会话共享
- `sessionTraits` → 仅随对话持久化（`chats/{characterCardName}.json`），会话隔离
- `executeImageGeneration`（Task 10 未实现）将优先读 `sessionTraits`，未设置时回退到角色卡 traits

### 实现方案

**IPC 层（saveTestChat 新增第 5 个参数 `sessionTraits?`）：**
- 渲染进程 `saveTestChat` 内部从 `get().currentTestChat?.sessionTraits` 读取（仅当 creativeId/characterCardId 匹配时），透传给 IPC
- 主进程 `saveCharacterTestChat` 接收 `sessionTraits`：存在 chat 时赋值到 `existingChat.sessionTraits`（undefined 时 JSON.stringify 省略字段 = 重置语义）；新建 chat 时仅在传入有效数组时写入
- 主进程 `TestChatData` 类型新增 `sessionTraits?: CharacterTraitItem[]` 字段
- `getTestChat` / `getAllTestChats` 读取时对 `sessionTraits` 做 `.map(t => ({ ...t }))` 浅拷贝，避免跨 IPC 边界共享引用

**Store 层（5 个新 actions）：**
- `setSessionTraits(traits)` — 深拷贝入参 → 更新 currentTestChat → saveTestChat 持久化
- `resetSessionTraits()` — 置 currentTestChat.sessionTraits = undefined → saveTestChat 持久化
- `updateSessionTrait(traitId, updates)` — lazy 初始化（sessionTraits 不存在时从 `characterTraitStore.traits` 深拷贝）→ 找到 trait 合并 updates → 持久化
- `addSessionTrait(categoryId, text)` — lazy 初始化 → genTraitId 生成新 trait（enabled=true, weight=1.0）→ 追加 → 持久化
- `removeSessionTrait(traitId)` — sessionTraits 不存在时 no-op → 过滤移除 → 持久化

### 设计决策

**决策 1：saveTestChat 从 currentTestChat 读取 sessionTraits（spec preferred 方案），而非新增参数**

spec 提供两种方案：(A) saveTestChat 新增 sessionTraits 参数；(B) saveTestChat 内部从 currentTestChat 读取。采用方案 B（spec 标注 "simpler, preferred"），优势：
- 现有调用方（addTestMessage / hooks.saveChatToStore）无需修改签名
- 新 actions（setSessionTraits 等）只需先更新 currentTestChat.sessionTraits，再调 saveTestChat 即可持久化
- 避免参数列膨胀（saveTestChat 已有 4 个位置参数）

关键实现：saveTestChat 读取 currentTestChat 时校验 creativeId/characterCardId 匹配，避免跨对话保存时串用其他对话的 sessionTraits。

**决策 2：updateSessionTrait / addSessionTrait 总是深拷贝（而非仅 lazy init 时深拷贝）**

spec 描述 lazy init 时深拷贝 characterTraitStore.traits，sessionTraits 已存在时直接使用。实现中改为**总是深拷贝**（`current.sessionTraits ?? characterTraitStore.traits` → JSON.parse(JSON.stringify(...))）。原因：
- 避免 TypeScript 控制流分析无法收窄 `let baseTraits` 的 undefined（`let` + 条件赋值 + JSON.parse 返回 any 导致 TS18048）
- 更安全：未更新项的 trait 对象不与原 sessionTraits 共享引用
- 性能影响可忽略（sessionTraits 为小数组）

**决策 3：IPC 透传 undefined = 重置语义**

主进程对 `existingChat.sessionTraits = sessionTraits`（undefined 时赋值 undefined）。`JSON.stringify` 省略 undefined 字段，因此重置后文件中不含 sessionTraits 字段，加载时自然回退到 undefined。无需单独的 "delete field" 逻辑。

**决策 4：loadTestChat / getTestChat 双层浅拷贝**

主进程 `getTestChat` 和渲染进程 `loadTestChat` 都对 sessionTraits 做 `.map(t => ({ ...t }))` 浅拷贝。双层保险：即使主进程缓存返回同一对象引用，渲染进程也能拿到独立副本，避免编辑 sessionTraits 时污染主进程缓存。

### TypeScript 类型收窄注意事项

`chat` 来自 IPC 返回（`Promise<any>`），`chat.sessionTraits` 为 `any`。直接写 `if (Array.isArray(chat.sessionTraits)) { chat.sessionTraits.map(t => ...) }` 会触发 TS7006（`t` implicitly any）——因为对 `any` 基对象的属性访问做类型收窄不会保持。解决方案：先用 `const` 局部变量承载（`const traits = chat.sessionTraits;`），使 `Array.isArray` 收窄（any → any[]）保持到 `.map` 调用。

### 验证状态

- `npx tsc --noEmit` 过滤相关文件：**零新增类型错误**
- characterChatStore.ts 残留 11 个报错（`msg` implicitly any + `msg.status`/`speakerName` 等不存在于本地 ChatMessage 接口）均为预存（原始 saveTestChat 即有此模式，本地 ChatMessage 接口是实际消息形状的子集）
- ChatStorageService.ts 残留 3 个 unused 报错（getChatFilePath 的 characterCardId 参数 + getTestChat 的 shortId/filePath 局部变量）均为预存
- characterChatHandlers.ts(10) `getCharacterTestChat` 返回类型缺 Promise 包裹为预存（未修改该函数）

### 无 bug，无用户反复提示。

### 涉及文件

- `src/main/services/ChatStorageService.ts` — TestChatData 新增 sessionTraits 字段（L24-37）；getTestChat / getAllTestChats 读取时浅拷贝 sessionTraits
- `src/main/ipc/handlers/characterChatHandlers.ts` — saveCharacterTestChat 新增 sessionTraits 参数（L13-64）；IPC handler 注册新增第 5 参数（L79-90）
- `src/main/preload.ts` — saveTestChat 新增 sessionTraits 参数（L377）
- `src/renderer/types/electron.d.ts` — saveTestChat 类型签名新增 sessionTraits（L439-456）
- `src/renderer/stores/characterChatStore.ts` — import genTraitId + useCharacterTraitStore（L1-8）；接口新增 5 actions（L59-101）；loadTestChat 安全映射 sessionTraits（L136-147）；saveTestChat 读取 currentTestChat.sessionTraits 透传 IPC（L217-257）；5 个 actions 实现（L319-531）
- `docs/FIX_RECORDS.md` — 本节记录（§7.33）

## §7.34 对话图片生成可审计性 — 提示词落盘 / 标签展示 / 临时特征编辑（Spec: enhance-conversation-image-auditability / Task 1+2+4+5+6+8+9+10+11，2026-08-09）

### 背景

用户反馈对话中生成的图片缺乏可审计性：无法看到每张图片实际使用了哪些标签和提示词，临时调整角色特征必须修改角色卡 manifest（污染原始数据），且生成失败时无从追溯当时使用的 prompt。本节记录除 Task 3（sourceContext 接线，§7.32）与 Task 7（sessionTraits store，§7.33）外的全部实施细节。

整体方案分三块：
1. **提示词落盘日志**（Task 2）— `sdGenerationService` 新增 `image-generation` logger，每次生成记录完整请求快照
2. **图片下方标签展示**（Task 1 / 4 / 5 / 6）— `ImageHistoryItem` 快照 `usedTags`/`usedPrompt`，`ChatMessageBubble` 渲染可折叠面板
3. **角色特征临时编辑**（Task 8 / 9 / 10 / 11）— `ConfigPanel` 升级为可编辑，`executeImageGeneration` 优先读 `sessionTraits`

### 实现方案

#### Task 1: 类型扩展（基础）

**`ImageHistoryItem`（CharacterDialogueChat.types.ts）新增 4 个可选字段**：
- `usedTags?: Array<{ text: string; weight?: number }>` — 该历史项生成时使用的标签快照（去重合并后的完整列表）
- `usedPrompt?: string` — 最终发送给 SD WebUI 的完整 prompt 字符串（含 LoRA + traits 替换后）
- `usedNegativePrompt?: string` — 反向提示词快照
- `usedLoras?: Array<{ name: string; weight: number }>` — LoRA 列表快照

**`SDGenerationOptions` 新增 `sourceContext?` 字段**：
```typescript
sourceContext?: {
  source: 'conversation' | 'asset-manager';
  messageId?: string;
  characterCardId?: string;
  round?: number;  // 第几次重生成（首次=1）
};
```

**`CharacterTestChat` 新增 `sessionTraits?: CharacterTraitItem[]`** — 见 §7.33。

**`electron.d.ts` 同步**：`generateTxt2Img` 返回值类型签名新增 `finalPrompt: string`（Task 4.4）；`saveTestChat` 签名新增第 5 参数 `sessionTraits?`（§7.33）。

#### Task 2: 提示词落盘日志（sdGenerationService 新增 image-generation logger）

在 `src/main/services/sdGenerationService.ts` 顶部：
```typescript
import { createLogger } from './logger';
const logger = createLogger('image-generation');
```

`generateTxt2Img` 方法在 `applyTraitsAndLora` 之后、HTTP 请求之前插入 `logger.info`：
```typescript
const finalPrompt = this.applyTraitsAndLora(prompt, options);
logger.info(
  `生成图片请求 [${options.sourceContext?.source || 'unknown'}]`,
  finalPrompt,
  {
    negativePrompt: negativePrompt || '',
    traits: options.characterTraits || [],
    loras: options.selectedLoras || [],
    steps: options.steps,
    cfgScale: options.cfgScale,
    sampler: options.sampler,
    scheduler: options.scheduler,
    width: options.width,
    height: options.height,
    model: options.model,
    sourceContext: options.sourceContext,
  }
);
```

catch 分支调用 `logger.error` 记录失败原因 + sourceContext + 原始 prompt。

**日志落盘路径**：开发环境 `g:\AI\creative-cafe\logs\image-generation\image-generation_<timestamp>.log`，生产环境 `app.getAppPath()/logs/image-generation/`。复用 `getModuleLogDir` 既有逻辑，无需修改 `logPathService`。10MB 自动轮转，最多保留 5 个文件（与项目其他模块 logger 一致）。

#### Task 4: 标签快照写入（executeImageGeneration 在 history 项中快照）

**问题**：最终 prompt 在主进程 `applyTraitsAndLora` 中组装，渲染进程无法直接拿到完整字符串。

**方案**：
1. `sdGenerationService.generateTxt2Img` 返回值新增 `finalPrompt: string` 字段（始终返回，含 LoRA + traits 替换后的完整字符串）
2. `sd:generateTxt2Img` IPC handler 透传 `finalPrompt`
3. `electron.d.ts` 同步返回值类型签名
4. `executeImageGeneration` 在 `newHistoryItem` 中快照：
```typescript
const newHistoryItem: ImageHistoryItem = {
  assetId: savedAssetId,
  createdAt: Date.now(),
  usedTags: mergedTraits,           // 合并去重后的完整 traits 数组
  usedPrompt: sdResult?.finalPrompt, // 主进程返回的最终 prompt
  usedNegativePrompt: negativePrompt,
  usedLoras: currentLoras.map(l => ({ name: l.name, weight: l.weight })),
};
```

**旧数据兼容**：旧 `ImageHistoryItem`（无 usedTags 字段）加载时字段为 undefined，UI 显示「此历史版本无标签快照」灰色提示，不报错。

#### Task 5: 图片下方标签展示 UI（ChatMessageBubble 可折叠面板）

在 `ChatMessageBubble.tsx` 图片区域 `chat-msg-image-actions` 下方新增「查看本次生成标签」可折叠面板：

```tsx
const [tagsPanelExpanded, setTagsPanelExpanded] = useState(false);
const [promptPanelExpanded, setPromptPanelExpanded] = useState(false);
const currentHistoryItem = message.imageAttachment?.history?.[message.imageAttachment.currentIndex];

// 历史导航时自动折叠
useEffect(() => {
  setTagsPanelExpanded(false);
  setPromptPanelExpanded(false);
}, [message.imageAttachment?.currentIndex]);

// 渲染：仅 status === 'idle' 且当前历史项有 usedTags 时显示
{message.imageAttachment.status === 'idle' && currentHistoryItem && (
  currentHistoryItem.usedTags ? (
    <div className="chat-msg-image-tags-panel">
      <button type="button" className="chat-msg-image-tags-panel-header"
              onClick={() => setTagsPanelExpanded(!tagsPanelExpanded)}>
        {tagsPanelExpanded ? <DownOutlined /> : <RightOutlined />}
        <span>查看本次生成标签</span>
        <Tag className="chat-msg-image-tags-count">{currentHistoryItem.usedTags.length} tags</Tag>
      </button>
      {tagsPanelExpanded && (
        <>
          <div className="chat-msg-image-tags">
            {currentHistoryItem.usedTags.map((t, i) => (
              <Tag key={i}>
                {t.text}
                {t.weight && t.weight !== 1.0 && (
                  <span className="chat-msg-image-tag-weight">:{t.weight}</span>
                )}
              </Tag>
            ))}
          </div>
          {/* 二级折叠：完整 Prompt / Negative Prompt / LoRAs */}
          <button type="button" onClick={() => setPromptPanelExpanded(!promptPanelExpanded)}>
            {promptPanelExpanded ? <DownOutlined /> : <RightOutlined />} 查看完整 Prompt
          </button>
          {promptPanelExpanded && (
            <>
              <pre className="chat-msg-image-prompt">{currentHistoryItem.usedPrompt}</pre>
              {currentHistoryItem.usedNegativePrompt && (
                <pre className="chat-msg-image-prompt">{currentHistoryItem.usedNegativePrompt}</pre>
              )}
              {currentHistoryItem.usedLoras?.map((l, i) => (
                <Tag key={i}>{l.name}:{l.weight}</Tag>
              ))}
            </>
          )}
        </>
      )}
    </div>
  ) : (
    <div className="chat-msg-image-tags-panel chat-msg-image-tags-empty">
      <span>此历史版本无标签快照</span>
    </div>
  )
)}
```

#### Task 6: 标签面板样式（ChatMessageBubble.css）

新增 CSS 类：`.chat-msg-image-tags-panel` / `.chat-msg-image-tags-panel-header` / `.chat-msg-image-tags` / `.chat-msg-image-prompt`（等宽字体 + 横向滚动 + 暗色背景 + 圆角边框）/ `.chat-msg-image-tag-weight`（小字号 + `var(--color-warning)` 黄色）/ `.chat-msg-image-tags-empty`（灰色提示）/ `.chat-msg-image-tags-count`。

样式遵循暗色主题 CSS 变量（`var(--bg-elevated)` / `var(--text-secondary)` / `var(--border-base)` / `var(--text-tertiary)` / `var(--color-warning)` 等），所有属性均含 hex fallback；亮/暗主题通过 `ui-variables.css` 同名变量双值定义。视觉风格参考 `RagQualityReport.tsx` 的 Tag 渲染保持一致。

#### Task 8: ConfigPanel 特征分类区域升级（从只读升级为可编辑）

`ConfigPanel.tsx` 从 `useCharacterChatStore` 订阅 `currentTestChat.sessionTraits` / `setSessionTraits` / `updateSessionTrait` / `addSessionTrait` / `removeSessionTrait` / `resetSessionTraits`。

**派生 `effectiveTraits`**：`sessionTraits ?? characterTraits`，特征分类区域渲染基于 `effectiveTraits`。

**UI 升级**：
- 顶部「角色特征分类」标题旁新增「临时编辑中」徽标（仅 sessionTraits 存在时显示，黄色警告色 + EditOutlined + Tooltip 说明「此修改仅对当前对话生效，不影响角色卡」）+ 「重置为角色卡特征」按钮（仅 sessionTraits 存在时显示，点击触发 `resetSessionTraits` 含 `Modal.confirm` 二次确认）
- 每个 Tag 渲染改为可交互：点击 Tag 切换 `enabled` 状态（调 `updateSessionTrait(trait.id, { enabled: !trait.enabled })`）；Tag 悬浮显示删除按钮（调 `removeSessionTrait(trait.id)`）
- Tag 文本 inline 编辑：双击 Tag 进入编辑态（Input 组件），回车确认调 `updateSessionTrait(trait.id, { text: newValue, originalText: undefined })`，Esc 取消
- 权重徽标：带非默认权重的 Tag 显示权重徽标，点击徽标进入权重编辑态（InputNumber），确认调 `updateSessionTrait(trait.id, { weight: newWeight })`
- 每个分类下新增「+ 添加特征」按钮，点击弹出 prompt 输入特征文本，确认调 `addSessionTrait(cat.id, text)`
- 分类级 Checkbox 保留现有行为，但作用于 `effectiveTraits`（批量切换通过 `setSessionTraits` 全量替换，首次调用 lazy-init sessionTraits）

#### Task 9: ConfigPanel 编辑态样式（ConfigPanel.css）

新增 CSS 类：`.image-gen-trait-tag.editable`（cursor pointer + hover 高亮）/ `.image-gen-trait-tag-edit-btn`（绝对定位 + 悬浮显示）/ `.image-gen-trait-tag-weight-badge`（小圆角 + 灰色背景）/ `.image-gen-trait-tag-editing`（编辑态 Input 样式）/ `.image-gen-add-trait-btn`（添加特征按钮）/ `.image-gen-session-badge`（临时编辑中徽标：黄色警告色）/ `.image-gen-reset-btn`（重置按钮）。

样式遵循暗色主题 CSS 变量，避免硬编码 hex（参考 `ui-variables.css` 既有变量）。

#### Task 10: executeImageGeneration 特征源切换（优先 sessionTraits）

`CharacterDialogueChat.tsx` 的 `executeImageGeneration` 中：
```typescript
// 特征源优先 sessionTraits
const sessionTraits = useCharacterChatStore.getState().currentTestChat?.sessionTraits;
const currentTraits = sessionTraits ?? useCharacterTraitStore.getState().traits;
console.log(`[executeImageGeneration] 特征来源: ${sessionTraits ? 'sessionTraits (临时编辑)' : 'characterTraitStore (角色卡)'}`);

// enabledTraitTexts 与 buildSdOptionsFromConfig 的 effectiveTraits 均使用 currentTraits
```

替换原有的 `useCharacterTraitStore.getState().traits` 直接读取。日志输出特征来源便于调试。

#### Task 11: hooks 透传（CharacterDialogueChat.hooks）

`saveChatToStore` 调用路径会触发 `characterChatStore.saveTestChat`，且 `saveTestChat` 内部已序列化 `sessionTraits`（§7.33 Task 7.2 已处理）。`messagesToSave` 映射无需修改（sessionTraits 是对话级字段，不在 messages 内）。

### 设计决策

**决策 1：finalPrompt 由主进程返回，而非渲染进程重组装**

`applyTraitsAndLora` 在主进程完成 LoRA + traits 替换。方案 A（渲染进程重组装）需要复制 `applyTraitsAndLora` 逻辑到渲染层，存在双源真相风险；方案 B（主进程返回 finalPrompt）只需扩展 IPC 返回值。采用方案 B，主进程是 prompt 组装的唯一权威源。

**决策 2：标签快照存历史项（per-history-item），而非消息级（per-message）**

`ImageHistoryItem` 是每张图片的快照，同一消息可能有多张图片（重生成历史）。标签快照存历史项级别，确保切换历史图片时显示对应版本的标签。消息级存储会导致所有历史版本共享同一标签列表，与实际生成参数不符。

**决策 3：标签面板默认折叠 + 历史导航自动折叠**

避免占用过多垂直空间影响对话阅读体验。用户主动点击展开查看详情。切换历史图片时自动折叠，避免上一版本的展开状态误导用户。

**决策 4：sessionTraits 是会话级覆盖，不写角色卡 manifest**

`sessionTraits` 仅随对话持久化（`chats/{characterCardName}.json`），与角色卡 manifest（`traits.json`）物理隔离。临时编辑后切换角色卡/新建对话，新对话不继承 sessionTraits。用户主动「重置」可清空 sessionTraits 回退到角色卡原始数据。详见 §7.33。

**决策 5：lazy initialization 策略**

`updateSessionTrait` / `addSessionTrait` 在 sessionTraits 未初始化时从 `characterTraitStore.traits` 深拷贝初始化。优势：
- 用户首次编辑某个特征时，无需先点「全量复制为临时方案」按钮，体验流畅
- 避免对话开始就深拷贝整个 traits 数组（即使不编辑也消耗内存）
- sessionTraits 的存在性自然成为「是否进入临时编辑模式」的标志（驱动 UI 徽标显示）

**决策 6：日志 details 字段为最终 prompt 字符串（多行可复制），context 字段为 JSON 对象**

`logger.info(message, details, context)` 三参数模式：
- `message`：简短描述 + sourceContext.source 标识
- `details`：最终 prompt 完整字符串（用户可直接复制到 SD WebUI 调试）
- `context`：JSON 对象（negativePrompt / traits / loras / 采样参数 / 尺寸 / sourceContext）

便于后续通过日志文件直接定位「哪次生成用了什么参数」。

### TypeScript 类型收窄注意事项

**`SDGenerationOptions` 类型扩展后必须同步 `electron.d.ts`**：主进程类型不能直接被渲染进程引用，需手动同步内联类型签名。`generateTxt2Img` 返回值新增 `finalPrompt` 字段时，IPC handler 与 `electron.d.ts` 必须同步更新，否则渲染进程拿不到字段。

### 验证状态

- `npx tsc --noEmit` 所有修改文件无新增错误
- 提示词落盘：生成图片后 `logs/image-generation/` 目录下日志文件含完整 prompt + traits + loras + sourceContext
- 标签展示：图片下方「查看本次生成标签」面板可折叠展开，显示 Tag 列表 + 完整 Prompt
- 历史导航：切换历史图片时标签面板同步刷新为对应历史项的快照
- 临时编辑：ConfigPanel 修改特征后「临时编辑中」徽标显示，图片生成使用临时特征
- 临时编辑持久化：关闭重开对话后 sessionTraits 恢复，徽标重新显示
- 重置功能：点击「重置为角色卡特征」后 sessionTraits 清空，特征回退到角色卡原始数据
- 角色卡隔离：临时编辑后切换角色卡/新建对话，新对话不继承 sessionTraits
- 角色卡 manifest 不受影响：临时编辑后角色卡 manifest 数据未变化（AssetManagerModal 查看确认）
- 旧数据兼容：旧 ImageHistoryItem（无 usedTags）加载显示「此历史版本无标签快照」提示
- 旧对话兼容：旧 CharacterTestChat（无 sessionTraits）加载正常，行为与现有逻辑一致

### 无 bug，无用户反复提示。

### 涉及文件

- `src/renderer/components/Character/CharacterDialogueChat/CharacterDialogueChat.types.ts` — `ImageHistoryItem` 新增 `usedTags` / `usedPrompt` / `usedNegativePrompt` / `usedLoras` 字段（Task 1.1）
- `src/shared/types/sd.types.ts`（或 sdGenerationService 内联）— `SDGenerationOptions` 新增 `sourceContext` 字段（Task 1.3）
- `src/renderer/types/electron.d.ts` — `generateTxt2Img` 返回值签名新增 `finalPrompt`；`saveTestChat` 签名新增 `sessionTraits`（Task 1.4 + Task 4.4）
- `src/main/services/sdGenerationService.ts` — import createLogger + `image-generation` logger；`generateTxt2Img` 内 logger.info/error 调用；返回值新增 `finalPrompt`（Task 2 + Task 4.3）
- `src/main/ipc/handlers/sdGenerationHandlers.ts` — 透传 `finalPrompt`（Task 4.4）
- `src/renderer/components/Character/CharacterDialogueChat/CharacterDialogueChat.tsx` — `executeImageGeneration` 优先读 sessionTraits；`newHistoryItem` 快照 usedTags/usedPrompt/usedNegativePrompt/usedLoras；日志输出特征来源（Task 4.1-4.2 + Task 10）
- `src/renderer/components/Character/CharacterDialogueChat/ChatMessageBubble.tsx` — 可折叠标签面板 + Prompt 二级折叠 + 历史导航自动折叠（Task 5）
- `src/renderer/components/Character/CharacterDialogueChat/ChatMessageBubble.css` — 新增 `.chat-msg-image-tags-panel` 等 7 个 CSS 类（Task 6）
- `src/renderer/components/Character/CharacterDialogueChat/ConfigPanel.tsx` — 订阅 sessionTraits + 5 actions；effectiveTraits 派生；Tag 可交互（点击切换/双击编辑/悬浮删除/权重编辑）；「+ 添加特征」按钮；「临时编辑中」徽标 + 「重置」按钮（Task 8）
- `src/renderer/components/Character/CharacterDialogueChat/ConfigPanel.css` — 新增 `.image-gen-trait-tag.editable` 等 7 个 CSS 类（Task 9）
- `src/renderer/components/Character/CharacterDialogueChat/CharacterDialogueChat.hooks.ts` — 确认 saveChatToStore 透传 sessionTraits（Task 11，§7.33 已实现）
- `docs/FIX_RECORDS.md` — 本节记录（§7.34）；§7.32（Task 3 sourceContext 接线）+ §7.33（Task 7 sessionTraits store）已先行记录
- `CODE_WIKI.md` — §39 架构变更记录
- `CHANGELOG.md` — 版本条目

### 关联章节

- §7.32 — sourceContext 接线（Task 3）
- §7.33 — sessionTraits store 扩展（Task 7）
- §7.30 — 旧图片消息迁移为 imageAttachment 附属字段（前置依赖）
- §7.31 — hooks 新增 updateImageAttachment / deleteImageAttachment / navigateImageHistory（前置依赖）

## §7.35 对话互动元素识别 — 新增 `interaction` 系统分类与双模式互动标签引导（Spec: enhance-conversation-interaction-prompt-recognition，2026-08-09）

### 用户反馈

用户反馈：对话中描述动作互动（如"用手触摸她的身体"、"舔她的手"、"亲吻她"、"拥抱她"）时，生成的图片缺乏交互性质 — SD 仅生成角色独自站立/坐着的画面，未体现用户与角色的肢体接触。用户明确要求：

1. 建立专门的互动元素识别机制，准确捕获对话中描述的交互场景
2. 生成图片 prompt 时必须添加对应的互动元素标签（脱离身体的部位及动作）
3. 允许不生成用户的完整形象，但必须确保添加的互动元素能引导 SD 生成交互性质图片
4. 互动标签除 `disembodied_hand` / `hand_on_breast` / `disembodied_tongue` / `licking` 等 POV 风格外，还包括 `hugging_another` 等带 `another` 的双角色互动标签

### 根因分析

原特征分类体系仅有 `pose`（角色自身姿势），无专门承载「用户与角色交互」的标签分类：

- `pose` 语义是角色自己的姿态（`sitting` / `standing` / `lying`），无法表达「与另一实体的交互」
- AI 不知道应输出 `disembodied_hand` / `hugging_another` 等 Danbooru 互动标签，prompt 中无任何互动标签引导
- `disembodied_hand`（count 71413）/ `hugging_another`（count 10622）/ `hand_on_another's_head`（count 47364）等互动标签均已存在于标签库 CSV，但从未被 AI 识别输出

### 解决方案

#### 1. 新增 `interaction` 系统分类

**`src/shared/types/characterTrait.types.ts`** — `SYSTEM_TRAIT_CATEGORIES` 数组新增第 11 个系统分类（order 10）：

```typescript
{ id: 'interaction', name: '互动元素', isSystem: true, order: 10 }
```

与 `pose` 语义分离：
- `pose` = 角色自身的姿态（`sitting` / `standing` / `lying`）
- `interaction` = 与另一个实体的交互（`disembodied_hand` / `hugging_another` / `holding_hands`）

#### 2. 增强 `buildDynamicTraitSystemPrompt` 互动识别指令

**`src/main/services/characterTraitAIService.ts`** — `buildDynamicTraitSystemPrompt` 方法三处增强：

**(a) `systemCategoryDescriptions` 新增 `interaction` 描述**：

```typescript
interaction:
  '互动元素（用户与角色之间的身体接触、肢体动作等交互场景，含两种模式：A) POV 脱离身体风格如 disembodied_hand / hand_on_breast / disembodied_tongue / licking；B) 双角色互动风格如 hugging_another / holding_hands / hand_on_another\'s_head / grabbing_another\'s_breast / sitting_on_another。用于引导 SD 生成包含交互性质的图片）',
```

**(b) `systemGuidance` 新增互动元素归类建议**：

```
- 用户与角色的动作互动（触摸身体 → disembodied_hand + hand_on_breast/hand_on_butt/hand_on_hip/hand_on_leg；
  舔 → disembodied_tongue + licking/face_lick/breast_lick/foot_lick；亲吻 → kissing；
  拥抱 → hugging_another/hug；牵手 → holding_hands；
  手放在他人身上 → hand_on_another's_head/shoulder/face/cheek/chin/back/arm/chest/thigh/waist；
  抓握 → grabbing_another's_breast/ass/arm/hair；
  坐/抱 → sitting_on_another/carrying_another）→ interaction
```

**(c) 新增 `interactionGuidance` 指令块**（注入到 prompt 主体）：

定义两种 Danbooru 互动模式 + 5 条关键原则：

- **模式 A — POV/脱离身体风格**（第一人称描述触发）：`disembodied_hand` + `hand_on_*` / `disembodied_tongue` + `*_lick` / `disembodied_penis` / `disembodied_foot` / `disembodied_mouth`
- **模式 B — 双角色互动风格**（第三人称或两角色互动触发）：`hugging_another` / `holding_hands` / `hand_on_another's_*` / `grabbing_another's_*` / `holding_another's_*` / `sitting_on_another` / `carrying_another` / `facing_another` / `smiling_at_another` / `kissing`

5 条关键原则：
1. 互动元素独立于角色完整形象 — 必须添加 `disembodied_*` 标签，而非试图生成用户完整角色
2. 互动标签必须成对出现 — `disembodied_hand` 配合 `hand_on_*`，`disembodied_tongue` 配合 `*_lick`
3. 仅当对话明确描述互动动作时才输出 — 角色独自描述不触发
4. 使用 `interaction:` 分类前缀输出
5. 根据对话语境选择模式 — 第一人称倾向模式 A，第三人称倾向模式 B

#### 3. 同步更新 `buildDynamicImageTraitSystemPrompt` 与基线常量

- `buildDynamicImageTraitSystemPrompt`：`systemCategoryDescriptions` 新增 `interaction` 英文描述（标注「typically NOT extracted from a single character card image, only triggered by conversation context」）；`systemGuidance` 新增互动元素归类建议。**关键修复**：`SYSTEM_TRAIT_CATEGORIES` 已含 `interaction`，若 `buildDynamicImageTraitSystemPrompt` 的 `systemCategoryDescriptions` 缺失 `interaction` key，分类列表会回退到 `c.name`（中文名「互动元素」），破坏英文 prompt 一致性。
- `CHARACTER_TRAIT_SYSTEM_PROMPT` / `IMAGE_TRAIT_SYSTEM_PROMPT` 基线常量：同步追加 `interaction` 分类描述与 guidance（基线参考，生产用动态构建版本）。

#### 4. 互动标签分类级权重提升（用户反馈增强）

**用户反馈**：互动标签拼接位置本身靠后，角色特征标签较多时图像模型比较容易忽略，需要加强到 1.1-1.2，或者在参数面板提供一个让用户自己修改互动类标签权重的值。

**实现方案**（组合方案：默认 1.2 + 可配置）：

**(a) 新增配置项 `interaction_weight`**（`CharacterDialogueChat.types.ts`）：
- `AIParameterConfig` 新增 `interaction_weight?: number` 字段
- 默认 `1.2`（用户建议的 1.1-1.2 范围取上限），范围 `1.0-2.0`，步进 `0.1`
- `1.0` = 不提升（等价关闭功能，互动标签使用原始 per-tag weight）

**(b) 权重组合方式**（`CharacterDialogueChat.tsx` `executeImageGeneration`）：
- `enabledTraitTexts` / `contextTraits` / `mergedTraits` 映射时保留 `categoryId`（原代码丢弃）
- 新增分类级权重提升逻辑：
  ```typescript
  const interactionWeight = characterConfig?.customParameters?.interaction_weight ?? 1.2;
  const finalTraits = mergedTraits.map(t => {
    if (t.categoryId === 'interaction' && interactionWeight !== 1.0) {
      const baseWeight = t.weight ?? 1.0;
      return { text: t.text, weight: Math.round(baseWeight * interactionWeight * 10) / 10 };
    }
    return { text: t.text, weight: t.weight };
  });
  ```
- 最终 weight = (per-tag weight ?? 1.0) × interaction_weight（分类级提升与标签级权重**相乘**）
- `buildSdOptionsFromConfig` 与 `usedTags` 快照均使用 `finalTraits`（含提升后权重），与 `usedPrompt` 保持一致

**(c) ConfigPanel 滑块 UI**（`ConfigPanel.tsx` + `ConfigPanel.css`）：
- 「图片生成设置」面板内新增「互动标签权重」滑块（antd Slider，1.0-2.0 步进 0.1，默认 1.2）
- 图片生成开启时可用，关闭时 disabled
- 滑块旁显示当前值（如 `1.2`），带 Tooltip 说明权重组合方式
- 新增 `handleInteractionWeightChange` 回调（范围校验 1.0-2.0，保留 1 位小数）

**设计决策**：
- **在渲染进程应用权重**（不改 `SDGenerationOptions` 类型 / `applyTraitsAndLora` 主进程逻辑）：保持主进程 prompt 组装逻辑不变，权重计算在数据准备阶段完成。`applyTraitsAndLora` 只看到最终的 `{ text, weight }`，不感知 categoryId
- **权重相乘而非覆盖**：分类级权重与 per-tag weight 相乘，用户可同时调整单个标签权重和分类级权重
- **默认 1.2**：在用户建议的 1.1-1.2 范围内取上限，确保互动标签足够突出

#### 5. ConfigPanel 角色特征分类区域按 AssetGenerateModal 设计重构（用户反馈）

**用户反馈**：参数面板中的添加按钮不生效；请将角色特征分类整个按照 AI 素材生成——携带角色特征板块进行设计，但保留是否勾选启用的开关。

**Bug 根因**：原 `handleAddTrait` 使用 `window.prompt` 获取文本（L272），**Electron 默认不支持 `window.prompt`**，导致「添加」按钮点击后无反应。此外，空分类被隐藏（`if (catTraits.length === 0) return null`），用户无法向空分类（如 `interaction`）添加标签。

**重构方案**（按 AssetGenerateModal「携带角色特征」面板设计）：

**(a) 替换 `window.prompt` 为内联 `TagAutocomplete` + ✓/✗ 按钮**：
- 新增 `addingCategoryId` / `addingText` 本地状态控制内联输入
- 新增 `handleStartAddTrait` / `handleConfirmAddTrait` / `handleCancelAddTrait` / `handleTagSelectAdd` handlers
- `TagAutocomplete` 提供标签库实时推荐（降级开关关闭时回退为普通 Input）
- ✓ 按钮确认添加（调 `addSessionTrait`），✗ 按钮取消
- 选中推荐 tag 后直接添加并清空输入框（不退出新增模式，允许连续添加多个）

**(b) 分类布局从平铺改为 `Collapse` 折叠面板**：
- 使用 antd `Collapse` + `Collapse.Panel`（与 AssetGenerateModal 一致）
- 面板头：Checkbox（启用/禁用，`indeterminate` 三态）+ 分类名 + 启用计数
- Checkbox 点击 `stopPropagation` 避免触发 Collapse 展开/收起
- **所有分类均显示**（含空分类），用户可向空分类添加标签

**(c) Tag 渲染从自定义 `<span>` 改为 antd `Tag` + `Tooltip` + `EditOutlined` + `Popover`**：
- `Tag` `closable` 属性提供删除（替换自定义 × 按钮）
- `Tooltip` 显示翻译 / 拆分溯源 / 权重信息
- `EditOutlined` 图标触发文本编辑（替换双击）
- `SplitCellsOutlined` 图标标识 L3 颜色拆分标签
- `Popover` 权重编辑器（Slider 0.1-2.0 + InputNumber 0.1-10.0 + 预设按钮 1.0/1.2/1.5）
- 权重徽标三色：默认 1.0 灰色虚线 / >1.0 暖橙 / <1.0 冷蓝（与 AssetGenerateModal 一致）
- 权重实时更新（`handleUpdateTraitWeight` → `updateSessionTrait`），无需确认按钮

**(d) 移除不再需要的旧状态/handlers**：
- 移除 `editingWeightId` / `editingWeight` 状态（Popover 方式无需本地编辑态）
- 移除 `handleConfirmWeightEdit` / `handleCancelWeightEdit`（被 `handleUpdateTraitWeight` 取代）
- 移除 `isCategoryAllEnabled`（被内联 `indeterminate` 逻辑取代）

**涉及文件**：
- `src/renderer/components/Character/CharacterDialogueChat/ConfigPanel.tsx` — 导入更新（Tag/Popover/Collapse/Space/TagAutocomplete + 新 icons）；新增 6 个 handlers；重写特征分类区域 JSX（~200 行替换）
- `src/renderer/components/Character/CharacterDialogueChat/ConfigPanel.css` — 替换旧 tag 样式为 Collapse/Tag/Popover/weight-badge 新样式（~15 个 CSS 类）

### 数据流

```
对话上下文描述互动动作（"我用手触摸她的身体"）
  ↓
generateTraitPrompts（characterTraitAIService）调用 buildDynamicTraitSystemPrompt
  ↓
interactionGuidance 指令块注入到 system prompt
  ↓
LLM 识别互动语境 → 输出 interaction:disembodied_hand|脱离身体的手, interaction:hand_on_breast|手放在胸部
  ↓
parseTraitsFromContent 解析 → CategorizedTrait { categoryId: 'interaction', text: 'disembodied_hand', translation: '脱离身体的手' }
  ↓
characterTraitStore.setTraits（MERGE 策略）→ CharacterTraitItem { categoryId: 'interaction', enabled: true }
  ↓
ConfigPanel 自动渲染「互动元素」分类折叠区（SYSTEM_TRAIT_CATEGORIES 驱动，无需修改组件）
  ↓
executeImageGeneration 构建 mergedTraits（保留 categoryId）
  ↓
分类级权重提升：interaction 分类的 trait weight × interaction_weight（默认 1.2）
  → finalTraits: [{ text: 'disembodied_hand', weight: 1.2 }, { text: 'hand_on_breast', weight: 1.2 }]
  ↓
applyTraitsAndLora 拼接 finalTraits 到 SD prompt → (disembodied_hand:1.2), (hand_on_breast:1.2)
  ↓
SD 生成包含交互性质的图片（disembodied_hand + hand_on_breast → 画面出现一只手放在角色胸部）
```

### ConfigPanel 自动适配

`ConfigPanel.tsx` 通过 `SYSTEM_TRAIT_CATEGORIES + globalCategories + UNCATEGORIZED_CATEGORY` 构建分类列表（`traitCategories` useMemo），新增的 `interaction` 分类自动出现在右侧面板的分类折叠区，无需修改组件代码。用户可在「互动元素」分类下查看/编辑/启用/禁用 AI 生成的互动标签。

### 标签库覆盖验证

互动标签均已存在于 `docs/danbooru_e621_merged_2026-03-01_pt20-ia-dd-ed-spc.csv`：

| 标签 | count | 模式 |
|------|-------|------|
| `disembodied_hand` | 71413 | A (POV) |
| `hand_on_breast` | — | A (POV) |
| `disembodied_tongue` | — | A (POV) |
| `licking` | — | A (POV) |
| `hugging_another` | 10622 | B (双角色) |
| `hand_on_another's_head` | 47364 | B (双角色) |
| `holding_hands` | — | B (双角色) |
| `sitting_on_another` | — | B (双角色) |

RAG 检索（tagRagService）与 L0-L5 审计链（tagAutocompleteService / userSynonymMapService）可正常命中这些标签，AI 生成的互动 tag 会通过标准审计流程验证。

### 无 bug，无用户反复提示。

### 涉及文件

- `src/shared/types/characterTrait.types.ts` — `SYSTEM_TRAIT_CATEGORIES` 新增 `interaction` 分类（order 10）；`CategorizedTrait.categoryId` 注释补充 `interaction` 取值
- `src/main/services/characterTraitAIService.ts` — 四处同步更新：
  - `buildDynamicTraitSystemPrompt`：`systemCategoryDescriptions` + `systemGuidance` + `interactionGuidance` 指令块
  - `buildDynamicImageTraitSystemPrompt`：`systemCategoryDescriptions` + `systemGuidance`（英文描述，标注图片识别场景一般不触发）
  - `CHARACTER_TRAIT_SYSTEM_PROMPT` 基线常量：同步追加 `interaction` 分类描述 + guidance + 互动识别指令块
  - `IMAGE_TRAIT_SYSTEM_PROMPT` 基线常量：同步追加 `interaction` 分类描述 + guidance
- `src/renderer/components/Character/CharacterDialogueChat/CharacterDialogueChat.types.ts` — `AIParameterConfig` 新增 `interaction_weight?: number` 字段（默认 1.2，范围 1.0-2.0）
- `src/renderer/components/Character/CharacterDialogueChat/CharacterDialogueChat.tsx` — `executeImageGeneration` 中保留 `categoryId` + 分类级权重提升（`finalTraits`）；`usedTags` 快照使用 `finalTraits`；新增 `handleInteractionWeightChange` 回调；ConfigPanel 传参新增 `interactionWeight` / `onInteractionWeightChange`
- `src/renderer/components/Character/CharacterDialogueChat/ConfigPanel.tsx` — 新增 `interactionWeight` / `onInteractionWeightChange` props；导入 `Slider`；新增「互动标签权重」滑块 UI；**【UI 重构】**按 AssetGenerateModal 设计重构特征分类区域：Collapse + Tag + Tooltip + EditOutlined + Popover 权重编辑器 + TagAutocomplete 内联添加（替换 window.prompt）；移除旧 editingWeightId/handleConfirmWeightEdit/isCategoryAllEnabled
- `src/renderer/components/Character/CharacterDialogueChat/ConfigPanel.css` — 新增 `.image-gen-interaction-weight-row` / `-control` / `-value` 三个 CSS 类；**【UI 重构】**替换旧 tag 样式为 Collapse/Tag/Popover/weight-badge 新样式（~15 个 CSS 类）
- `docs/FIX_RECORDS.md` — 本节记录（§7.35）
- `CODE_WIKI.md` — §40 架构变更记录 + 系统分类体系表更新（10 → 11 个）
- `CHANGELOG.md` — 版本条目

### 关联章节

- CODE_WIKI.md §40 — 对话互动元素识别架构
- CODE_WIKI.md §「AI 生成特征自动归类」— 系统分类体系表（已更新为 11 个，含 `interaction`）
- §7.29 — 衣物分类拆分（top/bottom/accessories/underwear）— 同类「系统分类扩展」变更参考
- §5.2 — AI 不生成自定义分类 tag 的 bug 修复（buildDynamicTraitSystemPrompt 动态构建机制来源）

## §7.36 允许 AI 优化特征标签（试验性功能）（Spec: add-ai-trait-optimization-for-image-gen，2026-08-09）

### 背景

对话图片生成时，角色卡特征标签可能与对话上下文矛盾（如对话中角色「脱下了裤子」但特征标签仍含 `pants`），导致生成图片与剧情不符。当前系统仅做「加法」（AI 生成上下文标签后合并），缺少「减法」能力。

### 实现内容

1. **新增配置项** `ai_optimize_traits?: boolean`（AIParameterConfig，默认关闭）
2. **新增 AI 服务方法** `optimizeTraitsForContext`（characterTraitAIService.ts）：接收已启用特征标签 + 对话上下文，返回应删除的标签列表（JSON 格式 `{ "remove": [{ "text", "reason" }] }`）
3. **新增 IPC 通道** `ai:optimizeTraitsForContext`（handler + preload + electron.d.ts）
4. **ConfigPanel UI**：「图片生成设置」区新增开关 + 试验性警示文案
5. **executeImageGeneration 集成**：在收集 enabledTraitTexts 后、生成上下文标签前，调用 AI 优化过滤矛盾标签
6. **标签快照展示**：ChatMessageBubble 新增「AI 已移除」分区（灰色 + 删除线 + 原因 tooltip）

### 防御性设计（重点标记）

- ⚠️ **AI 返回结果不信任**：必须做存在性过滤（仅移除实际存在的标签）+ 过度删除防护（>80% 拒绝执行）
- ⚠️ **AI 调用失败不中断主流程**：降级为不优化，保持原标签列表，记录错误日志
- ⚠️ **const → let 关键修改**：`enabledTraitTexts` 原为 `const` 声明，AI 优化步骤需重新赋值，必须改为 `let`。遗漏此修改会导致 `ts(2588)` 编译错误
- ⚠️ **过滤后保留 categoryId 字段**：`enabledTraitTexts` 过滤使用 `.filter()` 而非 `.map()` 重构，避免对象重构丢字段（参照 globalCategories 教训）

### 关键文件清单

- `src/renderer/components/Character/CharacterDialogueChat/CharacterDialogueChat.types.ts` — AIParameterConfig + ImageHistoryItem 类型扩展
- `src/main/services/characterTraitAIService.ts` — optimizeTraitsForContext 方法 + parseOptimizeResponse 解析器
- `src/main/ipc/handlers/characterTraitAIHandlers.ts` — IPC handler 注册
- `src/main/preload.ts` — ai.optimizeTraitsForContext 暴露
- `src/renderer/types/electron.d.ts` — 类型声明
- `src/renderer/components/Character/CharacterDialogueChat/ConfigPanel.tsx` — 开关 UI
- `src/renderer/components/Character/CharacterDialogueChat/ConfigPanel.css` — 试验性警示样式
- `src/renderer/components/Character/CharacterDialogueChat/CharacterDialogueChat.tsx` — executeImageGeneration 集成
- `src/renderer/components/Character/CharacterDialogueChat/ChatMessageBubble.tsx` — 标签快照展示
- `src/renderer/components/Character/CharacterDialogueChat/ChatMessageBubble.css` — 被删除标签样式

## §7.37 ⚠️ 重点 — AI 标签优化反馈可见性修复（Spec: add-ai-trait-optimization-for-image-gen / 反馈缺失，2026-08-09）

### 背景

用户反馈：「勾选了允许 AI 优化特征标签，但是图片下的标签快照区域内没有显示删除了哪些标签，也没有删除标签专用的区域」。

§7.36 上线 AI 标签优化功能后，用户启用了开关并生成图片，但标签快照面板中始终看不到「AI 已移除」分区，误以为功能无效。

### 根因分析

原设计的「AI 已移除」分区渲染条件为：

```tsx
{currentHistoryItem.removedTags && currentHistoryItem.removedTags.length > 0 && (
  <div className="chat-msg-image-removed-tags">...</div>
)}
```

该条件**仅在 AI 实际删除了标签时才渲染**。但 AI 优化的执行结果有三种场景，其中两种不渲染分区：

| 场景 | removedTags | 分区是否渲染 | 用户感知 |
|------|-------------|-------------|---------|
| AI 成功删除标签 | 非空 | ✅ 渲染 | 看到「AI 已移除」分区 |
| AI 成功但无需删除（对话上下文无矛盾） | `undefined` | ❌ 不渲染 | **看不到任何反馈，误以为功能无效** |
| AI 调用失败（API 未配置/超时/返回非法 JSON） | `undefined` | ❌ 不渲染 | **看不到任何反馈，无法诊断失败原因** |

**核心问题**：缺少 AI 优化执行的反馈机制。用户启用功能后，无论 AI 是否运行、是否成功、是否删除标签，都得不到明确反馈。这与项目历史教训一致——「用户反馈"功能无效"时，第一问应是排查实际执行链路，而非假设组件有 Bug」。

### 解决方案

新增 `aiOptimization` 元数据字段到 `ImageHistoryItem`，记录 AI 优化的执行状态，无论是否删除标签都给出明确反馈。

#### 1. 类型扩展（CharacterDialogueChat.types.ts）

```typescript
aiOptimization?: {
  status: 'success' | 'no-removal' | 'failed';
  removedCount: number;
  error?: string;
};
```

- `success`：AI 成功执行并删除了标签（removedTags 非空）
- `no-removal`：AI 成功执行但本次对话上下文无需移除标签
- `failed`：AI 调用失败/超时/返回非法数据（error 字段记录原因）

#### 2. executeImageGeneration 状态跟踪（CharacterDialogueChat.tsx）

新增 `aiOptimizationStatus` / `aiOptimizationError` 局部变量，在 AI 优化各分支中更新状态：

```typescript
let aiOptimizationStatus: 'success' | 'no-removal' | 'failed' = 'no-removal';
let aiOptimizationError: string | undefined = undefined;

if (aiOptimizeEnabled && enabledTraitTexts.length > 0) {
  try {
    const optimizeResult = await window.electronAPI.ai.optimizeTraitsForContext({...});
    if (optimizeResult?.success && Array.isArray(optimizeResult.tagsToRemove)) {
      // ... 存在性过滤 + 过度删除防护
      if (validRemovals.length > 0) {
        // ... 执行过滤
        aiOptimizationStatus = 'success';
      } else {
        aiOptimizationStatus = 'no-removal';
      }
    } else if (optimizeResult && !optimizeResult.success) {
      aiOptimizationStatus = 'failed';
      aiOptimizationError = optimizeResult.error;
    }
  } catch (e) {
    aiOptimizationStatus = 'failed';
    aiOptimizationError = e instanceof Error ? e.message : String(e);
  }
}

// 写入 ImageHistoryItem
aiOptimization: aiOptimizeEnabled ? {
  status: aiOptimizationStatus,
  removedCount: removedTags.length,
  error: aiOptimizationError,
} : undefined,
```

#### 3. ChatMessageBubble 三态渲染（ChatMessageBubble.tsx）

**头部徽标**（面板折叠时也可见）：在「查看本次生成标签」按钮上新增 AI 优化徽标，三态颜色区分：
- `success`：绿色「AI 已移除 N」
- `no-removal`：灰色「AI 已分析」
- `failed`：红色「AI 失败」

**展开后详情分区**：基于 `aiOptimization` 而非 `removedTags` 渲染：
- `success`：展示被删除标签列表（灰色+删除线+悬停原因，与原设计一致，新增计数）
- `no-removal`：✅ 图标 + 「AI 已分析对话上下文，本次无需移除标签」
- `failed`：⚠️ 图标 + 「AI 标签优化失败：[error]」（悬停显示完整错误）

#### 4. CSS 样式（ChatMessageBubble.css）

新增 `.chat-msg-image-ai-badge-*` 三态徽标样式 + `.chat-msg-image-ai-optimization-*` 三态分区样式，遵循 `ui-variables.css` CSS 变量，兼容亮/暗双主题。

### 教训总结（重点标记）

- ⚠️ **「功能无效」类反馈的第一步应是验证实际执行链路**：本次用户反馈的根因不是组件 Bug，而是 AI 优化确实运行了但未删除标签（对话上下文无矛盾），原设计缺少「执行但无结果」的反馈。排查 IPC 链路时应先确认服务是否被调用、返回了什么，而非假设渲染逻辑有错
- ⚠️ **功能反馈不应仅覆盖成功路径**：设计「AI 做减法」类功能时，必须为三种结果（成功删除/成功但无需删除/失败）都提供 UI 反馈。仅覆盖「成功删除」会让用户在其余 90% 的场景下误以为功能无效
- ⚠️ **条件渲染应基于「功能是否启用」而非「功能是否有产出」**：原 `removedTags.length > 0` 条件本质是「功能有产出才显示」，应改为基于 `aiOptimization` 元数据（「功能启用了就显示执行状态」），让用户始终知道功能是否在工作
- 与项目历史教训呼应：「用户反馈"功能无效"时，第一问应是排查实际执行链路」（§7.35 / 项目 memory），本次再次验证

### 关键文件清单

- `src/renderer/components/Character/CharacterDialogueChat/CharacterDialogueChat.types.ts` — ImageHistoryItem 新增 `aiOptimization` 字段
- `src/renderer/components/Character/CharacterDialogueChat/CharacterDialogueChat.tsx` — executeImageGeneration 新增状态跟踪 + 写入 aiOptimization
- `src/renderer/components/Character/CharacterDialogueChat/ChatMessageBubble.tsx` — 三态渲染 + 头部徽标
- `src/renderer/components/Character/CharacterDialogueChat/ChatMessageBubble.css` — 徽标 + 分区三态样式

## §7.38 ⚠️ 重点 — AI 标签优化执行顺序修复 + 互动标签识别（Spec: add-ai-trait-optimization-for-image-gen，2026-08-09）

### 背景

用户反馈：「AI 还是没有删除必要的标签，而且没有识别上下文中关于互动的内容。原文里明确提到了 Fifi 看着 Pixel 像触电一样迅速抽回手…相关字样，但 AI 还是返回了标签 `disembodied_hand:1.2` 和 `hand_on_vulva:1.2`」。

§7.37 修复了反馈可见性后，用户发现 AI 优化虽然能执行，但并未删除矛盾的互动标签。

### 根因分析

`executeImageGeneration` 的标签处理流程存在**执行顺序缺陷**：

```
原流程：
步骤 3: enabledTraitTexts = 角色特征标签（已启用的）
步骤 AI优化: 只处理 enabledTraitTexts  ← 此时互动标签还没生成！
步骤 4: generateTraitPrompts 生成上下文标签（含 disembodied_hand 等互动标签）
步骤 5: 合并 → mergedTraits
步骤 6: 互动标签权重提升 → finalTraits (1.2 权重)
```

`disembodied_hand` 和 `hand_on_vulva` 是步骤 4 通过 `generateTraitPrompts` **动态生成的上下文互动标签**（权重 1.2 来自步骤 6 的 `interaction_weight` 默认值）。但 AI 优化在步骤 4 **之前**执行，只看到角色特征标签 `enabledTraitTexts`——**这两个互动标签在 AI 优化时根本不存在**，所以 AI 无法删除它们。

**核心问题**：AI 优化的执行时机错误。它应该在所有标签合并后执行（看到完整标签列表），而不是在上下文标签生成前执行（只看到角色特征标签）。

### 修复方案

#### 1. 执行顺序调整（CharacterDialogueChat.tsx）

将 AI 优化代码块从「步骤 4 之前」移动到「步骤 5 合并之后、步骤 6 权重提升之前」：

```
修复后流程：
步骤 3: enabledTraitTexts = 角色特征标签
步骤 4: generateTraitPrompts 生成上下文标签（含互动标签）
步骤 5: 合并 → mergedTraits（角色特征 + 上下文生成）
步骤 AI优化: 处理 mergedTraits  ← 此时能看到所有标签包括互动标签！
步骤 6: 互动标签权重提升 → finalTraits
```

关键改动：
- AI 优化入参从 `enabledTraitTexts` 改为 `mergedTraits`
- 存在性过滤从 `enabledTraitTexts` 改为 `mergedTraits`
- 过度删除防护的分母从 `enabledTraitTexts.length` 改为 `mergedTraits.length`
- 由于 `mergedTraits` 是 `const` 声明，使用 `mergedTraits.splice(0, mergedTraits.length, ...filteredTraits)` 原地替换（而非重新赋值），保证下游 `finalTraits = mergedTraits.map(...)` 能看到过滤后的数组

#### 2. System Prompt 增强（characterTraitAIService.ts）

原 prompt 只覆盖 clothing/pose/location/state 四种矛盾模式，缺少互动标签的移除场景。新增 **Interaction withdrawal** 模式：

- 明确告知 AI 标签列表包含「角色特征标签」和「动态生成的上下文互动标签」两类
- 列出互动标签的常见模式：`disembodied_*` / `hand_on_*` / `*_another` / `holding_*`
- 给出具体的移除触发词：抽回手 / 缩回手 / withdraw hand / pulled back / let go / 推开 / shoved away
- 给出具体的标签→场景映射（如「抽回手」→ 移除 `disembodied_hand` / `hand_on_vulva` / `hand_on_breast`）
- 在 IMPORTANT RULES 新增第 6 条：特别关注互动标签是否因对话进展而过时
- user message 标题从「角色特征标签」改为「图片生成标签列表（含角色特征 + 上下文互动标签）」，并提示注意互动标签

### 教训总结（重点标记）

- ⚠️ **「做减法」类功能必须在所有数据源合并后执行**：AI 优化是「删除矛盾标签」的减法操作，必须在所有标签来源（角色特征 + AI 生成的上下文标签）合并后才执行。在部分数据源生成前执行减法，等于对不完整的数据集做判断，必然遗漏。这与「防御性去重应在最后一环」的教训同类（项目 memory：prompt 构建链路最后一环必须做防御性去重）
- ⚠️ **动态生成内容不在静态数据集中**：`disembodied_hand` 等互动标签不是角色卡固定特征，而是 `generateTraitPrompts` 根据对话动态生成的。设计过滤/优化逻辑时必须区分「静态数据源」和「动态生成数据源」，确保优化步骤覆盖后者
- ⚠️ **权重值是数据来源的指纹**：本次诊断的关键线索是 `disembodied_hand:1.2` 的权重 1.2 正好等于 `interaction_weight` 默认值，据此推断该标签是互动标签（经步骤 6 权重提升），进而定位到执行顺序问题。排查标签来源时，权重值是重要的溯源依据
- ⚠️ **System Prompt 必须覆盖所有业务场景**：原 prompt 只覆盖 clothing/pose/location/state 四种矛盾，完全遗漏 interaction 场景。AI 的能力受限于 prompt 的场景枚举——prompt 没提到的场景，AI 不会主动处理

### 关键文件清单

- `src/renderer/components/Character/CharacterDialogueChat/CharacterDialogueChat.tsx` — AI 优化代码块移至 mergedTraits 之后
- `src/main/services/characterTraitAIService.ts` — system prompt 新增 Interaction withdrawal 模式

## §7.39 AI 标签优化补充能力：system prompt 重构 + 响应解析升级（Spec: add-ai-tag-supplement-after-removal / Task 2，2026-08-09）

### 背景

§7.36-§7.38 实现的 `optimizeTraitsForContext` 方法只能做「删除矛盾标签」的减法，但删除后可能产生描述缺失。例如对话中角色「脱下裤子」时移除 `pants` 标签，但下身暴露后缺少 `pussy` 等暴露特征标签，导致 SD 生成图片时下身描述不准确。

Spec `add-ai-tag-supplement-after-removal` 在一次 AI 调用中完成「删除矛盾标签 + 评估并补充缺失标签」的链式推理。Task 1 已在 `OptimizeTraitsResult` 接口新增 `tagsToAdd?` 字段，本 Task 2 实现服务层 system prompt 重构 + 响应解析器升级。

### 实施内容（`src/main/services/characterTraitAIService.ts`）

#### 1. System Prompt 重构为 TWO PARTS（SubTask 2.1）

原 prompt 只指导 AI 返回 `{ "remove": [...] }`，重构为：

- **PART 1 - REMOVAL**：保留原有矛盾模式列表（clothing / pose / location / state / interaction withdrawal §7.38）
- **PART 2 - SUPPLEMENT**：新增补充指令，覆盖四类常见补充模式：
  - Exposure after clothing removal：`pants` 移除 → 补 `pussy`；`bra` 移除 → 补 `breasts`；`covered_pussy` 移除 → 补 `pussy`
  - Pose transition：`sitting` 移除（站起）→ 补 `standing`
  - State transition：`closed_eyes` 移除（睁眼）→ 补 `open_eyes`
  - 仅补充必要标签，使用标准 Danbooru/e621 标签名
- **IMPORTANT RULES 新增第 7 条**：`add` 列表仅建议不在现有标签列表中的标签，且不补充同时建议删除的标签
- **JSON 返回格式**更新为 `{ "remove": [...], "add": [...] }`，无操作时返回 `{ "remove": [], "add": [] }`

#### 2. User Message 任务描述更新（SubTask 2.2 + 2.3）

任务描述从单部分（找矛盾删除）更新为两部分：(1) 找矛盾应删除的标签（含互动标签 withdrawal 识别）(2) 评估删除后是否有关键特征缺失需要补充。

#### 3. 响应解析器升级（SubTask 2.4）

`parseOptimizeResponse` 方法签名从 `Array<{ text, reason? }>` 升级为 `{ tagsToRemove, tagsToAdd }`：

- 同时解析 `remove` 与 `add` 两个字段
- `add` 项额外支持 `weight` / `categoryId`（与 `OptimizeTraitsResult.tagsToAdd` 字段对齐）
- **防御性过滤**：剔除 `tagsToAdd` 中与 `tagsToRemove` 同名（大小写不敏感）的项，兜底执行 IMPORTANT RULES 第 7 条（AI 偶发不遵守规则时的安全网）
- **向后兼容**：旧格式 `{ remove: [...] }`（无 add）→ `tagsToAdd` 为空；裸数组 `[{ text, reason }]` → 视为仅 remove

#### 4. 方法返回值更新（SubTask 2.5）

`optimizeTraitsForContext` 返回值新增 `tagsToAdd` 字段，与 `OptimizeTraitsResult` 接口对齐。日志同步增加 `suggestedSupplement` / `addedTags` 字段便于调试。

### 开发备注：TypeScript 类型推断问题

重构解析器时遇到 `TS7006: Parameter 't' implicitly has an 'any' type` 错误（防御性过滤的 `.map(t => ...)` / `.filter(t => ...)` 回调参数）。根因：`JSON.parse` 返回 `any`，经 `Array.isArray` 收窄为 `any[]` 后，链式 `.map(normalizeFn).filter(typePredicate)` 的类型推断在某些情况下未正确传播到后续链式调用的回调参数。

**修复方案**：为 `removeList` / `addList` 显式标注 `any[]`，为 `tagsToRemove` / `tagsToAdd` 显式标注目标数组类型，确保后续 `.map(t => ...)` / `.filter(t => ...)` 的 `t` 参数能从变量声明类型正确推断。此为开发过程中即时发现并修复的类型问题，非用户反馈 bug。

### 向后兼容性

- `OptimizeTraitsResult.tagsToAdd` 为可选字段（`?`），现有调用方（CharacterDialogueChat.tsx / IPC handler / electron.d.ts）无需修改即可编译通过
- 解析器兼容旧格式响应，AI 偶发只返回 `remove` 时不会报错
- 现有错误处理与降级逻辑（空输入短路 / 配置缺失 / HTTP 错误 / 超时 / 空内容）全部保留不变

### 关键文件清单

- `src/main/services/characterTraitAIService.ts` — system prompt TWO PARTS 重构 + user message 任务描述更新 + `parseOptimizeResponse` 解析器升级 + 方法返回值新增 `tagsToAdd` + 方法 JSDoc 更新

### 后续待办（Spec 后续 Task）

- ~~Task 3+：渲染层 `executeImageGeneration` 接线消费 `tagsToAdd`（合并到 mergedTraits + 记录到 ImageHistoryItem 快照）~~ ✅ 已完成（§7.40，2026-08-09）
- ~~过度补充防护（如限制单次补充标签数量上限）~~ ✅ 已完成（§7.40 SubTask 3.3，阈值 50%）
- 标签快照面板「AI 已补充」分区渲染（与「AI 已移除」对称）— Task 4 已完成（见 ChatMessageBubble.tsx）

## §7.40 AI 标签优化补充能力：渲染层 executeImageGeneration 消费 tagsToAdd（Spec: add-ai-tag-supplement-after-removal / Task 3，2026-08-09）

### 背景

§7.39 完成服务层 system prompt 重构与响应解析器升级，`optimizeTraitsForContext` 现在返回 `tagsToAdd?` 字段。本 Task 3 在渲染层 `executeImageGeneration` 中接线消费该字段，将 AI 建议补充的标签合并到 `mergedTraits`，并记录到 `ImageHistoryItem` 快照供 UI 展示。

### 实施内容（`src/renderer/components/Character/CharacterDialogueChat/CharacterDialogueChat.tsx`）

#### 1. 变量声明扩展

在 `removedTags` 声明旁新增 `addedTags` 快照变量（与 `removedTags` 同级，需在 AI 优化代码块外部声明，供 `newHistoryItem` 构建使用）：

```typescript
let removedTags: Array<{ text: string; reason?: string }> = [];
// 【Spec: add-ai-tag-supplement-after-removal / Task 3】补充标签快照，与 removedTags 对称
let addedTags: Array<{ text: string; reason?: string }> = [];
```

#### 2. tagsToAdd 处理逻辑（SubTask 3.1-3.5）

在现有 `tagsToRemove` 处理逻辑之后（独立 if 块，与 `tagsToRemove` 处理解耦），新增 `tagsToAdd` 处理：

- **SubTask 3.1 去重检查**：跳过已存在于 `mergedTraits` 中的标签（大小写不敏感）。注意此时 `mergedTraits` 已被 splice 过（删除已执行），所以是删除后的状态。
- **SubTask 3.2 冲突检查**：跳过在 `tagsToRemove`（刚被删除）中的标签。兜底执行 service 层 IMPORTANT RULES 第 7 条（AI 偶发不遵守规则时的安全网）。
- **SubTask 3.3 过度补充防护**：补充标签数 > 50% `mergedTraits.length` 时拒绝执行（与过度删除防护 80% 阈值对称但更宽松，补充比删除更安全）。
- **SubTask 3.4 合并到 mergedTraits**：将有效补充标签（保留 `weight` / `categoryId` 供后续互动标签权重提升使用）push 到 `mergedTraits`。
- **SubTask 3.5 构建 addedTags 快照**：仅保留 `text` / `reason`（与 `removedTags` 结构对称），用于 `ImageHistoryItem` 持久化与 UI 展示。

有实际补充操作时，将 `aiOptimizationStatus` 提升为 `'success'`（覆盖 `'no-removal'`；`'failed'` 不会进入此分支因为 `optimizeResult.success` 已为 true）。

#### 3. aiOptimization 元数据扩展（SubTask 3.6）

在 `newHistoryItem` 构建时，`aiOptimization` 对象新增 `addedCount` 字段（与 `removedCount` 对称）：

```typescript
aiOptimization: aiOptimizeEnabled ? {
  status: aiOptimizationStatus,
  removedCount: removedTags.length,
  addedCount: addedTags.length,  // 新增
  error: aiOptimizationError,
} : undefined,
```

#### 4. ImageHistoryItem 构建扩展（SubTask 3.7）

在 `newHistoryItem` 构建时，新增 `addedTags` 字段（与 `removedTags` 对称）：

```typescript
addedTags: addedTags.length > 0 ? addedTags : undefined,
```

#### 5. 诊断日志扩展（SubTask 3.8）

在 AI 优化代码块关键节点添加日志：
- 收到 AI 结果后：`console.log` 输出 AI 建议补充的标签（`AI 建议补充: [...]`）
- 去重/冲突过滤时：`console.log` / `console.warn` 输出跳过原因（已存在 / 冲突）
- 过度补充防护触发时：`console.warn` 输出补充比例
- 实际补充后：`console.log` 输出实际补充的标签与补充后标签总数

### 设计决策

#### 为什么 tagsToAdd 处理独立于 tagsToRemove 处理（独立 if 块而非嵌套）？

- 即使 `tagsToRemove` 不是数组（旧格式响应）但 `tagsToAdd` 存在，也能处理补充
- 即使 `tagsToRemove` 处理被过度删除防护拒绝（`mergedTraits` 未修改），`tagsToAdd` 仍可基于原始 `mergedTraits` 处理
- 解耦后逻辑更清晰，便于单独调试

#### 为什么过度补充阈值是 50% 而非 80%（删除阈值）？

补充比删除更安全（补充只是增加描述，删除可能丢失关键特征），但过度补充会稀释标签权重，导致 SD 生成图片时主要标签被弱化。50% 是平衡点：允许合理补充（如脱衣后补充 2-3 个暴露特征标签）但拒绝异常大批补充。

#### 为什么 addedTags 快照只保留 text/reason 而非全部字段？

与 `removedTags` 结构对称（UI 展示只需要文本和原因）。`weight` / `categoryId` 已通过 `mergedTraits` → `finalTraits` → `usedTags` 链路持久化，无需在 `addedTags` 中冗余存储。

### 向后兼容性

- `addedTags` 和 `addedCount` 都是可选字段（`?`），旧历史记录无此字段时 UI 不渲染「AI 已补充」分区
- 未启用 AI 优化时（`aiOptimizeEnabled=false`），`addedTags` 为 `undefined`，`aiOptimization` 为 `undefined`，行为与原实现一致
- AI 返回旧格式（无 `tagsToAdd`）时，`tagsToAdd` 处理逻辑被跳过，仅执行 `tagsToRemove` 处理

### 关键文件清单

- `src/renderer/components/Character/CharacterDialogueChat/CharacterDialogueChat.tsx` — `executeImageGeneration` 新增 `tagsToAdd` 处理逻辑 + `addedTags` 变量声明 + `newHistoryItem` 构建新增 `addedTags` / `addedCount` 字段


## §7.41 ⚠️ 重点 — 角色特征分类选择框 + 新增 tag 按钮不生效（currentTestChat 永不初始化，2026-08-09）

### 问题背景

用户反馈：右侧 ConfigPanel 的角色特征分类选择框（Checkbox）不生效，新增 tag 按钮也不生效。点击后无任何反应，无报错。

### 根因分析

经排查发现**两个复合 Bug**，均导致 `characterChatStore.currentTestChat` 永远为 `null`，进而使所有 `sessionTraits` 相关 action（`setSessionTraits` / `updateSessionTrait` / `addSessionTrait` / `removeSessionTrait` / `resetSessionTraits`）因 `if (!current) return` 守卫静默 no-op。

#### Bug 1：`saveTestChat` store action 的 `updateCurrent` 逻辑缺陷

`characterChatStore.ts` 的 `saveTestChat` action 在 IPC 返回后更新 `currentTestChat`：

```typescript
// 修复前（错误）
const updateCurrent =
  state.currentTestChat &&                           // ← null 时恒为 falsy！
  state.currentTestChat.creativeId === creativeId &&
  state.currentTestChat.characterCardId === characterCardId;

return {
  testChats: newTestChats,
  currentTestChat: updateCurrent ? chat : state.currentTestChat  // ← null 时保持 null
};
```

原意图是「只有当前正在查看这个对话时才更新 `currentTestChat`」，避免跨对话保存时串改。但 `state.currentTestChat &&` 在 `currentTestChat` 为 `null` 时整个表达式恒为 falsy，导致 `currentTestChat` **永远无法从 `null` 初始化**——它只在已经非 null 时才会被更新。

#### Bug 2：`loadChatHistory` 未在所有分支初始化 `currentTestChat`

`CharacterDialogueChat.hooks.ts` 的 `loadChatHistory` 直接调用 `getTestChat` IPC（绕过 store 的 `loadTestChat` action），且仅在特定分支调用 `saveChatToStore`（间接设置 `currentTestChat`）：

| 场景 | 是否调用 `saveChatToStore` | `currentTestChat` 结果 |
|------|---------------------------|----------------------|
| 有历史 + 需迁移 | ✅ 调用 | Bug 1 导致仍为 null |
| 有历史 + 无需迁移（最常见） | ❌ 不调用 | null |
| 无历史 + 有 first_mes | ✅ 调用 | Bug 1 导致仍为 null |
| 无历史 + 无 first_mes（空状态） | ❌ 不调用 | null |

**所有场景下 `currentTestChat` 都是 `null`**，sessionTraits action 全部静默失效。

### 修复方案

#### 修复 1：`saveTestChat` 初始化 `currentTestChat` 从 null

```typescript
// 修复后（正确）
const updateCurrent =
  !state.currentTestChat ||                          // ← null 时也更新
  (state.currentTestChat.creativeId === creativeId &&
   state.currentTestChat.characterCardId === characterCardId);
```

`null` 表示「尚未加载任何对话」，而 `saveTestChat` 一定来自当前正在查看的角色卡（`saveChatToStore` 在 hooks 中仅以 `characterInfo` 的 id 调用），初始化是安全的。

#### 修复 2：`loadChatHistory` 在所有分支显式设置 `currentTestChat`

1. **「有历史」分支**：在 dispatch 消息后、迁移检查前，显式调用 `setCurrentTestChat(savedChat)`（含与 `store.loadTestChat` 一致的 sessionTraits 安全映射）。覆盖「无需迁移」子场景（`saveChatToStore` 未调用）。

2. **「空状态」分支**：调用 `setCurrentTestChat(placeholder)`，占位对象 `messages: []`（与实际状态一致）。后续用户编辑特征时 `setSessionTraits` 调 `saveTestChat` 将其持久化到后端。

3. **「first_mes」分支**：依赖修复 1（`saveChatToStore([firstMessage])` 返回后 `currentTestChat` 被初始化）。未设占位对象，避免与并发 `saveChatToStore` 的 `messages` 产生竞态（占位 `messages: []` 可能覆盖正在保存的 `[firstMessage]`）。

### 教训总结（重点标记）

- ⚠️ **「条件更新」逻辑中的短路求值陷阱**：`obj && obj.field === value` 在 `obj` 为 null/undefined 时整个表达式为 falsy，不仅跳过了字段比较，还跳过了赋值。设计「仅在匹配时更新」逻辑时，null 应作为独立分支处理（`!obj || (obj.field === value)`），而非与字段判断共用 `&&` 短路。
- ⚠️ **store action 的「静默 no-op」是调试黑洞**：`if (!current) { console.warn(...); return; }` 模式在 `currentTestChat` 永远为 null 时，所有依赖 action 的 UI 元素表现为「点击无反应无报错」。store action 的前置守卫应考虑「前置条件是否可能永远不满足」——如果前置条件依赖另一个 action 的初始化，而那个 action 也有 Bug，则形成静默失效链。
- ⚠️ **「直接调 IPC」vs「走 store action」的初始化遗漏**：`loadChatHistory` 直接调用 `getTestChat` IPC（绕过 store 的 `loadTestChat` action），导致 store 状态（`currentTestChat`）与 IPC 返回值脱钩。store 的 `loadTestChat` action 本会正确设置 `currentTestChat`，但因未被调用而失效。在 store 之上封装 IPC 调用时，应确保所有调用路径都经过 store action，或在直接调 IPC 处手动同步 store 状态。
- ⚠️ **新增功能依赖的「隐式前置条件」需显式验证**：sessionTraits 功能（Spec: enhance-conversation-image-auditability）依赖 `currentTestChat` 非 null，但该前置条件在功能设计时被假设为「总是满足」（因为对话页面打开时应该有 currentTestChat）。实际上 `currentTestChat` 的初始化链路存在 Bug，导致前置条件不满足。新增功能时应显式验证所依赖的 store 状态在所有场景下都能正确初始化。

### 关键文件清单

- `src/renderer/stores/characterChatStore.ts` — `saveTestChat` action 的 `updateCurrent` 逻辑修复（`!state.currentTestChat ||` 补充 null 分支）
- `src/renderer/components/Character/CharacterDialogueChat/CharacterDialogueChat.hooks.ts` — `loadChatHistory` 新增 `setCurrentTestChat` 订阅 + 「有历史」分支显式设置 + 「空状态」分支占位对象初始化


## §7.42 服装状态提示词指令增强（Spec: add-costume-state-prompt-directives，2026-08-09）

### 问题背景

AI 图片生成流程中，`generateTraitPrompts`（标签生成）和 `optimizeTraitsForContext`（删除+补充审核）两个阶段对服装状态变化的处理不够精细。现有审核阶段仅覆盖"服装移除→暴露"一种模式，不覆盖"服装开合状态"（open_clothes）、"服装位置变化"（shorts_aside, panties_aside）和"身体部位暴露"（one_breast_out, off_shoulder）等场景。导致对话中描述"敞开夹克"、"拉下内裤"等服装状态变化时，AI 无法生成精准的视觉描述标签。

### 设计决策

| 决策点 | 选择 | 理由 |
|--------|------|------|
| 作用阶段 | 两个阶段都增强 | 生成阶段主动产出 + 审核阶段纠偏补缺，双重保障 |
| 标签参考机制 | 利用现有 RAG 标签库检索 | 复用 31.7 万条 Danbooru/e621 标签库，无需维护独立词典 |
| 扩展性设计 | 先实现服装，预留扩展接口 | 服装状态作为"状态变化检测"的第一个维度，后续可平行新增姿势/位置/情绪等 |
| 分类归属 | 不归入分类（使用 interaction 前缀） | 服装状态标签是上下文标签（非角色固有特征），与互动标签处理方式一致 |

### 实施内容

#### Task 1: 服装状态识别指令块（generateTraitPrompts 阶段）

新增 `buildCostumeStateGuidance()` 私有方法，返回服装状态识别指令块字符串。指令块包含 3 类 Danbooru 风格标签的命名规范和示例：

- **类型 A — 服装开合状态**：open_clothes, open_jacket, open_shirt, unbuttoned_shirt, zipper_open 等
- **类型 B — 服装位置变化**：panties_aside, shorts_aside, bra_lift, shirt_lift, skirt_lift, shorts_around_one_leg 等
- **类型 C — 身体部位暴露**：one_breast_out, both_breasts_out, off_shoulder, cleavage, underboob, navel, midriff 等

在 `buildDynamicTraitSystemPrompt` 中，`costumeStateGuidance` 拼接到 `interactionGuidance` 之后，两个指令块平行存在。

#### Task 2: RAG 服装状态标签检索增强

在 `generateTraitPrompts` 中，除了用对话上下文 `prompt` 检索 RAG 标签库外，额外用 `COSTUME_STATE_RAG_KEYWORDS`（22 个服装状态标签关键词）检索 RAG 标签库。检索结果以 `## 服装状态标签参考` 标题注入 system prompt，与现有 RAG 结果分区展示。RAG 未启用/检索失败时静默跳过。

#### Task 3: 审核阶段 system prompt 扩展（optimizeTraitsForContext 阶段）

**PART 1 REMOVAL 新增 2 条矛盾模式**：
- Clothing opening/closing change：对话描述扣上/拉开/合上衣物 → 移除 open_clothes/open_jacket/unbuttoned_shirt 等开合状态标签
- Clothing position reset：对话描述整理/穿好/复位衣物 → 移除 panties_aside/shorts_aside/shirt_lift 等位移状态标签

**PART 2 SUPPLEMENT 新增 3 条补充模式**：
- Opening → exposure：开合标签存在 → 补充暴露特征（open_shirt → cleavage/one_breast_out）
- Displacement → exposure：位移标签存在 → 补充暴露特征（panties_aside → pussy）
- Displacement → body part：位移标签存在 → 补充身体部位（shirt_lift → navel/midriff）

JSON 返回示例同步更新，包含 open_shirt remove 示例和 cleavage add 示例。

### 扩展接口预留

- `buildCostumeStateGuidance()` 为独立方法，后续可平行新增 `buildPoseStateGuidance()` 等方法
- `optimizeTraitsForContext` system prompt 中服装状态模式以独立条目组织，后续可平行新增其他维度
- 新增服装状态维度不需要修改现有互动标签指令代码

### 关键文件清单

- `src/main/services/characterTraitAIService.ts` — `buildCostumeStateGuidance()` 新增 + `buildDynamicTraitSystemPrompt` 拼接 + `generateTraitPrompts` RAG 检索增强 + `optimizeTraitsForContext` system prompt 扩展


## §7.43 ⚠️ 重点 — 对话图片表情与父对话气泡立绘不一致（2026-08-10）

### 问题背景

用户反馈：对话过程中生成的图片，其表情没有和父对话气泡保持一致。父对话气泡的表情立绘是"恼怒"，但图片的表情仍旧是"愉悦"、"挑逗"，没有更新。

### 根因分析

系统中存在**两套独立的表情机制**，在对话图片生成时断裂：

1. **表情立绘系统**（`expressionStore` + `EMOTION_PROMPT_MAP`）：根据 `message.emotion` 字段（如 `annoyance`）切换头像立绘，31 种预置情绪映射到 SD prompt（如 `annoyance` → `scowl, frown, narrowed_eyes, pouting, annoyed...`）

2. **对话图片生成**（`executeImageGeneration`）：从角色卡 `characterTraitStore.traits` 构建 `enabledTraitTexts`，其中 `expression` 分类的标签（如 `smile`）是**固定的角色特征**

**断裂点**在 `CharacterDialogueChat.tsx` 的 `executeImageGeneration` 函数：
- L400 读取了 `emotionSnapshot = parentMsg.emotion || 'default'`，但**只存入 `imageAttachment.emotion`**（用于立绘显示）
- L457 `enabledTraitTexts` 直接从 `currentTraits` 构建，**包含 `expression` 分类的固定标签**（如 `smile`）
- **没有用 `emotionSnapshot` 替换 expression 分类的标签**

**结果**：角色卡有 `expression:smile|微笑` → 对话情绪变成 `annoyance` → 图片生成仍用 `smile` → 图片表情与父对话气泡立绘不一致。

### 修复方案

在 `executeImageGeneration` 构建 `enabledTraitTexts` 后，用 `emotionSnapshot` 动态替换 `expression` 分类的固定标签：

1. **移除固定标签**：从 `enabledTraitTexts` 中移除 `categoryId === 'expression'` 的标签
2. **获取动态表情 prompt**：从 `EMOTION_PROMPT_MAP[emotionSnapshot]` 获取 positive prompt
3. **过滤冲突 tag**：过滤背景类（`simple_background` 等）和全身姿势类（`standing`/`arms_at_sides` 等），保留面部表情 + 动作 + 符号 tag
4. **注入动态标签**：将过滤后的 tag 加入 `enabledTraitTexts`（标记 `categoryId: 'expression'`），去重
5. **降级处理**：`emotionSnapshot` 不在 `EMOTION_PROMPT_MAP` 中时（自定义情绪或 default），恢复原 expression 分类固定标签

### 过滤策略

`EMOTION_PROMPT_MAP` 的每个情绪 prompt 包含 4 类 tag，过滤策略：
- ✅ **保留**：面部表情（`scowl`/`frown`/`narrowed_eyes`）+ 动作（`crossed_arms`/`hand_on_hip`/`head_tilt`）+ 符号（`anger_vein`/`sweatdrop`/`exclamation_point`）
- ❌ **过滤**：背景类（`*_background`/`sunny`/`blue_sky`）+ 光效氛围（`bokeh`/`soft_lighting`/`depth_of_field`）+ 背景装饰（`petals`/`confetti`/`rain`）+ 全身姿势（`standing`/`sitting`/`jumping`）+ 视线方向（`looking_at_viewer`/`looking_away`）

### 教训总结（重点标记）

- ⚠️ **两套独立机制的断裂是常见 bug 模式**：表情立绘系统（`EMOTION_PROMPT_MAP`）和对话图片生成（`enabledTraitTexts`）是两套独立机制，各自都能正常工作，但在对话图片生成场景下没有打通。设计新增功能时，应检查是否有"同类数据的不同来源"需要同步——此处 `emotion` 字段已存在于父消息上，但图片生成流程没有消费它。
- ⚠️ **「固定特征」vs「动态状态」的冲突**：角色卡 `expression` 分类的标签（如 `smile`）是固定特征，但表情本质是动态状态（随对话情绪变化）。将动态状态作为固定特征存储会导致无法响应状态变化。修复方式：在消费端（图片生成）根据动态状态（`emotion`）替换固定特征，而非在存储端修改。
- ⚠️ **prompt 注入需过滤冲突 tag**：`EMOTION_PROMPT_MAP` 的 prompt 是为表情立绘生成（face swap / ADetailer）设计的，包含背景/姿势/光效 tag。直接注入对话图片生成会与 `background`/`pose` 分类标签冲突。跨场景复用 prompt 时必须过滤目标场景已有的维度。

### 关键文件清单

- `src/renderer/components/Character/CharacterDialogueChat/CharacterDialogueChat.tsx` — `executeImageGeneration` 新增表情标签动态替换逻辑（L465-L519）+ import `EMOTION_PROMPT_MAP`（L18）


## §7.45 ⚠️ 重点 — GLM SSE 注释行导致 JSON 解析失败 + 恢复逻辑截断（2026-08-16）

### 问题背景

调用 GLM 模型时日志报错：
```
[WARN] [ai-handler] 普通 JSON 解析失败
  error: "Unexpected token ':', \": keep-ali\"... is not valid JSON"
  rawDataLength: 28624
[INFO] [ai-handler] 从原始数据中恢复内容成功
  restoredLength: 4
  fullContent: "芙琳！这"
```

28624 字节原始数据只恢复出 4 个字符，AI 回复内容严重截断。

### 根因分析

**两个复合 Bug**：

#### Bug 1：SSE 格式检测条件过于严格

`aiHandlers.ts` L525 原代码：
```javascript
if (accumulatedData.startsWith('data: ')) {
```

SSE 协议允许服务器发送注释行（以 `:` 开头），常用于 keep-alive 心跳。GLM API 返回的 SSE 数据以注释行开头：
```
: keep-alive

data: {"choices":[{"delta":{"content":"芙"}}]}
data: {"choices":[{"delta":{"content":"琳"}}]}
...
data: [DONE]
```

由于 `accumulatedData` 以 `: keep-alive` 开头而非 `data: `，检测条件为 `false`，走了"普通 JSON 解析"分支，`JSON.parse` 遇到 `: keep-alive` 报错 `Unexpected token ':', ": keep-ali"...`。

#### Bug 2：恢复逻辑取最后一个 content 导致截断

原恢复逻辑用正则 `/"content"\s*:\s*"((?:[^"\\]|\\.)*)"/g` 匹配所有 `content` 字段，取**最后一个**匹配。但 SSE 流式数据中每个 chunk 的 `delta.content` 是增量内容（如 "芙"/"琳"/"！"/"这"），最后一个 chunk 的 content 只有 "这" 一个字。

### 修复方案

#### 修复 1：SSE 格式检测条件

```javascript
// 修复前
if (accumulatedData.startsWith('data: ')) {

// 修复后
const isSSEFormat = accumulatedData.startsWith('data: ')
  || accumulatedData.startsWith(':')           // SSE 注释行开头
  || accumulatedData.includes('\ndata: ');     // 数据中包含 SSE data 行
if (isSSEFormat) {
```

SSE 行解析时已有的 `filter(line => line.trim().startsWith('data: '))` 会自动跳过注释行，无需额外修改。

#### 修复 2：恢复逻辑改为累加增量内容

```javascript
// 策略 1：累加所有 delta.content（流式 SSE 格式）
const sseDataLines = accumulatedData
  .split('\n')
  .filter(line => line.trim().startsWith('data: '))
  .map(line => line.trim().substring(6))
  .filter(line => line && line !== '[DONE]');
for (const line of sseDataLines) {
  const parsed = JSON.parse(line);
  if (parsed.choices?.[0]?.delta?.content) {
    recoveredContent += parsed.choices[0].delta.content;
  }
}

// 策略 2：回退到正则匹配最后一个 content（非流式格式）
if (!recoveredContent) { /* 原正则逻辑 */ }
```

### 教训总结（重点标记）

- ⚠️ **SSE 协议注释行是合法的**：SSE 规范允许以 `:` 开头的行作为注释，常用于 keep-alive 心跳。解析 SSE 数据时不能假设数据一定以 `data: ` 开头，必须处理注释行开头的场景。`startsWith('data: ')` 作为唯一检测条件过于严格，应改为 `startsWith(':') || includes('\ndata: ')` 等宽松检测。
- ⚠️ **流式增量 vs 完整内容**：SSE 流式响应中每个 chunk 的 `delta.content` 是增量内容（如 "芙"/"琳"），不是完整内容。恢复逻辑取最后一个匹配会丢失前面所有增量。正确做法是遍历所有 chunk 累加 `delta.content`，与 SSE 主解析逻辑保持一致。
- ⚠️ **不同 AI 供应商的 SSE 实现差异**：OpenAI API 的 SSE 数据通常直接以 `data: ` 开头（无注释行），而 GLM/智谱 API 会发送 `: keep-alive` 注释行作为心跳。适配多供应商时必须测试各家的非标准行为，不能以 OpenAI 的行为作为唯一参考。

### 关键文件清单

- `src/main/ipc/handlers/aiHandlers.ts` — SSE 格式检测条件修复（L525-L535）+ 恢复逻辑改为累加增量内容（L648-L704）


---

## §7.44 ⚠️ 重点 — SSE 跨 chunk 行丢失导致标签名损坏（2026-08-11）

### 现象

AI 回复中的系统控制标签（`<<<SUGGESTED_OPTIONS>>>`、`<<<EXPRESSION>>>`）在存储到 `message.content` 后出现标签名被截断的损坏：

| 数据来源 | SUGGESTED_OPTIONS | EXPRESSION | in_heat | 选项编号 |
|---------|-------------------|------------|---------|---------|
| 主进程日志（正确） | `<<<SUGGESTED_OPTIONS>>>` | `<<<EXPRESSION>>>` | `in_heat` | `1. 2. 3.` |
| 编辑视图 message.content（损坏） | `<<<SUGGED_OPTIONS>>>` | `<<<EXESSION>>>` | `in_` | `1. 2. .` |
| 对话气泡渲染（更损坏） | `<<<SUGGED_OPTIONS>>>` | `<<>>in_` | 丢失 | 合并 |

损坏程度随处理阶段递进：日志正确 → message.content 部分丢失 → 渲染后更严重（rehypeRaw 解析残留碎片）。

### 根因

**`ChatEngine.handleStream` 的 SSE 行计数方案存在缺陷**（`ChatEngine.ts` L454-L506）：

主进程通过 IPC 发送 `{ accumulatedData, chunk }` 给渲染进程，其中 `accumulatedData` 是完整累积的 SSE 原始数据。渲染进程用 `lastProcessedLineCount` 计数已处理的 `data:` 行数，通过 `dataLines.slice(lastProcessedLineCount)` 只处理新增行。

**问题**：当一个 SSE `data:` 行跨越多个网络 chunk 时：
1. **第一个 chunk** 包含不完整的 `data: {"choices":[{"delta":{"content":"<<<SUGG`（无尾部 `\n`）
2. 该不完整行被 `filter(line => line.startsWith('data: '))` 匹配，计入 `lastProcessedLineCount`
3. `parseSSEChunk` 尝试 JSON.parse 失败（不完整 JSON），无内容提取
4. **第二个 chunk** 补全该行为 `data: {"choices":[{"delta":{"content":"<<<SUGGESTED_OPTIONS>>>"}}]}\n`
5. 但 `dataLines.slice(lastProcessedLineCount)` 已跳过此行 → **内容永久丢失**

丢失的字符取决于 chunk 边界落在 SSE JSON 的哪个位置，解释了不规律的损坏模式：
- `SUGGESTED` → `SUGGED`（丢失 "EST"）
- `EXPRESSION` → `EXESSION`（丢失 "PR"）
- `in_heat` → `in_`（丢失 "heat"）
- `3.` → `.`（丢失 "3"）

### 修复方案

**1. 核心修复：`ChatEngine.ts` 行计数 → 字节偏移**

将 `lastProcessedLineCount`（行计数）替换为 `lastProcessedOffset`（字节偏移），只处理到最后一个 `\n` 为止的完整行：

```typescript
// handleStream: 只处理完整行
const lastNewlineIdx = fullData.lastIndexOf('\n');
if (lastNewlineIdx >= lastProcessedOffset) {
  const newData = fullData.substring(lastProcessedOffset, lastNewlineIdx + 1);
  lastProcessedOffset = lastNewlineIdx + 1;
  // ... 解析 newData 中的 data: 行
}
```

不完整的尾部行不会被计入 `lastProcessedOffset`，留到下次 chunk 到达时处理。

**2. 补齐处理：`handleComplete` 处理残留数据**

流结束时可能有不以 `\n` 结尾的最后一行，在 `handleComplete` 中补齐处理 `lastProcessedOffset` 之后的剩余数据。

**3. 防御性兜底：`stripSystemTags` + `parseExpressionFromContent` + 选项解析**

在渲染层和解析层增加对损坏标签变体的匹配能力：
- `stripSystemTags`：添加含 `SUGGEST`/`OPTIONS`/`EXPR` 关键字的损坏 `<<<...>>>` 标记匹配、HTML 风格标签碎片清理
- `parseExpressionFromContent`：添加通用 `<<<TAG>>>key<<<END_TAG>>>` 匹配模式（标签名 ≥4 字符）
- `onComplete` 选项解析：添加含 `OPTIONS` 关键字的损坏标记匹配

### 修改文件

- `src/renderer/components/Common/ChatEngine/ChatEngine.ts` — `handleStream` 行计数→字节偏移（L454-L506），`handleComplete` 补齐残留数据处理（L527-L552）
- `src/renderer/components/Character/CharacterDialogueChat/utils/messageProcessor.ts` — `stripSystemTags` 添加损坏标签变体匹配（L249-L265）
- `src/renderer/components/Character/CharacterDialogueChat/PromptBuilder.ts` — `parseExpressionFromContent` 添加通用兜底模式（L418-L423）
- `src/renderer/components/Character/CharacterDialogueChat/CharacterDialogueChat.hooks.ts` — 选项解析添加损坏变体匹配（L1331-L1335）

### 教训总结

- ⚠️ **SSE 流式解析不能用行计数跟踪进度**：网络 chunk 边界与 SSE 行边界不对齐，不完整的行会被误计入计数。必须用字节偏移，且只处理到最后一个 `\n` 为止的完整行。
- ⚠️ **`<<<TAG>>>` 语法与 HTML 解析冲突**：三重尖括号 `<<<TAG>>>` 会被 `rehypeRaw` 解析为 HTML 标签（`<` 文本 + `<TAG>` 标签 + `>>` 文本），`rehypeSanitize` 删除未知标签后留下碎片。必须在 HTML 解析前（`stripSystemTags`）彻底剥离。
- ⚠️ **防御性编程的多层兜底**：即使根因修复后，仍需在渲染层（`stripSystemTags`）和解析层（`parseExpressionFromContent`/选项解析）增加损坏变体匹配，处理旧消息或极端边缘情况。



---

## §8 禁词表功能实现方向修正 — 后处理过滤改为提示词注入（Spec: add-forbidden-words-prompt，2026-08-13）

### ⚠️【重点标记 - 用户反复提示才解决的问题】实现方向错误：内容过滤 ≠ 提示词注入

**现象（用户两次更正）：**
1. 第一次用户提出「过滤 AI 回复内容中的限制级词汇」，被实现为 **PostProcessingPipeline 后处理过滤插件**（BlockedWordsPlugin，priority=750）：将 AI 已输出内容中的禁词替换为 ****（含全词/通配符/正则三种匹配模式 + 正则缓存等复杂逻辑）
2. 用户立即更正：「不是内容过滤，而是让 AI 在回复时主动避开禁词，类似在提示词里加上 Forbidden Word List 指令块」，并要求按类别分组（Religious Terminology / Extreme Emotion Labels 等）、英文输出、带替代表达建议（Show, Don't Tell）
3. 完整实施后用户再次强调「需求有不明确的地方及时向我提问」，确认应为**提示词注入**而非事后过滤

**根因：**
- 对话中存在歧义：「过滤」在口语中既可指「事后替换」也可指「让其不出现」。未在动手前用 AskUserQuestion 澄清「过滤的实现机制」，直接按常见技术方案（正则后处理）实现
- 未关注用户示例中的关键信息：示例本身就是**提示词文本**（Forbidden Word List (Strict Constraints): ...），而非过滤规则配置——示例即答案，读题不仔细

**两方案本质区别：**
| 维度 | 后处理过滤（原实现，错误） | 提示词注入（最终实现，正确） |
|------|------------------------|--------------------------|
| 机制 | PostProcessingPipeline 插件（渲染后替换） | PromptComposer Provider（prompt 生成前注入） |
| 效果 | AI 先输出禁词再被替换（破坏语义连贯） | AI 从一开始就避免禁词（语义自然） |
| 数据模型 | 扁平 words 数组 + 匹配模式/大小写/替换文本 | 按类别分组（name/description/words/note） |
| 核心文件 | BlockedWordsPlugin + blockedWordsMatcher | ForbiddenWordsPromptProvider |
| 注入位置 | 后处理阶段 | suffix 区域（priority=460，FormatInstructionProvider 450 之后） |
| 输出语言 | 不适用 | 英文（用户指定；禁词本身保持原样含中文） |

**修复方案（完整实施）：**
1. **清理废弃实现**：删除 BlockedWordsPlugin / blockedWordsMatcher / 原 blockedWords.ts 类型及其测试；回滚 plugins/index.ts
2. **新数据模型**：ForbiddenWordsConfig { enabled, categories: ForbiddenWordCategory[] }，类别含 name/description/words/note?（src/shared/types/forbiddenWords.ts）
3. **ForbiddenWordsPromptProvider**（pipeline/providers/）：section='suffix'、priority=460，isActive 检查启用+类别非空，uild 生成英文 Forbidden Word List 指令块；通过 SettingStoreAccessor 依赖注入解耦（可测试）
4. **设置面板重写**：BlockedWordsSettings.tsx 改为类别管理（标题「内容约束」）；Settings.tsx 标签页名称同步改为「内容约束」，保存字段改为 orbiddenWords
5. **单元测试**：20 个用例覆盖 isActive / build 格式 / 多类别拼接 / 无效配置，全部通过

**输出格式（英文指令块）：**
`
Forbidden Word List (Strict Constraints):

No Religious Terminology: Do not use words related to religion, rituals, or divinity. Specifically, avoid terms such as "sacrifice", "offering", "sacred", "holy", and any similar descriptors.

No Extreme Emotion Labels: Do not use direct adjectives or nouns to label extreme psychological states. Specifically, avoid terms such as "crazy", "fear", "despair", and any similar terms.
Note: Instead of labeling these emotions, describe the physical manifestations and behavioral reactions to convey the intensity (Show, Don't Tell).
`

**涉及文件：**
- 删除：lockedWordsMatcher.ts + 测试、BlockedWordsPlugin.ts + 测试、src/shared/types/blockedWords.ts
- 新增：src/shared/types/forbiddenWords.ts、pipeline/providers/ForbiddenWordsPromptProvider.ts + 测试
- 修改：shared/types/index.ts、shared/settings.ts、
enderer/types/setting.ts、pipeline/providers/index.ts（注册 14 个 Provider）、Settings/BlockedWordsSettings.tsx（重写）、Settings/Settings.tsx、pipeline/plugins/index.ts（回滚）
- Git 分支/提交状态：未提交

**验证：**
- 20 个单元测试全部通过（ForbiddenWordsPromptProvider.test.ts）
- 全部变更文件 IDE 诊断零错误（tsc --noEmit 全量仅剩预存错误）

### 教训（重点标记）
- ⚠️ **动手前必须用 AskUserQuestion 澄清歧义术语**：「过滤」在需求中是「事后替换」还是「生成前规避」是完全不同的实现方向。当需求动词存在多种技术实现时，先问清机制再动手。本次第一版实现方向错误 = 大量返工（5 个文件 + 2 个测试文件废弃重建）
- ⚠️ **用户提供示例时，示例本身是最权威的需求说明书**：用户给出的 Forbidden Word List (Strict Constraints): ... 就是提示词文本，直接表明期望「提示词注入」方案。读需求时应先逐字分析示例内容，而非抽象归纳后套用工程惯例
- ⚠️ **先问再做优于快速交付**：本任务第一版实现（后处理过滤）表面上是「合理的技术选型」，但用户第二次仍需解释「不是内容过滤」——说明需求澄清不足。涉及架构方向的选择应先确认，避免表面正确、方向错误的交付

---

## §9 聊天参数面板 min_p 滑块无法拉到 0（2026-08-14）

### 现象
聊天模式的「AI 参数配置」面板中，min_p 参数文字显示默认值为 0，但将滑块拖到最左端时最低只能到达 0.01，无法精确到 0。

### 根因
ParameterPanel.tsx 的 
enderSlider 直接使用 antd v6 Slider（min=0, max=1, step=0.01）。antd Slider 内部按「位置比例 × (max-min) → 归一到 step 倍数」计算值，当鼠标拖到最左边缘 1-2px 时，计算值会落到第一个 tick（min + step = 0.01）而非 min（0）。

该问题影响所有 min=0 且 step 较小的参数滑块（min_p step=0.01、	op_k step=1、max_tokens step=256 等），但仅 min_p 被用户实际触发（0 表示"禁用"，用户需要真正到达 0）。

### 修复方案
在 
enderSlider 中新增 
ormalizeSliderValue 吸附函数：**当 config.min === 0 且 value 为第一个 tick（min + step）时，吸附回 min（0）**。onChange 与 onAfterChange 均应用吸附，保证拖动过程中与松手后显示一致。

`	ypescript
const normalizeSliderValue = (value: number): number => {
  if (config.min === 0 && value === config.min + config.step) return config.min;
  return value;
};
`

**副作用**：min=0 的滑块将无法设置第一个 tick 值（如 min_p=0.01、	op_k=1）。对实际使用场景（0 = 禁用/无限制，0.01 与 0 无实质差异；top_k=1 过窄无意义）可接受。

### 涉及文件
- src/renderer/components/Character/CharacterDialogueChat/ParameterPanel.tsx — 
enderSlider 新增 
ormalizeSliderValue，应用于 onChange/onAfterChange

### 验证
- TypeScript 诊断零错误（ParameterPanel.tsx）
- 待运行时验证：拖 min_p 滑块到最左端应显示 0.00（此前为 0.01）

### 第一轮修复失败：吸附 + 回弹复合问题

**现象**：第一轮修复（strict equality + 直接透传 handleSliderAfterChange）后，用户反馈"最小值变成 0.02 了"，比修复前更糟。

**排查**：两个独立问题叠加导致：

1. **浮点精度问题**：antd Slider 在最左端输出 0.009999... 等浮点值，alue === 0.01 严格比较不匹配，吸附失效。
2. **回弹问题**：即使吸附生效（0.01→0），handleSliderAfterChange 中"值等于 defaultValue(0) 则删除字段"逻辑触发，localValues.min_p 被删除，UI 回弹到 ffectiveParams.min_p（引擎配置值如 0.1）。

**修复**（2026-08-14）：
- 吸附阈值改为容差比较：alue < min + step * 1.5（覆盖浮点 0.0099~0.0149 范围）
- onAfterChange 中吸附生效时**跳过** handleSliderAfterChange 的删除字段逻辑，直接写入吸附值到 customParameters，确保不回弹
- 吸附阈值 1.5 倍：覆盖 antd 浮点误差（0.009999→0.014999），同时保留 0.02 及以上可设置

**涉及文件**：src/renderer/components/Character/CharacterDialogueChat/ParameterPanel.tsx — renderSlider 函数

**教训**：antd Slider min=0 边界问题本质是"最小 tick 不可达"。修复时必须同时处理两个问题：(1) 浮点吸附用容差比较；(2) 吸附后的值不能触发"值等于默认值则删除"逻辑，否则会回弹到引擎值。

---

## §7.46 ⚠️ 重点 — 角色卡智能助手未携带 AI 引擎全局 system_prompt（2026-08-19）

### ⚠️【重点标记 - 用户提示后发现的问题】

**现象（用户直接指出）：**
角色卡编辑智能助手（Spec: add-ai-assistant-for-character-card-editor）发送提问时，请求中的系统提示词只有助手自身的 `ASSISTANT_SYSTEM_PROMPT` + 角色卡上下文，**没有包含用户在 AI 引擎配置中设置的全局 `system_prompt`**。导致引擎级人设/风格约束（如语言偏好、输出风格要求）对助手失效。

**根因：**
`useCharacterCardAssistant.ts` 的 `sendQuestion` 中直接拼接：
```typescript
const systemPrompt = `${ASSISTANT_SYSTEM_PROMPT}\n\n${contextBlock}`;
```
未参考项目既有惯例——世界书 AI 操作（`useWorldBookAIOperations.ts` L662-664）、对话管线（`CharacterDialogueChat.hooks.ts` L1055）等所有 AI 调用点都会将 `engine.system_prompt` 前置到任务提示词：
```typescript
if (engine.system_prompt && engine.system_prompt.trim()) {
  systemPrompt = engine.system_prompt.trim() + '\n\n' + systemPrompt;
}
```
新增 AI 功能模块时遗漏了这一全局约定。

**修复：**
`useCharacterCardAssistant.ts` 构建系统提示词时前置引擎全局 `system_prompt`（引擎配置 → 助手任务提示词 → 角色卡上下文，三层拼接）：
```typescript
const globalSystemPrompt = activeEngine.system_prompt?.trim();
const assistantSystemPrompt = `${ASSISTANT_SYSTEM_PROMPT}\n\n${contextBlock}`;
const systemPrompt = globalSystemPrompt
  ? `${globalSystemPrompt}\n\n${assistantSystemPrompt}`
  : assistantSystemPrompt;
```
同时在日志中输出全局提示词携带状态（`✅ 已携带(N字符) / ❌ 未配置`），便于调试验证。

**涉及文件：**
- `src/renderer/components/Character/hooks/useCharacterCardAssistant.ts` — systemPrompt 构建逻辑（L317-L326）+ 日志增强（L338）

**验证：**
- TypeScript 诊断零错误（useCharacterCardAssistant.ts）
- 运行时验证：助手发送提问时日志应显示 `全局system_prompt: ✅ 已携带(N字符)`；AI 回复风格应遵循引擎全局提示词约束

### 教训（重点标记）
- ⚠️ **新增 AI 调用点必须携带引擎全局 system_prompt**：项目中所有既有 AI 功能（世界书操作、对话管线、角色卡字段操作）都遵循「引擎 system_prompt 前置 + 任务提示词」的拼接惯例。新增 AI 功能模块前应先检索 `engine.system_prompt` 的既有用法，保持一致性
- ⚠️ **AIEngineConfig 的 system_prompt 是用户级全局约束**：用户在设置中配置的引擎级提示词（语言、风格、行为约束）应作用于所有 AI 功能，遗漏会导致"设置不生效"类 Bug

---

## §7.47 — 智能助手改为自然对话式回复（去掉结构化建议格式，2026-08-19）

### 现象（用户反馈）

用户使用后反馈：「感觉智能助手回复太乱了，我只要一段修改建议就行，就像和正常的角色卡对话一样，我需要什么就自己复制出来，不需要特意格式化」。

### 根因

初版设计过度工程化：
1. `ASSISTANT_SYSTEM_PROMPT` 强制 AI 按固定模板输出（【建议】分隔 + 类型/标题/说明/内容/操作 五段式）
2. 前端 `parseAssistantSuggestions`（约 110 行）将响应解析为 `Suggestion[]` 结构化卡片
3. `AssistantSuggestionCard` 组件按类型图标+标签+代码块渲染，并提供"复制内容/复制全部"按钮

该设计的问题：模板化输出让 AI 回复僵硬割裂；解析器对模型输出变体容错要求高（TYPE_ALIASES 中英映射、内容/操作顺序互换兼容等）；用户实际只需要自然文本，自己选择复制。

### 修复方案（简化）

| 层 | 变更 |
|----|------|
| 提示词 | `ASSISTANT_SYSTEM_PROMPT` 删除「输出格式（严格遵守）」整节，改为「像正常聊天一样自然回复，可用 Markdown 排版但不要使用【建议】、类型：等固定格式模板」 |
| Hook | 删除 `TYPE_ALIASES`/`parseType`/`parseAssistantSuggestions`；缓存值简化为 `{ content, signature }`；assistant 消息不再携带 suggestions |
| 面板 | assistant 气泡直接渲染 `msg.content` 原始文本（pre-wrap）；删除建议卡片列表与复制提示条 |
| 组件 | 删除 `AssistantSuggestionCard.tsx` |
| 类型 | `assistant.types.ts` 移除 `SuggestionType`/`Suggestion`/`AssistantMessage.suggestions` |

保留能力：角色卡全字段上下文注入、引擎全局 system_prompt 前置、多轮对话（6 轮历史）、回复缓存与角色卡变更失效、"来自之前的回复"标签 + 重新生成、请求取消/重试。

### 涉及文件
- `src/renderer/utils/promptTemplates.ts` — ASSISTANT_SYSTEM_PROMPT 重写
- `src/renderer/components/Character/hooks/useCharacterCardAssistant.ts` — 删除解析逻辑
- `src/renderer/components/Character/CharacterCardAssistantPanel.tsx` — 直接渲染文本
- `src/renderer/components/Character/AssistantSuggestionCard.tsx` — 删除
- `src/shared/types/assistant.types.ts` — 类型简化

### 验证
- TypeScript 诊断零错误（相关文件）
- Vite HMR 生效

### 教训
- ⚠️ **助手类功能优先做"自然对话"，结构化解析是负担而非能力**：强模板输出+前端解析引入双重脆弱性（模型不遵守格式 → 解析失败回退原始文本；遵守格式 → 回复僵硬）。除非用户明确要求结构化交互（如卡片式选择），AI 回复应保持自然文本，把"复制什么"的选择权交给用户
- ⚠️ **spec 阶段的"结构化建议展示"需求未经用户确认就直接实现**：用户原始需求只说了"提供针对性的内容设计建议"和"支持一键复制"，并没有要求固定五段式模板+类型枚举。实现时自行加码了格式约定

---

## §7.48 ⚠️ 重点 — 安卓 release APK 明文 HTTP 被系统拦截：手机浏览器可访问但 App 报"无法连接到服务器"（2026-08-19）

### ⚠️【重点标记 - 真机实测发现的 Bug】

**现象（用户真机反馈）：**
手机浏览器访问 `http://192.168.3.43:8787/api/health` 正常返回 JSON，但安卓客户端（release APK）在连接页输入 `192.168.3.43:8787` 点"测试并连接"后提示 `[不可达] 无法连接到服务器`。

**排查过程：**
1. 排除网络/服务端问题：手机浏览器同 URL 可访问，`Get-NetIPAddress` 确认电脑局域网 IP，防火墙已加 8787 入站规则
2. 客户端地址处理无问题：`normalizeServerAddress('192.168.3.43:8787')` 校验通过，fetch 的是同一个 URL
3. **aapt2 解析两个 APK 的 Manifest**：debug APK `usesCleartextTraffic=true`，**release APK `usesCleartextTraffic=false`** —— Android 9+（API 28+）默认禁止应用发起明文 HTTP 请求，系统层直接拦截（浏览器不受此限制，所以浏览器正常）

**根因（两层）：**
1. RN Gradle 插件 `@react-native/gradle-plugin` 的 `AgpConfiguratorUtils.configureBuildTypesForApp`（`AgpConfiguratorUtils.kt` L39-41）通过 `androidComponents.finalizeDsl` 在 **DSL 定稿阶段**强制将 release 的 `usesCleartextTraffic` 占位符设为 `"false"`
2. `finalizeDsl` 回调在项目 build.gradle 所有常规配置（`defaultConfig`/`buildTypes` 的 `manifestPlaceholders`）**之后**执行，因此 build.gradle 里任何常规写法都会被覆盖（本项目最初在 `defaultConfig` 设置了 `manifestPlaceholders = [usesCleartextTraffic: true]`，实测被覆盖，无效）

**修复：**
`android-client/android/app/build.gradle` 末尾新增一个**后注册**的 `finalizeDsl` 回调（finalizeDsl 回调按注册顺序执行，插件先注册先执行、脚本后注册后执行，后者生效）：
```groovy
androidComponents {
    finalizeDsl { androidEx ->
        androidEx.buildTypes.getByName("release").manifestPlaceholders["usesCleartextTraffic"] = "true"
        androidEx.buildTypes.getByName("debug").manifestPlaceholders["usesCleartextTraffic"] = "true"
    }
}
```

**涉及文件：**
- `android-client/android/app/build.gradle` — 新增 finalizeDsl 反覆盖块（L110-123）；删除 defaultConfig 中被证明无效的占位符配置

**验证：**
- `gradlew assembleRelease` 重新构建后，aapt2 解析新 APK：`usesCleartextTraffic=true` ✅
- 新 APK 已复制到 `android-client/apk/creative-cafe-release.apk`（59MB，2026-08-19 15:56+ 构建）
- 真机复测：安装新 release APK 后连接 `192.168.3.43:8787` 应成功（待用户复核）

### 教训（重点标记）
- ⚠️ **RN Gradle 插件会用 `finalizeDsl` 强制覆盖 manifestPlaceholders**：凡是 RN 项目需要在 release 中放宽安全默认值（cleartext/备份策略等），常规 `manifestPlaceholders` 写法一律无效，必须用后注册的 `androidComponents.finalizeDsl` 反覆盖
- ⚠️ **明文 HTTP 的 Android 客户端，交付前必须用 aapt2 校验 release APK 的 `usesCleartextTraffic`**：`aapt2 dump xmltree --file AndroidManifest.xml <apk>`——本机无设备的静态验证也要覆盖 Manifest 安全属性，"构建成功"不等于"属性正确"
- ⚠️ **"浏览器能访问但 App 不能"是 cleartext 拦截的典型特征**：浏览器不走应用层 cleartext 策略，排查客户端网络问题时优先对比系统策略差异而非网络本身

---

## §7.49 — 智能助手回复改为流式响应（2026-08-19）

### 现象（用户反馈）

用户要求：「应该也以流式响应」——助手回复应与普通角色卡对话一样边生成边显示，而非等待完整响应后一次性渲染。

### 实现方案

复用项目既有流式管线（`defaultAIService.sendStreamChatRequest`，SSE 经主进程 `ai:stream` IPC 事件转发，`ai:cancel` 可中止）：

**1. `characterAIUtils.ts` 新增 `sendAssistantAIStreamRequest(engine, messages, callbacks)`**
- `onStream(chunk, isDone)`：chunk 为增量文本；`onError(message)`：失败（含取消中止）；`onComplete(fullContent)`：主进程汇总的完整内容（比流式累积更完整时覆盖）

**2. `useCharacterCardAssistant.ts` 流式状态管理**
- 请求前插入空 assistant 占位消息 → 每 chunk `updateLastAssistant(accumulated)` 增量更新（依赖 `[messages]` 的自动滚动随每次更新触发）
- `onComplete` 时若主进程完整内容更长则覆盖（防最后 chunk 解析丢失）
- 取消：保留已流出内容（为空则移除占位）；流式中断有部分内容：保留并提示「已保留部分生成内容」；完全失败：移除占位、保留用户问题便于重试
- **重试语义修复**：`replaceLastUser` 原实现 `slice(0, -1)` 只移除最后一条消息，在"错误后保留部分内容"场景下会残留旧 user 消息导致历史出现连续两条 user。改为 `stripLastRound()`（移除最后一条 user 及其后所有消息），无论上一轮以成功/失败/取消结束都能正确回退

**3. `CharacterCardAssistantPanel.tsx` 流式渲染**
- 流式占位（最后一条 assistant 且 content 为空 + isLoading）不渲染空气泡
- 加载文案区分：无内容时「正在思考...」，有内容流出后「正在生成...」

### 涉及文件
- `src/renderer/utils/characterAIUtils.ts` — 新增流式请求方法；顺手清理预存 TS6133（未使用的 `AIService` import、`ensurePositiveInteger`）
- `src/renderer/components/Character/hooks/useCharacterCardAssistant.ts` — 流式状态管理 + stripLastRound 重试语义修复
- `src/renderer/components/Character/CharacterCardAssistantPanel.tsx` — 占位气泡隐藏 + 加载文案区分

### 验证
- TypeScript 诊断零错误（三个涉及文件；tsc 全量输出中仅剩其他模块预存错误）
- Vite HMR 生效，主进程 ai:stream 管线运行正常（dev server 日志可见流式请求处理）

### 教训
- **流式取消/中断要区分三种收尾**：正常完成（写缓存）、用户取消（保留已流出内容）、错误中断（有部分内容保留+提示 / 无内容回退+可重试）。一次性追加 assistant 消息的写法无法直接套用到流式，状态机需重新设计
- **回调式错误处理无法 throw 到 await 调用方**（`sendStreamChatRequest` 的 onError 是回调），需用局部变量捕获错误、await 返回后再判断
- **流式场景下"替换最后一条"的重试逻辑必须按轮次回退**（stripLastRound），否则失败残留消息会破坏多轮历史构建

---

## §7.50 — 智能助手消息操作：重新生成 + 卷回到输入框（2026-08-19）

### 需求（用户反馈）

「智能助手里也添加重新生成和卷回的按钮」——与主对话（ChatMessageBubble）的消息操作交互保持一致。

### 主对话语义参照
- **卷回**（RollbackOutlined，用户消息上）：`rollbackToMessage(messageId)` → 截断该消息及其后所有消息，内容回填输入框（`CharacterDialogueChat.hooks.ts` L2765）
- **重新生成**（ReloadOutlined，AI 消息上）：重发该轮请求

### 实现

**Hook（`useCharacterCardAssistant.ts`）新增两个方法：**
```typescript
/** 重新生成最后一条回复：绕过缓存 + 替换最后一轮 */
regenerate(): 取最后一条 user 消息，sendQuestion(content, { replaceLastUser: true, forceRegenerate: true })

/** 卷回到指定用户消息：截断该消息及之后的所有消息，返回内容供回填输入框 */
rollbackToMessage(timestamp): 找到 user 消息 → 流式中先 cancel → setMessages(slice(0, idx)) → 返回 content
```

**Panel（`CharacterCardAssistantPanel.tsx`）：**
- 新增 `HoverActions` 组件（hover 渐显 opacity 0→1）
- 用户消息气泡左侧：「卷回到输入框（移除该消息及之后的对话）」，loading 中 disabled
- 最后一条回复气泡下方：「重新生成（忽略缓存）」，仅 `idx === messages.length - 1 && !!content && !isLoading` 时显示
- 移除原"来自之前的回复"标签旁的旧重新生成按钮（统一到新按钮），标签本身保留

**容器（`CharacterCardAssistant.tsx`）**：props 从 `onRegenerate(question)` 改为 `onRegenerateLast()` + `onRollbackMessage(timestamp)`，直接透传 hook 方法。

### 消息标识说明
AssistantMessage 无 id 字段，卷回以 `timestamp` 定位（同一毫秒内两条 user 消息理论上可能冲突，但面板串行发送下不可能出现）。

### 涉及文件
- `src/renderer/components/Character/hooks/useCharacterCardAssistant.ts` — regenerate / rollbackToMessage + 接口类型
- `src/renderer/components/Character/CharacterCardAssistantPanel.tsx` — HoverActions + 两个操作按钮
- `src/renderer/components/Character/CharacterCardAssistant.tsx` — props 透传调整

### 验证
- TypeScript 诊断零错误（三个涉及文件）
- Vite HMR 生效

## §7.51 安卓客户端 V2 功能补全与布局修复（Spec: fix-android-chat-feature-parity）

**日期**：2026-08-19　**类型**：功能补全 + 布局修复　**重点等级**：⚠️ 含重点陷阱记录

### 问题（用户反馈）

1. 功能模块缺失：用户人设、参数配置、记忆表格、图片生成、知识库检索等预期功能未实现
2. 布局错位：图片及相关板块元素重叠、位置偏移、尺寸异常（不同屏幕表现不一致）

### 修复内容

**服务端**（`src/main/services/lanApiServer/`）：
- `sessionConfigStore.ts`（新增）：每角色会话配置 JSON 持久化（人设/参数子集/知识库绑定/表格开关/停止序列）
- `dialogue.ts`：人设注入、参数覆盖、language/min_response_chars 约束、expression_display、停止序列合并、历史 RAG + KB RAG、记忆表格注入与编辑指令执行（SSE `table` 事件）
- `imageGeneration.ts`（新增）：headless 图片生成（traits+LoRA+情绪动态表情标签，对齐 §7.43；interaction 权重提升；regenerate history 追加）
- `personas.ts`（新增）：人设扫描与查询；`server.ts` 路由扩展 + `/api/assets` 白名单防穿越

**客户端**（`android-client/src/`）：
- 新组件：`SessionConfigSheet` / `ImageBubble` / `MemoryTableSheet`；`types.ts`/`client.ts`/`sse.ts` 扩展
- `ChatScreen.tsx` 布局修复 L1-L6：立绘 contain 自适应（onLoad 宽高比 + 四重限高）、键盘避让（keyboardDidShow/Hide → paddingBottom）、长文本折行（flexShrink+textBreakStrategy）、流式滚动 200ms 节流、气泡 maxWidth 三档分档（useWindowDimensions）、徽章流式布局避让

### ⚠️ 重点标记 1：max_tokens 配置陷阱（AI_EMPTY_RESPONSE）

- **现象**：curl 实测仅设 `max_tokens=1024` 稳定复现 `AI_EMPTY_RESPONSE`；`max_tokens=4096` 或不设置均正常
- **根因**：推理型模型 think 阶段消耗输出 token，上限过小 → 思考未完成即截断 → sanitizer 剥离 think 后正文为空
- **结论**：**配置指引问题，非代码缺陷**（桌面端同参数同样现象）；已写入 `docs/android-client.md` §2.2（建议 ≥4096 或不设置）
- **复现/验证记录**：`docs/android-client-test-report.md` V2.2 #10-#12

### ⚠️ 重点标记 2：RN 类型修正 4 处（初版编译错误）

1. `keyboardType='decimal'` → RN 合法值为 `'decimal-pad'`（KeyboardTypeOptions）
2. JSX 文本中 `{{user}}` 被解析为表达式 → 转义为 `{'{{user}}'}`
3. RN Text 属性为 `textBreakStrategy`（非 `breakStrategy`）
4. 其枚举值为 `'highQuality'`（非 CSS 风格 `'high-quality'`）

### 验证

- 服务端 curl 22 项全通过（图片真实生成 3.3MB/regen history+1/表格落库 5 表/SSE chunk→emotion→table→done/穿越 404/非法配置 400）
- 客户端 `npx tsc --noEmit` 0 错误；assembleDebug+assembleRelease BUILD SUCCESSFUL；aapt2 双变体 `usesCleartextTraffic=true`（对齐 §7.48 教训）
- 真机复核清单 10 项（三档屏幕）见测试报告 V2.5，待用户执行

## §7.52 安卓端图标字体未打包：所有按钮图标渲染失败（用户真机反馈"按钮全是紫色看不见"）

**日期**：2026-08-19　**类型**：构建配置缺失（BUG）　**重点等级**：⚠️⚠️ 用户真机实测反馈

### 问题（用户原话）

> 在安卓端的对话里的按钮全都看不见啊，都是紫色的

对话页所有图标按钮（顶栏返回/表格/设置/清空、发送按钮、生成图片、重试等）图标位置空白，只显示主题色（紫色）背景块 → 按钮"看不见"。

### 根因

`react-native-vector-icons` 的图标字体（MaterialCommunityIcons.ttf 等 19 个 .ttf）**从未被打包进 APK**：

- 解包 17:21 版 `creative-cafe-release1.apk` 检查：`assets/` 下**无任何 .ttf 条目**
- react-native-vector-icons 的 Android 官方集成要求在 `android/app/build.gradle` 添加：
  `apply from: "../../node_modules/react-native-vector-icons/fonts.gradle"`
- 该行自 V1 起就缺失 → 字体不进 APK → 图标组件 `fontFamily: 'MaterialCommunityIcons'` 解析失败 → 图标字符渲染为空，只剩背景色
- 桌面端 Web/Electron 无此机制（字体随 JS 加载），RN 端必须走 fonts.gradle，属 RN 特有集成步骤遗漏

### 修复

`android-client/android/app/build.gradle`（dependencies 块内）添加官方 fonts.gradle 应用（含详细注释说明本 BUG）。

### 关键验证（构建产物级）

- `copyReactNativeVectorIconFonts` 任务执行 → 新 APK `assets/fonts/` 含全部 19 个 .ttf（MaterialCommunityIcons.ttf 1,147,844 字节）
- APK 体积 59.3MB → 61.3MB（+2MB 字体，符合预期）
- `usesCleartextTraffic=true` 不受影响（aapt2 复验）
- debug/release 双变体 BUILD SUCCESSFUL；产物：`android-client/apk/creative-cafe-{debug,release}.apk`（2026-08-19 17:54 构建）

### ⚠️ 教训（对齐 §7.48 模式：构建产物内容必须解包验证）

1. RN 三方库"autolink 编译通过"≠"资源完整"——字体/manifest 等资源型依赖需单独集成步骤，构建成功不报错
2. 交付前应对 APK 做**内容级抽验**（fonts/manifest/JS bundle 关键符号），本次在 V2 静态验证清单中补充了 bundle 符号检查却漏了字体检查
3. 用户反馈"按钮紫色看不见"时优先怀疑：主题背景正常渲染 + 前景（图标字体）缺失 → 解包 APK 查资源

---

## §7.53 ⚠️⚠️ 重点 — 安卓端消息列表强制滚底：滚动修复代码因重复声明从未进包（用户真机二次反馈"上滑看历史被拉回底部"）

**日期**：2026-08-19　**类型**：AI 编辑引入的编译级回归 + 滚动逻辑平台兼容（BUG）　**重点等级**：⚠️⚠️⚠️ 用户真机实测二次反馈，修复未生效的根因是**上一轮修复代码本身打不进 APK**

### 问题（用户原话）

> 消息一直固定在最下方即使往上滑动想看一下之前的消息，仍旧会强制固定到最新的消息为止

### 根因（双层）

**第一层（真正的回归）**：上一轮 L7 滚动修复在应用编辑时，`ChatScreen.tsx` 中滚动逻辑代码块（`isNearBottomRef`/`lastContentHRef`/`onListScroll`/`scrollToBottom`）被**重复插入了两次**（原 L112-158 与 L220-266 完全相同的 `const` 声明）。同作用域重复 `const` 声明是语法错误 → Metro 打包 `createBundleReleaseJsAndAssets` 必然失败 → **修复从未进入任何 APK**，用户真机装的一直是 V2.5 旧包（无条件 `onContentSizeChange` 滚底），bug 自然依旧。

**第二层（滚动逻辑本身的平台兼容缺陷）**：Android Fabric 上 `onScroll` 事件的 `contentSize.height` 可能为 0，导致"用户是否在底部附近"（`isNearBottomRef`）计算失效回退初始值 `true` → 流式期间用户上滑后仍被判定"在底部"而持续跟底。

### 修复（android-client/src/screens/ChatScreen.tsx）

1. 删除重复声明的整块滚动逻辑（保留单份）
2. `onContentSizeChange={(_, contentH) => ...}` 直接用回调参数缓存内容高度到 `lastContentHRef`（该参数在 Fabric 上可靠），保证 `onListScroll` 距离计算始终有据可依
3. 最终生效的三层防护：
   - `onContentSizeChange` 仅在 `streaming` 期间触发跟随；静态浏览历史时任何内容尺寸变化（图片加载/windowing 重布局）都不滚底
   - 用户上滑离开底部 >80px 即暂停跟随，滚回底部自动恢复
   - 主动场景（发送消息/历史加载完成）用 `scrollToBottom(true)` 强制回底

### 模拟器实测（AVD test36 @ 1080x2400，连接 10.0.2.2:8787）

| 场景 | 操作 | 结果 |
|---|---|---|
| 静态浏览（Milf dog，59 条历史） | 上滑 1 屏 → 等 3s 再取证 | 位置纹丝不动 ✅ |
| 静态浏览·多屏 | 连续上滑 3 次到更早位置 → 等 8s | 同一消息同 bounds，未被拉回 ✅ |
| 流式期间上滑（AmazingAA） | 发送后 ~2.5s（流式进行中）上滑 2 次 → 等流结束 | 视图停留在中部历史位置（含失败气泡插入），未跟底 ✅ |
| 正常跟底 | 用户位于底部时流式输出 | 跟随最新消息 ✅ |

### ⚠️ 教训（流程级，比 §7.48/§7.52 更严重）

1. **"tsc 通过 + 构建成功"必须发生在"最后一次编辑之后"**——上轮验证顺序是 编辑→验证→又编辑（引入重复块）→直接交付，跳过了最终态验证。交付前必须以最终文件状态重跑 `tsc --noEmit` + `assembleRelease`
2. **AI 应用编辑（Edit 工具）插入大块代码时必须先检查目标锚点是否会导致重复**——本例是"移动代码块"操作被退化成"复制粘贴"
3. 模拟器复测脚本要点（本次踩坑记录）：
   - 发送后**不要按 BACK 收键盘**——发送使 `input disabled` 键盘会自动收起，此时 BACK 直接退出应用并取消 SSE 流（服务端不落盘，计数不变易误判为"发送失败"）
   - 流式期间 `uiautomator dump` 常报 `could not get idle state`（屏幕持续重绘），需轮询重试直到流结束
   - 键盘状态用 `dumpsys input_method | grep mInputShown` 校验，手势必须落在键盘收起后的列表区域
4. 模型首 token 延迟可达 15-30s（推理模型），流式滚动测试的窗口期要按"发送后 2~10s 内上滑"设计，不能等首 chunk 出现后再滑

## §7.54 安卓客户端 V3：对话模式对齐桌面端 + 亮暗主题切换（用户再次反馈功能不一致）

**日期**：2026-08-19　**类型**：功能对齐（FEATURE）+ 主题系统　**重点等级**：⚠️ 用户多轮反馈的功能差距收敛项

### 需求（用户原话）

> 还是跟pc端的对话模式功能不一致，比如思考内容处理。辅助模式、防重复强度预设等等，并且给一个主题切换的按钮，能够适配暗色模式/亮色模式

### 服务端实现（src/main/services/lanapiserver/）

1. **sessionConfigStore.ts 白名单扩展**：`LanCustomParameters` 新增 `think_tag_mode`（枚举校验 strip/strip_render/fold）、`assist_mode`（bool）、`frequency_penalty`/`presence_penalty`（-2..2）、`dry_multiplier`（0..2）
2. **dialogue.ts 思考三态**（权威全文策略随模式变化）：
   - `strip`：存储前剥离 `<think>`（V1/V2 默认行为）
   - `strip_render`：存储保留 `<think>`，SSE chunk 仍剥离（渲染端不可见，其他端可查原文）
   - `fold`：存储保留 + SSE 新增 `reasoning` 事件流式推送思考增量（`StreamSanitizer` 改造支持流式 think 直通）
3. **dialogue.ts 辅助模式**：`assist_mode=true` 时注入提示词要求回复末尾以固定标记输出 3 个推荐选项；`extractSuggestedOptions` 解析并从存储正文中剥离，经 SSE `options` 事件推送
4. **防重复参数注入**：frequency_penalty / presence_penalty / dry_multiplier 会话级覆盖注入 AI 请求（三档预设值见 docs/android-client.md §2.2）
5. 事件序列：`reasoning*? → chunk* → emotion? → table? → options? → done`（完全向后兼容）

### 客户端实现（android-client/src/）

1. **theme.ts（新）**：亮/暗 Palette（含 userBubble/aiBubble/reasoningBg 等语义色）+ Paper MD3 主题；`store.themeMode` AsyncStorage 持久化（纯外观，不违反"客户端无功能配置"约束）；连接页/列表页右上角太阳/月亮切换
2. **SessionConfigSheet**：思考内容处理三态 / 辅助模式开关 / 防重复三档 SegmentedButtons（按参数组合精确匹配回显高亮，手动改单值则不选中任何档）
3. **ChatScreen**：`ThinkingPanel`（fold 折叠面板：流式自动展开+ActivityIndicator，完成自动收起，点击切换）；`splitThink()` 提取 `<think>`；推荐选项 chips 点击即发送；样式全面改为 `createStyles(palette)` 工厂
4. ImageBubble / MemoryTableSheet / ConnectScreen / CharacterListScreen 全部主题化

### ⚠️ 本轮构建期发现并修复的三个问题（自查）

1. **ChatScreen 半成品状态**：V3 渲染逻辑（ThinkingPanel/options chips）先行写入，但底部样式块未替换（`createStyles` 未定义、缺 `thinkWrap`/`optionChip` 等样式键）——若直接构建必然 Metro 失败。修复：样式声明移至 renderItem 前 + 全量替换为工厂函数（再次印证 §7.53 教训：验证必须发生在最后一次编辑之后）
2. **RN 0.87 StatusBar 类型收紧**：edge-to-edge 下 `backgroundColor` 属性已从类型中移除，仅保留 `barStyle`（图标明暗）
3. **NumberField 作用域**：组件定义在 `createStyles` 作用域外却引用 `styles.field` → 改为 `style` prop 注入

### 验证

- 客户端 `npx tsc --noEmit` 0 错误（最终文件状态）
- 服务端全量 tsc：lanapiserver 相关文件 0 错误（renderer 782 个历史遗留错误与本次改动无关）
- `assembleRelease` BUILD SUCCESSFUL；APK 已复制 `android-client/apk/creative-cafe-release.apk`（19:37，61.3MB）
- 真机复核清单见 `docs/android-client.md` §5.4 第 9-12 项（思考折叠/辅助模式/防重复回显/主题切换与记忆）

## §7.55 移动端角色卡编辑模块：toSpecV3() 白名单过滤丢弃 worldBooks 导致关系写入读回为空

**日期**：2026-08-20　**类型**：架构级数据丢失 BUG（SERVICE）　**重点等级**：⚠️ 服务端冒烟测试发现的关键数据保真问题

### 现象

`PUT /api/characters/:id/worldbook-relations` 返回 HTTP 200 成功，但紧接的 GET 读回为空。关系写入成功但读回时被静默丢弃。

### 根因

`characterService.getWorldBookRelations` 内部调用 `readCharacter` → `CharacterCard.toSpecV3()`，该函数仅提取白名单字段（20 余个标准字段），`worldBooks` 作为项目自定义非标准字段被静默丢弃。`toSpecV3()` 是**白名单过滤**而非**保真传输**。

### 修复

`characterWrite.ts` 新增 `readRawCardData(filePath)`：直接解 PNG tEXt chunk（优先 v3 ccv3，回退 v2 chara），`JSON.parse` 原始数据，不经过 toSpecV3 白名单过滤。同时将 `updateCard`/`replaceAvatar`/关系读写全部改用 raw 级读取，保证编辑链路中 worldBooks 等非标准字段保真。

### 教训

- 扩展已有数据模型时，不能依赖第三方库的序列化/反序列化链路（白名单过滤），必须自己实现 raw 级读写。
- 冒烟测试设计必须覆盖**写入后立即读回**的闭环（而非仅检查 HTTP 响应码），否则此类"写成功但读不对"的 BUG 会被遗漏。


## §7.56 移动端对话交互对齐 PC：5 项用户报告缺陷 + 3 项实施中新发现缺陷（D1-D3）

**日期**：2026-08-20　**类型**：功能缺失 + 布局 BUG（CLIENT+SERVICE）　**重点等级**：⚠️ 用户报告的系统性功能对齐问题（spec: fix-android-chat-interaction-parity）

### 现象（用户报告 5 项）

1. 点击用户/系统头像无全屏查看（需放大/缩放/关闭）
2. 对话气泡形状、边角、颜色、对齐、内外边距与 PC 端不一致
3. 「卷回」「重新生成」按钮丢失
4. 辅助模式选项点击直接发送，应先填入输入框可编辑
5. 其他与 PC 端差异项

### 实施中新发现缺陷（⚠️ 重点标记）

- **D1【半成品代码】AvatarViewer 组件已实现并 import，但从未加入 JSX 渲染树**——state/handler 全存在，点击头像却无任何反应。教训：上下文截断/分段生成大型组件时，必须以"运行时点击实测"验证组件真正挂载，静态 tsc 通过不代表功能存在。
- **D2【flex 对齐陷阱】AI 头像沉底**：`bubbleRow.alignItems: 'flex-end'` + AI 头像 `alignSelf: 'flex-start'` 写在内层 Animated.View 而外层 Pressable 无 style——alignSelf 只影响无 style 的 Pressable **内部**（无效），Pressable 本身仍被容器底对齐。长 AI 消息时头像沉到消息底部甚至滚出屏幕。修复：容器改 `alignItems: 'flex-start'`。教训：RN 中 `alignSelf` 作用于**自身在父容器**中的对齐，包裹层（Pressable 无 style）会吞掉内层节点的 alignSelf。
- **D3【嵌套对齐失效】用户消息整体靠左**：`contentColUser.alignItems: 'flex-end'` 只让内容在 shrink-to-fit 的列**内部**右对齐，列本身仍贴左。修复：行级 `bubbleRowUser: { justifyContent: 'flex-end' }`（对齐 PC `.chat-msg-wrapper.is-user`）。教训：RN 嵌套 flex 的"右对齐"必须在外层 row 用 justifyContent，内层 alignItems 仅影响列内元素。

### 修复方案

- 服务端：`POST /api/chats/:characterId/rollback`（截断历史+持久化）；SSE `done` 新增 `userMessageId`（卷回/重新生成按服务端 id 定位，规避本地 localId 不一致）；辅助模式 options 持久化。
- 客户端：AvatarViewer 全屏查看器（捏合/双击/拖拽/三种关闭）；气泡样式对齐 PC CSS（圆角 18/小角 4/padding 16/12/名字行+情绪标签+序号徽章）；操作按钮行（复制/重新生成/卷回）；辅助模式 `setInput` 填入输入框。

### 验证

模拟器（AVD test36）12 用例全通过：五项功能全流程 + 空历史卷回/流式禁用边界 + 窄屏 343dp/常规/横屏三档 + 亮暗主题像素级验证（背景 #141110、AI 气泡 rgba(30,30,46,0.8) 与 PC 原值一致）。双指捏合缩放 adb 无法模拟，留待真机复核。完整记录见 `debug-chat-interaction-defects.md`。

### 测试方法学备注

- uiautomator dump 对 RN Fabric FlatList 不稳定（丢节点 + 显示滞后的旧内容），必须"重新 dump + 服务端 API 状态"双源交叉验证。
- PowerShell 传中文 JSON 到 curl 会编码损坏，服务端测试须用英文内容。
- 像素分析（screencap + System.Drawing）可弥补 dump 缺失，验证颜色/位置。

## §7.57 移动端角色列表排序与 PC 端不一致（收藏置顶缺失 + 收藏数据两端隔离）

**日期**：2026-08-20　**类型**：功能对齐缺陷（SERVICE+CLIENT）　**重点等级**：⚠️ 用户报告的对齐问题

### 现象

用户要求"角色列表的排序也和 PC 端保持相同的排序规则"。排查确认 PC 端排序规则（`CharacterSelectorPanel.tsx` sortedCharacters）：**收藏角色置顶（组内保持 readdir 顺序）→ 非收藏在后；搜索先过滤再分组**。移动端按 `/api/characters` 返回顺序直接渲染、无收藏概念，收藏置顶效果缺失。

### 根因

1. 移动端未实现收藏功能（无 UI/无排序分组）
2. 深层问题：PC 端收藏存于渲染进程 localStorage（zustand persist），**主进程与 LAN API 均无法读取**——即使移动端做收藏，两端数据也是隔离的，排序结果不可能一致

### 修复方案（收藏数据互通架构）

- 收藏唯一真源迁移到主进程文件 `userData/character-favorites.json`（存**文件名**而非绝对路径，角色目录迁移不失效）
- PC 端 favoritesStore：localStorage 保留为本地缓存，rehydrate 后与主进程文件对齐（文件有→覆盖本地；文件空且本地有→一次性上传迁移）；add/remove 双写主进程
- LAN API `GET/PUT /api/favorites`：移动端读写同一份文件
- 移动端角色列表：并行拉取 characters+favorites → 排序对齐 PC（收藏在前组内保序/非收藏在后/搜索先过滤再分组）→ 心形 toggle（乐观更新+PUT+失败回滚）

### 验证

服务端 API 5 用例全过（GET/PUT/回读/非数组 400/坏 JSON 400）；模拟器实测：收藏 Kanako+克拉拉（原 #2/#18）后置顶且组内保持 readdir 序、服务端改收藏后下拉刷新同步、搜索过滤后收藏仍置顶、心形 toggle 持久化生效；npm test 无新增回归。

### ⚠️ 经验教训

- **跨端共享数据必须落到服务端可读位置**：渲染进程 localStorage 是主进程/其他客户端的盲区，做多端一致功能前先审计数据存储位置
- PC 端同步采用"启动时对齐 + 变更时双写"弱一致模型（运行中的 PC 感知不到移动端修改，下次启动同步），足够收藏场景；强一致需引入推送机制（SSE/WS），勿过度设计
- PowerShell curl.exe 传 JSON 的引号转义坑再次确认：`-d '{\"k\":\"v\"}'` 会破坏 JSON，用 `Invoke-RestMethod -Body` 或临时文件
- Android 模拟器下拉刷新需**慢速长拖**（`input swipe y1 y2` 时长 ≥600ms）才能触发 RefreshControl，快速 swipe 会被当 fling

## §7.58 ⚠️ 重点 — PC 端世界书关系读写 via toSpecV3 白名单过滤丢弃 worldBooks（Spec: fix-worldbook-relation-and-vector-retrieval）

**日期**：2026-08-21　**类型**：架构级数据丢失 BUG（SERVICE）　**重点等级**：⚠️ 静态分析 + 运行时验证（§7.55 的 PC 端遗留问题）

### 现象

PC 端角色卡编辑器中，添加世界书关联后保存并重新打开，关联关系消失。`characterService.getWorldBookRelations` 始终返回空数组。

### 根因

§7.55 在移动端 LAN API 中修复了 `toSpecV3()` 白名单过滤丢弃 `worldBooks` 的问题，但 **PC 端主进程** `characterService.ts` 的 `getWorldBookRelations` / `setWorldBookRelations` 仍使用 `readCharacter()` → `CharacterCard.toSpecV3()` 路径，该函数仅提取 24 个标准字段，`worldBooks` 被静默丢弃。

### 修复

1. `characterService.ts` 新增 `readRawCardData(filePath)`：直接解 PNG tEXt chunk（优先 v3 ccv3，回退 v2 chara），不经过 `toSpecV3()` 白名单过滤（与 `characterWrite.ts` 同构）
2. `getWorldBookRelations` 改用 `readRawCardData` 读取 `data.worldBooks`
3. `setWorldBookRelations` 改用 `readRawCardData` 读取 + 合并写入后走 `writeCharacter`（双 spec 写回）
4. `addWorldBookRelation` / `removeWorldBookRelation` 底层复用修复后的方法，自动受益

### 验证

- 运行时验证脚本：创建含 worldBooks 的测试 PNG → `readRawCardData` 读回 2 条关联 → 新增 1 条后写回 → 读回 3 条 → 闭环验证通过
- 对比验证：模拟 `toSpecV3()` 白名单过滤确认 worldBooks 被丢弃（原 bug 复现）
- 编译零新增错误（VS Code 零诊断）

### 教训

- 修复 LAN API 时（§7.55）只覆盖了移动端（`characterWrite.ts`），未同步修复 PC 端主进程（`characterService.ts`）的同一问题。修复应统一检查所有调用路径，而不是仅修复单端。
- 跨端（PC LAN API / PC IPC / 移动端）的同一数据模型操作应共享底层读取逻辑，避免各端各自实现导致修复遗漏。

## §7.59 向量库多源检索过滤器数组绑定失败（Spec: fix-worldbook-relation-and-vector-retrieval）

**日期**：2026-08-21　**类型**：运行时静默失败 BUG（SERVICE）　**重点等级**：⚠️ 静态分析 + 运行时验证

### 现象

对话管线中向量库检索在指定多源过滤（如 `source: ['worldbook', 'knowledge', 'memory']`）时返回空结果，导致对话无法获取世界书/知识库的向量检索内容。

### 根因

`ContextManager.retrieveContext` / `retrieveContextWithKeywords` 将 `options.sources` 数组赋值给 `filter.source` 并传入 `vectorStoreService.search`。`SqliteVecBackend.buildFilterClause` 对 filter 值直接生成 `m.source = ?` SQL 并 `params.push(value)`，当 value 为数组时，better-sqlite3 无法绑定数组类型，抛出 `TypeError: Invalid value` → 整个 search 被 try/catch 捕获 → 返回空数组。

### 修复

`SqliteVecBackend.buildFilterClause` 增加数组类型处理：
- 数组值：生成 `m.source IN (?, ?, ...)` 子句，展开数组为独立参数
- 单值：保持 `m.source = ?` 不变（回归）
- 空数组：生成 `1=0` 避免 SQL 语法错误

### 验证

- 运行时验证脚本：旧行为 `m.source = ?` 生成 `params: [["worldbook","knowledge","memory"]]` → better-sqlite3 绑定失败；新行为 `m.source IN (?, ?, ?)` 生成 `params: ["worldbook","knowledge","memory"]` → 绑定成功
- 单值 filter 行为不变（`m.source = ?`）
- 空数组 filter 正确处理（`1=0`）
- 编译零新增错误（VS Code 零诊断）

### 教训

- 类型安全的 filter 接口应明确参数类型，避免使用者传入数组但底层不支持
- 静默失败（try/catch 返回空数组）比显式报错更难排查，搜索请求的异常应至少记录 warn 日志
- `buildFilterClause` 的白名单机制（METADATA_COLUMN_WHITELIST）已过滤非法字段，但合法字段的值类型校验缺失

---

## §7.60 ⚠️ 重点 — "以当前用户人设生成对话回复"按钮回显上一条消息（Spec: fix-user-reply-persona-echo，2026-08-27）

### 【重点标记】trailing-assistant 消息数组被后端视为续写前缀，导致模型原样回显

**现象：**
- 点击"以当前用户人设生成对话回复"按钮后，生成的"回复"并非基于用户人设的新内容，而是将对话中的上一条消息（通常为角色的 assistant 消息）原封不动返回到输入框

**根因（日志证据）：**
分析 `logs/ai-handler/ai-handler_20260827_210504.log` 中请求 `req-bc4fe8539372` 的入参发现：
- `generateUserReply` 将完整对话历史作为 `messages` 数组直接传给 `engine.sendMessage`，对话以角色的 assistant 消息结尾
- 该消息结构在 llama.cpp 等后端被解释为"对话续写前缀（prefill）"：模型任务是接续最后一条 assistant 消息继续写，而非响应新的 user 请求
- 结果模型直接"续写"出上一条消息的内容（即回显），系统提示中"扮演用户生成回复"的约束被消息结构完全压制

**修复方案（镜像 polishInput 的上下文隔离模式，Spec: fix-polish-context-isolation）：**
1. **PromptBuilder.ts** — `buildUserReplySystemPrompt` 新增可选参数 `conversationHistory?: ChatMessage[]`，将对话历史格式化为文本（`[用户名]: ...` / `[角色名]: ...`）嵌入系统提示的"## 对话历史"段落
2. **CharacterDialogueChat.hooks.ts** — `generateUserReply` 重构消息结构：
   - 构建 preliminary 系统提示（不含历史）专用于 token 计数与裁剪预算估算
   - ContextTruncator 裁剪逻辑保持不变（仍对 contextMessages 操作）
   - 裁剪后调用 `buildUserReplySystemPrompt` 传入裁剪后的 contextMessages，构建最终系统提示（历史在系统提示内，不再进入 messages 数组）
   - `engine.sendMessage` 改为发送**单条 user 角色请求消息**（含 id/timestamp/status 的 ChatMessage 结构），内容为"请以 {userName} 的身份，直接输出下一句回复内容本身。"

**修改文件：**
- `src/renderer/components/Character/CharacterDialogueChat/PromptBuilder.ts` — `buildUserReplySystemPrompt` 签名扩展 + "## 对话历史"段落
- `src/renderer/components/Character/CharacterDialogueChat/CharacterDialogueChat.hooks.ts` — `generateUserReply` 消息结构重构（preliminary 提示 / 裁剪后构建最终提示 / 单条 user 请求消息）

**教训：**
- 以 assistant 消息结尾的 messages 数组对续写型后端（llama.cpp 等）等效于 prefill 前缀，模型会接续而非响应——任何"生成新内容"的请求都不应携带 trailing-assistant 历史
- 系统提示中的角色指令无法对抗消息结构层面的续写暗示；上下文隔离（历史嵌入 system + 单条 user 请求）是根治手段，而非权宜补丁
- 本修复与 §fix-polish-context-isolation（润色功能同型问题）构成可复用模式：凡"AI 扮演特定身份生成文本"的功能，一律采用"历史入 system、请求入单条 user"结构

---

## §7.61 ⚠️ 重点 — 对话模式世界书关联失效 + qwen 思考模型标签输出缺失（Spec: fix-dialogue-worldbook-association-and-tag-output，2026-08-28）

### 问题一：对话模式无法关联世界书内容

**根因（代码证据）：**
- 对话检索入口 `retrieveWithKeywords` 被 `scopeIds` 门控（ContextManager.ts:211），而 hooks 仅传入对话配置的 `boundKnowledgeBaseIds`（知识库绑定）
- **角色卡世界书关联（data.worldBooks）在对话检索链路中没有任何消费方**——§7.55/§7.58 修复了关联的读写保真，但对话检索侧从未接入；用户在角色管理里关联的世界书对话时从不触发
- 次要：constant（蓝灯）条目无关键词即永不注入；`enabled:false` 禁用语义不识别（只认 `disable:true`，双字段并存）

**修复：**
1. `CharacterDialogueChat.hooks.ts` — 检索请求构造处读取角色卡关联（`character.getWorldBookRelations(characterCardId)`，characterCardId 即角色卡文件路径），启用的 `worldBookPath` 并入 scopeIds 与绑定去重合并；IPC 异常回退仅绑定列表不阻断
2. `WorldBookKeywordMatcher.ts` — `match()` 步骤0 无条件并入 constant 条目（`matchConstantEntry` 仅受概率过滤），候选循环按 uid 去重；空文本时仅常驻生效
3. `WorldBookKeywordIndex.ts` — 新增导出 `isEntryDisabled`（`disable===true || enabled===false`），rebuild/upsertEntry 统一使用；新增 `getConstantEntries()`

### 问题二：qwen3.8-next-flash 不输出表情/辅助模式标签

**根因（代码证据）：**
- 续写模式提示词硬冲突：`creative-chat.continuation` 模板【严格禁止】"禁止添加任何标签"，但表情提示词对续写同样注入（hooks 无 promptType 判断）；且**标签提醒仅注入 dialogue 模式**——续写场景指令自相矛盾
- 思考常开（qwen3.8 preset 特性）下格式指令被思维链"吸收"，正文直接 stop 不带标签；无"未生成 vs 解析丢失"的定性手段，截断时（finish_reason=length）标签位于末尾最先丢失
- **持久化模板迁移陷阱**：`mergeNewDefaultTemplates` 只补充新增 moduleId，改内置种子对已有安装的持久化副本永远不生效（"文件已保存 ≠ 运行时已生效"的又一实例）

**修复：**
1. continuation 模板白名单豁免表情/选项标签——**三处同步**：内置种子（promptTemplateService.ts）、PromptBuilder 硬编码回退、持久化副本按锚点非破坏性迁移（新增 `migrateContinuationWhitelist`：已含 EXPRESSION 跳过 / 无锚点（用户深度自定义）跳过 / 异常不阻断启动）
2. 标签提醒注入范围扩展到 continuation（hooks.ts）
3. 定性诊断 + 单次补发（hooks.ts onComplete，think 剥离后、解析前）：
   - 判据：正文不含 EXPRESSION/OPTIONS 关键字 → 未生成；含关键字但解析失败 → 解析问题（既有诊断日志定位）
   - `finish_reason=length` → 截断专项 warn，不补发（补发同样截断）
   - `finish_reason=stop` → 独立 `new ChatEngine()` 实例发起一次补发（短提示词：末尾 400 字 + 格式要求 + 可用情绪键，30s 超时兜底），`thinking_mode:'off'` 请求级关思考防补发再被吸收，成功后标签行追加正文交由现有解析器；失败 warn 保持现状不循环

**修改文件：**
- `src/renderer/components/Character/CharacterDialogueChat/CharacterDialogueChat.hooks.ts`
- `src/main/services/WorldBookKeywordMatcher.ts` / `WorldBookKeywordIndex.ts`
- `src/main/services/promptTemplateService.ts`
- `src/renderer/components/Character/CharacterDialogueChat/PromptBuilder.ts`

**验证：**
- WorldBookKeywordIndex 26 测试 + 对话链路 371 测试全部通过；tsc 改动文件零新增错误
- 运行时判据日志：`Calling retrieveWithKeywords with scopeIds`（应含角色卡关联路径）、`角色卡世界书关联: N 条`、`关键词匹配返回: N 个匹配`、`标签缺失定性`、`标签补发成功/失败`

**教训：**
- 关联关系"能保存能回显"≠"运行时被消费"——读写保真修复（§7.55/§7.58）后必须检查消费方是否接入
- 提示词模板的持久化副本会永久固化旧内容：任何模板内容修复必须同步处理"内置种子 + 硬编码回退 + 存量副本迁移"三处，缺一即对已有安装无效
- 思考模型的格式遵循需要"末尾 user 提醒 + 未生成时请求级关思考补发"双保险，仅靠 system 指令会被思维链稀释

---

## §7.62 ⚠️ 重点 — 素材管理 AI 功能误报"AI 引擎未配置"（2026-08-28，用户报告）

### 【重点标记】本地无密钥引擎被强校验 apiKey 一刀切拦截

**现象：**
角色卡素材管理相关 AI 功能（特征生成/图片特征识别/特征提示词生成/标签优化/表情生成）一律报错「AI 引擎未配置，请先在设置中配置 API」，而对话功能完全正常

**根因（配置实证）：**
- 当前激活引擎"本地引擎qwen3.8"（llama-server 127.0.0.1:5000）`api_key` 为空——本地引擎无需密钥，这是**合法配置**
- `characterTraitAIService.ts` 全部 5 个 AI 方法把 `!apiKey` 与 `!baseUrl`/`!modelName` 同等对待，直接返回"未配置"错误
- 对话链路（ChatEngine）从不要求 apiKey，故仅主进程 AI 服务报错——同一引擎在两条链路行为不一致

**修复（characterTraitAIService.ts）：**
1. 5 处校验点放宽：apiKey 为空 → console.warn 继续调用（远程服务缺 key 由 HTTP 401 报错，语义更准确）
2. 2 处 header 构建补 `if (apiKey)` 守卫（generateTraitPrompts/TraitOptimize）：空 key 不发送 `Authorization: Bearer `（空头）/`api_key` 字段，与 generateCharacterTraits/recognizeImageTraits 既有守卫对齐
3. baseUrl / modelName / temperature / max_tokens 校验保持不变（必需项语义不变）

**同型隐患（未修，另行立项）：**
- `AIConfigProvider.getApiKey()`（抛错型，TableOrganizeService 表格整理消费）对空 apiKey 抛"未配置 API Key"——本地引擎下表格整理会报同型错误
- writing/* 各服务经 getAIConfig 拿到空 apiKey 后的强校验情况未逐一排查

**教训：**
- apiKey 必填是远程 SaaS 时代假设；多引擎架构下"本地引擎无密钥"是一等公民场景，主进程所有 AI 服务校验须与对话链路（不要求 apiKey）对齐
- 排查此类问题最快路径：先读 `%APPDATA%/creative-cafe/data/settings.json` 的 aiEngines 实际数据，再对照校验代码，避免猜配置

---

## §7.63 ⚠️ 重点 — RAG 索引误报 stale（mtime 触碰即要求重向量化 37 分钟）（2026-08-28，用户报告）

### 【重点标记】CSV 指纹含 mtimeMs，内容未变也被判 stale

**现象：**
素材管理一直提示「⚠️ RAG 索引状态为 stale，请先在设置面板完成向量化」，而标签库 CSV（22 万条）实际从未变更

**根因（配置 + 指纹实证）：**
- 指纹算法 `sha256(csvPath:size:mtimeMs)`（tagRagService.computeCsvHash 与 tagAutocompleteService.notifyCsvLoaded 两处）——**CSV 文件的 mtime 被触碰即指纹变化**
- 实测：当前指纹 `30f5dc2618f7fe55` ≠ meta.csvHash `2af350ff6a86e6d6`，dimension(1024)/model(bge-m3-f16.gguf) 均一致 → 唯一命中 csvHash 条件
- CSV 内容未变（8MB 静态库），仅 mtime 因 git/复制/同步等操作变化；重向量化成本 ~37 分钟（meta.durationMs=2204401）

**修复（tagRagService.ts）：**
1. `computeCsvHash` 改为**内容 sha256**（slice 16），以 (path → size+mtimeMs → hash) 内存缓存：mtime 未变零读取；mtime 变化时重算一次内容哈希（8MB ~50ms），内容未变则不 stale
2. `computeFreshness` 增加存量 meta 一次性迁移：meta.csvHash 与旧算法指纹匹配 → 证明 path/size/mtime 自向量化以来均未变 → 原地迁移为新算法值并持久化，返回 ready
3. `tag-csv-loaded` 事件监听器改用 `computeCsvHash()` 比对（原用 payload 中的旧算法 hash，口径不一致会误报）
4. vectorizeAll 完成后 meta.csvHash 自动写入新算法值（无需额外改动）

**用户存量数据注意：**
当前 meta.csvHash 与旧算法指纹不匹配（mtime 已变）→ 迁移不命中 → **需重新向量化一次（~37 分钟）**。此后 mtime 触碰不再误报，仅 CSV 内容真正变化才会要求重向量。

**教训：**
- "轻量指纹"（path:size:mtime）隐含假设"文件不被触碰"——在 git/同步工具环境不成立；内容指纹 + stat 缓存是正确折中（mtime 稳定时零成本，变化时 50ms 一次）
- 同一指纹存在双实现（tagAutocompleteService 与 tagRagService）且算法漂移，修复时必须统一口径

---

## §7.64 — 角色卡润色/翻译/生成按钮超时（TimeoutError: timed out）改为流式响应（2026-08-28，用户需求）

**现象：**
角色卡编辑器的润色/翻译/生成按钮频繁报 `TimeoutError: timed out`

**根因：**
三个按钮走 `defaultAIService.sendChatRequest`（**非流式**）→ 主进程 aiHandlers 需等待完整响应体（qwen 思考模型含思维链，可能长达数分钟）才返回响应头 → 超过请求超时（AIService 默认 timeout=600s，aiHandlers 引擎级 request_timeout 默认 300s）被 AbortController 中止

**修复（useCharacterAIOperations.ts）：**
1. 三处调用改为 `sendAssistantAIStreamRequest`（SSE 流式，主进程流式分支收到首包后即清除连接/请求超时定时器 aiHandlers.ts:284-293 → **长生成不再超时**）
2. 新增 `runStreamingAI` 内部执行器：onStream 增量实时写入表单字段（打字机预览）；onComplete 取服务器合并内容（优先于流式累积）
3. 中断/失败/空结果时恢复字段原值（流式预览可能已写入半截内容）；成功路径沿用既有清理逻辑（思考前缀正则、译文/润色前缀、顿号分隔）
4. 用户取消链路不变（ai.cancel → 主进程 abort → onError，isProcessingRef 判定静默）

**效果：**
- TimeoutError 消失（流式响应头立即返回，超时定时器只覆盖首包等待窗口）
- 字段内容实时流式显示，长生成体验与对话一致

## §7.65 ⚠️ 重点 — 世界书 AI 按钮仍报"请求超时"：timeout:0 未跳过连接超时（2026-08-31，用户两次反馈）

**⚠️ 本条为"用户明确要求后第一次修复仍不彻底、再次反馈才补全"的问题，重点标记。**

**现象：**
世界书条目润色/审查等按钮报 `[ai-handler] [req-xxx] 请求超时: API请求超过了设定的超时时间`，按钮弹回。此前的第一轮修复（13 处 `ai.request` 全部补 `timeout: 0`）**未能消除**该报错。

**根因（双重超时陷阱）：**
主进程 `aiHandlers.ts` 非流式分支存在**两个独立超时定时器**：
1. **请求超时**（等待完整响应体）：`effectiveTimeout = timeout === 0 ? 0 : (timeout || 配置值)` —— `timeout: 0` 可跳过 ✅
2. **连接超时**（等待响应头）：独立取引擎级 `connection_timeout`（多数引擎为默认 120s）—— **不受 timeout:0 影响** ❌

关键事实：**非流式 LLM 生成完成前不返回响应头**（TTFB = 完整生成时长）。因此即使 `timeout: 0` 跳过了请求超时，连接超时定时器仍在 120s 处 abort → fetch 抛 "This operation was aborted" → 命中 catch 分支 `error.message.includes('abort')` → 返回「请求超时」。实测引擎配置：Gemma4-bf16/muse/Deepseek/Proxy 均 connection_timeout=120000，长生成必被中止。

**修复（aiHandlers.ts，流式 + 非流式两分支同步）：**
`timeout === 0` 语义升级为「完全无限制」：同时将连接超时与请求超时置 0（不设任何定时器）。
```typescript
const callerUnlimited = timeout === 0;
const CONNECTION_TIMEOUT = callerUnlimited ? 0 : configuredConnectionTimeout;
const effectiveTimeout = callerUnlimited ? 0 : (timeout || configuredRequestTimeout);
```
调用方语义对照：
| 调用方式 | 请求超时 | 连接超时 |
|---|---|---|
| 不传 timeout | 引擎级 request_timeout | 引擎级 connection_timeout |
| timeout: 具体值 | 该值（覆盖配置） | 引擎级 connection_timeout |
| **timeout: 0** | **无** | **无（本次修复点）** |

**配套变更：**
- `useWorldBookAIOperations.ts` 13 处 `ai.request` 全部补 `timeout: 0`（第一轮修复，保留有效）
- **教训**：改动主进程超时逻辑后必须完整重启 Electron（vite-plugin-electron 会自动重启，但若 dev server 未运行则需手动 `npm run dev`）——用户复测前需确认新代码已加载

**验证：**
`tsc --noEmit` aiHandlers.ts 零错误；dev server 已重启（job-6d52c04b031c4e3dabca91cf2d02c76e），Electron 正常启动。

## §7.66 ⚠️ 重点 — Flash 模型角色卡字段级任务全字段泛化输出（Spec: fix-character-card-field-scope-flash-models，2026-08-31）

**现象：**
角色卡编辑器中，用户明确要求对**单个字段**（如描述）执行生成/翻译/润色时，国产 Flash 类模型（glm5.3-flash、qwen3.8-flash 等 100B+ MoE）会返回**包含所有字段**（个性、场景、初始消息等）的完整角色卡内容。Gemma4-31B 小模型反而无此问题 —— 说明与参数量无关，是提示词工程问题。

**根因（提示词作用域缺失，三层叠加）：**
1. **目标文本无边界标识**：user prompt 中目标字段文本与角色卡全量字段上下文**平铺混排**，模型无法区分"待处理文本"与"参考上下文"，长上下文下倾向文档补全式输出（补全整个角色卡）
2. **系统提示不知道目标字段是什么**：翻译/润色模板系统提示完全未提及目标字段，仅说"翻译用户提供的文本"，字段指向只能靠 user prompt 中一句自然语言
3. **无输出净化兜底**：即使模型越界输出，旧逻辑直接整段写回表单

**修复（三层防御 + 模板迁移）：**
1. **提示词工程**（promptTemplateService.ts 三个模板种子）：
   - 翻译/润色系统提示新增【翻译/润色范围约束】段落，注入 `{{target_field_label}}` 变量（目标字段中文名）
   - 生成模板系统提示新增规则 7（仅生成目标字段），user prompt 首行前置"本次任务：仅生成【xx】字段"强调
2. **user prompt 标签化**（useCharacterAIOperations.ts）：目标文本用 `<translate_target>`/`<polish_target>` 标签包裹，其他字段上下文用 `<context_reference>` 包裹并声明"仅作参考，禁止输出"
3. **输出越界防御**（新文件 `src/renderer/components/Character/hooks/characterFieldScope.ts`）：
   - `extractTargetFieldContent(raw, fieldKey)` 三重防御：① 字段段落提取（识别"描述："、"【个性】"、"# 场景"等行首标签变体，提取目标字段段落）② 越界回退判定（无目标段落且 ≥2 个其他字段标签 → overflow=true，恢复原文并提示）③ 标签残留清理
   - 接入翻译/润色/生成三个写回点，越界时保留原文 + message.warning
4. **存量模板迁移**（`migrateCharacterCardFieldScope`）：按"旧种子精确匹配"非破坏性迁移 —— 未修改副本整模板替换为新默认，用户自定义副本仅记 warn 不覆盖，已含新锚点幂等跳过

**⚠️ 调试期教训（重点标记）：**
- 迁移函数中 `OLD_GENERATE_SYSTEM` 旧种子误用了**长描述版**字段规范（个性：如"冷静、理智、略带傲娇"…），但 git HEAD 改动前真实种子是**短描述版**（个性：可以用关键词或短句。）→ 精确匹配失败 → generate 模板静默不迁移。**编写"旧种子精确匹配"迁移时，必须从 git 历史复制旧种子原文，不能凭记忆或从其他模块（FIELD_DESCRIPTIONS）拼接**
- 测试从新种子反向派生旧副本（replace 移除新增块）是自维护的好模式，但前提是旧种子常量必须与真实历史种子一致，否则测试通过≠迁移生效
- 顺带修复：`world-book.audit-content` 模板之前加入种子后，PromptTemplateService.test.ts 的模板总数断言（21→22、14→15）未同步，属遗留失败

**验证：**
`PromptTemplateService.test.ts` + `characterFieldScope.test.ts` 共 41 个测试全部通过；`tsc --noEmit` 本次涉及文件零新增错误；dev server 已重启，Electron 正常启动。
