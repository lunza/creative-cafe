# 角色对话聊天模块 (Character Dialogue Chat Module) 技术文档

> 模块路径: `src/renderer/components/Character/CharacterDialogueChat/`
> 源码文件: `CharacterDialogueChat.tsx`, `CharacterDialogueChat.hooks.ts`, `CharacterDialogueChat.types.ts`, `CharacterDialogueChat.utils.ts`, `ChatHeader.tsx`, `ChatInputBar.tsx`, `ChatMessageBubble.tsx`, `ChatTypingIndicator.tsx`, `ConfigPanel.tsx`, `ParameterPanel.tsx`, `PersonaPanel.tsx`, `KnowledgeBaseBindingPanel.tsx`, `MessageRenderer/` (子模块), `utils/` (消息处理工具链)
> 后端支撑: `src/main/ipc/handlers/characterChatHandlers.ts`, `src/main/services/ChatStorageService.ts`, `src/main/services/ChatVectorizationService.ts`
> 通用组件: `src/renderer/components/Common/ChatEngine/` (聊天引擎)
> 状态管理: `src/renderer/stores/characterChatStore.ts`

---

## 1. 模块功能描述

角色对话聊天模块是 Creative Cafe 的**AI 对话测试沙箱**，为角色卡提供真实的多轮 AI 对话测试环境，是角色卡"创作→测试→验证"闭环的关键组成部分。

### 核心能力

| 能力分类 | 具体能力 | 描述 |
|---------|---------|------|
| **对话交互** | 多轮对话 | 用户与 AI 角色的自然多轮对话，支持上下文理解和记忆 |
| | 流式响应 | AI 回复逐字流式输出，实时渲染到界面 |
| | 续写功能 | 对最后一轮 AI 回复进行内容续写，保持角色一致性 |
| | 重试机制 | 针对任一 AI 回复重新生成，支持回溯式修正 |
| | 编辑消息 | 编辑已有的 AI 消息内容（用户消息编辑按钮已替换为卷回按钮，详见"用户消息卷回按钮"章节） |
| | 取消请求 | 中断正在进行的 AI 请求 |
| | 清空对话 | 清除全部对话历史，重置到初始状态 |
| **消息渲染** | Markdown 渲染 | react-markdown + 插件链实现完整 Markdown 渲染 |
| | 富文本增强 | 代码高亮、引用高亮、内联 HTML 解析、样式限定 |
| | 模板变量替换 | `{{char}}` / `{{user}}` 自动替换为实际名称（含大小写变体） |
| | 引号规范化 | 自动识别和统一中文/英文/弯曲引号格式 |
| | 思维链过滤 | AI 后处理清除思维链标记和前缀 |
| | HTML 安全净化 | 三重安全级别（strict/moderate/loose），防护 XSS 攻击 |
| **配置面板** | 人设选择 | 从人设库中选择用户身份参与对话 |
| | AI 参数调节 | Temperature/Top-P/MaxTokens/Frequency Penalty/Presence Penalty 滑块实时调节 |
| | 知识库绑定 | 绑定知识库文档，对话中自动检索并注入相关上下文 |
| | 配置持久化 | 对话配置自动保存到 localStorage + 主进程文件系统 |
| **UI/UX** | 打字指示器 | AI 思考时显示动画气泡（角色头像 + Loading 图标 + "Typing..."） |
| | 暗色主题 | 渐变背景、毛玻璃效果、彩色光晕、网格纹理 |
| | 全屏模式 | 一键切换全屏对话视图 |
| | 滚动控制 | 自动滚动到底部 + 浮动"回到底部"按钮 |
| | 导出对话 | 一键导出完整对话到剪贴板 |
| **对话管理** | 历史加载 | 自动从 ChatStorageService 加载上次对话记录 |
| | 对话存储 | 每次回复后自动持久化对话到主进程文件系统 |
| | 对话向量化 | 对话内容向量化后支持语义搜索（ChatVectorizationService） |
| **上下文增强** | 向量检索 | 调用 ContextManager 从知识库/世界书/记忆中检索相关上下文 |
| | 系统提示词 | 自动组装角色信息、人设信息、对话约束规则到系统提示词 |

### 操作类型

- **对话操作**: 发送消息、续写、重试、编辑、取消、清空
- **配置操作**: 选择人设、调节参数、绑定/解绑知识库、保存配置
- **UI 操作**: 全屏切换、导出对话、滚动控制
- **后台操作**: 历史加载、对话存储、向量检索、向量化

### 功能边界

- 对话仅作为测试功能，不直接导出到 SillyTavern 格式
- 不包含对话分支/多线剧情管理
- 向量化搜索功能依赖知识库模块的基础设施
- Persona 数据来自 Avatar 模块，不可在此新建

---

## 2. 模块定位与业务价值

### 战略角色

角色对话聊天模块在系统中是**连接角色卡创作与使用验证的关键桥梁**，形成"编辑 → 测试 → 再编辑"的迭代闭环。

```
┌──────────────────────────────────────────────────────────┐
│              角色卡创作工作流                              │
│                                                          │
│  ┌──────────────┐    ┌──────────────────┐               │
│  │ Character    │ →  │ CharacterDialogue│               │
│  │ Manager      │    │ Chat (本模块)     │               │
│  │ (编辑端)     │    │ (测试端)          │               │
│  │              │ ←  │                   │               │
│  │ · 编辑字段   │    │ · 多轮对话验证      │               │
│  │ · AI 翻译    │    │ · 角色表现评估      │               │
│  │ · AI 润色    │    │ · 发现问题回编辑    │               │
│  │ · AI 生成    │    │                   │               │
│  └──────────────┘    └──────────────────┘               │
└──────────────────────────────────────────────────────────┘
```

### 解决的业务痛点

1. **角色卡质量无法即时验证**: 编辑完成后直接对话测试，实时发现 personality/scenario/first_mes 等问题
2. **对话测试环境缺失**: 无需启动 SillyTavern 即可测试角色卡对话效果
3. **上下文相关性不足**: 知识库绑定功能让 AI 角色能引用外部文档知识
4. **参数调优困难**: 可视化滑块实时调节 AI 参数，直观感受不同配置对回复质量的影响
5. **对话数据丢失**: 自动持久化保证对话历史不因页面切换而丢失

### 目标用户群体

- **角色卡创作者**: 验证角色设定是否能产生预期的对话效果
- **角色卡翻译者/润色者**: 测试翻译或润色后角色的对话质量
- **Prompt 工程师**: 调试和优化角色的 System Prompt

---

## 3. 技术实现方案

### 3.1 整体技术架构

```
┌──────────────────────────────────────────────────────────────┐
│                   CharacterDialogueChat.tsx                     │
│  ┌────────────┐ ┌──────────────────┐ ┌────────────────────┐  │
│  │ ChatHeader │ │ 消息列表          │ │ ConfigPanel        │  │
│  │            │ │ ┌──────────────┐ │ │ ┌────────────────┐ │  │
│  │ 角色名/头像 │ │ │ChatMessage   │ │ │ │PersonaPanel    │ │  │
│  │ 消息统计   │ │ │Bubble        │ │ │ │                │ │  │
│  │ 清除/导出  │ │ │┌────────────┐│ │ │ │ParameterPanel  │ │  │
│  │ 全屏切换   │ │ ││Message     ││ │ │ │                │ │  │
│  └────────────┘ │ ││Renderer    ││ │ │ │KnowledgeBase   │ │  │
│                 │ │└────────────┘│ │ │ │BindingPanel    │ │  │
│                 │ └──────────────┘ │ │ └────────────────┘ │  │
│                 │ ChatTyping       │ └────────────────────┘  │
│                 │ Indicator        │                          │
│  ┌────────────┐ └──────────────────┘                          │
│  │ChatInputBar│                                                │
│  └────────────┘                                                │
└──────────────────────────────────────────────────────────────┘
                          ↓ Hooks
┌──────────────────────────────────────────────────────────────┐
│  CharacterDialogueChat.hooks.ts (业务逻辑层)                   │
│  ├── useCharacterConfig(characterCardId)  → 配置持久化        │
│  ├── usePersonas()                        → 人设加载          │
│  └── useCharacterDialogueChat(charInfo)   → 对话主逻辑        │
│      ├── sendMessage / continueConversation / retryMessage    │
│      ├── clearChat / cancelRequest / editMessage              │
│      ├── buildDialoguePrompt / buildContinuationPrompt        │
│      └── requestAIResponse (核心AI请求+向量检索)              │
└──────────────────────────────────────────────────────────────┘
                          ↓ 依赖
┌──────────────┐ ┌──────────────┐ ┌──────────────┐ ┌──────────┐
│ ChatEngine   │ │ Message      │ │ Character    │ │ Context  │
│ (Factory)    │ │ Processor    │ │ Chat Store   │ │ Manager  │
└──────────────┘ └──────────────┘ └──────────────┘ └──────────┘
```

### 3.2 设计模式

| 模式 | 应用位置 | 说明 |
|------|---------|------|
| **Factory** | ChatEngineFactory | 单例工厂管理聊天引擎实例，按配置获取或创建 |
| **Observer** | Zustand Stores | characterChatStore / settingStore / logStore 订阅 |
| **Mediator** | useCharacterDialogueChat Hook | 协调对话状态、引擎、配置、存储等多个子系统 |
| **Strategy** | buildDialoguePrompt / buildContinuationPrompt | 对话模式和续写模式使用不同的 Prompt 构建策略 |
| **Pipes and Filters** | MessageRenderer 插件链 | remark→rehype 插件管线处理 Markdown→HTML 转换 |
| **Command** | sendMessage / retryMessage / continueConversation | 统一的消息发送接口封装 |

### 3.3 核心算法

#### 对话 Prompt 构建 (buildDialoguePrompt)

```typescript
// 1. 构建角色上下文 (buildCharacterContext)
//    - 角色名 / 个性 / 描述 / 场景 / 示例消息 / 系统提示 / 创建者笔记
//    - 使用 replaceTemplates 替换 {{char}} / {{user}} 占位符
// 2. 构建人设段落 (buildPersonaSection)
//    - 当前选中人设的名称和描述
// 3. 组装最终 Prompt:
//    - 任务类型声明
//    - 角色信息 + 人设信息
//    - 对话任务说明
//    - 对话约束规则 (8条)
//    - 严格禁止列表 (8条)
//    - 输出格式说明
```

#### 向量上下文检索与注入

```typescript
// 在每次 AI 请求前:
// 1. 找到对话历史中最后一条用户消息
// 2. 调用 context:retrieve API
//    - 搜索范围: worldbook / knowledge / memory
//    - 过滤范围: 用户绑定的 KnowledgeBase scopeIds
//    - 参数: topK=5, minScore=0.3
// 3. 将检索结果格式化为 "相关背景知识" 段落
// 4. 追加到系统提示词末尾
```

#### 续写逻辑 (continueConversation)

```typescript
// 基于已有消息扩展回复:
// 1. 获取最后一条 assistant 消息的现有内容作为 initialContent
// 2. 设置 initialContentRef 为现有内容
// 3. AI 流式回复以现有内容为前缀开始追加
// 4. 使用 buildContinuationPrompt (续写专用 Prompt)
// 5. 流式回调中验证新内容不会破坏前缀
// 6. 如果流式累积内容短于 initialContent，使用 initialContent + serverResponse 作为回退
```

#### 流式响应后处理

```typescript
// ChatEngine 的 onStream 回调:
// - 累积 chunk 到 streamContentRef.current
// - 更新 targetMessageId 对应的消息内容
// - 状态: 'sending'
//
// ChatEngine 的 onComplete 回调:
// - 验证最终内容不为空
// - Content Protection: 防止最终内容短于流式累积内容
// - 状态: 'sent'
// - 触发 saveChatToStore 持久化
```

#### 精确 Token 计数（cl100k_base）

> Spec: optimize-chat-ai-intelligence / Task 1
> 状态: 已实施（2026-07）

**背景与原缺陷** ⚠️：原 `TokenCounter.estimateTokens` 使用 `Math.ceil(byteLength / 3.35)` 字节估算，spec 假设中文场景误差 ±15%。**实测发现（与 spec 假设不符）**：cl100k_base 对中文约 1.3-1.4 token/字，字节估算反而**低估约 35-50%**，导致 `ContextTruncator` 可能放过超限上下文，AI 接收过多 token 触发模型截断或报错。此为本次重点修复项。已修复（optimize-chat-ai-intelligence spec / Task 1）。

**架构**：
- 主进程 `src/main/services/TokenCountService.ts`（单例）：懒加载 `gpt-tokenizer/encoding/cl100k_base`（纯 JS、同步、无 WASM 依赖，比 tiktoken WASM 更稳定），加载失败永久降级到字节估算
- IPC：`token:count` / `token:countBatch`（`src/main/ipc/handlers/tokenHandlers.ts`）
- 渲染进程 `TokenCounter` 双模式：
  - 异步精确路径：`estimateTokensAsync` / `precountMessages` / `precountSystemPrompt` — 通过 IPC 批量拉取精确计数并写双缓存（按 messageId + 按文本内容）
  - 同步降级路径：`estimateTokens` / `estimateTokensSync` — 优先返回缓存命中的精确值；未命中走字节估算（不写缓存，避免污染）

**关键调用点**：
- `CharacterDialogueChat.hooks.ts::requestAIResponse` 在 `ContextTruncator.truncateMessages` 之前 `await Promise.all([precountMessages, precountSystemPrompt])` 预热缓存，保证后续同步裁剪逻辑全部命中精确缓存
- `ContextTruncator.truncateMessages` 保持同步签名，无需重构为异步（Task 2 重写时再优化）

**性能**：
- 单次 IPC 批量调用减少跨进程往返
- 缓存命中后零开销
- text 缓存 LRU 上限 512 条，避免 system prompt 频繁变更导致无界增长

**待办（Task 2 衔接）**：~~接入精确计数后，相同文本的 token 占用上升约 35-50%，需基于真实 cl100k_base 数值重新校准 `maxContextTokens` 默认值与 budget reserve 比例。~~ ✅ 已由 Task 2 完成（见下文"Budget 双向预留上下文裁剪"）。

#### Budget 双向预留上下文裁剪

> Spec: optimize-chat-ai-intelligence / Task 2
> 状态: 已实施（2026-07）

**背景与原缺陷** ⚠️：原 `ContextTruncator.truncateMessages` 采用"末尾累加 + minMessagesToKeep 回退"算法——预算 = `maxContextTokens - systemPromptTokens - reservedForResponse`，从末尾向前累加直至超限；预算耗尽时强制回退到最近 `minMessagesToKeep*2` 条。该回退会**挤占必填项预算**（system prompt / response 预留可能被牺牲），且无 stop sequences / 角色锚定的独立预留位，长对话易丢失必填上下文。接入 Task 1 精确计数后，相同文本 token 数上升 35-50%，原算法更易触发回退，问题放大。已修复（optimize-chat-ai-intelligence spec / Task 2）。

**新算法**（基于 token budget 的双向预留裁剪，对齐 SillyTavern 风格）：

1. **TokenBudget 类**（`ContextTruncator.ts`）：`reserve(key, tokens) / free(key) / canAfford(tokens) / remaining / reserved / total`。必填项即使超出剩余预算也强制扣除（钳制 `remaining` 到 0，返回 `false` 告警），保证必填项一定注入。
2. **必填项按顺序 reserve**：`[systemPrompt, roleAnchor, stopSequenceReserve(512), exampleMessages, responseReserve]`。剩余预算用于对话历史。
3. **倒序填充对话历史**：从最新消息向前，每条 `canAfford` 检查通过则入栈，超限即 `break`。
4. **minMessagesToKeep 软下限**（spec REMOVED Requirement）：若最近 `minMessagesToKeep*2` 条消息整体 `canAfford`，则先 reserve 它们；预算不允许时**不强制**（不再回退到 N*2 条，避免挤占必填项）。
5. **至少保留最近 1 条消息**：极端紧凑预算下避免空上下文（部分 API 要求 messages 非空）；`ensureMessagePairs` 增强兜底——丢弃开头 assistant 致结果为空时保留最后一条。

**关键接口**：
- `truncateMessages(messages, systemPromptTokens, config, requiredItems?)`：新增可选第 4 参数 `requiredItems: RequiredBudgetItem[]`，由调用方计算各项精确 token 后传入；未传时内部按 spec 顺序构造默认必填项（`roleAnchor`/`exampleMessages` 默认 0，Task 4 通过此参数注入角色锚定真实值）。**向后兼容**：现有 3 参数调用方（`CharacterDialogueChat.hooks.ts::requestAIResponse`）无需改动。
- `TokenBudget` 类已从 `TokenManagement/index.ts` 导出，可供 Task 4 / 调用方直接复用做预算审计。

**预算常量**（`TokenManagement/constants.ts`，基于 Task 1 实测中文 1.3-1.4 token/字校准）：
- `STOP_SEQUENCE_RESERVE = 512`（Task 3 注入的 stop sequences 预留，约容纳 6-8 个用户名变体停止串）
- `DEFAULT_ROLE_ANCHOR_RESERVE = 0`（Task 4 注入真实值，预估 200 中文字 ≈ 350 tokens）
- `DEFAULT_EXAMPLE_MESSAGES_RESERVE = 0`（`mes_example` 当前已拼入 systemPrompt，避免重复 reserve）
- `ARRAY_PADDING_TOKENS = 3`（与 `TokenCounter` 内部 `TOKENS_PADDING` 对齐，一次性 reserve 避免漏算）
- `DEFAULT_MAX_TOKENS = 8192`（见下文 max_tokens 统一）

**max_tokens 双重默认值修复**（Task 2.4）⚠️：原 `hooks.ts` fallback `max_tokens=8192` 与 `ChatEngine.ts` 内部 fallback `10240` 不一致，可能导致两端生成上限不同。已统一为 `DEFAULT_MAX_TOKENS=8192`，在 `hooks.ts`（参数 fallback / 流式超时阈值）、`ParameterPanel.tsx`（滑块默认值）、`ChatEngine.ts`（请求体 fallback）三处引用同一常量。

