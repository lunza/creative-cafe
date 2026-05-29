# Tasks
- [x] Task 1: 移除 CONFIG 模块的 electron-store 实例
  - [x] SubTask 1.1: 从 `initializeStores()` 中移除 `StorageModule.CONFIG`
  - [x] SubTask 1.2: 移除 `initializeBaseDirectories()` 中为 CONFIG 创建 `config/` 目录的逻辑

- [x] Task 2: 重构元数据管理逻辑
  - [x] SubTask 2.1: 修改 `initializeMetadata()`，将元数据直接写入 `settings.json`
  - [x] SubTask 2.2: 修改 `updateMetadata()`，将元数据更新直接写入 `settings.json`
  - [x] SubTask 2.3: 确保 `inferFromKey()` 中 CONFIG 模块的 `settings`、`version`、`lastUpdated` 键能正确处理

- [x] Task 3: 更新 storageService 中的元数据初始化
  - [x] SubTask 3.1: 确认 `initializeDefaultData()` 中的元数据初始化不再生成 `config.json`

- [x] Task 4: 验证修改
  - [x] SubTask 4.1: 确保保存设置时不再生成 `config.json` 和 `config/` 文件夹
  - [x] SubTask 4.2: 确保元数据正常读写
  - [x] SubTask 4.3: 确保 `settings.json` 正常读写

# Task Dependencies
- [Task 2] depends on [Task 1]
- [Task 3] depends on [Task 2]
- [Task 4] depends on [Task 3]