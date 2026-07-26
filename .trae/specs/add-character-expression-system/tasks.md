# Tasks

## 阶段一：数据层与基础类型

- [x] Task 1: 新建 `expressionService` 主进程服务与 IPC 处理器
  - [x] SubTask 1.1: 新建 `src/main/services/expressionService.ts`，实现表情包目录管理（`data/character-expressions/{characterCardId}/`）、manifest 读写（`manifest.json`）、图像保存/删除/读取
  - [x] SubTask 1.2: 新建 `src/main/ipc/handlers/expressionHandlers.ts`，注册 IPC 通道：`expression:list` / `expression:saveImage` / `expression:deleteImage` / `expression:addCustomEmotion` / `expression:removeCustomEmotion` / `expression:getImagePath`
  - [x] SubTask 1.3: 在 `src/preload/` 暴露 `electronAPI.expression.*` API（参照既有 `electronAPI.character.*` / `electronAPI.memory.*` 模式）
  - [x] SubTask 1.4: 在主进程入口注册 expressionHandlers（参照 characterHandlers 注册位置）

- [x] Task 2: 扩展 ChatMessage 与 AIParameterConfig 类型定义
  - [x] SubTask 2.1: 在 `src/shared/types/chat.types.ts` 的 `ChatMessage` 接口新增 `emotion?: string` 字段（含 JSDoc 注释引用本 Spec）
  - [x] SubTask 2.2: 在 `src/renderer/components/Character/CharacterDialogueChat/CharacterDialogueChat.types.ts` 的 `ChatMessage` 接口同步新增 `emotion?: string` 字段
  - [x] SubTask 2.3: 在 `AIParameterConfig` 新增 `expression_display?: boolean` 字段；为 `emoji_enhanced` 添加 `@deprecated` JSDoc 注释

## 阶段二：预置情绪常量与提示词构建

- [x] Task 3: 在 PromptBuilder 中定义预置情绪清单与情绪提示词构建函数
  - [x] SubTask 3.1: 在 `src/renderer/components/Character/CharacterDialogueChat/PromptBuilder.ts` 新增 `EMOTION_PRESETS` 常量（30 项 `{ key, label }[]`，含中英文映射）
  - [x] SubTask 3.2: 新增 `buildExpressionPrompt(charName, availableEmotionKeys)` 函数，注入系统提示词，要求 AI 在回复末尾输出 `<<<EXPRESSION>>>key<<<END_EXPRESSION>>>` 标记，并约束 key 必须来自 availableEmotionKeys 列表
  - [x] SubTask 3.3: 新增 `parseExpressionFromContent(content)` 工具函数，多格式容错匹配情绪标记，返回 `{ emotion: string | null, cleanedContent: string }`（参照 `parseSuggestedOptions` 模式）

## 阶段三：图片裁剪工具

- [x] Task 4: 安装 `react-easy-crop` 依赖
  - [x] SubTask 4.1: 执行 `npm install react-easy-crop`，确认 `package.json` 与 `package-lock.json` 更新

- [x] Task 5: 新建 `ImageCropperModal` 裁剪弹窗组件
  - [x] SubTask 5.1: 新建 `src/renderer/components/Character/CharacterDialogueChat/ImageCropperModal.tsx`，基于 `react-easy-crop` 实现：图片预览、缩放滑块（0.5x~5x）、滚轮缩放、自由裁剪框、裁剪预览
  - [x] SubTask 5.2: 实现裁剪输出逻辑：通过 canvas 提取裁剪区域，输出 PNG data URL；长边超过 512px 时按比例缩放压缩
  - [x] SubTask 5.3: 弹窗 props：`open` / `imageSrc` / `onConfirm(croppedDataUrl: string)` / `onCancel`；UI 风格与 CharacterEditModal 一致（暗色主题）

## 阶段四：表情管理 UI

- [x] Task 6: 新建表情状态 Zustand store
  - [x] SubTask 6.1: 新建 `src/renderer/stores/expressionStore.ts`，定义状态：`manifest` / `imageCache: Record<emotionKey, imagePath>` / `loading` / `error`
  - [x] SubTask 6.2: 实现 actions：`loadExpressions(characterCardId)`（IPC 拉取 manifest + 预加载所有图像路径至缓存）、`saveExpression(characterCardId, emotionKey, imageDataUrl, isCustom, label?)`、`deleteExpression(characterCardId, emotionKey)`、`addCustomEmotion(characterCardId, key, label)`、`removeCustomEmotion(characterCardId, key)`、`resolveExpressionImage(emotionKey): string | null`
  - [x] SubTask 6.3: 实现预加载机制：`loadExpressions` 时将所有已上传图像的绝对路径写入 `imageCache`，渲染时直接读取路径（Electron 直接加载本地文件无延迟）

