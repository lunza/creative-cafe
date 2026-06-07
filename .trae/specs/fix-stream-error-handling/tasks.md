# 任务列表

## 任务 1: 修改 onStreamError 回调
- [x] 任务 1.1: 清空流式内容和字数统计
  - [x] 在 onStreamError 回调中添加 `setStreamingContent('')` 和 `setCurrentChapterWords(0)`
  - [x] 确保仅在非用户主动停止时清空内容

## 任务 2: 添加错误类型分类方法
- [x] 任务 2.1: 在 ContentGenerator 中添加 `classifyError(error: Error): string` 方法
  - [x] 分类：timeout（超时）、network（网络）、service（服务）、unknown（未知）

## 任务 3: 修改错误消息为用户友好提示
- [x] 任务 3.1: 修改 `onStreamError` 回调中的消息显示逻辑
  - [x] 根据错误类型显示对应友好提示
  - [x] 超时："生成超时，请检查网络连接或减少章节字数后重试"
  - [x] 网络："网络连接异常，请检查网络后重试"
  - [x] 服务："AI 服务暂时不可用，请稍后重试"
  - [x] 未知："生成失败，请稍后重试"

## 任务 4: 验证
- [x] 任务 4.1: TypeScript 编译验证
- [x] 任务 4.2: IDE 诊断验证

## 任务依赖关系
- 任务 1 和任务 2 可以并行
- 任务 3 依赖于任务 1、2
