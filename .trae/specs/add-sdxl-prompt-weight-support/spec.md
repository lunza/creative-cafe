# SDXL 提示词权重调整功能 Spec

## Why

当前图片生成系统在拼接 SD prompt 时，所有特征 tag 权重相同（均为 1.0），用户无法对特定特征进行加权/弱化。SD WebUI（含 Forge Neo）原生支持 `(word:1.5)` 语法实现 per-tag 权重控制，但当前系统未利用此能力。用户需要为每个提示词设置独立权重，以精准控制生成结果中各特征的强度（如强化 `blue_eyes`、弱化 `simple_background`）。

## What Changes

- **数据模型扩展**：`CharacterTraitItem` / `CategorizedTrait` 新增 `weight?: number` 字段（默认 1.0，范围 0.1-10.0），随 v2 manifest 持久化
- **SD 生成管线升级**：`SDGenerationOptions.characterTraits` 由 `string[]` 升级为 `Array<{ text: string; weight?: number }>`；`applyTraitsAndLora` 拼接时将 `weight !== 1.0` 的 tag 格式化为 `(text:weight)` 语法（兼容 Forge Neo 的 lark 解析器）
- **前端派生层升级**：`enabledTraitTexts` 由 `string[]` 升级为 `Array<{ text: string; weight?: number }>`，透传 weight 到 `buildSdOptions`
- **UI 权重编辑**：在 `AssetGenerateModal` / `AssetManagerModal` 的 Tag 旁新增权重指示器与编辑入口（Popover + InputNumber/Slider），直观展示非默认权重
- **AI 生成适配**：`generateCharacterTraits` / `generateTraitPrompts` 的 LLM prompt 扩展为 `分类:tag|中文翻译|权重` 三段格式，解析后透传 `weight` 到 `CategorizedTrait`
- **审计兼容**：`applyTagAudit` / `validateTagsAgainstLibrary` 不受 weight 影响（审计基于 tag text，不涉及权重）；替换/拆分 tag 时 weight 继承或重置为 1.0
- **持久化迁移**：旧 traits（无 weight 字段）加载时兜底 `undefined`（等价 1.0），无需显式迁移
- **动态场景适配**：`DynamicScenePrompt` 的 clothing/pose/scene 为逗号分隔字符串，暂不支持 per-tag 权重（维持原样，未来可扩展）
- **组合方案适配**：`TraitCombination.traitSnapshot` 透传 weight 字段（快照机制天然支持新字段，无需额外处理）

## Impact

- **Affected specs**: `add-asset-and-trait-management` / `add-trait-category-grouping` / `add-ai-tag-chinese-translation` / `optimize-trait-translation-and-temp-scheme` / `add-dynamic-scene-prompt-generation` / `add-prompt-generation-in-asset-modal`
- **Affected code**:
  - `src/shared/types/characterTrait.types.ts` — `CharacterTraitItem` / `CategorizedTrait` 新增 `weight` 字段
  - `src/main/services/sdGenerationService.ts` — `SDGenerationOptions.characterTraits` 类型升级 + `applyTraitsAndLora` 权重格式化
  - `src/main/services/characterTraitAIService.ts` — LLM prompt 扩展 + 响应解析支持权重 + `applyTagAudit` weight 继承
  - `src/main/services/characterTraitService.ts` — `normalizeTraitItem` 透传 weight
  - `src/renderer/stores/characterTraitStore.ts` — `setTraits` / `saveCombination` / `applyCombination` 透传 weight
  - `src/renderer/components/Character/CharacterDialogueChat/AssetGenerateModal.tsx` — `enabledTraitTexts` 类型升级 + Tag 权重 UI + 权重编辑 handler
  - `src/renderer/components/Character/CharacterDialogueChat/AssetManagerModal.tsx` — Tag 权重 UI + 权重编辑 handler
  - `src/renderer/components/Character/CharacterDialogueChat/ExpressionGenerateModal.tsx` — `characterTraits` 传递适配
  - `src/main/preload.ts` + `src/renderer/types/electron.d.ts` — IPC 类型同步（如有新通道）

## ADDED Requirements

### Requirement: 提示词权重数据模型

系统 SHALL 为每个角色特征项（`CharacterTraitItem`）和 AI 生成的分类特征（`CategorizedTrait`）提供可选的 `weight` 数值字段，表示该 tag 在 SD prompt 中的权重。

- 字段名：`weight`
- 类型：`number | undefined`（undefined 等价于 1.0）
- 有效范围：0.1 ~ 10.0（保留 1 位小数）
- 默认值：`undefined`（旧数据迁移时兜底，不显式写入 1.0）
- 持久化：随 `CharacterTraitManifestV2.traits[].weight` 存储

#### Scenario: 旧数据加载（无 weight 字段）

- **WHEN** 加载 v2 manifest 中不含 `weight` 字段的 traits
- **THEN** `normalizeTraitItem` 兜底 `weight: undefined`，下游等价于 1.0，不报错

#### Scenario: 权重持久化

- **WHEN** 用户修改某 trait 的 weight 为 1.5 并保存
- **THEN** `saveTraitData` 将 `weight: 1.5` 写入 manifest 的 `traits[]` 数组对应项
- **AND** 重新加载时 weight 值保持 1.5

### Requirement: SD Prompt 权重格式化

系统 SHALL 在 `applyTraitsAndLora` 拼接 `{traits}` 占位符时，将 `weight !== undefined && weight !== 1.0` 的 tag 格式化为 SD WebUI 兼容的 `(text:weight)` 语法。