> **【增量更新】（2026-07-26，max_tokens 范围扩展 + 0 值表示不限制）**：
> - **变更**：`ParameterPanel.tsx` 滑块范围从 `min=256, max=32768` 扩展到 `min=0, max=262144`（256K），支持大窗口模型（如 DeepSeek V4 384K 输出、Gemini 2.5 Pro 等）。
> - **max_tokens=0 语义**：设为 0 表示不限制最大 token 数，由模型上下文窗口决定。`ChatEngine.ts` 请求体构造中，`max_tokens=0` 时**不发送** `max_tokens` 字段，让后端使用默认行为（OpenAI / llama.cpp / vLLM 等均支持省略此字段）。UI 显示"无限制"。
> - **辅助模式兼容**：`hooks.ts` 中辅助模式 `+512` 预留逻辑增加 `> 0` 条件判断，`max_tokens=0` 时不执行加法（0 会被 ChatEngine 解析为不限制）。
> - **修改文件**：`parameterConfigs.ts`（范围 0-262144）、`ChatEngine.ts`（0 值不发送字段）、`ParameterPanel.tsx`（0 值显示"无限制"）、`CharacterDialogueChat.hooks.ts`（辅助模式 +512 条件）。

**校准结论**（基于 Task 1 实测）：`maxContextTokens` 默认值 32000（按模型窗口设定）**仍合理，无需调整**；`reservedForResponse=4096`（约 3000 中文字，足够一轮详细回复）、`stopSequenceReserve=512` 在真实 token 数下均合理。接入精确计数后裁剪时机更准（不再因字节估算低估而放过超限上下文）。

**验证**：`TokenManagement/__tests__/ContextTruncator.test.ts`（22 个用例）：100 轮对话+8000 预算下必填项全注入且历史 ≤ 剩余预算；5 轮短对话全保留；minMessagesToKeep 软下限预算紧张时不强制。

> **【重点标记】增量更新（2026-07-26，TokenManagement 关闭时的上下文溢出安全网 + finish_reason=length 检测）**：
> - **根因**：TokenManagement 默认关闭（`tokenManagementEnabled ?? false`），关闭时直接发送所有历史消息。长对话累积至 30K+ tokens 后，模型上下文窗口（如 Gemma-4-31B 的 32K）被历史占满，留给输出的空间不足，`finish_reason=length` 强制截断 AI 回复。表现为"某次对话中稳定出现截断"——随对话增长，输出空间递减至耗尽。
> - **修复 1（安全网）**：TokenManagement 关闭时，若消息数超过 `maxMessagesToKeep`（默认 60），自动截断到最近 N 条并确保以 user 消息开头。防止上下文窗口溢出。修改文件：`CharacterDialogueChat.hooks.ts` 第 1025-1044 行。
> - **修复 2（截断检测与告警）**：`onComplete` 回调中检测 `response.finishReason === 'length'`，向用户展示 `message.warning` 告警（持续 8 秒），提示启用 TokenManagement 或调整参数。修改文件：`CharacterDialogueChat.hooks.ts` 第 1102-1116 行。
> - **诊断方法**：检查 AI 服务器返回的 `finish_reason` 字段——`"length"` 表示因上下文窗口或 max_tokens 耗尽被截断；`"stop"` 表示正常结束。`timings.predicted_n` 显示实际生成 token 数，与 `max_tokens` 比较可区分两种截断原因。

#### Stop Sequences 防抢话机制

> Spec: optimize-chat-ai-intelligence / Task 3
> 状态: 已实施（2026-07）

**背景与原缺陷** ⚠️：原 `ChatEngine.ts` 请求体未设置 `stop` 字段，AI 经常自己生成下一条用户消息（"\n用户: ..."）或连续重复角色名/引号，破坏沉浸感。此为用户反馈"AI 抢话"问题的直接技术根因，影响每一次对话。已修复（optimize-chat-ai-intelligence spec / Task 3）。借鉴 SillyTavern `names_as_stop_strings` 机制（源码 `public/script.js:2966 getStoppingStrings`），在请求体注入用户名变体停止序列。

**实现链路**：

1. **`buildStopSequences(userName, customStops?)`**（`PromptBuilder.ts:68-103`）：构建停止序列数组。
   - 默认返回 **6 项**用户名变体（含中英文冒号），**仅使用 `\n\n` 双换行前缀**：`\n\n{{user}}:, \n\n{{user}}：, \n\n用户:, \n\n用户：, \n\nUser:, \n\nUser：`
   - 🐛 **Bug修复（重点，2026-07-26）**：原实现包含 12 项（6 项双换行 + 6 项单换行 `\n` 前缀），单换行变体会被 OpenAI-compatible 后端按子串匹配误触发——当 AI 在回复中引用用户话语（如"用户: '我喜欢这个'"）、写内心独白、列举对话片段时，输出在 `\n用户:` 处被截断。经评估单换行变体误触发风险远大于"兜底"价值，故移除，仅保留双换行前缀匹配段落分隔。
   - 传入 `customStops`（用户自定义）时合并到末尾，整体去重（含默认数组内部去重——userName 恰为 "User"/"用户" 时也去重），过滤空串与纯空白串
   - 用户名缺省/空白时回退到 `'User'`

2. **请求体注入**（`ChatEngine.ts::sendMessage` 内联请求体构造处）：通过 `resolveStopForRequestBody(config.stopSequences, config.capabilities)` 解析 stop 字段值并写入 `requestBody.stop`。
   - `stopSequences` 由 `hooks.ts::requestAIResponse` 在构造 `engineConfigWithParams` 时调用 `buildStopSequences(selectedPersona.name, customStopSequences)` 注入（第 484-489 行）
   - **不破坏 sendMessage 签名**：stopSequences 从 `AIEngineConfig` 对象读取而非新增参数

3. **后端能力探测**（`ChatEngine.types.ts`）：
   - `EngineCapabilities` 接口：`supportsStopArray` / `supportsRepPen` / `supportsDrySampler`（后两者 Task 6 完整实现）
   - `getDefaultEngineCapabilities(apiMode)`：当前所有 api_mode 默认 `supportsStopArray=true`（spec："若不确定默认传数组"，大多数 OpenAI-compatible 后端兼容）
   - `resolveStopForRequestBody(stopSequences, capabilities)` 纯函数：`supportsStopArray=true` 传数组；`=false` 取首元素作字符串并 warn 日志；空/缺省返回 undefined（不注入 stop，向后兼容）
   - `AIEngineSetting` 类型新增 `capabilities?: AIEngineCapabilities` 字段（`setting.ts`）

4. **自定义停止序列 UI**（`ParameterPanel.tsx`）：在 AI 参数配置之后新增"自定义停止序列"配置区——开关（Switch）+ TextArea（每行一个停止串，失焦时解析持久化）。
   - 持久化到 `character-session-<cardId>` localStorage 的 `customStopSequencesEnabled` + `customStopSequences` 字段（复用现有 `customParameters` 持久化模式，经 `ConfigPanel` → `CharacterDialogueChat.updateConfig` 流）
   - `CharacterSessionConfig` 类型新增 `customStopSequencesEnabled?: boolean` 与 `customStopSequences?: string[]` 字段

**验证**：新增 23 个单元测试（`buildStopSequences.test.ts` 12 个 + `resolveStopForRequestBody.test.ts` 11 个），覆盖默认数组、合并去重、空串过滤、`supportsStopArray=false` 传字符串等场景；`npx vitest run` 全量 85 个测试通过。⚠️ 无法真实调用 AI API 验证流式截断，改为通过 `resolveStopForRequestBody` 纯函数单测验证 stop 字段值正确性（数组/字符串/undefined 三态）。

#### AI 回复按钮与用户回复生成（generateUserReply）

> Spec: add-ai-user-reply-button
> 状态: 已实施（2026-07）

**背景与目标**：在对话模式 ChatInputBar 中"Send Message"按钮**左侧**新增"AI回复"按钮。点击后以**当前登录用户的身份角色（UserPersona）**为基准，调用 AI 模型生成下一句用户侧对话内容，自动填入输入框供用户编辑后发送（不自动发送）。生成内容严格遵循当前对话环境的所有 AI 参数设置（temperature / max_tokens / freq_pen / pres_pen / rep_pen / DRY 采样组等），并复用 `ContextTruncator` 进行上下文裁剪。

**与 `requestAIResponse` 的对称设计**：`requestAIResponse` 让 AI 扮演 {{char}} 生成角色回复；`generateUserReply` 让 AI 扮演 {{user}} 生成用户回复。两者共享相同的引擎调用与参数注入链路，仅在以下三处差异：

| 维度 | `requestAIResponse`（角色回复） | `generateUserReply`（用户回复） |
|------|---------------------------------|-------------------------------|
| 系统提示 | `buildCompleteSystemPrompt`（含角色卡 + 人设 + 锚定 + 长度引导） | `buildUserReplySystemPrompt`（仅含用户人设 + 对方角色上下文 + "仅输出用户回复"约束） |
| 停止序列 | `buildStopSequences(selectedPersona.name, ...)`（**用户名**变体，防止 AI 越权替用户发言） | `buildStopSequencesForUserReply(characterInfo.characterCardName, ...)`（**角色名**变体，防止 AI 越权替角色发言） |
| 消息落地 | 流式写入 `state.messages` 中的 placeholder 消息 | 流式累积到 `generatedReplyAccumulatedRef`，完成后通过 Promise resolve 返回完整文本（不写入 state.messages） |

**实现链路**：

1. **`buildUserReplySystemPrompt(characterInfo, persona)`**（`PromptBuilder.ts:305-357`）：构建用户回复专用系统提示。
   - 防御性返回：`persona` 为空或 `persona.name` 为空时返回空串，由 hooks 前置校验后调用
   - 内容结构：`## 用户人设`（name + description，description 缺失时回退 `'（未提供用户描述）'`）+ `## 对方角色上下文`（characterCardName + personality + characterCardContent 截断到 300 字）+ `## 任务要求`（6 条约束）
   - 关键约束：`仅输出 ${userName} 的下一句回复内容` / `不要输出 ${charName} 的回复` / `不要解释、不要引号包裹、不要前缀` / 长度 50-200 字
   - **⚠️ 实现差异（重点标记）**：spec 原文使用"只输出"，实际实现使用"**仅输出**"（功能等价，文案以实现为准）

2. **`buildStopSequencesForUserReply(charName, customStops?)`**（`PromptBuilder.ts:115-146`）：构建角色名变体停止序列。
   - 默认 **4 项**数组，**仅使用 `\n\n` 双换行前缀**（`\n\n${charName}:`、`\n\n${charName}：`、`\n\n{{char}}:`、`\n\n{{char}}：`）
   - 🐛 **Bug修复（重点，2026-07-26）**：与 `buildStopSequences` 同步移除 4 项单换行前缀变体，原因相同——单换行变体会被后端按子串匹配误触发，在 AI 引用角色话语时导致输出截断
   - 复用 `buildStopSequences` 的 `pushIfValid` 合并去重模式；`charName` 恰为 `'{{char}}'` 时去重为 2 项
   - `charName` 缺省/空白时回退到 `'Character'`

3. **`generateUserReply` useCallback**（`CharacterDialogueChat.hooks.ts:1537-1719`）：
   - 前置校验：`selectedPersona` 为空 → `message.warning('请先在右侧面板选择用户人设')` 并 return；`getActiveEngineConfig()` 为空 → `message.warning('请先在设置中配置AI引擎')` 并 return；`state.isStreaming` / `isOrganizing` / `isGeneratingUserReplyRef.current` 任一为 true 时 return（避免并发）
   - `engineConfigWithParams` 构造：逐字段复制自 `requestAIResponse`（含 `temperature` / `top_p` / `frequency_penalty` / `presence_penalty` / `repetition_penalty` / DRY 采样组 / `capabilities`），仅 `stopSequences` 改用 `buildStopSequencesForUserReply`
   - 上下文裁剪：`tokenManagementEnabled` 为真时走 `ContextTruncator.truncateMessages`，**不注入 `roleAnchorMessage`**（角色锚定仅适用于角色回复生成场景），调用前 `await Promise.all([precountMessages, precountSystemPrompt])` 预热缓存
   - Promise 模式：`engine.onStream` 累积 chunk 到 `generatedReplyAccumulatedRef`（取消后早返）；`engine.onComplete` 中 `resolve(response?.content || generatedReplyAccumulatedRef.current)`；`engine.onError` 中 `message.error` + `reject`；`finally` 块重置 state 与 ref

4. **取消机制**（`CharacterDialogueChat.hooks.ts::cancelRequest`）：
   - `isGeneratingUserReplyRef.current` 为 true 时：设置 `isGeneratingUserReplyAbortRef.current = true`（onStream 早返避免污染累积缓冲）+ 调用 `engine.cancelRequest()`（触发 onError 或 onComplete，由 finally 块重置 state）

5. **UI 三态按钮**（`ChatInputBar.tsx:165-200`）：
   - 正常态：紫色渐变（`linear-gradient(135deg, #8b5cf6 0%, #6366f1 100%)`）+ `RobotOutlined` 图标 + Tooltip "以当前用户人设生成对话回复"
   - 生成中：红色渐变 + `LoadingOutlined` 图标 + Tooltip "停止生成"；点击触发 `onCancel?.()` 中断
   - 禁用态：`disabled || isStreaming || isOrganizing` 时禁用（与 Send 按钮一致）
   - 生成中同步禁用 Send 按钮 + textarea（`disabled={(disabled && !isStreaming) || isGeneratingUserReply}`）

6. **人称选择器 UI**（`ChatInputBar.tsx:181-198`，Spec: add-person-attribute-to-ai-reply / Task 3）：
   - 位置：位于"AI回复"按钮**左侧**、textarea **右侧**（与 AI回复按钮同处 `else` 分支，仅在非 streaming / 非 organizing 态显示）
   - 实现：antd `Select` 组件，`size="small"`，`width: '110px'`，`marginRight: '4px'`，`alignSelf: 'center'` 垂直居中
   - 三个 `Select.Option`：`first` → `第一人称（我）` / `second` → `第二人称（你）` / `third` → `第三人称（他/她）`
   - 受控绑定：`value={userReplyPerson}`（默认 `'first'`），`onChange={(v) => onUserReplyPersonChange?.(v as 'first' | 'second' | 'third')}`
   - 禁用态：`disabled || isStreaming || isOrganizing || isGeneratingUserReply` 任一为 true 时禁用（与 AI回复按钮的生成态联动，避免生成中切换人称）
   - 暗色主题适配：通过 `popupClassName="person-select-dropdown"` 配合组件内 `<style>` 注入的下拉样式（文字 `#e2e8f0`，hover/selected 用 `rgba(99, 102, 241, 0.2 / 0.3)` 紫色半透明高亮，与 ConfigPanel 暗色风格一致）
   - 新增 props：`userReplyPerson?: 'first' | 'second' | 'third'` + `onUserReplyPersonChange?: (person) => void`（均为可选，向后兼容；Task 4 在 `CharacterDialogueChat.tsx` 透传到 `updateConfig({ userReplyPerson })` 持久化）

7. **人称选择器父组件透传**（`CharacterDialogueChat.tsx:216-220 + 568-569`，Spec: add-person-attribute-to-ai-reply / Task 4）：
   - `handleUserReplyPersonChange` useCallback：调用 `updateConfig({ userReplyPerson: person })` 持久化到 `character-session-<cardId>` localStorage，依赖数组 `[updateConfig]`
   - JSX 透传：`<ChatInputBar>` 调用处追加 `userReplyPerson={characterConfig?.userReplyPerson}` 与 `onUserReplyPersonChange={handleUserReplyPersonChange}` 两个 props（紧随 `onGeneratedReplyTextConsumed` 之后）
   - 数据流向：`characterConfig.userReplyPerson`（localStorage）→ ChatInputBar `value` → 用户切换 → `onUserReplyPersonChange` → `updateConfig` → localStorage 持久化（与现有 `selectedPersonaId` / `customStopSequences` 等字段复用同一 `useCharacterConfig` 流）

8. **文本填充模式**（`ChatInputBar.tsx:43-57` + `CharacterDialogueChat.tsx:197-214`）：
   - hook 完成 → `handleGenerateUserReply` 调用 `setGeneratedReplyText(text)` → ChatInputBar useEffect 监听 `generatedReplyText` 非空 → `setInput(generatedReplyText)` + `onGeneratedReplyTextConsumed?.()` 清空暂存 + 异步 `textareaRef.current?.focus()` + `setSelectionRange(text.length, text.length)` 光标置末尾

> **【重点标记】增量更新（2026-07-05，Spec: fix-polish-input-undo-and-target / Task 2 / Bug 1 修复）**：上述"文本填充模式"原实现存在 Bug——`setInput(generatedReplyText)` 直接设置 React state，**不向浏览器原生 undo stack 注册历史项**，导致润色/AI回复/卷回完成后按 Ctrl+Z 无法回退到填充前文本。修复方案：重构 `ChatInputBar.tsx:56-88` 的 `generatedReplyText` useEffect，改用 `textarea.focus()` → `textarea.select()` → `document.execCommand('insertText', false, text)` 三步法注册 undo 历史；execCommand 失败时回退 `setInput` 保证功能可用。**关键实现点**：(1) 移除原 `setInput(generatedReplyText)` 同步调用；(2) 新增 `const textToInsert = generatedReplyText;` 局部常量暂存，防止 `onGeneratedReplyTextConsumed?.()` 清空后闭包失效；(3) `onGeneratedReplyTextConsumed?.()` 仍在 setTimeout 之前即时调用；(4) try/catch 包裹 execCommand；(5) 光标定位 `setSelectionRange(len, len)` 在两条路径后均执行；(6) execCommand 成功时通过触发 textarea `onChange` 事件自动同步 React state，无需额外 setInput。**正向副作用**：该机制同时服务于 AI回复 / 润色 / 卷回 三条 `generatedReplyText` 填充路径，三个功能均获得 Ctrl+Z 撤销能力。**技术权衡**：`document.execCommand` 已被 Web 标准废弃，但在 Chromium/Electron 环境中仍受支持，且是唯一能向浏览器 undo stack 注册历史项的 API；React 受控组件的 state 直接修改无法触发 undo stack 注册。TypeScript 编译检查：`ChatInputBar.tsx` 0 错误（全量 typecheck 中该文件无报错，其他文件错误均为预存问题，与本次修改无关）。

