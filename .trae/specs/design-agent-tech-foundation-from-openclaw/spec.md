# 基于 openclaw 的项目 AI 智能体技术底座设计 Spec

> 本文档为**技术底座设计型 Spec**（design doc）。基于对 `g:\AI\creative-cafe\sillytavern-source\openclaw-main` 源码的系统性调研，提取其智能体架构、技能系统、记忆模块、自学习机制、Cron 自主调度、ACP 多 agent 通信等设计理念，融合本项目（creative-cafe，Electron 桌面应用）已有资产（角色卡 / 世界书 / 对话-写作-游戏三模式 / `<tableEdit>` 协议 / ChatVectorizationService / PlotCheckerService 等），设计一套模块化、低耦合、高扩展的智能体技术底座。本文档定义架构、接口规范与集成方案，作为后续子 Spec（`add-tool-calling-agent-engine` / `add-agent-skill-and-memory-foundation` / `add-worldbook-writing-agent` 等）的总纲。

## Why

当前项目 AI"智能体的作用还是太低"——`supportsToolCalling` 已检测但全项目未使用，所有 AI 操作（`<tableEdit>` 文本协议、世界书 15+ AI 操作、写作 PlotChecker/OutlineGenerator）都是**用户触发、一次性、fire-and-forget**。openclaw 源码提供了一套成熟的智能体工程范式：**声明式 Tool 可用性、SKILL.md 技能契约、SOUL.md/AGENTS.md/MEMORY.md 三分离、Cron pacing 防失控、ACP 多 agent 通信、dreaming 长期记忆**。本底座把这些范式移植并适配到 Electron + 现有三模式，让 AI 从"被动工具"升级为"自驱智能体"，同时保证低耦合高扩展、接口规范完备、可安全跨平台部署。

## What Changes

本 Spec 产出**设计文档**（不直接写业务代码），定义以下五大低耦合模块的架构、接口规范、集成方案：

- **模块一 智能体核心引擎（AgentCore）**：基于 openclaw `src/agents/` 的 config/context/lanes/sandbox/timeout/usage 范式，封装 agent 生命周期、并发车道、沙盒、超时、资源追踪；上层统一驱动对话/写作/游戏三模式。
- **模块二 多模态交互接口（Multimodal I/O）**：基于 openclaw `src/llm/` + `src/media/` + plugin-sdk 范式，抽象 provider 无关的流式文本/视觉/音频接口与统一消息格式。
- **模块三 自适应学习系统（AdaptiveLearning）**：基于 openclaw dreaming + goal/steer + cron pacing 范式，实现"短期记忆→长期摘要"的离线学习循环 + 目标驱动 + 节流防失控。
- **模块四 技能管理平台（SkillPlatform）**：基于 openclaw `src/skills/` + SKILL.md 契约 + 三层可见性 + 双调用策略，把现有 PlotChecker/OutlineGenerator/AIAssistedChapter/世界书 AI 操作等包装为声明式技能。
- **模块五 分布式记忆存储系统（MemoryStore）**：基于 openclaw memory-core + SQLite + 写溯源 + 语义检索范式，统一角色卡/世界书/对话历史/写作项目的记忆存储与检索。

并定义：统一接口规范（I/O / 数据格式 / 错误处理）、集成文档（部署 / 环境 / 依赖）、性能优化、安全性设计、跨平台兼容性、与现有三模式融合路径。

**BREAKING**：无（底座新增，现有 `<tableEdit>` 文本协议作为降级路径保留）。

## Impact

- Affected specs:
  - `analyze-multimodal-model-feature-upgrades`（本底座是其方向 0「工具调用智能体引擎」+ 方向 C「世界书自驱」的工程化落地总纲）
  - `add-tool-calling-agent-engine`、`add-agent-skill-and-memory-foundation`、`add-worldbook-writing-agent`（本底座定义其共享架构与接口契约，三者为本底座的实施子 Spec）
  - `add-model-capability-detection-and-image-recognition`（模块二能力检测地基）
  - `integrate-worldbook-ai-prompts`（模块四/五的世界书技能化）
- Affected code（作为后续子 Spec 的修改目标，本 Spec 不改动）:
  - `src/main/services/AIService.ts` — 模块二 LLM 抽象层落点
  - 新增 `src/main/services/agent/` — 模块一/三/四/五落点
  - `src/main/services/memory/` + `worldBookService.ts` + `ChatVectorizationService.ts` — 模块五整合点
  - `src/main/services/writing/*` — 模块四技能化对象
  - `src/renderer/components/Common/ChatEngine/` — 模块一/二前端集成点
  - `package.json` — 新增 better-sqlite3 等依赖（见集成文档）

---

## 一、openclaw 源码调研结论（设计理念提取）