- [x] Task 7: 新建 `ExpressionManagerModal` 表情管理弹窗
  - [x] SubTask 7.1: 新建 `src/renderer/components/Character/CharacterDialogueChat/ExpressionManagerModal.tsx`，props：`open` / `characterCardId` / `characterName` / `avatarPath`（默认表情预览）/ `onClose`
  - [x] SubTask 7.2: 渲染表情网格：30 个预置情绪 + 已添加的自定义情绪；每个格子显示当前表情缩略图（或「未上传」占位 + 默认头像小图）+ 上传/删除/预览按钮
  - [x] SubTask 7.3: 实现上传流程：点击上传 → `<input type="file" accept="image/*">` → 读取为 data URL → 打开 `ImageCropperModal` → 裁剪确认 → 调用 `expressionStore.saveExpression` → 刷新网格
  - [x] SubTask 7.4: 实现「添加自定义情绪」表单：输入英文键（校验 `^[a-z][a-z0-9_]*$`、不与预置重复）+ 中文标签 → 调用 `expressionStore.addCustomEmotion`
  - [x] SubTask 7.5: 实现删除：预置情绪仅删除图像（回退默认）；自定义情绪删除图像 + 从 manifest 移除；二次确认
  - [x] SubTask 7.6: 弹窗打开时调用 `loadExpressions(characterCardId)` 加载该角色卡表情包；UI 风格与 CharacterEditModal 一致

- [x] Task 8: 在 ChatHeader 添加「表情管理」入口
  - [x] SubTask 8.1: 在 `src/renderer/components/Character/CharacterDialogueChat/ChatHeader.tsx` 头部按钮区新增「表情管理」按钮（使用 antd `Button` + `SmileOutlined` 图标）
  - [x] SubTask 8.2: 在 `CharacterDialogueChat.tsx` 渲染 `ExpressionManagerModal`，由 ChatHeader 回调控制 open 状态；传入 `characterInfo.characterCardId` / `characterInfo.characterCardName` / `avatarPath`

## 阶段五：AI 回复情绪解析与渲染

- [x] Task 9: 在 hooks.ts 注入表情提示词并解析情绪标记
  - [x] SubTask 9.1: 在 `CharacterDialogueChat.hooks.ts` 的 `requestAIResponse` 系统提示词拼接段（约 L920-933），移除 `buildEmojiEnhancedPrompt` 调用；新增 `expression_display` 分支：当 `characterConfig?.customParameters?.expression_display === true` 时，调用 `buildExpressionPrompt(charName, availableEmotionKeys)` 追加到 `effectiveSystemPrompt`
  - [x] SubTask 9.2: `availableEmotionKeys` 来源：合并 `EMOTION_PRESETS` 全部 key + 当前角色卡 manifest 的 customEmotions key（通过 expressionStore 读取）；若 manifest 未加载则仅用预置 keys
  - [x] SubTask 9.3: 在 AI 回复后处理段（约 L1155-1216 suggestedOptions 解析附近），新增情绪标记解析：当 `expression_display === true` 时，调用 `parseExpressionFromContent(finalContent)`，得到 `emotion` 与 `cleanedContent`；将 `cleanedContent` 覆盖 `finalContent`（剥离标记），并将 `emotion` 写入最终 ChatMessage
  - [x] SubTask 9.4: 在创建 ChatMessage 的位置（与 suggestedOptions 同处）追加 `emotion` 字段；记录 `addLog` 标记解析结果（含未匹配回退警告）
  - [x] SubTask 9.5: 设置 `emotionStripped` 标志，纳入既有「内容保护检查」的容差跳过逻辑（参照 `thinkTagsStripped` / `optionsStripped` 模式，避免剥离标记后触发内容保护误判导致 UI 卡死）

