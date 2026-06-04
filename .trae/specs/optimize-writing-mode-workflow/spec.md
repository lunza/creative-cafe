# 写作模式功能改进 Spec

## Why
基于实际生产环境试运行结果及用户反馈数据，写作模式存在以下问题：
- 参数配置面板包含大量低使用率的高级参数（temperature、top_p等），增加用户认知负担
- "手动创建大纲"功能使用率低于0.5%，属于冗余功能
- 内容创作界面按钮过多（分解、合并、AI历史、版本、关闭面板、调整参数等使用率均低于1%），界面杂乱
- 思维链数据未能被有效利用，缺少独立展示和持久化存储
- 章节生成流程缺少状态校验，用户在上一章节未完成时直接生成下一章节可能导致质量问题
- Markdown编辑器在暗色模式下存在样式不一致问题
- 字数统计位置不直观，缺少目标字数对比和颜色提示
- 右侧辅助面板宽度固定，无法根据用户需求调整

## What Changes
- 移除写作配置面板中的"模型参数"折叠面板及其相关代码
- 移除"手动创建大纲"按钮及其关联逻辑
- 移除内容创作界面6个低使用率按钮（分解、合并、AI历史、版本、关闭面板、调整参数）
- 新增思维链(Chain of Thought)数据识别、展示和持久化功能
- 新增章节完成状态追踪（扩展ChapterStatus枚举）
- 新增"生成下一章节"时的前置校验和确认对话框
- Markdown编辑器暗色主题适配优化
- 右侧面板宽度拖拽调整功能（200px-600px范围）
- 字数统计迁移至编辑器顶部工具栏，带目标字数对比和颜色变化
- 剩余按钮重新布局（网格/弹性布局，间距8-12px）

## Impact
- 受影响的组件：WritingConfigPanel, ContentWorkspace, ManualOutlineEditor, WritingModeRightPanel, MarkdownEditor
- 受影响的Store：writingModeStore, writingModeUIStore, writingProjectStore
- 受影响的类型：writing.types.ts（ChapterStatus枚举扩展）
- 受影响的类型定义：WritingConfig接口简化（移除modelConfig）

## ADDED Requirements

### Requirement: 思维链数据处理
系统 SHALL 支持识别和展示AI模型返回的思维链(Chain of Thought)数据。

#### Scenario: 识别并展示思维链数据
- **WHEN** AI模型返回包含思维链格式的数据（如`<RichMediaReference>`标签包裹或`thinking_process`参数）
- **THEN** 系统自动提取思维链数据并在大纲生成结果界面以可折叠面板形式独立展示

#### Scenario: 思维链数据持久化
- **WHEN** 大纲生成完成并保存项目
- **THEN** 思维链数据作为项目元数据存储于project.json文件中（字段名`chainOfThought`）

#### Scenario: 思维链数据后续查看
- **WHEN** 用户打开已有项目的大纲编辑界面
- **THEN** 之前保存的思维链数据可在可折叠面板中查看

### Requirement: 章节状态扩展与校验
系统 SHALL 扩展章节状态枚举并实现生成前置校验机制。

#### Scenario: 扩展章节状态
- **WHEN** 章节经历不同处理阶段
- **THEN** 章节状态包括：未开始(pending)/生成中(generating)/已生成(generated)/已检查(checked)/已修复(fixed)/已整理(organized)/已完成(completed)

#### Scenario: 生成下一章节前置校验
- **WHEN** 用户点击"生成下一章节"按钮
- **THEN** 系统检查上一章节状态，若未达到"已整理"状态则弹出确认对话框
- **THEN** 对话框显示："检测到上一章节尚未完成全部操作，可能影响当前章节生成质量。是否继续生成？"
- **THEN** 提供"继续生成"和"返回处理"两个选项
- **THEN** 用户选择被记录到操作日志中

### Requirement: Markdown组件暗色主题适配
系统 SHALL 实现Markdown编辑器组件与系统主题模式的深度绑定。

#### Scenario: 暗色模式样式适配
- **WHEN** 系统切换到暗色主题
- **THEN** Markdown编辑器背景色切换为#1e1e1e或主题变量
- **THEN** 文本颜色切换为#e0e0e0或主题变量
- **THEN** 代码块、引用块等特殊元素样式同步适配暗色主题