**验证**：新增 52 个单元测试（`PromptBuilder.userReply.test.ts` 32 个 + `buildStopSequencesForUserReply.test.ts` 20 个），覆盖正常输入、约束关键词（"仅输出"/"不要输出"/"不要解释"）、长度约束、字段缺失、>300 字截断、persona null/undefined/name 空字符串防御、默认 8 项数组、`'{{char}}'` 去重（4 项）、`'Character'` 不去重（8 项）、customStops 合并/去重/空串过滤等场景；`npx vitest run` 全量 420 个测试通过。⚠️ 无法真实调用 AI API 验证流式生成实际效果，改为通过纯函数单测验证提示词构建与停止序列正确性。

> **增量更新（2026-07，Spec: add-person-attribute-to-ai-reply / Task 3）**：在 ChatInputBar.tsx 新增人称选择器 UI（上述第 6 点）。本次仅完成 UI 层（接口扩展 + 组件解构 + Select 组件 + 暗色主题样式），Task 4（父组件透传 `characterConfig?.userReplyPerson` ↔ `updateConfig` 持久化）和 Task 1/2（提示词层 `person` 参数 + hook 读取 `characterConfig.userReplyPerson`）尚未实施，故当前选择器切换暂未实际影响生成提示词。TypeScript 编译无新增错误（`ChatInputBar.tsx` 0 错误）。

> **增量更新（2026-07，Spec: add-person-attribute-to-ai-reply / Task 4）**：在 `CharacterDialogueChat.tsx` 完成父组件透传（上述第 7 点）。新增 `handleUserReplyPersonChange` useCallback（位于 `handleGeneratedReplyTextConsumed` 之后），调用 `updateConfig({ userReplyPerson: person })` 持久化；`<ChatInputBar>` JSX 在 `onGeneratedReplyTextConsumed` 之后追加 `userReplyPerson={characterConfig?.userReplyPerson}` 与 `onUserReplyPersonChange={handleUserReplyPersonChange}` 两个 props。`characterConfig` 与 `updateConfig` 已在 hook 解构列表（第 59-60 行），无需新增解构。TypeScript 编译无新增错误（`CharacterDialogueChat.tsx` 仅余 3 项预存的 unused import / unused var 警告，与本次修改无关）。⚠️ Task 1/2（提示词层 `person` 参数 + hook 读取 `characterConfig.userReplyPerson`）尚未实施，当前选择器切换虽已持久化但暂未实际影响生成提示词。

> **增量更新（2026-07，Spec: add-person-attribute-to-ai-reply / Task 2）**：在 `CharacterDialogueChat.hooks.ts::generateUserReply` 中（上述第 3 点实现链路），将 `buildUserReplySystemPrompt` 调用从 2 参数扩展为 3 参数，新增第 3 参数 `characterConfig?.userReplyPerson` 透传到提示词层。具体修改位置：第 1569-1581 行的 `buildUserReplySystemPrompt` 调用，在 `selectedPersona` 之后追加 `characterConfig?.userReplyPerson`（含 Spec 标注注释）。`generateUserReply` 的 useCallback 依赖数组（第 1720 行）已包含 `characterConfig`，无需新增。结合 Task 1（`buildUserReplySystemPrompt` 第 3 参数 `person` 已实施）与 Task 4（父组件 `CharacterDialogueChat.tsx` 已透传 `userReplyPerson` ↔ `updateConfig` 持久化），人称选择器切换现在可以实际影响 `generateUserReply` 的生成提示词（第一/二/三人称视角约束）。TypeScript 编译无新增错误（`CharacterDialogueChat.hooks.ts` 0 错误，全量 typecheck 中该文件无报错）。

> **【重点标记】增量更新（2026-07-12，输入框内容作为用户指令）**：`generateUserReply` 新增 `userInstruction?: string` 参数，当输入框中有内容时将其作为"用户指令"注入系统提示，引导 AI 按用户意图生成回复；输入框为空时保持原有行为不变。具体修改：
> 1. **`ChatInputBar.tsx`**：`onGenerateUserReply` prop 类型从 `() => void` 改为 `(currentInput?: string) => void`；按钮 onClick 调用 `onGenerateUserReply?.(input.trim() || undefined)` 传入当前输入框内容。
> 2. **`CharacterDialogueChat.tsx`**：`handleGenerateUserReply` 新增 `currentInput?: string` 参数，透传给 `generateUserReply(currentInput)`。
> 3. **`CharacterDialogueChat.hooks.ts`**：`generateUserReply` 签名改为 `(userInstruction?: string) => Promise<string>`，将 `userInstruction` 作为第 4 参数传入 `buildUserReplySystemPrompt`。
> 4. **`PromptBuilder.ts`**：`buildUserReplySystemPrompt` 新增第 4 参数 `userInstruction?: string`。当非空时在系统提示中追加 `## 用户指令` 段落（含指令内容 + "请在生成回复时参考上述用户指令"提示），并将任务要求第 5 条追加"并遵循上方'用户指令'的要求"；为空时不追加任何内容，保持完全向后兼容。

#### 润色按钮（polishInput）UI

> Spec: refine-user-input-text / Task 3
> 状态: 已实施（2026-07）

**背景与目标**：在对话模式 ChatInputBar 中"AI回复"按钮与"Send Message"按钮**之间**新增"润色"按钮。点击后以当前用户人设结合对话上下文与对方角色人设，对输入框已有文本进行润色（不自动发送，回填到输入框供用户编辑）。该功能与 `generateUserReply`（AI回复）共享文本填充与暂存机制（`generatedReplyText` state + `setInput` 回填 + 光标置末尾），区别仅在于输入来源——`generateUserReply` 是"从无到有生成"，`polishInput` 是"基于已有文本优化"。

**UI 三态按钮设计**（与 AI回复 按钮对称）：

| 状态 | 配色 | 图标 | Tooltip | 点击行为 |
|------|------|------|---------|---------|
| 正常态 | 青色渐变（`linear-gradient(135deg, #14b8a6 0%, #06b6d4 100%)`） | `HighlightOutlined` | "润色当前输入文本（结合对话上下文与角色人设）" | 调用 `onPolishInput?.(input)` |
| 润色中态 | 红色渐变（`linear-gradient(135deg, #ef4444 0%, #dc2626 100%)`） | `LoadingOutlined` | "停止润色" | 调用 `onCancel?.()` 中断 |
| 禁用态 | — | — | — | 输入框为空 / `disabled` / `isStreaming` / `isOrganizing` / `isGeneratingUserReply` 任一为 true 时禁用 |

**配色语义**：青色（#14b8a6 teal）与紫色 AI回复按钮、蓝紫色 Send 按钮形成视觉区分，三个按钮在 `else` 分支中按"人称选择器 → AI回复（紫）→ 润色（青）→ Send（蓝紫）"顺序自左向右排列。

**实现链路**（仅 ChatInputBar.tsx，对应 Task 3）：

1. **接口扩展**（`ChatInputBarProps`）：新增 3 个可选 props——`onPolishInput?: (text: string) => void`（润色回调，传入当前输入框文本）、`isPolishingInput?: boolean`（润色中状态）、`polishFlashKey?: number`（润色完成后触发 textarea 边框动画的递增计数器）。

2. **组件解构**：在解构参数列表末尾（`onUserReplyPersonChange` 之后）新增 `onPolishInput` / `isPolishingInput = false` / `polishFlashKey` 三个参数。

3. **flashBorder state + useEffect 动画**：
   - `const [flashBorder, setFlashBorder] = useState(false)`（紧随 `input` state 之后）
   - useEffect 监听 `polishFlashKey`：当其非零变化时 `setFlashBorder(true)`，并通过 `setTimeout(() => setFlashBorder(false), 600)` 触发 600ms 青色边框高亮动画；return 清理函数 `clearTimeout(timer)` 避免组件卸载或快速重复触发时的 timer 泄漏
   - 动画视觉：textarea `boxShadow: '0 0 0 2px rgba(20, 184, 166, 0.6)'`（青色半透明环），通过 `transition: 'border-color 0.2s ease, box-shadow 0.3s ease'` 实现 0.3s 平滑过渡

4. **textarea 修改**：
   - `disabled` 条件追加 `|| isPolishingInput`（润色中禁止编辑输入框，避免与流式回填冲突）
   - `transition` 由 `border-color 0.2s ease, box-shadow 0.2s ease` 改为 `border-color 0.2s ease, box-shadow 0.3s ease`（动画时长从 0.2s 延长到 0.3s）
   - style 中通过 `...(flashBorder ? { boxShadow: '0 0 0 2px rgba(20, 184, 166, 0.6)' } : {})` 动态注入 boxShadow
   - `onFocus` / `onBlur` 中加入 `if (flashBorder) return;` 早返保护，避免动画期间被 focus/blur 覆盖 boxShadow

5. **润色按钮 JSX**（位于 AI回复按钮 `</Tooltip>` 之后、Send 按钮 `<Tooltip>` 之前）：
   - `<Tooltip title={isPolishingInput ? '停止润色' : '润色当前输入文本（结合对话上下文与角色人设）'}>`
   - `icon={isPolishingInput ? <LoadingOutlined /> : <HighlightOutlined />}`
   - `onClick`：润色中调 `onCancel?.()`，正常态调 `onPolishInput?.(input)`
   - `disabled={!isPolishingInput && (!input.trim() || disabled || isStreaming || isOrganizing || isGeneratingUserReply)}`
   - 圆形 44×44px，`marginRight: '4px'`（与 Send 按钮间距）
   - 配色与 boxShadow 根据 `isPolishingInput` 双态切换

6. **联动禁用条件**（润色中时同步禁用其他交互元素，避免并发）：
   - textarea：追加 `|| isPolishingInput`
   - 人称选择器：追加 `|| isPolishingInput`
   - AI回复按钮：追加 `|| isPolishingInput`
   - Send 按钮：`disabled` 追加 `|| isPolishingInput`，且 `background` / `border` / `boxShadow` 三元判断条件均追加 `&& !isPolishingInput`（润色中 Send 按钮视觉上呈禁用态）

**验证**：TypeScript 编译无新增错误（`ChatInputBar.tsx` 0 错误，全量 typecheck 中该文件无报错）。⚠️ 本次仅完成 UI 层（接口扩展 + 组件解构 + state/effect + JSX + 联动禁用），Task 1（提示词层 `buildPolishInputSystemPrompt`）、Task 2（hook `polishInput` 函数）、Task 4（父组件 `CharacterDialogueChat.tsx` 透传 `onPolishInput` / `isPolishingInput` / `polishFlashKey`）尚未实施，故当前润色按钮点击后 `onPolishInput?.(input)` 调用因未透传而无实际效果（optional chaining 早返）。需 Task 1+2+4 全部完成后方可端到端验证润色流程。

> **增量更新（2026-07，Spec: refine-user-input-text / Task 2）**：在 `CharacterDialogueChat.hooks.ts` 中新增 `polishInput(originalText: string): Promise<string>` hook 函数（与 `generateUserReply` 对称），将上述第 5 步的 `onPolishInput?.(input)` 调用打通到 AI 引擎。具体修改：
>
> 1. **import 扩展**（第 12 行）：在 `PromptBuilder` named import 列表末尾追加 `buildPolishInputSystemPrompt`（Task 1 已导出）。
>
> 2. **state / ref 新增**（第 367-375 行，紧随 `isGeneratingUserReplyAbortRef` 之后）：
>    - `const [isPolishingInput, setIsPolishingInput] = useState(false)`：驱动 UI 按钮态切换与输入框禁用
>    - `const polishedAccumulatedRef = useRef<string>('')`：流式累积 chunk，完成后供 Promise resolve 使用
>    - `const isPolishingInputRef = useRef<boolean>(false)`：cancelRequest 中同步读取避免闭包陈旧
>    - `const isPolishingInputAbortRef = useRef<boolean>(false)`：cancelRequest 触发后用于 onStream 回调早返
>
> 3. **`polishInput` useCallback**（第 1745-1933 行，紧随 `generateUserReply` 之后）：完全复用 `generateUserReply` 的引擎调用链路，仅以下差异：
>    - **函数签名**：`(originalText: string) => Promise<string>`（接收原始文本参数，与 `generateUserReply` 无参数不同）
>    - **前置校验**（5 项，比 `generateUserReply` 多 1 项 `originalText` 校验）：① `originalText` 为空或仅空白 → `message.warning('请先输入需要润色的文本')` ② `selectedPersona` 为空 → `message.warning('请先在右侧面板选择用户人设')` ③ `state.isStreaming` / `isOrganizing` / `isGeneratingUserReply` / `isPolishingInputRef.current` 任一为 true 时静默 return ④ `getActiveEngineConfig()` 为空 → `message.warning('请先在设置中配置AI引擎')`
>    - **系统提示构建**：调用 `buildPolishInputSystemPrompt(characterInfo映射, selectedPersona, originalText, characterConfig?.userReplyPerson)`（与 `generateUserReply` 调用 `buildUserReplySystemPrompt` 仅函数名与多 1 个 `originalText` 参数的差异，characterInfo 字段映射与 `userReplyPerson` 透传完全一致）
>    - **engineConfigWithParams**：与 `generateUserReply` 完全一致（含 `stopSequences` 使用 `buildStopSequencesForUserReply(charName, customStopSequences)`，防止 AI 越权替角色发言；`temperature` / DRY 采样组 / `capabilities` 等所有字段逐字段复制）
>    - **ContextTruncator 裁剪**：与 `generateUserReply` 完全一致，包括 `await Promise.all([precountMessages, precountSystemPrompt])` 预热缓存、不注入 `roleAnchorMessage`（角色锚定不适用于用户输入润色）、`truncationAnalysis.wasTruncated` 时记 warn 日志
>    - **engine.onStream**：检查 `isPolishingInputAbortRef.current` 早返，否则累积到 `polishedAccumulatedRef.current`
>    - **engine.onComplete**：`resolve(response?.content || polishedAccumulatedRef.current)`（优先用 server 返回 content，回退到本地流式累积）
>    - **engine.onError**：`message.error('润色输入失败: ${error.message}')` + `addLog` + `reject`
>    - **engine.sendMessage catch**：与 `generateUserReply` 一致，捕获 sendMessage 抛出的同步异常并 reject
>    - **finally 块**：`setIsPolishingInput(false)` / `isPolishingInputRef.current = false` / `polishedAccumulatedRef.current = ''`（与 `generateUserReply` finally 块对称）
>    - **依赖数组**：`[selectedPersona, state.isStreaming, isOrganizing, isGeneratingUserReply, characterInfo, characterConfig, getActiveEngineConfig, getEffectiveParams, addLog]`——比 `generateUserReply` 多 `isGeneratingUserReply`（因为前置并发校验中读取了该 state），其余与 `generateUserReply` 完全一致；`originalText` 是参数不是闭包变量，不在依赖数组中
>
> 4. **hook 返回值扩展**（第 2393-2395 行）：在 `generateUserReply` / `isGeneratingUserReply` 之后追加 `polishInput,` / `isPolishingInput,`，供 `CharacterDialogueChat.tsx` 父组件透传到 `ChatInputBar`（Task 4 实施）。
>
> 5. **`cancelRequest` 追加润色中断逻辑**（第 2085-2091 行，紧随 `isGeneratingUserReplyRef.current` 中断逻辑之后）：若 `isPolishingInputRef.current` 为 true，则设置 `isPolishingInputAbortRef.current = true`（onStream 早返避免污染累积缓冲）+ 记日志。**关键设计**：不在此处调用 `engine.cancelRequest()`，因为下方统一调用 `engine.cancelRequest()` 已经覆盖该场景（与 `generateUserReply` 取消机制一致），由 `polishInput` 的 finally 块重置 state。**注意**：与 `generateUserReply` 取消逻辑的差异——`polishInput` 不在 cancelRequest 中提前重置 `isPolishingInputRef.current = false` 与 `setIsPolishingInput(false)`，因为 `engine.cancelRequest()` 会触发 onError 或 onComplete，由 `polishInput` 的 finally 块统一重置（避免重复重置）。
>
> **验证**：TypeScript 编译无新增错误（`CharacterDialogueChat.hooks.ts` 0 错误）。`polishInput` 函数与 `generateUserReply` 共享相同的引擎调用与参数注入模式，仅系统提示构建（`buildPolishInputSystemPrompt` vs `buildUserReplySystemPrompt`）与累积缓冲 ref（`polishedAccumulatedRef` vs `generatedReplyAccumulatedRef`）不同。⚠️ 本次仅完成 hook 层，Task 1（`buildPolishInputSystemPrompt` 提示词构建）已先行实施，Task 4（父组件 `CharacterDialogueChat.tsx` 透传 `onPolishInput` / `isPolishingInput` / `polishFlashKey` props 到 `ChatInputBar`）尚未实施，故当前 `polishInput` 已能从 hook 暴露但尚未在 UI 接通。需 Task 4 完成后方可端到端验证润色流程。

