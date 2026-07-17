# 07 - 规则系统设计

> 本文档定义狼人杀推理游戏的规则子系统（架构图中的 06 规则系统），负责基础/扩展规则集管理、规则组合合法性校验、胜负条件评估。所有术语严格遵循 [01-system-architecture.md](./01-system-architecture.md) 第 9 章术语表，规则机制严格对齐 [逆转裁判+狼人杀规则.txt](../逆转裁判+狼人杀规则.txt)。

## 1. 子系统定位

规则系统是六大子系统中唯一在游戏开始前完成初始化、在游戏运行中只读不改的子系统。其核心边界如下：

| 维度 | 说明 |
| :--- | :--- |
| 主要输入 | 玩家在规则选择页提交的规则配置、运行时的角色存活状态 |
| 主要输出 | 校验通过的规则配置快照、胜负判定结果 |
| 核心职责 | 基础规则集管理、扩展规则集管理、规则组合合法性校验、阵营配比计算、胜负条件评估 |
| 严格禁止 | 运行时修改已生效规则、违反规则组合约束、绕过胜负判定直接结束游戏 |

依赖关系：规则系统不依赖其他五大子系统，但被 [02 法官系统](./02-judge-system-design.md)（真相剧本生成需读取击杀规则）、[03 角色系统](./03-character-system-design.md)（阵营分配需读取配比）、[05 流程系统](./05-game-flow-design.md)（阶段状态机需读取规则开关）三方依赖。

## 2. 基础规则集

基础规则集对齐规则文档中的核心机制，玩家不可关闭，仅可在扩展规则集中叠加变体。

### 2.1 屠边局模式

本游戏默认采用屠边局模式（规则文档第 1 行）。屠边局的核心特征是伪装者阵营只需杀光"普通好人"或"神民"其中一边即可获胜，对应规则文档第 242 行的失败条件。屠城局作为扩展规则提供，见第 3.1 节。

### 2.2 阵营配比

默认阵营配比为 **7 普通好人 + 4 神民 + 5 伪装者**（规则文档第 17-23 行），合计 16 名 AI 角色，加上玩家扮演的典狱长共 17 人。

| 阵营 | 人数 | 对应狼人杀角色 | 阵营目标 |
| :--- | :--- | :--- | :--- |
| 普通好人 | 7 | 村民 | 存活到最后 |
| 神民 | 4 | 女巫/猎人/白痴/守卫 | 发挥技能价值，保护好人阵营 |
| 伪装者 | 5 | 狼人 | 屠边：杀光所有普通好人或所有神民 |

神民的四种技能固定为药剂师、保安、笨蛋、黑客各一名，分配完全随机，不可与外观/性格绑定。伪装者除变形能力外无任何特异功能，需依赖凶器、药物或肉搏击杀。

### 2.3 夜间黑盒机制

每日 00:00-06:00 为夜间阶段（规则文档第 122-134 行），系统强制黑盒：

- 不记录任何明文信息，仅生成玩家不可见的【真相剧本】
- 真相剧本须涵盖：时间、地点、凶手/帮凶、手法/凶器、凶器来源与处理、证据销毁与栽赃嫁祸、提前准备、技能发动情况
- 若未发生命案，仍需记录伪装者是否选择杀人、技能发动地点、预期目标等隐藏信息
- 每夜难度与犯罪手法需逐步提升，但必须保留可推理的完整证据链

### 2.4 击杀规则

夜间击杀遵循以下硬性约束（规则文档第 124-129 行）：

1. **每房最多 2 人**：每个单人牢房在夜晚最多容纳 2 名角色
2. **单夜单杀**：所有伪装者一次夜晚只能击杀一名好人；若选择有 2 名角色的房间，必定产生目击者
3. **可伪造平安夜**：伪装者可不进行击杀，伪造平安夜假象
4. **需依赖凶器**：伪装者无特殊杀人能力，需依赖凶器、药物、可造成伤害的日常物品或肉搏；凶器不一定是违禁品
5. **真面目示人**：伪装者杀人时必定以真面目示人，且可互相识别身份（对应狼人杀夜间睁眼）
6. **残忍手法**：真实好人将被残忍方式肢解杀害，仅写入真相剧本，玩家侧仅看到现场证据

