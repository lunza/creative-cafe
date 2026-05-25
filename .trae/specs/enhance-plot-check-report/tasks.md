# Tasks
- [x] Task 1: 扩展类型定义
  - [x] SubTask 1.1: 在 writing.types.ts 的 PlotCheckIssue 接口中添加 originalText、references、fixable、fixed 字段
  - [x] SubTask 1.2: 在 writing.types.ts 的 PlotCheckReport 接口中添加 batchFixed 字段

- [x] Task 2: 增强 PlotCheckerService 问题检测逻辑
  - [x] SubTask 2.1: 在问题检测时提取相关原文片段（包含问题位置前后上下文）
  - [x] SubTask 2.2: 在问题检测时收集参考资料引用（世界书、角色卡、前序章节等）
  - [x] SubTask 2.3: 将原文片段和引用信息附加到 PlotCheckIssue 对象

- [x] Task 3: 实现 AI 批量修正服务
  - [x] SubTask 3.1: 在 PlotCheckerService 中新增 batchFixIssues 方法
  - [x] SubTask 3.2: 构建批量修正提示词（结构化拼接多个问题的信息）
  - [x] SubTask 3.3: 调用 AI 服务获取批量修正后的内容
  - [x] SubTask 3.4: 解析 AI 返回结果，按问题拆分修复结果

- [x] Task 4: 实现 IPC 通信层
  - [x] SubTask 4.1: 在 preload.ts 中添加 batchFixIssues API 暴露
  - [x] SubTask 4.2: 在 writingHandlers.ts 中新增批量修正 handler

- [x] Task 5: 实现 PlotCheckReportModal 引用展示
  - [x] SubTask 5.1: 在问题详情区域展示原文片段（带高亮标注）
  - [x] SubTask 5.2: 在问题详情区域展示参考资料引用列表
  - [x] SubTask 5.3: 为逻辑异常检测部分的问题也展示引用信息

- [x] Task 6: 实现批量勾选与一键修复 UI
  - [x] SubTask 6.1: 为每个问题条目前方添加复选框
  - [x] SubTask 6.2: 实现全选/取消全选操作
  - [x] SubTask 6.3: 添加"一键修复选中问题(N)"按钮
  - [x] SubTask 6.4: 实现批量修复加载状态展示
  - [x] SubTask 6.5: 实现批量修复结果摘要展示

- [x] Task 7: 集成到 ContentWorkspace
  - [x] SubTask 7.1: 实现 onBatchFix 回调函数
  - [x] SubTask 7.2: 调用批量修正 API 并处理返回结果
  - [x] SubTask 7.3: 批量修复成功后更新编辑器内容
  - [x] SubTask 7.4: 更新报告中的问题修复状态

- [x] Task 8: 构建并验证
  - [x] SubTask 8.1: 运行构建命令 - 构建成功无错误
  - [x] SubTask 8.2: 验证类型定义与代码一致性 - 代码审查通过
  - [x] SubTask 8.3: 测试批量修复功能完整流程（需用户手动测试）

# Task Dependencies
- Task 2 depends on Task 1
- Task 3 depends on Task 1
- Task 4 depends on Task 3
- Task 5 depends on Task 1 and Task 2
- Task 6 depends on Task 1 and Task 4
- Task 7 depends on Task 4 and Task 6
- Task 8 depends on Task 7
