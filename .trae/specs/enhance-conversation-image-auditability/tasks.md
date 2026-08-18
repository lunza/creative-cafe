# Tasks

- [x] Task 1: 类型扩展 — ImageHistoryItem / CharacterTestChat / SDGenerationOptions 新增字段 ✅
  - [ ] SubTask 1.1: `src/renderer/components/Character/CharacterDialogueChat/CharacterDialogueChat.types.ts` 中 `ImageHistoryItem` 新增可选字段：`usedTags?: Array<{ text: string; weight?: number }>` / `usedPrompt?: string` / `usedNegativePrompt?: string` / `usedLoras?: Array<{ name: string; weight: number }>`，含 JSDoc 注释说明「该历史项生成时使用的标签/prompt 快照，用于图片下方标签展示」
  - [ ] SubTask 1.2: `src/renderer/stores/characterChatStore.ts` 中 `CharacterTestChat` 接口新增可选字段 `sessionTraits?: CharacterTraitItem[]`，含 JSDoc 注释说明「当前对话的临时特征覆盖，不写入角色卡 manifest；存在时 executeImageGeneration 优先从此读取」
  - [ ] SubTask 1.3: 定位 `SDGenerationOptions` 类型定义（在 `src/shared/types/sd.types.ts` 或 `sdGenerationService.ts` 内联），新增可选字段 `sourceContext?: { source: 'conversation' | 'asset-manager'; messageId?: string; characterCardId?: string; round?: number }`，含 JSDoc
  - [ ] SubTask 1.4: `src/renderer/types/electron.d.ts` 同步 `SDGenerationOptions` 内联类型签名（如存在）；`CharacterTestChat` 若在 electron.d.ts 有内联签名也同步

