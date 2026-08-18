# 服装状态提示词指令增强 Spec

## Why

当前 AI 图片生成流程中，`generateTraitPrompts`（标签生成）和 `optimizeTraitsForContext`（删除+补充审核）两个阶段对服装状态变化的处理不够精细。现有审核阶段仅覆盖"服装移除→暴露"一种模式，不覆盖用户需要的"服装开合状态"（open_clothes）、"服装位置变化"（shorts_aside, panties_aside）和"身体部位暴露"（one_breast_out, off_shoulder）等场景。导致对话中描述"敞开夹克"、"拉下内裤"等服装状态变化时，AI 无法生成精准的视觉描述标签，图片生成结果与对话上下文脱节。

## What Changes

- **`generateTraitPrompts` 阶段增强**：在 `buildDynamicTraitSystemPrompt` 中新增 `costumeStateGuidance` 服装状态识别指令块（与现有 `interactionGuidance` 平行），引导 AI 根据对话上下文中的服装变化生成 3 类标签（开合状态 / 位置变化 / 身体部位暴露）
- **`optimizeTraitsForContext` 阶段增强**：扩展 PART 1 REMOVAL 矛盾检测模式（新增"服装开合状态变化"和"服装位置变化"矛盾识别），扩展 PART 2 SUPPLEMENT 补充模式（新增"开合/位移→暴露"补充逻辑）
- **RAG 标签库检索增强**：在 `generateTraitPrompts` 中，用服装状态关键词额外检索 RAG 标签库，将检索到的服装状态相关标签注入 system prompt 作为参考
- **扩展接口预留**：将服装状态指令构建抽取为独立方法（`buildCostumeStateGuidance`），后续可平行新增姿势/位置/情绪等状态变化维度

## Impact

- Affected specs: `enhance-conversation-interaction-prompt-recognition`（互动标签识别，平行扩展）、`add-ai-trait-optimization-for-image-gen`（AI 标签优化，审核模式扩展）、`add-ai-tag-supplement-after-removal`（标签补充能力，补充模式扩展）
- Affected code:
  - `src/main/services/characterTraitAIService.ts` — `buildDynamicTraitSystemPrompt` 新增服装状态指令块 + `generateTraitPrompts` 新增 RAG 服装状态检索 + `optimizeTraitsForContext` system prompt 扩展
  - 不涉及前端组件修改（标签生成和审核均在主进程 AI 服务中完成）
  - 不涉及 IPC 通道变更（现有 `ai:generateTraitPrompts` 和 `ai:optimizeTraitsForContext` 接口不变）

## ADDED Requirements

### Requirement: 服装状态标签生成（generateTraitPrompts 阶段）

系统 SHALL 在 `generateTraitPrompts` 的 system prompt 中包含服装状态识别指令块，引导 AI 根据对话上下文中的服装变化描述，生成以下 3 类 Danbooru 风格标签：

1. **服装开合状态**：如 `open_clothes`（衣物敞开）、`open_jacket`（夹克敞开）、`open_shirt`（衬衫敞开）、`unbuttoned_shirt`（未扣扣子的衬衫）、`zipper_open`（拉链拉开）等
2. **服装位置变化**：如 `shorts_around_one_leg`（短裤只穿单腿）、`shorts_aside`（短裤拉到一边）、`panties_aside`（内裤拉到一边）、`bra_lift`（胸罩掀起）、`shirt_lift`（衬衫掀起）、`skirt_lift`（裙子掀起）等
3. **身体部位暴露**：如 `one_breast_out`（单侧乳房外露）、`both_breasts_out`（双侧乳房外露）、`off_shoulder`（露肩）、`cleavage`（乳沟）、`underboob`（下乳）等

指令块 SHALL 包含以下内容：
- 3 类标签的命名规范和示例
- 服装状态与服装类型、身体部位的对应关系指导
- 条件触发规则：仅当对话上下文描述服装状态变化时才输出对应标签
- 输出格式：使用 `interaction` 分类前缀（与现有互动标签一致，不新建分类），如 `interaction:open_clothes|衣物敞开`

#### Scenario: 对话描述服装开合状态变化
- **WHEN** 对话上下文描述"她解开了夹克的扣子，敞开穿着"
- **THEN** AI 生成 `interaction:open_jacket|夹克敞开` 标签
- **AND** 标签参与 SD 图片生成，图片中角色夹克呈敞开状态

#### Scenario: 对话描述服装位置变化
- **WHEN** 对话上下文描述"她把内裤拉到一边"
- **THEN** AI 生成 `interaction:panties_aside|内裤拉到一边` 标签
- **AND** 标签参与 SD 图片生成，图片中角色内裤呈拉到一边状态

#### Scenario: 对话无服装状态变化描述
- **WHEN** 对话上下文不涉及任何服装状态变化
- **THEN** AI 不输出服装状态标签（条件触发，避免误生成）

### Requirement: 服装状态 RAG 标签库检索增强

系统 SHALL 在 `generateTraitPrompts` 中，除了用对话上下文 `prompt` 检索 RAG 标签库外，额外用服装状态关键词检索 RAG 标签库，将检索到的服装状态相关标签注入 system prompt 作为参考。

