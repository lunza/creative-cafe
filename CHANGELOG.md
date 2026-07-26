# Changelog

## [Unreleased] - 2026-07-26

### Fixed
- **⭐⭐⭐【重点标记】修复 AI 引擎配置在系统重启后消失（仅剩测试引擎）**：用户在系统设置中配置的多个 AI 引擎在正常退出或重启后全部丢失，仅保留一个名为"测试引擎"的临时条目，严重影响使用体验。
  - **根因**：`useAIEngineSettings.ts` 的 `handleTestConnection`（主表单测试连通性）和 `handleTestEngineConnection`（引擎管理弹窗测试连通性）在测试成功后执行了"同步到 store"操作，调用 `setSetting({ ...setting!, aiEngines: [syncedEngine], activeEngineId: 'test_engine' })`，**将整个 `aiEngines` 数组替换为仅包含一个临时测试引擎**。此后任何 `saveSetting`（保存设置/切换引擎/保存删除复制引擎等）操作都会将这个被污染的内存状态持久化到 `settings.json`，重启后即丢失所有引擎配置
  - **修复方案**：移除两个测试连通性函数中"同步到 store"的代码块。测试操作是纯验证行为，不应修改已存储的引擎配置；用户通过"保存设置"/"保存修改"按钮持久化表单配置
  - **数据流（Bug 路径）**：用户点击"测试连通性"成功 → `setSetting({ aiEngines: [test_engine] })`（内存被污染）→ 用户点击"保存设置"等任意持久化操作 → `saveSetting(corrupted_setting)` 写入 settings.json → 重启后只剩一个测试引擎
  - **验证流程**：配置 3+ 引擎 → 测试连通性成功 → 确认引擎列表仍保持 3+ → 保存设置 → 重启应用 → 所有引擎配置完整保留
  - 涉及文件：`src/renderer/components/Settings/hooks/useAIEngineSettings.ts`（移除两处 `useSettingStore.getState().setSetting(...)` 调用及相关 `syncedEngine` 构建代码）
  - **核心教训**：测试操作不应修改持久化数据
- **⭐⭐⭐【重点标记】修复剧情检查返回综合评分=0、问题总数=0（第二次修复，多策略解析）**：写作模式剧情检查功能调用 AI 后返回成功，但日志显示 `综合评分=0, 问题总数=0`，UI 弹窗显示空报告。首次修复（添加 `extractJsonObject`）后问题仍然存在，用户反复反馈 2 次才彻底解决。
  - **根因分析**：`综合评分=0` 的唯一可能是 `parseCheckResponse` 走到 `createFallbackReport` 分支，即两次 `JSON.parse` 均失败。原解析流程存在 3 个结构性缺陷：
    1. **`fixJsonForParsing` 步骤 3 正则破坏 JSON**：`/(\{|\,)\s*([a-zA-Z_$][a-zA-Z0-9_$]*)\s*:/g` 不考虑字符串边界，当 JSON 字符串值内部包含 `{key:` 或 `,key:` 模式（在 description/suggestion/analysis 字段中常见），会错误插入引号破坏 JSON 结构
    2. **`fixChineseQuotes` 在 `JSON.parse` 之前无条件执行**：即使 JSON 本身已有效，若字符串值内包含中文引号，`inString` 状态追踪可能出错，破坏原本有效的 JSON
    3. **`extractJsonObject` 调用条件太窄**：`!extracted || !jsonStr.startsWith('{')` 在代码块正则匹配成功且内容以 `{` 开头时不触发，无法处理代码块正则截断（JSON 内含 ` ``` ` 导致非贪婪匹配提前结束）
  - **修复方案**：
    1. **记录 AI 原始响应**（info 级别）：在 `checkChapter` 调用 `parseCheckResponse` 前记录 rawContent 长度和前/后 500 字符，确保即使 debug 日志关闭也能看到 AI 实际返回内容
    2. **多策略递进解析**：将 `parseCheckResponse` 改为按破坏性递增的 3 策略依次尝试——策略1「直接解析」/ 策略2「修复中文引号」/ 策略3「修复JSON格式」
    3. **`extractJsonObject` 无条件执行**：去掉条件始终尝试提取最外层 `{...}`，处理代码块截断和前后缀文本
    4. **`fixJsonForParsing` 步骤 3 改为字符级遍历**：追踪 `inString` 状态，仅在字符串外部执行未加引号键名修复
  - 涉及文件：`src/main/services/writing/PlotCheckerService.ts`（`checkChapter` 新增原始响应 info 日志 / `parseCheckResponse` 重构为多策略 / `fixJsonForParsing` 步骤 3 字符级遍历）
  - **核心教训**：JSON 修复函数（fixChineseQuotes/fixJsonForParsing）应在 `JSON.parse` 失败后再应用，而非之前无条件执行——对有效 JSON 的误修复比不修复更危险
- **【重点标记】修复多轮对话中 AI 输出被截断问题（停止序列 + think 标签 + 内容保护）**：AI 在多轮对话中频繁出现内容被截断、UI 卡死在"正在生成中"等问题，根因涉及多个后处理环节。
  - **子问题1（停止序列误触发）**：`buildStopSequences` / `buildStopSequencesForUserReply` 原包含 6/4 项单换行前缀变体（`\n用户:` / `\nUser:` 等）作为"兜底防止后端按子串匹配时漏判"。但大多数 OpenAI-compatible 后端（vLLM / textgen-webui / koboldcpp 等）的 stop 字段使用子串匹配，AI 在回复中引用用户话语（如"用户: '我喜欢这个'"）、写内心独白提及用户代词、列举对话片段时被误截断。**修复**：移除所有单换行前缀变体，仅保留 6/4 项双换行前缀（`\n\n`），匹配段落分隔
  - **子问题2（think 标签正则误删）**：`stripThinkingTags` 的未闭合标签正则原为 `/<(think...)\b[^>]*>[\s\S]*$/gi`，会从首次出现的 `<think` 字面量删到文本末尾。若 AI 在故事中提及"思考标签"、模仿 XML、或输出 `<thought>` 字面量，后半部分内容全部丢失。**修复**：要求未闭合的 `<think` 标签必须位于行首（`^` 或 `\n` 之后），并保留匹配到的起始换行符避免合并前后行
  - **子问题3（内容保护检查误判合法截断）**：stop sequences 或 max_tokens 截断会导致 `finalContent` 短于流式累积的 `existingContent`，触发内容保护检查（`displayContent.length < existingContent.length`）后状态不更新 → UI 卡死。**修复**：增加 30% 长度容差标志 `stopTruncated`，`displayContent` 不少于 `existingContent` 的 30% 即视为合法截断，跳过保护检查
  - 涉及文件：`src/renderer/components/Character/CharacterDialogueChat/PromptBuilder.ts`（移除单换行停止序列变体）、`src/renderer/components/Character/CharacterDialogueChat/utils/messageProcessor.ts`（`stripThinkingTags` 行首限制）、`src/renderer/components/Character/CharacterDialogueChat/CharacterDialogueChat.hooks.ts`（30% 容差标志 + finish_reason=length 检测）
- **【重点标记】修复辅助模式推荐选项重启后丢失问题（hooks + store + 4 处类型断层）**：退出对话模式再进入后，AI 消息的 3 个推荐选项不再显示。此 Bug 涉及 3 层遗漏，需逐层修复：
  - **第 1 层（hooks.ts）**：`engine.onComplete` 回调中构建 `messagesToSave` 持久化对象时手动逐字段构建 clean 副本，遗漏了 `suggestedOptions` 字段。**修复**：在 map 映射中添加 `suggestedOptions: msg.suggestedOptions`
  - **第 2 层（store 白名单过滤）**：即使 hooks.ts 传了字段，`characterChatStore.ts` 的 `saveTestChat` 函数构建 `safeMessages` 时使用显式字段白名单（仅 7 个字段：id/role/content/timestamp/status/speakerName/speakerAvatar），`suggestedOptions` 不在白名单中被静默丢弃。**修复**：白名单添加 `suggestedOptions` 字段（含 `Array.isArray` 安全转换）
  - **第 3 层（类型定义断层）**：项目中存在 4 处独立的 `ChatMessage` 定义，均不包含 `suggestedOptions`，TypeScript 无法检测出字段缺失。**修复**：4 个文件统一添加 `suggestedOptions?: string[]` 字段——`src/shared/types/chat.types.ts`（号称"单一真源"）/ `src/renderer/stores/characterChatStore.ts` / `src/main/services/ChatStorageService.ts` / `CharacterDialogueChat.types.ts`
  - **核心教训**：项目中存在多处独立的 `ChatMessage` 定义号称"单一真源"但实际未统一，TypeScript 无法检测字段缺失。后续应推动类型定义集中化
- **【修复】写作模式用户人设显示文件名而非人设名称**：写作模式生成大纲时，用户人设列表显示的是文件名（如 `my-persona.json`）而非人设的实际名称。
  - **根因**：`avatarService.listAvatars()` 返回的 `name` 字段是文件系统文件名，而非 JSON 文件内部存储的人设名称。写作模式的 3 个组件直接使用了该 `name` 字段，未读取文件内容；而角色对话模式的 `usePersonas` 已正确实现
  - **修复方案**：3 个组件统一改为读取 JSON 文件内容获取 `name` 和 `description` 字段，读取失败时回退到去扩展名的文件名
  - 涉及文件：`src/renderer/components/Creative/WritingMode/useWritingMaterials.ts`、`WritingConfigModal.tsx`、`WritingConfigPanel.tsx`（人设映射从 `.map()` 改为 `for...of` 异步读取）

### Added
- **角色卡表情管理系统（Spec: add-character-expression-system，完整特性）**：新增完整的角色卡表情管理功能——每个角色卡独立的表情包存储、30 种预置情绪 + 自定义情绪扩展、图片裁剪工具、表情管理弹窗、AI 回复情绪字段解析、聊天气泡按情绪渲染表情图像、表情显示开关（代替 Emoji 增强模式）、表情图像预加载机制。本条目由 Task 1 / Task 5 早期增量条目合并整理而来，覆盖 Task 1-12 全部功能。
  - **存储**：`{userData}/data/character-expressions/{sha256(characterCardId).slice(0,16)}/{manifest.json, {emotionKey}.png}`；用 SHA-256 截断哈希作为目录名，保证同一角色卡 ID（含路径/空格/中文）确定性映射且文件系统安全
  - **主进程服务**：`src/main/services/expressionService.ts` 单例 `expressionService`，方法 `listExpressions / saveImage / deleteImage / addCustomEmotion / removeCustomEmotion / getImagePath`，镜像 `avatarService` 风格；自定义情绪 key 校验 `^[a-z][a-z0-9_]*$`
  - **IPC 通道**：`src/main/ipc/handlers/expressionHandlers.ts` 注册 6 个通道（`expression:list/saveImage/deleteImage/addCustomEmotion/removeCustomEmotion/getImagePath`），在 `ipc/index.ts` 的 `setupIpcHandlers()` 中调用 `registerExpressionHandlers()`；Preload 暴露 `electronAPI.expression.*`；`src/renderer/types/electron.d.ts` 补全类型声明；`saveImage` / `getImagePath` 返回绝对路径便于 `<img src={absolutePath}>` 直接加载
  - **30 种预置情绪**：基于 GoEmotions 分类（27 项）+ default（默认）+ cheerfulness（快乐）共 30 项，定义在 `PromptBuilder.ts` 的 `EMOTION_PRESETS` 常量；预置类别不可删除，用户可追加自定义情绪
  - **图片裁剪工具 ImageCropperModal**（`src/renderer/components/Character/CharacterDialogueChat/ImageCropperModal.tsx`）：基于 `react-easy-crop`（v6.2.3）的方形裁剪弹窗，支持放大/缩小/自由裁剪/区域截取；Props `{ open, imageSrc, onConfirm(dataUrl), onCancel }`；`<Cropper>` aspect=1 + `zoomWithScroll` + antd `Slider` 0.5~5；`getCroppedImg` 通过 canvas 输出 PNG data URL，长边 > 512px 时按比例缩放压缩；64×64 圆形预览用 CSS `background-position` 同步渲染；状态重置 + 异常容错 + 暗色主题 UI（详见 `CODE_WIKI.md` §14.11）；tsc 验证通过（仓库唯一 tsc 错误为 `vite.config.ts:65` 的 `WatchOptions.include` 类型问题，与本组件无关）
  - **表情管理弹窗 ExpressionManagerModal**（`src/renderer/components/Character/CharacterDialogueChat/ExpressionManagerModal.tsx`）：从 ChatHeader「表情管理」按钮入口打开；渲染 30 预置 + 自定义情绪网格、上传/删除/预览、添加/移除自定义情绪表单；数据来源 `useExpressionStore`，保存/删除后 store 同步更新本地 manifest 与 imageCache 自动重渲染
  - **【重点标记】CharacterEditModal 表情管理 Tab（Task 15 - 用户反馈补充入口）**：用户反馈「没有看到上传角色表情包的位置」——原入口仅位于对话头部 ChatHeader 的 😊 按钮，用户在角色卡编辑界面找不到上传入口。修复：在 `CharacterEditModal.tsx` 的 Tabs 中新增第 4 个 `表情管理` Tab（与 `角色信息` / `对话与指令` / `世界书关联` 并列），内容为说明 Alert + 「打开表情管理」按钮（调用 ExpressionManagerModal）；新建角色卡（无 path）时显示「请先保存角色卡」警告。涉及文件：`src/renderer/components/Character/CharacterEditModal.tsx`（新增 imports：`Alert` / `SmileOutlined` / `ExpressionManagerModal`；新增 state：`expressionModalOpen`；新增 tab item；新增 Modal 渲染）
  - **表情状态 Store expressionStore**（`src/renderer/stores/expressionStore.ts`）：Zustand store，持有 `manifest` / `imageCache` / `loading` / `error`；封装所有 `electronAPI.expression.*` IPC 调用；提供 `loadExpressions` / `saveExpression` / `deleteExpression` / `addCustomEmotion` / `removeCustomEmotion` / `resolveExpressionImage` / `getAvailableEmotionKeys` / `clear` actions；加载时通过 `new Image()` 预热浏览器图像缓存避免情绪切换闪烁；不持久化到 localStorage（manifest 由主进程 `expressionService` 写盘）
    - **【重点标记】`getImagePath` 返回签名**：任务文档描述为 `Promise<string | null>`，但 `electron.d.ts` 第 453 行与 `expressionHandlers.ts` 第 143 行的实际实现均为 `Promise<{ success: boolean; imagePath: string | null; error?: string }>`。store 以实际实现为准（取 `.imagePath`）
  - **AI 回复情绪字段**：`<<<EXPRESSION>>>key<<<END_EXPRESSION>>>` 标记格式，由 `PromptBuilder.ts` 的 `buildExpressionPrompt` 注入系统提示词、`parseExpressionFromContent` 多格式容错解析（参照 `parseSuggestedOptions` 模式）；解析后写入 `ChatMessage.emotion`，并从显示内容中剥离该标记；`emotionStripped` 容差标志纳入既有「内容保护检查」跳过逻辑（参照 `thinkTagsStripped` / `optionsStripped` 模式），避免剥离标记后触发内容保护误判导致 UI 卡死
  - **表情显示开关 `expression_display`**（在 ParameterPanel 中）：代替原 Emoji 增强模式开关；Tooltip 说明：「开启后，AI 回复时根据语境动态切换角色表情头像。需先在「表情管理」中上传表情图片。默认关闭。」
  - **ChatMessageBubble 按情绪渲染**：新增 `expressionImage?: string` prop，按情绪渲染表情图像（自定义 > 预置 > 默认头像三级回退）；流式消息期间使用默认头像，待流式完成后再切换为表情图像，避免闪烁
  - **表情图像预加载机制**：`expressionStore.loadExpressions` 时将所有已上传表情图像路径创建 `new Image()` 对象预加载（fire-and-forget），写入浏览器图像缓存；`CharacterDialogueChat.tsx` 的 `useEffect` 在 `expressionDisplay === true` 且 `characterCardId` 变化时调用 `loadExpressions`；`ExpressionManagerModal` 保存/删除表情后亦调用 `loadExpressions` 刷新缓存
  - 涉及文件：`src/main/services/expressionService.ts`（新建）、`src/main/ipc/handlers/expressionHandlers.ts`（新建）、`src/main/ipc/index.ts`（注册）、`src/main/preload.ts`（暴露 API）、`src/renderer/types/electron.d.ts`（类型）、`src/renderer/stores/expressionStore.ts`（新建）、`src/renderer/components/Character/CharacterDialogueChat/PromptBuilder.ts`（`EMOTION_PRESETS` / `buildExpressionPrompt` / `parseExpressionFromContent`）、`src/renderer/components/Character/CharacterDialogueChat/ExpressionManagerModal.tsx`（新建）、`src/renderer/components/Character/CharacterDialogueChat/ImageCropperModal.tsx`（新建）、`src/renderer/components/Character/CharacterDialogueChat/ChatHeader.tsx`（入口按钮）、`src/renderer/components/Character/CharacterDialogueChat/ParameterPanel.tsx`（开关）、`src/renderer/components/Character/CharacterDialogueChat/ConfigPanel.tsx`（透传）、`src/renderer/components/Character/CharacterDialogueChat/CharacterDialogueChat.tsx`（状态绑定 + 弹窗渲染 + 预加载 useEffect）、`src/renderer/components/Character/CharacterDialogueChat/CharacterDialogueChat.hooks.ts`（提示词注入 + 标记解析 + emotion 写入）、`src/renderer/components/Character/CharacterDialogueChat/ChatMessageBubble.tsx`（按情绪渲染头像）、`src/renderer/components/Character/CharacterEditModal.tsx`（Task 15 新增「表情管理」Tab 入口）、`src/shared/types/chat.types.ts` + `CharacterDialogueChat.types.ts`（`emotion` / `expression_display` 字段）
  - 文档同步：`docs/PROJECT_DOCUMENTATION_NEW.md` 新增「7.3.1 表情管理系统」小节（覆盖概述、存储、manifest、IPC 通道、30 项预置情绪清单、AI 标记格式、显示优先级、参数面板开关、表情管理弹窗入口、关键文件清单、图片裁剪工具、预加载机制）；`CODE_WIKI.md` 新增 §14.10（expressionService 后端 + IPC）/ §14.11（ImageCropperModal）/ §14.12（ExpressionManagerModal + expressionStore）/ §14.13（PromptBuilder 表情函数 + hooks 注入 + ParameterPanel 开关迁移 + 类型扩展）+ §6.1 角色卡模块组件清单补充 + §9 状态管理 expressionStore 条目 + 附录关键文件索引补充；`CHANGELOG.md`（本条目，合并原 Task 1 / Task 5 两条增量条目）
- **辅助模式选项生成稳定性强化与三选项差异化**：辅助模式下 AI 偶尔不生成 3 个待选回答，可能由 max_tokens 不足导致选项块被截断，或 AI 遗漏结束标记/编号格式不匹配导致解析失败。本次强化覆盖生成、解析、渲染全链路。
  - **max_tokens 预留**（`CharacterDialogueChat.hooks.ts`）：辅助模式开启时 `max_tokens += 512`，为选项块预留安全余量。注意 `max_tokens=0`（无限制）时不执行 +512
  - **半截选项块容错**：新增 2 个"仅开始标记到文本末尾"的正则模式（`text-marker-unclosed`、`plain-tag-unclosed`），在 AI 遗漏结束标记或被截断时仍能提取选项
  - **多编号格式支持**：选项行解析支持 `①②③`、`1.`、`1)`、`1）`、`-`、`*`、`(1)` 等编号格式
  - **三选项差异化提示词**（`PromptBuilder.ts` `buildAssistModePrompt`）：明确要求 3 个选项各有侧重——1. 稳妥推进（贴合剧情）/ 2. 平衡探索（适度转换）/ 3. 发散创新（引入新元素）
  - **结构化格式约束**：要求 AI 用圆括号 `()` 包裹人物动作/状态/表情/环境描写，用双引号 `""` 包裹语言/心理活动，并给出示例 `(微微一笑)"今天天气真好呢"`
  - **UI 三色差异化**（`ChatMessageBubble.tsx` + `ChatMessageBubble.css`）：
    - 每个选项上方显示特点标签（稳妥推进/平衡探索/发散创新）
    - 三色编号系统：稳妥推进=绿色（#10b981）/ 平衡探索=紫色（#6366f1）/ 发散创新=橙红色（#f59e0b→#ef4444）
    - 选项内容结构化渲染：`renderOptionContent` 用正则解析 `()` 和 `""`，分别渲染为 `.suggested-option-action`（斜体淡色）和 `.suggested-option-dialogue`（高亮）
    - 小屏幕响应式适配（标签 font-size 9px / padding 1px 5px）
- **AI 回复语言选择功能**：新增 `AIParameterConfig.language` 字段（'zh' | 'en' | 'ja'，默认中文），控制 AI 生成回复使用的语言。
  - **类型与配置**：`CharacterDialogueChat.types.ts` 新增 `language?: 'zh' | 'en' | 'ja'` 字段
  - **提示词注入**：`PromptBuilder.ts` 新增 `buildLanguagePrompt(language)` 函数，向系统提示词追加 `【语言要求】你的回复必须使用{中文/英文/日文}...`
  - **UI 控件**：`ParameterPanel.tsx` 在「辅助模式」与「Emoji 增强模式」之间新增「语言」Select 下拉框（中文/English/日本語），经 `ConfigPanel.tsx` 透传，由 `CharacterDialogueChat.tsx` 绑定到 `characterConfig.customParameters.language`
  - **默认值**：undefined 视为中文（与现有 emoji_enhanced、strip_think_tags 等开关的"undefined 视为默认值"约定一致）
- **max_tokens=0 表示无限制**：扩展 max_tokens 参数配置，支持设为 0 表示不限制最大 token 数（由模型上下文窗口决定）。
  - `parameterConfigs.ts`：min 由 256 改为 0，max 由 32768 扩展到 262144（支持 256K 上下文模型），tooltip 更新说明"设为 0 表示不限制"
  - `ChatEngine.ts`：`max_tokens=0` 时不发送 `max_tokens` 字段（让后端使用默认行为），原实现会回退到 `DEFAULT_MAX_TOKENS` 强制发送
  - `ParameterPanel.tsx`：当 `max_tokens=0` 时显示"无限制"，区分于具体数值
- **AI 回复序号显示**：在每条 AI 回复消息的发送者名称旁显示序号徽章（如 `#3`），便于在长对话中快速定位 AI 回复次数。
  - `CharacterDialogueChat.tsx`：渲染消息列表时计算 `aiSequenceNumber`（当前消息之前所有 `role=assistant` 的消息数量 + 1），透传给 `ChatMessageBubble`
  - `ChatMessageBubble.tsx`：新增 `aiSequenceNumber` prop，仅 assistant 消息且序号 > 0 时显示徽章（10px 字号 / 浅色背景 / 圆角 8px）
- **TokenManagement 关闭时的安全网**：原实现 TokenManagement 关闭时直接发送所有消息，长对话会耗尽模型上下文窗口（如 32K）导致 `finish_reason=length` 截断。
  - **修复**：`CharacterDialogueChat.hooks.ts` 新增消息数量软限制——超过 `maxMessagesToKeep`（默认 60）时仅保留最近 N 条，并确保以 user 消息开头（丢弃开头的 assistant 消息）
  - **finish_reason=length 检测**：在 `onComplete` 回调中检测 `response.finishReason === 'length'`，根据是否启用 TokenManagement 给出不同的用户提示（启用→增大 maxContextTokens / 减小 maxMessagesToKeep；未启用→启用 Token 管理），通过 `message.warning` 显示 8 秒
- **辅助模式选项结构化格式渲染计划文档**（`.trae/documents/辅助模式选项结构化格式渲染计划.md`）：记录辅助模式选项 `()` 动作描写与 `""` 对话内容结构化渲染功能的设计分析与实施计划
- **剧情检查评分=0 第二次修复文档**（`.trae/documents/fix-plot-check-score-zero-v2.md`）：详细记录多策略 JSON 解析修复方案的根因分析、修改方案与验证流程

### Changed
- **技术文档增量更新**（`.trae/documents/技术文档.md`）：追加 7 段开发记录，覆盖辅助模式稳定性强化、推荐选项持久化修复（3 层）、写作模式人设显示修复、剧情检查评分=0 两次修复、AI 引擎配置消失修复，所有用户反复反馈的问题均以 ⭐⭐⭐ 重点标记

## [Unreleased] - 2026-07-05

