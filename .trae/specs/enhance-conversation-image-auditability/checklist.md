# Checklist

## 类型扩展（Task 1）
- [ ] `ImageHistoryItem` 新增 `usedTags?: Array<{ text: string; weight?: number }>` 字段，含 JSDoc
- [ ] `ImageHistoryItem` 新增 `usedPrompt?: string` 字段，含 JSDoc
- [ ] `ImageHistoryItem` 新增 `usedNegativePrompt?: string` 字段，含 JSDoc
- [ ] `ImageHistoryItem` 新增 `usedLoras?: Array<{ name: string; weight: number }>` 字段，含 JSDoc
- [ ] `CharacterTestChat` 新增 `sessionTraits?: CharacterTraitItem[]` 字段，含 JSDoc（会话隔离说明）
- [ ] `SDGenerationOptions` 新增 `sourceContext?` 字段（含 source / messageId / characterCardId / round），含 JSDoc
- [ ] `electron.d.ts` 同步 `SDGenerationOptions` 与 `CharacterTestChat` 内联类型签名（如存在）

## 提示词落盘日志（Task 2）
- [ ] `sdGenerationService.ts` 顶部 `import { createLogger } from './logger'` + `const logger = createLogger('image-generation')`
- [ ] `generateTxt2Img` 在 `applyTraitsAndLora` 之后、HTTP 请求之前调用 `logger.info` 记录完整请求快照
- [ ] 日志 `details` 字段为最终 prompt 字符串（多行可复制）
- [ ] 日志 `context` 字段为 JSON 对象（含 negativePrompt / traits / loras / 采样参数 / 尺寸 / sourceContext）
- [ ] `generateTxt2Img` catch 分支调用 `logger.error` 记录失败
- [ ] `applyTraitsAndLora` 现有 `console.log` 处补充 `logger.debug` 调用（保留 console.log）
- [ ] 验证日志文件路径：开发环境 `logs/image-generation/image-generation_<timestamp>.log`
- [ ] 验证日志轮转：10MB 自动轮转，最多保留 5 个文件

## sourceContext 接线（Task 3）
- [ ] `executeImageGeneration` 构建 `sdOptions` 后赋值 `sourceContext = { source: 'conversation', messageId, characterCardId, round }`
- [ ] `round` 计算正确：`(parentMsg.imageAttachment?.history?.length || 0) + 1`（首次=1，第 N 次重生成=N+1）
- [ ] `buildSdOptions.ts` 返回类型显式声明 `sourceContext` 可选字段（或调用处 spread 添加）
- [ ] AssetGenerateModal 调用 `sd.generateTxt2Img` 处传入 `sourceContext: { source: 'asset-manager' }`
- [ ] AssetManagerModal 调用 `sd.generateTxt2Img` 处传入 `sourceContext: { source: 'asset-manager' }`
- [ ] 全局搜索 `sd.generateTxt2Img` 调用点，确保全部调用方传入 sourceContext

## 标签快照写入（Task 4）
- [ ] `sdGenerationService.generateTxt2Img` 返回值新增 `finalPrompt: string` 字段
- [ ] `finalPrompt` 为 `applyTraitsAndLora` 处理后的完整字符串（含 LoRA + traits 替换）
- [ ] `sd:generateTxt2Img` IPC handler 透传 `finalPrompt`
- [ ] `electron.d.ts` 同步 `generateTxt2Img` 返回值类型签名（新增 `finalPrompt`）
- [ ] `executeImageGeneration` 生成成功时，`newHistoryItem` 含 `usedTags`（mergedTraits）
- [ ] `newHistoryItem` 含 `usedPrompt`（来自 `sdResult.finalPrompt`）
- [ ] `newHistoryItem` 含 `usedNegativePrompt`
- [ ] `newHistoryItem` 含 `usedLoras`（currentLoras 快照）
- [ ] 旧 `ImageHistoryItem`（无 usedTags）加载时字段为 undefined，不报错

