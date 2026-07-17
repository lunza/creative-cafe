# 03 - 角色系统设计

> 本文档是狼人杀推理游戏策划阶段的角色系统设计文档，遵循 [01-system-architecture.md](./01-system-architecture.md) 总览与术语表，规则依据 [逆转裁判+狼人杀规则.txt](../逆转裁判+狼人杀规则.txt)。涉及阵营/技能的暗码标记规则严格遵循规则文档第 25-37 行。

## 1. 设计目标与定位

角色系统对应架构总览中的 **02 角色系统** 子系统，负责角色档案管理、阵营与技能分配、自定义角色创建、角色 CRUD、导入导出。核心约束：

- **阵营分配不可与外观/性格/武力值绑定**（规则文档第 41 行明确禁止）
- **暗码由系统在身份初始化时分配，用户不可指定**（规则文档第 188 行）
- **暗码全局不变**：自身份初始化起，法官 AI 在所有输出中始终携带，玩家不可见但持久化于存档
- 所有角色数据存储于 `data/games/werewolf/characters/<characterId>.json`，支持热插拔

## 2. 角色档案数据结构

### 2.1 核心 TypeScript 接口

```typescript
// src/shared/types/werewolf.types.ts

/**
 * 狼人杀角色档案。
 * 基于既有 SillyTavern 角色卡 v3 扩展，新增狼人杀专属字段。
 */
export interface WerewolfCharacter {
  /** 唯一标识，UUIDv4，由系统在创建时生成 */
  id: string;
  /** 原作姓名（保留原名，规则文档第 192 行） */
  name: string;
  /** 英文名/罗马音 */
  nickname?: string;
  /** 种族（如：兔、狐、狼、猫、刺猬、驯鹿、数码兽、机械） */
  species: string;
  /** 来源作品（如：疯狂动物城） */
  source: string;
  /** 详细外观描写（毛色、衣着、特征） */
  appearance: string;
  /** 身材数据：身高 / 体重 / 罩杯（规则文档第 195 行要求） */
  bodyData: {
    height?: string;  // 如 "98cm" / "172cm"
    weight?: string;  // 如 "3kg" / "55kg"
    cup?: string;     // 如 "B" / "-"（无）
  };
  /** 原作性格描述 */
  personality: string;
  /** 生平简介 / 背景故事摘要 */
  biography: string;
  /** 对话风格（语气与口头禅，规则文档第 198 行） */
  dialogueStyle: string;
  /** 首条问候语（供 AI 上下文初始化，复用既有 first_mes） */
  firstMes: string;
  /** 对话示例数组（复用既有 mes_example） */
  mesExample: string[];
  /** 文字颜色：HEX 格式，符合其外观的唯一配色（规则文档第 199 行） */
  textColor: string;
  /** 初始物品：恰好 4 项（规则文档第 200 行） */
  initialItems: string[];
  /** 标签数组（复用既有 tags） */
  tags: string[];
  /** 创建者标识 */
  creator: string;
  /** 卡版本号 */
  characterVersion: string;
  /** 暗码：阵营/技能标记，仅法官 AI 可见，初始化后不变 */
  factionCode?: FactionCode;
  /** 创建时间 ISO 字符串 */
  createdAt: string;
  /** 最后修改时间 ISO 字符串 */
  updatedAt: string;
}

/**
 * 暗码枚举，严格对应规则文档第 30-32 行。
 * 紧贴姓名末尾以 HTML 注释形式插入。
 */
export type FactionCode =
  | '好'   // 普通好人
  | '伪'   // 伪装者
  | '药'   // 药剂师
  | '保'   // 保安
  | '笨'   // 笨蛋
  | '黑';  // 黑客

/** 阵营分配结果，存储于 faction-codes.json */
export interface FactionAssignment {
  characterId: string;
  faction: 'good' | 'impostor';
  role: 'villager' | 'pharmacist' | 'security' | 'fool' | 'hacker' | 'impostor';
  code: FactionCode;
  /** 分配时使用的种子，便于复现 */
  seed: number;
  /** 分配时间戳 */
  assignedAt: string;
}
```

### 2.2 暗码渲染规则

依据规则文档第 27-36 行：

```typescript
// 渲染姓名时附加暗码 HTML 注释
function renderNameWithCode(name: string, code: FactionCode): string {
  return `<span style="color:${textColor}">${name}<!-- ${code} --></span>`;
}
// 示例输出：<span style="color:#4682B4">朱迪<!-- 好 --></span>
```

