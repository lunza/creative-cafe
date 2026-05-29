# Tasks
- [x] Task 1: 修复 selectedChapter 数据源问题
  - [x] SubTask 1.1: 修改 selectedChapter useMemo 从 chaptersRef.current 读取数据
  - [x] SubTask 1.2: 确保 handleSelect 和 handleFormChange 数据流一致
- [x] Task 2: 验证章节切换后标题不还原
  - [x] SubTask 2.1: 测试修改标题后切换章节再返回
  - [x] SubTask 2.2: 验证左侧章节列表同步更新

# Task Dependencies
- [Task 2] depends on [Task 1]
