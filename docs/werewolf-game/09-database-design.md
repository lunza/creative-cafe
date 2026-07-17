# 09 - 数据库结构设计

> 本文档是狼人杀推理游戏策划阶段的数据持久化设计文档，对应 [01-system-architecture.md](./01-system-architecture.md) §3 中的横切数据层。定义存档目录结构、8 个 JSON 文件 Schema、与既有 [`GameSaveRepository`](../../src/main/services/game/GameSaveRepository.ts) / [`GameTableRepository`](../../src/main/services/game/GameTableRepository.ts) 的集成方案、数据版本迁移与自动存档轮转策略。
>
> 严格遵循 [01-system-architecture.md](./01-system-architecture.md) §9 术语表与 §4.2 数据隔离层级表；Schema 与以下子系统的 TypeScript interface 保持一致：
> - [02-judge-system-design.md](./02-judge-system-design.md) §5.2 `TruthScript` / `Incident` / `Evidence` / `Witness`
> - [03-character-system-design.md](./03-character-system-design.md) §2.1 `WerewolfCharacter` / `FactionCode` / `FactionAssignment`
> - [06-ai-driving-mechanism.md](./06-ai-driving-mechanism.md) §2.1 `AiContext` / `PublicKnowledge` / `AcquiredKnowledgeItem`

## 1. 设计目标与原则

### 1.1 设计目标

- **存档隔离**：不同存档的数据严格隔离，禁止跨存档读取（对齐架构总览 §7.4）
- **层级隔离**：真相剧本层、证据链层、证言层、暗码层、AI 上下文层分别持久化，按 [01-system-architecture.md](./01-system-architecture.md) §4.2 控制可见性
- **既有复用**：复用 [`GameSaveRepository`](../../src/main/services/game/GameSaveRepository.ts) 的 `safeWriteFile` 原子写入与自动存档轮转；复用 [`GameTableRepository`](../../src/main/services/game/GameTableRepository.ts) 的 `applyTableEdits` 协议
- **断点续传**：每阶段切换时自动存档，支持任意阶段退出后恢复
- **版本演进**：通过 `schemaVersion` 字段支持数据结构升级与迁移

### 1.2 设计原则

| 原则 | 说明 |
| :--- | :--- |
| **JSON 文件原子写入** | 所有持久化均走 `safeWriteFile`（先 `.tmp` 再 rename），避免半写入状态 |
| **单一真源** | 所有共享类型定义于 [`src/shared/types/werewolf.types.ts`](../../src/shared/types/werewolf.types.ts)（对齐架构总览 §7.2） |
| **路径单一真源** | 路径 helper 复用 `GameSaveRepository` 的 `getSaveDir` 等函数，不重复实现 |
| **字段语义对齐** | `TruthScript` / `WerewolfCharacter` / `AiContext` 字段名与既有子系统文档完全一致 |
| **避免冗余写入** | 阶段内增量更新只写变化文件，阶段切换时全量快照 |

## 2. 存档目录结构

### 2.1 目录树

存档根目录复用既有 [`GameSaveRepository`](../../src/main/services/game/GameSaveRepository.ts) 的 `data/game-saves/<saveId>/`，狼人杀专属数据置于 `werewolf/` 子目录，与既有 `save.json` / `state-snapshot.json` / `tables/` 平级：

```
data/game-saves/<saveId>/
├── save.json                          # 既有 GameSaveRepository 存档元数据 + 剧情日志
├── state-snapshot.json                # 既有模板状态快照（扩展后含 werewolf 字段，见 §5）
├── tables/                            # 既有 GameTableRepository 表格目录
│   ├── table-data.json                # 含狼人杀 sheet（characters/evidence/testimony/votes/events）
│   ├── table-config.json
│   └── table-versions.json
└── werewolf/                          # 狼人杀专属数据根目录
    ├── save.json                      # 狼人杀元数据（阶段、天数、规则、玩家身份）
    ├── characters.json                # 16 名角色运行时状态档案
    ├── truth-script.json              # 真相剧本集合（按夜存储）
    ├── evidence.json                  # 证据链
    ├── testimony.json                 # 证言表
    ├── votes.json                     # 投票记录（按审判场次）
    ├── faction-codes.json             # 暗码映射（初始化后不变）
    ├── judge-feedback.json            # 玩家举报通道（02-judge §6.3）
    └── ai-contexts/                   # 各 AI 角色独立上下文
        ├── <characterId-1>.json
        ├── <characterId-2>.json
        └── ...                        # 共 16 个文件
```

### 2.2 文件清单与层级归属

| 文件 | 对应架构总览 §4.2 层级 | 可见对象 | 写入时机 |
| :--- | :--- | :--- | :--- |
| `werewolf/save.json` | 跨层（元数据） | 玩家 + 法官 | 每阶段切换 |
| `werewolf/characters.json` | 证据链层（部分） | 玩家 + 法官 | 状态变更时 |
| `werewolf/truth-script.json` | 真相剧本层 | 仅法官 AI | 每夜结束 |
| `werewolf/evidence.json` | 证据链层 | 玩家 + 法官 | 现场调查每轮 |
| `werewolf/testimony.json` | 证言层 | 玩家 + 法官 + 已询问角色 | 证言收集每轮 |
| `werewolf/votes.json` | 证据链层 | 玩家 + 法官 | 审判处刑完成 |
| `werewolf/faction-codes.json` | 暗码层 | 仅法官 AI | 游戏初始化一次 |
| `werewolf/ai-contexts/<id>.json` | AI 上下文层 | 各角色独立 | 每次该角色被调用后 |
| `werewolf/judge-feedback.json` | 跨层（审计） | 玩家 + 法官 | 玩家举报时 |

