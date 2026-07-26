# 角色卡表情管理系统 Spec

## Why
当前角色卡对话仅能显示角色卡 PNG 作为静态头像，AI 回复的情感语境无法通过头像变化直观传达；现有的「Emoji 增强模式」只是在文本中插入 emoji 字符，表现力有限且与角色形象脱节。需要一套完整的表情管理系统，让用户为每个角色卡上传多种情绪表情图片，AI 在回复时根据语境动态切换头像表情，显著增强角色扮演的沉浸感与表现力。

## What Changes
- **新增**：角色卡表情包存储层（每个角色卡独立的表情数据目录 + manifest 清单）
- **新增**：30 种预置情绪类别（基于 GoEmotions 分类 + 默认 + 快乐），含中英文键名映射
- **新增**：用户自定义情绪类别扩展（仅通过用户上传实现，禁止系统自动生成）
- **新增**：图片裁剪工具组件（支持放大/缩小/自由裁剪/区域截取），新增依赖 `react-easy-crop`
- **新增**：表情管理 UI（`ExpressionManagerModal`），从 `ChatHeader` 入口打开
- **新增**：AI 回复情绪字段解析（`<<<EXPRESSION>>>key<<<END_EXPRESSION>>>` 标记，沿用 suggestedOptions 解析模式）
- **新增**：`ChatMessage.emotion` 字段，持久化到聊天记录
- **新增**：表情显示开关 `expression_display`，**代替**现有的「Emoji 增强模式」开关
- **新增**：`ChatMessageBubble` 表情图像渲染逻辑（自定义 > 预置 > 默认头像三级回退）
- **新增**：表情图像预加载机制
- **新增**：主进程 `expressionService` + IPC 处理器
- **BREAKING**：移除 ParameterPanel 中的「Emoji 增强模式」开关 UI（保留 `buildEmojiEnhancedPrompt` 函数但不再调用；`emoji_enhanced` 字段保留供向后兼容但不再生效）

## Impact
- **Affected specs**：`add-assist-mode-options`（解析模式参照）、`fix-ai-response-length-degradation`（系统提示词拼接顺序）
- **Affected code**:
  - `src/shared/types/chat.types.ts` — 新增 `emotion?: string` 字段
  - `src/renderer/components/Character/CharacterDialogueChat/CharacterDialogueChat.types.ts` — 同步 `emotion` 字段、新增 `expression_display` 参数
  - `src/renderer/components/Character/CharacterDialogueChat/CharacterDialogueChat.hooks.ts` — 注入 `buildExpressionPrompt`、解析情绪标记、写入 `ChatMessage.emotion`
  - `src/renderer/components/Character/CharacterDialogueChat/PromptBuilder.ts` — 新增 `buildExpressionPrompt`、新增 `EMOTION_PRESETS` 常量
  - `src/renderer/components/Character/CharacterDialogueChat/ParameterPanel.tsx` — 移除 Emoji 开关、新增「开启表情」开关
  - `src/renderer/components/Character/CharacterDialogueChat/ConfigPanel.tsx` — 透传 `expressionDisplay` / `onExpressionDisplayToggle`
  - `src/renderer/components/Character/CharacterDialogueChat/CharacterDialogueChat.tsx` — 透传新参数、加载表情包
  - `src/renderer/components/Character/CharacterDialogueChat/ChatMessageBubble.tsx` — 按情绪解析并渲染表情图像
  - `src/renderer/components/Character/CharacterDialogueChat/ChatHeader.tsx` — 新增「表情管理」入口按钮
  - `src/main/services/expressionService.ts` — **新建**，表情包存储/读取/删除
  - `src/main/ipc/handlers/expressionHandlers.ts` — **新建**，IPC 通道
  - `src/renderer/components/Character/CharacterDialogueChat/ExpressionManagerModal.tsx` — **新建**，表情管理弹窗
  - `src/renderer/components/Character/CharacterDialogueChat/ImageCropperModal.tsx` — **新建**，图片裁剪弹窗
  - `src/renderer/stores/expressionStore.ts` — **新建**，Zustand 表情状态与预加载缓存
  - `src/preload/` — 暴露 `expression.*` IPC API
  - `package.json` — 新增 `react-easy-crop` 依赖

## ADDED Requirements

### Requirement: 预置情绪类别
系统 SHALL 提供 30 种预置情绪类别，每种含唯一英文键与中文标签。预置类别不可删除。

#### Scenario: 预置情绪清单
- **GIVEN** 系统初始化表情包
- **WHEN** 读取预置情绪列表
- **THEN** 返回包含以下 30 项：default(默认)、admiration(钦佩)、amusement(愉悦)、anger(愤怒)、annoyance(恼怒)、approval(赞同)、caring(关切)、confusion(困惑)、curiosity(好奇)、desire(渴望)、disappointment(失望)、disapproval(不赞同)、disgust(厌恶)、embarrassment(尴尬)、excitement(兴奋)、fear(恐惧)、gratitude(感激)、grief(悲痛)、joy(喜悦)、love(喜爱)、nervousness(紧张)、neutral(中性)、optimism(乐观)、pride(自豪)、realization(顿悟)、relief(宽慰)、remorse(懊悔)、sadness(悲伤)、surprise(惊讶)、cheerfulness(快乐)

