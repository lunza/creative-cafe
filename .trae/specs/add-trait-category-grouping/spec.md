# 角色特征标签分组管理 Spec

## Why

当前角色特征模块（`add-asset-and-trait-management` Task 1/2/3/9.5/13）将所有特征标签以扁平 `string[]` 存储，AI 提取后无分类统一列出。随着特征数量增长，用户难以快速定位、组合与复用：生成不同场景（更换衣物、调整背景、切换姿势）时无法便捷地选择子集，只能全量拼接，导致操作繁琐且生成结果不可控。本变更引入「分类体系 + 组合方案」机制，将扁平特征升级为可分组、可选择、可复用的结构化模型。

## What Changes

- **数据模型升级**：`CharacterTraitManifest` 从 v1（`traits: string[]`）升级到 v2（`traits: CharacterTraitItem[]` + `customCategories` + `combinations` + `activeCombinationId`），每个特征项携带 `id / text / categoryId / enabled` 字段。
- **预设分类体系**：内置 6 个系统分类（头部特征 / 身体特征 / 衣物配饰 / 背景环境 / 人物姿势 / 人物表情）+ 1 个迁移兜底分类（未分类），系统分类为代码常量、全局可用、不可删除。
- **自定义分类 CRUD**：支持用户创建 / 编辑 / 删除自定义分类（按角色卡独立存储）。
- **特征归属调整**：支持特征标签在分类间移动（含移动到未分类）。
- **特征启用选择**：每个特征带 `enabled` 标志，下游图像生成仅拼接 `enabled=true` 的特征文本，实现跨分类组合。
- **组合方案**：保存当前启用特征集合为命名方案，支持一键切换 / 覆盖 / 删除。
- **下游兼容**：`sdGenerationService.applyTraitsAndLora` **零改动**（仍接收 `string[]`），适配点集中在 `AssetGenerateModal.buildSdOptions`——将启用的特征项扁平化为 `string[]` 透传。
- **数据迁移**：v1 traits.json 首次加载时自动迁移为 v2（旧特征全部归入「未分类」、`enabled=true`），不丢失数据，无需用户介入。
- **AI 集成适配**：AI 特征生成（Task 13）仍返回 `string[]`，新特征落入「未分类」桶且 `enabled=true`，用户随后手动归类（AI 自动归类为未来增强项，本期不做）。
- **UI 重构**：`CharacterTraitTabContent` 由扁平 Tag 列表重构为「分类分组面板 + 组合方案工具栏」。
- **扩展性**：分类与特征均为数据驱动（`TraitCategory[]` / `CharacterTraitItem[]`），新增分类类型或特征字段无需改动架构或下游契约。

## Impact

- **Affected specs**：`add-asset-and-trait-management`（特征模块 Task 1/2/3/9.5/13 为本变更的基线）
- **Affected code（主进程）**：
  - `src/main/services/characterTraitService.ts` — manifest v2 结构、迁移逻辑、分类/组合/移动的存储方法
  - `src/main/ipc/handlers/characterTraitHandlers.ts` — 新增 IPC 通道（分类 CRUD / 组合 CRUD / 移动特征 / 切换启用）
  - `src/main/ipc/index.ts` — 注册新通道
- **Affected code（共享层）**：
  - `src/shared/types/`（新增 trait 类型定义文件，如 `characterTrait.types.ts`）— `CharacterTraitItem` / `TraitCategory` / `TraitCombination` / manifest v2 / 系统分类常量
- **Affected code（渲染层）**：
  - `src/renderer/stores/characterTraitStore.ts` — state 升级 + 新 actions
  - `src/renderer/components/Character/CharacterDialogueChat/AssetManagerModal.tsx` — `CharacterTraitTabContent` UI 重构
  - `src/renderer/components/Character/CharacterDialogueChat/AssetGenerateModal.tsx` — `buildSdOptions` 改为传启用特征扁平化 `string[]`
  - `src/preload.ts` / `electron.d.ts` — 暴露新 IPC 通道类型声明

## ADDED Requirements

### Requirement: 特征分类体系

系统 SHALL 提供预设的系统分类集合，包含至少以下分类：头部特征、身体特征、衣物配饰、背景环境、人物姿势、人物表情，外加一个用于迁移兜底与未归类特征的「未分类」。

