# 素材/特征/动态场景缺陷修复 Spec

## Why

近期完成的三个 spec（`add-asset-and-trait-management` / `add-trait-category-grouping` / `add-dynamic-scene-prompt-generation`）引入了若干缺陷与体验缺口，用户在实际使用中暴露出三类问题：

1. **三视图与高分辨率生成**：裸体版三视图的 nude tag 列表不够完整、未固定强制包含；当分辨率 ≥ 1024×1024 时 SD 模型倾向生成多个角色，缺少 `1girl`/`1boy` 人物数量约束
2. **角色特征分类系统**：自定义分类（`customCategories`）按角色卡独立存储，重启后不丢失但**跨角色卡不共享**；AI 生成特征时系统提示词硬编码 7 个系统分类，**不包含用户自定义分类**，导致 AI 不会为「纹身」「武器装备」等新建分类生成对应 tag
3. **动态场景指令**：`AssetGenerateModal`（图片生成弹窗）**缺少动态场景方案选择 UI**，用户必须先返回 `AssetManagerModal` 激活方案才能生效；`userScene` 文本输入框应替换为动态场景下拉选择，让用户在生成时直接选择已保存的方案

## What Changes

### 三视图与高分辨率
- 扩展裸体版三视图的固定 tag 列表为常量数组，确保 `*-nude` 槽位生成时**强制包含** `nude, naked, bare skin, completely naked, no clothes, nsfw` 等核心关键词
- 在 `AssetGenerateModal.buildSdOptions` 中新增分辨率检测：当 `selectedSize` 宽×高 ≥ 1024×1024 时，从基础特征（`categoryId='basic'`）推断性别并自动注入 `1girl` 或 `1boy` 人物数量约束（适用于 illustration / general / three-view 全部模式）

### 角色特征分类系统
- **新增全局分类字典服务** `categoryDictionaryService.ts`：持久化到 `{userData}/data/trait-categories.json`，管理所有自定义分类（跨角色卡共享、重启后保留）
- **重构分类加载链路**：`characterTraitStore` 加载分类时从全局字典读取（而非从角色卡 manifest 的 `customCategories` 读取）；系统分类仍由常量提供
- **迁移既有数据**：首次加载时将各角色卡 `customCategories` 中的分类合并到全局字典（去重 by name），迁移后角色卡 manifest 的 `customCategories` 字段不再作为读取源（保留字段以兼容旧文件，但不再写入）
- **修复 AI 生成 bug**：`characterTraitAIService` 的 `CHARACTER_TRAIT_SYSTEM_PROMPT` / `IMAGE_TRAIT_SYSTEM_PROMPT` 改为**动态构建**，将全局字典中的自定义分类（如「纹身」「武器装备」）注入提示词，让 LLM 知道这些分类存在并为其生成 tag；`parseTraitsFromContent` 同步接受全局字典分类 id 作为合法前缀

### 动态场景指令
- **新增动态场景选择 UI**：在 `AssetGenerateModal` 中新增 `<Select>` 下拉，展示已保存的动态场景方案列表（从 `characterTraitStore.dynamicScenePrompts` 读取），选择后调用 `applyDynamicScenePrompt(id)` 激活
- **替换 `userScene` 文本输入**：移除 `AssetGenerateModal` 中的 `userScene` 文本输入框，由动态场景下拉选择替代；`buildAssetPromptTemplate` 的 `userScene` 参数标记为废弃（保留签名以避免破坏调用方，但不再作为主要 scene 来源）
- **验证提示词拼接**：确保选择的动态场景方案的 `clothing` / `pose` / `scene` 字段通过 `buildSdOptions` → `applyTraitsAndLora` 正确替换 `{clothing}` / `{pose}` / `{scene}` 占位符

## Impact

- **Affected specs**:
  - `add-dynamic-scene-prompt-generation`（动态场景功能 — 修复选择 UI 缺失）
  - `add-trait-category-grouping`（分类系统 — 重构为全局字典）
  - `add-asset-and-trait-management`（素材管理 — 三视图 nude tag + 高分辨率约束）