## 3. JSON 文件 Schema 定义

### 3.1 `werewolf/save.json` - 狼人杀元数据

```typescript
/**
 * 狼人杀存档元数据
 *
 * 持久化路径：data/game-saves/<saveId>/werewolf/save.json
 * 可见层级：玩家 + 法官（跨层元数据）
 */
interface WerewolfSaveMeta {
  /** 存档 ID（与 GameSaveRepository 的 saveId 一致） */
  saveId: string;
  /** 游戏 ID（如 'werewolf'） */
  gameId: string;
  /** Schema 版本号，用于迁移（见 §7） */
  schemaVersion: string;
  /** 规则配置快照（来自 07-rule-system） */
  ruleConfig: WerewolfRuleConfig;
  /** 当前阶段（WerewolfPhase 枚举） */
  currentPhase: WerewolfPhase;
  /** 当前天数（从 1 开始，第 1 夜受首夜保护机制保护） */
  currentDayIndex: number;
  /** 当前阶段进入时间戳（ms） */
  phaseEnteredAt: number;
  /** 存档创建时间戳（ms） */
  createdAt: number;
  /** 最后更新时间戳（ms） */
  updatedAt: number;
  /** 玩家（典狱长）身份信息 */
  playerIdentity: PlayerIdentity;
  /** 游戏结果（未结束时为 null） */
  result: WerewolfGameResult | null;
}

/** 玩家（典狱长）身份 */
interface PlayerIdentity {
  /** 玩家角色名（默认"典狱长"） */
  name: string;
  /** 鉴定力场剩余充能次数（每日 1 次，初始 1） */
  identificationCharges: number;
  /** 历史鉴定记录 */
  identificationHistory: Array<{
    dayIndex: number;
    targetCharacterId: string;
    result: '好人' | '伪装者';
    identifiedAt: number;
  }>;
  /** 玩家拥有的 2 票投票权标记 */
  voteWeight: 2;
}

/** 游戏结果 */
interface WerewolfGameResult {
  isVictory: boolean;
  endedAt: number;
  elapsedDays: number;
  /** 整局打分结果（对齐 02-judge §7.2 GameScoreResult） */
  score: GameScoreResult;
}

/** 规则配置快照（07-rule-system 定义） */
interface WerewolfRuleConfig {
  /** 阵营人数配置 */
  factionCounts: { villager: number; pharmacist: number; security: number; fool: number; hacker: number; impostor: number };
  /** 是否启用首夜保护 */
  firstNightProtection: boolean;
  /** 自动存档上限（本游戏建议 10，见 §8） */
  maxAutoSaves: number;
  /** 扩展规则开关 */
  extendedRules: Record<string, boolean>;
}
```

### 3.2 `werewolf/characters.json` - 角色运行时状态档案

```typescript
/**
 * 角色运行时状态集合
 *
 * 持久化路径：data/game-saves/<saveId>/werewolf/characters.json
 * 可见层级：玩家 + 法官（部分字段仅法官可见，如 factionCode）
 *
 * 与 03-character-system-design.md §2.1 WerewolfCharacter 接口对齐：
 * 角色档案字段（name/species/appearance 等）直接复用 WerewolfCharacter，
 * 本文件额外承载运行时状态。
 */
interface CharactersFile {
  /** Schema 版本 */
  schemaVersion: string;
  /** 16 名角色运行时状态列表 */
  characters: CharacterRuntimeState[];
}

/** 单角色运行时状态 */
interface CharacterRuntimeState {
  /** 角色 ID（对应 WerewolfCharacter.id） */
  characterId: string;
  /** 角色档案（完整复用 03-character §2.1 WerewolfCharacter） */
  profile: WerewolfCharacter;
  /** 当前存活状态（对齐术语表 §9.4） */
  status: '存活' | '死亡' | '处刑' | '失踪';
  /** 状态变更原因（如"夜间击杀"/"审判处刑"/"药剂师救助"） */
  statusReason?: string;
  /** 死亡/处刑发生的天数 */
  statusChangedAtDay?: number;
  /** 当前位置（如 "F2-#F205" / "F1-中央厨房"） */
  currentLocation: string;
  /** 当前好感度（玩家与该角色的好感度，-100 到 100） */
  affinity: number;
  /** 该角色当前已知信息列表（公开信息的引用，详见 ai-contexts） */
  knownInfoRefs: Array<{
    /** 信息类型（对齐 06-ai-driving §2.1 AcquiredKnowledgeItem.type） */
    type: AcquiredKnowledgeItem['type'];
    /** 获取时间戳 */
    acquiredAt: string;
    /** 信息摘要（完整内容存于该角色的 ai-contexts 文件） */
    summary: string;
  }>;
  /** 神民技能状态（仅神民角色有值，对齐 03-character §5） */
  skillState?: PharmacistState | SecurityState | FoolState | HackerState;
  /** 伪装者共谋状态（仅伪装者角色有值，仅法官可见） */
  impostorState?: ImpostorCoverupPlan;
  /** 最后更新时间戳 */
  updatedAt: string;
}

/** 药剂师状态（对齐 03-character §5.1） */
interface PharmacistState {
  hasAntidote: boolean;
  hasPoison: boolean;
  usedThisNight: boolean;
  savedTargets: string[];
  poisonedTargets: string[];
}

/** 保安状态（对齐 03-character §5.2） */
interface SecurityState {
  hasCounterKillAvailable: boolean;
  lastPatrolArea: string | null;
}

/** 笨蛋状态（对齐 03-character §5.3） */
interface FoolState {
  hasTriggeredRecess: boolean;
}

/** 黑客状态（对齐 03-character §5.4） */
interface HackerState {
  lastProtected: string | null;
  proxyDeaths: Array<{ characterId: string; dayIndex: number }>;
}

/** 伪装者掩盖计划（对齐 06-ai-driving §6.4 ImpostorCoverupPlan） */
interface ImpostorCoverupPlan {
  weaponDisposal: 'carry' | 'incinerate' | 'plant';
  sceneCleanup: string[];
  scapegoatId?: string;
  falseAlibi: string;
  witnessAction: 'silence' | 'bribe' | 'ignore';
}
```

