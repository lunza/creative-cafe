# 修复 AI 润色功能：添加用户指令输入对话框并消除硬编码默认值

## Why
当前 AI 润色功能存在两个问题：1) 点击"AI 润色"按钮后直接开始润色，用户无法指定具体的润色方向（如增强文采、精简表达、调整风格等）；2) 润色请求中的模型配置参数存在多处硬编码默认值（`gpt-3.5-turbo`、`0.7`、`2000`），当配置文件无法读取时会使用错误的默认值执行逻辑。此外，`DEFAULT_WRITING_CONFIG` 中也存在硬编码的 `model: 'gpt-4o'`，WritingConfigModal 和 WritingConfigPanel 中多处使用 `DEFAULT_WRITING_CONFIG.model` 作为 fallback，导致配置缺失时仍会使用错误的默认值。

## What Changes
- 在 WritingConfigModal 中点击"AI 润色"按钮后弹出指令输入对话框，让用户指定润色方向
- 移除 `writingHandlers.ts` 中 `polishDescription` 处理器的硬编码默认值（`gpt-3.5-turbo`、`0.7`、`2000`）
- 移除 `DEFAULT_WRITING_CONFIG` 中的硬编码 `model: 'gpt-4o'`
- 修复 WritingConfigModal 和 WritingConfigPanel 中所有使用 `DEFAULT_WRITING_CONFIG.model` 作为 fallback 的位置
- 确保所有配置依赖参数在未读取到配置时不执行，而非使用硬编码默认值
- 将用户指定的润色方向作为上下文传递给 AI

## Impact
- Affected specs: add-creative-description-polish（追加修改）
- Affected code:
  - `src/renderer/components/Creative/WritingMode/WritingConfigModal.tsx` - 添加润色指令对话框，移除硬编码默认值
  - `src/renderer/components/Creative/WritingMode/WritingConfigPanel.tsx` - 移除硬编码默认值
  - `src/main/ipc/handlers/writingHandlers.ts` - 移除 polishDescription 处理器中的硬编码默认值
  - `src/shared/constants/writing.constants.ts` - 移除 DEFAULT_WRITING_CONFIG 中的硬编码 model
  - `src/main/services/writing/PromptBuilder.ts` - 修改润色提示词以支持用户指令
  - `src/main/services/writing/DescriptionPolisher.ts` - 传递用户指令到提示词

## ADDED Requirements

### Requirement: 润色指令输入对话框
系统 SHALL 在用户点击"AI 润色"按钮后弹出一个对话框，让用户输入具体的润色方向。

#### Scenario: 对话框展示
- **WHEN** 用户点击"AI 润色"按钮且输入内容满足最低字符要求
- **THEN** 弹出一个模态对话框，包含一个文本输入区域
- **AND** 对话框标题为"AI 润色指令"
- **AND** 提供预设指令选项（如"提升文采"、"精简表达"、"增强专业性"、"调整语气"）
- **AND** 提供"开始润色"和"取消"按钮

#### Scenario: 预设指令选择
- **WHEN** 用户点击预设指令标签
- **THEN** 该指令文本应填入输入区域
- **AND** 用户可以在预设基础上继续编辑

#### Scenario: 无指令提交
- **WHEN** 用户未输入任何指令直接点击"开始润色"
- **THEN** 系统使用默认润色目标（保持核心、提升流畅度、增强文采、提高专业度）

### Requirement: 指令传递到 AI
系统 SHALL 将用户输入的润色指令作为上下文传递给 AI 润色请求。

#### Scenario: 指令整合
- **WHEN** 用户提交了润色指令
- **THEN** 指令应作为附加上下文整合到润色提示词中
- **AND** AI 应根据指令调整润色方向

## MODIFIED Requirements

### Requirement: 配置参数无硬编码默认值
系统 SHALL 不在代码中硬编码模型配置默认值，所有配置依赖参数必须从配置文件读取。

#### Scenario: 配置缺失时不执行
- **WHEN** AI 配置（模型、温度、maxTokens）无法从配置文件读取
- **THEN** 系统应拒绝执行润色请求
- **AND** 向用户显示"AI 配置未找到，请先在设置中配置 AI 服务"的提示
- **AND** 不使用任何硬编码的 fallback 值

#### Scenario: 配置正常读取
- **WHEN** AI 配置正常从配置文件读取
- **THEN** 使用配置文件中的值执行润色请求
- **AND** 不应用任何代码层面的默认值覆盖

### Requirement: DEFAULT_WRITING_CONFIG 无硬编码 model
系统 SHALL 不在 DEFAULT_WRITING_CONFIG 中设置硬编码的 model 值。

#### Scenario: model 为 undefined
- **WHEN** 读取 DEFAULT_WRITING_CONFIG.model
- **THEN** 返回值应为 undefined
- **AND** 调用方应检查 model 是否为 undefined 并提示用户配置
