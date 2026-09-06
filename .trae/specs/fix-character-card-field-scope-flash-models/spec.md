# 修复角色卡字段级 AI 操作被 Flash 模型泛化为完整角色卡输出 Spec

## Why

用户使用国产 Flash 模型（glm5.3-flash、qwen3.8-flash 等 100B+ MoE）在角色卡编辑器中对**单个字段**（如描述）执行生成/翻译/润色时，模型返回**包含所有字段**（个性、场景、初始消息等）的完整角色卡内容；而 Gemma4-31B 小模型无此问题。这不是参数量问题，而是**提示词作用域缺失**：目标文本与全量字段上下文在 user prompt 中无边界标识平铺混排，且系统提示不知道目标字段是什么，长上下文训练的 Flash 模型将其理解为"重写整张角色卡"文档任务。

## 根因分析（代码实证）

### 根因 1：目标文本与上下文无边界标识（最关键）

`useCharacterAIOperations.ts` 翻译（L296-301）/润色（L609-）的 user prompt 结构：

```
{目标文本}

【角色卡其他字段参考】
- 描述：{完整内容}
- 个性：{完整内容}
- 场景：{完整内容}
- 初始消息：{完整内容}
...

请在翻译时参考上述角色卡上下文信息，确保翻译用词与角色卡整体设定保持一致。
```

`buildCharacterContext`（L144-155）注入除目标字段外**所有已填字段的完整值**。目标文本与其他字段在文本流上完全同质，无标签包裹。Flash 模型在长上下文 + "角色卡"语义下，倾向输出文档级完整重写。

### 根因 2：翻译/润色系统提示无目标字段感知

- `character-card.translate` 模板（promptTemplateService.ts L871-885）：纯通用"翻译助手"指令，**无 target_field_label 变量**，未声明"仅翻译目标字段"
- `character-card.polish` 模板（L1059-1081）：同上，仅接受 `polish_requirements` 一个变量
- 对比：`character-card.generate` 模板有 `target_field_label`，因此生成场景问题相对较轻（但约束仍弱，见根因 3）

### 根因 3：生成模板作用域约束弱

`character-card.generate` user prompt（L935-945）中"请直接输出为该字段生成的内容"位于**全量字段信息之后**，约束位置靠后易被稀释；系统提示（L914-933）列出全部 9 个字段的规范说明，可能引导模型输出多字段。

### 根因 4：无输出侧防御

生成结果经 `runStreamingAI` 流式写回表单字段，无越界检测。即使模型违规输出完整卡，整段内容（含"个性：xxx"等其他字段文本）直接污染目标字段。

### 根因 5：模板持久化副本陷阱（既有教训）

内置种子更新后，存量安装的 DB 模板副本不会自动更新（`mergeNewDefaultTemplates` 只补新增 moduleId）。修复必须包含存量副本迁移，否则用户环境不生效。

### 为什么 Flash 出问题而 Gemma 没有

Flash 类模型（glm/qwen 的 flash 变体）训练语料中"角色卡 JSON/全字段文档"占比高，长上下文 + 多字段平铺输入会激活"文档补全"行为；Gemma 对窄指令的 scope adherence 更严格。修复方案不针对特定模型，而是从提示词结构与输出防御两侧根治，对两类模型均无害。

## What Changes

### 1. 翻译操作：目标文本标签包裹 + 上下文隔离（`useCharacterAIOperations.ts` handleTranslate）

user prompt 重构为：

```
请翻译以下<translate_target>标签内的文本：

<translate_target>
{目标文本}
</translate_target>

<context_reference>（以下为角色卡其他字段，仅作翻译用词参考，禁止翻译或输出其中任何内容）
- 描述：...
- 个性：...
</context_reference>
```

### 2. 润色操作：同构改造（handlePolish / performPolish）

user prompt 用 `<polish_target>` / `<context_reference>` 标签同构包裹。

### 3. 翻译/润色模板增加目标字段声明（promptTemplateService.ts）