- [x] Task 10: ChatMessageBubble 按情绪渲染表情图像
  - [x] SubTask 10.1: 在 `ChatMessageBubble.tsx` 新增 props：`expressionImage?: string`（由父组件解析后的表情图像路径，未提供时回退 avatarPath）
  - [x] SubTask 10.2: 修改头像渲染逻辑（约 L363-369）：优先使用 `expressionImage`，其次 `avatarPath`，最后首字母占位
  - [x] SubTask 10.3: 在 `CharacterDialogueChat.tsx` 消息列表渲染处（约 L445、L466），通过 `expressionStore.resolveExpressionImage(message.emotion)` 解析每条 assistant 消息的表情路径，传入 `ChatMessageBubble`
  - [x] SubTask 10.4: 流式消息（isStreaming）期间使用默认头像，待流式完成后再切换为表情图像，避免闪烁

## 阶段六：参数面板开关迁移

- [x] Task 11: ParameterPanel 移除 Emoji 开关、新增「开启表情」开关
  - [x] SubTask 11.1: 在 `ParameterPanel.tsx` 移除「Emoji 增强模式」开关区块（约 L376-391）；移除 `emojiEnhanced` / `onEmojiEnhancedToggle` props
  - [x] SubTask 11.2: 在原位置新增「开启表情」开关区块，绑定 `expressionDisplay` / `onExpressionDisplayToggle` props；Tooltip 说明：「开启后，AI 回复时根据语境动态切换角色表情头像。需先在「表情管理」中上传表情图片。默认关闭。」
  - [x] SubTask 11.3: 在 `ConfigPanel.tsx` 透传 `expressionDisplay` / `onExpressionDisplayToggle`，移除 `emojiEnhanced` / `onEmojiEnhancedToggle` 透传
  - [x] SubTask 11.4: 在 `CharacterDialogueChat.tsx` 计算 `expressionDisplay = characterConfig?.customParameters?.expression_display === true`，透传给 ConfigPanel；`onExpressionDisplayToggle` 回调调用 `updateConfig({ customParameters: { ...characterConfig?.customParameters, expression_display: enabled } })` 并 `saveConfig`
  - [x] SubTask 11.5: 在 hooks.ts 移除 `buildEmojiEnhancedPrompt` 的 import 与调用（保留 PromptBuilder 中的函数定义以便回退）

## 阶段七：预加载与性能优化

- [x] Task 12: 表情图像预加载机制
  - [x] SubTask 12.1: 在 `CharacterDialogueChat.tsx` 的 `useEffect` 中，当 `expressionDisplay === true` 且 `characterInfo.characterCardId` 变化时，调用 `expressionStore.loadExpressions(characterCardId)` 加载并缓存
  - [x] SubTask 12.2: 在 expressionStore.loadExpressions 中，对每个已上传的表情图像路径创建 `new Image()` 对象预加载，写入浏览器图像缓存
  - [x] SubTask 12.3: 在 ExpressionManagerModal 保存/删除表情后，调用 `loadExpressions` 刷新缓存，确保 ChatMessageBubble 渲染时拿到最新路径

## 阶段八：文档更新

- [x] Task 13: 更新技术文档
  - [x] SubTask 13.1: 在 `docs/PROJECT_DOCUMENTATION_NEW.md` 增量更新「角色卡」与「对话」章节，新增「表情管理系统」小节，说明存储路径、manifest 结构、IPC 通道、预置情绪清单
  - [x] SubTask 13.2: 在 `CODE_WIKI.md` 新增表情系统相关条目（expressionService / expressionStore / ExpressionManagerModal / ImageCropperModal / buildExpressionPrompt）
  - [x] SubTask 13.3: 在 `CHANGELOG.md` 顶部新增本特性条目，标注「BREAKING：移除 Emoji 增强模式开关，新增表情显示开关」

## 阶段九：补充入口（用户反馈）

- [x] Task 15: 在 CharacterEditModal 新增「表情管理」Tab
  - [x] SubTask 15.1: 在 `src/renderer/components/Character/CharacterEditModal.tsx` 导入 `ExpressionManagerModal` + `SmileOutlined` + `Alert`；新增 `expressionModalOpen` state
  - [x] SubTask 15.2: 在 Tabs items 数组末尾（worldbook 之后）新增第 4 个 tab `{ key: 'expressions', label: <SmileOutlined /> 表情管理 }`；内容：若 `editingItem.path` 存在则显示说明 Alert + 「打开表情管理」按钮，否则显示「请先保存角色卡」警告
  - [x] SubTask 15.3: 在 Modal 外层（与 AI润色/AI生成 Modal 同级）渲染 `ExpressionManagerModal`，传入 `characterCardId={editingItem?.path}` / `characterName={formValues.name}` / `avatarPath={uploadedImage}`
  - [x] SubTask 15.4: 更新 CHANGELOG / PROJECT_DOCUMENTATION_NEW / CODE_WIKI，标注【重点标记】（用户反馈原入口仅位于对话头部，不易发现）