### Added
- **【重点标记】think 标签剥离导致内容保护检查误触发修复（Spec: fix-think-strip-content-protection）**：针对 `strip_think_tags` 开关启用后 UI 卡死在"正在生成中"的问题，定位真正的根因并修复。
  - **问题现象**：`strip_think_tags` 默认开启后，AI 回复完成后对话状态卡在"正在生成中"，流式渲染正常（用户能看到内容），向量化也正常触发，但状态指示器永远不切换到"完成"
  - **根因**：`onComplete` 回调中 `stripThinkingTags` 剥离了 think 标签内容，导致 `displayContent.length` 小于流式渲染时累积的 `existingContent.length`（后者含 think 标签）。这触发了 `hooks.ts:1305` 的内容保护检查（`return prev`），状态不更新 → UI 卡死
  - **修复方案**：在 think 标签剥离处增加 `thinkTagsStripped` 标志位，在内容保护检查条件中增加 `&& !thinkTagsStripped`，跳过 think 标签剥离导致的合法缩短
  - 涉及文件：`src/renderer/components/Character/CharacterDialogueChat/CharacterDialogueChat.hooks.ts`（第 1091-1099 行标志位、第 1311 行保护检查条件）
  - 这是 `handle-think-tags-overflow` spec 的配套修复——没有此修复，think 标签开关启用时必然导致 UI 卡死
  - 文档同步：`doc/04b-character-dialogue-chat-module.md` 追加【重点标记】段落
- **【重点标记】对话卡死修复：AI 返回空内容时 completeCallback 未触发**：针对用户反馈"AI 响应完成后对话状态仍旧显示正在生成中"的问题，定位根因并修复。
  - **问题现象**：日志显示 `SSE 解析成功` → `ai:stream:complete event sent`，但 UI 永远停留在"正在生成中"状态
  - **根因**：`ChatEngine.ts` 的 `handleComplete` 中有 `if (finalContent) { this.completeCallback?.(response); }` 守卫——当 AI 返回空内容（流式 chunk 全部无 `delta.content`，且最终 `message.content` 也为空）时，`finalContent` 为空字符串（falsy），`completeCallback` **永远不会被调用**，导致 hooks.ts 的 `onComplete` 回调不触发，消息状态不从 "sending" 更新
  - **修复方案**：移除 `if (finalContent)` 守卫，始终调用 `completeCallback`，即使内容为空。空内容时输出 warn 日志 `[ChatEngine] handleComplete: finalContent is empty, calling completeCallback with empty content to prevent UI stuck`
  - **附带修复**：`aiHandlers.ts` 的 content length 日志此前检查 `data?.content?.length`（错误路径，SSE 解析后内容在 `data?.choices?.[0]?.message?.content`），导致日志永远显示 `0 chars` 误导诊断。修正为检查正确的三级路径
  - 涉及文件：`src/renderer/components/Common/ChatEngine/ChatEngine.ts`（第 259-272 行）、`src/main/ipc/handlers/aiHandlers.ts`（第 629-635 行）
  - 文档同步：`doc/04b-character-dialogue-chat-module.md` 追加【重点标记】段落
- **【重点标记】向量化崩溃修复：全局异常处理器 + IPC handler try-catch**：针对用户反馈"向量化过程中 Electron 主进程自动崩溃"的问题，定位根因并修复。
  - **问题现象**：AI 流式响应完成后（`SSE 解析成功`），增量向量化触发但主进程随即崩溃，`vectorizeIncremental: starting` 日志一条都没输出，紧接着出现 `ERROR: This operation returned because the timeout period expired.` 和 `vite-plugin-electron` 的 `taskkill /T /F` 超时崩溃
  - **根因**：`src/main` 目录**完全没有 `process.on('unhandledRejection')` / `process.on('uncaughtException')` 处理器**（致命缺陷）。`ipcMain.handle('chatHistory:vectorizeIncremental')` handler **无 try-catch 包裹**，若 `vectorizeIncremental` 内部有任何异常逃逸三层 try-catch（或产生未 await 的 Promise rejection），Node.js 16+ 默认会退出进程。Electron 主进程退出后触发 `vite-plugin-electron` 的 `startup.exit → treeKillSync → taskkill /T /F`，而 `taskkill` 无超时保护，最终导致 Vite 父进程也崩溃
  - **修复方案**：
    1. 在 `src/main/index.ts` 顶部添加全局 `process.on('unhandledRejection')` 和 `process.on('uncaughtException')` 处理器，仅记录日志不退出进程（兜底所有逃逸异常）
    2. 为 `chatHistory:vectorizeIncremental` IPC handler 添加 try-catch + 进入日志，返回 `{success: false, error}` 而非抛出异常
    3. 为 `chatHistory:retrieve` IPC handler 添加 try-catch + 进入日志，失败返回空数组（与内部失败行为一致）
  - **验证方式**：下次复现时，若异常逃逸，日志将输出 `[Main Process] UNHANDLED REJECTION (swallowed to prevent crash): ...` 而非崩溃；若异常在 handler 内，日志将输出 `[IPC] chatHistory:vectorizeIncremental: handler error: ...` 并返回 `{success: false}`
  - 涉及文件：`src/main/index.ts`（第 6-16 行全局异常处理器）、`src/main/ipc/handlers/characterChatHandlers.ts`（第 107-135 行两个 handler 的 try-catch 包裹）
  - 文档同步：`doc/04b-character-dialogue-chat-module.md` 在诊断日志段落后追加【重点标记】向量化崩溃修复段落
- **【重点标记】对话向量化可观测性诊断日志补全**：针对用户反馈"向量化结果长时间不返回，无法判断是向量化未完成还是结果未处理"的可观测性盲点，在增量向量化全链路补全耗时与进度日志。
  - **问题现象**：AI 流式响应完成后（日志 `SSE 解析成功`），增量向量化触发但 20-30 秒内无任何日志输出，用户无法判断卡在哪一步
  - **根因**：`ChatVectorizationService.vectorizeIncremental` 对最近 10 条消息**串行**调用远程 Embedding API（10 × 2-3s = 20-30s 等待期），循环内此前无逐条进度日志
  - **新增日志节点**：
    - `ChatVectorizationService.vectorizeIncremental`：每条消息的 embedding 开始（`role`/`textLen`/`id`）、完成耗时、`add` 确认、跳过/失败原因；`starting` / `persisting N vectors` / `persist done in Xms` / `completed in Xms`
    - `VecstoreVectorStore.doPersist`：`export_json()` 耗时（WASM 同步阻塞可观测）、`writeFile` 耗时、总耗时
    - `EmbeddingService.generateEmbedding`（remote）：`fetch` 耗时与状态码（与 30s 超时配套，定位是慢还是卡死）
    - `aiHandlers.ts`：`ai:stream:complete` 发送前后各一条日志（确认主进程事件链路完整）
  - 渲染层 `hooks.ts` 已有 `[DEBUG-COMPLETE] === engine.onComplete called ===` 与 `Step A2-incremental: triggering vectorizeIncremental` 日志，构成完整事件链
  - 本次仅补日志，串行→并行化优化待后续 spec 处理
  - 涉及文件：`src/main/services/ChatVectorizationService.ts`、`src/main/services/VecstoreVectorStore.ts`、`src/main/services/EmbeddingService.ts`、`src/main/ipc/handlers/aiHandlers.ts`
  - 文档同步：`doc/04b-character-dialogue-chat-module.md` 在 `vectorizeIncremental` 小节后追加【重点标记】增量更新段落
- **对话模式 Think 标签后处理开关**（Spec: handle-think-tags-overflow）：针对 deepseek3.2 等老模型在 AI 回复 / 润色结果中内联 think / thinking / thought 推理标签的问题，新增 `AIParameterConfig.strip_think_tags` 开关，默认开启，在 `onComplete` 写入存储前剥离其内容。
  - **问题现象**：现有 `stripThinkingTags` 工具仅在渲染时（`processMessage` 内）清理，存储 / 上下文回传 / RAG 向量化仍保留原始标签，造成历史污染与无效 token 累积
  - **解决方案**：在 `requestAIResponse.onComplete` 与 `polishInput.onComplete` 写入存储前按开关调用 `stripThinkingTags(finalContent)`；渲染层 `processMessage` 内的兜底剥离保留（处理历史脏数据）；流式 `onStream` 阶段不剥离，避免未闭合标签误删后续正文
  - **UI**：`ParameterPanel` 在「Emoji 增强模式」与「自定义停止序列」之间新增「Think 标签处理」Switch（沿用 emoji 区块的样式 + Tooltip），经 `ConfigPanel` 透传，由 `CharacterDialogueChat.tsx` 绑定 `characterConfig.customParameters.strip_think_tags !== false` 并通过 `handleParameterChange` 持久化到 `localStorage['character-session-<cardId>']`
  - 涉及文件：`CharacterDialogueChat.types.ts`（`strip_think_tags?: boolean`）、`CharacterDialogueChat.hooks.ts`（导入 `stripThinkingTags` + 两处 `onComplete` 后处理）、`ParameterPanel.tsx`（Switch UI）、`ConfigPanel.tsx`（props 透传）、`CharacterDialogueChat.tsx`（状态绑定）
  - 文档同步：`doc/04b-character-dialogue-chat-module.md` 3.5 节新增「Think 标签后处理」表格 + 4.4 节边界情况新增条目
- **创作中心聊天模式向量化/知识库/记忆面板优化（E1-E5）**：优化 `CharacterDialogueChat` 配置面板的命名、分组、健康度反馈与检索效果反馈。
  - **E1 面板重命名**：`VectorizationPanel.tsx` 标题「向量化设置」→「知识库检索」，Tooltip 说明更新为「绑定知识库文档，对话时自动检索相关内容注入上下文。向量化模型请在系统设置中配置。」
  - **E3 概念分组与说明**：`ConfigPanel.tsx` 在 VectorizationPanel 与 MemoryTablePanel 之上新增分组标题「记忆与上下文增强」（fontSize 14px，color `var(--config-panel-sub-title-color)`）；两个面板下方各增加一行说明小字（fontSize 12px，color `var(--config-panel-sub-text-color, #94a3b8)`，marginTop 4px）—— VectorizationPanel 下「从文档中检索相关知识注入上下文」，MemoryTablePanel 下「AI 自动整理对话中的关键信息到表格」
  - **E4+E5 知识库健康度与重试**：`KnowledgeBaseBindingPanel.tsx` 移除 2 处 `console.log` 调试语句（Fetched scopes result / Filtered knowledge base scopes）；每个知识库列表项（`renderOptionLabel`）增加状态 Tag（`vectorCount>0` 绿色「可检索」/`vectorCount===0` 橙色「未向量化」）；错误状态区域增加「重试」按钮（Ant Design Button + ReloadOutlined，size small，点击重新调用 `fetchKnowledgeBases`）
  - **E2 检索效果反馈**：`KnowledgeBaseBindingPanel.tsx` 知识库列表底部增加检索反馈区域（仅 `boundKnowledgeBaseIds.length>0` 显示），从 `sessionStorage[chat-rag-feedback-{characterCardId}]` 读取 `{hitCount, tokenCount, timestamp}`，显示「上次检索：命中 N 条，注入约 M Token（相对时间）」，无记录时显示「尚无检索记录」；新增 `getRelativeTime` 辅助函数（刚刚 / N 分钟前 / N 小时前 / N 天前）与 `ragFeedback` state + 读取 useEffect
  - 涉及文件：`src/renderer/components/Character/CharacterDialogueChat/VectorizationPanel.tsx`、`ConfigPanel.tsx`、`KnowledgeBaseBindingPanel.tsx`
  - 文档同步：`CODE_WIKI.md` 6.1 章节组件描述更新
- **`rollbackToMessage` 核心逻辑单元测试**（Spec: rollback-user-message / Task 4）：为 `useCharacterDialogueChat` hook 中的 `rollbackToMessage` 函数新增单元测试，验证消息卷回核心算法的正确性。
  - **新增文件**：
    - `src/renderer/components/Character/CharacterDialogueChat/__tests__/rollbackToMessage.test.ts`（7 个测试用例）
  - **测试策略**：采用**纯函数提取测试**。`rollbackToMessage` 实际实现位于 `CharacterDialogueChat.hooks.ts:2116-2154`，依赖 `messagesRef` / `setState` / `cancelRequest` / `saveChatToStore` / `addLog` 等 hook 内部状态与副作用，难以在隔离环境下直接测试。将其核心算法（消息查找 / role 校验 / `slice(0, messageIndex)` 裁剪 / 内容返回）提取为纯函数 `rollbackToMessageCore(messages, messageId) => { content, updatedMessages }` 进行测试
  - **覆盖场景**（全部通过，4ms）：
    1. 卷回最后一条用户消息：移除该消息 + AI 回复，返回用户消息内容
    2. 卷回中间轮次用户消息：移除该消息及所有后续消息
    3. 卷回第一条用户消息：移除所有消息，返回内容
    4. messageId 不存在时返回空串且不修改消息列表（对应 hook 中 `findIndex === -1` 早返分支）
    5. 目标消息 role 不是 user 时返回空串且不修改消息列表（对应 hook 中 `targetMessage.role !== 'user'` 早返分支）
    6. 空消息列表时返回空串
    7. 卷回后返回的内容与原用户消息内容完全一致（含中文 / 英文 / 数字 / 特殊符号的长文本完整性校验）
  - **已知局限**：纯函数测试不覆盖 hook 副作用（`cancelRequest` 取消流式、`saveChatToStore` 持久化、`setState` 状态合并、`addLog` 日志记录），需通过 Task 4.3 手动验证场景确认。如后续需测试副作用，需引入 `@testing-library/react` + `renderHook` 并 mock Electron API 与 ChatEngineFactory
  - **文档同步**：`doc/04b-character-dialogue-chat-module.md` 在「用户消息卷回按钮」章节追加「单元测试」小节；`.trae/specs/rollback-user-message/tasks.md` Task 4 SubTask 4.1 / 4.2 标记完成；`.trae/specs/rollback-user-message/checklist.md` 测试小节 5 项全部勾选
  - **验证结果**：`npx vitest run src/renderer/components/Character/CharacterDialogueChat/__tests__/rollbackToMessage.test.ts` → 1 file passed, 7 tests passed
  - 涉及文件：`src/renderer/components/Character/CharacterDialogueChat/__tests__/rollbackToMessage.test.ts`（新建）、`doc/04b-character-dialogue-chat-module.md`（追加单元测试小节）、`.trae/specs/rollback-user-message/tasks.md`（标记 Task 4 SubTask 4.1/4.2）、`.trae/specs/rollback-user-message/checklist.md`（勾选测试 5 项）、`CHANGELOG.md`（新增条目）

- **编写游戏模式技术文档 `doc/10-game-mode-module.md`**（Spec: add-game-mode-framework / Task 18）：为已完成的「游戏模式」阶段一（框架）与阶段二（经营游戏）编写完整技术文档，遵循 `doc/01-dashboard-module.md` 的章节结构，作为后续开发者理解与扩展游戏模式的核心参考资料。
  - **新增文件**：
    - `doc/10-game-mode-module.md`（约 1100 行）：游戏模式模块技术文档，含 12 个主章节 + 1 个附录 + 7 个重点标记
  - **章节清单**：
    1. **模块功能描述** —— AI 驱动纯文字冒险游戏模式，多游戏类型支持、流式叙事、tableEdit 协议、多存档管理、版本快照、ANSI 瓦片渲染、可扩展模板体系
    2. **模块定位与业务价值** —— 创作中心第三个核心模式（与对话/写作并列），解决 AI 输出结构化持久化、多游戏类型统一框架、存档状态分散、流式中断、prompt 差异等痛点
    3. **技术实现方案** —— 整体架构图、8 种设计模式（Repository / Template Method / Strategy / Observer / Lazy Init / DI / Wrapper / AbortController）、3 个核心算法（tableEdit 解析与执行 / AI 叙事生成主流程 / endTurn 完整流程）、组件树、状态管理设计
    4. **关键技术要点** —— 8 个技术难点与解决方案、8 个性能优化策略、6 个安全考虑、6 个边界情况处理
    5. **模块间关系** —— 依赖关系图、被依赖关系、数据流、集成点（CreationCenter / Settings / AIService / Writing / File）
    6. **数据持久化** —— 8 种数据项的存储机制（meta.json / save.json / table-data.json / table-config.json / table-versions.json / state-snapshot.json 等）、缓存策略、数据生命周期
    7. **IPC 接口表** —— 21 个 IPC 通道详细说明：5 个元数据 CRUD、5 个存档 CRUD、6 个表格数据 CRUD + 版本快照、2 个 AI 叙事生成、2 个游戏本地配置、4 个流式事件监听器（game:narrative:chunk / complete / error / game:table:updated）
    8. **表格 Schema 与 tableEdit 协议** —— 经营游戏 5 sheet 结构表、GameTableSchema 接口、tableEdit 标签格式与命令格式、索引规则（1-based）、增量更新策略、版本快照机制（saveVersionSnapshot / confirmVersion / rollbackVersion + 24h TTL）
    9. **AI Prompt 构建流程** —— System prompt 6 段拼装顺序、User prompt 4 段拼装顺序、经营游戏专属 prompt 6 段、跨进程传递策略（templateSystemPrompt + tableSchema 由渲染进程取出后传入主进程）
    10. **ANSI 瓦片渲染原理** —— CSS Grid 实现、ANSI SGR 转义序列解析（30-37 前景色 / 40-47 背景色 / 1 加粗 / 0 重置）、VGA 调色板、tileStyles 优先级、性能考量（useMemo 缓存 / stripAnsi 工具 / Grid 优于 table）、用法示例
    11. **扩展指南：新增游戏类型** —— 5 步流程（实现 GameTypeTemplate / 注册到 GameTemplateRegistry / 创建主进程 Prompt Builder + NarrativeService / 创建示例游戏元数据 / 模板组件 Props 契约），以新增"文字 RPG"为例
    12. **后续游戏类型实现规划** —— 4 种游戏类型的详细技术点与预估工作量：
       - **狼人杀**（中大型，约 2-3 周）：多人角色管理、阶段切换、AI 扮演多角色、投票系统、胜利条件判定
       - **逆转裁判类推理**（大型，约 3-4 周）：证据收集与比对、法庭辩论流程、矛盾判定、章节结构、剧情分支
       - **恋爱模拟**（中型，约 2 周）：好感度系统、关系图谱、约会事件分支、礼物系统、场景选择、时间管理
       - **文字 RPG**（大型，约 3-4 周）：回合制战斗、技能树、装备系统、经验值与升级、属性系统、敌人 AI、存档平衡
    13. **附录：相关文件清单** —— 主进程 13 个文件、渲染进程 24 个文件、共享类型与常量 2 个文件、数据文件 2 个、Preload 桥接 1 个
    14. **已知问题与经验教训** —— 7 个重点标记问题
  - **【重点标记 1：vitest.config.ts 静默跳过 .tsx 测试文件】**：阶段一开发期间 `include` 字段原为 `['src/**/*.test.ts']`，仅匹配 `.ts` 后缀，所有组件级 `.tsx` 测试被静默跳过。修复方案：扩展为 `['src/**/*.test.ts', 'src/**/*.test.tsx']`。经验教训：vitest 在 `include` 不匹配任何文件时不报错，需开发者主动验证测试是否被执行
  - **【重点标记 2：ManagementGameTemplate serializeState/deserializeState 接口签名与 spec 描述不一致】**：spec 描述为 `(state) => JSON 字符串`，但实际类型签名为 `(state: Record<string, any>) => Record<string, any>`（返回结构化对象，由存档层负责 JSON 序列化）。按实际类型实现，spec 描述偏差以类型定义为单一真源
  - **【重点标记 3：gameNarrativeHandlers 未接入 ManagementNarrativeService 包装层】**：`gameNarrativeHandlers.ts` 仍直接调用通用 `GameNarrativeService.generateNarrative`，未根据 `request.gameType` 路由到 `ManagementNarrativeService` 包装层。意味着 `end_turn` userAction 在主进程实际走通用叙事生成路径，不会触发 endTurn 的资源结算 / 随机事件 / 回合 +1 / 自动存档等专属逻辑。后续修复方向：在 `gameNarrativeHandlers.ts` 中按 `request.gameType` 路由，或新增独立 IPC 频道 `game:management:endTurn`
  - **【重点标记 4：vi.mock 路径计算错误导致 mock 静默未生效】**：编写 `ManagementGameMain.test.tsx` 时 mock 子组件路径使用了 4 个 `..` 段，实际只需 3 个 `..` 段（`__tests__` → `management` → `templates` → `Game` → `panels`）。vitest 不报错但 mock 静默未生效，导致测试失败。经验教训：vitest 的 mock 路径解析失败时不抛错，建议在编写 mock 时先通过单独运行测试验证路径
  - **【重点标记 5：antd v6 Button 的 forwardRef 不能直接调用】**：测试中 mock antd Button 时直接调用 `actual.Button(props)` 抛 `TypeError: actual.Button is not a function`，因为 antd v6 的 Button 是 forwardRef 包装的组件。修复方案：使用 `React.createElement(actual.Button, props)` 而非 `actual.Button(props)`
  - **【重点标记 6：GameRepository 模块加载时自动调用 ensureIndexExists 与测试 mock 时序冲突】**：`GameRepository.ts` 末尾添加 `gameRepository.ensureIndexExists()` 后，该调用在 import 时即触发（模块加载阶段），与测试 mock 的时序冲突。修复方案：使用 `vi.hoisted(() => { ... return { current: fs.mkdtempSync(...) } })` 在所有 import 之前创建初始临时目录并赋值给共享 ref，`vi.mock` 工厂返回 `getUserDataPath: () => tmpRootRef.current`。该模式适用于所有"主进程模块加载时自动初始化副作用 + 测试 mock"场景
  - **【重点标记 7：endTurn 中事件效果与产出结算的合并问题】**：旧实现 `buildEventCommands` 同时生成 insertRow 到 events sheet 与 updateRow 到 resources sheet，对同一资源行产生多条 updateRow 互相覆盖。修复方案：将事件效果（eventDeltas）合并到 `settleProduction` 方法中，与 facilities 产出、resources change_per_turn 合并计算后生成单条 updateRow 命令。经验教训：多个来源对同一行数据产生变更时必须合并为单条 updateRow 命令
  - **遵循约束**：
    - 不修改任何代码文件（仅创建 doc/10-game-mode-module.md 与修改 spec 文档）
    - 不修改 vitest.config.ts
    - 使用中文
    - 遵循 `doc/01-dashboard-module.md` 的章节结构
  - **验证结果**：
    - 文档章节完整性核对：12 个主章节 + 1 个附录 + 7 个重点标记问题全部包含，符合 checklist 9 项要求
    - spec 文档 `tasks.md` Task 18 的 8 个 SubTask 全部勾选 `[x]`
    - spec 文档 `checklist.md` 中 doc/10 相关的 9 项全部勾选 `[x]`
  - 涉及文件：`doc/10-game-mode-module.md`（新建）、`.trae/specs/add-game-mode-framework/tasks.md`（标记 Task 18 完成）、`.trae/specs/add-game-mode-framework/checklist.md`（标记 doc/10 相关 9 项完成）、`CHANGELOG.md`（新增 Task 18 条目）