服装状态关键词列表 SHALL 包含以下 Danbooru 常见标签名（用于 RAG 向量检索查询）：
- 开合状态：`open_clothes`, `open_jacket`, `open_shirt`, `unbuttoned`, `zipper_open`
- 位置变化：`aside`, `lift`, `around_one_leg`, `pull_aside`
- 暴露状态：`one_breast_out`, `off_shoulder`, `cleavage`, `underboob`, `side_tie`

检索结果 SHALL 以"服装状态标签参考"标题注入 system prompt，与现有 RAG 检索结果（"标签库参考"）分区展示。

#### Scenario: RAG 检索到服装状态标签
- **WHEN** RAG 标签库中包含 `open_clothes`、`panties_aside` 等标签
- **AND** 对话上下文涉及服装状态变化
- **THEN** system prompt 中包含 RAG 检索到的服装状态标签作为参考
- **AND** AI 生成的标签优先使用 RAG 检索到的标准标签名

#### Scenario: RAG 未启用或检索失败
- **WHEN** RAG 标签库未启用或检索异常
- **THEN** 跳过服装状态 RAG 检索，仅依赖 system prompt 中的命名规范指导 AI 生成标签
- **AND** 不影响其他标签生成流程

### Requirement: 服装状态审核增强（optimizeTraitsForContext 阶段）

系统 SHALL 在 `optimizeTraitsForContext` 的 system prompt 中扩展以下内容：

**PART 1 - REMOVAL 扩展**：
- 新增"服装开合状态变化"矛盾模式：如对话描述"扣上扣子"/"拉上拉链"时，移除 `open_clothes` / `open_jacket` / `unbuttoned_shirt` 等开合状态标签
- 新增"服装位置变化复位"矛盾模式：如对话描述"穿好内裤"/"整理衣物"时，移除 `panties_aside` / `shorts_aside` / `shirt_lift` 等位移状态标签

**PART 2 - SUPPLEMENT 扩展**：
- 新增"开合→暴露"补充模式：如 `open_shirt` 被生成/保留时，补充 `cleavage` 或 `one_breast_out`（根据上下文判断单侧/双侧）
- 新增"位移→暴露"补充模式：如 `panties_aside` 被生成/保留时，补充 `pussy`（如未存在）
- 新增"位移→身体部位"补充模式：如 `shirt_lift` 被生成/保留时，补充 `navel`（肚脐）或 `midriff`（腰腹）

#### Scenario: 审核阶段检测到服装状态复位
- **WHEN** 对话上下文描述"她重新扣上了衬衫扣子"
- **AND** 当前标签列表包含 `open_shirt`
- **THEN** AI 返回 `tagsToRemove` 包含 `open_shirt`（原因：对话中角色扣上了扣子）

#### Scenario: 审核阶段补充开合暴露特征
- **WHEN** 当前标签列表包含 `open_jacket`（夹克敞开）
- **AND** 标签列表中不包含 `cleavage` 或 `one_breast_out`
- **AND** 对话上下文暗示胸部可见
- **THEN** AI 返回 `tagsToAdd` 包含相应的暴露特征标签

### Requirement: 扩展接口预留

系统 SHALL 将服装状态指令构建抽取为独立方法 `buildCostumeStateGuidance()`，与现有 `interactionGuidance`（内联构建）模式平行。后续新增其他状态变化维度（姿势/位置/情绪/身体状态）时，可平行新增对应的 `buildXxxStateGuidance()` 方法并拼接到 system prompt。

`optimizeTraitsForContext` 的 system prompt 中，状态变化检测模式 SHALL 以结构化的 section 形式组织（如 `Clothing State Patterns` section），后续可平行新增 `Pose State Patterns` / `Location State Patterns` 等 section。

#### Scenario: 后续扩展姿势状态维度
- **WHEN** 后续需求新增姿势状态变化检测
- **THEN** 只需新增 `buildPoseStateGuidance()` 方法并拼接到 `buildDynamicTraitSystemPrompt`
- **AND** 在 `optimizeTraitsForContext` system prompt 中新增 `Pose State Patterns` section
- **AND** 不需修改现有服装状态指令代码

## MODIFIED Requirements

### Requirement: generateTraitPrompts system prompt 构建

`buildDynamicTraitSystemPrompt` 方法 SHALL 在现有 `interactionGuidance`（互动元素识别指令块）之后，新增 `costumeStateGuidance`（服装状态识别指令块）。两个指令块平行存在，各自独立触发（互动动作 → 互动标签；服装变化 → 服装状态标签）。

system prompt 结构变更：
```
[原有分类体系 + 分类建议]
[interactionGuidance — 互动元素识别要求]
[costumeStateGuidance — 服装状态识别要求]  ← 新增
[原有要求 + 输出示例]
```

### Requirement: optimizeTraitsForContext system prompt

`optimizeTraitsForContext` 的 system prompt SHALL 在 PART 1 REMOVAL 的 "Common contradiction patterns" 和 PART 2 SUPPLEMENT 的 "Common supplement patterns" 中新增服装状态相关模式。

PART 1 新增模式：
- Clothing opening/closing change: 对话描述扣上/拉开/合上衣物时，移除对应开合状态标签
- Clothing position reset: 对话描述整理/穿好/复位衣物时，移除对应位移状态标签

PART 2 新增模式：
- Opening → exposure: 开合状态标签存在时，补充对应的暴露特征标签
- Displacement → exposure: 位移状态标签存在时，补充对应的暴露特征标签
- Displacement → body part: 位移状态标签存在时，补充对应的身体部位标签
