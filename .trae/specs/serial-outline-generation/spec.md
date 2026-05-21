# 连载式大纲生成增强 Spec

## Why
当前新建创作项目生成大纲时，系统始终生成完整包含结局的大纲，无法满足多段连载式小说的分阶段编写需求。用户需要控制大纲是否包含结局，以及支持分阶段（指定章节范围）生成大纲，以适应连载小说的实际创作流程。

## What Changes
- **新增"是否包含结局"复选框**：在创作配置表单中添加控制开关
- **新增章节范围选择功能**：允许用户指定生成指定范围的章节大纲
- **修改大纲生成 Prompt 构建逻辑**：根据配置动态调整生成指令
- **修改 OutlineGenerator 服务**：支持章节范围参数和未完结标记
- **更新类型定义**：在 WritingParameters 中添加新字段

## Impact
- Affected specs: 创意中心写作模式、大纲生成流程
- Affected code: 
  - `src/shared/types/writing.types.ts` - 类型定义
  - `src/main/services/writing/OutlineGenerator.ts` - 大纲生成核心逻辑
  - `src/main/services/writing/PromptBuilder.ts` - Prompt 构建
  - `src/renderer/components/Creative/WritingMode/WritingConfigPanel.tsx` - 配置面板 UI
  - `src/renderer/components/Creative/WritingMode/WritingConfigModal.tsx` - 配置模态框 UI
  - `src/main/ipc/handlers/writingHandlers.ts` - IPC 处理

## ADDED Requirements

### Requirement: 是否包含结局选项
系统 SHALL 在创作配置表单中提供"是否包含结局"复选框选项。
- 勾选时：生成包含完整结局章节的完整大纲
- 未勾选时：生成的大纲明确标识为"未完结"状态，不包含结局章节，storyArc 中的 resolution 字段标记为"待定"

#### Scenario: 勾选包含结局
- **WHEN** 用户在新建项目时勾选"是否包含结局"
- **THEN** 生成的大纲包含完整的故事弧线（起承转合），最后一章为结局章

#### Scenario: 未勾选包含结局
- **WHEN** 用户在新建项目时未勾选"是否包含结局"
- **THEN** 生成的大纲在 WorkInfo 中标记 `isComplete: false`，不生成结局章节，故事弧线中 resolution 为"待定"

### Requirement: 章节范围选择功能
系统 SHALL 在创作配置中提供章节范围选择，允许用户指定生成指定范围的章节大纲。

#### Scenario: 生成全部章节
- **WHEN** 用户未指定章节范围或选择"全部章节"
- **THEN** 系统根据配置的总章节数生成所有章节的大纲

#### Scenario: 生成指定范围章节
- **WHEN** 用户指定生成"第3章至第10章"的大纲
- **THEN** 系统仅生成第3章至第10章的大纲内容，其他章节不生成

### Requirement: 大纲未完结标识
GeneratedOutline 和 WorkInfo SHALL 包含完结状态标识字段，用于区分完整大纲和连载大纲。

## MODIFIED Requirements

### Requirement: WritingParameters 类型定义
WritingParameters 接口 SHALL 添加以下可选字段：
- `includeEnding: boolean` - 是否包含结局，默认 true
- `chapterRangeStart?: number` - 大纲生成的起始章节号，默认 1
- `chapterRangeEnd?: number` - 大纲生成的结束章节号，默认等于 chapterCount

### Requirement: 大纲生成 Prompt
PromptBuilder 在构建大纲生成 Prompt 时，SHALL 根据 includeEnding 参数动态调整指令：
- 当 includeEnding 为 false 时，在 Prompt 中明确指示"不生成结局章节，故事在发展中"
- 当指定了 chapterRangeStart/chapterRangeEnd 时，Prompt 中明确说明生成的章节范围

### Requirement: 大纲确认流程
OutlineEditor 中 SHALL 根据 isComplete 状态显示不同的完结标识，连载大纲在 UI 上明确标注"未完结"状态。

## REMOVED Requirements
无
