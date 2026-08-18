# Tasks

- [x] Task 1: 扩展类型定义
  - [x] SubTask 1.1: 在 `CharacterDialogueChat.types.ts` 的 `AIParameterConfig` 接口中新增 `image_gen_enabled?: boolean`、`image_gen_width?: number`、`image_gen_height?: number` 字段
  - [x] SubTask 1.2: 在 `ChatMessage` 接口中新增 `generatedImage?: string` 字段（base64 data URL 或文件路径），用于在对话流中展示生成的图片
  - [x] SubTask 1.3: 在 `ChatMessage` 接口中新增 `isImageMessage?: boolean` 标记字段，区分图片消息与文本消息

- [x] Task 2: 开发控制面板"图片生成设置"配置区域
  - [x] SubTask 2.1: 在 `ConfigPanel.tsx` 中新增"图片生成设置"区域（位于 ParameterPanel 下方、记忆与上下文增强区域之前），包含区域标题和分隔线
  - [x] SubTask 2.2: 添加"是否开启图片生成" Switch 开关组件，绑定 `image_gen_enabled` 配置项
  - [x] SubTask 2.3: 添加"图片大小" Select 下拉组件，复用 `SizeSelector.tsx` 中的 `SIZE_PRESETS` 预设尺寸列表（头像/表情 512×512、全身立绘 512×768、竖版高清 768×1024、方图高清 1024×1024、竖版超清 1024×1536、横版高清 1536×1024）
  - [x] SubTask 2.4: 在 `ConfigPanel.tsx` 的 props 中新增 `imageGenEnabled`、`imageGenWidth`、`imageGenHeight`、`onImageGenToggle`、`onImageGenSizeChange` 属性
  - [x] SubTask 2.5: 在 `CharacterDialogueChat.tsx` 中将配置项连接到 `ConfigPanel`，通过 `handleParameterChange` 持久化到 `character-session-<cardId>` localStorage

- [x] Task 3: 在 ChatMessageBubble 中新增"生成图片"按钮
  - [x] SubTask 3.1: 在 `ChatMessageBubble.tsx` 的 props 中新增 `onGenerateImage?: (messageId: string) => void`、`imageGenEnabled?: boolean`、`isGeneratingImage?: boolean` 属性
  - [x] SubTask 3.2: 在 `actionButtons` 区域中，"重新生成/从此版本重新生成"按钮（ReloadOutlined）之后，新增"生成图片"按钮（使用 PictureOutlined 图标）
  - [x] SubTask 3.3: 按钮显隐逻辑：仅对 assistant 消息显示，与"重新生成"按钮共享 `showFullActions` / `showRegenerateOnly` 的显示条件
  - [x] SubTask 3.4: 按钮禁用逻辑：当 `imageGenEnabled` 为 false 时按钮禁用，Tooltip 提示"图片生成功能未开启"；当 `isGeneratingImage` 为 true 时显示 LoadingOutlined 并禁用
  - [x] SubTask 3.5: 在 `ChatMessageBubble.css` 中添加"生成图片"按钮的样式，与现有 `chat-action-btn` 保持一致的设计语言

- [x] Task 4: 在 ChatMessageBubble 中支持图片消息渲染
  - [x] SubTask 4.1: 当 `message.isImageMessage` 为 true 且 `message.generatedImage` 有值时，渲染图片内容（`<img>` 标签）替代文本内容
  - [x] SubTask 4.2: 图片消息气泡的样式调整为适配图片展示（移除文本内边距，图片圆角裁剪，最大宽度限制）
  - [x] SubTask 4.3: 图片消息仍显示时间戳，但不显示编辑、重新生成等文本操作按钮（仅保留复制和"生成图片"按钮）
  - [x] SubTask 4.4: 在 `ChatMessageBubble.css` 中添加图片消息气泡的样式

