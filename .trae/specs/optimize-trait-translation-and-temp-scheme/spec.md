# 角色特征翻译继承与临时方案联动优化 Spec

## Why

当前系统存在两类问题：
1. **翻译丢失**：AI 生成的标签经 L0-L5 审计链替换/拆分后，中文翻译被显式清空（`applyTagAudit` 三处 `translation = undefined`），用户无法看到被替换标签的中文含义；拆分生成的标签无任何来源标识，用户无法区分原始标签与拆分标签。
2. **临时方案无法保存**：AI 素材生成弹窗（AssetGenerateModal）中用户临时编辑的特征列表（`editedTraits`）在弹窗关闭后丢失；弹窗内无"组合方案"下拉，用户无法快速切换特征组合；"AI 图片识别"按钮实际使用率低，占据黄金位置。

## What Changes

### 翻译继承与拆分标识
- 修改 `characterTraitAIService.applyTagAudit`：三种替换场景（L3 颜色拆分 / L2-L3 规范化 / L4 KNN 语义替换）均将源标签的 `translation` 继承到目标标签
- 修改 L3 颜色拆分逻辑：原标签翻译同时分配到 `featureTag` 和 `colorPartTag` 两个子标签
- 扩展 `CategorizedTrait` 与 `CharacterTraitItem` 类型：新增 `originalText?: string` 字段，记录拆分前的原始标签文本
- 修改 `normalizeTraitItem`：防御性兜底 `originalText` 字段
- 增强 Tooltip：拆分标签 hover 显示「原标签 → 拆分标签 + 中文翻译」，并用专用图标（`SplitCellsOutlined`）标识拆分来源

### 临时方案保存与跨页面联动
- **BREAKING**：移除 AssetGenerateModal 中的"AI 图片识别"按钮（`handleImageRecognize` / `supportsVision` 相关渲染），替换为"临时方案保存"按钮
- 扩展 `TraitCombination` 类型：新增 `traitSnapshot?: CharacterTraitItem[]` 可选字段，存储完整特征快照（含临时新增/编辑的标签），向后兼容现有 `traitIds` 方案
- AssetGenerateModal 新增"组合方案"下拉选择组件，与 AssetManagerModal（CharacterTraitTabContent）的"组合方案"下拉共享同一 `characterTraitStore.combinations` 数据源
- 选择方案时：若 `traitSnapshot` 存在则用快照替换 `editedTraits`（完整恢复临时标签）；若仅 `traitIds` 则按现有逻辑切换 enabled 状态
- 保存方案时：从 AssetGenerateModal 保存则写入 `traitSnapshot`（含临时编辑）；从 AssetManagerModal 保存则仅写 `traitIds`（向后兼容）
- 持久化：通过现有 `saveTraits` → `character-trait:saveData` IPC 通道写入 v2 manifest

## Impact

- Affected specs: `add-ai-tag-chinese-translation`（翻译继承增强）/ `add-asset-and-trait-management`（组合方案扩展）/ `add-model-capability-detection-and-image-recognition`（AI 图片识别按钮移除）
- Affected code:
  - `src/main/services/characterTraitAIService.ts` — `applyTagAudit` 翻译继承逻辑
  - `src/main/services/characterTraitService.ts` — `normalizeTraitItem` 兜底 `originalText`
  - `src/shared/types/characterTrait.types.ts` — `CategorizedTrait` / `CharacterTraitItem` / `TraitCombination` 类型扩展
  - `src/renderer/components/Character/CharacterDialogueChat/AssetGenerateModal.tsx` — 替换 AI 图片识别按钮 + 新增组合方案下拉 + 保存/应用方案
  - `src/renderer/components/Character/CharacterDialogueChat/AssetManagerModal.tsx` — 组合方案下拉支持 traitSnapshot 方案的应用
  - `src/renderer/stores/characterTraitStore.ts` — `saveCombination` / `applyCombination` 支持 traitSnapshot
  - `src/main/ipc/handlers/characterTraitAIHandlers.ts` — `ai:recognizeImageTraits` IPC 通道保留但前端不再调用（后端不删，避免破坏其他调用方）
  - `electron.d.ts` — 同步 `TraitCombination` 类型扩展

## ADDED Requirements

### Requirement: 标签翻译继承机制

系统 SHALL 在标签审计替换/拆分场景下完整保留 AI 返回的原始中文翻译。

#### Scenario: 规范化替换翻译继承
- **WHEN** 标签 `slender`（翻译"纤细的"）经 L2/L3 规范化替换为 `slim`
- **THEN** 替换后的 `slim` 标签保留翻译"纤细的"

#### Scenario: KNN 语义替换翻译继承
- **WHEN** 标签 `dog girl`（翻译"狗女孩"）经 L4 KNN 语义替换为 `dog_girl`
- **THEN** 替换后的 `dog_girl` 标签保留翻译"狗女孩"

