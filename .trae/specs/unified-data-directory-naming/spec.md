# 统一数据目录命名规范 Spec

## Why
当前 `__USER_DATA__/data` 目录下存在多组单数/复数形式的文件夹冲突（如 `character/characters`、`creative/creatives`、`memory/memories`、`worldbook/worldbooks`、`writing/writing-projects` 等）。这些冲突源于代码中不同位置使用了不一致的目录命名规范，导致数据分散存储、增加维护复杂度、可能产生重复数据。

## What Changes
- **统一所有数据目录使用复数形式命名**（`characters`、`creatives`、`memories`、`worldbooks`、`writing-projects` 等）
- **修复 `storage.types.ts` 中的 `MODULE_PATH_MAP`**，将单数路径改为复数
- **修复 `WritingStyleLearningService.ts` 和 `LogicCheckRecorder.ts`** 中硬编码的单数 `writing` 路径
- **清理单数形式文件夹**：如果确认无特殊用途则安全删除
- **检查并修复所有硬编码的单数路径引用**

## Impact
- **Affected specs**: 数据存储、路径服务、文件处理
- **Affected code**:
  - `src/main/services/storage.types.ts` - `MODULE_PATH_MAP` 需要修改
  - `src/main/services/WritingStyleLearningService.ts` - 硬编码路径需要修改
  - `src/main/services/writing/LogicCheckRecorder.ts` - 硬编码路径需要修改
  - `src/main/ipc/handlers/fileHandlers.ts` - 路径解析逻辑
  - 其他可能引用单数路径的代码

## ADDED Requirements
### Requirement: 统一数据目录命名
系统 SHALL 统一使用复数形式命名所有数据目录，避免单数/复数并存的情况。

#### Scenario: 创建新目录
- **WHEN** 系统需要创建数据目录
- **THEN** 系统仅创建复数形式的目录（如 `characters`、`creatives`、`memories`、`worldbooks`、`writing-projects`）

#### Scenario: 访问现有目录
- **WHEN** 系统需要访问数据目录
- **THEN** 系统统一使用复数形式的路径进行访问

### Requirement: 清理历史单数文件夹
系统 SHALL 评估并清理已存在的单数形式文件夹。

#### Scenario: 单数文件夹为空或无特殊用途
- **WHEN** 单数文件夹被确认无特殊用途
- **THEN** 安全删除该单数文件夹

#### Scenario: 单数文件夹存在特殊用途
- **WHEN** 单数文件夹存在特殊用途
- **THEN** 详细记录其功能、使用场景及关联关系，提交决策报告

## MODIFIED Requirements
### Requirement: MODULE_PATH_MAP 路径映射
**Original**: `MODULE_PATH_MAP` 使用单数形式（`'character'`、`'creative'`、`'worldbook'`、`'memory'`）

**Modified**: `MODULE_PATH_MAP` 统一使用复数形式（`'characters'`、`'creatives'`、`'worldbooks'`、`'memories'`）

### Requirement: 写作风格学习服务路径
**Original**: `WritingStyleLearningService.ts` 使用 `'writing'` 目录

**Modified**: `WritingStyleLearningService.ts` 使用 `'writing-projects'` 目录

### Requirement: 逻辑检查记录器路径
**Original**: `LogicCheckRecorder.ts` 使用 `'writing'` 目录

**Modified**: `LogicCheckRecorder.ts` 使用 `'writing-projects'` 目录

## REMOVED Requirements
### Requirement: 单数形式文件夹创建逻辑
**Reason**: 单数形式文件夹导致命名冲突和数据分散
**Migration**: 统一迁移到复数形式文件夹，确保向后兼容性