#### Scenario: 系统分类始终可用
- **WHEN** 用户打开任意角色卡的特征管理界面
- **THEN** 6 个预设系统分类与「未分类」均显示，且不可被删除或重命名
- **AND** 系统分类以代码常量形式定义（`SYSTEM_TRAIT_CATEGORIES`），不写入每张角色卡的 traits.json

#### Scenario: 自定义分类按角色卡独立
- **WHEN** 用户在角色卡 A 创建自定义分类「武器装备」
- **THEN** 该分类仅出现在角色卡 A，不影响角色卡 B
- **AND** 自定义分类存储于该角色卡的 `traits.json` 的 `customCategories` 字段

### Requirement: 分类化管理数据结构

系统 SHALL 将特征标签从扁平 `string[]` 升级为结构化 `CharacterTraitItem[]`，每项包含稳定唯一 `id`、文本 `text`、所属分类 `categoryId`、启用标志 `enabled`。

#### Scenario: 特征项字段完整
- **WHEN** 加载或保存角色卡特征
- **THEN** 每个特征项包含 `id`（string，全局唯一）、`text`（string，非空）、`categoryId`（string，指向系统或自定义分类）、`enabled`（boolean）

#### Scenario: 分类与特征的关联存储
- **WHEN** 保存特征数据
- **THEN** `traits.json` 包含 `version: 2`、`traits: CharacterTraitItem[]`、`customCategories: TraitCategory[]`、`combinations: TraitCombination[]`、`activeCombinationId: string | null`
- **AND** 特征与分类的归属关系通过 `trait.categoryId` 表达，无需冗余反查表

### Requirement: 分类 CRUD

系统 SHALL 支持自定义分类的创建、编辑（重命名）、删除操作。

#### Scenario: 创建分类
- **WHEN** 用户输入分类名并确认创建
- **THEN** 新分类追加到 `customCategories`，`isSystem=false`，分配唯一 `id` 与递增 `order`
- **AND** 空名或与已有分类（含系统分类）重名时拒绝创建并提示

#### Scenario: 删除分类
- **WHEN** 用户删除一个自定义分类
- **THEN** 该分类被移除
- **AND** 其下所有特征的 `categoryId` 重置为 `uncategorized`（特征本身不删除）
- **AND** 系统分类不可删除

#### Scenario: 编辑分类
- **WHEN** 用户重命名自定义分类
- **THEN** 仅更新 `name`，`id` 与特征归属不变
- **AND** 系统分类不可重命名

### Requirement: 特征归属调整

系统 SHALL 支持将特征标签移动到任意分类（系统或自定义）或移至未分类。

#### Scenario: 移动特征
- **WHEN** 用户对某特征执行「移动到分类 X」
- **THEN** 该特征的 `categoryId` 更新为 X，`id` 与 `text` 与 `enabled` 不变
- **AND** 移动操作即时反映在分类 X 的特征列表中

### Requirement: 特征启用选择

系统 SHALL 为每个特征提供启用/禁用标志，下游图像生成仅使用 `enabled=true` 的特征文本。

#### Scenario: 默认启用
- **WHEN** 新增特征（手动添加或 AI 生成）
- **THEN** 该特征 `enabled=true`

#### Scenario: 生成仅用启用特征
- **WHEN** 触发立绘/一般图像/三视图/表情生成
- **THEN** 传入 SD 生成的 `characterTraits` 仅包含 `enabled=true` 特征的 `text`，按 `traits` 数组顺序拼接
- **AND** `applyTraitsAndLora` 接口与 `{traits}` 占位符替换逻辑不变

#### Scenario: 跨分类组合
- **WHEN** 用户启用分属不同分类的多个特征
- **THEN** 这些特征均被纳入生成提示词，不受分类边界限制

### Requirement: 组合方案

系统 SHALL 支持将当前启用特征集合保存为命名组合方案，并支持快速切换、覆盖、删除。

#### Scenario: 保存组合
- **WHEN** 用户输入方案名并保存当前启用集合
- **THEN** 创建 `TraitCombination`（`id` / `name` / `traitIds` 为当前 `enabled=true` 特征的 id 快照 / 时间戳）
- **AND** 空名或重名时拒绝并提示

