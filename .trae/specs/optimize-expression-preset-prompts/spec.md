# 表情预置提示词优化脚本 Spec

## Why

当前 `EMOTION_PROMPT_MAP`（PromptBuilder.ts:1480-1512）硬编码的 31 种情绪提示词存在两个核心问题：
1. **标签不合规**：大量 tag 不在 Danbooru/e621 标签库中（如 `aroused`、`lustful`、`sultry`、`heavy breathing` 等），SD 模型无法准确理解，且未经质检流程验证
2. **维度缺失**：每条提示词仅含面部表情描述，缺少用户要求的 4 个关键维度（面部表情 / 人物动作 / 符号元素 / 背景样式），无法生成漫画风格的富表现力表情图

此外，表情生成时角色特征的 `expression` 分类 tag 会通过 `{traits}` 占位符注入，与 `{emotion}` 占位符的提示词冲突，导致重复/矛盾的表情 tag。

## What Changes

- **新增**：独立一次性脚本 `scripts/optimize-expression-prompts.ts`，对 31 种预置情绪执行 AI 生成 → L0-L5 质检审计 → 报告输出
- **修改**：`EMOTION_PROMPT_MAP` 硬编码值替换为脚本产出的审计通过提示词（保留 NSFW 语义但全部使用标签库合法 tag）
- **修改**：表情生成流程（`buildSdOptions` / `applyTraitsAndLora`）在 `single-expression` / `batch-expression` 模式下过滤 `categoryId === 'expression'` 的角色特征，避免与 `{emotion}` 占位符冲突
- **保留**：`EMOTION_NL_PROMPT_MAP`（NL 模型版本）不在本次范围内，后续可按同样流程优化

## Impact

- Affected specs: `add-ai-expression-generation`（EMOTION_PROMPT_MAP 定义）、`add-asset-and-trait-management`（特征携带机制）、`add-multi-round-tag-audit`（L0-L5 审计链）
- Affected code:
  - `scripts/optimize-expression-prompts.ts`（新增脚本）
  - `src/renderer/components/Character/CharacterDialogueChat/PromptBuilder.ts`（EMOTION_PROMPT_MAP 替换）
  - `src/renderer/components/Character/CharacterDialogueChat/AssetGenerateModal.tsx`（buildSdOptions 过滤 expression 特征）
  - `src/main/services/sdGenerationService.ts`（applyTraitsAndLora 可选过滤，或由上游 buildSdOptions 处理）
  - `src/main/services/characterTraitAIService.ts`（applyTagAudit 可能需暴露为可复用方法）

## ADDED Requirements

### Requirement: 表情提示词优化脚本

系统 SHALL 提供一个独立可执行的 TypeScript 脚本，对 31 种预置情绪的 SD 提示词进行 AI 生成 + 质检审计 + 报告输出。

#### Scenario: 脚本执行成功

- **WHEN** 开发者执行 `npx tsx scripts/optimize-expression-prompts.ts`
- **THEN** 脚本读取当前 AI 引擎配置 + 加载标签库 CSV
- **AND** 对每个 EMOTION_PRESETS 条目调用 LLM 生成 4 维度候选 tag（面部表情 / 动作 / 符号 / 背景）
- **AND** 对每条候选 tag 执行 L0-L5 审计链（userSynonymMap → name → alias → color-split → negation-strip → KNN → AI-fallback）
- **AND** 审计通过的 tag 保留，未通过的 tag 被替换为库内标签或标记为异常
- **AND** 输出 JSON 报告到 `scripts/expression-prompt-optimization-report.json`，含处理数量 / 成功替换数量 / 质检通过率 / 异常提示词列表
- **AND** 输出 TypeScript 代码片段到 `scripts/expression-prompt-map.generated.ts`，可直接粘贴替换 EMOTION_PROMPT_MAP

#### Scenario: 标签库未加载

- **WHEN** 脚本启动时标签库 CSV 未找到或加载失败
- **THEN** 脚本报错退出，提示标签库路径

#### Scenario: AI 引擎未配置

- **WHEN** 脚本启动时 AI 引擎 baseUrl / apiKey / modelName 缺失
- **THEN** 脚本报错退出，提示先在应用中配置 AI 引擎

### Requirement: AI 生成 4 维度提示词

系统 SHALL 使用 LLM 为每个情绪生成包含 4 个维度的候选 SD tag 列表。

#### Scenario: 生成候选 tag