- [x] Task 5: 实现对话上下文 Tag 生成与审计流程
  - [x] SubTask 5.1: 在 `CharacterDialogueChat.tsx` 中新增 `handleGenerateImage` 方法，接收 `messageId` 参数
  - [x] SubTask 5.2: 构建 conversation context prompt：提取当前对话中最近 N 条消息（默认全部已发送消息）的内容，拼接为上下文摘要字符串
  - [x] SubTask 5.3: 调用 `window.electronAPI.ai.generateTraitPrompts({ prompt: conversationContext, baseTraits: existingTraitTexts })` 生成上下文 tag，复用 L0-L5 审计链
  - [x] SubTask 5.4: 从 `characterTraitStore` 获取当前角色已启用的特征 tag（`enabled=true`），提取 `{ text, weight }` 数组
  - [x] SubTask 5.5: 将上下文生成的 tag 与角色特征 tag 合并，执行大小写不敏感去重（参考 `AssetGenerateModal` 中 `enabledTraitTexts` 的去重逻辑）
  - [x] SubTask 5.6: 构建 SD 提示词模板：使用 `buildAssetPromptTemplate('general', null)` 生成 `{traits}, {camera}, high quality, best quality` 模板（复用 `PromptBuilder.ts`）

- [x] Task 6: 实现 SD 图片生成调用与结果展示
  - [x] SubTask 6.1: 加载 SD 配置（`setting.load()` 获取 endpoint 和默认参数），检测 SD WebUI 状态（`sd.checkStatus(endpoint)`）
  - [x] SubTask 6.2: 构建 `buildSdOptions()`：传入合并后的 `characterTraits`、角色 LoRA（`loadCharacterLoras`）、宽高（从配置项 `image_gen_width` / `image_gen_height` 读取，默认 1024×1024）、ADetailer/Hires.fix 等参数
  - [x] SubTask 6.3: 调用 `window.electronAPI.sd.generateTxt2Img({ endpoint, prompt, negativePrompt, options })` 执行生成
  - [x] SubTask 6.4: 生成成功后将 base64 转 data URL，构造一条新的 `ChatMessage`（`isImageMessage: true`，`generatedImage: dataUrl`），插入到对话消息列表中当前 AI 消息之后
  - [x] SubTask 6.5: 生成失败时显示 antd `message.error` 错误提示，包含错误原因
  - [x] SubTask 6.6: 生成过程中设置 `isGeneratingImage` 状态为 true，完成后重置为 false

- [x] Task 7: 在 CharacterDialogueChat 中连接所有组件
  - [x] SubTask 7.1: 新增 `isGeneratingImage` state，传递给 `ChatMessageBubble` 的 `isGeneratingImage` prop
  - [x] SubTask 7.2: 新增 `imageGenEnabled` 计算属性（从 `characterConfig?.customParameters?.image_gen_enabled` 读取），传递给 `ChatMessageBubble`
  - [x] SubTask 7.3: 将 `handleGenerateImage` 方法传递给 `ChatMessageBubble` 的 `onGenerateImage` prop
  - [x] SubTask 7.4: 在 `renderMessageBubble` 函数中传递新增的 props
  - [x] SubTask 7.5: 确保图片消息（`isImageMessage: true`）在对话流中正确渲染，不影响消息序号计算

- [x] Task 8: 样式优化与兼容性验证
  - [x] SubTask 8.1: 验证"生成图片"按钮在不同消息状态（最新版本/历史版本/流式中）下的显隐正确性
  - [x] SubTask 8.2: 验证图片消息在对话流中的布局不破坏现有消息排列
  - [x] SubTask 8.3: 验证控制面板"图片生成设置"区域在不同屏幕尺寸下的布局合理性
  - [x] SubTask 8.4: 验证功能关闭时所有现有功能不受影响

# Task Dependencies
- Task 2 depends on Task 1（类型定义先行）
- Task 3 depends on Task 1（类型定义先行）
- Task 4 depends on Task 1（类型定义先行）
- Task 5 depends on Task 1（类型定义先行）
- Task 6 depends on Task 5（tag 生成流程先行）
- Task 7 depends on Task 2, Task 3, Task 4, Task 5, Task 6（所有组件就绪后连接）
- Task 8 depends on Task 7（全部连接后验证）
- Task 2, Task 3, Task 4 可并行开发（均仅依赖 Task 1）
