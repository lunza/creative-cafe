# 05 - 狼人杀推理游戏流程设计

> 本文档定义狼人杀推理游戏 **流程系统**（04 子系统）的完整设计，覆盖八大阶段状态机、阶段进入/退出条件、UI 操作类型映射、夜间黑盒机制、晨间死亡判定与封锁、现场调查、证言收集、庭前推理打分、审判处刑、身份鉴定、日间活动各环节的设计与数据传递。所有术语严格遵循 [01-system-architecture.md](./01-system-architecture.md) 第 9 章术语表，核心机制严格对齐 [逆转裁判+狼人杀规则.txt](../逆转裁判+狼人杀规则.txt) 第 120-181 行。

## 1. 设计目标与边界

### 1.1 职责边界（摘自 [01-system-architecture.md](./01-system-architecture.md) §3）

| 项 | 内容 |
| :--- | :--- |
| 主要输入 | 阶段切换事件、规则配置（来自 [07-rule-system-design.md](./07-rule-system-design.md)） |
| 主要输出 | 阶段状态、UI 操作类型、阶段过渡动画 |
| 核心职责 | 八大阶段状态机、阶段进入/退出条件、阶段间数据传递 |
| 严格禁止 | 跳过强制阶段、违反状态机依赖 |

### 1.2 设计原则

- **状态机自实现**：依据架构文档 §6.1 建议，采用 `WerewolfPhase` 枚举 + `phaseTransitions` 转移表，不引入 xstate 依赖。
- **真相驱动**：晨间之后的所有阶段都由真相剧本（来自 [02-judge-system-design.md](./02-judge-system-design.md) §5）驱动。
- **地图协同**：阶段切换触发地图状态变更（对齐 [04-map-system-design.md](./04-map-system-design.md) §9.3）。
- **规则只读**：阶段状态机读取 [07-rule-system-design.md](./07-rule-system-design.md) 的 `firstNightProtection`、`sheriffElection`、`suicideWolf` 等字段以决定阶段增减与跳转条件。

## 2. 完整阶段状态机图

### 2.1 ASCII 状态机总览

```
                       ┌──────────────────────────────────────────┐
                       │                                          │
                       ▼                                          │
   [游戏初始化] ──▶ [首夜保护] ──仅 Day 1──┐                       │
                                          │                       │
                                          ▼                       │
   ┌──────────────────────────▶  [夜间 Phase] ◄─────────────┐    │
   │                              │                          │    │
   │                              │ ├─ 身份鉴定(可选)        │    │
   │                              │ ├─ 伪装者会议(黑盒)      │    │
   │                              │ ├─ 神民技能发动(黑盒)    │    │
   │                              │ └─ 击杀判定(黑盒)        │    │
   │                              │     → 真相剧本 JSON      │    │
   │                              ▼                          │    │
   │                       [晨间结算 06:00]                  │    │
   │                              │                          │    │
   │                              │ ├─ 死亡判定              │    │
   │                              │ └─ 封锁判定              │    │
   │                              ▼                          │    │
   │                       ┌─ 平安夜? ─┐                     │    │
   │                       │           │                     │    │
   │                    是 │           │ 否                  │    │
   │                       │           │                     │    │
   │                       ▼           ▼                     │    │
   │                  [审判处刑]  [现场调查]                 │    │
   │                       ▲           │                     │    │
   │                       │           ▼                     │    │
   │                       │      [证言收集]                 │    │
   │                       │           │                     │    │
   │                       │           ▼                     │    │
   │                       │      [庭前推理]                 │    │
   │                       │       (打分 优良中差)            │    │
   │                       │           │                     │    │
   │                       │           ▼                     │    │
   │                       └───────────┘                     │    │
   │                              │                          │    │
   │                              ▼                          │    │
   │                       [审判处刑]                         │    │
   │                       ├─ 辩护(力场禁言)                 │    │
   │                       ├─ 投票(玩家 2 票)                │    │
   │                       ├─ 笨蛋触发 → 临时休庭            │    │
   │                       ├─ 平票 → 最后辩护 → 再投票       │    │
   │                       └─ 处刑 + 遗言                   │    │
   │                              │                          │    │
   │                              ▼                          │    │
   │                       [胜负判定]                         │    │
   │                       ├─ 触发胜利 ──→ [胜利终止态]      │    │
   │                       ├─ 触发失败 ──→ [失败终止态]      │    │
   │                       └─ 继续                          │    │
   │                              │                          │    │
   │                              ▼                          │    │
   │                       [日间活动]                         │    │
   │                       ├─ 解除封锁                       │    │
   │                       ├─ 自由探索 + 监控调取            │    │
   │                       └─ 系统日间行为简报              │    │
   │                              │                          │    │
   └──────────────────────────────┘                          │    │
                                                              │    │
   注:首夜保护后 Day≥2 不再走首夜保护分支 ─────────────────────┘    │
                                                                    │
   [终止态]                                                         │
   ├─ [胜利] 伪装者全灭(对齐规则第 240 行)                          │
   └─ [失败] 屠边/屠城触发(对齐规则第 242 行)                       │
```

### 2.2 阶段枚举与转移表