### Requirement: 右侧面板拖拽调整宽度
系统 SHALL 支持右侧辅助面板宽度拖拽调整。

#### Scenario: 拖拽调整面板宽度
- **WHEN** 用户在面板右侧边缘的5px宽拖拽手柄上按住鼠标拖动
- **THEN** 面板宽度在200px-600px范围内实时调整
- **THEN** 鼠标悬停时显示双向箭头光标(e-resize/w-resize)
- **THEN** 面板内容区域自适应宽度变化
- **THEN** 调整后的宽度偏好在同一项目会话中保持一致

### Requirement: 字数统计显示优化
系统 SHALL 重构字数统计功能的UI位置和展示方式。

#### Scenario: 字数统计迁移和实时显示
- **WHEN** 用户在Markdown编辑器中输入内容
- **THEN** 字数统计显示在编辑器顶部工具栏区域
- **THEN** 显示格式为"字数：当前字数/目标字数"（如"字数：1250/2000"）
- **THEN** 字数在用户输入过程中实时更新

#### Scenario: 字数颜色变化
- **WHEN** 当前字数达到目标字数的90%
- **THEN** 字数统计文本颜色变为橙色
- **WHEN** 当前字数达到或超过目标字数
- **THEN** 字数统计文本颜色变为绿色

### Requirement: 操作按钮重新布局
系统 SHALL 对剩余操作按钮进行重新布局与美化。

#### Scenario: 按钮网格布局
- **WHEN** 移除冗余按钮后
- **THEN** 剩余按钮采用弹性布局(flexbox)或网格布局(grid)
- **THEN** 按钮间距保持8-12px
- **THEN** 视觉层级清晰（主要操作按钮使用primary类型）

## MODIFIED Requirements

### Requirement: 大纲生成配置面板
The system SHALL 简化创作配置面板，移除低使用率的模型参数配置。

#### Modified Configuration Panel Structure
- 保留：资源选择面板（世界书、角色卡、用户人设）
- 保留：创作参数面板（创意描述、小说类型、叙事视角、写作风格、目标字数、章节数量、是否包含结局、额外要求、禁止内容）
- 移除：模型参数面板（temperature、maxTokens等滑块调节）
- 模型配置使用全局AI引擎设置中的默认值

### Requirement: 章节状态枚举
The system SHALL 扩展ChapterStatus枚举以支持更细粒度的状态追踪。

#### Modified ChapterStatus Enum
原枚举值：
- PENDING = 'pending'
- GENERATING = 'generating'
- COMPLETED = 'completed'
- FAILED = 'failed'

新增枚举值：
- GENERATED = 'generated'（已生成但未检查）
- CHECKED = 'checked'（已进行剧情检查）
- FIXED = 'fixed'（已完成修复）
- ORGANIZED = 'organized'（已整理为剧情表格）

### Requirement: WritingConfig类型
The system SHALL 简化WritingConfig类型，移除或可选化modelConfig字段。

#### Modified WritingConfig
- modelConfig字段变为可选（用于兼容已有项目数据）
- 新增chainOfThought字段用于存储思维链数据（可选）

## REMOVED Requirements

### Requirement: 模型参数配置面板
**Reason**: 使用率低于0.5%，增加用户认知负担，模型参数应在全局AI引擎设置中统一配置
**Migration**: 已有项目中保存的modelConfig数据保持兼容但不再展示编辑

### Requirement: 手动创建大纲功能
**Reason**: 使用率低于0.5%，核心流程为AI生成大纲
**Migration**: ManualOutlineEditor组件保留为独立工具，但不再从WritingConfigPanel入口访问

### Requirement: 内容创作界面低使用率按钮
**Reason**: 使用率均低于1%，界面过于杂乱
**Removed buttons**:
- "分解"按钮及文本分割功能
- "合并"按钮及内容合并功能
- "AI历史"按钮及历史记录查看面板
- "版本"按钮及版本控制相关功能
- "关闭面板"按钮及面板隐藏逻辑
- "调整参数"按钮及参数调节界面
**Migration**: 相关功能代码保留但不再在主界面展示，可通过快捷方式或后续按需恢复