渲染层使用既有 `react-markdown` + `rehype-raw` 渲染，HTML 注释自动隐藏（架构总览 §7.4）。

## 3. 16 人样例角色列表

以下角色全部源自规则文档第 43-60 行的样例表。**阵营与技能不在档案中预设**，由 §4 的分配算法在游戏开局随机决定。文字颜色按"符合外观的唯一配色"原则选取，确保 16 人互不冲突。

| # | 姓名 | 来源 | 种族 | 文字颜色 | 初始物品（4 项） |
| :-: | :--- | :--- | :--- | :--- | :--- |
| 1 | 朱迪 (Judy Hopps) | 疯狂动物城 | 兔 | `#4682B4` 警服蓝 | 警用对讲机、胡萝卜笔、警徽、迷你录音笔 |
| 2 | 露娜 (Loona) | 极恶老大 | 地狱犬 | `#9E9E9E` 灰白 | 哥特项圈、手机、烟盒、黑色唇膏 |
| 3 | 黛安·狐辛顿 (Diane Foxington) | 坏蛋联盟 | 狐 | `#FF8C00` 西装橘 | 西装套装、市长胸章、口红、便携镜 |
| 4 | 真 (Zhen) | 功夫熊猫4 | 狐 | `#8B4513` 棕 | 短匕首、绳索、护腕、偷来的银币 |
| 5 | 妖狐兽 (Renamon) | 数码宝贝 | 数码兽 | `#FFD700` 金黄 | 数据护符、护手、符纸、冷银链 |
| 6 | 闪焰王牌 (Cinderace) | 宝可梦 | 兔 | `#DC143C` 火红 | 足球、护腿、运动头带、能量饮料 |
| 7 | 咪·柔爪 (Kitty Softpaws) | 穿靴子的猫 | 猫 | `#2F2F2F` 墨黑 | 黑色面纱、开锁工具、丝质手套、毒药小瓶（空） |
| 8 | 西施惠 (Isabelle) | 动物森友会 | 狗 | `#DAA520` 米黄 | 文件夹、便签、领结、咖啡杯 |
| 9 | 卡瑞斯托 (Krystal) | 星际火狐 | 狐 | `#1E90FF` 星蓝 | 通讯器、能量手杖、护甲片、星图 |
| 10 | 诺埃尔 (Noelle Holiday) | 三角符文 | 驯鹿 | `#A0522D` 棕 | 围巾、魔法书、冰晶吊坠、糖果 |
| 11 | 艾咪 (Amy Rose) | 刺猬索尼克 | 刺猬 | `#FF69B4` 粉红 | 巨锤、心意卡、发箍、便当 |
| 12 | 艳后 (Ankha) | 动物森友会 | 猫 | `#FFC125` 法老金 | 蛇形臂环、法老权杖、莎草纸、香炉 |
| 13 | 罗克珊·沃尔夫 (Roxanne Wolf) | 五夜后宫 | 机械狼 | `#C0C0C0` 银灰 | 麦克风、赛道手套、备用电池、签名照片 |
| 14 | 艾露猫 (Felyne) | 怪物猎人 | 猫 | `#DEB887` 米棕 | 大厨刀、急救包、钓鱼竿、肉干 |
| 15 | 伊西克斯 (esix) | e621.net | 钢蓝兽 | `#00BFFF` 钢蓝 | 平板电脑、员工卡、口香糖、便签本 |
| 16 | 悍娇虎 (Master Tigress) | 功夫熊猫 | 虎 | `#FF8C00` 虎橙（与黛安色系不同，黛安偏橘红，此处偏橙黄，可调为 `#FFA500`） | 铁拳套、练功服、念珠、竹笛 |

> **颜色唯一性校验**：导入时由系统对 16 人颜色做去重检查，若冲突则提示用户调整。

## 4. 阵营分配算法

### 4.1 分配约束

| 阵营 | 数量 | 对应角色 |
| :--- | :---: | :--- |
| 普通好人 | 7 | 无特殊技能的村民 |
| 神民 | 4 | 药剂师 / 保安 / 笨蛋 / 黑客 各 1 人 |
| 伪装者 | 5 | 狼人阵营 |
| **总计** | **16** | |

