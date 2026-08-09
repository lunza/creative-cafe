# 颜色拆分标签匹配（L3 重构）Spec

## Why

当前 L3 颜色剥离策略**丢弃颜色信息**：`light gray drooping ears` → 剥离 `light gray` → 只保留 `drooping_ears`，而 Danbooru 标签库实际有丰富的「颜色+部位」组合标签（`grey_ears` count=11299、`grey_tail` count=24542、`grey_hoodie` count=12057、`grey_beanie`、`grey_hat` 等）。

验证脚本（`verify-color-split.mjs`）已证实：用户反馈的 4 个颜色复合 tag 全部可拆成「颜色+部位标签 + 核心特征标签」两条且两条都在库中。应将 L3 从「剥离丢弃」改为「拆分保留」，让颜色语义进入 SD 生成链路。

## What Changes

- **L3 从「剥离丢弃」改为「颜色拆分」**：颜色复合 tag 拆成 `colorPartTag`（如 `grey_ears`）+ `featureTag`（如 `drooping_ears`）两条
- **`validateTagsAgainstLibrary` 返回类型新增 `splitTags` 字段**：当 L3 拆分两条都命中时携带拆分信息
- **`characterTraitAIService` 替换循环新增「场景1：颜色拆分」**：一个 trait 拆成两个（原 trait 替换为 featureTag，新增 colorPartTag trait）
- **前端展示拆分**：RagQualityReport 对 splitTags 项显示「🔄 已拆分：tag → colorPartTag + featureTag」
- **撤销逻辑扩展**：撤销拆分时删除新增的 colorPartTag trait + 还原 featureTag 为 originalTag
- **`onRevertTrait` 签名扩展**：新增可选 `splitColorTag` 参数

## Impact

- Affected specs: `enhance-tag-synonym-matching`（L3 策略变更）、`add-asset-and-trait-management`（trait 列表可能因拆分而增长）
- Affected code:
  - `src/main/services/tagRagService.ts` — 新增 `splitColorTag` + L3 重构 + 返回类型扩展
  - `src/main/services/characterTraitAIService.ts` — 替换循环新增颜色拆分场景 + ragDebug 透传 splitTags
  - `src/renderer/components/Character/CharacterDialogueChat/RagQualityReport.tsx` — 展示拆分 + onRevertTrait 签名
  - `src/renderer/components/Character/CharacterDialogueChat/AssetManagerModal.tsx` — handleRevertTrait 撤销拆分
  - `src/main/services/__tests__/tagRagService.test.ts` — splitColorTag + L3 拆分测试

## ADDED Requirements

### Requirement: 颜色拆分函数 splitColorTag

系统 SHALL 提供 `splitColorTag(tag: string)` 函数，将颜色复合 tag 拆分为颜色标签与核心特征标签的构造信息。

算法：
1. 统一为空格分隔，识别开头「可选亮度修饰词（light/dark/pale/bright/deep/neon/pastel/vivid/dull）+ 基础颜色（gray/grey/black/white/brown/blonde/blond/red/blue/green/pink/purple/yellow/orange/silver/gold/cyan/magenta）」
2. 颜色归一化：`gray`→`grey`、`blond`→`blonde`（标签库用 grey/blonde 拼写）；亮度词丢弃（标签库是 `grey_ears` 而非 `light_grey_ears`）
3. 剩余部分 = 核心特征（`drooping ears` → `drooping_ears`）；部位词 = 核心特征最后一个词（`ears`）
4. 构造颜色+部位标签：`baseColor + '_' + partWord`（`grey_ears`）

返回 `{ baseColor, feature, partWord, colorPartTag }` 或 `null`（无可识别颜色前缀 / 纯颜色词无特征）。

#### Scenario: 颜色复合 tag 拆分
- **WHEN** `splitColorTag('light gray drooping ears')`
- **THEN** 返回 `{ baseColor: 'grey', feature: 'drooping_ears', partWord: 'ears', colorPartTag: 'grey_ears' }`

