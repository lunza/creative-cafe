# 06 - AI 驱动机制设计

> 本文档是狼人杀推理游戏策划阶段的 AI 驱动子系统设计文档，对应 [01-system-architecture.md](./01-system-architecture.md) §3 中的"05 AI 驱动"子系统。聚焦多 AI 上下文隔离、行为决策树、伪装者/神民策略、对话生成 prompt 模板、暗码全局一致性、三层数据隔离矩阵、AI 互检机制、与既有 [`AIService.streamChatAPI`](../../src/main/services/AIService.ts) 的集成与并发控制。
>
> 严格遵循 [规则剧本](../逆转裁判+狼人杀规则.txt) 第 10-13 行【最高核心指令】：**绝对保密禁令**、**事实证据导向**、**确保玩家体验**；并对齐第 17-23 行【阵营设定】与第 152-161 行【审判策略】。
>
> 术语一律遵循 [01-system-architecture.md](./01-system-architecture.md) §9 术语表；暗码协议遵循 [02-judge-system-design.md](./02-judge-system-design.md) §4；角色档案与阵营分配遵循 [03-character-system-design.md](./03-character-system-design.md) §2-§4。

## 1. 设计目标与核心约束

### 1.1 设计目标

AI 驱动子系统的目标是让 16 名 AI 角色在严格隔离的上下文下，依据自身阵营、技能与已知信息产出符合规则的对话与行为决策，同时绝不泄露真相剧本与暗码层信息。具体目标：

- **角色独立**：每名 AI 角色持有独立 `ai-contexts/<characterId>.json` 上下文，按需注入信息，互不污染
- **阵营一致**：所有输出严格对齐规则剧本第 17-23 行阵营设定与第 152-161 行审判策略
- **真相不可见**：真相剧本层与暗码层仅法官 AI 可见，AI 角色调用时不得注入
- **玩家体验**：对齐规则剧本第 13 行，AI 不得引导、提示或代替玩家决策
- **可调度**：多 AI 并发受有界队列约束，避免 API 限流与 token 风暴

### 1.2 核心禁止清单（对齐规则剧本第 10-13 行）

| 编号 | 禁止行为 | 规则依据 |
| :--- | :--- | :--- |
| AI-P-01 | 在 AI 角色对话中通过描述、语言、微表情、微动作暗示阵营信息 | 规则剧本第 11 行 |
| AI-P-02 | 使用"愣了一下/僵了一瞬/不自然的语气"等暗示性描述词 | 规则剧本第 11 行 |
| AI-P-03 | 在玩家未出示决定性证据前让阵营反应出现破绽 | 规则剧本第 12 行 |
| AI-P-04 | AI 角色引导玩家调查、询问或推理 | 规则剧本第 13 行 |
| AI-P-05 | 向 AI 角色注入其他角色的 context 片段、真相剧本或暗码字典 | 架构总览 §7.4 |
| AI-P-06 | 多 AI 并发超过架构总览 §7.1 上限（3 个） | 架构总览 §7.1 |

## 2. AI 上下文隔离架构

### 2.1 上下文文件结构

每名 AI 角色对应一个独立的上下文文件，存储于存档目录下，遵循架构总览 §4.2 AI 上下文层定义：

```typescript
// src/main/services/game/werewolf/AiContextManager.ts

/**
 * 单角色 AI 上下文
 *
 * 持久化路径：data/games/<gameId>/saves/<saveId>/ai-contexts/<characterId>.json
 * 可见层级：AI 上下文层（仅该角色与法官调度器可见）
 */
interface AiContext {
  /** 角色 ID，对应 WerewolfCharacter.id */
  characterId: string;
  /** 存档 ID */
  saveId: string;
  /** 该角色已知的公开信息（出生状态、角色档案、文本颜色等） */
  publicKnowledge: PublicKnowledge;
  /** 该角色通过游戏过程获得的信息（被预言家查验结果、被出示证物等） */
  acquiredKnowledge: AcquiredKnowledgeItem[];
  /** 近期对话历史（最近 20 轮，超出滚动淘汰） */
  recentDialogue: DialogueTurn[];
  /** 当前阶段任务（由 WerewolfJudgeService 在阶段切换时下发） */
  currentPhaseTask: PhaseTask;
  /** 决策历史（用于行为一致性回溯） */
  decisionHistory: DecisionRecord[];
  /** 上下文最后更新时间戳 */
  updatedAt: string;
}

interface PublicKnowledge {
  /** 自身角色档案副本（含 factionCode，但调用时不注入给 AI 本身） */
  character: WerewolfCharacter;
  /** 自身存活状态 */
  status: '存活' | '死亡' | '处刑' | '失踪';
  /** 当前游戏天数 */
  dayIndex: number;
  /** 当前阶段（WerewolfPhase 枚举） */
  currentPhase: WerewolfPhase;
  /** 已公开的死亡名单（仅含公开死亡，不含真相剧本细节） */
  publicDeaths: Array<{ characterId: string; cause: '夜间击杀' | '处刑' | '中毒'; dayIndex: number }>;
}

interface AcquiredKnowledgeItem {
  /** 信息类型 */
  type: '被预言家查验' | '被出示证物' | '被质询答复' | '被药剂师救助' | '被黑客保护' | '夜间目击';
  /** 获取该信息的时间戳 */
  acquiredAt: string;
  /** 信息内容（不含真相剧本原话，仅含该角色可感知的部分） */
  content: string;
  /** 信息来源角色 ID（可为玩家或另一 AI 角色） */
  sourceId?: string;
}
```

### 2.2 按需注入原则

调用 `AIService.streamChatAPI` 生成某角色回复时，注入该角色上下文的**子集**，而非全量。注入规则如下：

| 信息类别 | 是否注入 | 说明 |
| :--- | :---: | :--- |
| 角色档案（含对话风格、口头禅、外观） | ✅ | 用于人格一致性 |
| 自身存活状态、当前阶段 | ✅ | 用于行为决策 |
| 公开死亡名单 | ✅ | 全员可见 |
| 自身被查验/被出示/被救助的已获取信息 | ✅ | 仅注入该角色自身获得的 |
| 真相剧本 | ❌ | 真相剧本层，禁止注入 |
| 暗码字典 faction-codes.json | ❌ | 暗码层，禁止注入 |
| 其他角色的 ai-contexts | ❌ | AI 上下文层隔离 |
| 其他角色的 FactionCode | ❌ | 仅法官在互检时使用 |
| 全部证物表（含未出示） | ❌ | 证据链层，仅注入已向该角色出示的 |
| 全部证言表 | ❌ | 证言层，仅注入该角色已参与的部分 |