**核心约束**（规则文档第 41 行）：
- 不可用外观、性格、特征等强行分配伪装者身份和技能拥有者身份
- 分配方式完全随机，即使是最弱小的西施惠也可能是伪装者、拥有武力的悍娇虎也不一定是保安
- 一局分配后固定不变，存档持久化

### 4.2 洗牌算法 + 种子

```typescript
// src/main/services/werewolf/FactionAssigner.ts

import { createSeedableRNG } from './seedableRng';

const ALLOCATION: Array<{ role: FactionAssignment['role']; count: number }> = [
  { role: 'villager',    count: 7 },
  { role: 'pharmacist',  count: 1 },
  { role: 'security',    count: 1 },
  { role: 'fool',        count: 1 },
  { role: 'hacker',      count: 1 },
  { role: 'impostor',    count: 5 },
];

/**
 * Fisher-Yates 洗牌分配阵营。seed 一致则结果可复现，便于回放与调试。
 */
export function assignFactions(
  characterIds: string[],
  seed: number
): FactionAssignment[] {
  if (characterIds.length !== 16) {
    throw new Error('阵营分配要求恰好 16 名角色');
  }

  const rng = createSeedableRNG(seed);
  const shuffled = [...characterIds];

  // Fisher-Yates
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }

  const assignments: FactionAssignment[] = [];
  let cursor = 0;
  const now = new Date().toISOString();

  for (const { role, count } of ALLOCATION) {
    for (let k = 0; k < count; k++) {
      const id = shuffled[cursor++];
      const code: FactionCode = role === 'villager' ? '好'
        : role === 'impostor' ? '伪'
        : role === 'pharmacist' ? '药'
        : role === 'security' ? '保'
        : role === 'fool' ? '笨'
        : '黑';
      assignments.push({
        characterId: id,
        faction: role === 'impostor' ? 'impostor' : 'good',
        role,
        code,
        seed,
        assignedAt: now,
      });
    }
  }

  return assignments;
}
```

### 4.3 持久化

分配结果写入存档目录下 `faction-codes.json`（架构总览 §4.2 暗码层），对玩家与其他 AI 均不可见，仅法官 AI 可读。

## 5. 神民技能机制详述

四大神民对应传统狼人杀的女巫 / 猎人 / 白痴 / 守卫。技能触发与状态转移记录于 `truth-script.json`（真相剧本层）。

### 5.1 药剂师（女巫）

| 属性 | 值 |
| :--- | :--- |
| 初始物品 | 强心剂 ×1、毒药 ×1（**非实体化、不可见**，规则文档第 19 行） |
| 每夜限制 | 每晚只能使用一瓶药 |
| 触发时机 | 夜间 00:00 后；若发生命案，药剂师第一时间得知并选择是否救助被害人 |
| 救助效果 | 被救助者由药剂师移送医疗室；**当晚记忆全部丢失**，不知道被谁攻击与保护 |
| 毒杀效果 | 毒杀对象次晨判定为死亡，无明显外伤（法医可识别中毒特征） |
| 战略目标 | 救助好人，毒杀心中认为的伪装者 |

**状态字段**：
```typescript
interface PharmacistState {
  hasAntidote: boolean;   // 是否持有强心剂
  hasPoison: boolean;     // 是否持有毒药
  usedThisNight: boolean; // 当夜是否已用药
  savedTargets: string[]; // 历史救助记录
  poisonedTargets: string[]; // 历史毒杀记录
}
```

### 5.2 保安（猎人）

| 属性 | 值 |
| :--- | :--- |
| 反杀触发 | 被伪装者夜间击杀 **或** 被审判处刑时 |
| 反杀机制 | 选择一名自己认为是伪装者的角色同归于尽 |
| 巡夜触发 | 夜间可选择一公共区域巡夜 |
| 巡夜效果 | 获取该公共区域的额外信息（如最后出现者、异常痕迹） |
| 战略目标 | 反杀伪装者、收集夜间信息 |

**约束**：反杀仅在被杀或被处刑时触发；若被药剂师毒杀则**不可发动反杀**（继承传统女巫毒死猎人不能开枪规则，避免连锁崩盘）。

### 5.3 笨蛋（白痴）

