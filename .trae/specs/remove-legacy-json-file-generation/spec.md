# Remove Legacy JSON File Generation Spec

## Why
在保存设置时，系统会自动生成 character.json、creative.json、memory.json、worldbook.json、config.json 这些历史遗留文件。这些文件由 `electron-store` 为每个 `StorageModule` 创建的 Store 实例自动生成，但实际上已被迁移到对应的子目录中（如 characters/、creatives/ 等），造成数据分散和目录混乱。

## What Changes
- **移除 `StorageManager` 中为历史模块创建 `electron-store` 实例的逻辑**
- **移除 `MODULE_PATH_MAP` 中无用的 CONFIG 模块映射**
- **确保不再自动创建 character.json、creative.json、memory.json、worldbook.json、config.json 等遗留文件**
- **统一数据访问路径**，确保所有数据通过子目录或 `settings.json` 管理

## Impact
- **Affected specs**: 数据存储、存储管理器、存储服务
- **Affected code**:
  - `src/main/services/storageManager.ts` - 核心修改：移除为历史模块创建 Store 的逻辑
  - `src/main/services/storage.types.ts` - 可能需要调整 `MODULE_PATH_MAP`
  - `src/main/services/storageService.ts` - 可能需要调整初始化逻辑

## ADDED Requirements
### Requirement: 统一数据存储
系统 SHALL 确保数据只存储在一个位置，不再使用 `electron-store` 为每个模块创建独立的 JSON 文件。

#### Scenario: 初始化存储
- **WHEN** 系统初始化存储时
- **THEN** 系统仅创建必要的目录结构，不为每个模块创建 JSON 文件

#### Scenario: 保存设置
- **WHEN** 用户点击"保存设置"按钮时
- **THEN** 系统仅更新 `settings.json`，不生成其他遗留 JSON 文件

## MODIFIED Requirements
### Requirement: StorageManager 初始化逻辑
**Original**: `StorageManager.initializeStores()` 为每个 `StorageModule` 创建 `electron-store` 实例，导致自动生成 character.json、creative.json 等文件

**Modified**: 移除或重构 `initializeStores()` 方法，不再为已迁移的模块创建 Store 实例

## REMOVED Requirements
### Requirement: 历史模块的 electron-store 实例
**Reason**: character、creative、memory、worldbook 模块的数据已迁移到对应的子目录中，不需要独立的 JSON 文件

**Migration**: 
- character.json → characters/ 子目录
- creative.json → creatives/ 子目录  
- memory.json → memories/ 子目录
- worldbook.json → worldbooks/ 子目录
- config.json → settings.json（配置统一管理）