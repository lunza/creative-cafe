# Tasks
- [x] Task 1: 在 writing.types.ts 中新增逻辑检查类型定义
  - [x] SubTask 1.1: 添加 LogicContradictionType 枚举（物品状态、经济系统、角色状态、物理规律、剧情设定、数学逻辑）
  - [x] SubTask 1.2: 添加 LogicCheckIssue 接口（包含异常类型、情节描述、矛盾点分析、位置信息、严重程度）
  - [x] SubTask 1.3: 在 PlotCheckReport 中新增 logicIssues 字段
- [x] Task 2: 增强 PlotCheckerService 逻辑检测能力
  - [x] SubTask 2.1: 在 buildCheckPrompt 中添加逻辑矛盾检测指令
  - [x] SubTask 2.2: 在 parseCheckResponse 中解析逻辑检查结果
- [x] Task 3: 实现 LogicCheckRecorder 服务
  - [x] SubTask 3.1: 创建 LogicCheckRecorder 类，负责将逻辑异常写入记忆表格
  - [x] SubTask 3.2: 实现 insertRowToTable 方法，将异常记录插入表格
  - [x] SubTask 3.3: 集成 tableTemplateService 管理表格文件
- [x] Task 4: 实现 IPC 通信层
  - [x] SubTask 4.1: 在 writingHandlers.ts 中增强 checkChapter handler，调用 LogicCheckRecorder
  - [x] SubTask 4.2: 在 preload.ts 中暴露 saveLogicCheck API
- [x] Task 5: 更新 PlotCheckReportModal
  - [x] SubTask 5.1: 在报告中添加逻辑异常检查维度展示
  - [x] SubTask 5.2: 添加查看记忆表格入口
- [x] Task 6: 集成到 ContentWorkspace
  - [x] SubTask 6.1: 在操作栏添加"查看逻辑记录"按钮
- [x] Task 7: 构建并验证

# Task Dependencies
- Task 2 depends on Task 1
- Task 3 depends on Task 1
- Task 4 depends on Task 2 and Task 3
- Task 5 depends on Task 1
- Task 6 depends on Task 4 and Task 5
- Task 7 depends on Task 6
