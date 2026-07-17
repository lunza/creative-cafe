# 11 - 狼人杀推理游戏核心模块划分

> 本文档是狼人杀推理游戏策划阶段的**核心模块划分文档**，对应 [01-system-architecture.md](./01-system-architecture.md) §9.5 系统组件术语表所定义的 8 大核心模块。本文档将六大子系统的职责进一步拆解为可独立开发、可单独测试的代码模块，定义各模块的输入输出接口、依赖关系、与既有 [`add-game-mode-framework`](../../.trae/specs/add-game-mode-framework/spec.md) 的复用关系、测试策略与并行开发建议。
>
> 所有术语严格遵循 [01-system-architecture.md](./01-system-architecture.md) §9 术语表；规则依据 [逆转裁判+狼人杀规则.txt](../逆转裁判+狼人杀规则.txt)；模块接口遵循既有 [`ManagementNarrativeService`](../../src/main/services/game/templates/management/ManagementNarrativeService.ts) 与 [`ManagementGameTemplate`](../../src/renderer/components/Game/templates/management/ManagementGameTemplate.ts) 的实现风格。

## 1. 设计目标

### 1.1 模块化拆分原则

- **单一职责**：每个模块只承担一项核心职责，对应架构总览 §3 子系统职责矩阵的细分项
- **依赖单向**：模块间依赖严格单向，禁止循环依赖（详见 §3 依赖图）
- **可独立测试**：每个模块的核心方法为纯函数或可 mock 依赖的方法，单元测试覆盖率 ≥ 80%（对齐架构文档 §7.2）
- **复用优先**：能复用 [`add-game-mode-framework`](../../.trae/specs/add-game-mode-framework/spec.md) 既有能力的，不重复造轮子（对齐架构文档 §5 复用清单）
- **类型单一真源**：所有共享 interface 定义在 [`src/shared/types/werewolf.types.ts`](../../src/shared/types/werewolf.types.ts)（对齐架构文档 §7.2）

### 1.2 与六大子系统的映射

| 子系统（架构 §3） | 对应核心模块（本文档 §2） |
| :--- | :--- |
| 01 法官系统 | M1 法官调度器、M4 证据链引擎、M5 证言管理器、M6 投票裁判 |
| 02 角色系统 | M3 角色上下文管理器 |
| 03 地图系统 | （由 04-map-system-design 单独定义，本文档不重复） |
| 04 流程系统 | M2 阶段状态机、M8 UI 模块映射 |
| 05 AI 驱动 | M7 AI 行为模拟器 |
| 06 规则系统 | （由 07-rule-system-design 单独定义，本文档不重复） |

## 2. 八大核心模块清单

### 2.1 模块定位一览表

| 编号 | 模块名 | 类名 | 一句话定位 | 主进程/渲染进程 |
| :---: | :--- | :--- | :--- | :---: |
| M1 | 法官调度器 | `WerewolfJudgeService` | 协调法官 AI 的命令执行、角色模拟、信息记录、判定、打分五大职责的单例入口 | 主进程 |
| M2 | 阶段状态机 | `WerewolfPhaseStateMachine` | 管理 `WerewolfPhase` 枚举的八大阶段转移、进入/退出条件校验 | 渲染进程 |
| M3 | 角色上下文管理器 | `CharacterContextManager` | 维护各 AI 角色独立的 `ai-contexts/<characterId>.json` 上下文与按需注入策略 | 主进程 |
| M4 | 证据链引擎 | `EvidenceChainEngine` | 管理证据的生成、收集、销毁、对角色出示、可见性过滤 | 主进程 |
| M5 | 证言管理器 | `TestimonyManager` | 管理证言生成、整理为证言表、矛盾点标注、按角色可见性过滤 | 主进程 |
| M6 | 投票裁判 | `VotingReferee` | 管理审判投票、归票统计、平票重投、笨蛋触发、处刑执行 | 主进程 |
| M7 | AI 行为模拟器 | `AiBehaviorSimulator` | 基于"阵营 × 技能 × 已知信息 × 当前阶段"四维矩阵生成行为决策与对话 | 主进程 |
| M8 | UI 模块映射 | `WerewolfUIModuleMapper` | 将 `WerewolfPhase` + `PhaseUIType` 映射到具体的 antd 组件树与布局 | 渲染进程 |

### 2.2 模块文件布局

参照 [`ManagementNarrativeService.ts`](../../src/main/services/game/templates/management/ManagementNarrativeService.ts) 的目录组织模式，狼人杀模块统一放置于：