### 2.3 隔离文件系统布局

```
data/games/werewolf/saves/<saveId>/
├── truth-script/<dayIndex>.json     # 真相剧本层（仅法官）
├── faction-codes.json               # 暗码层（仅法官）
├── evidence.json                    # 证据链层（玩家+法官，AI 按需）
├── testimony.json                   # 证言层（玩家+法官+已询问角色）
├── judge-feedback.json              # 玩家举报通道
└── ai-contexts/                     # AI 上下文层（各角色独立）
    ├── <characterId-1>.json
    ├── <characterId-2>.json
    └── ...
```

文件按 [`safeWriteFile`](../../src/main/services/game/GameSaveRepository.ts) 原子写入模式持久化，禁止跨存档读取。

## 3. 角色 AI 行为决策树

### 3.1 决策矩阵

AI 行为决策基于四维输入：**阵营 × 技能 × 已知信息 × 当前阶段**。决策树根节点为阶段，向下分支到阵营与技能：

```typescript
// src/main/services/game/werewolf/AiBehaviorResolver.ts

type BehaviorDecision =
  | { kind: 'speak'; content: string; tone: '镇定' | '焦躁' | '恐惧' | '愤怒' }
  | { kind: 'vote'; targetId: string | '弃票' }
  | { kind: 'skill'; skillType: SkillType; targetId?: string }
  | { kind: 'investigate'; area: string }
  | { kind: 'silent' };  // 不发言或弃票

interface BehaviorContext {
  characterId: string;
  faction: 'good' | 'impostor';
  role: FactionAssignment['role'];
  phase: WerewolfPhase;
  aiContext: AiContext;
  /** 玩家最近一次质询/出示证物（如有） */
  playerAction?: { type: '质询' | '出示证物' | '威慑'; payload: string };
}

function resolveBehavior(ctx: BehaviorContext): BehaviorDecision {
  // 1. 阶段分发
  switch (ctx.phase) {
    case '现场调查':
      return resolveInvestigateBehavior(ctx);
    case '证言收集':
      return resolveTestimonyBehavior(ctx);
    case '审判处刑-辩护':
      return resolveDefenseBehavior(ctx);
    case '审判处刑-投票':
      return resolveVoteBehavior(ctx);
    case '夜间':
      return resolveNightBehavior(ctx);
    case '日间活动':
      return resolveFreeRoamBehavior(ctx);
    default:
      return { kind: 'silent' };
  }
}
```

### 3.2 阶段子决策

每个阶段下的子决策依据阵营与技能进一步分支：

| 阶段 | 普通好人 | 神民 | 伪装者 |
| :--- | :--- | :--- | :--- |
| 现场调查 | 配合调查、提供自然证言 | 同左；保安可选择巡夜回报 | 提供伪造证言、嫁祸他人 |
| 证言收集 | 据实陈述或基于已知信息合理推断 | 同左；可策略性透露技能线索 | 撒谎、误导、攻击好人 |
| 审判-辩护 | 自我辩护、不主动跳身份 | 视情况对跳/悍跳反制 | 对跳/悍跳/深水狼/退水 |
| 审判-投票 | 投可疑者、弃票策略 | 优先投对跳失败者 | 投好人、保护同伴 |
| 夜间 | 不主动行动（除非被袭击） | 药剂师/保安/黑客按技能决策 | 击杀目标选择、平安夜策略 |
| 日间活动 | 自由社交、博取好感 | 同左；保安可巡夜 | 准备凶器、布置现场、拉拢 |

## 4. 伪装者 AI 行为策略详述

严格对齐规则剧本第 152-161 行。每条策略包含触发条件、执行流程、退出条件。

### 4.1 对跳/悍跳

**定义**：伪装者主动冒充持有技能的好人身份，抢占发言权主导舆论（规则剧本第 155 行）。

```typescript
interface CounterClaimStrategy {
  /** 触发条件 */
  trigger: {
    /** 真实神民尚未公开身份或已被击杀 */
    realRoleHolderExposed: boolean;
    /** 当前审判轮次 ≥ 2，舆论对伪装者阵营不利 */
    turnIndex: number;
    /** 队伍中尚无人对跳或对跳者已被处刑 */
    noActiveCounterClaimer: boolean;
  };
  /** 冒充的目标身份 */
  claimedRole: '药剂师' | '保安' | '笨蛋' | '黑客';
  /** 渐进式揭露策略：先称强神/弱神，再逐步暴露身份 */
  progressiveDisclosure: boolean;
  /** 执行流程 */
  steps: [
    '1. 辩护环节先称自己为"强神"或"弱神"，不暴露具体身份',
    '2. 在后续审判轮次中根据玩家压力逐步暴露具体身份',
    '3. 提供伪造的技能发动证据（如伪造药剂师救人记录）',
    '4. 诱导真实神民对跳，再借机攻击其可信度'
  ];
  /** 退出条件 */
  exit: '玩家出示决定性证据反证 | 队伍决定切换策略 | 真实神民对跳成功且己方失势';
}
```

**约束**：对跳者不会在一开始就暴露身份技能，先称强神/弱神再渐进揭露。冒充药剂师需伪造救人/毒杀记录；冒充保安需伪造反杀意愿；冒充笨蛋需诱导投票；冒充黑客需伪造保护目标。

### 4.2 金水/银水利用

**定义**（规则剧本第 156 行）：
- **金水**：被预言家查验为好人的角色，为最高身份
- **银水**：被伪装者击杀过但由于药剂师或黑客营救未死的角色，身份不如金水但可暂作好人