### 2.5 晨间死亡判定与首夜保护

每日 06:00 晨间结算按顺序进行（规则文档第 135-141 行）：

1. **首夜保护机制**：第一夜禁止杀戮，保证玩家体验
2. **死亡判定**：发生命案则播报"空气中弥漫着血腥味……犯罪地点为：【尸体发现的地点】"；未发生则播报"今天是平安夜"
3. **封锁机制**：命案发生后拉响警报，所有角色被强制禁闭于各自所在地图区域
4. **现场调查**：法官 AI 基于真相剧本生成现场信息表与可搜索点位清单
5. **证言收集**：完成现场调查后向角色质询，可出示证物与威慑
6. **庭前推理**：玩家提交推理，法官打分优良中差，禁止提示

### 2.6 审判投票

审判环节每天白天执行，无论是否为平安夜（规则文档第 152-166 行）：

1. **辩护环节**：按玩家指定顺序正序或逆序发言，发言期间其他人严禁插话；所有人在编号座位上被力场保护且不可自由移动
2. **投票环节**：所有角色同时记名投票或弃票；典狱长拥有 **2 票**
3. **归票与处刑**：得票最高者被处刑，处刑前可交代遗言
4. **平票处理**：平票角色进行最后辩护 → 再次投票 → 若得票超过半数则处刑 → 再次平票则跳过处刑
5. **处刑方式**：由典狱长决定

审判环节中 AI 角色将随机采用对跳/悍跳、金水/银水、查杀、悍跳反水、深水狼/倒钩狼、退水等传统狼人杀策略，以增加博弈深度。

### 2.7 身份鉴定力场

典狱长的预言家能力受医疗室特殊床位力场约束（规则文档第 167-172 行）：

- **鉴定方式**：每晚通过性接触方式识别一名角色的真实身份
- **鉴定地点**：必须在医疗室的特殊床位进行
- **力场充能**：力场每天拥有一次充能，鉴定需消耗充能；力场消失时所有鉴定规则失效
- **鉴定时段**：只能在夜间（00:00-06:00）进行，符合传统狼人杀预言家夜晚查验设定
- **鉴定结果**：力场下鉴定结果绝对正确，只能是【好人】或【伪装者】，严禁出现药剂师/保安/笨蛋/黑客等技能标签
- **结果通报**：鉴定结果第一时间由法官通报给所有人并添加到角色数据库

## 3. 扩展规则集清单

扩展规则集为可选变体规则，玩家可在游戏开始前自由组合，但需通过第 5 章的合法性校验。

### 3.1 屠城局

| 项 | 内容 |
| :--- | :--- |
| 规则 ID | `slaughterAll` |
| 说明 | 伪装者需杀光所有好人才胜利（含普通好人与神民两边） |
| 与基础规则差异 | 失败条件由"屠边"改为"屠城"，好人阵营生存空间更大，伪装者压力更高 |
| 互斥 | 与默认屠边局互斥；与 `7+4+5` 配比兼容但建议调整为更高伪装者比例 |

### 3.2 双预言家

| 项 | 内容 |
| :--- | :--- |
| 规则 ID | `doubleSeer` |
| 说明 | 除典狱长外，另有一名神民拥有预言家能力（每晚独立鉴定一人） |
| 与基础规则差异 | 神民数量由 4 调整为 5（新增预言家神民），或替换其中一项技能 |
| 配比调整 | 需将阵营配比调整为 7 普通好人 + 5 神民 + 4 伪装者，或 6+5+5 |

### 3.3 自爆狼

