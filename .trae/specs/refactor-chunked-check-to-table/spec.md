# 分片检查重构为表格整理 Spec

## Why
当前分片检查功能（ChunkedCheckPanel）使用 Collapse 手风琴组件展示检查结果，用户体验和数据处理效率有限。需要将检查结果展示方式重构为与聊天模式下表格整理功能一致的表格形式，提升用户查看和操作检查结果的体验，支持排序、筛选、分页等交互操作。

## What Changes
- 将 ChunkedCheckPanel 组件重构为使用 Ant Design Table 展示检查结果
- 实现表格数据的实时同步更新机制（与分片检查进度同步）
- 支持表格的排序、筛选、分页等交互操作
- 保持与聊天模式下表格整理功能相同的用户界面风格
- 保留原分片检查功能的核心业务逻辑不变
- 重构仅涉及 UI 展示层，不修改后端服务逻辑

## Impact
- Affected specs: add-plot-check, enhance-plot-check
- Affected code: 
  - `src/renderer/components/Creative/WritingMode/ChunkedCheckPanel.tsx` - 主要修改，UI 组件重构
  - `src/shared/types/writing.types.ts` - 可能需要新增类型定义
  - `src/renderer/styles/table-common.css` - 复用现有表格样式

## MODIFIED Requirements

### Requirement: 分片检查结果展示
**修改原因**: 当前使用 Collapse 手风琴展示分片详情，需要改为表格形式展示

```
修改 ChunkedCheckPanel 组件的分片详情展示区域:
- 将原有的 Collapse 手风琴组件替换为 Ant Design Table
- 表格列包含：分片名称、状态、评分、高危问题数、中等问题数、建议问题数、总问题数
- 支持点击行展开查看详情（使用 expandable 配置）
- 展开区域显示该分片的具体问题列表，也使用表格形式展示
```

### Requirement: 检查结果表格交互
**修改原因**: 当前分片检查结果缺乏排序、筛选、分页等交互功能

```
新增检查结果表格交互功能:
- 排序：支持按评分、问题数量等列进行升序/降序排序
- 筛选：支持按状态（已完成/检查中/失败/待检查）、严重程度进行筛选
- 分页：默认每页显示 10 条，支持调整每页行数（10/20/50）
- 支持快速跳转页码
```

### Requirement: 实时同步更新机制
**修改原因**: 当前轮询机制获取的进度数据需要同步到表格中

```
保持现有轮询机制，但将进度数据实时更新到表格:
- 当分片检查进行中时，表格数据实时更新显示最新状态
- 使用 Table 组件的 dataSource 更新机制实现响应式更新
- 展开区域的问题列表随检查结果实时更新
```

### Requirement: 问题详情表格展示
**修改原因**: 当前问题列表使用简单的 div+Paragraph 展示，需要改为表格形式

```
将问题详情展示改为表格形式:
- 表格列包含：严重程度、问题类型、描述、分析、建议
- 严重程度列使用 Tag 组件显示颜色区分
- 表格支持展开查看完整分析和建议
- 保持原有的严重程度颜色标识（高=红色，中=橙色，低=蓝色）
```

### Requirement: 汇总报告区域
**修改原因**: 当前汇总报告使用 List 组件展示，需要与表格风格统一

```
汇总报告区域改为更紧凑的统计卡片+表格组合:
- 顶部显示统计卡片：综合评分、高危问题数、总问题数
- 下方显示各分片得分和问题数的汇总表格
- 表格支持点击跳转到对应分片详情
```

## REMOVED Requirements

### Requirement: Collapse 手风琴展示分片详情
**Reason**: 改用 Ant Design Table 展示检查结果，提升用户体验和操作效率
**Migration**: 原有 Collapse 展示的问题数据通过 Table 的 expandable 功能展示