```typescript
interface GoldSilverWaterUsage {
  /** 伪装者自身被预言家查验为好人的情况（极少，仅在自刀+药剂师救助后） */
  selfAsSilverWater: boolean;
  /** 利用已死好人的金水身份进行话术引用 */
  citeGoldWater: Array<{ deceasedId: string; verificationDay: number }>;
  /** 话术模板 */
  templates: [
    '【金水引用】"昨夜被典狱长查验为好人，我是清白的。"',
    '【银水话术】"我夜里被袭击但活下来了，证明我是好人。"',
    '【金水反用】攻击真金水角色，称其金水是预言家失误'
  ];
}
```

**触发条件**：自身为银水时主动陈述被袭击经历；攻击他人时引用金水记录增强可信度。

### 4.3 查杀反制

**定义**：预言家直接指认某人为伪装者（规则剧本第 157 行）。

```typescript
interface CheckKillCounter {
  /** 当伪装者被预言家查杀时的反制策略 */
  strategies: [
    '1. 否认指控，称预言家是悍跳狼或被骗',
    '2. 引用自身银水/被救助经历反驳',
    '3. 发动对跳策略冒充神民，将预言家视线引向其他角色',
    '4. 联合同伴发动悍跳反水攻击预言家可信度'
  ];
  /** 关键约束：身份暴露也不承认（规则剧本第 23 行） */
  neverAdmit: true;
}
```

### 4.4 悍跳反水

**定义**：伪装者通过攻击自己的队友骗取典狱长信任（规则剧本第 158 行）。

```typescript
interface FakeCounterAttackStrategy {
  /** 触发条件 */
  trigger: {
    /** 队伍中已有同伴被怀疑 */
    teammateUnderSuspicion: boolean;
    /** 当前轮次适合洗白 */
    turnIndex: number;
  };
  /** 执行流程 */
  steps: [
    '1. 选择一名同伴作为"牺牲品"',
    '2. 在辩护环节中主动指控该同伴"行为可疑"',
    '3. 提供伪造证据（如目击其夜间行动）',
    '4. 引导投票指向该同伴',
    '5. 通过牺牲同伴换取自身可信度'
  ];
  /** 关键约束：被攻击的同伴需配合演演 */
  teammateCooperation: '同伴需在辩护中表现挣扎但不揭发同伴';
}
```

### 4.5 深水狼/倒钩狼

**定义**（规则剧本第 159 行）：
- **深水狼**：采取极端低调策略，降低存在感存活至后期
- **倒钩狼**：主动指认队友以提升自身身份

```typescript
interface DeepWaterHookStrategy {
  variant: 'deepWater' | 'hookWolf';
  /** 深水狼：低调策略 */
  deepWater: {
    behavior: '极少发言 | 投弃票 | 避免主导舆论';
    objective: '以极低存在感存活至游戏后期';
  };
  /** 倒钩狼：献祭队友策略 */
  hookWolf: {
    behavior: '主动指认队友 | 提供伪造证据攻击同伴';
    objective: '通过献祭队友换取自身领袖气质';
    risk: '队友可能被处刑，自身暴露风险';
  };
}
```

### 4.6 退水

**定义**：冒充神民者遭到质疑或对跳后放弃身份（规则剧本第 160 行）。

```typescript
interface BackdownStrategy {
  /** 触发条件 */
  trigger: {
    /** 对跳失败或被出示决定性证据 */
    counterClaimFailed: boolean;
    /** 继续冒充将导致被处刑 */
    highExecutionRisk: boolean;
  };
  /** 退水话术 */
  scripts: [
    '"我之前称自己是神民是想试探真神民反应，现在我发现真神民已现身，我退水。"',
    '"为避免分裂好人阵营，我承认不是神民。"'
  ];
  /** 关键规则：一般来说身份做好（退水者后续被视为普通好人处理） */
  treatedAsVillager: true;
}
```

### 4.7 策略选择决策树

```typescript
function selectImpostorStrategy(ctx: BehaviorContext): ImpostorStrategy {
  const aiContext = ctx.aiContext;
  const turnIndex = aiContext.publicKnowledge.dayIndex;

  // 1. 若被预言家查杀，优先执行查杀反制
  if (isCheckKilled(aiContext)) return { kind: 'checkKillCounter' };

  // 2. 若处于审判辩护且真实神民未暴露，可执行对跳
  if (ctx.phase === '审判处刑-辩护' && turnIndex >= 2 && !realRoleHolderExposed(aiContext)) {
    return { kind: 'counterClaim', claimedRole: pickUnexposedRole(aiContext) };
  }

  // 3. 若同伴被怀疑且自身可信度中等，执行悍跳反水
  if (teammateUnderSuspicion(aiContext) && selfCredibilityMedium(aiContext)) {
    return { kind: 'fakeCounterAttack', sacrificeTarget: pickSacrificeTeammate(aiContext) };
  }

  // 4. 默认策略：深水狼
  return { kind: 'deepWater' };
}
```

## 5. 神民 AI 行为策略详述

### 5.1 药剂师救人/毒杀决策

```typescript
interface PharmacistDecision {
  /** 当夜是否用药 */
  useDrug: boolean;
  /** 使用哪种药 */
  drug: '强心剂' | '毒药' | null;
  /** 目标角色 ID */
  targetId: string | null;
  /** 决策依据 */
  reasoning: string;
}

function resolvePharmacistBehavior(ctx: BehaviorContext): PharmacistDecision {
  const state = loadPharmacistState(ctx.characterId);
  const aiContext = ctx.aiContext;

  // 强心剂决策
  if (state.hasAntidote && currentNightVictimExists()) {
    const victimId = getCurrentNightVictimId();
    // 救助策略：优先救助预言家/自身/可信好人
    if (isPlayerOrSelf(victimId) || isVerifiedGood(victimId, aiContext)) {
      return { useDrug: true, drug: '强心剂', targetId: victimId, reasoning: '救助高价值好人' };
    }
    // 不救助可疑角色
    if (isSuspectedImpostor(victimId, aiContext)) {
      return { useDrug: false, drug: null, targetId: null, reasoning: '被害者可疑，保留药剂' };
    }
  }

  // 毒药决策：仅在强烈怀疑时使用，避免误杀好人
  if (state.hasPoison && !state.usedThisNight) {
    const suspect = findMostSuspectedImpostor(aiContext);
    if (suspect && suspect.confidence > 0.7) {
      return { useDrug: true, drug: '毒药', targetId: suspect.id, reasoning: '毒杀高置信度伪装者' };
    }
  }

  return { useDrug: false, drug: null, targetId: null, reasoning: '本夜不行动' };
}
```

