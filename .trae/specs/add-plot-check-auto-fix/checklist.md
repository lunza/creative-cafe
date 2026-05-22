# Checklist

- [x] PlotCheckIssue 类型包含 fixable、fixed、fixResult 字段
- [x] PlotCheckerService 包含 autoFixIssue 方法
- [x] 修正提示词包含问题描述、建议、当前章节内容
- [x] IPC 通道 writing:autoFixIssue 正确暴露到 preload
- [x] writingHandlers.ts 包含修正 handler
- [x] PlotCheckReportModal 中每个问题条目下方有"自动修正"按钮
- [x] 修正过程中按钮显示加载状态
- [x] 修正成功后按钮显示"已修正"状态
- [x] 修正失败后按钮恢复可点击状态并显示错误
- [x] 逻辑异常检测部分的问题也有修正按钮
- [x] 修正成功后编辑器内容更新为修正版本
- [x] 报告原有内容（问题描述、格式、非问题文本）保持不变
- [x] 构建无错误
- [ ] 手动测试修正功能完整流程