```typescript
// src/shared/types/werewolf.types.ts

/** 狼人杀阶段枚举（对齐规则文档第 120-181 行） */
export enum WerewolfPhase {
  /** 游戏初始化 */
  INIT = 'init',
  /** 首夜保护（仅 Day 1） */
  FIRST_NIGHT_PROTECTION = 'first-night-protection',
  /** 夜间 00:00-06:00（黑盒） */
  NIGHT = 'night',
  /** 晨间结算 06:00 */
  MORNING_SETTLEMENT = 'morning-settlement',
  /** 现场调查（命案后） */
  INVESTIGATION = 'investigation',
  /** 证言收集（命案后） */
  TESTIMONY = 'testimony',
  /** 庭前推理（命案后） */
  REASONING = 'reasoning',
  /** 审判处刑（每日必走，对齐规则第 152 行） */
  TRIAL = 'trial',
  /** 笨蛋触发的临时休庭子阶段 */
  RECESS = 'recess',
  /** 平票重投子阶段 */
  REVOTE = 'revote',
  /** 日间活动 */
  DAYTIME = 'daytime',
  /** 胜利终止态 */
  VICTORY = 'victory',
  /** 失败终止态 */
  DEFEAT = 'defeat',
}

/** 阶段转移表（自实现状态机，对齐架构文档 §6.1） */
export const phaseTransitions: Record<WerewolfPhase, WerewolfPhase[]> = {
  [WerewolfPhase.INIT]: [WerewolfPhase.FIRST_NIGHT_PROTECTION],
  [WerewolfPhase.FIRST_NIGHT_PROTECTION]: [WerewolfPhase.NIGHT],
  [WerewolfPhase.NIGHT]: [WerewolfPhase.MORNING_SETTLEMENT],
  [WerewolfPhase.MORNING_SETTLEMENT]: [
    WerewolfPhase.INVESTIGATION, // 命案
    WerewolfPhase.TRIAL,         // 平安夜跳过调查直接审判
  ],
  [WerewolfPhase.INVESTIGATION]: [WerewolfPhase.TESTIMONY],
  [WerewolfPhase.TESTIMONY]: [WerewolfPhase.REASONING],
  [WerewolfPhase.REASONING]: [WerewolfPhase.TRIAL],
  [WerewolfPhase.TRIAL]: [
    WerewolfPhase.RECESS,    // 笨蛋触发
    WerewolfPhase.REVOTE,    // 平票重投
    WerewolfPhase.DAYTIME,   // 处刑完成
    WerewolfPhase.VICTORY,   // 胜利触发
    WerewolfPhase.DEFEAT,    // 失败触发
  ],
  [WerewolfPhase.RECESS]: [WerewolfPhase.TRIAL],
  [WerewolfPhase.REVOTE]: [
    WerewolfPhase.TRIAL,     // 处刑完成
    WerewolfPhase.DAYTIME,   // 二次平票跳过处刑
    WerewolfPhase.VICTORY,
    WerewolfPhase.DEFEAT,
  ],
  [WerewolfPhase.DAYTIME]: [WerewolfPhase.NIGHT, WerewolfPhase.VICTORY, WerewolfPhase.DEFEAT],
  [WerewolfPhase.VICTORY]: [],
  [WerewolfPhase.DEFEAT]: [],
};
```

## 3. 阶段进入/退出条件矩阵

| 阶段 | 进入条件 | 退出条件 | 跳过条件 | 强制 |
| :--- | :--- | :--- | :--- | :--- |
| **首夜保护** | 游戏初始化完成且 `firstNightProtection=true` | 玩家确认开始夜间 | Day≥2 自动跳过 | ✅ Day 1 不可跳过 |
| **夜间** | 首夜保护完成 / 日间活动结束 | 06:00 到达或玩家手动结算 | — | ✅ |
| **晨间结算** | 夜间结束 | 死亡与封锁判定完成 | — | ✅ |
| **现场调查** | 晨间判定发生命案 | 玩家选择离开现场且无未收集关键证据提示被接受 | 平安夜直接进入审判（规则第 152 行） | ❌ |
| **证言收集** | 现场调查完成 | 所有存活角色被询问完毕或玩家放弃询问 | 平安夜 | ❌ |
| **庭前推理** | 证言收集完成 | 玩家提交推理结论 | 平安夜 | ❌ |
| **审判处刑** | 庭前推理完成 / 平安夜播报 | 处刑执行完成或跳过处刑 | 无（每日必走，规则第 152 行） | ✅ |
| **临时休庭** | 笨蛋得票过半（首次触发） | 玩家与笨蛋单独谈话结束 | 笨蛋已触发过临时休庭 | ❌ |
| **平票重投** | 归票出现平票 | 二次投票完成 | 二次投票仍平票则跳过处刑 | ❌ |
| **日间活动** | 审判处刑完成 | 00:00 到达或玩家手动进入夜间 | — | ✅ |
| **胜负判定** | 任何处刑/技能/晨间结算后 | 评估完成 | — | ✅ |
| **胜利/失败** | 胜负判定触发终止条件 | — | — | 终止态 |

## 4. 各阶段 UI 操作类型映射

依据架构文档 §3 子系统职责矩阵与 [08-ui-ux-design.md](./08-ui-ux-design.md) 的 UI 设计规范，各阶段映射到不同的 UI 操作类型：

| 阶段 | UI 操作类型 | 主要 UI 组件 | 交互模式 |
| :--- | :--- | :--- | :--- |
| **首夜保护** | 系统播报式 | `NarrativePanel` + 确认按钮 | 单向播报，玩家点击"开始夜间" |
| **夜间** | 黑盒等待式 | 全屏遮罩 + 进度提示 | 无操作，等待真相剧本生成 |
| **晨间结算** | 表格播报式 | `Table` 死亡判定表 + 警报动画 | 单向播报 |
| **现场调查** | **按钮选择式** | 按钮清单（可搜索点位） | 玩家点击按钮搜索现场 |
| **证言收集** | **对话式** | `NarrativePanel` 对话流 + 证物出示栏 | 玩家质询/出示证物/威慑 |
| **庭前推理** | **推理工作台式** | 证物表 + 证言表 + 推理输入区 | 玩家拖拽证物构建推理链 |
| **审判处刑** | 投票面板式 | 辩护流 + 投票按钮（玩家 2 票） | 顺序辩护 + 同时投票 |
| **临时休庭** | 私密对话式 | `NarrativePanel` 单独通道 | 玩家与笨蛋 1v1 对话 |
| **平票重投** | 投票面板式 | 复用审判投票面板 + 最后辩护流 | 二次投票 |
| **日间活动** | **对话式** + 自由探索 | 地图瓦片 + 角色对话 + 监控调取面板 | 玩家自由移动与互动 |
| **证言整理** | **表格式** | 证言信息表（对齐规则 §C） | 自动整理，玩家只读 |
| **证据展示** | **表格式** | 证物表（对齐规则 §B） | 自动整理，玩家只读 |
| **胜利/失败** | 结算页式 | 评分卡 + 评级展示 | 单向播报，玩家可选择重开 |