```
src/main/services/game/werewolf/         # 主进程模块（M1/M3/M4/M5/M6/M7）
├── WerewolfJudgeService.ts               # M1
├── WerewolfPhaseStateMachine.ts          # M2（同时镜像到渲染进程 store）
├── CharacterContextManager.ts            # M3
├── EvidenceChainEngine.ts                # M4
├── TestimonyManager.ts                   # M5
├── VotingReferee.ts                      # M6
├── AiBehaviorSimulator.ts                # M7
└── WerewolfPromptBuilder.ts              # 法官 prompt 片段（被 M1/M7 共用）

src/renderer/components/Game/templates/werewolf/  # 渲染进程模块（M8）
├── WerewolfGameTemplate.ts               # 实现 GameTypeTemplate 接口
├── WerewolfUIModuleMapper.ts             # M8
└── WerewolfGameMain.tsx                  # 懒加载入口
```

## 3. 模块间依赖图

### 3.1 ASCII 依赖图

```
                    ┌─────────────────────────────────────────┐
                    │   既有 add-game-mode-framework 基础设施    │
                    │  GameNarrativeService / AIService         │
                    │  GameTableRepository / GameSaveRepository │
                    │  AnsiTileMap / gameStore / gameUIStore    │
                    └──────────────┬──────────────────────────┘
                                   │ 复用
                                   ▼
        ┌──────────────────────────────────────────────────┐
        │              M1 法官调度器 WerewolfJudgeService      │
        │  （单例，主进程，所有法官专属逻辑的统一出口）          │
        └──┬──────────┬──────────┬──────────┬──────────┬────┘
           │          │          │          │          │
           ▼          ▼          ▼          ▼          ▼
       ┌──────┐  ┌────────┐  ┌────────┐  ┌────────┐  ┌────────┐
       │ M3   │  │ M4     │  │ M5     │  │ M6     │  │ M7     │
       │ 角色 │  │ 证据链 │  │ 证言   │  │ 投票   │  │ AI 行为│
       │ 上下 │  │ 引擎   │  │ 管理器 │  │ 裁判   │  │ 模拟器 │
       │ 文   │  │        │  │        │  │        │  │        │
       └──┬───┘  └────┬───┘  └────┬───┘  └────┬───┘  └────┬───┘
          │           │           │           │           │
          └─────┬─────┴─────┬─────┘           │           │
                │           │                 │           │
                ▼           ▼                 │           │
            ┌──────────────────┐              │           │
            │  M2 阶段状态机   │◀─────────────┘           │
            │  PhaseStateMachine│                         │
            └────────┬─────────┘                         │
                     │                                   │
                     ▼                                   │
            ┌──────────────────┐                         │
            │  M8 UI 模块映射  │◀────────────────────────┘
            │  UIModuleMapper  │
            └──────────────────┘
```

### 3.2 依赖关系明细

| 模块 | 直接依赖 | 反向依赖（被依赖） | 说明 |
| :--- | :--- | :--- | :--- |
| M1 法官调度器 | M3/M4/M5/M6/M7、GameNarrativeService、AIService | 无 | 单例入口，协调所有法官专属子模块 |
| M2 阶段状态机 | M1（仅读取当前阶段任务） | M8、gameStore | 状态机集中在前端 store，主进程仅持久化 |
| M3 角色上下文管理器 | GameSaveRepository | M1、M7 | 持久化 `ai-contexts/*.json`，按需注入 |
| M4 证据链引擎 | GameTableRepository | M1、M5、M7 | 持久化 `evidence.json` |
| M5 证言管理器 | M4、GameTableRepository | M1、M7 | 持久化 `testimony.json` |
| M6 投票裁判 | M1（读取真相剧本与暗码） | M1 | 持久化 `vote-records/<dayIndex>.json` |
| M7 AI 行为模拟器 | M3、M4、M5、AIService | M1 | 多 AI 并发由 `AiCallQueue` 包装（对齐 06-ai-driving §11） |
| M8 UI 模块映射 | M2、gameUIStore、AnsiTileMap | 无 | 渲染层映射，不调用主进程服务 |

### 3.3 反循环依赖约束

- M7 → M3/M4/M5 为单向读取，禁止 M3/M4/M5 反向调用 M7（M7 的调用入口只能由 M1 触发）
- M2 不依赖任何业务模块，仅依赖 M1 暴露的 `getCurrentPhaseTask()` 纯查询方法
- M8 不依赖任何主进程服务，仅消费 gameStore 与 gameUIStore 的状态切片

## 4. 模块输入输出接口定义

> 以下 TypeScript interface 草案均应统一存放于 [`src/shared/types/werewolf.types.ts`](../../src/shared/types/werewolf.types.ts)（对齐架构文档 §7.2 类型单一真源）。本节仅给出核心签名，完整字段以 02~07 子系统文档为准。

### 4.1 M1 法官调度器（WerewolfJudgeService）