#### Scenario: 非颜色 tag 返回 null
- **WHEN** `splitColorTag('slender')`
- **THEN** 返回 `null`（开头非颜色词）

#### Scenario: 纯颜色词返回 null
- **WHEN** `splitColorTag('black')`
- **THEN** 返回 `null`（剥离颜色后无核心特征）

### Requirement: validateTagsAgainstLibrary 返回 splitTags

系统 SHALL 在 `validateTagsAgainstLibrary` 的返回类型中新增可选 `splitTags?: { colorPartTag: string; featureTag: string }` 字段。

当 L3 颜色拆分时：
- `colorPartTag` 与 `featureTag` 都在标签库（name 或 alias）命中 → `isValid=true`、`canonicalName=featureTag`、`splitTags={colorPartTag, featureTag}`
- 仅 `featureTag` 命中 → `isValid=true`、`canonicalName=featureTag`、无 splitTags（退化为当前剥离行为）
- 仅 `colorPartTag` 命中 → `isValid=true`、`canonicalName=colorPartTag`、无 splitTags
- 两者都不命中 → 走 L4 语义 KNN

## MODIFIED Requirements

### Requirement: validateTagsAgainstLibrary L3 颜色拆分

L3 从「`stripColorModifier` 剥离颜色后查核心词」改为「`splitColorTag` 拆分后分别查 colorPartTag 与 feature」：

1. 调 `splitColorTag(tag)`，若返回 `null` → 走 L4
2. 查 `colorPartTag` 是否命中 name/alias（含空格/下划线互转）
3. 查 `feature` 是否命中 name/alias（含空格/下划线互转）
4. 按 ADDED Requirement 的规则设置 isValid/canonicalName/splitTags

`stripColorModifier` 保留为 `splitColorTag` 的概念子集（剥离逻辑被 splitColorTag 覆盖），现有 stripColorModifier 测试保留。

### Requirement: characterTraitAIService 替换循环颜色拆分场景

替换循环在「场景2（valid 规范化）」之前新增「场景1：颜色拆分」：

```
for (const v of tagValidation) {
  // 场景1：L3 颜色拆分 → 一个 trait 拆成两个
  if (v.splitTags) {
    const trait = traits.find(t => t.text === v.tag);
    if (trait) {
      trait.text = v.splitTags.featureTag;           // 原 trait 替换为核心特征
      traits.push({ text: v.splitTags.colorPartTag,  // 新增颜色+部位 trait
                    categoryId: trait.categoryId }); // 复制原 trait 的分类
      v.replacedBy = v.splitTags.featureTag;         // 前端展示 tag→featureTag
    }
    continue;
  }
  // 场景2：valid 规范化（已有，不变）
  // 场景3：invalid 语义替换（已有，不变）
}
```

新增 trait 为 `CategorizedTrait`（无 id），由 store `setTraits` 的 MERGE 策略分配 id。

### Requirement: RagQualityReport 展示拆分 + onRevertTrait 签名扩展

`onRevertTrait` 签名从 `(originalTag, replacedBy)` 扩展为 `(originalTag, replacedBy, splitColorTag?)`。

有 `splitTags` 的 tag 项：
- 显示蓝色 🔄 徽标 + 文案「已拆分：tag → colorPartTag + featureTag」
- 撤销按钮调用 `onRevertTrait(item.tag, item.replacedBy, item.splitTags?.colorPartTag)`

### Requirement: handleRevertTrait 撤销颜色拆分

`handleRevertTrait` 接收 `splitColorTag` 参数时：
1. 还原 featureTag trait 为 originalTag（现有 `updateTrait` 逻辑）
2. 找到 `text === splitColorTag` 的 trait，调用 `removeTrait` 删除（store 已有该方法）
3. 清除 ragDebug 对应项的 `replacedBy` 与 `splitTags`

## REMOVED Requirements

无。L3 的 `stripColorModifier` 保留（被 splitColorTag 概念覆盖，不删除以避免破坏现有测试）。