| 项 | 内容 |
| :--- | :--- |
| 规则 ID | `suicideWolf` |
| 说明 | 伪装者被票出处刑时可发动自爆，立即带走一名在场角色，并跳过当日剩余审判流程直接进入夜间 |
| 与基础规则差异 | 处刑环节新增自爆判定，被带走角色无遗言 |
| 互斥 | 与 `whiteWolfKing` 互斥（同为伪装者首领型变体） |

### 3.4 白狼王

| 项 | 内容 |
| :--- | :--- |
| 规则 ID | `whiteWolfKing` |
| 说明 | 伪装者阵营中有一名白狼王（伪装者首领），夜晚可发动双杀（一晚击杀两名好人） |
| 与基础规则差异 | 击杀规则中的"单夜单杀"对白狼王失效；白狼王身份在伪装者内部公开 |
| 互斥 | 与 `suicideWolf` 互斥 |

### 3.5 混血儿

| 项 | 内容 |
| :--- | :--- |
| 规则 ID | `mixedBlood` |
| 说明 | 引入中立阵营，混血儿独立胜利条件：存活至游戏终局且好人/伪装者任一阵营胜利时混血儿胜利 |
| 与基础规则差异 | 新增第三阵营；阵营配比调整为 6 普通好人 + 4 神民 + 5 伪装者 + 1 混血儿 |
| 互斥 | 无；但与屠城局组合时混血儿胜利条件调整为"存活至屠城完成" |

### 3.6 警上警下

| 项 | 内容 |
| :--- | :--- |
| 规则 ID | `sheriffElection` |
| 说明 | 审判前先进行警长选举环节，玩家可竞选警长；当选警长者拥有 2 票投票权 |
| 与基础规则差异 | 典狱长默认 2 票被剥夺，改为由选举产生；新增"警上发言"与"警下投票"两个子阶段 |
| 互斥 | 与基础规则中的"典狱长固定 2 票"冲突，启用后基础规则的警长 2 票由选举产生 |

### 3.7 聊爆判定

| 项 | 内容 |
| :--- | :--- |
| 规则 ID | `chatBust` |
| 说明 | AI 监控角色发言，当检测到伪装者发言中泄露真实阵营信息（如无意说出夜间行动、认出队友等）时自动标注聊爆 |
| 与基础规则差异 | 审判环节新增聊爆标注 UI；标注后的发言对玩家高亮显示，但最终判断仍由玩家做出 |
| 互斥 | 无；纯辅助规则，不改变胜负判定 |

## 4. 规则配置数据结构

### 4.1 TypeScript 接口定义

所有规则相关类型定义将集中存放在 [src/shared/types/werewolf.types.ts](../../src/shared/types/werewolf.types.ts)（单一真源，见架构文档 7.2）。