| 属性 | 值 |
| :--- | :--- |
| 投票免疫 | 审判环节得票**超过半数**依旧不被票出 |
| 主动策略 | 想尽一切办法让所有人投票给自己，缩小伪装者在票型中的范围 |
| 触发效果 | 投票过半触发**临时休庭**；笨蛋获得一次单独与玩家（典狱长）谈话的机会 |
| 一次性 | 临时休庭能力整局只能触发一次（首次触发后下次再过半将被正常票出，对齐传统白痴规则） |
| 战略目标 | 吸引伪装者给自己投票 |

### 5.4 黑客（守卫）

| 属性 | 值 |
| :--- | :--- |
| 每夜技能 | 生成一个不可见的全息影像跟随并保护一名角色 |
| 触发效果 | 伪装者击杀此角色时，全息影像**代替被击杀角色死亡**；角色本人**以无记忆方式存活** |
| 自保 | 黑客可以将想要保护的角色设定为自己 |
| 战略目标 | 识别高价值好人并进行保护 |

**守卫连续保护规则**：传统狼人杀守卫不可连续两晚守护同一人；本游戏采用相同约束（防止无限自守），由 `truth-script.json` 维护上一夜保护记录。

```typescript
interface HackerState {
  lastProtected: string | null;  // 上一夜保护对象，不可重复
  proxyDeaths: string[];         // 全息影像代死记录（角色 ID + 夜次）
}
```

## 6. 伪装者变形与共谋机制

### 6.1 变形规则（规则文档第 23 行）

- **细胞层面完美模拟**：变形后获得目标角色的记忆、性格、外观、生理结构等全方位伪装
- **常规手段不可识别**：仅预言家在力场下的鉴定结果绝对正确
- **无其他技能**：除变形外，力量、速度、智力等与普通好人相同
- **攻击方式限制**：几乎不会通过正面死斗击杀，而是欺骗、偷袭、下毒、引诱
- **心理素质极强**：哪怕身份暴露也不承认，作案后极力掩盖和销毁不利证据
- **无超能力**：不拥有特异功能、魔法、高科技能力

### 6.2 夜间睁眼共谋（对应狼人杀夜间睁眼）

- 所有伪装者**可互相识别身份**
- 伪装者在杀人时**必定以真面目示人**（规则文档第 126 行）
- 一夜最多击杀一名好人；若目标房间内有 2 人，必产生目击者
- 可选择不击杀，伪造"平安夜"假象

### 6.3 不携带识别物品

伪装者**绝对不会**携带任何能够进行身份识别的物品。档案的 `initialItems` 在伪装者身份下视为日常物品，不暴露阵营。

### 6.4 作案后掩盖证据行为逻辑

```typescript
// 伪装者 AI 行为决策树（节选，由 06-ai-driving-mechanism.md 详述）
interface ImpostorCoverupPlan {
  // 1. 凶器处置：带走 / 投入焚化炉 / 嫁祸他人
  weaponDisposal: 'carry' | 'incinerate' | 'plant';
  // 2. 现场清理：擦除血迹 / 伪造打斗痕迹 / 调整温湿度
  sceneCleanup: string[];
  // 3. 栽赃嫁祸：选择一名好人作为替罪羊
  scapegoatId?: string;
  // 4. 不在场证明：编造夜间行程
  falseAlibi: string;
  // 5. 目击者处置：是否进一步追杀 / 收买 / 沉默
  witnessAction: 'silence' | 'bribe' | 'ignore';
}
```

**关键约束**（规则文档第 132 行）：每夜难度逐步提升，但**不可完全毁灭关键证据**导致无法推理，必须保留合理完善的证据链条。

## 7. 自定义角色创建表单字段清单

### 7.1 字段表

| 字段 | 必填 | 类型 | 校验规则 |
| :--- | :---: | :--- | :--- |
| `name` | ✅ | string | 1-20 字符，禁止重复 |
| `nickname` | ❌ | string | 0-30 字符 |
| `species` | ✅ | string | 1-10 字符 |
| `source` | ✅ | string | 1-30 字符，建议为原作名 |
| `appearance` | ✅ | string | 10-500 字符 |
| `bodyData.height` | ❌ | string | 形如 `123cm` |
| `bodyData.weight` | ❌ | string | 形如 `45kg` |
| `bodyData.cup` | ❌ | string | 枚举：`-`/`A`/`B`/`C`/`D`/`E`/`F`+ |
| `personality` | ✅ | string | 10-300 字符 |
| `biography` | ✅ | string | 20-1000 字符 |
| `dialogueStyle` | ✅ | string | 5-200 字符 |
| `firstMes` | ❌ | string | 0-500 字符 |
| `mesExample` | ❌ | string[] | 每条 0-500 字符，最多 10 条 |
| `textColor` | ✅ | string | HEX 格式 `#RRGGBB`，全库唯一 |
| `initialItems` | ✅ | string[4] | **恰好 4 项**，每项 1-30 字符 |
| `tags` | ❌ | string[] | 每项 1-15 字符 |
| `creator` | ❌ | string | 默认 `user` |
| `characterVersion` | ❌ | string | 默认 `1.0` |