#### Scenario: 默认权重不格式化

- **GIVEN** trait `{ text: 'dog_girl', weight: undefined }` 或 `{ text: 'dog_girl', weight: 1.0 }`
- **WHEN** `applyTraitsAndLora` 拼接 prompt
- **THEN** 输出 `dog_girl`（不加括号）

#### Scenario: 非默认权重格式化

- **GIVEN** trait `{ text: 'blue_eyes', weight: 1.5 }`
- **WHEN** `applyTraitsAndLora` 拼接 prompt
- **THEN** 输出 `(blue_eyes:1.5)`

#### Scenario: 混合权重拼接

- **GIVEN** traits `[{ text: 'dog_girl' }, { text: 'blue_eyes', weight: 1.5 }, { text: 'simple_background', weight: 0.5 }]`
- **WHEN** `applyTraitsAndLora` 拼接 prompt
- **THEN** 输出 `dog_girl, (blue_eyes:1.5), (simple_background:0.5)`

### Requirement: 权重编辑 UI

系统 SHALL 在特征 Tag 旁提供权重编辑入口，让用户直观查看与修改单个 tag 的权重值。

#### Scenario: 默认权重不显示数值

- **GIVEN** trait weight 为 undefined 或 1.0
- **THEN** Tag 旁不显示权重数值（保持界面简洁）

#### Scenario: 非默认权重显示数值

- **GIVEN** trait weight 为 1.5
- **THEN** Tag 旁显示权重徽标（如 `×1.5`），颜色区分强化（>1.0 暖色）与弱化（<1.0 冷色）

#### Scenario: 点击权重徽标打开编辑器

- **WHEN** 用户点击权重徽标或 Tag 上的权重按钮
- **THEN** 弹出 Popover 含 InputNumber（0.1-10.0，步长 0.1）+ Slider + 重置按钮
- **AND** 修改后实时更新 `editedTraits` 中对应 trait 的 weight

### Requirement: AI 生成权重

系统 SHALL 让 AI 生成特征时可选地产出权重值，通过扩展 LLM prompt 输出格式为 `分类:tag|中文翻译|权重` 三段。

#### Scenario: AI 生成带权重的特征

- **GIVEN** LLM 输出 `head:blue_eyes|蓝眼睛|1.3`
- **WHEN** `parseTraitsFromContent` 解析
- **THEN** 产出 `CategorizedTrait { text: 'blue_eyes', categoryId: 'head', translation: '蓝眼睛', weight: 1.3 }`

#### Scenario: AI 未输出权重（兼容）

- **GIVEN** LLM 输出 `head:blue_eyes|蓝眼睛`（无第三段）
- **WHEN** `parseTraitsFromContent` 解析
- **THEN** 产出 `CategorizedTrait { text: 'blue_eyes', categoryId: 'head', translation: '蓝眼睛', weight: undefined }`（等价 1.0）

### Requirement: 审计环节权重继承

系统 SHALL 在 L0-L5 审计链替换/拆分 tag 时合理处理 weight 字段。

#### Scenario: L4 KNN 替换继承 weight

- **GIVEN** trait `{ text: 'slender', weight: 1.5 }` 被 L4 替换为 `slim`
- **THEN** 替换后 trait 为 `{ text: 'slim', weight: 1.5 }`（继承原权重，因为用户意图是强化"纤细"概念）

#### Scenario: L3 颜色拆分 weight 重置

- **GIVEN** trait `{ text: 'grey long hair', weight: 1.5 }` 被 L3 拆分为 `grey_hair` + `long_hair`
- **THEN** 拆分后的两个 trait weight 均为 `undefined`（1.0），因为拆分后语义已变化，原权重不适用

#### Scenario: 手动编辑 weight 清空

- **WHEN** 用户手动编辑 trait.text（如 `sitting` → `standing`）
- **THEN** weight 保持不变（编辑文本不影响权重设置）

## MODIFIED Requirements

### Requirement: SDGenerationOptions.characterTraits 类型升级

原类型：`characterTraits?: string[]`

新类型：`characterTraits?: Array<{ text: string; weight?: number }>`

**BREAKING**：`SDGenerationOptions.characterTraits` 由 `string[]` 升级为结构化数组。所有生产者（`buildSdOptions` / `ExpressionGenerateModal`）与消费者（`applyTraitsAndLora`）需同步升级。旧代码传 `string[]` 将触发 TS 类型错误。

### Requirement: enabledTraitTexts 类型升级

原类型：`string[]`（仅 text）

新类型：`Array<{ text: string; weight?: number }>`（text + weight）

**影响**：`buildSdOptions` 的 `characterTraits` 字段、`handleGenerateTraitPrompts` 的 `baseTraits` 拼接、`buildEmotionPrompt` 等所有消费者需适配。`baseTraits` 拼接时仅取 `.text`（不带权重语法，避免 LLM 混淆）。

### Requirement: parseTraitsFromContent 解析格式扩展

原格式：`分类:tag|中文翻译`

新格式：`分类:tag|中文翻译|权重`（权重段可选，不存在的旧格式兜底 `undefined`）

### Requirement: normalizeTraitItem 透传 weight

`normalizeTraitItem` 返回对象新增 `weight` 透传：`typeof r.weight === 'number' && r.weight >= 0.1 && r.weight <= 10.0 ? Math.round(r.weight * 10) / 10 : undefined`

## REMOVED Requirements

无移除项。本 spec 为纯增量升级，向后兼容旧数据。