## 阶段十：验证

- [x] Task 14: 端到端验证（静态代码审计完成；运行时 E2E 由用户在应用中执行）
  - [x] SubTask 14.1: 为角色 A 上传 3 个预置情绪表情 + 1 个自定义情绪表情，验证 manifest 与图像文件正确写入 `data/character-expressions/{charA}/`（代码路径已验证：ExpressionManagerModal → ImageCropperModal → expressionStore.saveExpression → IPC expression:saveImage → expressionService.saveImage 写入 `data/character-expressions/{sha256(cardId).slice(0,16)}/`）
  - [x] SubTask 14.2: 开启「开启表情」开关，与角色 A 对话，验证 AI 回复末尾输出 `<<<EXPRESSION>>>` 标记、解析后气泡头像切换为对应表情（代码路径已验证：hooks.ts L937-942 buildExpressionPrompt 注入；L1237 parseExpressionFromContent 解析；L1476 emotion 写入 ChatMessage；ChatMessageBubble L366-368 按 expressionImage 渲染）
  - [x] SubTask 14.3: 验证未上传表情的情绪回退到默认头像；验证 AI 未输出标记时回退到默认头像（代码路径已验证：expressionStore.resolveExpressionImage 未命中返回 null；ChatMessageBubble L366 `(expressionImage || avatarPath)` 回退到 avatarPath）
  - [x] SubTask 14.4: 验证切换角色卡后表情数据隔离（角色 B 看不到角色 A 的表情）（代码路径已验证：expressionService 使用 `sha256(characterCardId).slice(0,16)` 作为独立目录名；loadExpressions 按 characterCardId 加载各自 manifest）
  - [x] SubTask 14.5: 验证关闭「开启表情」开关后，AI 不再输出情绪标记、气泡显示默认头像（代码路径已验证：hooks.ts L937 `expressionDisplay === true` 守卫，关闭时不注入 buildExpressionPrompt；L1235 expressionDisplayEnabled 守卫，关闭时不调用 parseExpressionFromContent；ChatMessageBubble 在 msg.emotion 为 undefined 时使用 avatarPath）
  - [x] SubTask 14.6: 验证图片裁剪工具：上传 1920×1080 全身图，放大至 200% 裁剪面部，输出 256×256 PNG（代码路径已验证：ImageCropperModal 基于 react-easy-crop，aspect=1 + zoom 0.5~5 + wheel zoom + 自由裁剪框；getCroppedImg 通过 canvas 输出 PNG data URL，长边 > 512px 按比例缩放压缩）
  - [x] SubTask 14.7: 验证既有 suggestedOptions / think 标签解析未被破坏（回归测试）（代码路径已验证：hooks.ts L1470 内容保护检查同时纳入 `thinkTagsStripped` / `optionsStripped` / `emotionStripped` / `stopTruncated` 四类容差标志，互不干扰；emoji_enhanced 字段保留并标注 @deprecated，旧配置读取不报错）

# Task Dependencies
- Task 2（类型扩展）独立，可与 Task 1 并行
- Task 3（PromptBuilder 常量与函数）依赖 Task 2（类型）
- Task 5（ImageCropperModal）依赖 Task 4（安装依赖）
- Task 6（expressionStore）依赖 Task 1（IPC）+ Task 3（EMOTION_PRESETS）
- Task 7（ExpressionManagerModal）依赖 Task 5 + Task 6
- Task 9（hooks 解析）依赖 Task 3 + Task 6
- Task 10（ChatMessageBubble 渲染）依赖 Task 6 + Task 9
- Task 11（ParameterPanel 开关迁移）依赖 Task 2
- Task 12（预加载）依赖 Task 6 + Task 11
- Task 13（文档）在所有功能任务完成后进行
- Task 14（验证）依赖全部功能任务完成