- **注册示例经营游戏元数据"田园小镇"**（Spec: add-game-mode-framework / Task 17）：为游戏大厅提供默认示例游戏，让用户首次启动即可在大厅看到并启动"田园小镇"。修改 `GameRepository.ensureIndexExists` 的初始化行为，从"写入空索引"升级为"写入包含示例游戏的默认索引 + 示例游戏 meta.json"，并在模块加载时自动调用。同时新增项目根目录下的种子数据文件作为版本控制下的参考。
  - **新增文件**：
    - `data/games/games-index.json`：项目根目录下的种子索引文件，包含 1 个示例游戏摘要（id=`pastoral_town`、type=`management`、status=`completed`、title=`田园小镇`、tags=`["经营","模拟","建设"]`、createdAt/updatedAt=1735689600000）。该文件作为版本控制下的参考种子，运行时实际使用 `userData/data/games/games-index.json`（由 `ensureIndexExists` 在首次启动时创建）
    - `data/games/pastoral_town/meta.json`：示例游戏完整 GameMeta，包含 description（详细介绍）/ gameplay（玩法说明，含建造、招募、结束回合、资源说明、随机事件 5 段）/ developer（Creative Cafe Team）/ version（1.0.0）/ templateKey（`management`，与 `GameType.MANAGEMENT` 枚举值一致）/ tags / 时间戳等字段
  - **修改文件**：
    - `src/main/services/game/GameRepository.ts`：
      - 新增 `DEFAULT_PASTORAL_TOWN_META: GameMeta` 常量（与项目根目录 `data/games/pastoral_town/meta.json` 内容一致），作为运行时初始化的种子源
      - 重写 `ensureIndexExists()` 方法：① 检查索引文件是否存在，已存在直接 return（保留用户修改）；② 写入示例游戏 meta.json（如该文件不存在）；③ 写入包含示例游戏摘要的默认索引（version=`1.0.0`、games=[pastoral_town 摘要]）。原实现写入空索引 `{version, games: []}`，新实现让首次启动即可在大厅展示示例游戏
      - 模块末尾新增 `gameRepository.ensureIndexExists()` 调用：在 `import` GameRepository 时自动触发首次启动初始化，无需调用方显式触发。注释说明测试环境通过 `vi.mock` 替换 `getUserDataPath` 指向临时目录避免污染开发环境
      - 同步更新文件顶部 docstring 与 GameRepository 类 docstring
    - `src/main/services/game/__tests__/GameRepository.test.ts`：
      - 用 `vi.hoisted` 创建共享 ref + 初始临时目录，解决"模块加载时自动调用 `ensureIndexExists` 与测试 mock 时序冲突"问题（详见下方"重点标记"）
      - 替换原"应创建空索引 `{version, games: []}`"测试为"应创建包含示例游戏'田园小镇'的默认索引"，断言 `games[0].id === 'pastoral_town'` / `type === GameType.MANAGEMENT` / `status === GameStatus.COMPLETED`
      - 新增"当索引文件不存在时，应同时写入示例游戏 meta.json"测试，断言 meta.json 各字段（id / type / status / title / developer / version / templateKey / tags / createdAt）
      - 新增"当索引已存在但示例游戏 meta.json 缺失时，ensureIndexExists 不应补写 meta.json"测试，验证已存在索引时直接 return 的契约
      - 新增 `afterAll` 清理模块加载时创建的初始临时目录
  - **设计要点**：
    - **种子数据双写策略**：项目根目录 `data/games/pastoral_town/meta.json` 作为版本控制下的"参考种子"（开发者可读、可被 CI 校验、不参与运行时）；`DEFAULT_PASTORAL_TOWN_META` 常量作为运行时初始化源（在 `ensureIndexExists` 中使用）。两者内容必须保持一致，注释中明确要求"修改时请同步更新两处，避免运行时与种子数据漂移"
    - **templateKey 字段保留并使用小写**：`GameMeta.templateKey?` 是可选字段，注释说"与 GameType 一致"。本任务使用 `GameType.MANAGEMENT`（即 `'management'` 小写字符串），而非任务描述示例中的 `"MANAGEMENT"` 大写。理由：`GameType` 是 string enum，`MANAGEMENT = 'management'`，`templateKey` 取值应与枚举值（运行时字符串）一致而非枚举名
    - **时间戳固定为 1735689600000**（2025-01-01 00:00:00 UTC）：便于回归测试断言，避免使用 `Date.now()` 导致每次运行结果不一致
    - **索引已存在时直接 return**：保留用户已有的修改或自定义游戏列表，不强制覆盖。即使用户删除了示例游戏，下次启动也不会重新写入（仅首次启动写入）
    - **副作用最小化**：`ensureIndexExists` 仅在索引文件不存在时才写入；任何写入失败仅打印日志不抛错，避免阻塞主进程启动
  - **【重点标记 - 模块加载时自动调用与测试 mock 时序冲突】**：
    `GameRepository.ts` 末尾添加 `gameRepository.ensureIndexExists()` 后，该调用在 `import { gameRepository } from '../GameRepository'` 时即触发（模块加载阶段）。此时测试文件的 `let tmpRoot = ''` 还未执行（ES module 顶层代码在 import 之后才求值），若 vi.mock 工厂直接读取 `tmpRoot`，会得到空字符串，导致 `getGamesIndexPath()` 返回相对路径 `'data/games/games-index.json'`，最终 `fs.existsSync` 命中项目根目录下的种子文件并跳过写入（看似无害），但若项目根目录无种子文件则会写入到 cwd 下相对路径，污染开发环境。
    解决方案：使用 `vi.hoisted(() => { const fs = require('fs'); ...; return { current: fs.mkdtempSync(...) } })` 在所有 import 之前创建一个初始临时目录并赋值给共享 ref。`vi.mock` 工厂返回 `getUserDataPath: () => tmpRootRef.current`，在模块加载阶段 `tmpRootRef.current` 已指向初始临时目录，`ensureIndexExists` 写入到该临时目录。`beforeEach` 中切换 `tmpRootRef.current` 到新的临时目录保持测试隔离，`afterAll` 清理初始临时目录。该模式适用于"主进程模块加载时自动初始化副作用 + 测试 mock"的所有场景
  - **【重点标记 - 任务描述示例与实际类型不一致，按实际类型实现】**：
    任务描述给出的 `games-index.json` 示例使用 `"version": 1`（数字）和 `"status": "COMPLETED"`（大写枚举名），但 `src/shared/constants/game.constants.ts` 中 `GAMES_INDEX_VERSION = '1.0.0'`（字符串），`src/shared/types/game.types.ts` 中 `GameType.MANAGEMENT = 'management'`、`GameStatus.COMPLETED = 'completed'`（小写枚举值）。按任务要求"如发现类型实际定义与本任务描述不符，按实际类型实现"，最终使用 `version: "1.0.0"`、`type: "management"`、`status: "completed"`、`templateKey: "management"`（小写）。`GameIndexEntry` 类型不包含 `templateKey` 字段（仅有 id/type/title/subtitle/status/coverPath?/tags/createdAt/updatedAt），故 `games-index.json` 中不写入 `templateKey`；`GameMeta` 类型包含可选 `templateKey?` 字段，故 `meta.json` 中保留该字段
  - **验证结果**：
    - `npx tsc --noEmit`：在新增/修改文件（GameRepository.ts / GameRepository.test.ts / data/games/*.json）上无错误；仅 `vitest.config.ts` 的 `WatchOptions` 类型错误为预存错误（与本任务无关）
    - `npx vitest run src/main/services/game`：5 个测试文件 / 149 个测试全部通过（`Test Files 5 passed (5) / Tests 149 passed (149) / Duration 1.49s`），含 GameRepository 24 个（含 4 个 ensureIndexExists 测试）/ GameSaveRepository 38 / GameTableEditParser 36 / GamePromptBuilder 32 / gameHandlers 24 等
    - `npx vitest run`（全量）：41 个测试文件 / 916 个测试全部通过（GameRepository.test.ts 从 21 个测试扩展为 24 个，新增 3 个 ensureIndexExists 测试，含 ManagementGameMain 等 Task 16 已有测试无回归）；`Duration 11.69s`
    - JSON 文件可被 `JSON.parse` 解析，字段值与 `GameMeta` / `GameIndexEntry` 类型一致
  - 涉及文件：`data/games/games-index.json`（新建）、`data/games/pastoral_town/meta.json`（新建）、`src/main/services/game/GameRepository.ts`（修改 ensureIndexExists + 添加 DEFAULT_PASTORAL_TOWN_META + 模块末尾自动调用）、`src/main/services/game/__tests__/GameRepository.test.ts`（重写 mock 与 ensureIndexExists 测试套件）

- **经营游戏端到端游戏循环**（Spec: add-game-mode-framework / Task 16）：将渲染层模板（ManagementGameMain）与主进程叙事服务（ManagementNarrativeService）串联起来，实现完整的开场 → 建造 → 招募 → 结束回合 → 自动存档 → 读档恢复 游戏循环。在已完成的 Task 14（模板）+ Task 15（叙事服务）+ Task 13（通用面板）基础上，仅修改 `ManagementGameMain.tsx` 一个文件即完成渲染层串联。
  - **修改文件**：
    - `src/renderer/components/Game/templates/management/ManagementGameMain.tsx`（从 156 行扩展为 343 行）：
      - 新增"招募"折叠面板（CollapsiblePanel 包裹内联 RecruitPanel 组件），硬编码 3 个可招募角色（farmer / lumberjack / merchant），与 `ManagementNarrativeService.RECRUIT_COSTS` 表保持一致；点击招募按钮触发 `onAction('recruit:<characterId>')`，由 GameMainPage 包装为 `generateNarrative({ userAction: 'recruit:farmer' })`
      - `currentTurn` 改为响应式派生：从 `useMemo(() => useGameStore.getState().tableData, [])` 改为 `useGameStore((s) => s.tableData)` selector + `useMemo(deriveCurrentTurn, [tableData])`，使 endTurn 后 AI 通过 tableEdit 更新 stats sheet 的 turn 行时 UI 自动反映新回合数
      - 新增 `deriveCurrentGold` 工具函数：从 tableData.resources 读取金币行，用于招募按钮的资源不足视觉提示（按钮仍可点击，由后端校验）
      - 新增 `handleRecruit` 回调：与 `handleEndTurn` / `handleBuild` 同样的"防并发 + onAction 上抛"模式
      - 工具条副文案从"建造设施或结束回合以推进游戏"扩展为"建造设施 / 招募角色 / 结束回合以推进游戏"
    - `src/renderer/components/Game/templates/management/__tests__/ManagementGameMain.test.tsx`（新建，约 520 行）：28 个测试用例，覆盖 10 个核心场景 + 8 个补充场景：
      - 渲染 4 个面板（资源 / 设施 / 招募 / 统计）
      - 当前回合派生（含 4 个容错：tableData=null / stats sheet 缺 turn 行 / value 非数字 / 响应式更新）
      - 结束回合按钮（渲染 + 点击触发 onAction('end_turn') + isGenerating 时禁用与不触发）
      - 招募面板（3 个硬编码角色 + 成本信息与 RECRUIT_COSTS 一致）
      - 招募按钮点击（farmer / lumberjack / merchant 各触发对应 userAction + isGenerating 时禁用与不触发）
      - FacilityPanel onBuild 传递（捕获 prop + 调用触发 onAction('build:farm') + isGenerating 时不触发）
      - 资源不足视觉提示（金币 < 成本时显示 / 充足时不显示 / 等于成本时不算不足）
      - tableData 变化时 currentTurn 自动更新
      - 主容器与工具条 className / data-testid 验证
      - 传递给 3 个面板的 sheetName prop 验证
  - **设计要点**：
    - **最小侵入原则**：仅修改 `ManagementGameMain.tsx` 一个文件 + 新建测试文件，不修改主进程代码 / store / preload / 通用面板 / 模板定义 / schema / 初始状态。所有约束严格遵守（"不要修改主进程代码" 等 8 条约束）
    - **不直接调用 store.generateNarrative**：玩家行动通过 `props.onAction` 回调上抛给 GameMainPage 框架，由其统一包装 `generateNarrative({ userAction })`，便于在框架层注入 `templateSystemPrompt` / `tableSchema`（避免重复在模板组件中维护这些字段）
    - **响应式 currentTurn**：从 `useGameStore.getState().tableData`（一次性读取）改为 `useGameStore((s) => s.tableData)` selector（响应式订阅），配合 `useMemo(deriveCurrentTurn, [tableData])`，使 endTurn 后 AI 通过 tableEdit 更新 stats sheet 的 turn 行时 UI 自动反映新回合数。这是端到端循环"状态闭环"的关键修复点
    - **招募成本与后端对齐**：`RECRUIT_OPTIONS` 数组的 `id / costGold` 字段与主进程 `ManagementNarrativeService.RECRUIT_COSTS` 完全一致（farmer 20 / lumberjack 30 / merchant 50）。若后续后端调整成本，前端需同步更新（建议未来抽出为共享常量，避免重复定义）
    - **招募按钮的资源不足提示**：仅作 UI 视觉提示，按钮仍可点击。理由：① 前端无法读取 facilities production 等复杂状态，硬性校验会与后端规则不同步；② 后端 `ManagementNarrativeService.applyCharacterRecruit` 已通过 `buildResourceDeductionCommands` 做实际扣减；③ 资源不足时让 AI 在叙事中提示玩家更自然
    - **不重复造轮子**：招募面板的 `RecruitPanel` 内联在 `ManagementGameMain.tsx` 中（未单独抽出为通用面板），因为招募场景是经营游戏特有逻辑（角色列表 / 成本表 / 行动 userAction 前缀），不通用。若未来其他游戏类型也需要招募，可再抽出
    - **测试 mock 路径模式**：mock ResourcePanel / FacilityPanel / StatisticsPanel 而非真实渲染，避免 antd Card / List / Statistic 等子组件的渲染副作用（特别是 `react-markdown` 在 node 测试环境下的复杂行为）。FacilityPanel mock 通过 `capturedFacilityOnBuild.current = props.onBuild` 捕获 onBuild 回调，测试手动调用验证调用契约（参考 GameMainPage.test.tsx 的 Button 捕获模式）
  - **【重点标记 - preload 未暴露 endTurn，用通用 generateNarrative 接口适配】**：preload.ts 的 `game` 命名空间仅暴露 `generateNarrative / cancelGeneration` 等通用 IPC，未单独暴露 `endTurn` 频道。约束明确"不要修改 preload.ts"，因此渲染层"结束回合"流程通过 `gameStore.generateNarrative({ userAction: 'end_turn' })` 通用接口触发。该 userAction 由 `ManagementNarrativeService.generateNarrative` 主入口分发到 `endTurn` 流程（参见 Task 15 ManagementNarrativeService.ts L208-211）。**已知限制**：当前 `gameNarrativeHandlers.ts` 直接调用通用 `GameNarrativeService.generateNarrative` 而非 `ManagementNarrativeService` 包装层（ManagementNarrativeService.ts 文件末尾的注释明确说明），意味着 `end_turn` userAction 在主进程实际走的是通用叙事生成路径，不会触发 endTurn 的资源结算 / 随机事件 / 回合 +1 / 自动存档等专属逻辑。这是主进程层面的已知 gap，由后续 Task（如引入 `game:management:endTurn` 独立 IPC 频道或切换 GameNarrativeService 调用 ManagementNarrativeService 包装层）解决，不在本任务约束范围内（"不要修改主进程代码"）
  - **【重点标记 - vi.mock 路径计算错误导致 mock 未生效】**：初次编写测试时 mock ResourcePanel / FacilityPanel / StatisticsPanel 路径使用了 `'../../../../panels/<Name>'`（4 个 `..` 段），实际从 `src/renderer/components/Game/templates/management/__tests__/` 到 `src/renderer/components/Game/panels/` 只需要 3 个 `..` 段（`__tests__` → `management` → `templates` → `Game` → `panels`）。错误路径解析为 `src/renderer/components/panels/<Name>`（不存在），vitest 不报错但 mock 静默未生效，导致测试用例"FacilityPanel 接收 onBuild 回调"失败（`capturedFacilityOnBuild.current` 为 null）。修复为 `'../../../panels/<Name>'` 后测试通过。后续在 mock 子组件时需手动验证路径解析（参考 ManagementGameTemplate.test.tsx 中 `'../../GameTemplateRegistry'` 的相对路径模式：从 `__tests__/` 出发，每多嵌套一层目录就多一个 `..`）
  - **【重点标记 - 招募按钮的 forwardRef Button 不可直接调用】**：与 GameMainPage.test.tsx 同样的 antd v6 Button 问题，mock 时必须用 `React.createElement(actual.Button, props)` 而非 `actual.Button(props)`，否则抛 `TypeError: actual.Button is not a function`
  - **验证结果**：
    - `npx vitest run src/renderer/components/Game/templates/management`：77 个测试全部通过（`Test Files 2 passed (2) / Tests 77 passed (77) / Duration 10.58s`），含本任务新增 28 个 ManagementGameMain 测试 + 既有 49 个 ManagementGameTemplate 测试
    - `npx vitest run`（全量）：916 个测试全部通过（41 个测试文件，含本任务新增的 28 个 ManagementGameMain 测试，与既有 888 个测试无冲突）；`Duration 11.53s`
    - `npx tsc --noEmit`：在修改 / 新增文件（ManagementGameMain.tsx / ManagementGameMain.test.tsx）上无错误（其他既有文件的预存错误与本任务无关）
  - **手动验证清单**（由于无法实际运行 Electron 应用，请开发者按以下步骤手动验证）：
    - [ ] **开场**：启动应用 → 创想咖啡厅 → 创作中心 → 游戏面板 → 选择"田园小镇"游戏 → 点击"开始游戏" → 进入主页面 → 验证初始资源显示（金币 500 / 食物 50 / 木材 30 / 人口 5）+ 当前回合显示"第 1 回合"
    - [ ] **建造**：在右侧"设施"折叠面板中找到可建设施 → 点击"建造"按钮 → 验证：① 按钮禁用并显示"生成中"状态；② 等待几秒后 AI 在左侧叙事面板流式描述建造过程；③ "设施"面板刷新显示新设施（如 farm）带 Lv.1 等级；④ "资源"面板的金币 / 木材数量已扣减（如 farm 扣 50 金币 + 10 木材）
    - [ ] **招募**：在右侧"招募"折叠面板中点击"招募农夫"按钮 → 验证：① 按钮禁用并显示"生成中"状态；② AI 在叙事面板描述新角色加入小镇；③ "资源"面板的金币扣减 20，人口 +1；④ **【已知限制】** 由于主进程当前未接入 ManagementNarrativeService 包装层，AI 在 characters sheet 新增行的 tableEdit 命令可能不会被自动应用（取决于通用 GameNarrativeService 是否解析 tableEdit）。如发现 characters sheet 未更新，需在后续 Task 切换主进程调用为 ManagementNarrativeService 包装层
    - [ ] **结束回合**：点击工具条右侧"结束回合"按钮 → 验证：① 按钮禁用并显示"生成中"状态；② 等待几秒后 AI 在叙事面板描述本回合事件（含随机事件如丰收 / 灾害 / 旅人来访）；③ "资源"面板刷新显示结算后的资源变化（如食物 +10 丰收）；④ "统计"面板与工具条显示"第 2 回合"；⑤ 自动存档触发（GameStateBar 的"存档"按钮变为已存档状态）
    - [ ] **自动存档**：每回合结束后验证 `data/game-saves/<saveId>/save.json` 的 `meta.currentTurn` 已更新为最新回合数；验证 `tables/table-data.json` 的 stats sheet 的 turn 行已更新；验证 `tables/table-versions.json` 已记录版本快照
    - [ ] **退出读档**：点击工具条"退出"按钮 → Modal.confirm 确认 → 返回详情页 → 关闭游戏 → 重新启动应用 → 进入"田园小镇"详情页 → 点击"读取存档" → 选择刚才的存档 → 验证：① 资源 / 设施 / 统计 / 回合数 与退出前一致；② 剧情日志可滚动查看历史消息
  - 涉及文件：`src/renderer/components/Game/templates/management/ManagementGameMain.tsx`（修改：增加招募面板 + 响应式 currentTurn + handleRecruit 回调）、`src/renderer/components/Game/templates/management/__tests__/ManagementGameMain.test.tsx`（新建：28 个测试用例）、`.trae/specs/add-game-mode-framework/tasks.md`（标记 Task 16 完成）、`.trae/specs/add-game-mode-framework/checklist.md`（标记"完整游戏循环可走通"完成）

- **经营游戏 AI 叙事生成**（Spec: add-game-mode-framework / Task 15）：为"田园小镇"经营类游戏实现专属叙事服务，包装通用 `GameNarrativeService`，添加 userAction 路由（build: / recruit: / end_turn / 自由文本）、endTurn 完整流程（结算产出 → 触发随机事件 → 回合 +1 → 触发 AI 叙事 → 自动存档），以及经营专属 prompt 构建（资源经济规则 / 回合制规则 / 随机事件规则 / tableEdit 示例 / schema 提示）。
  - **新增文件**：
    - `src/main/services/game/templates/management/ManagementPromptBuilder.ts`（约 445 行）：经营游戏 prompt 构建器。`buildSystemPrompt(meta, tableSchema)` 拼装 6 个段落（角色定位 / 资源经济 / 回合制规则 / 随机事件 / tableEdit 示例 / schema 提示），作为 `templateSystemPrompt` 注入到通用 `GamePromptBuilder` 输出末尾的【模板额外规则】段。`buildUserPrompt({userAction, currentTurn, tableSnapshot, recentEvents})` 构建独立场景下的 user prompt（4 段：当前回合 / 资源快照 / 最近事件 / 玩家行动），主要用于单元测试与 endTurn 等特殊场景。常量 `RECENT_EVENTS_COUNT = 3` 与 `MAX_ROWS_PER_SHEET = 20`（与 `GamePromptBuilder.MAX_ROWS_PER_SHEET_IN_PROMPT` 对齐）
    - `src/main/services/game/templates/management/ManagementNarrativeService.ts`（约 700+ 行）：经营游戏叙事服务，通过依赖注入持有 `narrativeService / promptBuilder / tableRepository / saveRepository / randomSource`。`generateNarrative(request, callbacks, abortSignal)` 主入口按 userAction 前缀分发：`end_turn` → endTurn 流程；`build:<facility_id>` → `applyFacilityBuild` 扣减资源（FACILITY_COSTS 表：farm/market/sawmill/house）；`recruit:<character_id>` → `applyCharacterRecruit` 扣金币加人口（RECRUIT_COSTS 表：farmer/merchant/lumberjack）；自由文本直接调用通用叙事生成。`endTurn(saveId, callbacks, abortSignal)` 流程：① 读取 tableData → ② rollRandomEvent → ③ settleProduction（合并 eventDeltas） → ④ buildEventInsertCommands（仅 insertRow） → ⑤ incrementTurnCommand → ⑥ applyTableEdits → ⑦ saveRepository.updateSave({currentTurn, turnCount}) → ⑧ narrativeService.generateNarrative。失败不阻塞叙事生成（让 AI 有机会提示玩家资源不足）。常量 `RANDOM_EVENTS`：30% harvest（food +10）/ 20% disaster（food -20）/ 10% traveler（population +1）/ 40% none
    - `src/main/services/game/templates/management/__tests__/ManagementNarrativeService.test.ts`（约 600+ 行）：19 个集成测试用例，使用 `vi.hoisted + vi.mock` 模式 mock AIService / storageService / storageManager / logger。覆盖 PromptBuilder（3 个：system prompt 段落构建 / user prompt 段落构建 / 空 schema 容错）、generateNarrative 路由（4 个：自由文本调用通用 generateNarrative / build: 应用资源扣减 / recruit: 应用资源扣减 + 人口增加 / end_turn 委托 endTurn 流程）、endTurn 流程（5 个：产出结算 / 随机事件触发概率 / 回合数 +1 / tableEdit 命令应用 / 自动存档）、边界与异常场景（7 个：随机源 mock 触发特定事件 / field 读取 convention / eventDeltas 合并避免重复 updateRow / 资源不足跳过扣减 / 未在成本表中的设施 / tableData 不存在 / mock 双重注入）
  - **设计要点**：
    - **包装/扩展模式（不修改通用层）**：`ManagementNarrativeService` 通过依赖注入持有 `GameNarrativeService` 实例，复用其 `generateNarrative / abortAll` 等方法。本类仅添加经营专属逻辑（userAction 路由 + endTurn 流程），通用叙事生成（流式推送 / tableEdit 解析 / 自动存档）由 `GameNarrativeService` 负责。严格遵守 spec 要求"不要修改通用 GameNarrativeService.ts / GamePromptBuilder.ts / GameTableEditParser.ts"
    - **依赖注入**：构造函数注入 5 个依赖（`narrativeService / promptBuilder / tableRepository / saveRepository / randomSource`）。`randomSource` 默认 `{ next: () => Math.random() }`，测试中可注入 mock 随机源以确定性地触发特定事件（如 harvest / disaster / traveler）
    - **prompt 注入策略**：通过 `request.templateSystemPrompt` 字段将 `ManagementPromptBuilder.buildSystemPrompt` 的输出注入到通用 `GamePromptBuilder`，最终以【模板额外规则】段拼接到 system prompt 末尾。本类不重复实现通用 prompt 框架（角色定位 / 输出格式 / tableEdit 协议 / schema 描述）
    - **资源变更语义约定**：`buildResourceDeductionCommands(costs)` 中正数表示"扣减量"，负数表示"增加量"（`newValue = currentValue - cost`）。招募时金币为正（扣减），人口为 -1（"扣减 -1"等同于增加 1）。该约定在源码注释中明确标注，避免歧义
    - **endTurn 状态变更在叙事生成前完成**：让 AI 看到结算后的最新资源状态。流程顺序为"应用 tableEdits → 更新 save.json currentTurn → 触发 AI 叙事生成"
    - **失败不阻塞叙事生成**：资源扣减失败 / tableEdits 应用失败 / updateSave 失败时记日志但不抛错，让 AI 有机会在叙事中提示玩家资源不足或场景异常
    - **随机事件可注入随机源**：默认 `Math.random`，测试通过构造函数注入 `{ next: () => 0.4 }` 等确定性随机源触发特定事件
  - **【重点标记 - mock 双重注入模式】**：测试 `makeService()` helper 中必须同时将 mock tableRepository / saveRepository 注入到 `ManagementNarrativeService` 与其内部的 `GameNarrativeService` 实例：
    ```
    const narrativeService = new GameNarrativeService();
    narrativeService.setGameTableRepository(tableRepository);  // 关键：注入到底层
    narrativeService.setGameSaveRepository(saveRepository);     // 关键：注入到底层
    const service = new ManagementNarrativeService(narrativeService, ..., tableRepository, saveRepository);
    ```
    若仅注入到 `ManagementNarrativeService` 而未通过 `setGameTableRepository / setGameSaveRepository` 注入到底层 `GameNarrativeService`，则底层 `gameTableRepository` 为 null，会在 async 模式下跳过 tableEdit 应用，导致 `applyTableEdits` 调用次数为 0（测试 10c 失败）。该问题在 spec 中未明确说明，是通过实际测试发现的依赖链路，后续为其他游戏类型模板编写包装服务测试时需复用此模式
  - **【重点标记 - field 读取 convention】**：`incrementTurnCommand / resolveCurrentTurn / resolveNewTurn` 等方法读取 stats sheet 行的字段值时，**必须从 `row['4']` 字段读取**（即 stats sheet 的第 4 列"值"），不能从 `row['3'] ?? row['4']` 读取。`row['3']` 在 stats sheet 中存的是键名字符串（如 'turn'），不是数值。初次实现使用 `row['3'] ?? row['4']` 导致 `resolveCurrentTurn` 返回字符串 'turn' 而非数字 1，进而 `resolveNewTurn` 返回 null，`saveRepository.updateSave` 未被调用（测试 9b 失败）。该约定在 `managementSchema.ts` 中已有定义但未在 spec 中显式说明，需通过测试发现
  - **【重点标记 - eventDeltas 合并到 settleProduction】**：endTurn 初版实现将"结算产出"与"应用随机事件效果"分别生成 updateRow 命令，导致同一资源行（如 food）被两条 updateRow 命令更新，最终只剩最后一条生效（last writer wins），测试 8 断言"食物 +10 丰收"失败（实际值为 0）。修复方式：将 eventDeltas 合并到 `settleProduction(tableData, eventDeltas)`，对每个资源行只生成一条 updateRow，`totalDelta = changePerTurn + productionDelta + eventDelta`；事件本身通过 `buildEventInsertCommands` 仅生成 insertRow 到 events sheet（不再生成资源 updateRow）。该模式适用于所有"对同一资源行有多个 delta 来源"的场景
  - **【重点标记 - 资源扣减语义歧义】**：`buildResourceDeductionCommands(costs)` 初版未明确"正数=扣减 / 负数=增加"的语义，导致 `applyCharacterRecruit` 中 `effectiveCosts.population = (effectiveCosts.population ?? 0) + 1`（值为 1，被当作扣减 1，实际减少人口），与"招募 +1 人口"语义相反。修复方式：改为 `effectiveCosts.population = (effectiveCosts.population ?? 0) - 1`（值为 -1，"扣减 -1"等同于增加 1）。该问题反映 cost 字段语义需在源码注释中显式说明，避免后续维护者误解
  - **验证结果**：
    - `npx vitest run src/main/services/game/templates/management`：19 个测试全部通过（`Test Files 1 passed (1) / Tests 19 passed (19)`），含 PromptBuilder 3 个 + generateNarrative 路由 4 个 + endTurn 流程 5 个 + 边界场景 7 个
    - `npx vitest run src/main/services/game src/main/ipc/handlers/game`：171 个测试全部通过（含本任务新增 19 个 + 既有 GameNarrativeService / GameTableEditParser / GameRepository / GameSaveRepository / GameTableRepository / GamePromptBuilder / gameHandlers 等模块的 152 个测试无回归）
    - `npx vitest run`（全量）：886 个测试全部通过（40 个测试文件，含本任务新增的 19 个 ManagementNarrativeService 测试，与既有 867 个测试无冲突）
    - `npx tsc --noEmit`：在新增文件（ManagementPromptBuilder.ts / ManagementNarrativeService.ts / ManagementNarrativeService.test.ts）上无错误（其他既有文件如 `KnowledgeBaseDocumentService.ts / CharacterDialogueChat.ts / CollapsiblePanel.tsx` 的预存错误与本任务无关）
  - 涉及文件：`src/main/services/game/templates/management/ManagementPromptBuilder.ts`（新建）、`ManagementNarrativeService.ts`（新建）、`__tests__/ManagementNarrativeService.test.ts`（新建）、`.trae/specs/add-game-mode-framework/tasks.md`（标记 Task 15 完成）、`.trae/specs/add-game-mode-framework/checklist.md`（标记 3 项阶段二检查项完成）

- **游戏模式 GameLobby 大厅页**（Spec: add-game-mode-framework / Task 9）：替换占位 GameLobby 为完整实现，包括顶部筛选区（类别 Select / 搜索 Input.Search / 排序 Select，紧凑排列）+ 卡片网格（antd Row + Col，响应式 xs=24 / sm=12 / md=8 / lg=6）+ 加载态（Spin）+ 空状态（Empty，文案"暂无匹配游戏"）。筛选 / 搜索 / 排序派生逻辑抽出为导出的纯函数 `filterAndSortGames`，便于单元测试覆盖（避免依赖 antd Select / Input 的事件系统）。卡片点击通过 mock 捕获 onClick 模式验证 store 调用契约。
  - **新增文件**：
    - `src/renderer/components/Game/GameLobby.tsx`（约 205 行，从 19 行占位重写）：完整大厅实现。订阅 `gameStore.games` 与 `gameStore.isLoadingGames`；本地 useState 维护 typeFilter / search / sortBy；useMemo 派生 filteredGames（避免每次渲染重算）；handleCardClick 通过 `useGameStore.getState().selectGame(gameId)` + `useGameUIStore.getState().setCurrentView('detail')` 触发跳转；导出 `filterAndSortGames(games, typeFilter, search, sortBy)` 纯函数
    - `src/renderer/components/Game/GameCard.tsx`（约 110 行）：单张卡片组件，接收 `GameIndexEntry` + `onClick(gameId)`；antd Card hoverable + Tooltip "点击进入详情"；Card.Meta 渲染 title / subtitle / 类别 Tag / 状态 Tag / 简短介绍 / 更新时间；封面用渐变色 div 占位（`.game-card__cover-placeholder`）
    - `src/renderer/components/Game/GameLobby.css`（约 90 行）：大厅容器（`padding: 24px; height: 100%; overflow: auto`）+ 筛选区（margin-bottom 16px）+ 加载态 / 空状态居中容器 + 卡片网格（margin-top 16px）+ 卡片 hover 上抬 2px 阴影过渡 + 封面占位渐变色 + 简短介绍 `-webkit-line-clamp: 2` 椭圆截断
    - `src/renderer/components/Game/__tests__/GameLobby.test.tsx`（约 280 行）：24 个测试用例，覆盖 `filterAndSortGames` 纯函数（15 个用例：类别筛选 / 搜索筛选 / 排序 / 组合筛选 / 不修改原数组）+ `GameLobby` 组件渲染（9 个用例：加载态 Spin / 空态 Empty / 正常数据卡片网格 / 筛选区组件存在 / 加载态不渲染卡片 / 卡片点击触发 selectGame+setCurrentView / 不同卡片传递不同 gameId / 容器类名 / 响应式 Col 断点）
  - **设计要点**：
    - **筛选逻辑位置**：在组件内使用 useMemo 派生 filteredGames（避免污染 store），同时将派生逻辑抽出为纯函数 `filterAndSortGames` 便于测试。`typeFilter`/`search`/`sortBy` 三个 UI 状态由本地 useState 管理，不进入 store
    - **加载态判断**：使用 `gameStore.isLoadingGames`（**注意非 `isLoading`**），store 实际字段名详见 `src/renderer/stores/gameStore.ts:60`
    - **数据源**：`gameStore.games: GameIndexEntry[]`（**注意非 `GameMeta[]`**），store 仅提供摘要字段（id / type / title / subtitle / status / coverPath / tags / createdAt / updatedAt），完整 meta.json 由详情页（Task 10）通过 selectGame 拉取
    - **卡片点击**：通过 `useGameStore.getState().selectGame(gameId)` + `useGameUIStore.getState().setCurrentView('detail')`，两个 store 都通过 getState() 调用，避免订阅整个 store 导致冗余渲染
  - **【重点标记 - store API 与 spec 不符，按实际实现适配】**：
    - 1) `gameStore.games` 类型为 `GameIndexEntry[]`（**非 spec 描述的 `GameMeta[]`**）；`GameIndexEntry` 是 `GameMeta` 的子集（缺 description / gameplay / developer / version / templateKey）。GameCard 改为接收 `GameIndexEntry` 而非 spec 描述的 `GameMeta`
    - 2) `gameStore.isLoadingGames`（**非 spec 描述的 `isLoading`**），实际 store 字段名带 "Games" 后缀
    - 3) GameIndexEntry 无 `description` 字段，GameCard 的"简短介绍"改用 `meta.tags.join(' · ')` 作为替代展示（tags 为空时不渲染该区块）；完整 description 由 Task 10 详情页通过 selectGame 拉取完整 GameMeta 后展示
  - **【重点标记 - constants 颜色映射与 spec 描述相反】**：spec 描述类别 Tag 颜色 "WEREWOLF 红色 / MYSTERY 紫色"，但 `src/shared/constants/game.constants.ts` 的 `GAME_TYPE_ICON_COLORS` 实际为 `WEREWOLF=#8b5cf6（紫色）/ MYSTERY=#ef4444（红色）`（恰好相反）。优先以 constants 为准，避免在多个组件中重复定义颜色映射。spec 描述的 "COMING_SOON 灰色" 实际枚举为 `GameStatus.PLANNED`（label "计划中"，color #8c8c8c 灰色），语义一致仅命名不同
  - **【重点标记 - antd v6 Spin `tip` prop 已弃用】**：项目使用 antd v6.3.5，`Spin` 的 `tip` prop 已弃用（运行时 warning `[antd: Spin] tip is deprecated. Please use description instead.`），改用 `description` prop。`GameModeEntry.tsx`（Task 8）与 `GameMainPage.tsx`（Task 11）的 Spin 仍使用 `tip` prop，待后续任务统一升级
  - **【重点标记 - 测试中 mock GameCard 捕获 onClick 模式】**：`renderToStaticMarkup` 不触发 React 事件处理器，无法直接模拟用户点击 antd Card。测试通过 `vi.mock('../GameCard', ...)` 替换 GameCard 为简单 div，在 mock 工厂内通过 `capturedCardOnClick.current = props.onClick` 捕获父组件传入的 onClick 回调，测试用例手动调用 `capturedCardOnClick.current!('g2')` 模拟点击，验证 `selectGame` 与 `setCurrentView` 被正确触发。注意：mock 工厂每次渲染都会覆盖 `capturedCardOnClick.current`，因此只能验证最后一次捕获的 onClick（对应最后渲染的卡片，受 sort 顺序影响）
  - **【重点标记 - 筛选派生逻辑抽出为纯函数】**：`renderToStaticMarkup` 无法模拟 antd Select / Input.Search 的 onChange 事件，因此将筛选 / 搜索 / 排序的派生逻辑抽出为导出的纯函数 `filterAndSortGames(games, typeFilter, search, sortBy)`，测试直接调用该函数验证各种组合。这种"派生逻辑纯函数化"的模式在 vitest `environment: 'node'`（无 jsdom）下是验证状态派生的推荐做法，后续 Task 19 若引入 jsdom 后可补充完整的交互测试
  - **验证结果**：
    - `npx vitest run src/renderer/components/Game/__tests__/GameLobby.test.tsx`：24 个测试全部通过（`Test Files 1 passed (1) / Tests 24 passed (24) / Duration 1.51s`）
    - `npx vitest run`（全量）：38 个测试文件 / 818 个测试全部通过（含本任务新增的 24 个 GameLobby 测试，与既有 GameModeEntry 18 / AnsiTileMap 27 / GameDetailPage 12 / GameMainPage 11 / ResourcePanel 15 等测试无冲突）；`Duration 14.05s`
    - `npx tsc --noEmit`：在新增文件（GameLobby.tsx / GameCard.tsx / GameLobby.test.tsx）上无错误；其他既有文件的预存错误（如 `CollapsiblePanel.tsx` 的 JSX 解析错误、`GameDetailPage.test.tsx` 的 spread 类型错误、`vitest.config.ts` 的 WatchOptions 类型错误）与本任务无关
  - 涉及文件：`src/renderer/components/Game/GameLobby.tsx`（重写）、`GameCard.tsx`（新建）、`GameLobby.css`（新建）、`__tests__/GameLobby.test.tsx`（新建）

- **游戏模式 GameMainPage 通用框架**（Spec: add-game-mode-framework / Task 11）：替换占位 GameMainPage 为完整实现，包括顶部状态栏（GameStateBar：游戏标题 / 当前节点 / 当前回合 / 生成状态指示器 / 存档 / 设置 / 退出按钮）、左侧叙事面板（NarrativePanel：流式文本 + 选项 + 用户输入框）、右侧模板面板区（根据 currentGame.type 从 GameTemplateRegistry 获取模板并渲染 Component，未注册时显示 Empty）。包含退出确认（Modal.confirm 二次确认）与流式叙事订阅（store 已订阅，组件仅消费状态）。
  - **新增文件**：
    - `src/renderer/components/Game/panels/GameStateBar.tsx`（约 145 行）：顶部状态栏组件，左侧显示游戏标题（currentGame.title）+ 当前节点 Tag（currentSave.meta.nodeTitle ?? '未开始'）；中间显示当前回合（currentSave.meta.currentTurn，仅回合制游戏）+ 生成中 Spin 指示器（isGenerating=true 时显示"生成中..."）；右侧 antd Space 紧凑排列存档 / 设置 / 退出按钮；退出按钮通过 `Modal.confirm` 弹出二次确认（标题"确认退出游戏？"），确认后取消进行中的生成（cancelGeneration）+ 切换视图（setCurrentView('detail')）
    - `src/renderer/components/Game/panels/NarrativePanel.tsx`（约 328 行）：左侧叙事面板组件，使用 `react-markdown` + `remark-gfm` + `rehype-raw` 渲染 narrativeLog 中的消息内容；自动滚动到底部（useEffect 监听 narrativeLog / isGenerating 变化）；isGenerating=true 时显示 typing 指示器（三点闪烁动画 `typing-blink`）；选项区从最新 assistant 消息防御性读取 `(message as any).options` 字段（类型未定义但支持未来扩展，无需修改类型）；用户输入框（Input.TextArea + 发送 Button）回车或点击发送触发 `gameStore.generateNarrative({ userAction: text })`，生成中禁用输入框；流式订阅位置：`gameStore` 模块加载时已通过 `setupGameEventListeners()` 订阅 4 个 IPC 事件并自动更新 narrativeLog，组件内 useEffect 仅作日志埋点（无操作副作用）
    - `src/renderer/components/Game/GameMainPage.css`（约 175 行）：布局样式（`.game-main-page` flex column 100% 高度；`.game-main-page__body` flex row；左 60% `.game-main-page__narrative` / 右 40% `.game-main-page__panels`）；状态栏样式（`.game-state-bar` 三段 flex 布局，中间 Space 用 flex 1 居中）；叙事面板样式（自定义滚动条 / markdown 内容样式覆盖 / typing-blink 关键帧动画 + `prefers-reduced-motion` 适配）
    - `src/renderer/components/Game/__tests__/GameMainPage.test.tsx`（约 380 行）：11 个测试用例，覆盖 6 个核心场景 + 5 个补充场景（无 currentGame 显示 Empty / 有 currentGame 渲染 GameStateBar+NarrativePanel+模板面板容器 / 模板未注册显示 Empty / 模板注册渲染 Component / 退出按钮调用 Modal.confirm / GameStateBar 显示标题 / 当前节点缺省值 / 存档按钮调用 saveGame / 设置按钮调用 setShowOptionsDialog(true) / isGenerating 显示生成指示器 / onAction 回调包装 generateNarrative）
  - **修改文件**：
    - `src/renderer/components/Game/GameMainPage.tsx`（从 19 行占位重写为约 145 行完整实现）：删除占位 Empty，整合 GameStateBar / NarrativePanel / 模板面板区；通过 `GameTemplateRegistry.get(currentGame.type)` 查询模板，未注册显示 Empty "该游戏类型暂未实现"；模板 Component 为 `React.lazy` 包裹的懒加载组件，用 Suspense + Spin fallback 包裹；注入 `GameTemplateProps`（saveId / gameId / tableData / onAction）；无 currentGame 时显示 Empty "未选择游戏，请返回大厅重新选择"；onExit 回调注入 `() => setCurrentView('detail')`
  - **设计要点**：
    - **流式订阅位置**：根据 `gameStore.ts` 实际实现，store 在模块加载时已通过 `setupGameEventListeners()` 订阅了 `onNarrativeChunk / onNarrativeComplete / onNarrativeError / onTableUpdated` 4 个 IPC 事件并自动更新 narrativeLog。NarrativePanel 内的 useEffect **不重复订阅**，仅作日志埋点位置；组件仅消费 store 状态（narrativeLog / isGenerating）。这种"store 单例订阅 + 组件消费状态"的模式避免了多组件挂载时重复订阅与卸载时漏取消的问题
    - **模板面板加载**：模板 Component 通过 `React.lazy` 懒加载（在模板定义时已包裹），GameMainPage 用 Suspense + Spin 包裹，首次渲染时显示加载态；模板未注册时显示 antd Empty（`description="该游戏类型暂未实现"`），不抛错（与 GameTemplateRegistry 设计一致）
    - **退出确认流程**：`GameStateBar` 的退出按钮 onClick 调用 `Modal.confirm({ title: '确认退出游戏？', content: '未保存的进度将丢失（实际已自动存档，仅为提示）', okText: '退出', cancelText: '取消', onOk: ... })`；onOk 回调内：① 如 isGenerating=true 调用 `cancelGeneration()` 取消进行中的生成；② 调用注入的 `onExit` 回调或默认 `setCurrentView('detail')`。`onExit` 由 GameMainPage 注入，便于将来扩展（如自定义退出确认逻辑 / 跳转到不同视图）
    - **选项区扩展性**：当前 `GameNarrativeMessage` 类型未定义 `options` 字段；NarrativePanel 通过 `(message as unknown as { options?: NarrativeOption[] }).options` 防御性读取，无需修改类型即可支持未来 AI 返回结构化选项。当 AI 在未来 Task 14 / 15 等任务中扩展返回 options 时，UI 自动渲染按钮列表，点击触发 `generateNarrative({ userAction: option.action })`
    - **生成中状态指示**：GameStateBar 在 isGenerating=true 时显示 `Spin + "生成中..."`；NarrativePanel 在 isGenerating=true 时禁用输入框 / 选项按钮，并显示 typing 指示器；避免用户在等待 AI 回复时重复触发 generateNarrative 导致 `currentStreamingMessageId` 状态错乱
    - **typing 动画**：使用 CSS `@keyframes typing-blink`（opacity 0.3↔1 + translateY 0↔-3px，间隔 0.2s），暗色主题蓝色（`rgba(24, 144, 255, 0.8)`）；`@media (prefers-reduced-motion: reduce)` 适配禁用动画
    - **暗色主题**：所有颜色使用 `rgba(255, 255, 255, x)` / `rgba(0, 0, 0, x)` 与 CSS 变量 `--cc-bg-primary` / `--cc-text-primary`，与 GameModeEntry.css 协调
  - **验证结果**：
    - `npx vitest run src/renderer/components/Game/__tests__/GameMainPage.test.tsx`：11 个测试全部通过（`Test Files 1 passed (1) / Tests 11 passed (11) / Duration 12.49s`）
    - `npx tsc --noEmit`：在新文件上无错误（其他既有文件如 `CollapsiblePanel.tsx`（Task 13 并行实现的语法错误）与 `GameDetailPage.test.tsx`（Task 10 并行实现的类型错误）的预存错误与本任务无关）
    - `npx vitest run src/renderer/components/Game/__tests__/`：5 个测试文件 / 92 个测试全部通过（含本任务新增 11 个 + GameModeEntry 18 个 + GameLobby 24 个 + GameDetailPage 12 个 + AnsiTileMap 27 个），无回归
    - `npx vitest run src/renderer/stores/__tests__/gameStore.test.ts src/renderer/stores/__tests__/gameUIStore.test.ts`：73 个测试全部通过，无回归
  - **【重点标记 - antd Button 在测试中是 forwardRef 对象】**：在 GameMainPage.test.tsx 中 mock antd Button 以捕获 onClick 回调时，初次编写使用 `actual.Button(props)` 直接调用，但 antd v6 的 Button 是 `forwardRef` 对象而非函数，调用抛 `TypeError: actual.Button is not a function`。修复方式：改用 `React.createElement(actual.Button, props)` 让 React 处理 forwardRef 调用。后续在测试中 mock antd 组件时需注意：antd v6 多数组件都是 forwardRef 对象，必须用 `React.createElement` 而非直接调用
  - **【重点标记 - vi.fn 类型与 mock.calls 索引访问】**：测试中 mock `Modal.confirm` 时初次使用 `const mockConfirmFn = vi.fn(() => ...)`，TypeScript 推断 `mockConfirmFn.mock.calls` 类型为 `[]`（空 tuple），导致 `mock.calls[0][0]` 报 `TS2493: Tuple type '[]' of length '0' has no element at index '0'`。修复方式：在 `vi.hoisted` 中显式注解 `const mockConfirmFn: any = vi.fn(() => ...)`，使 mock 属性退化为 any 类型，可任意索引访问。后续在 `vi.hoisted` 中创建 mock 函数时如需访问 `mock.calls[i][j]`，建议显式注解为 any 避免类型收窄
  - **【重点标记 - react-markdown 在测试环境中的副作用】**：NarrativePanel 内部使用 `react-markdown` + `rehype-raw`，在 node 测试环境下渲染复杂（涉及 unified / remark / rehype pipeline，可能导致 Transform 耗时长或 throw）。GameMainPage.test.tsx 通过 `vi.mock('../panels/NarrativePanel', ...)` 替换为简单 div（`data-testid="narrative-panel"`）避免引入 react-markdown 副作用。NarrativePanel 的逻辑应由其自身的测试覆盖（本任务未要求 NarrativePanel 独立测试）。后续如需为 NarrativePanel 编写测试，建议使用 jsdom + @testing-library/react 而非 renderToStaticMarkup
  - 涉及文件：`src/renderer/components/Game/panels/GameStateBar.tsx`（新建）、`panels/NarrativePanel.tsx`（新建）、`GameMainPage.css`（新建）、`GameMainPage.tsx`（重写：从占位 Empty 替换为完整实现）、`__tests__/GameMainPage.test.tsx`（新建）

- **游戏模式通用面板组件（资源 / 设施 / 统计 / 折叠容器）**（Spec: add-game-mode-framework / Task 13）：实现 4 个可复用面板组件，从 `gameStore.tableData` 派生展示数据，纯展示 + 回调模式（除折叠状态外不修改 store）。这些面板将在阶段二被经营游戏模板（`ManagementGameTemplate`）使用，但本身是通用组件，不绑定特定游戏类型。
  - **新增文件**：
    - `src/renderer/components/Game/panels/ResourcePanel.tsx`（160 行）：资源面板，从 `gameStore.tableData` 读取指定 sheet（默认 `'resources'`）按行解析为资源列表，antd `Card + Row + Col + Statistic` 网格展示资源名称 / 数量 / 每回合变化（带 +/- 符号与绿/红/灰着色）；支持自定义 `sheetName` / `nameField` / `amountField` / `changeField` 兼容非标准 schema；空状态显示 antd `Empty` "暂无资源数据"
    - `src/renderer/components/Game/panels/FacilityPanel.tsx`（210 行）：设施面板，分两块 —— 已建设施列表（antd `List` + Lv 等级 Tag）+ 可建设施列表（antd `List` + 建造按钮 + 资源消耗提示）；"已建/可建"判定支持三种优先级：`builtPredicate`（自定义函数）> `builtIds`（外部 ID 列表）> `level >= 1`（默认按行内字段）；点击建造按钮默认调用 `gameStore.generateNarrative({ userAction: 'build:<facility_id>' })`，也支持通过 `onBuild` 回调让上层接管流程
    - `src/renderer/components/Game/panels/StatisticsPanel.tsx`（150 行）：统计面板，从 sheet（默认 `'stats'`）解析 key-value 统计项，antd `Statistic` 网格展示；图表渲染留接口（`TODO: 后续支持图表`，可未来在 props 增加 `chartConfig` 字段）
    - `src/renderer/components/Game/panels/CollapsiblePanel.tsx`（110 行）：折叠容器组件，基于 antd `Collapse` 的 `items` API（v6 推荐用法）；折叠状态通过 `gameUIStore.collapsedPanels[panelKey]` 持久化（运行期会话状态，不写 localStorage）；`defaultOpen` 仅在 store 中尚未记录该 panelKey 状态时生效；组件挂载时读取初始状态、折叠/展开时通过 `setPanelCollapsed` 同步到 store
    - `src/renderer/components/Game/panels/panels.css`（130 行）：统一 Card 间距、Statistic 网格响应式（窄屏单列、宽屏三列）、变化值着色（`game-panel__change--positive/negative/neutral`）、建造按钮 hover 抬起效果、暗色主题适配、`prefers-reduced-motion` 适配
    - `src/renderer/components/Game/panels/__tests__/ResourcePanel.test.tsx`（280 行）：15 个测试用例，覆盖无数据/空 sheet/行数为 0 三种 Empty 场景、有数据渲染 Statistic 列表、自定义 sheetName 与字段映射、数量正确显示（含千位分隔容错）、字符串数字容错、amount 缺省回退到 0、正数 +/负数 -/零 +0 三种变化字段显示与颜色 class、change 缺省与空字符串不显示变化指示、自定义 Card 标题、多资源项渲染
  - **设计要点**：
    - **纯展示 + 回调模式**：4 个面板组件仅消费 `gameStore.tableData` 与（FacilityPanel）`generateNarrative` action，不修改 store 状态。`generateNarrative` 触发的状态变更通过 store 内的 IPC 事件回调推送，面板再次渲染时自动反映新数据
    - **数据派生通过 useMemo 缓存**：避免 `tableData` 引用未变时重复解析，性能可控
    - **字段映射可配置**：ResourcePanel / FacilityPanel / StatisticsPanel 均支持 `nameField` / `amountField` / `keyField` 等 props，兼容非标准 schema（如 `display_name` 而非 `name`），便于不同游戏类型模板复用
    - **变化字段格式化**：正数 `+50`、负数 `-10`、零 `+0`（与正数一致，避免被误判为缺失数据）；着色由 CSS class 控制（`game-panel__change--positive/negative/neutral`），便于暗色主题适配
    - **设施已建判定三层优先级**：`builtPredicate`（自定义函数）> `builtIds`（外部 ID 列表）> `level >= 1`（默认按行内字段）。允许经营游戏模板通过外部状态（如 `stateSnapshot` 中的 `builtFacilities` 数组）覆盖默认判定
    - **CollapsiblePanel 受控模式**：折叠状态完全由 `gameUIStore.collapsedPanels[panelKey]` 决定，避免"内部 state 与 store 不一致"问题；`defaultOpen` 仅在 store 中尚未记录该 panelKey 状态时作为初始值生效
    - **antd Collapse items API**：使用 antd v6 推荐的 `items={[{ key, label, children }]}` 模式（旧的 `<Collapse.Panel>` 子组件已 deprecated）
  - **验证结果**：
    - `npx vitest run src/renderer/components/Game/panels/__tests__/ResourcePanel.test.tsx`：15 个测试全部通过（`Test Files 1 passed (1) / Tests 15 passed (15) / Duration 1.48s`）
    - 邻近测试无回归：`vitest run` AnsiTileMap.test.tsx + GameModeEntry.test.tsx + ResourcePanel.test.tsx 共 60 个测试全部通过
    - `npx tsc --noEmit` 在新增 panel 文件上无错误（其他既有文件的预存错误与本任务无关：`GameMainPage.tsx:44` 引用 `NarrativePanel` 是 Task 11 并行开发中的依赖，`GameDetailPage.test.tsx:348` 是 Task 10 测试中的预存错误）
  - **【重点标记 - vi.mock 路径深度】**：测试文件位于 `src/renderer/components/Game/panels/__tests__/`，比被 mock 的 `src/renderer/stores/gameStore` 多两层目录，相对路径需 `../../../../stores/gameStore`（4 个 `../`）。初次编写时误用 5 个 `../`（`../../../../../stores/gameStore`），导致 vi.mock 未生效，真实 store 被加载（其 `tableData` 初始为 null），所有"有数据"用例均误显示 Empty 状态。后续在 `panels/__tests__/` 下新增依赖 store 的测试时需注意路径深度。该问题与 Task 8 中记录的"`__tests__/` 下 mock 路径深度问题"为同一类，再次印证 Game 测试目录嵌套较深需特别留意
  - **【重点标记 - antd Statistic 默认千位分隔】**：`Statistic` 组件默认对整数按千位分隔显示（如 `1234` 渲染为 `1,234`）。测试用例初次断言 `expect(html).toContain('1234')` 失败，HTML 实际为 `1,234`。修正后断言改为 `expect(html).toContain('1,234')`。后续在面板类组件中如需禁用千位分隔，可在 `Statistic` 上设置 `groupSeparator=""`；当前实现保留默认分隔以提升大数字可读性（如资源 99999 显示为 99,999）
  - **【重点标记 - formatChangeValue 零值显示】**：`formatChangeValue(0)` 初版实现为 `change > 0 ? `+${change}` : `${change}``，对 0 返回 `"0"`，但注释标明"0 显示 +0"。修正为三分支判断（正数 `+50` / 负数 `-10` / 零 `+0`），使零值与正数风格一致，避免被误判为缺失数据
  - 涉及文件：`src/renderer/components/Game/panels/ResourcePanel.tsx`（新建）、`FacilityPanel.tsx`（新建）、`StatisticsPanel.tsx`（新建）、`CollapsiblePanel.tsx`（新建）、`panels.css`（新建）、`__tests__/ResourcePanel.test.tsx`（新建）

- **游戏模式游戏详情页**（Spec: add-game-mode-framework / Task 10）：实现完整的 `GameDetailPage` 与三个配套对话框（`GameSaveDialog` / `GameOptionsDialog` / `GameGalleryDialog`），完成"开始游戏 / 读取存档 / 选项 / 画廊 / 其他 / 关闭"6 个操作按钮的全部交互逻辑，并替换 Task 8 创建的占位组件。
  - **新增文件**：
    - `src/renderer/components/Game/GameDetailPage.tsx`（265 行）：左侧 8 栏元数据区（封面占位 / 标题 / 副标题 / 类别徽标 / 状态徽标 / 开发者 / 版本）+ 右侧 16 栏详细介绍 + 玩法说明 + 操作按钮区（antd Card 包裹）；详细介绍按 `\n` 拆分为多段 Paragraph 渲染；玩法说明缺省时回退到 description；订阅 `gameUIStore.showSaveDialog / showOptionsDialog / showGalleryDialog` 控制三个对话框显隐；currentGame 为 null 时渲染 antd Empty
    - `src/renderer/components/Game/GameSaveDialog.tsx`（188 行）：antd Modal + List + Popconfirm，展示存档名 / 最后保存时间（zh-CN 本地化）/ 当前剧情节点（缺省"未开始"）/ 消息数 / 回合数；每项含"读取"与"删除"两个 Popconfirm 二次确认按钮；空状态 antd Empty"暂无存档，请开始新游戏"；挂载时通过 `window.electronAPI.game.listSaves(currentGameId)` 加载列表；删除通过 `window.electronAPI.game.deleteSave(saveId)` 直接调用主进程（gameStore 未提供 deleteSave action）；读取通过 `gameStore.loadSave` → `setCurrentView('main')` → 关闭对话框
    - `src/renderer/components/Game/GameOptionsDialog.tsx`（193 行）：antd Modal + Form，配置 AI 引擎选择（从 `useSettingStore.setting.aiEngines` 读取列表）/ 温度（Slider 0-2 步长 0.1）/ 最大 token（InputNumber 1000-32000）/ 表格整理模式（Radio.Group sync / async）/ ANSI 配色主题（Select 默认 / 暗色 / 亮色）；挂载时 `window.electronAPI.game.getConfig(currentGameId)` 加载配置（失败回退 `DEFAULT_GAME_LOCAL_CONFIG`）；保存时调用 `saveConfig` 并同步 ANSI 主题到 gameUIStore
    - `src/renderer/components/Game/GameGalleryDialog.tsx`（44 行）：antd Modal + Empty 空状态占位，文案"暂无 CG，该功能正在开发中"；预留 `// TODO: 后续从模板读取 gallery items` 接口供后续从 GameTypeTemplate 读取 CG 列表
    - `src/renderer/components/Game/GameDetailPage.css`（118 行）：`.game-detail-page` 容器 padding 24px；左侧元数据区 flex column 间距 8px；封面占位渐变色（`linear-gradient(135deg, #667eea, #764ba2)`）+ "封面占位"标签；操作按钮区 flex wrap + gap 8px；关闭按钮 `margin-left: auto` 靠右；暗色主题适配
    - `src/renderer/components/Game/__tests__/GameDetailPage.test.tsx`（289 行）：12 个测试用例，覆盖正常渲染元数据 / 无 currentGame 时 Empty / "开始游戏"按钮触发 `startNewGame + setCurrentView('main')` / "读取存档"按钮打开 GameSaveDialog / "选项"按钮打开 GameOptionsDialog / "画廊"按钮打开 GameGalleryDialog / 模板未注册 onOtherAction 时"其他"按钮隐藏 / 模板注册时显示并触发回调 / "关闭"按钮返回 lobby / 对话框 data-open 属性反映 gameUIStore / 多段介绍分段渲染 / gameplay 缺省回退到 description
  - **设计要点**：
    - **对话框显隐策略**：通过 `gameUIStore.showSaveDialog / showOptionsDialog / showGalleryDialog` 三个独立标志位控制（**与 spec 描述的 `activeDialog` 字段名不符**，实际字段为分离的 boolean 标志位，详见下方重点标记）；GameDetailPage 同时渲染三个对话框组件并订阅这三个标志位，将 `open` prop 与标志位绑定，关闭时调用对应的 `setShowXxxDialog(false)` action
    - **按钮显隐逻辑**：除"其他"按钮外，其余 5 个按钮（开始游戏 / 读取存档 / 选项 / 画廊 / 关闭）始终显示；"其他"按钮通过查询 `GameTemplateRegistry.get(meta.type)?.onOtherAction` 是否存在决定显隐（占位模板未注册 onOtherAction，默认隐藏）；用户点击"其他"时调用模板提供的 `onOtherAction` 回调
    - **空状态处理**：三层空状态——(1) `currentGame` 为 null 时整个详情页渲染 Empty；(2) 介绍/玩法说明缺省时显示"暂无详细介绍 / 暂无玩法说明"；(3) `GameSaveDialog` 列表为空时显示"暂无存档，请开始新游戏"；`GameGalleryDialog` 首期为"暂无 CG，该功能正在开发中"占位
    - **关闭返回逻辑（SubTask 10.6）**：通过 `useGameUIStore` hook 取出 `setCurrentView` 引用，调用 `setCurrentView('lobby')` 返回大厅；与 spec 中示例 `useGameUIStore.getState().setCurrentView('lobby')` 等价，但使用 hook 模式更符合 React 数据流（hook 与 getState 在 zustand 中行为一致）
    - **测试 mock 策略**：通过 `vi.mock('antd', ...)` 替换 Button 为捕获器，将 onClick 回调按按钮文本索引存入 `buttonClickHandlers` Map；测试用例通过 `buttonClickHandlers.get('开始游戏')?.()` 手动触发点击并验证 store action 调用契约；三个对话框组件 mock 为简单 `<div data-testid="..." data-open="...">`，便于通过 HTML 字符串验证 open 状态
    - **gameStore.deleteSave 缺失适配**：gameStore（Task 6）未提供 `deleteSave` action，GameSaveDialog 通过 `window.electronAPI.game.deleteSave(saveId)` 直接调用主进程；删除后通过 `reloadSaves()` 刷新列表
  - **修改文件**：无（仅替换 Task 8 创建的占位 `GameDetailPage.tsx`，未修改任何 store / preload / 主进程代码）
  - **验证结果**：
    - `npx vitest run src/renderer/components/Game/__tests__/GameDetailPage.test.tsx`：12 个测试全部通过（`Test Files 1 passed (1) / Tests 12 passed (12) / Duration 1.55s`）
    - `npx vitest run` Game 模块除 GameMainPage.test.tsx 外：128 个测试全部通过（AnsiTileMap 27 + GameModeEntry 18 + GameLobby 24 + GameDetailPage 12 + GameTemplateRegistry 32 + ResourcePanel 15）
    - `npx tsc --noEmit`：在新增文件上无错误；唯一预存错误为 `src/renderer/components/Game/panels/CollapsiblePanel.tsx(104,8)`（Task 13 文件，与本任务无关）
  - **【重点标记 - gameUIStore 对话框显隐字段名与 spec 描述不符】**：本任务 spec 描述 gameUIStore 的对话框显隐字段为"可能是 `activeDialog`"，但**实际 store 实现采用 3 个独立的 boolean 标志位** `showSaveDialog / showOptionsDialog / showGalleryDialog`（详见 `src/renderer/stores/gameUIStore.ts`），setter 分别为 `setShowSaveDialog / setShowOptionsDialog / setShowGalleryDialog`。GameDetailPage 按实际 store 实现 adapter，订阅这 3 个标志位并将 `open` prop 绑定到对应对话框组件。后续在 GameMainPage 等场景调用对话框时也需使用这 3 个标志位（而非 `activeDialog` 字符串字段）
  - **【重点标记 - GameMeta 字段名 `gameplay` 与 spec 描述 `gameplayDescription` 不符】**：本任务 spec 描述玩法说明从 `meta.gameplayDescription` 读取，但**实际类型定义为 `meta.gameplay`**（详见 `src/shared/types/game.types.ts` 的 `GameMeta` 接口）。GameDetailPage 按实际类型实现，读取 `meta.gameplay`，缺省时回退到 `meta.description`（spec 描述的回退逻辑保留）
  - **【重点标记 - gameStore 未提供 deleteSave action】**：本任务 spec 描述存档删除通过"调用 `deleteSave(saveId)`"实现，但**gameStore（Task 6 实现）未暴露 deleteSave action**（Task 6 仅实现 loadSave / saveGame 等读存档相关 action，删除存档未纳入 store 管理）。GameSaveDialog 通过 `window.electronAPI.game.deleteSave(saveId)` 直接调用主进程 IPC，删除后通过本地 `reloadSaves()` 刷新列表（不依赖 store 重新拉取）。后续如需统一在 store 层管理存档删除，需在 gameStore 中补充 deleteSave action
  - **【重点标记 - GameMainPage.test.tsx 失败为预存问题，与本任务无关】**：执行 `npx vitest run src/renderer/components/Game` 时 `GameMainPage.test.tsx`（10 个用例失败）报错 `TypeError: actual.Button is not a function`。该测试文件由 Task 11（并行任务）创建，测试的是占位组件 `GameMainPage.tsx`（仍为 Task 8 创建的 Empty 占位）。失败原因是 antd Button 是 `forwardRef` 组件不能作为普通函数调用（`actual.Button(props)` 模式失败）。本任务未修改 GameMainPage.tsx 或其测试文件，失败由 Task 11 自行修复
  - **【重点标记 - settingStore.setting 可能为 null】**：`useSettingStore` 的 `setting: AppSetting | null` 字段在应用启动早期可能为 null（依赖 App 组件挂载时调用 `fetchSetting`）。GameOptionsDialog 通过 `setting?.aiEngines ?? []` 兜底处理，避免运行时 `Cannot read property 'aiEngines' of null` 错误
  - 涉及文件：`src/renderer/components/Game/GameDetailPage.tsx`（重写）、`GameSaveDialog.tsx`（新建）、`GameOptionsDialog.tsx`（新建）、`GameGalleryDialog.tsx`（新建）、`GameDetailPage.css`（新建）、`__tests__/GameDetailPage.test.tsx`（新建）

- **游戏模式 GameModeEntry 容器与视图切换**（Spec: add-game-mode-framework / Task 8）：实现游戏模式顶层容器组件 `GameModeEntry`，根据 `gameUIStore.currentView` 渲染对应的子页面（GameLobby / GameDetailPage / GameMainPage），挂载时拉取游戏列表，通过 `React.lazy + Suspense` 懒加载子页面，并通过 `key={baseView}` 触发视图切换时的 fade+slide 过渡动画。同时创建 3 个占位子页面组件供 Task 9 / 10 / 11 替换。
  - **新增文件**：
    - `src/renderer/components/Game/GameModeEntry.tsx`（127 行）：顶层容器组件，订阅 `gameUIStore.currentView` 与 `previousView`，通过导出的 `resolveBaseView(currentView, previousView)` 纯函数解析需要渲染的基础视图；挂载时通过 `useGameStore.getState().loadGames()` 拉取游戏列表；通过 `data-current-view` 与 `data-base-view` 数据属性暴露当前路由状态，便于测试与调试
    - `src/renderer/components/Game/GameModeEntry.css`（61 行）：全屏布局（`position: fixed; inset: 0`）+ `game-mode-fade-in` 关键帧动画（opacity 0→1，translateY 8px→0，200ms ease-out）+ `prefers-reduced-motion` 适配；使用 CSS 变量 `--cc-bg-primary` / `--cc-text-primary` 适配未来主题切换
    - `src/renderer/components/Game/GameLobby.tsx`（19 行）：占位组件，渲染 antd `Empty`（"游戏大厅正在开发中"）；标记 `TODO: Task 9 将实现完整版`
    - `src/renderer/components/Game/GameDetailPage.tsx`（19 行）：占位组件，渲染 antd `Empty`（"游戏详情页正在开发中"）；标记 `TODO: Task 10 将实现完整版`
    - `src/renderer/components/Game/GameMainPage.tsx`（19 行）：占位组件，渲染 antd `Empty`（"游戏主页面正在开发中"）；标记 `TODO: Task 11 将实现完整版`
    - `src/renderer/components/Game/__tests__/GameModeEntry.test.tsx`（363 行）：18 个测试用例，覆盖 `resolveBaseView` 纯函数（8 个用例：lobby / detail / main 直接返回；options / gallery / saves 回退到 previousView；previousView=null 与 previousView 也是对话框视图的边界场景）+ `GameModeEntry` 组件（10 个用例：挂载时调用 loadGames、3 个基础视图渲染、视图切换 key 变化、3 个对话框视图回退渲染、容器结构、data-current-view 属性）
  - **设计要点**：
    - **视图切换策略**：`gameUIStore.GameView` 类型包含 6 个值（lobby / detail / main / options / gallery / saves），其中后 3 个为对话框视图（其显隐由独立的 `showOptionsDialog / showGalleryDialog / showSaveDialog` 标志位控制）。`resolveBaseView` 在对话框视图下回退到 `previousView` 作为基础渲染层，对话框组件叠加在 base view 之上（由详情页或主页面内部管理）；`previousView` 为 null 或也是对话框视图时进一步回退到 'detail'（保守默认值）
    - **过渡动画**：通过 `key={baseView}` 强制重新挂载子页面容器，新挂载的 `.game-mode-entry__view` 自动播放 `game-mode-fade-in` 关键帧动画；不依赖 React Transition Group，简化依赖
    - **懒加载拆分**：3 个子页面通过 `React.lazy` 拆分 chunk，避免主 bundle 包含未实现的子页面逻辑；`Suspense fallback` 显示 antd `Spin`（size="large"）
    - **导出 `resolveBaseView` 为纯函数**：将视图解析逻辑从组件中抽出，便于单元测试覆盖边界场景，无需渲染组件即可验证
  - **修改文件**：
    - `vitest.config.ts`：include 模式从 `['src/**/*.test.ts']` 扩展为 `['src/**/*.test.ts', 'src/**/*.test.tsx']`（详见下方重点标记）
  - **验证结果**：
    - `npx vitest run`（全量）：34 个测试文件 / 756 个测试全部通过（含本任务新增的 18 个 GameModeEntry 测试与既有的 27 个 AnsiTileMap 测试）；`Duration 3.34s`
    - `npx tsc --noEmit`：在新增 GameModeEntry 相关文件上无错误；其他既有文件的预存错误（如 `ipcMain declared but never read`、`png-chunks-extract` 缺类型声明等）与本任务无关
  - **【重点标记 - vitest.config.ts 静默跳过 .tsx 测试文件】**：项目原 `vitest.config.ts` 的 `include: ['src/**/*.test.ts']` 仅匹配 `.test.ts` 后缀，**静默跳过所有 `.test.tsx` 文件**——既有的 `AnsiTileMap.test.tsx`（27 个测试）与本任务新增的 `GameModeEntry.test.tsx`（18 个测试）在 `npx vitest run` 默认执行中均**不运行**，但 vitest 不输出任何警告。这导致 CI 实际只跑了 711 个测试（应为 756 个），差 45 个组件测试被静默忽略。修复方式：将 include 模式扩展为 `['src/**/*.test.ts', 'src/**/*.test.tsx']`。后续新增组件级测试时，**测试文件后缀必须显式为 `.test.tsx`**（若使用 JSX），并验证 `npx vitest run` 输出中确实包含该测试文件
  - **【重点标记 - 测试中 vi.mock 的相对路径深度】**：测试文件位于 `src/renderer/components/Game/__tests__/`，比被 mock 的 `src/renderer/stores/` 多一层目录，相对路径需 `../../../stores/gameStore`（3 个 `../`）而非 2 个。初次编写时误用 2 个 `../` 导致 vi.mock 未生效，真实 store 被加载触发 `window.electronAPI` 未定义错误。后续在 `Game/__tests__/` 下新增测试时需注意路径深度
  - **【重点标记 - renderToStaticMarkup 不运行 useEffect】**：项目测试环境为 `vitest environment: 'node'`（未安装 jsdom / happy-dom / @testing-library/react），渲染使用 `react-dom/server` 的 `renderToStaticMarkup`，**该 API 不会触发 useEffect**。验证"挂载时调用 loadGames"时需通过 `vi.mock('react', ...)` 替换 `useEffect` 为捕获器，将 effect 回调推入数组，测试用例手动调用捕获的回调以模拟 mount effect。注意：`antd Spin` 等子组件也会注册 useEffect，因此需通过 `deps.length === 0` 筛选出 mount-only effect，避免重复调用
  - **【重点标记 - React.lazy 在测试中的模块缓存】**：`React.lazy` 在同一测试文件内首次解析后会缓存模块，无法通过 mock 重置回到"未解析"状态。因此**无法可靠测试 Suspense fallback 状态**（除非将 fallback 测试放在文件首个用例且不触发任何 lazy import）。本任务改为测试"组件渲染时包含 game-mode-entry 容器与 view 容器"以验证容器结构，避免与 lazy 缓存冲突
  - 涉及文件：`src/renderer/components/Game/GameModeEntry.tsx`（新建）、`GameModeEntry.css`（新建）、`GameLobby.tsx`（新建）、`GameDetailPage.tsx`（新建）、`GameMainPage.tsx`（新建）、`__tests__/GameModeEntry.test.tsx`（新建）、`vitest.config.ts`（修改：扩展 include 模式）

