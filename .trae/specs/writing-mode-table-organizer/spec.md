# 写作模式表格整理功能重构 Spec

## Why
当前写作模式中的"表格整理"按钮打开的是旧的分片检查功能（原剧情检查重构后的残留），功能表现与预期不符。用户需要的是与聊天模式中已实现的记忆表格整理功能完全一致的体验，用于在写作过程中管理项目的记忆表格（角色、时空、物品、事件等信息追踪），而非剧情检查结果展示。

## What Changes
- 将"表格整理"按钮的行为从打开旧的分片检查弹窗改为打开记忆表格预览弹窗
- 在写作模式中集成记忆表格功能（启用/配置/预览），与聊天模式的 MemoryTablePanel + TablePreviewModal 保持一致
- 支持按项目 ID 隔离表格数据，每个写作项目拥有独立的记忆表格
- 支持关联表格模板、启用/禁用表格整理、同步/异步整理模式
- 表格预览弹窗复用 TablePreviewModal 组件或创建对等组件
- **BREAKING**: 旧的 ChunkedCheckPanel（分片检查）仍可通过其他入口访问（如剧情检查），但"表格整理"按钮不再打开它

## Impact
- Affected specs: refactor-chunked-check-to-table（需要回滚该 spec 中对"表格整理"按钮的修改）
- Affected code:
  - `src/renderer/components/Creative/WritingMode/ContentWorkspace.tsx` - 修改"表格整理"按钮行为
  - `src/renderer/components/Creative/WritingMode/` - 新增 MemoryTablePanel 组件
  - `src/renderer/components/Creative/WritingMode/` - 新增 WritingTablePreviewModal 组件
  - `src/main/services/writing/` - 新增写作模式表格数据存储服务
  - `src/main/ipc/handlers/writingHandlers.ts` - 新增表格数据 IPC handler
  - `src/main/ipc/writing.ipc.ts` - 新增表格相关 IPC 通道
  - `src/shared/types/writing.types.ts` - 新增表格相关类型
  - `src/renderer/types/writing.ts` - 新增写作模式表格 API 类型

## ADDED Requirements

### Requirement: 写作模式记忆表格配置面板
系统 SHALL 在写作模式侧边栏或配置面板中提供记忆表格设置功能。

#### Scenario: 配置记忆表格
- **WHEN** 用户进入写作模式
- **THEN** 系统提供记忆表格配置面板，包含：
  - 是否启用记忆表格功能（开关）
  - 是否实时整理表格（开关）
  - 整理模式选择（同步/异步）
  - 关联模板按钮
  - 预览表格按钮

### Requirement: 写作模式表格数据存储
系统 SHALL 按项目 ID 隔离存储写作模式的记忆表格数据。

#### Scenario: 按项目存储表格
- **WHEN** 用户为写作项目启用记忆表格功能
- **THEN** 系统将表格数据存储在 `data/writing-projects/{projectId}/tables/` 目录下
- **THEN** 每个项目的表格数据独立管理，互不干扰

### Requirement: 写作模式表格预览弹窗
系统 SHALL 提供与聊天模式一致的表格预览弹窗。

#### Scenario: 预览表格
- **WHEN** 用户点击"预览表格"按钮
- **THEN** 系统弹出表格预览弹窗，展示当前项目关联的所有表格数据
- **THEN** 支持多 Sheet 切换（Tabs）
- **THEN** 支持单元格编辑并自动同步到存储
- **THEN** 支持导出 CSV、清空表格、保存修改等操作

### Requirement: 写作模式表格整理
系统 SHALL 支持对写作项目的章节内容进行表格整理。

#### Scenario: 同步整理
- **WHEN** 用户启用同步整理模式
- **THEN** 系统对当前章节内容发起 AI 整理请求
- **THEN** 整理结果更新到项目表格数据中

#### Scenario: 异步整理
- **WHEN** 用户启用异步整理模式
- **THEN** 系统在章节生成时注入整理指令
- **THEN** 解析 AI 返回的 tableEdit 命令并执行

## MODIFIED Requirements

### Requirement: ContentWorkspace 表格整理按钮
**修改原因**: 当前按钮打开的是分片检查弹窗，需要改为记忆表格功能入口

```
修改 ContentWorkspace 中的"表格整理"按钮:
- 点击后打开记忆表格预览弹窗（类似聊天模式的 TablePreviewModal）
- 弹窗以项目 ID 为 key 加载表格数据
- 弹窗包含完整的表格管理功能（编辑、导出、清空、同步）
```

### Requirement: refector-chunked-check-to-table spec
**修改原因**: 该 spec 错误地将"分片检查"改名为"表格整理"，需要回滚

```
回滚 refactor-chunked-check-to-table spec 中的修改:
- ContentWorkspace 中的按钮名称从"表格整理"改回"分片检查"
- ChunkedCheckPanel 的 Modal 标题从"表格整理"改回"分片检查"
- Modal 宽度从 1200px 改回 900px
- Collapse 组件恢复（原样恢复）
```

## REMOVED Requirements

### Requirement: 分片检查改名为表格整理
**Reason**: 概念混淆，分片检查是剧情检查的分片执行版本，与记忆表格整理是完全不同的功能
**Migration**: 分片检查恢复原名，表格整理功能作为独立的记忆表格功能实现
