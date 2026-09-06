# Tasks

- [x] Task 1: 扩展 `buildUserReplySystemPrompt` 支持对话历史嵌入
  - [x] 1.1 `PromptBuilder.ts` 中 `buildUserReplySystemPrompt` 新增可选参数 `conversationHistory?: ChatMessage[]`
  - [x] 1.2 历史格式化：user 消息 → `[${userName}]: ${content}`，assistant 消息 → `[${charName}]: ${content}`，空历史显示"（无历史对话）"
  - [x] 1.3 在"## 对方角色上下文"之后、"## 任务要求"之前插入"## 对话历史"段落

- [x] Task 2: 修复 `generateUserReply` 的消息结构（消除 trailing-assistant 回显）
  - [x] 2.1 构建 preliminary 系统提示（不含历史）用于 token 计数与裁剪预算估算（镜像 polishInput 模式）
  - [x] 2.2 保留现有 ContextTruncator 裁剪逻辑（仍对 contextMessages 操作），`precountMessages`/`countSystemPromptTokens` 使用 preliminary 提示
  - [x] 2.3 裁剪后调用 `buildUserReplySystemPrompt` 传入裁剪后的 contextMessages，构建最终系统提示
  - [x] 2.4 `engine.sendMessage` 改为发送单条 user 角色请求消息（ChatMessage 结构，含 id/timestamp/status 字段），内容为"请以 {userName} 的身份，直接输出下一句回复内容本身。"

- [x] Task 3: 验证与文档
  - [x] 3.1 TypeScript 编译检查（`npx tsc --noEmit`，确认新增代码零错误）
  - [x] 3.2 重启开发服务器使变更生效
  - [x] 3.3 更新 `docs/FIX_RECORDS.md`，重点标记此 bug（根因 + 修复方案 + 日志证据）

# Task Dependencies
- Task 2 依赖 Task 1（需要扩展后的函数签名）
- Task 3 依赖 Task 1-2 完成
