# 拆分「衣物配饰」特征分类为上装/下装/配饰/内衣

## Summary

将「素材管理」中角色特征标签的系统分类「衣物配饰」（`id='clothing'`, `order=3`）拆分为 4 个独立系统分类：**上装 / 下装 / 配饰 / 内衣**。系统是数据驱动的（UI 通过 `SYSTEM_TRAIT_CATEGORIES` 常量动态组装分类列表），核心改动集中在常量定义、AI 提示词、裸体三视图过滤逻辑、旧数据迁移 4 处；纯注释引用顺带修正。

### 已确认的设计决策
- **新分类 ID**（沿用现有英文 id 约定 `basic/head/body/...`）：`top`(上装) / `bottom`(下装) / `accessories`(配饰) / `underwear`(内衣)
- **新分类 order**（按用户列出顺序）：top=3 / bottom=4 / accessories=5 / underwear=6；原 background/pose/expression 顺延为 7/8/9
- **旧数据迁移**：现有 `categoryId='clothing'` 的特征在 `loadTraitData` 加载时一次性重写为 `UNCATEGORIZED_CATEGORY_ID`（未分类），下次 `saveTraitData` 落盘。用户手动重新归类到 4 个新分类。
- **裸体三视图过滤**：`*-nude` 槽位过滤 `top` / `bottom` / `underwear` 三个分类（保留 `accessories`，如眼镜/首饰/缎带）。

## Current State Analysis

