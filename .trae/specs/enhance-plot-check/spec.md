# 剧情检查功能完善 Spec

## Why
剧情检查功能已完成基础实现，但存在以下缺失需要完善：
1. 逻辑检查机制虽然已在 `PlotCheckerService` 中实现了 AI 辅助检测，但缺乏系统性的规则验证层
2. 分片逐步检查功能未开发，无法对长篇内容按章节/段落逐步检查
3. tableEdit 组件的表格同步功能未完成，表格修改无法实时同步到其他模块

## What Changes
- 增强逻辑检查机制，添加规则验证层（基于已有数据的矛盾检测）
- 实现分片逐步检查功能，支持按章节或自定义分片粒度进行检查
- 完善 tableEdit 表格同步功能，确保表格修改实时同步
- 在 UI 中添加分片检查控制面板

## Impact
- Affected specs: add-logic-validation（扩展）
- Affected code:
  - `src/main/services/writing/PlotCheckerService.ts`（修改 - 增强逻辑验证层）
  - `src/main/services/writing/ChunkedCheckService.ts`（新增 - 分片检查服务）
  - `src/renderer/components/Creative/WritingMode/ChunkedCheckPanel.tsx`（新增 - 分片检查 UI）
  - `src/renderer/components/Creative/WritingMode/ContentWorkspace.tsx`（修改 - 添加分片检查入口）
  - `src/main/ipc/handlers/writingHandlers.ts`（修改 - 新增分片检查 handler）
  - `src/main/preload.ts`（修改 - 暴露新 API）
  - `src/renderer/components/Character/CharacterDialogueChat/TablePreviewModal.tsx`（修改 - 完善表格同步）
  - `src/main/services/memory/tableTemplateService.ts`（修改 - 增强同步机制）

## ADDED Requirements

### Requirement: 分片逐步检查功能
系统SHALL提供分片逐步检查功能，支持：
1. **自动分片**：按章节自动分片
2. **手动分片**：用户自定义分片范围（字数或段落数）
3. **逐步检查**：按顺序逐个分片检查，或指定分片进行检查
4. **进度追踪**：显示检查进度、已完成/待检查分片

#### Scenario: 执行分片检查
- **WHEN** 用户选择分片检查模式并启动检查
- **THEN** 系统按顺序逐个分片执行检查，显示进度条和当前分片信息

### Requirement: 逻辑检查规则验证层
系统SHALL在 AI 辅助检测之外，增加基于已有数据的规则验证层：
1. **实体状态追踪**：追踪物品/角色/地点的状态变化
2. **状态冲突检测**：检测同一实体出现矛盾状态
3. **数量关系验证**：验证数量、金额等数值关系的合理性

#### Scenario: 规则验证发现矛盾
- **WHEN** 系统执行逻辑检查
- **THEN** 先执行规则验证层，再执行 AI 辅助检测

### Requirement: tableEdit 表格同步
系统SHALL确保 tableEdit 表格中的修改能够实时同步：
1. 表格编辑后自动触发同步到持久化存储
2. 同步时广播更新事件，通知其他模块刷新
3. 支持手动触发同步

## MODIFIED Requirements

### Requirement: 剧情检查按钮
在 ContentWorkspace 中，除现有的"剧情检查"和"逻辑记录"按钮外，新增"分片检查"按钮，提供分片逐步检查入口。
