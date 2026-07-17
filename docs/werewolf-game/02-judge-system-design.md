# 02 - 法官 AI 系统设计

> 本文档定义狼人杀推理游戏法官 AI 子系统的角色定位、职责边界、暗码协议、真相剧本格式、二次监管机制、打分维度，以及与既有 [`GameNarrativeService`](file:///d:/AI/creative-cafe/src/main/services/game/GameNarrativeService.ts) 的集成方案。
>
> 本文档严格遵循 [01-system-architecture](./01-system-architecture.md) 末尾术语表，并与 [规则剧本](../逆转裁判+狼人杀规则.txt) 第 25-37 行的"阵营区分核心指令"保持一致。

## 1. 法官角色定位

### 1.1 唯一性与单例约束

法官 AI 是本游戏系统预置的**唯一 AI 法官**，对应规则剧本第 6 行的定义。在单局游戏中：

- **进程内单例**：法官调度器在主进程以单例模式注册（参照 [`gameNarrativeService`](file:///d:/AI/creative-cafe/src/main/services/game/GameNarrativeService.ts) 的 `export const gameNarrativeService = new GameNarrativeService()` 模式），所有阶段共用同一实例。
- **逻辑唯一性**：法官 AI 不被任何角色 AI 复用、不被任何玩家代理。所有阶段切换、暗码维护、真相剧本生成、打分判定均由该单例统一出口。
- **存档隔离**：法官调度器以 `saveId` 为键维护运行时状态，禁止跨存档读取（对齐 [01-system-architecture](./01-system-architecture.md) §7.4 存档隔离要求）。

### 1.2 与玩家的关系

| 维度 | 法官 AI | 玩家（典狱长） |
| :--- | :--- | :--- |
| 角色身份 | 系统预置的唯一裁判 | 预言家 + 警长双重身份 |
| 阵营归属 | 中立，无阵营 | 好人阵营领袖 |
| 信息可见性 | 真相剧本层、暗码层、所有 AI 上下文 | 证据链层、证言层、自身鉴定结果 |
| 决策权限 | 命令执行、角色模拟、信息记录、判定、打分 | 调查、质询、鉴定、2 票投票、处刑方式选择 |
| 物理权限 | 通过系统播报驱动阶段切换、封锁机制、警报 | 电子面罩私密频道下达隐秘指令、万能房卡访问全图 |

法官 AI 与典狱长为**裁判—选手关系**，绝非伙伴关系。法官 AI 不得对典狱长表现出倾向性、不得在典狱长决策失误时给予提示（对齐规则剧本第 13 行"确保玩家体验"指令）。

### 1.3 法官 AI 的双重身份

法官 AI 在不同阶段承担两种人格切换：

1. **系统裁判人格**：在夜间、晨间结算、审判处刑、打分等环节作为系统播报源，输出格式化表格与 Markdown（对齐规则剧本"系统播报与格式规范"段）。
2. **角色模拟器人格**：在辩护、证言收集、日间活动等环节代为生成 AI 角色的对话与行为。此人格不暴露"法官"身份，对外表现为对应角色。

人格切换通过 prompt 上下文与角色 ID 隔离实现，禁止在同一回复中混用（详见 §8 集成方案）。

## 2. 法官职责清单

法官 AI 的职责对应 [01-system-architecture](./01-system-architecture.md) §3 子系统职责矩阵中"01 法官系统"行的"核心职责"，共五项：

### 2.1 命令执行

接收典狱长通过电子面罩私密频道下达的隐秘指令（如身份鉴定请求、阶段切换确认、处刑方式选择），解析为内部命令并执行：

- 身份鉴定命令：在医疗室床位力场可用时（每日 00:00-06:00 且充能未消耗），对指定角色执行鉴定，结果只能是【好人】或【伪装者】，禁止输出技能相关标签。
- 阶段切换命令：根据 [`WerewolfPhase`](file:///d:/AI/creative-cafe/src/shared/types/werewolf.types.ts) 状态机转移表执行阶段进入/退出逻辑。
- 处刑方式命令：在审判处刑环节，接收典狱长指定的处刑方式并生成对应叙事。

### 2.2 角色模拟

在辩护环节、证言收集环节、日间活动环节，调用 [`AIService.streamChatAPI`](file:///d:/AI/creative-cafe/src/main/services/AIService.ts) 为各 AI 角色生成对话与行为决策：

- 每角色独立上下文（`ai-contexts/<characterId>.json`），按数据隔离矩阵注入对应角色的已知信息。
- 伪装者角色模拟时遵循"心理素质极强、绝不会露出破绽"的规则（规则剧本第 23 行）。
- 神民角色模拟时遵循对应技能的策略逻辑（药剂师用药决策、保安反杀决策、笨蛋吸引投票、黑客保护决策）。

### 2.3 信息记录

法官 AI 是真相剧本层、暗码层、证言层的唯一写入者：

- 每夜生成真相剧本 JSON 并持久化到 `truth-script.json`（玩家不可见）。
- 游戏初始化时为 16 名 AI 角色分配阵营与技能，写入 `faction-codes.json`（初始化后不变，对应规则剧本第 188 行"身份初始化"）。
- 现场调查环节生成可搜索点位清单；证言收集环节整理证言表（`testimony.json`）。

### 2.4 判定

| 判定场景 | 输入 | 输出 | 依据 |
| :--- | :--- | :--- | :--- |
| 夜间死亡判定 | 真相剧本 + 房间占用规则 | 死亡名单 / 平安夜 | 规则剧本 §1 夜间规则 |
| 晨间封锁判定 | 是否发生命案 | 警报触发 / 平安夜播报 | 规则剧本 §2 晨间结算 |
| 投票归票 | 投票结果（含典狱长 2 票） | 处刑目标 / 平票重投 / 跳过处刑 | 规则剧本 §3 审判与处刑 |
| 笨蛋触发判定 | 单角色得票数 | 是否过半 → 临时休庭 | 规则剧本阵营设定 §3 笨蛋 |
| 胜负判定 | 存活阵营分布 | 胜利 / 失败 / 继续 | 规则剧本 §胜利条件 §失败条件 |

### 2.5 打分

在庭前推理环节对典狱长的推理结果打分（仅回复优良中差），以及在游戏结束时为本局打分。打分维度与公式见 §7。

## 3. 法官禁止行为清单

法官 AI 在所有输出中严禁以下行为，违反任何一条均视为严重 bug：

### 3.1 信息泄露类禁止

| 编号 | 禁止行为 | 规则依据 |
| :--- | :--- | :--- |
| P-01 | 通过描述、语言、微表情、微动作、微信息或第三方对话暗示、提示或暴露角色阵营信息 | 规则剧本第 11 行"绝对保密禁令" |
| P-02 | 在对话和描述中使用"愣了一下"、"僵了一瞬"、"僵住"、"不自然的语气"等动作语言描述词进行暗示 | 规则剧本第 11 行 |
| P-03 | 在玩家未出示决定性证据前，让任何阵营的反应、行为、语气出现破绽 | 规则剧本第 12 行"事实证据导向" |
| P-04 | 在对话中提及暗码标记的存在，或在可见输出中显示真实阵营 | 规则剧本第 34 行"严禁泄露" |
| P-05 | 鉴定结果输出技能相关标签（如【药】【保】），仅允许输出【好人】或【伪装者】 | 规则剧本第 172 行 |

### 3.2 玩家代理类禁止

| 编号 | 禁止行为 | 规则依据 |
| :--- | :--- | :--- |
| P-06 | 在调查取证、证言、推理和审判环节引导玩家 | 规则剧本第 13 行"确保玩家体验" |
| P-07 | 代替玩家询问证言或调查现场 | 规则剧本第 13 行 |
| P-08 | 在玩家做出错误判断或选择时通过任何形式给出提示 | 规则剧本第 13 行 |
| P-09 | 代替玩家进行推理和分析 | 规则剧本庭前推理段 |
| P-10 | 代替玩家说话或代替玩家做决定 | 规则剧本第 6 行 |

### 3.3 暗码类禁止

| 编号 | 禁止行为 | 规则依据 |
| :--- | :--- | :--- |
| P-11 | 出现 `<!-- ? -->` 等无法区分阵营的暗码 | 规则剧本第 29 行"暗码说明" |
| P-12 | 暗码未紧贴角色姓名最后一个字之后插入 | 规则剧本第 28 行"标记方式" |
| P-13 | 提到角色姓名时未携带对应颜色 + 暗码后缀 | 规则剧本第 35 行"始终携带" |
| P-14 | 暗码随鉴定状态变化（暗码无论是否经过鉴定都要全局保存） | 规则剧本第 29 行 |

### 3.4 唯一例外

规则剧本第 145 行允许法官在玩家前往下一地图区域前提示【尚有 X 个关键证据未收集，是否离开？】，此为**唯一允许的提示**，且仅限数量提示，不得指向具体证据位置。

## 4. 暗码标记协议

### 4.1 暗码定义

暗码是紧贴角色姓名末尾插入的 HTML 注释，标识角色阵营与技能，对应 [01-system-architecture](./01-system-architecture.md) §9.3 术语定义。暗码玩家不可见（`react-markdown` 渲染时自动隐藏 HTML 注释），但法官 AI 全局维护。

### 4.2 暗码字典

严格遵循规则剧本第 25-37 行"阵营区分核心指令"：

| 阵营 / 技能 | 暗码 | 示例 |
| :--- | :--- | :--- |
| 普通好人（村民） | `<!-- 好 -->` | `<span style="color:#4682B4">朱迪<!-- 好 --></span>` |
| 伪装者（狼人） | `<!-- 伪 -->` | `<span style="color:#B0B0B0">露娜<!-- 伪 --></span>` |
| 药剂师（女巫） | `<!-- 药 -->` | `<span style="color:#FFB6C1">戴安娜<!-- 药 --></span>` |
| 保安（猎人） | `<!-- 保 -->` | `<span style="color:#FF8C00">悍娇虎<!-- 保 --></span>` |
| 笨蛋（白痴） | `<!-- 笨 -->` | `<span style="color:#98FB98">西施惠<!-- 笨 --></span>` |
| 黑客（守卫） | `<!-- 黑 -->` | `<span style="color:#87CEEB">妖狐兽<!-- 黑 --></span>` |

### 4.3 注入位置规则

暗码注入遵循"三必须"原则：

1. **必须紧贴姓名末字之后**：在角色姓名（Name）的最后一个字后面紧贴插入，中间不留空格、不留标点。
2. **必须在所有姓名出现处注入**：包括信息打印、对话头、系统播报、表格、证言表、犯罪现场表、角色信息表等所有涉及姓名的场景。
3. **必须在颜色 span 内部**：暗码位于 `<span style="color:...">姓名` 与 `</span>` 之间，确保暗码与姓名同色渲染上下文。

错误示例（禁止）：

```html
<!-- 错误：暗码在 span 外 -->
<span style="color:#4682B4">朱迪</span><!-- 好 -->
<!-- 错误：暗码与姓名之间有空格 -->
<span style="color:#4682B4">朱迪 <!-- 好 --></span>
<!-- 错误：使用 ? 等不确定标记 -->
<span style="color:#4682B4">朱迪<!-- ? --></span>
```

正确示例：

```html
<span style="color:#4682B4">朱迪<!-- 好 --></span>
```

### 4.4 全局一致性

暗码一旦在游戏初始化时分配（写入 `faction-codes.json`），在整个游戏周期内**不可变**：

- 即使角色被典狱长鉴定为好人，其暗码不变（药剂师鉴定结果仍是【好人】，但暗码仍为 `<!-- 药 -->`）。
- 即使伪装者被处刑、身份暴露，其暗码仍为 `<!-- 伪 -->`。
- 即使角色死亡，后续提及姓名时仍需携带暗码（用于复盘与日志审计）。

对应规则剧本第 29 行："暗码无论是否经过鉴定都要全局保存！禁止出现 `<!-- ? -->` 等无法区分的情况！类似狼人杀一开始法官就知道身份牌但预言家不知道！"

### 4.5 AI 互检流程

严格遵循规则剧本第 36 行"AI 互检"原则："在生成回复前，先在后台确认该角色的真实阵营，再附加对应的暗码。"

法官 AI 生成包含角色姓名的回复时，执行以下互检流程：

```typescript
/**
 * 暗码互检流程（生成回复前执行）
 *
 * 1. 提取待生成回复中所有出现的角色姓名
 * 2. 从 faction-codes.json 查询每个角色的真实阵营与技能
 * 3. 校验待生成回复中每个姓名后是否已紧贴对应暗码
 * 4. 缺失或错误的暗码自动补正
 * 5. 校验通过后再输出回复
 */
interface FactionCodeLookup {
  /** 角色 ID → 阵营代码映射，初始化后不变 */
  [characterId: string]: '好' | '伪' | '药' | '保' | '笨' | '黑';
}

interface DarkCodeValidationResult {
  /** 校验是否通过 */
  valid: boolean;
  /** 自动补正的暗码数量 */
  autoFixedCount: number;
  /** 校验失败的角色与原因 */
  failures: Array<{ characterId: string; reason: string }>;
}
```

互检流程在 [`GamePromptBuilder`](file:///d:/AI/creative-cafe/src/main/services/game/GamePromptBuilder.ts) 输出最终 prompt 之前与 [`GameNarrativeService`](file:///d:/AI/creative-cafe/src/main/services/game/GameNarrativeService.ts) 接收 AI 回复之后各执行一次，确保双向一致。

## 5. 真相剧本格式规范

### 5.1 用途与可见性

真相剧本是法官 AI 每夜生成的完整犯罪过程记录，对应 [01-system-architecture](./01-system-architecture.md) §9.3 术语定义。其存储于真相剧本层，仅法官 AI 可见，玩家与其他 AI 角色均不可见。真相剧本是下一阶段现场调查、证言收集、庭前推理打分的唯一真相依据。

### 5.2 完整 TypeScript Interface 定义

```typescript
/**
 * 每夜真相剧本
 *
 * 持久化路径：data/games/<gameId>/saves/<saveId>/truth-script/<dayIndex>.json
 * 可见层级：真相剧本层（仅法官 AI）
 */
interface TruthScript {
  /** 存档 ID */
  saveId: string;
  /** 第几夜（从 1 开始，第 1 夜受首夜保护机制保护，禁止杀戮） */
  dayIndex: number;
  /** 夜间开始时间戳（毫秒） */
  nightStartAt: number;
  /** 夜间结束时间戳（毫秒，06:00） */
  nightEndAt: number;
  /** 是否为平安夜（未发生命案） */
  isPeacefulNight: boolean;
  /** 凶案事件列表（平安夜时为空数组） */
  incidents: Incident[];
  /** 技能发动记录 */
  skillActivations: SkillActivation[];
  /** 伪装者夜间会议记录（互相识别、击杀目标讨论） */
  impostorMeeting: ImpostorMeeting;
  /** 目击者列表 */
  witnesses: Witness[];
}

/**
 * 单次凶案事件
 *
 * 对应规则剧本第 132 行："如发生凶案，则仔细描述凶手/帮凶 在什么时间、什么地点、
 * 通过什么方式/手法/凶器杀害被害人、凶器来源/如何处理、做了哪些事进行证据销毁/
 * 栽赃嫁祸/混淆视听、提前进行了哪些准备、是否有人发动技能等等要素"
 */
interface Incident {
  /** 事件唯一 ID */
  incidentId: string;
  /** 案发时间（HH:mm 格式，00:00-06:00 之间） */
  occurredAt: string;
  /** 案发地点（层级 + 房间/区域，如 "F2-#F205"） */
  location: string;
  /** 凶手角色 ID（伪装者，必填） */
  killerId: string;
  /** 帮凶角色 ID 列表（其他伪装者，可为空数组） */
  accompliceIds: string[];
  /** 被害人角色 ID */
  victimId: string;
  /** 杀害手法描述（如"持刀刺入胸口"、"下毒"、"勒颈"） */
  method: string;
  /** 凶器名称与外观描述 */
  weapon: {
    name: string;
    description: string;
    /** 凶器来源（如"取自 F4 物资仓库违禁品柜"、"取自厨房刀具架"） */
    source: string;
    /** 是否为违禁品 */
    isContraband: boolean;
  };
  /** 证据销毁动作列表 */
  evidenceDestruction: Array<{
    /** 销毁的证据描述 */
    evidence: string;
    /** 销毁方式（如"焚烧"、"冲入下水道"、"带离现场"） */
    method: string;
    /** 销毁后是否仍残留痕迹（用于现场调查可搜索点位） */
    residue: string;
  }>;
  /** 栽赃嫁祸动作列表 */
  frameUps: Array<{
    /** 被栽赃角色 ID */
    framedId: string;
    /** 栽赃手法描述（如"在被害人房间留下其房卡"） */
    method: string;
    /** 留下的伪证据描述 */
    plantedEvidence: string;
  }>;
  /** 提前准备动作列表（如"白天先获取被害人好感"、"提前准备凶器"） */
  preparations: string[];
  /** 现场可搜索点位清单（基于真相生成，用于现场调查环节） */
  searchablePoints: SearchablePoint[];
  /** 关键证物列表（用于现场调查环节返回给玩家） */
  keyEvidences: Evidence[];
}

/**
 * 技能发动记录
 *
 * 对应规则剧本第 133 行："是否有人发动技能、发动地点 -->
 * 来记录拥有技能的角色的技能接下来是否可用"
 */
interface SkillActivation {
  /** 技能发动者角色 ID */
  activatorId: string;
  /** 技能类型 */
  skillType: '药剂师-强心剂' | '药剂师-毒药' | '保安-巡夜' | '黑客-全息影像';
  /** 发动时间（HH:mm） */
  activatedAt: string;
  /** 发动地点 */
  location: string;
  /** 目标角色 ID（药剂师用药目标、黑客保护目标） */
  targetId?: string;
  /** 是否生效 */
  effective: boolean;
  /** 未生效原因（如"目标已被黑客保护"、"药剂师已用强心剂"） */
  ineffectiveReason?: string;
  /** 技能下次可用状态 */
  nextAvailability: {
    /** 强心剂是否仍可用 */
    antidoteAvailable: boolean;
    /** 毒药是否仍可用 */
    poisonAvailable: boolean;
    /** 黑客保护目标（与上一夜不同） */
    hackerLastProtectedId?: string;
  };
}

/**
 * 伪装者夜间会议记录
 *
 * 对应规则剧本第 126 行："伪装者可以互相识别身份（对应狼人杀夜间睁眼）"
 */
interface ImpostorMeeting {
  /** 参与会议的伪装者角色 ID 列表 */
  participantIds: string[];
  /** 会议开始时间（HH:mm） */
  startedAt: string;
  /** 会议地点 */
  location: string;
  /** 讨论的击杀目标角色 ID */
  proposedTargetIds: string[];
  /** 最终确定的击杀目标角色 ID（不击杀时为 null） */
  finalTargetId: string | null;
  /** 是否选择"平安夜"策略（不击杀以伪造假象） */
  skipKillStrategy: boolean;
}

/**
 * 目击者记录
 *
 * 对应规则剧本第 126 行："如果选择了拥有 2 名角色的房间，
 * 那么必定会产生目击者（因为无法违反规则在同一夜杀死第二个人）"
 */
interface Witness {
  /** 目击者角色 ID */
  witnessId: string;
  /** 目击到的凶手角色 ID（伪装者杀人时必定以真面目示人） */
  seenKillerId: string;
  /** 目击时间（HH:mm） */
  witnessedAt: string;
  /** 目击地点 */
  location: string;
  /** 目击内容描述（用于证言收集环节，目击者可选择是否承认） */
  observation: string;
}

/**
 * 可搜索点位
 *
 * 用于现场调查环节生成按钮清单（含与真相剧本无关的干扰点位）
 */
interface SearchablePoint {
  /** 点位 ID */
  pointId: string;
  /** 点位名称（按钮显示文本，如"天花板"、"通风口"、"尸体"） */
  label: string;
  /** 所属地图区域 */
  area: string;
  /** 是否为关键证据点位 */
  isKeyEvidence: boolean;
  /** 搜索后返回的描述（关键证据返回证物描述，干扰点位返回无关描述） */
  searchResult: string;
}

/**
 * 证物
 *
 * 对应规则剧本 §B 犯罪现场信息表
 */
interface Evidence {
  /** 证物 ID */
  evidenceId: string;
  /** 证物名称 */
  name: string;
  /** 外观描述 */
  description: string;
  /** 证物类型 */
  type: '凶器' | '指纹' | '痕迹' | '体液' | '毛发' | '物品' | '监控残留';
  /** 是否与特定种族相关（如毛发、鳞片） */
  raceSpecific?: string;
  /** 关联角色 ID（如指纹所属角色） */
  relatedCharacterId?: string;
}
```

### 5.3 真相剧本生成约束

1. **首夜保护**：第 1 夜 `isPeacefulNight` 必须为 `true`，`incidents` 必须为空数组（对齐规则剧本第 137 行"首夜保护机制"）。
2. **击杀上限**：每夜所有伪装者合计最多击杀 1 名好人（对齐规则剧本第 126 行）。
3. **难度递进**：每夜难度与犯罪手法需逐步提升，但必须保留合理完善的推理链条，不可完全毁灭关键证据（对齐规则剧本第 132 行）。
4. **平安夜策略**：伪装者可选择不击杀，此时 `isPeacefulNight` 为 `true`，但 `impostorMeeting` 仍需记录讨论过程（对齐规则剧本第 127 行）。
5. **房间占用规则**：每个单人牢房夜晚最多容纳 2 名角色，若伪装者选择 2 人房间则必产生目击者（对齐规则剧本第 125-126 行）。

## 6. 法官二次监管机制

为防止法官 AI 在运行时泄露信息（违反 §3 禁止行为清单），设计三层监管机制。

### 6.1 暗码完整性扫描

在 [`GameNarrativeService`](file:///d:/AI/creative-cafe/src/main/services/game/GameNarrativeService.ts) 接收 AI 回复后、回调 `onComplete` 前，执行暗码完整性扫描：

```typescript
interface DarkCodeIntegrityScanResult {
  /** 扫描是否通过 */
  passed: boolean;
  /** 回复中出现的所有角色姓名 */
  detectedNames: string[];
  /** 缺失暗码的姓名列表 */
  missingDarkCodeNames: string[];
  /** 暗码与 faction-codes.json 不一致的姓名列表 */
  mismatchedDarkCodeNames: string[];
  /** 自动补正后的回复文本 */
  correctedText: string;
  /** 违规详情（写入审计日志） */
  violations: Array<{
    name: string;
    expected: string;
    actual: string;
    position: number;
  }>;
}
```

扫描算法：

1. 从 `faction-codes.json` 加载角色 ID → 暗码映射。
2. 用正则匹配回复中所有 `<span style="color:...">姓名` 模式。
3. 校验每个姓名后是否紧贴 `<!-- 期望暗码 -->`。
4. 缺失或不一致时自动补正，并记录违规详情到审计日志。
5. 累计违规次数超过阈值（默认 3 次）时，向玩家发送告警（仍不暴露暗码本身）。

### 6.2 对话内容关键词扫描

在暗码扫描之后，对回复明文进行关键词扫描，检测是否泄露阵营信息：

```typescript
/**
 * 禁止关键词模式
 *
 * 对应规则剧本第 11 行禁止的描述词
 */
const FORBIDDEN_PATTERNS: Array<{ pattern: RegExp; reason: string }> = [
  { pattern: /愣了一下|僵了一瞬|僵住|不自然的语气/g, reason: 'P-02: 禁止使用暗示性动作描述词' },
  { pattern: /真实阵营|真实身份是|其实是伪装者|其实是好人/g, reason: 'P-01: 禁止直接暴露阵营' },
  { pattern: /<!-- \? -->/g, reason: 'P-11: 禁止使用不确定暗码' },
  { pattern: /药剂师|保安|笨蛋|黑客/g, reason: 'P-05: 禁止在鉴定结果中输出技能标签' }
];

interface KeywordScanResult {
  passed: boolean;
  matches: Array<{
    pattern: string;
    matchedText: string;
    position: number;
    reason: string;
  }>;
  /** 替换后的安全文本（将违规片段替换为 [REDACTED]） */
  sanitizedText: string;
}
```

注意：第 4 条"药剂师/保安/笨蛋/黑客"关键词扫描仅在**鉴定结果输出**场景启用，在角色对话中允许出现（角色可在审判环节对跳身份）。

### 6.3 玩家反馈通道

提供典狱长主动举报机制：

- 在 UI 状态栏（[`GameStateBar`](file:///d:/AI/creative-cafe/src/renderer/components/Game/panels/GameStateBar.tsx)）增加"举报法官"按钮，点击后弹出 Modal 收集举报类型（信息泄露 / 错误引导 / 代替玩家决策 / 暗码异常）。
- 举报写入 `judge-feedback.json`，包含存档 ID、当前阶段、举报类型、玩家备注、相关回复快照。
- 举报不立即修改游戏状态，但作为后续 spec 阶段优化 prompt 的依据。

### 6.4 监管执行流程

```
AI 回复生成完毕
   ↓
[6.1 暗码完整性扫描] ──失败──→ 自动补正 → 写入审计日志
   ↓通过
[6.2 关键词扫描] ──失败──→ 替换为 [REDACTED] → 写入审计日志
   ↓通过
回调 onComplete 返回玩家
   ↓
[6.3 玩家反馈通道] ──玩家举报──→ 写入 judge-feedback.json
```

## 7. 法官打分维度

### 7.1 庭前推理打分

庭前推理环节，法官基于真相剧本对典狱长的推理结果打分，**仅回复优良中差**，禁止回复其他信息（对齐规则剧本第 150 行）。打分依据：

| 等级 | 标准 |
| :--- | :--- |
| 优 | 凶手指认正确 + 手法推断正确 + 关键证据全部收集 |
| 良 | 凶手指认正确 + 手法推断部分正确 + 关键证据收集 ≥ 60% |
| 中 | 凶手指认错误但推理逻辑自洽 / 关键证据收集 30%-60% |
| 差 | 凶手指认错误且推理逻辑混乱 / 关键证据收集 < 30% |

```typescript
type ReasoningGrade = '优' | '良' | '中' | '差';

interface ReasoningScoreInput {
  /** 玩家指认的凶手角色 ID */
  accusedKillerId: string;
  /** 真实凶手角色 ID（来自真相剧本） */
  trueKillerId: string;
  /** 玩家推断的作案手法 */
  inferredMethod: string;
  /** 真实作案手法（来自真相剧本） */
  trueMethod: string;
  /** 玩家已收集的关键证据 ID 列表 */
  collectedEvidenceIds: string[];
  /** 真相剧本中的全部关键证据 ID 列表 */
  allKeyEvidenceIds: string[];
}

function scoreReasoning(input: ReasoningScoreInput): ReasoningGrade {
  const killerCorrect = input.accusedKillerId === input.trueKillerId;
  const methodMatchRatio = computeMethodMatchRatio(input.inferredMethod, input.trueMethod);
  const evidenceRatio = input.allKeyEvidenceIds.length === 0
    ? 0
    : input.collectedEvidenceIds.filter(id => input.allKeyEvidenceIds.includes(id)).length
      / input.allKeyEvidenceIds.length;

  if (killerCorrect && methodMatchRatio >= 0.8 && evidenceRatio >= 1.0) return '优';
  if (killerCorrect && methodMatchRatio >= 0.5 && evidenceRatio >= 0.6) return '良';
  if ((!killerCorrect && isLogicSelfConsistent(input)) || (evidenceRatio >= 0.3 && evidenceRatio < 0.6)) return '中';
  return '差';
}
```

### 7.2 整局打分

游戏结束时（胜利或失败），按 [01-system-architecture](./01-system-architecture.md) §9.4 与规则剧本 §胜利条件为本局打分。打分维度与权重：

| 维度 | 权重 | 计算方式 | 适用场景 |
| :--- | :--- | :--- | :--- |
| 好人存活数 | 35% | 存活好人数 / 初始好人数（11 人） × 100 | 胜利时为主激励 |
| 经过天数 | 20% | min(经过天数, 7) / 7 × 100（封顶 7 天） | 越长说明博弈越激烈 |
| 审判正确度 | 25% | 正确处刑伪装者次数 / 总审判次数 × 100 | 衡量典狱长判断力 |
| 推理打分均值 | 15% | 各夜推理等级均值（优=100/良=80/中=60/差=40） | 衡量典狱长推理力 |
| 鉴定使用率 | 5% | 已使用鉴定次数 / 经过年数 × 100（封顶 100） | 鼓励善用预言家能力 |

```typescript
interface GameScoreInput {
  /** 是否胜利 */
  isVictory: boolean;
  /** 初始好人数（含神民，默认 11） */
  initialGoodCount: number;
  /** 存活好人数（含神民） */
  survivingGoodCount: number;
  /** 经过年数（夜数） */
  elapsedDays: number;
  /** 总审判次数 */
  totalTrialCount: number;
  /** 正确处刑伪装者次数 */
  correctExecutionCount: number;
  /** 各夜推理等级 */
  reasoningGrades: ReasoningGrade[];
  /** 已使用鉴定次数 */
  usedIdentificationCount: number;
}

interface GameScoreResult {
  /** 总分（0-100） */
  totalScore: number;
  /** 各维度得分明细 */
  dimensions: {
    goodSurvival: number;
    elapsedDays: number;
    trialAccuracy: number;
    reasoningAverage: number;
    identificationUsage: number;
  };
  /** 评级 */
  rating: 'S' | 'A' | 'B' | 'C' | 'D';
}

function scoreGame(input: GameScoreInput): GameScoreResult {
  const goodSurvival = (input.survivingGoodCount / input.initialGoodCount) * 100;
  const elapsedDaysScore = (Math.min(input.elapsedDays, 7) / 7) * 100;
  const trialAccuracy = input.totalTrialCount === 0
    ? 0
    : (input.correctExecutionCount / input.totalTrialCount) * 100;
  const gradeMap: Record<ReasoningGrade, number> = { '优': 100, '良': 80, '中': 60, '差': 40 };
  const reasoningAverage = input.reasoningGrades.length === 0
    ? 0
    : input.reasoningGrades.reduce((sum, g) => sum + gradeMap[g], 0) / input.reasoningGrades.length;
  const identificationUsage = Math.min(
    (input.usedIdentificationCount / Math.max(input.elapsedDays, 1)) * 100,
    100
  );

  const totalScore = Math.round(
    goodSurvival * 0.35 +
    elapsedDaysScore * 0.20 +
    trialAccuracy * 0.25 +
    reasoningAverage * 0.15 +
    identificationUsage * 0.05
  );

  const rating: GameScoreResult['rating'] =
    totalScore >= 90 ? 'S' :
    totalScore >= 75 ? 'A' :
    totalScore >= 60 ? 'B' :
    totalScore >= 40 ? 'C' : 'D';

  return {
    totalScore,
    dimensions: { goodSurvival, elapsedDaysScore, trialAccuracy, reasoningAverage, identificationUsage },
    rating
  };
}
```

## 8. 与既有 GameNarrativeService 的集成方案

### 8.1 方案对比

| 方案 | 描述 | 优点 | 缺点 | 评估 |
| :--- | :--- | :--- | :--- | :--- |
| **A. 纯 system prompt 注入** | 法官逻辑全部写入 `templateSystemPrompt`，由 [`GameNarrativeService`](file:///d:/AI/creative-cafe/src/main/services/game/GameNarrativeService.ts) 通用流程调用 | 改动最小、复用流式回调与 tableEdit 解析 | 法官职责复杂（暗码互检、真相剧本生成、打分）难以纯 prompt 完成；缺乏确定性校验 | 不推荐 |
| **B. 独立 WerewolfJudgeService** | 新建独立服务，封装法官调度器、真相剧本生成器、打分器、暗码扫描器，内部调用 [`AIService.streamChatAPI`](file:///d:/AI/creative-cafe/src/main/services/AIService.ts) | 职责清晰、可单元测试、确定性校验可控 | 重复实现流式回调与 tableEdit 解析逻辑 | 不推荐 |
| **C. 混合方案（推荐）** | 法官 AI 的人格切换与叙事生成复用 [`GameNarrativeService`](file:///d:/AI/creative-cafe/src/main/services/game/GameNarrativeService.ts)；法官专属逻辑（暗码互检、真相剧本生成、打分、监管扫描）封装为独立 `WerewolfJudgeService`，通过钩子接入 | 复用既有流式与表格协议；专属逻辑可独立测试；职责边界清晰 | 需定义清晰的钩子接口 | **推荐** |

### 8.2 推荐方案 C：混合集成

#### 8.2.1 模块划分

```
src/main/services/game/werewolf/
├── WerewolfJudgeService.ts          // 法官调度器（单例），协调以下子模块
├── WerewolfPromptBuilder.ts         // 法官专属 prompt 片段（参照 ManagementPromptBuilder 模式）
├── TruthScriptGenerator.ts          // 真相剧本生成器
├── DarkCodeValidator.ts             // 暗码互检与完整性扫描
├── KeywordScanner.ts                // 对话内容关键词扫描
├── ReasoningScorer.ts              // 庭前推理打分
├── GameScorer.ts                    // 整局打分
└── JudgeFeedbackRecorder.ts         // 玩家反馈记录
```

#### 8.2.2 与 GameNarrativeService 的钩子接入

参照 [`ManagementPromptBuilder`](file:///d:/AI\creative-cafe/src/main/services/game/templates/management/ManagementPromptBuilder.ts) 的接入模式（作为 `templateSystemPrompt` 注入 [`GamePromptBuilder`](file:///d:/AI/creative-cafe/src/main/services/game/GamePromptBuilder.ts)），法官 AI 通过两个钩子接入：

**钩子 1：templateSystemPrompt 注入**

`WerewolfPromptBuilder.buildSystemPrompt()` 返回法官专属规则片段，由 [`GameNarrativeService`](file:///d:/AI/creative-cafe/src/main/services/game/GameNarrativeService.ts) 在调用 `gamePromptBuilder.buildSystemPrompt()` 时作为 `templateSystemPrompt` 参数传入，最终拼接到 system prompt 末尾的 `【模板额外规则】` 段。片段内容包括：

- 法官角色定位（系统裁判人格 / 角色模拟器人格切换）
- 暗码字典与注入规则
- 真相剧本生成约束
- 禁止行为清单
- 当前阶段任务（由 `WerewolfJudgeService` 根据状态机动态生成）

**钩子 2：回复后监管扫描**

扩展 [`GameNarrativeService`](file:///d:/AI/creative-cafe/src/main/services/game/GameNarrativeService.ts) 的 `generateNarrative` 流程，在步骤 7（解析 tableEdit）与步骤 8（应用 tableEdit）之间插入监管扫描：

```typescript
// 在 GameNarrativeService.generateNarrative 内部，步骤 7 之后插入：
// 7.5 法官监管扫描（仅 werewolf 游戏类型）
if (request.gameType === 'werewolf') {
  const scanResult = werewolfJudgeService.scanNarrativeOutput(saveId, narrativeText);
  if (!scanResult.passed) {
    logger.warn('法官监管扫描未通过，已自动补正', undefined, {
      saveId,
      violations: scanResult.violations
    });
    // 用补正后的文本替换 narrativeText
    narrativeText = scanResult.correctedText;
  }
}
```

#### 8.2.3 独立调用入口

对于非叙事场景（如夜间真相剧本生成、庭前推理打分、整局打分），`WerewolfJudgeService` 直接调用 [`AIService.streamChatAPI`](file:///d:/AI/creative-cafe/src/main/services/AIService.ts)，不经过 [`GameNarrativeService`](file:///d:/AI/creative-cafe/src/main/services/game/GameNarrativeService.ts)，避免与叙事流程耦合：

```typescript
class WerewolfJudgeService {
  /**
   * 生成夜间真相剧本
   *
   * 直接调用 AIService，不经过 GameNarrativeService
   * 输出 JSON 持久化到 truth-script/<dayIndex>.json
   */
  async generateTruthScript(
    saveId: string,
    dayIndex: number,
    abortSignal?: AbortSignal
  ): Promise<TruthScript> {
    const systemPrompt = werewolfPromptBuilder.buildTruthScriptSystemPrompt(saveId, dayIndex);
    const userPrompt = werewolfPromptBuilder.buildTruthScriptUserPrompt(saveId, dayIndex);
    const result = await aiService.streamChatAPI(
      [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt }
      ],
      { model: '', temperature: 0.7, maxTokens: 32768, abortSignal },
      () => {}
    );
    return this.parseAndPersistTruthScript(saveId, dayIndex, result.content);
  }

  /**
   * 监管扫描入口（由 GameNarrativeService 在钩子 2 调用）
   */
  scanNarrativeOutput(saveId: string, text: string): DarkCodeIntegrityScanResult & KeywordScanResult {
    const darkCodeResult = darkCodeValidator.validate(saveId, text);
    const keywordResult = keywordScanner.scan(text);
    return {
      passed: darkCodeResult.passed && keywordResult.passed,
      correctedText: keywordResult.sanitizedText,
      violations: [...darkCodeResult.violations, ...keywordResult.matches]
    } as any;
  }

  /**
   * 庭前推理打分
   */
  scoreReasoning(input: ReasoningScoreInput): ReasoningGrade {
    return reasoningScorer.score(input);
  }

  /**
   * 整局打分
   */
  scoreGame(input: GameScoreInput): GameScoreResult {
    return gameScorer.score(input);
  }
}

export const werewolfJudgeService = new WerewolfJudgeService();
```

### 8.3 集成约束

1. **不修改 GameNarrativeService 既有签名**：钩子 2 通过 `request.gameType` 判断是否启用监管扫描，对其他游戏模板无影响。
2. **不引入新 IPC 通道**：法官专属逻辑（真相剧本生成、打分）通过既有 `GameNarrativeRequest` 扩展字段触发，复用既有 IPC 事件。
3. **类型单一真源**：所有 TypeScript interface 定义在 [`src/shared/types/werewolf.types.ts`](file:///d:/AI/creative-cafe/src/shared/types/werewolf.types.ts)（对齐 [01-system-architecture](./01-system-architecture.md) §7.2）。
4. **常量单一真源**：暗码字典、禁止关键词、打分权重等常量定义在 [`src/shared/constants/werewolf.constants.ts`](file:///d:/AI/creative-cafe/src/shared/constants/werewolf.constants.ts)。

## 9. 后续文档导航

| 编号 | 文档 | 本文相关章节 |
| :--- | :--- | :--- |
| 03 | [角色系统设计](./03-character-system-design.md) | §4 暗码字典依赖角色阵营分配 |
| 05 | [游戏流程设计](./05-game-flow-design.md) | §2 法官职责清单依赖阶段状态机 |
| 06 | [AI 驱动机制](./06-ai-driving-mechanism.md) | §2.2 角色模拟、§4.5 AI 互检流程 |
| 09 | [数据库设计](./09-database-design.md) | §5 真相剧本 JSON Schema、`faction-codes.json` 结构 |
| 11 | [核心模块划分](./11-core-module-division.md) | §8.2 模块划分 |
| 12 | [法官提示词约束](./12-judge-prompt-constraints.md) | §4 暗码协议、§8.2.2 system prompt 片段 |
