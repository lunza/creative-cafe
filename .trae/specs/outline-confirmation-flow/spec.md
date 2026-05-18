# 大纲确认后流程修复 Spec

## Why
大纲生成并成功解析后（日志显示 "JSON parsed successfully"），用户点击"确认大纲"后没有进入内容生成页面，系统既未展示任何页面也未提供章节创作入口。经分析，根本原因是 `WritingModeView` 枚举中缺少 `CONTENT_GENERATION` 视图，导致 OutlineEditor 的 `onConfirm` 回调设置的视图值在 `WritingModeEntry` 的 switch 语句中无对应分支，返回空内容。

## What Changes
- **新增 `CONTENT_GENERATION` 视图**：在 `WritingModeView` 枚举和 `WritingModeEntry` 渲染逻辑中添加内容生成视图
- **修复 OutlineEditor onConfirm 回调**：确保"确认大纲"后触发视图切换，正确更新项目状态为 IN_PROGRESS
- **优化项目创建时机**：大纲生成后仅保存到 store，在 OutlineEditor 中"确认大纲"时才创建正式项目

## Impact
- Affected specs: 大纲交互流程、内容生成入口、视图管理
- Affected code: `WritingModeEntry.tsx`、`WritingConfigPanel.tsx`、`OutlineEditor.tsx`、`writing.types.ts`、`writingProjectStore.ts`

## ADDED Requirements

### Requirement: 大纲确认后视图切换
大纲编辑页面中用户点击"确认大纲"后，系统 SHALL 切换到内容生成页面（Content Workspace），展示章节列表和内容编辑区域，并将项目状态更新为 IN_PROGRESS。

#### Scenario: 大纲确认成功
- **WHEN** 用户在大纲编辑页面点击"确认大纲"按钮
- **THEN** 系统创建 WritingProject（如未创建），初始化章节数据，更新状态为 IN_PROGRESS，并切换到 CONTENT_GENERATION 视图

### Requirement: CONTENT_GENERATION 视图渲染
WritingModeEntry SHALL 根据 WritingModeView 枚举渲染对应的视图组件，CONTENT_GENERATION 视图对应 ContentWorkspace 组件。

#### Scenario: 进入内容生成页面
- **WHEN** 当前视图设置为 `WritingModeView.CONTENT_GENERATION`
- **THEN** 渲染 ContentWorkspace 组件，传入 outline、projectId 和回调函数

## MODIFIED Requirements

### Requirement: OutlineEditor onConfirm 回调
OutlineEditor 的 onConfirm 回调 SHALL 触发项目创建和视图切换。当前实现仅调用 `onConfirm` 回调（在 WritingModeEntry 中设置 view 为 `WritingModeView.CONTENT_GENERATION`），但需在回调中确保项目已正确创建和状态已更新。

### Requirement: 大纲生成后项目创建时机
大纲生成成功后的项目创建 SHALL 在 WritingConfigPanel 中保持现有逻辑（生成后立即创建），以便 outlineRaw 等数据能正确关联到项目。大纲确认后更新项目状态为 IN_PROGRESS。

## REMOVED Requirements
无

## ADDED Requirements（对照 PRD 的缺失项清单）

以下列出当前实现与 PRD 需求文档的所有差异：

### 缺失模块 1：大纲确认后页面空白
**PRD 4.1 流程要求**：点击"确认大纲"后进入内容生成页
**当前实现**：`WritingModeView` 枚举缺少 `CONTENT_GENERATION`，`WritingModeEntry` switch 无对应 case，返回空内容
**影响**：用户点击"确认大纲"后页面空白

### 缺失模块 2：项目状态流转
**PRD 3.5.1 项目状态要求**：项目状态包含"大纲阶段/创作中/已完成"
**当前实现**：createProject 时设置 ProjectStatus.OUTLINING，但大纲确认后未更新为 IN_PROGRESS
**影响**：项目状态不准确

### 缺失模块 3：大纲生成中独立加载视图
**PRD 4.1 流程要求**：大纲生成中应显示加载视图（加载动画、进度提示、取消按钮）
**当前实现**：在 WritingConfigPanel 中通过 isGenerating 状态显示流式输出文本框，无独立 Loading 视图页
**影响**：用户点击"生成大纲"后仍在原配置页面，无明确的生成进度指示

### 缺失模块 4：大纲编辑页 Header 栏和底部状态栏
**PRD 4.3 界面布局要求**：Header 显示"写作模式 | 项目名称 | [保存] [导出] [设置]"，Footer 显示"Token 使用量 | 模型信息 | 状态指示"
**当前实现**：无 Header 和 Footer
**影响**：缺少全局操作入口和状态信息

### 缺失模块 5：侧边栏资源面板
**PRD 4.3 界面布局要求**：侧边栏包含"资源"区域（世界书、角色卡）和"大纲"章节列表
**当前实现**：OutlineEditor 和 ContentWorkspace 均无侧边栏资源展示
**影响**：无法快速访问创作资源
