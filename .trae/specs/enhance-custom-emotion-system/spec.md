# 自定义表情增强 Spec

## Why

当前角色卡表情系统中，自定义情绪仅存储 `{ key, label }` 两个字段，表情生成时使用简单兜底提示词 `${label} expression, emotional face`，远不如预置情绪的 4 维度丰富 tag（面部表情 / 人物动作 / 符号元素 / 背景样式）。这导致自定义表情的生成质量与预置表情存在巨大差距，且批量生成不支持自定义情绪。用户需要一个完整的 AI 提示词生成系统，让自定义表情在所有方面与预置表情完全对齐。

## What Changes

- **修改**：`CustomEmotion` 类型扩展，新增 `prompts` 字段存储 AI 生成的 SDXL tag 提示词（4 维度）和 NL 自然语言提示词
- **新增**：AI 提示词生成 IPC 通道（`ai:generateEmotionPrompts`），根据情绪关键词生成 4 维度候选 tag + NL 描述，并执行标签审计
- **修改**：`ExpressionManagerModal` 的「添加自定义情绪」弹窗，新增情绪关键词输入 + AI 提示词生成交互
- **修改**：`ExpressionGenerateModal` / `AssetGenerateModal` 的批量生成模式，包含自定义情绪
- **修改**：`buildExpressionGenerationPrompt` / `buildNLExpressionPrompt`，自定义情绪优先使用存储的 prompts，而非简单兜底
- **新增**：自定义情绪编辑功能（修改关键词 → 重新生成提示词）
- **修改**：`expressionService` 的 `addCustomEmotion` / `updateCustomEmotion` 方法支持 prompts 字段持久化

## Impact

- Affected specs:
  - `add-character-expression-system`（自定义情绪扩展需求修改）
  - `add-ai-expression-generation`（自定义情绪生成逻辑修改）
  - `optimize-expression-preset-prompts`（4 维度结构复用）
- Affected code:
  - `src/main/services/expressionService.ts` — `CustomEmotion` 类型扩展 + `addCustomEmotion` / `updateCustomEmotion` / `removeCustomEmotion` 方法修改
  - `src/main/services/characterTraitAIService.ts` — 新增 `generateEmotionPrompts` 方法（复用标签审计链）
  - `src/main/ipc/handlers/characterTraitAIHandlers.ts` — 新增 `ai:generateEmotionPrompts` IPC 通道
  - `src/main/preload.ts` + `src/renderer/types/electron.d.ts` — 暴露 `ai.generateEmotionPrompts` API
  - `src/renderer/components/Character/CharacterDialogueChat/ExpressionManagerModal.tsx` — 添加自定义情绪弹窗 UI 增强 + 编辑功能
  - `src/renderer/components/Character/CharacterDialogueChat/ExpressionGenerateModal.tsx` — 批量生成包含自定义情绪 + 提示词读取逻辑修改
  - `src/renderer/components/Character/CharacterDialogueChat/AssetGenerateModal.tsx` — 同步批量生成逻辑
  - `src/renderer/components/Character/CharacterDialogueChat/PromptBuilder.ts` — `buildExpressionGenerationPrompt` / `buildNLExpressionPrompt` 修改
  - `src/renderer/stores/expressionStore.ts` — `addCustomEmotion` / `updateCustomEmotion` 传递 prompts

## ADDED Requirements

### Requirement: 自定义情绪 AI 提示词生成

系统 SHALL 提供通过 AI 根据情绪关键词自动生成 SD 提示词的能力，生成的提示词覆盖 4 个维度（面部表情 / 人物动作 / 符号元素 / 背景样式），与预置情绪的 `EMOTION_PROMPT_MAP` 结构完全一致。

#### Scenario: 输入关键词生成提示词

- **GIVEN** 用户在「添加自定义情绪」弹窗中输入情绪关键词（如"热恋"）
- **WHEN** 用户点击「AI 生成提示词」按钮
- **THEN** 系统调用 LLM，传入关键词 + 4 维度结构要求 + Danbooru 标签格式约束
- **AND** LLM 返回 4 组逗号分隔的英文 tag（FACE / ACTION / SYMBOL / BACKGROUND）
- **AND** 对每条候选 tag 执行标签审计链（L0-L5），审计通过的 tag 保留，未通过的标记异常
- **AND** 返回 `{ positive: string, negative?: string, nlPrompt: string, tags: { face, action, symbol, background }, auditDetails }` 结构
- **AND** 在 UI 中展示 4 维度 tag 预览，用户可确认或手动编辑后保存