### 4.1 UI 操作类型 TypeScript 映射

```typescript
// src/shared/types/werewolf.types.ts

/** UI 操作类型枚举 */
export type PhaseUIType =
  | 'broadcast'          // 系统播报式
  | 'blackbox-wait'      // 黑盒等待式
  | 'table-broadcast'    // 表格播报式
  | 'button-selection'   // 按钮选择式（现场调查）
  | 'dialogue'           // 对话式（证言收集、日间活动）
  | 'table-readonly'     // 表格式（证言整理、证据展示）
  | 'reasoning-bench'    // 推理工作台式（庭前推理）
  | 'voting-panel'       // 投票面板式（审判处刑）
  | 'private-dialogue'  // 私密对话式（临时休庭）
  | 'free-explore'       // 自由探索式（日间活动）
  | 'settlement';        // 结算页式

/** 阶段 UI 映射表 */
export const phaseUITypeMap: Record<WerewolfPhase, PhaseUIType> = {
  [WerewolfPhase.FIRST_NIGHT_PROTECTION]: 'broadcast',
  [WerewolfPhase.NIGHT]: 'blackbox-wait',
  [WerewolfPhase.MORNING_SETTLEMENT]: 'table-broadcast',
  [WerewolfPhase.INVESTIGATION]: 'button-selection',
  [WerewolfPhase.TESTIMONY]: 'dialogue',
  [WerewolfPhase.REASONING]: 'reasoning-bench',
  [WerewolfPhase.TRIAL]: 'voting-panel',
  [WerewolfPhase.RECESS]: 'private-dialogue',
  [WerewolfPhase.REVOTE]: 'voting-panel',
  [WerewolfPhase.DAYTIME]: 'free-explore',
  [WerewolfPhase.VICTORY]: 'settlement',
  [WerewolfPhase.DEFEAT]: 'settlement',
};
```

## 5. 夜间黑盒机制设计

严格对齐规则文档第 122-134 行。

### 5.1 黑盒约束

| 约束项 | 说明 |
| :--- | :--- |
| **时段** | 每日 00:00-06:00 |
| **明文禁令** | 系统不记录任何明文对话/行为描述 |
| **可见层** | 仅生成真相剧本 JSON，玩家与其他 AI 角色均不可见 |
| **持久化路径** | `data/games/<gameId>/saves/<saveId>/truth-script/<dayIndex>.json` |

### 5.2 真相剧本生成要素

真相剧本须涵盖（对齐规则第 132 行）：

- **时间**：每起凶案的精确时间（HH:mm，00:00-06:00 之间）
- **地点**：层级 + 房间/区域（如 `F2-#F205`）
- **凶手/帮凶**：伪装者角色 ID 列表
- **被害人**：好人角色 ID
- **手法/凶器**：杀害手法描述、凶器名称与来源
- **凶器来源与处理**：凶器从何处取得、如何销毁/带离
- **证据销毁与栽赃嫁祸**：销毁动作与残留痕迹、栽赃的目标角色与伪证据
- **提前准备**：白天先获取被害人好感、提前准备凶器等
- **技能发动**：药剂师/保安/笨蛋/黑客的技能发动记录
- **目击者**：2 人房间场景下必产生的目击者记录
- **可搜索点位**：基于真相生成的现场点位清单（含干扰点位）
- **关键证物**：用于现场调查返回给玩家的证据列表

> 详细 TypeScript Interface 定义见 [02-judge-system-design.md](./02-judge-system-design.md) §5.2。

### 5.3 黑盒执行流程

```typescript
// src/main/services/game/werewolf/NightPhaseExecutor.ts

class NightPhaseExecutor {
  /** 执行夜间黑盒流程 */
  async execute(saveId: string, dayIndex: number, ruleSet: WerewolfRuleSet): Promise<void> {
    // 1. 首夜保护判定（仅 Day 1）
    if (dayIndex === 1 && ruleSet.base.firstNightProtection) {
      await this.executeFirstNightProtection(saveId);
      return;
    }

    // 2. 切换地图到夜间态（对齐 04-map §9.1）
    await mapRuntimeService.applyNightState(saveId);

    // 3. 调用 WerewolfJudgeService 生成真相剧本（不经过 GameNarrativeService）
    const truthScript = await werewolfJudgeService.generateTruthScript(saveId, dayIndex);

    // 4. 处理技能发动副作用（药剂师救助 → 被害人移送医疗室；黑客保护 → 全息影像代死）
    await this.applySkillSideEffects(saveId, truthScript);

    // 5. 持久化真相剧本（玩家不可见）
    await truthScriptRepository.persist(saveId, dayIndex, truthScript);

    // 6. 切换阶段到晨间结算
    await phaseMachine.transition(saveId, WerewolfPhase.MORNING_SETTLEMENT);
  }
}
```

### 5.4 首夜保护机制

- **触发条件**：`dayIndex === 1 && ruleSet.base.firstNightProtection === true`
- **效果**：第一夜 `truthScript.isPeacefulNight` 强制为 `true`，`incidents` 为空数组
- **保留要素**：仍需生成伪装者会议记录与神民技能发动记录（用于后续 AI 上下文初始化）