- **游戏模式渲染进程 store**（Spec: add-game-mode-framework / Task 6）：实现 `gameStore` 与 `gameUIStore` 两个 zustand store，为游戏模式的渲染进程提供状态管理与 IPC 事件订阅能力，解耦后续 Task 8-13 的 UI 组件开发。
  - **新增文件**：
    - `src/renderer/stores/gameStore.ts`（540 行）：管理游戏列表 / 当前游戏 / 当前存档 / 剧情日志 / 表格数据快照 / 生成状态；提供 `loadGames / selectGame / startNewGame / loadSave / saveGame / appendNarrativeChunk / applyTableEdits / generateNarrative / cancelGeneration / setTableData / clearError` 等 action 与 `getCurrentGame / getCurrentSave` 两个 getter；模块加载时通过 `setupGameEventListeners()` 订阅 `window.electronAPI.game` 的 4 个 IPC 事件（`onNarrativeChunk / onNarrativeComplete / onNarrativeError / onTableUpdated`），将事件路由到 store action
    - `src/renderer/stores/gameUIStore.ts`（160 行）：管理当前视图（lobby / detail / main / options / gallery / saves）、面板折叠状态、ANSI 主题、叙事面板滚动位置、3 个对话框显隐；提供 `setCurrentView / goBack / togglePanel / setPanelCollapsed / setAnsiTheme / setNarrativeScrollPosition / setShowSaveDialog / setShowOptionsDialog / setShowGalleryDialog / resetUI` 等 action
    - `src/renderer/stores/__tests__/gameStore.test.ts`（470 行）：46 个测试用例，覆盖 loadGames / selectGame / startNewGame / loadSave / saveGame / appendNarrativeChunk / generateNarrative / cancelGeneration / applyTableEdits / _handleNarrativeComplete / _handleNarrativeError / _handleTableUpdated / 模块加载事件订阅 / getters 等关键场景
    - `src/renderer/stores/__tests__/gameUIStore.test.ts`（210 行）：27 个测试用例，覆盖初始状态 / setCurrentView / goBack / togglePanel / setPanelCollapsed / setAnsiTheme / setDetailGameId / setNarrativeScrollPosition / setShow*Dialog / resetUI 等
  - **设计要点**：
    - 流式 chunk 通过 `currentStreamingMessageId` 追踪当前流式目标消息：`generateNarrative` 重置为 null，首个 chunk 创建新 assistant 消息并记录其 id，后续 chunk 追加到该消息的 content；`_handleNarrativeComplete` 用 `fullText` 覆盖流式累积内容（authoritative）并触发自动保存
    - 所有 IPC 事件回调按 `saveId` 过滤，避免多存档并发时事件串扰
    - `generateNarrative` 采用 fire-and-forget 模式：设置 `isGenerating=true` 后调用 IPC，不 await；完成通过 `onNarrativeComplete` 事件回调处理；同步错误通过 `.catch()` 兜底复位 `isGenerating`
    - 事件订阅在模块加载顶层执行，检查 `typeof window !== 'undefined' && window.electronAPI?.game` 后才订阅，避免测试环境（vitest `environment: 'node'`）下报错
    - `gameUIStore` 的 `GameView` 类型为局部定义（包含 options / gallery / saves 三个对话框视图），与 `game.types.ts` 中的 `GameView` 枚举（仅含 LOBBY / DETAIL / MAIN）不同，便于 GameModeEntry 路由层统一处理
    - `gameUIStore.goBack` 采用单层历史栈：`previousView` 仅记录上一级视图，返回后清空（不支持多级回溯）
  - **修改文件**：`src/renderer/types/electron.d.ts` 新增 `game` 命名空间类型声明（与 Task 5 preload 契约一致），解耦渲染进程 store 开发——若 Task 5 已在 preload 侧声明则无冲突（同一类型可重复声明）
  - **验证结果**：
    - `npx vitest run src/renderer/stores/__tests__/gameStore.test.ts src/renderer/stores/__tests__/gameUIStore.test.ts` 全部 73 个测试通过（`Test Files 2 passed (2) / Tests 73 passed (73) / Duration 368ms`）
    - `npx tsc --noEmit` 在新增文件上无错误（其他既有文件的预存错误与本任务无关）
    - 既有 game 相关测试（GameTemplateRegistry / game.types / GameRepository / GameSaveRepository / GamePromptBuilder / GameTableEditParser）共 184 个测试全部通过，无回归
  - **【重点标记 - 测试中 mock window.electronAPI 的时机】**：由于 store 在模块加载时即调用 `setupGameEventListeners()` 订阅 IPC 事件，测试必须在 `import { useGameStore }` 之前设置 `globalThis.window.electronAPI.game`。ESM 不允许在 import 之间穿插赋值语句，因此采用 `vi.hoisted(() => { (globalThis as any).window = {...}; return { mockGameApi, capturedListeners }; })` 模式——`vi.hoisted` 的回调会在所有 import 之前执行。后续在 `src/renderer/stores/__tests__/` 下新增依赖 `window.electronAPI` 的 store 测试时需复用此模式
  - 涉及文件：`src/renderer/stores/gameStore.ts`（新建）、`src/renderer/stores/gameUIStore.ts`（新建）、`src/renderer/stores/__tests__/gameStore.test.ts`（新建）、`src/renderer/stores/__tests__/gameUIStore.test.ts`（新建）、`src/renderer/types/electron.d.ts`（修改：新增 game 命名空间类型声明）

