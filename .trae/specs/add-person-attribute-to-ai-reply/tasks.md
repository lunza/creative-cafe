# Tasks

## 类型与提示词层

- [x] Task 1: 扩展类型定义与 `buildUserReplySystemPrompt` 函数
  - [x] SubTask 1.1: 在 `CharacterDialogueChat.types.ts` 的 `CharacterSessionConfig` 接口新增 `userReplyPerson?: 'first' | 'second' | 'third'` 字段（含 JSDoc 注释说明持久化与默认值）
  - [x] SubTask 1.2: 在 `PromptBuilder.ts` 的 `buildUserReplySystemPrompt` 函数新增第 3 个可选参数 `person?: 'first' | 'second' | 'third'`
    - 默认值 `'first'`（在函数体内用 `const personValue = person || 'first';` 处理，保持签名可选向后兼容）
    - 根据 `personValue` 在"任务要求"段落末尾追加第 7 条人称视角约束：
      - `first`：`7. 以第一人称（"我"）视角生成回复，使用"我"作为自称`
      - `second`：`7. 以第二人称（"你"）视角生成回复，使用"你"来指代 ${userName} 自身（互动小说风格）`
      - `third`：`7. 以第三人称叙事视角生成回复，使用"${userName}"作为主语（小说叙事风格）`
    - 更新 JSDoc 注释，说明 `person` 参数的含义与默认值

## Hook 业务逻辑

- [x] Task 2: 在 `generateUserReply` 中读取并传递 `userReplyPerson`
  - [x] SubTask 2.1: 在 `CharacterDialogueChat.hooks.ts` 的 `generateUserReply` 函数中，读取 `characterConfig?.userReplyPerson`
  - [x] SubTask 2.2: 将读取到的 `userReplyPerson` 作为第 3 参数传给 `buildUserReplySystemPrompt(characterInfo, selectedPersona, userReplyPerson)`
  - [x] SubTask 2.3: 更新 `generateUserReply` 的 useCallback 依赖数组，确保 `characterConfig` 已包含（当前依赖数组已含 `characterConfig`，验证无需新增）

## ChatInputBar UI

- [x] Task 3: 在 ChatInputBar.tsx 中新增人称选择器
  - [x] SubTask 3.1: 扩展 `ChatInputBarProps` 接口，新增可选 props：
    - `userReplyPerson?: 'first' | 'second' | 'third'`
    - `onUserReplyPersonChange?: (person: 'first' | 'second' | 'third') => void`
  - [x] SubTask 3.2: 在组件参数解构中新增 `userReplyPerson` 和 `onUserReplyPersonChange`，`userReplyPerson` 默认值 `'first'`
  - [x] SubTask 3.3: 在 `else` 分支（非 streaming / 非 organizing）中，"AI回复"按钮**左侧**新增 `Select` 组件：
    - 导入 `Select` from `antd`
    - `size="small"`，`style={{ width: '110px' }}`
    - 三个 `Select.Option`：`first` → `第一人称（我）`、`second` → `第二人称（你）`、`third` → `第三人称（他/她）`
    - `value={userReplyPerson}`，`onChange={(v) => onUserReplyPersonChange?.(v as 'first' | 'second' | 'third')}`
    - `disabled={disabled || isStreaming || isOrganizing || isGeneratingUserReply}`
    - `marginRight: '4px'` 与 AI回复按钮间距
  - [x] SubTask 3.4: 调整 `Select` 的下拉样式以适配暗色主题（`popupClassName` 或 `dropdownStyle` 设置背景色与文字色，与现有 ConfigPanel 暗色风格一致）

## 父组件透传

- [x] Task 4: 在 CharacterDialogueChat.tsx 中连接人称选择器与持久化
  - [x] SubTask 4.1: 新增 `handleUserReplyPersonChange` useCallback，调用 `updateConfig({ userReplyPerson: person })` 持久化到 character session
  - [x] SubTask 4.2: 从 `characterConfig` 读取 `userReplyPerson` 字段（`characterConfig?.userReplyPerson`）
  - [x] SubTask 4.3: 在 `<ChatInputBar>` JSX 中传入新 props：
    - `userReplyPerson={characterConfig?.userReplyPerson}`
    - `onUserReplyPersonChange={handleUserReplyPersonChange}`

## 测试与验证

- [x] Task 5: 单元测试
  - [x] SubTask 5.1: 在 `__tests__/PromptBuilder.userReply.test.ts` 中新增测试用例验证人称参数：
    - `person='first'`（或不传）时，输出包含"以第一人称（"我"）视角生成回复"
    - `person='second'` 时，输出包含"以第二人称（"你"）视角生成回复"和"互动小说风格"
    - `person='third'` 时，输出包含"以第三人称叙事视角生成回复"和用户名作为主语
    - 不传 `person` 参数时行为与现有测试完全一致（向后兼容）
  - [x] SubTask 5.2: 运行 `npm test` 确认全部测试通过，无新增编译错误

# Task Dependencies

- Task 2 依赖 Task 1（使用新增的 `person` 参数）
- Task 4 依赖 Task 3（需要 ChatInputBar 新 props 就绪）
- Task 5 依赖 Task 1（测试 PromptBuilder 新参数）
- Task 1、Task 3 相互独立，可并行实施