```typescript
/** 法官调度器输入：阶段切换请求 */
interface JudgeDispatchInput {
  saveId: string;
  dayIndex: number;
  phase: WerewolfPhase;
  /** 玩家通过电子面罩下达的隐秘指令（如身份鉴定目标） */
  playerSecretCommand?: {
    type: 'identify' | 'phase-transition' | 'execution-method';
    payload: string;
  };
}

/** 法官调度器输出：阶段执行结果 */
interface JudgeDispatchOutput {
  saveId: string;
  phase: WerewolfPhase;
  /** 系统播报文本（含暗码 HTML 注释） */
  broadcastText: string;
  /** 触发的地图状态变更事件 */
  mapStateChanges: MapStateChangeEvent[];
  /** 触发的胜负判定结果 */
  winResult: WinResult | null;
  /** 监管扫描结果（对齐 02-judge §6） */
  supervisionScan: DarkCodeIntegrityScanResult & KeywordScanResult;
}

class WerewolfJudgeService {
  /** 单例入口：执行阶段调度 */
  async dispatch(input: JudgeDispatchInput, abortSignal?: AbortSignal): Promise<JudgeDispatchOutput>;
  /** 生成夜间真相剧本（对齐 02-judge §5，不经过 GameNarrativeService） */
  async generateTruthScript(saveId: string, dayIndex: number, abortSignal?: AbortSignal): Promise<TruthScript>;
  /** 庭前推理打分（对齐 02-judge §7.1，仅返回优良中差） */
  scoreReasoning(input: ReasoningScoreInput): ReasoningGrade;
  /** 整局打分（对齐 02-judge §7.2） */
  scoreGame(input: GameScoreInput): GameScoreResult;
  /** 监管扫描入口（由 GameNarrativeService 在钩子 2 调用，对齐 02-judge §8.2.2） */
  scanNarrativeOutput(saveId: string, text: string): DarkCodeIntegrityScanResult & KeywordScanResult;
  /** 查询当前阶段任务（供 M2 状态机读取，纯查询无副作用） */
  getCurrentPhaseTask(saveId: string, phase: WerewolfPhase): PhaseTask;
}
export const werewolfJudgeService = new WerewolfJudgeService();
```

### 4.2 M2 阶段状态机（WerewolfPhaseStateMachine）

```typescript
/** 状态机输入：阶段转移请求 */
interface PhaseTransitionInput {
  saveId: string;
  currentPhase: WerewolfPhase;
  targetPhase: WerewolfPhase;
  /** 转移条件上下文（如平安夜判定结果、笨蛋触发标志） */
  context: {
    isPeacefulNight: boolean;
    foolTriggered: boolean;
    isTie: boolean;
    ruleSet: WerewolfRuleSet;
  };
}

/** 状态机输出：转移结果 */
interface PhaseTransitionOutput {
  accepted: boolean;
  /** 拒绝原因（accepted=false 时填写） */
  rejectReason?: 'invalid-transition' | 'entry-condition-not-met' | 'forced-phase-skipped';
  /** 进入新阶段后的 UI 操作类型 */
  uiType: PhaseUIType;
  /** 阶段过渡动画提示 */
  transitionHint: string;
}

class WerewolfPhaseStateMachine {
  /** 校验转移合法性（纯函数，对齐 05-game-flow §2.2 phaseTransitions） */
  validateTransition(input: PhaseTransitionInput): PhaseTransitionOutput;
  /** 获取当前阶段可进入的下一阶段列表 */
  getValidTransitions(currentPhase: WerewolfPhase, context: PhaseTransitionInput['context']): WerewolfPhase[];
  /** 执行阶段转移（写入 phaseHistory，触发 gameStore 更新） */
  async transition(input: PhaseTransitionInput): Promise<PhaseTransitionOutput>;
  /** 获取当前阶段对应的 UI 操作类型（对齐 05-game-flow §4.1） */
  getUIType(phase: WerewolfPhase): PhaseUIType;
}
```

### 4.3 M3 角色上下文管理器（CharacterContextManager）

```typescript
/** 上下文加载输入 */
interface LoadContextInput {
  saveId: string;
  characterId: string;
  /** 是否按需注入（对齐 06-ai-driving §2.2 按需注入原则） */
  injectionFilter?: {
    includePublicKnowledge: boolean;
    includeAcquiredKnowledge: boolean;
    includeRecentDialogueRounds: number;  // 0-20
  };
}

/** 上下文加载输出 */
interface LoadContextOutput {
  aiContext: AiContext;
  /** 注入到 prompt 的可见信息子集（已按隔离矩阵过滤） */
  visiblePromptSlice: string;
  /** 隔离违规检测结果 */
  isolationCheck: { passed: boolean; violations: string[] };
}

class CharacterContextManager {
  /** 加载角色上下文并按需过滤 */
  load(input: LoadContextInput): LoadContextOutput;
  /** 持久化角色上下文（对齐 06-ai-driving §11.5 自动存档时机） */
  async save(saveId: string, characterId: string, aiContext: AiContext): Promise<void>;
  /** 追加已获取信息（被预言家查验/被出示证物/被质询答复等） */
  appendAcquiredKnowledge(saveId: string, characterId: string, item: AcquiredKnowledgeItem): Promise<void>;
  /** 追加近期对话（滚动淘汰超出 20 轮的旧记录） */
  appendDialogueTurn(saveId: string, characterId: string, turn: DialogueTurn): Promise<void>;
  /** 下发当前阶段任务（由 M1 在阶段切换时调用） */
  setPhaseTask(saveId: string, characterId: string, task: PhaseTask): Promise<void>;
}
```