### 3.3 `werewolf/truth-script.json` - 真相剧本集合

```typescript
/**
 * 真相剧本集合（按夜存储）
 *
 * 持久化路径：data/game-saves/<saveId>/werewolf/truth-script.json
 * 可见层级：真相剧本层（仅法官 AI）
 *
 * 与 02-judge-system-design.md §5.2 TruthScript interface 完全对齐：
 * 每夜的 TruthScript 实例作为数组元素存储。
 * 注：02-judge 原文按夜分文件存储（truth-script/<dayIndex>.json），
 * 本设计合并为单文件以便原子写入与备份，字段语义不变。
 */
interface TruthScriptFile {
  /** Schema 版本 */
  schemaVersion: string;
  /** 存档 ID */
  saveId: string;
  /** 按夜存储的真相剧本列表（按 dayIndex 升序） */
  nights: TruthScript[];
}

/**
 * 单夜真相剧本（对齐 02-judge §5.2 TruthScript interface）
 *
 * 以下字段定义直接引用 02-judge §5.2，不再重复：
 * - TruthScript / Incident / SkillActivation / ImpostorMeeting
 * - Witness / SearchablePoint / Evidence
 *
 * 完整 interface 定义参见：
 * https://github.com/creative-cafe/werewolf/blob/main/docs/werewolf-game/02-judge-system-design.md#52-完整-typescript-interface-定义
 */
interface TruthScript {
  saveId: string;
  dayIndex: number;
  nightStartAt: number;
  nightEndAt: number;
  isPeacefulNight: boolean;
  incidents: Incident[];
  skillActivations: SkillActivation[];
  impostorMeeting: ImpostorMeeting;
  witnesses: Witness[];
}
```

### 3.4 `werewolf/evidence.json` - 证据链

```typescript
/**
 * 证据链
 *
 * 持久化路径：data/game-saves/<saveId>/werewolf/evidence.json
 * 可见层级：证据链层（玩家 + 法官；AI 角色仅可见已出示子集）
 *
 * 扩展自 02-judge §5.2 Evidence interface，新增运行时字段。
 */
interface EvidenceFile {
  /** Schema 版本 */
  schemaVersion: string;
  /** 证据列表 */
  evidences: EvidenceRecord[];
}

/** 证据记录（扩展自 02-judge §5.2 Evidence） */
interface EvidenceRecord {
  /** 证物 ID（对齐 Evidence.evidenceId） */
  evidenceId: string;
  /** 证物名称（对齐 Evidence.name） */
  name: string;
  /** 外观描述（对齐 Evidence.description） */
  description: string;
  /** 证物类型（对齐 Evidence.type） */
  type: '凶器' | '指纹' | '痕迹' | '体液' | '毛发' | '物品' | '监控残留';
  /** 是否与特定种族相关（对齐 Evidence.raceSpecific） */
  raceSpecific?: string;
  /** 关联角色 ID（对齐 Evidence.relatedCharacterId） */
  relatedCharacterId?: string;
  /** 来源夜数（哪一夜生成） */
  sourceDayIndex: number;
  /** 来源地点（如 "F2-#F205" / "F1-中央厨房"） */
  sourceLocation: string;
  /** 来源事件 ID（对应 TruthScript.incidents[].incidentId） */
  sourceIncidentId?: string;
  /** 发现方式（如 "现场调查-按钮点击" / "证言出示" / "鉴定推导"） */
  discoveryMethod: string;
  /** 是否已被玩家收集 */
  isCollected: boolean;
  /** 收集时间戳（未收集为 null） */
  collectedAt: number | null;
  /** 是否已被销毁（对齐 02-judge §5.2 evidenceDestruction） */
  isDestroyed: boolean;
  /** 销毁方式（如 "焚烧" / "冲入下水道" / "带离现场"） */
  destructionMethod?: string;
  /** 已向哪些角色出示过（角色 ID 列表，对齐 06-ai-driving §8.1） */
  presentedTo: string[];
}
```

### 3.5 `werewolf/testimony.json` - 证言表