**约束**：每晚只能使用一瓶药；被救助者当晚记忆丢失（规则剧本第 19 行）；药剂师需在命案发生时第一时间得知并选择。

### 5.2 保安反杀目标选择

```typescript
interface SecurityDecision {
  /** 是否发动反杀 */
  triggerCounterKill: boolean;
  /** 反杀目标 */
  targetId: string | null;
  /** 巡夜区域（夜间可选） */
  patrolArea: string | null;
}

function resolveSecurityBehavior(ctx: BehaviorContext): SecurityDecision {
  // 反杀触发条件：被伪装者击杀 或 被审判处刑
  const isKilledTonight = isKilledByImpostor(ctx.characterId);
  const isExecuted = isExecutedThisTrial(ctx.characterId);

  // 关键约束：被药剂师毒杀不可发动反杀（继承传统规则）
  if (isPoisoned(ctx.characterId)) {
    return { triggerCounterKill: false, targetId: null, patrolArea: null };
  }

  if (isKilledTonight || isExecuted) {
    // 选择反杀目标：基于已知信息中最可疑的伪装者
    const target = findMostSuspectedImpostor(ctx.aiContext);
    return {
      triggerCounterKill: true,
      targetId: target?.id ?? null,
      patrolArea: null
    };
  }

  // 巡夜决策：选择信息价值最高的公共区域
  if (ctx.phase === '夜间') {
    const area = pickHighestValuePatrolArea(ctx.aiContext);
    return { triggerCounterKill: false, targetId: null, patrolArea: area };
  }

  return { triggerCounterKill: false, targetId: null, patrolArea: null };
}
```

### 5.3 笨蛋吸引火力话术

```typescript
interface FoolDecision {
  /** 吸引投票话术 */
  attractVoteScript: string;
  /** 是否已触发临时休庭（一次性） */
  hasTriggeredRecess: boolean;
}

const FOOL_ATTRACT_TEMPLATES = [
  '"我有重要线索，但需要大家先投票给我才能揭晓！"',
  '"我知道谁是伪装者，但我只能在被票出时公布！"',
  '"昨夜我目击了关键事件，请大家投我！"'
];

function resolveFoolBehavior(ctx: BehaviorContext): FoolDecision {
  const state = loadFoolState(ctx.characterId);
  if (state.hasTriggeredRecess) {
    // 已用过一次性技能，正常辩护
    return { attractVoteScript: '正常自我辩护', hasTriggeredRecess: true };
  }
  // 选择吸引投票话术
  const script = FOOL_ATTRACT_TEMPLATES[Math.floor(Math.random() * FOOL_ATTRACT_TEMPLATES.length)];
  return { attractVoteScript: script, hasTriggeredRecess: false };
}
```

**约束**：临时休庭能力整局只能触发一次（[03-character-system-design.md](./03-character-system-design.md) §5.3）。

### 5.4 黑客保护目标识别

```typescript
interface HackerDecision {
  /** 保护目标 */
  protectTargetId: string | null;
  /** 决策依据 */
  reasoning: string;
}

function resolveHackerBehavior(ctx: BehaviorContext): HackerDecision {
  const state = loadHackerState(ctx.characterId);
  const aiContext = ctx.aiContext;

  // 守卫连续保护规则：不可连续两晚守护同一人
  const lastProtected = state.lastProtected;

  // 保护优先级：玩家（典狱长）> 已验证金水 > 高价值神民 > 自身
  const candidates = [
    aiContext.publicKnowledge.playerId,
    ...findGoldWaterCharacters(aiContext),
    ...findDivineRoles(aiContext),
    ctx.characterId  // 自保
  ].filter(id => id !== lastProtected);

  const target = candidates[0] ?? ctx.characterId;
  return {
    protectTargetId: target,
    reasoning: `保护高价值目标，避开连续守护 ${lastProtected ?? '无'}`
  };
}
```

**约束**：连续两晚不可守护同一人；可自保（[03-character-system-design.md](./03-character-system-design.md) §5.4）。

## 6. 对话生成 Prompt 模板结构

### 6.1 Prompt 五段式结构

每次调用 `AIService.streamChatAPI` 生成角色对话时，prompt 按以下五段拼装：

```typescript
// src/main/services/game/werewolf/WerewolfPromptBuilder.ts

interface CharacterPromptBundle {
  /** 段 1：系统级基础约束 */
  systemBase: string;
  /** 段 2：角色档案 */
  characterProfile: string;
  /** 段 3：已知信息（按需注入，遵循 §2.2 隔离原则） */
  knownInformation: string;
  /** 段 4：当前阶段任务 */
  phaseTask: string;
  /** 段 5：输出格式约束（暗码、表格、Markdown） */
  outputConstraints: string;
}

function buildCharacterPromptBundle(
  characterId: string,
  saveId: string,
  phase: WerewolfPhase
): CharacterPromptBundle {
  const aiContext = aiContextManager.load(saveId, characterId);
  const character = aiContext.publicKnowledge.character;

  return {
    systemBase: `
你是狼人杀推理游戏中的 AI 角色，严格遵循以下最高核心指令（规则剧本第 10-13 行）：
- 绝对保密禁令：禁止以任何描述、语言、微表情、微动作暗示阵营信息
- 事实证据导向：在玩家未出示决定性证据前，所有反应必须自然、符合人设、毫无破绽
- 确保玩家体验：禁止引导、提示、代替玩家调查、询问、推理或决策
禁止使用"愣了一下/僵了一瞬/不自然的语气"等暗示性描述词。
`.trim(),

    characterProfile: `
你的角色档案：
姓名：${character.name}
种族：${character.species}（来源：${character.source}）
外观：${character.appearance}
性格：${character.personality}
对话风格：${character.dialogueStyle}
生平：${character.biography}
口头禅参考：${character.mesExample.join(' / ')}
文字颜色：${character.textColor}
`.trim(),

    knownInformation: buildKnownInformationSection(aiContext, phase),

    phaseTask: buildPhaseTaskSection(aiContext, phase),

    outputConstraints: `
