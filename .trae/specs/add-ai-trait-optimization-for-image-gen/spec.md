# 允许 AI 优化特征标签（试验性功能）Spec

## Why

对话图片生成时，角色卡上的特征标签（如「裤子」「sitting」）可能与当前对话上下文矛盾（如对话中角色「脱下了裤子」「站了起来」），导致生成的图片与剧情不符。当前系统仅做「加法」（AI 生成上下文标签后合并），缺少「减法」能力——无法根据对话进展移除已不适用的角色特征标签。

本功能新增一个试验性开关，允许 AI 根据对话上下文分析并返回应删除的角色特征标签，在图片生成前过滤掉矛盾标签。

## What Changes

- **新增配置项** `ai_optimize_traits?: boolean`（`AIParameterConfig`，默认 `false`/`undefined` = 关闭）
- **新增 ConfigPanel UI**：图片生成设置区新增「允许 AI 优化特征标签」开关 + 试验性功能警示文案
- **新增 AI 服务方法** `optimizeTraitsForContext`（`characterTraitAIService.ts`）：接收已启用角色特征标签列表 + 对话上下文，返回应删除的标签列表
- **新增 IPC 通道** `ai:optimizeTraitsForContext`（主进程 handler + preload + electron.d.ts）
- **修改 `executeImageGeneration`**：在收集已启用角色特征后、生成上下文标签前，若开关开启则调用 AI 优化服务过滤标签
- **扩展 `ImageHistoryItem`**：新增 `removedTags?: Array<{ text: string; reason?: string }>` 字段，记录被 AI 删除的标签及原因
- **扩展标签快照展示**（`ChatMessageBubble`）：在标签展示面板中显示被删除的标签（灰色删除线 + 原因 tooltip）
- **新增操作日志**：记录用户是否启用该功能、AI 返回的删除列表、实际过滤结果

## Impact

- **Affected specs**: `add-conversation-image-generation` / `enhance-conversation-image-auditability` / `enhance-conversation-interaction-prompt-recognition`
- **Affected code**:
  - `src/renderer/components/Character/CharacterDialogueChat/CharacterDialogueChat.types.ts` — `AIParameterConfig` 新增字段 + `ImageHistoryItem` 新增字段
  - `src/renderer/components/Character/CharacterDialogueChat/CharacterDialogueChat.tsx` — `executeImageGeneration` 插入 AI 优化步骤 + props 透传
  - `src/renderer/components/Character/CharacterDialogueChat/ConfigPanel.tsx` — 新增开关 UI
  - `src/renderer/components/Character/CharacterDialogueChat/ConfigPanel.css` — 试验性功能警示样式
  - `src/renderer/components/Character/CharacterDialogueChat/ChatMessageBubble.tsx` — 标签快照展示被删除标签
  - `src/main/services/characterTraitAIService.ts` — 新增 `optimizeTraitsForContext` 方法
  - `src/main/ipc/handlers/characterTraitAIHandlers.ts` — 新增 IPC handler
  - `src/main/preload.ts` — 暴露新 IPC 方法
  - `src/renderer/types/electron.d.ts` — 新增类型声明
  - `src/renderer/components/Character/CharacterDialogueChat/CharacterDialogueChat.hooks.ts` — 新增 config 读写 hook（若需要）

## ADDED Requirements

### Requirement: AI 特征标签优化开关

系统 SHALL 在 ConfigPanel「图片生成设置」区域提供「允许 AI 优化特征标签」开关控件，默认关闭。开关旁 SHALL 显示试验性功能警示文案：「此为试验性功能，AI 可能会删除重要标签，建议谨慎使用」。开关状态 SHALL 持久化到角色会话配置（`customParameters.ai_optimize_traits`），在用户会话期间保持一致。

#### Scenario: 用户开启开关
- **WHEN** 用户在图片生成设置区将「允许 AI 优化特征标签」开关切换为开启
- **THEN** 开关状态保存到 `customParameters.ai_optimize_traits = true`
- **AND** 试验性警示文案保持可见

#### Scenario: 用户关闭开关
- **WHEN** 用户将开关切换为关闭
- **THEN** 开关状态保存到 `customParameters.ai_optimize_traits = false`
- **AND** 后续图片生成不执行 AI 标签优化

### Requirement: AI 标签优化分析

当开关开启且用户触发图片生成/重新生成时，系统 SHALL 在收集已启用角色特征标签后、生成上下文标签前，调用 AI 服务分析标签与对话上下文的矛盾关系。

#### Scenario: AI 成功返回删除列表
- **WHEN** 开关开启 + 用户点击生成图片
- **AND** 系统已收集已启用角色特征标签（`enabledTraitTexts`）
- **AND** AI 返回合法的删除标签列表
- **THEN** 系统从 `enabledTraitTexts` 中移除 AI 指定的标签
- **AND** 被移除的标签及其原因记录到 `ImageHistoryItem.removedTags`
- **AND** 过滤后的标签继续进入后续流程（上下文标签生成 → 合并 → 权重提升 → SD 生成）

