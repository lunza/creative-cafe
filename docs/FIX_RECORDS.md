# Creative Café 修复记录与重点问题日志

> **来源**：从 CODE_WIKI.md §14 拆分而来（2026-07-31 文档结构整理）
> **定位**：本文件集中沉淀项目演进过程中出现的 Bug 修复、Spec 实现记录与重点问题排查历程。
> **与 CHANGELOG.md 的区别**：CHANGELOG.md 记录版本级发布日志；本文件按 Spec/Task 粒度记录技术细节与根因分析，供后续排查同类问题参考。
> **架构性描述**：仍在 CODE_WIKI.md 对应章节中维护；本文件中如涉及新增模块的架构说明，仅为变更时增量记录，最新架构以 CODE_WIKI.md 为准。

---

## 14. 已知重点问题与修复记录

> 以下为技术文档中标记的重点问题，开发时需特别注意。

### 14.1 ⭐ 角色卡对话异步整理表格自动创建（三轮迭代修复）

- **症状**：异步整理模式下 tableEdit 命令执行失败，"表格文件不存在"
- **根因**：`executeTableEditCommands` 缺少文件存在性检查；`autoInitializeChatSession` 仅检查关联记录不验证实际文件；副本模板被删除但关联记录残留
- **修复**：新增 `resolveAvailableTemplate` 统一模板回退逻辑（关联副本 → 原始模板 → 任意可用），增加文件创建二次验证
- **文件**：`src/main/services/memory/chatLogService.ts`

### 14.2 ⭐ AI 响应 HTML 注释嵌套解析

- **症状**：AI 在 tableEdit JSON 值中嵌入 `<!-- -->` 导致解析器失效
- **根因**：非贪婪正则截断外层注释
- **修复**：重写 `parseCommands` 按行匹配命令，`parseDataObject` 解析前清理嵌套注释
- **文件**：`src/main/services/memory/tableEditParser.ts`

### 14.3 ⭐⭐ 写作大纲数据结构重构

- **变更**：移除 `WritingProject.chapters`，统一使用 `project.outline.chapters` 作为唯一章节数据源
- **影响**：类型定义、主进程服务、渲染进程组件/hooks、服务层全部适配
- **标记**：重大架构变更，消除双重存储同步风险

### 14.4 ⭐⭐ 世界书编辑器组件替换（Milkdown → TextEditor）

- **原因**：Milkdown 自带主题与系统 CSS 变量体系不统一，WYSIWYG 模式不匹配纯文本/Markdown 需求
- **方案**：新建 `Common/TextEditor/`（基于 textarea + Ant Design token），替换 3 处 MarkdownEditor 引用
- **标记**：重大架构改进

### 14.5 思考标签过滤

- **需求**：过滤模型输出的 `think` / `thinking` / `thought` 思考标签包裹的推理过程内容，避免用户看到内部思考
- **实现**：`messageProcessor.ts` 新增 `stripThinkingTags`，处理自闭合 / 完整标签对 / 未闭合标签（流式场景）三种变体，清理多余空行，集成到 `processMessage` 与 `preprocessForMarkdown`
- **测试**：20 个单元测试 + 4 个渲染层测试，67 个测试全部通过
- **文件**：`src/renderer/components/Character/CharacterDialogueChat/utils/messageProcessor.ts`

### 14.6 写作模式自定义模板管理（2026-07-06 新增）

- **能力**：自定义小说类型与写作风格模板，支持从零创建、基于预置模板复制、编辑、删除
- **数据模型**：`CustomNovelTypeTemplate`、`CustomWritingStyleTemplate`（`shared/types/writing.types.ts`），`WritingParameters` 新增 `customNovelTypeId` / `customWritingStyleId`
- **兼容策略**：保留预置枚举（12 种小说类型 / 7 种写作风格），自定义模板 ID 用 `custom_` 前缀，`PromptBuilder` 优先自定义回退预置
- **存储**：`data/writing-templates/{novel-types,writing-styles}/{id}.json`，安全写入（先写 `.tmp` 再 rename）
- **IPC**：`writing:template:novelType:*` / `writing:template:writingStyle:*`（list/get/save/delete），预置模板只读
- **UI**：`WritingTemplateManager` 弹窗，两个 Tab，预置模板仅可复制，自定义可编辑删除

### 14.7 自动修正反馈增强

- **能力**：`PlotCheckerService.autoFixIssue` 返回 `AutoFixResult`（含 `diffs` 差异列表），`AutoFixResultModal` 展示修正前后对比，支持接受/拒绝/取消
- **文件**：`PlotCheckerService.ts`、`AutoFixResultModal.tsx`、`ContentWorkspace.tsx`

### 14.8 写作模式素材选择功能

- **能力**：写作辅助面板支持从系统全部素材中选择（世界书/角色卡/用户人设/知识库四类），300ms 防抖搜索，已选高亮
- **文件**：`useWritingMaterials.ts`、`MaterialList.tsx`、`WritingModeRightPanel.tsx`

### 14.9 辅助模式推荐选项渲染与交互（Spec: add-assist-mode-options）

- **能力**：AI 消息渲染推荐选项（`suggestedOptions`），用户点击后选项文本填入输入框（复用 `generatedReplyText` 机制）
- **渲染条件**：仅 AI 消息（`!isUser`）、非流式（`!isStreaming`）、`message.suggestedOptions` 非空时渲染
- **交互**：`ChatMessageBubble` 新增 `onSelectOption` prop；`CharacterDialogueChat` 新增 `handleSelectOption` 回调，调用 `setGeneratedReplyText` 填入输入框
- **文件**：`ChatMessageBubble.tsx`、`CharacterDialogueChat.tsx`

### 14.10 角色卡表情管理系统后端（Spec: add-character-expression-system / Task 1，2026-07-26 新增，增量进行中）

- **能力**：为每个角色卡独立维护表情包（manifest.json + 多个情绪 PNG），供后续 AI 回复按情绪动态切换头像。本节记录 Task 1 已落地的后端层；UI / 解析 / 预加载等将在后续 Task 完成
- **存储路径**：`{userData}/data/character-expressions/{sanitizeCardId(characterCardId)}/`
  - `sanitizeCardId` 取 `sha256(characterCardId)` 前 16 个十六进制字符：保证同一 characterCardId（角色卡文件路径字符串，可能含路径分隔符/空格/中文）始终映射到同一目录，且文件系统安全
- **manifest 结构**：`{ characterCardId, version: 1, expressions: Record<emotionKey, { type: 'preset'|'custom', image: '{emotionKey}.png' }>, customEmotions: Array<{ key, label }> }`
- **服务**：`ExpressionService`（单例 `expressionService`）提供 `listExpressions / saveImage / deleteImage / addCustomEmotion / removeCustomEmotion / getImagePath`；镜像 `avatarService` 风格（`fs/promises` + `fsSync` + `[ExpressionService]` 日志前缀）；自定义情绪 key 校验 `^[a-z][a-z0-9_]*$`
- **IPC 通道**：`expression:list` / `expression:saveImage` / `expression:deleteImage` / `expression:addCustomEmotion` / `expression:removeCustomEmotion` / `expression:getImagePath`，注册入口 `registerExpressionHandlers()`（在 `ipc/index.ts` 的 `setupIpcHandlers()` 中调用），每个 handler try/catch 返回 `{ success: false, error }`
- **Preload 暴露**：`electronAPI.expression.{list, saveImage, deleteImage, addCustomEmotion, removeCustomEmotion, getImagePath}`，类型声明见 `src/renderer/types/electron.d.ts`
- **图像返回**：`saveImage` / `getImagePath` 返回绝对路径，便于渲染进程 `<img src={absolutePath}>` 直接加载本地文件
- **文件**：`src/main/services/expressionService.ts`（新建）、`src/main/ipc/handlers/expressionHandlers.ts`（新建）、`src/main/ipc/index.ts`（注册）、`src/main/preload.ts`（暴露）、`src/renderer/types/electron.d.ts`（类型）

### 14.11 表情图片裁剪弹窗 ImageCropperModal（Spec: add-character-expression-system / Task 5，2026-07-26 新增，增量进行中）

- **能力**：基于 `react-easy-crop`（v6.2.3，自带 TypeScript 类型）实现的方形裁剪弹窗，供 `ExpressionManagerModal`（Task 7，未实现）调用。用户从全身图/大图中精确截取面部表情区域，输出 PNG data URL，长边超过 512px 时按比例压缩，符合 Spec「图像格式统一与压缩」要求
- **Props**：`{ open: boolean; imageSrc: string | null; onConfirm: (croppedDataUrl: string) => void; onCancel: () => void }`；`imageSrc` 为 null 时弹窗体显示「图片加载中...」占位
- **裁剪交互**：
  - `<Cropper>` 组件，`aspect=1`（方形）、`showGrid` + `zoomWithScroll` 开启（滚轮缩放为内置行为，无需额外 wheel 监听）
  - `crop` 状态 `{ x, y }` 控制平移，`zoom` 状态（0.5~5，默认 1）控制缩放
  - antd `Slider` 滑块绑定 `zoom`，与 Cropper 双向同步（`onZoomChange`）
  - `onCropComplete(croppedArea, croppedAreaPixels)` 仅缓存 `croppedAreaPixels`（像素坐标）供确认时使用
- **裁剪输出 `getCroppedImg(imageSrc, pixelCrop)`**：异步函数，复用 `CharacterEditModal.convertToPng` 的 `new Image()` + `onload` Promise 模式；按 `pixelCrop` 子区域 `drawImage` 到目标 canvas；长边 > 512px 时按 `MAX_LONG_SIDE / longSide` 系数等比缩放，一次 drawImage 到目标尺寸（避免二次重绘）；返回 `canvas.toDataURL('image/png')`
- **圆形预览**：64×64 圆形预览，用 CSS `background-image` + `background-size` + `background-position` 同步渲染（基于 `croppedAreaPixels` + `onMediaLoaded` 返回的 `naturalWidth/Height` 计算），无 canvas 异步开销
- **状态重置**：`useEffect` 监听 `open` 与 `imageSrc`，弹窗打开或图片切换时重置 `crop={0,0}` / `zoom=1` / `croppedAreaPixels=null` / `mediaSize=null`，避免上次裁剪位置残留
- **异常容错**：`handleConfirm` try/catch 包裹；失败时 `message.error('裁剪失败')` 且不关闭弹窗（用户可重试或取消）；`finally` 关闭 loading
- **UI 风格**：antd Modal 暗色主题，width=640，自包含 inline styles（参照 `ChatMessageBubble.tsx` 模式，未引入额外 CSS 文件）；使用项目 CSS 变量（`--primary-color` / `--config-panel-label-color` / `--config-panel-sub-text-color` / `--chat-bubble-assistant-bg`）；Cropper 容器固定 400px 高 + `#0f0f1a` 暗色背景便于透明 PNG 可见；确认按钮使用 `linear-gradient(135deg, #6366f1, #8b5cf6)` 与 ChatHeader 风格一致
- **TypeScript 注意**：`react-easy-crop` v6 的 `CropperProps` 类型将 `style` / `classes` 标记为必填（虽然 `defaultProps` 提供空对象，但 TS 5.x 不再对 class defaultProps 应用 `LibraryManagedAttributes`），因此 JSX 中显式传 `style={{ containerStyle: {...} }}` 和 `classes={{}}`
- **类型导入**：`import Cropper from 'react-easy-crop';`（默认导出）+ `import type { Area } from 'react-easy-crop';`（命名类型导出）；`Area = { width, height, x, y }`
- **文件**：`src/renderer/components/Character/CharacterDialogueChat/ImageCropperModal.tsx`（新建，~270 行）
- **tsc 验证**：`npx tsc --noEmit` 通过，ImageCropperModal.tsx 无新增 TypeScript 错误（仓库唯一 tsc 错误为 `vite.config.ts:65` 的 `WatchOptions.include` 类型问题，与本组件无关，属预存问题）

### 14.12 表情管理弹窗 ExpressionManagerModal + Zustand store（Spec: add-character-expression-system / Task 6 + Task 7，2026-07-26 新增）

#### 14.12.1 expressionStore（`src/renderer/stores/expressionStore.ts`）

- **能力**：渲染进程侧的表情状态管理 Zustand store（`useExpressionStore`），作为 IPC 适配层与运行期缓存，封装所有 `window.electronAPI.expression.*` 调用，对组件暴露同步/异步 actions
- **状态字段**：
  - `currentCharacterCardId: string | null` —— 当前加载的角色卡 ID（切换角色卡时被覆盖，用于校验缓存归属）
  - `manifest: ExpressionManifest | null` —— 当前 manifest（含预置/自定义情绪映射）
  - `imageCache: Record<string, string>` —— emotionKey → **data URL**（仅含已上传表情）。【重点标记 - CSP 兼容】只存 data URL 不存磁盘绝对路径，否则 `<img src>` 会被 CSP `img-src 'self' data: blob:` 拦截导致裂图
  - `loading: boolean` / `error: string | null`
- **Actions**：
  - `loadExpressions(characterCardId)` —— 拉取 manifest + 逐个 `getImagePath` 拿磁盘绝对路径 → `file.readAsBase64` 转 data URL 存入 imageCache + `new Image()` 预热浏览器图像缓存（fire-and-forget）
  - `saveExpression(characterCardId, emotionKey, imageDataUrl, isCustom, label?)` —— 调用 `saveImage` IPC，成功后**直接复用入参 `imageDataUrl`**（本身就是 data URL）存入 imageCache 并预热新图；仅当入参不是 data URL 时才回退读盘
  - `deleteExpression(characterCardId, emotionKey)` —— 调用 `deleteImage` IPC，同步从 manifest.expressions 与 imageCache 移除
  - `addCustomEmotion(characterCardId, key, label)` —— 调用 `addCustomEmotion` IPC，同步追加到本地 manifest.customEmotions（幂等）
  - `removeCustomEmotion(characterCardId, key)` —— 调用 `removeCustomEmotion` IPC，同步移除 customEmotions + expressions + imageCache
  - `resolveExpressionImage(emotionKey)` —— null/undefined/空串/`'default'` 直接返回 null（回退默认头像）；其他 key 从 imageCache 查找 data URL
  - `getAvailableEmotionKeys()` —— 合并 `EMOTION_PRESETS` 全部 key + manifest 的 customEmotions key（去重保序，预置优先）
  - `clear()` —— 重置所有状态
- **设计要点**：
  - **不持久化到 localStorage**：表情数据由主进程 expressionService 持久化到磁盘，store 仅作为运行期缓存，每次进入对话重新拉取
  - **永不抛异常**：所有 actions 包裹 try/catch，统一通过返回值 `{ success, error? }` 传递错误
  - **引用更新**：`manifest` / `imageCache` 在 set 时均通过浅拷贝构造新引用，确保 React 通过引用相等感知变更
- **【重点标记】关于 `getImagePath` 的返回签名**：任务文档描述为 `Promise<string | null>`，但 `src/renderer/types/electron.d.ts` 第 453 行与 `src/main/ipc/handlers/expressionHandlers.ts` 第 143 行的实际实现均为 `Promise<{ success: boolean; imagePath: string | null; error?: string }>`。本 store 以实际实现为准（取 `.imagePath`），不以任务文档为准
- **【重点标记 - CSP 裂图 BUG 修复（2026-07-27）】** 早期实现将 `getImagePath` / `saveImage` 返回的磁盘绝对路径直接存入 `imageCache` 并用于 `<img src>`，但 `src/main/index.ts` 的 CSP 限制 `img-src 'self' data: blob:`，本地文件路径被浏览器拦截导致「裂开图片」图标。修复方案：imageCache 中**只存 data URL**——`loadExpressions` 在拿到绝对路径后再调 `window.electronAPI.file.readAsBase64(path)` 转 data URL（与 `useCharacterSwitch.ts` 加载头像方式一致）；`saveExpression` 直接复用入参 `imageDataUrl`（裁剪/SD 生成的输出本就是 data URL）。**核心教训**：Electron 渲染进程启用了 `webSecurity: true` + 严格 CSP 时，本地文件路径不能直接用于 `<img src>`，必须转为 data URL（或注册自定义 protocol）；后续涉及「在渲染进程展示主进程落盘的图片」场景应统一遵循 data URL 模式
- **文件**：`src/renderer/stores/expressionStore.ts`（新建，~500 行），类型导出 `ExpressionEntry` / `CustomEmotion` / `ExpressionManifest` / `ExpressionState`

#### 14.12.2 ExpressionManagerModal（`src/renderer/components/Character/CharacterDialogueChat/ExpressionManagerModal.tsx`）

- **能力**：表情管理弹窗组件（Task 7），渲染 30 个预置情绪 + 用户自定义情绪的网格，每个格子展示当前表情缩略图（或「未上传」占位 + 默认头像小图）+ 上传/删除/预览按钮；提供「添加自定义情绪」表单
- **Props**：`{ open: boolean; characterCardId: string; characterName: string; avatarPath?: string; onClose: () => void }`
- **数据来源**：`useExpressionStore`（Zustand）。保存/删除后 store 同步更新本地 manifest 与 imageCache，UI 通过引用变化自动重渲染，无需显式 reload
- **打开时加载**：`useEffect` 监听 `open + characterCardId`，弹窗打开时调用 `loadExpressions(characterCardId)` 加载该角色卡表情包
- **上传流程**：点击上传 → 隐藏 `<input type="file" accept="image/*">` → FileReader 读取为 data URL → 打开 `ImageCropperModal` → 裁剪确认 → 调用 `expressionStore.saveExpression(characterCardId, emotionKey, croppedDataUrl, isCustom, label?)` → 网格自动刷新（store 引用变化）
  - **file input 复用技巧**：`fileInputRef.current.value` 必须在每次点击前重置，否则用户连续选择同一文件不触发 `change` 事件
  - **上传目标上下文**：组件维护 `cropperTargetKey` / `cropperIsCustom` / `cropperLabel` 状态，记录当前正在上传的情绪键信息，传递给裁剪弹窗的 `onConfirm` 回调
- **删除流程**：`Modal.confirm` 二次确认 → `expressionStore.deleteExpression(characterCardId, emotionKey)`；预置情绪仅删除图像（回退默认），自定义情绪需通过单独的「移除类别」入口调用 `removeCustomEmotion`（删除图像 + manifest 条目）
- **添加自定义情绪表单**：弹出二级 `Modal`，输入英文键（前端校验 `^[a-z][a-z0-9_]*$` + 不与预置重复）+ 中文标签 → 调用 `expressionStore.addCustomEmotion(characterCardId, key, label)`
- **错误展示策略【重点标记】**：`store.error` 仅以 inline 横幅展示，避免 toast 重复弹出；具体操作的失败（save/delete/add/remove）由对应 handler 通过 `message.error` 反馈
- **UI 风格**：暗色主题 + inline styles + 项目 CSS 变量，参照 `CharacterEditModal` / `ChatMessageBubble` / `ImageCropperModal` 一致
- **文件**：`src/renderer/components/Character/CharacterDialogueChat/ExpressionManagerModal.tsx`（新建，~764 行）

#### 14.12.3 AI 生成表情入口（Spec: add-ai-expression-generation / Task 5，2026-07-27 新增）

- **背景**：原 `ExpressionManagerModal` 仅支持手动上传表情图（file input → ImageCropperModal → saveExpression）。Task 5 在不破坏现有流程的前提下，新增 AI 生成（基于 SD WebUI img2img）的两个入口，调用 Task 4 创建的 `ExpressionGenerateModal` 组件
- **新增 imports**：`ThunderboltOutlined` / `RobotOutlined`（@ant-design/icons）、`ExpressionGenerateModal`（`./ExpressionGenerateModal`，默认导出）
- **新增 state**：`generateModalOpen`（弹窗可见性）/ `generateMode`（`'batch' | 'single'`）/ `generateTargetKey?` / `generateTargetLabel?`（单张模式的情绪键与标签）
- **批量入口（顶部工具栏）**：在「添加自定义情绪」按钮右侧新增 `<Button type="primary" icon={<ThunderboltOutlined />}>AI 生成全部表情</Button>`，`disabled={!hasCharacter}`，`onClick={handleBatchGenerate}`
  - **覆盖确认【重点标记】**：`handleBatchGenerate` 检测 `manifest?.expressions` 是否非空，若已有任何表情图则弹出 `Modal.confirm` 二次确认（"覆盖现有表情？部分情绪已有表情图片，AI 生成将覆盖这些表情"），避免误覆盖用户已上传的图片
- **单张入口（情绪格子操作区）**：在每个非 default 情绪卡片的操作区（位于「上传」按钮与「删除」按钮之间）新增 `<Tooltip title="AI 生成"><Button type="text" size="small" icon={<RobotOutlined />} /></Tooltip>`
  - **stopPropagation**：按钮 `onClick` 调用 `e.stopPropagation()` 防止触发卡片父级 hover/leave 事件
  - **仅非 default**：default 卡片（角色卡头像）不展示 AI 生成按钮，因 default 不需要单独生成
- **handler**：`handleBatchGenerate(manifest)` 与 `handleSingleGenerate(emotionKey, label)`，均为 `useCallback` 包装；`handleSingleGenerate` 加入 `renderEmotionCard` 的 deps 数组
- **弹窗渲染**：在 `ImageCropperModal` 之后渲染 `<ExpressionGenerateModal>`，传入 `open` / `characterCardId` / `characterName` / `avatarPath` / `mode` / `targetEmotionKey` / `targetEmotionLabel` / `onClose` / `onGenerated`
  - **`onGenerated` 回调**：调用 `loadExpressions(characterCardId)` 刷新 expressionStore 的 manifest 与 imageCache，使新生成的图片立即展示在网格中
- **Props 接口约定**：`ExpressionGenerateModalProps { open, characterCardId, characterName, avatarPath?, mode: 'batch' | 'single', targetEmotionKey?, targetEmotionLabel?, onClose, onGenerated? }`（由 Task 4 实现，本任务仅消费）
- **未导入 `ExpressionGenerateModalProps` 类型**：项目 `tsconfig.json` 启用 `noUnusedLocals: true`，本组件未显式标注 props 类型（直接 inline 传递），故仅 import 默认导出，避免未使用类型导入触发 tsc 错误
- **兼容性**：不修改原有上传/删除/添加自定义情绪/移除类别任何流程；新增按钮独立挂载，互不影响

### 14.13 表情提示词构建与情绪标记解析（Spec: add-character-expression-system / Task 3 + Task 9 + Task 11，2026-07-26 新增）

#### 14.13.1 EMOTION_PRESETS 常量（PromptBuilder.ts）

- **能力**：30 项预置情绪清单，基于 GoEmotions 分类（27 项）+ default（默认）+ cheerfulness（快乐）；每项含唯一英文键（AI 输出用）与中文标签（UI 展示用）
- **不可删除**：预置类别不可删除，用户可在此基础上追加自定义情绪
- **导出形式**：`ReadonlyArray<{ key: string; label: string }>`
- **清单**：default/默认、admiration/钦佩、amusement/愉悦、anger/愤怒、annoyance/恼怒、approval/赞同、caring/关切、confusion/困惑、curiosity/好奇、desire/渴望、disappointment/失望、disapproval/不赞同、disgust/厌恶、embarrassment/尴尬、excitement/兴奋、fear/恐惧、gratitude/感激、grief/悲痛、joy/喜悦、love/喜爱、nervousness/紧张、neutral/中性、optimism/乐观、pride/自豪、realization/顿悟、relief/宽慰、remorse/懊悔、sadness/悲伤、surprise/惊讶、cheerfulness/快乐

#### 14.13.2 buildExpressionPrompt（PromptBuilder.ts）

- **能力**：构建表情显示模式系统提示词约束，要求 AI 在回复正文末尾以结构化格式输出当前情绪键名
- **签名**：`buildExpressionPrompt(charName: string = 'Character', availableEmotionKeys: string[] = []): string`
- **格式要求**：在正文之后另起一行，严格按 `<<<EXPRESSION>>>emotion_key<<<END_EXPRESSION>>>` 格式输出
- **约束**：`emotion_key` 必须来自 `availableEmotionKeys` 列表；情绪难以判断时使用 `neutral`
- **防御性兜底**：未传入 keys 时使用预置全部 key（保证 AI 输出的 key 可被解析）
- **与 suggestedOptions 互不冲突**：两者标记格式不同（`<<<EXPRESSION>>>` vs `<<<SUGGESTED_OPTIONS>>>`），可同时启用

#### 14.13.3 parseExpressionFromContent（PromptBuilder.ts）

- **能力**：从 AI 回复内容中多格式容错解析情绪标记，返回 `{ emotion: string | null, cleanedContent: string }`
- **多格式容错匹配**（参照 `parseSuggestedOptions` 模式）：
  1. 主格式：`<<<EXPRESSION>>>key<<<END_EXPRESSION>>>`（大小写不敏感）
  2. 容错：仅有开始标记 `<<<EXPRESSION>>>key` 到文本末尾
  3. 兼容变体：`<expression>key</expression>`（纯标签）
  4. 兼容变体：仅有 `<expression>key` 到末尾
- **行为**：解析成功返回小写 emotion 键名 + 剥离标记后的 cleanedContent；解析失败返回 `{ emotion: null, cleanedContent: content }`

#### 14.13.4 hooks.ts 注入与解析（`CharacterDialogueChat.hooks.ts`）

- **注入位置**：`requestAIResponse` 系统提示词拼接段（约 L920-933）；当 `characterConfig?.customParameters?.expression_display === true` 时，调用 `buildExpressionPrompt(charName, availableEmotionKeys)` 追加到 `effectiveSystemPrompt`
- **availableEmotionKeys 来源**：合并 `EMOTION_PRESETS` 全部 key + 当前角色卡 manifest 的 customEmotions key（通过 `expressionStore.getAvailableEmotionKeys()` 读取）；若 manifest 未加载则仅用预置 keys
- **解析位置**：AI 回复后处理段（约 L1155-1216 suggestedOptions 解析附近），当 `expression_display === true` 时调用 `parseExpressionFromContent(finalContent)`，得到 `emotion` 与 `cleanedContent`；将 `cleanedContent` 覆盖 `finalContent`（剥离标记），并将 `emotion` 写入最终 ChatMessage
- **emotionStripped 容差标志【重点标记】**：参照 `thinkTagsStripped` / `optionsStripped` 模式，设置 `emotionStripped` 标志纳入既有「内容保护检查」的容差跳过逻辑，避免剥离标记后触发内容保护误判导致 UI 卡死（`displayContent.length < existingContent.length` 时跳过保护检查）
- **日志记录**：`addLog` 标记解析结果（含未匹配回退警告）

#### 14.13.5 ChatMessageBubble 渲染（`ChatMessageBubble.tsx`，Spec Task 10）

- **新增 props**：`expressionImage?: string`（由父组件通过 `expressionStore.resolveExpressionImage(message.emotion)` 解析后的表情图像路径，未提供时回退 `avatarPath`）
- **渲染优先级**：`expressionImage` > `avatarPath` > 首字母占位
- **流式期间回退**：流式消息（`isStreaming`）期间使用默认头像，待流式完成后再切换为表情图像，避免闪烁
- **父组件透传**：`CharacterDialogueChat.tsx` 消息列表渲染处通过 `expressionStore.resolveExpressionImage(message.emotion)` 解析每条 assistant 消息的表情路径，传入 `ChatMessageBubble`

#### 14.13.6 ParameterPanel 开关迁移（`ParameterPanel.tsx` + `ConfigPanel.tsx` + `CharacterDialogueChat.tsx`，Spec Task 11）

- **移除**：「Emoji 增强模式」开关区块（约 L376-391）+ `emojiEnhanced` / `onEmojiEnhancedToggle` props
- **新增**：「开启表情」开关区块，绑定 `expressionDisplay` / `onExpressionDisplayToggle` props；Tooltip 说明：「开启后，AI 回复时根据语境动态切换角色表情头像。需先在「表情管理」中上传表情图片。默认关闭。」
- **透传链路**：`ConfigPanel.tsx` 透传 `expressionDisplay` / `onExpressionDisplayToggle`，移除 `emojiEnhanced` / `onEmojiEnhancedToggle` 透传
- **状态绑定**：`CharacterDialogueChat.tsx` 计算 `expressionDisplay = characterConfig?.customParameters?.expression_display === true`，`onExpressionDisplayToggle` 回调调用 `updateConfig({ customParameters: { ..., expression_display: enabled } })` 并 `saveConfig`
- **BREAKING**：`buildEmojiEnhancedPrompt` 函数保留在 PromptBuilder 中但不再被调用；`emoji_enhanced` 配置字段保留以避免旧配置读取报错（标记 `@deprecated`），但不再产生任何效果
- **hooks.ts 同步**：移除 `buildEmojiEnhancedPrompt` 的 import 与调用（保留 PromptBuilder 中的函数定义以便回退）

#### 14.13.7 类型扩展（`src/shared/types/chat.types.ts` + `CharacterDialogueChat.types.ts`）

- `ChatMessage` 接口新增 `emotion?: string` 字段（含 JSDoc 注释引用本 Spec），用于持久化 AI 回复携带的情绪键名，使表情状态跨会话保留
- `AIParameterConfig` 接口新增 `expression_display?: boolean` 字段（默认关闭，`undefined` 视为关闭）；为 `emoji_enhanced` 添加 `@deprecated` JSDoc 注释
- 4 处独立 `ChatMessage` 定义同步添加 `emotion` 字段：`src/shared/types/chat.types.ts` / `src/renderer/stores/characterChatStore.ts` / `src/main/services/ChatStorageService.ts` / `CharacterDialogueChat.types.ts`（参照 `suggestedOptions` 持久化修复的 3 层遗漏教训）

#### 14.13.8 CharacterEditModal 表情管理 Tab（Spec: add-character-expression-system / Task 15，2026-07-26 新增）

**【重点标记 - 用户反馈补充入口】** 用户反馈「没有看到上传角色表情包的位置」——原入口仅位于对话头部 ChatHeader 的 😊 按钮，用户在角色卡编辑界面找不到上传入口。Task 15 在 `CharacterEditModal.tsx` 新增第二入口。

- **新增 imports**：`Alert`（antd）、`SmileOutlined`（@ant-design/icons）、`ExpressionManagerModal`（`./CharacterDialogueChat/ExpressionManagerModal`）
- **新增 state**：`expressionModalOpen`（boolean），控制嵌套 `ExpressionManagerModal` 的 open 状态
- **新增 Tab**：在 Tabs items 数组末尾（`worldbook` 之后）新增 `{ key: 'expressions', label: <SmileOutlined /> 表情管理 }`
- **Tab 内容逻辑**：
  - `editingItem?.path` 存在（已有角色卡）：显示 `Alert type="info"` 说明 + `Button type="primary"` 「打开表情管理」→ `setExpressionModalOpen(true)`
  - `editingItem?.path` 不存在（新建角色卡）：显示 `Alert type="warning"` 「请先保存角色卡」
- **嵌套 Modal 渲染**：与 AI润色 / AI生成 Modal 同级渲染 `ExpressionManagerModal`，传入 `characterCardId={editingItem?.path}` / `characterName={formValues.name}` / `avatarPath={uploadedImage}`
- **数据互通**：两个入口（ChatHeader + CharacterEditModal Tab）共用同一 `ExpressionManagerModal` 组件与 `expressionStore`，表情数据完全互通
- **文件**：`src/renderer/components/Character/CharacterEditModal.tsx`（修改，新增 ~50 行）

### 14.14 SD 表情生成服务 SDGenerationService（Spec: add-ai-expression-generation / Task 1，2026-07-27 新增）

**【重点标记 - Spec 约束修改】** 本节起的 §14.14-§14.17 实现 AI 表情生成功能，对应 Spec `add-ai-expression-generation`。该 Spec **修改了原 Spec `add-character-expression-system` 的约束 1.b**：从「表情图像仅通过用户上传实现，无任何『自动生成』入口」变更为「允许通过本地 SD WebUI AI 生成，用户也可手动上传，两种方式并存」。这是架构层面的约束变更，但所有存储/渲染/manifest 逻辑保持不变——AI 生成仅是「写入表情存储」的另一条数据源，与手动上传走完全相同的 `expression:saveImage` IPC 通道，写入同一目录与 manifest，可互相替换/删除。

- **能力**：主进程 Stable Diffusion WebUI API 客户端服务，通过本地 Forge Neo（默认 `http://localhost:7860`，需以 `--api` 启动）的 `/sdapi/v1/img2img` 端点调用图生图，以角色卡 PNG 中提取的基底图片为输入，配合情绪提示词与 ADetailer 面部一致性修复，自动生成角色卡表情包。本节为 Task 1 已落地的服务层；IPC 处理器（§14.15）/ UI（§14.17）/ 设置项（§14.16）在后续 Task 完成
- **单例导出**：`export const sdGenerationService = new SDGenerationService();`，与 `expressionService` / `avatarService` 风格一致
- **HTTP 实现**：使用 Node.js 内置 `fetch`（Node 18+ 原生，本项目运行于 Node 24），不引入 axios 等额外依赖。封装 `fetchWithTimeout(url, init, timeoutMs)` 基于 `AbortController` 实现单次请求超时
- **错误识别**：`fetchWithTimeout` 区分三类错误：
  - `AbortError` → 友好提示「请求超时（Xs）」
  - `TypeError`（fetch 网络错误，如连接被拒绝/DNS 失败）→ 友好提示「无法连接到 SD WebUI，请确认 Forge Neo 已启动且开启了 --api 参数」
  - 其他错误原样抛出
- **公共方法**（全部返回结构化对象，永不抛异常给调用方）：
  - `checkStatus(endpoint): Promise<SDStatusResult>` —— GET `/sdapi/v1/options`，返回 `{ available, currentModel }`（`currentModel` 来自 `options.sd_model_checkpoint`）。短超时 10s
  - `getModels(endpoint): Promise<{ success, models: SDModel[], error? }>` —— GET `/sdapi/v1/sd-models`，返回模型清单。短超时 10s
  - `extractBaseImage(characterCardPath): Promise<{ success, imageBase64?, error? }>` —— `fsSync.readFileSync` + `Buffer.toString('base64')`，角色卡 PNG 文件本身就是基底图片（tEXt chunk 仅含 JSON 元数据，无需解析），返回不含 `data:image/png;base64,` 前缀的 base64
  - `generateExpression(params): Promise<SDGenerationResult>` —— POST `/sdapi/v1/img2img`，超时 120s（SDXL 28 步 + ADetailer 较慢）。`params = { endpoint, baseImageBase64, prompt, negativePrompt, options? }`
  - `cancelGeneration(endpoint): Promise<void>` —— POST `/sdapi/v1/interrupt`，发送中断信号。仅记录日志，不抛异常（取消失败不影响调用方主流程）