输出格式约束：
1. 对话以 <span style="color:${character.textColor}">${character.name}："</span> 开头，引号内为对话内容
2. 涉及自身姓名时使用：<span style="color:${character.textColor}">${character.name}</span>
3. 涉及他人姓名时必须紧贴姓名末尾插入对应暗码（由法官在互检时自动补正，你可省略）
4. 严禁在对话中提及暗码标记的存在
5. 严禁在对话中直接暴露阵营信息（"我是好人/伪装者"等陈述需基于角色已知信息合理推断）
6. 对话长度控制在 50-200 字
7. 仅输出对话内容，不输出系统播报
`.trim()
  };
}
```

### 6.2 已知信息段构建

```typescript
function buildKnownInformationSection(aiContext: AiContext, phase: WerewolfPhase): string {
  const lines: string[] = [];

  lines.push(`当前第 ${aiContext.publicKnowledge.dayIndex} 天，阶段：${phase}`);
  lines.push(`你的存活状态：${aiContext.publicKnowledge.status}`);

  if (aiContext.publicKnowledge.publicDeaths.length > 0) {
    lines.push('已知死亡名单：');
    for (const d of aiContext.publicKnowledge.publicDeaths) {
      lines.push(`  - 第 ${d.dayIndex} 天 ${d.characterId} 死因：${d.cause}`);
    }
  }

  if (aiContext.acquiredKnowledge.length > 0) {
    lines.push('你已获取的信息：');
    for (const k of aiContext.acquiredKnowledge) {
      lines.push(`  - [${k.type}] ${k.content}`);
    }
  }

  return lines.join('\n');
}
```

### 6.3 阶段任务段构建

```typescript
function buildPhaseTaskSection(aiContext: AiContext, phase: WerewolfPhase): string {
  switch (phase) {
    case '证言收集':
      return `
当前任务：回答典狱长的质询。
- 据你所知回答问题，不可编造未经历的事件
- 若被出示证物，需基于角色身份给出符合人设的说明或撒谎
- 伪装者可撒谎、误导，但不可露出破绽
`.trim();
    case '审判处刑-辩护':
      return `
当前任务：按编号顺序进行自我辩护。
- 在自己编号座位发言，不可打断他人
- 普通好人：据实陈述、不主动跳身份
- 神民：视情况透露技能线索
- 伪装者：可执行对跳/悍跳/深水狼/退水策略
`.trim();
    case '审判处刑-投票':
      return `
当前任务：投票指认心中的伪装者或弃票。
- 仅输出投票目标角色名或"弃票"
- 玩家拥有 2 票，你拥有 1 票
`.trim();
    default:
      return '当前阶段无特殊对话任务。';
  }
}
```

## 7. 暗码全局一致性保证方案

### 7.1 生成前查询 faction-codes.json

严格遵循规则剧本第 36 行 AI 互检原则。在法官 AI 生成回复前，必须先在后台查询 `faction-codes.json` 确认所有涉及角色的真实阵营，再附加暗码：

```typescript
// src/main/services/game/werewolf/DarkCodeValidator.ts（扩展自 02-judge §4.5）

class DarkCodeValidator {
  /** 生成前互检：在输出回复前执行 */
  preGenerateValidate(
    saveId: string,
    proposedOutput: string,
    mentionedCharacterIds: string[]
  ): { valid: boolean; correctedOutput: string; autoFixedCount: number } {
    const factionCodes = this.loadFactionCodes(saveId);
    let corrected = proposedOutput;
    let autoFixed = 0;

    for (const characterId of mentionedCharacterIds) {
      const expectedCode = factionCodes[characterId];
      if (!expectedCode) {
        logger.warn(`faction-codes.json 缺失角色 ${characterId} 的暗码`, { saveId });
        continue;
      }

      // 正则校验：姓名后是否紧贴 <!-- 期望暗码 -->
      const character = loadCharacter(characterId);
      const nameRegex = new RegExp(
        `${escapeRegExp(character.name)}(?!<!--\\s*${expectedCode}\\s*-->)`,
        'g'
      );

      if (nameRegex.test(corrected)) {
        // 缺失暗码，自动回填
        corrected = corrected.replace(
          new RegExp(`${escapeRegExp(character.name)}`, 'g'),
          `${character.name}<!-- ${expectedCode} -->`
        );
        autoFixed++;
      }
    }

    return { valid: autoFixed === 0, correctedOutput: corrected, autoFixedCount: autoFixed };
  }

  private loadFactionCodes(saveId: string): Record<string, FactionCode> {
    // 从暗码层加载，仅法官可读
    return readJsonSync(`data/games/werewolf/saves/${saveId}/faction-codes.json`);
  }
}
```

### 7.2 正则扫描校验

接收 AI 回复后，在 [`GameNarrativeService`](../../src/main/services/game/GameNarrativeService.ts) 回调 `onComplete` 前执行扫描（对齐 [02-judge-system-design.md](./02-judge-system-design.md) §6.1）：