#### Scenario: 颜色拆分翻译分配
- **WHEN** 复合标签 `grey long hair`（翻译"灰色长发"）经 L3 颜色拆分为 `grey_hair` + `long_hair`
- **THEN** `grey_hair` 和 `long_hair` 均继承翻译"灰色长发"
- **AND** `long_hair`（featureTag）的 `originalText` 记录为 `grey long hair`
- **AND** `grey_hair`（colorPartTag）的 `originalText` 记录为 `grey long hair`

### Requirement: 拆分标签 UI 标识与增强 Tooltip

系统 SHALL 在 UI 中明确标识拆分生成的标签，并在 hover 时展示完整来源信息。

#### Scenario: 拆分标签视觉标识
- **WHEN** 用户在角色特征面板中查看拆分生成的标签
- **THEN** 该标签前显示 `SplitCellsOutlined` 图标（与普通标签区分）
- **AND** Tooltip 显示：原标签文本、拆分后标签文本、中文翻译结果

#### Scenario: 非拆分标签无标识
- **WHEN** 用户查看未经拆分的普通标签
- **THEN** 不显示拆分图标，Tooltip 仅显示中文翻译（现有行为不变）

### Requirement: 临时方案保存功能

系统 SHALL 在 AI 素材生成弹窗中提供"临时方案保存"按钮，将当前编辑的特征列表持久化为命名方案。

#### Scenario: 保存临时方案
- **WHEN** 用户在 AssetGenerateModal 中编辑特征（临时新增/删除/修改文本/切换启用）后点击"临时方案保存"按钮
- **THEN** 弹出方案名输入框
- **AND** 用户输入名称并确认后，当前 `editedTraits` 完整快照（含临时标签、文本修改、启用状态）保存为 `TraitCombination`（含 `traitSnapshot` 字段）
- **AND** 方案持久化到 v2 manifest（跨会话保留）
- **AND** 方案出现在 AssetGenerateModal 和 AssetManagerModal 的"组合方案"下拉列表中

#### Scenario: 方案名校验
- **WHEN** 用户输入空名称或与已有方案重名的名称
- **THEN** 拒绝保存并提示错误原因

### Requirement: 组合方案下拉与跨页面联动

系统 SHALL 在 AI 素材生成弹窗中提供"组合方案"下拉选择组件，与角色特征页签的"组合方案"下拉共享同一数据源。

#### Scenario: AssetGenerateModal 选择方案
- **WHEN** 用户在 AssetGenerateModal 的"组合方案"下拉中选择一个含 `traitSnapshot` 的方案
- **THEN** `editedTraits` 被替换为该方案的完整特征快照
- **AND** UI 立即刷新特征列表展示

#### Scenario: AssetGenerateModal 选择 traitIds 方案
- **WHEN** 用户选择一个仅含 `traitIds` 的旧方案
- **THEN** `editedTraits` 中匹配 `traitIds` 的特征置 `enabled=true`，其余置 `enabled=false`
- **AND** 临时标签（不在 store 中的）保留但置 `enabled=false`

#### Scenario: 跨页面同步
- **WHEN** 用户在 AssetGenerateModal 保存或删除方案
- **THEN** AssetManagerModal 的"组合方案"下拉列表立即反映变更（共享同一 store）
- **AND** 反之亦然

## MODIFIED Requirements

### Requirement: AI 素材生成弹窗按钮布局

AssetGenerateModal 特征面板头部的"AI 图片识别"按钮 SHALL 替换为"临时方案保存"按钮。后端 `ai:recognizeImageTraits` IPC 通道保留（不删除），仅前端移除调用入口。

### Requirement: TraitCombination 数据结构

`TraitCombination` SHALL 新增可选字段 `traitSnapshot?: CharacterTraitItem[]`，用于存储完整特征快照。现有 `traitIds` 字段保留不变，向后兼容旧方案。应用方案时优先使用 `traitSnapshot`（若存在），否则回退到 `traitIds` 逻辑。

### Requirement: CategorizedTrait 与 CharacterTraitItem 类型

`CategorizedTrait` 与 `CharacterTraitItem` SHALL 新增可选字段 `originalText?: string`，记录标签拆分前的原始文本。手动编辑标签文本时清空 `originalText`（编辑后的标签不再是"拆分生成"）。

## REMOVED Requirements

### Requirement: AssetGenerateModal AI 图片识别按钮

**Reason**: 实际使用率低，黄金位置应让给高频功能（临时方案保存）
**Migration**: 后端 `ai:recognizeImageTraits` IPC 通道保留（其他组件可能调用）；`handleImageRecognize` 函数保留但不再绑定到按钮（避免删除过多代码）；`supportsVision` / `imageRecognizing` 状态保留但不再驱动按钮渲染
