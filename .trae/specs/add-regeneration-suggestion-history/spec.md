# 重新生成建议累积与智能整合 Spec

## Why

当前系统虽然支持持久化章节创作指导（`generationGuidance`），但每次提交新建议时会覆盖旧建议，导致历史反馈丢失。用户在多章节写作过程中反复指出的问题（如"对话太少"、"节奏过快"）无法被系统累积和强化，AI 在后续章节中容易重复犯同样的错误。需要一个建议累积机制，让 AI 的理解随反馈增多而不断深化。

## What Changes

- 在 `ChapterOutline` 类型中新增 `suggestionHistory` 字段，存储每次重新生成时用户提交的建议列表（含时间戳和来源章节索引）
- 在 `WorkInfo` 或项目级别新增 `consolidatedSuggestions` 字段，存储 AI 整合后的综合建议
- 在重新生成建议面板（`RegenerationSuggestionModal`）中新增"建议整理"按钮，触发 AI 对所有历史建议进行智能合并
- 修改 `ContentGenerator.buildPrompt`，将综合建议自动注入到所有章节的生成提示词中
- 每次重新生成时自动将用户建议追加到 `suggestionHistory`，不再覆盖

## Impact

- Affected specs: `persist-chapter-guidance-suggestion`（功能增强）、`add-generation-suggestion-panel`（交互增强）
- Affected code:
  - `writing.types.ts` — `ChapterOutline` 新增 `suggestionHistory` 字段；项目级别新增 `consolidatedSuggestions`
  - `RegenerationSuggestionModal.tsx` — 新增"建议整理"按钮及交互
  - `ContentWorkspace.tsx` — 处理建议追加、触发 AI 整合、传递综合建议
  - `ContentGenerator.ts` — 提示词构建注入综合建议
  - `useChapterGeneration.ts` — 传递综合建议到 IPC 请求
  - `WritingStorageService.ts` — 确保新字段的持久化
  - 新增 IPC handler 或复用现有 AI 调用接口实现建议整合

## ADDED Requirements

### Requirement: 建议历史记录持久化
系统 SHALL 在每次重新生成时自动将用户提交的结构化建议追加到当前章节的 `suggestionHistory` 数组中，而非覆盖已有记录。

#### Scenario: 用户提交重新生成建议
- **WHEN** 用户在重新生成建议面板中填写内容并提交
- **THEN** 系统将本次建议（含 `keepContent`、`discardContent`、`adjustContent`、`addContent`）连同时间戳和章节索引追加到该章节的 `suggestionHistory` 数组
- **THEN** 触发项目保存，确保建议历史写入 `project.json`

#### Scenario: 多次重新生成同一章节
- **WHEN** 用户对同一章节执行多次重新生成，每次提交不同建议
- **THEN** `suggestionHistory` 数组按时间顺序包含所有历史建议记录
- **THEN** 每条记录包含时间戳和建议内容，可追溯建议演进过程

#### Scenario: 跨章节建议累积
- **WHEN** 用户在不同章节的重新生成中分别提交建议
- **THEN** 每个章节各自维护独立的 `suggestionHistory`
- **THEN** 所有建议均可被"建议整理"功能读取和整合

### Requirement: 建议整理功能
系统 SHALL 提供"建议整理"按钮，点击后触发 AI 对所有历史建议进行智能合并与优化，生成结构化、简洁且全面的综合建议。

#### Scenario: 用户点击建议整理按钮
- **WHEN** 用户点击重新生成建议面板中的"建议整理"按钮
- **THEN** 系统收集所有章节的 `suggestionHistory` 记录
- **THEN** 调用 AI 对所有历史建议进行智能分析，识别共性问题和核心诉求
- **THEN** 生成结构化的综合建议（`consolidatedSuggestions`），包含：
  1. 用户反复强调的核心问题
  2. 各章节个性化建议的归纳总结
  3. 明确的改进方向和约束条件
- **THEN** 将综合建议保存到项目级别，触发保存

#### Scenario: 无历史建议时点击建议整理
- **WHEN** 用户点击"建议整理"但 `suggestionHistory` 为空（没有任何重新生成建议记录）
- **THEN** 系统提示"暂无历史建议可供整理，请先在重新生成时提交建议"

#### Scenario: 建议整理进行中
- **WHEN** AI 正在整合建议
- **THEN** 按钮显示 loading 状态，禁用重复点击
- **THEN** 整合完成后显示成功提示