- **img2img 请求体**（与 Spec 关键参数表一致，2026-07-27 更新 ADetailer args 字段名以兼容 ADetailer-Neo）：
  ```
  { init_images: [baseImageBase64], prompt, negative_prompt,
    denoising_strength: 0.55, steps: 28, cfg_scale: 7,
    width: 512, height: 512, sampler_name: "DPM++ 2M Karras",
    batch_size: 1, n_iter: 1,
    alwayson_scripts: { ADetailer: { args: [
      true,  // args[0]: enable
      { ad_model: "face_yolov8n.pt", ad_prompt: <同主提示词>,
        ad_negative_prompt: <同主负面>, ad_confidence: 0.3,
        ad_denoising_strength: 0.4, ad_mask_blur: 4, ad_dilate_erode: 4,
        ad_inpaint_only_masked: true, ad_inpaint_only_masked_padding: 32,
        // 可选独立采样参数（仅当 ad_use_* 开关为 true 时才写入）
        // ad_use_inpaint_width_height: true, ad_inpaint_width: 512, ad_inpaint_height: 512,
        // ad_use_steps: true, ad_steps: 20,
        // ad_use_cfg_scale: true, ad_cfg_scale: 4.0,
        // ad_use_sampler: true, ad_sampler: "DPM++ SDE Karras"
      }
    ] } } }
  ```
  - `alwayson_scripts.ADetailer` 仅在 `options.adetailerEnabled !== false` 时包含（默认启用）
  - 若 `options.model` 提供，先 POST `/sdapi/v1/options` 切换模型；切换失败则直接返回错误，不进行生成
  - 默认值常量：`DEFAULT_ENDPOINT` / `DEFAULT_DENOISING_STRENGTH=0.55` / `DEFAULT_STEPS=28` / `DEFAULT_CFG_SCALE=7` / `DEFAULT_WIDTH=512` / `DEFAULT_HEIGHT=512` / `DEFAULT_SAMPLER="DPM++ 2M Karras"` / `GENERATION_TIMEOUT_MS=120_000` / `SHORT_TIMEOUT_MS=10_000` / `ADETAILER_MODEL="face_yolov8n.pt"` / `ADETAILER_CONFIDENCE=0.3` / `ADETAILER_DENOISING_STRENGTH=0.4` / `ADETAILER_MASK_BLUR=4` / `ADETAILER_DILATE_ERODE=4` / `ADETAILER_INPAINT_ONLY_MASKED=true` / `ADETAILER_INPAINT_ONLY_MASKED_PADDING=32`
- **【重点标记 - ADetailer-Neo 兼容性修复（2026-07-27）】** ADetailer args dict 字段名严格对齐 `extensions/ADetailer-Neo/lib_adetailer/args.py` 的 `ADetailerArgs` 定义（pydantic `ConfigDict(extra="forbid")`，禁止未定义字段）：
  - 移除 `ad_inpaint_full_res`（Neo 已移除，改用 `ad_use_inpaint_width_height` + `ad_inpaint_width/height`）
  - `ad_dilation` → `ad_dilate_erode`（原拼写错误）
  - 新增 `ad_inpaint_only_masked_padding` / `ad_confidence` / `ad_dilate_erode` / `ad_mask_blur`
  - 可选独立采样参数（仅当对应的 `ad_use_*` 开关为 true 时才写入 args dict）：`ad_use_inpaint_width_height` + `ad_inpaint_width/height` / `ad_use_steps` + `ad_steps` / `ad_use_cfg_scale` + `ad_cfg_scale` / `ad_use_sampler` + `ad_sampler`
  - `SDGenerationOptions` 接口新增 16 个 ADetailer 高级参数字段（`adModel` / `adConfidence` / `adDenoisingStrength` / `adMaskBlur` / `adDilateErode` / `adInpaintOnlyMasked` / `adInpaintOnlyMaskedPadding` / `adUseInpaintWidthHeight` / `adInpaintWidth` / `adInpaintHeight` / `adUseSteps` / `adSteps` / `adUseCfgScale` / `adCfgScale` / `adUseSampler` / `adSampler`）
- **响应解析**：取 `data.images[0]`（base64 字符串，不含 data: 前缀）；非数组 / 空数组 / 非字符串 均视为失败并返回具体错误信息
- **类型导出**：`SDModelType`（`'sdxl' | 'qwen-image' | 'qwen-image-edit' | 'flux2'`）/ `SDModelTypePreset`（模型类型推荐参数）/ `MODEL_TYPE_PRESETS`（4 种模型类型的预设参数 Record）/ `detectModelType(modelName): SDModelType`（根据模型文件名自动检测模型类型）/ `SDGenerationOptions`（含 `modelType?` + 16 个 ADetailer 高级参数字段 + `selectedLoras?` LoRA 模型列表）/ `SDGenerationResult` / `SDStatusResult` / `SDModel` / `SDGenerateParams`
- **【重点标记 - SD 模型类型与自动检测（Spec: NL-SD-Model-Integration / Task 1，2026-07-28 新增）】** 新增 `SDModelType` 类型与 `detectModelType` 函数，支持根据模型文件名自动识别模型类型（qwen-image / qwen-image-edit / flux2 / sdxl 默认兜底）。`MODEL_TYPE_PRESETS` 为每种模型类型提供推荐参数预设（endpoint / denoising / steps / cfgScale / sampler / adetailerEnabled / width / height）。`SDGenerationOptions` 新增 `modelType?: SDModelType` 字段（位于 `model` 字段之后），供调用方显式指定模型类型或由上游自动检测后传入。
- **日志前缀**：`[SDGenerationService]`，与 `[ExpressionService]` / `[AvatarService]` 一致使用 `console.log/error`
- **文件**：`src/main/services/sdGenerationService.ts`（新建，~370 行 → 2026-07-27 扩展至 ~440 行 → 2026-07-27 Task 4 新增 `{traits}` 占位符替换逻辑 → 2026-07-28 Task 1 新增 SD 模型类型定义与自动检测 → 2026-07-28 Task 7 新增 LoRA 标签注入逻辑）
- **tsc 验证**：`npx tsc --noEmit` 通过，`sdGenerationService.ts` 无新增 TypeScript 错误（仓库其他 tsc 错误均属预存问题，与本服务无关）
- **【重点标记 - 特征携带机制（Spec: add-asset-and-trait-management / Task 4）】** `SDGenerationOptions` 新增 `characterTraits?: string[]` 字段，`generateExpression` 中读取该字段并替换 prompt 中的 `{traits}` 占位符（使用函数形式 replace 避免 `$` 特殊字符干扰），空数组/undefined 替换为空字符串并清理多余逗号与空格（循环 `replace(/,\s*,/g, ',')` 直至收敛 + 清理开头/结尾逗号）。ADetailer 的 `ad_prompt` 同步使用已注入特征的最终 prompt，保证面部修复也携带角色特征。`{traits}` 占位符由上游 `PromptBuilder.buildExpressionGenerationPrompt`（Task 5）写入到 `positivePromptTemplate` 中。
- **【LoRA 模型标签注入（Spec: lora-model-selection / Task 7，2026-07-28 新增）】** `SDGenerationOptions` 新增 `selectedLoras?: Array<{ name: string; weight: number }>` 字段。`generateExpression` 在 `{traits}` 占位符替换与清理之后、模型类型分流之前，将 `selectedLoras` 转为 `<lora:name:weight>` 标签并注入到 prompt 前部（如 `<lora:character_style:0.8> portrait, ...`）。Forge Neo 的 prompt parser 自动解析 `<lora:...>` 标签并加载对应 LoRA 文件。空数组/undefined 时不注入。注入位置在模型类型分流之前，确保 txt2img 与 img2img 路径均生效。

### 14.15 SD 表情生成 IPC 处理器（Spec: add-ai-expression-generation / Task 2，2026-07-27 新增）

- **能力**：主进程 IPC 处理器层，将 `sdGenerationService` 的 5 个能力通过 `ipcMain.handle` 暴露给渲染进程，并提供批量生成的进度推送与取消机制。与 `expressionHandlers.ts` 注册模式一致，导出 `registerSdGenerationHandlers()` 函数在 `setupIpcHandlers()` 中调用
- **通道列表**：
  - `sd:checkStatus` —— args: `{ endpoint: string }` → `sdGenerationService.checkStatus(endpoint)`，返回 `{ available, currentModel?, error? }`
  - `sd:getModels` —— args: `{ endpoint: string }` → `sdGenerationService.getModels(endpoint)`，返回 `{ success, models, error? }`
  - `sd:generateExpression` —— args: `{ characterCardPath, emotionKey, prompt, negativePrompt, options? }` → 先 `extractBaseImage` 再 `generateExpression`，返回 `{ success, imageBase64?, error? }`
  - `sd:generateAllExpressions` —— args: `{ characterCardPath, emotions: Array<{ key, prompt, negativePrompt }>, options? }` → 循环生成，通过 `event.sender.send` 推送进度，返回 `{ success, total, successCount, failedCount, cancelledCount }`
  - `sd:cancelGeneration` —— 设置模块级 `isCancelled = true`，返回 `{ success: true }`
- **事件推送**（通过 `event.sender.send` 主动推送给渲染进程，使用 `safeSend` 包装避免窗口销毁后抛错，模式参照 `gameNarrativeHandlers.ts`）：
  - `sd:generationProgress` —— `{ current, total, emotionKey, status: 'success'|'failed', error?, imageBase64? }`
  - `sd:generationComplete` —— `{ total, success, failed, cancelled }`
- **批量生成流程**：
  1. 重置 `isCancelled = false`（每个新批次开始时）
  2. 调用 `extractBaseImage(characterCardPath)` 一次（所有情绪共用基底图片）
  3. 循环 `emotions` 数组，每次迭代前检查 `isCancelled`：若为 true 则 break，剩余未处理的记入 `cancelled`
  4. 每个情绪调用 `generateExpression`，成功/失败后通过 `sd:generationProgress` 推送进度
  5. 全部完成后通过 `sd:generationComplete` 推送汇总
- **取消机制**：模块级 `isCancelled` 标志位（非 AbortController），`cancelGeneration` 设置为 true，`generateAllExpressions` 在下次循环检查时退出。注意：当前正在进行的 img2img HTTP 请求无法被外部 abort（由 120s 超时兜底），取消仅阻止后续未处理的情绪继续生成
- **Preload 暴露**：`window.electronAPI.sd.*` 命名空间，包含 `checkStatus` / `getModels` / `generateExpression` / `generateAllExpressions` / `cancelGeneration` / `onGenerationProgress` / `onGenerationComplete` / `removeProgressListeners`
- **类型声明**：`src/renderer/types/electron.d.ts` 中 `sd` 命名空间，`options` 字段使用 `any`（实际类型为 `SDGenerationOptions`，因主进程类型不可直接被渲染进程引用）
- **⚠️ 重要说明（Task 6 合并）**：Task 6 初期曾创建 `sdHandlers.ts`（仅暴露 `sd:checkStatus` / `sd:getModels`，使用裸字符串 `endpoint` 作为参数）。发现与 Task 2 的 `sdGenerationHandlers.ts` 通道冲突后，已**删除 `sdHandlers.ts`**，统一由 `sdGenerationHandlers.ts` 提供全部 5 个通道。`index.ts` 中 `registerSDHandlers()` 调用被替换为 `registerSdGenerationHandlers()`。`checkStatus` / `getModels` 的 IPC handler 参数为 `{ endpoint }` 对象，但 preload 内部包装使渲染进程仍可使用裸字符串调用（`window.electronAPI.sd.checkStatus(endpoint)` → `ipcRenderer.invoke('sd:checkStatus', { endpoint })`）
- **文件**：
  - `src/main/ipc/handlers/sdGenerationHandlers.ts`（新建，~280 行）
  - `src/main/ipc/index.ts`（修改：替换 `registerSDHandlers` → `registerSdGenerationHandlers`）
  - `src/main/preload.ts`（修改：`sd` 命名空间扩展为完整 8 方法版本）
  - `src/renderer/types/electron.d.ts`（修改：`sd` 类型声明扩展为完整版本）
- **tsc 验证**：`npx tsc --noEmit` 通过，4 个文件无新增 TypeScript 错误

### 14.16 SD WebUI 设置面板（Spec: add-ai-expression-generation / Task 6，2026-07-27 新增；2026-07-27 扩展采样器与 ADetailer 高级参数；2026-07-28 Task 2 新增模型类型选择与 NL 模型支持；2026-07-28 Task 1+8 新增 LoRA 模型选择字段与持久化）

- **能力**：在 Settings 页面新增「Stable Diffusion 设置」区块，允许用户配置 SD WebUI 连接参数与 img2img 生成参数，持久化到 `AppSetting.sdWebui`。与 `VectorConfigPanel` 同样使用 `forwardRef + useImperativeHandle` 模式，父组件 `Settings.tsx` 通过 `ref.current.getFormValues()` 在 `handleSave` 时合并到 `updatedSetting.sdWebui`
- **配置项**（与 `SDWebuiConfig` 接口字段一一对应）：
  - **端点 URL**（`endpoint`）：`Input`，默认 `http://localhost:7860`（Forge Neo 默认端口，需 `--api` 启动）
  - **连接测试**按钮：调用 `window.electronAPI.sd.checkStatus(endpoint)`，结果通过 `Alert` 显示当前模型 checkpoint / 错误信息
  - **模型**（`model`）：`Select` 下拉，选项来自 `window.electronAPI.sd.getModels(endpoint)`，含「使用当前」选项（空字符串值）。配「获取模型列表」按钮触发拉取
  - **模型类型**（`modelType`）：`Select` 下拉（Spec: integrate-nl-driven-sd-models / Task 2 新增），4 个选项：SDXL (img2img + ADetailer) / Qwen-Image (txt2img) / Qwen-Image-Edit (img2img, 推荐用于表情生成) / Flux2 (txt2img/img2img)。配「自动检测」按钮，根据当前模型名调用 `detectModelTypeFromName` 推断类型。切换模型类型时自动填充推荐参数（denoisingStrength/steps/cfgScale/sampler/adetailerEnabled/txt2imgWidth/txt2imgHeight）
  - **txt2img 输出宽高**（`txt2imgWidth` / `txt2imgHeight`）：`InputNumber` 64-2048，仅当 modelType 为 `qwen-image` 或 `flux2`（txt2img 模式）时显示，默认 1024
  - **Denoising Strength**（`denoisingStrength`）：`Slider` 0.1-1.0，步进 0.05，默认 0.55。【重点标记 - 范围扩展】Task 2 将 max 从 0.9 扩展至 1.0，以支持 qwen-image (1.0) 与 qwen-image-edit (0.95) 的推荐去噪强度
  - **qwen-image-edit 去噪警告**：当 modelType 为 `qwen-image-edit` 且 denoisingStrength < 0.9 时，显示 `Alert type="warning"` 提示推荐 denoising ≥ 0.9
  - **Steps**（`steps`）：`InputNumber` 1-100，默认 28（SDXL 推荐）
  - **CFG Scale**（`cfgScale`）：`InputNumber` 1-20，步进 0.5，默认 7
  - **Sampling Method 采样器**（`sampler`）：`AutoComplete` 控件，10 个 SDXL 推荐采样器预设（DPM++ 2M Karras 等）+ 自由输入自定义采样器名。【重点标记 - 采样器可配置】早期版本缺失此字段导致采样器固定无法更改
  - **ADetailer 面部修复**（`adetailerEnabled`）：`Switch`，默认开启。**仅当 modelType 为 `sdxl` 时显示**（Spec: integrate-nl-driven-sd-models / Task 2 条件渲染）
  - **NL 提示词模板**（`nlPromptTemplate`）：`Input.TextArea`，支持 `{traits}` 与 `{emotion}` 占位符。**仅当 modelType 不为 `sdxl` 时显示**（NL 驱动模型使用自然语言提示词而非 tag 格式）。默认：`'A portrait of a character. {traits} The character has {emotion}, looking at the viewer. High quality, detailed.'`
  - **正面提示词模板**（`positivePromptTemplate`）：`Input.TextArea`，支持 `{traits}` 与 `{emotion}` 两个占位符。【重点标记 - 特征携带机制（Spec: add-asset-and-trait-management / Task 5）】`{traits}` 由 `PromptBuilder.buildExpressionGenerationPrompt` 替换为角色视觉特征 tag 字符串（来自 `characterTraitStore`，如 `white fur, dog girl`），特征为空时替换为空字符串并清理多余逗号；`{emotion}` 替换为情绪专用提示词。默认模板：`'portrait, {traits}, looking at viewer, simple background, {emotion}, high quality, best quality, masterpiece, detailed face'`（{traits} 放在 portrait 之后确保角色特征优先）。旧配置兼容：若用户模板不含 `{traits}` 占位符，特征 tag 会在 prompt 开头追加（不破坏旧模板）
  - **自定义负面提示词**（`customNegativePrompt`）：`Input.TextArea`，可选；留空使用 `PromptBuilder.buildExpressionGenerationPrompt` 默认负面提示词
  - **【重点标记 - ADetailer 高级参数折叠面板（2026-07-27 新增；2026-07-28 Task 2 条件渲染：仅 modelType 为 `sdxl` 时显示）】** `Collapse` 折叠面板，暴露全套 ADetailer-Neo 支持的参数（字段名严格对齐 `ADetailerArgs`）：
    - **检测模型**（`adModel`）：`AutoComplete`，9 个预设（face_yolov8n.pt 默认 / face_yolov8s.pt 精度更高 / hand_yolov8n.pt 手部 / person_yolov8n-seg.pt 全身 / mediapipe_face_* 真实人脸）+ 自由输入
    - **检测置信度**（`adConfidence`）：`Slider` 0-1，步进 0.05，默认 0.3
    - **面部修复去噪强度**（`adDenoisingStrength`）：`Slider` 0-1，步进 0.05，默认 0.4
    - **Mask 模糊**（`adMaskBlur`）：`InputNumber` 0-20，默认 4
    - **Mask 膨胀/腐蚀**（`adDilateErode`）：`InputNumber` -20~20，默认 4（正值膨胀/负值腐蚀）
    - **仅修复 Mask 区域**（`adInpaintOnlyMasked`）：`Switch`，默认 true
    - **Mask Padding**（`adInpaintOnlyMaskedPadding`）：`InputNumber` 0-128，默认 32
    - **独立修复尺寸开关 + 宽高**（`adUseInpaintWidthHeight` / `adInpaintWidth` / `adInpaintHeight`）：`Switch` + 两个 `InputNumber`（64-2048，默认 512）
    - **独立步数开关 + 步数**（`adUseSteps` / `adSteps`）：`Switch` + `InputNumber`（1-150，默认 20）
    - **独立 CFG 开关 + CFG**（`adUseCfgScale` / `adCfgScale`）：`Switch` + `InputNumber`（1-24，默认 4.0）
    - **独立采样器开关 + 采样器**（`adUseSampler` / `adSampler`）：`Switch` + `AutoComplete`（默认 "Use same sampler"）
- **预设常量**：`SAMPLER_OPTIONS`（10 个采样器）、`ADETAILER_MODEL_OPTIONS`（9 个检测模型）、`MODEL_TYPE_PRESETS`（4 种模型类型推荐参数，与 `sdGenerationService` 内联一致）、`detectModelTypeFromName`（模型名→类型推断，与 `sdGenerationService.detectModelType` 逻辑一致）
- **条件渲染**（Spec: integrate-nl-driven-sd-models / Task 2）：使用 `Form.useWatch('modelType', form)` 监听模型类型（默认 `'sdxl'`），`Form.useWatch('denoisingStrength', form)` 监听取噪强度：
  - **modelType === 'sdxl'**：显示 ADetailer 面部修复开关 + ADetailer 高级参数折叠面板
  - **modelType !== 'sdxl'**：显示 NL 提示词模板 TextArea，隐藏 ADetailer 相关 UI
  - **modelType 为 `qwen-image` 或 `flux2`**：显示 txt2img 输出宽高 InputNumber
  - **modelType 为 `qwen-image-edit` 且 denoisingStrength < 0.9**：显示去噪强度警告 Alert
- **数据流**：
  - **加载**：`useSettingStore().setting.sdWebui` → `useEffect` → `form.setFieldsValue(...)`（合并 `DEFAULT_SD_WEBUI_CONFIG` 兜底旧配置无 `sdWebui` 字段或新字段缺失的场景）
  - **保存**：`Settings.tsx:handleSave` → `sdWebuiConfigRef.current.getFormValues()` → 合并到 `updatedSetting.sdWebui` → `saveSetting(updatedSetting)` → `window.electronAPI.setting.save()`。【重点标记 - selectedLoras 持久化（Spec: lora-model-selection / Task 8，2026-07-28 新增）】`getFormValues()` 中 `selectedLoras` 不在表单中编辑（由 LoRA 选择 Modal 设置），`form.getFieldsValue(true)` 可能不返回此字段。因此在 `getFormValues` 返回值中显式从 `setting.sdWebui.selectedLoras` 合并，确保已持久化的 LoRA 选择在保存时不丢失。合并顺序：`DEFAULT_SD_WEBUI_CONFIG` → `selectedLoras`（来自 setting）→ `values`（来自表单），确保表单值优先级最高。
- **类型定义**：`SDWebuiConfig` 接口定义于 `src/renderer/types/setting.ts`（含 `sampler` + 16 个 ADetailer 高级参数字段 + NL 模型相关字段 `modelType` / `nlPromptTemplate` / `txt2imgWidth` / `txt2imgHeight` + `selectedLoras?` LoRA 模型列表），`AppSetting.sdWebui?: SDWebuiConfig`（可选字段，旧配置无此字段时使用默认值）
- **默认值**：`src/shared/settings.ts` 中 `defaultSetting.sdWebui` 与 `sdGenerationService` 默认参数一致（`denoisingStrength=0.55` / `steps=28` / `cfgScale=7` / `sampler="DPM++ 2M Karras"` / `adetailerEnabled=true` + 全套 ADetailer 默认值 + NL 模型默认值 `modelType='sdxl'` / `nlPromptTemplate='A portrait of a character. {traits} The character has {emotion}, looking at the viewer. High quality, detailed.'` / `txt2imgWidth=1024` / `txt2imgHeight=1024` / `selectedLoras=[]`）
- **与 `sdGenerationService` 的关系**：设置项中的 `denoisingStrength` / `steps` / `cfgScale` / `sampler` / `adetailerEnabled` + 16 个 ADetailer 高级参数对应 `SDGenerationOptions` 同名字段；`endpoint` / `model` 用于连接与模型切换；`customNegativePrompt` 在生成时与 `PromptBuilder` 默认负面提示词合并
- **UI 风格**：与 `PathSettingsPanel` / `AIEngineSettingsPanel` 一致使用 `Card` + `Form layout="vertical"`，顶部含 `rgba(99, 102, 241, 0.08)` 背景的说明条；ADetailer 高级参数区使用 `Collapse ghost` 折叠面板（默认折叠），内部 `Alert type="info"` 说明字段名兼容性
- **文件**：
  - `src/renderer/components/Settings/SDWebuiSettings.tsx`（新建，~300 行 → 2026-07-27 扩展至 ~700 行 → 2026-07-28 Task 2 扩展至 ~870 行，新增模型类型选择 / NL 提示词模板 / txt2img 尺寸 / 条件渲染）
  - `src/renderer/components/Settings/Settings.tsx`（修改：import + ref 声明 + JSX 渲染 + `handleSave` 合并 `sdWebuiConfig`）
  - `src/renderer/types/setting.ts`（修改：新增 `SDWebuiConfig` 接口含 `sampler` + 16 个 ADetailer 字段 + `AppSetting.sdWebui?` 字段）
  - `src/shared/settings.ts`（修改：`defaultSetting.sdWebui` 默认配置块含全部新字段）
- **tsc 验证**：`npx tsc --noEmit` 通过，`SDWebuiSettings.tsx` / `Settings.tsx` / `setting.ts` / `settings.ts` 均无新增 TypeScript 错误（仓库其他 tsc 错误均属预存问题，与本 Task 无关；Task 2 / Task 1+8 同样无新增错误）

### 14.17 AI 表情生成弹窗 ExpressionGenerateModal（Spec: add-ai-expression-generation / Task 4，2026-07-27 新增）

- **能力**：渲染进程侧的 AI 表情生成弹窗组件，通过 Stable Diffusion WebUI img2img 自动生成角色卡表情图片。支持两种模式：
  - **batch 模式**：一次性生成全部 30 个预置情绪（`EMOTION_PRESETS`）的表情图片，带实时进度条与统计（成功 / 失败 / 跳过），每张生成成功后立即调用 `expressionStore.saveExpression` 保存到磁盘
  - **single 模式**：生成单个情绪表情，提供提示词预览 + 生成中 loading + 结果预览 + 保存 / 重新生成 / 关闭按钮
- **Props 接口**（Task 5 将 import 此 interface）：
  ```typescript
  export interface ExpressionGenerateModalProps {
    open: boolean;
    characterCardId: string;          // = 角色卡 PNG 文件路径
    characterName: string;
    avatarPath?: string;              // 顶部预览用
    mode: 'batch' | 'single';
    targetEmotionKey?: string;        // single 模式必需
    targetEmotionLabel?: string;      // 自定义情绪的中文标签
    onClose: () => void;
    onGenerated?: () => void;         // 完成后回调（父组件刷新 store / UI）
  }
  ```
- **打开时初始化**（`useEffect` 监听 `open + characterCardId`）：
  1. 加载 SD 设置：`window.electronAPI.setting.load()` → `setting.sdWebui`（含 `endpoint` / `denoisingStrength` / `steps` / `cfgScale` / `adetailerEnabled` / `customNegativePrompt` / `model`），缺失字段以 `DEFAULT_SD_CONFIG` 兜底
  2. 加载角色卡描述：`window.electronAPI.character.read(characterCardId)` → `data.description`（用于 `buildExpressionGenerationPrompt` 的 `charDescription` 参数）
  3. 检测 SD 状态：`window.electronAPI.sd.checkStatus(endpoint)` → 更新 `sdStatus`（`available` / `unavailable` / `checking`），不可用时展示 `Alert` 含启动 Forge Neo `--api` 参数的指引
- **【重点标记 - characterCardId 即文件路径】** `characterCardId` prop 实际是角色卡 PNG 文件绝对路径字符串，既是表情 manifest 的 key（经 `expressionService.sanitizeCardId` 哈希后作为目录名），也是 SD 生成时提取基底图片的源文件路径。本组件直接将其作为 `characterCardPath` 传给 `sd:generateExpression` / `sd:generateAllExpressions` IPC，无需额外转换
- **【重点标记 - SD 返回的 base64 不含 data URI 前缀】** `sdGenerationService.generateExpression` 返回的 `imageBase64` 是裸 base64 字符串（不含 `data:image/png;base64,` 前缀）。本组件在收到 base64 后立即拼接 `PNG_DATA_URI_PREFIX` 存入 state（用于 `<img src>` / antd `<Image src>` 展示）；保存时直接传入带前缀的 data URL，`expressionService.saveImage` 内部会剥离前缀（已实现 `imageBase64.replace(/^data:image\/[a-zA-Z]+;base64,/, '')`）
- **批量生成流程**：
  1. 清理旧监听器：`window.electronAPI.sd.removeProgressListeners()`（避免重复监听）
  2. 重置统计：`statsRef.current = { success: 0, failed: 0, skipped: 0 }`，`setBatchStage('generating')`
  3. 为全部 30 个预置情绪构建提示词：`EMOTION_PRESETS.map(({ key, label }) => buildEmotionPrompt(key, label))`，每个情绪调用 `PromptBuilder.buildExpressionGenerationPrompt(charDescription, key, label)` 并合并 `customNegativePrompt`
  4. 注册进度监听：
     - `onGenerationProgress(data)` → 更新 `batchProgress` + 累计统计；若 `status === 'success'` 且 `imageBase64` 非空，**立即**调用 `saveExpression(characterCardId, emotionKey, dataUrl, false)` 保存（不等全部完成）
     - `onGenerationComplete(data)` → 更新 `batchSummary` + `setBatchStage('complete' | 'cancelled')` + `loadExpressions(characterCardId)` 刷新 store + `onGenerated?.()` + `removeProgressListeners()` 清理
  5. 启动生成：`await window.electronAPI.sd.generateAllExpressions({ characterCardPath, emotions, options })`；Promise resolve 时进度事件通常已全部推送完毕，仅 await 以捕获启动异常
- **单个生成流程**：
  1. 找到情绪标签：先查 `EMOTION_PRESETS` 取 `label`，否则用 `targetEmotionLabel` 兜底
  2. 构建提示词：`buildExpressionGenerationPrompt(charDescription, targetEmotionKey, customLabel)` + 合并 `customNegativePrompt`
  3. 调用 IPC：`await window.electronAPI.sd.generateExpression({ characterCardPath, emotionKey, prompt, negativePrompt, options })`
  4. 成功 → 拼接 data URI 前缀存入 `generatedImage`，`setSingleStage('success')`，展示 256×256 预览（antd `Image` 支持点击放大）
  5. 失败 → `setSingleError(result.error)`，`setSingleStage('failed')`，提供「重新生成」按钮
  6. 保存：判断 `isCustom = !EMOTION_PRESETS.some(e => e.key === targetEmotionKey)`，调用 `saveExpression(characterCardId, targetEmotionKey, generatedImage, isCustom, label)` → 成功后 `loadExpressions` 刷新 + `onGenerated?.()` + `onClose()`
- **取消机制**：批量生成中点击「取消生成」→ `window.electronAPI.sd.cancelGeneration()` → 模块级 `isCancelled` 标志位（非 AbortController），下次循环检查时退出。注意：当前正在进行的 img2img HTTP 请求无法被外部 abort（由 120s 超时兜底），取消仅阻止后续未处理的情绪继续生成
- **IPC 监听器清理**：组件卸载 `useEffect` cleanup 调用 `window.electronAPI.sd.removeProgressListeners()`，避免组件销毁后仍收到事件导致 setState on unmounted component 警告；批量生成完成 / 异常时也会调用清理
- **提示词构建复用**：`PromptBuilder.buildExpressionGenerationPrompt(charDescription, emotionKey, customLabel?)` 已由 Task 3 实现，本组件仅负责调用与合并 `customNegativePrompt`，不重复实现提示词逻辑
- **UI 风格**：暗色主题 + inline styles + 项目 CSS 变量（`var(--text-primary)` / `var(--primary-color)` / `var(--chat-bubble-assistant-bg)` 等），参照 `ExpressionManagerModal.tsx`；主操作按钮使用渐变背景 `linear-gradient(135deg, #6366f1 0%, #8b5cf6 100%)` 与 `ExpressionManagerModal` 的「添加自定义情绪」按钮一致
- **antd 组件使用**：`Modal` / `Progress`（active 状态 + 渐变 `strokeColor`）/ `Button` / `Alert`（错误提示 + 信息说明）/ `Spin` / `Image`（结果预览，支持点击放大）/ `Input.TextArea`（提示词预览，readonly）/ `Tag`（SD 状态指示器 + 参数概览）/ `Space` / `Tooltip`
- **图标**：`ThunderboltOutlined`（生成按钮）/ `RobotOutlined`（重新生成）/ `CheckCircleOutlined`（完成 / 成功）/ `CloseCircleOutlined`（失败 / 取消）/ `LoadingOutlined`（检测中 / 生成中）/ `SettingOutlined`（默认状态）
- **文件**：
  - `src/renderer/components/Character/CharacterDialogueChat/ExpressionGenerateModal.tsx`（新建，约 870 行）
- **tsc 验证**：`npx tsc --noEmit` 通过，`ExpressionGenerateModal.tsx` 无新增 TypeScript 错误（仓库 777 个 tsc 错误均属预存问题，与本 Task 无关）
- **后续依赖**：Task 5 将在 `ExpressionManagerModal.tsx` 中添加「AI 生成全部表情」按钮（顶部工具栏，`ThunderboltOutlined`）与每个情绪格子的「AI 生成」按钮（`RobotOutlined`），点击后 import 本组件并传入对应 props

### 14.18 素材与特征管理弹窗 AssetManagerModal（Spec: add-asset-and-trait-management / Task 9，2026-07-27 新增）

- **能力**：渲染进程侧的多 Tab 素材管理弹窗组件，**重构自 `ExpressionManagerModal.tsx`**——原弹窗仅管理表情，重构后内部 5 个 Tab 统一管理角色的全部视觉素材与特征：
  1. **表情**（`ExpressionTabContent`）：复用 `ExpressionManagerModal` 的表情网格逻辑（30 预置情绪 + 自定义情绪网格 + 上传/删除/裁剪流程 + 添加自定义情绪表单）
  2. **角色立绘**（`AssetGridTabContent`，`assetType='illustration'`）：素材网格 + 上传 + 删除，`assetId` 前缀 `ill_`
  3. **一般图像**（`AssetGridTabContent`，`assetType='general'`）：素材网格 + 上传 + 删除，`assetId` 前缀 `gen_`
  4. **三视图**（`ThreeViewTabContent`，`assetType='three-view'`）：三个固定槽位（正面/侧面/背面）独立展示与操作，`assetId` 直接使用 slot 名 `front`/`side`/`back`
  5. **角色特征**（`CharacterTraitTabContent`）：特征 Tag 编辑器（antd `Tag` + `Input` + 添加/删除/编辑 + 保存按钮）
- **Props 接口**（与 `ExpressionManagerModal` 一致 + 扩展 3 个可选字段）：
  ```typescript
  interface AssetManagerModalProps {
    open: boolean;
    characterCardId: string;
    characterName: string;
    characterDescription?: string;  // 新增，供 Task 13 AI 特征生成使用
    characterPersonality?: string;  // 新增
    characterScenario?: string;     // 新增
    avatarPath?: string;
    onClose: () => void;
  }
  ```
- **顶层结构**：`<Modal>`（width=960）+ `<Tabs>`（5 个 Tab，使用 antd v6 `items` API，默认激活 `expression`）。打开时（`open=true && characterCardId` 非空）`useEffect` 并行触发统一加载：
  - `expressionStore.loadExpressions(characterCardId)`
  - `assetStore.loadAssets(characterCardId, 'illustration' | 'general' | 'three-view')`（三次调用）
  - `characterTraitStore.loadTraits(characterCardId)`
  - 各子组件内部也兜底调用各自的 load（防止单独使用时未加载）
- **表情 Tab（ExpressionTabContent）**：从 `ExpressionManagerModal.tsx` 复制核心逻辑后适配为 Tab 内主体（去除外层 Modal），完整复用：
  - 30 预置情绪 + 自定义情绪网格（`EMOTION_PRESETS` + `manifest.customEmotions`）
  - 上传流程：隐藏 file input → `FileReader` → `ImageCropperModal` → `saveExpression(characterCardId, emotionKey, croppedDataUrl, isCustom, label?)`
  - 删除流程：`Modal.confirm` → `deleteExpression`；自定义情绪类别移除走 `removeCustomEmotion`
  - 添加自定义情绪表单：key 校验 `^[a-z][a-z0-9_]*$` + label 非空 + 与预置/已有 keys 不冲突 → `addCustomEmotion`
  - AI 生成入口（`handleBatchGenerate` / `handleSingleGenerate`）：**placeholder**，`message.info('AI 生成功能将在后续接入')`，TODO 标注「Task 11 接入 AssetGenerateModal」
