# AI 回复人称属性 Spec

## Why

当前"AI回复"按钮生成的用户回复始终采用第一人称（"我"）视角，无法满足不同角色扮演场景的叙事需求。部分用户偏好第三人称小说式叙事（"他走向她..."），或第二人称互动小说式表达（"你走向她..."）。本 spec 为"AI回复"按钮新增人称属性选择器，支持第一/第二/第三人称切换，让生成的用户回复适配不同 RP 风格。

## What Changes

### UI 层
- 在 `ChatInputBar.tsx` 中"AI回复"按钮**左侧**新增人称选择器（Ant Design `Select` 紧凑模式）
  - 三个选项：`第一人称（我）` / `第二人称（你）` / `第三人称（他/她）`
  - 默认值：`第一人称`（向后兼容现有行为）
  - 紧凑样式：`size="small"`，宽度约 110px，与圆形按钮在同一行
- 人称选择器在 `isStreaming` / `isOrganizing` / `isGeneratingUserReply` 时禁用
- 选择变化时立即回调父组件持久化，无需"保存设置"按钮

### 业务逻辑层
- 在 `CharacterDialogueChat.types.ts` 的 `CharacterSessionConfig` 接口新增 `userReplyPerson?: 'first' | 'second' | 'third'` 字段
  - 持久化到 `character-session-<cardId>` localStorage（复用现有 `useCharacterConfig` 的 `updateConfig` 流）
  - 默认 `undefined` 等同于 `'first'`（向后兼容）
- 在 `useCharacterDialogueChat` hook 的 `generateUserReply` 函数中读取 `characterConfig?.userReplyPerson`，传入 `buildUserReplySystemPrompt`

### 提示词层
- 在 `PromptBuilder.ts` 的 `buildUserReplySystemPrompt` 函数新增第 3 个可选参数 `person?: 'first' | 'second' | 'third'`
  - 默认 `'first'`（向后兼容，不传时行为不变）
  - 根据人称值在"任务要求"段落注入人称视角约束：
    - `first`：`以第一人称（"我"）视角生成回复，使用"我"作为自称`
    - `second`：`以第二人称（"你"）视角生成回复，使用"你"来指代 ${userName} 自身（互动小说风格）`
    - `third`：`以第三人称叙事视角生成回复，使用"${userName}"作为主语（小说叙事风格）`

### 状态机
- 人称选择器在以下状态时禁用：`isStreaming=true` / `isOrganizing=true` / `isGeneratingUserReply=true`
- 切换人称不会立即触发生成，仅影响下次点击"AI回复"按钮时的提示词

## Impact

- **Affected specs**: `add-ai-user-reply-button`（扩展其"AI回复"按钮功能，向后兼容）
- **Affected code**:
  - `src/renderer/components/Character/CharacterDialogueChat/CharacterDialogueChat.types.ts`（`CharacterSessionConfig` 新增 `userReplyPerson` 字段）
  - `src/renderer/components/Character/CharacterDialogueChat/PromptBuilder.ts`（`buildUserReplySystemPrompt` 新增 `person` 参数）
  - `src/renderer/components/Character/CharacterDialogueChat/CharacterDialogueChat.hooks.ts`（`generateUserReply` 读取并传递 `userReplyPerson`）
  - `src/renderer/components/Character/CharacterDialogueChat/ChatInputBar.tsx`（新增人称选择器 UI + props）
  - `src/renderer/components/Character/CharacterDialogueChat/CharacterDialogueChat.tsx`（透传人称值与回调）

## ADDED Requirements

### Requirement: AI 回复人称选择器
系统 SHALL 在 ChatInputBar 的"AI回复"按钮左侧提供人称选择器，支持第一人称 / 第二人称 / 第三人称三种叙事视角切换。

#### Scenario: 默认人称
- **WHEN** 用户首次打开对话窗口且未配置过 `userReplyPerson`
- **THEN** 人称选择器显示"第一人称（我）"（默认值），生成的回复采用第一人称视角

#### Scenario: 切换人称
- **WHEN** 用户在下拉选择器中选择"第三人称（他/她）"
- **THEN** 选择值立即持久化到 `character-session-<cardId>` localStorage 的 `userReplyPerson` 字段
- **AND** 下次点击"AI回复"按钮时，生成的回复采用第三人称叙事视角（使用用户名作为主语）

#### Scenario: 人称选择器禁用
- **WHEN** `isStreaming=true` 或 `isOrganizing=true` 或 `isGeneratingUserReply=true`
- **THEN** 人称选择器进入禁用态，无法切换（避免生成中改变人称导致提示词不一致）

### Requirement: 人称视角提示词注入
系统 SHALL 通过 `buildUserReplySystemPrompt` 的 `person` 参数在系统提示的"任务要求"段落注入人称视角约束。

#### Scenario: 第一人称提示词
- **WHEN** 调用 `buildUserReplySystemPrompt(characterInfo, persona, 'first')`
- **THEN** 系统提示"任务要求"段落包含：`以第一人称（"我"）视角生成回复，使用"我"作为自称`

#### Scenario: 第二人称提示词
- **WHEN** 调用 `buildUserReplySystemPrompt(characterInfo, persona, 'second')`
- **THEN** 系统提示"任务要求"段落包含：`以第二人称（"你"）视角生成回复，使用"你"来指代 ${userName} 自身（互动小说风格）`

#### Scenario: 第三人称提示词
- **WHEN** 调用 `buildUserReplySystemPrompt(characterInfo, persona, 'third')`
- **THEN** 系统提示"任务要求"段落包含：`以第三人称叙事视角生成回复，使用"${userName}"作为主语（小说叙事风格）`

#### Scenario: 默认值向后兼容
- **WHEN** 调用 `buildUserReplySystemPrompt(characterInfo, persona)` 不传 `person` 参数
- **THEN** 等同于 `person='first'`，行为与现有实现完全一致（向后兼容）

## MODIFIED Requirements

### Requirement: buildUserReplySystemPrompt 函数签名
`buildUserReplySystemPrompt` 新增第 3 个可选参数：
```typescript
export function buildUserReplySystemPrompt(
  characterInfo: CharacterInfoForPrompt,
  persona: UserPersona,
  person?: 'first' | 'second' | 'third'  // 新增，默认 'first'
): string
```
- 不传 `person` 或 `person='first'` 时，行为与现有实现完全一致（向后兼容）
- `person='second'` 或 `person='third'` 时，在"任务要求"段落末尾追加人称视角约束条目

### Requirement: CharacterSessionConfig 接口
`CharacterSessionConfig` 新增可选字段：
```typescript
userReplyPerson?: 'first' | 'second' | 'third';
```
- 持久化到 `character-session-<cardId>` localStorage
- 默认 `undefined` 等同于 `'first'`

### Requirement: ChatInputBar 组件接口
`ChatInputBarProps` 新增以下可选 props：
- `userReplyPerson?: 'first' | 'second' | 'third'`：当前选中的人称值
- `onUserReplyPersonChange?: (person: 'first' | 'second' | 'third') => void`：人称切换回调

### Requirement: generateUserReply 函数
`generateUserReply` 在调用 `buildUserReplySystemPrompt` 时传入 `characterConfig?.userReplyPerson` 作为第 3 参数。