```typescript
/**
 * 证言表
 *
 * 持久化路径：data/game-saves/<saveId>/werewolf/testimony.json
 * 可见层级：证言层（玩家 + 法官 + 已询问角色）
 *
 * 对齐规则剧本 §C 证言信息表与 02-judge §2.3 信息记录职责。
 */
interface TestimonyFile {
  /** Schema 版本 */
  schemaVersion: string;
  /** 证言列表 */
  testimonies: TestimonyEntry[];
}

/** 单条证言 */
interface TestimonyEntry {
  /** 证言 ID */
  testimonyId: string;
  /** 角色 ID（陈述者） */
  characterId: string;
  /** 对应夜数（陈述的是哪一夜的事件） */
  dayIndex: number;
  /** 审判场次（第几次审判收集的，从 1 开始） */
  trialSession: number;
  /** 陈述内容（玩家质询后的角色回复） */
  statement: string;
  /** 出示的证据 ID 列表（玩家在质询时出示的证物） */
  presentedEvidenceIds: string[];
  /** 情绪标记（对齐规则剧本 §C，如 "镇定"/"焦躁"/"恐惧"） */
  emotionTag: '镇定' | '焦躁' | '恐惧' | '愤怒' | '悲伤' | '兴奋';
  /** 情绪 Emoji（对齐规则剧本 §C 示例，如 🧊/💢/😨） */
  emotionEmoji: string;
  /** 是否撒谎（仅法官可知，玩家不可见） */
  isLying: boolean;
  /** 撒谎动机（仅 isLying=true 时有值，仅法官可见） */
  lieMotivation?: string;
  /** 矛盾点标注列表（与其他证言或证据的矛盾） */
  contradictions: Array<{
    /** 矛盾对象类型 */
    targetType: 'testimony' | 'evidence' | 'truth_script';
    /** 矛盾对象 ID */
    targetId: string;
    /** 矛盾描述 */
    description: string;
  }>;
  /** 该证言被哪些角色听到（已询问该角色的列表，对齐 06-ai-driving §8.2） */
  witnessedBy: string[];
  /** 陈述时间戳 */
  statedAt: number;
}
```

### 3.6 `werewolf/votes.json` - 投票记录

```typescript
/**
 * 投票记录（按审判场次存储）
 *
 * 持久化路径：data/game-saves/<saveId>/werewolf/votes.json
 * 可见层级：证据链层（玩家 + 法官）
 *
 * 对齐规则剧本 §3 审判与处刑机制。
 */
interface VotesFile {
  /** Schema 版本 */
  schemaVersion: string;
  /** 审判场次列表（按 trialSession 升序） */
  sessions: VoteSession[];
}

/** 单次审判场次 */
interface VoteSession {
  /** 审判场次（从 1 开始） */
  trialSession: number;
  /** 对应天数 */
  dayIndex: number;
  /** 辩护环节记录（各角色辩护摘要） */
  defenseRecords: Array<{
    characterId: string;
    defenseSummary: string;
    /** 是否触发对跳/悍跳等策略（对齐 06-ai-driving §4） */
    strategyUsed?: 'counterClaim' | 'fakeCounterAttack' | 'deepWater' | 'backdown';
  }>;
  /** 投票记录（含玩家 2 票） */
  votes: Array<{
    /** 投票人角色 ID（玩家为 'player'） */
    voterId: string;
    /** 被投票人角色 ID（弃票时为 null） */
    targetId: string | null;
    /** 票型（玩家为 2，其他角色为 1） */
    weight: 1 | 2;
    /** 投票时间戳 */
    votedAt: number;
  }>;
  /** 归票结果 */
  tally: Array<{ characterId: string; totalWeight: number }>;
  /** 是否平票 */
  isTied: boolean;
  /** 平票辩护记录（isTied=true 时有值） */
  tieBreakerDefense?: Array<{
    characterId: string;
    defenseSummary: string;
  }>;
  /** 处刑结果（null 表示跳过处刑） */
  executionResult: {
    /** 被处刑角色 ID */
    executedCharacterId: string | null;
    /** 处刑方式（玩家指定，对齐规则剧本 §3） */
    method: string;
    /** 遗言内容 */
    lastWords: string;
    /** 是否触发保安反杀（对齐 03-character §5.2） */
    triggeredCounterKill: boolean;
    /** 反杀目标（triggeredCounterKill=true 时有值） */
    counterKillTargetId?: string;
  } | null;
  /** 是否触发笨蛋临时休庭（对齐 03-character §5.3） */
  triggeredFoolRecess: boolean;
  /** 审判完成时间戳 */
  completedAt: number;
}
```

### 3.7 `werewolf/faction-codes.json` - 暗码映射