- **素材网格 Tab（AssetGridTabContent）**：参数化 `assetType`，立绘 Tab 传 `'illustration'`、一般图像 Tab 传 `'general'`：
  - 素材网格：从 `assetStore.manifests[assetType]` 读取 `assets`，每个素材的缩略图从 `imageCache[assetType][assetId]` 读取 data URL（3:4 aspect ratio 缩略图）
  - 上传流程：file input → `FileReader` → `ImageCropperModal` → `saveAsset({characterCardId, assetType, assetId, imageBase64})`
    - `assetId` 生成：`{idPrefix}_{Date.now()}_{random}`（如 `ill_1722078400000_abc123`），保证唯一性
  - 删除流程：`Modal.confirm` → `deleteAsset({characterCardId, assetType, assetId})`
  - AI 生成按钮：**placeholder**（同表情 Tab，TODO「Task 11 接入」）
  - 空状态：`<Empty>` + 「上传第一张{tabLabel}」按钮
- **三视图 Tab（ThreeViewTabContent）**：三个固定槽位（`THREE_VIEW_SLOTS = [{slot:'front',label:'正面'}, {slot:'side',label:'侧面'}, {slot:'back',label:'背面'}]`）：
  - 每个槽位独立展示：有图显示缩略图 + 删除按钮；无图显示占位 + 上传按钮 + AI 生成按钮（placeholder）
  - 上传流程：`ImageCropperModal` → `saveAsset({characterCardId, assetType:'three-view', assetId:slot, imageBase64, slot})`（`assetId` 直接使用 slot 名，保持槽位固定）
  - 删除流程：`deleteAsset({characterCardId, assetType:'three-view', assetId:slot})`
  - 三个槽位互不影响，独立上传/删除
  - 渲染：3 列 grid，每个槽位卡片含标签 + 3:4 缩略图 + 操作按钮行
- **角色特征 Tab（CharacterTraitTabContent）**：特征 Tag 编辑器，绑定 `characterTraitStore`：
  - 顶部工具栏：「AI 生成特征」按钮（placeholder，TODO「Task 13 接入」）+ 「保存」按钮（`saveTraits(characterCardId, traits)` 持久化，乐观更新 + 失败回滚）
  - 特征列表：antd `Tag`（closable）展示每个特征，点击 X 删除（`removeTrait(index)`）
  - 添加特征：底部 `Input` + 「添加」按钮（`addTrait(trait)`，trim 后非空且不重复才追加）
  - 编辑特征：点击 Tag 文字进入编辑态（渲染 `<input>` 替代 Tag）+ 回车保存（`updateTrait(index, newValue)`）+ Esc 取消 + 失焦自动保存
  - 空状态：`<Empty>` + 「AI 生成特征」引导按钮
  - 打开 Tab 时 `useEffect` 调 `loadTraits(characterCardId)`
  - **预留参数**：`characterDescription` / `characterPersonality` / `characterScenario` 解构后通过 `void` 标记为已使用（避免 TS6133），Task 13 接入 AI 生成时将用于构建提示词
- **复用 ImageCropperModal**：4 个素材/表情相关 Tab 各自独立维护 `cropperOpen` / `cropperImageSrc` 状态与 `<ImageCropperModal>` 实例（立绘/一般图像/三视图）或共享同一实例（表情），均通过 `onConfirm` 回调接收 `croppedDataUrl` 后调用对应 store 的 save 方法
- **【重点标记 - AI 生成入口全部为 placeholder】** Task 9 阶段所有 AI 生成入口（表情批量/单张、立绘、一般图像、三视图、特征）均使用 `message.info('AI 生成功能将在后续接入')` 占位，**不 import `AssetGenerateModal`**（Task 10 尚未完成，避免编译依赖），统一以 TODO 注释标注「Task 11 接入 AssetGenerateModal」/「Task 13 接入」
- **【重点标记 - 重构关系】** 本文件由 `ExpressionManagerModal.tsx` 重构而来，但 **不删除原文件**（Task 11 决定是否删除或保留为内部子组件），也 **不修改任何入口文件**（`CharacterEditModal` / `ChatHeader` / `CharacterDialogueChat`，Task 11 处理）。表情 Tab 直接复用原 ExpressionManagerModal 的核心逻辑（30 预置情绪 + 自定义情绪网格 + 上传/删除/裁剪流程 + 添加自定义情绪表单），代码量较大但行为一致
- **UI 风格**：暗色主题 + inline styles + 项目 CSS 变量（`var(--text-primary)` / `var(--primary-color)` / `var(--chat-bubble-assistant-bg)` 等），与 `ExpressionManagerModal.tsx` 一致；主操作按钮使用渐变背景 `linear-gradient(135deg, #6366f1 0%, #8b5cf6 100%)`
- **antd 组件使用**：`Modal` / `Tabs`（items API）/ `Button` / `Input` / `Tag`（closable + onClick 编辑）/ `Tooltip` / `Empty` / `Spin` / `message` / `Modal.confirm`
- **图标**：`UploadOutlined`（上传）/ `DeleteOutlined`（删除）/ `PlusOutlined`（添加自定义情绪/特征）/ `CloseOutlined`（移除自定义情绪类别）/ `ThunderboltOutlined`（AI 批量生成）/ `RobotOutlined`（AI 单张生成）/ `SaveOutlined`（保存特征）
- **store 订阅模式**：各子组件分别订阅 `useExpressionStore` / `useAssetStore` / `useCharacterTraitStore`，`error` 字段单独通过 selector 订阅（`useXxxStore((s) => s.error)`）以渲染 inline 错误横幅；具体操作的失败由 handler 通过 `message.error` 反馈，与 `ExpressionManagerModal` 一致
- **文件**：`src/renderer/components/Character/CharacterDialogueChat/AssetManagerModal.tsx`（新建，约 1837 行 / 62 KB）
- **tsc 验证**：`npx tsc --noEmit` 通过，`AssetManagerModal.tsx` 无新增 TypeScript 错误（仓库其他 1006 行 tsc 错误均属预存问题，与本 Task 无关）。开发中曾出现 `ThreeViewTabContent` 中 `manifest` 变量声明未使用的 TS6133 错误（三视图通过固定 slot 直接查 `imageCache`，无需读 manifest），已通过从解构中移除 `manifests` 修复
- **后续依赖**：
  - Task 10：实现 `AssetGenerateModal` 组件（AI 生成素材弹窗）
  - Task 11：将本弹窗接入入口文件（`CharacterEditModal` 新增「素材与特征」Tab / `ChatHeader` 替换原「表情管理」入口），届时决定是否删除原 `ExpressionManagerModal.tsx`
  - Task 13：接入 AI 特征生成（使用 `characterDescription` / `characterPersonality` / `characterScenario` 构建提示词）

### 14.19 素材管理入口接入（Spec: add-asset-and-trait-management / Task 11，2026-07-27 新增）

**【重点标记 - BREAKING UI 变更】** 本 Task 将 `AssetManagerModal`（Task 9）正式接入两个用户入口，替换原 `ExpressionManagerModal`。表情数据层（`expressionService` / `expressionStore`）保持不变，仅 UI 容器层重构。用户面向的「表情管理」标签统一更名为「素材管理」，但内部 API 命名（state 变量 / prop 名）保留原名以最小化改动面。

- **改动文件**（共 3 个）：
  1. `src/renderer/components/Character/CharacterEditModal.tsx`（角色卡编辑弹窗 - 第 4 个 Tab 入口）
  2. `src/renderer/components/Character/CharacterDialogueChat/ChatHeader.tsx`（对话头部按钮 Tooltip）
  3. `src/renderer/components/Character/CharacterDialogueChat/CharacterDialogueChat.tsx`（对话测试弹窗内嵌渲染）

- **CharacterEditModal.tsx 改动**（4 处）：
  - **L7 import 替换**：`import ExpressionManagerModal from './CharacterDialogueChat/ExpressionManagerModal'` → `import AssetManagerModal from './CharacterDialogueChat/AssetManagerModal'`
  - **L719 Tab label 文本**：`<SmileOutlined /> 表情管理` → `<SmileOutlined /> 素材管理`（保留 `key: 'expressions'` 与 `SmileOutlined` 图标不变，仅改用户可见文本）
  - **L730 Alert message**：`"为该角色卡管理表情图片"` → `"为该角色卡管理素材与特征"`
  - **L828-841 嵌套 Modal 渲染**：`<ExpressionManagerModal>` → `<AssetManagerModal>`，新增 3 个 props：
    - `characterDescription={formValues.description || ''}`
    - `characterPersonality={formValues.personality || ''}`
    - `characterScenario={formValues.scenario || ''}`
  - **保留 state 名**：`expressionModalOpen` / `setExpressionModalOpen` 不变（内部命名，不影响用户行为）

- **ChatHeader.tsx 改动**（1 处）：
  - **L211 Tooltip title**：`"表情管理"` → `"素材管理"`
  - **保留不变**：`SmileOutlined` 图标、`onOpenExpressionManager` prop 名（内部 API 命名，不属于用户可见标签）

- **CharacterDialogueChat.tsx 改动**（2 处）：
  - **L10 import 替换**：`import ExpressionManagerModal from './ExpressionManagerModal'` → `import AssetManagerModal from './AssetManagerModal'`
  - **L631-644 Modal 渲染**：`<ExpressionManagerModal>` → `<AssetManagerModal>`，新增 3 个 props：
    - `characterDescription={characterInfo.characterCardContent || ''}`（`characterCardContent` 即角色卡 description 字段）
    - `characterPersonality={characterInfo.personality}`（可选，直接传 `string | undefined`）
    - `characterScenario={characterInfo.scenario}`（可选）
  - **保留 state 名**：`expressionManagerOpen` / `setExpressionManagerOpen` 不变

- **类型兼容性**：`AssetManagerModalProps` 的 3 个新增字段均为可选（`characterDescription?: string` / `characterPersonality?: string` / `characterScenario?: string`），因此 `characterInfo.personality` / `characterInfo.scenario` 为 `string | undefined` 时无需兜底即可直接传入；`CharacterInfo` 类型已包含 `personality?` / `scenario?` / `characterCardContent?` 字段，无需类型层改动。`formValues` 在 `CharacterEditModal` 中已使用 `description` / `personality` / `scenario` 字段（见原有 FieldEditor 渲染），无需扩展。

- **【重点标记 - 命名保留策略】** Task 11 有意保留 `expressionModalOpen` / `expressionManagerOpen` / `onOpenExpressionManager` / `setExpressionModalOpen` / `setExpressionManagerOpen` 等内部命名不变，原因：
  1. 这些是组件内部 state 与 prop 名，用户不可见，不影响功能
  2. 最小化改动面，降低 git diff 噪音，便于代码审查聚焦于真正影响行为的变更
  3. 若后续 Task（如 Task 14+）需要彻底重命名，可统一进行；当前 Task 仅聚焦于「让 AssetManagerModal 接管入口」

- **未删除 `ExpressionManagerModal.tsx`**：原文件（859 行）保留，原因：
  1. Task 9 的 `AssetManagerModal` 表情 Tab 直接复用原 `ExpressionManagerModal` 的核心逻辑（复制粘贴 + 适配），两个文件无引用关系
  2. Task 11 后 `ExpressionManagerModal` 已无入口引用（仅 `index.ts` 仍 re-export，但无外部消费），可视为「僵尸组件」
  3. 后续 Task 决定是否删除或保留作为内部子组件（如未来需要单独的「仅表情」入口）

- **tsc 验证**：`npx tsc --noEmit --pretty false 2>&1 | findstr /i "CharacterEditModal ChatHeader CharacterDialogueChat"` 输出仅含 4 个预存错误（`CharacterDialogueChat.tsx` L2/L3/L84 未使用导入 + `CharacterEditModal.tsx` L240 `getCharacterDir` 不存在），与本 Task 改动无关。本 Task 改动的行（L7/L719/L730/L828-841 / L10/L631-644 / L211）均无新增 TypeScript 错误。

- **后续依赖**：
  - Task 12：实现 `AssetGenerateModal` 的 AI 生成逻辑（SD WebUI 调用，写入素材存储）
  - Task 13：接入 AI 特征生成（使用本 Task 传入的 `characterDescription` / `characterPersonality` / `characterScenario` 构建提示词，调用 LLM 生成特征 Tag 数组）

### 14.20 AssetGenerateModal 接入 + AI 特征生成（Spec: add-asset-and-trait-management / Task 11 接线 + Task 13，2026-07-27 新增）

**【重点标记 - placeholder 全量替换】** 本 Task 将 §14.18 `AssetManagerModal` 中遗留的 6 处 `message.info('AI 生成功能将在后续接入')` placeholder 全部替换为真实调用：5 处接入 `AssetGenerateModal`（Task 10 已实现），1 处接入 `ai:generateCharacterTraits` IPC（Task 12 已实现）。同时为 `characterTraitStore` 新增 `setTraits` action 作为 AI 生成结果的本地写入入口。

- **改动文件**（共 2 个）：
  1. `src/renderer/stores/characterTraitStore.ts`（新增 `setTraits` action）
  2. `src/renderer/components/Character/CharacterDialogueChat/AssetManagerModal.tsx`（6 处 placeholder handler 接线 + 顶层 `AssetGenerateModal` 状态提升 + 子组件 Props 扩展）

- **Task A：`characterTraitStore.setTraits` action（本地批量替换）**：
  - **签名**：`setTraits: (traits: string[]) => { success: boolean; error?: string }`
  - **行为**：与 `addTrait` / `removeTrait` / `updateTrait` 一致，**仅修改本地 state，不调 IPC**。AI 生成特征后调用此 action 填入编辑区，用户可逐条修改后点击「保存」按钮触发 `saveTraits` 持久化
  - **防御性处理**：非数组入参转为空数组；每个元素 trim + 过滤空串 + `Set` 去重（保持首次出现顺序）
  - **永不失败**：try/catch 包裹，正常路径返回 `{ success: true }`，异常路径返回 `{ success: false, error }`（与 store 其他 action 一致）
  - **用途**：Task 13 AI 生成特征返回 `string[]` 后调用 `setTraits(result.traits)` 写入本地 state，避免直接 `saveTraits` 持久化（用户需先 review/编辑）
  - **文件头注释更新**：职责描述与 Actions 说明同步加入 `setTraits`

- **Task B：AssetGenerateModal 接入（5 处 placeholder 替换）**：
  - **顶层状态提升**：在 `AssetManagerModal` 顶层组件新增 5 个 state（`generateModalOpen` / `generateMode` / `generateTargetEmotionKey` / `generateTargetEmotionLabel` / `generateTargetSlot`）+ 统一入口 `openGenerateModal(mode, options?)`，避免在 5 个子组件中各自维护弹窗状态
  - **`<AssetGenerateModal>` 渲染**：在顶层 `<Modal>` 内 `<Tabs>` 之后渲染，`characterCardId` 同时作为 `characterCardId` 与 `characterCardPath` 传入（语义不同但实际同值，见 §14.18 AssetGenerateModal 说明）
  - **子组件 Props 扩展**（3 处）：
    - `ExpressionTabContentProps` 新增 `onBatchGenerate?: () => void` + `onSingleGenerate?: (emotionKey, label) => void`
    - `AssetGridTabContentProps` 新增 `onAIGenerate?: () => void`
    - `ThreeViewTabContent` 由内联 Props 改为命名接口 `ThreeViewTabContentProps`，新增 `onAIGenerate?: (slot: ThreeViewSlot) => void`
  - **placeholder 替换**（5 处 handler）：
    - `ExpressionTabContent.handleBatchGenerate` → 校验 `characterCardId` 后调 `onBatchGenerate?.()` → 父组件 `openGenerateModal('batch-expression')`
    - `ExpressionTabContent.handleSingleGenerate(emotionKey, label)` → 调 `onSingleGenerate?.()` → 父组件 `openGenerateModal('single-expression', { targetEmotionKey, targetEmotionLabel })`
    - `AssetGridTabContent.handleAIGenerate` → 调 `onAIGenerate?.()` → 父组件 `openGenerateModal('illustration' | 'general')`（由 tabItems 配置决定 mode）
    - `ThreeViewTabContent.handleAIGenerate(slot)` → 调 `onAIGenerate?.(slot)` → 父组件 `openGenerateModal('three-view', { targetSlot: slot })`
    - `CharacterTraitTabContent.handleAIGenerateTraits` 见 Task C（不通过 AssetGenerateModal，直接调 IPC）
  - **统一校验**：所有 handler 在调 `onXxx?.()` 前均校验 `characterCardId` 非空（`message.warning('请先选择角色卡')`），保持与原 placeholder 的防御性一致
  - **tabItems 配置**：在顶层 `tabItems` 数组中为 4 个 Tab（表情/立绘/一般图像/三视图）传入对应 callback，角色特征 Tab 无 callback（自有 IPC 调用）

- **Task C：AI 特征生成接入（Task 13）**：
  - **新增 state**：`aiGenerating: boolean`（控制「AI 生成特征」按钮 loading 状态）
  - **store 订阅扩展**：`CharacterTraitTabContent` 的 `useCharacterTraitStore` 解构新增 `setTraits`
  - **`handleAIGenerateTraits` 重写**（异步）：
    1. 校验 `characterCardId` 非空 + 至少一个描述字段（`characterDescription` / `characterPersonality` / `characterScenario`）非空
    2. 若 `traits.length > 0` 弹 `Modal.confirm` 二次确认（标题「AI 生成将覆盖现有特征」，内容显示当前特征数）
    3. `setAiGenerating(true)` → 调 `window.electronAPI.ai.generateCharacterTraits({ characterCardId, description, personality, scenario })`
    4. 成功且 `result.traits` 为数组时调 `setTraits(result.traits)` 写入本地 state：
       - `result.traits.length === 0` → `message.info('AI 未能从角色描述中提取到视觉特征，请手动添加')`
       - 否则 `message.success('AI 生成了 N 个特征，请确认后点击「保存」')`
    5. 失败时 `message.error(result?.error || 'AI 生成特征失败')`；异常时 `console.error` + `message.error`
    6. `finally` 块 `setAiGenerating(false)`
  - **按钮 loading 状态**：顶部工具栏与空状态两处「AI 生成特征」按钮均加 `loading={aiGenerating}` prop
  - **依赖数组**：`[characterCardId, characterDescription, characterPersonality, characterScenario, traits.length, setTraits]`（注意 `traits.length` 而非 `traits`，避免每次 trait 变动都重建 callback）

- **【重点标记 - antd v6 兼容性修复】** 开发中遇到 TypeScript 错误 `Type '"warning"' is not assignable to type 'LegacyButtonType | undefined'`：
  - **根因**：项目使用 `antd@^6.3.5`，antd v6 移除了 `ButtonType` 的 `'warning'` 值（v5 已 deprecated）。当前 `LegacyButtonType = ButtonType | 'danger'` = `'default' | 'primary' | 'dashed' | 'link' | 'text' | 'danger'`
  - **修复**：`Modal.confirm` 的 `okType: 'warning'` 替换为 `okButtonProps: { danger: true }`（红色按钮表达破坏性覆盖操作），与本文件中删除确认弹窗（`handleDeleteAsset` / `handleDeleteSlot`）的既有模式一致
  - **教训**：antd v6 不再支持 `okType: 'warning'`，后续涉及「警告型确认弹窗」统一使用 `okButtonProps: { danger: true }` 或 `okType: 'default'`

- **tsc 验证**：`npx tsc --noEmit --pretty false 2>&1 | findstr /i "AssetManagerModal characterTraitStore"` 输出为空（无匹配行），证明两文件无新增 TypeScript 错误。全量 tsc 仅有 1 行预存的 `WatchOptions` 配置错误，与本 Task 无关

- **未删除既有 placeholder 注释**：原 §14.18 中「AI 生成入口 placeholder」「Task 11 接入」等 TODO 注释已在本 Task 替换为实际实现，§14.18 的描述保留作为历史记录（描述的是 Task 9 阶段状态）

### 14.21 角色特征持久化服务 characterTraitService（Spec: add-asset-and-trait-management / Task 1，2026-07-27 新增）

- **能力**：主进程服务，为每个角色卡持久化「视觉特征清单」（如 `["white fur", "dog girl", "black shirt"]`）。在 SD 生成素材时由 `sdGenerationService` 读取该特征并替换 prompt 中的 `{traits}` 占位符（详见 §14.14 特征携带机制），保证角色一致性（毛色/服饰/物种等关键特征不漂移）
- **单例导出**：`export const characterTraitService = new CharacterTraitService();`，与 `expressionService` / `avatarService` / `assetService` 风格一致
- **存储路径设计**：
  - 根目录：`{userData}/data/character-traits/`
  - 单卡目录：`{userData}/data/character-traits/{sanitizeCardId(characterCardId)}/`
  - 特征文件：`{userData}/data/character-traits/{sanitizeCardId(characterCardId)}/traits.json`
  - `traits.json` 结构：`{ characterCardId: string, version: 1, traits: string[] }`，`traits` 顺序代表用户优先级（前置特征优先级更高）
- **`sanitizeCardId` 哈希策略**：SHA-256 完整哈希后截取前 16 个十六进制字符，与 `expressionService.sanitizeCardId` / `assetService.sanitizeCardId` 完全一致，保证同一 `characterCardId` 在 `character-expressions` / `character-traits` / `character-assets` 三个目录下映射到同一 hash 子目录名（虽然目录相互独立）
- **公共方法**（全部返回结构化对象，永不抛异常给调用方）：
  - `loadTraits(characterCardId): Promise<string[]>` —— 读取特征 tag 数组；文件不存在返回 `[]`；JSON 解析失败兜底返回 `[]` 并记录 error 日志；非数组 `traits` 字段兜底为 `[]`
  - `saveTraits(characterCardId, traits): Promise<{ success, error? }>` —— 覆盖保存特征 tag 数组（自动 mkdir + writeFile）。入参校验：仅保留 string 元素，过滤 null/undefined/非字符串
  - `clearTraits(characterCardId): Promise<{ success, error? }>` —— 删除 `traits.json` 文件。**ENOENT 视为幂等成功**（与 `expressionService` 删除图像的目录处理策略一致）；仅删文件保留单卡子目录，便于后续写入
- **错误处理约定**：
  - 所有方法包裹 try/catch，永不抛异常
  - 错误通过返回值 `{ success: false, error?: string }` 传递
  - `loadTraits` 文件不存在返回空数组（不抛异常、不返回 error）
  - `clearTraits` 文件不存在视为成功
- **类型导出**：`CharacterTraitManifest`（含 `characterCardId` / `version: 1` / `traits: string[]`）
- **日志前缀**：`[CharacterTraitService]`，与 `[ExpressionService]` / `[AssetService]` 风格一致使用 `console.log/error/warn`
- **依赖关系**：`fs/promises` / `fs` / `path` / `crypto` / `getUserDataPath`（`src/main/utils/appPath.ts`）；不依赖 `expressionService`，与 `assetService` 互不依赖
- **文件**：`src/main/services/characterTraitService.ts`（新建，~232 行）

### 14.22 素材管理服务 assetService（Spec: add-asset-and-trait-management / Task 6，2026-07-27 新增）

- **能力**：主进程服务，将原表情管理拓展为通用素材管理。新增三种素材类型 `illustration`（角色立绘）/ `general`（一般图像）/ `three-view`（三视图 front/side/back 三个固定槽位）。**表情类型 `expression` 不纳入本服务**，继续由 `expressionService` 管理，保证向后兼容
- **单例导出**：`export const assetService = new AssetService();`，与 `expressionService` / `characterTraitService` 风格一致
- **存储路径设计**：
  - 根目录：`{userData}/data/character-assets/`
  - 单卡 × assetType 目录：`{userData}/data/character-assets/{sanitizeCardId(characterCardId)}/{assetType}/`
  - PNG 文件：`{userData}/data/character-assets/{sanitizeCardId(characterCardId)}/{assetType}/{assetId}.png`
  - 清单文件：`{userData}/data/character-assets/{sanitizeCardId(characterCardId)}/{assetType}/manifest.json`
  - 每个 `assetType` 拥有独立子目录与独立 manifest，便于按类型批量读取/迁移
- **`AssetManifest` 结构**：`{ characterCardId, version: 1, assets: Record<assetId, AssetEntry> }`，`AssetEntry` 含 `id` / `type` / `slot?` / `image` / `createdAt`
- **【重点标记 - 三视图槽位约束】** `three-view` 类型的 `assetId` 仅允许 `front` / `side` / `back`（`THREE_VIEW_ALLOWED_SLOTS` 常量），`slot` 字段与 `assetId` 一致；`illustration` / `general` 类型的 `assetId` 由调用方生成（如 `ill_{timestamp}_{random}`），忽略 `slot` 字段。service 内部对三视图类型校验 `assetId` 是否在白名单内，违例返回 `{ success: false, error }`
- **公共方法**（全部返回结构化对象，永不抛异常给调用方）：
  - `listAssets(characterCardId, assetType): Promise<AssetManifest>` —— 读取 manifest；不存在时返回默认空 manifest（`{ characterCardId, version: 1, assets: {} }`）
  - `saveAsset({ characterCardId, assetType, assetId, imageBase64, slot? }): Promise<{ success, error?, imagePath? }>` —— 保存 PNG 图像并更新 manifest。`imageBase64` 可含 `data:image/png;base64,` 前缀（内部 strip 后写盘）。返回图像绝对路径 `imagePath`
  - `deleteAsset({ characterCardId, assetType, assetId }): Promise<{ success, error? }>` —— 删除 PNG 文件并从 manifest.assets 移除条目；图像不存在视为幂等成功
  - `getAssetPath({ characterCardId, assetType, assetId }): Promise<{ success, imagePath: string|null, error? }>` —— 获取指定素材的图像绝对路径；不存在时 `imagePath=null`、`success=true`
- **【重点标记 - CSP 兼容 - imagePath 仅供主进程使用】** `saveAsset` / `getAssetPath` 返回的 `imagePath` 是磁盘绝对路径（如 `C:\Users\...\character-assets\{hash}\illustration\{assetId}.png`）。渲染进程 `<img src="C:/...">` 会被 CSP `img-src 'self' data: blob:` 拦截导致裂图。渲染层（`assetStore`）拿到 `imagePath` 后必须调 `window.electronAPI.file.readAsBase64` 转 `data:image/png;base64,...` 后才能用于 `<img src>`（与 `expressionStore.loadExpressions` 修复模式一致，详见 §14.24）
- **错误处理约定**：与 `characterTraitService` 一致——所有方法包裹 try/catch，永不抛异常；文件不存在等可恢复场景按幂等成功处理
- **类型导出**：`AssetType` / `ThreeViewSlot` / `AssetEntry` / `AssetManifest`
- **日志前缀**：`[AssetService]`
- **依赖关系**：`fs/promises` / `fs` / `path` / `crypto` / `getUserDataPath`；不依赖 `expressionService` / `characterTraitService`，与两者互不依赖
- **文件**：`src/main/services/assetService.ts`（新建）

### 14.23 角色特征 Zustand store characterTraitStore（Spec: add-asset-and-trait-management / Task 3，2026-07-27 新增；Task 13 扩展 setTraits）

- **能力**：渲染进程 Zustand store，持有当前角色卡的特征 tag 数组 `traits`，封装所有 `window.electronAPI.characterTrait.*` IPC 调用。提供「编辑态」与「持久化态」分离：本地编辑 actions 仅修改 state，调用方在合适时机调 `saveTraits` 一次性持久化
- **不持久化到 localStorage**：特征数据由主进程 `characterTraitService` 持久化到磁盘，此 store 仅作为运行期缓存与 IPC 适配层，每次进入角色卡编辑界面重新拉取
- **状态字段**：
  - `currentCharacterCardId: string | null` —— 当前加载的角色卡 ID（用于校验缓存归属）
  - `traits: string[]` —— 特征 tag 数组，顺序代表用户优先级（前置特征优先级更高）
  - `loading: boolean` / `error: string | null`
- **Actions**：
  - `loadTraits(characterCardId): Promise<void>` —— 异步，调 `characterTrait.list` 拉取并设置；IPC 返回非数组兜底为 `[]`
  - `saveTraits(characterCardId, traits): Promise<{ success, error? }>` —— **乐观更新 + 失败回滚**：先保存 `prevTraits` 引用 → `set({ traits })` 更新本地 state → 调 IPC → 失败时 `set({ traits: prevTraits })` 回滚
  - `addTrait(trait): { success, error? }` —— 同步，仅修改本地 state；trim 后非空且不重复（大小写敏感）则追加到末尾
  - `removeTrait(index): { success, error? }` —— 同步，仅修改本地 state；越界返回 `{ success: false, error: 'index 越界' }`
  - `updateTrait(index, newValue): { success, error? }` —— 同步，仅修改本地 state；越界 / 空串 / 与其他 trait 重复（排除当前 index）均返回 `{ success: false }`
  - **【重点标记 - setTraits action（Task 13 新增）】** `setTraits(traits): { success, error? }` —— 同步，**本地批量替换**（仅修改 state，不调 IPC）。用于 AI 生成特征（Task 13）后填入编辑区，用户可逐条修改后点击「保存」按钮触发 `saveTraits` 持久化。入参防御性处理：非数组转空数组 + 每个元素 trim + 过滤空串 + `Set` 去重（保持首次出现顺序）。**永不失败**：try/catch 包裹，正常路径返回 `{ success: true }`。**设计原因**：AI 返回的特征可能含冗余/低质量 tag，不应直接覆盖持久化数据；用户 review/编辑后再 `saveTraits` 落盘
  - `clear(): void` —— 重置所有状态（离开角色卡编辑界面时调用）
- **设计要点**：
  - 所有 actions 包裹 try/catch，永不向调用方抛出异常，统一通过返回值 `{ success, error? }` 传递错误
  - `traits` 在 set 时均通过浅拷贝构造新引用（`[...traits]` / `Array.from(new Set(...))`），确保 React 通过引用相等感知变更
- **依赖关系**：`zustand`；`window.electronAPI.characterTrait` IPC（preload 透传，详见 §14.14 SD IPC + characterTrait 命名空间类型声明于 `src/renderer/types/electron.d.ts`）；不依赖 `expressionStore` / `assetStore`
- **参考**：`src/renderer/stores/expressionStore.ts`（无 persist 的 IPC 适配 store 模式） / `src/main/services/characterTraitService.ts`（主进程持久化实现，§14.21） / `src/main/ipc/handlers/characterTraitHandlers.ts`（IPC handler）
- **文件**：`src/renderer/stores/characterTraitStore.ts`（新建，~303 行）

### 14.24 素材 Zustand store assetStore（Spec: add-asset-and-trait-management / Task 8，2026-07-27 新增）

- **能力**：渲染进程 Zustand store，按 `assetType` 分组持有 `manifests` 与 `imageCache`（`illustration` / `general` / `three-view`），封装所有 `window.electronAPI.asset.*` IPC 调用
- **不持久化到 localStorage**：素材 manifest 由主进程 `assetService` 持久化到磁盘，此 store 仅作为运行期缓存与 IPC 适配层
- **状态字段**：
  - `currentCharacterCardId: string | null`
  - `manifests: Record<AssetType, AssetManifest | null>` —— 三种 assetType 各自的 manifest（`null` 表示尚未加载）
  - `imageCache: Record<AssetType, Record<assetId, string>>` —— 三种 assetType 各自的 data URL 缓存
  - `loading: boolean` / `error: string | null`
- **Actions**：
  - `loadAssets(characterCardId, assetType): Promise<void>` —— 调 `asset.list` 拿 manifest → 遍历 assets 调 `asset.getImagePath` 拿磁盘绝对路径 → **调 `file.readAsBase64` 转 data URL 存入 `imageCache[assetType]`**。仅更新对应 assetType 的 manifest/imageCache，不触碰其他类型
  - `saveAsset({ characterCardId, assetType, assetId, imageBase64, slot? }): Promise<{ success, error? }>` —— 调 `asset.save` 持久化；**成功后直接复用入参 `imageBase64`（已是 data URL）存入 `imageCache`**，避免读盘；同步更新本地 `manifests[assetType].assets[assetId]`
  - `deleteAsset({ characterCardId, assetType, assetId }): Promise<{ success, error? }>` —— 调 `asset.delete` 删除磁盘文件并从主进程 manifest 移除；同步从本地 `manifests` 与 `imageCache` 移除
  - `resolveAssetImage(assetType, assetId): string | null` —— 解析 `assetType × assetId` → 素材图像 data URL；优先从 `imageCache` 查找，未找到返回 `null`（调用方应回退到默认占位图）。**供未来对话/卡片渲染调用**
  - `clear(): void` —— 重置所有状态
- **【重点标记 - CSP 兼容设计（与 expressionStore.ts 同源修复模式）】** 主进程 `assetService.getImagePath / save` 返回的 `imagePath` 是磁盘绝对路径。但 `src/main/index.ts` 中 CSP 限制 `img-src 'self' data: blob:`，渲染进程 `<img src="C:/...">` 会被浏览器拦截导致「裂开图片」图标。**修复方案**：`imageCache` 中**只存 data URL**，不存绝对路径：
  - `loadAssets`：拿到 `getImagePath` 返回的绝对路径后，再调 `window.electronAPI.file.readAsBase64(path)` 读为 `data:image/png;base64,...` 存入 `imageCache`（与 `useCharacterSwitch.ts` 加载头像、`expressionStore.loadExpressions` 加载表情一致）
  - `saveAsset`：入参 `imageBase64` 本身已是 data URL（裁剪 / SD 生成输出），保存成功后直接复用存入 `imageCache`，无需读盘——既避免 CSP 拦截又省一次 IO
- **工具函数**：`createEmptyManifests()` / `createEmptyImageCache()` 构造初始值；`preloadImage(imagePath)` 通过 `new Image()` fire-and-forget 预加载图像到浏览器缓存
- **类型导出**：本地结构化声明 `AssetType` / `ThreeViewSlot` / `AssetEntry` / `AssetManifest`（与主进程 `assetService.ts` 同名类型结构一致，避免主进程代码导入渲染进程；与 `electron.d.ts` 第 476-505 行 asset 命名空间内联声明保持一致）
- **依赖关系**：`zustand`；`window.electronAPI.asset` + `window.electronAPI.file.readAsBase64` IPC；不依赖 `expressionStore` / `characterTraitStore`
- **参考**：`src/renderer/stores/expressionStore.ts`（CSP 裂图 BUG 修复模式来源，详见 CHANGELOG 2026-07-27 修复条目）/ `src/renderer/components/Character/CharacterDialogueChat/useCharacterSwitch.ts`（头像 data URL 加载模式）
- **文件**：`src/renderer/stores/assetStore.ts`（新建）

