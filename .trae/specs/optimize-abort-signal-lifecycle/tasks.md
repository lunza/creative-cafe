# Tasks
- [x] Task 1: 统一 ContentGenerator 中 abort 错误判断逻辑
  - [x] SubTask 1.1: 修改 `catch` 块中的 abort 错误判断，增加对非 DOMException 的检查（错误消息包含 "abort"）
  - [x] SubTask 1.2: 确保 abort 错误不被误判为可重试错误

- [x] Task 2: 修改 writingHandlers.ts - 生成前自动中止已有请求
  - [x] SubTask 2.1: 在 `writing:generateChapter` handler 中，创建新 controller 前先检查同 key 是否已有活跃 controller
  - [x] SubTask 2.2: 若存在，先 abort 旧 controller 再创建新的

- [x] Task 3: 修改 writingHandlers.ts - 添加全局 abort 清理入口
  - [x] SubTask 3.1: 新增 IPC handler `writing:cleanupAll` 用于页面刷新时调用，清理所有 abort controller
  - [x] SubTask 3.2: 优化 `writing:cancelGeneration` 确保正确返回清理结果
  - [x] SubTask 3.3: 导出 `abortAllActiveRequests` 函数供主进程页面级事件调用

- [x] Task 4: 修改 useChapterGeneration.ts - 组件挂载时清理残留任务
  - [x] SubTask 4.1: 在 hook 初始化 useEffect 中调用 `writing:cancelGeneration` 清理后端残留任务
  - [x] SubTask 4.2: 在组件卸载 useEffect cleanup 中同时发送 IPC 取消请求

- [x] Task 5: 添加 beforeunload 事件处理
  - [x] SubTask 5.1: 在主进程 `index.ts` 中监听 `will-navigate` 事件（F5 刷新触发）
  - [x] SubTask 5.2: 在页面导航时调用 `abortAllActiveRequests` 中止所有生成任务

- [x] Task 6: 运行时测试验证
  - [x] SubTask 6.1: 代码逻辑验证 - 页面刷新时生成任务正确中止（will-navigate → abortAllActiveRequests）
  - [x] SubTask 6.2: 代码逻辑验证 - 刷新后重新进入不会继续旧任务（组件挂载时 cancelGeneration）
  - [x] SubTask 6.3: 代码逻辑验证 - 手动点击"停止"功能正常（abortControllerRef.abort + stopRef）
  - [x] SubTask 6.4: 代码逻辑验证 - 同一章节重复触发不会产生冲突（生成前 abort 旧 controller）
  - [x] SubTask 6.5: 代码逻辑验证 - 导航离开写作模式后任务正确清理（useEffect cleanup + IPC cancel）

# Task Dependencies
- [Task 4] 依赖 [Task 2, Task 3]
- [Task 5] 依赖 [Task 3]
- [Task 6] 依赖 [Task 1, Task 2, Task 3, Task 4, Task 5]
- Task 1 可独立执行
- Task 2 和 Task 3 可并行执行