```typescript
/**
 * 规则集根配置
 *
 * 在游戏开始前由玩家在规则选择页提交，经合法性校验后持久化到存档。
 * 运行时只读，禁止修改。
 */
export interface WerewolfRuleSet {
  /** 规则集版本号（用于存档兼容性校验） */
  version: string;
  /** 规则集预设包 ID（若来自预设包，则为预设包 ID；自定义则为 'custom'） */
  presetId: string;
  /** 基础规则开关（基础规则不可关闭，仅可被扩展规则覆盖） */
  base: WerewolfBaseRules;
  /** 扩展规则开关 */
  extensions: WerewolfExtensionSwitches;
  /** 阵营配比覆盖（若未提供则使用默认 7+4+5） */
  factionRatio?: WerewolfFactionRatio;
  /** 技能分配策略 */
  skillAssignment: WerewolfSkillAssignment;
}

/** 基础规则开关 */
export interface WerewolfBaseRules {
  /** 屠边局模式（默认 true，启用屠城局扩展时被覆盖为 false） */
  slaughterSide: boolean;
  /** 首夜保护（默认 true，第一夜禁止杀戮） */
  firstNightProtection: boolean;
  /** 夜间黑盒（默认 true，00:00-06:00 仅生成真相剧本） */
  nightBlackBox: boolean;
  /** 单夜单杀（默认 true，白狼王扩展启用时对白狼王失效） */
  singleKillPerNight: boolean;
  /** 每房最多 2 人（默认 true） */
  maxTwoPerRoom: boolean;
  /** 典狱长固定 2 票（默认 true，警上警下扩展启用时被覆盖为 false） */
  wardenDoubleVote: boolean;
  /** 身份鉴定力场（默认 true，每日一次充能） */
  seerForceField: boolean;
}

/** 扩展规则开关 */
export interface WerewolfExtensionSwitches {
  /** 屠城局 */
  slaughterAll: boolean;
  /** 双预言家 */
  doubleSeer: boolean;
  /** 自爆狼 */
  suicideWolf: boolean;
  /** 白狼王 */
  whiteWolfKing: boolean;
  /** 混血儿 */
  mixedBlood: boolean;
  /** 警上警下 */
  sheriffElection: boolean;
  /** 聊爆判定 */
  chatBust: boolean;
}

/** 阵营配比 */
export interface WerewolfFactionRatio {
  /** 普通好人数 */
  villagers: number;
  /** 神民数 */
  gods: number;
  /** 伪装者数 */
  impostors: number;
  /** 中立阵营数（如混血儿），默认 0 */
  neutrals: number;
}

/** 技能分配策略 */
export interface WerewolfSkillAssignment {
  /** 神民技能池（默认为药剂师/保安/笨蛋/黑客四项） */
  godSkillPool: WerewolfGodSkill[];
  /** 是否允许同一技能重复分配 */
  allowDuplicate: boolean;
  /** 分配随机种子（用于存档复现） */
  seed: number;
}

/** 神民技能枚举 */
export enum WerewolfGodSkill {
  PHARMACIST = 'pharmacist',   // 药剂师（女巫）
  GUARD = 'guard',             // 保安（猎人）
  FOOL = 'fool',               // 笨蛋（白痴）
  HACKER = 'hacker',           // 黑客（守卫）
  SEER = 'seer'                // 预言家（双预言家扩展使用）
}
```

### 4.2 JSON Schema

规则集持久化路径：`data/games/<gameId>/rules/<ruleSetId>.json`（与架构文档 7.3 的可扩展性约定一致）。

```json
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "title": "WerewolfRuleSet",
  "type": "object",
  "required": ["version", "presetId", "base", "extensions", "skillAssignment"],
  "properties": {
    "version": { "type": "string", "const": "1.0.0" },
    "presetId": { "type": "string" },
    "base": {
      "type": "object",
      "required": ["slaughterSide", "firstNightProtection", "nightBlackBox",
                   "singleKillPerNight", "maxTwoPerRoom", "wardenDoubleVote", "seerForceField"],
      "properties": {
        "slaughterSide": { "type": "boolean" },
        "firstNightProtection": { "type": "boolean" },
        "nightBlackBox": { "type": "boolean" },
        "singleKillPerNight": { "type": "boolean" },
        "maxTwoPerRoom": { "type": "boolean" },
        "wardenDoubleVote": { "type": "boolean" },
        "seerForceField": { "type": "boolean" }
      },
      "additionalProperties": false
    },
    "extensions": {
      "type": "object",
      "required": ["slaughterAll", "doubleSeer", "suicideWolf",
                   "whiteWolfKing", "mixedBlood", "sheriffElection", "chatBust"],
      "properties": {
        "slaughterAll": { "type": "boolean" },
        "doubleSeer": { "type": "boolean" },
        "suicideWolf": { "type": "boolean" },
        "whiteWolfKing": { "type": "boolean" },
        "mixedBlood": { "type": "boolean" },
        "sheriffElection": { "type": "boolean" },
        "chatBust": { "type": "boolean" }
      },
      "additionalProperties": false
    },
    "factionRatio": {
      "type": "object",
      "required": ["villagers", "gods", "impostors", "neutrals"],
      "properties": {
        "villagers": { "type": "integer", "minimum": 0 },
        "gods": { "type": "integer", "minimum": 0 },
        "impostors": { "type": "integer", "minimum": 0 },
        "neutrals": { "type": "integer", "minimum": 0 }
      }
    },
    "skillAssignment": {
      "type": "object",
      "required": ["godSkillPool", "allowDuplicate", "seed"],
      "properties": {
        "godSkillPool": {
          "type": "array",
          "items": { "type": "string", "enum": ["pharmacist", "guard", "fool", "hacker", "seer"] }
        },
        "allowDuplicate": { "type": "boolean" },
        "seed": { "type": "integer" }
      }
    }
  }
}
```

