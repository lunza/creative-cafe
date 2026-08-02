# 智能体世界书编写过程内容透明化 Spec

## Why

当前智能体对话框中执行世界书编写时，进度面板仅展示简略活动日志（阶段名 + 条目计数）和被截断到 120 字符的思考摘要，用户无法看到 AI 实际生成的条目内容、审计过程发现的具体问题和修复结果。同时编写过程缺少 loading 旋转图标，用户无法判断智能体是否仍在工作。需要将生成内容、审计详情实时推送到对话框，提升编写过程透明度。

## What Changes

- **扩展 `AuthoringProgressEvent`**：新增 `generatedEntries` 字段（携带最近生成的条目名称+内容摘要）和 `auditDetail` 字段（携带审计结果摘要：问题数、分数、关键问题列表）
- **后端推送实际内容**：在 `worldbookAuthoringService` 条目生成完成、微型审计完成、完整审计完成时，填充 `generatedEntries` 和 `auditDetail` 字段
- **前端面板展示实际内容**：`buildAuthoringProgressPanel` 新增"最近生成条目"区块（展示条目名称+内容前 200 字符）和"审计结果"区块（展示分数、通过/未通过、关键问题列表）
- **思考过程摘要扩展**：思考步骤 outputSummary 展示长度从 120 字符提升到 300 字符
- **Loading 状态指示器**：AgentDialogueModal 在世界书编写进行中时，进度面板标题旁显示旋转加载图标

## Impact

- Affected specs: `add-worldbook-thinking-visualization`（AuthoringProgressEvent 扩展）、`add-worldbook-thinking-visualization`（buildAuthoringProgressPanel 展示逻辑）
- Affected code:
  - `src/shared/types/worldbook-authoring.types.ts` — `AuthoringProgressEvent` 新增 `generatedEntries` 和 `auditDetail` 字段
  - `src/main/services/agent/worldbook/worldbookAuthoringService.ts` — 在条目生成、微型审计、完整审计节点填充新字段
  - `src/renderer/components/AgentCenter/hooks/useAgentDialogue.ts` — `buildAuthoringProgressPanel` 展示实际内容+审计结果；思考摘要扩展到 300 字符；`AuthoringProgressEvent` 类型 import 扩展

## ADDED Requirements

### Requirement: 生成条目内容推送

系统 SHALL 在每次条目生成完成后，通过 `AuthoringProgressEvent.generatedEntries` 字段推送最近生成的条目名称和内容摘要，供前端实时展示。

#### Scenario: 条目生成完成推送
- **WHEN** `worldbookAuthoringService` 成功为一个维度生成条目
- **THEN** 进度事件的 `generatedEntries` 字段包含本次生成的条目列表（每条含 name 和 content 前 200 字符）
- **AND** 列表最多包含最近 5 个条目（超出截断）

### Requirement: 审计结果详情推送

系统 SHALL 在微型审计和完整审计完成后，通过 `AuthoringProgressEvent.auditDetail` 字段推送审计结果摘要。

#### Scenario: 微型审计完成推送
- **WHEN** 微型审计完成
- **THEN** `auditDetail` 字段包含 `type: 'mini'`、`dimension`（维度名）、`completenessIssues`（完整性问题数）、`consistencyIssues`（一致性问题数）、`issues`（关键问题列表，每条含 description + entryIds，最多 5 条）

#### Scenario: 完整审计完成推送
- **WHEN** 完整审计完成
- **THEN** `auditDetail` 字段包含 `type: 'full'`、`overallPassed`（是否通过）、`overallScore`（综合分数）、`completeness`（完整性结果摘要）、`consistency`（一致性结果摘要）、`alignment`（符合度结果摘要）、`autoFixesApplied`（已自动修复数）、`userDecisions`（需用户决策项列表，最多 5 条）

### Requirement: 进度面板展示实际内容

`buildAuthoringProgressPanel` SHALL 在进度面板中展示最近生成的条目内容和审计结果详情。

#### Scenario: 展示生成条目
- **WHEN** 进度事件携带 `generatedEntries` 字段
- **THEN** 面板新增"📝 最近生成条目"区块
- **AND** 每个条目显示名称（加粗）和内容摘要（前 200 字符，灰色）
- **AND** 最多展示 5 个条目

#### Scenario: 展示审计结果
- **WHEN** 进度事件携带 `auditDetail` 字段
- **THEN** 面板新增"🔍 审计结果"区块
- **AND** 微型审计显示维度名、完整性问题数、一致性问题数、关键问题列表
- **AND** 完整审计显示通过/未通过、综合分数、三维度摘要、自动修复数、需用户决策项

### Requirement: Loading 状态指示器

AgentDialogueModal SHALL 在世界书编写进行中时，进度面板标题旁显示旋转加载图标。

#### Scenario: 编写进行中
- **WHEN** 进度面板消息存在且最新事件 phase 不在 `complete`/`cancelled`/`error` 中
- **THEN** 面板标题"📖 世界书「xxx」编写进度"旁显示 antd `LoadingOutlined` 旋转图标

#### Scenario: 编写完成
- **WHEN** 最新事件 phase 为 `complete`/`cancelled`/`error`
- **THEN** 旋转图标消失，替换为对应状态图标（✅/🚫/❌）

## MODIFIED Requirements

### Requirement: 思考过程摘要展示长度

`buildAuthoringProgressPanel` 中思考步骤的 `inputSummary` 和 `outputSummary` 展示长度从 120 字符提升到 300 字符，让用户看到更多 AI 思考细节。