### Requirement: 表情数据隔离
系统 SHALL 为每个角色卡维护独立的表情包存储空间，不同角色卡的表情数据相互独立、不可共享。

#### Scenario: 存储路径隔离
- **GIVEN** 角色 A（characterCardId = "charA"）与角色 B（characterCardId = "charB"）
- **WHEN** 分别上传 joy 表情
- **THEN** 角色 A 的 joy 表情存储在 `data/character-expressions/{charA}/joy.png`，角色 B 的存储在 `data/character-expressions/{charB}/joy.png`，两者互不影响

### Requirement: 用户上传实现表情
系统 SHALL 仅通过用户上传方式实现表情图像，禁止系统自动生成任何表情图像。

#### Scenario: 上传流程
- **GIVEN** 用户在表情管理弹窗中点击某个情绪的上传按钮
- **WHEN** 用户选择本地图片文件
- **THEN** 系统打开图片裁剪弹窗，用户裁剪后保存；系统不提供任何「自动生成」「AI 生成」入口

### Requirement: 默认表情回退
系统 SHALL 在用户未上传特定情绪表情时，自动显示角色卡默认表情（即角色卡 PNG 图像 = 当前对话的 avatarPath）。

#### Scenario: 未上传时回退
- **GIVEN** 用户未为 joy 情绪上传表情
- **WHEN** AI 回复携带 emotion = "joy"
- **THEN** 聊天气泡头像显示角色卡默认图像（avatarPath），而非空白或占位图

### Requirement: 图片裁剪工具
系统 SHALL 提供完整的图片裁剪工具，支持放大、缩小、自由裁剪、区域截取操作，确保用户能从全身图等较大图片中精确截取面部图像。

#### Scenario: 从全身图截取面部
- **GIVEN** 用户上传一张全身角色图（如 1920×1080）
- **WHEN** 用户在裁剪弹窗中放大图像至 200%、平移至面部区域、选择 256×256 裁剪框、确认裁剪
- **THEN** 系统输出 256×256 的面部裁剪图，保存为 PNG 格式

#### Scenario: 缩放与自由裁剪
- **GIVEN** 用户在裁剪弹窗中
- **WHEN** 用户拖动缩放滑块（0.5x ~ 5x）或滚轮缩放、拖动裁剪框自由调整位置与大小
- **THEN** 裁剪预览实时更新；确认时输出裁剪框内的图像

### Requirement: 图像格式统一与压缩
系统 SHALL 将所有上传的表情图像统一处理为 PNG 或 JPG/JPEG 格式，并进行适当压缩以优化加载性能，同时保留图像清晰度。

#### Scenario: 格式与尺寸约束
- **GIVEN** 用户上传任意格式图片（WebP/BMP/GIF 等）
- **WHEN** 裁剪保存
- **THEN** 输出为 PNG 格式；长边超过 512px 时按比例缩放至 512px；文件大小通常 < 200KB

### Requirement: 自定义情绪扩展
系统 SHALL 支持用户为单个角色卡添加自定义情绪类别，自定义情绪的英文键由用户输入（仅允许小写字母/数字/下划线），中文标签由用户填写。

#### Scenario: 添加自定义情绪
- **GIVEN** 用户在表情管理弹窗点击「添加自定义情绪」
- **WHEN** 用户输入英文键 "shyness" 与标签 "害羞"
- **THEN** 该角色卡 manifest 的 customEmotions 增加 { key: "shyness", label: "害羞" }；该情绪出现在表情网格中可上传图像

#### Scenario: 删除自定义情绪
- **GIVEN** 角色卡存在自定义情绪 "shyness"
- **WHEN** 用户点击删除
- **THEN** manifest 移除该情绪、删除对应图像文件；预置情绪不可删除

### Requirement: 显示优先级
系统 SHALL 按以下优先级解析表情图像：自定义情绪表情 > 预置情绪表情 > 默认头像。

#### Scenario: 自定义优先于预置
- **GIVEN** 用户为 joy 情绪上传了自定义表情
- **WHEN** AI 回复携带 emotion = "joy"
- **THEN** 显示用户上传的 joy 表情图像，而非任何系统预置图

### Requirement: 表情显示开关
系统 SHALL 在对话界面 AI 参数面板中提供「开启表情」切换控件，**代替**原有的「Emoji 增强模式」开关。

