# 手动大纲编辑功能规格

## Why

当前写作模式仅支持AI自动生成大纲，用户无法手动创建和编辑大纲。需要提供完整的手动大纲创建与编辑功能，让用户能够灵活地组织章节结构、调整内容，满足个性化创作需求。

## What Changes

- 新增手动大纲创建界面，支持从零开始构建大纲
- 新增章节管理功能：添加、删除、调整顺序、合并与拆分
- 支持子章节层级结构（最多二级嵌套）
- 提供章节属性编辑面板：名称、预估字数、剧情梗概、章节类型、重要程度
- 实现实时自动保存机制
- 添加操作撤销/重做功能（至少支持20步历史）
- 增强现有OutlineEditor组件，整合手动编辑与AI生成两种模式
- 新增手动大纲模式下的数据流与状态管理

## Impact

- Affected specs: `creative-writing-mode` (扩展)
- Affected code:
  - `src/renderer/components/Creative/WritingMode/OutlineEditor.tsx` - 大幅增强
  - `src/renderer/components/Creative/WritingMode/ManualOutlineEditor.tsx` - 新增
  - `src/renderer/stores/writingProjectStore.ts` - 扩展状态管理
  - `src/shared/types/writing.types.ts` - 扩展类型定义
  - `src/main/ipc/handlers/writingHandlers.ts` - 新增大纲保存/更新处理器
  - `src/main/services/WritingStorageService.ts` - 扩展现有存储逻辑

## ADDED Requirements

### Requirement: 手动大纲创建
系统 SHALL 提供手动创建大纲的功能入口，用户可从空白开始构建大纲结构。

#### Scenario: 用户开始手动创建大纲
- **WHEN** 用户在写作模式中选择"手动创建大纲"
- **THEN** 系统显示空白大纲编辑器，包含"添加章节"按钮和章节列表区域

### Requirement: 添加章节（含子章节）
系统 SHALL 支持添加章节和子章节，最多支持两级嵌套结构。

#### Scenario: 添加顶级章节
- **WHEN** 用户点击"添加章节"按钮
- **THEN** 系统在章节列表末尾添加新章节，默认名称为"第X章"，并自动进入编辑状态

#### Scenario: 添加子章节
- **WHEN** 用户在章节上点击"添加子章节"
- **THEN** 系统在该章节下添加子章节，支持最多二级层级

### Requirement: 编辑章节属性
系统 SHALL 提供章节属性编辑面板，支持编辑以下属性：
- 章节名称（必填，最多100字符）
- 预估字数（可选，数字输入，范围100-50000）
- 主要剧情梗概（可选，多行文本，最多2000字符）
- 章节类型（枚举：主线剧情、支线剧情、过渡章节、高潮章节、结尾章节）
- 重要程度标记（枚举：低、中、高、关键，使用颜色标识）

#### Scenario: 编辑章节名称
- **WHEN** 用户修改章节名称并离开输入框
- **THEN** 系统自动保存修改，显示成功提示（1秒后消失）

#### Scenario: 输入验证
- **WHEN** 用户输入超出限制的字符或非法值
- **THEN** 系统显示验证错误提示，阻止保存

### Requirement: 章节顺序调整
系统 SHALL 支持拖拽调整章节顺序，章节可在同级内自由移动。

#### Scenario: 拖拽调整顺序
- **WHEN** 用户拖拽章节到新位置并释放
- **THEN** 系统更新章节顺序，自动保存，提供撤销选项

### Requirement: 删除章节
系统 SHALL 支持删除章节，删除前需确认（若章节已有内容）。

#### Scenario: 删除空章节
- **WHEN** 用户点击删除空章节
- **THEN** 系统直接删除，提供撤销选项

#### Scenario: 删除有内容的章节
- **WHEN** 用户点击删除已有内容的章节
- **THEN** 系统弹出确认对话框，提示"此章节已有内容，删除后不可恢复（可通过撤销恢复）"

### Requirement: 合并章节
系统 SHALL 支持将两个或多个相邻章节合并为一个章节。

#### Scenario: 合并相邻章节
- **WHEN** 用户选择多个相邻章节并点击"合并"
- **THEN** 系统将选中章节合并为一个章节，保留所有章节内容（用分隔符分隔），新章节名称使用第一个章节的名称

### Requirement: 拆分章节
系统 SHALL 支持将一个章节拆分为两个章节。

#### Scenario: 拆分章节
- **WHEN** 用户在章节编辑界面选择"拆分章节"，并设置拆分点
- **THEN** 系统将章节在指定位置拆分为两个章节，原章节内容保留在前半部分，后半部分创建为新章节

### Requirement: 实时自动保存
系统 SHALL 在每次编辑操作后自动保存大纲变更，用户无需手动触发保存。

#### Scenario: 编辑后自动保存
- **WHEN** 用户完成任何编辑操作（添加、删除、修改、排序、合并、拆分）
- **THEN** 系统在500ms内自动保存至本地存储

### Requirement: 撤销/重做功能
系统 SHALL 提供撤销（Undo）和重做（Redo）功能，至少支持20步操作历史。

#### Scenario: 撤销操作
- **WHEN** 用户按下 Ctrl+Z 或点击撤销按钮
- **THEN** 系统撤销上一步操作，恢复至之前状态

#### Scenario: 重做操作
- **WHEN** 用户按下 Ctrl+Y 或点击重做按钮
- **THEN** 系统重做已撤销的操作

#### Scenario: 撤销历史限制
- **WHEN** 用户操作超过20步
- **THEN** 系统保留最近20步操作，最早的操作从历史中移除

### Requirement: 大纲管理界面
系统 SHALL 提供直观的大纲管理界面，包含以下区域：
- 左侧：章节树形列表（支持展开/折叠子章节）
- 中间：章节属性编辑面板
- 顶部：工具栏（添加章节、撤销、重做、导出、切换AI/手动模式）
- 右侧（可选）：章节预览面板

#### Scenario: 章节树显示
- **WHEN** 用户打开大纲编辑器
- **THEN** 系统以树形结构显示所有章节，支持展开/折叠子章节，显示章节类型和重要程度的颜色标识

### Requirement: AI生成与手动编辑模式切换
系统 SHALL 支持在AI生成大纲和手动编辑大纲之间切换，切换时保留现有大纲内容。

#### Scenario: 从AI生成切换到手动编辑
- **WHEN** 用户在AI生成的大纲上切换到手动编辑模式
- **THEN** 系统保留AI生成的大纲内容，允许用户手动修改

#### Scenario: 从手动编辑切换到AI生成
- **WHEN** 用户在手动编辑的大纲上切换到AI生成模式
- **THEN** 系统提示"AI生成将覆盖当前手动大纲，是否继续？"

## MODIFIED Requirements

### Requirement: OutlineEditor 组件扩展
现有 OutlineEditor 组件 SHALL 扩展支持手动编辑模式，整合以下功能：
- 添加"AI生成"和"手动编辑"模式切换标签
- 在手动编辑模式下显示章节管理界面
- 保持AI生成模式的现有功能不变

### Requirement: writingProjectStore 扩展
writingProjectStore SHALL 扩展以支持：
- 大纲版本历史（用于撤销/重做）
- 手动大纲操作的action（addChapter、deleteChapter、moveChapter、mergeChapters、splitChapter）
- 自动保存节流机制

### Requirement: WritingStorageService 扩展
WritingStorageService SHALL 扩展支持：
- 大纲增量更新（仅保存变更部分）
- 大纲版本快照存储（用于长期恢复）

## REMOVED Requirements

无移除需求。现有AI生成大纲功能保持不变，新增手动编辑功能作为补充。