> **增量更新（2026-07，Spec: refine-user-input-text / Task 4）**：在 `CharacterDialogueChat.tsx` 父组件中接通润色功能与持久化，将 hook 层 `polishInput` / `isPolishingInput` 与 `ChatInputBar` UI 层的 3 个新 props 联通。具体修改：
>
> 1. **hook 解构扩展**（第 50-53 行）：在 `isGeneratingUserReply,` 之后追加 `polishInput,` / `isPolishingInput,`，从 `useCharacterDialogueChat(characterInfo)` 解构出 hook 暴露的两个新返回值。
>
> 2. **`polishFlashKey` state 新增**（第 93 行，紧随 `generatedReplyText` state 之后）：`const [polishFlashKey, setPolishFlashKey] = useState(0);`——递增计数器，每次润色成功后 `+1` 触发 `ChatInputBar` 内的 `useEffect` 监听器播放 600ms textarea 边框青色高亮动画。设计上独立于 `generatedReplyText`（文本回填机制），避免文本消费清空逻辑影响动画触发。
>
> 3. **`handlePolishInput` useCallback**（第 219-235 行，紧随 `handleGeneratedReplyTextConsumed` 之后）：
>    ```typescript
>    const handlePolishInput = useCallback(async (text: string) => {
>      try {
>        const polishedText = await polishInput(text);
>        if (polishedText) {
>          setGeneratedReplyText(polishedText);  // 复用 AI回复 按钮的文本填充机制
>          setPolishFlashKey(k => k + 1);        // 触发 textarea 边框青色高亮动画
>          message.success('已润色');
>        }
>      } catch {
>        // hook 内 message.error 已处理错误提示，此处无需重复
>      }
>    }, [polishInput]);
>    ```
>    **关键设计**：与 `handleGenerateUserReply` 对称——两者都通过 `setGeneratedReplyText` 复用同一文本回填机制（`ChatInputBar` 通过 `generatedReplyText` prop + `onGeneratedReplyTextConsumed` 回调消费并清空），但 `handlePolishInput` 多 1 个 `setPolishFlashKey` 调用以触发动画。**复用而非独立 state 的理由**：避免在 `ChatInputBar` 内同时监听两个文本源导致竞态，且 `generatedReplyText` 已有完整的"填充 → 消费 → 清空"生命周期管理。依赖数组仅 `[polishInput]`（hook 函数引用稳定，由 hook 内 useCallback 保证）。
>
> 4. **`<ChatInputBar>` JSX props 透传**（第 591-593 行，紧随 `onUserReplyPersonChange={handleUserReplyPersonChange}` 之后）：
>    ```tsx
>    onPolishInput={handlePolishInput}
>    isPolishingInput={isPolishingInput}
>    polishFlashKey={polishFlashKey}
>    ```
>    3 个 props 与 Task 3 中 `ChatInputBarProps` 接口扩展对应。
>
> **验证**：TypeScript 编译无新增错误（`CharacterDialogueChat.tsx` 0 新增错误；既有 3 个未使用 import 警告 `Popconfirm` / `DownloadOutlined, CopyOutlined, FullscreenExitOutlined` / `fetchMemoryTableData` 为预先存在，与本次修改无关）。`message` 已从 `antd` 导入（第 2 行 `import { Modal, message, Tooltip, Button, Popconfirm } from 'antd';`），无需新增 import。Task 1（提示词）+ Task 2（hook）+ Task 3（UI）+ Task 4（父组件透传）全链路联通，润色流程可端到端运行：用户点击"润色"按钮 → `ChatInputBar` 调 `onPolishInput?.(input)` → `handlePolishInput` 调 `polishInput` → hook 通过 `buildPolishInputSystemPrompt` + `engine.sendMessage` 流式生成 → 返回 polishedText → `setGeneratedReplyText` 回填输入框 + `setPolishFlashKey` 触发青色边框动画 + `message.success('已润色')`。

> **【重点标记】增量更新（2026-07-05，Spec: fix-polish-input-undo-and-target / Task 1 / Bug 2 修复）**：上述 `polishInput` 函数存在 Bug——`contextMessages` 取 `messagesRef.current.filter(msg => msg.role !== 'system')` 的全部对话历史，**对话历史以 AI 回复结尾**，AI 引擎在生成续写时倾向于"接着最后一条消息继续"，从而**误将最后一条 AI 回复作为润色对象**，而非用户在输入框中已输入但尚未发送的草稿文本。尽管 `polishSystemPrompt` 中已包含 `originalText`，但对话上下文末尾消息的影响力远大于系统提示中的文本片段。修复方案：在 `CharacterDialogueChat.hooks.ts:1889-1898` 的 `polishInput` 函数中，token 裁剪逻辑完成后、`engine.sendMessage` 调用前，向 `contextMessages` 末尾追加一条合成 user 消息：
>
> ```typescript
> contextMessages = [...contextMessages, {
>   id: `polish-target-${Date.now()}`,
>   role: 'user',
>   content: originalText,
>   timestamp: Date.now(),
>   status: 'sent',
> } as ChatMessage];
> ```
>
> **关键设计**：(1) 追加位置在 `if (tokenManagementEnabled) { ... }` 块**之后**，使合成消息不被裁剪逻辑移除；(2) 合成消息仅作为局部变量传递给 `engine.sendMessage`，**不**写入 `messagesRef.current`、**不**触发 `setState`、**不**调用 `saveChatToStore`、**不**显示在对话界面；(3) 与 `polishSystemPrompt` 中的 `originalText` 形成**双重锚定**——AI 引擎看到对话以"用户的草稿文本"结尾，且系统提示明确要求润色该文本，两处一致指向消除歧义；(4) `addLog` 日志中的 `context=N msgs` 自动反映追加后的总数（真实历史数 + 1），便于调试。**与 `generateUserReply` 的对称检查**：经审查，`generateUserReply` 不存在此问题，因为其目标是"从无到有生成新回复"，AI 续写最后一条消息即为期望行为，无需修改。**测试覆盖**：新增 `__tests__/polishInputTargetFix.test.ts` 7 个用例（纯函数提取 `buildPolishContextMessages` 测试），覆盖空历史 / AI 结尾 / user 结尾三种上下文场景与合成消息字段校验。TypeScript 编译无新增错误。

> **【重点标记】增量更新（2026-07-05，Spec: fix-polish-target-misinterpretation）**：⚠️ 上述 `fix-polish-input-undo-and-target` 的 Bug 2 修复（追加合成 user 消息）**引入了新的功能异常**——AI 将待润色的用户输入错误处理为需要直接回答的问题，而非润色对象。
>
> **问题表现**：
> - 用户输入："你吃饭了吗"
> - 期望输出（润色扩展）："你今天早上吃饭了吗？在哪里吃的？"
> - 实际输出（直接回答）："我吃过了"
>
> **根因**：在 OpenAI 风格的 chat completion API 中，`messages` 数组末尾的 user 消息被视为"当前轮次用户输入"，AI 的职责是"回复"该消息。将 `originalText` 作为合成 user 消息追加到末尾，等价于让 AI"回答"这段文本，而非"润色"它。即使 `polishSystemPrompt` 中明确"你是文本润色器"，user 消息的"提问"语义压倒了系统提示的润色指令。**关键洞察**：根本问题是**消息角色**（user）而非**消息内容**——即使加标记，user 消息作为对话末尾仍会触发 AI 的"回复"本能。
>
> **修复方案**（两处修改）：
>
> 1. **回退合成 user 消息**（`CharacterDialogueChat.hooks.ts`）：移除 `polishInput` 函数中向 `contextMessages` 末尾追加合成 user 消息的代码块（原第 1889-1898 行）。`contextMessages` 恢复为 `messagesRef.current.filter(msg => msg.role !== 'system')` + token 裁剪后的真实对话历史。对话历史以 AI 回复结尾的状态恢复原状（这是正常的对话轮次结束状态）。
>
> 2. **强化系统提示润色对象锚定**（`PromptBuilder.ts:450-479`）：修改 `buildPolishInputSystemPrompt` 函数，通过以下手段强化润色对象识别：
>    - **标签包裹**：用 `<polish_target>` / `</polish_target>` 标签包裹 `originalText`，明确标识润色对象的边界
>    - **新增"## 关键约束"段落**（4 条约束，位于"待润色文本"之后、"任务要求"之前）：
>      - `<polish_target>` 标签内的文本是润色对象，不是需要回答的问题
>      - 即使 `<polish_target>` 内包含问句，也必须对其进行润色扩展，禁止生成对问句的回答
>      - 对话历史中的最后一条 AI 回复仅作为上下文参考，不是润色对象
>      - 你的唯一输出是润色后的 `<polish_target>` 文本本身，不要回答其中任何问题
>    - **保留**原有任务要求 1-7（保持原始意图 / 提升表达 / 符合人设 / 仅输出 / 长度约束 / 上下文连贯 / 人称视角）
>
> **为什么不在合成消息中使用标记**：考虑过在合成 user 消息的 content 中用 `[待润色]xxx[/待润色]` 标记包裹，但即使有标记，user 消息作为对话末尾仍会触发 AI 的"回复"本能。因此选择移除合成消息，回到"对话以 AI 回复结尾"的正常状态，通过系统提示的标签和约束来锚定润色对象。
>
> **测试覆盖**：`__tests__/PromptBuilder.polishInput.test.ts` 新增 7 个用例验证 `<polish_target>` 标签与"关键约束"段落（开闭标签存在 / 标签内文本与 originalText 一致 / 关键约束段落标题 / 4 条约束关键词）；`__tests__/polishInputTargetFix.test.ts` 已删除（合成消息逻辑已移除，测试死代码）。全量 1021 测试通过（+7 新增 -7 删除 = 净 0 变化）。TypeScript 编译无新增错误。

> **【重点标记】增量更新（2026-07-06，Spec: fix-polish-context-isolation）**：⚠️ 上述两轮修复（`fix-polish-input-undo-and-target` 追加合成 user 消息、`fix-polish-target-misinterpretation` 回退合成消息并强化 `<polish_target>` 标签与"关键约束"段落）**均未能解决润色功能的核心问题**——AI 仍将用户输入转换为直接回复，而非执行文本扩写与润色。本轮为**第三次修复**，根因定位到**消息结构层面**而非提示措辞层面。
>
> **根因确认**（通过 `ChatEngine.ts:89-93` 实现分析）：
> - `engine.sendMessage(contextMessages, systemPrompt, config)` 将消息组装为 `[system, ...contextMessages]` 发给 OpenAI 兼容 API
> - 润色场景下 `contextMessages` 是真实对话历史（user → assistant → user → assistant → ...），**几乎总是以 assistant 回复结尾**
> - OpenAI chat completion API 收到 `[system, ..., assistant]` 序列后，会自然"续写"下一条消息——即生成对最后一条 assistant 回复的延续或对话轮次的推进
> - 即使 system prompt 包含 `<polish_target>` 标签和 4 条"关键约束"，**system 消息在 chat completion 中的指令权重低于对话历史的强模式上下文**（已被广泛验证的 LLM 行为）
> - 结果：AI 将 `<polish_target>` 内的问句当作"待回答的问题"，生成直接回复（如"我吃过了"），而非润色扩展
>
> **关键洞察**：根本问题在**消息结构**（messages 数组以 assistant 结尾触发续写本能），而非提示措辞。无论系统提示如何强化约束，都无法对抗消息结构的主导作用。
>
> **修复方案**（两处修改，将对话历史从 messages 数组隔离到系统提示文本）：
>
> 1. **修改 `buildPolishInputSystemPrompt` 函数**（`PromptBuilder.ts:405-499`）：
>    - **函数签名扩展**：新增第 5 个可选参数 `conversationHistory?: ChatMessage[]`（`ChatMessage` 类型从 `./CharacterDialogueChat.types` import，与既有 `UserPersona` 同行）
>    - **新增"## 对话历史参考"段落**（位于"## 对方角色上下文"之后、"## 待润色文本"之前）：将 `conversationHistory` 格式化为 `[用户]: xxx\n[AI]: xxx` 文本嵌入系统提示；为空或未传入时显示"（无历史对话）"。段落标题明确标注"仅作上下文参考，不是润色对象，不要回答其中任何内容"
>    - **修改"## 关键约束"第 3 条**：从"对话历史中的最后一条 AI 回复仅作为上下文参考"改为"对话历史（含'## 对话历史参考'段落与 messages 数组中的历史消息）中的任何内容均仅作上下文参考，不是润色对象"
>    - **修改"## 任务要求"第 6 条**：从"结合对话历史与 ${charName} 的最新发言"改为"结合对话历史参考与 ${charName} 的最新发言"
>    - **JSDoc 补充**：新增 `@param conversationHistory` 说明与"润色上下文隔离"（Spec: fix-polish-context-isolation）说明段落
>    - **保留**上一轮 `<polish_target>` 标签包裹与"关键约束"段落（4 条约束，第 3 条文案已更新）
>
> 2. **修改 `polishInput` 函数**（`CharacterDialogueChat.hooks.ts:1780-1964`）：
>    - **代码重排**：将 `contextMessages` 定义（`messagesRef.current.filter(msg => msg.role !== 'system')`）与 token 裁剪逻辑**上移**至 `buildPolishInputSystemPrompt` 调用之前，使裁剪后的对话历史可作为 `conversationHistory` 参数传入
>    - **新增 `polishSystemPromptForCounting`**：因 token 裁剪需 `polishSystemPrompt` 估算系统提示 token 占用，而实际 `polishSystemPrompt`（含对话历史）需在裁剪后构建，存在循环依赖。解决方案：先构建**不含对话历史**的 preliminary 系统提示（`buildPolishInputSystemPrompt` 不传第 5 个参数）供 `TokenCounter` / `ContextTruncator` 估算 base 系统提示 token 占用；裁剪完成后再构建**含裁剪后对话历史**的实际 `polishSystemPrompt`。此设计下裁剪预算计算近似正确：truncator 限制历史 token ≤ `maxContextTokens - reservedForResponse - baseSystemPromptTokens`，无论历史进入 messages 数组还是系统提示文本，总 token 占用一致
>    - **`buildPolishInputSystemPrompt` 调用新增第 5 个参数**：传入裁剪后的 `contextMessages`（嵌入"## 对话历史参考"段落）
>    - **`engine.sendMessage` 调用修改**：第一个参数从 `contextMessages` 改为新增的 `polishRequestMessages`——单条 user 消息 `{ content: '请润色上述 <polish_target> 标签内的文本，直接输出润色后的文本本身。' }`，明确指示 AI 执行润色任务
>    - **`addLog` 日志不变**：仍使用 `contextMessages.length` 反映真实（裁剪后）对话历史数，便于调试
>
> **修复后 AI 收到的消息结构**：
> - 修复前：`[system(含<polish_target>与约束), ...对话历史(以assistant结尾)]` → AI 续写对话
> - 修复后：`[system(含对话历史参考+<polish_target>+约束), user(润色请求)]` → AI 执行润色任务
>
> **为什么这次能解决问题**：messages 数组末尾从"assistant 回复（触发续写/回复本能）"变为"user 润色请求（触发执行润色任务）"；对话历史从"messages 数组强模式上下文"降级为"系统提示文本弱参考上下文"；system prompt 约束力从"被对话历史压倒"变为"唯一上下文源，约束力最大化"。
>
> **测试覆盖**：`__tests__/PromptBuilder.polishInput.test.ts` 既有 34 个用例全部通过，新增 7 个用例验证"## 对话历史参考"段落（段落标题存在 / "仅作上下文参考"文本存在 / 传入历史时输出 `[用户]` 与 `[AI]` 格式 / 未传入时显示"（无历史对话）" / 段落位置正确 / 关键约束第 3 条已更新），总计 41 个用例。全量 1028 测试通过（1021 基线 + 7 新增）。TypeScript 编译无新增错误（唯一预先存在的 `tsconfig.json` `WatchOptions.include` 警告与本次修改无关）。

> **第四条【重点标记】增量更新（2026-07-06，Spec: fix-polish-task-framing）**：⚠️ 上述三轮修复（阶段六 `fix-polish-input-undo-and-target`、阶段七 `fix-polish-target-misinterpretation`、阶段八 `fix-polish-context-isolation`）**均未能解决润色功能的核心问题**——AI 仍将用户输入转换为直接回复，而非执行文本扩写与润色。本轮为**第四次修复（任务框架重构）**，根因定位到**系统提示语义层面**而非消息结构层面。前三轮修复均无效，因为只解决了"消息结构"问题，没有解决"系统提示语义"问题；本次从任务框架（Task Framing）层面入手，彻底去除对话生成语义信号。
>
> **背景与原缺陷** ⚠️：
> - 前三轮修复（阶段六/七/八）均未能解决润色功能的核心问题：AI 仍将用户输入转换为直接回复，而非执行文本扩写与润色
> - 阶段八的"上下文隔离"修复只改变了对话历史的传输通道（从 messages 数组移到 system prompt 文本），但**没有消除让 AI 进入对话模式的语义信号**
> - 系统提示中残留多个"对话生成"语义触发器，让 AI 优先走对话生成路径
>
> **根因**（详细列出 4 点）：
> - **personConstraint 措辞错误（最关键）**：第 7 条任务要求使用"以第一人称视角**生成回复**"，与孪生函数 `buildUserReplySystemPrompt` 完全相同。"生成回复"是核心误导词
> - **任务要求第 6 条"结合对话历史参考与 ${charName} 的最新发言确保上下文连贯"** 是对话生成指令
> - **关键约束位于待润色文本之后**，attention 被稀释
> - **"## 对方角色上下文"段落包含 personality + characterCardContent**，是角色扮演触发器
>
> **关键洞察**：只要"生成回复"+"确保上下文连贯"这两个对话生成关键词还在润色提示里，无论对话历史放哪一层、用什么标签包裹 originalText，AI 都会优先走对话生成路径。
>
> **修复方案**（任务框架重构，7 项改动）：
>
> 1. **改动 1**：强化开头任务定义，明确"**禁止生成对话回复，禁止回答 <polish_target> 内的任何问题**"
> 2. **改动 2**：精简"## 对方角色上下文"为"## 角色名（仅作润色参考，不要扮演这个角色）"，去除 personality 和 characterCardContent
> 3. **改动 3**：调整段落顺序，"## 关键约束"提前到"## 待润色文本"之前
> 4. **改动 4**：关键约束使用强禁止措辞（"**绝对禁止**回答..."、"**绝对禁止**生成对话回复"）
> 5. **改动 5**：任务要求第 6 条改为"润色结果需与对话历史不矛盾即可，**无需衔接角色发言，无需推进对话**"
> 6. **改动 6**：personConstraint 措辞从"生成回复"改为"输出"（"润色后的文本以第一人称视角输出"）
> 7. **改动 7**：JSDoc 注释更新
>
> **系统提示结构对比表**（修复前 vs 修复后）：
>
> | 维度 | 阶段八方案 | 阶段九方案 |
> |---|---|---|
> | 任务定义 | "你是文本润色器，需要基于对话上下文优化..." | "你是文本润色器...**禁止生成对话回复，禁止回答 <polish_target> 内的任何问题**" |
> | 角色上下文 | 完整 personality + characterCardContent（角色扮演触发器） | 仅角色名（无扮演触发） |
> | 关键约束位置 | 待润色文本之后（attention 被稀释） | 待润色文本之前（约束力最大化） |
> | 关键约束措辞 | "不是需要回答的问题"（弱否定） | "**绝对禁止**回答...**绝对禁止**生成对话回复"（强禁止） |
> | 任务要求第 6 条 | "结合对话历史参考与 ${charName} 的最新发言确保上下文连贯"（对话生成指令） | "润色结果需与对话历史不矛盾即可，无需衔接角色发言，无需推进对话"（反对话生成） |
> | personConstraint | "以第一人称视角**生成回复**" | "润色后的文本以第一人称视角**输出**" |
>
> **与阶段八的关系**：
> - 阶段八解决"消息结构"问题（对话历史以 assistant 结尾触发续写本能），把对话历史从 messages 数组隔离到系统提示文本
> - 阶段九解决"系统提示语义"问题（残留对话生成关键词），彻底重构系统提示措辞
> - 两者叠加才能彻底切断 AI 走对话生成路径的可能性
> - 阶段九仅在 `buildPolishInputSystemPrompt` 函数内重构，不动 `polishInput` 调用结构（[system, user(润色请求)] 消息结构保留）
>
> **验证**：
> - `__tests__/PromptBuilder.polishInput.test.ts` 更新 6 个现有用例 + 新增 8 个用例，总计 50 个用例
> - 全量测试 1037 通过（1028 + 9 个新增/调整）
> - 无新增编译错误
>
> **修改的文件**：
> - `src/renderer/components/Character/CharacterDialogueChat/PromptBuilder.ts`（重构 `buildPolishInputSystemPrompt` 函数）
> - `src/renderer/components/Character/CharacterDialogueChat/__tests__/PromptBuilder.polishInput.test.ts`（更新 + 新增测试用例）

