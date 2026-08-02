# 智能体对话参数配置面板 Spec

## Why

当前 AgentDialogueModal 仅有一个居中对话区，缺少参数配置能力。用户无法自定义智能体人格风格、无法启用辅助引导模式，导致对话体验不如角色卡对话灵活。需要在对话窗口右侧增加折叠式参数面板，提供人格自定义和辅助模式功能。

## What Changes

- **AgentDialogueModal 布局重构**：从单列居中布局改为左右双列布局（左侧对话区 + 右侧参数面板），参数面板默认折叠隐藏
- **人格自定义系统**：参数面板提供自定义人格输入框，用户输入引导智能体回复语气/表达方式/应答风格/破限规则的细节描述，注入 systemPrompt
- **辅助模式功能**：移植角色卡对话的辅助模式（`<<<SUGGESTED_OPTIONS>>>` 标记格式 + 三选项差异化设计），新增强度调节（低/中/高三档），控制智能体引导行为的主动性
- **数据持久化**：参数配置按 agent.id 存储到 localStorage，切换智能体自动加载对应配置
- **视觉标识**：头部显示当前激活的人格模式和辅助模式标签，对话中辅助引导启用时显示状态提示

## Impact

- Affected specs: `enhance-agent-ux-and-capability`（AgentDialogueModal 美化）、`add-assist-mode-options`（辅助模式参考）
- Affected code:
  - `src/renderer/components/AgentCenter/AgentDialogueModal.tsx` — 布局重构 + 参数面板集成
  - `src/renderer/components/AgentCenter/AgentDialogueModal.css` — 双列布局样式
  - `src/renderer/components/AgentCenter/hooks/useAgentDialogue.ts` — 人格注入 systemPrompt + 辅助模式提示词注入 + 选项解析
  - `src/renderer/components/AgentCenter/AgentParamPanel.tsx` — 新增：参数面板组件
  - `src/renderer/components/AgentCenter/AgentParamPanel.css` — 新增：参数面板样式
  - `src/renderer/components/AgentCenter/hooks/useAgentParams.ts` — 新增：参数持久化 hook

## ADDED Requirements

### Requirement: 人格自定义系统

系统 SHALL 在参数面板中提供自定义人格输入框（TextArea），用户可输入引导智能体回复语气、表达方式、应答风格及破限规则的细节性文字描述。

#### Scenario: 设置自定义人格
- **WHEN** 用户在参数面板的人格输入框中输入文本（如"用古风文言文回复，语气沉稳内敛"）
- **THEN** 该文本实时注入到智能体的 systemPrompt 中，作为「人格风格」段落
- **AND** 后续对话中智能体的回复风格即时反映该人格设定
- **AND** 人格设置不影响智能体的身份和职责（仅影响交互风格）

#### Scenario: 人格输入框为空
- **WHEN** 人格输入框为空
- **THEN** systemPrompt 中不包含人格风格段落，智能体使用默认风格

#### Scenario: 人格与角色定义的区分
- **WHEN** 用户同时设置了智能体描述（角色定义）和自定义人格
- **THEN** systemPrompt 中智能体描述段落定义"你是谁"（身份职责）
- **AND** 人格风格段落定义"你怎么说话"（语气风格）
- **AND** 两者在 systemPrompt 中以独立段落呈现，不混淆

### Requirement: 辅助模式功能

系统 SHALL 在参数面板中提供辅助模式开关，开启后智能体在回复末尾生成 3 个推荐选项，引导对话方向。

#### Scenario: 开启辅助模式
- **WHEN** 用户打开辅助模式开关
- **THEN** systemPrompt 末尾注入辅助模式约束，要求 AI 在回复正文后以 `<<<SUGGESTED_OPTIONS>>>...<<<END_OPTIONS>>>` 格式输出 3 个推荐选项
- **AND** AI 回复完成后，系统自动解析并剥离选项块，将选项存入消息的 suggestedOptions 字段
- **AND** 在 AI 消息气泡下方渲染 3 个选项卡片（稳妥推进/平衡探索/发散创新三色设计）
- **AND** 用户点击选项后，选项文本填入输入框

#### Scenario: 关闭辅助模式
- **WHEN** 用户关闭辅助模式开关
- **THEN** systemPrompt 不注入辅助模式约束
- **AND** AI 回复不包含推荐选项
- **AND** 已有消息中的历史选项仍然保留显示

#### Scenario: AI 未生成选项
- **WHEN** 辅助模式开启但 AI 回复中未包含有效选项块
- **THEN** 系统静默处理，不显示选项区域，不影响正常回复展示

### Requirement: 辅助模式强度调节