### 4.4 M4 证据链引擎（EvidenceChainEngine）

```typescript
/** 证据查询输入 */
interface EvidenceQueryInput {
  saveId: string;
  dayIndex: number;
  /** 查询视角：玩家视角返回全量；AI 视角仅返回已出示给该角色的 */
  viewer: { kind: 'player' } | { kind: 'ai'; characterId: string };
  /** 过滤条件 */
  filter?: { type?: Evidence['type']; areaId?: string };
}

/** 证据查询输出 */
interface EvidenceQueryOutput {
  evidences: Evidence[];
  /** 玩家可见的犯罪现场表（对齐规则 §B） */
  crimeSceneTable?: CrimeSceneTable;
}

/** 证据收集输入（玩家点击可搜索点位） */
interface CollectEvidenceInput {
  saveId: string;
  dayIndex: number;
  pointId: string;
  searcherId: string;  // 玩家（典狱长）ID
}

class EvidenceChainEngine {
  /** 查询证据（按视角过滤） */
  query(input: EvidenceQueryInput): EvidenceQueryOutput;
  /** 收集证据（玩家点击按钮后调用，写入 evidence.json） */
  async collect(input: CollectEvidenceInput): Promise<{ foundEvidenceIds: string[]; description: string }>;
  /** 向某 AI 角色出示证物（更新该角色的可见证物集） */
  async presentTo(saveId: string, evidenceId: string, targetCharacterId: string): Promise<void>;
  /** 生成可搜索点位清单（含干扰点位，对齐 05-game-flow §7.2） */
  async buildSearchablePoints(saveId: string, dayIndex: number, roomId: string): Promise<SearchablePoint[]>;
  /** 销毁证据（由法官在真相剧本中记录，对齐 02-judge §5.2） */
  recordDestruction(saveId: string, dayIndex: number, destruction: TruthScript['incidents'][0]['evidenceDestruction']): void;
}
```

### 4.5 M5 证言管理器（TestimonyManager）

```typescript
/** 证言查询输入 */
interface TestimonyQueryInput {
  saveId: string;
  dayIndex: number;
  /** 查询视角：玩家视角返回全量；AI 视角仅返回自身参与的 */
  viewer: { kind: 'player' } | { kind: 'ai'; characterId: string };
}

/** 证言查询输出 */
interface TestimonyQueryOutput {
  testimonies: TestimonyEntry[];
  /** 证言表 Markdown（对齐规则 §C，含暗码 HTML 注释） */
  testimonyTableMarkdown: string;
  /** 自动标注的矛盾点列表 */
  contradictions: Array<{ entryA: number; entryB: number; reason: string }>;
}

/** 证言生成输入（玩家质询 AI 角色） */
interface GenerateTestimonyInput {
  saveId: string;
  dayIndex: number;
  targetCharacterId: string;
  /** 玩家的质询动作 */
  action: { type: '质询' | '出示证物' | '威慑'; payload: string; evidenceId?: string };
}

class TestimonyManager {
  /** 查询证言（按视角过滤） */
  query(input: TestimonyQueryInput): TestimonyQueryOutput;
  /** 生成证言（委托 M7 AiBehaviorSimulator 生成 AI 回复，整理为证言条目） */
  async generate(input: GenerateTestimonyInput, abortSignal?: AbortSignal): Promise<TestimonyEntry>;
  /** 整理为证言表（法官在单角色质询完成后调用） */
  organizeTable(saveId: string, dayIndex: number): Promise<string>;
  /** 自动标注矛盾点（对比不在场证明、指控、情绪压力） */
  detectContradictions(testimonies: TestimonyEntry[]): Array<{ entryA: number; entryB: number; reason: string }>;
}
```

### 4.6 M6 投票裁判（VotingReferee）