#### 用户消息卷回按钮（rollback-user-message）

> Spec: rollback-user-message / Task 2（UI 层）
> 状态: 已实施（2026-07）

**背景与原缺陷** ⚠️：原 `ChatMessageBubble.tsx` 用户消息气泡下方 `userEditButton` 区域包含一个 `EditOutlined` 编辑按钮，点击进入内联编辑模式（`handleEditStart` / `handleEditSave`），保存时仅原地更新消息内容（`editMessage`）——**不会重新触发 AI 回复**，导致编辑后的用户消息与原有 AI 回复语义脱节、上下文不连贯，用户体验不佳。已修复（rollback-user-message spec / Task 2）。

> **【增量更新】（2026-07-26，AI 回复序号显示）**：
> - **需求**：为对话中的每次 AI 回复添加从 1 开始的编号，便于用户在排查截断等问题时定位特定回复。
> - **实现**：`CharacterDialogueChat.tsx` 渲染消息列表时，对每条 `role === 'assistant'` 的消息计算序号（在它之前的 assistant 消息数量 + 1），通过 `aiSequenceNumber` prop 传入 `ChatMessageBubble`。组件在角色名旁渲染 `#N` 徽章样式标签（10px 字号、半透明背景、圆角）。
> - **修改文件**：`CharacterDialogueChat.tsx`（序号计算 + prop 传递）、`ChatMessageBubble.tsx`（prop 声明 + 头部渲染）。

**设计借鉴说明**：参照 Trae IDE "回退到本轮对话发起前" 的交互范式，将用户消息编辑按钮**重构为卷回按钮**——点击后把该用户消息内容完整回退到对话输入框供用户修改重发，同时移除该用户消息及其后所有消息（含对应 AI 回复），使对话状态回到该轮发起前。用户重新发送后 AI 基于新内容生成全新回复，保证语义连贯。

**实现链路**（仅 `ChatMessageBubble.tsx`，对应 Task 2）：

1. **import 扩展**（第 3 行）：在 `@ant-design/icons` named import 列表末尾追加 `RollbackOutlined`（与原 `EditOutlined` 共存——`EditOutlined` 仍被助手消息 `actionButtons` 编辑按钮使用）。

2. **`ChatMessageBubbleProps` 接口扩展**（第 7-19 行）：在 `onEdit?` 之后新增可选 prop `onRollback?: (messageId: string) => void`。**保留** `onEdit` prop（助手消息 `actionButtons` 编辑仍使用）。

3. **组件参数解构扩展**（第 20-34 行）：在解构参数列表中 `onEdit,` 之后追加 `onRollback,`。

4. **`userEditButton` 重构**（第 294-340 行，核心修改）：
   - **移除**原 `EditOutlined` 按钮及 `isEditing` 三元判断（`onClick` 中的 `handleEditStart` / `handleEditSave` 分支、`color: isEditing ? ... : ...` 配色切换、Tooltip 文案 `isEditing ? '保存编辑' : '编辑内容'`）
   - **新增** `RollbackOutlined` 卷回按钮：
     - `<Tooltip title="卷回到输入框">` 包裹
     - `onClick`: 调用 `onRollback?.(message.id)`（可选链，因为 `onRollback` 为可选 prop；Task 3 父组件透传后才会实际生效）
     - `disabled`: `isStreaming && !isLastMessage`（**关键设计**：最后一轮流式生成中允许卷回——Task 1 hook 中 `rollbackToMessage` 会先调 `cancelRequest()` 中断流式再移除消息；非最后一轮 streaming 时禁用以避免状态冲突）
     - 图标：`<RollbackOutlined />`
     - 配色：默认 `var(--chat-action-text, #9ca3af)`，hover 时 `var(--primary-color, #6366f1)` 文字色 + `var(--chat-action-hover, rgba(255, 255, 255, 0.1))` 背景
     - 按钮样式与原编辑按钮一致（`background: none; border: none; padding: 6px 8px; font-size: 12px; border-radius: 6px; transition: all 0.2s ease`）
     - `cursor` / `opacity` 跟随 `disabled` 状态切换（`isStreaming && !isLastMessage` 时 `cursor: 'not-allowed'` + `opacity: 0.5`）
     - `onMouseEnter` / `onMouseLeave` 复用原编辑按钮的 hover 颜色切换逻辑，但增加 `if (!(isStreaming && !isLastMessage))` 早返保护，避免 disabled 态下 hover 仍改样式

5. **保留项**（关键约束）：
   - **保留**所有内联编辑机制（`isEditing` / `editContent` / `textareaRef` / `handleEditStart` / `handleEditCancel` / `handleEditSave` / `handleEditKeyDown`），因为助手消息 `actionButtons` 中第 174-211 行的 `showFullActions` 块仍使用 `EditOutlined` 编辑按钮
   - **保留** `onEdit` prop 及 `actionButtons` 中的助手消息编辑按钮（不变）
   - 仅修改 `userEditButton` 这一个变量块，`actionButtons`（第 133-289 行）保持原样

**与 AI回复 / 润色按钮的协同设计**：
- Task 3（父组件透传）实施后，`onRollback` 将调用 `handleRollback` → `rollbackToMessage`（Task 1 hook 已实施）→ 返回用户消息内容 → 父组件通过 `setGeneratedReplyText(content)` 复用与 AI回复 / 润色按钮相同的输入框填充机制（`ChatInputBar` 通过 `generatedReplyText` prop + `onGeneratedReplyTextConsumed` 回调消费并清空）
- 三个功能（AI回复 / 润色 / 卷回）共享同一文本回填生命周期管理，避免在 `ChatInputBar` 内同时监听多个文本源导致竞态

**验证**：TypeScript 编译无新增错误（`ChatMessageBubble.tsx` 0 错误）。⚠️ 本次仅完成 UI 层（接口扩展 + 组件解构 + `userEditButton` 重构），Task 1（hook `rollbackToMessage`）已先行实施，Task 3（父组件 `CharacterDialogueChat.tsx` 透传 `onRollback` prop）、Task 5（文档完整章节）尚未全部完成。当前卷回按钮点击后 `onRollback?.(message.id)` 调用因未透传而无实际效果（optional chaining 早返）。需 Task 3 完成后方可端到端验证卷回流程。

**单元测试（Spec: rollback-user-message / Task 4，2026-07-05 完成）**：

`src/renderer/components/Character/CharacterDialogueChat/__tests__/rollbackToMessage.test.ts` 采用**纯函数提取测试策略**——`rollbackToMessage` 实际实现位于 `CharacterDialogueChat.hooks.ts:2116-2154`，依赖 `messagesRef` / `setState` / `cancelRequest` / `saveChatToStore` / `addLog` 等 hook 内部状态与副作用，难以在隔离环境下直接测试。因此将其核心算法（消息数组查找 / role 校验 / `slice(0, messageIndex)` 裁剪 / 内容返回）提取为纯函数 `rollbackToMessageCore(messages, messageId) => { content, updatedMessages }` 进行测试，验证算法正确性。

测试覆盖 7 个场景（全部通过，4ms）：
1. 卷回最后一条用户消息：移除该消息 + AI 回复，返回用户消息内容
2. 卷回中间轮次用户消息：移除该消息及所有后续消息
3. 卷回第一条用户消息：移除所有消息，返回内容
4. messageId 不存在时返回空串且不修改消息列表（与 hook 中 `findIndex === -1` 早返分支对应）
5. 目标消息 role 不是 user 时返回空串且不修改消息列表（与 hook 中 `targetMessage.role !== 'user'` 早返分支对应）
6. 空消息列表时返回空串
7. 卷回后返回的内容与原用户消息内容完全一致（含中文 / 英文 / 数字 / 特殊符号的长文本完整性校验）

**注意事项**：纯函数测试不覆盖 hook 副作用（`cancelRequest` 取消流式、`saveChatToStore` 持久化、`setState` 状态合并、`addLog` 日志记录），这些副作用需通过 Task 4.3 手动验证场景确认。如后续需要测试副作用，需引入 `@testing-library/react` + `renderHook` 并 mock Electron API 与 ChatEngineFactory。

#### 角色深度锚定（depth_prompt）机制

> Spec: optimize-chat-ai-intelligence / Task 4
> 状态: 已实施（2026-07）

**背景与原缺陷** ⚠️：原 `PromptBuilder.ts::buildCharacterContext` 只在 system prompt 头部出现一次，长上下文截断后早期角色设定被"稀释"，AI 性格逐渐漂移（用户反馈"AI OOC"问题的核心成因之一）。已修复（optimize-chat-ai-intelligence spec / Task 4）。借鉴 SillyTavern `data.extensions.depth_prompt` 机制（源码 `public/script.js:549, 4424-4425`，角色卡 `data.extensions.depth_prompt` 默认 depth=4 周期性注入对话深处），在裁剪后消息列表 depth=4 位置注入角色精简摘要。同时与 system prompt 末尾追加的"角色卡为绝对权威"约束句形成"系统提示 + 深度锚定"双重角色一致性保障。

**实现链路**：

1. **`buildRoleAnchorMessage(characterCard, userName)`**（`PromptBuilder.ts:86-147`）：构建角色深度锚定 system 消息。
   - 新增 `RoleAnchorCharacterCard` 接口（`name` / `personality` / `description` 三字段），兼容 `CharacterInfo`
   - 摘要提取规则：`personality` 前 200 字符（`ROLE_ANCHOR_SUMMARY_MAX_CHARS=200`）；`personality` 为空（含空白字符）时 fallback 到 `description` 前 200 字符；两者皆空时 summary 为空字符串（仍输出锚定文案）
   - 格式：`[角色锚定] {{char}} 的核心设定：{{summary}}。始终以 {{char}} 视角回复，禁止替 {{user}} 发言。`
   - `{{char}}` 替换为 `characterCard.name`（缺省 `'Character'`），`{{user}}` 替换为 `userName`（缺省 `'User'`）；处理空白字符回退

2. **system prompt 末尾追加"角色卡为绝对权威"约束**（`PromptBuilder.ts::buildCharacterContext` 第 264-268 行）：
   - 约束句：`【重要】角色卡设定为绝对权威，必须严格遵循 ${charName} 的性格、背景与说话方式，不得偏离。`
   - 实现位置选择 `buildCharacterContext` 末尾：该方法被 `buildPromptCore` 调用，结果作为 `character_context` 变量传给模板系统与硬编码回退两条路径，因此两条路径都会包含此约束

3. **`ContextTruncator.truncateMessages` 二阶段裁剪**（`ContextTruncator.ts`）：
   - **重构**：提取 `truncateCore` 私有方法承载原 budget + 软下限 + 倒序填充逻辑；`truncateMessages` 改为二阶段裁剪协调器
   - 新增可选第 5 参数 `roleAnchorMessage?: {role:'system'; content:string}`（**向后兼容**：不传时行为与 Task 2 完全一致，现有 4 参数调用方无需改动）
   - 新增 `withRoleAnchorTokens` 私有方法：在 `requiredItems` 中注入 roleAnchor 真实 token（用 `TokenCounter.countSystemPromptTokens` 估算 `roleAnchorMessage.content`），保持 spec reserve 顺序 `[systemPrompt, roleAnchor, stopSequenceReserve, exampleMessages, responseReserve]`
   - 新增 `insertRoleAnchorMessage` 私有方法：在 depth=4 位置插入 system 消息
   - **二阶段裁剪流程**：
     1. 阶段 1：按调用方 `requiredItems`（或默认 `roleAnchor=0`）裁剪，得到 `firstPass`
     2. 阶段 2：若传入 `roleAnchorMessage` 且 `firstPass` 历史 token > `maxContextTokens * 0.5`：注入 roleAnchor 真实 token 重新裁剪 → 在 depth=4 位置插入锚定消息
     3. 否则直接返回 `firstPass`（spec Scenario: 短对话不锚定）
   - ⚠️ **关键设计修正**：depth=4 含义按 SillyTavern 标准实现——roleAnchor 位于倒数第 4 位（即其后有 3 条对话消息），`insertIndex = messages.length - 3`（而非 `messages.length - 4`）。spec 字面"从末尾往前数第 4 条之前插入"会导致 roleAnchor 位于倒数第 5 位，与 spec"插入后该 system 消息位于倒数第 4 位"矛盾，最终以"插入后位于倒数第 4 位"为准
   - 边界处理：`messages.length < 4` 时插在末尾（spec 约束）

4. **`hooks.ts::requestAIResponse` 调用集成**（`CharacterDialogueChat.hooks.ts` 第 707-726 行）：
   - 在 `truncateMessages` 调用前构建 `roleAnchorMessage = buildRoleAnchorMessage(characterInfo映射, selectedPersona?.name || 'User')`
   - 字段映射：`characterInfo.characterCardName → name`、`personality → personality`、`characterCardContent → description`
   - 传入 `truncateMessages` 第 5 参数；`requiredItems` 传 `undefined`（使用默认必填项，`ContextTruncator` 内部按需注入真实 token）
   - 注入检测：调用后扫描 `truncatedMessages` 是否含 `content.startsWith('[角色锚定]')` 的 system 消息，记日志便于排查

**验证**：新增 31 个单元测试（`buildRoleAnchorMessage.test.ts` 17 个 + `roleAnchorIntegration.test.ts` 14 个）：
- `buildRoleAnchorMessage`：覆盖 personality 提取/截断、description fallback、空白字符处理、`{{char}}`/`{{user}}` 替换、name/userName 缺省回退、完整格式校验
- `roleAnchorIntegration`：覆盖长对话注入（depth=4 位置正确性 `result.length - anchorIndex === 4`、roleAnchor id 唯一性 `^role-anchor-` 前缀、token 计入 budget）、短对话不注入、向后兼容（不传 `roleAnchorMessage`）、调用方传 `requiredItems` 含 `roleAnchor=300`、`ContextTruncator` 内部估算 roleAnchor token
- `npx vitest run` 全量 116 个测试通过（Task 1/2/3 既有 85 个 + Task 4 新增 31 个）
- ⚠️ 无法真实调用 AI API 验证"长对话角色一致性"实际效果（spec Scenario: 长对话角色一致性），改为通过单元测试验证 depth=4 位置插入逻辑与 token 阈值判断的正确性

#### 对话智能度优化机制总览

> Spec: optimize-chat-ai-intelligence / Task 1-8
> 状态: 已实施（2026-07）

本节汇总 `optimize-chat-ai-intelligence` spec 实施的 **5 项核心机制** 与 **3 项辅助机制**，借鉴 SillyTavern v1.18.0 的成熟设计并针对 creative-cafe 测试沙箱场景做了适配。详细对比结论见 `docs/SILLYTAVERN_TECHNICAL_ANALYSIS.md` 末尾"对比结论"章节。

**5 项核心机制索引**（按对话主流程时序排列）：

| # | 机制 | 原缺陷（⚠️ 已修复） | 关键文件 | 借鉴的 SillyTavern 源码 |
|---|------|---------------------|---------|------------------------|
| 1 | Budget 双向预留上下文裁剪 | 末尾累加 + minMessagesToKeep 回退挤占必填项 | `ContextTruncator.ts`（`TokenBudget` 类） | `openai.js:3988/4115` `reserveBudget` / `canAfford` |
| 2 | Stop Sequences 防抢话 | 请求体无 `stop` 字段，AI 抢话生成下一条用户消息 | `PromptBuilder.ts::buildStopSequences` | `script.js:2966` `getStoppingStrings`（`names_as_stop_strings`） |
| 3 | 角色深度锚定 depth_prompt | 角色设定仅 system prompt 头部一次，长对话 OOC | `PromptBuilder.ts::buildRoleAnchorMessage` + `ContextTruncator.ts::insertRoleAnchorMessage` | `script.js:549, 4424-4425` `data.extensions.depth_prompt` |
| 4 | 重试/续写去重检测 | 无 AI 回复去重/相似度检测，重试常得到几乎相同的回复 | `utils/similarityUtils.ts` + `hooks.ts::requestAIResponse` | （非直接借鉴，SillyTavern 靠采样参数防重复；creative-cafe 补充应用层 n-gram Jaccard 去重） |
| 5 | 对话历史 RAG 检索 | 对话历史向量化与 RAG 脱节，长对话引用早期细节失效 | `ChatVectorizationService.ts::retrieveChatHistory` + `hooks.ts::requestAIResponse` | （受 `worldinfo.js` World Info 向量检索启发，用向量检索替代关键字匹配） |

**3 项辅助机制**：

