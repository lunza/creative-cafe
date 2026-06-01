# 统一章节数据结构 Spec

## Why
当前代码中存在历史遗留的数据冗余和兼容性处理逻辑，增加了系统复杂度。为简化架构、提升代码可维护性，需要统一使用 `project.outline.chapters` 作为章节数据的唯一来源，并移除所有冗余的兼容性代码。

## What Changes
- **统一数据访问路径**：确保所有代码仅使用 `project.outline.chapters` 访问章节数据
- **移除冗余代码**：删除所有历史兼容性处理逻辑、数据同步代码
- **简化类型定义**：确保类型定义清晰，不包含冗余字段
- **不添加迁移逻辑**：本次重构不包含任何历史数据迁移代码，历史数据由用户自行清理

## Impact
- **受影响规格**：写作模式、大纲生成、章节生成、章节编辑
- **受影响代码**：
  - `src/shared/types/writing.types.ts` - 类型定义
  - `src/main/services/WritingStorageService.ts` - 存储服务
  - `src/main/ipc/handlers/writingHandlers.ts` - IPC 处理器
  - `src/renderer/stores/writingProjectStore.ts` - 状态管理
  - `src/renderer/components/Creative/WritingMode/` - UI 组件
  - `src/renderer/components/Creative/WritingMode/hooks/` - Hooks
  - `src/main/services/writing/` - 大纲生成服务

## ADDED Requirements
### Requirement: 单一数据来源
系统应当仅使用 `project.outline.chapters` 作为章节数据的唯一存储和访问位置。

#### Scenario: 读取章节列表
- **WHEN** 需要读取章节列表时
- **THEN** 应当从 `project.outline.chapters` 中获取，不使用其他路径

#### Scenario: 写入章节数据
- **WHEN** 需要更新章节信息时
- **THEN** 应当写入 `project.outline.chapters`，不维护多份数据

### Requirement: 无兼容性代码
系统不应包含任何历史数据兼容性处理逻辑。

#### Scenario: 加载项目
- **WHEN** 加载项目文件时
- **THEN** 直接读取当前格式，不进行数据迁移或格式转换

#### Scenario: 保存项目
- **WHEN** 保存项目文件时
- **THEN** 仅保存当前格式，不生成兼容格式

## MODIFIED Requirements
### Requirement: 数据存储结构
**原要求**：项目数据可能包含多个章节数据源，需要兼容性处理
**修改为**：项目数据仅使用 `project.outline.chapters` 作为章节数据源，不包含兼容性代码

### Requirement: 代码复杂度
**原要求**：代码需要处理多种数据格式的兼容性
**修改为**：代码仅处理单一数据格式，降低复杂度

## REMOVED Requirements
### Requirement: 历史数据迁移
**原因**：简化代码结构，历史数据由用户自行清理
**迁移方案**：不适用，用户负责清理历史数据

### Requirement: 数据兼容性处理
**原因**：降低系统复杂度，提升可维护性
**迁移方案**：移除所有兼容性代码，系统仅支持当前数据格式
