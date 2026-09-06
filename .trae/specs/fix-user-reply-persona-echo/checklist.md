# Checklist

- [x] `buildUserReplySystemPrompt` 支持 `conversationHistory` 可选参数，空/未传时行为向后兼容
- [x] "## 对话历史"段落正确嵌入系统提示，说话人使用 `${userName}` / `${charName}` 标注
- [x] `generateUserReply` 的 `engine.sendMessage` 仅发送单条 user 请求消息，不再传以 assistant 结尾的历史数组
- [x] 发送的消息结构为 `[system(含历史), user(生成请求)]`，消除 trailing-assistant prefill 回显
- [x] Token 管理裁剪逻辑保留且作用于真实 contextMessages（preliminary 提示用于计数）
- [x] userInstruction（输入框内容）仍通过"## 用户指令"段落注入（现有行为不回退）
- [x] 人称视角（userReplyPerson）约束保持不变
- [x] TypeScript 编译通过（新增代码零错误）
- [x] 开发服务器已重启，变更生效
- [x] `docs/FIX_RECORDS.md` 已重点标记此 bug 修复记录