| # | 机制 | 说明 | 关键文件 |
|---|------|------|---------|
| A | 精确 Token 计数（cl100k_base） | 替代字节估算，中文误差从 ±15% 降至 ±3% | `TokenCountService.ts` + `TokenCounter` |
| B | AI 超参数默认值 + DRY 采样 + 防重复强度预设 | top_p=0.95 / freq_pen=0.1 / pres_pen=0.1 / rep_pen=1.1 + DRY 采样 + 三档预设（宽松/标准/严格） | `parameterConfigs.ts` + `ChatEngine.types.ts::buildSamplingExtras` + `ParameterPanel.tsx` |
| C | continue_nudge_prompt 续写约束 | 续写重叠率 > 60% 触发重新生成 | `PromptBuilder.ts::buildContinuationPrompt` + `buildContinueNudgePrompt` |
| D | 回复长度引导约束 + 诊断日志 | 系统提示末尾注入字数下限约束（默认 300 字）；连续 3 轮短回复自动强化；每轮记录 chars/tokens/duration/参数到 console+日志面板 | `PromptBuilder.ts::buildLengthGuidancePrompt` + `hooks.ts::shouldStrengthenLength` + `ParameterPanel.tsx`（min_response_chars Slider） |
| E | 用户回复生成（AI 回复按钮） | "AI回复"按钮以当前 UserPersona 为基准生成下一句用户侧对话内容，自动填入输入框供用户编辑后发送；与 `requestAIResponse` 对称（系统提示/停止序列/消息落地三处差异） | `PromptBuilder.ts::buildUserReplySystemPrompt` + `buildStopSequencesForUserReply` + `hooks.ts::generateUserReply` + `ChatInputBar.tsx`（紫色渐变按钮） |

**触发条件速查**：

- 角色深度锚定：裁剪后对话历史 token > `maxContextTokens * 0.5` 时注入 depth=4
- 对话历史 RAG 检索：`contextMessages.length > 40`（即 > 20 轮）触发检索
- 增量向量化：`(contextMessages.length + 1) % 10 === 0`（即每 5 轮用户+AI）触发
- 重试去重：`nGramJaccard(previousResponse, newResponse, 4) > 0.8` 触发重新生成（最多 2 次）
- 续写去重：`overlapRate(newPart, initialContent) > 0.6` 触发 `continue_nudge_prompt` 重新生成（最多 2 次）

#### 重试/续写去重检测（n-gram Jaccard）

> Spec: optimize-chat-ai-intelligence / Task 5
> 状态: 已实施（2026-07）

**背景与原缺陷** ⚠️：原 `CharacterDialogueChat.hooks.ts::retryMessage` 与 `continueConversation` **无任何 AI 回复去重/相似度检测**——用户点击"重试"时，AI 经常返回与原回复几乎相同的内容（仅标点或个别字词差异），用户需要反复点击 3-5 次才能得到有差异的回复；续写时 AI 原样重写已有内容也是常见问题。此为用户反馈"重试无效/续写重复"问题的直接技术根因，影响重试与续写两大核心交互。已修复（optimize-chat-ai-intelligence spec / Task 5）。

**设计借鉴说明**：SillyTavern **不做重试去重**，靠 `repetition_penalty` / DRY 采样等采样参数在生成阶段防重复（见 Task 6）。creative-cafe 在采样参数之上**补充应用层去重**——生成完成后用 n-gram Jaccard 量化相似度，超阈值则自动重新生成。该机制为 creative-cafe 原创补充，非直接借鉴 SillyTavern。

**实现链路**：

1. **`utils/similarityUtils.ts`**（核心相似度算法）：
   - `nGramJaccard(textA, textB, n=4): number`：字符级 4-gram 集合 Jaccard 相似度。中文友好（无需分词），Set 去重 + 较小集合上迭代计算交集。500 字文本对实测 < 1ms（spec 要求 < 50ms）
   - `overlapRate(newContent, initialContent): number`：最长公共前缀长度 / `initialContent` 长度。用于续写场景检测 AI 是否原样重写已有内容
   - `evaluateDedupRetry` 纯函数：封装去重决策逻辑（retry / continue / mixed / exhausted / 自定义阈值），供 `hooks.ts` 与单元测试共用
   - 导出常量：`DEDUP_SIMILARITY_THRESHOLD=0.8` / `DEDUP_OVERLAP_THRESHOLD=0.6` / `DEDUP_MAX_RETRIES=2`

2. **`hooks.ts::requestAIResponse` 重试去重**（`retryMessage` 流程）：
   - `requestAIResponse` 新增可选第 5 参数 `dedupConfig?: DedupConfig`（**向后兼容**，不破坏现有签名）
   - `retryMessage` 捕获 `existingMessage.content` 作为 `previousResponse`，传入 `dedupConfig`
   - `engine.onComplete` 内：`nGramJaccard(previousResponse, displayContent, 4) > 0.8` 且 `retryCount < maxRetries` 时递归调用 `requestAIResponse`（`retryCount+1`）
   - 耗尽时 `message.info('已尝试 N 次，回复相似度较高')` 并保留最后结果（antd `message.info()`，与项目现有通知方式一致）

3. **`hooks.ts::requestAIResponse` 续写去重**（`continueConversation` 流程）：
   - `continueConversation` 调用 `requestAIResponse(currentMessages, targetMessageId, existingContent, 'continuation')` 无需改动
   - **自动检测**：`promptType === 'continuation' && initialContent` 非空时启用 overlap 检查
   - `engine.onComplete` 内：剥离 `displayContent` 的 `initialContent` 前缀后计算 `overlapRate(newPart, initialContent)`，> 0.6 时重试并注入 `continue_nudge_prompt`（`injectContinueNudge: true`）
   - 重试时将 `buildContinueNudgePrompt()` 作为 system 消息追加到 `messagesToSend` 末尾（Task 5 占位实现，Task 8 完善——见下文"continue_nudge_prompt 续写约束"小节）

4. **`PromptBuilder.ts::buildContinueNudgePrompt()`**：返回 `[Continue your last message without repeating its original content.]`（Task 8.1/8.2 已完善，位置 `PromptBuilder.ts:149-168`）

**关键文件路径**：
- `src/renderer/components/Character/CharacterDialogueChat/utils/similarityUtils.ts`
- `src/renderer/components/Character/CharacterDialogueChat/CharacterDialogueChat.hooks.ts`（`requestAIResponse` / `retryMessage` / `continueConversation`）
- `src/renderer/components/Character/CharacterDialogueChat/utils/PromptBuilder.ts`（`buildContinueNudgePrompt`）
- `src/renderer/components/Character/CharacterDialogueChat/utils/__tests__/similarityUtils.test.ts`

**验证**：新增 38 个单元测试（`similarityUtils.test.ts` 34 个 + `buildContinueNudgePrompt.test.ts` 4 个）：
- `nGramJaccard`：相同=1.0 / 不同=0.0 / 部分相似 / 空文本 / 短文本 / 对称性
- `overlapRate`：完全前缀=1.0 / 不匹配=0.0 / 部分匹配 / 续写场景
- `evaluateDedupRetry`：retry / continue / mixed / exhausted / 自定义阈值
- 性能测试：500 字文本对 < 50ms（实测 < 1ms）
- `npx vitest run` 全量 154 个测试通过（Task 1-4 既有 116 个 + Task 5 新增 38 个）
- ⚠️ 无法真实调用 AI API 验证"连续点击重试 3 次"实际场景（spec SubTask 5.5），改为通过 `evaluateDedupRetry` 纯函数单测验证完整重试流程决策正确性（首次相似→重试1→重试2→耗尽 / 首次相似→重试1→不同→停止）

#### 对话历史 RAG 检索

> Spec: optimize-chat-ai-intelligence / Task 7
> 状态: 已实施（2026-07）

**背景与原缺陷** ⚠️：原 `ChatVectorizationService` 虽然在每次对话保存后调用 `vectorizeChat` 向量化整段对话，但**对话主流程（`requestAIResponse`）从不检索这些向量**——向量化的对话历史与 RAG 检索完全脱节。原 `requestAIResponse` 只调 `context:retrieve` 检索知识库/世界书/记忆（外部来源），从不检索本会话历史。导致 20+ 轮长对话中，AI 无法引用早期对话细节（用户反馈"AI 忘了第 3 轮说过的内容"问题）。已修复（optimize-chat-ai-intelligence spec / Task 7）。

**设计借鉴说明**：受 SillyTavern `worldinfo.js` World Info 向量检索启发（源码 `endpoints/worldinfo.js`，World Info 条目支持 `vectorized: true` 走向量检索替代关键字匹配），creative-cafe 将同套向量基础设施应用于**本会话历史消息**——用向量检索替代关键字匹配，召回语义相关而非字面相关的早期对话片段。

**实现链路**：

1. **`ChatVectorizationService.ts::retrieveChatHistory(chatId, queryText, topK=3, minScore=0.6)`**：
   - 位置：`searchChatMessages` 方法之后、`buildMessageText` 之前
   - 流程：`embeddingService.generateEmbedding(queryText)` 向量化查询文本 → `vectorStoreService.search(vector, candidateCount, {source: CHARACTER_CHAT, characterId: chatId})` → 按分数过滤 + 截断 topK → 提取 `content/score/timestamp` → 按时间升序排序
   - 候选数 `candidateCount = Math.max(topK * 2, topK)` 提升召回率；score < minScore(0.6) 过滤；空 content 过滤
   - 全程 try-catch，失败仅 `console.error` 并返回空数组（**绝不阻塞对话主流程**）

2. **`ChatVectorizationService.ts::vectorizeIncremental(chatId, messages: Message[])`**：
   - **幂等性保证**：稳定 vectorId = `chat_${chatId}_msg_${message.id}`，通过 `vectorStoreService.getById(vectorId)` 检查已存在则跳过（与原 `vectorizeChat` 的 `chat_${characterId}_${chunkIndex}` ID 格式不冲突）
   - 跳过空消息与 system 消息；逐条 `generateEmbedding` + `add`（`isIncremental=true` 标记）
   - 持久化 + registry 注册/更新（`getVectorFilesBySourceId` 查找已存在记录，存在则 `updateVectorFile`，不存在则 `registerVectorFile`）
   - 全程 try-catch，失败仅 `console.error` 不抛异常（fire-and-forget 调用方不 await）

> **【重点标记】增量更新（2026-07，诊断日志补全）**：针对用户反馈"向量化结果长时间不返回，无法判断是向量化未完成还是结果未处理"的可观测性盲点，在关键节点补全耗时与进度日志：
> - `ChatVectorizationService.vectorizeIncremental` 循环内：每条消息的 embedding 开始（含 `role`/`textLen`/`id`）、embedding 完成耗时、`add` 完成确认、跳过/失败原因；循环外记录 `starting` / `persisting N vectors` / `persist done in Xms` / `completed in Xms`
> - `VecstoreVectorStore.doPersist`：`export_json()` 耗时（WASM 同步阻塞可观测）、`writeFile` 耗时、总耗时
> - `EmbeddingService.generateEmbedding`（remote 模式）：`fetch` 耗时与状态码（与单条 30s 超时配套，定位是慢还是卡死）
> - `aiHandlers.ts`：`ai:stream:complete` 发送前后各一条日志（确认主进程事件链路完整）
> - 渲染层 `hooks.ts` 已有 `[DEBUG-COMPLETE] === engine.onComplete called ===` 与 `Step A2-incremental: triggering vectorizeIncremental` 日志，构成完整事件链
> - 根因记录：`vectorizeIncremental` 对最近 10 条消息**串行**调用远程 Embedding API，10 × 2-3s = 20-30s 等待期，此前日志空白导致用户无法判断进度。本次仅补日志，并行化优化待后续 spec 处理
> - 涉及文件：`src/main/services/ChatVectorizationService.ts`、`src/main/services/VecstoreVectorStore.ts`、`src/main/services/EmbeddingService.ts`、`src/main/ipc/handlers/aiHandlers.ts`

> **【重点标记】增量更新（2026-07，向量化崩溃修复）**：针对用户反馈"向量化过程中 Electron 主进程自动崩溃"的问题，定位根因并修复：
> - **问题现象**：AI 流式响应完成后（`SSE 解析成功`），增量向量化触发但主进程随即崩溃，`vectorizeIncremental: starting` 日志一条都没输出，紧接着出现 `ERROR: This operation returned because the timeout period expired.` 和 `vite-plugin-electron` 的 `taskkill /T /F` 超时崩溃
> - **根因分析**：`src/main` 目录**完全没有 `process.on('unhandledRejection')` / `process.on('uncaughtException')` 处理器**（致命缺陷）。`ipcMain.handle('chatHistory:vectorizeIncremental')` handler **无 try-catch 包裹**，若 `vectorizeIncremental` 内部有任何异常逃逸三层 try-catch（或产生未 await 的 Promise rejection），Node.js 16+ 默认会退出进程。Electron 主进程退出后触发 `vite-plugin-electron` 的 `startup.exit → treeKillSync → taskkill /T /F`，而 `taskkill` 无超时保护，最终导致 Vite 父进程也崩溃
> - **修复方案**：
>   1. 在 `src/main/index.ts` 顶部添加全局 `process.on('unhandledRejection')` 和 `process.on('uncaughtException')` 处理器，仅记录日志不退出进程（兜底所有逃逸异常）
>   2. 为 `chatHistory:vectorizeIncremental` IPC handler 添加 try-catch + 进入日志，返回 `{success: false, error}` 而非抛出异常
>   3. 为 `chatHistory:retrieve` IPC handler 添加 try-catch + 进入日志，失败返回空数组（与内部失败行为一致）
> - **关键代码**：`src/main/index.ts` 第 6-16 行全局异常处理器；`src/main/ipc/handlers/characterChatHandlers.ts` 第 107-135 行两个 handler 的 try-catch 包裹
> - **验证方式**：下次复现时，若异常逃逸，日志将输出 `[Main Process] UNHANDLED REJECTION (swallowed to prevent crash): ...` 而非崩溃；若异常在 handler 内，日志将输出 `[IPC] chatHistory:vectorizeIncremental: handler error: ...` 并返回 `{success: false}`
> - **后续优化**：`vectorizeIncremental` 内部三层 try-catch 仍需审查是否有未 await 的 Promise 产生 rejection；`vite-plugin-electron` 的 `treeKillSync` 无超时是第三方库问题
> - 涉及文件：`src/main/index.ts`、`src/main/ipc/handlers/characterChatHandlers.ts`

> **【重点标记】增量更新（2026-07，对话卡死修复）**：针对用户反馈"AI 响应完成后对话状态仍旧显示正在生成中"的问题，定位根因并修复：
> - **问题现象**：日志显示 `SSE 解析成功` → `Sending ai:stream:complete event to renderer (content length: 0 chars)` → `ai:stream:complete event sent`，事件已发送但 UI 永远停留在"正在生成中"
> - **根因**：`ChatEngine.ts` 的 `handleComplete` 函数中有守卫 `if (finalContent) { this.completeCallback?.(response); }`——当 AI 返回空内容（流式 chunk 全部无 `delta.content`，且最终 `message.content` 也为空）时，`finalContent` 为空字符串（falsy），`completeCallback` **永远不会被调用**。hooks.ts 的 `onComplete` 回调不触发 → 消息状态不从 "sending" 更新 → UI 卡死
> - **修复方案**：移除 `if (finalContent)` 守卫，始终调用 `completeCallback`，即使内容为空（`content: finalContent || ''`）。空内容时输出 warn 日志 `[ChatEngine] handleComplete: finalContent is empty, calling completeCallback with empty content to prevent UI stuck`
> - **附带修复**：`aiHandlers.ts` 第 629 行的 content length 日志此前检查 `data?.content?.length`（错误路径，SSE 解析后内容在 `data?.choices?.[0]?.message?.content`），导致日志永远显示 `0 chars` 误导诊断。修正为检查 `data?.choices?.[0]?.message?.content?.length || data?.choices?.[0]?.text?.length || data?.content?.length || 0`
> - 涉及文件：`src/renderer/components/Common/ChatEngine/ChatEngine.ts`（第 259-272 行）、`src/main/ipc/handlers/aiHandlers.ts`（第 629-635 行）

> **【重点标记】增量更新（2026-07，think 标签剥离导致内容保护检查误触发修复）**：`strip_think_tags` 开关默认开启后，AI 回复完成后 UI 卡死在"正在生成中"的真正根因：
> - **问题现象**：流式渲染正常（用户能看到内容），向量化正常触发，但消息状态指示器永远不切换到"完成"
> - **根因**：`onComplete` 回调中 `stripThinkingTags` 剥离了 think 标签内容 → `displayContent.length` < 流式渲染时累积的 `existingContent.length`（后者含 think 标签）→ 触发 `hooks.ts:1305` 的内容保护检查（`return prev`）→ 状态不更新 → UI 卡死
> - **修复方案**：在 think 标签剥离处（`hooks.ts:1091-1099`）增加 `thinkTagsStripped` 标志位，在内容保护检查条件（`hooks.ts:1311`）中增加 `&& !thinkTagsStripped`，跳过 think 标签剥离导致的合法缩短
> - **与 `handle-think-tags-overflow` spec 的关系**：此修复是 think 标签后处理开关的配套修复——没有此修复，开关启用时必然导致 UI 卡死
> - 涉及文件：`src/renderer/components/Character/CharacterDialogueChat/CharacterDialogueChat.hooks.ts`（第 1091-1099 行标志位、第 1311 行保护检查条件）

> **【重点标记】增量更新（2026-07-26，stop sequences / max_tokens 截断导致内容保护检查误触发修复）**：
> - **根因**：当 stop sequences 触发提前结束或 max_tokens 耗尽时，`onComplete` 收到的 `finalContent`（`serverContent`）可能短于流式阶段累积的 `existingContent`。此时 `displayContent.length < existingContent.length` 触发内容保护检查 `return prev`，状态不更新 → UI 卡死在"正在生成中"。
> - **修复**：在内容保护检查中增加 `stopTruncated` 容差标志——当 `displayContent.length >= existingContent.length * 0.3` 时视为合法截断（stop/max_tokens 触发），跳过保护检查。阈值 30% 用于区分"合法截断"与"真正的内容丢失"。
> - **修改文件**：`src/renderer/components/Character/CharacterDialogueChat/CharacterDialogueChat.hooks.ts` 第 1394-1400 行