## 5. 规则组合合法性校验

规则系统在玩家提交规则配置后、游戏初始化前执行合法性校验，返回 `RuleValidationResult`：

```typescript
export interface RuleValidationResult {
  valid: boolean;
  errors: RuleConflict[];
}

export interface RuleConflict {
  code: string;          // 冲突代码
  message: string;       // 冲突描述
  involvedRules: string[]; // 涉及的规则 ID
}
```

### 5.1 冲突检测规则

| 冲突代码 | 触发条件 | 处理方式 |
| :--- | :--- | :--- |
| `E_SLAUGHTER_CONFLICT` | `slaughterAll=true` 且 `base.slaughterSide=true` | 自动将 `base.slaughterSide` 置为 false，并提示用户已切换为屠城局 |
| `E_VOTE_CONFLICT` | `sheriffElection=true` 且 `base.wardenDoubleVote=true` | 自动将 `base.wardenDoubleVote` 置为 false，提示警长 2 票改由选举产生 |
| `E_WOLF_LEADER_CONFLICT` | `suicideWolf=true` 且 `whiteWolfKing=true` | 校验失败，二选一 |
| `E_DOUBLE_SEER_RATIO` | `doubleSeer=true` 且未调整 `factionRatio` | 校验失败，需将神民数调整为 5 或替换技能池 |
| `E_MIXED_BLOOD_RATIO` | `mixedBlood=true` 且 `factionRatio.neutrals !== 1` | 自动设置 `factionRatio.neutrals=1`，并从普通好人中扣除 1 |
| `E_SLAUGHTER_ALL_RATIO` | `slaughterAll=true` 且 `factionRatio` 为默认 7+4+5 | 警告（不阻断），建议提升伪装者比例至 6 |
| `E_TOTAL_COUNT` | `factionRatio` 各项之和小于 12 或大于 20 | 校验失败，总数须在 12-20 之间 |
| `E_SKILL_POOL_MISMATCH` | `godSkillPool.length !== factionRatio.gods` 且 `allowDuplicate=false` | 校验失败，技能池数量须与神民数一致 |
| `E_SEER_SKILL_WITHOUT_DOUBLE` | `godSkillPool` 含 `seer` 且 `doubleSeer=false` | 校验失败，预言家技能仅在双预言家扩展启用时可用 |

### 5.2 校验流程

```
玩家提交规则配置
       │
       ▼
  逐条执行冲突检测 ──失败──→ 返回 RuleConflict 列表
       │
       ▼
  执行自动修复（E_SLAUGHTER_CONFLICT / E_VOTE_CONFLICT / E_MIXED_BLOOD_RATIO）
       │
       ▼
  再次执行冲突检测 ──失败──→ 返回修复后仍存在的冲突
       │
       ▼
  通过 ──→ 持久化规则配置快照到存档
```

## 6. 胜利/失败条件矩阵

胜负判定由规则系统的 `evaluateWinCondition` 函数在每夜晨间结算、每次处刑后、每次技能发动后触发。