### 1.1 三分离的人格-规则-记忆模型
openclaw 每个 agent 工作区含三个文件（[docs/concepts/soul.md](file:///g:/AI/creative-cafe/sillytavern-source/openclaw-main/docs/concepts/soul.md)）：
- **`SOUL.md`**：agent 的"voice"——语气/立场/风格，注入系统提示的高优先级指令层
- **`AGENTS.md`**：操作规则——能做什么/不能做什么的程序性约束
- **`MEMORY.md`**：长期记忆——dreaming 系统从短期记忆提炼的持久化摘要

**本项目映射**：角色卡（character card）的 description/personality/scenario = SOUL.md；世界书（worldbook）= MEMORY.md + memory/ 短期记忆；缺少独立的 AGENTS.md 操作规则层（需补）。

### 1.2 声明式 Tool 可用性（[src/tools/types.ts](file:///g:/AI/creative-cafe/sillytavern-source/openclaw-main/src/tools/types.ts)）
Tool 不靠 if/else 启用，而是声明 `ToolAvailabilityExpression` 布尔表达式：
- 信号：`always | auth(providerId) | config(path,check) | env(name) | plugin-enabled(pluginId) | context(key,equals)`
- 组合：`allOf[] | anyOf[]`
- 运行时求值决定可见性——优雅的动态启用机制

`ToolOwnerRef` 四类所有者：`core | plugin | channel | mcp`；`ToolExecutorRef` 四类执行器。

### 1.3 SKILL.md 技能契约（[src/skills/types.ts](file:///g:/AI/creative-cafe/sillytavern-source/openclaw-main/src/skills/types.ts)）
- **格式**：YAML frontmatter（name/description/metadata）+ markdown 正文（使用时机/不使用场景/流程/输出格式/规则），见 [skills/spike/SKILL.md](file:///g:/AI/creative-cafe/sillytavern-source/openclaw-main/skills/spike/SKILL.md)
- **三层可见性 SkillExposure**：`includeInRuntimeRegistry` + `includeInAvailableSkillsPrompt` + `userInvocable`
- **双调用策略 SkillInvocationPolicy**：`userInvocable`（用户可调）+ `disableModelInvocation`（禁止模型自调）——精细控制谁能触发
- **SkillCommandSpec**：命令分发 `kind:tool → toolName + argMode:raw`
- **加载链**：workspace（发现）→ local-loader → plugin-skills → remote-skills → session-snapshot

### 1.4 记忆 + 写溯源 + dreaming
- **存储**：memory-core 插件 + agent 工作区 `memory/`（结构化 markdown + SQLite）
- **写溯源**：[memory-write-provenance.ts](file:///g:/AI/creative-cafe/sillytavern-source/openclaw-main/src/agents/memory-write-provenance.ts) 跟踪每次写入来源
- **dreaming**：短期记忆→长期 MEMORY.md（每日文件 + 语义搜索）
- **全局状态**：[globals.ts](file:///g:/AI/creative-cafe/sillytavern-source/openclaw-main/src/globals.ts) 定义 `AGENT_ID` / `RUN_ID` / `memory`

### 1.5 Cron 自主调度 + pacing/stagger 防失控（[src/cron/](file:///g:/AI/creative-cafe/sillytavern-source/openclaw-main/src/cron/)）
- **service.ts**：CronService 门面（生命周期/mutations/read/run 委托）
- **store.ts**：SQLite 持久化 + sidecar 隔离
- **pacing.ts**：最小/最大间隔——防自主 agent 失控
- **stagger.ts**：抖动窗口——防雷群效应
- **delivery.ts**：结果投递（chat/webhook/silent）
- **types.ts**：527 行完整契约（schedules/delivery/run states/jobs/payloads）

### 1.6 ACP 多 agent 通信（[src/acp/](file:///g:/AI/creative-cafe/sillytavern-source/openclaw-main/src/acp/)）
- **client.ts / server.ts**：agent 间消息收发与会话管理
- **policy.ts**：通信策略
- 支持 swarm 多 agent 协同（[docs/plan/swarms.md](file:///g:/AI/creative-cafe/sillytavern-source/openclaw-main/docs/plan/swarms.md)）

### 1.7 基础设施范式（[src/infra/](file:///g:/AI/creative-cafe/sillytavern-source/openclaw-main/src/infra/)）
- **dedupe.ts**：进程内去重缓存（短时间窗防重复执行）
- **retry.ts + backoff.ts**：指数退避重试（错误分类）
- **fs-safe / ports / restart / semver / ws / wsl**：跨平台与可靠性基建

---

## 二、本项目智能体技术底座总体架构

```
┌─────────────────────────────────────────────────────────────────┐
│                    应用层（三模式 + 未来扩展）                      │
│   对话模式(CharacterDialogueChat)  写作模式(WritingMode)  游戏模式  │
└───────────────┬───────────────────┬──────────────────┬──────────┘
                │                   │                  │
┌───────────────▼───────────────────▼──────────────────▼──────────┐
│  模块一 AgentCore（智能体核心引擎）                                 │
│  AgentLifecycle / Lanes并发 / Sandbox / Timeout / Usage追踪       │
│  AgentLoop（tool_calls→执行→回填→再决策）                          │
└ ┌─────────────┐ ┌──────────────┐ ┌──────────────┐ ┌────────────┐ ┘
  │模块二        │ │模块三         │ │模块四         │ │模块五       │
  │Multimodal I/O│ │AdaptiveLearn │ │SkillPlatform │ │MemoryStore │
  │LLM流式抽象   │ │dreaming+goal │ │SKILL.md契约  │ │SQLite+向量 │
  │视觉/音频     │ │+cron pacing  │ │三层可见性    │ │写溯源      │
  └──────┬───────┘ └──────┬───────┘ └──────┬───────┘ └─────┬──────┘
         │                │                │               │
┌────────▼────────────────▼────────────────▼───────────────▼──────┐
│  基础设施层（复用 openclaw 范式 + Electron 适配）                   │
│  dedupe / retry+backoff / fs-safe / IPC / better-sqlite3         │
│  现有资产：AIService / worldBookService / ChatVectorizationService│
│            PlotCheckerService / OutlineGenerator / tableEditParser│
└──────────────────────────────────────────────────────────────────┘
```

**模块化原则**：
- 每个模块独立目录、独立类型定义、独立 IPC 通道
- 模块间仅通过**接口契约**通信，禁止跨模块直接 import 实现类
- 五大模块可独立启用/禁用（复用 openclaw 声明式 availability）
- 现有资产作为"适配器"接入，不推倒重来

---

## 三、模块一：智能体核心引擎（AgentCore）

### 3.1 职责
封装 agent 生命周期、并发车道、沙盒隔离、超时控制、资源追踪、tool_calls 循环；上层三模式通过统一 `AgentCore.run(intent)` 接口驱动。

### 3.2 架构（移植 openclaw `src/agents/`）
- `agentLifecycle.ts`：创建→配置→执行→销毁；持久化 agent 元数据（对应 openclaw config.ts）
- `agentContext.ts`：上下文管理（状态/记忆/变量），agent 持续性与个性化核心（对应 openclaw context.ts）
- `lanes.ts`：并发车道——每个模式一个车道，车道内任务串行，车道间并行（对应 openclaw lanes.ts）
- `sandbox.ts`：沙盒——限制工具可访问的资源范围（文件系统白名单/世界书范围/写作项目范围）（对应 openclaw sandbox.ts）
- `timeout.ts`：单 tool 调用 + 整个 agent turn 超时（对应 openclaw timeout.ts）
- `usage.ts`：追踪 token / 工具调用次数 / 耗时 / 成本，落 SQLite（对应 openclaw usage.ts）
- `agentLoop.ts`：核心循环——发送含 tools 的请求 → tool_calls → 并行执行 handler → role:'tool' 回填 → 重发 → 至最终文本（`maxIterations=8`）

### 3.3 接口规范

```typescript
// 输入
interface AgentRunIntent {
  mode: 'dialogue' | 'writing' | 'game' | 'worldbook';
  agentId: string;              // 角色卡ID / 写作项目ID / 游戏实例ID
  messages: AgentMessage[];     // OpenAI 兼容消息格式
  tools?: ToolDescriptor[];     // 来自模块四的技能工具
  maxIterations?: number;       // 默认 8
  timeoutMs?: number;           // 单 turn 超时，默认 120000
  laneId?: string;              // 并发车道，默认取 mode
  sandbox: AgentSandbox;        // 资源访问边界
  callbacks: AgentCallbacks;    // onToolCall / onToken / onDone / onError
}
interface AgentSandbox {
  allowedWorldBookIds?: string[];
  allowedProjectIds?: string[];
  allowedTableIds?: string[];
  fsWritePaths?: string[];      // 文件写入白名单
}
// 输出
interface AgentRunResult {
  finalText: string;
  toolCalls: ToolCallRecord[];  // 工具调用轨迹
  usage: AgentUsage;            // token/次数/耗时/成本
  iterations: number;
  status: 'completed' | 'timeout' | 'error' | 'cancelled';
  error?: AgentError;
}
// 错误处理
interface AgentError {
  code: 'TOOL_EXEC_FAILED' | 'MAX_ITERATIONS' | 'TIMEOUT' | 'PROVIDER_ERROR' | 'SANDBOX_VIOLATION' | 'INVALID_TOOL_CALL';
  message: string;
  toolName?: string;
  retryable: boolean;
}
```

**错误处理机制**：
- 单 tool handler 抛错 → try-catch 返回 `{error}` 给模型，让其自行降级（不中断循环）
- `MAX_ITERATIONS` → 返回当前 best-effort 文本 + 警告
- `TIMEOUT` → 取消进行中 tool，返回已完成部分
- `SANDBOX_VIOLATION` → 拒绝该 tool 调用并记录审计日志
- Provider 网络错误 → 复用 infra/retry.ts 指数退避（最多 3 次）

### 3.4 与三模式集成
- **对话模式**：`ChatEngine` 发消息时 → `AgentCore.run({mode:'dialogue', agentId:角色卡ID, tools:对话组工具, sandbox:{allowedWorldBookIds}})`
- **写作模式**：`WritingAgentService` 编排时 → `AgentCore.run({mode:'writing', agentId:项目ID, tools:写作组工具, sandbox:{allowedProjectIds}})`
- **游戏模式**：`GameEngine` 推进时 → `AgentCore.run({mode:'game', ...})`
- **世界书维护**：`WorldBookAgent` 整理时 → `AgentCore.run({mode:'worldbook', ...})`

---

## 四、模块二：多模态交互接口（Multimodal I/O）

### 4.1 职责
抽象 provider 无关的流式文本/视觉/音频接口；统一消息格式；能力检测与降级。

### 4.2 架构（移植 openclaw `src/llm/` + `src/media/` + plugin-sdk）
- `llmProvider.ts`：统一 `LLMProvider` 接口（对应 openclaw [src/llm/types.ts](file:///g:/AI/creative-cafe/sillytavern-source/openclaw-main/src/llm/types.ts) `StreamResult`/`LLMProvider`）
- `streamAdapter.ts`：流式 chunk 处理/缓冲/状态上报（对应 openclaw [src/llm/stream.ts](file:///g:/AI/creative-cafe/sillytavern-source/openclaw-main/src/llm/stream.ts)）
- `multimodalMessage.ts`：统一消息格式（text + image_url + audio + tool_calls + role:'tool'）
- `capabilityDetector.ts`：复用现有 `add-model-capability-detection-and-image-recognition` 的 `supportsText/ToolCalling/Vision/Audio` 检测
- `mediaCodec.ts`：图像 base64/URL 编解码、音频转码（对应 openclaw `src/media/`）

### 4.3 接口规范

```typescript
interface LLMProvider {
  readonly id: string;
  readonly capabilities: ModelCapabilities;  // supportsText/ToolCalling/Vision/Audio
  streamChat(req: StreamChatRequest): AsyncIterable<StreamChunk>;
}
interface StreamChatRequest {
  model: string;
  messages: UnifiedMessage[];
  tools?: ToolDescriptor[];       // OpenAI function-calling schema
  temperature?: number;
  maxTokens?: number;
  parallelToolCalls?: boolean;
}
type UnifiedMessage =
  | { role: 'system' | 'user' | 'assistant'; content: MultimodalContent }
  | { role: 'tool'; tool_call_id: string; content: string };
type MultimodalContent = string | Array<
  | { type: 'text'; text: string }
  | { type: 'image_url'; image_url: { url: string } }
  | { type: 'audio'; audio: { data: string; format: string } }
>;
interface StreamChunk {
  delta?: { content?: string; tool_calls?: ToolCallDelta[] };
  finishReason?: 'stop' | 'tool_calls' | 'length' | 'error';
  usage?: { promptTokens: number; completionTokens: number };
}
```

**数据格式要求**：消息严格遵循 OpenAI Chat Completions 兼容格式（项目主流 provider 已是 OpenAI 兼容）；图像走 `image_url.url`（base64 data URL 或 http URL）；音频走自定义 `audio` 段（provider 不支持时 capabilityDetector 返回 false 并降级为纯文本）。

**错误处理**：provider 不可达 → retry 3 次 → 切备用 provider → 最终抛 `PROVIDER_ERROR`；流中断 → 丢弃不完整 chunk，重发上一请求（幂等）。

### 4.4 降级矩阵
| 能力 | 支持 | 不支持 |
|------|------|--------|
| ToolCalling | 原生 tool_calls 循环 | 降级为 `<tableEdit>` 文本协议 + 关键词匹配 |
| Vision | image_url 注入 | 拒图 + 提示"当前模型不支持图像" |
| Audio | audio 段 | 拒音频 + 提示 |

---

## 五、模块三：自适应学习系统（AdaptiveLearning）

### 5.1 职责
实现"短期记忆→长期摘要"离线学习循环 + 目标驱动 + 节流防失控；让 agent 越用越懂用户/角色/故事。

### 5.2 架构（移植 openclaw dreaming + goal/steer + cron pacing）
- `dreamingService.ts`：离线把短期记忆（最近 N 轮对话/章节）提炼成长期 MEMORY.md 摘要（对应 openclaw dreaming）
- `goalTracker.ts`：目标设定与追踪——agent 可设/追求目标（对应 openclaw [docs/tools/goal.md](file:///g:/AI/creative-cafe/sillytavern-source/openclaw-main/docs/tools/goal.md)）
- `steerEngine.ts`：根据外部输入/目标调整 agent 行为路径（对应 openclaw [docs/tools/steer.md](file:///g:/AI/creative-cafe/sillytavern-source/openclaw-main/docs/tools/steer.md)）
- `cronScheduler.ts`：自主调度——定时触发 dreaming/世界书整理/写作推进（对应 openclaw [src/cron/](file:///g:/AI/creative-cafe/sillytavern-source/openclaw-main/src/cron/)）
- `pacing.ts` + `stagger.ts`：最小/最大间隔 + 抖动——防自主失控（直接移植 openclaw 范式）
- `feedbackLoop.ts`：用户反馈（采纳/拒绝 agent 提议）回流为学习信号

### 5.3 接口规范

```typescript
interface DreamingJob {
  agentId: string;
  sourceType: 'dialogue' | 'writing' | 'worldbook';
  sourceRange: { from: number; to: number };  // 消息/章节范围
  schedule: 'manual' | { every: string };     // cron 表达式
  pacing: { minIntervalMs: number; maxPerDay: number };
}
interface DreamingResult {
  summary: string;              // 写入 MEMORY.md
  newMemoryEntries: MemoryEntry[];
  tokensUsed: number;
  status: 'completed' | 'skipped' | 'failed';
}
interface GoalSpec {
  agentId: string;
  description: string;          // "把第5-8章写到剧情一致"
  successCriteria: string;      // 可机器判定
  deadline?: number;
  priority: 'low' | 'normal' | 'high';
}
```

**防失控机制**（关键安全设计）：
- pacing：dreaming/自主任务最小间隔 5 分钟，每日上限 100 次（用户可调）
- stagger：定时任务加 ±10% 抖动，防雷群
- dedupe：同 agent 同参数任务 60 秒内去重（复用 infra/dedupe.ts）
- 所有自主任务默认走"草稿"区，需用户确认才生效

---

## 六、模块四：技能管理平台（SkillPlatform）

### 6.1 职责
把现有 AI 能力（PlotChecker/OutlineGenerator/AIAssistedChapter/世界书 15+ 操作/tableEdit）包装为声明式技能；支持 SKILL.md 契约、三层可见性、双调用策略；支持用户/模型两种触发方式。

### 6.2 架构（移植 openclaw `src/skills/`）
- `skillContract.ts`：SKILL.md 解析（frontmatter + markdown），对应 openclaw [src/skills/loading/skill-contract.ts](file:///g:/AI/creative-cafe/sillytavern-source/openclaw-main/src/skills/loading/skill-contract.ts)
- `skillRegistry.ts`：注册中心，按 mode 分组启用
- `skillLoader.ts`：加载链 workspace→local→builtin（对应 openclaw local-loader/workspace）
- `skillSnapshot.ts`：会话快照（对应 openclaw session-snapshot.ts）
- `skillInvoker.ts`：分发 `kind:tool → toolName + argMode`
- `skillAvailability.ts`：复用 openclaw 声明式 `ToolAvailabilityExpression`

### 6.3 技能契约格式（SKILL.md）

```yaml
---
name: plot-check
description: 审核章节剧情一致性（大纲/世界书/角色/风格/连续 5 维）
metadata:
  emoji: 🔍
  mode: writing
  requires:
    services: [PlotCheckerService]
invocation:
  userInvocable: true
  disableModelInvocation: false
exposure:
  includeInRuntimeRegistry: true
  includeInAvailableSkillsPrompt: true
  userInvocable: true
dispatch:
  kind: tool
  toolName: checkPlot
  argMode: raw
---

# Plot Check

Use when: 章节写完需审核剧情一致性时
Do not use when: 仅做局部润色时

## 流程
1. 读取章节 + 大纲 + 世界书 + 角色卡
2. 5 维审核 + 逻辑矛盾检测
3. 返回 issues + autoFix 建议

## 输出格式
{ issues: Issue[], autoFix: Diff[] }
```

### 6.4 内置技能清单（把现有能力技能化）
| 技能名 | 模式 | 包装对象 | 工具名 |
|--------|------|---------|--------|
| plot-check | writing | PlotCheckerService | checkPlot |
| outline-generate | writing | OutlineGenerator | generateOutline |
| chapter-write | writing | AIAssistedChapterService | writeChapter |
| description-polish | writing | DescriptionPolisher | polishText |
| table-organize | all | TableOrganizeService | updateTable |
| worldbook-generate | worldbook | useWorldBookAIOperations | createEntry |
| worldbook-keywords | worldbook | 同上 | generateKeywords |
| worldbook-sort | worldbook | 同上 | sortEntries |
| state-table-edit | dialogue/game | tableEditParser | updateStateTable |
| chat-history-search | dialogue | ChatVectorizationService | searchHistory |
| worldbook-search | all | ChatVectorizationService | searchWorldbook |

### 6.5 接口规范

```typescript
interface SkillEntry {
  skill: Skill;                    // SKILL.md 解析结果
  frontmatter: ParsedSkillFrontmatter;
  metadata?: SkillMetadata;
  invocation: SkillInvocationPolicy;
  exposure: SkillExposure;
}
interface SkillInvocationPolicy {
  userInvocable: boolean;
  disableModelInvocation: boolean;
}
interface SkillExposure {
  includeInRuntimeRegistry: boolean;
  includeInAvailableSkillsPrompt: boolean;  // 注入到 system prompt 的"可用技能"列表
  userInvocable: boolean;                   // UI 按钮可见
}
// 统一调用入口（用户点击 / 模型 tool_call 都走此）
async function invokeSkill(name: string, args: unknown, ctx: AgentContext): Promise<SkillResult>;
```

---

## 七、模块五：分布式记忆存储系统（MemoryStore）

### 7.1 职责
统一角色卡/世界书/对话历史/写作项目的记忆存储与检索；SQLite 持久化 + 向量语义检索 + 写溯源；对应 openclaw memory-core + MEMORY.md + 写溯源范式。

### 7.2 架构
- `memoryStore.ts`：统一存储门面（对应 openclaw memory-core）
- `sqliteBackend.ts`：better-sqlite3 持久化（对应 openclaw [src/cron/store.ts](file:///g:/AI/creative-cafe/sillytavern-source/openclaw-main/src/cron/store.ts) SQLite 范式）
- `vectorIndex.ts`：复用现有 ChatVectorizationService + EmbeddingService
- `writeProvenance.ts`：每次写入记录来源（agentId/runId/toolName/timestamp）（对应 openclaw [memory-write-provenance.ts](file:///g:/AI/creative-cafe/sillytavern-source/openclaw-main/src/agents/memory-write-provenance.ts)）
- `memoryPromptPrepare.ts`：检索 + 拼装进 prompt（对应 openclaw [memory-prompt-prepare.ts](file:///g:/AI/creative-cafe/sillytavern-source/openclaw-main/src/agents/memory-prompt-prepare.ts)）

### 7.3 记忆分类（统一现有散落存储）
| 记忆类型 | 现有存储 | 统一到 | 检索方式 |
|---------|---------|--------|---------|
| 角色卡人格 | character cards JSON | memoryStore(type=persona) | 按 agentId |
| 世界书条目 | worldbook JSON | memoryStore(type=lore) | 关键词 + 向量 |
| 对话历史 | ChatStorageService | memoryStore(type=dialogue) | 按会话 + 向量 |
| 章节内容 | WritingStorageService | memoryStore(type=chapter) | 按项目 + 向量 |
| 长期摘要 | （无） | memoryStore(type=memory_md) | 向量 |
| 临时笔记 | （无） | memoryStore(type=note) | 按 agentId |

**注**：现有存储不立即迁移，通过适配器（adapter）接入 memoryStore；新数据走 memoryStore，旧数据逐步迁移。

### 7.4 接口规范

```typescript
interface MemoryEntry {
  uid: string;
  agentId: string;
  type: 'persona' | 'lore' | 'dialogue' | 'chapter' | 'memory_md' | 'note';
  content: string;
  keywords?: string[];
  embedding?: number[];
  metadata?: Record<string, unknown>;
  autoGenerated?: boolean;        // 复用世界书现有字段
  provenance: WriteProvenance;    // 写溯源
  createdAt: number;
  updatedAt: number;
  enabled: boolean;
}
interface WriteProvenance {
  source: 'user' | 'agent' | 'tool' | 'dreaming';
  agentId?: string;
  runId?: string;
  toolName?: string;
  timestamp: number;
}
// CRUD + 检索
async function write(entry: Omit<MemoryEntry,'uid'|'createdAt'>): Promise<MemoryEntry>;
async function read(uid: string): Promise<MemoryEntry | null>;
async function search(query: MemoryQuery): Promise<MemoryEntry[]>;
interface MemoryQuery {
  agentId?: string;
  type?: MemoryEntry['type'];
  keyword?: string;
  semantic?: string;              // 语义检索
  limit?: number;
}
```

**错误处理**：SQLite 写失败 → 重试 3 次 → 落本地 JSON 兜底文件 + 上报；向量索引失败 → 降级为纯关键词检索；读失败 → 返回空数组 + 警告日志。

---

## 八、统一接口规范汇总

### 8.1 跨模块通信契约
所有模块间调用走**接口**而非实现类。定义于 `src/main/services/agent/contracts.ts`：

```typescript
// AgentCore 依赖的接口（由其他模块实现并注入）
interface IToolProvider { getTools(mode, ctx): ToolDescriptor[]; }
interface IMemoryProvider { search(q): Promise<MemoryEntry[]>; write(e): Promise<MemoryEntry>; }
interface ILLMProvider { streamChat(req): AsyncIterable<StreamChunk>; capabilities: ModelCapabilities; }
interface ISkillRegistry { resolve(name): SkillEntry | null; invoke(name, args, ctx): Promise<SkillResult>; }
interface ILearningScheduler { scheduleDreaming(job): void; }
```

### 8.2 IPC 通道规范（主进程↔渲染进程）
| 通道 | 方向 | Payload | 用途 |
|------|------|---------|------|
| `agent:run` | req→main | AgentRunIntent | 启动 agent turn |
| `agent:cancel` | req→main | {runId} | 取消 |
| `agent:toolCall` | main→req | ToolCallEvent | 工具调用过程推送 |
| `agent:token` | main→req | {delta} | 流式 token |
| `agent:done` | main→req | AgentRunResult | 完成 |
| `skill:list` | req→main | {mode} | 列出可用技能 |
| `skill:invoke` | req→main | {name,args} | 用户手动调用技能 |
| `memory:search` | req→main | MemoryQuery | 检索记忆 |
| `learning:dream` | req→main | DreamingJob | 触发 dreaming |

### 8.3 数据格式统一
- 时间戳：Unix ms（number）
- ID：`<type>_<ulid>`（ulid 保证时序可排序）
- 消息：OpenAI Chat Completions 兼容
- 工具 schema：JSON Schema draft-07
- 持久化：SQLite（主） + JSON 文件（兜底/导出）
- 向量：Float32Array，维度随 embedding 模型

### 8.4 统一错误码
`AGENT_*` / `PROVIDER_*` / `TOOL_*` / `SKILL_*` / `MEMORY_*` / `SANDBOX_*`，每个错误含 `code/message/retryable/context`。

---

## 九、集成文档

### 9.1 部署流程
1. **依赖安装**：`pnpm add better-sqlite3 ulid`（见 9.3）
2. **数据库初始化**：首次启动 `memoryStore.init()` 创建 SQLite schema（agent_memory / agent_usage / cron_jobs / skills 表）
3. **技能注册**：扫描 `skills/` 目录 + 内置技能注册
4. **能力检测**：复用现有 `add-model-capability-detection` 对当前 provider 做 supportsToolCalling/Vision 检测
5. **降级配置**：根据能力检测结果，自动启用/降级对应模块
6. **三模式接入**：按 `三、3.4` 逐模式接入 AgentCore

### 9.2 环境配置
- **必须**：现有 provider 配置（API key/baseURL/model）
- **可选**：`AGENT_MAX_ITERATIONS`（默认 8）、`AGENT_TURN_TIMEOUT_MS`（默认 120000）、`DREAMING_PACING_MIN_MS`（默认 300000）、`DREAMING_DAILY_MAX`（默认 100）
- **SQLite 路径**：`<userData>/agent/memory.db`（Electron `app.getPath('userData')`）
- **技能目录**：`<userData>/agent/skills/`（用户自定义）+ 内置 `src/main/services/agent/builtin-skills/`

### 9.3 依赖说明
| 依赖 | 用途 | 是否已有 | 备注 |
|------|------|---------|------|
| better-sqlite3 | SQLite 持久化 | 否 | Electron 需 native rebuild（`electron-rebuild`） |
| ulid | 时序 ID | 否 | 纯 JS，无 native 依赖 |
| 现有 ChatVectorizationService | 向量检索 | 是 | 复用 |
| 现有 EmbeddingService | embedding | 是 | 复用 |
| 现有 AIService | LLM 调用 | 是 | 包装为 LLMProvider |

**native 模块处理**：better-sqlite3 需在 `package.json` 配置 `postinstall: electron-rebuild`；Windows/macOS/Linux 三平台需在 CI 预编译或用 `@electron/rebuild`。

### 9.4 与现有资产对接清单
| 现有资产 | 对接方式 | 模块 |
|---------|---------|------|
| AIService.streamChatAPI | 适配为 LLMProvider | 模块二 |
| worldBookService | 适配为 MemoryProvider(type=lore) | 模块五 |
| ChatVectorizationService | 复用为 vectorIndex | 模块五 |
| PlotCheckerService | 包装为 skill `plot-check` | 模块四 |
| OutlineGenerator | 包装为 skill `outline-generate` | 模块四 |
| AIAssistedChapterService | 包装为 skill `chapter-write` | 模块四 |
| tableEditParser | 升级为 tool `updateStateTable`（保留文本协议降级） | 模块一/四 |
| WorldBookKeywordMatcher | 降级路径（tool calling 不可用时） | 模块五 |
| ChatEngine | 接入 AgentCore.run | 模块一 |

---

## 十、性能优化

- **tool 并行执行**：同一 turn 内无依赖的 tool_calls 并行（Promise.all），降低循环延迟
- **tool 结果缓存**：同 tool+同参数 60 秒内去重缓存（复用 infra/dedupe.ts）
- **向量检索懒加载**：embedding 仅在首次语义检索时计算，缓存到 SQLite
- **记忆压缩**：`role:'tool'` 消息与短期记忆定期压缩为摘要，防 context 膨胀
- **SQLite WAL 模式**：`PRAGMA journal_mode=WAL` 提升并发读写
- **技能快照**：会话级 SkillSnapshot 缓存（对应 openclaw session-snapshot.ts），避免每轮重新解析 SKILL.md
- **流式优先**：所有 LLM 调用走流式，首 token 延迟优先于总耗时

---

## 十一、安全性设计

- **沙盒隔离**（模块一 sandbox）：agent 只能访问 sandbox 白名单内的资源（世界书 ID/项目 ID/文件路径）；越权 → `SANDBOX_VIOLATION` + 审计日志
- **写操作分级**：
  - 只读 tool（search/read）→ 自动执行
  - 写 tool（create/update/delete）→ 默认走"草稿"区，需用户确认；高危（删世界书/覆盖章节）→ 强制确认
- **自主任务节流**（模块三 pacing/stagger/dedupe）：防 agent 失控刷量
- **敏感数据保护**：API key 通过 Electron safeStorage 加密存储；记忆库不含密钥；日志 redact（复用 openclaw [src/logging/redact.ts](file:///g:/AI/creative-cafe/sillytavern-source/openclaw-main/src/logging/redact.ts) 范式）
- **prompt 注入防护**：worldbook/用户输入走 `role:'user'` 或明确标记为不可信内容；agent system prompt 不可被覆盖
- **审计日志**：所有写操作 + 自主任务 + sandbox 违规落 SQLite audit 表，UI 可查
- **隐私**：dreaming/世界书扩展提示词约束"仅处理虚构设定"，不识别/记录真实人物敏感信息

---

## 十二、跨平台兼容性

- **Electron 主进程**：所有模块跑在 main 进程，renderer 通过 IPC 调用
- **native 模块**：better-sqlite3 用 `@electron/rebuild` 针对 Electron ABI 重编译；CI 配置三平台预编译
- **文件路径**：统一用 `path.join` + `app.getPath('userData')`，禁用硬编码分隔符
- **OS 差异**：技能 SkillInstallSpec 的 `os[]` 字段（移植 openclaw）声明技能支持的 OS；不支持的技能自动隐藏
- **WSL/Linux 兼容**：复用 openclaw [src/infra/wsl.ts](file:///g:/AI/creative-cafe/sillytavern-source/openclaw-main/src/infra/wsl.ts) 思路处理路径差异
- **移动端预留**：接口设计 provider 无关、IPC 可替换为 HTTP（未来 Tauri/移动端复用模块二/三/四/五）

---

## 十三、与现有三模式的融合路径（实施顺序）

1. **阶段 0（地基）**：模块二 LLMProvider 抽象 + 模块一 AgentCore + agentLoop（含 tool_calls 循环）+ 模块五 SQLite 骨架
2. **阶段 1（写作优先，核心诉求）**：模块四把 PlotChecker/OutlineGenerator/AIAssistedChapter 技能化 → 写作智能体闭环（读大纲→写章→自审→修复→更新表）
3. **阶段 2（对话智能体）**：tableEdit 升级为原生 updateStateTable tool + 对话组工具 → 对话角色卡自驱
4. **阶段 3（世界书自驱）**：模块四世界书技能化 + 模块三 dreaming → 世界书自我生长
5. **阶段 4（学习与自主）**：模块三 cron/dreaming/goal 完整启用 → 跨模式长期学习

每阶段保留 `supportsToolCalling=false` 降级路径，不破坏现有体验。

---

## ADDED Requirements

### Requirement: 基于 openclaw 的智能体技术底座设计文档
系统 SHALL 产出一份基于 openclaw 源码调研的智能体技术底座设计文档，定义五大低耦合模块（AgentCore / Multimodal I/O / AdaptiveLearning / SkillPlatform / MemoryStore）的架构、接口规范与集成方案。

#### Scenario: 用户要求基于 openclaw 重新设计技术底座
- **WHEN** 用户要求基于 openclaw 源码重新编写项目 AI 智能体技术底座 spec
- **THEN** 系统产出含五大模块的设计文档
- **AND** 每个模块明确职责、架构（移植自 openclaw 哪个范式）、接口规范（I/O/数据格式/错误处理）
- **AND** 提供统一接口规范汇总（跨模块契约 + IPC 通道 + 数据格式 + 错误码）
- **AND** 提供集成文档（部署流程 + 环境配置 + 依赖说明 + 现有资产对接清单）
- **AND** 覆盖性能优化、安全性设计、跨平台兼容性三个专题
- **AND** 给出与现有三模式的融合路径与实施顺序

#### Scenario: 设计基于 openclaw 真实源码
- **WHEN** 撰写设计时
- **THEN** 引用 openclaw 真实文件（src/agents/* / src/skills/types.ts / src/tools/types.ts / src/cron/* / src/acp/* / src/llm/* / docs/concepts/soul.md / skills/spike/SKILL.md）
- **AND** 提取 openclaw 设计理念（三分离人格模型 / 声明式 Tool 可用性 / SKILL.md 契约 / dreaming / cron pacing / ACP / 写溯源）
- **AND** 明确每个理念在本项目的映射与适配（如 SOUL.md→角色卡、MEMORY.md→世界书、pacing→防失控）

#### Scenario: 模块化与低耦合
- **WHEN** 定义模块边界时
- **THEN** 五大模块各自独立目录与类型定义
- **AND** 模块间仅通过 contracts.ts 接口契约通信
- **AND** 禁止跨模块直接 import 实现类
- **AND** 现有资产通过适配器接入而非推倒重来

#### Scenario: 接口规范完备
- **WHEN** 定义接口时
- **THEN** 每个模块给出 TypeScript 接口定义（输入/输出类型）
- **AND** 定义统一数据格式（时间戳/ID/消息/工具 schema/持久化/向量）
- **AND** 定义统一错误码与错误处理机制（重试/降级/兜底）
- **AND** 定义 IPC 通道规范（通道名/方向/Payload/用途）

### Requirement: 技能与工具的声明式管理
系统 SHALL 采用 openclaw 的声明式范式管理技能与工具可用性，而非硬编码 if/else。

#### Scenario: 声明式可用性
- **WHEN** 工具/技能需要动态启用时
- **THEN** 采用 ToolAvailabilityExpression 布尔表达式（always/auth/config/env/plugin-enabled/context + allOf/anyOf）
- **AND** 运行时求值决定可见性
- **AND** 技能采用三层可见性（includeInRuntimeRegistry/includeInAvailableSkillsPrompt/userInvocable）
- **AND** 技能采用双调用策略（userInvocable/disableModelInvocation）

### Requirement: 自主行为防失控
系统 SHALL 对所有自主 agent 行为（dreaming/cron/目标驱动）施加节流与防护。

#### Scenario: 防止自主 agent 失控
- **WHEN** agent 执行自主任务时
- **THEN** 强制 pacing（最小间隔 + 每日上限）
- **AND** 强制 stagger（抖动窗口防雷群）
- **AND** 强制 dedupe（同参数短时去重）
- **AND** 写操作默认走草稿区需用户确认
- **AND** 高危操作强制确认

## MODIFIED Requirements

无（本 Spec 为技术底座设计文档，不修改现有需求；现有 `<tableEdit>` 文本协议作为降级路径保留）。

## REMOVED Requirements

无。