#### Scenario: NL 自然语言提示词同步生成

- **GIVEN** AI 提示词生成完成
- **WHEN** 系统返回结果
- **THEN** 同时包含 NL 自然语言描述（如 "an expression of passionate love with blushing cheeks and heart-shaped eyes"），用于 NL 驱动 SD 模型
- **AND** NL 提示词与 tag 提示词语义一致

#### Scenario: 标签审计失败处理

- **GIVEN** 某条候选 tag 在 L0-L5 审计链全部未匹配
- **WHEN** 系统处理审计结果
- **THEN** 该 tag 标记为 `failed`，在 UI 中以警告样式展示
- **AND** 用户可选择保留该 tag 或手动删除
- **AND** 不阻断整体保存流程（failed tag 仍写入 positive 字段，对 SD 模型仍可能有效）

### Requirement: 自定义情绪提示词存储

系统 SHALL 将 AI 生成的提示词持久化到表情 manifest 的 `customEmotions` 条目中，与预置情绪的 `EMOTION_PROMPT_MAP` 数据结构对齐。

#### Scenario: 存储结构

- **GIVEN** 用户保存一个自定义情绪"热恋"（key: `passionate_love`）
- **WHEN** 系统写入 manifest
- **THEN** `customEmotions` 数组新增条目：
  ```json
  {
    "key": "passionate_love",
    "label": "热恋",
    "prompts": {
      "positive": "heart-shaped_eyes, blush, smile, open_mouth, ...",
      "negative": "",
      "nlPrompt": "an expression of passionate love with ..."
    }
  }
  ```

#### Scenario: 向后兼容

- **GIVEN** 旧版本 manifest 中的 `customEmotions` 条目无 `prompts` 字段
- **WHEN** 系统读取该 manifest
- **THEN** `prompts` 字段视为 `undefined`，表情生成时回退到原有的 `${label} expression, emotional face` 兜底逻辑
- **AND** 不报错，不中断功能

### Requirement: 自定义情绪批量生成

系统 SHALL 在批量生成模式中包含自定义情绪，使自定义表情与预置表情享受同等的批量生成能力。

#### Scenario: 批量生成包含自定义情绪

- **GIVEN** 角色卡有 3 个自定义情绪（均有 prompts）
- **WHEN** 用户点击「AI 生成全部表情」
- **THEN** 批量生成列表包含 31 个预置情绪 + 3 个自定义情绪，共 34 个
- **AND** 自定义情绪使用其存储的 `prompts.positive` 作为提示词（与预置情绪使用 `EMOTION_PROMPT_MAP` 逻辑一致）
- **AND** 进度条显示总数为 34

#### Scenario: 自定义情绪无 prompts 时的批量生成

- **GIVEN** 某自定义情绪无 `prompts` 字段（旧数据或用户跳过 AI 生成）
- **WHEN** 批量生成到达该情绪
- **THEN** 回退使用 `${label} expression, emotional face` 作为提示词
- **AND** 不中断批量流程

### Requirement: 自定义情绪编辑

系统 SHALL 允许用户编辑自定义情绪的关键词并重新生成提示词，编辑后更新 manifest 中的 `prompts` 字段。

#### Scenario: 编辑自定义情绪提示词

- **GIVEN** 用户在表情管理弹窗中对已有自定义情绪点击「编辑」
- **WHEN** 用户修改情绪关键词并点击「重新生成提示词」
- **THEN** 系统调用 AI 生成新的 4 维度提示词
- **AND** 用户确认后更新 manifest 中该条目的 `prompts` 字段
- **AND** label 字段同步更新

#### Scenario: 编辑不影响已有表情图片

- **GIVEN** 自定义情绪"热恋"已生成表情图片
- **WHEN** 用户编辑关键词并重新生成提示词
- **THEN** 仅更新 `prompts` 字段，已有表情图片保留不变
- **AND** 用户可手动重新生成该情绪的表情图片

