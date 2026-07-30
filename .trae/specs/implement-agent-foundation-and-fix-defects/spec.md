# 智能体底座实施与现有架构缺陷修复 Spec

> 本 Spec 为**实施型 Spec**，基于已批准的设计文档 [design-agent-tech-foundation-from-openclaw/spec.md](file:///g:/AI/creative-cafe/.trae/specs/design-agent-tech-foundation-from-openclaw/spec.md)，将其落地为具体的文件级架构与 OpenClaw 源码照抄/适配决策；同时汇总对现有架构的全面审计结论（60+ 条缺陷），给出修复清单与集成方案，确保新底座无缝接入现有系统。用户明确授权可照抄 openclaw 源码（`g:\AI\creative-cafe\sillytavern-source\openclaw-main`），照抄/适配/自研决策见 §四。

## Why

设计文档已定义五大模块的架构与接口规范，但尚未落地到具体文件、依赖、照抄决策。同时全面审计发现现有系统存在多处**阻断智能体底座集成**的缺陷：最严重的是 `supportsToolCalling` 已检测却**全链路未注入**（[ChatEngine.ts:154-167](file:///g:/AI/creative-cafe/src/renderer/components/Common/ChatEngine/ChatEngine.ts) `toolCallingEnabled` 定义后从未使用、[AIService.ts:597-627](file:///g:/AI/creative-cafe/src/main/services/AIService.ts) `probeAllCapabilities` 结果未进入请求体），导致工具调用能力空转——这是底座能否运行的前提。此外 tableEditParser 重复逻辑、Embedding 无缓存、WorldBook O(n) 扫描、同步文件 I/O、长列表无虚拟化等问题既影响现有稳定性，也会拖累新底座。本 Spec 一次性给出底座落地 + 缺陷修复 + 集成方案。

## What Changes

### A. 智能体底座落地（文件级）
- 新增 `src/main/services/agent/` 目录，含 `core/` `llm/` `learning/` `skills/` `memory/` `infra/` `contracts.ts` 七个子项
- 照抄 openclaw `src/infra/` 的 dedupe/retry/backoff 等基础设施（详见 §四）
- 适配 openclaw `src/skills/types.ts` + `src/tools/types.ts` 类型契约
- 自研 `agentLoop.ts`（对接项目 AIService + 三模式）
- 现有资产适配器：AIService→LLMProvider、worldBookService→MemoryProvider、ChatVectorizationService→vectorIndex

### B. 阻断性缺陷修复（P0，必须先于底座启用）
- **修复 supportsToolCalling 全链路未注入**（功能缺陷，critical）：AIService.streamChatAPI 增加 `tools` 参数；ChatEngine 注入工具集
- **统一 tableEditParser 与 GameTableEditParser**（设计缺陷，high）：抽取公共 `TableEditParserBase`，两处改为薄适配层
- **修复 ChatEngine 消息顺序/完整性校验缺失**（功能缺陷，high）：[ChatEngine.ts:42-54](file:///g:/AI/creative-cafe/src/renderer/components/Common/ChatEngine/ChatEngine.ts)
- **修复 tableEditParser 索引/越界校验缺失**（功能缺陷，high）：[tableEditParser.ts:187-219](file:///g:/AI/creative-cafe/src/main/services/memory/tableEditParser.ts)、270-278

### C. 性能与稳定性缺陷修复（P1，与底座并行）
- EmbeddingService 加缓存（性能，high）
- WorldBookKeywordMatcher 加关键词倒排索引（性能，high）
- storageService / chatSessionRepository 同步 I/O 异步化（性能，medium-high）
- 长列表虚拟化（chat/worldbook/chapter）（性能，medium）
- dataStore 分层（设计，medium）

### D. UI 缺陷修复（P2，体验提升）
- 缺失 loading/error 状态补齐、删除操作确认、自动滚动优化等（详见 §五）

**BREAKING**：无（底座新增 + 现有路径保留降级；tableEditParser 合并为内部重构，对外行为不变）。

## Impact

- Affected specs:
  - `design-agent-tech-foundation-from-openclaw`（本 Spec 是其落地实施）
  - `add-model-capability-detection-and-image-recognition`（B 项 supportsToolCalling 修复依赖其检测能力）
  - `add-game-mode-framework`、`migrate-table-organize-to-right-panel`、`refactor-plot-check-to-table`、`integrate-worldbook-ai-prompts`（涉及 tableEdit/写作/世界书改造）
- Affected code:
  - 新增：`src/main/services/agent/**`
  - 修改：`src/main/services/AIService.ts`、`src/main/services/memory/tableEditParser.ts`、`src/main/services/game/GameTableEditParser.ts`、`src/main/services/EmbeddingService.ts`、`src/main/services/WorldBookKeywordMatcher.ts`、`src/main/services/storageService.ts`、`src/renderer/components/Common/ChatEngine/ChatEngine.ts`、`src/renderer/stores/dataStore.ts`、长列表组件
  - 依赖：`package.json` 新增 `better-sqlite3` `ulid`

---

## 一、现有架构审计结论（60+ 条，分级汇总）

### 1.1 功能缺陷（critical/high，阻断底座）
| # | 缺陷 | 文件:行 | 严重 | 修复 |
|---|------|--------|------|------|
| F1 | supportsToolCalling 全链路未注入，工具调用空转 | AIService.ts:597-627 / ChatEngine.ts:154-167 | critical | streamChatAPI 增 tools 参数；ChatEngine 注入工具集 |
| F2 | ChatEngine 消息顺序/完整性校验缺失 | ChatEngine.ts:42-54 | high | 加消息序号校验 + 异常剔除 |
| F3 | tableEditParser 索引转换未校验，越界崩溃 | tableEditParser.ts:187-219,270-278 | high | 加整数/范围校验 |
| F4 | tableEditParser 与 GameTableEditParser 逻辑重复 | GameTableEditParser.ts:170-191 | high | 抽取 Base，两处适配 |
| F5 | AIAssistedChapterService 无失败重试/回退 | AIAssistedChapterService.ts:160-190 | high | 接入 infra/retry |
| F6 | ChatEngine 取消机制错误反馈缺失 | ChatEngine.ts:225-235 | medium | 取消失败时回传前端 |
| F7 | PlotChecker quickFixSuggestion 格式一致性未校验 | PlotCheckerService.ts:245-250 | medium | 加匹配校验 |

### 1.2 设计缺陷
| # | 缺陷 | 文件:行 | 严重 | 修复 |
|---|------|--------|------|------|
| D1 | dataStore 直接操作 DOM/ElectronAPI，违反分层 | dataStore.ts:26-56 | medium | 抽 IPC 层，store 纯数据 |
| D2 | WritingModeRightPanel 职责堆积 | WritingModeRightPanel.tsx:33-41 | medium | 拆分 resize/tabs/渲染 |
| D3 | WorldBookManager formState 未 memo 化 | WorldBookManager.tsx:105-139 | medium | useMemo/useCallback |
| D4 | StreamingTextEditor 生成态渲染逻辑过复杂 | ContentWorkspace.tsx:574-583 | medium | 中心化决策函数 |
| D5 | 写作模式存储状态与 UI 控制耦合 | CharacterDialogueChat.tsx:566-590 | medium | 抽 hook |

### 1.3 性能瓶颈
| # | 缺陷 | 文件:行 | 严重 | 修复 |
|---|------|--------|------|------|
| P1 | EmbeddingService 无缓存，重复计算 | EmbeddingService.ts | high | 加 content-hash→vector 缓存 |
| P2 | WorldBookKeywordMatcher 每消息 O(n) 扫描 | WorldBookKeywordMatcher.ts:45-61 | high | 建倒排索引 |
| P3 | storageService 同步文件 I/O 阻塞 | storageService.ts:1-100 | medium-high | 异步化 + WAL |
| P4 | chatSessionRepository 同步操作 | chatSessionRepository.ts:1-30 | medium | 异步化 |
| P5 | 向量库无分页读取 | VectorRepository.ts:1-60 | medium | 分页 + 流式 |
| P6 | 消息列表无虚拟化 | MessageRenderer.tsx:1-50 | medium | react-virtual |
| P7 | ContextManager 大消息量未优化 | ContextManager.ts:1-40 | medium | 滑窗 + 摘要 |
| P8 | 生成态未防抖 | ContentWorkspace.tsx:97-100 | low | 防抖 |

### 1.4 UI 缺陷（P2，节选）
- CharacterDialogueChat.tsx:137-148 表情加载无骨架屏；501-507 流式生成无占位符；530-545 自动滚动缺动画；508-521 错误恢复流程不清
- WorldBookManager.tsx:559-564 删除无确认；605-611 批量无进度；175-184 打开失败提示不全
- WorldBookEntryList.tsx:230-290 更多属性未折叠懒加载
- WritingModeEntry.tsx:107-122 新建项目无输入校验

> 完整 30 条 UI 发现见审计记录，本 Spec 修复 P2 子集，其余纳入后续迭代。

---

## 二、智能体底座具体架构（文件级）

```
src/main/services/agent/
├── contracts.ts                  # 跨模块接口契约（ILLMProvider/IMemoryProvider/IToolProvider/ISkillRegistry/ILearningScheduler）
├── core/                         # 模块一 AgentCore
│   ├── agentCore.ts              # AgentCore.run(intent) 入口
│   ├── agentLoop.ts              # tool_calls 循环（自研，对接 AIService）
│   ├── agentLifecycle.ts         # 生命周期（适配 openclaw config.ts）
│   ├── agentContext.ts           # 上下文（适配 openclaw context.ts）
│   ├── lanes.ts                  # 并发车道（照抄 openclaw lanes.ts 思路）
│   ├── sandbox.ts                # 沙盒（适配 openclaw sandbox.ts）
│   ├── timeout.ts                # 超时（照抄 openclaw timeout.ts）
│   └── usage.ts                  # 资源追踪（照抄 openclaw usage.ts）
├── llm/                          # 模块二 Multimodal I/O
│   ├── llmProvider.ts            # LLMProvider 接口 + AIServiceAdapter
│   ├── streamAdapter.ts          # 流式 chunk 处理
│   ├── multimodalMessage.ts      # 统一消息格式
│   ├── capabilityDetector.ts     # 复用现有能力检测（修复 F1 后真正使用）
│   └── mediaCodec.ts             # 图像/音频编解码
├── learning/                     # 模块三 AdaptiveLearning
│   ├── dreamingService.ts        # 短期→长期摘要
│   ├── goalTracker.ts            # 目标追踪
│   ├── steerEngine.ts            # 行为引导
│   ├── cronScheduler.ts          # 自主调度
│   ├── pacing.ts                 # 照抄 openclaw pacing.ts
│   ├── stagger.ts                # 照抄 openclaw stagger.ts
│   └── feedbackLoop.ts           # 反馈回流
├── skills/                       # 模块四 SkillPlatform
│   ├── skillContract.ts          # SKILL.md 解析
│   ├── skillRegistry.ts          # 注册中心
│   ├── skillLoader.ts            # 加载链
│   ├── skillSnapshot.ts          # 会话快照
│   ├── skillInvoker.ts           # 调用分发
│   ├── skillAvailability.ts      # 声明式可用性
│   ├── types.ts                  # 适配 openclaw src/skills/types.ts
│   └── builtin-skills/           # 内置 SKILL.md（plot-check/outline-generate/...）
├── memory/                       # 模块五 MemoryStore
│   ├── memoryStore.ts            # 存储门面
│   ├── sqliteBackend.ts          # better-sqlite3
│   ├── vectorIndex.ts            # 复用 ChatVectorizationService
│   ├── writeProvenance.ts        # 写溯源
│   ├── memoryPromptPrepare.ts    # 检索+拼装
│   └── adapters/                 # 现有资产适配器
│       ├── worldBookAdapter.ts   # worldBookService → MemoryProvider(type=lore)
│       ├── characterAdapter.ts   # 角色卡 → type=persona
│       ├── chatHistoryAdapter.ts # ChatStorageService → type=dialogue
│       └── chapterAdapter.ts     # WritingStorageService → type=chapter
├── infra/                        # 基础设施（照抄 openclaw src/infra/）
│   ├── dedupe.ts                 # 照抄
│   ├── retry.ts                  # 照抄
│   ├── backoff.ts                # 照抄
│   ├── errors.ts                 # 适配
│   └── sqliteUtils.ts            # WAL/事务封装
└── ipc/
    └── agentHandlers.ts          # agent:run/cancel/toolCall/token/done + skill:* + memory:search + learning:dream
```

### 2.1 关键集成点
- **AIService.ts**：`streamChatAPI` 增 `tools?` 与 `parallelToolCalls?` 参数；保留无 tools 旧路径（降级）。新增 `streamChatWithTools()` 委托给 `agentLoop`。
- **ChatEngine.ts**：发消息分支——若 `supportsToolCalling && 工具集非空` → 走 `AgentCore.run`；否则走旧 `streamChatAPI`。
- **tableEditParser**：合并为 `TableEditParserBase` + dialogue/game 两个薄适配；同时注册为 `updateStateTable` 工具供 agentLoop 调用（闭环：返回执行结果）。
- **worldBookService**：通过 `worldBookAdapter` 暴露为 MemoryProvider；`expandFromContext` 工具调用 `createEntry`（autoGenerated 审阅流）。

---

## 三、OpenClaw 源码照抄/适配/自研决策表

| openclaw 源文件 | 决策 | 理由 |
|----------------|------|------|
| `src/infra/dedupe.ts` | **照抄** | 纯逻辑、无外部依赖、直接可用 |
| `src/infra/retry.ts` + `backoff.ts` | **照抄** | 通用重试，项目缺失 |
| `src/infra/errors.ts` | **适配** | 错误分类理念好，合并项目现有错误码 |
| `src/cron/pacing.ts` | **照抄** | 防失控核心，纯逻辑 |
| `src/cron/stagger.ts` | **照抄** | 抖动窗口，纯逻辑 |
| `src/cron/schedule.ts` | **适配** | 依赖 Croner，本项目用轻量自研 cron 表达式解析 |
| `src/cron/store.ts` | **适配** | SQLite 持久化范式照搬，schema 按本项目改 |
| `src/skills/types.ts` | **适配** | SkillEntry/SkillExposure/SkillInvocationPolicy 直接用；SkillInstallSpec 简化（本项目无需 brew/go/uv 多语言安装） |
| `src/tools/types.ts` | **适配** | ToolDescriptor/ToolAvailabilityExpression 直接用；ToolOwnerRef 简化（本项目无 channel/mcp 所有者，仅 core/plugin） |
| `src/agents/sandbox.ts` | **适配** | 沙盒理念照搬，实现按 Electron 文件系统/世界书 ID 范围改 |
| `src/agents/timeout.ts` | **照抄** | 超时控制纯逻辑 |
| `src/agents/usage.ts` | **适配** | 追踪理念照搬，落本项目 SQLite |
| `src/agents/context.ts` | **适配** | 上下文管理理念照搬，对接项目 AgentContext |
| `src/agents/lanes.ts` | **照抄思路** | 并发车道模型照搬，API 按本项目改 |
| `src/agents/memory-write-provenance.ts` | **照抄** | 写溯源纯逻辑 |
| `src/agents/memory-prompt-prepare.ts` | **适配** | 拼装理念照搬，对接项目 promptBuilder |
| `src/llm/types.ts` + `stream.ts` | **适配** | 流式抽象理念照搬，对接项目 AIService（已 OpenAI 兼容） |
| `src/acp/*` | **暂不引入** | 多 agent 通信非首期需求，预留接口 |
| `src/plugins/*` + `src/hooks/*` | **暂不引入** | 插件/Hook 系统非首期需求 |
| `agentLoop`（openclaw 无对应） | **自研** | openclaw 的 agent 循环分散在 runtime/agents，本项目按 OpenAI tool_calls 协议自研精简版 |
| `skillContract.ts` SKILL.md 解析 | **自研** | openclaw 用 marked + yaml，本项目同栈自研精简解析器 |

**照抄原则**：纯逻辑/无外部依赖/直接可用 → 照抄；理念好但依赖本项目无 → 适配；与本项目架构差异大或非首期 → 暂不引入/自研。

---

## 四、缺陷修复清单（按优先级）

### 4.1 P0 阻断性（先于底座启用）
- [x] F1 supportsToolCalling 全链路注入（AIService.streamChatAPI 加 tools 参数 + ChatEngine 注入）✅ Task 1
- [x] F4 tableEditParser 统一（抽 Base + 两适配层）✅ Task 2
- [x] F3 tableEditParser 索引校验 ✅ Task 2.3
- [x] F2 ChatEngine 消息校验 ✅ Task 3.1

### 4.2 P1 性能与稳定性（与底座并行）
- [x] P1 EmbeddingService 缓存（content-hash → vector LRU + SQLite 持久） ✅ Task 10
- [x] P2 WorldBookKeywordMatcher 倒排索引 ✅ Task 11
- [x] P3 storageService 异步化 + WAL ✅ Task 12
- [x] P4 chatSessionRepository 异步化 ✅ Task 12
- [x] F5 AIAssistedChapterService 接入 retry ✅ Task 13.1
- [x] F6 ChatEngine 取消错误反馈 ✅ Task 3.2
- [x] F7 PlotChecker quickFix 校验 ✅ Task 13.2

### 4.3 P2 UI 与设计（体验）
- [ ] P6 消息/世界书/章节长列表虚拟化
- [ ] D1 dataStore 分层
- [ ] D2 WritingModeRightPanel 拆分
- [ ] D3 WorldBookManager memo 化
- [ ] UI 子集：删除确认、loading/骨架屏、自动滚动动画、错误恢复提示

---

## 五、集成方案（无缝接入）

### 5.1 双轨并行原则
- 所有新底座通过 `contracts.ts` 接口接入，**不改动现有调用方语义**
- 每个集成点保留 `supportsToolCalling=false` / 底座异常时**自动降级**到旧路径
- 现有 `<tableEdit>` 文本协议保留，作为 tool calling 不可用时的降级

### 5.2 三模式接入顺序
1. **对话模式**：ChatEngine 增加 `useAgent` 开关（默认 off 灰度）→ 开启后走 AgentCore + 对话组工具（searchWorldbook/searchHistory/updateStateTable/addMemoryNote）→ 验证稳定后默认 on
2. **写作模式**：新增 `WritingAgentService` 编排（读大纲→写章→checkPlot→applyAutoFix→updateTable）→ 用户手动触发"智能体写作"按钮（不替换现有逐按钮流程）
3. **世界书**：新增"AI 自主整理"按钮 + autoGenerated 待审阅区（不改动现有手动 CRUD）

### 5.3 数据迁移
- MemoryStore 新建 SQLite，**不迁移旧数据**；通过 adapter 实时桥接旧 JSON 存储
- 新数据（dreaming 摘要/autoGenerated 条目/agent 记忆）走 SQLite
- 旧数据（角色卡/世界书/对话/章节）保持原存储，adapter 透明读取

### 5.4 依赖与部署
- `pnpm add better-sqlite3 ulid`；`postinstall: electron-rebuild`
- SQLite 路径：`<userData>/agent/memory.db`
- 首次启动 `memoryStore.init()` 建表（agent_memory/agent_usage/cron_jobs/skills/audit）
- 能力检测复用现有 `probeAllCapabilities`（修复 F1 后结果真正生效）

---

## 六、实施阶段与任务依赖

| 阶段 | 内容 | 依赖 |
|------|------|------|
| 阶段 0 | P0 阻断性缺陷修复（F1-F4） | 无 |
| 阶段 1 | 底座地基：infra/ + contracts.ts + llm/ + core/agentLoop + memory/sqliteBackend | 阶段 0 |
| 阶段 2 | P1 性能修复（P1-P4, F5-F7）与底座并行 | 阶段 0 |
| 阶段 3 | skills/ 内置技能化（写作组优先） | 阶段 1 |
| 阶段 4 | 写作智能体接入（WritingAgentService） | 阶段 3 |
| 阶段 5 | 对话智能体接入（ChatEngine useAgent） | 阶段 1 |
| 阶段 6 | 世界书自驱 + learning/dreaming | 阶段 3 |
| 阶段 7 | P2 UI/设计修复 | 可并行 |

---

## ADDED Requirements

### Requirement: 智能体底座文件级落地
系统 SHALL 在 `src/main/services/agent/` 下落地五大模块的具体文件，并明确每个 openclaw 源文件的照抄/适配/自研决策。

#### Scenario: 底座落地
- **WHEN** 实施底座时
- **THEN** 新增 `src/main/services/agent/{core,llm,learning,skills,memory,infra,ipc}/` 目录与文件
- **AND** 每个 openclaw 源文件标注照抄/适配/自研决策（§三表格）
- **AND** 纯逻辑基础设施（dedupe/retry/backoff/pacing/stagger/timeout）直接照抄
- **AND** 现有资产通过 adapter 接入而非推倒重来

### Requirement: 阻断性缺陷修复
系统 SHALL 在底座启用前修复 supportsToolCalling 全链路未注入等阻断性缺陷。

#### Scenario: 修复工具调用空转
- **WHEN** 修复 F1 时
- **THEN** AIService.streamChatAPI 增加 `tools` 与 `parallelToolCalls` 参数
- **AND** ChatEngine 在 supportsToolCalling 时注入工具集
- **AND** 保留无 tools 旧路径作为降级

#### Scenario: 修复 tableEdit 重复与越界
- **WHEN** 修复 F3/F4 时
- **THEN** 抽取 TableEditParserBase，dialogue/game 改为薄适配层
- **AND** insertRow/deleteRow/updateRow 加整数与范围校验

### Requirement: 性能与稳定性修复
系统 SHALL 修复 Embedding 无缓存、WorldBook O(n) 扫描、同步文件 I/O 等性能瓶颈。

#### Scenario: 修复性能瓶颈
- **WHEN** 修复 P1/P2/P3 时
- **THEN** EmbeddingService 加 content-hash→vector 缓存
- **AND** WorldBookKeywordMatcher 建倒排索引替代 O(n) 扫描
- **AND** storageService 同步 I/O 异步化 + SQLite WAL

### Requirement: 无缝集成与降级
系统 SHALL 通过双轨并行与自动降级确保底座无缝接入现有系统。

#### Scenario: 降级保护
- **WHEN** supportsToolCalling=false 或底座异常时
- **THEN** 自动回退到现有 streamChatAPI + `<tableEdit>` 文本协议路径
- **AND** 现有调用方语义不变
- **AND** 现有数据存储不迁移，通过 adapter 桥接

## MODIFIED Requirements

无（底座新增 + 现有路径保留；tableEditParser 合并为内部重构，对外行为不变）。

## REMOVED Requirements

无。
