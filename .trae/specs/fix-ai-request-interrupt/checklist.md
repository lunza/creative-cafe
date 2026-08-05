# Checklist

- [x] `electron.d.ts` 的 `ai` 接口中已添加 `cancel: () => Promise<{ success: boolean; error?: string }>` 类型声明
- [x] `aiHandlers.ts` 非流式请求分支已将 AbortController 注册到 `activeRequests` Map
- [x] 非流式请求完成后（成功/失败）已从 `activeRequests` Map 中清理
- [x] `handleCancelAIRequest` 已调用 `window.electronAPI.ai.cancel()` 切断后端连接
- [x] `handleCancelAIRequest` 已重置所有 AI 操作状态（isPolishingAll/isTranslatingAll/isAuditingAll/polishingField/translatingField/auditingField/isGeneratingKeywordsAll/isAISorting/isGeneratingEntries/generatingKeywordsUid）
- [x] 中断后按钮文案正确恢复（"中断xxx" → "开始xxx"/"AI xxx"）
- [x] 中断操作有详细日志输出（addLog 记录中断事件和状态重置）
- [x] 中断操作有用户反馈消息（message.info 提示后台连接已切断）
- [x] WorldBookManager 已注册 `beforeunload` 事件监听器，页面关闭/刷新时调用 `ai.cancel()`
- [x] `beforeunload` 监听器在组件卸载时已正确移除
- [x] `aiHandlers.ts` 已导出 `abortAllAIRequests` 函数
- [x] `src/main/index.ts` 的 `before-quit` 事件中已调用 `abortAllAIRequests()` 清理所有活跃请求
- [x] `useWorldBookFormState.ts` 已新增 `resetAllAIStates` 方法并导出
- [x] 技术文档 `.trae/documents/技术文档.md` 已增量更新，**重点标记**此 Bug 修复