### Requirement: 自定义表情生成质量对齐

系统 SHALL 确保自定义表情在图片生成流程和质量标准上与预置表情完全一致。

#### Scenario: SDXL tag 模式下的提示词使用

- **GIVEN** SD 配置为 SDXL 模型 + 自定义情绪有 `prompts` 字段
- **WHEN** 生成该自定义情绪的表情
- **THEN** `buildExpressionGenerationPrompt` 使用 `customEmotion.prompts.positive` 作为 `{emotion}` 占位符内容
- **AND** 与预置情绪使用 `EMOTION_PROMPT_MAP[key].positive` 的逻辑完全对称
- **AND** 角色特征中 `expression` 分类的 tag 同样被过滤（避免冲突）

#### Scenario: NL 模型模式下的提示词使用

- **GIVEN** SD 配置为 NL 驱动模型（qwen-image / flux2）+ 自定义情绪有 `prompts.nlPrompt` 字段
- **WHEN** 生成该自定义情绪的表情
- **THEN** `buildNLExpressionPrompt` 使用 `customEmotion.prompts.nlPrompt` 作为情绪描述
- **AND** 与预置情绪使用 `EMOTION_NL_PROMPT_MAP[key]` 的逻辑完全对称

## MODIFIED Requirements

### Requirement: 自定义情绪扩展（原 Spec: add-character-expression-system 修改）

系统 SHALL 支持用户为单个角色卡添加自定义情绪类别，自定义情绪的英文键由用户输入（仅允许小写字母/数字/下划线），中文标签由用户填写，且可通过 AI 自动生成 4 维度 SD 提示词。自定义情绪的 `prompts` 字段可选（为空时回退到兜底逻辑）。

```typescript
interface CustomEmotion {
  key: string;        // 英文键名 ^[a-z][a-z0-9_]*$
  label: string;      // 中文标签
  prompts?: {         // AI 生成的 SD 提示词（可选，为空时回退兜底）
    positive: string;     // SDXL tag 风格（4 维度合并，逗号分隔）
    negative?: string;    // 负面提示词
    nlPrompt: string;     // NL 自然语言描述
  };
}
```

### Requirement: 表情图片来源（原 Spec: add-ai-expression-generation 修改）

表情图片可通过两种方式获得：
1. **用户手动上传**（原有功能，保留不变）
2. **AI 自动生成**（通过本地 SD WebUI img2img）

两种方式生成的表情在存储和渲染上完全相同。自定义情绪的 AI 生成使用与预置情绪相同的 SD 生成管线，提示词来源从 `EMOTION_PROMPT_MAP`（预置）或 `customEmotion.prompts`（自定义）读取，其余参数（denoising / steps / ADetailer / LoRA / 角色特征过滤）完全一致。

### Requirement: buildExpressionGenerationPrompt 修改

`buildExpressionGenerationPrompt` 函数新增 `customPrompts` 参数，当传入自定义情绪的 `prompts` 字段时，优先使用 `customPrompts.positive` 作为情绪提示词，而非 `EMOTION_PROMPT_MAP[emotionKey]` 或 `customLabel` 兜底。

```typescript
function buildExpressionGenerationPrompt(
  emotionKey: string,
  options?: {
    customLabel?: string;
    customPrompts?: { positive: string; negative?: string };
    characterTraits?: Array<{ text: string; weight?: number }>;
    // ... 其他已有参数
  }
): { prompt: string; negativePrompt: string }
```

调用优先级：`customPrompts.positive` > `EMOTION_PROMPT_MAP[key].positive` > `${customLabel} expression, emotional face` > `EMOTION_PROMPT_MAP.neutral.positive`

### Requirement: buildNLExpressionPrompt 修改

`buildNLExpressionPrompt` 函数新增 `customNlPrompt` 参数，当传入自定义情绪的 `nlPrompt` 字段时，优先使用该值作为 NL 情绪描述。

调用优先级：`customNlPrompt` > `EMOTION_NL_PROMPT_MAP[key]` > `${customLabel.toLowerCase()} expression` > `'a neutral expression'`

## REMOVED Requirements

（无移除项）