### 6.1 屠边局（默认）

| 条件 | 触发时机 | 播报内容 |
| :--- | :--- | :--- |
| **好人胜利** | 监狱内不存在任何伪装者 | "游戏胜利，本次的成绩是【以好人存活数、经过天数、审判正确度等维度为本局游戏打分】" |
| **好人失败（屠村民）** | 伪装者杀光所有普通好人 | "游戏失败……所有伪装者卸下面具，无差别杀戮剩余好人" |
| **好人失败（屠神民）** | 伪装者杀光所有神民 | 同上 |

### 6.2 屠城局（扩展）

| 条件 | 触发时机 | 播报内容 |
| :--- | :--- | :--- |
| **好人胜利** | 监狱内不存在任何伪装者 | 同屠边局 |
| **好人失败** | 伪装者杀光所有好人（普通好人 + 神民） | 同屠边局失败播报 |

### 6.3 中立阵营（混血儿扩展）

| 条件 | 触发时机 |
| :--- | :--- |
| **混血儿胜利** | 混血儿存活至游戏终局，且好人或伪装者任一阵营达成胜利条件 |
| **混血儿失败** | 混血儿在游戏终局前死亡，或混血儿存活但未达成任一阵营胜利 |

### 6.4 胜负判定伪代码

```typescript
function evaluateWinCondition(state: GameState, ruleSet: WerewolfRuleSet): WinResult {
  const aliveVillagers = countAlive(state, 'villager');
  const aliveGods = countAlive(state, 'god');
  const aliveImpostors = countAlive(state, 'impostor');
  const aliveMixed = countAlive(state, 'mixedBlood');

  // 好人胜利：伪装者全灭
  if (aliveImpostors === 0) {
    return buildGoodWin(state, ruleSet, aliveMixed);
  }

  // 屠边局失败判定
  if (ruleSet.base.slaughterSide) {
    if (aliveVillagers === 0 || aliveGods === 0) {
      return buildImpostorWin(state, ruleSet, aliveMixed);
    }
  }
  // 屠城局失败判定
  else {
    if (aliveVillagers === 0 && aliveGods === 0) {
      return buildImpostorWin(state, ruleSet, aliveMixed);
    }
  }

  // 中立阵营判定（仅在终局时触发）
  if (ruleSet.extensions.mixedBlood && aliveMixed > 0) {
    // 混血儿胜利条件已在好人/伪装者胜利分支中处理
  }

  return { winner: null, ongoing: true };
}
```

## 7. 规则配置 UI 流程

规则选择页作为新建存档前的独立步骤，遵循 [08-ui-ux-design.md](./08-ui-ux-design.md) 的线框图规范，使用 antd 组件库实现。

### 7.1 页面流程

```
[新建存档] → [规则选择页] → [合法性校验] → [通过] → [角色档案初始化] → [进入游戏]
                              ↓
                        [失败] → [显示冲突提示] → [回到规则选择页]
```

### 7.2 预设规则包

提供三个快捷预设包，玩家可一键加载后再做微调：

| 预设包 ID | 名称 | 基础规则 | 扩展规则 | 配比 |
| :--- | :--- | :--- | :--- | :--- |
| `standard_slaughter_side` | 标准屠边局 | 全部默认 | 全部关闭 | 7+4+5 |
| `fast_slaughter_all` | 高速屠城局 | `slaughterSide=false` | `slaughterAll=true` | 6+4+6 |
| `double_god` | 双神民局 | `slaughterSide=true` | `doubleSeer=true` | 7+5+4 |

预设包 JSON 文件存放于 `data/games/<gameId>/rules/presets/` 目录，结构与第 4.2 节 JSON Schema 一致。

### 7.3 页面组件结构

