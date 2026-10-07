# 角色卡 AI 三操作全字段上下文统一（unify-character-card-full-field-context）Spec

## Why

角色卡编辑器的生成/翻译/润色三个 AI 操作各自收集上下文字段，范围不一致：翻译与润色的 `<context_reference>` 仅包含 9 个长文本字段（`buildCharacterContext` 遍历 `FIELD_DESCRIPTIONS`），**缺失 name、nickname、source、creator、character_version、tags 共 6 个可编辑短字段**；生成的 `existing_fields_info` 缺 `source` 且靠模板变量另行拼接短字段。导致翻译/润色时 AI 无法参考角色名称、标签等基础信息，三个操作的数据参考基准不统一。

## What Changes

- **扩展 `FIELD_DESCRIPTIONS`**（[characterFieldScope.ts](file:///g:/AI/creative-cafe/src/renderer/components/Character/hooks/characterFieldScope.ts#L19)）：新增 6 个短字段条目（name/nickname/source/creator/character_version/tags），label 与编辑弹窗 UI 一致（角色名称/昵称/来源/创建者/版本信息/标签）
- **自动受益的既有链路**（无需改动逻辑，遍历 `FIELD_DESCRIPTIONS` 即得全字段）：
  - `buildCharacterContext`（翻译 L269 / 润色 L611 的 `<context_reference>`）→ 覆盖全部 15 个可编辑字段（排除目标字段）
  - `performGenerate` 的 `existing_fields_info`（L403）→ 同样覆盖全字段（补上 `source`），与翻译/润色同一数据基准
  - `extractTargetFieldContent` 越界防御的标签识别（L92）→ 能识别"角色名称：/【标签】"等短字段段落，全卡泛化输出的防御力增强
  - 翻译/润色的 `fieldLabel` 回退（L252/L586）→ 短字段目标显示中文名（原显示英文 key）
- **微调 `buildCharacterContext`**：`tags` 为数组时用 `、` 连接（保持单行紧凑；其他数组字段如 alternate_greetings 仍用 `\n`）
- **导出 `buildCharacterContext`** 供单元测试（原为模块私有函数）
- **生成模板变量保持不动**：`character_name` 与 `character_version_line` 等 4 行仍照常传入（主进程 `character-card.generate` 模板为用户可编辑持久化模板，避免动其变量语义；`existing_fields_info` 与模板行存在少量短字段重复，属模板兼容的已知可接受冗余）

## Impact

- Affected specs:
  - `fix-character-card-field-scope-flash-models`（越界防御）— 标签识别集扩大，行为向后兼容（防御 1/2 对短字段段落生效；既有测试用例不变）
  - `fix-polish-context-isolation` / `fix-polish-target-misinterpretation`（润色上下文隔离）— `<context_reference>` 内容变丰富，标签结构不变
- Affected code:
  - [characterFieldScope.ts](file:///g:/AI/creative-cafe/src/renderer/components/Character/hooks/characterFieldScope.ts)（FIELD_DESCRIPTIONS 扩展 + 头注释）
  - [useCharacterAIOperations.ts](file:///g:/AI/creative-cafe/src/renderer/components/Character/hooks/useCharacterAIOperations.ts)（buildCharacterContext 的 tags 连接符 + 导出）
  - [characterFieldScope.test.ts](file:///g:/AI/creative-cafe/src/renderer/components/Character/hooks/__tests__/characterFieldScope.test.ts)（新增用例）
- 不改动：主进程提示词模板、preload、IPC 层、`character-card.generate` 模板变量、FieldEditor UI、生成按钮开放范围（短字段无生成按钮，现状保持）

## ADDED Requirements

### Requirement: 全字段上下文收集

系统在用户点击角色卡编辑器的生成、翻译或润色按钮时，SHALL 自动收集当前角色卡**全部 15 个可编辑字段**的已填数据（name、nickname、source、creator、character_version、tags、description、personality、scenario、first_mes、mes_example、alternate_greetings、system_prompt、post_history_instructions、creator_notes），排除当前操作的目标字段与空值字段，作为该操作的统一参考上下文。

#### Scenario: 翻译短字段时参考完整长字段上下文

- **WHEN** 用户在"角色名称"字段（值为空以外场景均可）点击"翻译"，且描述/标签等字段已有内容
- **THEN** `<context_reference>` 内包含描述、标签、系统提示等全部其他已填字段，目标字段本身不重复出现

#### Scenario: 润色长字段时参考短字段信息

- **WHEN** 用户在"描述"字段点击"润色"，且角色名称、标签已填写
- **THEN** `<context_reference>` 内包含"角色名称""标签"等短字段信息，AI 润色可参考角色基础设定

#### Scenario: 生成时上下文包含来源字段

- **WHEN** 用户对任一长文本字段点击"生成"，且"来源"（source）已填写
- **THEN** `existing_fields_info` 中出现"来源"条目（此前生成上下文缺失 source）

#### Scenario: 标签数组紧凑展示

- **WHEN** 角色卡 tags 为数组（导入卡场景）且任一翻译/润色操作触发
- **THEN** 上下文中标签以顿号连接为单行（如"奇幻、傲娇"），而非每个标签独占一行

## MODIFIED Requirements

### Requirement: 输出越界防御的标签识别范围（继承自 fix-character-card-field-scope-flash-models）

`extractTargetFieldContent` 的字段段落识别 SHALL 覆盖 `FIELD_DESCRIPTIONS` 全部 15 个字段的 label（新增角色名称/昵称/来源/创建者/版本信息/标签的行首标签模式），防御 1（提取目标段落）与防御 2（≥2 个其他字段标签判越界）对新短字段标签同样生效。

#### Scenario: 全卡泛化输出含短字段段落

- **WHEN** 模型输出包含"角色名称：xxx""标签：xxx"等多个字段段落但无目标字段段落
- **THEN** 防御 2 判定越界，调用方恢复原文并提示

#### Scenario: 短字段目标输出带标签前缀

- **WHEN** 对 name 字段润色，模型输出"角色名称：Lynne"
- **THEN** 防御 1 提取"Lynne"作为结果写回

## REMOVED Requirements

（无 — 纯增量扩展，无删除项）
