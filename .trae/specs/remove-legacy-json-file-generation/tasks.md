# Tasks
- [ ] Task 1: 修改 StorageManager 的 initializeStores 方法
  - [ ] SubTask 1.1: 移除为已迁移模块（character, creative, memory, worldbook）创建 Store 实例的逻辑
  - [ ] SubTask 1.2: 仅保留 CONFIG 和 EDITOR 模块的 Store 实例
  - [ ] SubTask 1.3: 验证移除 Store 后相关功能不受影响

- [ ] Task 2: 清理 storageService 中的冗余初始化
  - [ ] SubTask 2.1: 检查 initializeDefaultData 中对已迁移模块的初始化
  - [ ] SubTask 2.2: 移除或调整 worldbooks、characters、creatives、chats、templates 的默认初始化

- [ ] Task 3: 验证修改后的存储功能
  - [ ] SubTask 3.1: 确保 settings.json 正常读写
  - [ ] SubTask 3.2: 确保不再自动生成 character.json、creative.json、memory.json、worldbook.json、config.json
  - [ ] SubTask 3.3: 确保子目录（characters/、creatives/ 等）中的数据访问正常

- [ ] Task 4: 手动删除已生成的历史遗留 JSON 文件
  - [ ] SubTask 4.1: 删除 character.json
  - [ ] SubTask 4.2: 删除 creative.json
  - [ ] SubTask 4.3: 删除 memory.json
  - [ ] SubTask 4.4: 删除 worldbook.json
  - [ ] SubTask 4.5: 删除 config.json
  - [ ] SubTask 4.6: 删除 config/ 文件夹

# Task Dependencies
- [Task 3] depends on [Task 1, Task 2]
- [Task 4] depends on [Task 3]