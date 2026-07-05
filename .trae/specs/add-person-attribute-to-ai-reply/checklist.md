# Checklist

## 类型与提示词层

- [x] `CharacterDialogueChat.types.ts` 的 `CharacterSessionConfig` 接口存在 `userReplyPerson?: 'first' | 'second' | 'third'` 字段
- [x] `buildUserReplySystemPrompt` 函数签名包含第 3 个可选参数 `person?: 'first' | 'second' | 'third'`
- [x] `person='first'`（或不传）时，系统提示"任务要求"段落包含"以第一人称（"我"）视角生成回复，使用"我"作为自称"
- [x] `person='second'` 时，系统提示"任务要求"段落包含"以第二人称（"你"）视角生成回复，使用"你"来指代 ${userName} 自身（互动小说风格）"
- [x] `person='third'` 时，系统提示"任务要求"段落包含"以第三人称叙事视角生成回复，使用"${userName}"作为主语（小说叙事风格）"
- [x] 不传 `person` 参数时，输出与现有实现完全一致（向后兼容）

## Hook 业务逻辑

- [x] `generateUserReply` 函数读取 `characterConfig?.userReplyPerson`
- [x] `generateUserReply` 调用 `buildUserReplySystemPrompt` 时传入 `userReplyPerson` 作为第 3 参数
- [x] `generateUserReply` 的 useCallback 依赖数组包含 `characterConfig`

## ChatInputBar UI

- [x] `ChatInputBarProps` 接口新增 `userReplyPerson?` 和 `onUserReplyPersonChange?` 两个可选 props
- [x] 人称选择器（`Select`）位于"AI回复"按钮**左侧**（同一 `else` 分支内）
- [x] 选择器包含三个选项：`第一人称（我）` / `第二人称（你）` / `第三人称（他/她）`
- [x] 选择器 `size="small"`，宽度约 110px
- [x] 选择器 `value` 绑定 `userReplyPerson`，`onChange` 回调 `onUserReplyPersonChange`
- [x] 选择器在 `disabled || isStreaming || isOrganizing || isGeneratingUserReply` 时禁用
- [x] 选择器下拉样式适配暗色主题（背景色与文字色与 ConfigPanel 一致）

## 父组件透传

- [x] `CharacterDialogueChat.tsx` 实现 `handleUserReplyPersonChange` 回调（调用 `updateConfig({ userReplyPerson: person })`）
- [x] 从 `characterConfig` 读取 `userReplyPerson` 字段
- [x] `<ChatInputBar>` JSX 中传入 `userReplyPerson` 和 `onUserReplyPersonChange` 两个新 props

## 测试

- [x] `buildUserReplySystemPrompt` 三种人称值的提示词输出正确
- [x] 不传 `person` 参数时向后兼容（现有测试全部通过）
- [x] `npm test` 全部通过，无新增编译错误

## 文档同步

- [x] 更新 `doc/04b-character-dialogue-chat-module.md` 中"AI 回复按钮与用户回复生成"章节，新增人称属性说明
