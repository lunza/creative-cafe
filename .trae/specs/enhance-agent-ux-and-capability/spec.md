# 智能体对话交互增强与能力强化 Spec

## Why

当前智能体对话界面（AgentDialogueModal）在命令提示和输入优化方面存在缺口：输入 `/` 时仅展示系统指令（5条）而非全部可用命令；缺少类似 CharacterDialogueChat 中的"优化输入"按钮；系统智能体的 system prompt 过于简单（仅一句话），缺乏多步推理和任务分解能力引导，远不及 Trae Solo Agent 的智能水平。

## What Changes

- **命令自动提示扩展**：AgentDialogueModal 输入 `/` 时展示全部已注册命令（系统指令 + 内置命令），而非仅系统指令
- **"优化输入"按钮**：在 AgentDialogueModal 输入框旁新增"优化输入"按钮，点击后对当前输入文本进行智能优化（提升清晰度、补全指令、修正语法），优化结果回填输入框供用户确认后发送
- **系统智能体 system prompt 强化**：为系统智能体构建专用 system prompt，包含角色定位、思考框架、任务分解策略、工具使用指导、多步推理指引等，使其具备与 Trae Solo Agent 同等的问题理解和执行能力

## Impact

- Affected specs: `consolidate-agents-into-system-agent`（系统智能体定义）、`optimize-agent-interaction-from-openclaw`（斜杠命令系统）、`refine-user-input-text`（润色输入）
- Affected code:
  - `src/renderer/components/AgentCenter/AgentDialogueModal.tsx` — 命令提示扩展 + 优化输入按钮
  - `src/renderer/components/AgentCenter/hooks/useAgentDialogue.ts` — 优化输入逻辑 + 强化 system prompt
  - `src/main/services/agent/management/agentConfigService.ts` — system-agent 描述更新

## ADDED Requirements

### Requirement: 全命令自动提示

AgentDialogueModal 输入 `/` 时，下拉列表 SHALL 展示全部已注册命令（系统指令 + 内置命令），按分组排列，支持键盘上下键导航和回车选择。

#### Scenario: 输入 / 时展示全部命令
- **WHEN** 用户在智能体对话窗口输入框中输入 `/`
- **THEN** 输入框下方显示下拉列表，包含全部已注册命令
- **AND** 系统指令（世界书/角色卡/编写/审核/帮助）和内置命令（help/reset/retry/continue/polish/model/clear）均展示
- **AND** 列表支持 ArrowUp/ArrowDown 键盘导航，高亮当前选中项
- **AND** 按 Enter 选择高亮命令并填入输入框，按 Escape 关闭列表
- **AND** 输入 `/w` 时过滤显示名称包含 "w" 的命令（如"世界书"）

### Requirement: 优化输入按钮

AgentDialogueModal 输入区域 SHALL 提供"优化输入"按钮，点击后对输入框中的文本进行 AI 智能优化。

#### Scenario: 优化输入文本
- **WHEN** 用户在输入框中输入文本后点击"优化输入"按钮
- **THEN** 按钮进入 loading 状态
- **AND** 系统调用 AI 对文本进行优化（提升清晰度、补全指令完整性、修正语法）
- **AND** 优化完成后，优化结果回填到输入框中，用户可继续编辑或直接发送
- **AND** 优化过程保持原输入意图不变

#### Scenario: 输入为空时点击优化
- **WHEN** 输入框为空时点击"优化输入"按钮
- **THEN** 显示提示"请先输入需要优化的文本"
- **AND** 不触发 AI 调用

#### Scenario: 优化过程中再次点击
- **WHEN** 优化进行中（loading 状态）时点击按钮
- **THEN** 取消当前优化请求
- **AND** 按钮恢复为正常状态

### Requirement: 系统智能体能力强化

系统智能体 SHALL 使用增强版 system prompt，包含多步推理、任务分解和自主思考能力引导。

#### Scenario: 系统智能体处理复杂任务
- **WHEN** 用户向系统智能体提出复杂需求（如"帮我分析这个角色卡的设定是否合理并给出改进建议"）
- **THEN** 智能体进行多步推理：理解需求 → 分解任务 → 调用工具获取数据 → 分析 → 给出结构化结论
- **AND** 智能体在回答中体现思考过程和逻辑推理链条

#### Scenario: 系统智能体自主使用工具
- **WHEN** 用户提出需要工具辅助的需求（如"查一下我的世界书有没有冲突的关键词"）
- **THEN** 智能体主动调用相关工具（如 worldbook-search）获取信息
- **AND** 基于工具返回结果给出有依据的回答

## MODIFIED Requirements

### Requirement: AgentDialogueModal 命令提示

原 AgentDialogueModal 仅展示系统指令（5条），修改为展示全部已注册命令（系统指令 + 内置命令）。

### Requirement: 系统智能体 system prompt

原 `buildSystemPrompt` 为所有智能体生成相同的简单提示词，修改为：当 `agent.isSystem === true` 时，追加能力强化段落。

## REMOVED Requirements

（无）