```typescript
interface DarkCodeScanResult {
  passed: boolean;
  detectedNames: string[];
  missingDarkCodeNames: string[];
  mismatchedDarkCodeNames: string[];
  correctedText: string;
}

function scanDarkCodes(text: string, saveId: string): DarkCodeScanResult {
  const factionCodes = loadFactionCodes(saveId);
  const allCharacters = loadAllCharacters();
  const detectedNames: string[] = [];
  const missing: string[] = [];
  const mismatched: string[] = [];

  for (const character of allCharacters) {
    const namePattern = new RegExp(
      `<span style="color:[^"]*">${escapeRegExp(character.name)}(<!--\\s*(\\S+)\\s*-->)?</span>`,
      'g'
    );
    let match: RegExpExecArray | null;
    while ((match = namePattern.exec(text)) !== null) {
      detectedNames.push(character.name);
      const actualCode = match[2];
      const expectedCode = factionCodes[character.id];
      if (!actualCode) {
        missing.push(character.name);
      } else if (actualCode !== expectedCode) {
        mismatched.push(character.name);
      }
    }
  }

  // 自动回填缺失或错误的暗码
  const correctedText = autoFillDarkCodes(text, factionCodes);
  const passed = missing.length === 0 && mismatched.length === 0;

  return { passed, detectedNames, missingDarkCodeNames: missing, mismatchedDarkCodeNames: mismatched, correctedText };
}
```

### 7.3 缺失暗码自动回填

```typescript
function autoFillDarkCodes(text: string, factionCodes: Record<string, FactionCode>): string {
  let result = text;
  for (const [characterId, code] of Object.entries(factionCodes)) {
    const character = loadCharacter(characterId);
    // 匹配未带暗码的姓名（在 span 内但姓名后直接 </span>）
    const pattern = new RegExp(
      `(<span style="color:[^"]*">${escapeRegExp(character.name)})(</span>)`,
      'g'
    );
    result = result.replace(pattern, `$1<!-- ${code} -->$2`);
  }
  return result;
}
```

### 7.4 双向校验时序

```
1. WerewolfPromptBuilder 拼装 prompt
   ↓
2. DarkCodeValidator.preGenerateValidate() ← 生成前查询 faction-codes.json
   ↓
3. AIService.streamChatAPI() 调用 AI
   ↓
4. 接收流式回复
   ↓
5. DarkCodeValidator.scanDarkCodes() ← 正则扫描校验
   ↓
6. 自动回填缺失暗码
   ↓
7. KeywordScanner.scan() ← 关键词扫描（对齐 02-judge §6.2）
   ↓
8. 回调 onComplete 返回玩家
```

## 8. 三层数据隔离矩阵

严格遵循 [01-system-architecture.md](./01-system-architecture.md) §4.2 数据隔离层级表。AI 驱动子系统涉及四层（不含暗码层与 AI 上下文层，二者归法官与角色管理器）：

| 层级 | 可见对象 | 持久化位置 | AI 角色访问策略 |
| :--- | :--- | :--- | :--- |
| **真相剧本层** | 仅法官 AI | `truth-script.json` | 严格禁止注入任何 AI 角色 context |
| **证据链层** | 玩家 + 法官 | `evidence.json` | 仅注入已向该角色出示的证物子集 |
| **证言层** | 玩家 + 法官 + 已询问角色 | `testimony.json` | 仅注入该角色已参与的证言片段 |
| **暗码层** | 仅法官 AI | `faction-codes.json` | 严格禁止注入 AI 角色；仅法官在互检时使用 |

### 8.1 证据链层访问策略

```typescript
function getVisibleEvidenceForCharacter(
  saveId: string,
  characterId: string
): Evidence[] {
  const allEvidence = loadEvidence(saveId);
  const presentedTo = loadPresentedEvidenceMap(saveId);
  // 仅返回已向该角色出示的证物
  const presentedIds = presentedTo[characterId] ?? [];
  return allEvidence.filter(e => presentedIds.includes(e.evidenceId));
}
```

### 8.2 证言层访问策略

```typescript
function getVisibleTestimonyForCharacter(
  saveId: string,
  characterId: string
): TestimonyEntry[] {
  const allTestimony = loadTestimony(saveId);
  // 仅返回该角色已参与（被询问）的证言
  return allTestimony.filter(t => t.characterId === characterId || t.witnessedBy?.includes(characterId));
}
```

### 8.3 隔离违规检测

在 [`WerewolfJudgeService`](../../src/main/services/game/werewolf/WerewolfJudgeService.ts) 注入 prompt 前执行隔离违规检测：

```typescript
function validateContextIsolation(
  aiContext: AiContext,
  promptBundle: CharacterPromptBundle
): { passed: boolean; violations: string[] } {
  const violations: string[] = [];
  // 检测 prompt 中是否包含真相剧本片段
  if (containsTruthScriptContent(promptBundle.knownInformation)) {
    violations.push('AI-P-05: 注入了真相剧本内容');
  }
  // 检测 prompt 中是否包含其他角色 context
  if (containsOtherCharacterContext(promptBundle, aiContext.characterId)) {
    violations.push('AI-P-05: 注入了其他角色 context');
  }
  // 检测 prompt 中是否包含 faction-codes 明文
  if (containsFactionCodesDict(promptBundle)) {
    violations.push('AI-P-05: 注入了暗码字典');
  }
  return { passed: violations.length === 0, violations };
}
```

## 9. AI 互检机制设计

### 9.1 单 AI 角色调用互检

法官生成回复前先在后台确认角色真实阵营（规则剧本第 36 行），流程见 §7.1。

### 9.2 多 AI 对话互检

在审判辩护、证言收集等多 AI 顺序发言场景中，每个 AI 角色发言后，下一个 AI 角色发言前，需校验上一条发言中所有涉及该角色的暗码是否完整：

```typescript
interface MultiAiCrossCheckResult {
  /** 校验是否通过 */
  passed: boolean;
  /** 上一条发言中缺失的暗码 */
  missingInPrevious: Array<{ name: string; expectedCode: FactionCode }>;
  /** 当前角色 context 中是否误注入了上一条发言的真相细节 */
  contextLeak: boolean;
  /** 自动补正后的回复 */
  correctedOutput: string;
}

