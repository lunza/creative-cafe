# Data Directory File Organization Evaluation Spec

## Why
data 目录下存在 8 个独立 JSON 文件（character.json、config.json、creative.json、creative-data.json、memory.json、migration_completed、settings.json、worldbook.json），这些文件分散存储在根目录而非功能子目录中。当前结构缺乏逻辑一致性，增加了维护复杂度和开发者理解成本。

## What Changes
- **全面评估独立 JSON 文件的功能状态和代码引用情况**
- **识别废弃/未使用的文件**
- **提供重组建议**：将文件迁移到适当的子目录或统一到存储服务
- **清理无引用文件**
- **优化目录结构逻辑**

## Impact
- **Affected specs**: 数据存储、文件组织、目录结构
- **Affected code**:
  - `src/main/services/storageService.ts` - 存储服务
  - `src/main/services/storage.types.ts` - 存储类型定义
  - `src/main/ipc/handlers/creativeHandlers.ts` - 创意数据处理
  - `src/main/ipc/handlers/appHandlers.ts` - 应用配置处理
  - `src/main/services/ConfigCleanupService.ts` - 配置清理服务

## ADDED Requirements
### Requirement: 文件组织评估
系统 SHALL 提供清晰的文件组织评估报告，包括：
- 每个独立 JSON 文件的引用状态
- 文件大小和修改时间分析
- 逻辑分组建议

#### Scenario: 文件引用分析
- **WHEN** 评估文件组织时
- **THEN** 系统应识别每个文件的代码引用情况，区分活跃文件和废弃文件

#### Scenario: 重组建议
- **WHEN** 发现组织混乱的文件时
- **THEN** 系统应提供具体的重组建议，包括目标目录和迁移方案

### Requirement: 废弃文件清理
系统 SHALL 清理不再被引用的文件。

#### Scenario: 无引用文件识别
- **WHEN** 文件无任何代码引用时
- **THEN** 文件应标记为可删除候选

## MODIFIED Requirements
### Requirement: settings.json 文件管理
**Original**: settings.json 存储在 data 根目录，通过多处直接文件路径引用

**Modified**: settings.json 应通过存储服务统一管理，减少直接文件路径引用

### Requirement: creative-data.json 文件管理
**Original**: creative-data.json 存储在 data 根目录，通过 creativeHandlers.ts 直接引用

**Modified**: creative-data.json 应迁移到 creatives 子目录或通过存储服务管理

## REMOVED Requirements
### Requirement: 废弃 JSON 文件
**Reason**: character.json、creative.json、memory.json、worldbook.json 等文件无任何代码引用，属于历史遗留文件

**Migration**: 
- character.json → 已迁移到 characters 子目录
- creative.json → 已迁移到 creatives 子目录  
- memory.json → 已迁移到 memories 子目录
- worldbook.json → 已迁移到 worldbooks 子目录
- 这些根目录文件应安全删除