- **WHEN** 脚本处理情绪 `emotionKey`（如 `joy`）
- **THEN** 调用 LLM 传入情绪 key + 中文标签 + 上下文（保留 NSFW 语义，使用 Danbooru 标准下划线格式）
- **AND** LLM 返回 4 组逗号分隔的英文 tag：
  - 面部表情特征（如 `smile, open_mouth, closed_eyes`）
  - 人物动作描述（如 `raised_arms, clapping_hands`，可为空）
  - 符号元素（如 `heart, sparkles, star_(symbol)`，可为空）
  - 简单背景样式（如 `simple_background, striped_background`，至少 1 条）
- **AND** 每条 tag 使用 Danbooro 标准下划线格式（如 `open_mouth` 而非 `open mouth`）

### Requirement: 质检审计流程

系统 SHALL 对 AI 生成的候选 tag 执行与角色特征 AI 生成相同的 L0-L5 审计链。

#### Scenario: tag 通过审计

- **WHEN** 候选 tag 在 L0-L5 任一层匹配到标签库中的标准 tag
- **THEN** 保留该 tag（或替换为 canonicalName 规范名）
- **AND** 记录命中层级（source 字段）

#### Scenario: tag 审计失败

- **WHEN** 候选 tag 在 L0-L5 全部未匹配
- **THEN** 将该 tag 加入异常提示词列表
- **AND** 在报告中标记为 `failed`
- **AND** 不写入最终 EMOTION_PROMPT_MAP（该维度位置留空或跳过）

### Requirement: 执行报告

系统 SHALL 在脚本完成后输出结构化 JSON 报告。

#### Scenario: 报告内容

- **WHEN** 脚本处理完所有 31 个情绪
- **THEN** 报告包含以下字段：
  - `totalEmotions`: 处理的情绪总数（31）
  - `successCount`: 成功生成且审计通过的情绪数
  - `failedCount`: 含异常 tag 的情绪数
  - `passRate`: 质检通过率（successCount / totalEmotions）
  - `totalTagsGenerated`: AI 生成的候选 tag 总数
  - `totalTagsValid`: 审计通过的 tag 数
  - `totalTagsReplaced`: 被替换的 tag 数（L2-L5 替换）
  - `totalTagsFailed`: 审计失败的 tag 数
  - `details`: 每个情绪的详细审计结果（候选 tag / 审计后 tag / 异常 tag / 命中层级）
  - `abnormalPrompts`: 异常提示词列表（tag + 对应情绪 + 失败原因）

## MODIFIED Requirements

### Requirement: 表情生成过滤 expression 分类特征

表情生成（`single-expression` / `batch-expression` 模式）时，系统 SHALL 过滤角色特征中 `categoryId === 'expression'` 的项，仅由 `{emotion}` 占位符提供表情 tag。

#### Scenario: 表情生成时过滤 expression 特征

- **WHEN** 用户在 `single-expression` 或 `batch-expression` 模式下生成表情
- **THEN** `buildSdOptions` 构建的 `characterTraits` 数组不含 `categoryId === 'expression'` 的项
- **AND** `{traits}` 占位符仅注入非 expression 分类的特征（basic / head / body / clothing / background / pose）
- **AND** `{emotion}` 占位符注入 EMOTION_PROMPT_MAP 的表情 tag（不与特征冲突）

#### Scenario: 非表情模式不受影响

- **WHEN** 用户在 `illustration` / `general` / `three-view` 模式下生成
- **THEN** `characterTraits` 数组包含所有 enabled 特征（含 expression 分类），行为不变

### Requirement: EMOTION_PROMPT_MAP 替换

系统 SHALL 将脚本产出的审计通过提示词硬编码替换 `EMOTION_PROMPT_MAP` 的原有值。

#### Scenario: 替换后提示词结构

- **WHEN** 脚本完成后，开发者将 `expression-prompt-map.generated.ts` 内容粘贴到 PromptBuilder.ts
- **THEN** `EMOTION_PROMPT_MAP` 每个情绪的 `positive` 字段为审计通过的 tag 字符串（逗号分隔，4 维度合并）
- **AND** 所有 tag 均为 Danbooro 标签库中的合法 tag（或审计替换后的 canonicalName）
- **AND** 保留 NSFW 语义（如 `in_heat` 情绪仍含 `blush, sweat, heart` 等 NSFW 相关合法 tag）
- **AND** `negative` 字段保持原有值或按需调整（本次不强制修改）

## REMOVED Requirements

（无移除项）
