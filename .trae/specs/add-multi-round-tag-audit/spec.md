# 多轮标签审计与替换机制 Spec

## Why

部分 AI 生成提示词经现有 L1-L4 匹配链仍未命中：
- `brimless cap`：`brimless` 是非颜色否定性修饰词（无帽檐），`cap` 是 `hat` 的别名。当前 L3 只处理颜色，无法剥离 `brimless`；L4 KNN 相似度不足。
- `B-cup`：杯罩尺寸是领域术语，Danbooru 用 `medium_breasts`/`small_breasts` 表达，非字符串拆分能解决，需领域映射或人工指定。

需建立多轮审计闭环：扩展结构拆分到保守的否定性修饰词 + 新增人工审核入口 + 自定义映射表持久化，使人工审核结果下次自动命中，持续优化匹配率。

## What Changes

- **首轮增强 — 自定义映射表（L0）**：在 L1 之前查询用户维护的同义词映射表（`user-synonym-map.json`），人工审核的替换自动记录于此，下次同词首轮即命中
- **次轮增强 — 否定性修饰词剥离（L3b）**：识别保守的否定性修饰词（brimless/sleeveless/strapless/topless/bottomless/hairless/wireless/collarless），剥离后用核心词查 name/alias
- **末轮 — 人工审核入口**：前端 RagQualityReport 对最终未匹配词提供「手动替换」inline 输入框，用户输入替换词 → 替换 trait + 记录到映射表
- **新增 IPC**：`tagRag.getUserSynonymMap` / `tagRag.addUserSynonymMapping` / `tagRag.removeUserSynonymMapping`

## Impact

- Affected specs: `enhance-tag-synonym-matching`（L0/L3b 插入匹配链）、`refine-color-tag-splitting`（L3b 紧随 L3 颜色拆分）、`add-asset-and-trait-management`（trait 手动替换）
- Affected code:
  - `src/main/services/tagRagService.ts` — L0 自定义映射查询 + L3b 修饰词剥离 + 加载映射表
  - `src/main/services/userSynonymMapService.ts`（新增）— 映射表持久化 + IPC
  - `src/main/ipc/` — 注册 tagRag 命名空间新 IPC
  - `src/shared/types/` — 自定义映射类型 + ragDebug 扩展
  - `src/renderer/components/Character/CharacterDialogueChat/RagQualityReport.tsx` — 手动替换入口
  - `src/renderer/components/Character/CharacterDialogueChat/AssetManagerModal.tsx` — 手动替换处理 + 撤销
  - `src/preload/` — 暴露新 IPC

## ADDED Requirements

### Requirement: 自定义同义词映射表持久化

系统 SHALL 在 `{userData}/data/user-synonym-map.json` 持久化用户自定义同义词映射（`Record<originalTag, replacementTag>`），跨会话保留。

- 加载：`tagRagService` 初始化时读取映射表到内存 `Map<string, string>`（key 小写）
- 写入：人工审核替换时追加映射并持久化
- 删除：撤销手动替换时删除对应映射（用户撤销意味着映射不正确）

#### Scenario: 人工审核替换持久化
- **WHEN** 用户对未匹配词 `B-cup` 手动指定替换为 `medium_breasts`
- **THEN** 写入 `user-synonym-map.json`：`{ "b-cup": "medium_breasts" }`，下次 AI 生成 `B-cup` 时 L0 首轮命中 → `medium_breasts`

### Requirement: L0 自定义映射查询

`validateTagsAgainstLibrary` SHALL 在 L1 name 之前查询自定义映射表（L0），命中则 `isValid=true`、`canonicalName=映射目标`、`source='user-map'`，跳过 L1-L4。

#### Scenario: 自定义映射命中
- **WHEN** 映射表含 `"b-cup": "medium_breasts"`，验证 `B-cup`
- **THEN** L0 命中 → `isValid=true`、`canonicalName='medium_breasts'`

### Requirement: L3b 否定性修饰词剥离

系统 SHALL 在 L3 颜色拆分之后、L4 语义 KNN 之前，尝试剥离保守的否定性修饰词前缀。

保守修饰词列表：`brimless`、`sleeveless`、`strapless`、`topless`、`bottomless`、`hairless`、`wireless`、`collarless`。

算法：识别 tag 开头的否定性修饰词（空格/下划线兼容），剥离后得核心词，查核心词 name/alias（含空格/下划线互转）。命中则 `isValid=true`、`canonicalName=核心词的 canonicalName`。

仅当完整 tag 未被 L0-L3 命中时才尝试 L3b（避免误伤 `short_hair`/`open_hoodie` 等本身是标签的复合词）。

#### Scenario: 否定性修饰词剥离命中
- **WHEN** 验证 `brimless cap`，L0-L3 未命中
- **THEN** L3b 剥离 `brimless` → 核心词 `cap` → `cap` 是 `hat` 的 alias → `isValid=true`、`canonicalName='hat'`

#### Scenario: 非否定性修饰词不剥离
- **WHEN** 验证 `short hair`，`short` 不在否定性修饰词列表
- **THEN** L3b 不触发，`short_hair` 由 L1/L2 正常匹配

### Requirement: 末轮人工审核入口

RagQualityReport SHALL 对最终未匹配词（L0-L4 全失败，即 `isValid=false`）显示「手动替换」inline 输入框。

交互：
1. 用户点击「手动替换」按钮 → 展开 inline 输入框
2. 用户输入替换词（如 `medium_breasts`）→ 回车确认
3. 系统：替换 `trait.text` 为输入词 + 调 IPC `addUserSynonymMapping(originalTag, replacement)` 持久化
4. 显示「🟣 已手动替换」徽标 + 撤销按钮

撤销手动替换：还原 `trait.text` 为 originalTag + 调 IPC `removeUserSynonymMapping` 删除映射记录。

#### Scenario: 人工审核替换 B-cup
- **WHEN** 用户对未匹配词 `B-cup` 输入 `medium_breasts` 并确认
- **THEN** trait.text 替换为 `medium_breasts`，映射表写入 `{ "b-cup": "medium_breasts" }`，质检报告显示「🟣 已手动替换：B-cup → medium_breasts」+ 撤销按钮

## MODIFIED Requirements

### Requirement: validateTagsAgainstLibrary 多轮匹配链

匹配链扩展为六层（L0-L5），任一命中即标记 `isValid=true` 并记录 `canonicalName`：

1. **L0 自定义映射**（新增）：查 userSynonymMap，命中 → canonicalName=映射目标，source='user-map'
2. **L1 name 精确**（已有）：getTagByName + 空格/下划线互转
3. **L2 alias 精确**（已有）：getTagByAlias + 格式转换
4. **L3 颜色拆分**（已有）：splitColorTag → colorPartTag + feature
5. **L3b 否定性修饰词剥离**（新增）：stripNegationModifier → 核心词查 name/alias
6. **L4 语义 KNN**（已有）：searchRelevantTags，阈值 0.15

返回类型新增 `source?: 'user-map' | 'name' | 'alias' | 'color-split' | 'negation-strip' | 'knn'` 字段，标识命中轮次（供前端展示 + 统计匹配率）。

### Requirement: ragDebug 透传 source + 手动替换状态

`GenerateCharacterTraitsResult.ragDebug.tagValidation` 类型新增：
- `source?: 'user-map' | 'name' | 'alias' | 'color-split' | 'negation-strip' | 'knn'`（命中轮次）
- `manuallyReplaced?: boolean`（人工审核替换标记，前端展示紫色徽标）
- `manualReplacement?: string`（人工指定的替换词，撤销时还原）

## REMOVED Requirements

无。