```typescript
/**
 * 暗码映射（初始化后不变）
 *
 * 持久化路径：data/game-saves/<saveId>/werewolf/faction-codes.json
 * 可见层级：暗码层（仅法官 AI）
 *
 * 与 03-character-system-design.md §2.1 FactionAssignment 接口对齐，
 * 与 02-judge-system-design.md §4.4 全局一致性约束一致：
 * 暗码一旦分配，在整个游戏周期内不可变。
 */
interface FactionCodesFile {
  /** Schema 版本 */
  schemaVersion: string;
  /** 存档 ID */
  saveId: string;
  /** 阵营分配种子（对齐 03-character §4.2，便于复现） */
  seed: number;
  /** 分配时间戳 */
  assignedAt: string;
  /** 角色 ID → 阵营分配结果映射 */
  assignments: Record<string, FactionAssignment>;
}

/**
 * 阵营分配结果（对齐 03-character §2.1 FactionAssignment）
 *
 * 完整 interface 定义参见 03-character-system-design.md §2.1。
 * 此处仅声明引用关系，不重复定义字段。
 */
interface FactionAssignment {
  characterId: string;
  faction: 'good' | 'impostor';
  role: 'villager' | 'pharmacist' | 'security' | 'fool' | 'hacker' | 'impostor';
  code: FactionCode;
  seed: number;
  assignedAt: string;
}

/**
 * 暗码枚举（对齐 03-character §2.1 FactionCode 与 02-judge §4.2 暗码字典）
 *
 * 完整定义参见 03-character-system-design.md §2.1。
 */
type FactionCode = '好' | '伪' | '药' | '保' | '笨' | '黑';
```

### 3.8 `werewolf/ai-contexts/<characterId>.json` - AI 上下文快照

```typescript
/**
 * 单角色 AI 上下文快照
 *
 * 持久化路径：data/game-saves/<saveId>/werewolf/ai-contexts/<characterId>.json
 * 可见层级：AI 上下文层（仅该角色与法官调度器可见）
 *
 * 与 06-ai-driving-mechanism.md §2.1 AiContext interface 完全对齐。
 * 文件名即 characterId，每角色独立，禁止跨角色读取（架构总览 §7.4）。
 */
interface AiContextFile {
  /** Schema 版本 */
  schemaVersion: string;
  /** AiContext 完整实例（对齐 06-ai-driving §2.1） */
  context: AiContext;
}

/**
 * AI 上下文（对齐 06-ai-driving-mechanism.md §2.1 AiContext interface）
 *
 * 完整 interface 定义（含 PublicKnowledge / AcquiredKnowledgeItem /
 * DialogueTurn / PhaseTask / DecisionRecord）参见：
 * 06-ai-driving-mechanism.md §2.1 与 §3.1
 */
interface AiContext {
  characterId: string;
  saveId: string;
  publicKnowledge: PublicKnowledge;
  acquiredKnowledge: AcquiredKnowledgeItem[];
  recentDialogue: DialogueTurn[];
  currentPhaseTask: PhaseTask;
  decisionHistory: DecisionRecord[];
  updatedAt: string;
}
```

## 4. 与既有类型的对齐矩阵

为避免类型重复定义，以下子系统的 interface 直接引用，不在本文件重复：

| 引用 interface | 来源文档 | 用途 |
| :--- | :--- | :--- |
| `WerewolfCharacter` | [03-character](./03-character-system-design.md) §2.1 | `characters.json` 的 `profile` 字段 |
| `FactionCode` / `FactionAssignment` | [03-character](./03-character-system-design.md) §2.1 | `faction-codes.json` |
| `TruthScript` / `Incident` / `SkillActivation` / `ImpostorMeeting` / `Witness` / `SearchablePoint` / `Evidence` | [02-judge](./02-judge-system-design.md) §5.2 | `truth-script.json` |
| `GameScoreResult` / `ReasoningGrade` | [02-judge](./02-judge-system-design.md) §7 | `save.json` 的 `result.score` |
| `AiContext` / `PublicKnowledge` / `AcquiredKnowledgeItem` / `DialogueTurn` / `PhaseTask` / `DecisionRecord` | [06-ai-driving](./06-ai-driving-mechanism.md) §2.1 | `ai-contexts/<id>.json` |
| `ImpostorCoverupPlan` | [06-ai-driving](./06-ai-driving-mechanism.md) §6.4 | `characters.json` 的 `impostorState` |
| `WerewolfPhase` | [01-architecture](./01-system-architecture.md) §9.2 | `save.json` 的 `currentPhase` |

## 5. 与 GameSaveRepository 的集成方案

### 5.1 扩展 GameSaveData 接口

在既有 [`GameSaveData`](../../src/shared/types/game.types.ts) 上新增 `werewolf` 可选字段，不破坏既有游戏模板：

```typescript
// src/shared/types/game.types.ts（扩展现有 GameSaveData）
export interface GameSaveData {
  meta: GameSaveMeta;
  narrativeLog: GameNarrativeMessage[];
  stateSnapshot?: Record<string, any>;
  /** 狼人杀专属状态快照（仅 gameType === 'werewolf' 时存在） */
  werewolf?: WerewolfSaveSnapshot;
}

/**
 * 狼人杀状态快照（写入 state-snapshot.json 的 werewolf 字段）
 *
 * 仅承载需要在主进程快速恢复的运行时状态，
 * 完整数据仍按 §3 的 8 个 JSON 文件持久化。
 */
interface WerewolfSaveSnapshot {
  /** 当前阶段 */
  currentPhase: WerewolfPhase;
  /** 当前天数 */
  currentDayIndex: number;
  /** 存活角色 ID 列表（快速判定胜负） */
  aliveCharacterIds: string[];
  /** 各文件最后更新时间戳（用于增量同步） */
  fileTimestamps: Record<string, number>;
}
```

### 5.2 读写流程