### 数据驱动架构（关键利好）
- 系统分类由常量 `SYSTEM_TRAIT_CATEGORIES` 提供（[characterTrait.types.ts:240-248](file:///G:/AI/creative-cafe/src/shared/types/characterTrait.types.ts#L240-L248)），不写入每张角色卡 traits.json
- UI 分类列表由 `[...SYSTEM_TRAIT_CATEGORIES, ...globalCategories, UNCATEGORIZED_CATEGORY]` 动态拼装（[AssetManagerModal.tsx:2619-2624](file:///G:/AI/creative-cafe/src/renderer/components/Character/CharacterDialogueChat/AssetManagerModal.tsx#L2619-L2624)），改常量后 UI 自动展示新分类，**无需改 UI 渲染代码**
- `AssetManagerModal.tsx:2634-2637` 有防御兜底：`categoryId` 不在已知分类时归入未分类显示——但 trait 的 `categoryId` 字段本身仍是旧值（悬空引用），需配合迁移逻辑

### 真正引用 `clothing` 分类 id 的功能性代码（必须改）
1. **裸体过滤** [AssetGenerateModal.tsx:515](file:///G:/AI/creative-cafe/src/renderer/components/Character/CharacterDialogueChat/AssetGenerateModal.tsx#L515)：`(!isNudeSlot || t.categoryId !== 'clothing')` —— 裸体三视图过滤逻辑
2. **AI 提示词** [characterTraitAIService.ts](file:///G:/AI/creative-cafe/src/main/services/characterTraitAIService.ts) 四处硬编码 `clothing` 分类描述与 guidance：
   - `CHARACTER_TRAIT_SYSTEM_PROMPT`（行 305-341，clothing 行 311 / guidance 323-324 / 示例 339）
   - `IMAGE_TRAIT_SYSTEM_PROMPT`（行 360-395，clothing 行 364 / guidance 376-377 / 示例 393）
   - `buildDynamicTraitSystemPrompt`（行 1542-1606，`systemCategoryDescriptions` 行 1544-1553 clothing 在 1549 / `systemGuidance` 行 1569-1580 clothing 在 1576-1577）
   - `buildDynamicImageTraitSystemPrompt`（行 1624-1687，`systemCategoryDescriptions` 行 1626-1635 clothing 在 1631 / `systemGuidance` 行 1651-1662 clothing 在 1658-1659）

### 纯注释引用（顺带修正，不改逻辑）
- [assetService.ts:58](file:///G:/AI/creative-cafe/src/main/services/assetService.ts#L58)
- [assetStore.ts:50](file:///G:/AI/creative-cafe/src/renderer/stores/assetStore.ts#L50)
- [AssetManagerModal.tsx:2248](file:///G:/AI/creative-cafe/src/renderer/components/Character/CharacterDialogueChat/AssetManagerModal.tsx#L2248)
- [AssetGenerateModal.tsx:146](file:///G:/AI/creative-cafe/src/renderer/components/Character/CharacterDialogueChat/AssetGenerateModal.tsx#L146) 和 496
- [characterTrait.types.ts](file:///G:/AI/creative-cafe/src/shared/types/characterTrait.types.ts) 多处 JSDoc 提及 `clothing`（行 100-112、223-239、244）

### 不动的（避免误伤）
- [PromptBuilder.ts:1758,1802](file:///G:/AI/creative-cafe/src/renderer/components/Character/CharacterDialogueChat/PromptBuilder.ts#L1758) 的 "clothing" 是英文自然语言（"Maintain ... clothing"），非分类 id
- CODE_WIKI.md / CHANGELOG.md 中的 `{clothing}` 是**已移除的动态场景占位符**（2026-08-07 Spec replace-dynamic-scene-with-prompt-gen 移除），与本任务无关；`DynamicScenePrompt.clothing` 字段同理不动

### 旧数据迁移必要性
`normalizeTraitItem`（[characterTraitService.ts:160-183](file:///G:/AI/creative-cafe/src/main/services/characterTraitService.ts#L160-L183)）保留 `categoryId` 原值不校验。若仅删除常量不迁移，旧 `clothing` trait 会：UI 兜底显示在未分类，但 `trait.categoryId` 仍为 `'clothing'`（悬空），且裸体过滤 `t.categoryId !== 'clothing'` 仍命中旧 id → 行为不一致。故必须在 `loadTraitData` 重写旧 id。

## Proposed Changes

### 1. 系统分类常量 — `src/shared/types/characterTrait.types.ts`

**What**: 移除 `clothing`，新增 4 个分类，顺延后续 order。

**Why**: 这是分类体系的唯一真源，UI/AI 提示词/裸体过滤全部间接依赖它。

**How**: 修改 `SYSTEM_TRAIT_CATEGORIES` 常量（行 240-248）：
```ts
export const SYSTEM_TRAIT_CATEGORIES: readonly TraitCategory[] = [
  { id: 'basic', name: '基本特征', isSystem: true, order: 0 },
  { id: 'head', name: '头部特征', isSystem: true, order: 1 },
  { id: 'body', name: '身体特征', isSystem: true, order: 2 },
  { id: 'top', name: '上装', isSystem: true, order: 3 },
  { id: 'bottom', name: '下装', isSystem: true, order: 4 },
  { id: 'accessories', name: '配饰', isSystem: true, order: 5 },
  { id: 'underwear', name: '内衣', isSystem: true, order: 6 },
  { id: 'background', name: '背景环境', isSystem: true, order: 7 },
  { id: 'pose', name: '人物姿势', isSystem: true, order: 8 },
  { id: 'expression', name: '人物表情', isSystem: true, order: 9 },
];
```
同步更新 JSDoc 注释：
- 行 223-239 分类列表注释：将 `4. clothing 衣物配饰` 替换为 4 行（上装/下装/配饰/内衣），后续编号顺延
- 行 100-112 `CategorizedTrait.categoryId` 注释：将 `clothing` 替换为 `top / bottom / accessories / underwear`

### 2. AI 提示词 — `src/main/services/characterTraitAIService.ts`

**What**: 4 处提示词中的 `clothing` 分类描述/示例替换为 4 个新分类。

**Why**: LLM 按 prompt 内嵌的分类体系输出 `分类:tag`，若 prompt 仍含 `clothing` 则 AI 继续输出 `clothing:` 前缀，经 `parseTraitsFromContent` 解析后 `categoryId='clothing'` 成为悬空值（不在 `validCategoryIds` 集合内 → 兜底 uncategorized，AI 归类失效）。

**How**:

**(a) `CHARACTER_TRAIT_SYSTEM_PROMPT`（行 305-341）** — 中文提示词
- 行 311 `- clothing：衣物配饰（服装、配饰、眼镜、缎带、首饰等）` 替换为 4 行：
  ```
  - top：上装（上衣、衬衫、外套、连衣裙等上身衣物）
  - bottom：下装（裤子、裙子、短裤等下身衣物）
  - accessories：配饰（眼镜、缎带、首饰、帽子、围巾等装饰物）
  - underwear：内衣（胸罩、内裤、内衣套装等贴身衣物）
  ```
- 行 323-324 guidance：
  - `- 服饰（如 black shirt, school uniform, dress）→ clothing` 改为分三条：上装类→top、下装类→bottom、连衣裙/dress 等连体→top（约定）
  - `- 配饰（如 glasses, ribbon, hat）→ clothing` 改为 `→ accessories`
  - 新增 `- 内衣（如 bra, underwear, panties）→ underwear`
- 行 339 输出示例：`clothing:black shirt|黑色衬衫` 改为 `top:black shirt|黑色衬衫`，可补一个 `accessories:glasses|眼镜` 示例

**(b) `IMAGE_TRAIT_SYSTEM_PROMPT`（行 360-395）** — 英文提示词，对应同步
- 行 364 `- clothing: clothes, accessories, glasses, ribbon, jewelry` 替换为 4 行英文描述
- 行 376-377 guidance 同步拆分
- 行 393 示例 `clothing:school uniform` 改为 `top:school uniform`

**(c) `buildDynamicTraitSystemPrompt`（行 1542-1606）** — 动态中文 prompt
- `systemCategoryDescriptions` Record（行 1544-1553）：移除 `clothing` 键，新增 `top`/`bottom`/`accessories`/`underwear` 4 个键（中文描述同 (a)）
- `systemGuidance` 数组（行 1569-1580）：将两条 clothing guidance 拆为 4 条（同 (a) guidance）
- 返回模板字符串中的示例（行 1603）同步改 `top:black shirt`

**(d) `buildDynamicImageTraitSystemPrompt`（行 1624-1687）** — 动态英文 prompt
- `systemCategoryDescriptions` Record（行 1626-1635）：移除 `clothing`，新增 4 键（英文描述同 (b)）
- `systemGuidance`（行 1651-1662）：拆分 clothing guidance 为 4 条
- 示例（行 1684）同步改 `top:school uniform`

**JSDoc 注释**：行 294、311、364、376 等提及 `clothing` 的注释同步更新为 4 个新分类。

### 3. 裸体三视图过滤 — `src/renderer/components/Character/CharacterDialogueChat/AssetGenerateModal.tsx`

**What**: 行 515 过滤条件改为过滤 `top`/`bottom`/`underwear`（保留 `accessories`）。

**Why**: 裸体图应去除上身/下身/内衣衣物，但保留眼镜/首饰等配饰（用户决策）。

**How**:
- 行 498 后新增常量集合（靠近 `isNudeSlot` 定义）：
  ```ts
  // 裸体三视图过滤的衣物分类（上装/下装/内衣）；配饰（眼镜/首饰等）保留
  const NUDE_FILTER_CATEGORY_IDS = new Set(['top', 'bottom', 'underwear']);
  ```
- 行 515 `(!isNudeSlot || t.categoryId !== 'clothing')` 改为：
  ```ts
  (!isNudeSlot || !NUDE_FILTER_CATEGORY_IDS.has(t.categoryId))
  ```
- 行 146、496 注释：「clothing 分类」改为「上装/下装/内衣分类（配饰保留）」

### 4. 旧数据迁移 — `src/main/services/characterTraitService.ts`

**What**: `loadTraitData` 加载 v2 数据后，将 `categoryId === 'clothing'` 的 trait 重写为 `UNCATEGORIZED_CATEGORY_ID`。

**Why**: 移除 `clothing` 常量后，旧 trait 的 `categoryId='clothing'` 成为悬空引用（UI 兜底显示未分类，但裸体过滤/分类匹配不一致）。迁移到未分类（用户决策），下次保存落盘后清除悬空值。

**How**: 在 `loadTraitData` v2 分支返回前（行 308-316 之前），对 `traits` 数组做一次重写：
```ts
// 【迁移】clothing 分类已拆分为 top/bottom/accessories/underwear，
// 旧数据中 categoryId='clothing' 的特征重写为 uncategorized（用户手动重新归类）
const CLOTHING_LEGACY_CATEGORY_ID = 'clothing';
let migratedCount = 0;
const migratedTraits = traits.map((t) => {
  if (t.categoryId === CLOTHING_LEGACY_CATEGORY_ID) {
    migratedCount++;
    return { ...t, categoryId: UNCATEGORIZED_CATEGORY_ID };
  }
  return t;
});
if (migratedCount > 0) {
  console.log('[CharacterTraitService] loadTraitData: migrated', migratedCount, 'legacy clothing traits -> uncategorized');
}
```
返回时用 `migratedTraits` 替代 `traits`。该迁移幂等：重写后下次保存不再有 `clothing` id，再次加载 `migratedCount=0`。

**注意**：v1→v2 迁移分支（行 232-258）将 string 归入 uncategorized，不涉及 clothing，无需改动。

### 5. 纯注释修正（不改逻辑）
- [assetService.ts:58](file:///G:/AI/creative-cafe/src/main/services/assetService.ts#L58)：「clothing 分类」→「上装/下装/内衣分类」
- [assetStore.ts:50](file:///G:/AI/creative-cafe/src/renderer/stores/assetStore.ts#L50)：同上
- [AssetManagerModal.tsx:2248](file:///G:/AI/creative-cafe/src/renderer/components/Character/CharacterDialogueChat/AssetManagerModal.tsx#L2248)：同上

### 6. 技术文档增量更新（遵循用户规则）

**Why**: 用户规则要求「开发过程中参考根目录技术文档，每次开发完成后增量更新；bug 或反复提示才解决的问题重点标记」。

**How**:
- **`CODE_WIKI.md`** 行 1194-1223 角色特征分类体系段落：将 `clothing 衣物配饰（order 3）` 更新为 4 个新分类（top/bottom/accessories/underwear，order 3-6），后续 background/pose/expression order 顺延；同步更新该段提及 `clothing` 的归类建议与 `validCategoryIds` 列表说明
- **`docs/FIX_RECORDS.md`** 新增一节（沿用 `## §N` 编号与「现象/根因/修复方案/修改文件/经验教训」结构），记录本次拆分；若实施中出现 bug 或反复调试则按规则用 `【重点标记】` 标注
- **`CHANGELOG.md`** 顶部新增一条目，概述分类拆分与迁移行为（沿用现有格式）

## Assumptions & Decisions
1. **新分类 id 用英文**（`top`/`bottom`/`accessories`/`underwear`）：与现有 `basic`/`head`/`body`/`background`/`pose`/`expression` 命名约定一致，便于 LLM 输出前缀与 `parseTraitsFromContent` 解析。
2. **order 按用户列出顺序**：上装(3)/下装(4)/配饰(5)/内衣(6)，后续分类顺延。
3. **旧数据迁移到未分类**：用户决策。无法可靠自动判断每条 tag 属于 4 类中的哪一类，未分类最安全，用户手动整理一次。
4. **裸体过滤保留配饰**：用户决策。眼镜/首饰/缎带在裸体图中保留，仅去上装/下装/内衣。
5. **连体衣物（dress/school uniform）归 top**：AI guidance 中约定 dress/uniform 归上装（最常见上身衣物），LLM 据语义判断，用户可手动移动。
6. **不改 UI 渲染代码**：分类列表动态派生自常量，改常量后自动生效。
7. **不改下游 SD 生成**：`applyTraitsAndLora` 仍接收 `string[]`，仅 `enabled=true` 的 text 拼接，与分类 id 无关。

## Verification Steps
1. **类型检查**：`npx tsc --noEmit` 对修改文件零新增错误（`SYSTEM_TRAIT_CATEGORIES` 是 `readonly TraitCategory[]`，新增项类型兼容）。
2. **UI 展示**：打开任意角色卡特征管理页签，确认分类列表显示 10 个系统分类（基本/头部/身体/上装/下装/配饰/内衣/背景/姿势/表情）+ 自定义 + 未分类，顺序正确。
3. **旧数据迁移**：构造一份含 `categoryId:'clothing'` 的 v2 traits.json，加载后确认这些 trait 显示在「未分类」、`trait.categoryId` 变为 `uncategorized`；点保存后重载确认无 `clothing` 残留。
4. **裸体三视图**：给角色添加 `top`/`bottom`/`underwear`/`accessories` 各一条特征并启用，生成 `front-nude`，确认 prompt 中不含上装/下装/内衣 tag，但含配饰 tag。
5. **AI 生成特征**：触发 AI 特征生成，确认 LLM 输出的服饰类 tag 被归入 `top`/`bottom`/`accessories`/`underwear`（而非 uncategorized），验证 prompt 中分类前缀被正确解析。
6. **AI 提示词生成**：在素材生成弹窗用「提示词生成」输入 "red dress, jeans, glasses, bra"，确认 4 条分别归入 top/bottom/accessories/underwear。
7. **组合方案回归**：保存/应用组合方案，确认 traitSnapshot 中 trait 的 categoryId 不受影响（top/bottom 等新 id 正常快照与恢复）。
8. **文档核对**：CODE_WIKI / FIX_RECORDS / CHANGELOG 已增量更新，无 `clothing` 残留误导描述（动态场景 `{clothing}` 历史记录不动）。
