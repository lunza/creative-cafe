# AI 兜底标签审核 Spec

## Why

多轮审计机制（`add-multi-round-tag-audit`，L0-L4 + 末轮人工审核）上线后，仍存在两类顽固未匹配词：

- `B-cup`：杯罩尺寸属于领域术语，Danbooru 用 `medium_breasts`/`small_breasts` 表达，非颜色拆分/否定性修饰词剥离/语义 KNN 能解决；用户未必知道目标 tag，人工审核体验差。
- `brimless cap`：L3b 剥离 `brimless` 后得 `cap`，但若 `cap` 在某些 CSV 中无独立条目（仅作为 `hat` 的别名出现在 `aliases` 字段），L1/L2 可能漏命中。

需为人工审核添加最后一道防线：对 L0-L4 全失败的 tag，启用 LLM 兜底——以「角色卡图片 + 角色卡描述」（与「AI 生成特征」按钮同样的上下文）为输入，让 LLM 返回多个候选同义词或拆分词，再次走 L0-L4 匹配替换。命中则自动替换 + 持久化到 userSynonymMap（下次 L0 首轮命中）；仍未命中则保留人工入口，由用户手动编辑。

## What Changes

- **L5 AI 兜底**：在 `characterTraitAIService.generateCharacterTraits` 的 `validateTagsAgainstLibrary` 之后插入兜底环节
  - 触发条件：`isValid=false && skipReason!=='rating' && !replacedBy`（即 L0-L4 全失败且非评级词）
  - 批量上限：`AI_FALLBACK_MAX_TAGS=10`，超出跳过（避免 LLM 上下文过大导致响应慢/截断）
  - 复用主调用配置（baseUrl/apiKey/modelName/temperature/maxTokens），系统提示词换为 `AI_FALLBACK_SYSTEM_PROMPT`
  - 输出格式：`<original_tag> | candidate1, candidate2`，按 `|` 切分解析为 `Map<originalTag, candidates[]>`
  - 候选词一次性调 `validateTagsAgainstLibrary` 走 L0-L4，首个 `isValid=true` 的候选词替换 trait.text
- **持久化**：命中时调 `userSynonymMapService.addMapping(tag, replacement)`，下次同词 L0 首轮命中（与人工审核持久化机制一致）
- **类型扩展**：`tagValidation` 项新增 `aiFallbackAttempted?: boolean`、`aiFallbackCandidates?: string[]`，`source` 联合类型新增 `'ai-fallback'`
- **前端展示**：RagQualityReport 对 AI 兜底命中显示橙色 🤖 + 撤销按钮；对 AI 兜底未命中显示橙色淡 🤖 + 候选词 tooltip（✏ 手动入口仍可用）
- **撤销**：新增 `onRevertAiFallback` prop，AssetManagerModal 实现 `handleRevertAiFallback`——还原 trait + 删除映射 + 清除 ragDebug 标记（保留 `aiFallbackAttempted=true` 避免循环）

## Impact

- Affected specs: `add-multi-round-tag-audit`（L5 紧随 L4，复用 userSynonymMap 持久化机制）、`rag-tag-library-for-ai-trait-generation`（ragDebug 字段扩展）
- Affected code:
  - `src/main/services/characterTraitAIService.ts` — 新增常量 + 4 个私有方法 + 兜底环节插入
  - `src/main/services/tagRagService.ts` — `TagValidationItem` 类型扩展 `aiFallbackAttempted`/`aiFallbackCandidates` 字段
  - `src/renderer/components/Character/CharacterDialogueChat/RagQualityReport.tsx` — 接口扩展 + 橙色 🤖 渲染 + `onRevertAiFallback` prop
  - `src/renderer/components/Character/CharacterDialogueChat/AssetManagerModal.tsx` — `handleRevertAiFallback` + state 类型扩展

## ADDED Requirements

### Requirement: AI 兜底触发条件

`generateCharacterTraits` SHALL 在 `validateTagsAgainstLibrary` 完成后，对满足以下全部条件的 tag 启用 AI 兜底：