```typescript
/** 投票输入 */
interface CastVoteInput {
  saveId: string;
  dayIndex: number;
  /** 投票者 ID（玩家为典狱长 ID，AI 为角色 ID） */
  voterId: string;
  /** 投票目标角色 ID 或弃票 */
  target: string | '弃票';
  /** 票数（典狱长 2 票，AI 各 1 票） */
  weight: number;
}

/** 归票输出 */
interface TallyVotesOutput {
  /** 角色 ID → 得票数 */
  tally: Record<string, number>;
  /** 得票最高者（平票时为数组） */
  topVotedIds: string[];
  /** 是否平票 */
  isTie: boolean;
  /** 笨蛋是否触发（得票过半且首次触发） */
  foolTriggered: boolean;
  /** 处刑目标（无平票且未触发笨蛋时确定） */
  executionTargetId: string | null;
}

class VotingReferee {
  /** 收集投票（玩家 2 票 + 各 AI 1 票，同时记名投票） */
  async collectVotes(saveId: string, dayIndex: number, abortSignal?: AbortSignal): Promise<CastVoteInput[]>;
  /** 归票统计（对齐 05-game-flow §10.3） */
  tally(votes: CastVoteInput[]): TallyVotesOutput;
  /** 执行处刑（玩家决定方式 + 遗言生成） */
  async executeExecution(saveId: string, targetId: string, method: string, abortSignal?: AbortSignal): Promise<{ lastWords: string }>;
  /** 触发临时休庭（笨蛋首次得票过半，对齐 05-game-flow §10.5） */
  async triggerRecess(saveId: string, foolId: string): Promise<void>;
  /** 平票重投流程（对齐 05-game-flow §10.4） */
  async revote(saveId: string, dayIndex: number, tiedIds: string[], abortSignal?: AbortSignal): Promise<TallyVotesOutput>;
}
```

### 4.7 M7 AI 行为模拟器（AiBehaviorSimulator）

```typescript
/** 行为模拟输入 */
interface SimulateBehaviorInput {
  saveId: string;
  characterId: string;
  phase: WerewolfPhase;
  /** 玩家最近一次动作（如有） */
  playerAction?: { type: '质询' | '出示证物' | '威慑'; payload: string };
  /** 流式回调（按 characterId 路由到 UI 渲染通道） */
  onChunk: (chunk: string) => void;
}

/** 行为模拟输出 */
interface SimulateBehaviorOutput {
  characterId: string;
  /** 决策类型与内容（对齐 06-ai-driving §3.1 BehaviorDecision） */
  decision: BehaviorDecision;
  /** 完整回复文本（含暗码 HTML 注释，已经监管扫描补正） */
  fullText: string;
  /** 隔离违规检测结果 */
  isolationCheck: { passed: boolean; violations: string[] };
}

class AiBehaviorSimulator {
  /** 模拟单个 AI 角色行为（委托 WerewolfAiCaller + AiCallQueue） */
  async simulate(input: SimulateBehaviorInput, abortSignal?: AbortSignal): Promise<SimulateBehaviorOutput>;
  /** 批量模拟（审判辩护环节，有界并发上限 3，对齐 06-ai-driving §11） */
  async simulateBatch(inputs: SimulateBehaviorInput[], abortSignal?: AbortSignal): Promise<SimulateBehaviorOutput[]>;
  /** 选择伪装者策略（对跳/金水银水/查杀反制/悍跳反水/深水狼倒钩狼/退水） */
  selectImpostorStrategy(ctx: BehaviorContext): ImpostorStrategy;
  /** 神民技能决策（药剂师/保安/笨蛋/黑客） */
  resolveDivineRoleBehavior(ctx: BehaviorContext): PharmacistDecision | SecurityDecision | FoolDecision | HackerDecision;
}
```

### 4.8 M8 UI 模块映射（WerewolfUIModuleMapper）

```typescript
/** UI 映射输入 */
interface UIMappingInput {
  phase: WerewolfPhase;
  uiType: PhaseUIType;
  /** 当前阶段所需的上下文数据 */
  context: {
    dayIndex: number;
    saveId: string;
    /** 现场调查阶段：可搜索点位清单 */
    searchablePoints?: SearchablePoint[];
    /** 证言收集阶段：当前质询角色 ID */
    currentDialogueCharacterId?: string;
    /** 庭前推理阶段：证物表 + 证言表 */
    evidenceTable?: Evidence[];
    testimonyTable?: TestimonyEntry[];
    /** 审判处刑阶段：投票面板所需数据 */
    aliveCharacterIds?: string[];
  };
}

/** UI 映射输出 */
interface UIMappingOutput {
  /** 主面板组件类型（对应 GameMainPage 右侧模板面板区） */
  mainPanel: 'narrative' | 'button-list' | 'reasoning-bench' | 'voting-panel' | 'map-explore' | 'settlement';
  /** 顶部状态栏扩展字段 */
  stateBarExtras: { dayIndex: number; phase: WerewolfPhase; phaseLabel: string };
  /** 阶段过渡动画 key（复用 PageTransition） */
  transitionKey: string;
  /** 当前阶段可用的玩家操作按钮清单 */
  actionButtons: Array<{ key: string; label: string; disabled: boolean }>;
}

class WerewolfUIModuleMapper {
  /** 根据 phase + uiType 映射到 UI 输出 */
  map(input: UIMappingInput): UIMappingOutput;
  /** 注册自定义阶段 UI（扩展规则启用时插入新阶段，对齐 07-rule §3.6 警上警下） */
  registerPhaseUI(phase: WerewolfPhase, mapping: (input: UIMappingInput) => UIMappingOutput): void;
}
```