#### Scenario: 开启表情
- **GIVEN** 用户在 ParameterPanel 中切换「开启表情」为 ON
- **WHEN** AI 生成回复
- **THEN** 系统提示词注入 `buildExpressionPrompt`，要求 AI 在回复末尾输出情绪标记；解析后写入 `ChatMessage.emotion`；聊天气泡按情绪渲染对应表情

#### Scenario: 关闭表情
- **GIVEN** 「开启表情」为 OFF
- **WHEN** AI 生成回复
- **THEN** 不注入表情提示词；不解析情绪标记；聊天气泡显示默认头像；`emoji_enhanced` 提示词也不再注入（已被代替）

### Requirement: AI 情绪字段输出
系统 SHALL 通过系统提示词引导 AI 在回复正文末尾输出结构化情绪标记，由系统解析匹配后渲染对应表情，AI 仅输出情绪键名，不直接渲染图像。

#### Scenario: 情绪标记格式
- **GIVEN** 「开启表情」为 ON
- **WHEN** AI 回复内容为 `"今天天气真好呢。" 笐笭地笑` + 末尾 `<<<EXPRESSION>>>joy<<<END_EXPRESSION>>>`
- **THEN** 系统解析出 emotion = "joy"；从显示内容中剥离该标记；`ChatMessage.emotion = "joy"`；气泡渲染 joy 表情

#### Scenario: 多格式容错匹配
- **GIVEN** AI 输出的情绪标记可能缺少结束标记或大小写不一
- **WHEN** 系统解析
- **THEN** 依次尝试：`<<<EXPRESSION>>>key<<<END_EXPRESSION>>>` → `<<<EXPRESSION>>>key` 到末尾 → 大小写不敏感匹配；解析失败时 emotion 置空并回退默认头像

### Requirement: 表情预加载
系统 SHALL 在用户开启表情功能且打开对话时，预加载该角色卡所有已上传的表情图像至内存缓存，避免切换表情时卡顿。

#### Scenario: 进入对话预加载
- **GIVEN** 角色 A 已上传 5 个表情，用户开启「开启表情」并打开对话
- **WHEN** 对话界面挂载
- **THEN** 系统 IPC 拉取 manifest 并预加载所有图像 URL 至 expressionStore 缓存；后续情绪切换直接从缓存读取，无 IPC 延迟

### Requirement: 回退机制
系统 SHALL 在无法识别情绪或对应情绪无可用表情时，显示角色卡默认表情。

#### Scenario: 未知情绪回退
- **GIVEN** AI 输出 emotion = "unknown_xyz"（不在预置也不在自定义清单中）
- **WHEN** 系统解析渲染
- **THEN** 回退显示角色卡默认头像（avatarPath）

#### Scenario: 情绪标记缺失回退
- **GIVEN** AI 回复未包含情绪标记（或解析失败）
- **WHEN** 系统处理
- **THEN** `ChatMessage.emotion` 为 undefined；气泡显示默认头像

## MODIFIED Requirements

### Requirement: ChatMessage 数据模型
`ChatMessage` 接口新增可选字段 `emotion?: string`，用于持久化 AI 回复携带的情绪键名，使表情状态跨会话保留。

```typescript
export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp: number;
  status?: 'sending' | 'sent' | 'error';
  speakerName?: string;
  suggestedOptions?: string[];
  /** AI 回复情绪键名（Spec: add-character-expression-system），用于驱动表情图像渲染 */
  emotion?: string;
  versionInfo?: ChatMessageVersionInfo;
}
```

### Requirement: AIParameterConfig
`AIParameterConfig` 接口新增 `expression_display?: boolean` 字段（默认关闭）；`emoji_enhanced` 字段保留但不再生效（向后兼容，迁移期保留）。

```typescript
export interface AIParameterConfig {
  // ... 既有字段 ...
  /** @deprecated 已被 expression_display 代替，不再生效 */
  emoji_enhanced?: boolean;
  /**
   * 表情显示开关。
   * 开启后注入 buildExpressionPrompt，要求 AI 在回复末尾输出情绪标记；
   * 解析后写入 ChatMessage.emotion 并驱动表情图像渲染。
   * 默认关闭（undefined 视为关闭）。
   */
  expression_display?: boolean;
  // ... 既有字段 ...
}
```

### Requirement: ParameterPanel AI 参数面板
移除「Emoji 增强模式」开关区块；在原位置新增「开启表情」开关区块，复用相同的 Switch UI 样式，绑定 `expressionDisplay` / `onExpressionDisplayToggle` props。

## REMOVED Requirements

### Requirement: Emoji 增强模式开关 UI
**Reason**: 被「开启表情」开关代替。表情图像比文本 emoji 更贴合角色形象，是更强的表现力升级。
**Migration**: `buildEmojiEnhancedPrompt` 函数保留在 PromptBuilder 中但不再被调用；`emoji_enhanced` 配置字段保留以避免旧配置读取报错，但不再产生任何效果。用户应改用「开启表情」开关。
