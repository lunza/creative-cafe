# Checklist

## 基础工具（Task 1-2）
- [x] `aiHttpClient.ts` 使用 fetch 实现统一 AI 调用，支持 chat_completion / text_completion
- [x] `aiHttpClient.ts` 支持 300s 超时与指数退避重试（最多 3 次）
- [x] 鉴权正确处理 Bearer token（header/body 两种传输方式）
- [x] `AIConfigProvider.buildApiEndpoint` 不再重复追加 `/v1/chat/completions`
- [x] 新增/更新的单元测试全部通过（24/24）

## 写作模式（Task 3、6）
- [x] `TableOrganizeService.callAIAPI` 已替换为 `callAIAPIWithFetch`，移除 http/https 原生模块
- [ ] 写作模式整理（全项目/单章节/单表格/单行）能正常调用 AI 并回写表格
- [x] 引擎配置缺失时返回明确错误信息
- [x] IPC 进度事件带 `sender.isDestroyed()` 守卫

## 对话模式同步整理（Task 4、6）
- [x] 同步整理能正常触发，AI 调用使用完整引擎配置参数
- [x] 断点续传在消息数量减少时正确重置
- [x] `aiClient.ts` 委托给 `aiHttpClient`，行为一致
- [x] IPC 进度事件带 `sender.isDestroyed()` 守卫

## 对话模式异步整理（Task 5）
- [x] 模板获取失败时回退指令与当前 tableEdit 协议对齐
- [x] `tableEdit` 标签检测覆盖 8 种 AI 变体格式
- [x] 解析失败时优雅降级，不阻塞 UI
- [x] 命令执行成功后表格数据立即刷新

## 测试验证（Task 7）
- [x] `aiHttpClient` 单元测试通过（24/24）
- [ ] `AIConfigProvider` 单元测试通过（无现有测试文件，跳过）
- [ ] 写作模式手动测试：全项目/单章节/单表格/单行整理正常
- [ ] 对话模式同步整理手动测试正常
- [ ] 对话模式异步整理手动测试正常