- 两个模板各新增 `target_field_label` 变量（required: true）
- 翻译系统提示追加作用域段落：`本次翻译目标字段：【{{target_field_label}}】。仅输出该字段文本的译文……绝对禁止输出其他字段的内容`
- 润色系统提示同构追加
- `handleTranslate`/`performPolish` 传入 `target_field_label: FIELD_DESCRIPTIONS[field].label`

### 4. 生成模板强化作用域约束

- user prompt 首行加入目标字段强调（约束前置，不再只在结尾）
- 系统提示【生成规则】追加第 7 条：`仅生成【目标字段】一个字段的内容，绝对禁止生成或输出其他任何字段的内容（即使它们出现在已有信息中）`

### 5. 输出侧越界防御（三重防御，新增工具函数）

新增 `extractTargetFieldContent(raw, fieldLabel, addLog)` 纯函数：

- **防御 1（字段段落提取）**：若输出匹配多字段结构（其他字段中文名 + 冒号/换行开头的段落，如 `描述：`、`【个性】`、`# 场景`），提取目标字段标签后的段落作为结果
- **防御 2（全量回退校验）**：若提取失败但检测到 ≥2 个其他字段标签出现在输出中，判定为越界输出，保留原文并 `message.warning` 提示用户模型输出越界
- **防御 3（标签残留清理）**：清除输出中残留的 `<translate_target>`/`<polish_target>`/`<context_reference>` 标签文本
- 应用于翻译/润色/生成三处的最终写回前（流式实时预览显示原始流，最终写回为净化后结果；若防御 2 触发则恢复原文）

### 6. 存量模板迁移（promptTemplateService.ts）

参考 `migrateContinuationWhitelist` 模式：对 `character-card.translate`/`polish`/`generate` 存量副本，检测旧锚点（如原文中不含 `<translate_target>` 作用域声明/新规则第 7 条），命中则迁移至新版内容；用户自定义修改过的副本（内容与旧内置种子不一致）不覆盖，仅记日志。

## Impact

- **Affected specs**: `polish-deai-humanizer`（generate 场景的 `withHumanizerTextgenRules` 注入点不变，仅模板内容更新）；`fix-polish-*` 系列（对话输入润色，与本 spec 的角色卡编辑器润色是**不同链路**，不受影响）
- **Affected code**:
  - `src/renderer/components/Character/hooks/useCharacterAIOperations.ts`（三处 user prompt 构建 + 输出防御接入）
  - `src/main/services/promptTemplateService.ts`（三个模板种子更新 + 存量迁移）
  - 新增输出防御工具函数（建议放 `useCharacterAIOperations.ts` 同文件或其 utils，避免过度抽象）
  - `src/main/services/__tests__/PromptTemplateService.test.ts`（模板断言更新 + 迁移测试）

## ADDED Requirements

### Requirement: 翻译操作目标文本边界标识

系统 SHALL 在翻译操作的 user prompt 中用 `<translate_target>` 标签包裹目标文本，用 `<context_reference>` 标签包裹其他字段上下文，并在 context_reference 起始处声明"仅作参考，禁止翻译或输出其中任何内容"。

#### Scenario: 标签包裹格式
- **WHEN** 对描述字段执行翻译且其他字段有内容
- **THEN** user prompt 包含 `<translate_target>\n{描述原文}\n</translate_target>`
- **AND** 包含 `<context_reference>` 包裹的其他字段列表
- **AND** 不包含裸露的"请在翻译时参考上述角色卡上下文信息"旧措辞

#### Scenario: 无上下文时
- **WHEN** 其他字段全部为空
- **THEN** user prompt 仅含 `<translate_target>` 段落，不含 `<context_reference>` 段落

### Requirement: 润色操作目标文本边界标识

同翻译，使用 `<polish_target>` 标签。

### Requirement: 翻译/润色系统提示目标字段作用域声明