3. **IPC handler**（`src/main/ipc/handlers/characterChatHandlers.ts`）：
   - `chatHistory:retrieve`（参数：chatId, queryText, topK?, minScore?；默认 topK=3 / minScore=0.6）
   - `chatHistory:vectorizeIncremental`（参数：chatId, messages；返回 `{success: true}`）
   - 位置：`chatVector:search` handler 之后

4. **preload.ts 暴露**：`window.electronAPI.chatHistory.retrieve` / `vectorizeIncremental`（`chatVector` namespace 之后新增 `chatHistory` namespace）；同步更新 `src/renderer/types/electron.d.ts` 类型声明

5. **`hooks.ts::requestAIResponse` RAG 检索集成**（步骤 A2）：
   - **触发条件纯函数** `shouldTriggerRagRetrieval(contextMessagesLength)`：`contextMessages.length > 40` 时触发（20 轮 × 2 = 40 条，严格大于）
   - 在原步骤 A（`context.retrieveWithKeywords`）之后新增步骤 A2：调用 `chatHistory.retrieve`，结果格式化为"区域 2：本会话相关历史片段"段落追加到 system prompt
   - **区域编号重命名**：原"区域 2：记忆表格数据"重命名为"区域 3"，原"区域 3：记忆表格异步整理指令"重命名为"区域 4"，新增"区域 2：本会话相关历史片段"插入在区域 1 之后、区域 3 之前（spec 要求顺序连贯）
   - `PromptBuilder.ts::buildFinalSystemPrompt` 新增第 6 参数 `chatHistoryItems?`，注入格式含相关度百分比 + 历史片段内容 + 区域边界标记；`buildSystemPrompt` 与 `usePromptBuilder.buildCompleteSystemPrompt` 同步透传
   - chatId 标识一致性：`characterInfo.characterCardName || characterInfo.characterCardId`，与 `ChatVectorizationService.vectorizeChat` 的 characterId 同源，保证检索命中
   - 检索失败时 try-catch 降级为空数组（`addLog warn`），不阻塞主流程

6. **`hooks.ts::requestAIResponse` 增量向量化集成**（流式完成后）：
   - **触发条件纯函数** `shouldTriggerIncrementalVectorize(contextMessagesLength)`：`(contextMessages.length + 1) % 10 === 0`（+1 代表本轮 AI 响应，`onComplete` 时已生成）
   - **消息提取纯函数** `extractRecentMessagesForVectorize(contextMessages, aiResponseText, aiMessageId, count=10)`：取 `contextMessages` 末尾 9 条 + 本轮 AI 响应 = 共 10 条
   - **fire-and-forget**：不 await，`.catch(err => addLog warn)` 内部处理错误；触发失败时 try-catch 降级（`addLog warn`），不阻塞对话主流程

**关键文件路径**：
- `src/main/services/ChatVectorizationService.ts`（`retrieveChatHistory` / `vectorizeIncremental`）
- `src/main/ipc/handlers/characterChatHandlers.ts`（IPC handler 注册）
- `src/main/preload.ts` + `src/renderer/types/electron.d.ts`（API 暴露）
- `src/renderer/components/Character/CharacterDialogueChat/CharacterDialogueChat.hooks.ts`（`requestAIResponse` 集成）
- `src/renderer/components/Character/CharacterDialogueChat/utils/PromptBuilder.ts`（`buildFinalSystemPrompt` 区域 2 注入）
- `src/renderer/components/Character/CharacterDialogueChat/utils/chatHistoryRagUtils.ts`（3 个纯函数）
- 测试：`src/main/services/__tests__/ChatVectorizationService.test.ts`（22 个）+ `utils/__tests__/chatHistoryRagUtils.test.ts`（15 个）+ `__tests__/buildFinalSystemPrompt.chatHistory.test.ts`（10 个）

**验证**：新增 47 个单元测试，`npx vitest run` 全量 246 个测试通过（Task 1-6 既有 199 个 + Task 7 新增 47 个）
- ⚠️ **重点标记 - 类型错误修复**：`chatHistoryRagUtils.ts` 第 80 行 tsc 报错 `Argument of type '{ id: string; role: "assistant"; ... }' is not assignable to parameter of type '{ ...; name: string | undefined; ... }'`。根因：`.map()` 回调返回 `name: msg.speakerName`（`string | undefined`），TS 推断数组元素 `name` 为必填字段（`name: string | undefined`），导致后续 push 不含 `name` 的对象时类型不兼容。修复方式：显式声明 `const recent: RecentMessage[]`（`name?: string` 可选而非 `name: string | undefined` 必填）阻止 TS 推断收窄
- ⚠️ 无法真实调用 AI API 验证"第 21 轮触发检索"实际场景（spec SubTask 7.7），改为通过纯函数单测验证触发条件决策正确性（`shouldTriggerRagRetrieval` / `shouldTriggerIncrementalVectorize`）

#### continue_nudge_prompt 续写约束

> Spec: optimize-chat-ai-intelligence / Task 8
> 状态: 已实施（2026-07）

**背景与原缺陷** ⚠️：原 `continueConversation` 在续写时，AI 经常**原样重写已有内容**而非追加新内容——流式返回的开头几百字与 `initialContent` 完全相同，用户看到的"续写"实际上是"重写"。原代码无任何检测与约束机制。此为用户反馈"续写重复"问题的核心成因（与 Task 5 续写去重检测形成"检测 + 约束"双重防线）。已修复（optimize-chat-ai-intelligence spec / Task 8）。

**设计借鉴说明**：借鉴 SillyTavern `continue_nudge_prompt` 机制（源码 `public/scripts/openai.js:110`，`default_continue_nudge_prompt` 默认值 `[Continue your last message without repeating its original content.]`，在续写请求中作为 system 消息注入），creative-cafe 在 `buildContinuationPrompt` 末尾追加 nudge 段落，并在重试时通过 `injectContinueNudge=true` 在消息数组末尾追加 nudge system 消息，形成"system prompt 段落 + 消息数组末尾 system 消息"双重提示。

**实现链路**：

1. **`PromptBuilder.ts::buildContinueNudgePrompt()`**（Task 5 占位 → Task 8.1/8.2 完善）：
   - 位置：`PromptBuilder.ts:149-168`（`buildRoleAnchorMessage` 之后、`replaceTemplates` 之前）
   - 返回 `[Continue your last message without repeating its original content.]`（spec 文本一致性）

2. **`PromptBuilder.ts::buildContinuationPrompt` 末尾追加 nudge 段落**（Task 8.1）：
   - 位置：`PromptBuilder.ts:407-486`（`buildContinuationPrompt` 函数）
   - 实现：新增 `nudgeSection = \`\n\n【续写去重约束】\n${buildContinueNudgePrompt()}\`` 常量
   - 在**模板路径**返回前（`promptResult.data.systemPrompt + nudgeSection`）与**硬编码回退路径**返回末尾（`${personaSection}${nudgeSection}`）均追加
   - **不破坏现有签名**：`buildContinuationPrompt(characterInfo, selectedPersona?, organizeMode?)` 三参数保持不变，nudge 作为内部追加
   - 同步更新 `buildContinueNudgePrompt` 函数注释：从"Task 5 占位实现"更新为"Task 8.1/8.2 已完善"，明确双重防线语义

3. **`hooks.ts::continueConversation` 重试时注入 nudge**（Task 8.2）：
   - 验证 Task 5 已完整实现：`continueConversation` 调用 `requestAIResponse('continuation')` → `onComplete` 中检测 `overlapRate > 0.6`（`hooks.ts:1141-1167`）→ 触发重试 `requestAIResponse(..., nextDedupConfig={retryCount+1, injectContinueNudge:true})`
   - SubTask 8.1 完成后，重试时 `requestAIResponse` 重新进入会再次调用 `buildContinuationPrompt`（始终含 nudge 段落），自动满足"重新构建 prompt 含 continue_nudge_prompt"
   - 重试时通过 `injectContinueNudge=true` 在 `messagesToSendFinal` 末尾追加 nudge system 消息（`hooks.ts:1385-1396`），形成"system prompt 段落 + 消息数组末尾 system 消息"双重提示
   - 重新生成最多 2 次（`DEFAULT_MAX_DEDUP_RETRIES=2`），耗尽后 `message.info('已尝试 N 次，续写重叠率较高')` 并保留最后结果
   - 更新 `hooks.ts` 中 3 处 Task 5 占位注释为"Task 8.2 已完善"（`DedupConfig` 文档、`onComplete` 决策注释、`injectContinueNudge` 块注释）

**双重防线语义**：
- **第一重防线**（Task 8.1）：`buildContinuationPrompt` 始终在 system prompt 末尾追加 nudge 段落，预防性提示 AI 不要重复
- **第二重防线**（Task 5.3 + Task 8.2）：若第一重失效（AI 仍原样重写），`overlapRate > 0.6` 检测触发重试，重试时在消息数组末尾追加 nudge system 消息强化提示，最多重试 2 次

**关键文件路径**：
- `src/renderer/components/Character/CharacterDialogueChat/utils/PromptBuilder.ts`（`buildContinueNudgePrompt` / `buildContinuationPrompt`）
- `src/renderer/components/Character/CharacterDialogueChat/CharacterDialogueChat.hooks.ts`（`continueConversation` / `requestAIResponse` 重试逻辑）
- 测试：`__tests__/buildContinuationPrompt.nudge.test.ts`（22 个）

**验证**：新增 22 个单元测试（`buildContinuationPrompt.nudge.test.ts`）：
- Task 8.1 覆盖（9 个）：硬编码回退路径含 nudge、模板路径含 nudge、nudge 段落格式正确（【续写去重约束】前缀）、nudge 位于末尾、spec 原文一致性、organizeMode=async/sync/undefined 三态都含 nudge、nudge 文本与 `buildContinueNudgePrompt()` 一致
- Task 8.2 覆盖（8 个）：通过 `evaluateDedupRetry` 纯函数验证 `overlapRate > 0.6` 触发重试、<= 0.6 不触发、retryCount=0/1 触发、retryCount=2 耗尽、总生成次数上限=3、续写去重不依赖 previousResponse、`injectContinueNudge` 语义验证
- Task 8.3 覆盖（5 个）：首次调用含 nudge、重试调用仍含 nudge（纯函数特性）、模板与硬编码路径 nudge 一致、模拟首次+2次重试 3 次调用都含 nudge、nudge 始终位于末尾区域
- `npx vitest run` 全量 268 个测试通过（Task 1-7 既有 246 个 + Task 8 新增 22 个）
- `npx tsc --noEmit` 改动文件无新增类型错误（`PromptBuilder.ts` 第 192 行 `parseMesExample` 错误与 `hooks.ts` 全部错误均为预先存在，与 Task 8 无关）
- ⚠️ 无法真实调用 AI API 验证"AI 原样重写已有内容"实际场景（spec SubTask 8.3），改为通过 `evaluateDedupRetry` 纯函数单测验证续写去重决策正确性 + `buildContinuationPrompt` 多次调用（模拟重试）的 nudge 一致性

### 3.4 MessageRenderer 插件链架构

MessageRenderer 基于 unified 生态的 remark-rehype 管线，处理 **Markdown → HTML** 的完整转换：

```
Raw Content
    ↓
replaceTemplates ({{char}}/{{user}})
    ↓ normalizeQuotes (引号包裹为<q>标签)
    ↓ protectCodeBlocks (代码块占位符保护)
    ↓
【Remark 阶段 (Markdown → MDAST)】
    ├── remarkGfm              (GFM 表格/删除线/任务列表)
    ├── remarkTableCellRawHtml (表格中内联 HTML 解析)
    ├── remarkEmoji            (Emoji 表情符号)
    └── remarkUnderscoreItalic (_斜体_ 语法支持)
    ↓
【Rehype 阶段 (MDAST → HAST)】
    ├── rehypeRaw                    (原始 HTML 解析)
    ├── rehypeInlineHtmlParse        (内联 HTML: span/div/a/b/strong/i/em/u/s 等)
    ├── rehypeSanitize               (安全净化: strict/moderate/loose)
    ├── rehypeQuoteNormalize         (引号规范化: 中日英弯曲引号统一)
    ├── rehypeQuoteHighlight         (引号内容高亮, 支持多语言引号)
    ├── rehypeCodeHighlight          (代码块语言类标记)
    └── rehypeStyleProcessor         (样式作用域限定, 危险样式过滤)
    ↓
ReactMarkdown Components
    ↓
Rendered HTML (安全的富文本消息)
```

### 3.5 安全净化三级策略

| 级别 | 允许的标签 | 协议 | 场景 |
|------|-----------|------|------|
| **strict** | 基础标签 (b/i/u/s/del/code/pre/p/div 等) | http/https/mailto/tel | 严格安全环境 |
| **moderate** (默认) | + details/summary/abbr/kbd/figure 等 | + data: 协议 | 正常对话 |
| **loose** | + audio/video/ruby/bdi/wbr 等 | + blob:/ftp: 协议 | 富媒体场景 |

```typescript
// 配置方式
import { createSanitizeSchema } from '../utils/sanitizeConfig';
const schema = createSanitizeSchema({ level: 'moderate' });
```

#### Think 标签后处理（Spec: handle-think-tags-overflow）

针对 deepseek3.2 等老模型在回复中内联 think / thinking / thought 推理标签的问题，模块提供两层清理机制：

| 层级 | 时机 | 实现 | 受控内容 |
|------|------|------|----------|
| **存储时剥离**（默认开启） | `requestAIResponse.onComplete` 与 `polishInput.onComplete` 写入存储前 | `stripThinkingTags(finalContent)` | chat history / RAG 向量化 / 回传上下文均使用剥离后内容 |
| **渲染时兜底** | `processMessage` 内 | 同 `stripThinkingTags` | 仅影响显示，处理历史已保存的脏数据 |

- 开关字段：`AIParameterConfig.strip_think_tags?: boolean`，`undefined` / `true` 视为开启
- 关闭行为：AI 原始回复（含 think 标签）直接存入历史，但渲染层仍由兜底剥离保持显示干净
- 流式 `onStream` 阶段不剥离，避免未闭合标签误删后续正文；仅在 `onComplete` 时做一次性剥离

> **【重点标记】增量更新（2026-07-26，stripThinkingTags 未闭合标签贪婪正则误删修复）**：
> - **根因**：`stripThinkingTags` 第 3 步未闭合标签正则 `/<(think|thinking|thought)\b[^>]*>[\s\S]*$/gi` 会从首次出现的 `<think` 字面量删到文本末尾。若 AI 在故事中提及"思考标签"、模仿 XML、或输出 `<thought>` 字面量，后半部分内容全部丢失——表现为 AI 回复被截断。
> - **修复**：正则改为 `/(?:^|\n)[ \t]*<(think|thinking|thought)\b[^>]*>[\s\S]*$/gi`，要求未闭合的 `<think` 标签必须位于行首（文本起始 `^` 或换行 `\n` 之后），因为真实推理标签通常出现在回复开头或新行起始处，而非句子中间。
> - **修改文件**：`src/renderer/components/Character/CharacterDialogueChat/utils/messageProcessor.ts` 第 158-164 行

### 3.6 组件树结构

```
CharacterDialogueChat (Modal 容器)
├── <style> (CSS 动画/背景/滚动条)
├── div.chat-area (对话主区域, 70%宽度)
│   ├── div.chat-area-bg (暗色渐变背景 + 光晕球体 + 网格纹理)
│   ├── ChatHeader
│   │   ├── 头像/角色名
│   │   ├── 消息统计
│   │   ├── 全屏切换按钮
│   │   ├── 清空对话 (Popconfirm)
│   │   ├── 导出对话
│   │   └── 关闭按钮
│   ├── div.chat-messages (可滚动消息列表)
│   │   ├── 空状态提示 (角色图标 + 欢迎文字)
│   │   ├── ChatMessageBubble[] (每条消息)
│   │   │   └── MessageRenderer (Markdown→HTML 渲染)
│   │   ├── ChatTypingIndicator (仅 AI 回复中)
│   │   ├── 错误提示 div
│   │   └── 滚动到底部按钮 (浮动)
│   └── ChatInputBar
│       ├── TextArea (消息输入)
│       │   ├── placeholder: "Message {角色名}..."
│       │   ├── Enter 发送 / Shift+Enter 换行
│       │   └── AutoSize (2-6 行)
│       ├── AI回复按钮 (紫色渐变, RobotOutlined/LoadingOutlined, Send 按钮左侧)
│       │   ├── 正常态: 触发 generateUserReply 以当前用户人设生成对话回复
│       │   ├── 生成中: 红色渐变 + LoadingOutlined, 点击触发取消
│       │   └── 禁用态: disabled / isStreaming / isOrganizing 时禁用
│       └── 发送/取消按钮
└── ConfigPanel (配置右侧面板, 30%宽度)
    ├── PersonaPanel
    │   ├── 标题 "用户人设"
    │   ├── 人设卡片列表 (头像 Base64 + 名称)
    │   └── 选中态高亮
    ├── KnowledgeBaseBindingPanel
    │   ├── 标题 "知识库绑定"
    │   ├── 绑定状态标签
    │   ├── Select (多选知识库)
    │   └── 提示说明
    ├── ParameterPanel
    │   ├── 标题 "AI 参数配置"
    │   ├── 自定义状态徽章
    │   ├── 5 个参数滑块:
    │   │   ├── Max Tokens (256-32768)
    │   │   ├── Temperature (0.1-2.0)
    │   │   ├── Top P (0.1-1.0)
    │   │   ├── Frequency Penalty (-2.0-2.0)
    │   │   └── Presence Penalty (-2.0-2.0)
    │   └── 重置按钮
    └── 保存设置按钮
```

### 3.7 状态管理设计

#### ChatState (核心对话状态)

```typescript
interface ChatState {
  messages: ChatMessage[];       // 消息列表
  isLoading: boolean;            // 是否正在请求
  isStreaming: boolean;          // 是否流式输出中
  error: string | null;          // 错误信息
}
```

#### ChatMessage (消息模型)

