# 世界书详情页 UI 重构 Spec

## Why

世界书详情 Modal（`WorldBookEntryTable.tsx`）当前存在明显易用性缺陷：底部 10 个按钮全部堆叠在 flex-wrap 容器中且几乎全为 `type="primary"`，无视觉层级、长标签换行后拥挤、点击区域不清晰；嵌套滚动混乱（Modal 体固定 75vh + 每卡片内容 200px 内滚动 + 分页控件随内容滚走）；单条目操作按钮散落卡片各处。需要在保持现有美观度（CSS 变量主题体系）的基础上重构布局，使界面既符合视觉设计标准又满足高效操作需求。

## 设计方案比选（用户已选定方案 B）

| 方案 | 思路 | 结论 |
|------|------|------|
| A 保守优化 | 保持整体结构，底部按钮重新分组分区，统一尺寸与层级 | 未选：滚动后仍需回底部找按钮 |
| **B 顶部粘性工具栏** | **核心操作全部移至顶部粘性工具栏，底部精简为保存/关闭/状态摘要，卡片操作行统一** | **✅ 用户已选定** |
| C 紧凑列表+虚拟滚动 | 卡片改可折叠行，虚拟化渲染 | 未选：改动过大，视觉变化剧烈 |

## What Changes

- **新增顶部粘性工具栏**（sticky 于 Modal 滚动区顶部，滚动时始终可见）：
  - 左区：全选复选框（放大点击区）+「已选 N 个条目」计数（计数仅显示一次，不再重复在按钮标签上）
  - 中区·批量操作组：一键翻译 / 一键润色 / 一键审核 / 批量删除；任一批量任务运行时对应按钮变为红色「中断」态；任务互斥禁用逻辑保持现状
  - 右区·管理组：AI 生成关键词 / 整理条目 / 标签管理 / 添加条目；分组间用分隔线区隔
- **精简底部 footer**：保存（唯一 primary）+ 关闭 + 状态摘要（总条目数 / 筛选后条目数）
- **统一按钮规范**：默认尺寸（≥32px 高），短标签 + 图标 + Tooltip 完整说明；视觉层级仅三档（primary=保存、danger=批量删除/中断、default=其余）；移除现有零散 `marginRight` hack
- **单条目卡片操作行统一**：编辑 / 删除 / AI 生成关键词 / 编辑标签 收敛为卡片右上角一行图标按钮（含 Tooltip），替换散落各处的 link/small 按钮
- **内容预览增强**：保留 maxHeight 折叠，新增「展开全部 / 收起」切换
- **滚动体验优化**：
  - Modal 体高度自适应（`min(75vh, calc(100vh - 200px))`），应用全局主题滚动条变量
  - `scroll-behavior: smooth` 平滑滚动
  - 长列表提供「回到顶部」悬浮按钮
  - 分页控件固定于滚动区底部（不随内容滚走）
- **样式收敛**：组件内大量内联 style 迁移至新文件 `WorldBookEntryTable.css`，沿用现有 CSS 变量（`--bg-container` / `--text-primary` / `--border-base` 等），适配 dark/light 双主题

### 明确不做（守卫边界）

- 不改动任何业务逻辑：保存 / 翻译 / 润色 / 审核 / 关键词生成 / 删除等回调函数与 props 签名原样保留
- 不改数据结构、IPC 接口、主进程代码
- 不动 `WorldBookEntryEditor` 等二级编辑 Modal
- 不引入新依赖（虚拟滚动等属方案 C 范畴）

## Impact

- Affected specs: 无直接关联的既有 spec（`enhance-agent-worldbook-content-visibility` 等均非 UI 布局范畴）
- Affected code:
  - `src/renderer/components/WorldBook/WorldBookEntryTable.tsx`（主要重构对象：modalFooter / 工具栏 / 卡片渲染）
  - `src/renderer/components/WorldBook/WorldBookEntryTable.css`（新增）
  - `src/renderer/styles/global.css`（如需补充滚动条/工具栏通用变量，仅增量）

## ADDED Requirements

### Requirement: 顶部粘性工具栏

系统 SHALL 在世界书详情 Modal 滚动区顶部提供粘性工具栏，滚动时始终可见，包含选择区、批量操作组、管理组三个分区，分区之间有视觉分隔。

#### Scenario: 长列表滚动时操作始终可达
- **WHEN** 用户在世界书条目超过一屏时向下滚动
- **THEN** 顶部工具栏保持可见，用户无需回到底部即可发起翻译/润色/审核/删除等批量操作

#### Scenario: 批量任务运行中的中断
- **WHEN** 一键翻译正在运行
- **THEN** 工具栏中翻译按钮变为红色「中断」态，其余批量任务按钮禁用（互斥逻辑与现状一致）

### Requirement: 按钮层级与点击区域

系统 SHALL 为工具栏与卡片内所有按钮提供统一尺寸（高度 ≥32px）、统一间距、短标签 + 图标 + Tooltip，且视觉层级不超过三档（primary / danger / default）。

#### Scenario: 按钮可辨识可点击
- **WHEN** 用户查看工具栏
- **THEN** 「保存」为唯一主按钮（移至底部 footer），批量删除与中断态为 danger 红色，其余为 default；每个按钮点击区域 ≥32×64px，hover 有反馈

### Requirement: 滚动体验

系统 SHALL 提供主题化滚动条、平滑滚动、自适应 Modal 高度，且分页控件固定在滚动区底部不随内容滚走；超过一屏时显示「回到顶部」悬浮按钮。

#### Scenario: 长内容浏览流畅
- **WHEN** 用户浏览 100+ 条目的世界书
- **THEN** 滚动条样式与主题一致（dark/light），滚动平滑，分页始终可见，点击「回到顶部」可平滑返回顶部

### Requirement: 单条目卡片操作行统一

系统 SHALL 将每张条目卡片的编辑 / 删除 / AI 生成关键词 / 编辑标签操作收敛为卡片右上角一行图标按钮，并以 Tooltip 说明完整功能。

#### Scenario: 快速定位单条目操作
- **WHEN** 用户需要在某条目上执行编辑或删除
- **THEN** 无需在卡片内多处寻找，所有操作集中在卡片右上角一行内

### Requirement: 内容预览展开收起

系统 SHALL 保留条目内容折叠预览（maxHeight），并提供「展开全部 / 收起」一键切换。

#### Scenario: 查看长条目全文
- **WHEN** 条目内容超过预览高度
- **THEN** 用户点击「展开全部」可在卡片内完整阅读，点击「收起」恢复折叠

## MODIFIED Requirements

无正式既有需求文档条目（本组件此前无 UI 规格），布局变更按 ADDED 处理。

## REMOVED Requirements

### Requirement: 底部 10 按钮堆叠式 footer
**Reason**: 按钮过多且无层级，拥挤难点击，滚动后不可达。
**Migration**: 全部功能迁移至顶部粘性工具栏（批量/管理组）与精简 footer（保存/关闭），无功能删减。