## 5. 模块与既有框架的复用关系

### 5.1 复用矩阵

| 模块 | 复用的既有类/接口/组件 | 复用方式 | 说明 |
| :--- | :--- | :--- | :--- |
| M1 法官调度器 | [`GameNarrativeService`](../../src/main/services/game/GameNarrativeService.ts) | 钩子接入 | 复用流式回调与 tableEdit 解析；通过钩子 1（templateSystemPrompt）与钩子 2（监管扫描）接入，对齐 02-judge §8.2 |
| M1 | [`AIService.streamChatAPI`](../../src/main/services/AIService.ts) | 直接调用 | 非叙事场景（真相剧本生成、打分）直接调用，不经过 GameNarrativeService |
| M1 | [`GamePromptBuilder`](../../src/main/services/game/GamePromptBuilder.ts) | 扩展 | 新增 `WerewolfPromptBuilder` 作为 `templateSystemPrompt` 注入 |
| M2 阶段状态机 | [`gameStore`](../../src/renderer/stores/gameStore.ts) | 扩展 | 新增 `werewolfGameState` 切片，对齐 05-game-flow §14.1 |
| M2 | [`gameUIStore`](../../src/renderer/stores/gameUIStore.ts) | 扩展 | 新增 `currentUIType`、`phaseHistory` 字段 |
| M2 | [`PageTransition`](../../src/renderer/components/Layout/PageTransition.tsx) | 复用 | 阶段切换淡入淡出动画 |
| M3 角色上下文管理器 | [`GameSaveRepository`](../../src/main/services/game/GameSaveRepository.ts) | 扩展 | `GameSaveData.stateSnapshot` 新增 `werewolf.aiContexts` 字段；复用 `safeWriteFile` 原子写入 |
| M4 证据链引擎 | [`GameTableRepository`](../../src/main/services/game/GameTableRepository.ts) | 复用 | 复用 `applyTableEdits` 协议持久化 `evidence.json` |
| M4 | [`AnsiTileMap`](../../src/renderer/components/Game/AnsiTileMap.tsx) | 复用 | 可搜索点位高亮渲染（`!` 瓦片标记） |
| M5 证言管理器 | [`GameTableRepository`](../../src/main/services/game/GameTableRepository.ts) | 复用 | 持久化 `testimony.json`，复用 `applyTableEdits` |
| M5 | [`react-markdown` + `rehype-raw`](../../src/renderer/components/Game/panels/NarrativePanel.tsx) | 复用 | 渲染含 HTML 注释暗码的证言表 |
| M6 投票裁判 | [`GameTableRepository`](../../src/main/services/game/GameTableRepository.ts) | 复用 | 持久化 `vote-records/<dayIndex>.json` |
| M7 AI 行为模拟器 | [`AIService.streamChatAPI`](../../src/main/services/AIService.ts) | 直接调用 | 通过 `AiCallQueue` 包装有界并发（上限 3） |
| M7 | [`GameNarrativeService`](../../src/main/services/game/GameNarrativeService.ts) | 复用 | 多 AI 对话场景复用流式回调路由 |
| M8 UI 模块映射 | [`GameTypeTemplate`](../../src/shared/types/game.types.ts) | 实现 | `WerewolfGameTemplate` 实现该接口，对齐 [`ManagementGameTemplate`](../../src/renderer/components/Game/templates/management/ManagementGameTemplate.ts) |
| M8 | [`GameTemplateRegistry`](../../src/renderer/components/Game/templates/GameTemplateRegistry.ts) | 注册 | 初始化时注册狼人杀模板 |
| M8 | [`GameMainPage`](../../src/renderer/components/Game/GameMainPage.tsx) | 复用 | 顶部状态栏 + 左侧叙事面板 + 右侧模板面板区布局 |
| M8 | [`NarrativePanel`](../../src/renderer/components/Game/panels/NarrativePanel.tsx) | 复用 | 流式叙事显示与玩家输入 |
| M8 | [`GameStateBar`](../../src/renderer/components/Game/panels/GameStateBar.tsx) | 复用 | 顶部状态栏，扩展显示天数/阶段 |
| M8 | [`AnsiTileMap`](../../src/renderer/components/Game/AnsiTileMap.tsx) | 复用 | 4 层楼瓦片地图渲染，新增狼人杀瓦片样式映射 |
| M8 | antd 组件库 | 复用 | Card/List/Button/Modal/Table/Form/Collapse |

### 5.2 复用约束

