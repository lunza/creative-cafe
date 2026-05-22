# 写作模式全面修复与重构规范

## Why

写作模式已完成初步开发，但经过全面审查发现存在多处bug和设计不合理问题，涉及数据持久化、大纲管理、章节索引、AI交互流程、用户体验、UI样式呈现、主题适配及日志记录等核心模块。需要系统性修复所有bug并重构设计不合理的功能模块。

## What Changes

- 修复数据持久化机制中的数据覆盖风险和自动保存不一致问题
- 修复大纲历史记录逻辑缺陷和更新完整性问题
- 修复章节索引处理异常和内容更新不完整问题
- 修复AI流处理健壮性和日志记录不完整问题
- 修复UI样式一致性和主题适配问题
- 修复章节合并/拆分后索引重新排序逻辑
- 优化日志系统确保AI请求响应完整记录到ai-handler.log
- 重构设计不合理的交互流程，提升易用性
- 优化代码结构和逻辑实现，提升可维护性

## Impact

- Affected specs: creative-writing-mode, fix-chapter-merge-logic, writing-mode-ui-redesign, manual-outline-editing, serial-outline-generation, outline-confirmation-flow
- Affected code:
  - `src/main/services/WritingStorageService.ts` - 数据持久化
  - `src/main/services/writing/ContentGenerator.ts` - AI流处理
  - `src/main/services/writing/OutlineGenerator.ts` - 大纲生成
  - `src/main/services/writing/PromptBuilder.ts` - Prompt构建
  - `src/main/ipc/handlers/writingHandlers.ts` - IPC处理器
  - `src/renderer/stores/writingModeStore.ts` - 写作模式状态
  - `src/renderer/stores/writingProjectStore.ts` - 项目管理状态
  - `src/renderer/stores/writingModeUIStore.ts` - UI状态
  - `src/renderer/components/Creative/WritingMode/ContentWorkspace.tsx` - 内容工作区
  - `src/renderer/components/Creative/WritingMode/OutlineEditor.tsx` - 大纲编辑器
  - `src/renderer/components/Creative/WritingMode/WritingModeEntry.tsx` - 入口组件
  - `src/renderer/components/Creative/WritingMode/WritingConfigPanel.tsx` - 配置面板
  - `src/renderer/components/Creative/WritingMode/WritingConfigModal.tsx` - 配置模态框
  - `src/renderer/components/Creative/WritingMode/ManualOutlineEditor.tsx` - 手动大纲编辑器
  - `src/renderer/components/Creative/WritingMode/WritingModeRightPanel.tsx` - 右侧面板
  - `src/shared/types/writing.types.ts` - 类型定义
  - `src/shared/constants/writing.constants.ts` - 常量定义

## ADDED Requirements

### Requirement: 完整的AI日志记录
系统必须将所有AI相关的请求和响应内容通过aiHandler.ts服务完整存储到本地ai-handler.log文件中，包括prompt、model参数、温度设置、完整响应内容、错误信息等。

#### Scenario: AI大纲生成日志
- **WHEN** 用户触发大纲生成
- **THEN** ai-handler.log中记录完整的请求参数（prompt、model、temperature、maxTokens等）和完整的AI响应内容

#### Scenario: AI章节生成日志
- **WHEN** 用户触发生成章节内容
- **THEN** ai-handler.log中记录完整的请求参数和流式响应累积后的完整内容

### Requirement: 数据持久化完整性
数据保存必须采用安全的事务性机制，确保数据不会因保存异常而丢失或损坏。

#### Scenario: 项目保存
- **WHEN** 保存项目
- **THEN** 先写入临时文件，成功后再替换原文件，确保保存失败时原数据不丢失

#### Scenario: 章节自动保存
- **WHEN** 章节内容发生变化
- **THEN** 自动保存必须同步更新项目元数据（字数统计、完成章节数等）

### Requirement: 章节索引一致性
章节拆分和合并后，所有章节的索引必须正确重新排序，确保导航和定位准确。

#### Scenario: 合并章节
- **WHEN** 合并多个连续章节
- **THEN** 合并后的章节索引正确，后续章节索引依次递减

#### Scenario: 拆分章节
- **WHEN** 拆分一个章节为多个
- **THEN** 拆分后的章节索引正确，后续章节索引依次递增

## MODIFIED Requirements

### Requirement: 大纲历史记录管理
大纲历史记录必须正确维护，支持完整的撤销/重做操作，历史记录不应丢弃最新状态。

**变更**: 修复pushOutlineHistory逻辑，使用正确的切片方式保留完整历史，添加操作类型和描述记录。

### Requirement: AI流式处理健壮性
AI流式响应处理必须具有完善的错误处理、超时控制和内容完整性校验。

**变更**: 添加流式响应超时机制，完善错误处理逻辑，确保流式内容不丢失。

### Requirement: UI主题适配一致性
所有写作模式组件必须在所有主题模式下显示正常，无布局错乱或样式冲突。

**变更**: 全面使用Ant Design主题变量，替换所有硬编码样式值。

### Requirement: 大纲编辑与状态同步
大纲编辑器必须正确反映编辑状态，拖拽排序、折叠展开等交互操作必须稳定可靠。

**变更**: 完善大纲编辑状态跟踪，添加拖拽排序的边界条件处理。

### Requirement: 配置校验完整性
所有用户输入和AI请求参数必须进行完整的校验，设置合理的默认值和防御性编程。

**变更**: 在IPC处理层添加完整的参数校验，防止异常输入导致服务崩溃。

## REMOVED Requirements

无

### Migration

无