#### Scenario: 对话上下文包含「脱下了裤子」
- **WHEN** 角色特征含 `pants` / `bottom:pants` 标签
- **AND** 对话上下文包含「脱下了裤子」描述
- **THEN** AI 应返回 `pants` 相关标签加入删除列表
- **AND** 生成图片时不再包含裤子相关特征

#### Scenario: 对话上下文包含「站了起来」
- **WHEN** 角色特征含 `sitting` 标签
- **AND** 对话上下文包含「站了起来」描述
- **THEN** AI 应返回 `sitting` 标签加入删除列表
- **AND** 生成图片时不再包含坐姿特征

### Requirement: AI 返回结果有效性验证

系统 SHALL 对 AI 返回的删除列表进行有效性验证，防止误删。

#### Scenario: AI 返回不存在的标签
- **WHEN** AI 返回的删除列表包含不在 `enabledTraitTexts` 中的标签
- **THEN** 系统忽略这些不存在的标签（仅过滤实际存在的）

#### Scenario: AI 返回空列表
- **WHEN** AI 返回空删除列表（无需删除任何标签）
- **THEN** 系统保持 `enabledTraitTexts` 不变，继续后续流程
- **AND** `ImageHistoryItem.removedTags` 为空数组或 undefined

#### Scenario: AI 返回所有标签（过度删除防护）
- **WHEN** AI 返回的删除列表覆盖了 `enabledTraitTexts` 中超过 80% 的标签
- **THEN** 系统拒绝执行删除操作，保持原标签列表不变
- **AND** 记录警告日志：「AI 优化返回过度删除（X/Y），已跳过」
- **AND** `ImageHistoryItem.removedTags` 记录 AI 建议但未执行的删除

#### Scenario: AI 调用失败或超时
- **WHEN** AI 服务调用失败（网络错误 / 超时 / 返回非法 JSON）
- **THEN** 系统降级为不执行标签优化，保持原标签列表不变
- **AND** 记录错误日志
- **AND** 图片生成流程继续（不因 AI 优化失败而中断）

### Requirement: 标签快照展示被删除标签

系统 SHALL 在图片下方的标签快照面板中展示被 AI 删除的标签，使可审计。

#### Scenario: 展示被删除标签
- **WHEN** 本次生成执行了 AI 标签优化且删除了标签
- **THEN** 标签快照面板在「已使用标签」区域下方显示「AI 已移除」分区
- **AND** 被删除的标签以灰色 + 删除线样式展示
- **AND** 鼠标悬停显示删除原因 tooltip（若 AI 提供了原因）

#### Scenario: 未删除任何标签
- **WHEN** 本次生成未开启 AI 优化 / AI 未删除任何标签
- **THEN** 标签快照面板不显示「AI 已移除」分区

### Requirement: 操作日志记录

系统 SHALL 记录 AI 标签优化相关的操作日志。

#### Scenario: 记录启用状态
- **WHEN** 用户触发图片生成
- **THEN** 日志记录 `[executeImageGeneration] AI 标签优化: 已启用 / 已禁用`

#### Scenario: 记录删除结果
- **WHEN** AI 返回删除列表
- **THEN** 日志记录 `[executeImageGeneration] AI 建议删除: [tag1, tag2, ...]`
- **AND** 日志记录 `[executeImageGeneration] 实际过滤: [tag1, tag2, ...]`（过滤后的实际结果）

## MODIFIED Requirements

### Requirement: executeImageGeneration 流程

在现有 `executeImageGeneration` 流程的「收集已启用角色特征」步骤（L454-463）之后、「AI 生成上下文标签」步骤（L467-485）之前，插入 AI 标签优化步骤：

```
1. 获取父消息 + 情绪快照（不变）
2. 创建/更新 imageAttachment 占位（不变）
3. 构建对话上下文（不变）
4. 加载角色特征 + LoRA（不变）
5. 收集已启用角色特征 → enabledTraitTexts（不变）
6. 【新增】若 ai_optimize_traits=true：
   a. 调用 ai:optimizeTraitsForContext({ traits: enabledTraitTexts, conversationContext })
   b. 验证返回结果（存在性 / 过度删除防护）
   c. 过滤 enabledTraitTexts，记录 removedTags
7. AI 生成上下文标签 → contextTraits（不变，基于过滤后的 enabledTraitTexts）
8. 合并 traits → mergedTraits（不变）
9. 应用互动标签权重 → finalTraits（不变）
10. SD 生成（不变）
11. 更新 imageAttachment history（扩展：removedTags 写入 ImageHistoryItem）
```

### Requirement: ImageHistoryItem 类型

`ImageHistoryItem` 新增可选字段 `removedTags`：

```typescript
export interface ImageHistoryItem {
  // ...现有字段...
  /**
   * AI 标签优化删除的标签列表（Spec: add-ai-trait-optimization-for-image-gen）。
   * 仅当用户开启「允许 AI 优化特征标签」且 AI 实际删除了标签时存在。
   * 用于标签快照面板展示「AI 已移除」分区。
   */
  removedTags?: Array<{ text: string; reason?: string }>;
}
```