- `isValid === false`
- `skipReason !== 'rating'`（评级词对 SD 有效，无需纠错）
- `!replacedBy`（已被 L0-L4 替换的不再兜底）
- 待处理 tag 数 ≤ `AI_FALLBACK_MAX_TAGS`（=10），超出跳过整个兜底环节并写日志

#### Scenario: 触发 AI 兜底
- **WHEN** AI 生成 `["B-cup", "brimless cap", "white fur"]`，其中 `B-cup` 和 `brimless cap` 经 L0-L4 全失败（isValid=false, 无 replacedBy, 非 rating）
- **THEN** 对这两个 tag 启用 AI 兜底，调 LLM 生成候选词

#### Scenario: 超出批量上限跳过
- **WHEN** 未匹配 tag 数 = 12 > `AI_FALLBACK_MAX_TAGS`(10)
- **THEN** 跳过整个 AI 兜底环节，写 warn 日志，所有未匹配 tag 保留 ✏ 手动入口

### Requirement: AI 兜底候选词生成与验证

系统 SHALL 复用主调用的 AI 引擎配置（baseUrl/apiKey/apiKeyTransmission/modelName/temperature/maxTokens），使用专用系统提示词 `AI_FALLBACK_SYSTEM_PROMPT`，将角色描述/性格/场景 + 未匹配 tag 列表作为 user message，调 LLM 生成候选词。

候选词解析：按行解析 `<original_tag> | candidate1, candidate2` 格式，每 tag 保留前 4 个候选词（去重），未匹配 tag 不在 LLM 输出中则无候选词。

候选词验证：收集所有候选词（跨 tag 去重），一次性调 `validateTagsAgainstLibrary` 走 L0-L4，构建 `candidate → validation` 映射。

#### Scenario: 候选词命中替换
- **WHEN** LLM 对 `B-cup` 返回 `medium_breasts, small_breasts, breasts`，其中 `medium_breasts` 在标签库中
- **THEN** trait.text 替换为 `medium_breasts`，tagValidation 项设 `replacedBy='medium_breasts'`、`source='ai-fallback'`、`aiFallbackAttempted=true`、`aiFallbackCandidates=[medium_breasts, small_breasts, breasts]`，并调 `addMapping('B-cup', 'medium_breasts')` 持久化

#### Scenario: 全部候选词未命中
- **WHEN** LLM 对 `xyz` 返回 `abc, def`，两者均不在标签库
- **THEN** tagValidation 项设 `aiFallbackAttempted=true`、`aiFallbackCandidates=[abc, def]`，trait.text 不变，保留 ✏ 手动入口

### Requirement: AI 兜底命中持久化

AI 兜底命中时 SHALL 立即调 `userSynonymMapService.addMapping(originalTag, replacement)` 持久化到 `user-synonym-map.json`，下次 AI 生成同词时 L0 首轮命中（与人工审核持久化机制一致）。

持久化失败不阻塞替换（trait.text 已更新，但下次同词仍需走 AI 兜底）。

#### Scenario: 持久化失败降级
- **WHEN** AI 兜底命中 `B-cup → medium_breasts`，但 `addMapping` 抛异常
- **THEN** trait.text 仍替换为 `medium_breasts`，ragDebug 标记 source='ai-fallback'，写 warn 日志，下次同词仍走 AI 兜底

### Requirement: AI 兜底失败降级

LLM 调用失败/解析失败时 SHALL 将所有待处理 tag 的 `aiFallbackAttempted` 设为 `true`，不抛异常，不阻塞主流程返回 traits。

#### Scenario: LLM 调用网络异常
- **WHEN** AI 兜底 LLM 请求因网络错误失败
- **THEN** 所有待处理 tag 设 `aiFallbackAttempted=true`，写 warn 日志「AI 兜底异常，降级到手动替换入口」，主流程正常返回 traits

### Requirement: 前端 AI 兜底状态展示

RagQualityReport SHALL 区分三种 AI 兜底状态：

- **AI 兜底命中**（`source='ai-fallback' && replacedBy`）：橙色 🤖 + `→ replacedBy` + 撤销按钮（调 `onRevertAiFallback`）
- **AI 兜底未命中**（`aiFallbackAttempted=true && !replacedBy && !isValid`）：橙色淡 🤖 + tooltip 展示候选词，保留 ✏ 手动入口
- **未尝试**（`aiFallbackAttempted === undefined`）：维持原 invalid 红色 ❌ + ✏ 入口

