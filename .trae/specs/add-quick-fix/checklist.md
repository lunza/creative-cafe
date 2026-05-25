# Checklist

- [x] `analyzeChapter` 系统提示词要求AI返回每个问题的 `quickFixSuggestion`
- [x] `parseCheckResponse` 解析 `quickFixSuggestion` 字段（originalText, fixedText, reason）
- [x] 解析后验证 `originalText` 在章节内容中存在
- [x] 设置 `quickFixSuggestion.position` 字段
- [x] 逻辑异常检测返回的问题也包含修正建议
- [x] `PlotCheckerService` 中移除 `quickFixIssue` 方法
- [x] `writingHandlers.ts` 中移除 `writing:quickFixIssue` handler
- [x] `preload.ts` 中移除 `quickFixIssue` API
- [x] `PlotCheckReportModal` 中 `handleQuickFix` 直接使用 `issue.quickFixSuggestion`
- [x] 快速修正按钮点击时不发起新的AI请求
- [x] `usePlotCheck` hook 中快速修正逻辑简化为同步操作
- [x] `ContentWorkspace` 中快速修正回调直接传递缓存建议
- [x] 构建无错误
- [x] 手动测试：剧情检查返回的报告中每个问题包含修正建议
- [x] 手动测试：点击快速修正直接使用缓存建议展示弹窗
- [x] 手动测试：接受修正后字符串替换和重新评分正常
