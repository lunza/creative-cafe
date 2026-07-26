# Checklist

## 数据层与类型
- [x] `expressionService.ts` 实现了表情包目录管理（`data/character-expressions/{characterCardId}/`），目录不存在时自动创建
- [x] `expressionService.ts` 实现了 manifest.json 读写，manifest 结构含 `characterCardId` / `expressions: Record<key, {type, image}>` / `customEmotions: Array<{key, label}>`
- [x] `expressionHandlers.ts` 注册了 6 个 IPC 通道（list / saveImage / deleteImage / addCustomEmotion / removeCustomEmotion / getImagePath）
- [x] `electronAPI.expression.*` API 在 preload 中正确暴露，类型声明齐全
- [x] `ChatMessage.emotion?: string` 字段在 `src/shared/types/chat.types.ts` 与 `CharacterDialogueChat.types.ts` 两处同步新增
- [x] `AIParameterConfig.expression_display?: boolean` 字段已新增；`emoji_enhanced` 字段添加 `@deprecated` 注释

## 预置情绪与提示词
- [x] `EMOTION_PRESETS` 常量包含 30 项，中英文键名映射完整（含 default / admiration / amusement / anger / annoyance / approval / caring / confusion / curiosity / desire / disappointment / disapproval / disgust / embarrassment / excitement / fear / gratitude / grief / joy / love / nervousness / neutral / optimism / pride / realization / relief / remorse / sadness / surprise / cheerfulness）
- [x] `buildExpressionPrompt` 函数要求 AI 在回复末尾输出 `<<<EXPRESSION>>>key<<<END_EXPRESSION>>>` 标记，并约束 key 必须来自传入的 availableEmotionKeys 列表
- [x] `parseExpressionFromContent` 函数支持多格式容错匹配（完整标记 / 缺结束标记 / 大小写不敏感），返回 `{ emotion, cleanedContent }`

## 图片裁剪工具
- [x] `react-easy-crop` 依赖已添加到 package.json
- [x] `ImageCropperModal` 支持缩放滑块（0.5x~5x）、滚轮缩放、自由裁剪框拖动与调整大小
- [x] 裁剪输出为 PNG data URL；长边超过 512px 时按比例缩放
- [x] 弹窗 UI 风格与 CharacterEditModal 一致（暗色主题、antd 组件）

## 表情管理 UI
- [x] `expressionStore` 实现 loadExpressions / saveExpression / deleteExpression / addCustomEmotion / removeCustomEmotion / resolveExpressionImage 六个 action
- [x] `ExpressionManagerModal` 渲染 30 个预置情绪 + 自定义情绪网格，每个格子显示缩略图或「未上传」占位
- [x] 上传流程：文件选择 → ImageCropperModal 裁剪 → saveExpression → 网格刷新
- [x] 「添加自定义情绪」表单校验英文键格式 `^[a-z][a-z0-9_]*$` 且不与预置重复
- [x] 删除预置情绪仅删除图像；删除自定义情绪同时移除 manifest 条目；均有二次确认
- [x] `ChatHeader` 新增「表情管理」按钮，点击打开 ExpressionManagerModal

## AI 回复情绪解析
- [x] hooks.ts 中 `buildEmojiEnhancedPrompt` 调用已移除；`expression_display === true` 时调用 `buildExpressionPrompt`
- [x] `availableEmotionKeys` 合并 EMOTION_PRESETS 全部 key + 当前角色卡 customEmotions key
- [x] AI 回复后处理段调用 `parseExpressionFromContent`，剥离标记、写入 `ChatMessage.emotion`
- [x] `emotionStripped` 标志已纳入内容保护检查的容差跳过逻辑（避免 UI 卡死）
- [x] 未开启 expression_display 时，不注入提示词、不解析标记、emotion 字段为 undefined

## 表情渲染
- [x] `ChatMessageBubble` 新增 `expressionImage?: string` prop
- [x] 头像渲染优先级：expressionImage > avatarPath > 首字母占位
- [x] 流式消息期间使用默认头像，流式完成后切换为表情图像
- [x] 未知情绪 / 未上传表情 / emotion 缺失时均回退到默认头像（avatarPath）

## 参数面板开关
- [x] ParameterPanel 移除「Emoji 增强模式」开关区块
- [x] ParameterPanel 在原位置新增「开启表情」开关，Tooltip 说明需先上传表情图片
- [x] ConfigPanel 正确透传 `expressionDisplay` / `onExpressionDisplayToggle`
- [x] CharacterDialogueChat.tsx 计算 expressionDisplay 并通过 onExpressionDisplayToggle 回调持久化到 customParameters
- [x] 默认关闭（undefined 视为关闭）

## 预加载与性能
- [x] `expressionDisplay === true` 且 characterCardId 变化时，自动调用 loadExpressions
- [x] loadExpressions 对所有已上传图像路径创建 `new Image()` 预加载
- [x] ExpressionManagerModal 保存/删除后刷新缓存
- [x] 切换表情无可见卡顿（本地文件直读 + 预加载缓存）

## 数据隔离与回退
- [x] 不同角色卡的表情数据存储在各自目录，互不共享
- [x] 默认表情 = 角色卡 PNG（avatarPath），未上传时自动回退
- [x] 自定义情绪表情优先级 > 预置 > 默认头像
- [x] 表情图像仅通过用户上传实现，无任何「自动生成」入口

## CharacterEditModal 入口（Task 15 - 用户反馈补充）
- [x] `CharacterEditModal.tsx` 导入 `ExpressionManagerModal` + `SmileOutlined` + `Alert`
- [x] Tabs items 末尾新增 `expressions` tab，label 为 `<SmileOutlined /> 表情管理`
- [x] tab 内容：`editingItem.path` 存在时显示说明 + 「打开表情管理」按钮；不存在时显示「请先保存角色卡」警告
- [x] 在 Modal 外层渲染 `ExpressionManagerModal`，传入正确的 characterCardId / characterName / avatarPath
- [x] 文档标注【重点标记】（用户反馈原入口仅位于对话头部不易发现）

## 文档
- [x] `docs/PROJECT_DOCUMENTATION_NEW.md` 新增「表情管理系统」小节
- [x] `CODE_WIKI.md` 新增表情系统条目
- [x] `CHANGELOG.md` 顶部新增条目，标注 BREAKING（移除 Emoji 增强模式开关）

## 回归
- [x] 既有 suggestedOptions 解析未被破坏
- [x] 既有 think 标签剥离未被破坏
- [x] 既有 emoji_enhanced 字段读取不报错（向后兼容）
- [x] 未开启表情功能时，对话流程与改动前完全一致
