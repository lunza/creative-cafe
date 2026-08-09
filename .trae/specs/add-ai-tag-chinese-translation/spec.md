# AI 生成标签中文翻译 Spec

## Why

角色特征页签（`AssetManagerModal`）与图片生成页签（`AssetGenerateModal`）展示的 AI 生成标签是英文 SD tag（如 `white fur`、`blue eyes`、`medium_breasts`），用户 hover 时无法直观理解含义。标签库 CSV（`docs/danbooru_e621_merged_*.csv`）字段为 `name,category,count,aliases`，**无中文字段**，且用户明确「标签库中的不用翻译」。仅 AI 生成时产出的特征/动态场景标签需要携带中文翻译，便于用户理解与管理。

现状关键事实（已核实）：
- `CategorizedTrait`（[characterTrait.types.ts:75](file:///g:/AI/creative-cafe/src/shared/types/characterTrait.types.ts#L75)）只有 `text` + `categoryId`，**无翻译字段**
- `CHARACTER_TRAIT_SYSTEM_PROMPT`（[characterTraitAIService.ts:335](file:///g:/AI/creative-cafe/src/main/services/characterTraitAIService.ts#L335)）只要求输出 `分类:tag` + 整段中文外观描述，**未为每条 tag 产出逐条翻译**
- `DYNAMIC_SCENE_SYSTEM_PROMPT` 输出 `---CLOTHING---` / `---POSE---` / `---SCENE---` 分隔的三组逗号 tag，**无翻译**
- `AssetManagerModal.renderTraitChip`（[L3357](file:///g:/AI/creative-cafe/src/renderer/components/Character/CharacterDialogueChat/AssetManagerModal.tsx#L3357)）用自定义 chip 展示 `trait.text`，点击进入编辑态，无 Tooltip
- `AssetGenerateModal`（[L1896](file:///g:/AI/creative-cafe/src/renderer/components/Character/CharacterDialogueChat/AssetGenerateModal.tsx#L1896)）用 `<Tag>` 展示 `trait.text`，点击切换启用，无 Tooltip
- 动态场景 `clothing/pose/scene` 是逗号分隔字符串在 `<TextArea>` 中展示

## What Changes

### 数据层
- **扩展 `CategorizedTrait` 类型**：新增 `translation?: string` 字段（中文翻译，AI 生成时产出；手动编辑/AI 兜底替换/颜色拆分时清空）
- **扩展 `DynamicScenePrompt` 类型**：新增 `clothingTranslations?: string` / `poseTranslations?: string` / `sceneTranslations?: string` 三个可选字段（逗号分隔，与 `clothing/pose/scene` 一一对应；旧数据无此字段时 hover 不显示）
- **`CharacterTraitItem`** 继承 `CategorizedTrait`，自动获得 `translation` 字段，随 v2 manifest 持久化

### AI 生成层（`characterTraitAIService.ts`）
- **修改 `CHARACTER_TRAIT_SYSTEM_PROMPT` / `IMAGE_TRAIT_SYSTEM_PROMPT`**：输出格式从 `分类:tag` 改为 `分类:tag|中文翻译`（`|` 分隔翻译，兼容无 `|` 的旧格式输出）
- **修改 `DYNAMIC_SCENE_SYSTEM_PROMPT`**：三组 tag 输出格式改为 `tag|中文翻译` 逗号分隔
- **修改 `parseTraitsFromContent`**：解析 `分类:tag|中文翻译`，`|` 后部分 trim 后写入 `translation`；无 `|` 时 `translation=undefined`
- **修改 `parseDynamicSceneResponse`**：解析 `tag|中文翻译`，产出 `clothing/Pose/Scene` + 对应 `*Translations` 字段
- **`applyTagAudit` 中清空翻译**：trait.text 被 L2/L3 规范化、L3 颜色拆分、L4 KNN 替换、L5 AI 兜底替换时，`translation=undefined`（替换为标签库 tag，标签库无需翻译）；L3 颜色拆分新增的 `colorPartTag` trait 无 `translation`

### 前端展示层
- **`AssetManagerModal.renderTraitChip`**：用 `<Tooltip>` 包裹 `trait.text`，`translation` 存在时 tooltip 显示中文翻译；无翻译时 tooltip 不显示（不影响点击编辑）
- **`AssetGenerateModal` 特征 `<Tag>`**：用 `<Tooltip>` 包裹，`translation` 存在时显示中文翻译；无翻译时不显示（不影响点击切换启用）
- **`AssetManagerModal` 动态场景三组**：从 `<TextArea>` 改为 **Tag 列表展示**（每个 Tag hover 显示翻译 + × 删除 + 双击行内编辑 + 末尾「+ 添加」按钮）；底层仍用字符串 state，Tag 操作同步更新字符串

### 编辑/替换后清空翻译
- **手动编辑**（`AssetManagerModal.handleSaveEdit` / `AssetGenerateModal` 行内编辑）：保存新 text 时 `translation=undefined`
- **AI 兜底替换 / 颜色拆分 / KNN 替换**：在 `applyTagAudit` 内替换 `trait.text` 时同步清空 `translation`
- **手动审核替换**（`onManualReplace`）：替换时清空 `translation`

### 向后兼容
- 旧 `traits.json` / 旧动态场景方案无 `translation` 字段 → hover 不显示翻译（无 Tooltip 或空 Tooltip）
- 旧 LLM 输出无 `|中文翻译` → `parseTraitsFromContent` 兜底 `translation=undefined`
- v2 manifest 加载时 `translation` 字段缺失自动兜底 `undefined`

## Impact

- **Affected specs**：
  - `add-asset-and-trait-management`（CategorizedTrait 类型扩展）
  - `add-dynamic-scene-prompt-generation`（DynamicScenePrompt 类型扩展 + UI 改造）
  - `add-ai-fallback-tag-audit` / `refine-color-tag-splitting`（替换时清空翻译）
  - `enhance-tag-synonym-matching`（规范化替换时清空翻译）
- **Affected code**：
  - `src/shared/types/characterTrait.types.ts` — CategorizedTrait + DynamicScenePrompt 类型扩展
  - `src/main/services/characterTraitAIService.ts` — prompt 修改 + 解析 + applyTagAudit 清空翻译
  - `src/renderer/stores/characterTraitStore.ts` — 行内编辑/手动替换清空 translation
  - `src/renderer/components/Character/CharacterDialogueChat/AssetManagerModal.tsx` — renderTraitChip Tooltip + 动态场景 Tag 列表改造
  - `src/renderer/components/Character/CharacterDialogueChat/AssetGenerateModal.tsx` — 特征 Tag Tooltip + 行内编辑清空翻译
- **不受影响**：`RagQualityReport` 标签库 tag（用户明确「标签库中的不用」）、`AssetGenerateModal` 动态场景方案下拉（仅展示方案名）

## ADDED Requirements

### Requirement: AI 生成标签中文翻译

系统 SHALL 在 AI 生成角色特征 / 动态场景提示词时，为每条 tag 同时产出中文翻译，并持久化到角色卡数据中，供前端 hover 展示。

#### Scenario: AI 生成角色特征携带翻译
- **WHEN** 用户点击「AI 生成特征」按钮，LLM 返回 `分类:tag|中文翻译` 格式内容
- **THEN** `parseTraitsFromContent` 解析每条 trait 的 `translation` 字段
- **AND** 返回的 `CategorizedTrait[]` 每项含 `text` + `categoryId` + `translation`
- **AND** 持久化到 `traits.json` v2 manifest

#### Scenario: AI 生成动态场景携带翻译
- **WHEN** 用户输入自然语言场景指令，LLM 返回 `tag|中文翻译` 格式的三组内容
- **THEN** `parseDynamicSceneResponse` 解析出 `clothing/Pose/Scene` + 对应 `*Translations` 字段
- **AND** 返回的 `GenerateDynamicScenePromptsResult` 含翻译字段
- **AND** 保存为方案时持久化到 `DynamicScenePrompt`

#### Scenario: hover 显示翻译
- **WHEN** 用户鼠标悬停在角色特征页签的特征 chip 上，且该 trait 有 `translation`
- **THEN** Tooltip 显示中文翻译
- **AND** 不影响 chip 的点击编辑行为

#### Scenario: hover 显示翻译（图片生成页签）
- **WHEN** 用户鼠标悬停在图片生成页签的特征 Tag 上，且该 trait 有 `translation`
- **THEN** Tooltip 显示中文翻译
- **AND** 不影响 Tag 的点击切换启用行为

#### Scenario: 动态场景 Tag 列表展示
- **WHEN** 用户在角色特征页签展开动态场景区
- **THEN** clothing/pose/scene 三组以 Tag 列表展示（非 TextArea）
- **AND** 每个 Tag hover 显示对应翻译
- **AND** Tag 支持 × 删除、双击行内编辑、末尾「+ 添加」按钮
- **AND** 编辑操作同步更新底层字符串 state

#### Scenario: 无翻译时不显示 Tooltip
- **WHEN** trait 无 `translation`（旧数据 / 手动编辑后 / AI 审计替换后 / 用户手动新增）
- **THEN** hover 不显示 Tooltip（或显示空 Tooltip 被禁止）
- **AND** 不影响其他交互

## MODIFIED Requirements

### Requirement: 特征标签编辑后翻译清空

**原行为**：手动编辑 trait.text 仅更新 text，无 translation 概念。
**新行为**：手动编辑保存新 text 时，`translation` 置为 `undefined`（避免翻译与新 tag 不符）。

#### Scenario: 手动编辑特征清空翻译
- **WHEN** 用户行内编辑 trait.text 并保存
- **THEN** 该 trait 的 `translation` 置为 `undefined`
- **AND** hover 不再显示翻译

### Requirement: AI 审计替换标签清空翻译

**原行为**：`applyTagAudit` 替换 trait.text（L2/L3 规范化、L3 颜色拆分、L4 KNN、L5 AI 兜底）时不涉及 translation。
**新行为**：替换 trait.text 时同步 `translation=undefined`（替换为标签库标准 tag，无需翻译）；L3 颜色拆分新增的 `colorPartTag` trait 无 `translation`。

#### Scenario: AI 兜底替换清空翻译
- **WHEN** L5 AI 兜底命中，trait.text 被替换为候选词
- **THEN** `translation` 置为 `undefined`
- **AND** hover 不显示翻译（候选词为标签库 tag）

#### Scenario: 颜色拆分新增 trait 无翻译
- **WHEN** L3 颜色拆分命中，新增 `colorPartTag` trait（如 `grey_ears`）
- **THEN** 新增 trait 的 `translation=undefined`
- **AND** 原 trait 替换为 `featureTag` 时 `translation` 也清空

### Requirement: 动态场景标签 UI 改造

**原行为**：clothing/pose/scene 三组在 `<TextArea>` 中展示逗号分隔字符串，可编辑。
**新行为**：三组改为 Tag 列表展示，每个 Tag 支持 hover 翻译 + × 删除 + 双击行内编辑 + 末尾「+ 添加」；底层字符串 state 保留（持久化格式不变），Tag 操作同步更新字符串。

#### Scenario: Tag 列表编辑同步字符串
- **WHEN** 用户点击 Tag 的 × 删除某条 tag
- **THEN** 底层 `parsedClothing`（或 pose/scene）字符串同步移除该 tag
- **AND** 对应 `clothingTranslations` 同步移除对应翻译
- **AND** 保存方案时持久化更新后的字符串

## REMOVED Requirements

无（本次为增量扩展，不删除现有功能）。
