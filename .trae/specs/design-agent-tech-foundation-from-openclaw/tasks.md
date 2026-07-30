# Tasks

> 本 Spec 为**技术底座设计型文档**（design doc），"实现"即撰写设计文档本身。以下任务为设计活动的分解，对应产出物已落入 `spec.md`。经用户审阅后，可能根据反馈对各模块接口、融合路径或专题（性能/安全/跨平台）进行增补修订。

## 阶段一：openclaw 源码调研

- [x] Task 1: 调研 openclaw 核心设计哲学
  - [x] SubTask 1.1: VISION.md / README.md / AGENTS.md / docs/concepts/soul.md（SOUL.md/AGENTS.md/MEMORY.md 三分离模型）
  - [x] SubTask 1.2: 三分离模型在本项目的映射（角色卡/世界书/操作规则）

- [x] Task 2: 调研 openclaw agent 架构（src/agents/）
  - [x] SubTask 2.1: config.ts / context.ts / lanes.ts / sandbox.ts / timeout.ts / usage.ts
  - [x] SubTask 2.2: btw.ts（任务世界）/ pty-dsr.ts（终端）/ docs/plan/swarms.md（多 agent）/ goal.md / steer.md（目标驱动）

- [x] Task 3: 调研 openclaw 技能系统（src/skills/ + skills/）
  - [x] SubTask 3.1: src/skills/types.ts（SkillEntry/SkillInvocationPolicy/SkillExposure/SkillCommandSpec）
  - [x] SubTask 3.2: skills/spike/SKILL.md 等 5 个示例（SKILL.md 契约格式）
  - [x] SubTask 3.3: 加载链 workspace→local-loader→plugin-skills→remote-skills→session-snapshot

- [x] Task 4: 调研 openclaw 记忆 + 学习 + Cron
  - [x] SubTask 4.1: memory-prompt-prepare.ts / memory-search.ts / memory-write-provenance.ts（记忆 + 写溯源）
  - [x] SubTask 4.2: src/cron/（service/schedule/store/pacing/stagger/delivery/types）+ dreaming 长期记忆
  - [x] SubTask 4.3: globals.ts（AGENT_ID/RUN_ID/memory）+ global-state.ts

- [x] Task 5: 调研 openclaw 工具/插件/Hook/ACP/Flow/LLM
  - [x] SubTask 5.1: src/tools/types.ts（ToolDescriptor/ToolAvailabilityExpression 声明式可用性）
  - [x] SubTask 5.2: src/plugins/ + src/hooks/ + src/acp/（client/server/types/policy）+ src/flows/types.ts
  - [x] SubTask 5.3: src/llm/stream.ts + types.ts（provider 无关流式）+ plugin-sdk/llm.ts + claws/mcp.ts
  - [x] SubTask 5.4: src/infra/（dedupe/retry/backoff/fs-safe 等）

- [x] Task 6: 归纳 openclaw 设计理念提取结论（spec §一）
  - [x] SubTask 6.1: 三分离 / 声明式可用性 / SKILL.md 契约 / dreaming / cron pacing / ACP / 写溯源 七大理念
  - [x] SubTask 6.2: 每个理念标注 openclaw 源文件引用与本项目映射

## 阶段二：五大模块设计

- [x] Task 7: 撰写模块一 AgentCore（spec §三）
  - [x] SubTask 7.1: 职责 + 架构（移植 src/agents/ 范式：lifecycle/context/lanes/sandbox/timeout/usage/agentLoop）
  - [x] SubTask 7.2: 接口规范（AgentRunIntent/AgentRunResult/AgentError TypeScript 定义）
  - [x] SubTask 7.3: 错误处理机制（单 tool 失败/MAX_ITERATIONS/TIMEOUT/SANDBOX_VIOLATION/Provider 重试）
  - [x] SubTask 7.4: 与三模式集成（对话/写作/游戏/世界书四入口）

- [x] Task 8: 撰写模块二 Multimodal I/O（spec §四）
  - [x] SubTask 8.1: 职责 + 架构（移植 src/llm/ + src/media/ + plugin-sdk）
  - [x] SubTask 8.2: 接口规范（LLMProvider/StreamChatRequest/UnifiedMessage/MultimodalContent/StreamChunk）
  - [x] SubTask 8.3: 数据格式要求（OpenAI 兼容 + image_url + audio 段）
  - [x] SubTask 8.4: 降级矩阵（ToolCalling/Vision/Audio 支持与不支持）

- [x] Task 9: 撰写模块三 AdaptiveLearning（spec §五）
  - [x] SubTask 9.1: 职责 + 架构（dreaming + goal/steer + cron pacing/stagger）
  - [x] SubTask 9.2: 接口规范（DreamingJob/DreamingResult/GoalSpec）
  - [x] SubTask 9.3: 防失控机制（pacing/stagger/dedupe/草稿区）

