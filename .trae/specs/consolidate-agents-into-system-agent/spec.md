# 整合预制智能体为统一系统智能体 Spec

## Why

当前系统存在三个独立预置智能体（对话/写作/世界书），用户需在不同智能体间切换才能完成不同任务，操作碎片化且职责边界模糊。需整合为单一系统智能体，通过斜杠指令（skill）统一入口，提升操作一致性与可管理性。

## What Changes

- **合并三个预置智能体为单一 `system-agent`**：整合所有技能白名单，支持对话/写作/世界书全模式
- **新增 4 个系统指令**：`/世界书`、`/角色卡`、`/编写 <名称>`、`/审核 <名称>`，作为系统智能体的核心交互入口
- **指令处理架构扩展**：在现有斜杠命令注册中心基础上，新增系统指令注册机制，支持中文指令名和参数化指令
- **系统智能体详情只读保护**：系统智能体详情可查看但核心配置（名称/描述/类型/技能/模式）不可编辑
- **AgentDialogueModal 指令支持**：智能体对话窗口识别 `/` 前缀指令，执行对应操作并将结果展示在对话流中
- **旧预置智能体迁移**：初始化时标记旧三智能体为已弃用并从列表中隐藏，已存在的用户自定义智能体不受影响

## Impact

- Affected specs: `add-agent-mode-management-and-center`（预置智能体定义）、`optimize-agent-interaction-from-openclaw`（斜杠命令系统）
- Affected code:
  - `src/main/services/agent/management/agentConfigService.ts` — SYSTEM_AGENTS 定义
  - `src/renderer/components/Common/SlashCommand/builtinCommands.ts` — 内置命令注册
  - `src/renderer/components/Common/SlashCommand/SlashCommandRegistry.ts` — 命令注册中心
  - `src/renderer/components/AgentCenter/AgentDialogueModal.tsx` — 对话窗口指令支持
  - `src/renderer/components/AgentCenter/hooks/useAgentDialogue.ts` — 对话 hook 指令处理
  - `src/renderer/components/AgentCenter/AgentDetail.tsx` — 详情只读保护
  - `src/renderer/components/AgentCenter/AgentList.tsx` — 列表展示调整
  - `src/renderer/components/AgentCenter/AgentCenter.tsx` — 页面逻辑调整

## ADDED Requirements

### Requirement: 统一系统智能体

系统 SHALL 提供唯一预置智能体 `system-agent`，整合对话/写作/世界书三个领域的全部技能，作为系统级任务的统一执行入口。

#### Scenario: 系统初始化后仅存在一个预置智能体
- **WHEN** 系统首次初始化或升级后启动
- **THEN** 智能体列表中仅显示一个名为"系统智能体"的预置智能体（isSystem=true）
- **AND** 旧的三个预置智能体（dialogue-agent/writing-agent/worldbook-agent）不再出现在列表中
- **AND** 系统智能体的技能白名单包含所有原三个智能体的技能

#### Scenario: 用户与系统智能体对话
- **WHEN** 用户在智能体中心点击系统智能体的"对话"按钮
- **THEN** 打开对话窗口，显示系统智能体开场白
- **AND** 用户可直接输入消息进行多轮对话
- **AND** 用户可输入 `/` 前缀指令触发系统操作

### Requirement: 系统指令识别与处理

系统 SHALL 识别以 `/` 开头的中文指令，并执行对应系统操作。

#### Scenario: 输入 /世界书 指令
- **WHEN** 用户在系统智能体对话窗口输入 `/世界书`
- **THEN** 系统调用 `worldBook.list()` IPC 获取所有世界书列表
- **AND** 以 assistant 消息形式展示世界书列表（名称 + 条目数 + 更新时间）

#### Scenario: 输入 /角色卡 指令
- **WHEN** 用户在系统智能体对话窗口输入 `/角色卡`
- **THEN** 系统调用 `character.list()` IPC 获取所有角色卡列表
- **AND** 以 assistant 消息形式展示角色卡列表（名称 + 描述 + 关联世界书数）

#### Scenario: 输入 /编写 指令带参数
- **WHEN** 用户输入 `/编写 我的世界书`
- **THEN** 系统查找名称匹配的世界书
- **AND** 找到时调用 `worldBookAgent.run()` 启动编写流程
- **AND** 在对话中显示"正在启动世界书「我的世界书」的编写流程…"
- **AND** 未找到时显示"未找到名为「我的世界书」的世界书，请使用 /世界书 查看可用列表"

#### Scenario: 输入 /审核 指令带参数
- **WHEN** 用户输入 `/审核 我的世界书`
- **THEN** 系统查找名称匹配的世界书
- **AND** 找到时启动审核流程（复用 worldbookAuditService）
- **AND** 在对话中展示审核结果摘要
- **AND** 未找到时显示友好错误提示

#### Scenario: 无效指令处理
- **WHEN** 用户输入 `/未知指令` 或指令格式错误
- **THEN** 系统返回友好的错误提示"未知指令：/未知指令。输入 /帮助 查看可用指令列表"
- **AND** 不影响后续对话正常进行

### Requirement: 指令架构可扩展性

系统 SHALL 提供可扩展的指令注册机制，新增指令无需修改现有架构核心代码。

#### Scenario: 新增系统指令
- **WHEN** 开发者需要新增一个系统指令（如 `/导出`）
- **THEN** 只需在系统指令注册文件中添加一条指令定义
- **AND** 无需修改 SlashCommandRegistry 核心逻辑或 AgentDialogueModal 组件

### Requirement: 系统智能体详情只读保护

系统 SHALL 允许用户查看系统智能体详情，但严格限制编辑权限。

#### Scenario: 查看系统智能体详情
- **WHEN** 用户点击系统智能体的"详情"按钮
- **THEN** 以只读形式展示智能体信息（名称/描述/类型/技能列表/模式）
- **AND** 不显示"编辑"按钮
- **AND** 技能配置面板以只读模式展示（不可勾选/取消勾选技能）

## MODIFIED Requirements

### Requirement: 预置智能体定义

原 `SYSTEM_AGENTS` 数组包含三个智能体定义，修改为仅包含一个 `system-agent`，整合所有技能白名单。

### Requirement: 斜杠命令注册中心

`SlashCommandRegistry` 扩展支持中文指令名注册，`builtinCommands.ts` 新增系统指令注册函数。

## REMOVED Requirements

### Requirement: 独立预置智能体（对话/写作/世界书）

**Reason**: 三个独立预置智能体合并为统一系统智能体，消除职责碎片化
**Migration**: 初始化时检测旧三智能体 ID（dialogue-agent/writing-agent/worldbook-agent），若存在则从数据库中标记为已弃用（status='disabled'）或删除记录，技能白名单迁移到 system-agent