- **预设包选择区**：Card 列表，展示三个预设包名称与简介，点击即加载
- **基础规则展示区**：Collapse 折叠面板，展示基础规则开关（只读，提示"基础规则不可关闭"）
- **扩展规则配置区**：Switch 开关列表，每项附 Tooltip 说明
- **阵营配比配置区**：InputNumber 三/四个数字输入框，实时显示总数
- **技能分配策略区**：Select 多选技能池 + Checkbox 允许重复 + 随机种子输入
- **底部操作栏**：[重置为默认] [加载预设] [校验并开始] 按钮

## 8. 与既有 GameLocalConfig 的集成方案

### 8.1 字段扩展

在既有 [`GameLocalConfig`](../../src/shared/types/game.types.ts) 中新增 `ruleSet` 字段，对齐既有配置存储模式（`data/games/<gameId>/config.json`）：

```typescript
// src/shared/types/game.types.ts（既有文件，新增字段）
export interface GameLocalConfig {
  activeEngineId: string | null;
  temperature: number;
  maxTokens: number;
  organizeMode: GameTableOrganizeMode;
  ansiTheme: string;
  autoSave: boolean;
  /** 狼人杀规则集（仅 GameType.WEREWOLF 使用，其他游戏类型为 null） */
  ruleSet?: WerewolfRuleSet | null;
}
```

### 8.2 默认值扩展

在 [src/shared/types/game.types.ts](../../src/shared/types/game.types.ts) 的 `DEFAULT_GAME_LOCAL_CONFIG` 中新增字段：

```typescript
export const DEFAULT_GAME_LOCAL_CONFIG: GameLocalConfig = {
  activeEngineId: null,
  temperature: 0.7,
  maxTokens: 32768,
  organizeMode: 'async',
  ansiTheme: 'default',
  autoSave: true,
  ruleSet: null  // 新建游戏时为 null，进入狼人杀时由规则选择页填充
};
```

### 8.3 持久化策略

- 规则集快照同时写入两处：`config.json`（运行时配置）与存档的 `state-snapshot.json`（存档级快照）
- 运行时只读：游戏开始后规则集字段冻结，任何修改请求返回错误
- 存档兼容：旧存档无 `ruleSet` 字段时，加载自动填充为 `standard_slaughter_side` 预设包

### 8.4 与其他子系统的对接

| 对接子系统 | 读取的规则字段 | 用途 |
| :--- | :--- | :--- |
| [02 法官系统](./02-judge-system-design.md) | `base.nightBlackBox` / `base.singleKillPerNight` / `extensions.whiteWolfKing` | 真相剧本生成时约束击杀数量与手法 |
| [03 角色系统](./03-character-system-design.md) | `factionRatio` / `skillAssignment` | 阵营分配与神民技能分配 |
| [05 流程系统](./05-game-flow-design.md) | `base.firstNightProtection` / `extensions.sheriffElection` / `extensions.suicideWolf` | 阶段状态机的阶段增减与跳转条件 |
| [06 AI 驱动](./06-ai-driving-mechanism.md) | `extensions.chatBust` / `extensions.mixedBlood` | AI 行为决策树的策略分支 |

## 9. 跨文档引用

- 上游：[01-system-architecture.md](./01-system-architecture.md)（术语表、子系统职责矩阵）
- 规则来源：[逆转裁判+狼人杀规则.txt](../逆转裁判+狼人杀规则.txt)
- 类型真源：[src/shared/types/game.types.ts](../../src/shared/types/game.types.ts)、[src/shared/types/werewolf.types.ts](../../src/shared/types/werewolf.types.ts)（待创建）
- 常量真源：[src/shared/constants/werewolf.constants.ts](../../src/shared/constants/werewolf.constants.ts)（待创建）
- 下游：[02-judge-system-design.md](./02-judge-system-design.md)、[03-character-system-design.md](./03-character-system-design.md)、[05-game-flow-design.md](./05-game-flow-design.md)、[08-ui-ux-design.md](./08-ui-ux-design.md)
