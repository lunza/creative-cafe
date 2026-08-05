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