### 14.25 AI 辅助特征生成服务 characterTraitAIService（Spec: add-asset-and-trait-management / Task 12，2026-07-27 新增）

- **能力**：主进程服务，基于角色卡的 `description` / `personality` / `scenario` 字段，调用现有 AI 引擎（OpenAI 兼容 `/v1/chat/completions` 端点）自动提取视觉特征 tag 列表（如 `["white fur", "dog girl", "blue eyes", "black shirt"]`）。输出的 tag 列表可直接写入 `characterTraitService` 持久化，供 SD 生成时携带以保证角色一致性
- **单例导出**：`export const characterTraitAIService = new CharacterTraitAIService();`，与 `characterTraitService` / `assetService` 单例模式一致
- **复用基础设施**：
  - `aiConfigProvider`（`src/main/services/ai/AIConfigProvider.ts`）：读取激活引擎的 `baseUrl` / `apiKey` / `apiKeyTransmission` / `systemPrompt` / `modelName`
  - 与 `DescriptionPolisher` / `OutlineGenerator` 一致的 fetch + `/v1/chat/completions` 调用模式
  - **非流式调用**（特征提取任务输出短，无需流式）
- **与 characterTraitService 的关系**：本服务只负责「生成」特征 tag，**不负责持久化**。持久化由 `characterTraitService.saveTraits` 负责，前端拿到 traits 后自行调用。解耦使本服务可独立测试与复用
- **公共方法**：
  - `generateCharacterTraits(params: GenerateCharacterTraitsParams): Promise<GenerateCharacterTraitsResult>`
    - 入参：`{ characterCardId, description, personality?, scenario? }`（`characterCardId` 用于日志关联，不参与 LLM prompt）
    - 返回：`{ success: true, traits: string[] }` 或 `{ success: false, error: 友好信息 }`。`traits` 可能为空数组（表示 LLM 未提取到任何特征）
- **流程**：
  1. 入参校验：`characterCardId` 非空 + `description` 非空（`personality` / `scenario` 可选）
  2. 读取 AI 引擎配置（`aiConfigProvider.getAIConfig({ defaultTransmission: 'header' })`）
  3. 配置兜底校验：`baseUrl` / `apiKey` / `modelName` 任一缺失返回「AI 引擎未配置，请先在设置中配置 API」
  4. 读取引擎运行时参数 `temperature` / `max_tokens`
  5. 构建 system + user 消息，注入引擎级 systemPrompt（与 `OutlineGenerator.enrichSystemPrompt` 一致）
  6. 非流式 POST `/v1/chat/completions`
  7. 解析 `data.choices[0].message.content`，提取逗号分隔 tag
  8. trim 每项 + 过滤空字符串 + 移除前缀编号（如 `1. ` / `- ` / `* `）+ 移除尾部句号/冒号 + 去重（保留原顺序）
- **专用系统提示词 `CHARACTER_TRAIT_SYSTEM_PROMPT`**：
  - 明确角色（角色视觉特征提取助手）与目标（输出 SD 提示词格式 tag）
  - 列出提取范围（物种/毛色发色/瞳色/服饰/配饰/其他显著特征）保证覆盖面
  - 4 条硬性要求：英文 tag / 逗号分隔 / 简洁（1-3 个单词）/ 不臆测
  - 提供输出示例（`white fur, dog girl, blue eyes, black shirt, animal ears`），降低 LLM 输出自然语言句子的概率
- **【重点标记 - 项目最高优先级规则：禁止使用 AI 参数默认值】** `getEngineRuntimeConfig()` 读取激活引擎的 `temperature` / `max_tokens`，**任一字段缺失（或类型非 number）即返回 `null`**，由调用方返回友好错误「AI 引擎未配置 temperature 或 max_tokens 参数，请在设置中配置 AI 引擎」。与 `WritingStyleLearningService.getTemperature / getMaxTokens` 抛错语义一致，仅改为返回 `null` 以适配本 service「不抛异常」的兜底约定（实施日期 2026-05-24，详见 `.trae/documents/技术文档.md`）
- **错误处理约定（SubTask 12.4）**：
  - 任何步骤失败返回 `{ success: false, error: 友好信息 }`，不抛异常
  - AI 引擎未配置 → 「AI 引擎未配置，请先在设置中配置 API」
  - 调用失败（网络/超时/HTTP 错误） → 「AI 调用失败：<具体原因>」；网络错误友好化为「无法连接到 AI 服务，请检查网络或 API 地址」；超时友好化为「请求超时，请稍后重试」
  - 返回格式异常（空内容/无法解析） → 「AI 返回内容无法解析为 tag 列表」
  - 日志前缀 `[CharacterTraitAI]`，与 `[CharacterTraitService]` 区分
- **类型导出**：`GenerateCharacterTraitsParams` / `GenerateCharacterTraitsResult`
- **依赖关系**：`aiConfigProvider` / `getStorageService`（读取 `settings.aiEngines` 与 `activeEngineId` 获取 temperature / max_tokens）；不依赖 `characterTraitService` / `assetService`
- **文件**：`src/main/services/characterTraitAIService.ts`（新建，~378 行）

### 14.26 AI 素材生成弹窗 AssetGenerateModal（Spec: add-asset-and-trait-management / Task 10，2026-07-27 新增）

- **能力**：渲染进程侧的 AI 素材生成弹窗组件，**扩展自 `ExpressionGenerateModal`**（§14.17），支持四种素材类型生成：
  - `batch-expression`：批量生成 30 个预置情绪表情（沿用原 `ExpressionGenerateModal` 逻辑）
  - `single-expression`：生成单个情绪表情（沿用原逻辑）
  - `illustration`：生成角色立绘（full body, standing）
  - `general`：生成一般场景图像（`userScene` 由用户输入）
  - `three-view`：生成三视图（front / side / back，由 `targetSlot` 指定）
- **Props 接口**：
  ```typescript
  export interface AssetGenerateModalProps {
    open: boolean;
    characterCardId: string;          // = 角色卡 PNG 文件路径，作为 store key 与 characterTrait.list 参数
    characterCardPath: string;        // 用于 SD 提取基底图（与 characterCardId 通常是同一字符串）
    characterName: string;
    mode: 'batch-expression' | 'single-expression' | 'illustration' | 'general' | 'three-view';
    targetEmotionKey?: string;        // single-expression 模式必需
    targetEmotionLabel?: string;      // 自定义情绪的中文标签
    targetSlot?: 'front' | 'side' | 'back';  // three-view 模式必需
    onClose: () => void;
    onGenerated?: () => void;
  }
  ```
- **【重点标记 - characterCardId vs characterCardPath 语义分离】** 在 `ExpressionGenerateModal` 中 `characterCardId` 即角色卡 PNG 文件路径（同时用作 store key 和 SD 提取基底图的源文件路径）。本组件按 Task 10 要求将两者作为独立 prop 声明以语义化区分：
  - `characterCardId`：用于 `expressionStore` / `assetStore` / `characterTrait.list` 的 key
  - `characterCardPath`：用于 `sd.generateExpression` 的 `characterCardPath` 参数
  - 实际调用方（Task 11）传入时两者通常是同一字符串
- **打开时初始化**（`useEffect` 监听 `open + characterCardId`）：
  1. 加载 SD 设置：`window.electronAPI.setting.load()` → `setting.sdWebui`（含 `endpoint` / `denoisingStrength` / `steps` / `cfgScale` / `sampler` / `adetailerEnabled` / `customNegativePrompt` / `model` + 16 个 ADetailer 高级参数），缺失字段以 `DEFAULT_SD_CONFIG` 兜底
  2. **读取角色特征**：`window.electronAPI.characterTrait.list(characterCardId)` → 存入 state `characterTraits`
  3. 检测 SD 状态：`window.electronAPI.sd.checkStatus(endpoint)` → 更新 `sdStatus`
- **【重点标记 - 特征携带机制（Spec: add-asset-and-trait-management / Task 4 + Task 10）】** 组件打开时通过 `characterTrait.list` 读取角色特征存入 state，`buildSdOptions` 时透传到 `options.characterTraits`，由 `sdGenerationService` 内部替换提示词模板中的 `{traits}` 占位符（与 `ExpressionGenerateModal` 一致，详见 §14.14）。**所有 5 种生成模式均自动携带角色特征**，保证生成素材的角色一致性
- **【重点标记 - 复用 sd.generateExpression IPC（不新增 IPC）】** Task 10 实现约束：不新增 IPC。原 `sd:generateExpression` 的 `emotionKey` 仅用于日志，实际生成由 `prompt` 字段控制（`sdGenerationService.generateExpression` 接收预构建 prompt）。因此非表情模式（`illustration` / `general` / `three-view`）复用此 IPC，`emotionKey` 传 `'neutral'` 占位值，prompt 由本组件按 mode 构建模板
- **提示词模板（按 mode 构建）**：
  - `batch-expression` / `single-expression`：调 `PromptBuilder.buildExpressionGenerationPrompt(emotionKey, customLabel, characterTraits)`，模板含 `{traits}` 与 `{emotion}` 两个占位符
  - `illustration`：`full body, standing, {traits}, looking at viewer, simple background, high quality, best quality, masterpiece`
  - `general`：用户输入 `userScene` + `{traits}` + 质量词
  - `three-view`：按 `targetSlot` 构建（如 `front view, full body, {traits}, ...` / `side view, profile, ...` / `back view, from behind, ...`）
- **生成成功后保存到对应 store**：
  - `batch-expression` / `single-expression` → `expressionStore.saveExpression`（写入 `data/character-expressions/{hash}/`，与手动上传走相同路径，详见 §14.17）
  - `illustration` / `general` / `three-view` → `assetStore.saveAsset`（写入 `data/character-assets/{hash}/{assetType}/`，详见 §14.24）
- **批量生成流程**（与 `ExpressionGenerateModal` 一致）：
  1. 清理旧监听器：`window.electronAPI.sd.removeProgressListeners()`
  2. 重置统计：`statsRef.current = { success: 0, failed: 0, skipped: 0 }`，`setBatchStage('generating')`
  3. 为全部 30 个预置情绪构建提示词（含 `characterTraits`）
  4. 注册进度监听 `onGenerationProgress` / `onGenerationComplete`
  5. 启动生成：`await window.electronAPI.sd.generateAllExpressions({ characterCardPath, emotions, options })`
- **取消机制**：批量生成中点击「取消生成」→ `window.electronAPI.sd.cancelGeneration()` → 模块级 `isCancelled` 标志位，下次循环检查时退出
- **【重点标记 - SD 返回的 base64 不含 data URI 前缀】** `sdGenerationService.generateExpression` 返回的 `imageBase64` 是裸 base64 字符串。本组件在收到 base64 后立即拼接 `PNG_DATA_URI_PREFIX` 存入 state（用于 `<img src>` / antd `<Image src>` 展示）；保存时直接传入带前缀的 data URL，`expressionStore.saveExpression` / `assetStore.saveAsset` 内部会剥离前缀（与 `ExpressionGenerateModal` 一致）
- **UI 风格**：暗色主题 + inline styles + 项目 CSS 变量，参照 `ExpressionGenerateModal`；主操作按钮使用渐变背景 `linear-gradient(135deg, #6366f1 0%, #8b5cf6 100%)`
- **antd 组件使用**：`Modal` / `Progress` / `Button` / `Alert` / `Spin` / `Image` / `Input.TextArea` / `Tag` / `Space` / `Tooltip`
- **图标**：`ThunderboltOutlined`（生成）/ `RobotOutlined`（重新生成）/ `CheckCircleOutlined`（成功）/ `CloseCircleOutlined`（失败/取消）/ `LoadingOutlined`（生成中）/ `SettingOutlined`（默认状态）/ `EyeOutlined`（AI 图片识别按钮，Spec: add-model-capability-detection-and-image-recognition / Task 7）
- **依赖关系**：`useExpressionStore` / `useAssetStore` / `useSettingStore`（Task 7 新增，读取 `supportsVision`）/ `window.electronAPI.sd.*` / `window.electronAPI.characterTrait.list` / `window.electronAPI.setting.load` / `window.electronAPI.ai.recognizeImageTraits`（Task 7 新增）；import `EMOTION_PRESETS` / `buildExpressionGenerationPrompt` from `./PromptBuilder`（§14.13）
- **【重点标记 - AI 图片识别按钮（Spec: add-model-capability-detection-and-image-recognition / Task 7，2026-07-28 新增）】** 在 `renderTraitsPanel` 的 header 行（特征计数标签所在 flex 容器）右侧新增「AI 图片识别」按钮（`marginLeft: 'auto'` 右对齐），仅当当前 AI 引擎 `supportsVision=true` 时条件渲染。点击后调用 `window.electronAPI.ai.recognizeImageTraits({ characterCardPath: characterCardId, characterName })`（Task 6 IPC），成功时大小写不敏感去重追加到 `characterTraits` state（`new Set(existing.map(t => t.toLowerCase()))` 过滤），`message.success` 提示新增数量与总数量。`supportsVision` 派生：`useSettingStore()` → `setting.aiEngines.find(e => e.id === setting.activeEngineId)` → `activeEngine?.capabilities?.supportsVision === true`。按钮 `loading` 由 `imageRecognizing` state 控制；关闭弹窗时重置该 state 避免残留。**不保存到磁盘**——仅更新组件内 state 影响后续 SD 生成提示词，特征持久化由角色卡编辑界面负责。
- **文件**：`src/renderer/components/Character/CharacterDialogueChat/AssetGenerateModal.tsx`（新建）
- **tsc 验证**：`npx tsc --noEmit` 通过，`AssetGenerateModal.tsx` 无新增 TypeScript 错误

### 14.27 AI 引擎能力标识 UI（Spec: add-model-capability-detection-and-image-recognition / Task 5，2026-07-28 新增）

- **能力**：在 AI 引擎管理界面（`AIEngineSettingsPanel.tsx`）基于引擎 `capabilities` 字段渲染能力徽章，让用户一眼可见每个引擎支持的模型能力（文本生成 / 视觉识别 / 思维链推理 / 工具调用）。徽章渲染于三处：引擎选择下拉、引擎管理 Modal 列表、连通性测试结果。
- **`renderCapabilityBadges` 渲染函数**（模块级，Task 5.1）：接收 `capabilities?: AIEngineCapabilities`，缺省返回 `null`；使用 antd `Tag` + `Tooltip` + `Space` 渲染四个图标徽章：
  - `EditOutlined`（蓝色）— 始终显示，表示文本生成能力
  - `EyeOutlined`（绿色）— `supportsVision=true` 时显示，表示视觉/图片识别
  - `BulbOutlined`（紫色）— `supportsThinking=true` 时显示，表示思维链/推理
  - `ToolOutlined`（橙色）— `supportsToolCalling=true` 时显示，表示工具调用
- **引擎选择下拉显示徽章**（Task 5.2）：主卡片 `Select` 通过 `options` 携带 `capabilities` 字段，`optionRender` 在下拉项名称后渲染徽章，`labelRender` 在已选中标签后渲染徽章（按 `props.value` 从 `engines` 查找引擎 capabilities）。
- **引擎管理 Modal 列表显示徽章**（Task 5.3）：引擎管理 Modal 的 `Table`「引擎名称」列增加 `render`，在引擎名下方渲染 `renderCapabilityBadges(record.capabilities)`。
- **连通性测试结果显示徽章**（Task 5.4 / Spec Task 4.1 + 4.3）：`useAIEngineSettings.ts` 的 `TestResult` 接口新增 `capabilities?: AIEngineCapabilities` 字段（Spec Task 4.1，作为 Task 5.4 显示区的前置类型准备）；主表单 `testResult` 与引擎编辑表单 `engineTestResult` 的 `Alert` 描述区在 `capabilities` 存在时渲染「模型能力」徽章行。当前 `capabilities` 数据由 Spec Task 4.2（探测后填入）提供，未接入前不显示。
- **【重点标记 - antd v6 `optionRender` 类型陷阱】** 首次实现 `optionRender` 时通过 `option.capabilities` 读取自定义字段触发 `tsc` 报错：`Property 'capabilities' does not exist on type 'FlattenOptionData<...>'`。根因：antd v6（`@rc-component/select`）的 `optionRender` 回调参数类型为 `FlattenOptionData<OptionType>`，其结构为 `{ label?, data: OptionType, key, value?, groupOption?, group? }`——自定义字段封装在 `option.data` 上，而非 option 顶层（`label` / `value` 是 FlattenOptionData 顶层字段故可直接访问）。修复方式：改用 `option.data?.capabilities` 读取。后续在 antd v6 Select `optionRender` 中访问自定义 option 字段时，统一通过 `option.data` 访问。
- **文件**：
  - `src/renderer/components/Settings/AIEngineSettingsPanel.tsx`（修改：新增 `Tag` / `Tooltip` antd 导入 + `EyeOutlined` / `BulbOutlined` / `ToolOutlined` 图标导入 + `AIEngineCapabilities` 类型导入；新增 `renderCapabilityBadges` 模块级函数；`Select` 新增 `optionRender` / `labelRender`；引擎管理 Table 名称列新增 `render`；两处测试结果 `Alert` 新增能力徽章行）
  - `src/renderer/components/Settings/hooks/useAIEngineSettings.ts`（修改：导入 `AIEngineCapabilities`；`TestResult` 接口新增 `capabilities?` 字段）
- **tsc 验证**：`npx tsc --noEmit` 通过，`AIEngineSettingsPanel.tsx` / `useAIEngineSettings.ts` 均无新增 TypeScript 错误（仓库其他 tsc 错误均属预存问题，与本 Task 无关）

### 14.28 LoRA 模型列表服务 LoraService（Spec: add-lora-model-selection / Task 1，2026-07-28 新增）

- **能力**：主进程 LoRA 模型列表获取服务，通过 Forge Neo 的 `/sdapi/v1/loras` 端点拉取可用 LoRA 模型列表，并为每个 LoRA 构建预览图 URL、读取本地 JSON 元数据文件、从 path 提取分类。供渲染进程 `LoraSelectModal` 展示可选 LoRA 列表
- **单例导出**：`export const loraService = new LoraService();`，与 `sdGenerationService` / `expressionService` 风格一致
- **HTTP 实现**：使用 Node.js 内置 `fetch` + `AbortSignal.timeout(10000)`（10s 超时），不引入额外依赖
- **公共方法**：
  - `fetchLoraList(endpoint): Promise<{ success, loras?: LoraModel[], error? }>` —— GET `{endpoint}/sdapi/v1/loras`，返回加工后的 `LoraModel[]`（按名称 `localeCompare('zh')` 排序）
- **数据处理流程**（`buildLoraModel` 私有方法）：
  1. 构建预览图 URL：`{endpoint}/sd_extra_networks/thumb?filename={encodeURIComponent(path)}`
  2. 从 path 提取分类：`path.replace(/\\/g, '/').split('/')` 取倒数第二段（子目录名），不足两段时为 `'未分类'`
  3. 读取 JSON 元数据：`readJsonMetadata(loraPath)` 读取 `{path_without_extension}.json`，解析 `description` / `activation text` / `preferred weight` / `sd version` / `notes` 五个字段（缺失或解析失败返回空字符串/0）
- **LoraModel 接口**（10 字段）：`name` / `alias` / `path` / `previewUrl` / `description` / `activationText` / `preferredWeight` / `sdVersion` / `notes` / `category`
- **错误处理**：API 非 2xx 返回友好错误信息；`fetch failed` / `network` 关键词识别为连接错误；非数组响应检测
- **日志前缀**：`[LoraService]`
- **文件**：`src/main/services/loraService.ts`（新建，~195 行）
- **tsc 验证**：`npx tsc --noEmit` 无 `loraService.ts` 相关 TypeScript 错误

### 14.29 LoRA 模型选择弹窗 LoraSelectModal（Spec: add-lora-model-selection / Task 4，2026-07-28 新增）

- **能力**：渲染进程侧的 LoRA 模型选择弹窗组件，打开时调用 `window.electronAPI.lora.list(endpoint)` 拉取可用 LoRA 列表，用户可多选并调整权重，确认后通过 `onConfirm` 回调返回选中列表。被 `ExpressionGenerateModal`（§14.17）与 `AssetGenerateModal`（§14.26）复用
- **Props 接口**：
  ```typescript
  interface LoraSelectModalProps {
    open: boolean;
    endpoint: string;
    selectedLoras: Array<{ name: string; weight: number }>;
    onConfirm: (loras: Array<{ name: string; weight: number }>) => void;
    onCancel: () => void;
  }
  ```
- **UI 组成**：
  - **顶部搜索 + 分类筛选**：`Input` 搜索框（前端不区分大小写过滤 `lora.name.toLowerCase().includes(kw)`）+ `Select` 分类下拉（从 `loraList` 的 `category` 字段去重，含「全部」选项）
  - **已选区域**：每个选中 LoRA 渲染为 `Tag` + `Popover`（内含权重 `Slider` 0-1，步进 0.05）+ `Button` 移除按钮（`CloseOutlined`）。Tag 文案格式 `name (0.70)`
  - **主体网格布局**：`display: grid; grid-template-columns: repeat(auto-fill, minmax(130px, 1fr))`，每个卡片含预览图（`<img loading="lazy">` 懒加载，120px 高）+ 模型名（11px 字号，`text-overflow: ellipsis`）。选中卡片边框为 `var(--primary-color, #6366f1)`，未选中为 `transparent`
  - **Tooltip**：悬停卡片显示 JSON 元数据（description / activationText / sdVersion / notes），无元数据显示「无额外说明」
  - **占位图**：预览图加载失败（`onError`）或无 `previewUrl` 时显示 `PictureOutlined` 图标占位
  - **底部按钮**：取消 + 确认（`确认（N）`，N 为已选数量）
- **常量**：`DEFAULT_WEIGHT = 0.7`（新增选中时使用）/ `ALL_CATEGORY = '全部'`
- **性能优化**：
  - 预览图懒加载（`<img loading="lazy">`）
  - `loraCacheRef` 缓存列表：endpoint 未变化时不重复请求，Modal 关闭再打开复用 `useRef` 缓存
  - `useMemo` 计算分类选项（`categoryOptions`）与过滤后列表（`filteredLoras`）
- **状态管理**：`localSelected` 为 `selectedLoras` 的本地副本（打开时同步，运行中独立修改，确认时通过 `onConfirm` 回传）。`failedImages` 为 `Set<string>` 记录加载失败的预览图 name
- **文件**：`src/renderer/components/Character/CharacterDialogueChat/LoraSelectModal.tsx`（新建，~450 行）
- **tsc 验证**：`npx tsc --noEmit` 无 `LoraSelectModal.tsx` 相关 TypeScript 错误

### 14.30 AssetManagerModal 内联渲染模式（2026-07-29 新增）

**【重点标记 - 体验优化】** 本节解决 `CharacterEditModal`「素材管理」Tab 内容单薄、需二次点击按钮才能进入管理面板的体验问题。为 `AssetManagerModal`（§14.18）新增 `inline` 属性，支持以非 Modal 形态直接嵌入 Tab 页签。

- **背景**：§14.19 将 `AssetManagerModal` 接入 `CharacterEditModal` 第 4 个 Tab 时，Tab 内仅渲染 `Alert` 说明 + 「打开表情管理」`Button`，点击后才弹出 `AssetManagerModal`。这导致素材管理 Tab 与其他三个 Tab（角色信息/对话与指令/世界书关联，均直接展示完整编辑界面）的功能复杂度严重不对称，用户体验较差。

- **方案选型**：采用**条件渲染**而非 Modal CSS hack（`getContainer={false}` + `position: static`）。原因：
  1. Ant Design Modal 的 fixed 定位 / z-index / overflow 体系专为弹层设计，强行覆盖为 static 易在嵌套 Modal（`CharacterEditModal` 内嵌 `AssetManagerModal`）场景产生样式冲突
  2. 条件渲染语义清晰——`inline=true` 时返回普通 `<div>`，内容自然随父 Modal body 的 `overflowY: auto` 滚动，无定位副作用
  3. 共享内容（`Tabs` + `AssetGenerateModal`）提取为变量，两种模式复用，无代码重复

- **AssetManagerModal.tsx 改动**：
  - **Props 新增** `inline?: boolean`（默认 `false`），接口注释说明三种渲染差异
  - **组件解构** 增补 `inline = false`
  - **return 重构**：提取 `tabsElement`（`<Tabs items={tabItems} style={{ minHeight: 400 }} />`）与 `generateModalElement`（`<AssetGenerateModal ... />`）为局部变量；`inline === true` 时提前返回 `<div style={{ width: '100%' }}>{tabsElement}{generateModalElement}</div>`（无标题，与「角色信息」等 Tab 风格一致）；否则渲染原 `<Modal title=... footer=...>` 包裹同样的两个变量
  - **数据加载**：`useEffect` 仍依赖 `open && characterCardId` 触发 `loadExpressions` / `loadAssets` / `loadTraits`。内联模式下父组件传 `open={父Modal的open}`，确保仅在父 Modal 可见时加载数据

- **CharacterEditModal.tsx 改动**：
  - **移除** `expressionModalOpen` / `setExpressionModalOpen` state 声明（2 行）及模态框打开时重置 imageChanged 的 useEffect 中相关逻辑不受影响
  - **Tab children 重写**（`key: 'expressions'`）：`editingItem?.path` 存在时渲染 `<AssetManagerModal open={open} inline={true} characterCardId={editingItem.path} ... onClose={() => {}} />`；不存在时保留 `Alert` 警告「请先保存角色卡」
  - **移除** 文件底部独立的 `<AssetManagerModal open={expressionModalOpen} ... />` 渲染块（原 L828-841）
  - **导入不变**：`AssetManagerModal` / `Alert` / `SmileOutlined` 等仍被使用，无需清理

- **向后兼容**：
  - `inline` 可选默认 `false`，`CharacterDialogueChat.tsx`（§14.19 ChatHeader 入口）未传该 prop，行为完全不变
  - 内联模式下内部子弹窗（`ImageCropperModal` / `AssetGenerateModal` / `LoraSelectModal` / `Modal.confirm`）仍各自 portal 到 document.body，弹层定位与 z-index 不受内联父容器影响

- **涉及文件**：`src/renderer/components/Character/CharacterDialogueChat/AssetManagerModal.tsx`（`inline` prop + 条件渲染 + 内容提取）/ `src/renderer/components/Character/CharacterEditModal.tsx`（Tab 内联渲染 + state 清理 + 底部弹窗移除）
- **tsc 验证**：`npx tsc --noEmit` 无本次改动的新增 TypeScript 错误（`CharacterEditModal.tsx` L237 `getCharacterDir` 为预存错误）

### 14.31 立绘生成重构 + 立绘替换角色卡图片 + 缩略图全尺寸预览（2026-07-29 新增）

**【重点标记 - 三项联动改动】** 本节记录用户需求驱动的三项相关改动：（1）立绘生成强制走 txt2img 路径（明确禁用 img2img）；（2）立绘可一键替换角色卡原始图片（含确认机制防误操作）；（3）所有素材缩略图新增 hover 眼睛图标 + 全尺寸预览 Modal。三项改动共同提升了立绘生成→预览→应用的完整工作流体验。

#### 14.31.1 立绘生成强制 txt2img 路径（Task 1）

- **背景**：原 `AssetGenerateModal`（§14.26）的 illustration 模式调用 `sd.generateExpression`，该方法内部按 `modelType` 分流——sdxl 走 img2img（需提取角色卡 PNG 作为基底图），qwen-image / flux2 走 txt2img。用户需求明确要求立绘生成**必须使用角色特征参数通过 txt2img 技术生成，禁止 img2img 路径**，以确保立绘完全由特征 tag + LoRA 驱动，不受基底图风格干扰
- **sdGenerationService.ts 重构**：
  - **提取 `applyTraitsAndLora(prompt, options): string` 私有方法**：原 `{traits}` 占位符替换 + LoRA 标签注入逻辑内联在 `generateExpression` 中，现提取为独立方法供两条路径复用。处理流程：① 读取 `options.characterTraits` 过滤空字符串拼接为逗号分隔串；② 函数形式 `replace(/\{traits\}/g, ...)` 替换占位符（避免 `$` 特殊字符干扰）；③ 循环 `replace(/,\s*,/g, ',')` 清理连续逗号 + 清理首尾逗号 + 清理多余空格；④ `selectedLoras` 转为 `<lora:name:weight>` 标签注入 prompt 前部
  - **`generateTxt2Img` 自包含特征处理**：在方法内部首行调用 `applyTraitsAndLora(prompt, options)`，使前端直接调用 `sd.generateTxt2Img` 时也能准确应用角色特征 tag 和 LoRA（无需依赖 `generateExpression` 预处理）
  - **`generateExpression` 调用顺序调整**：将 `applyTraitsAndLora` 调用移至 txt2img 分支之后（仅服务 img2img 路径）。**【重点标记 - 避免双重注入】** 当 `generateExpression` 分流到 `generateTxt2Img`（qwen-image / flux2 无基底图）时，prompt 尚未经过 `applyTraitsAndLora` 处理，由 `generateTxt2Img` 内部统一处理，避免 LoRA 标签被注入两次
- **AssetGenerateModal.tsx 改动**：`handleSingleGenerate` 中新增 `mode === 'illustration'` 分支，直接调用 `window.electronAPI.sd.generateTxt2Img({ endpoint, prompt, negativePrompt, options: buildSdOptions() })`，不传 `characterCardPath`（txt2img 无需基底图）；其他模式（single-expression / general / three-view）仍走 `sd.generateExpression` 由其内部按 modelType 分流。依赖数组新增 `sdConfig.endpoint`
- **数据流**：`AssetGenerateModal` 打开时 `characterTrait.list(characterCardId)` 读取特征 → `buildSdOptions()` 透传到 `options.characterTraits` → `sd.generateTxt2Img` → `applyTraitsAndLora` 替换 `{traits}` + 注入 LoRA → POST `/sdapi/v1/txt2img` → 返回 base64 → `assetStore.saveAsset({ assetType: 'illustration', ... })`
- **涉及文件**：`src/main/services/sdGenerationService.ts`（`applyTraitsAndLora` 提取 + `generateTxt2Img` 自包含 + `generateExpression` 调用顺序调整）/ `src/renderer/components/Character/CharacterDialogueChat/AssetGenerateModal.tsx`（illustration 分流到 txt2img）
- **【重点标记 - Forge Neo Hires.fix NoneType 迭代错误修复（2026-07-29）】** 立绘生成（txt2img）启用 Hires.fix 时 Forge Neo 端报错 `TypeError: argument of type 'NoneType' is not iterable`（`processing.py:1405`）。**根因**：Forge Neo `processing.py:1221` 将 `hr_additional_modules: list = field(default=None)` 默认值设为 `None`（而非空列表），而 `processing.py:1405` 的 `sample` 方法中 `"Use same choices" not in self.hr_additional_modules` 仅检查 `hasattr` 未检查 `None`——当 `enable_hr=true` 但 API 请求体未传入 `hr_additional_modules` 时，`"..." not in None` 抛出 TypeError。**修复**：在 `generateTxt2Img` 与 `generateExpression`（img2img 路径）的 Hires.fix 参数注入中，显式设置 `body.hr_additional_modules = ['Use same choices']`。这使得 Forge Neo `processing.py:1405` 的 `"Use same choices" not in ["Use same choices"]` 返回 `False`（跳过该 if 块），既绕过 None bug，又确保 Hires.fix 阶段复用主生成的 LoRA 模块（保持角色一致性）。通过阅读 Forge Neo 源码 `modules/api/models.py` 确认 `hr_additional_modules` 可通过 API 请求体传入——`PydanticModelGenerator` 反射 `StableDiffusionProcessingTxt2Img` 的所有 dataclass 字段生成 API 模型，`hr_additional_modules` 作为该类的字段自动暴露给 API。
- **【重点标记 - Forge Neo Hires.fix 参数名错误导致 denoising_strength 为 None（2026-07-29）】** 修复 `hr_additional_modules` bug 后 Hires.fix 仍报错 `TypeError: '>' not supported between instances of 'NoneType' and 'int'`（`sd_samplers_common.py:46` 的 `p.denoising_strength > 0`）。**根因（两个参数名错误，通过阅读 Forge Neo 源码定位）**：
  1. **`hr_denoising_strength` 不存在**：在整个 Forge Neo `modules/` 目录中搜索 `hr_denoising_strength` 零结果。txt2img 的 Hires.fix 第二阶段（`sample_hr_pass` → `sample_img2img` → `setup_img2img_steps`）直接读取 `p.denoising_strength`，而非独立的 `hr_denoising_strength`。子类 `StableDiffusionProcessingTxt2Img` 第 1212 行定义 `denoising_strength: float = 0.75`，但 `PydanticModelGenerator.merge_class_params`（`api/models.py:58-63`）按 MRO 顺序遍历（子类先、基类后），基类 `StableDiffusionProcessing` 第 174 行的 `denoising_strength: float = None` 覆盖了子类默认值 0.75。当 API 请求体未传 `denoising_strength` 时，`p.denoising_strength=None`，`setup_img2img_steps` 中 `p.denoising_strength > 0` 抛 TypeError
  2. **`hr_steps` 不是有效字段名**：Forge Neo `processing.py:1217` 的正确字段名为 `hr_second_pass_steps`，传 `hr_steps` 会被 Pydantic 忽略（`hr_second_pass_steps` 保持默认值 0 = 使用主生成 steps）
  - **修复**：`generateTxt2Img` 中将 `body.hr_denoising_strength` 改为 `body.denoising_strength`（txt2img 的 denoising_strength 专供 Hires.fix 使用），将 `body.hr_steps` 改为 `body.hr_second_pass_steps`；`generateExpression`（img2img）中移除无效的 `hr_denoising_strength`（img2img 已在请求体中设置 `denoising_strength`，Hires.fix 复用该值），将 `hr_steps` 改为 `hr_second_pass_steps`

#### 14.31.2 立绘替换角色卡图片（Task 2）