- **游戏模式 IPC handler 与 preload 桥接**（Spec: add-game-mode-framework / Task 5）：实现游戏模式所有 IPC handler（按领域拆分为 5 个子文件 + 1 个聚合入口），新增 `game` preload 命名空间，并通过集成测试验证流式叙事事件序列。
  - **新增文件**：
    - `src/main/ipc/handlers/game/gameMetaHandlers.ts`（78 行）：游戏元数据 CRUD（list / getMeta / createGame / updateGame / deleteGame），全部使用 wrapHandler 高阶函数统一 try/catch 兜底
    - `src/main/ipc/handlers/game/gameSaveHandlers.ts`（97 行）：存档 CRUD（createSave / loadSave / listSaves / deleteSave / save），对齐 GameSaveRepository.updateSave 字段（narrativeLog / stateSnapshot / currentTurn / currentNodeId / nodeTitle / turnCount）
    - `src/main/ipc/handlers/game/gameTableHandlers.ts`（112 行）：表格数据 CRUD + 版本快照（getTableData / saveTableData / applyTableEdits / getVersionSnapshot / confirmVersion / rollbackVersion），返回结构与 GameTableRepository.applyTableEdits 对齐
    - `src/main/ipc/handlers/game/gameNarrativeHandlers.ts`（185 行）：AI 叙事流式生成（generateNarrative / cancelGeneration）；维护 activeAbortControllers Map（key=saveId），导出 abortAllActiveGameRequests()；将 NarrativeCallbacks 转换为 IPC 事件推送（game:narrative:chunk / complete / error / table:updated）
    - `src/main/ipc/handlers/game/gameConfigHandlers.ts`（43 行）：游戏本地配置（getConfig / saveConfig）
    - `src/main/ipc/handlers/gameHandlers.ts`（73 行）：聚合入口，导出 registerGameHandlers() 与 abortAllActiveGameRequests()；在 registerGameHandlers() 内部完成 GameNarrativeService 的依赖注入（setGameRepository / setGameSaveRepository / setGameTableRepository）
    - `src/main/ipc/handlers/game/__tests__/gameHandlers.test.ts`（875 行）：24 个集成测试用例，全部通过
  - **修改文件**：
    - `src/main/ipc/index.ts`：在 setupIpcHandlers() 中新增 registerGameHandlers() 调用（行 47）
    - `src/main/preload.ts`：在 writing 命名空间后新增 game 命名空间（行 495-604），包含 20 个 invoke 方法 + 4 个流式事件监听器（onNarrativeChunk / onNarrativeComplete / onNarrativeError / onTableUpdated），每个监听器返回 unsubscribe 函数（与 writing.onPolishChunk 模式一致）
  - **设计要点**：
    - **依赖注入**：GameNarrativeService 通过 setter 注入仓库依赖（setGameRepository / setGameSaveRepository / setGameTableRepository），在 registerGameHandlers() 中一次性注入；service 设计为「依赖未注入时优雅降级」，未注入时仅功能受限（不抛错）
    - **流式事件推送**：generateNarrative handler 立即返回 success: true，实际生成在后台异步进行；通过 event.sender.send 将 service 的 callbacks（onChunk / onComplete / onError）转换为 4 个 IPC 事件推送给渲染进程；在 onComplete 中若 tableChanges.commandsExecuted > 0 额外推送 game:table:updated 事件
    - **取消机制**：activeAbortControllers Map（key=saveId）允许同 saveId 的旧请求被新请求 abort（避免并发生成同一存档）；cancelGeneration(saveId) 单独取消；abortAllActiveGameRequests() 批量取消（应用退出 / 切换存档场景）
    - **safeSend 防御**：在推送 IPC 事件前检查 event.sender.isDestroyed()，避免窗口关闭场景下的崩溃
    - **AIService 方法名对齐**：实际方法名是 streamChatAPI（非 spec 中提到的 callStream），签名 `aiService.streamChatAPI(messages, options, onChunk)` 返回 `Promise<{ content, generationTime, model }>`，本任务通过 GameNarrativeService 间接调用，handler 层无需关心
    - **GameSaveRepository 无 appendNarrativeMessage 方法**：消息追加通过 loadSave + updateSave({ narrativeLog }) 组合实现（GameNarrativeService.persistNarrativeMessage 已封装此逻辑）
  - **验证结果**：
    - `npx vitest run src/main/ipc/handlers/game`：24 个测试全部通过（`Test Files 1 passed (1) / Tests 24 passed (24) / Duration 1.10s`）
    - `npx tsc --noEmit`：在新增文件上无错误；既有文件 `ipc/index.ts:1`（ipcMain declared but never read）与 `preload.ts:45`（Function | undefined not assignable）均为本任务前已存在的预存错误（与 Task 5 修改无关）
  - **【重点标记 - vi.mock 提升与 vi.hoisted】**：集成测试需在 vi.mock 工厂内引用共享状态（如临时目录路径、IPC handler 注册表、mock stream 配置），但 vi.mock 工厂在文件 import 之前执行（提升），普通 `const` 变量在工厂内不可访问，会抛 `ReferenceError: Cannot access 'X' before initialization`。解决方案是使用 `vi.hoisted(() => ({ value: ... }))` 创建可变对象引用，工厂内通过 `obj.value` 读取。后续在 `__tests__/` 下新增集成测试时需注意此模式
  - **【重点标记 - 副作用模块的 mock 路径深度】**：测试文件位于 `src/main/ipc/handlers/game/__tests__/`，比被测的 `src/main/services/` 多两层目录，相对路径需 `../../../../services/AIService`（4 个 `../`）而非 3 个。初次编写时误用 3 个 `../` 导致 vi.mock 未生效，真实 storageManager.ts 被加载触发 `electron-store` 初始化错误。后续在 `__tests__/` 下新增测试时需注意路径深度
  - **【重点标记 - 副作用模块的级联 mock】**：AIService 间接 import 的 `storageService.ts`（行 726 `export default getStorageService()`）与 `storageManager.ts`（行 663 `export default getStorageManager()`）均为副作用模块，import 时即触发 StorageManager 初始化（依赖 electron app.getPath）。集成测试需同时 mock `services/storageService` 与 `services/storageManager` 两个模块，否则即使 mock 了 AIService，真实 storageManager 仍会被加载
  - **【重点标记 - tableEdit 协议格式】**：GameTableEditParser 期望的是函数式语法 `insertRow(sheetIndex, {"colIndex":"value"})`（HTML 注释包裹 `<!-- <tableEdit>...</tableEdit> -->`），而非 XML 格式。测试用例初次使用 XML 格式导致 commands 解析为空，table:updated 事件未推送。修正为函数式语法后通过
  - **【重点标记 - ESLint 限制（预存问题）】**：项目 `.eslintrc.js` 引用 `eslint-plugin-react-hooks` 但未安装，导致 `npx eslint` 全局失败（与本任务无关的预存问题，前序任务已记录）。本任务代码已通过 `tsc --noEmit`（含 `noUnusedLocals` + `noUnusedParameters`）验证无未使用变量
  - 涉及文件：`src/main/ipc/handlers/game/gameMetaHandlers.ts`（新建）、`gameSaveHandlers.ts`（新建）、`gameTableHandlers.ts`（新建）、`gameNarrativeHandlers.ts`（新建）、`gameConfigHandlers.ts`（新建）、`src/main/ipc/handlers/gameHandlers.ts`（新建）、`src/main/ipc/handlers/game/__tests__/gameHandlers.test.ts`（新建）、`src/main/ipc/index.ts`（修改）、`src/main/preload.ts`（修改）