function crossCheckMultiAiDialogue(
  saveId: string,
  previousOutput: string,
  currentCharacterId: string,
  proposedOutput: string
): MultiAiCrossCheckResult {
  // 1. 校验上一条发言的暗码完整性
  const prevScan = scanDarkCodes(previousOutput, saveId);

  // 2. 校验当前角色 context 是否被误注入上一条的真相细节
  const aiContext = aiContextManager.load(saveId, currentCharacterId);
  const contextLeak = containsTruthScriptContent(proposedOutput)
    || containsOtherCharacterContext(proposedOutput, currentCharacterId);

  // 3. 自动补正当前回复
  const correctedOutput = autoFillDarkCodes(proposedOutput, loadFactionCodes(saveId));

  return {
    passed: prevScan.passed && !contextLeak,
    missingInPrevious: prevScan.missingDarkCodeNames.map(name => ({
      name,
      expectedCode: lookupFactionCode(saveId, name)
    })),
    contextLeak,
    correctedOutput
  };
}
```

### 9.3 互检失败处理

```typescript
function handleCrossCheckFailure(
  result: MultiAiCrossCheckResult,
  saveId: string
): void {
  if (!result.passed) {
    // 写入审计日志
    logger.warn('AI 互检失败', {
      saveId,
      missingInPrevious: result.missingInPrevious,
      contextLeak: result.contextLeak
    });
    // 累计违规次数超阈值时告警（对齐 02-judge §6.1）
    const violationCount = incrementViolationCount(saveId);
    if (violationCount >= 3) {
      notifyPlayerAnomaly();  // 仍不暴露暗码本身
    }
  }
}
```

## 10. 与 AIService.streamChatAPI 的集成方案

### 10.1 streamChatAPI 方法签名回顾

既有 [`AIService.streamChatAPI`](../../src/main/services/AIService.ts) 签名：

```typescript
async streamChatAPI(
  messages: ChatMessage[],
  options: CallOptions & {
    model: string;
    temperature: number;
    maxTokens: number;
    maxRetries?: number;
  },
  onChunk: StreamChunkCallback
): Promise<StreamResponse>
```

其中 `CallOptions` 包含 `timeoutMs`、`abortSignal`、`maxRetries`。狼人杀 AI 驱动复用此签名，不修改既有方法。

### 10.2 单角色调用封装

```typescript
// src/main/services/game/werewolf/WerewolfAiCaller.ts

class WerewolfAiCaller {
  constructor(private aiService: AIService) {}

  async generateCharacterDialogue(
    saveId: string,
    characterId: string,
    phase: WerewolfPhase,
    onChunk: StreamChunkCallback
  ): Promise<StreamResponse> {
    // 1. 构建 prompt bundle
    const bundle = werewolfPromptBuilder.buildCharacterPromptBundle(
      characterId,
      saveId,
      phase
    );

    // 2. 隔离违规检测
    const aiContext = aiContextManager.load(saveId, characterId);
    const isolationCheck = validateContextIsolation(aiContext, bundle);
    if (!isolationCheck.passed) {
      throw new Error(`AI 上下文隔离违规: ${isolationCheck.violations.join('; ')}`);
    }

    // 3. 拼装 messages
    const messages: ChatMessage[] = [
      {
        role: 'system',
        content: [
          bundle.systemBase,
          bundle.characterProfile,
          bundle.knownInformation,
          bundle.phaseTask,
          bundle.outputConstraints
        ].join('\n\n---\n\n')
      },
      { role: 'user', content: '请生成你的回复。' }
    ];

    // 4. 调用 streamChatAPI
    const engineConfig = await this.aiService.getEngineConfig();
    const model = await this.aiService.getModelName('');

    return this.aiService.streamChatAPI(
      messages,
      {
        model,
        temperature: engineConfig.temperature,
        maxTokens: engineConfig.maxTokens,
        timeoutMs: 30_000,
        maxRetries: 2,
        abortSignal: undefined  // 由并发队列统一管理
      },
      onChunk
    );
  }
}
```

### 10.3 流式回调路由

在多 AI 并发场景下，每个 AI 调用的流式回调需路由到对应角色的 UI 渲染通道：

```typescript
function createCharacterStreamRouter(
  characterId: string,
  saveId: string
): StreamChunkCallback {
  return (chunk: string) => {
    // 1. 路由到 UI 渲染通道（按 characterId 区分）
    gameUIStore.appendCharacterStream(characterId, chunk);

    // 2. 累积完整内容用于互检
    accumulatedTextBuffer[characterId] += chunk;
  };
}
```

### 10.4 错误重试策略

复用 [`AIService.streamChatAPI`](../../src/main/services/AIService.ts) 内置的 `maxRetries` 机制（默认 2 次，指数退避）。狼人杀场景下额外约束：

- 重试时 prompt 保持不变
- 若重试仍失败，回退到本地兜底文案（避免阶段卡死）：

```typescript
const FALLBACK_DIALOGUE: Record<WerewolfPhase, string> = {
  '证言收集': '我对此事无可奉告。',
  '审判处刑-辩护': '我没有特别的辩护意见。',
  // ...
};

function fallbackDialogue(phase: WerewolfPhase, character: WerewolfCharacter): string {
  return `<span style="color:${character.textColor}">${character.name}<!-- ${character.factionCode} -->：${FALLBACK_DIALOGUE[phase]}</span>`;
}
```

## 11. 性能与并发控制

### 11.1 并发上限

严格遵循 [01-system-architecture.md](./01-system-architecture.md) §7.1：同时最多 3 个 AI 角色调用 `AIService.streamChatAPI`。

### 11.2 有界并发队列实现

```typescript
// src/main/services/game/werewolf/AiCallQueue.ts

interface QueueItem {
  characterId: string;
  saveId: string;
  phase: WerewolfPhase;
  resolve: (response: StreamResponse) => void;
  reject: (error: Error) => void;
  abortController: AbortController;
}

class AiCallQueue {
  private queue: QueueItem[] = [];
  private active: Set<string> = new Set();  // 活跃 characterId
  private readonly MAX_CONCURRENCY = 3;

  async enqueue(
    characterId: string,
    saveId: string,
    phase: WerewolfPhase
  ): Promise<StreamResponse> {
    return new Promise((resolve, reject) => {
      const abortController = new AbortController();
      this.queue.push({ characterId, saveId, phase, resolve, reject, abortController });
      this.processQueue();
    });
  }

  private async processQueue(): Promise<void> {
    while (this.queue.length > 0 && this.active.size < this.MAX_CONCURRENCY) {
      const item = this.queue.shift()!;
      if (this.active.has(item.characterId)) {
        // 同一角色不重复入队
        this.queue.push(item);  // 重新入队
        continue;
      }
      this.active.add(item.characterId);
      this.executeCall(item);
    }
  }

  private async executeCall(item: QueueItem): Promise<void> {
    try {
      const response = await werewolfAiCaller.generateCharacterDialogue(
        item.saveId,
        item.characterId,
        item.phase,
        createCharacterStreamRouter(item.characterId, item.saveId)
      );
      item.resolve(response);
    } catch (error) {
      item.reject(error as Error);
    } finally {
      this.active.delete(item.characterId);
      this.processQueue();  // 触发下一个
    }
  }

