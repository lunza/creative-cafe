# 世界书编写思考过程可视化 Spec

## Why
世界书编写智能体当前仅通过 `AuthoringProgressEvent` 推送宏观进度（阶段切换、维度/条目计数、活动描述），用户无法看到 AI 的思考过程、工具调用详情和决策依据。这导致编写过程像一个"黑盒"，用户无法判断 AI 的策略是否合理、生成的条目是否基于正确的推理，降低了系统的可解释性和可信度。

## What Changes
- 扩展 `AuthoringProgressEvent` 新增 `thoughtStep` 字段，携带微观思考步骤（LLM 调用目的、输入摘要、输出摘要、耗时）
- 在 `worldbookAuthoringService` 的关键 LLM 调用点（规划分析、澄清问题生成、计划构建、条目生成、审计）采集思考步骤并通过 progress 事件推送
- 在 `WorldBookAuthoringModal` 运行态新增"思考过程"可折叠面板，实时展示思考步骤时间线
- 支持用户点击任意思考步骤展开查看详情（输入摘要、输出摘要、耗时）
- 事件日志与思考面板并排展示，用户可同时查看宏观进度和微观思考

## Impact
- Affected specs: `implement-worldbook-authoring-agent`（扩展 AuthoringProgressEvent 和编写服务）
- Affected code:
  - `src/shared/types/worldbook-authoring.types.ts` — AuthoringProgressEvent 新增 thoughtStep 字段
  - `src/main/services/agent/worldbook/worldbookAuthoringService.ts` — 在 LLM 调用点采集思考步骤
  - `src/renderer/components/WorldBook/hooks/useWorldBookAuthoring.ts` — 处理 thoughtStep 事件
  - `src/renderer/components/WorldBook/WorldBookAuthoringModal.tsx` — 新增思考过程面板

## ADDED Requirements

### Requirement: 思考步骤采集
The system SHALL collect thought steps at each LLM call site during the worldbook authoring process, capturing the call purpose, input summary, output summary, and duration.

#### Scenario: 规划阶段分析提示
- **WHEN** the planning service calls LLM to analyze the user prompt
- **THEN** a thought step is collected with purpose="分析用户提示", input summary (first 200 chars of user prompt), output summary (first 200 chars of LLM response), and duration in ms

#### Scenario: 条目生成
- **WHEN** the entry generator calls LLM to generate entries for a dimension
- **THEN** a thought step is collected with purpose="生成「维度名」条目", input summary (dimension name + target count), output summary (parsed entry count + first entry name), and duration in ms

#### Scenario: 审计阶段
- **WHEN** the audit service calls LLM to check consistency
- **THEN** a thought step is collected with purpose="一致性检查", input summary (entry count), output summary (issues found count), and duration in ms

### Requirement: 思考过程可视化界面
The system SHALL provide a collapsible "思考过程" panel in the WorldBookAuthoringModal running view, displaying thought steps as a timeline.

#### Scenario: 实时展示思考步骤
- **WHEN** a thought step is received via progress event
- **THEN** it appears in the thought panel timeline with timestamp, purpose label, and duration badge

#### Scenario: 展开查看详情
- **WHEN** user clicks a thought step in the timeline
- **THEN** an expanded view shows the input summary and output summary

#### Scenario: 折叠/展开面板
- **WHEN** user clicks the panel header
- **THEN** the panel toggles between collapsed (showing only latest step) and expanded (showing full timeline)

### Requirement: 响应生成演变轨迹
The system SHALL record the evolution from initial LLM output to final entry data, showing how raw LLM text was parsed into structured entries.

#### Scenario: 条目解析轨迹
- **WHEN** the entry generator parses LLM JSON output into structured entries
- **THEN** a thought step is collected with purpose="解析条目数据", input summary (raw JSON first 200 chars), output summary (parsed N entries with names), and a "parseSuccess" flag

## MODIFIED Requirements

### Requirement: AuthoringProgressEvent 事件结构
`AuthoringProgressEvent` 新增可选字段 `thoughtStep?: ThoughtStep`，用于携带微观思考步骤。当事件包含 thoughtStep 时，前端将其追加到思考时间线而非（或同时）更新宏观进度。

```typescript
interface ThoughtStep {
  /** 思考步骤类型 */
  type: 'llm_call' | 'parse' | 'decision' | 'tool_call';
  /** 步骤目的（人类可读，如"分析用户提示"） */
  purpose: string;
  /** 输入摘要（截断到 300 字符） */
  inputSummary?: string;
  /** 输出摘要（截断到 300 字符） */
  outputSummary?: string;
  /** 耗时 ms */
  durationMs: number;
  /** 是否成功 */
  success: boolean;
  /** 关联的阶段 */
  phase?: AuthoringProgressEvent['phase'];
  /** 时间戳 ms */
  timestamp: number;
}
```

### Requirement: WorldBookAuthoringModal 运行态布局
运行态在现有进度条和事件日志之间新增"思考过程"可折叠面板。面板默认展开，展示思考步骤时间线。事件日志保持原有位置不变。