```typescript
// 扩展 GameSaveRepository（伪代码，不修改既有签名）

class GameSaveRepository {
  /** 创建狼人杀存档时初始化 werewolf/ 目录 */
  createWerewolfSave(params: {
    saveId: string;
    gameId: string;
    ruleConfig: WerewolfRuleConfig;
    characters: WerewolfCharacter[];
    factionAssignments: Record<string, FactionAssignment>;
    seed: number;
  }): void {
    const werewolfDir = path.join(getSaveDir(params.saveId), 'werewolf');
    fs.mkdirSync(path.join(werewolfDir, 'ai-contexts'), { recursive: true });

    // 初始化 8 个 JSON 文件
    safeWriteFile(path.join(werewolfDir, 'save.json'), JSON.stringify(this.initWerewolfSaveMeta(params), null, 2));
    safeWriteFile(path.join(werewolfDir, 'characters.json'), JSON.stringify(this.initCharactersFile(params), null, 2));
    safeWriteFile(path.join(werewolfDir, 'truth-script.json'), JSON.stringify({ schemaVersion: 'v1', saveId: params.saveId, nights: [] }, null, 2));
    safeWriteFile(path.join(werewolfDir, 'evidence.json'), JSON.stringify({ schemaVersion: 'v1', evidences: [] }, null, 2));
    safeWriteFile(path.join(werewolfDir, 'testimony.json'), JSON.stringify({ schemaVersion: 'v1', testimonies: [] }, null, 2));
    safeWriteFile(path.join(werewolfDir, 'votes.json'), JSON.stringify({ schemaVersion: 'v1', sessions: [] }, null, 2));
    safeWriteFile(path.join(werewolfDir, 'faction-codes.json'), JSON.stringify({
      schemaVersion: 'v1',
      saveId: params.saveId,
      seed: params.seed,
      assignedAt: new Date().toISOString(),
      assignments: params.factionAssignments
    }, null, 2));
    // ai-contexts/ 下每角色一个文件，由 AiContextManager 初始化
  }
}
```

### 5.3 copySave 兼容性

既有 [`copySave`](../../src/main/services/game/GameSaveRepository.ts) 通过 `copyDirSync` 递归复制存档目录，`werewolf/` 子目录会被自动复制，无需额外修改。复制后需刷新 `werewolf/save.json` 的 `saveId` 字段：

```typescript
// 在 copySave 内部，复制完成后追加：
const werewolfSavePath = path.join(newDir, 'werewolf', 'save.json');
if (fs.existsSync(werewolfSavePath)) {
  const werewolfMeta = JSON.parse(fs.readFileSync(werewolfSavePath, 'utf8'));
  werewolfMeta.saveId = newSaveId;
  werewolfMeta.createdAt = now;
  werewolfMeta.updatedAt = now;
  safeWriteFile(werewolfSavePath, JSON.stringify(werewolfMeta, null, 2), 'utf8');
}
```

## 6. 与 GameTableRepository 的表格 schema 映射

### 6.1 设计意图

将狼人杀部分数据表映射到 [`tables/table-data.json`](../../src/main/services/game/GameTableRepository.ts) 的 sheets，复用既有 `applyTableEdits` 协议（AI 回复末尾的 `<tableEdit>` 标签解析后应用），让 AI 法官在叙事生成时直接维护这些表格，渲染层复用既有表格面板组件。

### 6.2 狼人杀表格 Schema

参照 [`managementSchema.ts`](../../src/renderer/components/Game/templates/management/managementSchema.ts) 的模式定义狼人杀 schema：

```typescript
// src/renderer/components/Game/templates/werewolf/werewolfSchema.ts
import type { GameTableSchema } from '../../../../../shared/types/game.types';

export const WEREWOLF_TABLE_SCHEMA: GameTableSchema = {
  sheets: ['characters', 'evidence', 'testimony', 'votes', 'events'],
  headers: {
    characters: ['1', 'name', 'status', 'location', 'affinity', 'faction_code'],
    evidence:   ['1', 'name', 'type', 'source_day', 'source_location', 'is_collected', 'is_destroyed'],
    testimony:  ['1', 'character_id', 'day_index', 'statement', 'emotion', 'is_lying'],
    votes:      ['1', 'trial_session', 'voter_id', 'target_id', 'weight', 'result'],
    events:     ['1', 'day_index', 'phase', 'description', 'effect']
  },
  sheetDescriptions: {
    characters: '角色运行时状态（与 characters.json 同步的快照）',
    evidence:   '证据链（与 evidence.json 同步的快照）',
    testimony:  '证言表（与 testimony.json 同步的快照）',
    votes:      '投票记录（与 votes.json 同步的快照）',
    events:     '游戏事件日志（阶段切换、命案、处刑等）'
  }
};

export const WEREWOLF_SHEET_INDICES = {
  characters: 0,
  evidence: 1,
  testimony: 2,
  votes: 3,
  events: 4
} as const;
```

### 6.3 JSON 文件与 sheet 的同步关系

`tables/table-data.json` 中的 sheet 是 JSON 文件的**渲染快照**，AI 通过 `applyTableEdits` 更新 sheet 后，由 `WerewolfJudgeService` 同步回写对应的 JSON 文件：

