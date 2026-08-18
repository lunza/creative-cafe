# AI 标签删除后自动补充特征标签 Spec

## Why

当前 AI 标签优化（`ai_optimize_traits`）只做「减法」——删除与对话上下文矛盾的标签。但删除标签后可能出现**关键特征描述缺失**：例如删除 `pants`（角色脱下裤子）后，`covered_pussy` 也应联动删除，且下身暴露状态需要补充 `pussy` 标签。当前系统缺少「删除→级联评估→补充」的链式逻辑，导致标签集在状态变更后描述不完整，生成的图片可能不符合实际场景。

## What Changes

- **增强 `optimizeTraitsForContext` AI 服务**：system prompt 从「仅返回删除列表」改为「同时返回删除列表 + 补充列表」，AI 一次调用完成级联推理
- **扩展 `OptimizeTraitsResult` 类型**：新增 `tagsToAdd?: Array<{ text: string; reason?: string; weight?: number; categoryId?: string }>` 字段
- **扩展 `ImageHistoryItem` 类型**：新增 `addedTags?: Array<{ text: string; reason?: string }>` 字段，用于标签快照面板展示
- **扩展 `aiOptimization` 元数据**：新增 `addedCount: number` 字段记录补充标签数
- **`executeImageGeneration` 集成**：AI 优化返回 `tagsToAdd` 后，去重检查（跳过已存在标签 + 跳过刚被删除的标签）+ 过度补充防护（>50% 新增拒绝）+ 将补充标签加入 `mergedTraits`
- **`ChatMessageBubble` UI**：标签快照面板新增「AI 已补充」分区（绿色高亮 + 添加原因 tooltip），头部徽标扩展为「AI 已移除 N / 已补充 M」
- **CSS 样式**：新增 `.chat-msg-image-added-tags` 系列样式（绿色系，与 removedTags 的灰色删除线形成视觉对比）

## Impact

- Affected specs: `add-ai-trait-optimization-for-image-gen`（§7.36/§7.37/§7.38 的 AI 优化功能增强）
- Affected code:
  - `src/main/services/characterTraitAIService.ts` — `optimizeTraitsForContext` 方法 + system prompt 重构 + `OptimizeTraitsResult` 接口扩展
  - `src/renderer/components/Character/CharacterDialogueChat/CharacterDialogueChat.types.ts` — `ImageHistoryItem` 新增 `addedTags` + `aiOptimization` 新增 `addedCount`
  - `src/renderer/components/Character/CharacterDialogueChat/CharacterDialogueChat.tsx` — `executeImageGeneration` 新增补充标签处理逻辑
  - `src/renderer/components/Character/CharacterDialogueChat/ChatMessageBubble.tsx` — 新增「AI 已补充」分区渲染 + 头部徽标扩展
  - `src/renderer/components/Character/CharacterDialogueChat/ChatMessageBubble.css` — 新增 added-tags 样式
  - `src/renderer/types/electron.d.ts` — `optimizeTraitsForContext` 返回值类型同步

## ADDED Requirements

### Requirement: AI 标签删除后自动补充

当 AI 优化启用（`ai_optimize_traits=true`）且 AI 删除了标签时，系统必须同时评估是否需要补充新的特征标签，以维持特征描述的完整性。

#### Scenario: 服装移除后补充暴露特征

- **WHEN** 对话上下文描述角色「脱下裤子」，且标签集中存在 `pants` 和 `covered_pussy`
- **THEN** AI 返回 `tagsToRemove: [{ text: "pants", reason: "对话中角色脱下了裤子" }, { text: "covered_pussy", reason: "裤子移除后下身不再被遮盖" }]`
- **AND** AI 返回 `tagsToAdd: [{ text: "pussy", reason: "裤子移除后下身暴露，需要补充暴露特征标签" }]`
- **AND** 标签快照面板「AI 已补充」分区显示绿色 `pussy` 标签 + 原因 tooltip

#### Scenario: 删除后无需补充

- **WHEN** AI 删除了 `disembodied_hand`（角色抽回手），但当前场景无需补充新标签
- **THEN** AI 返回 `tagsToAdd: []`（空数组）
- **AND** 标签快照面板不渲染「AI 已补充」分区（但「AI 已移除」分区正常显示）

#### Scenario: 姿势变化后补充新姿势

- **WHEN** 对话上下文描述角色「站了起来」，且标签集中存在 `sitting`
- **THEN** AI 返回 `tagsToRemove: [{ text: "sitting", reason: "对话中角色站了起来" }]`
- **AND** AI 返回 `tagsToAdd: [{ text: "standing", reason: "角色从坐姿变为站姿" }]`（如果 `standing` 不在标签集中）

#### Scenario: 补充标签已存在时跳过

- **WHEN** AI 返回 `tagsToAdd: [{ text: "pussy" }]`，但 `pussy` 已在 `mergedTraits` 中
- **THEN** 系统跳过该标签（去重），不重复添加
- **AND** 该标签不计入 `addedTags` 快照（因为不是实际新增）

#### Scenario: 补充标签与删除标签冲突时拒绝

- **WHEN** AI 返回 `tagsToRemove: [{ text: "pants" }]` 同时返回 `tagsToAdd: [{ text: "pants" }]`
- **THEN** 系统拒绝添加该标签（刚被删除的标签不能立即补充）
- **AND** 记录警告日志

#### Scenario: 过度补充防护

- **WHEN** AI 返回的 `tagsToAdd` 数量超过当前 `mergedTraits` 数量的 50%
- **THEN** 系统拒绝执行补充（防止 AI 大量注入无关标签），仅执行删除
- **AND** 记录警告日志，`aiOptimization.status` 仍为 `success`（删除已执行）

#### Scenario: AI 调用失败时降级

- **WHEN** AI 调用失败/超时/返回非法 JSON
- **THEN** 系统降级为不优化（既不删除也不补充），`aiOptimization.status = 'failed'`
- **AND** 不中断图片生成流程

## MODIFIED Requirements

### Requirement: AI 标签优化执行结果

原 `optimizeTraitsForContext` 仅返回 `tagsToRemove`。修改为同时返回 `tagsToRemove` 和 `tagsToAdd`，AI 在一次调用中完成「删除矛盾标签 + 评估并补充缺失标签」的链式推理。

**返回格式变更**：
```json
{
  "remove": [{ "text": "pants", "reason": "对话中角色脱下了裤子" }],
  "add": [{ "text": "pussy", "reason": "裤子移除后下身暴露" }]
}
```

### Requirement: ImageHistoryItem 标签快照

`ImageHistoryItem` 新增 `addedTags` 字段，与 `removedTags` 对称设计。`aiOptimization` 元数据新增 `addedCount` 字段。

### Requirement: 标签快照面板展示

标签快照面板新增「AI 已补充」分区，位于「AI 已移除」分区下方。头部徽标从单一「AI 已移除 N」扩展为「AI 已移除 N / 已补充 M」（有补充时才显示补充部分）。