- [x] Task 10: 撰写模块四 SkillPlatform（spec §六）
  - [x] SubTask 10.1: 职责 + 架构（移植 src/skills/：契约/注册/加载/快照/调用/可用性）
  - [x] SubTask 10.2: SKILL.md 契约格式（frontmatter + markdown + 三层可见性 + 双调用策略）
  - [x] SubTask 10.3: 内置技能清单（11 个现有能力技能化：plot-check/outline-generate/chapter-write/polish/table-organize/worldbook-*/state-table-edit/chat-history-search/worldbook-search）
  - [x] SubTask 10.4: 接口规范（SkillEntry/invokeSkill）

- [x] Task 11: 撰写模块五 MemoryStore（spec §七）
  - [x] SubTask 11.1: 职责 + 架构（memory-core + SQLite + 向量 + 写溯源）
  - [x] SubTask 11.2: 记忆分类统一表（persona/lore/dialogue/chapter/memory_md/note 六类对应现有散落存储）
  - [x] SubTask 11.3: 接口规范（MemoryEntry/WriteProvenance/write/read/search/MemoryQuery）
  - [x] SubTask 11.4: 错误处理（SQLite 写失败/向量索引失败/读失败降级）

## 阶段三：统一接口规范 + 集成文档 + 专题

- [x] Task 12: 撰写统一接口规范汇总（spec §八）
  - [x] SubTask 12.1: 跨模块通信契约（IToolProvider/IMemoryProvider/ILLMProvider/ISkillRegistry/ILearningScheduler）
  - [x] SubTask 12.2: IPC 通道规范表（agent:run/cancel/toolCall/token/done + skill:list/invoke + memory:search + learning:dream）
  - [x] SubTask 12.3: 统一数据格式（时间戳/ID/消息/工具 schema/持久化/向量）
  - [x] SubTask 12.4: 统一错误码（AGENT_*/PROVIDER_*/TOOL_*/SKILL_*/MEMORY_*/SANDBOX_*）

- [x] Task 13: 撰写集成文档（spec §九）
  - [x] SubTask 13.1: 部署流程（依赖/DB 初始化/技能注册/能力检测/降级/三模式接入 6 步）
  - [x] SubTask 13.2: 环境配置（必须/可选/SQLite 路径/技能目录）
  - [x] SubTask 13.3: 依赖说明表（better-sqlite3/ulid/现有 ChatVectorizationService/EmbeddingService/AIService + native rebuild）
  - [x] SubTask 13.4: 现有资产对接清单（9 项适配器接入）

- [x] Task 14: 撰写性能优化专题（spec §十）
  - [x] SubTask 14.1: tool 并行 + 结果缓存 + 向量懒加载 + 记忆压缩 + SQLite WAL + 技能快照 + 流式优先

- [x] Task 15: 撰写安全性设计专题（spec §十一）
  - [x] SubTask 15.1: 沙盒隔离 + 写操作分级 + 自主节流 + 敏感数据保护 + prompt 注入防护 + 审计日志 + 隐私

- [x] Task 16: 撰写跨平台兼容性专题（spec §十二）
  - [x] SubTask 16.1: Electron 主进程 + native rebuild + 文件路径 + OS 差异（SkillInstallSpec os[]）+ WSL/Linux + 移动端预留

- [x] Task 17: 撰写与三模式融合路径（spec §十三）
  - [x] SubTask 17.1: 阶段 0 地基 → 阶段 1 写作 → 阶段 2 对话 → 阶段 3 世界书 → 阶段 4 学习
  - [x] SubTask 17.2: 每阶段保留 supportsToolCalling=false 降级路径

## 阶段四：用户反馈与修订（待用户审阅后执行）

- [x] Task 18: 根据用户反馈对 spec.md 进行增补/修订
  - [x] SubTask 18.1: 若用户指定重点模块，则细化该模块接口与实施细节 — 未触发（用户审批通过未指定重点）
  - [x] SubTask 18.2: 若用户调整融合路径顺序，则同步更新 §十三 — 未触发（用户未调整顺序）
  - [x] SubTask 18.3: 若用户要求新增专题（如可观测性/成本治理），则补章节 — 未触发（用户未要求新增）
  - 总结：用户审批通过 spec.md，未提出修订要求，本任务条件未触发，按 N/A 完成

# Task Dependencies
- Task 1-5（openclaw 调研）可并行
- Task 6（理念归纳）依赖 Task 1-5
- Task 7-11（五大模块）依赖 Task 6
- Task 12-17（接口/集成/专题/融合）依赖 Task 7-11
- Task 18（反馈修订）依赖用户审阅 spec.md 后的反馈
