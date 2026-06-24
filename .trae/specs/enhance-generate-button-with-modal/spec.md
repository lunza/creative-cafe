# 角色卡编辑 - 生成按钮弹出输入框增强 Spec

## Why
当前角色卡编辑界面中，"生成"按钮点击后直接基于已有字段信息调用 AI 生成内容，用户无法在生成前提供方向性指导（如风格、主题、侧重点等），导致生成结果的可控性较差。需要为"生成"按钮增加一个弹出式输入框，让用户在生成前输入关键指导信息，提升生成质量。

## What Changes
- 修改 `CharacterManager.tsx` 中"生成"按钮的点击行为：从直接生成改为先弹出输入框
- 新增生成指导输入 Modal 组件，UI 与现有润色 Modal 完全一致
- 修改 `handleGenerate` 函数，接收用户输入的指导信息并拼接到 AI 提示词中
- 新增 `isGenerateModalOpen` 和 `generateRequirements` 状态变量

## Impact
- Affected specs: 无
- Affected code:
  - `src/renderer/components/Character/CharacterManager.tsx` - 修改生成按钮交互和新增 Modal
  - `src/renderer/components/Character/FieldEditor.tsx` - 无需修改（onGenerate 回调签名不变）

## ADDED Requirements

### Requirement: 生成指导输入弹窗
系统 SHALL 在用户点击"生成"按钮时弹出一个输入框，允许用户输入生成内容的方向、风格或主题等关键信息。

#### Scenario: 点击生成按钮
- **WHEN** 用户点击任意字段的"生成"按钮
- **THEN** 系统弹出输入框 Modal，标题为"AI生成"
- **AND** Modal 中包含一个 TextArea 输入框，placeholder 为"请输入生成要求（选填，如：风格偏向正式、增加细节描述等）"
- **AND** 输入框自动获得焦点
- **AND** 显示当前目标字段的名称

#### Scenario: 用户提交生成要求
- **WHEN** 用户在输入框中输入内容并点击"确认生成"按钮
- **THEN** 系统将用户输入作为附加指导信息传递给 AI 生成逻辑
- **AND** 关闭弹窗
- **AND** 开始 AI 生成流程

#### Scenario: 用户不输入直接提交
- **WHEN** 用户未输入任何内容直接点击"确认生成"
- **THEN** 系统使用原有生成逻辑（不附加额外指导），行为与修改前一致

#### Scenario: 用户取消
- **WHEN** 用户点击"取消"按钮或关闭弹窗
- **THEN** 系统关闭弹窗，不执行生成操作

#### Scenario: AI 生成进行中
- **WHEN** AI 生成正在进行中
- **THEN** 弹窗显示"中断请求"按钮
- **AND** 输入框变为禁用状态
- **AND** 不可关闭弹窗

### Requirement: 弹窗 UI 一致性
系统 SHALL 确保生成指导弹窗的 UI 设计与现有润色弹窗完全一致。

#### Scenario: 布局与样式
- **WHEN** 弹窗展示时
- **THEN** 弹窗标题为"AI生成"
- **AND** 包含提示文字"请输入生成要求（例如：风格偏向可爱、更加正式、增加细节等）："
- **AND** TextArea 为 4 行高度
- **AND** 底部按钮布局与润色弹窗一致（取消 + 确认生成 / 中断请求）

#### Scenario: 键盘交互
- **WHEN** 弹窗打开时
- **THEN** 支持 Enter 键确认生成（与润色弹窗行为一致）

### Requirement: 生成提示词增强
系统 SHALL 将用户输入的指导信息拼接到生成提示词中。

#### Scenario: 带有用户指导的生成
- **WHEN** 用户输入了生成指导并确认
- **THEN** 在原有 userPrompt 末尾追加用户指导内容，格式为："\n\n【用户生成指导】\n{用户输入内容}"

#### Scenario: 无用户指导的生成
- **WHEN** 用户未输入指导直接确认
- **THEN** 提示词与修改前完全一致，不附加任何额外内容

## MODIFIED Requirements

### Requirement: 生成按钮交互流程
原生成按钮点击后直接开始 AI 生成，修改为点击后先弹出指导输入弹窗，用户可选择填写指导或直接确认。