## 6. 晨间死亡判定与封锁机制

严格对齐规则文档第 135-141 行。

### 6.1 死亡判定播报格式

| 场景 | 播报格式 | 后续流程 |
| :--- | :--- | :--- |
| **发生命案** | "空气中弥漫着血腥味……犯罪地点为：【尸体发现的地点】" | 触发封锁机制 → 进入现场调查 |
| **平安夜** | "今天是平安夜" | 跳过现场调查直接进入审判处刑（规则第 152 行） |

### 6.2 警报与禁闭规则

命案发生后系统立即拉响警报，触发封锁机制（对齐 [04-map-system-design.md](./04-map-system-design.md) §9.1）：

- **强制禁闭**：所有角色被强制禁闭于各自所在地图区域
- **门禁锁死**：所有门禁锁死，电梯停运
- **瓦片标记**：受影响区域瓦片叠加 `*` 标记与红色背景
- **持续阶段**：现场调查 + 证言收集（覆盖整个调查链）
- **力场保护**：审判处刑环节所有人在编号座位上被力场保护且不可自由移动（对齐规则第 162 行）

### 6.3 封锁解锁条件

| 解锁触发器 | 触发时机 | 持续影响 |
| :--- | :--- | :--- |
| **庭前推理完成** | 玩家提交推理结论并完成打分 | 仅解锁会议室通向审判厅路径 |
| **审判处刑结束** | 处刑执行完成或跳过处刑 | 全地图解锁，进入日间活动 |
| **日间活动开始** | 阶段转移到 `DAYTIME` | 门禁恢复，电梯恢复，瓦片去除 `*` |

### 6.4 晨间结算执行流程

```typescript
// src/main/services/game/werewolf/MorningSettlementExecutor.ts

class MorningSettlementExecutor {
  async execute(saveId: string, dayIndex: number): Promise<void> {
    const truthScript = await truthScriptRepository.load(saveId, dayIndex);

    // 1. 死亡判定
    const deaths = this.determineDeaths(truthScript);
    const hasIncident = deaths.length > 0;

    // 2. 播报
    if (hasIncident) {
      const incident = deaths[0];
      await narrativeService.broadcast(saveId,
        `空气中弥漫着血腥味……犯罪地点为：【${incident.location}】`
      );
      // 3. 触发封锁
      await mapRuntimeService.applyLockdown(saveId, [incident.location]);
      // 4. 进入现场调查
      await phaseMachine.transition(saveId, WerewolfPhase.INVESTIGATION);
    } else {
      await narrativeService.broadcast(saveId, '今天是平安夜');
      // 平安夜跳过调查直接进入审判（规则第 152 行）
      await phaseMachine.transition(saveId, WerewolfPhase.TRIAL);
    }
  }
}
```

## 7. 现场调查环节设计

严格对齐规则文档第 142-146 行。

### 7.1 按钮清单生成规则

法官 AI 基于真相剧本为犯罪地点房间生成可搜索点位按钮清单：

- **关键证据点位**：与真相剧本 `keyEvidences` 关联的点位
- **干扰点位**：与真相剧本无关的点位（规则第 145 行明确要求"包括和真相剧本无关的地点"）
- **按钮展示**：以按钮形式呈现，玩家通过点击按钮检查现场
- **法官禁止提示**：法官不得对按钮选择进行提示，但玩家前往下一地图区域前可提示"尚有 X 个关键证据未收集，是否离开？"（规则第 145 行，唯一允许的提示）

### 7.2 与真相剧本的关联

```typescript
// src/main/services/game/werewolf/InvestigationExecutor.ts

class InvestigationExecutor {
  /** 生成犯罪现场信息表（对齐规则 §B） */
  async buildCrimeSceneTable(saveId: string, dayIndex: number): Promise<CrimeSceneTable> {
    const truthScript = await truthScriptRepository.load(saveId, dayIndex);
    const incident = truthScript.incidents[0];

    return {
      victim: {
        characterId: incident.victimId,
        deathState: incident.method,
        bodyDamage: this.describeBodyDamage(incident),
        woundShape: this.describeWound(incident),
      },
      location: {
        areaId: incident.location,
        messiness: this.describeSceneState(incident),
        hasStruggle: this.detectStruggle(incident),
      },
      keyEvidences: incident.keyEvidences.map(e => ({
        name: e.name,
        description: e.description,
        raceSpecific: e.raceSpecific,
      })),
      surveillanceResidue: await this.buildSurveillanceResidue(incident),
      specialAnomaly: this.detectAnomaly(incident),
    };
  }

  /** 生成可搜索点位按钮清单（含干扰点位） */
  async buildSearchablePoints(saveId: string, dayIndex: number): Promise<SearchablePoint[]> {
    const truthScript = await truthScriptRepository.load(saveId, dayIndex);
    const incident = truthScript.incidents[0];

    // 关键证据点位（来自真相剧本）
    const keyPoints = incident.searchablePoints;

    // 干扰点位（法官 AI 随机生成，对齐规则第 145 行）
    const decoyPoints = await werewolfJudgeService.generateDecoyPoints(incident.location);

    // 打乱顺序后返回（避免玩家通过按钮顺序推测关键点位）
    return shuffle([...keyPoints, ...decoyPoints]);
  }
}
```

### 7.3 关键证据可被带离现场

部分关键证据可能被凶手带离犯罪现场（对齐规则第 144 行），此类证据不会出现在犯罪地点的按钮清单中，需玩家在后续证言收集环节从其他角色房间或角色身上发现。

### 7.4 未收集证据提示

玩家前往下一地图区域前，法官提示"尚有 X 个关键证据未收集，是否离开？"：

- **X 的计算**：犯罪地点剩余未搜索的关键证据点位数量
- **提示形式**：仅数量提示，不指向具体证据位置（对齐 [02-judge-system-design.md](./02-judge-system-design.md) §3.4 唯一例外）
- **玩家选择**：可继续搜索或确认离开