- **能力**：在素材管理的「角色立绘」Tab（`AssetGridTabContent` with `assetType='illustration'`）中，每张立绘缩略图新增 `SwapOutlined`「设为角色卡图片」按钮（仅 illustration 类型显示，general / three-view 不显示），点击后将该立绘替换为角色卡 PNG 的基底图片
- **确认机制**：**【重点标记 - 防误操作】** 点击后弹出 `Modal.confirm` 警告框，内容明确告知「将使用此立绘替换角色卡的原始图片（PNG 载体）。角色卡的角色数据（描述、个性等）会保留不变，仅替换基底图片。此操作不可撤销，确定继续？」，`okText: '确认替换'`，`okButtonProps: { danger: true }`，需用户主动确认后才执行
- **替换流程**（`handleReplaceCardImage`）：
  1. `window.electronAPI.character.read(characterCardId)` 读取角色卡当前 JSON 元数据（保留 description / personality / scenario 等所有字段，仅替换图片载体）
  2. 剥离 data URI 前缀（`dataUrl.substring(commaIndex + 1)`）提取纯 base64
  3. `window.electronAPI.character.createFromImage(characterCardId, base64String, content)` 重建 PNG 文件——新图片作为 PNG 载体，原 JSON 元数据写入 tEXt chunks
  4. `invalidateCharacterImageCache(characterCardId)` 失效缩略图/头像缓存（§14.30 引入的 `characterThumbnailCache` 模块），使角色列表、对话头像、编辑弹窗等各处显示新图片
  5. `onCardImageReplaced?.(dataUrl)` 回调通知父组件更新预览
- **CharacterEditModal 联动**：
  - **`AssetManagerModalProps` + `AssetGridTabContentProps` 新增** `onCardImageReplaced?: (newImageDataUrl: string) => void` prop
  - **`handleCardImageReplaced` 回调**（`CharacterEditModal`）：`setUploadedImage(newImageDataUrl)` 更新顶部图片预览为新立绘 + `setImageChanged(false)` 重置图片更换标记。**【重点标记 - 避免重复重建 PNG】** 因为 PNG 已在 `handleReplaceCardImage` 中通过 `createFromImage` 在磁盘上重建，保存角色卡时仅需 `character.write` 写 JSON 元数据，无需再次 `createFromImage`（否则会用同一图片重复重建）。`imageChanged=false` 确保走 `character.write` 分支
- **向后兼容**：`onCardImageReplaced` 为可选 prop，`CharacterDialogueChat.tsx`（ChatHeader 入口，弹窗模式）未传该 prop，替换功能仍可执行（磁盘 PNG 已重建 + 缓存已失效），仅不更新父组件预览
- **涉及文件**：`AssetManagerModal.tsx`（`AssetGridTabContent` 替换按钮 + `handleReplaceCardImage` + `replacingCardImage` loading state + `onCardImageReplaced` prop 透传）/ `CharacterEditModal.tsx`（`handleCardImageReplaced` 回调 + prop 传递）/ `characterThumbnailCache.tsx`（导入 `invalidateCharacterImageCache`）

#### 14.31.3 缩略图全尺寸预览（Task 3）

- **能力**：为素材管理中所有图片缩略图（`AssetGridTabContent` 的立绘/一般图像 + `ThreeViewTabContent` 的三视图）添加 hover 触发的预览功能。鼠标悬停在缩略图上时，半透明遮罩层平滑淡入，中央显示眼睛图标按钮；点击图标后以 Modal 展示完整尺寸图片，保留原始分辨率与细节
- **hover 覆盖层实现**：
  - 缩略图容器 `onMouseEnter` / `onMouseLeave` 事件中通过 `e.currentTarget.querySelector('.thumbnail-hover-overlay')` 获取覆盖层 DOM 节点，直接操控 `style.opacity`（`'1'` / `'0'`）
  - 覆盖层 `div.thumbnail-hover-overlay` 样式：`position: absolute; inset: 0; background: rgba(0,0,0,0.5); opacity: 0; transition: 'opacity 0.25s ease'; cursor: pointer`，实现 0.25 秒平滑淡入
  - 中央 `Button`（`type="text"`）+ `EyeOutlined` 图标（`fontSize: 22, color: '#fff'`），外包 `Tooltip title="预览大图"`
  - **【重点标记 - DOM 直操 vs React state】** 采用 `querySelector` + `style.opacity` 直接操控 DOM（与现有卡片 `border-color` hover 模式一致），避免额外 React state 渲染开销——每个缩略图网格有 N 张图，用 state 管理会导致整个网格重渲染
- **全尺寸预览 Modal**：
  - `previewImage: string | null` state 控制开关，`handlePreview(dataUrl)` / `setPreviewImage(dataUrl)` 设置，`onCancel={() => setPreviewImage(null)` 关闭
  - `Modal` props：`footer={null}`（无操作按钮）、`width="auto"` + `style={{ maxWidth: '95vw', padding: 0 }}` + `styles={{ body: { padding: 0 } }}`（紧贴图片）、`destroyOnClose`（关闭时销毁 DOM 释放大图内存）、`closable`（右上角关闭按钮）
  - 图片样式：`maxWidth: '90vw'` + `maxHeight: '85vh'` + `objectFit: 'contain'`（保持宽高比不变形，适配各种尺寸的立绘/三视图），`display: 'block'`（消除底部基线间隙）
- **ThreeViewTabContent 一致性**：三视图三个槽位（front/side/back）的缩略图同样添加 hover 覆盖层 + 眼睛图标，点击后复用同一 `previewImage` state + 预览 Modal（`setPreviewImage(dataUrl)`），实现风格统一
- **未覆盖范围**：`ExpressionTabContent`（表情 Tab）未添加 hover 预览——表情图为 512×512 方形裁剪，尺寸较小无需全尺寸预览；如后续需要可复用同一模式
- **涉及文件**：`AssetManagerModal.tsx`（`AssetGridTabContent` + `ThreeViewTabContent` 均添加 hover 覆盖层 + 预览 Modal + `previewImage` state）

### 14.32 img2img 步数参数优化 + 表情图模糊修复（2026-07-29 新增）

**【重点标记 - 两项联动优化】** 本节记录用户需求驱动的 img2img 两项优化：（1）步数严格遵循用户配置（消除 Forge Neo `img2img_fix_steps` 导致的步数放大）；（2）表情图模糊修复（分辨率 + ADetailer 参数全面优化）。

#### 14.32.1 步数严格遵循用户配置

- **背景**：用户反映 img2img 生成时 Forge Neo 控制台显示步数（如 56）与设置界面配置值（如 28）不符。排查发现代码中**无硬编码 56**——根源是 Forge Neo 的 `img2img_fix_steps` 选项（`shared_options.py:298`，默认 `False`）
- **Forge Neo 步数放大机制**（`sd_samplers_common.py:42-51` `setup_img2img_steps`）：
  - 当 `img2img_fix_steps = True` 时走 if 分支：`steps = int(requested_steps / min(denoising_strength, 0.999))`，如 `int(28 / 0.5) = 56`，进度条显示 56 步
  - 当 `img2img_fix_steps = False`（默认）时走 else 分支：`steps = p.steps`（用户配置值），`t_enc = int(denoising * steps)`，进度条显示用户配置步数
- **问题**：虽然 `img2img_fix_steps` 默认 `False`，但用户可能在 Forge Neo Settings 中手动启用，导致 API 调用时步数被放大
- **修复**：在 `generateExpression`（img2img 路径）的请求体中添加 `override_settings: { img2img_fix_steps: false }`，强制禁用步数放大行为。`override_settings` 是 SD WebUI API 的标准字段，可覆盖 `shared.opts` 中的任何选项，不受 Forge Neo UI 设置影响
- **涉及文件**：`sdGenerationService.ts`（`generateExpression` img2img 请求体添加 `override_settings`）

#### 14.32.2 表情图模糊修复

- **背景**：img2img 生成表情图片高概率模糊。通过分析 Forge Neo 源码与现有参数，定位四个根因
- **根因分析与修复**：

  | # | 根因 | 原值 | 新值 | 修复位置 |
  |---|------|------|------|---------|
  | 1 | img2img 目标分辨率太低（长边仅 512） | `DEFAULT_WIDTH = 512` 作为 `longSideTarget` | 新增 `IMG2IMG_LONG_SIDE_TARGET = 768`，传入 `calculateAspectRatioDimensions` | `sdGenerationService.ts` 常量 + `generateExpression` 调用 |
  | 2 | ADetailer 面部修复分辨率太低（512×512） | `adInpaintWidth/Height = 512`，`adUseInpaintWidthHeight = false`（可选） | `adInpaintWidth/Height = 768`，`adUseInpaintWidthHeight = true`（**强制启用**） | `sdGenerationService.ts` ADetailer args 构建 |
  | 3 | ADetailer 降噪强度过高（0.4 导致面部细节丢失） | `ADETAILER_DENOISING_STRENGTH = 0.4` | `0.3`（保留更多原图面部细节） | `sdGenerationService.ts` 常量 |
  | 4 | ADetailer 蒙版模糊/膨胀太小（过渡不自然） | `ADETAILER_MASK_BLUR = 4`, `ADETAILER_DILATE_ERODE = 4` | `8` / `8`（增大蒙版边缘模糊与膨胀范围） | `sdGenerationService.ts` 常量 |

- **ADetailer 强制启用独立修复尺寸**：原先 `ad_use_inpaint_width_height` 为可选（用户未启用时 ADetailer 使用主图分辨率修复面部），现强制设为 `true` 并使用 `Math.max(options.adInpaintWidth ?? 768, 512)` 兜底。这确保 ADetailer 面部 inpaint 始终在 ≥512 分辨率下进行，即使主图分辨率较低也能获得清晰的面部修复
- **分辨率选择依据**：SDXL 模型原生推荐 1024²，但 img2img 受基底图限制（角色卡 PNG 通常 400×600~512×768），768 是清晰度与生成速度的平衡点。ADetailer 面部修复使用 768×768 方形（面部区域近似正方形）
- **同步更新的默认配置文件**（5 处 `DEFAULT_SD_CONFIG` / `DEFAULT_SD_WEBUI_CONFIG`）：
  - `src/shared/settings.ts`（全局默认配置）
  - `src/renderer/components/Settings/SDWebuiSettings.tsx`（设置面板默认值）
  - `src/renderer/components/Character/CharacterDialogueChat/AssetGenerateModal.tsx`（素材生成弹窗默认值）
  - `src/renderer/components/Character/CharacterDialogueChat/ExpressionGenerateModal.tsx`（表情生成弹窗默认值）
  - `src/main/services/sdGenerationService.ts`（后端服务默认常量）
- **向后兼容**：已保存旧配置的用户不受影响——后端 `sdGenerationService` 的 `?? ADETAILER_*` 兜底逻辑会使用新常量值。用户在设置界面修改的值仍被尊重（`adInpaintWidth/Height` 兜底 `Math.max(..., 512)` 确保不低于 512）

### 14.33 img2img 高清模式切换：direct / two-step（2026-07-29 新增）

#### 14.33.1 背景与问题分析

**问题**：Forge Neo 的 img2img API 不支持 Hires.fix 高清修复。

通过阅读 Forge Neo 源码确认：
- `StableDiffusionProcessingTxt2Img` 类（`processing.py:1210`）包含 `enable_hr` / `hr_scale` / `hr_upscaler` / `hr_second_pass_steps` / `sample_hr_pass` 等 Hires.fix 字段与方法
- `StableDiffusionProcessingImg2Img` 类（`processing.py:1655`）**完全没有**这些字段，也没有 `sample_hr_pass` 方法
- `img2imgapi` 函数（`api.py:500`）通过 `StableDiffusionProcessingImg2Img(**args)` 构造处理对象，传入的 `enable_hr` 等参数因类中无对应字段而被静默忽略

**此前的问题**：代码在 img2img 路径中注入了 Hires.fix 参数（`enable_hr` / `hr_upscaler` / `hr_second_pass_steps` / `hr_additional_modules`），但这些参数被 Forge Neo 忽略，从未生效。

#### 14.33.2 解决方案：两种替代方案

新增 `img2imgHiresMode` 配置字段，通过两种替代方案实现高清修复：

| 方案 | 流程 | 分辨率 | 降噪强度 | 步数 | 特点 |
|------|------|--------|---------|------|------|
| **direct** | 一步生成 | 1024 | 0.55（用户配置） | 28（用户配置） | 速度快 |
| **two-step**（默认） | 两步放大 | 先 768 → 再 1024 | 0.55 → 0.35 | 28 → 20 | 细节保留好 |

两种方案均启用 ADetailer 面部修复（1024×1024，降噪 0.3）。

**参数针对 NVIDIA RTX PRO 6000 Blackwell（96GB 显存）优化**：
- img2img 目标分辨率从 768 提升至 1024（direct 模式）
- ADetailer 面部修复分辨率从 768 提升至 1024×1024

#### 14.33.3 代码重构

**`sdGenerationService.ts` 核心重构**：
- 提取 `calculateImg2ImgDimensions` 私有方法：按宽高比计算目标尺寸（长边对齐到指定值）
- 提取 `executeImg2ImgPass` 私有方法：执行单次 img2img 请求（构建请求体 + ADetailer + 发送 + 解析响应）
- `generateExpression` 根据 `img2imgHiresMode` 调用 `executeImg2ImgPass` 一次（direct）或两次（two-step）
- 移除 img2img 路径中被忽略的 Hires.fix 参数注入

**新增常量**：
```typescript
const IMG2IMG_DIRECT_TARGET = 1024;           // direct 模式目标分辨率
const IMG2IMG_TWO_STEP_FIRST_TARGET = 768;    // two-step 第一步分辨率
const IMG2IMG_TWO_STEP_SECOND_TARGET = 1024;  // two-step 第二步分辨率
const TWO_STEP_SECOND_DENOISING = 0.35;       // two-step 第二步降噪
const TWO_STEP_SECOND_STEPS = 20;             // two-step 第二步步数
```

**ADetailer 分辨率提升**：`ADETAILER_INPAINT_WIDTH/HEIGHT` 从 768 提升至 1024

#### 14.33.4 涉及文件

| 文件 | 修改内容 |
|------|---------|
| `src/renderer/types/setting.ts` | `SDWebuiConfig` 新增 `img2imgHiresMode: 'direct' \| 'two-step'` 字段 |
| `src/main/services/sdGenerationService.ts` | 重构 `generateExpression` + 新增 `calculateImg2ImgDimensions` / `executeImg2ImgPass` 私有方法 + 常量更新 |
| `src/renderer/components/Settings/SDWebuiSettings.tsx` | 新增「img2img 高清模式」折叠面板（Radio 切换）+ `Radio` 导入 + 默认值 |
| `src/shared/settings.ts` | `DEFAULT_SD_WEBUI_CONFIG` 新增 `img2imgHiresMode` 默认值 |
| `src/renderer/components/Character/CharacterDialogueChat/AssetGenerateModal.tsx` | `DEFAULT_SD_CONFIG` + `buildSdOptions` 透传 `img2imgHiresMode` |
| `src/renderer/components/Character/CharacterDialogueChat/ExpressionGenerateModal.tsx` | `DEFAULT_SD_CONFIG` + `buildSdOptions` 透传 `img2imgHiresMode` |

### 14.34 生成弹窗质量参数扩展（2026-07-29 新增）

**【重点标记 - 质量参数字段补全】** 本节记录对 `AssetGenerateModal.tsx` 与 `ExpressionGenerateModal.tsx` 两个生成弹窗中 `DEFAULT_SD_CONFIG` 默认值与 `buildSdOptions` 透传字段的扩展，补全采样器调度器、CLIP skip、ADetailer 独立采样器/调度器、Hires.fix 高级参数等质量字段，使前端弹窗在 `setting.sdWebui` 不存在时仍能向后端传递完整的质量参数。

#### 14.34.1 DEFAULT_SD_CONFIG 默认值更新

**采样器相关**：
- `sampler`: `'DPM++ 2M Karras'` → `'DPM++ 3M SDE'`（升级为 SDE 变体采样器，细节表现更佳）
- 新增 `scheduler: 'Karras'`（采样器调度器，与 sampler 配合）
- 新增 `clipSkip: 2`（CLIP 停止层，SDXL 模型常用 2 以跳过最后一层提升质量）

**ADetailer 默认值优化**（面部修复质量提升）：

| 字段 | 原值 | 新值 | 说明 |
|------|------|------|------|
| `adInpaintOnlyMaskedPadding` | 32 | 64 | 增大蒙版外填充，修复区域过渡更自然 |
| `adInpaintWidth` | 768 | 1024 | 面部修复分辨率提升至 1024 |
| `adInpaintHeight` | 768 | 1024 | 面部修复分辨率提升至 1024 |
| `adUseSteps` | false | true | 启用 ADetailer 独立步数 |
| `adSteps` | 20 | 30 | ADetailer 独立步数提升至 30 |
| `adUseCfgScale` | false | true | 启用 ADetailer 独立 CFG |
| `adCfgScale` | 4.0 | 5.0 | ADetailer 独立 CFG 提升至 5.0 |
| `adUseSampler` | false | true | 启用 ADetailer 独立采样器 |
| `adSampler` | `'Use same sampler'` | `'DPM++ 2M SDE'` | ADetailer 使用 SDE 采样器 |
| `adScheduler`（新增） | — | `'Use same scheduler'` | ADetailer 调度器（默认跟随主调度器） |

**Hires.fix 高级参数**（在 `hrNegativePrompt` 后新增 5 个字段）：

| 字段 | 默认值 | 说明 |
|------|--------|------|
| `hrCfg` | 5.0 | Hires.fix 独立 CFG |
| `hrSamplerName` | `'DPM++ 2M SDE'` | Hires.fix 独立采样器 |
| `hrScheduler` | `'Karras'` | Hires.fix 独立调度器 |
| `img2imgExtraNoise` | 0.05 | img2img 额外噪声注入 |
| `initialNoiseMultiplier` | 1.0 | 初始噪声乘数 |

**注**：`hrUpscaler` 保持 `'Latent'` 不变（两个弹窗当前值均为 `'Latent'`，依据需求保持）。

#### 14.34.2 buildSdOptions 透传字段扩展

在 `buildSdOptions` 返回对象中新增以下透传字段，确保前端配置能完整传递到后端 `sdGenerationService`：

- `sampler` 后新增：`scheduler` / `clipSkip`
- `adSampler` 后新增：`adScheduler`
- `hrNegativePrompt` 后新增：`hrCfg` / `hrSamplerName` / `hrScheduler` / `img2imgExtraNoise` / `initialNoiseMultiplier`

#### 14.34.3 涉及文件

| 文件 | 修改内容 |
|------|---------|
| `src/renderer/components/Character/CharacterDialogueChat/AssetGenerateModal.tsx` | `DEFAULT_SD_CONFIG` 更新采样器/ADetailer/Hires.fix 默认值 + `buildSdOptions` 透传新增质量字段 |
| `src/renderer/components/Character/CharacterDialogueChat/ExpressionGenerateModal.tsx` | `DEFAULT_SD_CONFIG` 更新采样器/ADetailer/Hires.fix 默认值 + `buildSdOptions` 透传新增质量字段 |

**向后兼容**：`DEFAULT_SD_CONFIG` 作为 `{ ...DEFAULT_SD_CONFIG, ...settingResult.setting.sdWebui }` 的兜底基座，旧配置缺失新字段时自动使用默认值，不会出现 `undefined`。

### 14.35 ADetailer 面部修复专用参数（2026-07-29 源码核验新增）

**【重点标记 - 源码核验驱动】** 本节记录通过直接核验 `G:\AI\sd-webui-forge-neo` 源码发现的两项未被利用的 ADetailer 高价值参数，以及 img2img 不支持 Hires.fix 的源码级确认。

#### 14.35.1 源码核验过程

核验以下源码文件：
- `extensions/ADetailer-Neo/lib_adetailer/args.py:43-85` —— `ADetailerArgs` pydantic 模型完整字段定义
- `modules/processing.py:143-190` —— 基类 `StableDiffusionProcessing` 字段
- `modules/processing.py:1210-1227` —— `StableDiffusionProcessingTxt2Img` 的 Hires.fix 字段
- `modules/processing.py:1655-1677` —— `StableDiffusionProcessingImg2Img` 字段

#### 14.35.2 核验结论：img2img 确认不支持 Hires.fix

| 类 | 文件行号 | 是否含 `enable_hr` / `hr_*` |
|----|---------|---------------------------|
| `StableDiffusionProcessing`（基类） | processing.py:143-190 | ❌ 无 |
| `StableDiffusionProcessingTxt2Img` | processing.py:1210-1227 | ✅ 有（`enable_hr` / `hr_scale` / `hr_upscaler` / `hr_second_pass_steps` / `hr_additional_modules` / `hr_sampler_name` / `hr_scheduler` / `hr_prompt` / `hr_negative_prompt` / `hr_cfg` / `hr_distilled_cfg`） |
| `StableDiffusionProcessingImg2Img` | processing.py:1655-1677 | ❌ 无（仅有 `init_images` / `denoising_strength` / `mask` / `mask_blur` / `inpainting_fill` / `inpaint_full_res` / `initial_noise_multiplier` 等 img2img 专属字段） |

**结论**：img2img API 无法通过 `enable_hr=true` 触发 Hires.fix，§14.33 的 two-step 替代方案是唯一可行路径。

#### 14.35.3 新增 ADetailer 参数

从 `ADetailerArgs`（args.py:43-85）中发现两项未被利用的高价值参数：

| 参数名 | 源码行号 | 类型/范围 | 默认值 | 作用 |
|--------|---------|----------|--------|------|
| `ad_negative_prompt` | args.py:50 | `str` | `""` | ADetailer 独立负面提示词，可针对性优化面部修复 |
| `ad_use_noise_multiplier` | args.py:78 | `bool` | `False` | 是否启用独立噪声倍率 |
| `ad_noise_multiplier` | args.py:79 | `float`（0.5-1.5） | `1.0` | 面部修复噪声注入量，增大可增加细节 |

**改进前**：`ad_negative_prompt` 直接复用主 `negativePrompt`（`executeImg2ImgPass` 中 `ad_negative_prompt: negativePrompt`），无法为面部修复配置专用负面提示词。

**改进后**：
1. `ad_negative_prompt` 优先使用 `options.adNegativePrompt`（若非空），否则回退到主 `negativePrompt`。用户可配置如 "deformed, distorted, disfigured, bad face, wrong anatomy" 专用于面部修复
2. 新增 `ad_use_noise_multiplier = true` + `ad_noise_multiplier = 1.0`，控制面部修复细节丰富度

#### 14.35.4 涉及文件

| 文件 | 修改内容 |
|------|---------|
| `src/main/services/sdGenerationService.ts` | `SDGenerationOptions` 接口新增 `adNegativePrompt?` / `adUseNoiseMultiplier?` / `adNoiseMultiplier?` 三个字段；`executeImg2ImgPass` 的 ADetailer 构建逻辑修改 `ad_negative_prompt` 取值策略 + 新增噪声倍率注入 |
| `src/renderer/types/setting.ts` | `SDWebuiConfig` 新增 `adNegativePrompt: string` / `adUseNoiseMultiplier: boolean` / `adNoiseMultiplier: number` 类型字段 |
| `src/shared/settings.ts` | `defaultSetting.sdWebui` 新增默认值 `adNegativePrompt: ''` / `adUseNoiseMultiplier: true` / `adNoiseMultiplier: 1.0` |
| `src/renderer/components/Settings/SDWebuiSettings.tsx` | `DEFAULT_SD_WEBUI_CONFIG` 新增默认值 + ADetailer 折叠面板内新增 UI 控件（TextArea 负面提示词 + Switch 启用开关 + InputNumber 噪声倍率） |
| `src/renderer/components/Character/CharacterDialogueChat/AssetGenerateModal.tsx` | `DEFAULT_SD_CONFIG` 新增默认值 + `buildSdOptions` 透传 3 个新字段 |
| `src/renderer/components/Character/CharacterDialogueChat/ExpressionGenerateModal.tsx` | `DEFAULT_SD_CONFIG` 新增默认值 + `buildSdOptions` 透传 3 个新字段 |

**向后兼容**：旧配置缺失这 3 个新字段时，`sdGenerationService` 的 `??` 兜底逻辑使用默认值（空负面提示词回退主负面、噪声倍率 1.0），行为与改进前一致。

---

### 14.36 按角色独立存储 LoRA 模型（2026-07-29 Bug 修复，用户反复提示后修复）

**【重点标记 - 跨角色 LoRA 污染 Bug】** 本节记录修复 A 角色 LoRA 污染 B 角色生成的完整方案。用户反馈：在 A 角色通过 LoRA 生成图片后，切换到 B 角色生成时 A 角色的 LoRA 被自动带入，违反「每个角色使用单独 LoRA」的设计预期。

#### 14.36.1 Bug 根因分析

原实现将 LoRA 选择存储在全局 `AppSetting.sdWebui.selectedLoras`（`src/shared/settings.ts`）中：

1. 用户在 A 角色的素材管理 Tab 中点击 LoRA 标签 → 打开 `LoraSelectModal` → 选择 LoRA → `onConfirm` 回调执行 `setSdConfig((prev) => ({ ...prev, selectedLoras: loras }))`，仅写入组件本地 state
2. 但生成弹窗（`AssetGenerateModal` / `ExpressionGenerateModal`）初始化时通过 `window.electronAPI.setting.load()` 读取全局配置 `setting.sdWebui`，其中 `selectedLoras` 字段在部分代码路径中可能被持久化到全局设置
3. 切换到 B 角色打开生成弹窗时，`buildSdOptions` 中 `selectedLoras: sdConfig.selectedLoras` 读取到的仍是 A 角色残留的 LoRA 配置，导致污染

**核心问题**：LoRA 配置是「角色维度」的数据（每个角色应有独立的 LoRA 列表），但原实现存储在「全局维度」（`AppSetting.sdWebui`），数据维度不匹配导致跨角色污染。

#### 14.36.2 修复方案：按角色卡独立存储

参考 `characterTraitService`（§14.21）的按角色存储模式，实现 LoRA 配置的角色级隔离：

```
{userData}/data/character-loras/{sha256(characterCardId).slice(0,16)}/loras.json
```

每个角色卡通过 SHA-256 哈希（取前 16 位）生成独立目录，目录内 `loras.json` 存储该角色的 LoRA 清单。

#### 14.36.3 新增文件

| 文件 | 职责 |
|------|------|
| `src/main/services/characterLoraService.ts` | 主进程服务，按角色卡 ID 哈希生成存储路径，提供 `loadLoras` / `saveLoras` 方法。`CharacterLoraManifest` 接口含 `characterCardId` / `version` / `loras` 三字段 |
| `src/main/ipc/handlers/characterLoraHandlers.ts` | IPC 处理器，注册 `character-lora:list` / `character-lora:save` 两个通道 |
| `src/renderer/stores/characterLoraStore.ts` | Zustand store，封装 IPC 调用。`saveLoras` 采用乐观更新 + 失败回滚策略；不使用 persist（数据由主进程持久化到磁盘） |

#### 14.36.4 修改文件

| 文件 | 修改内容 |
|------|---------|
| `src/main/preload.ts` | `electronAPI` 新增 `characterLora.{list, save}` 方法，透传 IPC |
| `src/renderer/types/electron.d.ts` | `ElectronAPI` 接口新增 `characterLora` 字段类型定义 |
| `src/main/ipc/index.ts` | 新增 `import { registerCharacterLoraHandlers }` + 调用注册 |
| `src/renderer/components/Character/CharacterDialogueChat/AssetManagerModal.tsx` | 引入 `useCharacterLoraStore`；LoRA 标签展示 / 删除 / `LoraSelectModal` 的 `selectedLoras` 与 `onConfirm` 均改为角色专属存储 |
| `src/renderer/components/Character/CharacterDialogueChat/AssetGenerateModal.tsx` | 引入 `useCharacterLoraStore`；初始化时 `loadCharacterLoras(characterCardId)`；`buildSdOptions` 中 `selectedLoras` 改用 `characterLoras`；`LoraSelectModal` 的 `onConfirm` 改为 `saveCharacterLoras`；LoRA 计数 Tag 改用 `characterLoras.length` |
| `src/renderer/components/Character/CharacterDialogueChat/ExpressionGenerateModal.tsx` | 同 `AssetGenerateModal`，全面替换 `sdConfig.selectedLoras` → `characterLoras` |

#### 14.36.5 数据流

```
打开生成弹窗（open=true, characterCardId=xxx）
  → useEffect 初始化：loadCharacterLoras(characterCardId)
  → IPC: character-lora:list → characterLoraService.loadLoras → 读取 loras.json
  → store.loras 更新

用户点击 LoRA 标签 → LoraSelectModal 打开
  → selectedLoras={characterLoras}（角色专属）
  → 用户选择/调整权重 → onConfirm(loras)
  → saveCharacterLoras(characterCardId, loras)
  → IPC: character-lora:save → characterLoraService.saveLoras → 写入 loras.json
  → store.loras 更新（乐观更新）

用户点击「生成」
  → buildSdOptions() → selectedLoras: characterLoras（角色专属，无污染）
  → sd.generateExpression / generateTxt2Img → applyTraitsAndLora 注入 LoRA 标签
```

#### 14.36.6 向后兼容

- 全局 `AppSetting.sdWebui.selectedLoras` 字段保留（`SDWebuiConfig` 类型未删除该字段），但生成弹窗不再读取该字段，仅作为类型兼容保留
- 角色卡首次打开时 `loras.json` 不存在，`loadLoras` 返回空数组 `[]`，行为等同于未选择 LoRA
- `LoraSelectModal` 的 `selectedLoras` prop 类型为 `Array<{ name: string; weight: number }>`，与 `characterLoraStore.LoraItem` 类型一致，无需适配

---

### 14.37 图片生成自定义尺寸选择 SizeSelector（2026-07-29 新增）

- **能力**：渲染进程侧可复用尺寸选择组件，为所有 SD 图片生成弹窗（`AssetGenerateModal` §14.26 / `ExpressionGenerateModal` §14.17）提供预设尺寸下拉 + 自定义宽高输入，每次生成独立应用（不写入全局设置）。
- **文件**：`src/renderer/components/Character/CharacterDialogueChat/SizeSelector.tsx`

#### 14.37.1 预设尺寸

| 预设 | 尺寸 | 适用场景 |
|------|------|---------|
| 头像/表情 | 512×512 | 适合头像和表情图片 |
| 全身立绘 | 512×768 | 适合全身立绘场景 |
| 竖版高清 | 768×1024 | 适合高清立绘/半身像 |
| 方图高清 | 1024×1024 | 适合高质量方图（默认） |
| 竖版超清 | 1024×1536 | 适合超清全身立绘 |
| 横版高清 | 1536×1024 | 适合横构图/宽幅场景 |
| 自定义 | 用户输入 | 手动输入宽高（64-2048） |

预设尺寸设计依据：512 系列适合 SD 1.5 模型及小图快速生成；768/1024/1536 系列覆盖 SDXL 推荐分辨率区间（总像素量 ≈ 1024²），包含竖/方/横三种构图。

#### 14.37.2 交互逻辑

- **预设选择**：Select 下拉选择预设 → 直接 `onChange(width, height)`，即时生效
- **自定义模式**：Select 选择"自定义" → 展示两个 InputNumber（宽/高，min=64 max=2048 step=64），实时校验超范围显示红色边框 + 错误文案
- **当前尺寸 Tag**：始终显示当前宽×高，超范围时变红
- **无确认按钮**：所有变更通过 `onChange` 直接触发

#### 14.37.3 集成方式

**AssetGenerateModal / ExpressionGenerateModal** 均采用相同模式：

1. **新增 state**：`const [selectedSize, setSelectedSize] = useState({ width: 1024, height: 1024 })`
2. **初始化**：init useEffect 中 `setSdConfig(config)` 后，`setSelectedSize({ width: config.txt2imgWidth ?? 1024, height: config.txt2imgHeight ?? 1024 })`（从全局设置默认值读取）
3. **重置**：关闭 useEffect 中 `setSelectedSize({ width: 1024, height: 1024 })`
4. **UI 渲染**：在 `renderHeader()` 之后、`renderSdUnavailableAlert()` 之前渲染 `<SizeSelector>`，所有生成模式（batch / single）均可见
5. **buildSdOptions**：
   - `txt2imgWidth: selectedSize.width`（txt2img 路径，替代 `sdConfig.txt2imgWidth`）
   - `txt2imgHeight: selectedSize.height`（txt2img 路径，替代 `sdConfig.txt2imgHeight`）
   - `width: selectedSize.width`（img2img 路径覆盖，新增）
   - `height: selectedSize.height`（img2img 路径覆盖，新增）
6. **参数概览 Tag**：新增 `<Tag color="geekblue">尺寸：{selectedSize.width}×{selectedSize.height}</Tag>`

#### 14.37.4 后端：img2img 两步模式缩放

修改 `sdGenerationService.calculateImg2ImgDimensions`（§14.32），当用户指定了 `options.width/height` 时，按 `longSideTarget / 1024` 比例缩放：

- **direct 模式**（longSideTarget=1024）：scale=1.0，直接使用用户尺寸
- **two-step pass 1**（longSideTarget=768）：scale=0.75，缩小到 75% 生成（如用户指定 1024×1024 → pass 1 在 768×768 生成）
- **two-step pass 2**（longSideTarget=1024）：scale=1.0，使用完整尺寸放大修复

这样保留了 two-step 模式"低分辨率生成→高分辨率放大修复"的质量优势，同时尊重用户指定的最终输出尺寸。最小尺寸兜底 64 像素。

#### 14.37.5 与全局设置的关系

- 全局设置 `sdWebui.txt2imgWidth/txt2imgHeight`（`SDWebuiSettings.tsx` 中的 InputNumber）**保留不变**，作为 SizeSelector 的初始默认值来源
- SizeSelector 的选择**不回写**全局设置，每次打开弹窗从全局默认值重新初始化
- 这满足"每次生成独立应用，而非全局统一设置"的设计要求

### 14.38 ⭐ tableEdit 解析器统一 + 越界校验（Spec: implement-agent-foundation-and-fix-defects / F3 + F4，2026-07-30 新增）

- **背景**：项目存在两个高度重复的 tableEdit 解析器（`memory/tableEditParser.ts` 与 `game/GameTableEditParser.ts`），逻辑高度重复且 insertRow/deleteRow/updateRow 的索引转换未校验，存在越界崩溃风险（F3）；两处重复逻辑需统一（F4）
- **F4 统一方案**（内部重构，对外 API 完全不变）：
  - 新建公共基类 `src/main/services/memory/tableEditParserBase.ts` 的 `TableEditParserBase`（抽象类）
  - `memory/tableEditParser.ts` 改为薄适配层（继承 Base，保留 `tableEditParser.parse` 单例与 `TableEditCommand` / `ParseResult` 接口导出）
  - `game/GameTableEditParser.ts` 改为薄适配层（继承 Base，保留 `GameTableEditParser` 类、`gameTableEditParser` 单例、`parse` / `stripTableEditTags` 方法）