- **Affected code**:
  - `src/main/services/categoryDictionaryService.ts` — **新建**：全局分类字典服务
  - `src/main/ipc/handlers/categoryDictionaryHandlers.ts` — **新建**：IPC 通道
  - `src/main/preload.ts` + `src/renderer/types/electron.d.ts` — 暴露 `categoryDictionary` 命名空间
  - `src/main/services/characterTraitAIService.ts` — 动态构建系统提示词 + 解析器接受自定义分类
  - `src/main/services/characterTraitService.ts` — 迁移逻辑：首次加载合并 customCategories 到全局字典
  - `src/shared/types/characterTrait.types.ts` — 新增 `GlobalTraitCategoryDictionary` 类型
  - `src/renderer/stores/characterTraitStore.ts` — 分类加载改为从全局字典读取
  - `src/renderer/components/Character/CharacterDialogueChat/AssetManagerModal.tsx` — 新建分类时写入全局字典
  - `src/renderer/components/Character/CharacterDialogueChat/AssetGenerateModal.tsx` — 新增动态场景下拉 + 移除 userScene 输入 + 高分辨率检测
  - `src/renderer/components/Character/CharacterDialogueChat/PromptBuilder.ts` — 三视图 nude tag 常量化扩展
  - `src/main/services/sdGenerationService.ts` — `SDGenerationOptions` 新增 `characterGenderTag?: string` 字段

## ADDED Requirements

### Requirement: 裸体版三视图固定 nude tag

系统 SHALL 为裸体版三视图槽位（`front-nude` / `side-nude` / `back-nude`）强制注入一组固定的 nude 相关 tag，确保生成结果始终包含裸体特征。

#### Scenario: 生成裸体版三视图
- **WHEN** 用户生成 `front-nude` 槽位三视图
- **THEN** 提示词模板自动包含 `nude, naked, bare skin, completely naked, no clothes, nsfw` 固定 tag（作为常量数组拼接，不可被用户配置覆盖）

#### Scenario: 穿衣版三视图不受影响
- **WHEN** 用户生成 `front` 槽位三视图
- **THEN** 提示词不包含 nude tag，行为与当前一致

### Requirement: 高分辨率人物数量约束

系统 SHALL 在生成分辨率 ≥ 1024×1024 时自动注入人物数量约束 tag（`1girl` 或 `1boy`），防止 SD 模型生成多个角色。

#### Scenario: 高分辨率生成立绘
- **WHEN** 用户选择分辨率 1024×1024 或更高，生成立绘
- **THEN** 系统从基础特征（`categoryId='basic'`）中查找性别 tag（`1girl` / `1boy` / `female` / `male` / `girl` / `boy`），若找到则注入对应的 `1girl` 或 `1boy`；若基础特征已包含 `1girl` 或 `1boy` 则不重复注入

#### Scenario: 低分辨率不注入
- **WHEN** 用户选择分辨率低于 1024×1024（如 512×768）
- **THEN** 不注入人物数量约束 tag，行为与当前一致

#### Scenario: 无法判断性别时的兜底
- **WHEN** 基础特征中未找到任何性别相关 tag
- **THEN** 不注入 `1girl` / `1boy`（避免错误约束），记录一条 `[AssetGenerateModal] 无法从基础特征推断性别` 警告日志

### Requirement: 全局分类字典服务

系统 SHALL 提供全局分类字典服务 `categoryDictionaryService`，持久化管理所有自定义分类，跨角色卡共享、重启后保留。

#### Scenario: 新建分类并重启
- **WHEN** 用户在角色 A 中新建分类「纹身」，关闭应用后重新打开，加载角色 B
- **THEN** 角色 B 的分类列表中包含「纹身」分类（全局字典是分类的唯一读取源）

#### Scenario: 跨角色卡共享
- **WHEN** 用户在角色 A 中新建分类「武器装备」
- **THEN** 切换到角色 B 时，「武器装备」分类出现在 B 的分类列表中（即使 B 从未使用过该分类）

#### Scenario: 既有数据迁移
- **WHEN** 系统首次启动且全局字典文件不存在，加载已有角色卡
- **THEN** 系统将该角色卡 `customCategories` 中的分类合并到全局字典（按 `name` 去重），并写入 `{userData}/data/trait-categories.json`；后续加载不再读取 manifest 的 `customCategories` 字段