系统 SHALL 在 `character-card.translate` 与 `character-card.polish` 模板系统提示中包含 `{{target_field_label}}` 变量及"仅处理该字段、绝对禁止输出其他字段内容"的作用域约束。

#### Scenario: 变量注入
- **WHEN** 对"描述"字段发起翻译
- **THEN** 系统提示包含"本次翻译目标字段：【描述】"

### Requirement: 生成模板作用域强化

系统 SHALL 在生成模板 user prompt 首行前置目标字段强调，并在系统提示生成规则中明确"仅生成目标字段一个字段的内容"。

### Requirement: 输出越界防御（三重防御）

系统 SHALL 在翻译/润色/生成结果写回表单前执行越界检测与净化。

#### Scenario: 多字段输出被提取
- **WHEN** 模型输出 `描述：xxx\n个性：yyy\n场景：zzz` 而目标字段为"描述"
- **THEN** 写回内容为 `xxx`（目标字段段落），且日志记录"检测到越界输出，已提取目标字段段落"

#### Scenario: 越界且无法提取
- **WHEN** 目标字段为"描述"，输出含 ≥2 个其他字段标签但无"描述"标签段落
- **THEN** 目标字段恢复原文值，`message.warning` 提示"模型输出越界（包含其他字段内容），已保留原文，建议重试或更换模型"

#### Scenario: 正常输出不受影响
- **WHEN** 输出仅为目标字段内容（无其他字段标签）
- **THEN** 原样写回，无告警

#### Scenario: 标签残留清理
- **WHEN** 输出包含 `<polish_target>` 等标签文本残留
- **THEN** 写回前清除标签文本

### Requirement: 存量模板迁移

系统 SHALL 对已安装环境的三个角色卡模板存量副本执行锚点迁移，使新版种子生效；用户自定义修改过的副本不覆盖。

#### Scenario: 存量未修改副本迁移
- **WHEN** DB 中存在旧版 `character-card.translate` 副本（与旧内置种子一致）
- **THEN** 迁移为新版内容

#### Scenario: 自定义副本保留
- **WHEN** 用户曾编辑过该模板（内容与旧内置种子不一致）
- **THEN** 不覆盖，记 warn 日志

## MODIFIED Requirements

### Requirement: buildCharacterContext 的消费方式

函数本身逻辑保留（仍返回其他字段列表），但消费点改为包裹进 `<context_reference>` 标签，不再以"【角色卡其他字段参考】"裸段落拼接。

### Requirement: 翻译/润色 user prompt 结构

从 `{text}\n\n【角色卡其他字段参考】\n{context}\n\n请在翻译时参考...` 改为标签化结构（见 What Changes 1/2）。

## REMOVED Requirements

（无）

## 测试标准与评估指标

### 自动化测试（单测）

1. 模板种子断言：三模板含新作用域声明/标签说明；`target_field_label` 变量注册正确
2. 迁移测试：未修改副本迁移成功、自定义副本保留
3. `extractTargetFieldContent` 单测：多字段提取 / 无法提取回退 / 标签清理 / 正常透传 四类用例

### 手动测试矩阵

| 维度 | 取值 |
|---|---|
| 字段 | 描述、个性、场景、初始消息（4 个代表字段） |
| 任务 | 生成、翻译、润色 |
| 模型 | glm5.3-flash、qwen3.8-flash（问题模型）+ Gemma4-31B（回归确认） |
| 卡片状态 | 其他字段全空 / 其他字段全满 |

通过标准：Flash 模型下 12 组字段×任务组合输出均不包含其他字段内容；Gemma 行为不回归。

### 评估指标（量化）

- **字段越界率**：输出中包含其他字段标签的请求占比（优化前实测基线 vs 优化后，目标 0%）
- **输出长度比**：结果长度 / 目标字段原文长度（翻译润色应 < 3，若 > 5 判定疑似越界）
- **目标内容保留率**：译文/润色结果与原文的语义对应（人工抽查）
