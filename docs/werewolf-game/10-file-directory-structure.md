# 10 - 狼人杀推理游戏文件目录结构规划

> 本文档定义狼人杀推理游戏在 [Creative Cafe](file:///d:/AI/creative-cafe/README.md) 仓库中的源码目录、IPC handler 目录、渲染进程模板目录、共享类型与常量目录、默认游戏元数据目录、测试目录的完整规划。本文档严格遵循 [01-system-architecture.md](./01-system-architecture.md) 第 9 章术语表，并与既有经营模板目录结构对齐，确保狼人杀作为第二款完整游戏接入既有 [游戏模式框架](file:///d:/AI/creative-cafe/.trae/specs/add-game-mode-framework/spec.md)。

## 1. 设计目标与边界

### 1.1 设计目标

| 目标 | 说明 |
| :--- | :--- |
| **目录对齐** | 狼人杀模板目录结构与既有 [`management`](file:///d:/AI/creative-cafe/src/main/services/game/templates/management/) 模板保持同构，降低维护成本 |
| **单一真源** | 所有共享类型集中在 [`werewolf.types.ts`](file:///d:/AI/creative-cafe/src/shared/types/werewolf.types.ts)，所有共享常量集中在 [`werewolf.constants.ts`](file:///d:/AI/creative-cafe/src/shared/constants/werewolf.constants.ts)，对齐 [01-system-architecture.md](./01-system-architecture.md) §7.2 |
| **职责边界** | 每个文件对应一个 [01-system-architecture.md](./01-system-architecture.md) §9.5 系统组件，职责单一可测 |
| **热插拔** | 角色包 / 地图包 / 规则包 / 案件剧本通过 `data/games/werewolf_default/` 数据目录接入，无需改代码 |
| **测试对齐** | 每个服务对应一个单元测试文件，状态机与跨服务流程放入 `__tests__/integration/`，对齐 [01-system-architecture.md](./01-system-architecture.md) §7.2 测试覆盖要求 |

### 1.2 依赖文档

本文档依赖以下已完成的策划文档，目录规划中的文件职责均源自这些文档：

- [01-system-architecture.md](./01-system-architecture.md) — 总览与术语表
- [02-judge-system-design.md](./02-judge-system-design.md) — 法官调度器 / 真相剧本 / 暗码
- [03-character-system-design.md](./03-character-system-design.md) — 角色档案 / 阵营分配
- [04-map-system-design.md](./04-map-system-design.md) — 4 层楼地图 / 房卡 / 可搜索点位
- [05-game-flow-design.md](./05-game-flow-design.md) — 八大阶段状态机
- [06-ai-driving-mechanism.md](./06-ai-driving-mechanism.md) — 上下文隔离 / 行为决策树
- [07-rule-system-design.md](./07-rule-system-design.md) — 基础 / 扩展规则集

### 1.3 与既有代码的对齐策略

狼人杀作为第二款完整游戏，沿用经营模板的目录分层模式：

```
src/main/services/game/templates/<templateId>/
   ├── <Template>NarrativeService.ts   ← 扩展 GameNarrativeService
   └── <Template>PromptBuilder.ts       ← 扩展 GamePromptBuilder

src/renderer/components/Game/templates/<templateId>/
   ├── <Template>GameMain.tsx           ← 懒加载主组件
   ├── <Template>GameTemplate.ts        ← 实现 GameTypeTemplate
   ├── <templateId>Schema.ts            ← 表格 schema
   └── <templateId>InitialState.ts      ← 初始状态
```

狼人杀因涉及多 AI 上下文隔离、真相剧本生成、证据链与证言管理，服务层文件数量显著多于经营模板，故在 `templates/werewolf/` 下按子系统拆分为 9 个服务文件 + 1 个 prompt 构建器。

## 2. 顶层目录总览

```
creative-cafe/
├── src/
│   ├── main/
│   │   ├── ipc/handlers/game/werewolf/         ← §4 IPC handler 目录
│   │   └── services/game/templates/werewolf/   ← §3 主进程服务目录
│   ├── renderer/
│   │   └── components/Game/templates/werewolf/ ← §5 渲染进程模板目录
│   └── shared/
│       ├── constants/werewolf.constants.ts     ← §6 共享常量
│       └── types/werewolf.types.ts             ← §6 共享类型
├── data/
│   └── games/werewolf_default/                 ← §7 默认游戏元数据目录
└── (test 目录随源码就近放置，见 §8)
```

## 3. 主进程服务目录规划

### 3.1 目录结构

```
src/main/services/game/templates/werewolf/
├── JudgeService.ts                    ← 法官调度器（核心入口）
├── CharacterContextService.ts         ← 角色上下文管理器
├── EvidenceChainService.ts            ← 证据链引擎
├── TestimonyService.ts                ← 证言管理器
├── VotingService.ts                   ← 投票裁判
├── AiBehaviorService.ts               ← AI 行为模拟器
├── TruthScriptService.ts              ← 真相剧本服务
├── WerewolfNarrativeService.ts        ← 叙事服务（扩展 GameNarrativeService）
├── WerewolfPromptBuilder.ts           ← prompt 构建器（扩展 GamePromptBuilder）
└── __tests__/
    ├── JudgeService.test.ts
    ├── CharacterContextService.test.ts
    ├── EvidenceChainService.test.ts
    ├── TestimonyService.test.ts
    ├── VotingService.test.ts
    ├── AiBehaviorService.test.ts
    ├── TruthScriptService.test.ts
    ├── WerewolfNarrativeService.test.ts
    ├── WerewolfPromptBuilder.test.ts
    └── integration/
        ├── NightToMorningFlow.test.ts   ← 夜间→晨间结算集成
        ├── InvestigationFlow.test.ts    ← 现场调查全流程集成
        ├── TrialFlow.test.ts            ← 庭前推理→审判处刑集成
        └── FullDayCycle.test.ts         ← 单日完整循环集成
```

### 3.2 文件职责说明

#### 3.2.1 JudgeService.ts（法官调度器）

[01-system-architecture.md](./01-system-architecture.md) §9.5 定义的**法官调度器**实现。本游戏所有命令执行、阶段切换协调、暗码全局一致性的核心入口，对应 [02-judge-system-design.md](./02-judge-system-design.md) §2 五项法官职责。

- 维护以 `saveId` 为键的运行时状态，禁止跨存档读取（对齐 [01-system-architecture.md](./01-system-architecture.md) §7.4）
- 协调其他 8 个子服务的调用顺序，是**唯一**对外暴露给 IPC handler 的总入口
- 维护暗码全局一致性（`faction-codes.json` 初始化后不变）
- 不直接生成 AI 回复，AI 角色对话与法官系统播报通过 [`WerewolfNarrativeService`](#329-werewolfnarrativeservicets-叙事服务扩展-gamernarrativeservice) 与 [`AiBehaviorService`](#326-aibehaviorservicets-ai-行为模拟器) 完成

#### 3.2.2 CharacterContextService.ts（角色上下文管理器）

[01-system-architecture.md](./01-system-architecture.md) §9.5 定义的**角色上下文管理器**实现。负责 16 名 AI 角色独立上下文的读写与注入，对齐 [06-ai-driving-mechanism.md](./06-ai-driving-mechanism.md) 的上下文隔离方案与 [01-system-architecture.md](./01-system-architecture.md) §6.2 持久化 context 文件方案。

- 每角色独立 `ai-contexts/<characterId>.json`，存储已知信息列表、近期对话（最近 20 轮）、当前阶段任务
- 每次调用 AI 时按规则注入对应角色的 context 片段，**禁止跨角色注入**
- 提供 `getVisibleInfo(characterId)` 与 `mergeKnownInfo(characterId, info)` 接口供法官在证言收集、现场调查环节更新

#### 3.2.3 EvidenceChainService.ts（证据链引擎）

[01-system-architecture.md](./01-system-architecture.md) §9.5 定义的**证据链引擎**实现。管理证据的生成、收集、销毁、展示，对应 [01-system-architecture.md](./01-system-architecture.md) §4.2 证据链层。

- 现场调查环节基于真相剧本生成可搜索点位清单（对齐 [04-map-system-design.md](./04-map-system-design.md) 的可搜索点位）
- 收集的证据持久化到 `evidence.json`，玩家与法官可见；AI 角色仅在玩家出示后可见
- 处理真相剧本中的"证据销毁"动作：若真相剧本记录某证据已被销毁，现场调查不可发现

#### 3.2.4 TestimonyService.ts（证言管理器）

[01-system-architecture.md](./01-system-architecture.md) §9.5 定义的**证言管理器**实现。管理证言的生成、整理、矛盾点标注，对应 [01-system-architecture.md](./01-system-architecture.md) §4.2 证言层。

- 证言收集环节按角色已知信息生成证言，持久化到 `testimony.json`
- 未询问角色不可见该证言；玩家质询 / 出示证物 / 威慑后整理入证言表
- 标注证言与证据、其他证言之间的矛盾点，供庭前推理阶段使用

#### 3.2.5 VotingService.ts（投票裁判）

[01-system-architecture.md](./01-system-architecture.md) §9.5 定义的**投票裁判**实现。管理投票、归票、平票处理、处刑执行，对应 [02-judge-system-design.md](./02-judge-system-design.md) §2.4 投票归票判定。

- 典狱长拥有 2 票投票权（对齐 [01-system-architecture.md](./01-system-architecture.md) §1.2）
- 处理笨蛋触发判定：单角色得票过半触发临时休庭（对齐 [01-system-architecture.md](./01-system-architecture.md) §9.4 笨蛋）
- 处理平票场景：最后辩护 → 再投票
- 处刑执行 + 遗言生成，触发死亡状态更新与胜负判定

#### 3.2.6 AiBehaviorService.ts（AI 行为模拟器）

[01-system-architecture.md](./01-system-architecture.md) §9.5 定义的**AI 行为模拟器**实现。基于角色阵营与已知信息生成行为决策，对应 [06-ai-driving-mechanism.md](./06-ai-driving-mechanism.md) 的行为决策树。

- 伪装者遵循"心理素质极强、绝不露出破绽"的策略（对齐 [02-judge-system-design.md](./02-judge-system-design.md) §2.2）
- 神民按技能策略生成决策：药剂师用药、保安反杀、笨蛋吸引投票、黑客保护
- 通过有界并发队列调用 [`AIService.streamChatAPI`](file:///d:/AI/creative-cafe/src/main/services/AIService.ts)，同时最多 3 个 AI 调用（对齐 [01-system-architecture.md](./01-system-architecture.md) §6.3 与 §7.1）

#### 3.2.7 TruthScriptService.ts（真相剧本服务）

负责 [01-system-architecture.md](./01-system-architecture.md) §9.3 定义的**真相剧本**生成与读取。每夜 00:00 由法官 AI 生成完整犯罪过程 JSON，持久化到 `truth-script.json`，玩家与其他 AI 均不可见（对齐 [01-system-architecture.md](./01-system-architecture.md) §4.2 真相剧本层）。

- 真相剧本须涵盖：时间、地点、凶手 / 帮凶、手法 / 凶器、凶器来源与处理、证据销毁与栽赃嫁祸、提前准备、技能发动情况、目击者
- 支持未发生命案时仍记录伪装者是否选择杀人、技能发动地点、预期目标等隐藏信息
- 仅法官 AI 可读写，其他服务只能通过 [`JudgeService`](#321-judgeservicets-法官调度器) 间接访问

#### 3.2.8 WerewolfNarrativeService.ts（叙事服务，扩展 GameNarrativeService）

参照 [`ManagementNarrativeService`](file:///d:/AI/creative-cafe/src/main/services/game/templates/management/ManagementNarrativeService.ts) 的包装层模式，扩展 [`GameNarrativeService`](file:///d:/AI/creative-cafe/src/main/services/game/GameNarrativeService.ts)。

- 通过依赖注入持有 `GameNarrativeService` 实例，复用其 `generateNarrative` / `abortAll` 等方法
- 注入 [`WerewolfPromptBuilder`](#329-werewolfpromptbuilderts-prompt-构建器扩展-gamepromptbuilder) 生成的狼人杀专属 system prompt
- 复用 `applyTableEdits` 协议更新狼人杀 sheet schema（角色表 / 证据表 / 证言表 / 投票表 / 真相表 / 日志表）
- 阶段切换时通过 `templateSystemPrompt` 字段动态注入对应阶段的规则片段

#### 3.2.9 WerewolfPromptBuilder.ts（prompt 构建器，扩展 GamePromptBuilder）

参照 [`ManagementPromptBuilder`](file:///d:/AI/creative-cafe/src/main/services/game/templates/management/ManagementPromptBuilder.ts) 模式，扩展 [`GamePromptBuilder`](file:///d:/AI/creative-cafe/src/main/services/game/GamePromptBuilder.ts)。

- 构建狼人杀专属 system prompt 片段，作为 `templateSystemPrompt` 注入到通用 `GamePromptBuilder` 的 `【模板额外规则】` 段
- 按阶段生成对应 prompt 片段：夜间 / 晨间结算 / 现场调查 / 证言收集 / 庭前推理 / 审判处刑 / 身份鉴定 / 日间活动
- 注入暗码协议规则（对齐 [02-judge-system-design.md](./02-judge-system-design.md) §4 暗码标记协议）
- 注入禁止行为清单（对齐 [02-judge-system-design.md](./02-judge-system-design.md) §3 法官禁止行为）
- 构建 user prompt 时按阶段注入对应上下文（真相剧本摘要 / 证据表 / 证言表 / 角色已知信息）

## 4. IPC handler 目录规划

### 4.1 目录结构

```
src/main/ipc/handlers/game/werewolf/
├── werewolfJudgeHandlers.ts           ← 法官调度相关 IPC
├── werewolfInvestigationHandlers.ts   ← 现场调查相关 IPC
├── werewolfTestimonyHandlers.ts       ← 证言收集相关 IPC
├── werewolfVotingHandlers.ts          ← 投票审判相关 IPC
├── werewolfMapHandlers.ts             ← 地图与可搜索点位相关 IPC
├── werewolfCharacterHandlers.ts       ← 角色档案与阵营相关 IPC
├── index.ts                           ← 聚合注册入口
└── __tests__/
    ├── werewolfJudgeHandlers.test.ts
    ├── werewolfInvestigationHandlers.test.ts
    ├── werewolfTestimonyHandlers.test.ts
    ├── werewolfVotingHandlers.test.ts
    ├── werewolfMapHandlers.test.ts
    └── werewolfCharacterHandlers.test.ts
```

### 4.2 文件职责说明

所有 handler 文件参照既有 [`gameNarrativeHandlers.ts`](file:///d:/AI/creative-cafe/src/main/services/game/GameNarrativeService.ts) 的模式：通过 `wrapHandler` 包装、`activeAbortControllers` 管理取消、`safeSend` 推送流式事件。

| 文件 | 一句话职责 | 主要 IPC 频道（示例） |
| :--- | :--- | :--- |
| `werewolfJudgeHandlers.ts` | 法官调度器命令执行入口，处理身份鉴定 / 阶段切换 / 处刑方式选择 | `werewolf:judge:identify`、`werewolf:judge:advancePhase`、`werewolf:judge:selectExecution` |
| `werewolfInvestigationHandlers.ts` | 现场调查环节的可搜索点位查询与证据收集 | `werewolf:investigation:searchPoint`、`werewolf:investigation:collectEvidence` |
| `werewolfTestimonyHandlers.ts` | 证言收集环节的质询 / 出示证物 / 威慑 | `werewolf:testimony:question`、`werewolf:testimony:presentEvidence`、`werewolf:testimony:press` |
| `werewolfVotingHandlers.ts` | 审判处刑环节的辩护生成、投票、归票、处刑 | `werewolf:voting:defense`、`werewolf:voting:castVote`、`werewolf:voting:tally` |
| `werewolfMapHandlers.ts` | 地图查询、房卡权限校验、监控调取 | `werewolf:map:getMap`、`werewolf:map:checkAccess`、`werewolf:map:getMonitor` |
| `werewolfCharacterHandlers.ts` | 角色档案 CRUD、阵营分配、自定义角色创建 | `werewolf:character:list`、`werewolf:character:create`、`werewolf:character:assignFaction` |
| `index.ts` | 聚合注册所有 werewolf handler，提供 `registerWerewolfHandlers()` 入口 | （被 `gameHandlers.ts` 调用） |

### 4.3 与既有 handler 的关系

狼人杀 handler 在 [`gameHandlers.ts`](file:///d:/AI/creative-cafe/src/main/ipc/handlers/game/) 聚合入口中注册：

```ts
// src/main/ipc/handlers/game/gameHandlers.ts （既有文件，需扩展）
import { registerWerewolfHandlers } from './werewolf';
// 在既有 registerGameHandlers 中追加调用
registerWerewolfHandlers();
```

狼人杀叙事生成复用既有 [`game:generateNarrative`](file:///d:/AI/creative-cafe/src/main/ipc/handlers/game/gameNarrativeHandlers.ts) 频道，由 [`WerewolfNarrativeService`](#328-werewolfnarrativeservicets-叙事服务扩展-gamernarrativeservice) 包装 `GameNarrativeService` 实现，不新增叙事生成频道。

## 5. 渲染进程模板目录规划

### 5.1 目录结构

```
src/renderer/components/Game/templates/werewolf/
├── WerewolfGameMain.tsx               ← 懒加载主组件
├── WerewolfGameTemplate.ts            ← 实现 GameTypeTemplate
├── werewolfSchema.ts                  ← 狼人杀表格 schema
├── werewolfInitialState.ts            ← 狼人杀初始状态
├── panels/
│   ├── CharacterPanel.tsx             ← 角色面板（16 名 AI 角色 + 典狱长）
│   ├── MapPanel.tsx                   ← 地图面板（4 层楼瓦片图）
│   ├── EvidencePanel.tsx              ← 证据表面板
│   ├── TestimonyPanel.tsx             ← 证言表面板
│   ├── ReasoningPanel.tsx             ← 庭前推理工作台
│   ├── VotingPanel.tsx                ← 投票面板
│   └── LogPanel.tsx                   ← 阶段日志 / 系统播报面板
└── __tests__/
    ├── WerewolfGameMain.test.tsx
    ├── WerewolfGameTemplate.test.tsx
    ├── werewolfSchema.test.ts
    ├── werewolfInitialState.test.ts
    └── panels/
        ├── CharacterPanel.test.tsx
        ├── MapPanel.test.tsx
        ├── EvidencePanel.test.tsx
        ├── TestimonyPanel.test.tsx
        ├── ReasoningPanel.test.tsx
        ├── VotingPanel.test.tsx
        └── LogPanel.test.tsx
```

### 5.2 文件职责说明

#### 5.2.1 顶层文件

| 文件 | 一句话职责 |
| :--- | :--- |
| `WerewolfGameMain.tsx` | 狼人杀主组件，参照 [`ManagementGameMain.tsx`](file:///d:/AI/creative-cafe/src/renderer/components/Game/templates/management/ManagementGameMain.tsx) 的懒加载模式，组合顶栏 + 左侧叙事 + 右侧模板面板区 |
| `WerewolfGameTemplate.ts` | 实现 [`GameTypeTemplate`](file:///d:/AI/creative-cafe/src/shared/types/game.types.ts) 接口，参照 [`ManagementGameTemplate.ts`](file:///d:/AI/creative-cafe/src/renderer/components/Game/templates/management/ManagementGameTemplate.ts) 提供 `serializeState` / `deserializeState` / `getInitialState` |
| `werewolfSchema.ts` | 定义狼人杀表格 schema（角色表 / 证据表 / 证言表 / 投票表 / 真相表 / 日志表），参照 [`managementSchema.ts`](file:///d:/AI/creative-cafe/src/renderer/components/Game/templates/management/managementSchema.ts) |
| `werewolfInitialState.ts` | 定义狼人杀模板自定义状态（当前阶段 / 天数 / 角色存活表 / 已收集证据 id / 已询问角色 id），参照 [`managementInitialState.ts`](file:///d:/AI/creative-cafe/src/renderer/components/Game/templates/management/managementInitialState.ts) |

#### 5.2.2 panels 子目录

| 文件 | 对应阶段 / 用途 | UI 操作类型（对齐 [05-game-flow-design.md](./05-game-flow-design.md)） |
| :--- | :--- | :--- |
| `CharacterPanel.tsx` | 角色存活列表与状态查看（存活 / 死亡 / 处刑 / 失踪） | 全阶段常驻 |
| `MapPanel.tsx` | 4 层楼瓦片地图，复用 [`AnsiTileMap`](file:///d:/AI/creative-cafe/src/renderer/components/Game/AnsiTileMap.tsx) | 现场调查 / 日间活动 |
| `EvidencePanel.tsx` | 证据表展示，玩家可拖入证言进行比对 | 现场调查 / 证言收集 / 庭前推理 |
| `TestimonyPanel.tsx` | 证言表展示，标注矛盾点 | 证言收集 / 庭前推理 |
| `ReasoningPanel.tsx` | 庭前推理工作台，玩家提交推理结论 | 庭前推理 |
| `VotingPanel.tsx` | 投票面板，玩家投 2 票，AI 角色辩护 | 审判处刑 |
| `LogPanel.tsx` | 系统播报与阶段日志，复用 [`NarrativePanel`](file:///d:/AI/creative-cafe/src/renderer/components/Game/panels/NarrativePanel.tsx) | 全阶段常驻 |

#### 5.2.3 与既有框架的复用

- 顶部状态栏复用 [`GameStateBar`](file:///d:/AI/creative-cafe/src/renderer/components/Game/panels/GameStateBar.tsx)，扩展显示天数 / 阶段
- 左侧叙事面板复用 [`NarrativePanel`](file:///d:/AI/creative-cafe/src/renderer/components/Game/panels/NarrativePanel.tsx)
- 整体布局复用 [`GameMainPage`](file:///d:/AI/creative-cafe/src/renderer/components/Game/GameMainPage.tsx) 框架
- 阶段切换动画复用 [`PageTransition`](file:///d:/AI/creative-cafe/src/renderer/components/Layout/PageTransition.tsx)
- 状态管理扩展既有 [`gameStore`](file:///d:/AI/creative-cafe/src/renderer/stores/gameStore.ts) 与 [`gameUIStore`](file:///d:/AI/creative-cafe/src/renderer/stores/gameUIStore.ts)

## 6. 共享类型与常量目录规划

### 6.1 目录结构

```
src/shared/
├── types/
│   ├── werewolf.types.ts              ← 狼人杀共享类型（单一真源）
│   ├── __tests__/
│   │   └── werewolf.types.test.ts
│   └── index.ts                       ← 既有，需追加 re-export werewolf 类型
└── constants/
    ├── werewolf.constants.ts          ← 狼人杀共享常量（单一真源）
    └── __tests__/
        └── werewolf.constants.test.ts
```

### 6.2 werewolf.types.ts 内容规划

参照 [`game.types.ts`](file:///d:/AI/creative-cafe/src/shared/types/game.types.ts) 的组织风格，集中定义狼人杀全部共享类型。详细接口定义见 [03-character-system-design.md](./03-character-system-design.md) §2、[05-game-flow-design.md](./05-game-flow-design.md) §2、[09-database-design.md](./09-database-design.md)。

主要导出：

- `WerewolfCharacter` — 角色档案（含 `factionCode` 字段）
- `FactionCode` — 暗码枚举（`'好' | '伪' | '药' | '保' | '笨' | '黑'`，对齐 [01-system-architecture.md](./01-system-architecture.md) §9.3）
- `WerewolfPhase` — 八大阶段枚举（夜间 / 晨间结算 / 现场调查 / 证言收集 / 庭前推理 / 审判处刑 / 身份鉴定 / 日间活动，对齐 [01-system-architecture.md](./01-system-architecture.md) §9.2）
- `TruthScript` — 真相剧本结构（时间 / 地点 / 凶手 / 被害人 / 手法 / 凶器 / 证据销毁 / 栽赃嫁祸 / 技能发动 / 目击者）
- `Evidence` / `Testimony` / `VoteRecord` — 证据 / 证言 / 投票记录
- `WerewolfState` — 模板自定义状态
- `WerewolfRuleConfig` — 规则配置（基础 / 扩展规则集，对齐 [07-rule-system-design.md](./07-rule-system-design.md)）
- `CharacterContext` — 单角色 AI 上下文（已知信息 / 近期对话 / 当前阶段任务）
- 各 IPC 请求 / 响应类型（如 `IdentifyRequest` / `InvestigationResponse`）

### 6.3 werewolf.constants.ts 内容规划

参照 [`game.constants.ts`](file:///d:/AI/creative-cafe/src/shared/constants/game.constants.ts) 的组织风格，集中定义狼人杀全部共享常量。主要导出：

- `WEREWOLF_PHASE_LABELS` — 阶段枚举到中文标签的映射
- `WEREWOLF_PHASE_TRANSITIONS` — 阶段状态机转移表（对齐 [01-system-architecture.md](./01-system-architecture.md) §6.1 自实现状态机建议）
- `WEREWOLF_FACTION_CONFIG` — 默认阵营配比（7 普通好人 + 4 神民 + 5 伪装者，对齐 [07-rule-system-design.md](./07-rule-system-design.md) §2.2）
- `WEREWOLF_FACTION_CODE_LABELS` — 暗码到中文标签的映射
- `WEREWOLF_TABLE_SCHEMA` — 狼人杀表格 schema 常量（与 `werewolfSchema.ts` 一致，作为主进程侧的真源）
- `WEREWOLF_AI_CONCURRENCY` — AI 并发上限（3，对齐 [01-system-architecture.md](./01-system-architecture.md) §6.3）
- `WEREWOLF_VOTE_WEIGHT_PLAYER` — 典狱长投票权重（2，对齐 [01-system-architecture.md](./01-system-architecture.md) §1.2）
- `WEREWOLF_CONTEXT_MAX_TURNS` — AI 上下文最近对话保留轮数（20，对齐 [01-system-architecture.md](./01-system-architecture.md) §6.2）

## 7. 默认游戏元数据目录规划

### 7.1 目录结构

```
data/games/werewolf_default/
├── meta.json                          ← 游戏元数据（标题 / 描述 / 版本 / tags）
├── characters/                        ← 16 名默认角色 JSON
│   ├── c01.json
│   ├── c02.json
│   ├── ...
│   └── c16.json
├── maps/
│   └── prison.json                    ← 监狱 4 层楼地图配置
├── rules/
│   └── standard.json                  ← 标准规则集（屠边局 + 默认扩展规则）
└── scripts/                           ← 案件剧本（可选，留空目录占位）
    └── .gitkeep
```

### 7.2 文件职责说明

| 文件 / 目录 | 一句话职责 |
| :--- | :--- |
| `meta.json` | 游戏元数据，对齐 [`GameMeta`](file:///d:/AI/creative-cafe/src/shared/types/game.types.ts)，包含 `id` / `type` / `title` / `description` / `gameplay` / `version` / `status` / `tags` |
| `characters/c01.json` ~ `c16.json` | 16 名默认 AI 角色档案，结构对齐 [`WerewolfCharacter`](#62-werewolftypests-内容规划)（不含 `factionCode`，阵营由系统初始化时分配，对齐 [03-character-system-design.md](./03-character-system-design.md) §1） |
| `maps/prison.json` | 监狱 4 层楼地图配置，含房间 / 走廊 / 公共区域 / 可搜索点位 / 监控覆盖，对齐 [04-map-system-design.md](./04-map-system-design.md) |
| `rules/standard.json` | 标准规则集，含基础规则（屠边局 / 阵营配比 / 夜间黑盒 / 击杀规则 / 晨间死亡判定 / 首夜保护）与默认扩展规则，对齐 [07-rule-system-design.md](./07-rule-system-design.md) §2-§3 |
| `scripts/` | 案件剧本占位目录，对齐 [01-system-architecture.md](./01-system-architecture.md) §7.3 可扩展性，留空目录占位 |

### 7.3 热插拔约定

对齐 [01-system-architecture.md](./01-system-architecture.md) §7.3 可扩展性要求：

- **新角色包**：放入 `data/games/werewolf_default/characters/` 即可，无需改代码
- **新地图包**：放入 `data/games/werewolf_default/maps/` 即可
- **新规则包**：放入 `data/games/werewolf_default/rules/` 即可
- **新案件剧本**：放入 `data/games/werewolf_default/scripts/` 即可

存档运行时数据（`truth-script.json` / `evidence.json` / `testimony.json` / `faction-codes.json` / `ai-contexts/<characterId>.json`）不放在 `data/games/werewolf_default/`，而是放在存档专属目录，对齐 [01-system-architecture.md](./01-system-architecture.md) §4.2 数据隔离层级与 §7.4 存档隔离要求。存档目录结构详见 [09-database-design.md](./09-database-design.md)。

## 8. 测试目录规划

### 8.1 测试目录组织原则

测试文件**就近放置**在源码目录的 `__tests__/` 子目录下，与既有 [`management/__tests__/`](file:///d:/AI/creative-cafe/src/main/services/game/templates/management/__tests__/) 模式对齐。集成测试统一放在对应源码目录的 `__tests__/integration/` 子目录。

### 8.2 测试目录结构汇总

```
src/main/services/game/templates/werewolf/__tests__/
├── JudgeService.test.ts                    ← 法官调度器单元测试
├── CharacterContextService.test.ts          ← 角色上下文管理器单元测试
├── EvidenceChainService.test.ts             ← 证据链引擎单元测试
├── TestimonyService.test.ts                 ← 证言管理器单元测试
├── VotingService.test.ts                    ← 投票裁判单元测试
├── AiBehaviorService.test.ts                ← AI 行为模拟器单元测试
├── TruthScriptService.test.ts               ← 真相剧本服务单元测试
├── WerewolfNarrativeService.test.ts         ← 叙事服务单元测试
├── WerewolfPromptBuilder.test.ts            ← prompt 构建器单元测试
└── integration/
    ├── NightToMorningFlow.test.ts           ← 夜间→晨间结算集成
    ├── InvestigationFlow.test.ts            ← 现场调查全流程集成
    ├── TrialFlow.test.ts                    ← 庭前推理→审判处刑集成
    └── FullDayCycle.test.ts                 ← 单日完整循环集成

src/main/ipc/handlers/game/werewolf/__tests__/
├── werewolfJudgeHandlers.test.ts
├── werewolfInvestigationHandlers.test.ts
├── werewolfTestimonyHandlers.test.ts
├── werewolfVotingHandlers.test.ts
├── werewolfMapHandlers.test.ts
└── werewolfCharacterHandlers.test.ts

src/renderer/components/Game/templates/werewolf/__tests__/
├── WerewolfGameMain.test.tsx
├── WerewolfGameTemplate.test.tsx
├── werewolfSchema.test.ts
├── werewolfInitialState.test.ts
└── panels/
    ├── CharacterPanel.test.tsx
    ├── MapPanel.test.tsx
    ├── EvidencePanel.test.tsx
    ├── TestimonyPanel.test.tsx
    ├── ReasoningPanel.test.tsx
    ├── VotingPanel.test.tsx
    └── LogPanel.test.tsx

src/shared/types/__tests__/
└── werewolf.types.test.ts

src/shared/constants/__tests__/
└── werewolf.constants.test.ts
```

### 8.3 测试覆盖目标

对齐 [01-system-architecture.md](./01-system-architecture.md) §7.2 测试覆盖要求：

- **核心服务单元测试覆盖率 ≥ 80%**：9 个主进程服务 + 1 个 prompt 构建器 + 6 个 IPC handler + 共享类型 / 常量
- **状态机流程集成测试覆盖所有阶段转移**：`NightToMorningFlow` / `InvestigationFlow` / `TrialFlow` / `FullDayCycle` 四个集成测试覆盖八大阶段的所有合法转移路径
- **暗码一致性测试**：在 `JudgeService.test.ts` 中独立测试暗码在所有阶段输出中的一致性（对齐 [02-judge-system-design.md](./02-judge-system-design.md) §4）
- **数据隔离测试**：在 `CharacterContextService.test.ts` 中独立测试跨角色上下文隔离与跨存档隔离（对齐 [01-system-architecture.md](./01-system-architecture.md) §7.4）

## 9. 文件职责说明总表

下表汇总所有新增文件的路径、职责、主要导出与依赖的既有模块。表格按目录分组排序。

### 9.1 主进程服务（src/main/services/game/templates/werewolf/）

| 文件路径 | 一句话职责 | 主要导出 | 依赖的既有模块 |
| :--- | :--- | :--- | :--- |
| `JudgeService.ts` | 法官调度器，协调其他 8 个子服务的调用顺序 | `JudgeService` 类、`judgeService` 单例 | [`GameNarrativeService`](file:///d:/AI/creative-cafe/src/main/services/game/GameNarrativeService.ts)、[`GameSaveRepository`](file:///d:/AI/creative-cafe/src/main/services/game/GameSaveRepository.ts)、[`AIService`](file:///d:/AI/creative-cafe/src/main/services/AIService.ts) |
| `CharacterContextService.ts` | 16 名 AI 角色独立上下文的读写与注入 | `CharacterContextService` 类、`characterContextService` 单例 | [`GameSaveRepository`](file:///d:/AI/creative-cafe/src/main/services/game/GameSaveRepository.ts)、[`safeWriteFile`](file:///d:/AI/creative-cafe/src/main/services/game/GameSaveRepository.ts) |
| `EvidenceChainService.ts` | 证据的生成、收集、销毁、展示 | `EvidenceChainService` 类、`evidenceChainService` 单例 | [`GameTableRepository`](file:///d:/AI/creative-cafe/src/main/services/game/GameTableRepository.ts) |
| `TestimonyService.ts` | 证言的生成、整理、矛盾点标注 | `TestimonyService` 类、`testimonyService` 单例 | [`GameTableRepository`](file:///d:/AI/creative-cafe/src/main/services/game/GameTableRepository.ts) |
| `VotingService.ts` | 投票、归票、平票处理、处刑执行 | `VotingService` 类、`votingService` 单例 | [`GameTableRepository`](file:///d:/AI/creative-cafe/src/main/services/game/GameTableRepository.ts) |
| `AiBehaviorService.ts` | 基于角色阵营与已知信息生成行为决策 | `AiBehaviorService` 类、`aiBehaviorService` 单例 | [`AIService.streamChatAPI`](file:///d:/AI/creative-cafe/src/main/services/AIService.ts) |
| `TruthScriptService.ts` | 真相剧本生成与读取（仅法官可访问） | `TruthScriptService` 类、`truthScriptService` 单例 | [`GameSaveRepository`](file:///d:/AI/creative-cafe/src/main/services/game/GameSaveRepository.ts)、[`safeWriteFile`](file:///d:/AI/creative-cafe/src/main/services/game/GameSaveRepository.ts) |
| `WerewolfNarrativeService.ts` | 扩展 GameNarrativeService，注入狼人杀专属 prompt | `WerewolfNarrativeService` 类、`werewolfNarrativeService` 单例 | [`GameNarrativeService`](file:///d:/AI/creative-cafe/src/main/services/game/GameNarrativeService.ts)、[`GameTableRepository`](file:///d:/AI/creative-cafe/src/main/services/game/GameTableRepository.ts)、[`GameSaveRepository`](file:///d:/AI/creative-cafe/src/main/services/game/GameSaveRepository.ts)、`WerewolfPromptBuilder` |
| `WerewolfPromptBuilder.ts` | 扩展 GamePromptBuilder，构建狼人杀专属 prompt 片段 | `WerewolfPromptBuilder` 类、`werewolfPromptBuilder` 单例 | [`GamePromptBuilder`](file:///d:/AI/creative-cafe/src/main/services/game/GamePromptBuilder.ts) |

### 9.2 IPC handler（src/main/ipc/handlers/game/werewolf/）

| 文件路径 | 一句话职责 | 主要导出 | 依赖的既有模块 |
| :--- | :--- | :--- | :--- |
| `werewolfJudgeHandlers.ts` | 法官调度命令 IPC | `registerWerewolfJudgeHandlers()` | `wrapHandler`、`JudgeService` |
| `werewolfInvestigationHandlers.ts` | 现场调查 IPC | `registerWerewolfInvestigationHandlers()` | `wrapHandler`、`EvidenceChainService` |
| `werewolfTestimonyHandlers.ts` | 证言收集 IPC | `registerWerewolfTestimonyHandlers()` | `wrapHandler`、`TestimonyService` |
| `werewolfVotingHandlers.ts` | 投票审判 IPC | `registerWerewolfVotingHandlers()` | `wrapHandler`、`VotingService` |
| `werewolfMapHandlers.ts` | 地图与可搜索点位 IPC | `registerWerewolfMapHandlers()` | `wrapHandler`、`AnsiTileMap` |
| `werewolfCharacterHandlers.ts` | 角色档案 CRUD IPC | `registerWerewolfCharacterHandlers()` | `wrapHandler`、`CharacterContextService` |
| `index.ts` | 聚合注册入口 | `registerWerewolfHandlers()` | 上述 6 个 handler |

### 9.3 渲染进程模板（src/renderer/components/Game/templates/werewolf/）

| 文件路径 | 一句话职责 | 主要导出 | 依赖的既有模块 |
| :--- | :--- | :--- | :--- |
| `WerewolfGameMain.tsx` | 懒加载主组件，组合面板区 | `WerewolfGameMain` 默认导出 | [`GameMainPage`](file:///d:/AI/creative-cafe/src/renderer/components/Game/GameMainPage.tsx)、[`NarrativePanel`](file:///d:/AI/creative-cafe/src/renderer/components/Game/panels/NarrativePanel.tsx)、[`GameStateBar`](file:///d:/AI/creative-cafe/src/renderer/components/Game/panels/GameStateBar.tsx)、`panels/*` |
| `WerewolfGameTemplate.ts` | 实现 GameTypeTemplate 接口 | `WerewolfGameTemplate`、`default` | [`GameTypeTemplate`](file:///d:/AI/creative-cafe/src/shared/types/game.types.ts)、`werewolfSchema`、`werewolfInitialState` |
| `werewolfSchema.ts` | 狼人杀表格 schema 定义 | `WEREWOLF_TABLE_SCHEMA`、`WEREWOLF_SHEET_INDICES` | [`GameTableSchema`](file:///d:/AI/creative-cafe/src/shared/types/game.types.ts) |
| `werewolfInitialState.ts` | 模板自定义状态与初始值 | `WerewolfState`、`WEREWOLF_INITIAL_STATE`、`createInitialWerewolfState` | [`GameTableData`](file:///d:/AI/creative-cafe/src/shared/types/game.types.ts)、`werewolfSchema` |
| `panels/CharacterPanel.tsx` | 角色存活列表与状态查看 | `CharacterPanel` | [`gameStore`](file:///d:/AI/creative-cafe/src/renderer/stores/gameStore.ts)、antd |
| `panels/MapPanel.tsx` | 4 层楼瓦片地图 | `MapPanel` | [`AnsiTileMap`](file:///d:/AI/creative-cafe/src/renderer/components/Game/AnsiTileMap.tsx)、`gameUIStore` |
| `panels/EvidencePanel.tsx` | 证据表展示 | `EvidencePanel` | [`gameStore`](file:///d:/AI/creative-cafe/src/renderer/stores/gameStore.ts)、antd |
| `panels/TestimonyPanel.tsx` | 证言表展示与矛盾点标注 | `TestimonyPanel` | [`gameStore`](file:///d:/AI/creative-cafe/src/renderer/stores/gameStore.ts)、antd |
| `panels/ReasoningPanel.tsx` | 庭前推理工作台 | `ReasoningPanel` | [`gameStore`](file:///d:/AI/creative-cafe/src/renderer/stores/gameStore.ts)、antd |
| `panels/VotingPanel.tsx` | 投票面板（典狱长 2 票） | `VotingPanel` | [`gameStore`](file:///d:/AI/creative-cafe/src/renderer/stores/gameStore.ts)、antd |
| `panels/LogPanel.tsx` | 系统播报与阶段日志 | `LogPanel` | [`NarrativePanel`](file:///d:/AI/creative-cafe/src/renderer/components/Game/panels/NarrativePanel.tsx) |

### 9.4 共享类型与常量（src/shared/）

| 文件路径 | 一句话职责 | 主要导出 | 依赖的既有模块 |
| :--- | :--- | :--- | :--- |
| `types/werewolf.types.ts` | 狼人杀全部共享类型（单一真源） | `WerewolfCharacter`、`FactionCode`、`WerewolfPhase`、`TruthScript`、`Evidence`、`Testimony`、`VoteRecord`、`WerewolfState`、`WerewolfRuleConfig`、`CharacterContext` | [`game.types.ts`](file:///d:/AI/creative-cafe/src/shared/types/game.types.ts) |
| `constants/werewolf.constants.ts` | 狼人杀全部共享常量（单一真源） | `WEREWOLF_PHASE_LABELS`、`WEREWOLF_PHASE_TRANSITIONS`、`WEREWOLF_FACTION_CONFIG`、`WEREWOLF_FACTION_CODE_LABELS`、`WEREWOLF_TABLE_SCHEMA`、`WEREWOLF_AI_CONCURRENCY`、`WEREWOLF_VOTE_WEIGHT_PLAYER`、`WEREWOLF_CONTEXT_MAX_TURNS` | [`game.constants.ts`](file:///d:/AI/creative-cafe/src/shared/constants/game.constants.ts)、`werewolf.types.ts` |

### 9.5 默认游戏元数据（data/games/werewolf_default/）

| 文件路径 | 一句话职责 | 主要导出 | 依赖的既有模块 |
| :--- | :--- | :--- | :--- |
| `meta.json` | 游戏元数据 | `id` / `type` / `title` / `description` / `gameplay` / `version` / `status` / `tags` | 无（纯数据） |
| `characters/c01.json` ~ `c16.json` | 16 名默认 AI 角色档案 | `WerewolfCharacter` 结构（无 `factionCode`） | 无（纯数据） |
| `maps/prison.json` | 监狱 4 层楼地图配置 | 房间 / 走廊 / 公共区域 / 可搜索点位 / 监控覆盖 | 无（纯数据） |
| `rules/standard.json` | 标准规则集 | 基础规则 + 默认扩展规则 | 无（纯数据） |

## 10. 命名规范

### 10.1 文件命名

| 类型 | 命名规范 | 示例 |
| :--- | :--- | :--- |
| 主进程服务类文件 | `PascalCase.ts` | `JudgeService.ts`、`WerewolfNarrativeService.ts` |
| IPC handler 文件 | `camelCase.ts`（以 `werewolf` 前缀） | `werewolfJudgeHandlers.ts` |
| 渲染进程组件文件 | `PascalCase.tsx` | `WerewolfGameMain.tsx`、`CharacterPanel.tsx` |
| 渲染进程模板配置文件 | `camelCase.ts` | `werewolfSchema.ts`、`werewolfInitialState.ts` |
| 共享类型 / 常量文件 | `kebab-case.ts`（与既有 `game.types.ts` 对齐） | `werewolf.types.ts`、`werewolf.constants.ts` |
| 数据目录 JSON 文件 | `kebab-case.json` 或简短 id | `meta.json`、`prison.json`、`standard.json`、`c01.json` |
| 测试文件 | `<被测文件名>.test.ts(x)` | `JudgeService.test.ts`、`WerewolfGameMain.test.tsx` |

### 10.2 单例导出规范

参照既有 [`ManagementNarrativeService`](file:///d:/AI/creative-cafe/src/main/services/game/templates/management/ManagementNarrativeService.ts) 与 [`ManagementPromptBuilder`](file:///d:/AI/creative-cafe/src/main/services/game/templates/management/ManagementPromptBuilder.ts) 的模式：

- 每个服务类同时导出**类**与**单例实例**
- 单例实例以 `camelCase` 命名（如 `judgeService`、`werewolfNarrativeService`）
- 单例默认不注入实际依赖，由主进程启动时通过构造函数注入（参照 [`ManagementNarrativeService`](file:///d:/AI/creative-cafe/src/main/services/game/templates/management/ManagementNarrativeService.ts) 文件末尾的注释示例）
- 测试中创建新实例注入 mock 依赖，不使用单例

## 11. 与既有文档的衔接

### 11.1 与 [09-database-design.md](./09-database-design.md) 的衔接

本文档定义的源码目录与数据目录，其内部 JSON 文件的 schema 详见 [09-database-design.md](./09-database-design.md)：

- 存档目录结构（`truth-script.json` / `evidence.json` / `testimony.json` / `faction-codes.json` / `ai-contexts/<characterId>.json`）→ [09-database-design.md](./09-database-design.md)
- `data/games/werewolf_default/` 下的 JSON schema → [09-database-design.md](./09-database-design.md)
- 狼人杀表格 sheet schema（角色表 / 证据表 / 证言表 / 投票表 / 真相表 / 日志表）→ [09-database-design.md](./09-database-design.md)

### 11.2 与 [11-core-module-division.md](./11-core-module-division.md) 的衔接

本文档按文件粒度规划目录，[11-core-module-division.md](./11-core-module-division.md) 按模块粒度划分接口与依赖图：

- 本文档 §3 的 9 个服务文件 → [11-core-module-division.md](./11-core-module-division.md) 的 8 大模块接口
- 本文档 §9 的依赖关系表 → [11-core-module-division.md](./11-core-module-division.md) 的模块依赖图
- 本文档 §8 的测试目录 → [11-core-module-division.md](./11-core-module-division.md) 的测试策略

### 11.3 与 [12-judge-prompt-constraints.md](./12-judge-prompt-constraints.md) 的衔接

本文档 §3.2.9 定义的 `WerewolfPromptBuilder.ts` 的具体 prompt 模板与暗码生成规则详见 [12-judge-prompt-constraints.md](./12-judge-prompt-constraints.md)：

- 阶段 prompt 片段模板 → [12-judge-prompt-constraints.md](./12-judge-prompt-constraints.md)
- 暗码生成规则 → [12-judge-prompt-constraints.md](./12-judge-prompt-constraints.md)
- AI 互检规则 → [12-judge-prompt-constraints.md](./12-judge-prompt-constraints.md)

## 12. 后续文档导航

| 编号 | 文档 | 主要内容 |
| :--- | :--- | :--- |
| 11 | [核心模块划分](./11-core-module-division.md) | 8 大模块接口、依赖图、测试策略 |
| 12 | [法官提示词约束](./12-judge-prompt-constraints.md) | 系统 prompt 模板、暗码生成规则、AI 互检 |
| 13 | [策划阶段总结](./13-design-summary.md) | 交付物清单、风险、下一阶段 spec 拆分 |
| 14 | [README 导航](./README.md) | 阅读顺序、依赖关系图 |

回到导航：[01-system-architecture.md](./01-system-architecture.md) §10。
