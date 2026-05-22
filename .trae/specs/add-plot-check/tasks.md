# Tasks
- [x] Task 1: 定义剧情检查相关类型
  - [x] SubTask 1.1: 在 writing.types.ts 中添加 PlotCheckDimension、PlotCheckIssue、PlotCheckReport 等类型定义
- [x] Task 2: 实现剧情检查服务（PlotCheckerService）
  - [x] SubTask 2.1: 创建 PlotCheckerService 基础框架
  - [x] SubTask 2.2: 实现大纲一致性检查
  - [x] SubTask 2.3: 实现世界书遵循检查
  - [x] SubTask 2.4: 实现角色卡符合度检查
  - [x] SubTask 2.5: 实现写作风格统一性检查
  - [x] SubTask 2.6: 实现剧情连贯性检查
  - [x] SubTask 2.7: 实现综合评分和报告生成
- [x] Task 3: 实现 IPC 通信层
  - [x] SubTask 3.1: 在 writing.ipc.ts 中添加剧情检查 IPC 通道定义
  - [x] SubTask 3.2: 在 writingHandlers.ts 中实现剧情检查 handler
- [x] Task 4: 实现剧情检查报告 UI 组件
  - [x] SubTask 4.1: 创建 PlotCheckReportModal 组件
  - [x] SubTask 4.2: 实现各维度评分展示
  - [x] SubTask 4.3: 实现问题列表展示和严重级别标识
- [x] Task 5: 集成到 ContentWorkspace
  - [x] SubTask 5.1: 在操作栏第二行添加"剧情检查"按钮
  - [x] SubTask 5.2: 实现点击按钮触发检查的逻辑
  - [x] SubTask 5.3: 展示检查报告弹窗
- [x] Task 6: 构建并验证

# Task Dependencies
- Task 2 depends on Task 1
- Task 3 depends on Task 2
- Task 4 depends on Task 1
- Task 5 depends on Task 3 and Task 4
- Task 6 depends on Task 5