#### Scenario: 应用组合
- **WHEN** 用户选择应用某组合方案
- **THEN** 将该方案 `traitIds` 中的特征置 `enabled=true`，其余置 `enabled=false`
- **AND** `activeCombinationId` 更新为该方案 id
- **AND** 特征被删除导致方案中部分 `traitId` 失效时，失效项静默跳过（不报错）

#### Scenario: 删除组合
- **WHEN** 用户删除某组合方案
- **THEN** 从 `combinations` 移除该方案；若它是当前 `activeCombinationId`，则 `activeCombinationId` 置 `null`（进入手动模式）
- **AND** 不影响任何特征项本身

#### Scenario: 手动编辑进入手动模式
- **WHEN** 用户在应用某组合后手动切换任一特征的 `enabled`
- **THEN** `activeCombinationId` 置 `null`，表示当前为自定义选择（不自动覆盖原组合）

### Requirement: 数据迁移与向后兼容

系统 SHALL 在加载 traits.json 时自动将 v1 结构迁移为 v2，不丢失任何现有数据，无需用户介入。

#### Scenario: v1 迁移
- **WHEN** 加载一个 `version` 非 2（或缺失）的 traits.json
- **THEN** 每个 `string` 特征转为 `{ id: 新生成, text, categoryId: 'uncategorized', enabled: true }`
- **AND** `customCategories=[]`、`combinations=[]`、`activeCombinationId=null`、`appearanceDescription` 保留
- **AND** 迁移后的 v2 数据在下次保存时以 `version: 2` 落盘

#### Scenario: 旧 IPC 调用兼容
- **WHEN** 任何调用方仍以 `string[]` 语义访问特征（如 AI 生成的 `setTraits`）
- **THEN** 新特征以 `enabled=true`、`categoryId='uncategorized'` 入库，不破坏既有流程

### Requirement: 扩展性

系统 SHALL 以数据驱动方式管理分类与特征，支持未来新增分类类型或特征字段而不改动下游契约。

#### Scenario: 新增系统分类
- **WHEN** 未来在 `SYSTEM_TRAIT_CATEGORIES` 常量追加一个分类
- **THEN** 所有角色卡立即可见该分类，无需迁移已有 traits.json
- **AND** 下游 `applyTraitsAndLora` 不受影响（仍接收 `string[]`）

#### Scenario: 特征字段扩展
- **WHEN** 未来为 `CharacterTraitItem` 追加字段（如 `weight` 权重）
- **THEN** 仅需扩展类型与 UI，存储/IPC/下游拼接逻辑无需结构性改动

## MODIFIED Requirements

### Requirement: 角色特征存储与 IPC（原 add-asset-and-trait-management Task 1/2）

`characterTraitService` 与 `characterTraitHandlers` 的存储格式从 v1 升级为 v2：

- `character-trait:list` 返回值由 `string[]` 改为 `CharacterTraitItem[]`（**BREAKING**：调用方需适配结构化项；通过 store 层适配，UI 不直接消费 IPC 返回的裸 `string[]`）
- `character-trait:save` 参数 `traits` 由 `string[]` 改为 `CharacterTraitItem[]`，并新增可选 `customCategories` / `combinations` / `activeCombinationId` 字段
- 新增通道：
  - `character-trait:list` 一次性返回完整 v2 数据（含分类/组合），减少多次往返
  - `character-trait:save` 一次性保存完整 v2 数据
  - 分类 CRUD / 组合 CRUD / 移动特征 / 切换启用 均通过「读取 v2 → 修改 → 保存 v2」在 store 层完成，**不新增细粒度 IPC**（保持与现有 `save` 覆盖写模式一致，降低主进程复杂度）

### Requirement: 下游图像生成对接（原 add-asset-and-trait-management Task 5/10）

`AssetGenerateModal.buildSdOptions` 传给 `sdGenerationService` 的 `options.characterTraits` 由「全部特征 `string[]`」改为「`enabled=true` 特征的 `text` 扁平化 `string[]`」。`sdGenerationService.applyTraitsAndLora` 与 `{traits}` 占位符替换逻辑**不变**。

## REMOVED Requirements

### Requirement: 扁平 string[] 特征语义
**Reason**：升级为结构化 `CharacterTraitItem[]` 以支持分类、启用选择与组合方案；扁平语义被结构化语义取代。
**Migration**：通过 v1→v2 自动迁移完成，旧 `string[]` 数据无损转为「未分类」分类下的结构化项。