| sheet | 同步目标 JSON | 同步方向 | 说明 |
| :--- | :--- | :--- | :--- |
| `characters` | `werewolf/characters.json` | 双向 | sheet 供 UI 渲染，JSON 为权威源 |
| `evidence` | `werewolf/evidence.json` | 双向 | 同上 |
| `testimony` | `werewolf/testimony.json` | 双向 | 同上 |
| `votes` | `werewolf/votes.json` | 双向 | 同上 |
| `events` | （仅 sheet） | 单向 | 仅用于 UI 展示事件日志，不持久化到 werewolf/ |

### 6.4 暗码字段的安全处理

`characters` sheet 的 `faction_code` 列**仅法官 AI 可见**，渲染层需过滤该列：

```typescript
// 渲染前过滤暗码列（避免泄露给玩家）
function sanitizeCharactersSheetForRender(rows: Record<string, any>[]): Record<string, any>[] {
  return rows.map(row => {
    const { faction_code, ...rest } = row;
    return rest;
  });
}
```

`faction-codes.json` 仍为暗码层的权威源，`characters` sheet 的 `faction_code` 列仅作为法官 AI 内部维护的冗余，便于 `applyTableEdits` 一次性更新。

## 7. 数据版本与迁移策略

### 7.1 schemaVersion 字段

每个 JSON 文件的根对象均含 `schemaVersion` 字段，初始值为 `'v1'`。版本号采用 `v<主版本号>` 格式，主版本号变更表示不兼容的结构性变更。

### 7.2 迁移函数注册机制

```typescript
// src/main/services/game/werewolf/WerewolfMigrator.ts

type MigrationFn = (oldData: any) => any;

interface MigrationRegistry {
  /** 文件名 → 版本 → 迁移函数 */
  [fileName: string]: {
    [fromVersion: string]: { toVersion: string; migrate: MigrationFn };
  };
}

const MIGRATIONS: MigrationRegistry = {
  'save.json': {
    'v1': { toVersion: 'v2', migrate: migrateSaveV1ToV2 }
  },
  'characters.json': {
    'v1': { toVersion: 'v2', migrate: migrateCharactersV1ToV2 }
  },
  // 其他文件同理
};

/** 加载时自动迁移到最新版本 */
function loadWithMigration(saveId: string, fileName: string, currentVersion: string, latestVersion: string): any {
  let data = readJsonSync(getWerewolfFilePath(saveId, fileName));
  let version = data.schemaVersion || currentVersion;

  while (version !== latestVersion) {
    const migration = MIGRATIONS[fileName]?.[version];
    if (!migration) {
      throw new Error(`无 ${fileName} 从 ${version} 的迁移路径`);
    }
    data = migration.migrate(data);
    data.schemaVersion = migration.toVersion;
    version = migration.toVersion;
  }

  // 若发生迁移，回写最新版本
  if (version !== currentVersion) {
    safeWriteFile(getWerewolfFilePath(saveId, fileName), JSON.stringify(data, null, 2));
  }
  return data;
}

// 示例迁移函数：v1 → v2（假设 v2 新增 playerIdentity.identificationCharges 字段）
function migrateSaveV1ToV2(old: any): any {
  if (!old.playerIdentity) old.playerIdentity = { name: '典狱长', voteWeight: 2 };
  if (old.playerIdentity.identificationCharges === undefined) {
    old.playerIdentity.identificationCharges = 1;
  }
  if (!Array.isArray(old.playerIdentity.identificationHistory)) {
    old.playerIdentity.identificationHistory = [];
  }
  return old;
}
```

### 7.3 版本演进约束

- **只允许线性迁移**：v1 → v2 → v3，不支持跳跃式迁移（避免组合爆炸）
- **迁移幂等**：同一迁移函数对已迁移的数据再次执行不应产生副作用
- **迁移日志**：每次迁移写入 `judge-feedback.json` 同目录的 `migration.log`，记录存档 ID、文件名、版本路径、时间戳
- **跨文件一致性**：若某次升级涉及多文件联动（如 `save.json` 的 `schemaVersion` 与 `characters.json` 同步升级），迁移函数需保证原子性

## 8. 自动存档轮转策略

### 8.1 触发时机

对齐 [06-ai-driving-mechanism.md](./06-ai-driving-mechanism.md) §11.5 的自动存档时机表，每阶段切换时触发自动存档：

| 触发事件 | 写入目标文件 |
| :--- | :--- |
| 夜间结束 | `truth-script.json` + `ai-contexts/*.json` + `save.json` |
| 晨间结算完成 | `evidence.json` + `characters.json`（状态变更） + `ai-contexts/*.json` |
| 现场调查每轮结束 | `evidence.json` + `ai-contexts/*.json` |
| 证言收集每轮结束 | `testimony.json` + `ai-contexts/*.json` |
| 庭前推理完成 | `save.json`（打分结果） |
| 审判处刑完成 | `votes.json` + `characters.json`（处刑状态） + `faction-codes.json`（不变，仅引用） + `ai-contexts/*.json` |
| 日间活动结束 | `ai-contexts/*.json` + `save.json`（天数推进） |

### 8.2 轮转上限