### 7.2 暗码不可由用户指定

`factionCode` 字段**不在创建表单中暴露**，由 §4 的分配算法在游戏开局时分配，并持久化到当前游戏存档的角色档案副本（不影响原角色库档案）。

### 7.3 表单结构建议

复用既有 [`CharacterEditModal`](../../src/renderer/components/Character/CharacterEditModal.tsx) 的 `Tabs` + `FieldEditor` 结构，新增"狼人杀扩展"页签：

```tsx
<Tabs.Items label="狼人杀扩展" key="werewolf">
  <FieldEditor label="种族" field="species" ... />
  <FieldEditor label="外观" field="appearance" inputType="textarea" ... />
  <BodyDataEditor label="身材数据" ... />
  <FieldEditor label="生平简介" field="biography" inputType="textarea" ... />
  <FieldEditor label="对话风格" field="dialogueStyle" ... />
  <ColorPicker label="文字颜色" field="textColor" uniquenessScope="allCharacters" />
  <ItemsEditor label="初始物品" field="initialItems" minCount={4} maxCount={4} />
</Tabs.Items>
```

## 8. 角色编辑 / 导入 / 导出流程

### 8.1 导入格式（JSON）

```json
{
  "schemaVersion": "werewolf-character-v1",
  "characters": [
    {
      "id": "uuid-...",
      "name": "朱迪",
      "nickname": "Judy Hopps",
      "species": "兔",
      "source": "疯狂动物城",
      "appearance": "灰色毛皮，蓝色紧身警服……",
      "bodyData": { "height": "98cm", "weight": "3kg", "cup": "-" },
      "personality": "充满正义感、活泼坚韧、行动力极强",
      "biography": "来自乡村的兔警官，第一任警官……",
      "dialogueStyle": "热情、积极，常以感叹句结尾",
      "firstMes": "嘿！我是朱迪·霍普斯，ZPD 警官！",
      "mesExample": ["朱迪：……", "朱迪：当然可以！"],
      "textColor": "#4682B4",
      "initialItems": ["警用对讲机", "胡萝卜笔", "警徽", "迷你录音笔"],
      "tags": ["警官", "兔", "正义"],
      "creator": "user",
      "characterVersion": "1.0"
    }
  ]
}
```

### 8.2 导出格式

- **JSON**：结构同导入格式，供跨用户分享与备份
- **Markdown**：人类可读档案，按字段分段渲染，含颜色色块预览

```markdown
# 朱迪 (Judy Hopps)

| 字段 | 值 |
| :--- | :--- |
| 来源 | 疯狂动物城 |
| 种族 | 兔 |
| 文字颜色 | ![#4682B4](#) `#4682B4` |
| 身材 | 98cm / 3kg / - |

## 外观
灰色毛皮……

## 性格
充满正义感、活泼坚韧……

## 生平
……

## 对话风格
热情、积极……

