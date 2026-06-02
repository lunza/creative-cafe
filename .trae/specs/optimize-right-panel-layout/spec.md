# 优化辅助面板功能布局 Spec

## Why
当前辅助面板中包含未完全实现的"AI助手"和"预览"页签，且"剧情检查"和"表格整理"功能以独立弹窗形式存在，遮挡编辑区域并造成交互中断。需要重组面板布局，移除无效功能，将核心工具迁移至面板内，提升编辑效率。

## What Changes
- **移除**辅助面板中的"AI助手"和"预览"两个空壳页签
- **保留**并优化"素材库"页签
- **新增**"剧情检查"页签 - 将原弹窗形式的剧情检查报告迁移至面板内
- **新增**"表格整理"页签 - 将原弹窗形式的表格预览迁移至面板内
- **更新**writingModeUIStore 中的 RightPanelTab 枚举，反映新的页签结构
- 所有面板页签共享编辑器实时内容引用，解决快照导致的数据不一致问题

## Impact
- Affected specs: 写作模式辅助面板、剧情检查功能、表格整理功能
- Affected code:
  - `src/renderer/components/Creative/WritingMode/WritingModeRightPanel.tsx`
  - `src/renderer/stores/writingModeUIStore.ts`
  - `src/renderer/components/Creative/WritingMode/ContentWorkspace.tsx`
  - `src/renderer/components/Creative/WritingMode/PlotCheckReportModal.tsx`

## MODIFIED Requirements
### Requirement: 辅助面板页签结构
辅助面板 SHALL 提供三个常驻功能页签：素材库、剧情检查、表格整理。素材库页签 SHALL 包含世界书、角色卡、用户人设、知识库、写作风格五个子分类。

### Requirement: 剧情检查面板联动
剧情检查页签 SHALL 直接展示当前章节的剧情检查结果，无需弹窗。用户点击剧情检查按钮时，辅助面板自动切换到剧情检查页签。

### Requirement: 表格整理面板联动
表格整理页签 SHALL 直接展示当前章节的表格数据，无需弹窗。用户点击表格整理按钮时，辅助面板自动切换到表格整理页签。

### Requirement: 实时内容同步
所有面板功能 SHALL 使用编辑器实时内容引用（editorContentRef），避免使用内容快照。