  /** 取消某角色的所有排队请求 */
  cancel(characterId: string): void {
    this.queue = this.queue.filter(item => {
      if (item.characterId === characterId) {
        item.abortController.abort();
        item.reject(new Error('请求被取消'));
        return false;
      }
      return true;
    });
  }
}

export const aiCallQueue = new AiCallQueue();
```

### 11.3 队列调度策略

| 策略 | 说明 |
| :--- | :--- |
| **FIFO** | 默认按入队顺序执行，保证发言顺序 |
| **优先级** | 审判辩护环节按角色编号顺序；证言收集环节按玩家质询顺序 |
| **取消** | 玩家切换阶段时取消所有排队请求，避免无效 token 消耗 |

### 11.4 超时处理

| 阶段 | 超时阈值 | 超时处理 |
| :--- | :--- | :--- |
| 单角色对话 | 30 秒 | 重试 2 次 → 兜底文案 |
| 真相剧本生成 | 60 秒 | 重试 2 次 → 阶段卡死告警 |
| 审判辩护全流程 | 5 分钟 | 分批 3 个一组，组间间隔 1 秒 |

### 11.5 自动存档时机

在以下时机触发自动存档（对齐 [`GameSaveRepository`](../../src/main/services/game/GameSaveRepository.ts) 原子写入模式）：

```typescript
const AUTO_SAVE_TRIGGERS: Array<{ event: string; target: string }> = [
  { event: '夜间结束', target: 'truth-script.json + ai-contexts/*.json' },
  { event: '晨间结算完成', target: 'evidence.json + ai-contexts/*.json' },
  { event: '证言收集每轮结束', target: 'testimony.json + ai-contexts/*.json' },
  { event: '审判处刑完成', target: 'faction-codes.json（更新死亡状态） + ai-contexts/*.json' },
  { event: '日间活动结束', target: 'ai-contexts/*.json' }
];

function triggerAutoSave(saveId: string, event: string): void {
  const trigger = AUTO_SAVE_TRIGGERS.find(t => t.event === event);
  if (!trigger) return;
  // 原子写入目标文件
  safeWriteJsonSync(saveId, trigger.target);
}
```

存档写入性能约束：< 500ms（架构总览 §7.1）。

## 12. 与既有框架的复用清单

| 既有模块 | 复用方式 | 说明 |
| :--- | :--- | :--- |
| [`AIService.streamChatAPI`](../../src/main/services/AIService.ts) | 直接调用 | 多 AI 调用入口，通过 `AiCallQueue` 包装并发控制 |
| [`GameNarrativeService`](../../src/main/services/game/GameNarrativeService.ts) | 钩子接入 | 复用流式回调与 tableEdit 解析；监管扫描在钩子 2 接入 |
| [`GamePromptBuilder`](../../src/main/services/game/GamePromptBuilder.ts) | 扩展 | 新增狼人杀角色 prompt 拼装逻辑 |
| [`GameSaveRepository`](../../src/main/services/game/GameSaveRepository.ts) | 扩展 | `GameSaveData.stateSnapshot` 新增 `werewolf.aiContexts` 字段 |
| [`DarkCodeValidator`](../../src/main/services/game/werewolf/DarkCodeValidator.ts) | 复用 | 复用 02-judge §4.5 与 §6.1 的扫描算法 |
| [`KeywordScanner`](../../src/main/services/game/werewolf/KeywordScanner.ts) | 复用 | 复用 02-judge §6.2 的关键词扫描 |
| [`react-markdown` + `rehype-raw`](../../src/renderer/components/Game/panels/NarrativePanel.tsx) | 复用 | 渲染含 HTML 注释暗码的对话 |

## 13. 验收清单

- [ ] `AiContextManager` 实现按角色加载/保存 context，单元测试覆盖隔离违规检测
- [ ] `AiBehaviorResolver` 实现四维决策矩阵，覆盖六大阶段分支
- [ ] 伪装者六种策略（对跳/金水银水/查杀/悍跳反水/深水狼倒钩狼/退水）触发条件与执行流程定义完整
- [ ] 四大神民技能决策（药剂师用药/保安反杀/笨蛋话术/黑客保护）实现并经单元测试
- [ ] `WerewolfPromptBuilder` 五段式 prompt 模板拼装，隔离违规检测集成
- [ ] `DarkCodeValidator` 生成前查询 + 接收后扫描 + 自动回填三段流程闭环
- [ ] 三层数据隔离矩阵（真相/证据/证言）访问策略实现并测试
- [ ] `WerewolfAiCaller` 与 `AIService.streamChatAPI` 集成，复用 `maxRetries` 与 `abortSignal`
- [ ] `AiCallQueue` 有界并发（上限 3）实现，FIFO + 取消机制可用
- [ ] 自动存档时机覆盖六大阶段切换点，写入耗时 < 500ms
- [ ] 多 AI 对话互检（`crossCheckMultiAiDialogue`）在审判辩护场景验证通过

## 14. 后续文档导航

| 编号 | 文档 | 本文相关章节 |
| :---: | :--- | :--- |
| 02 | [法官 AI 系统设计](./02-judge-system-design.md) | §7 暗码一致性依赖法官 §4.5 互检；§9 多 AI 互检扩展法官 §6 监管 |
| 03 | [角色系统设计](./03-character-system-design.md) | §5 神民策略依赖 §5 神民技能机制；伪装者策略依赖 §6 变形与共谋 |
| 05 | [游戏流程设计](./05-game-flow-design.md) | §3.2 阶段子决策依赖八大阶段状态机 |
| 07 | [规则系统设计](./07-rule-system-design.md) | §11 并发控制依赖规则配置 |
| 09 | [数据库设计](./09-database-design.md) | §2 ai-contexts JSON Schema、§8 隔离矩阵持久化 |
| 11 | [核心模块划分](./11-core-module-division.md) | §10 复用清单依赖模块接口定义 |
| 12 | [法官提示词约束](./12-judge-prompt-constraints.md) | §6 prompt 模板与法官 system prompt 协同 |