1. **不修改既有签名**：所有复用均通过扩展字段或钩子接入，不修改 [`GameNarrativeService`](../../src/main/services/game/GameNarrativeService.ts) 既有方法签名（对齐 02-judge §8.3）。
2. **不引入新 IPC 通道**：狼人杀专属逻辑通过既有 `GameNarrativeRequest` 扩展字段触发，复用既有 IPC 事件（对齐 02-judge §8.3）。
3. **目录隔离**：狼人杀角色库与既有 SillyTavern 角色库目录隔离（对齐 03-character §9.3）。

## 6. 模块测试策略

### 6.1 测试分层

| 测试层级 | 范围 | 工具 | 覆盖目标 |
| :--- | :--- | :--- | :--- |
| **单元测试** | 各模块的纯函数与可 mock 方法 | Vitest + tsd | 覆盖率 ≥ 80%（对齐架构文档 §7.2） |
| **集成测试** | 跨模块的状态机流程与数据流 | Vitest + supertest | 覆盖所有阶段转移与数据隔离矩阵 |
| **e2e 测试** | 完整游戏循环（初始化 → 终止态） | Playwright | 覆盖至少 1 局完整对局 |

### 6.2 单元测试清单

| 模块 | 测试重点 | Mock 依赖 |
| :--- | :--- | :--- |
| M1 法官调度器 | `scoreReasoning`/`scoreGame` 纯函数；`scanNarrativeOutput` 暗码补正逻辑 | AIService、GameNarrativeService |
| M2 阶段状态机 | `validateTransition` 全部合法/非法转移；`getValidTransitions` 上下文分支 | 无（纯函数） |
| M3 角色上下文管理器 | 按需注入过滤；隔离违规检测；对话滚动淘汰 | GameSaveRepository |
| M4 证据链引擎 | 视角过滤（玩家 vs AI）；收集/销毁/出示状态转移 | GameTableRepository |
| M5 证言管理器 | 矛盾点自动标注；证言表 Markdown 渲染含暗码 | GameTableRepository、M7 |
| M6 投票裁判 | 归票统计；平票判定；笨蛋触发一次性约束 | AIService（AI 投票 mock） |
| M7 AI 行为模拟器 | 伪装者六种策略选择决策树；神民四种技能决策 | AIService、M3、M4、M5 |
| M8 UI 模块映射 | phase → mainPanel 映射；扩展阶段注册 | 无（纯函数） |

### 6.3 集成测试场景

| 场景 | 涉及模块 | 验证点 |
| :--- | :--- | :--- |
| 单日完整流程 | M1→M2→M4→M5→M6→M7 | 夜间→晨间→现场调查→证言→推理→审判→日间 的状态转移与数据传递 |
| 平安夜分支 | M1、M2、M6 | 平安夜跳过现场调查直接审判（对齐 05-game-flow §6.4） |
| 笨蛋触发临时休庭 | M2、M6 | 笨蛋首次得票过半触发 RECESS 子阶段，第二次过半正常处刑 |
| 平票重投 | M2、M6 | 平票→最后辩护→再投票→二次平票跳过处刑 |
| 暗码全局一致性 | M1、M7、M4、M5 | 多 AI 对话互检；自动补正缺失/错误暗码（对齐 06-ai-driving §7） |
| 数据隔离矩阵 | M3、M4、M5 | 真相剧本不注入 AI；证据按出示过滤；证言按参与过滤（对齐 06-ai-driving §8） |
| 胜负判定 | M1、M2、M6 | 屠边局/屠城局/混血儿阵营的胜负触发条件 |

### 6.4 e2e 测试场景

| 场景 | 验证点 |
| :--- | :--- |
| 标准屠边局完整对局 | 从新建存档到胜利/失败结算，全流程无卡死 |
| 自定义角色 + 自定义地图 | 16 人自定义角色 + 自定义地图加载并开局 |
| 存档断点续传 | 在各阶段切换点存档退出，重新加载后状态一致 |
| 多 AI 并发性能 | 审判辩护环节 16 角色分批 3 个一组，总时长 < 5 分钟（对齐架构文档 §7.1） |

## 7. 开发优先级与并行度分析

### 7.1 依赖关系驱动的开发层级

```
层级 0（基础层，无依赖，可立即并行启动）
├── M2 阶段状态机           ← 仅依赖 WerewolfPhase 枚举与 phaseTransitions 表
└── M8 UI 模块映射（骨架）  ← 仅依赖 phaseUITypeMap 静态映射表

层级 1（核心服务层，依赖层级 0）
├── M3 角色上下文管理器     ← 依赖 GameSaveRepository（既有）
├── M4 证据链引擎           ← 依赖 GameTableRepository（既有）
├── M5 证言管理器           ← 依赖 M4
└── M6 投票裁判             ← 依赖 M1 的暗码查询接口（可先用 mock）

层级 2（AI 行为层，依赖层级 1）
└── M7 AI 行为模拟器        ← 依赖 M3/M4/M5、AIService（既有）

层级 3（调度入口层，依赖层级 1+2）
└── M1 法官调度器           ← 依赖 M3/M4/M5/M6/M7、GameNarrativeService（既有）

层级 4（UI 完整层，依赖层级 3）
└── M8 UI 模块映射（完整）  ← 依赖 M1~M7 全部接口与 gameStore
```