- [x] Task 2: 提示词落盘日志 — sdGenerationService 新增 image-generation logger ✅
  - [ ] SubTask 2.1: 在 `src/main/services/sdGenerationService.ts` 顶部 `import { createLogger } from './logger'` 并 `const logger = createLogger('image-generation')`
  - [ ] SubTask 2.2: 修改 `generateTxt2Img` 方法：在 `applyTraitsAndLora` 调用之后、HTTP 请求之前，调用 `logger.info('生成图片请求', details, context)`：
    - `message`: `生成图片请求 [${sourceContext?.source || 'unknown'}]`
    - `details`: 最终 prompt 字符串（多行，便于直接复制）
    - `context`: JSON 对象 `{ negativePrompt, traits: options.characterTraits, loras: options.selectedLoras, steps, cfgScale, sampler, scheduler, width, height, sourceContext }`
  - [ ] SubTask 2.3: 在 `generateTxt2Img` 失败分支（catch）调用 `logger.error('生成图片失败', error.message, { sourceContext, prompt })`
  - [ ] SubTask 2.4: 验证日志写入路径：开发环境为 `g:\AI\creative-cafe\logs\image-generation\`，生产环境为 `app.getAppPath()/logs/image-generation/`（复用 `getModuleLogDir` 既有逻辑，无需修改 logPathService）
  - [ ] SubTask 2.5: 在 `applyTraitsAndLora` 现有 `console.log` 调用处补充 `logger.debug` 调用（保留 console.log 不破坏现有行为），记录 traits 拼接中间结果与去重统计

- [x] Task 3: sourceContext 接线 — executeImageGeneration 传入来源标识 ✅
  - [x] SubTask 3.1: 在 `src/renderer/components/Character/CharacterDialogueChat/CharacterDialogueChat.tsx` 的 `executeImageGeneration` 中，构建 `sdOptions` 后、调用 `sd.generateTxt2Img` 前，向 `sdOptions.sourceContext` 赋值：`{ source: 'conversation', messageId, characterCardId: characterInfo.characterCardId, round: (parentMsg.imageAttachment?.history?.length || 0) + 1 }`
  - [x] SubTask 3.2: 验证 `buildSdOptionsFromConfig` 返回的对象可附加 `sourceContext` 字段（在 `buildSdOptions.ts` 的返回类型中显式声明 `sourceContext` 字段为可选，或直接在调用处 `Object.assign` / spread 添加）
  - [x] SubTask 3.3: 素材管理弹窗（AssetGenerateModal / AssetManagerModal）调用 `sd.generateTxt2Img` 处，向 options 传入 `sourceContext: { source: 'asset-manager' }`（搜索 `sd.generateTxt2Img` 调用点，确保全部调用方均传入 sourceContext）

- [x] Task 4: 标签快照写入 — executeImageGeneration 在 history 项中快照 usedTags/usedPrompt ✅
  - [x] SubTask 4.1: 在 `executeImageGeneration` 生成成功分支（`sdResult?.success && sdResult.imageBase64` 内），构造 `newHistoryItem` 时新增 `usedTags: mergedTraits`（合并去重后的完整 traits 数组）、`usedLoras: currentLoras.map(l => ({ name: l.name, weight: l.weight }))`
  - [x] SubTask 4.2: 由于最终 prompt 在主进程 `applyTraitsAndLora` 中组装，渲染进程无法直接拿到最终字符串。方案：在 `sdGenerationService.generateTxt2Img` 的返回值中新增 `finalPrompt?: string` 字段（`applyTraitsAndLora` 的返回值），`executeImageGeneration` 据此填充 `newHistoryItem.usedPrompt = sdResult.finalPrompt` 与 `usedNegativePrompt = negativePrompt`
  - [x] SubTask 4.3: 修改 `sdGenerationService.generateTxt2Img` 返回值类型，新增 `finalPrompt: string` 字段（始终返回，含 LoRA + traits 替换后的完整字符串）
  - [x] SubTask 4.4: 修改 `sd:generateTxt2Img` IPC handler 与 `electron.d.ts` 的返回值类型签名，同步 `finalPrompt` 字段
  - [x] SubTask 4.5: 验证旧数据兼容：旧 `ImageHistoryItem`（无 usedTags 字段）加载时字段为 undefined，UI 显示「此历史版本无标签快照」提示，不报错

- [x] Task 5: 图片下方标签展示 UI — ChatMessageBubble 新增可折叠标签面板 ✅
  - [x] SubTask 5.1: 在 `src/renderer/components/Character/CharacterDialogueChat/ChatMessageBubble.tsx` 图片区域 `chat-msg-image-actions` 下方，新增「查看本次生成标签」可折叠面板（仅 `imageAttachment.status === 'idle'` 且当前历史项有 `usedTags` 时渲染）
  - [x] SubTask 5.2: 面板结构：
    - 折叠头部：`<button type="button" className="chat-msg-image-tags-panel-header">` + `DownOutlined/RightOutlined` 图标 + 「查看本次生成标签」文案 + `<Tag>{tagsCount} tags</Tag>` 徽标
    - 展开后：`<div className="chat-msg-image-tags">` 内渲染 `usedTags.map(t => <Tag>{t.text}{t.weight && t.weight !== 1.0 && <span className="chat-msg-image-tag-weight">:{t.weight}</span>}</Tag>)`
    - 二级折叠：「查看完整 Prompt」按钮，展开后 `<pre className="chat-msg-image-prompt">{usedPrompt}</pre>` + 「Negative Prompt」`<pre>{usedNegativePrompt}</pre>` + LoRAs 列表
  - [x] SubTask 5.3: 面板折叠状态用 `useState` 本地管理（`tagsPanelExpanded` / `promptPanelExpanded`），默认折叠
  - [x] SubTask 5.4: 历史导航切换时（`currentIndex` 变化），标签面板自动折叠回默认状态（useEffect 依赖 `imageAttachment?.currentIndex` 重置 expanded 状态）
  - [x] SubTask 5.5: 当当前历史项无 `usedTags`（旧数据）时，显示「此历史版本无标签快照」灰色提示，不显示展开按钮

- [x] Task 6: 标签面板样式 — ChatMessageBubble.css 新增样式 ✅
  - [x] SubTask 6.1: 新增 `.chat-msg-image-tags-panel`（折叠面板容器）、`.chat-msg-image-tags-panel-header`（头部按钮行）、`.chat-msg-image-tags`（Tag 列表 flex wrap 容器）、`.chat-msg-image-prompt`（`<pre>` 块：等宽字体 + 横向滚动 + 暗色背景 + 圆角边框）、`.chat-msg-image-tag-weight`（权重徽标：小字号 + `var(--color-warning)` 黄色）
  - [x] SubTask 6.2: 样式遵循暗色主题 CSS 变量（`var(--bg-elevated)` / `var(--text-secondary)` / `var(--border-base)` / `var(--text-tertiary)` / `var(--color-warning)` 等），所有属性均含 hex fallback；亮/暗主题通过 ui-variables.css 同名变量双值定义
  - [x] SubTask 6.3: Tag 列表与权重徽标的视觉风格参考 `RagQualityReport.tsx` 的 Tag 渲染（保持视觉一致性，使用 `var(--bg-elevated)` 半透明背景 + `var(--text-secondary)` 文字色）

- [x] Task 7: sessionTraits store 扩展 — characterChatStore 新增临时特征状态与 actions ✅
  - [x] SubTask 7.1: `src/renderer/stores/characterChatStore.ts` 中 `CharacterTestChat` 接口新增 `sessionTraits?: CharacterTraitItem[]` 字段（Task 1.2 已定义类型，此处确保 store 内部使用）
  - [x] SubTask 7.2: `safeMessages` 映射逻辑不变（sessionTraits 是对话级字段，不在 messages 内）；但 `saveTestChat` 序列化时需确保 `currentTestChat.sessionTraits` 一并保存（修改 saveTestChat 的 payload 构造，新增 `sessionTraits` 字段透传）
  - [x] SubTask 7.3: 新增 action `setSessionTraits(traits: CharacterTraitItem[])`：设置当前对话的 sessionTraits（深拷贝入参），触发 `saveTestChat` 持久化
  - [x] SubTask 7.4: 新增 action `resetSessionTraits()`：将 `currentTestChat.sessionTraits` 设为 undefined，触发 `saveTestChat` 持久化
  - [x] SubTask 7.5: 新增 action `updateSessionTrait(traitId: string, updates: Partial<CharacterTraitItem>)`：更新 sessionTraits 中对应 trait（若 sessionTraits 不存在则先从 characterTraitStore.traits 深拷贝初始化）
  - [x] SubTask 7.6: 新增 action `addSessionTrait(categoryId: string, text: string)`：向 sessionTraits 追加新特征（genTraitId 生成 id），触发持久化
  - [x] SubTask 7.7: 新增 action `removeSessionTrait(traitId: string)`：从 sessionTraits 移除，触发持久化
  - [x] SubTask 7.8: `loadTestChat` 加载对话时，若持久化数据含 `sessionTraits` 字段则恢复到 `currentTestChat.sessionTraits`

- [x] Task 8: ConfigPanel 特征分类区域升级 — 从只读升级为可编辑 ✅
  - [x] SubTask 8.1: `src/renderer/components/Character/CharacterDialogueChat/ConfigPanel.tsx` 中，从 `useCharacterChatStore` 订阅 `currentTestChat.sessionTraits` / `setSessionTraits` / `updateSessionTrait` / `addSessionTrait` / `removeSessionTrait` / `resetSessionTraits`
  - [x] SubTask 8.2: 派生 `effectiveTraits`：`sessionTraits ?? characterTraits`（characterTraits 来自 characterTraitStore），特征分类区域渲染基于 `effectiveTraits`
  - [x] SubTask 8.3: 顶部「角色特征分类」标题旁新增「临时编辑中」徽标（仅 `sessionTraits` 存在时显示，黄色警告色 + EditOutlined + Tooltip）+ 「重置为角色卡特征」按钮（仅 sessionTraits 存在时显示，点击触发 `resetSessionTraits` 含 Modal.confirm 二次确认）
  - [x] SubTask 8.4: 每个 Tag 渲染改为可交互：点击 Tag 切换 `enabled` 状态（调 `updateSessionTrait(trait.id, { enabled: !trait.enabled })`）；Tag 悬浮显示删除按钮（调 `removeSessionTrait(trait.id)`）
  - [x] SubTask 8.5: Tag 文本 inline 编辑：双击 Tag 进入编辑态（Input 组件），回车确认调 `updateSessionTrait(trait.id, { text: newValue, originalText: undefined })`，Esc 取消
  - [x] SubTask 8.6: 权重徽标：带非默认权重的 Tag 显示权重徽标（参考 `add-sdxl-prompt-weight-support` 的徽标样式），点击徽标进入权重编辑态（InputNumber），确认调 `updateSessionTrait(trait.id, { weight: newWeight })`
  - [x] SubTask 8.7: 每个分类下新增「+ 添加特征」按钮，点击弹出 prompt 输入特征文本，确认调 `addSessionTrait(cat.id, text)`
  - [x] SubTask 8.8: 分类级 Checkbox 保留现有行为，但作用于 `effectiveTraits`（批量切换通过 `setSessionTraits` 全量替换，首次调用 lazy-init sessionTraits）

- [x] Task 9: ConfigPanel 编辑态样式 — ConfigPanel.css 新增样式 ✅
  - [x] SubTask 9.1: 新增 `.image-gen-trait-tag.editable`（可交互 Tag 样式：cursor pointer + hover 高亮）、`.image-gen-trait-tag-edit-btn`（删除按钮：绝对定位 + 悬浮显示）、`.image-gen-trait-tag-weight-badge`（权重徽标：小圆角 + 灰色背景）、`.image-gen-trait-tag-editing`（编辑态 Input 样式）、`.image-gen-add-trait-btn`（添加特征按钮）、`.image-gen-session-badge`（临时编辑中徽标：黄色警告色）、`.image-gen-reset-btn`（重置按钮）
  - [x] SubTask 9.2: 样式遵循暗色主题 CSS 变量，避免硬编码 hex（参考 `ui-variables.css` 既有变量）

- [x] Task 10: executeImageGeneration 特征源切换 — 优先 sessionTraits ✅
  - [x] SubTask 10.1: 在 `src/renderer/components/Character/CharacterDialogueChat/CharacterDialogueChat.tsx` 的 `executeImageGeneration` 中，从 `useCharacterChatStore.getState().currentTestChat?.sessionTraits` 读取临时特征
  - [x] SubTask 10.2: 派生 `currentTraits`：`sessionTraits ?? useCharacterTraitStore.getState().traits`
  - [x] SubTask 10.3: `enabledTraitTexts` 与 `buildSdOptionsFromConfig` 的 `effectiveTraits` 均使用 `currentTraits`（替换现有的 `useCharacterTraitStore.getState().traits` 直接读取）
  - [x] SubTask 10.4: 验证日志：在 `executeImageGeneration` 内 `console.log` 输出特征来源（`[executeImageGeneration] 特征来源: ${sessionTraits ? 'sessionTraits (临时编辑)' : 'characterTraitStore (角色卡)'}`），便于调试

- [x] Task 11: hooks 扩展 — CharacterDialogueChat.hooks 透传 sessionTraits ✅
  - [x] SubTask 11.1: `src/renderer/components/Character/CharacterDialogueChat/CharacterDialogueChat.hooks.ts` 中 `messagesToSave` 映射无需修改（sessionTraits 是对话级字段，不在 messages 内）
  - [x] SubTask 11.2: 确认 `saveChatToStore` 调用路径会触发 `characterChatStore.saveTestChat`，且 `saveTestChat` 内部已序列化 `sessionTraits`（Task 7.2 已处理）
  - [x] SubTask 11.3: 若 `saveChatToStore` 构造 payload 时显式列字段（而非 spread currentTestChat），需补充 `sessionTraits: currentTestChat?.sessionTraits` 字段透传

- [x] Task 12: 文档增量更新 ✅
  - [x] SubTask 12.1: `docs/FIX_RECORDS.md` 新增 §7.34 章节，覆盖 Task 1/2/4/5/6/8/9/10/11（Task 3 已记录于 §7.32、Task 7 已记录于 §7.33）；含改动 / 文件清单 / 设计决策 6 项 / TypeScript 注意事项 / 验证状态 / 关联章节
  - [x] SubTask 12.2: `CODE_WIKI.md` 新增 §39「对话图片生成可审计性架构」章节（原 §3/§4.4/§9/§10 因磁盘异常丢失，按现有「按 spec 顺序追加 ## §N 章节」模式记录）：类型层扩展表 / sdGenerationService 服务层 / characterChatStore 5 个 actions 表 / ChatMessageBubble 标签展示面板 / ConfigPanel 可编辑交互表 / 数据流（executeImageGeneration + sourceContext）/ 涉及文件表 / 设计约定 5 项
  - [x] SubTask 12.3: `CHANGELOG.md` 新增「[功能] - 2026-08-09 - 对话图片生成可审计性三件套」版本条目（顶部插入），覆盖全部 11 个 Task 的实现细节 + 设计决策 + 涉及文件 + 验证状态

# Task Dependencies

- Task 1（类型扩展）独立，最高优先级，其他任务依赖此
- Task 2（logger）独立，可与 Task 1 并行
- Task 3（sourceContext 接线）depends on Task 1（类型）+ Task 2（logger 落盘）
- Task 4（标签快照写入）depends on Task 1（类型）+ Task 3（sourceContext 接线，用于 round 计算）
- Task 5（标签展示 UI）depends on Task 1（类型）+ Task 4（快照数据可用）
- Task 6（标签面板样式）depends on Task 5
- Task 7（sessionTraits store）depends on Task 1（类型）
- Task 8（ConfigPanel 编辑 UI）depends on Task 7（store actions）
- Task 9（ConfigPanel 编辑样式）depends on Task 8
- Task 10（executeImageGeneration 特征源切换）depends on Task 7（sessionTraits store）+ Task 4（标签快照写入，确保临时编辑 reflected in usedTags）
- Task 11（hooks 透传）depends on Task 7
- Task 12（文档）依赖全部前序任务完成

# 并行化建议

- **第一批并行**：Task 1（类型扩展）+ Task 2（logger 落盘）
- **第二批并行**（Task 1 完成后）：Task 3（sourceContext 接线）+ Task 7（sessionTraits store）
- **第三批并行**（Task 3 + 7 完成后）：Task 4（标签快照写入）+ Task 8（ConfigPanel 编辑 UI）+ Task 10（executeImageGeneration 特征源切换）
- **第四批并行**（Task 4 + 8 完成后）：Task 5（标签展示 UI）+ Task 6（标签面板样式）+ Task 9（ConfigPanel 编辑样式）+ Task 11（hooks 透传）
- **第五批**：Task 12（文档）依赖全部完成
