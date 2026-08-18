# Checklist

## 类型定义
- [x] `AIParameterConfig` 接口包含 `image_gen_enabled?: boolean` 字段
- [x] `AIParameterConfig` 接口包含 `image_gen_width?: number` 字段
- [x] `AIParameterConfig` 接口包含 `image_gen_height?: number` 字段
- [x] `ChatMessage` 接口包含 `generatedImage?: string` 字段
- [x] `ChatMessage` 接口包含 `isImageMessage?: boolean` 字段

## 控制面板配置区域
- [x] ConfigPanel 中新增"图片生成设置"区域，位于 ParameterPanel 下方
- [x] "是否开启图片生成" Switch 开关正常切换并持久化
- [x] "图片大小" Select 下拉提供至少 6 个预设尺寸选项（复用 SIZE_PRESETS）
- [x] 配置变更通过 `handleParameterChange` 写入 `character-session-<cardId>` localStorage
- [x] ConfigPanel 新增 props 正确传递（imageGenEnabled / imageGenWidth / imageGenHeight / onImageGenToggle / onImageGenSizeChange）

## "生成图片"按钮
- [x] 按钮位于"重新生成/从此版本重新生成"按钮右侧
- [x] 按钮使用 PictureOutlined 图标，视觉风格与现有 chat-action-btn 一致
- [x] 仅对 assistant 消息显示
- [x] 当 `image_gen_enabled` 为 false 时按钮禁用，Tooltip 提示"图片生成功能未开启"
- [x] 当 `isGeneratingImage` 为 true 时按钮显示 LoadingOutlined 并禁用
- [x] 按钮在流式生成/消息发送中状态下不显示或禁用

## 图片消息渲染
- [x] `isImageMessage` 为 true 时渲染图片内容（`<img>`）而非文本内容
- [x] 图片消息气泡样式适配图片展示（圆角、最大宽度限制、移除文本内边距）
- [x] 图片消息显示时间戳
- [x] 图片消息不显示编辑、继续对话按钮（仅保留复制和生成图片按钮）
- [x] 图片在对话流中按比例缩放，不破坏布局

## 上下文 Tag 生成与审计
- [x] 点击"生成图片"按钮后自动提取当前对话上下文内容
- [x] 调用 `ai:generateTraitPrompts` IPC 生成上下文 tag，传入对话上下文作为 prompt
- [x] 生成的 tag 经过 L0-L5 审计链验证（用户同义词映射 → 标签库匹配 → 别名 → 颜色拆分 → KNN → AI 兜底）
- [x] 上下文 tag 与角色特征 tag（characterTraitStore 中 enabled=true 的特征）合并
- [x] 合并后执行大小写不敏感去重

## SD 图片生成调用
- [x] 使用 `buildAssetPromptTemplate('general', null)` 生成提示词模板（`{traits}, {camera}, high quality, best quality`）
- [x] 构建 SD options 包含合并后的 characterTraits、角色 LoRA、宽高参数
- [x] 宽高从配置项 `image_gen_width` / `image_gen_height` 读取（默认 1024×1024）
- [x] 调用 `sd:generateTxt2Img` IPC 执行生成
- [x] SD WebUI 未连接时显示错误提示，不执行生成

## 结果展示与错误处理
- [x] 生成成功后在当前 AI 消息后插入图片消息（isImageMessage: true, generatedImage: dataUrl）
- [x] 图片消息带时间戳和"生成图片"标识
- [x] 生成过程中显示加载状态（按钮 LoadingOutlined + 对话流中的生成提示）
- [x] 生成失败时显示 antd message.error 错误提示，包含错误原因
- [x] 生成完成后按钮恢复可点击状态

## 组件连接
- [x] `isGeneratingImage` state 正确传递给 ChatMessageBubble
- [x] `imageGenEnabled` 配置正确传递给 ChatMessageBubble
- [x] `handleGenerateImage` 方法正确传递给 ChatMessageBubble 的 onGenerateImage prop
- [x] 图片消息在 renderMessageBubble 中正确渲染
- [x] 图片消息不影响 AI 回复序号计算（aiSequenceNumber）

## 兼容性
- [x] 图片生成功能关闭时所有现有功能（重新生成、继续对话、编辑、版本管理）行为不变
- [x] "生成图片"按钮在操作按钮区正确排列，不溢出或遮挡其他按钮
- [x] 生成的图片在不同屏幕尺寸下按比例缩放显示
- [x] 控制面板"图片生成设置"区域在不同屏幕尺寸下布局合理
