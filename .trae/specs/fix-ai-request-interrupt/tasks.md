# Tasks

- [x] Task 1: 补充 `ai.cancel` 类型声明
  - [x] SubTask 1.1: 在 `src/renderer/types/electron.d.ts` 的 `ai` 接口中（`request` 方法之后）添加 `cancel: () => Promise<{ success: boolean; error?: string }>` 类型声明

- [x] Task 2: 修复后端非流式请求的 AbortController 注册
  - [x] SubTask 2.1: 在 `src/main/ipc/handlers/aiHandlers.ts` 非流式请求分支中，调用 `activeRequests.set(senderId, { controller, timeoutId, connectionTimeoutId })` 注册到 Map
  - [x] SubTask 2.2: 在非流式请求完成后（成功返回或 catch 块），调用 `activeRequests.delete(senderId)` 清理
  - [x] SubTask 2.3: 提取 `senderId` 变量到非流式分支顶部（`const senderId = event.sender.id`）

- [x] Task 3: 修复 `handleCancelAIRequest` 完整实现
  - [x] SubTask 3.1: 在 `src/renderer/components/WorldBook/hooks/useWorldBookFormState.ts` 中新增 `resetAllAIStates` 方法，集中重置所有 AI 操作状态
  - [x] SubTask 3.2: 在 `useWorldBookFormState` 返回对象中导出 `resetAllAIStates`
  - [x] SubTask 3.3: 在 `src/renderer/components/WorldBook/WorldBookManager.tsx` 的 `handleCancelAIRequest` 中：调用 `window.electronAPI.ai.cancel()`、设置 `isProcessingRef.current = false`、调用 `resetAllAIStates()`、关闭所有 AI Modal、输出详细日志、显示用户反馈消息

- [x] Task 4: 新增页面关闭/刷新清理
  - [x] SubTask 4.1: 在 `src/renderer/components/WorldBook/WorldBookManager.tsx` 中新增 `useEffect`，挂载 `beforeunload` 事件监听器，在页面关闭/刷新时调用 `window.electronAPI.ai.cancel()` 终止活跃请求
  - [x] SubTask 4.2: 在 `useEffect` 的 cleanup 函数中移除 `beforeunload` 监听器

- [x] Task 5: 新增主进程退出清理
  - [x] SubTask 5.1: 在 `src/main/ipc/handlers/aiHandlers.ts` 中导出 `abortAllAIRequests` 函数，遍历 `activeRequests` Map 并逐个调用 `controller.abort()`，清空 Map，返回清理的请求数量
  - [x] SubTask 5.2: 在 `src/main/index.ts` 的 `before-quit` 事件处理中（`abortActiveWritingAgent()` 之后），调用 `abortAllAIRequests()` 并记录日志

- [x] Task 6: 更新技术文档
  - [x] SubTask 6.1: 在 `.trae/documents/技术文档.md` 中增量更新 AI 请求中断功能修复内容，**重点标记**此 Bug（用户反复提示才解决的问题）

# Task Dependencies
- [Task 3] depends on [Task 1]（需要类型声明才能调用 ai.cancel）和 [Task 2]（需要后端能真正取消非流式请求）
- [Task 4] depends on [Task 1]
- [Task 5] depends on [Task 2]
- [Task 6] depends on all previous tasks