## 8. 证言收集环节设计

严格对齐规则文档第 147-150 行，参考逆转裁判风格。

### 8.1 质询流程

1. **房间内景扫描**：玩家进入某角色所在房间质询前，法官 AI 扫描该房间的内景（对齐规则第 148 行）
2. **房间点位生成**：基于真相同样为当前房间生成可搜索点位按钮清单
3. **角色质询**：玩家可向角色询问：
   - 不在场证明（案发 24:00-06:00 期间的行为）
   - 听到的声音
   - 注意到的异常
   - 针对他人的指控或疑点观察
4. **情绪压力测试**：通过角色对话的语气、微表情（仅由 AI 模拟，不暴露阵营）观察

### 8.2 出示证物流程

- 玩家可基于已获取的证物对角色进行出示（对齐规则第 149 行）
- 角色需对证物进行符合其身份的说明或撒谎
- 伪装者撒谎时遵循"心理素质极强、绝不露出破绽"原则（规则第 23 行）
- 仅在玩家出示决定性证据后，伪装者才可能露出破绽（规则第 12 行）

### 8.3 威慑流程

- 玩家可对角色陈述进行威慑
- 威慑可能引出新的证言细节或矛盾点
- 伪装者威慑后仍维持自然反应，不暴露阵营
- 普通好人威慑后可能透露更多细节信息

### 8.4 撒谎机制

| 角色类型 | 撒谎倾向 | 撒谎触发 | 破绽暴露条件 |
| :--- | :--- | :--- | :--- |
| **普通好人** | 低（仅在保护自己或他人时） | 不在场证明造假、隐瞒私密行为 | 出示与之矛盾的证物 |
| **神民** | 中（保护技能身份） | 隐瞒技能发动、伪造普通行为 | 出示技能发动相关证据 |
| **伪装者** | 高（系统性撒谎） | 不在场证明、目击者灭口、栽赃嫁祸 | 仅在玩家出示决定性证据后 |

### 8.5 证言表格整理格式

完成对单个角色的证言后，法官整理到证言表格中（对齐规则 §C）：

```typescript
// src/shared/types/werewolf.types.ts

/** 证言条目 */
interface TestimonyEntry {
  /** 编号（#01、#02…） */
  index: number;
  /** 角色姓名（带暗码，对齐 [02-judge-system-design.md](./02-judge-system-design.md) §4） */
  characterName: string;
  /** 案发时不在场证明（24:00 - 06:00） */
  alibi: string;
  /** 针对他人的指控或疑点观察 */
  accusations: string;
  /** 情绪压力测试结果 */
  emotionPressure: {
    tone: '镇定' | '焦躁' | '恐惧' | '愤怒' | '冷漠';
    emoji: string; // 如 🧊、💢、😨
  };
}
```

证言表示例（对齐规则 §C）：

| 编号 | 角色姓名 | 不在场证明 | 针对他人的指控 | 情绪 |
| :---: | :--- | :--- | :--- | :--- |
| #01 | `<span style="color:#4682B4">朱迪<!-- 好 --></span>` | "我一直在房间睡觉，中途听到走廊有脚步声。" | "我看到 #05 昨天在储藏室鬼鬼祟祟。" | [镇定] 🧊 |
| #02 | `<span style="color:#9E9E9E">露娜<!-- 伪 --></span>` | "我在 F2 翻看资料，快两点才回房。" | "#01 在撒谎，我回房时没听到脚步声。" | [焦躁] 💢 |

## 9. 庭前推理打分机制

严格对齐规则文档第 150 行。

### 9.1 推理工作台

玩家基于证物表与证言表进行犯罪过程推理，UI 采用推理工作台式：

- **左侧证物区**：列出已收集的证物
- **右侧证言区**：列出已整理的证言表
- **中央推理输入区**：玩家拖拽证物与证言构建推理链，输入凶手指认与作案手法推断
- **提交按钮**：玩家确认推理结论后提交

### 9.2 法官禁止行为

- 法官**不可对玩家进行推理提示**
- 法官**不可帮助玩家进行推理和分析**
- 玩家可能做出错误判断，法官**禁止通过任何形式给出提示**（对齐规则第 13 行）

### 9.3 打分机制

玩家提交推理后，法官基于真相剧本打分，**仅回复"优/良/中/差"四档，禁止回复其他信息**（对齐规则第 150 行）。

打分维度与公式详见 [02-judge-system-design.md](./02-judge-system-design.md) §7.1：

| 等级 | 标准 |
| :--- | :--- |
| 优 | 凶手指认正确 + 手法推断正确 + 关键证据全部收集 |
| 良 | 凶手指认正确 + 手法推断部分正确 + 关键证据收集 ≥ 60% |
| 中 | 凶手指认错误但推理逻辑自洽 / 关键证据收集 30%-60% |
| 差 | 凶手指认错误且推理逻辑混乱 / 关键证据收集 < 30% |

### 9.4 打分后流程

打分完成后法官**仅通知所有存活角色前往会议室开始审判**，不解释打分依据（规则第 150 行）。

```typescript
// src/main/services/game/werewolf/ReasoningExecutor.ts

class ReasoningExecutor {
  async submit(saveId: string, dayIndex: number, input: ReasoningScoreInput): Promise<ReasoningGrade> {
    // 调用法官打分（仅返回优良中差，对齐 02-judge §7.1）
    const grade = werewolfJudgeService.scoreReasoning(input);

    // 持久化打分结果到存档（用于整局打分，对齐 02-judge §7.2）
    await reasoningScoreRepository.persist(saveId, dayIndex, grade);

    // 仅返回四档等级，禁止附带任何其他信息
    return grade;
  }
}
```