### Requirement: 动态场景方案选择 UI

系统 SHALL 在 `AssetGenerateModal`（图片生成弹窗）中提供动态场景方案下拉选择，允许用户在生成时直接选择已保存的方案，无需返回 `AssetManagerModal`。

#### Scenario: 在生成弹窗中选择动态场景
- **WHEN** 用户打开 `AssetGenerateModal`，已保存至少一个动态场景方案
- **THEN** 弹窗中显示一个 `<Select>` 下拉，列出所有已保存方案（`dynamicScenePrompts`），默认选中当前激活方案（`activeDynamicScenePromptId`）

#### Scenario: 切换方案立即生效
- **WHEN** 用户在下拉中选择「哥特公路」方案
- **THEN** `activeDynamicScenePromptId` 立即更新为该方案 id，后续 `buildSdOptions` 读取该方案的 clothing/pose/scene

#### Scenario: 无方案时的空状态
- **WHEN** 用户未保存任何动态场景方案
- **THEN** 下拉显示 placeholder「暂无动态场景方案，请在素材管理中添加」，不阻塞生成流程

### Requirement: userScene 输入替换为下拉选择

系统 SHALL 移除 `AssetGenerateModal` 中的 `userScene` 文本输入框，由动态场景下拉选择替代。

#### Scenario: 原 userScene 输入框移除
- **WHEN** 用户打开 `AssetGenerateModal` 的 general 模式
- **THEN** 不再显示 `userScene` 文本输入框；scene 来源完全由动态场景方案提供（无激活方案时 `{scene}` 替换为空字符串）

## MODIFIED Requirements

### Requirement: characterTraitAIService 系统提示词

`CHARACTER_TRAIT_SYSTEM_PROMPT` 与 `IMAGE_TRAIT_SYSTEM_PROMPT` SHALL 动态构建分类列表：系统分类（7 个）+ 全局字典中的自定义分类。自定义分类的描述由用户在创建时填写（可选），无描述时仅列出分类名。

#### Scenario: 包含自定义分类的提示词
- **WHEN** 全局字典中有自定义分类「纹身」(id: `tattoo`) 和「武器装备」(id: `weapon`)
- **THEN** AI 系统提示词的分类列表包含：
  ```
  - basic / head / body / clothing / background / pose / expression（系统分类）
  - tattoo：纹身（自定义分类）
  - weapon：武器装备（自定义分类）
  ```
  并指导 LLM 可以为这些分类生成 `tattoo:dragon tattoo` / `weapon:katana` 等带前缀的 tag

### Requirement: parseTraitsFromContent 接受自定义分类

`parseTraitsFromContent` SHALL 接受全局字典中的自定义分类 id 作为合法的 `category:tag` 前缀，不再仅限于 7 个系统分类 id。

#### Scenario: 解析自定义分类 tag
- **WHEN** LLM 返回 `tattoo:dragon tattoo, weapon:katana, head:white hair`
- **THEN** 解析结果包含 `{ text: 'dragon tattoo', categoryId: 'tattoo' }` / `{ text: 'katana', categoryId: 'weapon' }` / `{ text: 'white hair', categoryId: 'head' }`

### Requirement: buildSdOptions 高分辨率检测

`AssetGenerateModal.buildSdOptions` SHALL 检测 `selectedSize` 的分辨率，当宽×高 ≥ 1024×1024 时，从基础特征推断性别并填充 `SDGenerationOptions.characterGenderTag` 字段。

### Requirement: applyTraitsAndLora 注入性别 tag

`sdGenerationService.applyTraitsAndLora` SHALL 在 `{traits}` 替换后，将 `options.characterGenderTag`（若存在）注入到提示词中（紧随 `{traits}` 之后，避免与已有 tag 重复）。

## REMOVED Requirements

无移除项。所有现有功能保持不变，新增功能为修复与增强。

**注意**：`CharacterTraitManifestV2.customCategories` 字段标记为**废弃**（保留以兼容旧文件读取，但不再作为读取源，不再写入新值），不物理删除以避免破坏既有数据。