```typescript
interface ChatMessage {
  id: string;                    // 唯一消息 ID
  role: 'user' | 'assistant' | 'system';
  content: string;               // 消息内容
  timestamp: number;             // 时间戳
  status?: 'sending' | 'sent' | 'error';  // 消息状态
}
```

#### 配置状态 (useCharacterConfig)

| 配置项 | 存储方式 | 说明 |
|--------|---------|------|
| `selectedPersonaId` | localStorage + 主进程 JSON | 当前选中的人设 ID |
| `customParameters` | localStorage + 主进程 JSON | 自定义 AI 参数覆盖 |
| `boundKnowledgeBaseIds` | localStorage + 主进程 JSON | 绑定的知识库 ID 列表 |

#### 引用状态 (useRef)

| Ref | 用途 |
|-----|------|
| `messagesRef` | 保持消息列表的最新引用，供异步回调读取 |
| `firstMessageSentRef` | 标记是否已发送过首条消息 |
| `initialContentRef` | 续写时的初始内容缓存 |
| `streamContentRef` | 流式响应的累积内容 |
| `targetMessageIdRef` | 当前正在生成的 AI 消息 ID |
| `isGeneratingUserReplyRef` | 用户回复生成中的同步读取标志（避免 cancelRequest 闭包陈旧，Spec: add-ai-user-reply-button / Task 2.3） |
| `isGeneratingUserReplyAbortRef` | 用户回复生成取消标志（onStream 早返避免污染累积缓冲） |
| `generatedReplyAccumulatedRef` | 用户回复生成的流式 chunk 累积缓冲（onComplete 中作为 fallback 文本来源） |

---

## 4. 关键技术要点

### 4.1 技术难点与解决方案

| 难点 | 解决方案 |
|------|---------|
| **Stream Closure 闭包陈旧问题** | 使用 `useRef` 持有最新状态引用（`messagesRef`, `targetMessageIdRef`, `streamContentRef`），流式回调中通过 ref 访问最新值而非闭包中的旧值 |
| **续写内容丢失保护** | 三层保护: (1) `streamContentRef` 累积; (2) `onComplete` 中比较服务器返回与累积内容; (3) Content Protection 防止最终内容短于流式阶段内容 |
| **配置实时生效** | `configRef` 在 `updateConfig` 中同步更新（不等 React 渲染），确保 sendMessage 立即读取最新配置 |
| **Prompt 质量保证** | 精心设计的对话/续写 Prompt 包含角色信息、约束规则、禁止项和输出格式四层结构，防止 AI "打破第四面墙" |
| **向量上下文注入** | 在每次 AI 请求前异步检索相关知识，以 "相关背景知识" 段落追加到系统提示词，失败时静默降级不影响对话 |
| **引号多语言兼容** | `normalizeQuotes` 处理 7 种引号配对（英文直引号/弯曲引号/全角引号/日文引号等），代码块内引号保护不变 |
| **安全渲染** | 三级 sanitize 策略 + rehypeStyleProcessor 过滤危险 CSS (expression/url-javascript/behavior)，样式作用域限定在 `.message-renderer` 下 |

### 4.2 性能优化策略

1. **useMemo 缓存**: `effectiveParams` 通过 `getEffectiveParams` + `useMemo` 避免重复计算
2. **MessageRenderer 插件缓存**: `remarkPlugins` / `rehypePlugins` / `components` / `sanitizeSchema` 全部使用 `useMemo`
3. **消息内容预处理**: 预处理在 `useMemo` 中完成，避免每次渲染重复执行
4. **懒加载人设**: Personas 通过 `useEffect` 异步加载，不影响首屏渲染
5. **按需渲染**: `ChatTypingIndicator` 仅在流式开始且最新消息为 user 时显示
6. **引擎单例复用**: `ChatEngineFactory` 按配置缓存引擎实例，避免重复创建

### 4.3 安全考虑

- 所有 HTML 渲染经过 `rehype-sanitize` 净化
- CSS 中的 `expression()` / `url(javascript:)` / `behavior:` 被过滤
- `<style>` 标签内的选择器限定在 `.message-renderer` 命名空间
- 用户输入不直接注入 Prompt，通过模板组装
- 对话历史存储在应用数据隔离目录
- AI 请求通过主进程代理，API Key 不暴露

### 4.4 边界情况处理

- 无历史对话且无 `first_mes` → 显示空状态欢迎提示
- 有 `first_mes` 且无历史 → 自动将首条消息设为对话起点
- AI 返回空响应 → 保持原内容并标记错误状态
- 流式响应中断 → 使用已累积的内容作为最终结果
- 保存失败 → 静默日志记录，不影响正常对话流程
- 全屏模式 → 锁定 body 滚动，显示独立的全屏 Modal
- 多字节字符截断 → 流式累积确保 Unicode 完整性
- 老模型（如 deepseek3.2）返回 think 推理标签 → 由 `strip_think_tags` 开关控制，默认在 `onComplete` 写入存储前剥离（参见 3.5 节）

---

## 5. 模块间关系

### 5.1 依赖关系

```
CharacterDialogueChat
    ├──→ CharacterManager (触发入口, 传递 CharacterInfo)
    │       └──→ characterInfo: { creativeId, characterCardId, name, personality, ... }
    ├──→ Setting Module (AI 引擎配置)
    │       └──→ useSettingStore().setting.aiEngines / activeEngineId
    ├──→ Avatar Module (人设列表)
    │       └──→ window.electronAPI.avatar.list/read
    ├──→ Common/ChatEngine (聊天引擎工厂)
    │       └──→ ChatEngineFactory.getInstance()
    │       └──→ AIEngineConfig → Stream/Complete/Error 回调
    ├──→ Common/MessageRenderer (消息渲染)
    │       └──→ 7 个 remark/rehype 插件链
    ├──→ Knowledge Base Module (向量检索)
    │       └──→ context:retrieve (检索相关上下文)
    │       └──→ vector.getAvailableScopes (可用知识库列表)
    ├──→ Character Chat Store (对话持久化)
    │       └──→ saveTestChat / loadTestChat
    ├──→ Character Config (配置持久化)
    │       └──→ characterConfig:save/load
    ├──→ Chat Storage Service (主进程文件存储)
    │       └──→ getTestChat / saveTestChat / deleteTestChat
    └──→ Chat Vectorization Service (对话向量化)
            └──→ vectorizeChat / searchChatMessages
```

### 5.2 被依赖关系

```
CharacterManager
    └──→ 点击"对话"按钮 → 打开 CharacterDialogueChat Modal
Creative Module
    └──→ CharacterChat.tsx (创意工坊中的对话入口)
```

### 5.3 数据流

```
用户操作 (发送消息)
    ↓
useCharacterDialogueChat.sendMessage(content)
    ↓
创建 userMessage + 创建空 assistantMessage
    ↓ 更新 ChatState
    ↓
requestAIResponse(contextMessages, targetId, initialContent, 'dialogue')
    ├── 1. getActiveEngineConfig() → AI 引擎配置
    ├── 2. getEffectiveParams() → 合并参数 (custom > global > default)
    ├── 3. context:retrieve() → 向量检索相关知识
    ├── 4. buildDialoguePrompt() → 组装系统提示词
    ├── 5. ChatEngine.sendMessage() → 发送 AI 请求
    │       ├── onStream: 更新 streamContentRef → setState 更新消息内容
    │       └── onComplete: 验证内容 → 标记 sent → saveChatToStore 持久化
    └── 6. 错误处理: onError 回调 → 更新错误状态
```

---

## 6. 数据持久化

### 6.1 存储机制

| 数据项 | 存储格式 | 存储位置 |
|--------|---------|---------|
| 对话历史 | JSON 文件 | `{userData}/data/memories/chats/{角色名}.json` |
| 对话配置 | localStorage + JSON 文件 | `localStorage[character-session-{cardId}]` + `characterConfig:save` |
| 对话向量 | VecStore WASM | ChatVectorizationService 管理 |
| 模板缓存 | 内存 Map (CACHE_TTL=60s) | ChatStorageService 内部缓存 |

### 6.2 对话数据 Schema

```typescript
interface TestChatData {
  id: string;                    // "test-chat-{timestamp}"
  creativeId: string;            // 创意 ID (与角色卡路径关联)
  characterCardId: string;       // 角色卡 ID
  characterCardName: string;     // 角色名称
  messages: ChatMessage[];       // 消息列表
  createdAt: number;             // 创建时间
  updatedAt: number;             // 最后更新时间
}
```

### 6.3 对话配置 Schema

```typescript
interface CharacterSessionConfig {
  characterCardId: string;               // 角色卡 ID
  selectedPersonaId?: string;            // 选中的人设
  customParameters?: AIParameterConfig;  // 自定义 AI 参数
  boundKnowledgeBaseIds?: string[];      // 绑定的知识库
  lastUpdated: number;                   // 最后更新时间
}
```

### 6.4 数据生命周期

```
打开对话 → loadTestChat → 有历史? → 恢复对话
                                → 无历史 + 有 first_mes? → 自动创建首条消息
                                                          → 无 first_mes? → 空白状态
    ↓
发送消息 → 保存到 ChatState → AI 请求
    ↓
AI 回复完成 → saveChatToStore → 写入 JSON 文件
    ↓
关闭对话 Modal → 状态保留 (下次打开恢复)
    ↓
清除对话 → deleteTestChat → 删除 JSON 文件
```

### 6.5 缓存策略 (ChatStorageService)

- **L1 内存缓存**: `Map<string, CacheEntry>` —— TTL 60 秒
- **缓存键格式**: `{type}_{creativeId}_{characterCardId}`
- **缓存失效**: 保存/删除时主动 invalidate，TTL 过期自动清除
- **旧目录迁移**: 自动将 `test/` 子目录迁移到平级目录

---

## 7. API 文档

### 7.1 对话历史管理 API

| IPC 通道 | 调用方式 | 参数 | 返回 |
|---------|---------|------|------|
| `characterChat:getTestChat` | `characterChat.getTestChat(creativeId, cardId)` | `creativeId: string; characterCardId: string` | `TestChatData \| null` |
| `characterChat:saveTestChat` | `characterChat.saveTestChat(creativeId, cardId, name, messages)` | `creativeId, cardId, name, messages[]` | `TestChatData` |
| `characterChat:deleteTestChat` | `characterChat.deleteTestChat(creativeId, cardId)` | `creativeId, cardId` | `boolean` |
| `characterChat:getAllTestChats` | `characterChat.getAllTestChats()` | 无 | `TestChatData[]` |
| `characterChat:clearCache` | `characterChat.clearCache()` | 无 | `{ success: true }` |

### 7.2 配置持久化 API

| IPC 通道 | 调用方式 | 参数 | 返回 |
|---------|---------|------|------|
| `characterConfig:save` | `characterConfig.save(cardId, config)` | `cardId: string; config: CharacterSessionConfig` | `{ success: boolean; error?: string }` |
| `characterConfig:load` | `characterConfig.load(cardId)` | `cardId: string` | `{ success: boolean; config?: CharacterSessionConfig }` |

### 7.3 对话向量化 API

| IPC 通道 | 调用方式 | 参数 | 返回 |
|---------|---------|------|------|
| `chatVector:vectorize` | `chatVector.vectorize(characterId, messages)` | `characterId: string; messages: ChatMessage[]` | `{ success: boolean }` |
| `chatVector:delete` | `chatVector.delete(characterId)` | `characterId: string` | `{ success: boolean }` |
| `chatVector:search` | `chatVector.search(characterId, query, topK?)` | `characterId, query, topK?` | `SearchResult[]` |

### 7.4 上下文检索 API

| IPC 通道 | 调用方式 | 参数 | 返回 |
|---------|---------|------|------|
| `context:retrieve` | `context.retrieve(conversation, options)` | `conversation: {role, content}[]; options: { topK, minScore, sources, scopeIds }` | `{ success: boolean; items: ContextItem[] }` |
| `context:compress` | `context.compress(items, maxTokens)` | `items: ContextItem[]; maxTokens: number` | `{ success: boolean; compressed: string }` |

### 7.5 可用知识库列表 API

| IPC 通道 | 调用方式 | 参数 | 返回 |
|---------|---------|------|------|
| `vector:getAvailableScopes` | `vector.getAvailableScopes()` | 无 | `{ success: boolean; scopes: Array<{ id, sourceId, sourceName, sourceType, vectorCount }> }` |

### 7.6 AI 请求 (通用)

| 项目 | 内容 |
|------|------|
| **IPC 通道** | `ai:request` (通过 ChatEngine 间接调用) |
| **请求参数** | `{ url, method: 'POST', headers, body, timeout?, streaming: true }` |
| **流式监听** | `electronAPI.on('ai:stream', callback)` / `electronAPI.on('ai:stream:complete', callback)` |
| **返回结构** | `{ success: boolean; data?: any; error?: string }` |

### 7.7 模块内部类型导出

```typescript
// CharacterDialogueChat.types.ts
export { ChatMessage, ChatState, CharacterInfo, ChatActions, ChatConfig }
export { UserPersona, AIParameterConfig, KnowledgeBaseBinding }
export { CharacterSessionConfig, EffectiveAIParams }
```

---

## 附录

### A. 插件体系详细说明

#### Remark 插件 (Markdown 解析阶段)

| 插件 | 文件 | 功能 |
|------|------|------|
| `remarkGfm` | 第三方 (remark-gfm) | GitHub Flavored Markdown: 表格、删除线、任务列表 |
| `remarkEmoji` | 第三方 (remark-emoji) | Emoji 短码转 Emoji 字符 |
| [remarkTableCellRawHtml](file:///d:/AI/creative-cafe/src/renderer/components/Character/CharacterDialogueChat/utils/plugins/remark-table-cell-raw-html.ts) | 自研 | 表格单元格中的内联 HTML 解析（span/div/a/img 等） |
| [remarkUnderscoreItalic](file:///d:/AI/creative-cafe/src/renderer/components/Character/CharacterDialogueChat/utils/plugins/remark-underscore-italic.ts) | 自研 | 下划线斜体语法 `_text_` → `<em>`，不破坏变量名中的下划线 |

#### Rehype 插件 (HTML 处理阶段)

| 插件 | 顺序 | 文件 | 功能 |
|------|------|------|------|
| `rehypeRaw` | ① | 第三方 | 解析原始 HTML 字符串 |
| [rehypeInlineHtmlParse](file:///d:/AI/creative-cafe/src/renderer/components/Character/CharacterDialogueChat/utils/plugins/rehype-inline-html-parse.ts) | ② | 自研 | 内联 HTML 标签解析（span/a/b/i/u/img/code/br 等） |
| `rehypeSanitize` | ③ | 第三方 | XSS 防护，按配置的标签/属性/协议白名单过滤 |
| [rehypeQuoteNormalize](file:///d:/AI/creative-cafe/src/renderer/components/Character/CharacterDialogueChat/utils/plugins/rehype-quote-normalize.ts) | ④ | 自研 | 7 种引号格式统一处理，包裹为高亮 span |
| [rehypeQuoteHighlight](file:///d:/AI/creative-cafe/src/renderer/components/Character/CharacterDialogueChat/utils/plugins/rehype-quote-highlight.ts) | ⑤ | 自研 | 引号内文本 `<mark>` 高亮 |
| [rehypeCodeHighlight](file:///d:/AI/creative-cafe/src/renderer/components/Character/CharacterDialogueChat/utils/plugins/rehype-code-highlight.ts) | ⑥ | 自研 | 代码块添加 `message-renderer-code` CSS 类 |
| [rehypeStyleProcessor](file:///d:/AI/creative-cafe/src/renderer/components/Character/CharacterDialogueChat/utils/plugins/rehype-style-processor.ts) | ⑦ | 自研 | CSS 样式作用域限定 + 危险属性过滤 |

### B. 消息处理器工具链

| 函数 | 文件 | 功能 |
|------|------|------|
| `replaceTemplates` | [messageProcessor.ts](file:///d:/AI/creative-cafe/src/renderer/components/Character/CharacterDialogueChat/utils/messageProcessor.ts) | 替换 `{{char}}`/`{{user}}` 模板变量（含 8 种大小写变体） |
| `normalizeQuotes` | 同上 | 统一引号格式，代码块内引号受保护 |
| `protectCodeBlocks` | 同上 | 代码块占位符保护（`` ``` `` / inline `` ` ``） |
| `restoreCodeBlocks` | 同上 | 还原占位符为原始代码块 HTML |
| `processMessage` | 同上 | 统一入口：模板替换 → 引号规范化 → 角括号编码 |
| `preprocessForMarkdown` | 同上 | Markdown 预处理：模板替换 → 引号规范化 → 代码块保护 |

### C. 使用示例

#### 从 CharacterManager 打开对话

```tsx
// CharacterManager.tsx 中的调用方式
const handleTestCharacter = async (record: Character) => {
  const content = await window.electronAPI.character.read(record.path);
  
  setTestChatCharacter({
    creativeId: record.path,
    characterCardId: record.path,
    characterCardName: content.data?.name || record.name,
    characterCardContent: content.data?.description || '',
    personality: content.data?.personality || '',
    scenario: content.data?.scenario || '',
    first_mes: content.data?.first_mes || '',
    mes_example: content.data?.mes_example || '',
    system_prompt: content.data?.system_prompt || '',
    creator_notes: content.data?.creator_notes || '',
    alternate_greetings: content.data?.alternate_greetings || [],
    tags: content.data?.tags || [],
  });
  
  setIsTestChatOpen(true);
};

// CharacterDialogueChat 使用:
<CharacterDialogueChat
  characterInfo={testChatCharacter}
  open={isTestChatOpen}
  onClose={() => setIsTestChatOpen(false)}
  avatarPath={testChatAvatar}
/>
```

#### MessageRenderer 独立使用

```tsx
import { MessageRenderer } from './MessageRenderer';

<MessageRenderer
  content={rawMarkdownContent}
  charName="克拉拉"
  userName="旅行者"
  config={{
    markdown: { enableGFM: true, enableEmoji: true },
    html: { allowRawHTML: true, sanitizeLevel: 'moderate' },
    style: { codeHighlight: true, theme: 'dark' },
    template: { charPlaceholder: '{{char}}', userPlaceholder: '{{user}}' }
  }}
  onLinkClick={(href, e) => console.log('Link clicked:', href)}
/>
```