优先级链：手动替换（紫🟣） > AI 兜底命中（橙🤖） > 自动替换（蓝🔄） > valid（绿✅） > rating > noSuggestion > hasSuggestionOnly > AI 兜底未命中（橙淡🤖） > invalid

#### Scenario: 橙色 🤖 命中展示
- **WHEN** tagValidation 项 `source='ai-fallback'`, `replacedBy='medium_breasts'`, `aiFallbackCandidates=['medium_breasts','small_breasts']`
- **THEN** Tag 渲染为橙色背景 + 🤖 图标 + `B-cup → medium_breasts` + ↩ 撤销按钮，tooltip 显示「🤖 AI 兜底命中：B-cup → medium_breasts（候选词：medium_breasts, small_breasts）（命中轮次：L5 AI 兜底）」

#### Scenario: 橙色淡 🤖 未命中展示
- **WHEN** tagValidation 项 `aiFallbackAttempted=true`, `aiFallbackCandidates=['abc','def']`, `isValid=false`, `replacedBy` 不存在
- **THEN** Tag 渲染为橙色淡背景 + 🤖 图标 + `xyz` + ✏ 手动入口，tooltip 显示「🤖 AI 兜底尝试未命中。候选词：abc, def（可点 ✏ 手动输入其中一个作为替换词）」

### Requirement: 撤销 AI 兜底替换

AssetManagerModal SHALL 提供 `handleRevertAiFallback(originalTag, replacement)` 回调：

1. 找到 `text === replacement` 的 trait，调 `updateTrait(trait.id, originalTag)` 还原
2. 调 IPC `tagRag.removeUserSynonymMapping(originalTag)` 删除 AI 兜底持久化的映射
3. 清除 ragDebug 对应项的 `replacedBy`/`source`/`aiFallbackCandidates`，**保留 `aiFallbackAttempted=true`**（避免下次再触发 LLM 调用）

#### Scenario: 撤销 AI 兜底命中
- **WHEN** 用户点击橙色 🤖 的 ↩ 按钮（`B-cup → medium_breasts`）
- **THEN** trait.text 还原为 `B-cup`，userSynonymMap 删除 `b-cup` 映射，ragDebug 项 `replacedBy=undefined`、`source=undefined`、`aiFallbackCandidates=undefined`、`aiFallbackAttempted=true`，UI 显示为 invalid 红色 ❌（不再展示 ✏ 入口）

## MODIFIED Requirements

### Requirement: validateTagsAgainstLibrary 多轮匹配链

匹配链扩展为七层（L0-L5），任一命中即标记 `isValid=true` 并记录 `canonicalName`：

1. **L0 自定义映射**（已有）：查 userSynonymMap，命中 → source='user-map'
2. **L1 name 精确**（已有）：source='name'
3. **L2 alias 精确**（已有）：source='alias'
4. **L3 颜色拆分**（已有）：source='color-split'
5. **L3b 否定性修饰词剥离**（已有）：source='negation-strip'
6. **L4 语义 KNN**（已有）：source='knn'
7. **L5 AI 兜底**（新增）：characterTraitAIService.applyAiFallback 写入 source='ai-fallback'

注：L5 不在 `validateTagsAgainstLibrary` 内部执行，而是由 `characterTraitAIService.generateCharacterTraits` 在 validate 之后对未匹配 tag 调用 LLM 生成候选词，再对候选词调 `validateTagsAgainstLibrary` 走 L0-L4，命中后写 `source='ai-fallback'` 标识。

### Requirement: ragDebug 透传 AI 兜底状态

`GenerateCharacterTraitsResult.ragDebug.tagValidation` 类型新增：
- `source` 联合类型新增 `'ai-fallback'`（AI 兜底命中标识，由 `applyAiFallback` 写入）
- `aiFallbackAttempted?: boolean`（已尝试过 AI 兜底，无论命中与否）
- `aiFallbackCandidates?: string[]`（LLM 返回的候选词数组，未命中时供前端展示）

## REMOVED Requirements

无。