## 10. 审判环节设计

严格对齐规则文档第 152-166 行。

### 10.1 辩护环节

- **力场保护**：所有人在自己编号所在的座位上被力场保护且不可自由移动（规则第 162 行）
- **辩护顺序**：按玩家（典狱长）指定的顺序进行正序或逆序发言（规则第 163 行）
- **禁止插话**：在角色发言期间其他角色严禁插话或打断（规则第 163 行）
- **玩家总结**：所有角色完成发言后由玩家进行总结并公布推理结果，然后进入投票

### 10.2 投票环节

- **记名投票**：所有角色同时记名投票或弃票（规则第 164 行）
- **玩家 2 票**：典狱长拥有 2 票（对齐 [01-system-architecture.md](./01-system-architecture.md) §1.2 与 [07-rule-system-design.md](./07-rule-system-design.md) §2.6）
- **指认伪装者**：投票指认心中的"伪装者"

### 10.3 归票与处刑

- **得票最高者处刑**：统计票数后得票最高者将被系统执行处刑（规则第 165 行）
- **遗言机制**：处刑前可以交代遗言（规则第 165 行）
- **处刑方式由玩家决定**：处刑方式由典狱长决定（规则第 165 行）

### 10.4 平票处理

平票处理流程（规则第 165 行）：

1. **平票角色最后辩护**：允许平票角色进行最后辩护
2. **再次投票**：然后再次进行处刑投票
3. **得票超过半数继续处刑**：若得票超过半数则继续处刑
4. **再次平票跳过处刑**：如再次发生平票则跳过处刑

### 10.5 笨蛋触发临时休庭

- **触发条件**：笨蛋得票**超过半数**依旧不被票出（对齐 [03-character-system-design.md](./03-character-system-design.md) §5.3）
- **临时休庭**：触发后进入 `RECESS` 子阶段
- **单独谈话**：笨蛋获得一次单独与玩家（典狱长）谈话的机会
- **一次性**：临时休庭能力整局只能触发一次

### 10.6 审判 AI 策略行为

审判环节中 AI 角色将随机采用以下传统狼人杀策略行为（规则第 154-160 行）：

1. **对跳/悍跳**：伪装者主动冒充持有技能的好人身份
2. **金水/银水**：金水是被预言家查验为好人的角色；银水是被伪装者击杀过但由于药剂师或黑客营救未死的角色
3. **查杀**：预言家直接指认某人为伪装者
4. **悍跳反水**：伪装者故意攻击自己的队友来骗取玩家信任
5. **深水狼/倒钩狼**：伪装者采取极端低调策略或指认队友策略
6. **退水**：冒充神民者遭到质疑后放弃身份

### 10.7 审判执行流程

```typescript
// src/main/services/game/werewolf/TrialExecutor.ts

class TrialExecutor {
  async execute(saveId: string, dayIndex: number): Promise<void> {
    // 1. 通知所有存活角色前往会议室（审判厅）
    await this.summonToCourt(saveId);

    // 2. 辩护环节（按玩家指定顺序）
    const defenseOrder = await this.collectDefenseOrder(saveId);
    for (const characterId of defenseOrder) {
      await this.conductDefense(saveId, characterId); // 力场保护，禁止插话
    }

    // 3. 玩家总结 + 公布推理结果
    await this.playerSummary(saveId);

    // 4. 投票环节（玩家 2 票 + AI 各 1 票，同时记名投票）
    const voteResult = await this.conductVoting(saveId);

    // 5. 归票
    const tally = this.tallyVotes(voteResult);

    // 6. 笨蛋触发判定
    if (this.checkFoolTrigger(tally)) {
      await phaseMachine.transition(saveId, WerewolfPhase.RECESS);
      return;
    }

    // 7. 平票处理
    if (tally.isTie) {
      await phaseMachine.transition(saveId, WerewolfPhase.REVOTE);
      return;
    }

    // 8. 处刑（玩家决定方式）+ 遗言
    await this.executeExecution(saveId, tally.topVotedId);

    // 9. 胜负判定
    const winResult = ruleService.evaluateWinCondition(state, ruleSet);
    if (winResult.winner) {
      await phaseMachine.transition(saveId, winResult.winner === 'good'
        ? WerewolfPhase.VICTORY : WerewolfPhase.DEFEAT);
      return;
    }

    // 10. 进入日间活动
    await phaseMachine.transition(saveId, WerewolfPhase.DAYTIME);
  }
}
```

## 11. 身份鉴定环节设计

严格对齐规则文档第 167-172 行，作为夜间阶段的子流程。

### 11.1 鉴定方式

- **预言家能力**：玩家（典狱长）每晚通过性接触方式识别一名角色的真实身份（规则第 169 行）
- **鉴定过程**：由 AI 输出叙事
- **鉴定结果**：最终给出一个鉴定结果

### 11.2 鉴定限制

| 限制项 | 说明 | 规则依据 |
| :--- | :--- | :--- |
| **鉴定地点** | 必须在医疗室的特殊床位进行 | 规则第 171 行 |
| **力场充能** | 特殊床位拥有削弱伪装者能力的力场，力场每天拥有一次充能，鉴定需消耗充能 | 规则第 171 行 |
| **鉴定时段** | 只能在夜间（00:00-06:00）进行 | 规则第 171 行 |
| **力场消失** | 在力场消失时以下所有鉴定规则均视为失效 | 规则第 171 行 |

### 11.3 鉴定结果输出

- **绝对正确**：玩家在力场下的鉴定结果绝对正确（规则第 172 行）
- **仅两档结果**：鉴定结果只能是【好人】或【伪装者】（规则第 172 行）
- **禁止技能标签**：严禁出现【药】【保】等技能相关标签
- **结果通报**：鉴定结果第一时间由法官通报给所有人并添加到他们的数据库中（规则第 172 行）