系统 SHALL 提供辅助模式强度调节选项（低/中/高三档），控制智能体引导行为的主动性程度。

#### Scenario: 低强度
- **WHEN** 用户选择"低"强度
- **THEN** 辅助模式提示词要求 AI 生成贴合当前话题的保守选项，引导性较弱
- **AND** 选项更倾向于延续当前话题，不主动引入新方向

#### Scenario: 中强度
- **WHEN** 用户选择"中"强度
- **THEN** 辅助模式提示词要求 AI 生成适度转换角度的选项，保持对话张力

#### Scenario: 高强度
- **WHEN** 用户选择"高"强度
- **THEN** 辅助模式提示词要求 AI 生成大胆创新的选项，可能引入全新话题分支
- **AND** 选项更主动地引导对话方向

### Requirement: 折叠式参数面板

系统 SHALL 采用折叠/展开式设计，默认状态下参数面板隐藏以保持界面简洁。

#### Scenario: 默认折叠
- **WHEN** 用户打开智能体对话窗口
- **THEN** 参数面板默认折叠隐藏，对话区占据全部宽度
- **AND** 头部右侧显示一个齿轮图标按钮用于展开参数面板

#### Scenario: 展开参数面板
- **WHEN** 用户点击齿轮图标
- **THEN** 参数面板从右侧滑出展开
- **AND** 对话区宽度收窄，参数面板占据右侧约 300px 宽度
- **AND** 面板内各功能区块（人格自定义、辅助模式）以独立折叠卡片形式展示

#### Scenario: 折叠参数面板
- **WHEN** 用户再次点击齿轮图标
- **THEN** 参数面板收起隐藏，对话区恢复全部宽度

### Requirement: 实时生效

所有参数修改 SHALL 实时生效，无需额外确认步骤。

#### Scenario: 修改参数即时生效
- **WHEN** 用户在参数面板中修改任何参数（人格文本、辅助模式开关、强度档位）
- **THEN** 修改立即写入持久化存储
- **AND** 下一次 AI 回复即使用新的参数配置
- **AND** 无需点击"保存"或"确认"按钮

### Requirement: 重置为默认

系统 SHALL 提供"重置为默认"按钮，允许用户快速恢复系统默认设置。

#### Scenario: 重置参数
- **WHEN** 用户点击"重置为默认"按钮
- **THEN** 人格输入框清空
- **AND** 辅助模式开关关闭
- **AND** 辅助模式强度重置为"中"
- **AND** 重置结果立即持久化

### Requirement: 数据持久化

系统 SHALL 按智能体 ID 持久化用户的参数配置，切换智能体时自动加载对应配置。

#### Scenario: 持久化配置
- **WHEN** 用户修改参数后
- **THEN** 配置以 JSON 格式存储到 localStorage，key 为 `agent-params-{agentId}`
- **AND** 存储内容包括：customPersonality（string）、assistMode（boolean）、assistModeIntensity（'low'|'medium'|'high'）

#### Scenario: 切换智能体加载配置
- **WHEN** 用户关闭当前智能体对话窗口并打开另一个智能体
- **THEN** 参数面板自动加载新智能体对应的持久化配置
- **AND** 若新智能体无历史配置，则使用默认值

### Requirement: 功能标识

系统 SHALL 为当前激活的人格模式和辅助模式提供清晰的视觉标识。

#### Scenario: 头部状态标签
- **WHEN** 用户设置了自定义人格
- **THEN** 头部显示"人格"标签（紫色胶囊），鼠标悬停显示人格摘要
- **AND** 人格为空时不显示该标签

#### Scenario: 辅助模式状态标签
- **WHEN** 辅助模式开启
- **THEN** 头部显示"辅助"标签（橙色胶囊），附带强度等级指示（低/中/高）
- **AND** 辅助模式关闭时不显示该标签

#### Scenario: 对话中辅助引导提示
- **WHEN** AI 回复包含辅助模式选项时
- **THEN** 选项区域上方显示提示文本"AI 推荐了以下对话方向"
- **AND** 选项卡片以三色差异化设计展示（绿/紫/橙红）

## MODIFIED Requirements

### Requirement: AgentDialogueModal 布局

原 AgentDialogueModal 为单列居中布局（900px 宽 Modal），修改为左右双列布局：参数面板展开时总宽度 1200px（对话区 900px + 参数面板 300px），折叠时保持 900px。

### Requirement: useAgentDialogue systemPrompt 构建

原 `buildSystemPrompt` 仅包含智能体描述和能力强化段落，修改为：在能力强化段落后追加「人格风格」段落（若有自定义人格）和「辅助模式」段落（若开启辅助模式）。

## REMOVED Requirements

（无）