## 初始物品
1. 警用对讲机
2. 胡萝卜笔
3. 警徽
4. 迷你录音笔
```

### 8.3 批量导入

- 支持单文件多角色（`characters` 数组）
- 支持目录扫描：自动加载 `data/games/werewolf/characters/*.json`
- 导入时按 `id` 去重；`name` 重复则提示用户重命名
- 导入失败的条目写入 `import-errors.log`，不影响其余条目

### 8.4 编辑流程时序

```
用户点击"新建角色" → 打开 CharacterEditModal
   ↓
填写表单 → 字段校验（含 textColor 唯一性）
   ↓
点击保存 → 写入 data/games/werewolf/characters/<id>.json
   ↓
列表刷新
```

## 9. 与既有 Character 组件的复用关系

### 9.1 字段复用矩阵

| 狼人杀字段 | 既有 SillyTavern 字段 | 复用方式 | 说明 |
| :--- | :--- | :--- | :--- |
| `name` | `data.name` | 直接复用 | |
| `nickname` | `data.nickname` | 直接复用 | |
| `source` | `data.source` | 直接复用 | |
| `personality` | `data.personality` | 直接复用 | |
| `firstMes` | `data.first_mes` | 直接复用 | |
| `mesExample` | `data.mes_example` | 直接复用 | |
| `tags` | `data.tags` | 直接复用 | |
| `creator` | `data.creator` | 直接复用 | |
| `characterVersion` | `data.character_version` | 直接复用 | |
| `biography` | `data.scenario` | **语义复用** | 既有 scenario 用于背景，狼人杀复用为生平 |
| `appearance` | `data.description` | **语义复用** | 既有 description 改为外观描写 |
| `dialogueStyle` | `data.post_history_instructions` | **语义复用** | 借用既有字段承载对话风格 |
| `species` | — | **新增** | |
| `bodyData` | — | **新增** | |
| `textColor` | — | **新增** | |
| `initialItems` | — | **新增** | |
| `factionCode` | — | **新增** | 仅运行时分配 |

### 9.2 组件复用策略

| 既有组件 | 文件路径 | 复用方式 |
| :--- | :--- | :--- |
| [`CharacterManager`](../../src/renderer/components/Character/CharacterManager.tsx) | src/renderer/components/Character/CharacterManager.tsx | **参考实现**，狼人杀新建 `WerewolfCharacterManager` 复用列表+分页+导入按钮骨架 |
| [`CharacterEditModal`](../../src/renderer/components/Character/CharacterEditModal.tsx) | src/renderer/components/Character/CharacterEditModal.tsx | **扩展**：复用 `FieldEditor` / `WorldBookRelationPanel` / AI 翻译润色能力，新增"狼人杀扩展"页签 |
| [`CharacterCardGenerateModal`](../../src/renderer/components/Character/CharacterCardGenerateModal.tsx) | src/renderer/components/Character/CharacterCardGenerateModal.tsx | **扩展**：复用 AI 生成流程，prompt 模板新增 `werewolf-character.generate`，输出包含 `species`/`bodyData`/`textColor`/`initialItems` |
| `FieldEditor` | src/renderer/components/Character/FieldEditor.tsx | 直接复用 |
| `character.write` / `character.read` IPC | 既有 | **扩展**：狼人杀角色写入 `data/games/werewolf/characters/` 而非默认 `data/characters/`，避免污染既有角色库 |

### 9.3 隔离原则

- 狼人杀角色库与既有 SillyTavern 角色库**目录隔离**：`data/games/werewolf/characters/` vs `data/characters/`
- 暗码字段 `factionCode` **不写入角色库档案**，仅写入当前游戏存档的角色副本（避免角色库被污染导致跨局信息泄露）
- AI 上下文隔离遵循架构总览 §4.2 数据隔离矩阵

## 10. 验收清单

- [ ] `WerewolfCharacter` 接口定义于 `src/shared/types/werewolf.types.ts`
- [ ] `FactionAssigner` 实现洗牌 + 种子分配，单元测试覆盖 16 人边界
- [ ] 4 种神民技能状态字段定义完整，触发条件可由 [05-game-flow-design.md](./05-game-flow-design.md) 状态机驱动
- [ ] 16 人样例角色档案 JSON 文件全部可加载
- [ ] 自定义角色表单含必填校验、`textColor` 唯一性校验、`initialItems` 恰好 4 项校验
- [ ] 导入/导出 JSON + Markdown 格式双向闭环
- [ ] 与既有 `CharacterEditModal` 复用关系明确，无重复造轮子

## 11. 后续文档导航

| 编号 | 文档 | 主要内容 |
| :---: | :--- | :--- |
| 02 | [法官 AI 系统设计](./02-judge-system-design.md) | 暗码协议、真相剧本格式 |
| 04 | [地图系统设计](./04-map-system-design.md) | 医疗室、单人牢房、公共区域 |
| 05 | [游戏流程设计](./05-game-flow-design.md) | 八大阶段状态机 |
| 06 | [AI 驱动机制](./06-ai-driving-mechanism.md) | 伪装者行为决策树、神民策略 |
| 09 | [数据库设计](./09-database-design.md) | 角色档案 JSON Schema |
| 12 | [法官提示词约束](./12-judge-prompt-constraints.md) | 暗码生成规则、AI 互检 |