### 11.4 鉴定执行流程

```typescript
// src/main/services/game/werewolf/IdentificationExecutor.ts

class IdentificationExecutor {
  /** 在夜间阶段发起身份鉴定 */
  async identify(saveId: string, targetId: string): Promise<IdentificationResult> {
    const mapState = await mapRuntimeService.load(saveId);

    // 1. 校验时段（必须夜间 00:00-06:00）
    if (mapState.phase !== 'night') {
      throw new Error('身份鉴定只能在夜间 00:00-06:00 进行');
    }

    // 2. 校验地点（必须在医疗室特殊床位）
    if (!await this.isAtMedicalBed(saveId, targetId)) {
      throw new Error('身份鉴定必须在医疗室的特殊床位进行');
    }

    // 3. 校验力场充能（每日 1 次）
    if (mapState.medicalForceFieldCharge <= 0) {
      throw new Error('医疗室力场已耗尽，今日无法鉴定');
    }

    // 4. 消耗充能
    await mapRuntimeService.consumeForceFieldCharge(saveId);

    // 5. 查询真实阵营（仅【好人】或【伪装者】）
    const factionCode = await factionCodesRepository.load(saveId, targetId);
    const isImpostor = factionCode === '伪';
    const result: IdentificationResult = isImpostor ? 'impostor' : 'good';

    // 6. 通报给所有存活角色（添加到 AI 上下文）
    await this.broadcastIdentification(saveId, targetId, result);

    return result;
  }
}

/** 鉴定结果（仅两档，严禁技能标签） */
type IdentificationResult = 'good' | 'impostor';
```

## 12. 日间活动环节设计

严格对齐规则文档第 174-181 行。

### 12.1 触发条件

- 审判处刑结束后触发（对齐规则第 175 行）
- 平安夜播报后也直接进入日间活动（平安夜跳过现场调查直接审判，审判后进入日间）

### 12.2 全域监控

- **监控覆盖**：所有公共地图区域均开启监控摄像头（对齐 [04-map-system-design.md](./04-map-system-design.md) §7.1）
- **监控查询**：监控情况依赖系统日报和录像调取
- **调取流程**：玩家点击公共区域瓦片 → 弹出"监控调取"面板 → 法官 AI 基于真相剧本返回该时段监控残留信息

### 12.3 行为规则

- **伪装者不主动杀戮**：伪装者在午夜 12 点前绝不会主动发动杀戮（规则第 178 行）
- **可提前准备**：伪装者可进行准备工作，如准备凶器、布置现场、获取被害人好感等
- **监控留痕**：伪装者的准备工作有可能通过监控摄像头留下蛛丝马迹（规则第 178 行）
- **角色自由行动**：角色可在全地图内自由行动，进行饮食、锻炼、交友、游戏、做爱、骚扰玩家等日常行为
- **拉帮结派**：通过拉帮结派、博取玩家好感等方式为自己在审判环节取得更多优势

### 12.4 系统日间行为简报

日间活动结束时，系统自动向玩家报送每位角色的日间行为总结（规则第 180 行）：

```typescript
// src/shared/types/werewolf.types.ts

/** 角色日间行为简报条目 */
interface DaytimeBehaviorSummary {
  /** 角色 ID */
  characterId: string;
  /** 角色姓名（带暗码） */
  characterName: string;
  /** 主要活动区域 */
  primaryAreas: string[];
  /** 关键行为摘要 */
  keyBehaviors: string[];
  /** 与其他角色的互动 */
  interactions: Array<{
    targetCharacterId: string;
    interactionType: 'conversation' | 'cooperation' | 'conflict' | 'intimacy';
    brief: string;
  }>;
  /** 监控残留（仅在公共区域活动时） */
  surveillanceTraces?: string[];
}
```

### 12.5 日间活动执行流程

```typescript
// src/main/services/game/werewolf/DaytimeExecutor.ts

class DaytimeExecutor {
  async execute(saveId: string, dayIndex: number): Promise<void> {
    // 1. 解除封锁（对齐 04-map §9.1）
    await mapRuntimeService.applyUnlock(saveId);

    // 2. 切换地图到日间态（监控全覆盖）
    await mapRuntimeService.applyDaytimeState(saveId);

    // 3. 触发 AI 角色自由行动（伪装者可准备，不主动杀戮）
    const behaviors = await aiBehaviorSimulator.simulateDaytimeActions(saveId, dayIndex);

    // 4. 玩家自由探索 + 监控调取
    await this.enablePlayerExploration(saveId);

    // 5. 00:00 到达或玩家手动进入夜间
    await this.waitForNightTransition(saveId);

    // 6. 生成系统日间行为简报
    const summaries = await this.buildDaytimeSummaries(saveId, behaviors);
    await narrativeService.broadcast(saveId, this.renderSummaries(summaries));

    // 7. 胜负判定（日间可能触发技能副作用）
    const winResult = ruleService.evaluateWinCondition(state, ruleSet);
    if (winResult.winner) {
      await phaseMachine.transition(saveId, winResult.winner === 'good'
        ? WerewolfPhase.VICTORY : WerewolfPhase.DEFEAT);
      return;
    }

    // 8. 进入下一夜
    await phaseMachine.transition(saveId, WerewolfPhase.NIGHT);
  }
}
```

## 13. 阶段间数据传递

### 13.1 数据流向总览