- 既有 [`GameSaveRepository.pruneAutoSaves`](../../src/main/services/game/GameSaveRepository.ts) 默认上限 `MAX_AUTO_SAVES = 5`（见 [`game.types.ts`](../../src/shared/types/game.types.ts) §默认配置）
- **本游戏建议上限 10**：狼人杀单局可能持续 5-7 天，每阶段切换都触发存档，5 个上限不足以覆盖完整阶段回溯
- 实现方式：在 [`WerewolfRuleConfig.maxAutoSaves`](#31-werewolfsavejson---狼人杀元数据) 中配置为 10，`WerewolfJudgeService` 在触发自动存档后调用 `pruneAutoSaves` 时传入本游戏专属上限：

```typescript
// 覆盖既有上限（不修改全局 MAX_AUTO_SAVES）
const WEREWOLF_MAX_AUTO_SAVES = 10;

class WerewolfJudgeService {
  triggerAutoSave(saveId: string, gameId: string, event: string): void {
    // 1. 写入当前阶段的所有变更文件（见 §8.1）
    this.persistChangedFiles(saveId, event);
    // 2. 创建自动存档副本（isAuto=true）
    const autoSaveMeta = gameSaveRepository.copySave(saveId, `自动存档-${event}-${Date.now()}`);
    if (autoSaveMeta) {
      autoSaveMeta.isAuto = true;
      // 3. 按狼人杀专属上限轮转
      this.pruneWerewolfAutoSaves(gameId);
    }
  }

  private pruneWerewolfAutoSaves(gameId: string): void {
    const autoSaves = gameSaveRepository.listSaves(gameId).filter(m => m.isAuto);
    if (autoSaves.length <= WEREWOLF_MAX_AUTO_SAVES) return;
    const toDelete = autoSaves.slice(WEREWOLF_MAX_AUTO_SAVES);
    for (const meta of toDelete) {
      gameSaveRepository.deleteSave(meta.id);
    }
  }
}
```

### 8.3 写入性能约束

对齐架构总览 §7.1：每次自动存档写入 < 500ms。约束实现：

- **增量写入**：仅写变化的文件，不全量重写 8 个 JSON
- **并行写入**：无依赖关系的文件并行 `safeWriteFile`（如 `evidence.json` 与 `testimony.json`）
- **ai-contexts 批量写入**：16 个角色文件并行写入，受 [`AiCallQueue`](./06-ai-driving-mechanism.md) §11.2 的并发上限约束（避免 IO 与 AI 调用争抢资源）

## 9. 验收清单

- [ ] `werewolf/` 目录结构与 §2.1 目录树一致，`createWerewolfSave` 初始化 8 个 JSON 文件 + `ai-contexts/` 子目录
- [ ] `WerewolfSaveMeta` / `CharactersFile` / `TruthScriptFile` / `EvidenceFile` / `TestimonyFile` / `VotesFile` / `FactionCodesFile` / `AiContextFile` 八个 interface 定义于 `src/shared/types/werewolf.types.ts`
- [ ] `GameSaveData.werewolf?: WerewolfSaveSnapshot` 扩展字段不破坏既有游戏模板
- [ ] `WEREWOLF_TABLE_SCHEMA` 定义 5 个 sheet，`applyTableEdits` 可正常应用 AI 回复中的 `<tableEdit>` 命令
- [ ] `characters` sheet 的 `faction_code` 列在渲染层被过滤，不泄露给玩家
- [ ] `WerewolfMigrator` 实现 v1→v2 迁移函数注册机制，迁移幂等且写日志
- [ ] `triggerAutoSave` 覆盖 §8.1 的 7 个触发时机，写入耗时 < 500ms
- [ ] `pruneWerewolfAutoSaves` 按上限 10 轮转，不修改全局 `MAX_AUTO_SAVES`
- [ ] `copySave` 复制 `werewolf/` 子目录后刷新 `saveId` / `createdAt` / `updatedAt`
- [ ] `TruthScript` / `WerewolfCharacter` / `AiContext` / `FactionAssignment` 引用关系与 §4 对齐矩阵一致，无重复定义

## 10. 后续文档导航

| 编号 | 文档 | 本文相关章节 |
| :---: | :--- | :--- |
| 01 | [系统架构设计](./01-system-architecture.md) | §2 目录树对齐 §4.2 数据隔离层级表；§8 自动存档对齐 §7.1 性能约束 |
| 02 | [法官 AI 系统设计](./02-judge-system-design.md) | §3.3 `truth-script.json` 引用 §5.2 TruthScript；§3.4 `evidence.json` 引用 §5.2 Evidence；§3.5 `testimony.json` 对齐 §2.3 信息记录 |
| 03 | [角色系统设计](./03-character-system-design.md) | §3.2 `characters.json` 引用 §2.1 WerewolfCharacter；§3.7 `faction-codes.json` 引用 §2.1 FactionAssignment |
| 05 | [游戏流程设计](./05-game-flow-design.md) | §3.1 `currentPhase` 字段依赖八大阶段状态机；§8.1 自动存档时机依赖阶段切换 |
| 06 | [AI 驱动机制](./06-ai-driving-mechanism.md) | §3.8 `ai-contexts/<id>.json` 引用 §2.1 AiContext；§3.2 `impostorState` 引用 §6.4 ImpostorCoverupPlan；§8.1 触发时机对齐 §11.5 |
| 07 | [规则系统设计](./07-rule-system-design.md) | §3.1 `ruleConfig` 字段依赖规则配置 |
| 10 | [文件目录结构](./10-file-directory-structure.md) | §2 存档目录结构为源码目录设计提供输入 |
| 11 | [核心模块划分](./11-core-module-division.md) | §5-§8 集成方案依赖模块接口定义 |