## 图片下方标签展示 UI（Task 5）
- [ ] `ChatMessageBubble.tsx` 图片区域下方新增「查看本次生成标签」可折叠面板
- [ ] 面板仅 `imageAttachment.status === 'idle'` 且当前历史项有 `usedTags` 时渲染
- [ ] 折叠头部含图标 + 文案 + 标签数量徽标
- [ ] 展开后显示 Tag 列表（每个 Tag 含文本 + 权重徽标）
- [ ] 二级折叠「查看完整 Prompt」展开后显示 `<pre>` 块（usedPrompt + usedNegativePrompt）
- [ ] 折叠状态用 `useState` 本地管理（tagsPanelExpanded / promptPanelExpanded）
- [ ] 历史导航切换时（currentIndex 变化）标签面板自动折叠
- [ ] 当前历史项无 usedTags 时显示「此历史版本无标签快照」灰色提示
- [ ] 生成中/错误状态不显示标签面板按钮

## 标签面板样式（Task 6）
- [ ] `.chat-msg-image-tags-panel` 容器样式
- [ ] `.chat-msg-image-tags-panel-header` 头部按钮行样式
- [ ] `.chat-msg-image-tags` Tag 列表 flex wrap 容器样式
- [ ] `.chat-msg-image-prompt` `<pre>` 块样式（等宽字体 + 横向滚动 + 暗色背景 + 圆角边框）
- [ ] `.tag-weight` 权重徽标样式（小字号 + 灰色）
- [ ] 样式遵循暗色主题 CSS 变量（无硬编码 hex）
- [ ] 亮色主题通过 CSS 变量双值定义
- [ ] 视觉风格与 `RagQualityReport.tsx` 的 Tag 渲染保持一致

## sessionTraits store 扩展（Task 7）
- [ ] `CharacterTestChat` 接口新增 `sessionTraits?: CharacterTraitItem[]` 字段
- [ ] `saveTestChat` 序列化 payload 含 `sessionTraits` 字段透传
- [ ] `loadTestChat` 加载时恢复 `sessionTraits`（若持久化数据含此字段）
- [ ] 新增 `setSessionTraits(traits)` action（深拷贝入参 + 触发持久化）
- [ ] 新增 `resetSessionTraits()` action（设为 undefined + 触发持久化）
- [ ] 新增 `updateSessionTrait(traitId, updates)` action（sessionTraits 不存在时先从 characterTraitStore.traits 深拷贝初始化）
- [ ] 新增 `addSessionTrait(categoryId, text)` action（genTraitId 生成 id + 触发持久化）
- [ ] 新增 `removeSessionTrait(traitId)` action（移除 + 触发持久化）

## ConfigPanel 特征分类区域升级（Task 8）
- [ ] ConfigPanel 从 `useCharacterChatStore` 订阅 sessionTraits 与新 actions
- [ ] 派生 `effectiveTraits = sessionTraits ?? characterTraits`
- [ ] 「临时编辑中」徽标在 sessionTraits 存在时显示（黄色 + EditOutlined + Tooltip）
- [ ] 「重置为角色卡特征」按钮在 sessionTraits 存在时显示（含 Modal.confirm 二次确认）
- [ ] 单条 Tag 点击切换 enabled 状态（调 updateSessionTrait）
- [ ] Tag 悬浮显示删除按钮（调 removeSessionTrait）
- [ ] Tag 文本双击进入 inline 编辑态（Input + 回车确认 / Esc 取消）
- [ ] 权重徽标点击进入权重编辑态（InputNumber + 确认调 updateSessionTrait）
- [ ] 每个分类下「+ 添加特征」按钮（InputModal + 调 addSessionTrait）
- [ ] 分类级 Checkbox 作用于 effectiveTraits（sessionTraits 存在时批量调 updateSessionTrait）