| 数据 | 来源 | 去向 | 持久化路径 |
| :--- | :--- | :--- | :--- |
| **真相剧本** | 夜间阶段 | 晨间结算、现场调查、证言收集、庭前推理打分 | `truth-script/<dayIndex>.json` |
| **证据链** | 现场调查、证言收集 | 庭前推理、审判处刑 | `evidence.json` |
| **证言** | 证言收集 | 庭前推理、审判处刑 | `testimony.json` |
| **推理打分** | 庭前推理 | 整局打分 | `reasoning-scores/<dayIndex>.json` |
| **投票结果** | 审判处刑 | 处刑执行、胜负判定 | `vote-records/<dayIndex>.json` |
| **日间行为简报** | 日间活动 | 玩家可见、AI 上下文更新 | `daytime-summaries/<dayIndex>.json` |
| **鉴定结果** | 身份鉴定 | 所有 AI 上下文更新 | `identification-records/<dayIndex>.json` |
| **地图运行时状态** | 所有阶段 | 地图系统 | `map-runtime-state.json` |

### 13.2 阶段间数据隔离

依据 [01-system-architecture.md](./01-system-architecture.md) §4.2 数据隔离矩阵：

- **真相剧本层**：仅法官 AI 可见，玩家与其他 AI 角色不可见
- **证据链层**：玩家与法官可见，AI 角色仅在玩家出示后可见
- **证言层**：玩家与法官与已询问角色可见，未询问角色不可见
- **暗码层**：仅法官 AI 可见，初始化后不变

## 14. 与既有框架的集成

### 14.1 状态机集成方案

阶段状态机集中在前端 `gameStore` 与 `gameUIStore`（对齐架构文档 §6.1 建议），主进程仅负责数据持久化：

```typescript
// src/renderer/stores/gameStore.ts（扩展既有 store）

interface WerewolfGameState {
  /** 当前阶段 */
  currentPhase: WerewolfPhase;
  /** 当前天数（从 1 开始） */
  dayIndex: number;
  /** 阶段历史 */
  phaseHistory: Array<{ phase: WerewolfPhase; enteredAt: string; exitedAt: string }>;
  /** 当前 UI 操作类型 */
  currentUIType: PhaseUIType;
}

interface WerewolfGameActions {
  /** 阶段转移 */
  transitionPhase: (target: WerewolfPhase) => Promise<void>;
  /** 获取当前阶段可进入的下一阶段 */
  getValidTransitions: () => WerewolfPhase[];
}
```

### 14.2 与 GameNarrativeService 的协作

- **叙事场景**（晨间播报、辩护、证言、日间对话）：通过 [`GameNarrativeService`](../../src/main/services/game/GameNarrativeService.ts) 调用 [`AIService.streamChatAPI`](../../src/main/services/AIService.ts)，复用既有流式回调与 tableEdit 解析（对齐 [02-judge-system-design.md](./02-judge-system-design.md) §8.2.2 钩子 1）
- **非叙事场景**（真相剧本生成、庭前推理打分、整局打分）：由 `WerewolfJudgeService` 直接调用 `AIService.streamChatAPI`，不经过 `GameNarrativeService`

### 14.3 与 PageTransition 的协作

阶段切换动画复用既有 [`PageTransition`](../../src/renderer/components/Layout/PageTransition.tsx) 组件（对齐架构文档 §5 复用清单）：

- 阶段转移时触发淡入淡出过渡
- 终止态（胜利/失败）使用专属结算动画

## 15. 跨文档引用

| 引用对象 | 路径 | 用途 |
| :--- | :--- | :--- |
| 系统架构总览 | [./01-system-architecture.md](./01-system-architecture.md) | 术语表、子系统职责矩阵、数据流向 |
| 规则剧本 | [../逆转裁判+狼人杀规则.txt](../逆转裁判+狼人杀规则.txt) | 核心机制原始来源（第 120-181 行） |
| 法官系统设计 | [./02-judge-system-design.md](./02-judge-system-design.md) | 真相剧本格式、打分机制、监管扫描 |
| 角色系统设计 | [./03-character-system-design.md](./03-character-system-design.md) | 神民技能、笨蛋临时休庭、阵营分配 |
| 地图系统设计 | [./04-map-system-design.md](./04-map-system-design.md) | 地图状态变更触发、监控覆盖、可搜索点位 |
| 规则系统设计 | [./07-rule-system-design.md](./07-rule-system-design.md) | 首夜保护、警上警下、胜负判定 |
| AI 驱动机制 | [./06-ai-driving-mechanism.md](./06-ai-driving-mechanism.md) | AI 行为决策树、伪装者策略 |
| UI/UX 设计 | [./08-ui-ux-design.md](./08-ui-ux-design.md) | 各阶段 UI 组件线框图 |
| 数据库设计 | [./09-database-design.md](./09-database-design.md) | 阶段数据持久化结构 |
| 核心模块划分 | [./11-core-module-division.md](./11-core-module-division.md) | 阶段执行器模块划分 |
| 法官提示词约束 | [./12-judge-prompt-constraints.md](./12-judge-prompt-constraints.md) | 阶段任务 prompt 片段 |

## 16. 待后续文档细化的开放问题

1. **多 AI 并发执行辩护**：审判环节 16 角色（存活数）辩护的有界并发（架构文档 §6.3 推荐 3 并发）具体调度策略——详见 [06-ai-driving-mechanism.md](./06-ai-driving-mechanism.md)。
2. **推理工作台 UI 交互细节**：玩家拖拽证物构建推理链的拖拽交互与证物关联高亮——详见 [08-ui-ux-design.md](./08-ui-ux-design.md)。
3. **平票重投的 AI 策略调整**：二次投票时 AI 角色是否调整投票策略——详见 [06-ai-driving-mechanism.md](./06-ai-driving-mechanism.md)。
4. **自爆狼扩展的阶段跳转**：`suicideWolf` 扩展启用时，处刑环节触发自爆后跳过当日剩余审判直接进入夜间——扩展规则启用时由 `phaseTransitions` 动态调整。
5. **警上警下扩展的阶段插入**：`sheriffElection` 扩展启用时，审判前插入"警上发言"与"警下投票"两个子阶段——扩展规则启用时由 `phaseTransitions` 动态调整。