### 7.2 并行开发建议

| 阶段 | 并行任务 | 串行依赖 | 预计工期 |
| :--- | :--- | :--- | :--- |
| **Sprint 1** | M2 状态机 + M8 UI 骨架 + M3 上下文管理器 + M4 证据链引擎 | 无 | 2 周 |
| **Sprint 2** | M5 证言管理器（依赖 M4） + M6 投票裁判（mock M1） | M4 完成 | 2 周 |
| **Sprint 3** | M7 AI 行为模拟器（依赖 M3/M4/M5） | M3/M4/M5 完成 | 2 周 |
| **Sprint 4** | M1 法官调度器（依赖 M3~M7） | M3~M7 完成 | 2 周 |
| **Sprint 5** | M8 UI 完整映射 + 集成测试 + e2e 测试 | M1 完成 | 2 周 |

### 7.3 关键路径与瓶颈

- **关键路径**：M2 → M4 → M5 → M7 → M1 → M8（完整），共 5 个 Sprint
- **瓶颈点**：M1 法官调度器需协调所有子模块，集成阶段风险最高；建议在 Sprint 2~3 同步编写 M1 的接口 stub 与 mock 实现，提前暴露集成问题
- **风险缓解**：M7 AI 行为模拟器的伪装者策略决策树复杂度高，建议在 Sprint 3 拆分为"决策树骨架 + 六种策略逐个实现"两个子任务并行

### 7.4 模块开发完成定义（DoD）

每个模块需满足以下条件方可视为开发完成：

1. TypeScript interface 已定义于 [`src/shared/types/werewolf.types.ts`](../../src/shared/types/werewolf.types.ts)
2. 单元测试覆盖率 ≥ 80%，所有边界条件覆盖
3. 与既有框架的复用关系符合 §5.1 复用矩阵
4. 不引入循环依赖（通过 §3 依赖图校验）
5. 暗码全局一致性保证（M1/M4/M5/M7 涉及姓名输出的模块必须经过 `DarkCodeValidator` 扫描）

## 8. 跨文档引用

| 引用对象 | 路径 | 用途 |
| :--- | :--- | :--- |
| 系统架构总览 | [./01-system-architecture.md](./01-system-architecture.md) | 术语表、子系统职责矩阵、复用清单 |
| 法官系统设计 | [./02-judge-system-design.md](./02-judge-system-design.md) | M1 法官调度器、M4 证据链、M5 证言、M6 投票的职责细则 |
| 角色系统设计 | [./03-character-system-design.md](./03-character-system-design.md) | M3 角色上下文的档案结构、阵营分配 |
| 地图系统设计 | [./04-map-system-design.md](./04-map-system-design.md) | M8 UI 地图瓦片映射、可搜索点位 |
| 游戏流程设计 | [./05-game-flow-design.md](./05-game-flow-design.md) | M2 阶段状态机、M8 UI 操作类型映射 |
| AI 驱动机制 | [./06-ai-driving-mechanism.md](./06-ai-driving-mechanism.md) | M7 AI 行为模拟器、M3 上下文隔离 |
| 规则系统设计 | [./07-rule-system-design.md](./07-rule-system-design.md) | M2 状态机的规则开关读取、M6 胜负判定 |
| UI/UX 设计 | [./08-ui-ux-design.md](./08-ui-ux-design.md) | M8 UI 组件线框图 |
| 数据库设计 | [./09-database-design.md](./09-database-design.md) | 各模块持久化 JSON Schema |
| 文件目录结构 | [./10-file-directory-structure.md](./10-file-directory-structure.md) | 模块文件布局 |
| 法官提示词约束 | [./12-judge-prompt-constraints.md](./12-judge-prompt-constraints.md) | M1 法官 prompt 片段 |
| 策划阶段总结 | [./13-design-summary.md](./13-design-summary.md) | 交付物清单与下一阶段 spec 拆分 |
| 既有模块样本 | [../../src/main/services/game/templates/management/ManagementNarrativeService.ts](../../src/main/services/game/templates/management/ManagementNarrativeService.ts) | 包装层与依赖注入模式参考 |
| 既有模板样本 | [../../src/renderer/components/Game/templates/management/ManagementGameTemplate.ts](../../src/renderer/components/Game/templates/management/ManagementGameTemplate.ts) | GameTypeTemplate 实现参考 |
