# Checklist

- [x] `ContentGenerator.ts` 中 abort 错误判断覆盖 DOMException 和非 DOMException（消息含 "abort"）
- [x] `ContentGenerator.ts` 中 abort 错误不被 `isTransientError` 判定为可重试
- [x] `writingHandlers.ts` 中 `writing:generateChapter` 在创建新 controller 前中止同 key 的旧 controller
- [x] `writingHandlers.ts` 提供清理所有 abort controller 的 IPC 入口（`writing:cleanupAll`）
- [x] `writingHandlers.ts` 导出 `abortAllActiveRequests` 供页面级事件调用
- [x] `useChapterGeneration.ts` 在组件挂载时调用 `writing:cancelGeneration` 清理残留任务
- [x] `useChapterGeneration.ts` 在组件卸载时发送 IPC 取消请求到主进程
- [x] `index.ts` 监听 `will-navigate` 事件，页面刷新时调用 `abortAllActiveRequests`
- [x] 页面刷新后，新组件不会继续旧任务的生成（组件挂载时 cancelGeneration + will-navigate 拦截）
- [x] 用户点击"停止生成"后，任务立即中止（abortControllerRef.abort + stopRef）
- [x] 同一章节重复触发时，旧请求被中止新请求正常执行
- [x] 导航离开写作模式后，后端任务正确清理（useEffect cleanup + IPC cancel）