## ConfigPanel 编辑态样式（Task 9）
- [ ] `.image-gen-trait-tag.editable` 可交互 Tag 样式（cursor pointer + hover 高亮）
- [ ] `.image-gen-trait-tag-edit-btn` 删除按钮样式（绝对定位 + 悬浮显示）
- [ ] `.image-gen-trait-tag-weight-badge` 权重徽标样式
- [ ] `.image-gen-trait-tag-editing` 编辑态 Input 样式
- [ ] `.image-gen-add-trait-btn` 添加特征按钮样式
- [ ] `.image-gen-session-badge` 临时编辑中徽标样式（黄色警告色）
- [ ] `.image-gen-reset-btn` 重置按钮样式
- [ ] 样式遵循暗色主题 CSS 变量（无硬编码 hex）

## executeImageGeneration 特征源切换（Task 10）
- [ ] `executeImageGeneration` 从 `useCharacterChatStore.getState().currentTestChat?.sessionTraits` 读取
- [ ] 派生 `currentTraits = sessionTraits ?? useCharacterTraitStore.getState().traits`
- [ ] `enabledTraitTexts` 使用 `currentTraits`
- [ ] `buildSdOptionsFromConfig` 的 `effectiveTraits` 参数传入 `currentTraits`
- [ ] 日志输出特征来源（sessionTraits / characterTraitStore）

## hooks 透传（Task 11）
- [ ] 确认 `saveChatToStore` 触发 `saveTestChat` 且序列化含 `sessionTraits`
- [ ] 若 `saveChatToStore` 显式列字段构造 payload，补充 `sessionTraits` 字段透传
- [ ] `messagesToSave` 映射无需修改（sessionTraits 不在 messages 内）

## 端到端验证
- [ ] `npx tsc --noEmit` 所有修改文件无新增错误
- [ ] 提示词落盘：生成图片后 `logs/image-generation/` 目录下日志文件含完整 prompt + traits + loras + sourceContext
- [ ] 标签展示：图片下方「查看本次生成标签」面板可折叠展开，显示 Tag 列表 + 完整 Prompt
- [ ] 历史导航：切换历史图片时标签面板同步刷新为对应历史项的快照
- [ ] 临时编辑：ConfigPanel 修改特征后「临时编辑中」徽标显示，图片生成使用临时特征
- [ ] 临时编辑持久化：关闭重开对话后 sessionTraits 恢复，徽标重新显示
- [ ] 重置功能：点击「重置为角色卡特征」后 sessionTraits 清空，特征回退到角色卡原始数据
- [ ] 角色卡隔离：临时编辑后切换角色卡/新建对话，新对话不继承 sessionTraits
- [ ] 角色卡 manifest 不受影响：临时编辑后角色卡 manifest 数据未变化（AssetManagerModal 查看确认）
- [ ] 旧数据兼容：旧 ImageHistoryItem（无 usedTags）加载显示「此历史版本无标签快照」提示
- [ ] 旧对话兼容：旧 CharacterTestChat（无 sessionTraits）加载正常，行为与现有逻辑一致

## 文档（Task 12）
- [x] `docs/FIX_RECORDS.md` 新增 §7.34 章节（覆盖 Task 1/2/4/5/6/8/9/10/11；Task 3 已记录于 §7.32，Task 7 已记录于 §7.33）
- [x] `CODE_WIKI.md` 新增 §39「对话图片生成可审计性架构」章节（原 §3/§4.4/§9/§10 因磁盘异常丢失，按现有「按 spec 顺序追加 ## §N 章节」模式记录）
  - 类型层扩展表（ImageHistoryItem 4 字段 / CharacterTestChat.sessionTraits / SDGenerationOptions.sourceContext）
  - 服务层 sdGenerationService（image-generation logger + finalPrompt 返回值）
  - Store 层 characterChatStore 5 个 actions 表
  - UI 层 ChatMessageBubble 标签展示面板 + ConfigPanel 可编辑交互表
  - 数据流 executeImageGeneration + sourceContext 接线
  - 涉及文件表 + 设计约定 5 项
- [x] `CHANGELOG.md` 新增「[功能] - 2026-08-09 - 对话图片生成可审计性三件套」版本条目（顶部插入）
