# 创意描述 AI 润色功能 Spec

## Why
用户在新建创作项目时输入的创意描述可能表达不够流畅、文采不足或缺乏专业性。需要提供 AI 润色功能，帮助用户优化创意描述的表达质量，同时保持原创意核心不变。

## What Changes
- 在 `WritingConfigModal.tsx` 的创意描述输入框旁添加"AI 润色"按钮
- 新增 IPC 处理器 `writing:polishDescription` 用于调用 AI 润色接口
- 新增 `DescriptionPolisher.ts` 服务类，负责构建润色提示词并处理流式响应
- 润色过程需整合用户已选择的资源（世界书、角色卡、用户人设）作为上下文
- 实现流式输出 UI，实时展示润色过程
- 提供润色结果的确认/修改交互界面

## Impact
- Affected specs: 无
- Affected code:
  - `src/renderer/components/Creative/WritingMode/WritingConfigModal.tsx` - 添加润色按钮和流式输出 UI
  - `src/main/ipc/handlers/writingHandlers.ts` - 新增润色 IPC 处理器
  - `src/main/services/writing/DescriptionPolisher.ts` - 新增润色服务类
  - `src/main/services/writing/PromptBuilder.ts` - 新增润色提示词构建方法

## ADDED Requirements

### Requirement: AI 润色按钮
系统 SHALL 在创意描述输入框右侧或下方提供一个"AI 润色"按钮，按钮样式应与现有 UI 风格一致。

#### Scenario: 按钮可见性
- **WHEN** 用户在创意描述输入框中输入了至少 10 个字符
- **THEN** "AI 润色"按钮应处于可用状态
- **AND** 按钮显示为带有 AI 图标的按钮

#### Scenario: 按钮禁用状态
- **WHEN** 创意描述为空或少于 10 个字符
- **THEN** "AI 润色"按钮应处于禁用状态
- **AND** 鼠标悬停时显示提示"请输入至少 10 个字符后再润色"

### Requirement: 资源整合
系统 SHALL 在润色时自动整合用户当前已选择的资源作为上下文。

#### Scenario: 资源上下文构建
- **WHEN** 用户点击"AI 润色"按钮
- **THEN** 系统应收集已选择的世界书、角色卡、用户人设信息
- **AND** 将这些信息作为参考上下文传递给 AI

#### Scenario: 无资源选择
- **WHEN** 用户未选择任何资源
- **THEN** 系统应仅基于创意描述文本进行润色
- **AND** 不显示资源相关提示

### Requirement: 流式输出
系统 SHALL 使用流式输出方式实时展示润色过程。

#### Scenario: 流式展示
- **WHEN** AI 开始返回润色结果
- **THEN** 系统应逐字/逐句实时展示润色内容
- **AND** 自动滚动到最新内容
- **AND** 显示"润色中..."状态指示

#### Scenario: 中止润色
- **WHEN** 润色正在进行中
- **THEN** 用户可点击"中止"按钮停止润色
- **AND** 已接收的内容应保留显示

### Requirement: 结果确认与修改
系统 SHALL 提供润色结果的确认和修改交互界面。

#### Scenario: 结果预览
- **WHEN** 润色完成
- **THEN** 显示润色后的完整文本
- **AND** 提供"采用"和"重新润色"按钮
- **AND** 用户可直接编辑润色结果

#### Scenario: 采用结果
- **WHEN** 用户点击"采用"按钮
- **THEN** 润色结果应替换原创意描述输入框的内容
- **AND** 关闭润色结果展示区域

#### Scenario: 重新润色
- **WHEN** 用户点击"重新润色"按钮
- **THEN** 系统应基于当前内容（可能是修改后的润色结果）重新发起润色请求

### Requirement: 润色提示词
系统 SHALL 构建专门的润色提示词，确保 AI 理解任务目标。

#### Scenario: 提示词结构
- **WHEN** 构建润色请求
- **THEN** 提示词应明确要求 AI 保持原创意核心不变
- **AND** 要求提升表达流畅度、文采质量和专业度
- **AND** 包含资源上下文（如有）作为参考

#### Scenario: 输出格式
- **WHEN** AI 返回润色结果
- **THEN** 结果应为纯文本格式
- **AND** 不包含额外的解释或说明文字
