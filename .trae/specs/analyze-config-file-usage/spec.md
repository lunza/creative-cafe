# Config File and Directory Analysis Spec

## Why
data 目录下存在 `config.json` 文件和 `config/` 空文件夹，两者存在命名冲突且关系不明确。`config.json` 包含完整的应用配置数据（AI引擎、路径设置等），但代码库中无任何直接引用；而 `config/` 文件夹是 MODULE_PATH_MAP 中 CONFIG 模块的映射目标，却完全为空。这种不一致增加了维护复杂度和理解成本。

## What Changes
- **全面分析 config.json 的功能状态和代码引用情况**
- **分析 config/ 空文件夹的创建原因和用途**
- **确认 config.json 与 settings.json 的数据关系**
- **提供清理建议**：删除无用的 config.json 和 config/ 文件夹
- **统一配置管理**：确保配置数据只存储在一个位置

## Impact
- **Affected specs**: 数据存储、配置管理、目录结构
- **Affected code**:
  - `src/main/services/storage.types.ts` - CONFIG 模块路径映射
  - `src/main/services/storageManager.ts` - 存储管理器
  - `src/main/services/storageService.ts` - 存储服务
  - `src/main/services/ConfigCleanupService.ts` - 配置清理服务

## ADDED Requirements
### Requirement: 配置统一管理
系统 SHALL 确保应用配置数据只存储在一个位置，避免多个配置文件并存。

#### Scenario: 配置数据访问
- **WHEN** 系统需要读取或写入应用配置时
- **THEN** 系统统一通过 settings.json 和存储服务进行访问

#### Scenario: 废弃配置清理
- **WHEN** 发现不再使用的配置文件或文件夹时
- **THEN** 系统应安全删除这些废弃资源

### Requirement: config 模块目录管理
**Original**: CONFIG 模块映射到 'config' 目录，但配置数据实际存储在 settings.json

**Modified**: CONFIG 模块应正确映射到实际使用的配置存储位置，或删除无用的 config 目录映射

## MODIFIED Requirements
### Requirement: config.json 文件状态
**Original**: config.json 包含完整的应用配置数据，与 settings.json 内容高度相似

**Modified**: 确认 config.json 为历史遗留文件，应安全删除

### Requirement: config/ 文件夹状态
**Original**: config/ 文件夹由 MODULE_PATH_MAP 创建，但完全为空且无实际用途

**Modified**: 确认 config/ 为无用目录，应安全删除，并调整 MODULE_PATH_MAP 中的 CONFIG 映射

## REMOVED Requirements
### Requirement: config.json 文件
**Reason**: 无任何代码引用，数据已迁移到 settings.json，属于历史遗留文件

**Migration**: 配置数据已统一到 settings.json，通过存储服务管理

### Requirement: config/ 文件夹
**Reason**: 完全为空，无实际用途，MODULE_PATH_MAP 中 CONFIG 映射无对应数据

**Migration**: 从 MODULE_PATH_MAP 中移除 CONFIG 映射，或调整为实际使用的配置存储路径