# Tasks
- [x] Task 1: 扩展 PlotCheckIssue 类型定义
  - [x] SubTask 1.1: 在 writing.types.ts 的 PlotCheckIssue 接口中添加 `fixable`、`fixed`、`fixResult` 字段

- [x] Task 2: 实现 AI 自动修正服务
  - [x] SubTask 2.1: 在 PlotCheckerService 中新增 `autoFixIssue` 方法
  - [x] SubTask 2.2: 构建修正提示词（包含问题描述、建议、当前内容）
  - [x] SubTask 2.3: 调用 AI 服务获取修正后的内容
  - [x] SubTask 2.4: 解析 AI 返回结果并返回修正内容

- [x] Task 3: 实现 IPC 通信层
  - [x] SubTask 3.1: 在 preload.ts 中添加 `autoFixIssue` API 暴露
  - [x] SubTask 3.2: 在 writingHandlers.ts 中新增修正 handler

- [x] Task 4: 实现修正按钮 UI 组件
  - [x] SubTask 4.1: 在 PlotCheckReportModal 中为每个问题添加"自动修正"按钮
  - [x] SubTask 4.2: 实现修正加载状态展示
  - [x] SubTask 4.3: 实现修正成功/失败状态反馈
  - [x] SubTask 4.4: 为逻辑异常检测部分的问题也添加修正按钮

- [x] Task 5: 集成到 ContentWorkspace
  - [x] SubTask 5.1: 实现 onAutoFix 回调函数
  - [x] SubTask 5.2: 调用修正 API 并处理返回结果
  - [x] SubTask 5.3: 修正成功后更新编辑器内容
  - [x] SubTask 5.4: 更新报告中的问题状态

- [x] Task 6: 构建并验证
  - [x] SubTask 6.1: 运行构建命令 - 构建成功无错误
  - [ ] SubTask 6.2: 测试修正功能完整流程（需用户手动测试）
  - [x] SubTask 6.3: 验证报告原有内容保持不变 - 代码审查通过

# Task Dependencies
- Task 2 depends on Task 1
- Task 3 depends on Task 2
- Task 4 depends on Task 1
- Task 5 depends on Task 3 and Task 4
- Task 6 depends on Task 5
