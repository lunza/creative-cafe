# 智能体逐项问答交互模式 Spec

## Why

当前智能体在世界书编写 PLANNING 阶段需要向用户提出澄清问题时，采用一次性在对话进度面板中展示所有问题的模式，用户无法逐项回答、无法针对每个问题获得预设方案选项，交互体验与 Trae 的逐项提问弹窗模式差距显著。需要将澄清问题交互改为逐项提问弹窗模式，每个问题提供至少 3 个预设解决方案 + "其他"自定义输入。

## What Changes

- **逐项提问机制**：将 `planning_clarifying` 阶段的一次性展示所有问题改为逐项提问，每次仅展示一个问题的弹窗，用户回答确认后继续下一个
- **临时问答弹窗组件**：新增 `AgentQuestionModal` 组件，包含问题描述、上下文说明（why）、预设选项列表（≥3 个）、"其他"自定义输入区域
- **预设解决方案生成**：智能体在生成澄清问题时同时生成每个问题的预设选项（至少 3 个），用户可选择预设选项或输入自定义答案
- **useAgentDialogue 集成**：hook 新增澄清问题状态管理（当前问题索引、问题队列、回答提交），在 `planning_clarifying` 事件到达时弹出问答弹窗
- **回答提交**：用户回答通过 `worldBookAgent.answer` IPC 提交到后端，唤醒等待中的编排会话

## Impact

- Affected specs: `add-agent-dialogue-parameter-panel`（AgentDialogueModal 布局）、`implement-worldbook-authoring-agent`（clarifyingQuestions 类型）、`add-worldbook-thinking-visualization`（进度面板展示）
- Affected code:
  - `src/renderer/components/AgentCenter/AgentDialogueModal.tsx` — 集成问答弹窗
  - `src/renderer/components/AgentCenter/hooks/useAgentDialogue.ts` — 澄清问题状态管理 + 逐项提问逻辑 + 回答提交
  - `src/renderer/components/AgentCenter/AgentQuestionModal.tsx` — 新增：逐项问答弹窗组件
  - `src/renderer/components/AgentCenter/AgentQuestionModal.css` — 新增：弹窗样式
  - `src/shared/types/worldbook-authoring.types.ts` — `ClarifyingQuestion` 接口新增 `options?: string[]` 字段
  - `src/main/services/agent/worldbook/worldbookPlanningService.ts` — `generateClarifyingQuestions` 提示词要求 LLM 为每个问题生成 ≥3 个预设选项

## ADDED Requirements

### Requirement: 逐项提问机制

系统 SHALL 在智能体需要向用户提出多个澄清问题时，采用逐项提问方式：每次仅展示一个问题，待用户回答并确认后，方可继续展示下一个问题，严禁一次性展示所有问题。

#### Scenario: 多问题逐项展示
- **WHEN** 智能体生成 3 个澄清问题
- **THEN** 系统首先弹出第 1 个问题的问答弹窗
- **AND** 用户回答或跳过第 1 个问题后，弹出第 2 个问题的问答弹窗
- **AND** 用户回答或跳过第 2 个问题后，弹出第 3 个问题的问答弹窗
- **AND** 所有问题回答完毕后，通过 `worldBookAgent.answer` 一次性提交全部回答

#### Scenario: 问题弹窗状态
- **WHEN** 问答弹窗展示中
- **THEN** 对话输入框处于禁用状态，用户无法发送新消息
- **AND** 弹窗显示当前问题序号（如"问题 1/3"）

### Requirement: 临时问答弹窗

系统 SHALL 为每个澄清问题生成独立的临时问答弹窗，包含问题描述、上下文说明和用户输入区域。

#### Scenario: 弹窗内容
- **WHEN** 弹出问题弹窗
- **THEN** 弹窗标题显示"智能体需要确认"
- **AND** 弹窗显示问题序号（如"问题 1/3"）
- **AND** 弹窗显示问题内容（如"故事发生在哪个年代？"）
- **AND** 弹窗显示上下文说明（why 字段，解释为什么需要这个信息）
- **AND** 弹窗提供预设选项列表和"其他"自定义输入区域

#### Scenario: 弹窗关闭行为
- **WHEN** 用户点击"跳过"按钮
- **THEN** 当前问题标记为 skipped=true
- **AND** 弹窗关闭，继续展示下一个问题（如有）
- **WHEN** 用户点击弹窗外部或 ESC 键
- **THEN** 弹窗不关闭（必须显式选择"跳过"或"确认"）

### Requirement: 预设解决方案选项

系统 SHALL 为每个澄清问题提供至少 3 个预设解决方案选项，并包含一个"其他"选项允许用户输入自定义解决方案。

#### Scenario: 预设选项展示
- **WHEN** 弹窗展示问题
- **THEN** 弹窗显示至少 3 个预设选项作为可点击的卡片/按钮
- **AND** 每个选项有简短描述
- **AND** 最后显示"其他"选项，点击后展开文本输入框

#### Scenario: 选择预设选项
- **WHEN** 用户点击某个预设选项
- **THEN** 该选项高亮选中
- **AND** 用户可点击"确认"提交该选项作为回答
- **AND** 用户也可修改选中的选项后重新选择

#### Scenario: 自定义输入
- **WHEN** 用户点击"其他"选项
- **THEN** 展开文本输入框，用户可输入自定义答案
- **AND** 用户输入完成后点击"确认"提交自定义答案

### Requirement: 回答提交与编排恢复

系统 SHALL 在所有问题回答完毕后，通过 `worldBookAgent.answer` IPC 一次性提交全部回答，唤醒等待中的编排会话继续执行。

#### Scenario: 提交回答
- **WHEN** 最后一个问题被回答或跳过
- **THEN** 系统调用 `worldBookAgent.answer(sessionId, answers)` 提交全部回答
- **AND** 对话输入框恢复可用状态
- **AND** 编排会话继续执行（进入 building plan 阶段）

#### Scenario: 回答超时
- **WHEN** 用户在 10 分钟内未回答问题（后端超时）
- **THEN** 系统自动关闭弹窗
- **AND** 所有未回答问题标记为 skipped=true
- **AND** 编排会话以智能体推断的默认值继续

## MODIFIED Requirements

### Requirement: 澄清问题生成

`worldbookPlanningService.generateClarifyingQuestions` SHALL 在生成澄清问题时同时为每个问题生成至少 3 个预设选项（options 字段），供用户在问答弹窗中选择。

#### Scenario: 生成带选项的澄清问题
- **WHEN** PLANNING 阶段调用 generateClarifyingQuestions
- **THEN** 每个返回的 ClarifyingQuestion 包含 options 字段（至少 3 个字符串）
- **AND** options 字段中的选项与问题内容相关且具有实际参考价值

### Requirement: AgentDialogueModal 澄清问题展示

AgentDialogueModal SHALL 在 `planning_clarifying` 事件到达时，弹出逐项问答弹窗而非在进度面板中一次性展示所有问题。进度面板仅显示"正在等待用户回答澄清问题..."状态提示。

#### Scenario: planning_clarifying 事件处理
- **WHEN** 进度事件 phase='planning_clarifying' 到达
- **THEN** 进度面板显示"🤔 智能体需要确认以下问题"状态
- **AND** 弹出第 1 个问题的问答弹窗
- **AND** 对话输入框禁用