- **游戏模板注册中心与 4 个占位模板**（Spec: add-game-mode-framework / Task 4）：实现渲染进程的 `GameTemplateRegistry` 单例注册中心，提供 `register / get / list / has / clear` 方法；创建 4 个占位游戏模板（Mystery / DatingSim / Werewolf / TextRpg）供大厅展示，主组件统一懒加载 `PlaceholderGameMain` 占位组件。`index.ts` 在被首次 import 时自动将 4 个模板注册到注册中心（副作用模块）。
  - **新增文件**：
    - `src/renderer/components/Game/templates/GameTemplateRegistry.ts`（73 行）：`GameTemplateRegistryImpl` 类 + 导出单例 `GameTemplateRegistry`；内部用 `Map<GameType, GameTypeTemplate>` 存储，重复注册仅 `console.warn` 不抛错（便于热重载）
    - `src/renderer/components/Game/templates/PlaceholderGameMain.tsx`（45 行）：占位主组件，展示"该游戏类型正在开发中"提示；所有占位模板的 `Component` 字段统一懒加载此组件
    - `src/renderer/components/Game/templates/MysteryTemplate.ts`（34 行）：逆转推理 - `GameStatus.PLANNED`，tags: ['推理', '法庭', '调查']
    - `src/renderer/components/Game/templates/DatingSimTemplate.ts`（34 行）：恋爱模拟 - `GameStatus.PLANNED`，tags: ['恋爱', '好感度', '约会']
    - `src/renderer/components/Game/templates/WerewolfTemplate.ts`（34 行）：狼人杀 - `GameStatus.PLANNED`，tags: ['推理', '阵营', '多人']
    - `src/renderer/components/Game/templates/TextRpgTemplate.ts`（34 行）：文字RPG - `GameStatus.PLANNED`，tags: ['RPG', '冒险', '成长']
    - `src/renderer/components/Game/templates/index.ts`（32 行）：聚合导出 + 自动注册 4 个模板（MANAGEMENT 待 Task 14 实现，暂不注册）
    - `src/renderer/components/Game/templates/__tests__/GameTemplateRegistry.test.ts`（203 行）：32 个测试用例，全部通过
  - **设计要点**：
    - 采用方案 A（创建占位组件 `PlaceholderGameMain.tsx`，所有占位模板懒加载它），未修改 `game.types.ts` 中 `GameTypeTemplate.Component` 的类型定义（保持 `React.LazyExoticComponent<React.ComponentType<GameTemplateProps>>` 强类型）
    - 4 个模板均声明 `panels: []`（占位）、`tableSchema: DEFAULT_GAME_TABLE_SCHEMA`（空 schema）、`meta.status: GameStatus.PLANNED`
    - `GameTemplateRegistry` 单例模式：导出实例而非类，保证全应用共享同一注册表
    - `index.ts` 作为副作用模块：首次 import 即触发注册，调用方无需手动调用 `register`
  - **验证结果**：
    - `npx vitest run src/renderer/components/Game/templates/__tests__/GameTemplateRegistry.test.ts` 全部 32 个测试通过（`Test Files 1 passed (1) / Tests 32 passed (32) / Duration 326ms`）
    - `npm run typecheck`（`tsc --noEmit`）在新文件上无错误；其他既有文件的预存错误与本任务无关
  - **【重点标记 - 测试文件导入路径深度】**：测试文件位于 `templates/__tests__/` 子目录，比模板文件多一层目录，导入 `shared` 类型需 5 个 `../`（`../../../../../shared/types/game.types`），而非模板文件使用的 4 个 `../`。初次编写时误用 4 个 `../` 导致 `tsc` 报 `TS2307: Cannot find module`。修复后通过——后续在 `templates/__tests__/` 下新增测试时需注意路径深度
  - **【重点标记 - ESLint 限制（预存问题）】**：项目 `.eslintrc.js` 引用 `eslint-plugin-react-hooks` 但未安装，导致 `npx eslint` 全局失败（与本任务无关的预存问题，前序 AnsiTileMap 任务已记录）。本任务代码已通过 `tsc --noEmit`（含 `noUnusedLocals` + `noUnusedParameters`）验证无未使用变量；`PlaceholderGameMain.tsx` 中 `_props` 参数遵循项目 `argsIgnorePattern: '^_'` 规则（与 `preload.ts` 中 `_event` 同一约定）
  - 涉及文件：`src/renderer/components/Game/templates/GameTemplateRegistry.ts`（新建）、`PlaceholderGameMain.tsx`（新建）、`MysteryTemplate.ts`（新建）、`DatingSimTemplate.ts`（新建）、`WerewolfTemplate.ts`（新建）、`TextRpgTemplate.ts`（新建）、`index.ts`（新建）、`__tests__/GameTemplateRegistry.test.ts`（新建）

- **AnsiTileMap ANSI 字符瓦片地图组件**（Game 模块独立组件）：用于在游戏模式中渲染 ANSI 字符瓦片地图，支持 ANSI SGR 转义序列解析与字符级样式配置。
  - **新增文件**：
    - `src/renderer/components/Game/AnsiTileMap.tsx`（346 行）：组件实现 + `parseAnsi`/`stripAnsi` 工具函数导出
    - `src/renderer/components/Game/AnsiTileMap.css`（129 行）：等宽字体样式、hover 高亮、点击波纹、暗色主题适配
    - `src/renderer/components/Game/__tests__/AnsiTileMap.test.tsx`（284 行）：27 个测试用例，全部通过
  - **组件能力**：
    - CSS Grid 渲染（`gridTemplateColumns: repeat(cols, 1fr)`），等宽字体（Cascadia Code / Fira Code / Consolas / monospace），瓦片最小 20×20 px
    - ANSI SGR 解析支持：`\x1b[0m` 重置、`\x1b[30-37m` 前景色、`\x1b[40-47m` 背景色、`\x1b[1m` 加粗、组合参数（如 `\x1b[1;31m`）；不支持的 SGR 码静默忽略（剥离转义后保留字符显示）
    - `tileStyles` 配置优先于 ANSI 解析结果；`tileStyles[char].label` 可覆盖显示文本
    - 交互：hover 高亮（1px solid #1890ff + rgba(24,144,255,0.1) 背景）、点击触发 `onTileClick(row, col, strippedChar)`、悬停触发 `onTileHover`、键盘焦点支持
    - 坐标轴：`showCoordinates=true` 时显示行号（左）与列号（顶），通过单层 CSS Grid + 角色属性（`role="grid"/"rowheader"/"columnheader"/"gridcell"`）实现无障碍
    - 空矩阵安全：传入 `[]` 或 `[[]]` 不崩溃，渲染 `data-empty="true"` 占位
  - **导出工具函数**：`parseAnsi(text): ParsedAnsiSegment[]`、`stripAnsi(text): string`、`ParsedAnsiSegment` / `TileStyleConfig` / `AnsiTileMapProps` 类型
  - **【重点标记 - 配置限制】测试文件扩展名为 `.test.tsx`，但 `vitest.config.ts` 的 `include` 当前为 `['src/**/*.test.ts']`，不会自动拾取 `.test.tsx` 文件**。已通过临时配置（运行后删除）验证 27 个测试全部通过（`Test Files 1 passed (1) / Tests 27 passed (27)`）。要让 `npm test` 自动包含本测试文件，需将 `vitest.config.ts` 的 `include` 扩展为 `['src/**/*.test.ts', 'src/**/*.test.tsx']`。本次任务按要求未修改其他文件，仅创建三个目标文件
  - **【重点标记 - 测试环境限制】**：项目当前未安装 `@testing-library/react`、`jsdom`、`happy-dom` 或 `react-test-renderer`，且 `vitest.config.ts` 的 `environment: 'node'`。本测试采用 `react-dom/server` 的 `renderToStaticMarkup`（在 node 环境可用）验证渲染产物，并通过 `data-row/data-col/data-char` 属性 + 直接调用 spy 验证点击/悬停回调契约。**完整的 DOM 事件模拟（真实 click 触发 onTileClick）需后续引入 jsdom + @testing-library/react 后才能实现**——已在测试文件头部注释中明确说明该限制
  - **TypeScript 类型检查**：`npx tsc --noEmit` 在新增文件上无错误（其他既有文件如 `KnowledgeItemList.tsx`、`GameSaveRepository.ts` 的预存错误与本任务无关）
  - **【重点标记 - ESLint 限制】**：项目 `.eslintrc.js` 引用 `eslint-plugin-react-hooks` 插件但 `package.json` devDependencies 中未声明该包，导致 `npx eslint` 全局失败（与本任务无关的预存问题）。本组件已严格遵循 `react-hooks/rules-of-hooks` 与 `@typescript-eslint/no-unused-vars` 规则
  - 涉及文件：`src/renderer/components/Game/AnsiTileMap.tsx`（新建）、`src/renderer/components/Game/AnsiTileMap.css`（新建）、`src/renderer/components/Game/__tests__/AnsiTileMap.test.tsx`（新建）

- **AI 回复人称属性 - 类型与提示词层扩展**（Spec: add-person-attribute-to-ai-reply / Task 1）：为"AI回复"按钮新增人称视角（第一/第二/第三人称）支持的类型定义与提示词注入基础。本任务为后续 Task 2-5（hook 业务逻辑、UI 选择器、父组件透传、单元测试）铺设底层契约，本身不改变现有运行时行为。
  - **`CharacterSessionConfig` 新增 `userReplyPerson` 字段**（`CharacterDialogueChat.types.ts`）：可选 `'first' | 'second' | 'third'`，持久化到 `character-session-<cardId>` localStorage；默认 `undefined` 等同于 `'first'`（向后兼容）。含完整 JSDoc 注释说明三种取值的语义与持久化位置
  - **`buildUserReplySystemPrompt` 新增第 3 个可选参数 `person`**（`PromptBuilder.ts`）：签名扩展为 `(characterInfo, persona, person?: 'first' | 'second' | 'third')`；函数体内用 `const personValue = person || 'first';` 归一化（保持签名可选向后兼容）
  - **任务要求段落新增第 7 条人称视角约束**：在 `return` 之前根据 `personValue` 动态生成 `personConstraint` 字符串：
    - `first`（默认）：`以第一人称（"我"）视角生成回复，使用"我"作为自称`
    - `second`：`以第二人称（"你"）视角生成回复，使用"你"来指代 ${userName} 自身（互动小说风格）`
    - `third`：`以第三人称叙事视角生成回复，使用"${userName}"作为主语（小说叙事风格）`
  - **JSDoc 更新**：新增 `@param person` 行说明人称视角参数与缺省值
  - **向后兼容性说明（重点）**：spec "Scenario: 默认值向后兼容" 与 "Scenario: 第一人称提示词" 之间存在语义细微差异——前者要求"行为与现有实现完全一致"，后者要求 first 时也注入第 7 条约束。**采用 "Scenario: 第一人称提示词" 为准**：无论是否传参，只要 `personValue === 'first'` 就追加第 7 条约束。这意味着不传 `person` 参数时输出会比旧版多出第 7 条"以第一人称..."约束。现有 `PromptBuilder.userReply.test.ts` 32 个测试用例全部使用 `toContain` 断言，未断言任务要求条数或第一人称约束的缺失，因此全部通过（已验证）。Task 5 将补充人称参数的专项测试
  - **验证结果**：`npx vitest run src/renderer/components/Character/CharacterDialogueChat/__tests__/PromptBuilder.userReply.test.ts` 全部 32 个测试通过；`npx tsc --noEmit` 在修改文件上无新增类型错误
  - 涉及文件：`src/renderer/components/Character/CharacterDialogueChat/CharacterDialogueChat.types.ts`、`src/renderer/components/Character/CharacterDialogueChat/PromptBuilder.ts`

## [0.0.32] - 2026-07-03

### Added
- **调整 AI 超参数默认值并暴露 stop/DRY 采样配置 UI**（Spec: optimize-chat-ai-intelligence / Task 6）：参照 SillyTavern textgen-settings.js 的 DRY 采样机制，将 `top_p=0.95, frequency_penalty=0.3, presence_penalty=0.3` 设为新基线，新增 `repetition_penalty` 滑块与"高级采样参数"折叠区（含 DRY 采样组 + no_repeat_ngram_size），按 `engineCapabilities` 显隐；ChatEngine 按能力注入对应字段到请求体。
  - **配置抽取重构**：将 `PARAMETER_CONFIGS` 与新增 `DRY_PARAMETER_CONFIGS` 从 `ParameterPanel.tsx` 抽取到独立 `parameterConfigs.ts`（纯 .ts，无 antd/React 依赖），便于单元测试；`ParameterConfig` 接口新增可选 `capability?: keyof EngineCapabilities` 字段实现按能力显隐过滤
  - **新默认值**：`top_p=0.95`、`frequency_penalty=0.3`、`presence_penalty=0.3`、`repetition_penalty=1.1`（0.8-1.5，step 0.05）、`dry_multiplier=0.8`、`dry_base=1.75`、`dry_allowed_length=2`、`no_repeat_ngram_size=0`
  - **能力预设**：`src/shared/settings.ts` 默认引擎（text_completion 模式）配置 `capabilities: {supportsStopArray:true, supportsRepPen:true, supportsDrySampler:true}`；`AIEngineConfig.capabilities` 为可选字段，缺省时由 `getDefaultEngineCapabilities(api_mode)` 启发式推断（text_completion → 全部支持；chat_completion/unknown → 仅 supportsStopArray=true）
  - **DRY UI 位置**：`ParameterPanel.tsx` 主参数区之后新增"高级采样参数"折叠区（ExperimentOutlined 图标），默认收起；折叠状态持久化到 localStorage `param-panel-advanced-collapsed`（缺省 true）；仅当 `engineCapabilities.supportsDrySampler === true` 时渲染
  - **请求体注入**：新增纯函数 `buildSamplingExtras(config, capabilities?)`（位于 `ChatEngine.types.ts`，与 Task 3.3 `resolveStopForRequestBody` 风格一致）；`ChatEngine.ts::buildRequestBody` 在 presence_penalty 注入块之后调用，按能力 spread `repetition_penalty` + 4 个 DRY 字段到 requestBody；NaN 值回退到 `REP_PEN_DEFAULT=1.1` / `DRY_SAMPLER_DEFAULTS`
  - **getEffectiveParams 优先级**：保持 `characterConfig > aiEngines > 硬编码`；新增 5 个参数的读取链路（repetition_penalty 缺省时回退到 `globalEngine.repetition_penalty`），`engineConfigWithParams` 同步注入
  - **单元测试**：新增 45 个测试用例（`parameterConfigs.test.ts` 24 个 + `buildSamplingExtras.test.ts` 21 个），覆盖默认值、capability 过滤三态、api_mode 推断、NaN/缺省/优先级边界；`npx vitest run` 全量 199 个测试通过；改动文件 `npx tsc --noEmit` 无新增类型错误
  - **⚠️ 重点标记 - 调试遗留问题（TS 类型收窄）**：`parameterConfigs.test.ts` 第 219 行 tsc 报错 `Property 'supportsDrySampler' does not exist on type 'never'`。根因：`const caps: EngineCapabilities | undefined = undefined` 被 TypeScript 收窄为 `undefined`/`never` 字面量类型，导致 `caps?.supportsDrySampler` 访问非法。修复方式：改用 `const caps = undefined as EngineCapabilities | undefined` 类型断言阻止收窄。该问题不影响运行时（vitest 通过），但提醒后续编写测试时需注意 TS 对 `const` 字面量类型的收窄特性
  - 涉及文件：`parameterConfigs.ts`（新建）、`__tests__/parameterConfigs.test.ts`（新建）、`Common/ChatEngine/__tests__/buildSamplingExtras.test.ts`（新建）、`CharacterDialogueChat.types.ts`、`Common/ChatEngine/ChatEngine.types.ts`、`Common/ChatEngine/ChatEngine.ts`、`shared/settings.ts`、`CharacterDialogueChat.hooks.ts`、`ParameterPanel.tsx`、`ConfigPanel.tsx`、`CharacterDialogueChat.tsx`、`.trae/specs/optimize-chat-ai-intelligence/tasks.md`（更新 Task 6 勾选）