- **Base 公共逻辑清单**：
  - `extractBlocks(text, regexes[])`：按一组正则依次提取块内容，自动剔除已消费部分避免重复（兼容 memory 单正则与 game 双正则去重）
  - `parseDataObject(dataStr)`：JSON 数据对象容错解析（清理嵌套 HTML 注释 → 直接 parse → 规范化重试），失败返回 null
  - `normalizeJsonObject(str)`：非标准 JSON 规范化（未加引号键名 / 单引号键名 / 单引号值 / 尾逗号）
  - `isPlainObject` / `toStringValueMap`：类型判断与值转字符串（null/undefined → ''，嵌套对象 → JSON 序列化）
  - `convertFieldIndicesToZeroBased(data, maxColumnIndex?)`：字段索引 1→0 转换 + 非负校验（F3）
  - `validatePositiveIndex` / `validateNonNegativeIndex`：索引校验原语
  - `tryParseLine(line, regexSpec, opts)`：命令行分派（顺序 updateRow → insertRow → deleteRow），返回统一中间结构 `ParsedCommandCore`
- **F3 越界校验点**（统一在 Base 中实现，校验失败一律"跳过 + 警告"，不崩溃不中断整体流程）：
  - **parseInsertRow**：sheetIndex 必须为正整数（1-based 协议最小为 1），否则跳过整条命令并警告；字段索引 1→0 转换后 < 0（如原键为 `"0"`）跳过该字段并警告；非整数键（命名键）保持原样不转换（容错）
  - **parseUpdateRow**：sheetIndex / rowIndex 必须为正整数，否则跳过整条命令并警告；字段索引同 insertRow
  - **parseDeleteRow**：sheetIndex / rowIndex 必须为正整数，否则跳过整条命令并警告
  - **列范围校验**（`< 列数`）：parser 阶段不知道列数，需 `maxColumnIndex` 参数；当前 parser 不传，列范围校验留给 executor（`TableEditCommandExecutor` 已有 `rowIndex >= 0 && rowIndex < length` 校验）
- **两个适配层差异**（保持各自对外行为不变）：

  | 维度 | memory 适配层 | game 适配层 |
  |------|---------------|-------------|
  | 对外方法 | `parse(text)` | `parse(text)` + `stripTableEditTags(text)` |
  | 返回结构 | `{success, commands, errors}` | `{commands, errors}` |
  | 命令字段 | `tableIndex` / `rowIndex` / `data` / `rawCommand` | `sheetIndex` / `rowIndex` / `rowData` / `raw` |
  | 索引语义 | parser 阶段 1→0 转换 | 保持 1-based（由 `GameTableRepository.applyTableEdits` 转换） |
  | 字段索引 | 1→0 转换 + 非负校验 | 保持原样不转换 |
  | 命令正则 | 非 anchored | anchored + `i` 标志 |
  | 未识别行 | debug 日志"跳过非命令行" | push error"无法解析的命令行" |
  | ParseLineOptions | `convertIndicesToZeroBased: true` / `convertFieldIndices: true` | 两者均 `false` |

- **调用点验证**（API 签名未变，所有调用方无需改动）：
  - memory 侧：`TableOrganizeService.ts` / `organizeOrchestrator.ts` / `memoryTableHandlers.ts` 调用 `tableEditParser.parse(text)`；`TableEditCommandExecutor.ts` / `tableOperationExecutor.ts` 导入 `TableEditCommand` 类型
  - game 侧：`GameNarrativeService.ts` 调用 `gameTableEditParser.parse(text)` + `.stripTableEditTags(text)`；`GameTableEditParser.test.ts` 实例化 `new GameTableEditParser()`
- **验证结果**：
  - `npx tsc --noEmit`：重构涉及的三个文件零类型错误（项目预存错误与本重构无关）
  - `npx vitest run GameTableEditParser.test.ts`：36 个测试全部通过（对外行为完全不变）
  - 相关测试 `GameSaveRepository.test.ts`（38）、`ManagementNarrativeService.test.ts`（19）、`gameHandlers.test.ts`（24）全部通过
- **文件**：
  - 新建：`src/main/services/memory/tableEditParserBase.ts`（公共基类，~360 行）
  - 修改：`src/main/services/memory/tableEditParser.ts`（改为薄适配层，~190 行）
  - 修改：`src/main/services/game/GameTableEditParser.ts`（改为薄适配层，~210 行）
- **标记**：F3 修复了原 `parseInsertRow` 对 `key='0'` 生成 `'-1'` 负索引字段的潜在越界 bug；F4 消除两个解析器间的逻辑重复，后续 bug 修复只需改 Base 一处

---

### 14.39 ⭐ 智能体底座 infra/ 基础设施（Spec: implement-agent-foundation-and-fix-defects / 阶段 1 Task 4，2026-07-30 新增）

照抄/适配 openclaw 核心基础设施，为 agentLoop / memory / skills / learning 模块提供低耦合工具层。

#### 14.39.1 文件结构
```
src/main/services/agent/infra/
├── backoff.ts       # 照抄 openclaw packages/retry：指数退避 + 可中止 sleep
├── retry.ts         # 适配 openclaw packages/retry：异步重试运行器 + 有状态控制器
├── dedupe.ts        # 照抄 openclaw src/infra/dedupe：TTL+LRU 去重缓存
├── errors.ts        # 适配 openclaw 错误分类：AgentError + 9 类分类 + isRetryable
├── sqliteUtils.ts   # 新增：WAL 模式 + 事务封装 + 语句缓存（动态加载 better-sqlite3）
└── index.ts         # barrel export
```

#### 14.39.2 核心接口
- **`computeBackoff(policy, attempt)`**：指数退避延迟计算（含抖动）
- **`sleepWithAbort(ms, abortSignal)`**：可中止的 sleep（AbortSignal 触发立即 reject）
- **`retryAsync(fn, attemptsOrOptions, initialDelayMs)`**：异步重试运行器，支持 jitter / Retry-After / shouldRetry / onRetry
- **`RetrySupervisor`**：有状态重试控制器（cancel / reset / next + AbortSignal 集成）
- **`createDedupeCache(options)`**：TTL+LRU 去重缓存（check / peek / delete / clear / size）
- **`AgentError`**：统一错误基类，携带 category / retryable / statusCode / context
- **`openAgentDatabase(dbPath)`**：WAL 模式打开 SQLite（动态加载 better-sqlite3）
- **`runTransaction(db, fn)`**：同步事务封装（遵循 openclaw AGENTS.md：事务内不 await）

#### 14.39.3 照抄/适配决策
| 文件 | 决策 | 理由 |
|------|------|------|
| backoff.ts | 照抄 | 纯逻辑无依赖 |
| retry.ts | 适配 | 去除 packages/retry + secure-random 依赖链，核心算法内联 |
| dedupe.ts | 适配 | 去除 packages/normalization-core + map-size 依赖，WeakMap→Map（ES2020 不支持 symbol 键） |
| errors.ts | 适配 | 合并项目现有错误码（network/server/api/validation/unknown） |
| sqliteUtils.ts | 新增 | openclaw 用 Kysely，本项目直接用 better-sqlite3 精简封装 |

#### 14.39.4 ES2020 兼容性修复
- Error 构造函数 `cause` 选项在 ES2022 才支持，项目 target ES2020 → 手动 `(err as any).cause = value`
- WeakMap 不支持 symbol 键 → 改用 Map（symbol 数量有限，无泄漏风险）

---

### 14.40 ⭐ 智能体底座 contracts.ts + 类型契约（Spec: implement-agent-foundation-and-fix-defects / 阶段 1 Task 5，2026-07-30 新增）

跨模块接口契约层，确保 core/llm/memory/skills/learning 五大模块低耦合。

#### 14.40.1 contracts.ts（自研）
定义五大模块接口：
- **`ILLMProvider`**：LLM 提供方（streamChat + probeCapabilities），实现方 AIServiceAdapter
- **`IToolProvider`**：工具提供方（listTools + getToolDefinitions + executeTool + isToolAvailable），实现方 ToolRegistry
- **`IMemoryProvider`**：记忆提供方（search + write + read + delete），实现方 memoryStore（通过 adapters 桥接现有资产）
- **`ISkillRegistry`**：技能注册中心（register + list + buildSnapshot + invoke），实现方 skillRegistry
- **`ILearningScheduler`**：学习调度器（start + stop + dreamNow + schedule + cancel），实现方 cronScheduler
- **`AgentRunIntent` / `AgentRunResult`**：AgentCore.run 入口与返回
- **`ToolCall`**：OpenAI tool_calls 协议类型（id / type / function.name / function.arguments）

#### 14.40.2 skills/types.ts（适配 openclaw src/skills/types）
- **`SkillEntry`**：技能注册条目（skill + frontmatter + metadata + invocation + exposure）
- **`SkillExposure`**：三层可见性（includeInRuntimeRegistry / includeInAvailableSkillsPrompt / userInvocable）
- **`SkillInvocationPolicy`**：双调用策略（userInvocable + disableModelInvocation）
- **`SkillSnapshot`**：会话快照（注入 prompt 的可用技能列表）
- 简化 SkillInstallSpec（本项目无需 brew/go/uv 多语言安装）

#### 14.40.3 tools/types.ts（适配 openclaw src/tools/types）
- **`ToolDescriptor`**：工具描述符（name + description + inputSchema + owner + availability）
- **`ToolAvailabilityExpression`**：声明式可用性（always / config / env / context / capability + allOf / anyOf）
- **`evaluateAvailability(expr, ctx)`**：可用性求值函数
- 简化 ToolOwnerRef（仅 core/plugin，无 channel/mcp）

---

### 14.41 ⭐ F2 修复：ChatEngine 消息校验 + F6 取消错误反馈（Spec: implement-agent-foundation-and-fix-defects / 阶段 0，2026-07-30）

#### 14.41.1 F2：消息序号/完整性校验
- **根因**：`ChatEngine.sendMessage` 仅 `filter(msg => msg.role !== 'system')`，未校验内容/状态/角色合法性
- **修复**：新增 `sanitizeChatHistory(messages)` 私有方法，统一清洗：
  1. 剔除 system 角色
  2. 剔除 status='error' 的失败消息
  3. 剔除空内容（trim 后为空）的消息
  4. 仅保留 role ∈ {user, assistant}
  5. content 强制 String 化
  - 每条被剔除的消息记录 console.warn 供审计

#### 14.41.2 F6：取消机制错误反馈
- **根因**：`cancelRequest` 中 `.catch(() => {})` 静默吞掉取消失败
- **修复**：取消失败时通过 `errorCallback` 回传前端；用 `as any` 绕过 electronAPI.ai 类型未声明 cancel 的问题

### 14.42 ⭐ Embedding 缓存 LRU + SQLite 持久化（Spec: implement-agent-foundation-and-fix-defects / 阶段 2 Task 10，2026-07-30 新增）

P1 性能修复：每次 `generateEmbedding` 都重复调用远程 API / 本地 ONNX 推理，对世界书条目、角色描述等高频重复文本产生冗余请求。新增 content-hash → vector 双轨缓存（内存 LRU + SQLite 持久化），跨进程重启复用 embedding 结果。

#### 14.42.1 EmbeddingCache（内存 LRU + 持久化双轨）
- **文件**：[EmbeddingCache.ts](src/main/services/EmbeddingCache.ts)
- **缓存键**：`SHA-256(normalizedText + '|' + modelName)`，标准化 `trim + lowercase` 提升相似文本命中率
- **LRU 内存层**：Map 插入序实现 LRU（get/set 时重新插入到末尾，超 maxSize 删除首条目）+ TTL 过期 + 按模型名隔离 + 命中/未命中/淘汰统计
- **SQLite 持久化层**（可选，`attachPersistence` 注入）：
  - `get`：内存未命中 → 查 SQLite → 命中则回填内存（warm-up）
  - `set`：内存 + SQLite UPSERT 双写
  - `clear` / `invalidateByModel`：内存 + SQLite 双清
  - `delete`：双删避免回填已失效条目
- **向量序列化**：`Float32Array ↔ Buffer`（4 字节/维，较 JSON 字符串 ~15 字节/维节省 ~70% 存储）
- **降级保护**：持久化异常内部捕获并记 `persistenceErrors`，不阻断 get/set；无持久化时纯内存模式正常工作
- **maxSize 构造**：允许任意正数（含小值，便于测试 LRU 淘汰），非正数/缺省回退 1000

#### 14.42.2 SqliteEmbeddingCachePersistence
- **文件**：[EmbeddingCache.ts](src/main/services/EmbeddingCache.ts)
- 复用 `AgentSqliteBackend`（共享 WAL 连接 + `embedding_cache` 表）
- `get` 命中时同步更新 `last_accessed_at`（持久化侧 LRU 近似）
- `upsert` 使用 `ON CONFLICT(cache_key) DO UPDATE` 幂等写入
- `backend.isInitialized=false` 时所有操作安全返回（不抛错）

#### 14.42.3 embedding_cache 表 schema
- **文件**：[sqliteBackend.ts](src/main/services/agent/memory/sqliteBackend.ts)（`AGENT_SCHEMA_STATEMENTS` 第 6 张表）
- 字段：`cache_key` TEXT PK / `model_name` TEXT / `vector` BLOB / `dimension` INTEGER / `mode` TEXT / `created_at` INTEGER / `last_accessed_at` INTEGER
- 索引：`idx_embedding_cache_model`（按模型名删除）/ `idx_embedding_cache_last_accessed`（LRU 近似淘汰）

#### 14.42.4 启动期接入：initAgentBackendIfNeeded
- **文件**：[sqliteBackend.ts](src/main/services/agent/memory/sqliteBackend.ts)
- 幂等懒初始化 Agent SQLite 后端：`<userData>/agent/memory.db`（`path.join` 跨平台）+ 目录创建 + `openAgentDatabase`（WAL + foreign_keys + busy_timeout + synchronous=NORMAL）+ `ensureSchema`
- 失败（better-sqlite3 未安装等）记 `initError` 返回 null，调用方降级（不抛错）
- 调用点：`registerAgentHandlers`（[agentHandlers.ts](src/main/ipc/handlers/agentHandlers.ts)）+ `EmbeddingService.initialize`（[EmbeddingService.ts](src/main/services/EmbeddingService.ts) 的 `initPersistence`）

#### 14.42.5 【重点标记】配套 Bug 修复
1. **cacheEmbeddingResult 方法缺失（运行时崩溃）**：`generateEmbedding` 成功后调用 `this.cacheEmbeddingResult(...)` 但该方法从未定义，embedding 一成功即抛 `TypeError`。新增私有方法（仅 `result.success && result.vector` 时写入，dimension 缺省回退 `vector.length`）。
2. **localModelName 误用（缓存键隔离失效）**：缓存键模型名用 `vectorConfig?.localModelName`（无此字段，恒 undefined），本地模式缓存键始终 `'local-default'`，切换本地模型后命中错误向量。修正为 `localModel`（与 EmbeddingWorkerService 一致）。
3. **normalizeVector 编译错误**：方法体缺失 `const magnitude = ...`、结构错乱导致编译失败。补回 + 零向量保护。
4. **Agent SQLite 后端从未初始化**：`registerAgentHandlers` 注册了 IPC 但从未 `getAgentBackend().init()`，`memory:search` 永远走 catch 返回空。由 `initAgentBackendIfNeeded` 修复。
5. **VectorConfig.remoteApiKeyTransmission 类型声明缺失**：字段由 storageService 持久化但接口未声明，补回 `?: 'header' | 'body'`。
6. **globalThis 索引签名**：`getEmbeddingService` 改用 `globalThis as unknown as {...}` 安全断言。

#### 14.42.6 验证
- **单测**：[EmbeddingCache.test.ts](src/main/services/__tests__/EmbeddingCache.test.ts) 18 用例全过（LRU/TTL/模型隔离/双写/回填/序列化往返/降级/双清/未初始化降级）
- **Electron 冒烟**：[smoke-embedding-cache.js](scripts/smoke-embedding-cache.js) 验证真实 better-sqlite3 链路 round-trip maxDiff=1.19e-8
- **部署**：`npm install --ignore-scripts`（系统 Node 24 无预编译二进制）后 `npx electron-rebuild -f -w better-sqlite3` 编译为 Electron 33 ABI

#### 14.42.7 涉及文件
| 文件 | 变更 |
|------|------|
| [EmbeddingCache.ts](src/main/services/EmbeddingCache.ts) | 新增 LRU + 持久化双轨 + SqliteEmbeddingCachePersistence |
| [EmbeddingService.ts](src/main/services/EmbeddingService.ts) | 接入缓存 + initPersistence + cacheEmbeddingResult + bug 修复 |
| [sqliteBackend.ts](src/main/services/agent/memory/sqliteBackend.ts) | embedding_cache 表 + initAgentBackendIfNeeded + EmbeddingCacheRow |
| [agentHandlers.ts](src/main/ipc/handlers/agentHandlers.ts) | 启动期 initAgentBackendIfNeeded |
| [vectorConfig.ts](src/main/types/vectorConfig.ts) | remoteApiKeyTransmission 声明 |

### 14.43 ⭐ WorldBook 关键词倒排索引（Aho-Corasick + 增量更新）（Spec: implement-agent-foundation-and-fix-defects / 阶段 2 Task 11，2026-07-30 新增）

#### 14.43.1 问题与方案
- **瓶颈**：`ContextManager` 每条消息都调用 `worldBookService.matchKeywords`，原实现每次重新读盘 + `matchWorldBookKeywords` 新建 `WorldBookKeywordMatcher`，对**所有条目**逐个 `matchEntry`，每条目再对每个主关键词 `text.includes(key)` —— 复杂度 O(Σ|key| × |text|) 每消息。典型规模（500 条目 × 3 关键词 × 5000 字文本）≈ 7.5M 字符比较/消息。
- **方案**：① 用 **Aho-Corasick 自动机** 对所有主关键词单趟扫描文本 O(|text|+|matches|) 找出命中的关键词；② 用 **关键词→uid 倒排 Map** 反查候选条目；③ 仅对候选运行原 `matchEntry`（selectiveLogic/probability/评分逻辑不变）。候选集 ⊇ 真正激活集 → **零假阴性、零行为回归**。
- **决策**：自研（openclaw 无对应实现，其世界书匹配依赖 SillyTavern world-info.js；spec §三决策表未列入照抄项）。

#### 14.43.2 WorldBookKeywordIndex（[WorldBookKeywordIndex.ts](src/main/services/WorldBookKeywordIndex.ts)）
- **AhoCorasick 类**：并行数组实现（`children: Map<char,nodeId>[]` / `fail[]` / `output[]` / `dictOutput[]`），`insert` → `build`（BFS 算 fail 链 + 预计算 dictOutput）→ `search` 返回 `{keyword, end}[]`。支持任意字符（中文/空格/标点），大小写由调用方 normalize。
- **WorldBookKeywordIndex 类**：
  - `entries: Map<uid, entry>`（始终当前）+ `primaryKeyIndex: Map<normalizedKey, {primaryUids, isSingleWord, length}>`（重建产物）+ `ac: AhoCorasick`
  - `rebuild(entries)`：批量替换 + 置 dirty
  - `upsertEntry(entry)` / `removeEntry(uid)`：O(1) 更新 entries + 置 dirty（disable 视为删除）
  - `findCandidateEntries(text, {caseSensitive, matchWholeWords})`：若 dirty 或 options 变化则 `ensureBuilt` 懒重建 → AC 扫描 normalize 后的文本 → 整词模式对单字关键词补 `\W` 边界校验 → 反查候选 uid → 返回候选条目（按 uid 升序）
  - `getStats()`：entryCount / distinctPrimaryKeys / acNodes / dirty / lastBuildMs（诊断用）
- **懒重建理由**：AC 自动机难以高效「删除/改」单关键词，必须重建；倒排 Map 与 AC 同源，统一重建保证一致性。配合 dirty 标志，一批编辑只触发一次重建，而编辑频率远低于匹配频率，摊销成本低。

#### 14.43.3 整词边界对齐（关键正确性细节）
- 原 `matchSingleKey` 在 `matchWholeWords` 模式：多字关键词用 `includes`；单字关键词用正则 `(?:^|\W)(key)(?:$|\W)`。
- 索引侧：AC 报告单字关键词命中位置 `[start, end)` 后，校验 `start-1` 与 `end` 字符是否 `\W` 或字符串边界；多字关键词直接接受。中文字符属 `\W` → 整词模式对中文等价子串匹配，**与原实现一致（刻意保留，勿改）**。

#### 14.43.4 WorldBookKeywordMatcher 重构（[WorldBookKeywordMatcher.ts](src/main/services/WorldBookKeywordMatcher.ts)）
- `match(text)`：原「遍历全部 entries」改为 `index.findCandidateEntries(...)` 取候选 → 仅对候选 `matchEntry`。`matchEntry/matchSecondaryKeys/matchSingleKey/calculateMatchScore` 业务逻辑**完全不变**。
- 新增增量 API：`upsertEntry(entry)` / `removeEntry(uid)` / `rebuild(entries)` / `indexedSize` / `getIndexStats()`，委托给内部 `WorldBookKeywordIndex`。
- `WORLD_INFO_LOGIC` / `KeywordMatchResult` / `KeywordMatchOptions` / `matchWorldBookKeywords` / `formatKeywordMatchResults` 导出保持不变（向后兼容）。

#### 14.43.5 worldBookService 按 scope 缓存（[worldBookService.ts](src/main/services/worldBookService.ts)）
- `matchKeywords` 改为复用缓存的 matcher：缓存键 = `排序后路径拼接 + '::' + 选项签名(caseSensitive|matchWholeWords|useGroupScoring)`，LRU 上限 16。
- `getOrBuildKeywordMatcher`：命中条件 = 缓存键一致 **且** 每文件 `stat.mtimeMs` 与缓存时一致；未命中则读盘加载 → `new WorldBookKeywordMatcher` → 写缓存。命中时跳过读盘/JSON 解析/AC 重建。
- **双重失效**：① 显式——`writeWorldBook/deleteWorldBook/importWorldBook/setWorldBookDir` 调用 `invalidateKeywordMatcherCache(path)`（path 命中 scope 或全量 scope 即清）；② 隐式——mtime 校验兜底外部编辑。
- **降级**：缓存路径抛错时回退「重新读盘 + 新建 matcher」旧路径，保证不阻断。
- 同时清理热路径冗余日志（原每消息打印 300 字文本 + 逐匹配日志），仅保留命中摘要。

#### 14.43.6 验证
- **单测**：[WorldBookKeywordIndex.test.ts](src/main/services/__tests__/WorldBookKeywordIndex.test.ts) 26 用例全过
  - AC 正确性：子串/大小写/重叠/前缀/无假阳性
  - 候选筛选：命中/未命中/disable/共享关键词/整词边界（单字 \W / 多字 includes / 中文）/空文本/无主关键词
  - 增量更新：upsert/remove/懒重建/disable 等价删除/同 uid 覆盖/不存在的 uid 不置 dirty/options 变化触发重建/getStats
  - **等价性（核心）**：手工用例（跨 4 种 selectiveLogic + 整词 + 大小写）+ **200 轮随机 fuzz**——索引版 `WorldBookKeywordMatcher.match` 与朴素 O(n) `naiveMatch` 结果完全一致（uid/matchedKeys/matchType/matchScore 全等）
  - 增量 API 等价：upsert+remove 路径与 rebuild 全量路径结果一致
- **typecheck**：改动文件（WorldBookKeywordIndex.ts / WorldBookKeywordMatcher.ts / worldBookService.ts）零 TS 错误。

#### 14.43.7 涉及文件
| 文件 | 变更 |
|------|------|
| [WorldBookKeywordIndex.ts](src/main/services/WorldBookKeywordIndex.ts) | 新增：AhoCorasick + WorldBookKeywordIndex + 倒排索引 + 懒重建 |
| [WorldBookKeywordMatcher.ts](src/main/services/WorldBookKeywordMatcher.ts) | 重构：match 用索引筛候选；新增 upsertEntry/removeEntry/rebuild/indexedSize/getIndexStats |
| [worldBookService.ts](src/main/services/worldBookService.ts) | matchKeywords 接入按 scope 缓存 matcher + mtime 校验 + 写路径失效 + 降级 |
| [WorldBookKeywordIndex.test.ts](src/main/services/__tests__/WorldBookKeywordIndex.test.ts) | 新增：26 用例（含 200 轮 fuzz 等价性） |

### 14.44 ⭐ storageService / chatSessionRepository 异步化（fs.promises + WAL）（Spec: implement-agent-foundation-and-fix-defects / Task 12）

#### 14.44.1 问题与方案

**问题**：`chatSessionRepository.ts` 全量使用 `fs.*Sync` 同步 API（`readFileSync` / `readdirSync` / `statSync` / `openSync` / `readSync` / `closeSync` / `existsSync`），在 Electron 主进程读取大型 JSONL 聊天记录时阻塞事件循环，导致 IPC 请求排队、UI 卡顿。`storageService.ts` 的 `ensureGenericPersona` / `ensureModuleDirectories`（启动期路径）与 `getSettings` / `setSettings`（直接读写 `settings.json`）同样使用同步 I/O。

**方案**（spec §4.2 P3/P4）：
- `chatSessionRepository.ts` 全量异步化：所有 I/O 函数改为 `async` + `fs.promises`（`fsp.open + filehandle.read` 替代 `openSync/readSync`，`fsp.readdir/stat/readFile/access/mkdir` 替代同步版本）
- `storageService.ts` 定向异步化：启动期路径（`ensureGenericPersona` / `ensureModuleDirectories`）改用 `fsp`；新增 `getSettingsAsync` / `setSettingsAsync` 异步变体供新代码使用；**保留同步 `getSettings` / `setSettings`** 以兼容 18+ 处旧调用方（遵循 spec「BREAKING: 无 / 现有调用方语义不变」约束）
- SQLite WAL 模式：已由 Task 4.3 `openAgentDatabase` 启用（全项目 SQLite 仅经此入口）

#### 14.44.2 chatSessionRepository 全量异步化（[chatSessionRepository.ts](src/main/services/memory/chatSessionRepository.ts)）

| 函数 | 原 API | 新 API |
|------|--------|--------|
| `readFirstNonEmptyLines` | `fs.openSync/readSync/closeSync` | `fsp.open + fh.read + fh.close` |
| `countNonEmptyLines` | `fs.openSync/readSync/closeSync` | `fsp.open + fh.read + fh.close` |
| `getChatSessions` | `fs.existsSync/readdirSync/statSync` | `fsp.access/readdir/stat` |
| `getChatSession` | `fs.existsSync/statSync` + sync 流式读取 | `fsp.access/stat` + async 流式读取 |
| `getChatMessages` | `fs.existsSync/readFileSync` | `fsp.access/readFile` |
| `readCharacterChatMessages` | `fs.existsSync/readFileSync` | `fsp.access/readFile` |
| `searchChatMessages` | `fs.existsSync/readdirSync/statSync` | `fsp.access/readdir/stat` |
| `searchInChatFile` | `fs.readFileSync` | `fsp.readFile` |
| `filterChatMessages` | `fs.existsSync/readFileSync` | `fsp.access/readFile` |
| `readAndFilterMessages` | sync（委托上述） | async（await 上述） |
| `pruneStaleSessionCache` | `fs.existsSync` | `fsp.access` |
| `splitChatIntoSegments` | 纯逻辑（无 I/O） | **保持同步** |

**缓存保留**：会话元数据缓存（`sessionMetaCache`，mtime+size 键）保留，命中时跳过 I/O。`getChatSession` 命中缓存时直接返回副本，不触发任何异步操作。

#### 14.44.3 调用方适配

| 调用方 | 适配方式 |
|--------|----------|
| [chatLogService.ts](src/main/services/memory/chatLogService.ts) | 5 个包装方法（`getChatSessions/getChatSession/getChatMessages/searchChatMessages/filterChatMessages`）标记 `async` |
| [organizeOrchestrator.ts](src/main/services/memory/organizeOrchestrator.ts) | 3 处直接调用加 `await`（`processChatWithAI:290` / `processChat:334` / 表格整理流程:554，均在 async 函数内） |
| [memorySessionHandlers.ts](src/main/ipc/handlers/memory/memorySessionHandlers.ts) | `getChatSessions` handler 加 `await`（赋值给变量后访问 `.length`）；其余 handler 用 `return` 隐式 await |
| [chatHistoryAdapter.ts](src/main/services/agent/memory/adapters/chatHistoryAdapter.ts) | 已使用 `await`（agent 模块设计时即按 `IChatSessionRepository` async 契约） |

#### 14.44.4 storageService 定向异步化（[storageService.ts](src/main/services/storageService.ts)）

- **`ensureGenericPersona`**：`fs.existsSync/mkdirSync/writeFileSync` → `fsp.mkdir（recursive 幂等）/access/writeFile`
- **`ensureModuleDirectories`**：`fs.existsSync/mkdirSync` → `fsp.mkdir（recursive，省去 existsSync 预检）`
- **新增 `getSettingsAsync` / `setSettingsAsync`**：与同步版读写语义、`sanitizeSettings` 逻辑完全一致，使用 `fsp.readFile/writeFile/mkdir`。供 agent 模块与新代码使用
- **保留同步 `getSettings` / `setSettings`**：18+ 处旧调用方（`AIService` / `AIConfigProvider` / `EmbeddingService` / `VectorConfigManager` / `settingService` / `VecstoreVectorStore` / `VectorStoreService` / `WritingStyleLearningService` / `AIAssistedChapterService` / `characterTraitAIService` / `promptTemplateService` / `memory/aiClient` 等）处于同步初始化路径（构造函数 / 顶层变量），无法改为 async。遵循 spec「BREAKING: 无」约束

#### 14.44.5 SQLite WAL 模式（SubTask 12.2）

已由 Task 4.3 `openAgentDatabase`（[sqliteUtils.ts](src/main/services/agent/infra/sqliteUtils.ts)）启用：
- `journal_mode = WAL`：写前日志，读不阻塞写
- `foreign_keys = ON`：外键约束
- `busy_timeout = 5000`：写冲突时等待 5 秒
- `synchronous = NORMAL`：WAL 模式下足够安全且更快

全项目 SQLite 仅经此入口（`agent_memory` / `agent_usage` / `cron_jobs` / `skills` / `audit` / `embedding_cache` 表），无遗漏。`EmbeddingCache.SqliteEmbeddingCachePersistence` 复用同一连接。

#### 14.44.6 验证

- `npx tsc --noEmit`：修改文件（`chatSessionRepository.ts` / `chatLogService.ts` / `organizeOrchestrator.ts` / `memorySessionHandlers.ts`）零新增错误；`storageService.ts` 的 pre-existing 错误（unused `ipcRenderer` / `initialized` / `event` 参数）与本次改动无关
- `npx vitest run`：26 个 WorldBookKeywordIndex 测试全部通过；35 个 pre-existing 失败（stop sequence 逻辑 / 模板计数 / 导入错误）与本次改动无关

#### 14.44.7 涉及文件

| 文件 | 变更 |
|------|------|
| [chatSessionRepository.ts](src/main/services/memory/chatSessionRepository.ts) | 全量异步化：11 个 I/O 函数改为 async + fs.promises；移除 `fs` 同步导入 |
| [chatLogService.ts](src/main/services/memory/chatLogService.ts) | 5 个包装方法标记 async |
| [organizeOrchestrator.ts](src/main/services/memory/organizeOrchestrator.ts) | 3 处调用加 await |
| [memorySessionHandlers.ts](src/main/ipc/handlers/memory/memorySessionHandlers.ts) | getChatSessions handler 加 await |
| [storageService.ts](src/main/services/storageService.ts) | ensureGenericPersona/ensureModuleDirectories 异步化；新增 getSettingsAsync/setSettingsAsync |

---

### 14.45 ⭐ 写作服务容错 F5/F7 修复（retry + quickFix 一致性）（Spec: implement-agent-foundation-and-fix-defects / Task 13）

#### 14.45.1 问题与方案

**F5 AIAssistedChapterService 无失败重试/回退**（`AIAssistedChapterService.ts:321-395` `callAIService`）：
- 原 `callAIService` 直接 `fetch` → 任何网络抖动 / 5xx / 超时均一次性失败，章节拆分/合并建议功能鲁棒性差
- **方案**：接入 `agent/infra/retry.ts` 的 `retryAsync`，对 transient 错误自动重试 3 次（指数退避 + 抖动），permanent 错误直接抛出

**F7 PlotChecker quickFixSuggestion 格式一致性未校验**（`PlotCheckerService.ts:329,376` `parseCheckResponse`）：
- 原实现 `quickFixable: !!issue.quickFixSuggestion`（基于 AI 原始输入），而 `quickFixSuggestion: validateQuickFixSuggestion(...)` 可能返回 `undefined`（匹配失败），导致 UI 标记「可快速修复」但实际无 suggestion 可执行
- 此外 `validateQuickFixSuggestion` 仅校验字段存在与类型，未校验 `fixedText` 格式合理性（空白 / no-op / 异常长度）
- **方案**：`validateQuickFixSuggestion` 新增 5 类格式校验；`parseCheckResponse` 改为先校验得 `validatedSuggestion` 再据此设 `quickFixable`

#### 14.45.2 F5 重试架构（[AIAssistedChapterService.ts](src/main/services/writing/AIAssistedChapterService.ts)）

```
callAIService(messages, modelConfig, timeoutMs)
  ├─ getConfig() → 配置缺失？throw AI_SERVICE_UNAVAILABLE（permanent，不进重试）
  ├─ attemptOnce(): 单次 fetch 执行器
  │    ├─ fetch(...) → response
  │    ├─ !response.ok → throw AgentError(category=fromHttpStatusCode(status))
  │    ├─ empty content → throw AgentError(category='server', reason='empty_content')
  │    ├─ AbortError → throw AgentError(category='timeout')
  │    ├─ TypeError(fetch/network) → throw AgentError(category='network')
  │    └─ AgentError/其他 → 原样透传
  ├─ retryAsync(attemptOnce, {
  │      attempts: 3, minDelayMs: 300, maxDelayMs: 10_000, jitter: 0.2,
  │      shouldRetry: err => err instanceof AgentError ? err.retryable : false,
  │      onRetry: info => addLog(warn, `attempt=${info.attempt}/${info.maxAttempts}, ...`)
  │    })
  └─ catch (err): AgentError → WritingError 映射
       ├─ category='timeout' → WritingError(TIMEOUT)
       ├─ category='api' (4xx) → WritingError(CONTENT_GENERATION_FAILED)
       ├─ statusCode>=400 → WritingError(CONTENT_GENERATION_FAILED)
       ├─ category='network' → WritingError(AI_SERVICE_UNAVAILABLE)
       ├─ reason='empty_content' → WritingError(CONTENT_GENERATION_FAILED)
       └─ 兜底 → WritingError(CONTENT_GENERATION_FAILED)
```

**重试决策表**（依据 `AgentError.category` 与 `retryable`）：

