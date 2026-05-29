# Remove Config Store and Directory Generation Spec

## Why
`config.json` 和 `config/` 文件夹由 `StorageModule.CONFIG` 的 `electron-store` 实例自动生成。每次保存设置时，`initializeMetadata()` 或 `updateMetadata()` 会向 CONFIG 模块的 Store 写入 `_metadata`，触发 `electron-store` 创建 `config.json`。同时 `initializeBaseDirectories()` 会为 CONFIG 模块创建 `config/` 目录。但配置数据实际存储在 `settings.json` 中，这些文件/目录是多余的。

## What Changes
- **移除 `StorageModule.CONFIG` 的 `electron-store` 实例**，不再为 CONFIG 模块生成 `config.json`
- **移除 `initializeBaseDirectories()` 中为 CONFIG 模块创建 `config/` 目录的逻辑**
- **将 `initializeMetadata()` 和 `updateMetadata()` 改为直接写入 `settings.json`**
- **更新 `get/set` 方法中的 CONFIG 模块处理逻辑**

## Impact
- **Affected specs**: 存储管理器、存储服务、元数据管理
- **Affected code**:
  - `src/main/services/storageManager.ts` - 核心修改：移除 CONFIG 模块的 Store 和相关逻辑
  - `src/main/services/storageService.ts` - 可能需要调整元数据初始化

## ADDED Requirements
### Requirement: 元数据直接写入 settings.json
系统 SHALL 将元数据（version、lastUpdated）直接存储到 `settings.json` 中，而不是通过 `electron-store` 的 `config.json` 存储。

#### Scenario: 更新元数据
- **WHEN** 系统需要更新元数据时
- **THEN** 系统直接将元数据写入 `settings.json`，不生成 `config.json`

## MODIFIED Requirements
### Requirement: CONFIG 模块存储方式
**Original**: CONFIG 模块使用 `electron-store` 创建 `config.json`，元数据存储在 `config.json` 的 `_metadata` 字段

**Modified**: CONFIG 模块不再使用 `electron-store`，元数据直接嵌入 `settings.json` 中

## REMOVED Requirements
### Requirement: CONFIG 模块的 electron-store 实例
**Reason**: 配置数据统一管理在 `settings.json` 中，`electron-store` 为 CONFIG 模块生成的 `config.json` 是多余的

**Migration**: 
- `config.json` 中的 `_metadata` 数据迁移到 `settings.json`
- 移除 CONFIG 模块的 Store 实例创建