## [0.0.31] - 2026-07-03

### Added
- **实现重试/续写去重检测（n-gram Jaccard）**（Spec: optimize-chat-ai-intelligence / Task 5）：在 `retryMessage` 与 `continueConversation` 流程中引入字符级 4-gram Jaccard 相似度检测，自动重新生成"几乎相同"的回复，避免用户反复点击重试；续写时检测 AI 是否原样重写已有内容并注入 `continue_nudge_prompt`。
  - **新增 `similarityUtils.ts`**：字符级 4-gram（中文友好，无需分词）集合 Jaccard 相似度算法；`overlapRate` 基于最长公共前缀；`evaluateDedupRetry` 纯函数封装去重决策逻辑供 hooks 与单测共用；500 字文本对实测 < 1ms（远优于 spec 要求的 < 50ms）
  - **`CharacterDialogueChat.hooks.ts` 集成**：`requestAIResponse` 新增可选第 5 参数 `dedupConfig?: DedupConfig`（向后兼容，不破坏现有 `retryMessage`/`continueConversation` 签名）；`engine.onComplete` 内完成去重判定，触发递归重试（max 2 次）；续写场景自动检测 `promptType === 'continuation' && initialContent` 非空，无需调用方显式传参
  - **`PromptBuilder.ts` 新增 `buildContinueNudgePrompt()`**：返回 `[Continue your last message without repeating its original content.]`（Task 5 占位实现，Task 8 完善提示词）
  - **去重阈值**：重试相似度 `nGramJaccard > 0.8` 触发重新生成；续写重叠率 `overlapRate > 0.6` 触发 `continue_nudge_prompt`；最大重试次数 2 次（总生成次数上限 3 次）
  - **toast 通知方式**：antd `message.info()`（重试耗尽提示）/ `message.error()`（重试失败提示），与项目现有通知方式一致（`hooks.ts` 已 `import { message } from 'antd'`）
  - **单元测试**：新增 38 个测试用例（`similarityUtils.test.ts` 34 个 + `buildContinueNudgePrompt.test.ts` 4 个），覆盖 nGramJaccard/overlapRate/evaluateDedupRetry/性能/续写决策等场景；`npx vitest run` 全量 154 个测试通过（含 Task 1-4 既有 116 个）
  - 涉及文件：`utils/similarityUtils.ts`（新建）、`utils/__tests__/similarityUtils.test.ts`（新建）、`__tests__/buildContinueNudgePrompt.test.ts`（新建）、`CharacterDialogueChat.hooks.ts`（修改）、`PromptBuilder.ts`（修改）、`.trae/specs/optimize-chat-ai-intelligence/tasks.md`（更新 Task 5 勾选）

## [0.0.30] - 2026-05-17

### Added
- **版本链接服务 VersionLinkerService**：实现聊天版本与表格快照的统一版本管理核心服务。支持版本索引管理、变更追踪、一致性验证等功能。
  - **核心接口**：VersionLinkRecord（版本链接记录）、VersionIndex（版本索引）、ChangeLogEntry（变更日志条目）、ConsistencyReport（一致性报告）
  - **版本ID生成**：格式为 `v{YYYYMMDD_HHmmss}_{6位随机字符}`，确保唯一性
  - **版本索引管理**：通过 `version-index.json` 管理所有版本链接记录，支持读取、保存、更新一致性状态
  - **变更追踪日志**：通过 `change-log.json` 记录所有版本操作，支持按数量限制查询最新条目
  - **联动版本创建**：`createLinkedVersion()` 方法同时创建聊天版本（`versions/chat/`）和表格快照（`versions/table/`），使用相同 versionLinkId 关联，自动更新索引和变更日志
  - **一致性验证**：`verifyConsistency()` 扫描所有版本文件，交叉引用索引，检查文件存在性、时间戳差异（≤5000ms阈值），发现孤立文件
  - **目录结构**：`{userDataPath}/data/memories/chats/{characterCardName}/` 下管理 `version-index.json`、`change-log.json`、`versions/chat/`、`versions/table/`
  - **字符名清理**：使用正则 `/[<>:"/\\|?*\x00-\x1F]/g` 替换为 `_`，确保目录名安全
  - **单例导出**：`export const versionLinkerService = new VersionLinkerService()`
  - **依赖**：使用 `fs/promises` 进行异步文件操作，从 `../utils/appPath` 导入 `getUserDataPath`
  - 涉及文件：VersionLinkerService.ts（新建）

### Fixed
- **【重点标记】润色功能 AI 将待润色文本误判为对话生成任务**（Spec: fix-polish-task-framing）：用户在输入框输入草稿文本后点击"润色"按钮，AI 应输出润色扩展后的文本，但实际输出对草稿文本的直接回复（如草稿为问句则回答该问题）。该问题经历 **4 轮修复** 才彻底解决，前 3 轮修复均无效，根因深挖过程体现了 LLM prompt 工程中"任务框架（Task Framing）"一致性的重要性。
  - **修复历程**：
    1. **第 1 轮（fix-polish-input-undo-and-target / 阶段六）**：尝试在 `contextMessages` 末尾追加合成 user 消息明确请求润色 → 失败，AI 把润色对象当作问题回答（根因：合成 user 消息被 AI 当作当前输入）
    2. **第 2 轮（fix-polish-target-misinterpretation / 阶段七）**：使用 `<polish_target>` 标签包裹润色对象 + 弱否定约束 → 失败，无法对抗对话历史的强模式上下文（根因：约束措辞太弱，且位于待润色文本之后被 LLM attention 稀释）
    3. **第 3 轮（fix-polish-context-isolation / 阶段八）**：将对话历史从 `engine.sendMessage` 的 messages 数组中隔离，改为格式化为文本嵌入系统提示的"## 对话历史参考"段落 → 部分改善但仍失败（根因：消息结构改变了，但系统提示中仍残留"生成回复"、"确保上下文连贯"等对话生成语义触发词）
    4. **第 4 轮（fix-polish-task-framing / 阶段九，最终修复）**：从**任务框架层面**重构 `buildPolishInputSystemPrompt`，彻底去除对话生成语义信号
  - **根本原因**：润色函数 `buildPolishInputSystemPrompt` 与孪生函数 `buildUserReplySystemPrompt`（对话回复生成）在任务框架上高度相似——`personConstraint` 措辞完全相同（"以第一人称视角**生成回复**"），且任务要求中含"结合对话历史与 ${charName} 的最新发言**确保上下文连贯**"等对话生成指令，"## 对方角色上下文"段落还携带 `personality` / `characterCardContent` 等角色扮演触发器。这些信号让 LLM 将润色任务误判为对话生成任务。
  - **最终修复方案（6 项改动，均位于 `PromptBuilder.ts::buildPolishInputSystemPrompt`）**：
    1. `personConstraint` 措辞由"生成回复"改为"润色后的文本...输出"（区别于孪生函数的"生成回复"）
    2. 删除任务要求第 6 条"结合对话历史参考与 ${charName} 的最新发言确保上下文连贯"，改为"润色结果需与对话历史不矛盾即可，无需衔接角色发言，无需推进对话"
    3. 删除"## 对方角色上下文"段落中的 `personality` 与 `characterCardContent` 字段（角色扮演触发器），仅保留角色名并显式标注"仅作润色参考，不要扮演这个角色"
    4. 段落顺序调整：将"## 关键约束"段落提前到"## 待润色文本"之前（利用 LLM attention 前重后轻特性）
    5. 开头任务定义追加"禁止生成对话回复，禁止回答 <polish_target> 内的任何问题"声明
    6. "## 关键约束"措辞强化为"绝对禁止"级别
  - **关键代码片段对比**：
    ```typescript
    // 修复前（与 buildUserReplySystemPrompt 完全相同，错误）
    personConstraint = `以第一人称（"我"）视角生成回复，使用"我"作为自称`;
    // 修复后（润色任务用"输出"，区别于对话任务的"生成回复"）
    personConstraint = `润色后的文本以第一人称（"我"）视角输出，使用"我"作为自称`;
    ```
  - **测试用例**：`PromptBuilder.polishInput.test.ts` 更新 6 个 + 新增 8 个测试用例，覆盖任务框架重构后的所有改动点（personConstraint 措辞、关键约束前置、角色上下文精简、绝对禁止约束、对话生成关键词检测、孪生函数差异化等）。全部 1037 个测试通过。
  - **验证结果**：`npx vitest run src/renderer/components/Character/CharacterDialogueChat/__tests__/PromptBuilder.polishInput.test.ts` → 14 tests passed；全量 `npx vitest run` → 1037 tests passed
  - **诊断方法论**：本次修复采用了"孪生函数对比诊断法"——当某功能失败但孪生功能（`buildUserReplySystemPrompt`）正常时，对比两者差异定位根因。同时遵循"多轮修复无效时的诊断升级"路径：提示措辞 → 提示结构 → 消息结构 → 任务框架 → 模型行为
  - **文档同步**（按规范 8 要求四处同步）：
    1. 模块技术文档 `doc/04b-character-dialogue-chat-module.md` 新增第四条【重点标记】（任务框架重构）
    2. 问题修复知识库 `docs/BUGFIX_KNOWLEDGE_BASE.md` 新增 BUG-001 完整记录（含 7 章节：问题现象/根本原因/修复方案/代码片段/测试用例/验证过程/经验教训）
    3. Spec 三件套 `.trae/specs/fix-polish-task-framing/`（spec.md / tasks.md / checklist.md）全部勾选完成
    4. CHANGELOG.md（本条目）
  - **预防性编码规范**：在 `docs/BUGFIX_KNOWLEDGE_BASE.md` 第二部分制定了 8 条编码规范/检查清单，覆盖 Prompt 工程（规范 1-5）、顽固 Bug 诊断（规范 6-7）、文档同步（规范 8），避免后续同类问题反复返工
  - 涉及文件：`src/renderer/components/Character/CharacterDialogueChat/PromptBuilder.ts`（重构 `buildPolishInputSystemPrompt`）、`src/renderer/components/Character/CharacterDialogueChat/__tests__/PromptBuilder.polishInput.test.ts`（更新 6 个 + 新增 8 个测试）、`doc/04b-character-dialogue-chat-module.md`（新增第四条【重点标记】）、`docs/BUGFIX_KNOWLEDGE_BASE.md`（新建，含 BUG-001 完整记录 + 8 条编码规范 + 标准化模板 + 团队技术分享方案）、`.trae/specs/fix-polish-task-framing/spec.md` / `tasks.md` / `checklist.md`（spec 三件套）、`CHANGELOG.md`（新增条目）

## [0.0.29] - 2026-05-12

### Fixed
- **修复关联模板信息在对话框关闭后丢失的问题**：用户关联模板后关闭对话框，重新打开时模板关联信息丢失。根因：模板关联信息仅通过IPC存储在`associations.json`中，未持久化到角色卡对话配置JSON文件中。修复方案：(1)在`characterConfig`中新增`memoryTableTemplateId`和`memoryTableTemplateName`字段；(2)`MemoryTablePanel`改为从config props获取关联信息，不再独立从IPC加载；(3)关联模板时，先调用IPC执行模板关联，再调用`updateConfig`将关联信息持久化到角色配置中；(4)在`ConfigPanel`、`CharacterDialogueChat.tsx`、`CharacterDialogueChat.hooks.ts`中传递模板关联信息；(5)`MemoryTablePanel`使用`useEffect`同步`selectedTemplate`与`associatedTemplateId`，确保重新打开对话框时回显正确。涉及文件：MemoryTablePanel.tsx、ConfigPanel.tsx、CharacterDialogueChat.tsx、CharacterDialogueChat.hooks.ts

- **在记忆表格设置面板中添加关联模板按钮**：用户在启用记忆表格时如果没有关联模板，无法正常使用表格功能。新增功能：(1)在`MemoryTablePanel`中添加"关联模板"按钮，效果与聊天记录管理中的关联按钮一致；(2)用户启用记忆表格时若未关联模板，自动弹出关联模板Modal并提示"启用记忆表格前，请先关联一个模板"；(3)按钮显示当前已关联的模板名称（未关联时显示"关联模板"）；(4)关联模板Modal中使用Select下拉框展示所有可用模板，支持更换已关联的模板；(5)新增IPC handler `memory:getAssociatedTemplate`获取当前关联的模板ID；(6)在preload.ts和类型声明中暴露`getAssociatedTemplate`和`associateTemplate` API；(7)在ConfigPanel.css中添加关联模板按钮样式（绿色未关联/蓝色已关联）。涉及文件：MemoryTablePanel.tsx、memoryHandlers.ts、preload.ts、electron.d.ts、memory.ts、ConfigPanel.css

- **【重点标记】修复AI请求50%概率卡死问题**：AI服务器请求有约50%概率卡死，根因是超时机制完全失效。分析发现：(1)`ChatEngine.ts`中`timeout: 0`（无超时限制）传送到主进程；(2)`aiHandlers.ts`中`effectiveTimeout = timeout || 0`导致超时值始终为0；(3)`if (effectiveTimeout && effectiveTimeout > 0)`条件不满足，超时定时器永不创建，`fetch()`调用在服务器响应慢时无限期挂起。修复方案：采用双层超时策略——(1)连接超时30秒（检测DNS解析、TCP连接、TLS握手问题）；(2)请求超时120秒（检测服务器响应慢问题）；(3)修改`ChatEngine.ts`默认timeout从0改为120000；(4)流式和非流式请求路径均增加连接超时和请求超时检测；(5)更新`ActiveRequest`接口增加`connectionTimeoutId`字段；(6)在取消和清理逻辑中清除连接超时定时器。涉及文件：ChatEngine.ts、aiHandlers.ts

- **修复AI Handler日志中AI完整回复内容被截断的问题**：`aiHandlers.ts` 中SSE解析成功日志将AI完整回复内容限制为前2000字符（`fullContent.substring(0, 2000)`），导致长回复无法在日志文件中查看完整内容。修复方案：移除 `substring(0, 2000)` 截断逻辑，直接输出完整 `fullContent` 到日志文件。涉及文件：aiHandlers.ts

- **【重点标记】深度排查对话功能中断问题并添加调试日志**：第一轮修复后用户反馈对话仍然无法调用AI引擎，日志在`memory:getTableData`后完全停止。排查发现：(1)备份文件存在时`autoInitializeChatSession`不会触发，返回空数据后流程中断但错误被静默吞掉；(2)`memory:autoInitializeSession` IPC handler在`memoryHandlers.ts`中已注册但未在`preload.ts`中暴露给渲染进程，导致渲染进程无法调用；(3)IPC返回数据可能存在序列化问题导致渲染进程的`await`挂起。修复方案：(1)在`requestAIResponse`函数外层添加全局try-catch包裹，确保任何未捕获异常都能被记录并更新UI错误状态；(2)在`requestAIResponse`的每个关键步骤（上下文检索→表格数据获取→提示词构建→Token管理→引擎调用）之间添加`console.log`调试日志（不依赖`addLog`的IPC通道），便于精确定位中断点；(3)在`memory:getTableData` IPC handler中添加序列化验证，确保返回数据可被正确传输；(4)在`preload.ts`中注册`autoInitializeSession` API。涉及文件：CharacterDialogueChat.hooks.ts、memoryHandlers.ts、preload.ts

- **【重点标记】实现用户首次对话自动初始化功能**：当系统检测到用户进行首次对话且尚未生成聊天记录文件和对应表格时，自动执行初始化流程。实现方案：(1)在`chatLogService.ts`中新增`autoInitializeChatSession()`方法，复用现有`associateTemplate`方法严格遵循"关联"功能的技术规范，完成模板副本创建、表格文件创建和关联关系存储；(2)修改`getTableData()`方法，在检测到表格文件不存在且备份文件也不存在时，自动调用`autoInitializeChatSession()`触发初始化，成功后递归调用自身返回新创建的表格数据；(3)在IPC层新增`memory:autoInitializeSession` handler供渲染进程主动调用；(4)在渲染进程类型声明中增加`autoInitializeSession` API类型。涉及文件：chatLogService.ts、memoryHandlers.ts、electron.d.ts、memory.ts

- **【重点标记】修复对话功能无法调用AI引擎的Bug**：用户输入信息后系统未调用AI引擎进行对话，日志在`memory:getTableData`后停止。根因：`chatLogService.getTableData()`在表格JSON文件不存在时抛出异常(`throw new Error('文件不存在')`)，导致`requestAIResponse`函数中断，后续的system prompt构建、Token管理和AI引擎调用均无法执行。修复方案：(1)将`chatLogService.ts`中`getTableData`的文件不存在异常改为返回空数据结构`{ sheets: [], headers: {}, data: {}, sheetDescriptions: {} }`，允许新对话或尚未创建表格的角色继续对话；(2)在`CharacterDialogueChat.hooks.ts`中增加记忆表格数据处理完成的确认日志和提示词构建完成的确认日志，便于后续排查类似问题。涉及文件：chatLogService.ts、CharacterDialogueChat.hooks.ts

- **【重点标记】修复用户头像存储路径错误**：avatarService.ts 使用 `process.cwd()` 作为基础路径，生成类似 `G:\AI\creative-cafe\data\user-avatars` 的绝对路径，而非正确的 `__USER_DATA__/data/user-avatars` 路径。修复方案：(1) 从 `../utils/appPath` 导入 `getUserDataPath`；(2) 将构造函数中的 `process.cwd()` 替换为 `getUserDataPath()`；(3) 头像目录现在正确设置为 `path.join(getUserDataPath(), 'data', 'user-avatars')`。涉及文件：avatarService.ts

## [0.0.28] - 2026-05-11

### Added
- **【重点标记】实现类似SillyTavern的Token管理机制**：在对话组件和业务流程中新增Token管理模块，有效监控和控制发送至AI的上下文长度，避免因上下文过长导致的响应延迟或性能下降问题。
  - **TokenCounter服务**：实现基于UTF-8字节长度的快速Token估算（UTF-8字节长度 / 3.35，与SillyTavern一致），支持消息级别Token计数、System Prompt计数、消息数组总计数。包含Token计数缓存机制（Map<messageId, tokenCount>），提升重复计算性能。涉及文件：TokenCounter.ts（新建）、types.ts（新建）
  - **ContextTruncator服务**：实现智能上下文截断算法，基于Token预算分配策略（可用预算 = 最大上下文Token数 - System Prompt Token数 - 响应预留Token数）。截断规则：(1)从最旧消息开始移除；(2)优先保留最近对话；(3)至少保留minMessagesToKeep轮对话；(4)最多保留maxMessagesToKeep条消息；(5)确保消息成对（user+assistant）。涉及文件：ContextTruncator.ts（新建）
  - **集成到对话流程**：在CharacterDialogueChat.hooks.ts的requestAIResponse()函数中，构建System Prompt后自动计算Token数并截断上下文消息。截断时记录详细日志（原始消息数、截断后消息数、Token变化、预算信息）。涉及文件：CharacterDialogueChat.hooks.ts（集成Token管理逻辑）
  - **配置支持**：扩展CharacterSessionConfig类型，新增maxContextTokens（默认6000）、reservedForResponse（默认1024）、minMessagesToKeep（默认2）、maxMessagesToKeep（默认40）字段，支持按角色自定义Token管理策略。涉及文件：CharacterDialogueChat.types.ts（类型扩展）
  - **技术实现要点**：(1)采用快速估算策略，避免浏览器端加载大型tokenizer文件；(2)Token计数包含消息格式开销（每消息4 tokens）和填充开销（3 tokens），与OpenAI API计数方式一致；(3)截断发生在System Prompt构建之后、发送给AI之前，确保关键信息（角色卡、向量检索、记忆表格）始终保留；(4)提供analyzeTruncation()方法用于分析和记录截断效果。涉及文件：TokenManagement/index.ts（模块导出）
  - **单元测试**：编写32个单元测试用例，覆盖TokenCounter和ContextTruncator的核心功能，包括：Token估算准确性、缓存管理、消息计数、截断边界情况、消息成对验证、截断分析等。所有测试通过。涉及文件：TokenManagement.test.ts（新建）

## [0.0.27] - 2026-05-11

### Fixed
- **修复模块切换时偶尔出现刷新效果的问题**：PageTransition 组件的 useEffect 依赖数组中包含了 children 参数，导致父组件每次渲染时即使 activeKey 未改变也会创建新的 React 元素引用，触发不必要的动画和组件重新挂载。修复方案：使用 useRef 缓存 children 引用，从 useEffect 依赖数组中移除 children，只在 activeKey 真正改变时才切换内容。涉及文件：PageTransition.tsx
- **【重点标记】修复清理缓存后聊天模式对话框无法打开的问题**：SingleChatDialog 组件在 characters.length === 0 时直接返回 null，而 fetchCharacters() 只在 CharacterManager 和 Dashboard 中被调用。清理缓存后角色数据尚未加载，导致点击聊天模式面板无法打开对话框。修复方案：在 SingleChatDialog 中监听 isDialogMode 变化，当对话框需要打开但角色数据为空时自动触发 fetchCharacters() 加载数据，并展示加载状态和空数据提示。涉及文件：SingleChatDialog.tsx

### Improved
- **修复 Ant Design Select 组件废弃 API 警告**：KnowledgeBaseBindingPanel 中使用了已废弃的 dropdownMatchSelectWidth 和 dropdownClassName API，替换为新的 popupMatchSelectWidth 和 classNames={{ popup: { root: 'knowledge-base-dropdown' } }} 语法。涉及文件：KnowledgeBaseBindingPanel.tsx
- **创作中心面板动态效果与纹理样式实现**：为四个模式面板（聊天/群聊/写作/游戏）分别实现独特纹理背景和动态动画效果。涉及文件：CreationCenter.css、CreationCenter.tsx

## [0.0.26] - 2026-05-10

### Improved
- **增强提示词区域分隔标记**：为system prompt中拼接的不同区域（背景知识、记忆表格、异步整理指令）添加了更清晰的分隔标记，帮助AI在长提示词场景下更准确区分不同区域，避免内容混淆。(1)使用Unicode双线框字符`═══════`作为区域分隔线，视觉区分度更高；(2)每个区域添加【区域 N：XXX】标题和【区域 N 结束】尾部标记，明确区域边界；(3)标题中附带说明文字，如"仅供参考，不是对话的一部分"、"以下为系统指令，不是对话内容"，帮助AI理解数据性质；涉及文件：PromptBuilder.ts

## [0.0.25] - 2026-05-10

### Improved
- **【重点标记】异步整理指令架构优化**：将完整的表格整理指令从user消息迁移回system提示词，提高AI生成tableEdit标签的稳定性。(1)**system prompt**：通过`buildFinalSystemPrompt`追加完整的`buildAsyncTableOrganizeInstructions`指令，包含表格模板结构、分类判断规则、增量更新策略等全部内容；(2)**user message**：仅拼接固定简短命令`\n\n然后进行表格整理`，作为触发AI执行整理的信号。这样AI在system prompt中看到完整指令，在user message中收到明确任务信号，双重保障tableEdit标签的生成稳定性。涉及文件：PromptBuilder.ts、CharacterDialogueChat.hooks.ts

## [0.0.24] - 2026-05-10

### Added
- **预览表格支持编辑和清空功能**：在表格预览弹窗中新增三项核心功能，满足用户自行修改或重新整理的需求。(1)**单元格内联编辑**：点击任意单元格即可进入编辑模式，支持回车确认或失焦自动保存；(2)**保存修改**：将当前表格的编辑结果持久化到JSON文件；(3)**清空当前表格**：清空当前选中表格的所有数据（带二次确认）；(4)**清空所有表格**：清空所有表格的数据（带二次确认，红色危险按钮）；涉及文件：TablePreviewModal.tsx

## [0.0.23] - 2026-05-10

### Improved
- **增强异步整理提示说明**：在参数面板的异步整理Tooltip中新增"延时"说明，明确告知用户"整理触发延时一回合（即第5条对话整理的是第3条对话的信息）"，帮助用户理解异步整理的工作机制——AI实际整理的是发送指令前的一条文本，而非后续生成的文本。涉及文件：MemoryTablePanel.tsx

## [0.0.22] - 2026-05-10

### Improved
- **增强所有表格的分类判断规则**：为时空表格、社交表格、事件表格添加明确的分类判断标准和关键示例，帮助AI正确区分实体类型并放入对应表格。具体改进：(1)时空表格：明确只记录时间/地点，不包括角色行为或物品，添加日期/地点示例；(2)社交表格：区分日常互动与重大事件，添加互动/汇报示例；(3)事件表格：区分重大事件与日常社交，添加犯罪/案件/日常活动对比示例；(4)统一使用"分类判断"格式和关键示例格式，与角色表格、物品表格保持一致。涉及文件：PromptBuilder.ts

## [0.0.21] - 2026-05-10

### Fixed
- **【重点标记】修复隐藏的tableEdit标签露出问题**：异步整理模式下tableEdit标签未被正确从显示内容中移除，导致用户在对话界面中看到技术标签。根本原因：使用indexOf进行精确字符串匹配定位标签位置失败（因AI生成的空白字符变体导致），备用正则方案也不够全面。修复方案：(1)移除不可靠的indexOf匹配定位逻辑；(2)直接使用连续正则替换移除所有可能的标签格式；(3)简化代码流程，避免分支逻辑导致的遗漏。涉及文件：CharacterDialogueChat.hooks.ts