| 错误类型 | category | retryable | 重试 | 最终 WritingError |
|---------|----------|-----------|------|------------------|
| 配置缺失（baseUrl 空） | - | - | 否（前置检查） | AI_SERVICE_UNAVAILABLE |
| HTTP 400/401/403/422 | api/validation | false | 否 | CONTENT_GENERATION_FAILED |
| HTTP 500/502/503/504 | server | true | 是（3 次） | CONTENT_GENERATION_FAILED（重试耗尽后） |
| HTTP 429 | rateLimit | true | 是（3 次） | CONTENT_GENERATION_FAILED（重试耗尽后） |
| 网络中断（TypeError） | network | true | 是（3 次） | AI_SERVICE_UNAVAILABLE（重试耗尽后） |
| 超时（AbortError） | timeout | true | 是（3 次） | TIMEOUT（重试耗尽后） |
| 空响应 | server | true | 是（3 次） | CONTENT_GENERATION_FAILED（重试耗尽后） |

**关键设计**：
- 每次重试新建 `AbortController`（避免复用已 abort 的 signal）
- `onRetry` 回调通过 `addLog('warn', ...)` 记录 attempt/delayMs/error，便于运维监控
- `AgentError` 携带 `statusCode`/`context.errorText`/`context.reason`，最终映射回 `WritingError` 时保留上下文
- 退避序列：300ms → 600ms → 1200ms（指数退避）+ 20% 抖动，上限 10s（避免长时间阻塞 UI）

#### 14.45.3 F7 校验逻辑（[PlotCheckerService.ts](src/main/services/writing/PlotCheckerService.ts)）

**`validateQuickFixSuggestion(suggestion, chapterContent)` 新增校验链**：

```typescript
// 1. 字段存在与类型（原有）
if (!suggestion?.originalText || !suggestion?.fixedText) return undefined;
if (typeof suggestion.originalText !== 'string' || typeof suggestion.fixedText !== 'string') return undefined;
if (!chapterContent) return undefined;

// 2. F7 新增：fixedText 格式校验
const trimmedFixed = suggestion.fixedText.trim();
if (trimmedFixed.length === 0) return undefined;                          // 空白拒绝
if (suggestion.originalText === suggestion.fixedText) return undefined;   // no-op（完全相同）
if (suggestion.originalText.trim() === trimmedFixed) return undefined;    // no-op（修剪后相同）
if (suggestion.originalText.length > 2000) return undefined;              // 原文过长
if (suggestion.fixedText.length > 5000) return undefined;                 // 修复过长

// 3. 匹配策略（原有）：精确 → 修剪 → 锚点 → position 提取
// ...
```

**`parseCheckResponse` 一致性修复**（dimension issues 与 logic issues 同构）：

```typescript
// 修复前（F7 缺陷）：
quickFixable: !!issue.quickFixSuggestion,  // 基于 AI 原始输入
quickFixSuggestion: issue.quickFixSuggestion
  ? this.validateQuickFixSuggestion(...)   // 可能返回 undefined
  : undefined,
// → 出现 quickFixable=true 但 quickFixSuggestion=undefined 的不一致

// 修复后（F7 修复）：
const validatedSuggestion = issue.quickFixSuggestion
  ? this.validateQuickFixSuggestion(issue.quickFixSuggestion, chapterContent || '')
  : undefined;
if (issue.quickFixSuggestion && !validatedSuggestion) {
  addLog('warn', `维度 ${dim} issue "${issueTitle}" 的 quickFixSuggestion 校验失败，已降级为不可快速修复`);
}
return {
  // ...
  quickFixable: validatedSuggestion !== undefined,  // 基于校验结果
  quickFixSuggestion: validatedSuggestion,
};
// → 恒等式 quickFixable === (quickFixSuggestion !== undefined) 成立
```

#### 14.45.4 测试

| 测试文件 | 用例数 | 覆盖点 |
|---------|-------|-------|
| [AIAssistedChapterService.retry.test.ts](src/main/services/__tests__/AIAssistedChapterService.retry.test.ts) | 12 | 成功不重试 / HTTP 500·429·网络错误·空响应·超时 重试后成功 / HTTP 400·401 不重试 / 重试耗尽抛正确错误码 / baseUrl 缺失直接抛 AI_SERVICE_UNAVAILABLE / onRetry 回调触发 |
| [PlotCheckerService.quickFix.test.ts](src/main/services/__tests__/PlotCheckerService.quickFix.test.ts) | 25 | 字段存在与类型 5 / F7 新增格式校验 6 / 正常匹配策略 4 / 锚点匹配 2 / position 提取 1 / parseCheckResponse 一致性 7 |

#### 14.45.5 验证

- `npx tsc --noEmit`：修改前后错误数一致（21 个 pre-existing 错误均为未改动代码），零新增类型错误
- `npx vitest run`：F5 retry 12/12 通过，F7 quickFix 25/25 通过
- pre-existing 不相关失败 2 个（PromptTemplateService 模板计数 / ChatVectorizationService setup）保持不变

#### 14.45.6 涉及文件

| 文件 | 变更 |
|------|------|
| [AIAssistedChapterService.ts](src/main/services/writing/AIAssistedChapterService.ts) | `callAIService` 接入 `retryAsync`，新增 `attemptOnce` 内部函数 + `AgentError` 错误分类 + `WritingError` 映射；导入 `retryAsync` / `AgentError` / `fromHttpStatusCode` / `getDefaultRetryable` |
| [PlotCheckerService.ts](src/main/services/writing/PlotCheckerService.ts) | `validateQuickFixSuggestion` 新增 5 类格式校验（空白 / no-op×2 / 长度上限×2）；`parseCheckResponse` dimension 与 logic issues 改为先校验再设 `quickFixable`，保证一致性；校验失败 warn 日志 |
| [AIAssistedChapterService.retry.test.ts](src/main/services/__tests__/AIAssistedChapterService.retry.test.ts) | 新增，12 个用例 |
| [PlotCheckerService.quickFix.test.ts](src/main/services/__tests__/PlotCheckerService.quickFix.test.ts) | 新增，25 个用例 |

---

### 14.46 ⭐ skills/ 技能系统模块（SKILL.md 契约 + 三层可见性 + 双调用）（Spec: implement-agent-foundation-and-fix-defects / Task 14）

#### 14.46.1 设计目标与 openclaw 对齐

**目标**（spec §二 Task 14）：照抄/适配 openclaw `src/skills/` 的 SKILL.md 技能契约系统，为 AgentCore 提供标准化技能定义、分类存储、版本管理与动态调用机制。

**openclaw 对齐决策**（spec §三）：
- **直接用**：`SkillEntry` / `SkillExposure`（三层可见性）/ `SkillInvocationPolicy`（双调用策略）/ `SkillSnapshot`（会话快照）类型结构
- **简化**：`SkillInstallSpec`（本项目无需 brew/go/uv 多语言安装）；`ToolOwnerRef`（仅 core/plugin，无 channel/mcp）
- **自研**：`skillContract` 解析（本项目用 YAML frontmatter，非 openclaw 的 TOML）；`skillRegistry`（openclaw 技能注册分散在 discovery/skill-index + loading/workspace，本项目按 `ISkillRegistry` 契约自研精简版）

**三层可见性**（核心设计，参考 openclaw SKILL.md 契约）：
1. `includeInRuntimeRegistry`：是否注册到运行时（可被 `invoke` 调用）
2. `includeInAvailableSkillsPrompt`：是否注入到「可用技能」prompt（模型可见）
3. `userInvocable`：是否在用户命令面板可见

**双调用策略**：
- `userInvocable`：用户可通过命令面板手动调用（默认 true）
- `disableModelInvocation`：禁止模型自主调用，仅用户触发（默认 false）

#### 14.46.2 模块结构

```
src/main/services/agent/skills/
├── skillContract.ts       # SKILL.md 解析 + prompt 格式化
├── skillAvailability.ts   # 声明式可用性评估 + 三层可见性过滤
├── skillLoader.ts         # 加载链（内置 + 工作区）
├── skillSnapshot.ts       # 会话快照构建 + LRU 缓存
├── skillInvoker.ts        # 调用分发（委托 IToolProvider）
├── skillRegistry.ts       # ISkillRegistry 实现（注册/查询/快照/调用）
├── types.ts               # 类型契约（SkillEntry/SkillExposure/...）
├── index.ts               # barrel export
└── builtin-skills/        # 内置技能目录
    ├── plot-check/SKILL.md           # 🔍 剧情检查 → plotCheck
    ├── outline-generate/SKILL.md     # 📋 大纲生成 → outlineGenerate
    ├── chapter-write/SKILL.md        # ✍️ 章节写作 → writeChapter
    ├── description-polish/SKILL.md   # ✨ 描写润色 → polishDescription
    └── table-organize/SKILL.md       # 📊 表格整理 → updateStateTable
```

#### 14.46.3 skillContract.ts（SKILL.md 解析）

[skillContract.ts](src/main/services/agent/skills/skillContract.ts) 适配 openclaw `src/skills/contract.ts`，实现 SKILL.md 文件到 `SkillEntry` 的解析链。

| 函数 | 职责 |
|------|------|
| `extractFrontmatter(content)` | 提取 YAML frontmatter（支持 `---`/`+++` 分隔符 + 缺失 frontmatter 兼容），返回 `{ frontmatter, body }` |
| `parseSkillMd(content, filePath, source)` | 解析 SKILL.md 为 `SkillEntry`（含 skill/metadata/invocation/exposure/disableCommandDispatch）；name/description 缺失返回 undefined |
| `resolveSkillInvocationPolicy(fm)` | 解析双调用策略（`user-invocable` / `disable-model-invocation` frontmatter） |
| `resolveSkillExposure(fm, invocation)` | 推导三层可见性（`always` 控制常驻；`disable-model-invocation` 控制 prompt 可见性） |
| `resolveSkillCommandSpec(entry)` | 解析命令分发规格（`command-name` + `command-tool` → `{ kind:'tool', toolName }` dispatch） |
| `formatSkillsForPrompt(skills)` | 生成 XML 格式 `<available_skills>` prompt 片段（含 name/description/location/version），注入 system prompt 末尾 |
| `resolveSkillKey(entry)` | 解析技能键名（优先 `skill-key` frontmatter，回退 `name`） |
| `normalizeSkillName(name)` | 标准化技能名（trim + lowercase，用于白名单匹配） |
| `truncateSkillBody(body, maxChars=4000)` | 防止超长 body 撑爆 prompt |

**prompt 注入格式**（`formatSkillsForPrompt` 输出）：

```xml
<available_skills>
  <skill>
    <name>plot-check</name>
    <description>检查写作章节的剧情一致性...</description>
    <location>/path/to/builtin-skills/plot-check/SKILL.md</location>
    <version>1</version>
  </skill>
  ...
</available_skills>
```

模型通过 `read` 工具加载 SKILL.md 文件获取详细使用说明（参考 openclaw 「read tool to load skill's file」理念）。

#### 14.46.4 skillAvailability.ts（声明式可用性评估）

[skillAvailability.ts](src/main/services/agent/skills/skillAvailability.ts) 实现技能的声明式可用性评估，参考 openclaw `ToolAvailabilityExpression` 理念。

`evaluateSkillAvailability(entry, ctx)` 按以下顺序评估 5 类门控（任一不满足则不可用）：

| 门控 | 来源 | 说明 |
|------|------|------|
| 运行时注册 | `exposure.includeInRuntimeRegistry` | false 时永不注册 |
| `requires.env` | frontmatter `requires-env` | 环境变量必须存在 |
| `requires.config` | frontmatter `requires-config` | 配置项必须非空（需 ctx.getConfig） |
| `skillFilter` 白名单 | ctx.skillFilter | 非空时技能须在白名单（按 skillKey 或 name 匹配） |
| `skillOverrides` 覆盖 | ctx.skillOverrides | 会话级按技能名启用/禁用，优先级最高 |

**三层可见性过滤函数**：

| 函数 | 过滤条件 |
|------|----------|
| `isSkillPromptVisible` | `exposure.includeInAvailableSkillsPrompt === true` |
| `isSkillUserInvocable` | `exposure.userInvocable === true` |
| `isSkillRuntimeVisible` | `exposure.includeInRuntimeRegistry === true` |
| `filterPromptVisibleSkills` | 批量过滤 prompt 可见技能（注入 `<available_skills>` 用） |
| `filterUserInvocableSkills` | 批量过滤用户可调用技能（命令面板用） |
| `filterAvailableSkills` | 批量过滤可用技能（运行时注册用） |
| `matchesSkillFilter` | skillKey/name 白名单匹配 |

#### 14.46.5 skillLoader.ts（加载链）

[skillLoader.ts](src/main/services/agent/skills/skillLoader.ts) 适配 openclaw `loading/workspace.ts` + `bundled-dir.ts`，实现技能加载链。

| 函数 | 职责 |
|------|------|
| `loadSkillFile(filePath, source)` | 异步读取并解析单个 SKILL.md（失败返回 undefined，不抛出） |
| `loadSkillsFromDir(dir, source)` | 扫描目录下所有 SKILL.md（支持子目录 `<dir>/<name>/SKILL.md` 与平铺 `<dir>/SKILL.md` 两种布局） |
| `loadBuiltinSkills()` | 加载内置技能（`builtin-skills/` 目录，编译时确定路径） |
| `loadWorkspaceSkills(userDataPath)` | 加载工作区技能（用户数据目录 `skills/`，可选） |
| `loadAllSkills(userDataPath?)` | 合并内置 + 工作区，同名技能工作区覆盖内置 |
| `loadSkillFileSync` / `loadSkillsFromDirSync` / `loadBuiltinSkillsSync` | 同步变体（启动期或测试用） |

**设计约束**：
- 内置技能目录：`src/main/services/agent/skills/builtin-skills/<skill-name>/SKILL.md`
- 加载失败的单个技能不中断整体加载（仅 `console.warn`）
- 工作区技能首期可为空（用户未自定义时返回空数组）

#### 14.46.6 skillSnapshot.ts（会话快照 + LRU 缓存）

[skillSnapshot.ts](src/main/services/agent/skills/skillSnapshot.ts) 适配 openclaw snapshot 理念，构建注入 prompt 的技能会话快照。

| 函数 | 职责 |
|------|------|
| `buildSkillSnapshot(entries, filterOptions)` | 构建快照：① 过滤可用技能（`evaluateSkillAvailability`）② 过滤 prompt 可见 ③ 生成 prompt 文本 ④ 收集 skills 元数据 |
| `resolveSkillSnapshot(entries, filterOptions)` | 带进程级 LRU 缓存（上限 10），按 entries 引用 + skillFilter + skillOverrides 签名命中 |
| `shouldRefreshSnapshot(old, entries, filterOptions)` | 比对旧快照决定是否刷新（entries 数量/引用/skillFilter/skillOverrides 变化） |
| `clearSkillSnapshotCache()` | 清空缓存（注册/注销技能时触发） |
| `getSkillSnapshotCacheSize()` | 获取缓存大小（诊断用） |

**缓存键设计**：entries 数量 + 各 entry 的 filePath + skillFilter join + skillOverrides keys/values 拼接为字符串键，LRU 淘汰最久未访问。注册/注销技能时通过 `clearSkillSnapshotCache()` 主动失效。

#### 14.46.7 skillInvoker.ts（双调用策略 + 分发）

[skillInvoker.ts](src/main/services/agent/skills/skillInvoker.ts) 适配 openclaw 双调用策略，实现技能调用全流程。

`invokeSkill(entry, args, context, options)` 执行流程：

1. **调用方权限校验**：
   - `invokedBy='user'`：校验 `exposure.userInvocable`（false 时拒绝，返回「not user-invocable」）
   - `invokedBy='model'`：校验 `invocation.disableModelInvocation`（true 时拒绝，返回「model invocation disabled」）
2. **可用性校验**：`evaluateSkillAvailability(entry, availabilityContext)`，不可用时返回「not available in current context」
3. **解析命令分发规格**：`resolveSkillCommandSpec(entry)`，无配置时返回「no command dispatch configured」
4. **按 `dispatch.kind` 分发**：
   - `'tool'`：委托 `IToolProvider.executeTool(dispatch.toolName, args, context)`，包装为 `SkillInvokeResult`
5. **返回结果**：`{ success, content, continueLoop, skillName, invokedBy }`

**双调用入口**：
- `SkillRegistry.invoke()`：模型调用主路径（`invokedBy='model'`），返回 `ToolExecutionResult` 契约
- `SkillRegistry.invokeByUser()`：命令面板触发（`invokedBy='user'`），返回完整 `SkillInvokeResult`

#### 14.46.8 skillRegistry.ts（ISkillRegistry 实现）

[skillRegistry.ts](src/main/services/agent/skills/skillRegistry.ts) 自研 `ISkillRegistry` 实现，管理技能注册、查询、快照、调用。

| 方法 | 职责 |
|------|------|
| `register(entry)` | 注册技能（重名抛错 + 清空快照缓存） |
| `unregister(name)` | 注销技能（清空快照缓存） |
| `registerAll(entries)` | 批量注册（单个失败仅 warn，不中断） |
| `get(name)` / `getBySkillKey(key)` | 按名称/skillKey 查询 |
| `list()` | 列出所有技能 |
| `buildSnapshot(filter?)` | 委托 `skillSnapshot.resolveSkillSnapshot` 生成 prompt 文本 |
| `buildFullSnapshot(filter?)` | 返回完整 `SkillSnapshot` 对象（含 skills 元数据） |
| `invoke(name, args, ctx)` | 模型调用（委托 `skillInvoker`，返回 `ToolExecutionResult`） |
| `invokeByUser(name, args, ctx)` | 用户调用（校验 `userInvocable`，返回 `SkillInvokeResult`） |
| `setToolProvider(provider)` | 注入工具提供方（调用分发依赖） |
| `setAvailabilityContext(ctx)` | 注入可用性上下文（env/config 校验用） |
| `clear()` / `size()` | 清空 / 计数 |

**单例**：`getSkillRegistry()` / `resetSkillRegistry()`（测试用）。AgentCore 或 IPC handler 初始化时注入 `toolProvider` 与 `availabilityContext`。

#### 14.46.9 内置写作组 SKILL.md

5 个内置技能位于 `builtin-skills/<name>/SKILL.md`，均含 frontmatter + body：

| 技能 | emoji | command-tool | 用途 |
|------|-------|--------------|------|
| `plot-check` | 🔍 | `plotCheck` | 剧情一致性检查（大纲/世界书/角色/风格/连续性 5 维度），返回带 `quickFixSuggestion` 的问题列表 |
| `outline-generate` | 📋 | `outlineGenerate` | 大纲生成（基于设定/前文生成章节大纲） |
| `chapter-write` | ✍️ | `writeChapter` | 章节写作（基于大纲 + 前文 + 角色卡生成章节正文） |
| `description-polish` | ✨ | `polishDescription` | 描写润色（局部文本增强，保留原意） |
| `table-organize` | 📊 | `updateStateTable` | 表格整理（insertRow/updateRow/deleteRow，闭环返回执行结果） |

**frontmatter 字段**（所有内置技能一致）：

```yaml
---
name: <skill-name>
description: "<模型可见的技能描述，含触发场景>"
emoji: <图标>
user-invocable: true          # 用户可命令面板调用
disable-model-invocation: false  # 模型可自主调用
command-name: /<skill-name>   # 用户命令
command-tool: <tool-name>     # 委托的工具名
---
```

**body 结构**：使用场景 + 调用方式（模型自主调用 / 用户命令调用）+ 返回结构 + 注意事项。模型通过 `read` 工具加载 SKILL.md 获取详细说明。

#### 14.46.10 与 AgentCore / ToolRegistry 集成

**集成点**（spec §二 Task 14 + Task 7.3）：

```
AgentCore.run(intent)
  ├─ skillRegistry.buildSnapshot()  →  prompt 拼接到 systemPrompt 末尾
  ├─ llmProvider.streamChat({ tools: toolRegistry.getToolDefinitions(ctx) })
  ├─ agentLoop 检测 tool_calls
  │   ├─ toolName 命中 SkillRegistry → skillRegistry.invoke(name, args, ctx)
  │   │                                  └─ skillInvoker → toolProvider.executeTool(dispatch.toolName)
  │   └─ toolName 命中 ToolRegistry → toolRegistry.executeTool(name, args, ctx)
  └─ 结果回填 role='tool' 消息 → 继续迭代
```

**降级保护**：
- `supportsToolCalling=false`：不注入 tools，技能 prompt 仍注入但模型无法调用（保留 `<tableEdit>` 文本协议降级路径）
- 技能调用失败：转为 `ToolExecutionResult { success:false, continueLoop:true }`，错误信息回灌 LLM 让模型重试或换策略
- 工具未注册：返回「Tool not found」+ 可用工具列表，引导模型修正

#### 14.46.11 验证

- `npx tsc --noEmit`：skills 模块 0 类型错误（pre-existing 744 错误均位于未改动代码）
- `npx vitest run src/main/services/__tests__/skills.test.ts`：75/75 通过

**测试覆盖**（[skills.test.ts](src/main/services/__tests__/skills.test.ts)）：

| 模块 | 覆盖点 |
|------|--------|
| skillContract | frontmatter 解析（`---`/`+++`/缺失）/ SkillEntry 构造 / formatSkillsForPrompt XML 格式 / truncateSkillBody / resolveSkillKey / normalizeSkillName |
| skillAvailability | requires.env 校验（满足/不满足）/ requires.config / skillFilter 白名单 / skillOverrides 覆盖 / 三层可见性过滤 |
| skillSnapshot | buildSkillSnapshot / LRU 缓存命中与淘汰 / shouldRefreshSnapshot |
| skillRegistry | register/get/list/buildSnapshot/invoke + toolProvider 注入 + user/model 权限校验 + 可用性校验 |
| skillLoader | loadBuiltinSkillsSync 加载 5 个内置技能 + command-tool 配置校验 + 注册到 Registry 构建快照 |

**【重点标记】测试导入路径修复**：初版测试使用 `../skills/...` 相对路径，但测试文件位于 `__tests__/` 而 skills 模块位于 `agent/skills/`，正确路径为 `../agent/skills/...`；同时清理未使用导入（`afterEach` / `resolveSkillInvocationPolicy` / `resolveSkillExposure` / `filterAvailableSkills` / `getSkillRegistry`）。修复后 75/75 通过。

#### 14.46.12 涉及文件

| 文件 | 变更 |
|------|------|
| [skillContract.ts](src/main/services/agent/skills/skillContract.ts) | 新增，SKILL.md 解析 + prompt 格式化 |
| [skillAvailability.ts](src/main/services/agent/skills/skillAvailability.ts) | 新增，声明式可用性评估 + 三层可见性过滤 |
| [skillLoader.ts](src/main/services/agent/skills/skillLoader.ts) | 新增，加载链（内置 + 工作区 + 同步变体） |
| [skillSnapshot.ts](src/main/services/agent/skills/skillSnapshot.ts) | 新增，会话快照 + LRU 缓存 |
| [skillInvoker.ts](src/main/services/agent/skills/skillInvoker.ts) | 新增，双调用策略 + 委托分发 |
| [skillRegistry.ts](src/main/services/agent/skills/skillRegistry.ts) | 新增，ISkillRegistry 实现 + 单例 |
| [types.ts](src/main/services/agent/skills/types.ts) | 新增，类型契约 |
| [index.ts](src/main/services/agent/skills/index.ts) | 新增，barrel export |
| [builtin-skills/plot-check/SKILL.md](src/main/services/agent/skills/builtin-skills/plot-check/SKILL.md) | 新增，剧情检查技能 |
| [builtin-skills/outline-generate/SKILL.md](src/main/services/agent/skills/builtin-skills/outline-generate/SKILL.md) | 新增，大纲生成技能 |
| [builtin-skills/chapter-write/SKILL.md](src/main/services/agent/skills/builtin-skills/chapter-write/SKILL.md) | 新增，章节写作技能 |
| [builtin-skills/description-polish/SKILL.md](src/main/services/agent/skills/builtin-skills/description-polish/SKILL.md) | 新增，描写润色技能 |
| [builtin-skills/table-organize/SKILL.md](src/main/services/agent/skills/builtin-skills/table-organize/SKILL.md) | 新增，表格整理技能 |
| [skills.test.ts](src/main/services/__tests__/skills.test.ts) | 新增，75 个用例 |

---

### 14.47 ⭐ writing/ 写作智能体编排（固定编排循环 + 断点续跑 + 前端三态视图）（Spec: implement-agent-foundation-and-fix-defects / Task 15）

#### 14.47.1 设计目标与 openclaw 对齐

**目标**（spec §二 Task 15）：实现写作智能体编排服务（WritingAgentService），完成从读大纲→写章→自审→修复→更新表→下一章的闭环流程，并提供前端交互入口（"智能体写作"按钮 + 进度流 + 断点续跑），让 AI 从用户操作的"工具"升级为可自驱完成多章节创作的"智能体"。

**openclaw 对齐决策**（spec §三）：**自研**。openclaw 无写作场景，spec §三无对应文件。写作编排是本项目特有业务，采用固定编排循环（非动态 agent loop），直接调用现有写作服务（ContentGenerator / PlotCheckerService / TableOrganizeService / WritingProjectRepository）。设计约束遵循 spec §5.2：不替换现有逐按钮流程、降级保护、断点续跑、取消支持、资源复用。

#### 14.47.2 架构与数据流

```
[前端 WritingAgentModal]
    │ useWritingAgent hook
    │ window.electronAPI.writing.agent.run/cancel/status/resume
    ▼
[IPC writingAgentHandlers] ── writing-agent:progress ──► [前端 onProgress 订阅]
    │
    ▼
[WritingAgentService 单例]
    │ runAgentWriting → executeOrchestration → processChapter (per chapter)
    │   ├─ generateChapterContent (ContentGenerator.generateStream)
    │   ├─ autoSaveChapter (WritingProjectRepository)
    │   ├─ checkChapter (PlotCheckerService.checkChapter)
    │   ├─ autoFixIssues (PlotCheckerService.autoFixIssue × N)
    │   └─ organizeTable (TableOrganizeService.organizeTable)
    │ onProgress 回调 → IPC handler → event.sender.send
    │ AbortController 取消 / checkpoint 断点
    ▼
[现有写作服务层]（不修改）
```

#### 14.47.3 核心模块

| 文件 | 职责 |
|------|------|
| [writing-agent.types.ts](src/shared/types/writing-agent.types.ts) | **共享类型 SSOT**：`AgentWritingRequest`/`AgentWritingOptions`/`AgentWritingEvent`（16 类事件）/`AgentWritingResult`/`AgentWritingCheckpoint`/`AgentWritingStatus` + `SEVERITY_ORDER`/`meetsSeverityThreshold` + 渲染进程别名 |
| [writingAgentTypes.ts](src/main/services/agent/writing/writingAgentTypes.ts) | 主进程类型 re-export + `AgentWritingProgressCallback` |
| [writingAgentService.ts](src/main/services/agent/writing/writingAgentService.ts) | **编排核心**：`WritingAgentService` 单例；`runAgentWriting`/`executeOrchestration`/`processChapter`/`generateChapterContent`/`checkChapter`/`autoFixIssues`/`organizeTable`/`hasChapterContent`/`findFirstUnwrittenChapter`/`saveCheckpoint`/`resumeFromCheckpoint` |
| [writingAgentHandlers.ts](src/main/ipc/handlers/writing/writingAgentHandlers.ts) | IPC 4 通道（run/cancel/status/resume）+ progress 事件流 + `abortActiveWritingAgent` |
| [useWritingAgent.ts](src/renderer/components/Creative/WritingMode/hooks/useWritingAgent.ts) | **前端 hook**：`buildRequest`（从 projectStore + settingStore 构建）/`start`/`cancel`/`resume`/`refreshStatus` + 进度事件缓存（上限 200） |
| [WritingAgentModal.tsx](src/renderer/components/Creative/WritingMode/WritingAgentModal.tsx) | **三态视图 Modal**：配置态（章节范围 + 6 项编排选项 + 断点提示）/ 运行态（进度条 + 事件流 + 取消）/ 完成态（统计卡片 + 事件流） |

#### 14.47.4 编排循环详解

`processChapter` 单章处理流程（5 步，每步 try-catch 独立降级）：

1. **跳过检查**：`hasChapterContent` 通过 `chapter-{index}.md` 文件检测（与 `autoSaveChapter` 路径对齐），已有内容则跳过
2. **内容生成**：`generateChapterContent` 构建 `ContentGenerationRequest`（世界书向量检索 / 角色 / 人设 / 前序 3 章摘要 / 写作风格 / 表格数据），调用 `ContentGenerator.generateStream`；失败重试 `maxRetriesPerChapter` 次
3. **剧情检查**：`checkChapter` 构建 `PlotCheckRequestData`（含表格数据），调用 `PlotCheckerService.checkChapter`
4. **自动修复**：`autoFixIssues` 遍历 dimension + logic 两类问题，对满足 `autoFixMinSeverity` 阈值的 `quickFixable` 问题调用 `autoFixIssue`；修复后内容重新保存
5. **表格整理**：`organizeTable` 调用 `TableOrganizeService.organizeTable`（无关联模板时跳过）

#### 14.47.5 断点续跑与取消

- **Checkpoint**：每章完成后保存 `AgentWritingCheckpoint`（projectId/startChapterIndex/nextChapterIndex/endChapterIndex/completedChapters/createdAt/updatedAt）到内存（`WritingAgentService.lastCheckpoint` 静态字段）
- **Resume**：`resumeFromCheckpoint` 校验 checkpoint.projectId 匹配后，以 `nextChapterIndex` 为 startChapterIndex 调用 `runAgentWriting`
- **Cancel**：`AbortController.abort()`；编排循环在每章 checkpoint 处检测 `isCancelled`，已生成内容保留
- **退出清理**：`main/index.ts` 在 `will-navigate`（页面刷新）和 `before-quit`（应用退出）时调用 `abortActiveWritingAgent`，避免后台孤儿任务

#### 14.47.6 前端三态视图

| 状态 | 触发条件 | 主要 UI |
|------|----------|---------|
| **配置态**（config） | `!running && !result` | 章节范围 InputNumber + 6 项编排选项（Switch/Select/InputNumber）+ 断点续跑 Alert + 开始/续跑按钮 |
| **运行态**（running） | `running` | Progress active 进度条 + 当前章节信息 + 最新事件 Alert + 事件流列表（16 类事件带图标/颜色/时间戳，自动滚动）+ 取消按钮 |
| **完成态**（result） | `!running && result` | 结果图标（成功/取消/失败）+ 4 个统计卡片（成功/跳过/失败/耗时）+ 事件流 + 关闭按钮 |

Modal 运行时禁止 `maskClosable`/`closable` 防误操作。

#### 14.47.7 涉及文件

| 文件 | 说明 |
|------|------|
| [writing-agent.types.ts](src/shared/types/writing-agent.types.ts) | 新增，共享类型 SSOT |
| [writingAgentTypes.ts](src/main/services/agent/writing/writingAgentTypes.ts) | 改为 re-export |
| [writingAgentService.ts](src/main/services/agent/writing/writingAgentService.ts) | 新增，编排核心 |
| [index.ts](src/main/services/agent/writing/index.ts) | 新增，barrel export |
| [writingAgentHandlers.ts](src/main/ipc/handlers/writing/writingAgentHandlers.ts) | 新增，IPC 4 通道 + progress |
| [writingHandlers.ts](src/main/ipc/handlers/writingHandlers.ts) | 聚合注册 + re-export abort |
| [preload.ts](src/main/preload.ts) | writing.agent API |
| [index.ts](src/main/index.ts) | will-navigate + before-quit abort |
| [electron.d.ts](src/renderer/types/electron.d.ts) | 类型补充 |
| [useWritingAgent.ts](src/renderer/components/Creative/WritingMode/hooks/useWritingAgent.ts) | 新增，前端 hook |
| [WritingAgentModal.tsx](src/renderer/components/Creative/WritingMode/WritingAgentModal.tsx) | 新增，三态视图 Modal |
| [ContentWorkspace.tsx](src/renderer/components/Creative/WritingMode/ContentWorkspace.tsx) | 按钮接入 + Modal 渲染 |

---

### 14.48 ⭐ 对话智能体 + 世界书自驱（Task 16 + Task 17）（Spec: implement-agent-foundation-and-fix-defects / 阶段 5-6，2026-07-30 新增）

#### 14.48.1 设计目标
- **对话智能体（Task 16）**：在对话模式启用 AgentCore + 工具调用闭环，让 AI 在对话中可自主检索世界书/搜索历史/记录记忆，从"被动回复"升级为"主动检索+记忆"的智能体
- **世界书自驱（Task 17）**：在世界书模式启用 AgentCore + 世界书组工具，让 AI 可自主创建条目/扩展 lore/生成关键词/重排条目；写入的条目进入"待审阅区"由用户审批，实现世界书的自我生长

#### 14.48.2 对话组工具（Task 16.1）
新增 [dialogueTools.ts](src/main/services/agent/tools/builtin/dialogueTools.ts)，3 个工具（availability gating `mode='dialogue'`）：
- **searchWorldbook**：向量检索世界书条目（复用 `worldBookService.searchWorldBookEntriesByVector` + `readWorldBook`）
- **searchHistory**：关键词搜索对话历史（复用 `chatLogService.searchChatMessages`）
- **addMemoryNote**：写入 agent 记忆笔记（复用 `memoryStore.write`）

通过 `IDialogueToolServices` 接口注入服务实现，工具代码不直接 import 服务，保持低耦合。`agentHandlers.ts` 的 `createDialogueToolServices()` 桥接现有服务。

#### 14.48.3 useAgent 灰度开关（Task 16.2）
- `AIEngineConfig` / `AIEngineSetting` 新增 `useAgent: boolean`（默认 `false`）
- `ChatEngine.sendMessage` 双条件守卫：`useAgent === true && capabilities.supportsToolCalling === true` → 调用 `runViaAgentCore()` 走 `agent:run` IPC + `agent:token`/`agent:done` 事件流
- 异常自动回退旧路径（`streamChatAPI`），降级保护
- `cancelRequest` 增加 `agent:cancel` 取消；`cleanupListeners` 清理 agent 事件订阅

#### 14.48.4 世界书组工具（Task 17.1）
新增 [worldbookTools.ts](src/main/services/agent/tools/builtin/worldbookTools.ts)，4 个工具（availability gating `mode='worldbook'`）：

| 工具 | 职责 | 写入模式 |
|------|------|---------|
| createEntry | 创建单个草稿条目 | autoGenerated=true 草稿区 |
| expandFromContext | 从上下文批量提取 lore 条目 | autoGenerated=true 草稿区 |
| generateKeywords | 为已有条目生成/更新关键词 | 原地更新（非草稿） |
| sortEntries | 按指定顺序重排条目（更新 order/displayIndex） | 原地更新（非草稿） |