#### Scenario: 重复点击建议整理
- **WHEN** 用户在已有综合建议的基础上再次点击"建议整理"
- **THEN** 系统重新整合所有历史建议，覆盖原有的 `consolidatedSuggestions`

### Requirement: 综合建议自动注入生成提示词
系统 SHALL 在所有章节的生成和重新生成操作中，自动将 `consolidatedSuggestions` 作为重要参考注入到提示词中。

#### Scenario: 生成新章节时存在综合建议
- **WHEN** 用户生成某章节且项目存在 `consolidatedSuggestions`
- **THEN** 系统将综合建议作为 `## 综合创作要求` 拼接到提示词中
- **THEN** 综合建议位于基础提示词之后、章节特定指导之前

#### Scenario: 重新生成章节时存在综合建议
- **WHEN** 用户重新生成某章节且项目存在 `consolidatedSuggestions`
- **THEN** 综合建议同样被注入到提示词中
- **THEN** 综合建议与本次重新生成指令共同作用，确保 AI 既遵循全局要求又响应本次调整

#### Scenario: 无综合建议
- **WHEN** 项目不存在 `consolidatedSuggestions`
- **THEN** 提示词构建行为与现有逻辑一致，不受影响

### Requirement: 错误预防与需求迭代
系统 SHALL 通过持续累积和应用用户建议，使 AI 能够识别并避免重复出现之前已被指出的问题。

#### Scenario: 用户反复指出同类问题
- **WHEN** 用户在多个章节中反复指出类似问题（如"对话生硬"）
- **THEN** AI 整合后的综合建议中将该问题标记为高优先级
- **THEN** 后续章节生成时，提示词中明确强调避免该问题

#### Scenario: 综合建议随反馈深化
- **WHEN** 用户累积的建议越来越多
- **THEN** 综合建议的内容更加具体和有针对性
- **THEN** AI 对用户诉求的理解逐步深化，生成内容的准确性持续提升

### Requirement: 建议历史查看与管理
系统 SHALL 允许用户查看各章节的建议历史，并提供清空历史的能力。

#### Scenario: 查看建议历史
- **WHEN** 用户打开重新生成建议面板
- **THEN** 面板中显示当前章节的建议历史条数
- **THEN** 提供展开查看历史详情的能力

#### Scenario: 查看综合建议
- **WHEN** 项目存在 `consolidatedSuggestions`
- **THEN** 面板中显示当前综合建议内容，支持用户查看

#### Scenario: 清空建议历史
- **WHEN** 用户选择清空某章节的建议历史
- **THEN** 系统清除该章节的 `suggestionHistory`
- **THEN** 提示用户是否需要重新整合综合建议

## MODIFIED Requirements

### Requirement: 重新生成建议面板交互
`RegenerationSuggestionModal` SHALL 在现有四字段输入基础上新增"建议整理"按钮和建议历史展示区域。

#### Modified RegenerationSuggestionModal
- 新增"建议整理"按钮，触发 AI 整合所有历史建议
- 新增可折叠区域展示当前综合建议（`consolidatedSuggestions`）
- 新增当前章节建议历史条数显示
- 提交重新生成时，自动追加本次建议到 `suggestionHistory`

### Requirement: 提示词构建逻辑
`ContentGenerator.buildPrompt` SHALL 在构建提示词时注入 `consolidatedSuggestions`。

#### Modified Prompt Building
在 `buildPrompt` 方法中：
1. 首先检查 `request.consolidatedSuggestions`（综合建议）
2. 若存在，将其作为 `## 综合创作要求` 拼接到提示词
3. 然后是 `generationGuidance`（章节特定指导）
4. 然后是 `userSuggestion`（即时建议）
5. 最后是 `regenerationSuggestion`（重新生成指令）

### Requirement: ContentWorkspace 集成
`ContentWorkspace` SHALL 在重新生成提交时自动追加建议到历史记录，并管理综合建议的传递。

#### Modified ContentWorkspace
- `handleRegenerationSubmit` 中追加本次建议到 `suggestionHistory` 并保存
- 传递 `consolidatedSuggestions` 到 `useChapterGeneration` hook
- 处理"建议整理"按钮的点击事件，调用 AI 整合接口

## REMOVED Requirements

无。本功能是对现有建议系统的增强，不移除任何现有功能。