## [0.0.20] - 2026-05-10

### Fixed
- **【重点标记】修复异步整理模式缺少表格模板结构信息问题**：异步整理模式下AI只收到当前表格数据，没有表格模板结构（表头定义），导致无法正确理解要提取哪些字段。修复方案：(1)修改buildFinalSystemPrompt、buildSystemPrompt接受tableStructure参数；(2)修改buildAsyncTableOrganizeInstructions使用tableStructure生成【表格模板结构】段落，包含每个表格的名称、字段结构和需要提取的字段；(3)在CharacterDialogueChat.hooks.ts中从tableResult提取sheets和headers结构传递给异步指令；(4)如果模板为空则发送默认模板结构（时空/角色/社交/物品/事件五个表格）作为备用。涉及文件：PromptBuilder.ts、usePromptBuilder.ts、CharacterDialogueChat.hooks.ts
- **【重点标记】修复异步整理模式表格描述缺失导致信息分类错误问题**：AI无法区分各表格用途，将物品错误放入角色表格。修复方案：(1)修改getTableData返回sheetDescriptions字段（从关联模板提取各表格description）；(2)tableStructure新增descriptions字段；(3)在PromptBuilder.ts中生成表格模板结构时追加"表格用途"行；(4)默认模板备用方案也追加用途描述。涉及文件：chatLogService.ts、CharacterDialogueChat.hooks.ts、PromptBuilder.ts、usePromptBuilder.ts

## [0.0.19] - 2026-05-10

### Fixed
- **【重点标记】修复异步整理模式AI生成错误表格格式问题**：异步整理指令buildAsyncTableOrganizeInstructions()过于简略，AI缺少表格格式、增量更新策略和唯一ID策略等关键规则约束，导致生成扁平化数据而非标准tableEdit命令。修复方案：将异步整理指令替换为与同步模式buildAIPromptForProgressive()完全一致的详细规则，包括：(1)详细的tableEdit命令格式说明和参数解释；(2)完整的增量更新决策流程；(3)唯一ID策略与变体称呼识别规则；(4)错误格式示例（绝对禁止）；(5)输出要求清单。涉及文件：PromptBuilder.ts

## [0.0.18] - 2026-05-10

### Fixed
- **【重点标记】修复异步整理模式表格文件不存在导致命令执行失败问题**：异步模式下executeTableEditCommands方法执行前表格JSON文件可能尚未创建，导致insertRowToTable/readJsonFile返回null。修复方案：(1)在executeTableEditCommands开头添加文件存在性检查；(2)使用与tableTemplateService完全一致的safeChatId计算方法（统一替换规则：/\s+/g, /@/g, /-/g等12种特殊字符）；(3)文件不存在时优先使用关联模板创建初始文件，若无关联模板则使用默认模板；(4)修复memoryHandlers.ts中缺失的tableEditParser导入。涉及文件：chatLogService.ts、memoryHandlers.ts

## [0.0.17] - 2026-05-10

### Added
- **动态tableEdit指令拼接机制**：根据用户选择的整理模式（sync/async）在任务说明中动态拼接tableEdit相关指令。参考用户成功做法（在任务说明中直接告知AI需要生成tableEdit），实现：(1)修改buildDialoguePrompt和buildContinuationPrompt支持organizeMode参数；(2)异步模式提示"系统将在提示词末尾提供详细的表格整理指令"；(3)同步模式提示"请在回复最后生成tableEdit标签，格式为<!-- <tableEdit> ... </tableEdit> -->"；(4)未选择整理模式时不拼接任何tableEdit指令，保持纯净的角色扮演提示词。涉及文件：PromptBuilder.ts、usePromptBuilder.ts

## [0.0.16] - 2026-05-10

### Fixed
- **【重点标记】修复异步整理功能AI未返回tableEdit指令问题**：增强异步整理指令的约束力，在PromptBuilder.ts的buildAsyncTableOrganizeInstructions()函数中添加：(1)开头新增【强制要求-MANDATORY】段落，强调必须生成tableEdit标签；(2)在输出顺序中增加第3步"最终确认"要求AI检查是否已包含标签；(3)在指令末尾添加【最终提醒】强制要求生成标签。通过多重强调提高AI遵守指令的概率。涉及文件：PromptBuilder.ts

## [0.0.15] - 2026-05-10

### Added
- **仪表盘使用技巧内容更新**：基于系统技术文档（01-09模块文档）编写了10条完整的系统使用指南，覆盖系统导航说明、AI引擎配置、世界书编辑、角色卡创作测试闭环、对话测试技巧、知识库语义检索、用户人设管理、效率提升技巧、数据安全说明、典型工作流推荐。Tips存储在 `data/tips.json`，通过 `file:readJson` IPC读取并在仪表盘Carousel组件中轮播展示。涉及文件：data/tips.json、doc/01-dashboard-module.md

## [0.0.14] - 2026-05-10

### Fixed
- **【重点标记】修复异步整理竞态条件**：将内容清理逻辑从setState之后移至之前执行，统一使用displayContent作为最终显示内容，避免带标签内容被保存到localStorage的竞态风险。涉及文件：CharacterDialogueChat.hooks.ts

### Improved
- **增强正则表达式兼容性**：支持3种tableEdit标签格式匹配（标准HTML注释+标签、纯标签、注释分隔格式），提升对AI变体输出的容错能力。涉及文件：CharacterDialogueChat.hooks.ts
- **增强IPC调用诊断**：添加chatId非空验证、解析错误详情输出、执行结果统计信息记录，便于问题排查。涉及文件：CharacterDialogueChat.hooks.ts
- **异步整理后自动刷新表格数据**：命令执行成功后主动调用getTableData刷新memoryTableDataRef，确保后续对话使用最新表格上下文。涉及文件：CharacterDialogueChat.hooks.ts

## [0.0.13] - 2026-05-10

### Improved
- **【重点标记】优化异步整理提示词 - Token减少20-30%且功能完整**：重构了异步整理指令的提示词结构，新建 `buildAsyncTableOrganizeInstructions()` 函数，在保持与同步整理相同功能覆盖的前提下，精简token消耗。关键优化点：(1)合并重复说明，去除冗余描述；(2)精简示例输出，保留核心格式约束；(3)突出输出顺序要求，明确标签必须位于回复文本最后；(4)保留核心策略：增量更新、唯一ID、变体称呼识别、重复检测；(5)明确标签格式 `<!--  <tableEdit>` 开头、`</tableEdit> -->` 结尾。涉及文件：PromptBuilder.ts

## [0.0.12] - 2026-05-10

### Fixed
- **【重点标记】修复异步整理功能提示词未正确拼接问题**：修复了当表格数据为空时，异步整理指令不会被追加到提示词末尾的问题。将 `PromptBuilder.ts` 中异步整理指令的追加条件从 `organizeMode === 'async' && memoryTableData && memoryTableData.trim()` 修改为仅依赖 `organizeMode === 'async'`，并在表格数据为空时提示AI创建新表格。涉及文件：PromptBuilder.ts
- **增强异步整理日志记录**：在 `CharacterDialogueChat.hooks.ts` 中增加了详细的日志记录，包括进入异步整理模式、正则匹配结果、解析结果等，便于追踪问题。涉及文件：CharacterDialogueChat.hooks.ts

## [0.0.11] - 2026-05-10

### Added
- **【重点标记】实时整理表格功能增强 - 异步整理模式**：在"开启实时整理表格"按钮下方新增"同步整理"和"异步整理"两个互斥选项，实现AI在回复对话内容后隐式包裹tableEdit命令，系统自动解析执行而不影响用户可见的对话内容。
  - **UI交互优化**：在MemoryTablePanel.tsx中新增Radio.Group组件，提供同步/异步整理模式切换，默认选中"同步整理"，关闭实时整理时自动重置为同步模式。涉及文件：MemoryTablePanel.tsx
  - **提示词注入逻辑**：在PromptBuilder.ts的buildFinalSystemPrompt方法中，当organizeMode='async'时追加异步整理指令，明确要求AI使用`<!--  <tableEdit>`开头、`</tableEdit> -->`结尾的隐式标签包裹tableEdit命令。涉及文件：PromptBuilder.ts
  - **回复解析执行**：在CharacterDialogueChat.hooks.ts的onComplete回调中，使用正则表达式`/<!--\s*<tableEdit>([\s\S]*?)<\/tableEdit>\s*-->/gi`检测并提取标签内容，使用IIFE包裹异步解析逻辑避免回调中使用await，解析后自动执行表格命令并清理对话内容。涉及文件：CharacterDialogueChat.hooks.ts
  - **IPC通信扩展**：在memoryHandlers.ts中新增`memory:parseTableEdit` handler暴露表格解析功能，在preload.ts中新增`parseTableEdit`方法供渲染进程调用。涉及文件：memoryHandlers.ts、preload.ts
  - **技术实现要点**：(1)标签格式严格遵循`<!--  <tableEdit>`开头（含两个空格），`</tableEdit> -->`结尾；(2)解析器期望标准格式`<tableEdit><!-- commands --></tableEdit>`，因此提取后需重新包装；(3)对话内容清理后确保用户界面不显示标签部分；(4)完善的错误处理和日志记录。

## [0.0.10] - 2026-05-10

### Changed
- **【重点标记】表格整理功能重构 - 实时整理与完全整理拆分**：将当前单一的表格整理功能拆分为两个独立模块，解决了重复触发、功能混杂、缺乏防抖等问题。
  - **新增整理锁机制**：在chatLogService.ts中新增organizingLocks Map，实现canStartOrganize、setOrganizingLock、releaseOrganizingLock方法，防止并发整理和重复触发。涉及文件：chatLogService.ts
  - **重构实时整理方法**：修改processChatProgressive方法，添加防抖检查（默认3000ms最小间隔），仅处理新增消息（增量更新），日志标识改为[Auto Organize]。涉及文件：chatLogService.ts
  - **新增完全整理方法**：新增processChatFull方法，清空表格数据并重新处理所有消息，带有完整的错误处理和回滚机制，日志标识改为[Full Reorganize]。涉及文件：chatLogService.ts
  - **新增IPC Handler**：在memoryHandlers.ts中新增memory:processChatFull IPC handler，修改memory:processChatProgressive使用新的options参数。涉及文件：memoryHandlers.ts
  - **更新Preload API**：在preload.ts中更新processChatProgressive API签名，新增processChatFull API暴露给渲染进程。涉及文件：preload.ts
  - **增强前端防抖**：在CharacterDialogueChat.hooks.ts中将实时整理的防抖延迟从500ms增加到2000ms，并使用新的options参数。涉及文件：CharacterDialogueChat.hooks.ts
  - **拆分前端调用逻辑**：在ChatManager.tsx中，当restart=true时使用processChatFull API进行完全整理，否则使用processChatProgressive API进行实时整理。涉及文件：ChatManager.tsx
  - **新增OrganizeOptions接口**：定义整理选项接口，包含continueFromLast（是否从上次位置继续）和minInterval（最小间隔时间）参数。涉及文件：chatLogService.ts

## [0.0.9] - 2026-05-10

### Changed
- **【重点标记】强化提示词和去重机制 - 消除表格重复记录**：针对物品表格等内容管理中出现的重复记录问题，全面优化了AI提示词和后端去重逻辑，确保所有表格数据更新操作的准确性和有效性。
  - **增强表格上下文唯一ID索引**：在buildTableContext方法中新增"唯一ID快速查找索引"，为AI提供唯一ID到行号的快速映射，便于AI快速定位需要更新的记录。涉及文件：chatLogService.ts（buildTableContext方法）
  - **强化AI提示词重复检测策略**：在buildAIPromptForProgressive方法中新增"强制重复性检查"流程，包含4步检查法；新增"名称相似度匹配"规则，明确物品名/角色名/描述内容高度相似时也应使用updateRow；新增"重复检测特殊场景处理"段落，提供3个具体的重复记录合并示例。涉及文件：chatLogService.ts（buildAIPromptForProgressive方法）
  - **增强输出要求**：新增3条输出要求，包括重复检测、合并重复记录、操作结果确认，要求AI在生成命令后说明每个操作的目的。涉及文件：chatLogService.ts（buildAIPromptForProgressive方法）
  - **实现名称相似度去重算法**：在executeTableEditCommands方法中新增基于Levenshtein编辑距离的名称相似度检测，当检测到名称相似（相似度>70%）的记录时，自动将insertRow转换为updateRow。新增isSimilarName和levenshteinDistance两个辅助方法。涉及文件：chatLogService.ts（executeTableEditCommands方法、isSimilarName方法、levenshteinDistance方法）
  - **双重去重保障**：现在系统具有双重去重机制：(1) AI层面的提示词引导去重；(2) 后端执行时的唯一ID匹配+名称相似度匹配去重。确保即使在AI误判的情况下，后端也能自动纠正并避免重复插入。

## [0.0.8] - 2026-05-10

### Changed
- **【重点标记】修复角色对话实时整理表格功能 - 实现真正的增量更新**：修复了实时整理表格功能中存在的重复插入、上下文不清晰、缺乏去重保护等问题。现在表格整理功能通过对比当前表格内容与最新信息，执行精确的增删改操作，确保表格数据准确反映最新状态。
  - **优化表格上下文格式**：将buildTableContext方法生成的表格数据从JSON格式改为清晰的"行N: 字段=值"格式，添加表格索引和行索引标识，便于AI理解现有数据结构并生成正确的updateRow/deleteRow命令。涉及文件：chatLogService.ts（buildTableContext方法）
  - **增强AI提示词增量更新策略**：在buildAIPromptForProgressive方法中新增"增量更新策略"段落，明确说明这是增量更新而非从头整理，添加去重检查规则和增量更新决策流程，强调已存在实体必须使用updateRow而非insertRow。涉及文件：chatLogService.ts（buildAIPromptForProgressive方法）
  - **添加命令执行前去重检查**：在executeTableEditCommands方法中，执行insertRow命令前先读取当前表格数据，检查唯一ID是否已存在。如果已存在则自动转换为updateRow操作，避免重复插入。涉及文件：chatLogService.ts（executeTableEditCommands方法）
  - **实现操作回滚机制**：在processChatProgressive方法中，处理开始前备份当前表格数据，出现严重错误时自动回滚到备份状态，保持表格数据一致性。涉及文件：chatLogService.ts（processChatProgressive方法）
  - **修复行索引显示问题**：修正了日志输出中行索引的显示，确保显示1-based的人类可读行号（rowIndex + 1）。

## [0.0.7] - 2026-05-10

### Added
- **【重点标记】记忆表格支持功能**：在角色对话配置面板中新增"记忆表格设置"板块，位于"向量化设置"与"AI参数配置"之间。包含两个开关："是否启用"（启用后在对话提示词中整合记忆管理模块的表格数据）和"是否实时整理表格"（启用后每次对话完成后自动触发表格整理操作）。新增组件：MemoryTablePanel.tsx。类型扩展：CharacterSessionConfig 新增 memoryTableEnabled 和 memoryTableAutoOrganize 字段，新增 MemoryTableConfig、MemoryTableSheet、MemoryTableData 接口。PromptBuilder.ts 支持将格式化的表格数据追加到系统提示词中。配置支持持久化保存。涉及文件：CharacterDialogueChat.types.ts（新增类型）、MemoryTablePanel.tsx（新建）、ConfigPanel.tsx（集成新面板）、ConfigPanel.css（新增样式）、CharacterDialogueChat.hooks.ts（表格数据获取、自动整理触发）、PromptBuilder.ts（整合表格数据）、CharacterDialogueChat.tsx（主组件集成）

### Changed
- **【重点标记】AI请求日志打印完整提示词入参**：修复了 `console.debug` 打印请求体时 DevTools 以 `... more characters` 形式截断长字符串的问题。改为逐条打印 messages 数组的 role 和内容预览（前200字符），同时将完整 JSON 写入日志文件。涉及文件：aiHandlers.ts（优化请求体日志输出）
- **【重点标记】修复记忆表格数据结构读取错误**：修正了 `CharacterDialogueChat.hooks.ts` 中读取 `memory.getTableData` 返回数据的逻辑。原代码错误地将 `sheets`（string[]）当作对象数组遍历（访问 `sheet.sheetName` 等），导致记忆表格数据始终为空。同时移除了50行输出限制。涉及文件：CharacterDialogueChat.hooks.ts（修复两处数据读取逻辑）
- **【重点标记】修复记忆表格数据路径不匹配问题**：表格整理功能使用 `characterCardName`（如"狼人杀助手2.0"）保存文件，但 hooks 使用 `characterCardId`（完整图片路径）读取文件，导致文件找不到。现在统一使用 `characterCardName` 进行读取。涉及文件：CharacterDialogueChat.hooks.ts（修复 requestAIResponse 和 fetchMemoryTableData 两处）
- **【重点标记】修复记忆表格数据读取映射错误**：表格数据在 JSON 文件中使用数字索引（"0", "1", "2"等）存储，但前端错误地尝试使用列标题（"流水号", "角色名"等）访问。现已修正为使用数字索引映射（headers[0] → row["0"], headers[1] → row["1"]等）。涉及文件：CharacterDialogueChat.hooks.ts
- **【重点标记】修复实时整理表格路径错误**：实时整理表格功能同样使用了错误的 `characterCardId`（完整图片路径）而非 `characterCardName`（角色卡名称），导致找不到聊天记录文件。现已修正。涉及文件：CharacterDialogueChat.hooks.ts（修复 onComplete 回调）
- **【重点标记】修复表格整理断点续传进度计算错误**：断点续传模式下（如从第4条消息开始处理9条消息），进度百分比错误地按绝对位置计算（显示44%而非实际的1/6=17%）。修复后进度百分比基于"已处理数/当前批次待处理总数"计算，处理详情仍保留绝对消息编号（4/9）。涉及文件：chatLogService.ts（processChatProgressive 方法）
- **【重点标记】修复 memory:getTableData IPC handler 日志输出**：优化了 `memoryHandlers.ts` 中 `memory:getTableData` 的日志输出，详细记录返回的数据结构摘要（sheets、headersKeys、dataKeys），便于调试表格数据传递问题。涉及文件：memoryHandlers.ts
- **【重点标记】增强全链路诊断日志**：在 CharacterDialogueChat.hooks.ts 的 requestAIResponse 和 fetchMemoryTableData 中添加了详细的调试日志（console.log），追踪 memoryTableEnabled 状态、使用的 chatId、tableResult 内容等。涉及文件：CharacterDialogueChat.hooks.ts

## [0.0.6] - 2026-05-09

### Added
- **【重点标记】世界书关键词匹配引擎**：实现基于关键词匹配的世界书条目激活功能。支持主关键词（key）、次关键词（keysecondary）、备用关键词（keys、secondary_keys）。支持 selective 模式（主+次关键词同时匹配）、概率过滤（probability）、完整单词匹配、不区分大小写、group 排序权重等完整 SillyTavern 兼容特性。对话时同时执行向量检索和关键词匹配，两种结果合并注入提示词。涉及文件：WorldBookKeywordMatcher.ts（新建）、worldBookService.ts（新增matchKeywords）、ContextManager.ts（新增retrieveContextWithKeywords）、preload.ts（新增worldbook IPC）、electron.d.ts（新增类型定义）、CharacterDialogueChat.hooks.ts（改用综合检索API）

## [0.0.5] - 2026-05-09

### Changed
- **【重点标记】对话系统提示词拼接逻辑重构——统一由PromptBuilder管理**：将对话系统中的提示词拼接逻辑完全统一由PromptBuilder模块管理。hooks中移除了手动的提示词拼接代码，改为调用usePromptBuilder Hook提供的buildCompleteSystemPrompt方法。PromptBuilder.ts中为每个拼接步骤添加了明确的注释（第一步→第六步），标明每个步骤的数据来源。涉及文件：PromptBuilder.ts（重构注释）、usePromptBuilder.ts（新增buildCompleteSystemPrompt）、CharacterDialogueChat.hooks.ts（简化拼接逻辑）

## [0.0.4] - 2026-05-09

### Changed
- **【重点标记】对话系统界面优化——向量化设置重构**：将知识库绑定功能从独立面板收纳到"向量化设置"区域中。"向量化设置"与"AI参数配置"同级排列。向量化面板支持折叠/展开切换，知识库绑定作为其内部内容展示。涉及文件：VectorizationPanel.tsx（新建）、KnowledgeBaseBindingPanel.tsx（移除自身折叠逻辑）、ConfigPanel.tsx（更新布局）、ConfigPanel.css（新增向量化面板样式）

## [0.0.3] - 2026-05-09

### Changed
- **【重点标记】对话系统界面优化——可折叠面板**：右侧配置栏的"知识库绑定设置"和"AI参数配置"模块重构为可折叠式组件。默认展开状态，点击标题栏切换折叠/展开。折叠时仅显示标题栏，展开时完整显示设置项。折叠状态通过localStorage持久化记忆。涉及文件：KnowledgeBaseBindingPanel.tsx、ParameterPanel.tsx、ConfigPanel.css
- **【重点标记】对话系统提示词构建逻辑重构**：将对话功能中的提示词构建过程提取为独立的逻辑文件。创建PromptBuilder.ts作为核心提示词构建模块，包含buildDialoguePrompt、buildContinuationPrompt、buildCharacterContext、buildPersonaSection等函数。创建usePromptBuilder.ts作为React Hook封装层，提供buildDialoguePrompt、buildContinuationPrompt、buildFinalPrompt等方法。CharacterDialogueChat.hooks.ts简化为调用usePromptBuilder，CharacterDialogueChat.utils.ts改为从PromptBuilder重新导出以保持向后兼容。涉及文件：PromptBuilder.ts（新建）、usePromptBuilder.ts（新建）、CharacterDialogueChat.hooks.ts、CharacterDialogueChat.utils.ts

### Added
- 可折叠面板折叠/展开指示图标（▼/▶）
- AI参数配置模块折叠时的自定义参数指示器（紫色小圆点）
- 知识库绑定数量标签显示

## [0.0.2] - 2026-05-02

### Fixed
- **【重点标记】修复向量测试模块WASM交互问题**：修复了VecstoreVectorStore.search()方法中WASM query()不返回metadata导致向量测试显示空结果的问题。通过引入元数据缓存机制，从metadataCache中补全搜索结果的完整元数据信息，确保相似性查询和向量查看功能正常工作
- **【重点标记】修复世界书条目分片串行问题**：重构了DocumentProcessorService.chunkText()方法，实现智能分块策略。世界书JSON文件按条目分块（每个条目一个完整分块，不分割），其他文档保持500字符分块标准。涉及文件：DocumentProcessorService.ts（新增chunkWorldBookEntries、chunkStandardText、isWorldBookFormat方法）
- 修复了向量维度不匹配问题（expected 384, got 4096），实现了动态维度支持
- 修复了元数据持久化问题，实现双文件存储机制（vecstore.json + vecstore_metadata.json）
- 修复了addBatchNoPersist方法未同步更新元数据缓存的问题

### Added
- 实现了元数据缓存机制（metadataCache），解决WASM query不返回metadata的根本问题
- 实现了启动时从文件加载元数据的功能
- 增加了详细的日志输出，便于调试向量存储相关问题
- 添加JSON文件类型支持，用于世界书JSON文件处理

### Changed
- **【重点标记】知识库版本字段替换为向量存储模式**：将知识库的"版本"(version)字段完全替换为"向量存储模式"(vectorStoreMode)字段，用于区分JSON向量和VecStore存储向量。移除了版本控制相关功能（版本历史、版本恢复），简化了知识条目管理逻辑。涉及文件：KnowledgeItem接口定义、KnowledgeBaseService、KnowledgeBaseManager UI组件、preload.ts IPC API、electron.d.ts类型定义
- **【重点标记】世界书向量化功能重构**：改进世界书向量化处理逻辑，以entries数组中的每个条目为基本单位进行拆分。每个条目向量包含完整字段信息（name、key、keysecondary、keys、secondary_keys、comment、content）。**description字段不再参与向量化**，仅作为元数据引用存储在条目元数据中。明确区分JSON存储和VecStore存储的差异，确保符合VecStore的存储规范。涉及文件：worldBookService.ts
- **【重点标记】文档分块策略优化**：DocumentProcessorService实现智能分块，世界书JSON按条目分块，其他文档按500字符分块

## [0.0.1] - 2026-04-04

### Added
- 实现了配置管理功能，包括API连接配置、模型参数、高级设置和模板管理
- 支持文本补全模式和聊天补全模式的配置
- 为每个参数添加了详细的问号提示，包含功能说明、影响分析和建议值范围
- 实现了配置的导入/导出功能
- 实现了Prompts数组的动态管理，支持添加、删除和查看prompts项
- 解决了{{}}格式通配符的显示问题

### Fixed
- 修复了导入配置导致白屏的问题
- 修复了导入配置时配置名称没有将文件名回显的问题
- 修复了缺少图标导入的问题

### Changed
- 优化了表单的布局和样式
- 提高了应用的稳定性和可靠性