**沙盒隔离**（spec §5.4）：`ToolCallContext` 新增 `allowedWorldBookPaths?: string[]` 白名单字段。写工具（createEntry/expandFromContext）调用前 `assertSandboxAllowed()` 校验 worldBookPath 是否在白名单内；越权 → 返回 `SANDBOX_VIOLATION` 错误，不执行写入。

**草稿标记 + 写溯源**：createEntry/expandFromContext 写入的条目均带：
- `autoGenerated: true` —— 进入待审阅区
- `provenance: { source: 'agent', runId?, toolName, timestamp }` —— 写溯源（对应 openclaw memory-write-provenance 范式）

**排序完整性校验**：sortEntries 要求 sortOrder 数组必须覆盖所有条目且不重复（未知 UID 拒绝 / 重复 UID 拒绝 / 遗漏条目拒绝），避免误删或错位。

#### 14.48.5 autoGenerated 待审阅区 UI（Task 17.2）

**后端**（[worldBookService.ts](src/main/services/worldBookService.ts)）新增 4 个草稿管理方法：
- `listAutoGeneratedEntries(path)` —— 列出 autoGenerated=true 的草稿条目
- `approveAutoGeneratedEntry(path, uid)` —— 清除 autoGenerated 标记，转为正式条目（provenance 保留以备溯源）
- `rejectAutoGeneratedEntry(path, uid)` —— 从世界书中删除该草稿条目
- `approveAllAutoGeneratedEntries(path)` —— 批量批准所有草稿条目

**IPC**（[worldBookHandlers.ts](src/main/ipc/handlers/worldBookHandlers.ts)）注册 4 个通道：`worldBook:listAutoGenerated` / `worldBook:approveAutoGenerated` / `worldBook:rejectAutoGenerated` / `worldBook:approveAllAutoGenerated`。[preload.ts](src/main/preload.ts) + [electron.d.ts](src/renderer/types/electron.d.ts) 暴露 4 个 API。

**前端**：新增 [WorldBookAutoGeneratedReview.tsx](src/renderer/components/WorldBook/WorldBookAutoGeneratedReview.tsx) 组件：
- 表格列：UID / 名称 / 主关键词（蓝色 Tag）/ 次关键词（青色 Tag）/ 内容预览（Paragraph ellipsis 可展开）/ 来源（写溯源 Tooltip：source/toolName/runId/timestamp）/ 操作（批准 + 拒绝 Popconfirm）
- 底部按钮：刷新 / 全部批准 / 关闭
- 空状态：Empty 组件"暂无待审阅的 AI 生成条目"

[WorldBookManager.tsx](src/renderer/components/WorldBook/WorldBookManager.tsx) 每行新增"待审阅"按钮（RobotOutlined 图标），点击打开 Modal；`handleAutoGeneratedChanged` 回调在审阅后刷新本地 worldBookContent 缓存。

#### 14.48.6 涉及文件

| 文件 | 改动 |
|------|------|
| [worldbookTools.ts](src/main/services/agent/tools/builtin/worldbookTools.ts) | 新增，4 个世界书组工具 |
| [dialogueTools.ts](src/main/services/agent/tools/builtin/dialogueTools.ts) | 新增（Task 16），3 个对话组工具 |
| [contracts.ts](src/main/services/agent/contracts.ts) | 修改：ToolCallContext.mode 扩展 'worldbook' + allowedWorldBookPaths 沙盒白名单 |
| [tools/index.ts](src/main/services/agent/tools/index.ts) | 修改：barrel 导出对话组 + 世界书组工具 |
| [agentHandlers.ts](src/main/ipc/handlers/agentHandlers.ts) | 修改：注册对话组 + 世界书组工具 + createDialogueToolServices + createWorldbookToolServices |
| [worldBookService.ts](src/main/services/worldBookService.ts) | 修改：4 个 autoGenerated 管理方法 |
| [worldBookHandlers.ts](src/main/ipc/handlers/worldBookHandlers.ts) | 修改：4 个 autoGenerated IPC 通道 |
| [preload.ts](src/main/preload.ts) | 修改：4 个 worldBook API + useAgent 透传 |
| [electron.d.ts](src/renderer/types/electron.d.ts) | 修改：worldBook autoGenerated 类型 |
| [setting.ts](src/renderer/types/setting.ts) | 修改：useAgent 字段 |
| [settings.ts](src/shared/settings.ts) | 修改：useAgent 默认值 false |
| [ChatEngine.ts](src/renderer/components/Common/ChatEngine/ChatEngine.ts) | 修改：useAgent 双条件守卫 + runViaAgentCore |
| [CharacterDialogueChat.hooks.ts](src/renderer/components/Character/CharacterDialogueChat/CharacterDialogueChat.hooks.ts) | 修改：useAgent 透传 |
| [WorldBookAutoGeneratedReview.tsx](src/renderer/components/WorldBook/WorldBookAutoGeneratedReview.tsx) | 新增，待审阅区 Modal |
| [WorldBookManager.tsx](src/renderer/components/WorldBook/WorldBookManager.tsx) | 修改：待审阅按钮 + Modal 渲染 |
| [worldbookTools.test.ts](src/main/services/__tests__/worldbookTools.test.ts) | 新增，21 个测试用例 |

#### 14.48.7 验证
- `npx tsc --noEmit`：Task 17 涉及文件零新增类型错误（745 个 pre-existing 错误均位于未改动代码）
- `npx vitest run src/main/services/__tests__/worldbookTools.test.ts`：21 个用例全部通过
- `npx vitest run src/main/services/__tests__/skills.test.ts src/main/services/__tests__/WorldBookKeywordIndex.test.ts`：101 个用例全部通过（无回归）

### 14.49 ⭐ learning/ 长期记忆与自学习系统（dreaming + goal + steer + feedback）（Spec: implement-agent-foundation-and-fix-defects / Task 18，2026-07-30 新增）

#### 14.49.1 设计目标与 openclaw 对齐
本模块是智能体底座的"自学习与记忆沉淀"层，对齐 openclaw 以下核心设计：
- **dreaming 长期记忆**（openclaw dreaming.ts）：短期→长期记忆摘要，分 light/deep/rem 三相，不同相位使用不同 speed/thinking/budget 避免单次成本失控
- **cron pacing/stagger 防失控**（openclaw pacing.ts + stagger.ts）：pacing 钳位任务执行间隔到 [min, max] 区间；stagger 对 top-of-hour cron 自动加 5 分钟抖动窗口，防 thundering herd
- **goal tracker**：会话目标追踪 + 阻塞计数器，避免偶发失败误判 blocked
- **steer engine**：行为引导消息注入，lease/ack 机制避免重复注入
- **feedback loop**：用户反馈→LLM 反思→经验记忆回流，5 分钟冷却期防 LLM 成本失控

四大子系统均落库到 SQLite `agent_memory` 表（按 `metadata.kind` 区分 'goal'/'steer'/'feedback_learning'/'dreaming_summary'），进程重启后状态可恢复。

#### 14.49.2 模块结构

```
src/main/services/agent/learning/
├── types.ts              # 核心类型 + 默认配置常量
├── pacing.ts             # 间隔钳位（照抄 openclaw）
├── stagger.ts            # 抖动窗口（照抄 openclaw）
├── cronScheduler.ts      # 自研轻量 5 字段 cron 调度器
├── dreamingService.ts    # 三相短期→长期记忆摘要
├── goalTracker.ts        # 会话目标追踪 + 阻塞计数器
├── steerEngine.ts        # 行为引导消息管理
├── feedbackLoop.ts       # 用户反馈→LLM 反思→经验记忆
├── index.ts              # barrel export + initLearningServices
└── __tests__/            # 8 个测试文件，183 个用例
    ├── fakeBackend.ts            # 内存版 AgentSqliteBackend（绕过 better-sqlite3 ABI 问题）
    ├── pacing.test.ts
    ├── stagger.test.ts
    ├── cronScheduler.test.ts
    ├── dreamingService.test.ts
    ├── goalTracker.test.ts
    ├── steerEngine.test.ts
    └── feedbackLoop.test.ts
```

#### 14.49.3 types.ts（核心类型与默认配置）

| 类型/常量 | 说明 |
|----------|------|
| `DreamingPhase` | `'light' \| 'deep' \| 'rem'` 三相 |
| `DreamingConfig` | dreaming 全局配置（enabled/frequency/timezone/verboseLogging/phases） |
| `DreamingPhaseConfig` | 单相位配置（lookbackDays/limit/execution/params） |
| `DreamingExecutionConfig` | 执行档位（speed: fast/balanced/slow + thinking: low/high + budget: cheap/medium/expensive + model/temperature/maxOutputTokens） |
| `GoalRecord` | 目标记录（sessionId/objective/status: pending/in_progress/blocked/complete/blocker/consecutiveBlockerCount/tokenUsage/tokenBudget） |
| `SteerMessage` | 引导消息（id/sessionId/content/source/priority/deliveryStatus/leaseId/leasedAt） |
| `FeedbackEvent` | 反馈事件（sessionId/kind: thumb_down/low_rating/comment/correction/agentResponse/userComment/createdAt） |
| `DEFAULT_DREAMING_CONFIG` | light=2d/100条/cheap+fast / deep=30d/10条/balanced+high/minScore=0.75 / rem=7d/10条/expensive+high/minPatternStrength=0.75 |
| `GOAL_BLOCKER_THRESHOLD` | `3`（同 blocker 连续 3 次才 blocked） |
| `MAX_STEER_PROMPT_CHARS` / `MAX_STEER_MESSAGES` | 引导消息 prompt 长度/数量上限 |

#### 14.49.4 pacing.ts + stagger.ts（防失控双保险，照抄 openclaw）

**pacing.ts** —— 间隔钳位，防止任务过快执行：
- `parseDurationMs(str)`：解析时长字符串，支持单格式（`'30m'`）和复合格式（`'1h30m'`）
- `parseCronPacingBounds(pacing)`：从 cron pacing 配置解析 `{minMs, maxMs}` 边界
- `resolvePacedNextRunAtMs({nowMs, delayMs, pacing})`：钳位 `nowMs + delayMs` 到 `[nowMs+minMs, nowMs+maxMs]` 区间

**stagger.ts** —— 抖动窗口，防止任务锁步：
- `DEFAULT_TOP_OF_HOUR_STAGGER_MS = 5 * 60 * 1000`（5 分钟）
- `resolveDefaultCronStaggerMs(cronExpr)`：top-of-hour 表达式（如 `0 3 * * *`）自动应用 5 分钟抖动
- `normalizeCronStaggerMs(stagger)`：标准化 stagger 配置（数字/字符串/undefined）
- `resolveCronStaggerMs(cronExpr, stagger)`：综合显式配置与默认值
- `applyStaggerJitter(nextRunAtMs, staggerMs, randomFn)`：在 `[0, staggerMs)` 内随机偏移

#### 14.49.5 cronScheduler.ts（自研轻量 cron 调度器）

实现 `ILearningScheduler` 接口，核心方法：

| 方法 | 职责 |
|------|------|
| `start()` / `stop()` | 启动/停止轮询（默认 1s tick，`unref()` 不阻塞进程退出） |
| `schedule(cronExpr, callback, opts)` | 注册任务（label/pacing/stagger/allowConcurrent） |
| `cancel(jobId)` / `cancelByLabel(label)` | 取消任务 |
| `listJobs()` | 列出所有任务（含 nextRunAtMs/lastRunAtMs/lastStatus） |
| `setDreamingCallback(cb)` | 委托 dreaming 执行（dreamNow 任务调用） |
| `setNowFn(fn)` | 注入时间函数（测试用） |

**执行流程**：tick → listDueJobs(now) → executeJob（单实例守卫，同 jobId 不并发；allowConcurrent 可放开）→ 计算下次 nextRunAtMs（pacing 钳位 + stagger 抖动）→ 持久化到 `cron_jobs` 表。orphan job（callback 为 null）自动清理。

**cron 解析**：自研 5 字段解析器（分/时/日/月/周），支持 `*` / `数字` / `,` 列表 / `-` 范围 / `*/n` 步长。

#### 14.49.6 dreamingService.ts（三相短期→长期记忆摘要）

`DreamingService` 类核心方法：

| 方法 | 职责 |
|------|------|
| `runAll(sessionId?)` | 按 light→deep→rem 顺序执行三相，返回 `DreamingResult` |
| `runPhase(phase, sessionId?)` | 执行单相：检索短期记忆 → LLM 摘要 → 写回长期记忆 |
| `fetchShortTermMemories(phase, since, limit, sessionId?)` | 检索近期 type='agent' 记忆，排除 dreaming_summary 自身（防无限递归） |
| `buildPrompt(phase, memories, sessionId?)` | 按相位选择提示词模板（light=每日快报/deep=核心事实/rem=模式识别） |
| `parseAndPromote(phase, llmOutput, sessionId?)` | 解析 LLM JSON 输出，写回长期记忆（metadata.kind='dreaming_summary'） |
| `cancel()` | 中止正在进行的 dreaming（AbortController） |

**设计约束**（openclaw 原则）：
- 三相分隔：不同相位使用不同 speed/thinking/budget，避免单次成本失控
- minScore 阈值（deep=0.75）：仅固化高置信度事实，避免噪声
- 限制单次处理条数（light=100, deep=10, rem=10）
- 失败不中断：单相位失败不影响其他相位
- 单实例守卫：同一时刻仅允许一个 dreaming 运行

**LLM 输出格式**（三相不同 JSON schema）：
- light: `{"summary":"...","key_facts":["..."]}`
- deep: `{"promoted_facts":["..."],"skipped_count":N}`
- rem: `{"patterns":["..."],"confidence":0-1}`

#### 14.49.7 goalTracker.ts（会话目标追踪 + 阻塞计数器）

`GoalTracker` 类核心方法：

| 方法 | 职责 |
|------|------|
| `createGoal({sessionId, objective})` | 创建新目标（若已有未完成目标则拒绝） |
| `getGoal(sessionId)` | 查询当前未完成目标（最新状态快照） |
| `updateStatus({sessionId, status, blocker?, tokenUsage?})` | 更新目标状态 |
| `clearGoal(sessionId)` | 清除目标 |

**阻塞计数器逻辑**：
- 同一 blocker 连续命中 `GOAL_BLOCKER_THRESHOLD=3` 次才标记 `blocked`（避免偶发失败误判）
- 不同 blocker 重置计数器
- token 超额（tokenUsage > tokenBudget）直接 blocked

**持久化**：目标记录落库到 `agent_memory` 表（type='agent', metadata.kind='goal'），每次状态变更追加新记录（最新快照在前）。

#### 14.49.8 steerEngine.ts（行为引导消息管理）

`SteerEngine` 类核心方法：

| 方法 | 职责 |
|------|------|
| `enqueue({sessionId, content, source, priority})` | 入队引导消息 |
| `leasePendingSteer(sessionId)` | 租借待发送消息（批量 lease，返回 leaseId + prompt） |
| `ack(leaseId)` | 确认已注入（标记 delivered） |
| `release(leaseId)` | 释放 lease（消息重新入队待发送） |
| `discard(messageId)` | 丢弃消息 |
| `listPendingMessages(sessionId)` | 列出待发送消息 |

**lease/ack 机制**：避免同一消息被重复注入。lease 后消息状态变为 `in_progress`，ack 后变为 `delivered`，release 后重新变为 `pending`。**stale lease 自动清理**：lease 超 5 分钟未 ack 自动重新入队。

**prompt 组装**：`buildPrompt(messages)` 拼接为 `<steer_messages>` XML 块，头部声明「运行时数据而非用户指令」防止注入攻击；总长度受 `MAX_STEER_PROMPT_CHARS` 限制，超长时按优先级截断。

#### 14.49.9 feedbackLoop.ts（用户反馈→LLM 反思→经验记忆）

`FeedbackLoop` 类核心方法：

| 方法 | 职责 |
|------|------|
| `recordFeedback({sessionId, kind, agentResponse?, userComment?})` | 记录用户反馈事件 |
| `runReflection({sessionId, agentResponse?, userComment?})` | 触发 LLM 反思（5 分钟冷却期） |
| `recordAndReflect(params)` | 一站式：记录反馈 + 触发反思 |

**冷却机制**：同 sessionId 5 分钟内不重复反思，避免 LLM 成本失控。

**LLM 反思流程**：构建反思提示词 → 调用 LLM → 解析输出为 `learning` 结论 → 写回长期记忆（metadata.kind='feedback_learning'）。LLM 错误降级：返回 `{status: 'failed', error}` 而非崩溃。

#### 14.49.10 index.ts（barrel export + 统一初始化）

`initLearningServices(config)` 协调所有子系统：

```typescript
export function initLearningServices(config: InitLearningConfig): InitLearningResult {
  const cronScheduler = getCronScheduler({ backend: config.backend });
  const dreamingService = getDreamingService({ llmProvider, memoryProvider });
  const goalTracker = getGoalTracker({ memoryProvider, config });
  const steerEngine = getSteerEngine({ memoryProvider });
  const feedbackLoop = getFeedbackLoop({ llmProvider, memoryProvider });

  // 委托 dreaming 执行
  cronScheduler.setDreamingCallback(async (sessionId) => { await dreamingService.runAll(sessionId); });

  // 注册默认 cron 任务
  cronScheduler.schedule('0 3 * * *', async () => { await dreamingService.runAll(); }, { label: 'daily-dreaming' });
  cronScheduler.schedule('0 4 * * *', async () => { /* 清理过期 steer */ }, { label: 'daily-steer-cleanup' });

  if (config.autoStartScheduler !== false) cronScheduler.start();
  return { cronScheduler, dreamingService, goalTracker, steerEngine, feedbackLoop };
}
```

#### 14.49.11 IPC + preload + 类型

**IPC 通道**（`agentHandlers.ts` 的 `registerLearningHandlers`）：

| 通道 | 职责 |
|------|------|
| `learning:dream` | 手动触发 dreaming（可选 sessionId） |
| `learning:cancelDream` | 取消正在进行的 dreaming |
| `learning:getDreamingStatus` | 查询 dreaming 运行状态 |
| `learning:createGoal` | 创建会话目标 |
| `learning:getGoal` | 查询当前目标 |
| `learning:updateGoal` | 更新目标状态 |
| `learning:clearGoal` | 清除目标 |
| `learning:steer` | 入队引导消息 |
| `learning:listSteer` | 列出待发送引导消息 |
| `learning:recordFeedback` | 记录用户反馈 |
| `learning:runReflection` | 触发 LLM 反思 |

**降级初始化**：`initLearningServicesSafely` 在 `initAgentBackendIfNeeded` 成功后调用；SQLite backend 未就绪时返回 null，IPC handler 通过 `getXXServiceSafely` 获取服务，未初始化时返回明确错误而非崩溃。

**preload + 类型**：`preload.ts` 扩展 `electronAPI.learning` 对象；`electron.d.ts` 补充完整类型定义（`DreamingResult`/`GoalRecord`/`SteerMessage` 等）。

#### 14.49.12 【重点标记】修复的 Bug

1. **pacing.ts `parseDurationMs` 正则锚点 bug**：
   - **现象**：复合格式（如 `1h30m`）只能解析第一段 `1h`，剩余 `30m` 被丢弃
   - **根因**：正则 `/^(\d+)(ms|s|m|h|d)/g` 带 `^` 锚点，`exec` 第二次调用时 `lastIndex` 已前移但 `^` 强制从字符串开头匹配
   - **修复**：去掉 `^` 锚点，允许从字符串任意位置匹配数字+单位组合

2. **goalTracker.ts `getGoal` 状态判断 bug**：
   - **现象**：目标 complete 后 `createGoal` 仍被拒绝（误判"已有未完成目标"）
   - **根因**：原实现 `goalEntries.find(g => g.status !== 'complete')` 在目标经历 pending→in_progress→complete 后，会跳过最新的 complete 记录返回旧的 in_progress/pending 记录
   - **修复**：改为取 `goalEntries[0]`（updatedAt 最大记录的最新状态快照），若其状态为 complete 则返回 null

3. **fakeBackend.ts `makeStmt` 参数传递 bug**：
   - **现象**：`stmt.all(now)` 时查询条件匹配失败，测试数据无法检索
   - **根因**：`makeStmt` 实现方法签名为 `(params)` 单参数，而 better-sqlite3 的 statement 方法是 `(...params)` rest 参数，导致参数被包装成 `[[now]]` 而非 `[now]`
   - **修复**：修改 `makeStmt` 接口统一使用 `(params: unknown[])` 接收参数数组

#### 14.49.13 验证
- `npx tsc --noEmit`：learning 模块 0 类型错误（pre-existing 错误均位于未改动代码）
- `npx vitest run src/main/services/agent/learning/__tests__/`：183 个用例全部通过
  - pacing: 单/复合格式解析、钳位边界
  - stagger: 抖动窗口、top-of-hour 默认、随机性
  - cronScheduler: 表达式解析、任务调度、pacing/stagger 集成、并发控制、orphan 清理
  - dreamingService: 三相执行、LLM 交互、记忆持久化、错误处理、取消支持
  - goalTracker: 状态机、阻塞阈值、token 超额、会话隔离
  - steerEngine: lease/ack/release、stale 重新入队、prompt 组装
  - feedbackLoop: 反馈类型、冷却期、LLM 反思降级、记忆写回

#### 14.49.14 涉及文件

| 文件 | 改动 |
|------|------|
| [types.ts](src/main/services/agent/learning/types.ts) | 新增，核心类型 + 默认配置 |
| [pacing.ts](src/main/services/agent/learning/pacing.ts) | 新增（照抄 openclaw），间隔钳位 |
| [stagger.ts](src/main/services/agent/learning/stagger.ts) | 新增（照抄 openclaw），抖动窗口 |
| [cronScheduler.ts](src/main/services/agent/learning/cronScheduler.ts) | 新增（自研），轻量 cron 调度器 |
| [dreamingService.ts](src/main/services/agent/learning/dreamingService.ts) | 新增（适配 openclaw），三相记忆摘要 |
| [goalTracker.ts](src/main/services/agent/learning/goalTracker.ts) | 新增，会话目标追踪 |
| [steerEngine.ts](src/main/services/agent/learning/steerEngine.ts) | 新增，行为引导消息管理 |
| [feedbackLoop.ts](src/main/services/agent/learning/feedbackLoop.ts) | 新增，用户反馈反思回流 |
| [index.ts](src/main/services/agent/learning/index.ts) | 新增，barrel export + 统一初始化 |
| [agentHandlers.ts](src/main/ipc/handlers/agentHandlers.ts) | 修改：registerLearningHandlers + initLearningServicesSafely |
| [preload.ts](src/main/preload.ts) | 修改：learning API 暴露 |
| [electron.d.ts](src/renderer/types/electron.d.ts) | 修改：learning 类型定义 |
| [learning/__tests__/*.ts](src/main/services/agent/learning/__tests__/) | 新增 8 测试文件，183 个用例 |

---

### 14.50 ⭐ P2 UI/设计修复：长列表虚拟化 + dataStore 分层 + WritingModeRightPanel 拆分 + UI 子集修复（Spec: implement-agent-foundation-and-fix-defects / 阶段 7 Task 19-21）

#### 14.50.1 设计目标
针对现有架构审核识别的 P2 级 UI 缺陷与设计缺陷进行定向修复，提升长对话渲染性能、实现数据层与 IPC 解耦、拆分臃肿组件、完善错误恢复与输入校验。所有修复均为非破坏性增量改进，不改变现有对外 API 语义。

#### 14.50.2 Task 19 长列表虚拟化（P6）
- **问题**：`CharacterDialogueChat` 消息列表用 `.map()` 全量渲染，长对话（>50 条）渲染卡顿、滚动掉帧
- **方案**：新增 [VirtualizedMessageList.tsx](src/renderer/components/Character/CharacterDialogueChat/VirtualizedMessageList.tsx)，基于 `@tanstack/react-virtual@^3` 实现动态高度虚拟化
- **关键实现**：
  - `VIRTUALIZATION_THRESHOLD=50`，消息数 < 50 走原 `.map()` 路径（避免短对话引入虚拟化开销与回归风险）
  - `measureElement` 动态高度测量 + `overscan=8` 缓冲 + 复用父级 `chatContainerRef` 滚动容器
  - `shouldVirtualize(count)` 工具函数供组件条件启用
  - `CharacterDialogueChat.tsx` 提取 `renderMessageBubble` 函数，虚拟化与非虚拟化路径共享渲染逻辑
- **WorldBookEntryList**：已有分页（pageSize 切片），无需虚拟化

#### 14.50.3 Task 20 dataStore 分层（D1）+ RightPanel 拆分（D2）+ WorldBookManager memo（D3）
- **D1 dataStore 分层**：新增 [dataService.ts](src/renderer/services/dataService.ts) 作为 IPC 防腐层（`fetchCharacters`/`fetchAvatars`/`optimizeCharacter` + 结果归一化为 `CharacterOptimizeResult`）；[dataStore.ts](src/renderer/stores/dataStore.ts) 改为纯数据状态 + 委托 service，不再直接访问 `window.electronAPI`；store 对外 API 不变，5 个消费方零改动
- **D2 WritingModeRightPanel 拆分**：新增 [usePanelResize.ts](src/renderer/components/Creative/WritingMode/usePanelResize.ts) hook，提取 resize handle 的 `isResizing` 状态 + `resizeStartXRef`/`resizeStartWidthRef` refs + mousedown/mousemove/mouseup 事件监听；[WritingModeRightPanel.tsx](src/renderer/components/Creative/WritingMode/WritingModeRightPanel.tsx) 改为消费 `{ isResizing, handleResizeMouseDown }`，移除内联 `useRef`/`useEffect`/`useState`
- **D3 WorldBookManager memo 化**：审计确认已由 Task 8 重构完成（handler `useCallback` / columns `useMemo` / formState 迁入 hook），无未 memo 化派生值

#### 14.50.4 Task 21 UI 子集修复
- **错误恢复 UI**：[CharacterDialogueChat.hooks.ts](src/renderer/components/Character/CharacterDialogueChat/CharacterDialogueChat.hooks.ts) 新增 `clearError` 回调；[CharacterDialogueChat.tsx](src/renderer/components/Character/CharacterDialogueChat/CharacterDialogueChat.tsx) 错误提示区新增「重试」按钮（优先 `retryMessage` 最后一条 assistant，回退 `sendMessage` 最后一条 user）+「关闭」按钮
- **新建项目输入校验**：[WritingModeEntry.tsx](src/renderer/components/Creative/WritingMode/WritingModeEntry.tsx) `handleConfigConfirm` 新增防御性校验（config 非空对象 / `parameters.creativeDescription` 非空 / `modelConfig.model` 存在）
- **已修复项确认**：spec 行号过时（Task 8 重构后多数 P2 项已修复）——自动滚动 `behavior:'smooth'`、流式 `ChatTypingIndicator` 占位符、删除 Popconfirm、WorldBookEntryList 折叠懒加载均已存在

#### 14.50.5 涉及文件
| 文件 | 改动 |
|------|------|
| [VirtualizedMessageList.tsx](src/renderer/components/Character/CharacterDialogueChat/VirtualizedMessageList.tsx) | 新增，虚拟化列表组件 |
| [CharacterDialogueChat.tsx](src/renderer/components/Character/CharacterDialogueChat/CharacterDialogueChat.tsx) | 修改：虚拟化集成 + 错误恢复 UI |
| [CharacterDialogueChat.hooks.ts](src/renderer/components/Character/CharacterDialogueChat/CharacterDialogueChat.hooks.ts) | 修改：clearError 导出 |
| [dataService.ts](src/renderer/services/dataService.ts) | 新增，IPC 防腐层 |
| [dataStore.ts](src/renderer/stores/dataStore.ts) | 修改：委托 service |
| [usePanelResize.ts](src/renderer/components/Creative/WritingMode/usePanelResize.ts) | 新增，resize hook |
| [WritingModeRightPanel.tsx](src/renderer/components/Creative/WritingMode/WritingModeRightPanel.tsx) | 修改：消费 hook |
| [WritingModeEntry.tsx](src/renderer/components/Creative/WritingMode/WritingModeEntry.tsx) | 修改：输入校验 |

---

### 14.51 ⭐ 现有测试套件全量审核与缺陷修复（Spec: implement-agent-foundation-and-fix-defects / 阶段 8 Task 22）

#### 14.51.1 设计目标
对项目现有测试进行全量审核，识别并修复测试/实现一致性缺陷与测试环境隔离缺陷。vitest 通过率从「35 failed | 1328 passed (1363) + 2 套件加载崩溃」提升至「**1397 passed (1397) 全绿**」。所有修复不改变生产代码语义（除 storageService 防御性 guard）。

#### 14.51.2 【重点标记】修复的 Bug

**⚠️ Bug 1：sandbox.ts mode 类型回归（Task 17 引入）**
- **根因**：[sandbox.ts](src/main/services/agent/core/sandbox.ts) 的 `ToolExecutionContext.mode` 类型原为 `'dialogue' | 'writing' | 'game'`，Task 17 扩展 [contracts.ts](src/main/services/agent/contracts.ts) 的 `ToolCallContext.mode` 新增 `'worldbook'` 后未同步更新 sandbox 本地类型，导致 `toToolExecutionContext` 传递 `context?.mode` 时 TS2322
- **修复**：sandbox `mode` 类型对齐 contracts，新增 `'worldbook'`

**⚠️ Bug 2：stop sequences 测试与实现漂移（4 文件 32 用例）**
- **根因**：[PromptBuilder.ts](src/renderer/components/Character/CharacterDialogueChat/PromptBuilder.ts) 的 `buildStopSequences` / `buildStopSequencesForUserReply` 此前经「🐛 Bug修复（重点）」刻意移除单换行前缀变体（12→6 项 / 8→4 项），因 OpenAI-compatible 后端子串匹配会在 AI 引用用户/角色话语时误触发截断。但 4 个测试文件未同步更新，仍断言旧的单换行变体
- **修复**：[buildStopSequences.test.ts](src/renderer/components/Character/CharacterDialogueChat/__tests__/buildStopSequences.test.ts)（14→0）/ [buildStopSequencesForUserReply.test.ts](src/renderer/components/Character/CharacterDialogueChat/__tests__/buildStopSequencesForUserReply.test.ts)（16→0）/ [resolveStopForRequestBody.test.ts](src/renderer/components/Common/ChatEngine/__tests__/resolveStopForRequestBody.test.ts)（1→0）/ [e2e-chat-flow.test.ts](src/renderer/components/Character/CharacterDialogueChat/__tests__/e2e-chat-flow.test.ts)（1→0）全部对齐实现，并显式断言「不包含单换行变体」固化 Bug修复意图

**⚠️ Bug 3：PromptTemplateService 测试模板计数过期**
- **根因**：[PromptTemplateService.ts](src/main/services/PromptTemplateService.ts) 已新增第 14 个世界书模板 `world-book.generate-world-description`（世界书主题描述生成），但 [测试](src/main/services/__tests__/PromptTemplateService.test.ts) 仍断言 20 个模板（13 世界书）
- **修复**：`getAllTemplates` 期望 20→21，世界书模板期望 13→14，`expectedModuleIds` 补入 `generate-world-description`

**⚠️ Bug 4：storageService.setupIPC 在测试环境崩溃（2 套件加载失败）**
- **根因**：[storageService.ts](src/main/services/storageService.ts) 构造函数立即调用 `setupIPC()` → `ipcMain.handle(...)`，但 vitest 环境 `ipcMain` 为 `undefined`，导致所有经由 `VectorConfigManager → storageService` 的测试套件（ChatVectorizationService / e2e-performance）**模块加载即崩溃**（0 test run，套件级 FAIL）
- **修复**：`setupIPC` 入口加防御性 guard——`if (!ipcMain || typeof ipcMain.handle !== 'function')` 时记 warn 日志并跳过 IPC 注册；生产环境（Electron 主进程）`ipcMain` 始终可用，行为不变

**⚠️ Bug 5：ChatVectorizationService / e2e-performance 测试隔离缺陷（18 用例）**
- **根因**：Bug 4 解除套件加载崩溃后，暴露 18 个 `retrieveChatHistory` / `vectorizeIncremental` 用例返回 `[]`。测试 mock 了 `embeddingService`/`vectorStoreService`/`vectorRegistryService`，**但未 mock `vectorConfigManager`**，导致服务读取真实磁盘 `settings.json` 的 `vector.embeddingMode`——本机恰好为 `'disabled'`，触发短路 `return []`
- **修复**：[ChatVectorizationService.test.ts](src/main/services/__tests__/ChatVectorizationService.test.ts) 与 [e2e-performance.test.ts](src/renderer/components/Character/CharacterDialogueChat/__tests__/e2e-performance.test.ts) 新增 `vi.mock('.../VectorConfigManager', () => ({ vectorConfigManager: { loadVectorConfig: () => ({ embeddingMode: 'remote' }) } }))`，使测试与机器配置解耦（hermetic）

#### 14.51.3 验证
- `npx vitest run`：**60 个测试文件全部通过，1397/1397 用例通过**
- `npx tsc --noEmit`：agent 模块 0 错误（sandbox.ts TS2322 已消除），修改的测试文件零新增类型错误（e2e-chat-flow 的 4 个 TS6133 unused 与 e2e-performance 的 5 个 TS2322 measure helper 均为 pre-existing，与本次改动无关）

#### 14.51.4 涉及文件
| 文件 | 改动 |
|------|------|
| [sandbox.ts](src/main/services/agent/core/sandbox.ts) | 修改：mode 类型对齐 contracts（+`'worldbook'`） |
| [storageService.ts](src/main/services/storageService.ts) | 修改：setupIPC 防御性 guard |
| [buildStopSequences.test.ts](src/renderer/components/Character/CharacterDialogueChat/__tests__/buildStopSequences.test.ts) | 重写：对齐 6 项双换行实现 |
| [buildStopSequencesForUserReply.test.ts](src/renderer/components/Character/CharacterDialogueChat/__tests__/buildStopSequencesForUserReply.test.ts) | 重写：对齐 4 项双换行实现 |
| [resolveStopForRequestBody.test.ts](src/renderer/components/Common/ChatEngine/__tests__/resolveStopForRequestBody.test.ts) | 修改：集成断言对齐 |
| [e2e-chat-flow.test.ts](src/renderer/components/Character/CharacterDialogueChat/__tests__/e2e-chat-flow.test.ts) | 修改：stop 断言对齐 |
| [PromptTemplateService.test.ts](src/main/services/__tests__/PromptTemplateService.test.ts) | 修改：模板计数对齐（20→21, 13→14） |
| [ChatVectorizationService.test.ts](src/main/services/__tests__/ChatVectorizationService.test.ts) | 修改：+vectorConfigManager mock |
| [e2e-performance.test.ts](src/renderer/components/Character/CharacterDialogueChat/__tests__/e2e-performance.test.ts) | 修改：+vectorConfigManager mock |

---
