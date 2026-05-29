# Tasks
- [ ] Task 1: 分析独立 JSON 文件的代码引用情况
  - [ ] SubTask 1.1: 确认 character.json 的引用状态
  - [ ] SubTask 1.2: 确认 creative.json 的引用状态
  - [ ] SubTask 1.3: 确认 memory.json 的引用状态
  - [ ] SubTask 1.4: 确认 worldbook.json 的引用状态
  - [ ] SubTask 1.5: 确认 config.json 的引用状态
  - [ ] SubTask 1.6: 确认 settings.json 的引用状态
  - [ ] SubTask 1.7: 确认 creative-data.json 的引用状态
  - [ ] SubTask 1.8: 确认 migration_completed 的引用状态

- [ ] Task 2: 评估文件大小和内容分析
  - [ ] SubTask 2.1: 检查每个文件的实际内容
  - [ ] SubTask 2.2: 分析文件大小是否合理
  - [ ] SubTask 2.3: 检查文件修改时间判断活跃度

- [ ] Task 3: 清理废弃文件
  - [ ] SubTask 3.1: 删除无引用的 character.json
  - [ ] SubTask 3.2: 删除无引用的 creative.json
  - [ ] SubTask 3.3: 删除无引用的 memory.json
  - [ ] SubTask 3.4: 删除无引用的 worldbook.json
  - [ ] SubTask 3.5: 删除 migration_completed 标记文件

- [ ] Task 4: 优化 settings.json 管理
  - [ ] SubTask 4.1: 评估 settings.json 的当前引用模式
  - [ ] SubTask 4.2: 减少直接文件路径引用
  - [ ] SubTask 4.3: 统一通过存储服务访问

- [ ] Task 5: 优化 creative-data.json 管理
  - [ ] SubTask 5.1: 评估 creative-data.json 的当前引用模式
  - [ ] SubTask 5.2: 考虑迁移到 creatives 子目录
  - [ ] SubTask 5.3: 统一通过存储服务访问

- [ ] Task 6: 验证重组后的文件组织
  - [ ] SubTask 6.1: 确保核心功能不受影响
  - [ ] SubTask 6.2: 验证存储服务正常工作
  - [ ] SubTask 6.3: 运行相关测试确保完整性

# Task Dependencies
- [Task 3] depends on [Task 1, Task 2]
- [Task 4] depends on [Task 1]
- [Task 5] depends on [Task 1]
- [Task 6] depends on [Task 3, Task 4, Task 5]