# 对话图片生成可审计性增强 Spec

## Why

当前对话图片生成链路存在三类可审计性缺口：
1. **提示词无落盘**：`sdGenerationService.applyTraitsAndLora`（[sdGenerationService.ts:776-898](file:///g:/AI/creative-cafe/src/main/services/sdGenerationService.ts#L776-L898)）仅用 `console.log` 输出最终提示词，重启后丢失。用户无法事后追溯"这张图当时用了什么 prompt/标签/LoRA"。
2. **图片下方无标签展示**：`ImageAttachment`（[CharacterDialogueChat.types.ts:50-67](file:///g:/AI/creative-cafe/src/renderer/components/Character/CharacterDialogueChat/CharacterDialogueChat.types.ts#L50-L67)）只存 assetId/emotion/history，渲染层（[ChatMessageBubble.tsx:520-603](file:///g:/AI/creative-cafe/src/renderer/components/Character/CharacterDialogueChat/ChatMessageBubble.tsx#L520-L603)）无标签展示，用户无法在对话流中实时核对"图片与剧情/标签是否一致"。素材管理弹窗已有 `RagQualityReport`（[RagQualityReport.tsx](file:///g:/AI/creative-cafe/src/renderer/components/Character/CharacterDialogueChat/RagQualityReport.tsx)）标签展示范式，但对话流未复用。
3. **特征临时编辑无会话隔离**：`ConfigPanel`（[ConfigPanel.tsx:256-295](file:///g:/AI/creative-cafe/src/renderer/components/Character/CharacterDialogueChat/ConfigPanel.tsx#L256-L295)）右侧"角色特征分类"仅支持分类级开关，单条特征编辑必须进入 `AssetManagerModal`/`AssetGenerateModal`，且编辑会通过 `characterTraitStore.saveTraits` 持久化到角色卡 manifest（跨对话生效）。用户在对话中"只为本次剧情临时调整一个特征"的需求无入口，强行编辑会污染角色卡数据。

## What Changes

### 提示词落盘日志
- 新增 `image-generation` 模块日志器（`createLogger('image-generation')`），落盘到 `logs/image-generation/image-generation_<timestamp>.log`
- 在 `sdGenerationService.generateTxt2Img` 内部（`applyTraitsAndLora` 之后、HTTP 请求之前）记录完整请求快照：最终 prompt / negativePrompt / 合并后 traits（含权重）/ LoRA 列表 / 采样参数 / 图片尺寸 / 调用来源（conversation / asset-manager）
- 在对话图片生成路径 `CharacterDialogueChat.executeImageGeneration` 调用 `sd.generateTxt2Img` 时，通过新增的 `options.sourceContext` 字段标识来源（含 messageId / characterCardId / 生成轮次），落盘日志可据此关联到具体对话消息

### 图片下方标签展示
- **BREAKING — 数据模型扩展**：`ImageHistoryItem` 新增可选字段 `usedTags?: Array<{ text: string; weight?: number }>` / `usedPrompt?: string` / `usedNegativePrompt?: string` / `usedLoras?: Array<{ name: string; weight: number }>`，每次生成时快照本次使用的完整标签与提示词，存入对应历史项
- `ChatMessageBubble` 图片区域下方新增可折叠「查看本次生成标签」面板，展示当前 `history[currentIndex]` 对应的 `usedTags`（Tag 列表，含权重徽标）+ 可展开的「完整 Prompt」`<pre>` 块
- 历史导航切换时，标签面板同步刷新为对应历史项的快照（每张图对应自己生成时的标签）
- UI 风格参考 `RagQualityReport` 的折叠头部 + Tag 列表布局，但简化为只读展示（无 ✅/❌ 徽标、无撤销操作）

### 角色特征临时编辑（会话隔离）
- **BREAKING — 数据模型扩展**：`CharacterTestChat`（`characterChatStore`）新增可选字段 `sessionTraits?: CharacterTraitItem[]`，存储当前对话的临时特征覆盖；不写入角色卡 manifest
- `ConfigPanel`「角色特征分类」区域从只读升级为可编辑：
  - 单条特征：点击 Tag 进入编辑态（文本 + 权重），删除按钮，启用/禁用切换
  - 分类级：保留原有全选开关，新增「添加特征」按钮（在该分类下追加临时特征）
  - 顶部新增「重置为角色卡特征」按钮（清空 `sessionTraits`，回退到 `characterTraitStore.traits`）+ 「临时编辑中」徽标（当 `sessionTraits` 存在时显示）
- 编辑操作只修改 `sessionTraits`，不调用 `characterTraitStore.saveTraits`；随 `saveTestChat` 持久化到对话记录（关闭重开仍保留临时编辑，但切换角色卡/新建对话不继承）
- `executeImageGeneration` 读取特征时优先用 `sessionTraits`（若存在），否则回退到 `characterTraitStore.traits`（现有行为不变）
- `buildSdOptionsFromConfig` 的 `effectiveTraits` 参数同步从 `sessionTraits` 传入（用于 `detectGenderTag` 推断）

## Impact

- Affected specs:
  - `add-conversation-image-generation`（数据模型扩展 ImageHistoryItem）
  - `enhance-conversation-image-bubble`（图片区域新增标签面板）
  - `fix-conversation-image-generation-bugs`（ConfigPanel 特征分类区域从只读升级为可编辑，executeImageGeneration 特征读取源变更）
  - `optimize-trait-translation-and-temp-scheme`（临时方案持久化与本次会话隔离临时编辑的区别需在文档中澄清：前者跨对话持久到 manifest，后者仅绑定当前对话记录）
- Affected code:
  - `src/main/services/logger.ts` — 无需修改（复用 `createLogger`）
  - `src/main/services/sdGenerationService.ts` — `generateTxt2Img` 内新增 `image-generation` logger 调用，记录最终 prompt + 全部上下文
  - `src/shared/types/sd.types.ts`（或 SDGenerationOptions 定义处）— 新增 `sourceContext?: { source: 'conversation' | 'asset-manager'; messageId?: string; characterCardId?: string; round?: number }` 可选字段
  - `src/renderer/components/Character/CharacterDialogueChat/CharacterDialogueChat.types.ts` — `ImageHistoryItem` 新增 `usedTags` / `usedPrompt` / `usedNegativePrompt` / `usedLoras` 字段
  - `src/renderer/components/Character/CharacterDialogueChat/ChatMessageBubble.tsx` — 图片区域下方新增可折叠标签面板
  - `src/renderer/components/Character/CharacterDialogueChat/ChatMessageBubble.css` — 标签面板样式
  - `src/renderer/components/Character/CharacterDialogueChat/CharacterDialogueChat.tsx` — `executeImageGeneration` 在生成成功时快照 usedTags/usedPrompt 写入 history 项；读取特征时优先用 sessionTraits
  - `src/renderer/components/Character/CharacterDialogueChat/ConfigPanel.tsx` — 特征分类区域从只读升级为可编辑，新增「添加特征」/「重置」/「临时编辑中」徽标
  - `src/renderer/components/Character/CharacterDialogueChat/ConfigPanel.css` — 编辑态样式
  - `src/renderer/stores/characterChatStore.ts` — `CharacterTestChat` 新增 `sessionTraits` 字段；`saveTestChat` / `safeMessages` 映射透传 `sessionTraits`；新增 `setSessionTraits` / `resetSessionTraits` action
  - `src/renderer/components/Character/CharacterDialogueChat/CharacterDialogueChat.hooks.ts` — `messagesToSave` 透传 `sessionTraits`（如有）；新增 `updateSessionTrait` / `addSessionTrait` / `removeSessionTrait` / `resetSessionTraits` hooks

## ADDED Requirements

### Requirement: 图片生成提示词落盘日志

系统 SHALL 在每次调用 `sd:generateTxt2Img` 时，将完整的最终提示词与生成上下文记录到 `logs/image-generation/` 目录下的日志文件，确保事后可追溯。

#### Scenario: 落盘日志内容完整
- **WHEN** 系统调用 `sdGenerationService.generateTxt2Img` 并完成 `applyTraitsAndLora` 处理
- **THEN** 日志文件中新增一条记录，包含：时间戳、调用来源（conversation / asset-manager）、最终 prompt（替换占位符 + 注入 LoRA 后的完整字符串）、negativePrompt、合并后 traits 列表（含权重）、LoRA 列表（name + weight）、采样参数（steps / cfgScale / sampler / scheduler）、图片尺寸（width × height）、sourceContext（messageId / characterCardId / round，仅 conversation 来源）
- **AND** 日志行格式遵循 `[YYYY-MM-DD HH:mm:ss] [INFO] [image-generation] <message>`，复杂对象以 JSON 缩进 2 空格附在 `details` / `context` 字段

#### Scenario: 对话来源可关联到消息
- **WHEN** 对话图片生成路径（`executeImageGeneration`）调用 `sd.generateTxt2Img`
- **THEN** 传入的 `options.sourceContext.source === 'conversation'`
- **AND** `sourceContext.messageId` 为父消息 ID
- **AND** `sourceContext.characterCardId` 为当前角色卡 ID
- **AND** `sourceContext.round` 为该消息的重新生成轮次（首次=1，第 N 次重生成=N+1）
- **AND** 日志记录中包含上述全部字段，可据此在对话流中定位到具体消息与具体历史图片

#### Scenario: 素材管理来源标识
- **WHEN** 素材管理弹窗（AssetGenerateModal / AssetManagerModal）调用 `sd.generateTxt2Img`
- **THEN** 传入的 `options.sourceContext.source === 'asset-manager'`
- **AND** `sourceContext.messageId` 省略
- **AND** 日志记录区分来源，不与对话图片混淆

#### Scenario: 日志文件轮转
- **WHEN** 单个日志文件达到 10MB
- **THEN** 自动创建新日志文件（文件名含时间戳）
- **AND** 最多保留 5 个历史日志文件，超出时删除最旧的

### Requirement: 图片下方标签展示

系统 SHALL 在每张生成图片下方提供可折叠的标签展示面板，显示该图片生成时使用的完整标签与提示词，支持历史导航切换时同步刷新。

#### Scenario: 标签面板默认折叠
- **WHEN** 图片生成成功并显示（`imageAttachment.status === 'idle'`）
- **THEN** 图片区域下方显示「查看本次生成标签」可折叠按钮（默认折叠）
- **AND** 按钮右侧显示标签数量徽标（如「12 tags」）

#### Scenario: 展开标签面板
- **WHEN** 用户点击「查看本次生成标签」按钮
- **THEN** 面板展开，显示当前 `history[currentIndex].usedTags` 的 Tag 列表
- **AND** 每个 Tag 显示文本，带非默认权重的 Tag 显示权重徽标（如 `(blue_eyes:1.5)`）
- **AND** 面板底部有「查看完整 Prompt」二级折叠，展开后显示 `usedPrompt` + `usedNegativePrompt` 的 `<pre>` 块（等宽字体，可横向滚动）

#### Scenario: 历史导航同步刷新
- **WHEN** 用户点击「上一张」/「下一张」切换历史图片
- **THEN** 标签面板自动刷新为 `history[新currentIndex].usedTags` / `usedPrompt`
- **AND** 若该历史项无 `usedTags` 字段（旧数据迁移过来的历史项），显示「此历史版本无标签快照」提示

#### Scenario: 生成中/错误状态不显示面板
- **WHEN** `imageAttachment.status === 'generating'` 或 `'error'`
- **THEN** 不显示「查看本次生成标签」按钮（仅 idle 状态显示）

#### Scenario: 标签快照写入历史项
- **WHEN** 图片生成成功，系统追加新的 `ImageHistoryItem` 到 `history`
- **THEN** 该历史项包含 `usedTags`（合并去重后的完整 traits 数组，含权重）
- **AND** 包含 `usedPrompt`（`applyTraitsAndLora` 返回的最终 prompt 字符串）
- **AND** 包含 `usedNegativePrompt`
- **AND** 包含 `usedLoras`（LoRA 列表快照）

### Requirement: 角色特征临时编辑（会话隔离）

系统 SHALL 在对话右侧 `ConfigPanel`「角色特征分类」区域提供临时编辑功能，编辑仅绑定当前对话记录，不影响角色卡 manifest 数据。

#### Scenario: 进入临时编辑态
- **WHEN** 用户在 `ConfigPanel` 特征分类区域对任一特征执行编辑操作（修改文本 / 修改权重 / 删除 / 添加新特征 / 切换单条启用）
- **THEN** 系统在 `characterChatStore.currentTestChat.sessionTraits` 写入一份完整的特征快照（从 `characterTraitStore.traits` 深拷贝并应用本次编辑）
- **AND** 后续所有编辑操作只修改 `sessionTraits`，不调用 `characterTraitStore.saveTraits`
- **AND** 顶部显示「临时编辑中」徽标（黄色警告色）

#### Scenario: 编辑操作类型
- **WHEN** 用户在特征分类区域操作
- **THEN** 支持以下编辑：
  - 单条特征文本编辑（点击 Tag 进入 inline 编辑态）
  - 单条特征权重编辑（权重徽标点击进入数值输入）
  - 单条特征启用/禁用切换（点击 Tag 切换 enabled 状态）
  - 单条特征删除（Tag 悬浮显示删除按钮）
  - 分类下添加新特征（「+ 添加特征」按钮）
  - 分类级全选/全不选（保留现有 Checkbox 行为，作用于 sessionTraits）

#### Scenario: 临时编辑应用于图片生成
- **WHEN** `sessionTraits` 存在且用户点击「生成图片」/「重新生成」
- **THEN** `executeImageGeneration` 从 `sessionTraits` 读取特征（而非 `characterTraitStore.traits`）
- **AND** `buildSdOptionsFromConfig` 的 `effectiveTraits` 参数传入 `sessionTraits`
- **AND** 生成的图片标签快照（`usedTags`）反映 `sessionTraits` 的内容

#### Scenario: 重置为角色卡特征
- **WHEN** 用户点击「重置为角色卡特征」按钮
- **THEN** 弹出确认对话框（Modal.confirm），提示「确定放弃当前对话的临时特征编辑，恢复为角色卡原始特征？此操作不影响角色卡数据。」
- **AND** 确认后清空 `sessionTraits`（设为 undefined）
- **AND** 特征分类区域回退到显示 `characterTraitStore.traits`
- **AND** 「临时编辑中」徽标消失

#### Scenario: 临时编辑随对话持久化
- **WHEN** 用户编辑 sessionTraits 后，对话记录保存（`saveTestChat`）
- **THEN** `sessionTraits` 完整序列化到对话记录持久化
- **AND** 用户关闭对话框后重新进入
- **THEN** `sessionTraits` 恢复，临时编辑保留
- **AND** 「临时编辑中」徽标重新显示

#### Scenario: 切换角色卡/新建对话不继承
- **WHEN** 用户切换到另一个角色卡或新建对话
- **THEN** 新对话的 `sessionTraits` 为 undefined（不继承其他对话的临时编辑）
- **AND** 角色卡 manifest 数据始终不受影响

#### Scenario: 角色卡原始特征变更同步
- **WHEN** `sessionTraits` 存在期间，用户在 `AssetManagerModal` 修改并保存了角色卡原始特征
- **THEN** `sessionTraits` 保持不变（临时编辑优先）
- **AND** 用户点击「重置为角色卡特征」后，特征分类区域显示最新的 `characterTraitStore.traits`（含 AssetManagerModal 的保存结果）

## MODIFIED Requirements

### Requirement: 对话图片生成 SD 选项构建

系统 SHALL 在 `executeImageGeneration` 中通过 `buildSdOptionsFromConfig` 构建 SD 选项时，特征来源优先使用 `sessionTraits`（若存在），否则使用 `characterTraitStore.traits`。

#### Scenario: 存在 sessionTraits 时
- **WHEN** `characterChatStore.currentTestChat.sessionTraits` 存在
- **THEN** `enabledTraitTexts` 从 `sessionTraits` 过滤 `enabled === true` 的项
- **AND** `buildSdOptionsFromConfig` 的 `effectiveTraits` 参数传入 `sessionTraits`
- **AND** SD 选项的 `sourceContext.source = 'conversation'`，含 messageId / characterCardId / round

#### Scenario: 不存在 sessionTraits 时
- **WHEN** `sessionTraits` 为 undefined
- **THEN** 行为与现有逻辑一致（从 `characterTraitStore.traits` 读取）

### Requirement: 图片重新生成（覆盖 + 历史）

系统 SHALL 在重新生成图片时，将本次使用的标签与提示词快照写入新的 `ImageHistoryItem`，确保历史导航可查看每张图对应的标签。

#### Scenario: 重新生成快照写入
- **WHEN** 用户点击「重新生成」并成功生成新图片
- **THEN** 新追加的 `ImageHistoryItem` 包含 `usedTags` / `usedPrompt` / `usedNegativePrompt` / `usedLoras` 字段
- **AND** 字段值反映本次重新生成时的特征源（sessionTraits 或 characterTraitStore.traits）与上下文 tag

### Requirement: 控制面板图片生成设置

系统 SHALL 在 `ConfigPanel`「图片生成设置」区域中，将「角色特征分类」区域从只读分类级开关升级为支持单条特征 inline 编辑的可编辑面板，并新增「重置为角色卡特征」按钮与「临时编辑中」徽标。

#### Scenario: 特征分类区域可编辑
- **WHEN** 用户展开「图片生成设置」区域
- **THEN** 「角色特征分类」区域的每个 Tag 可点击进入编辑态
- **AND** Tag 悬浮显示删除按钮
- **AND** 每个分类下有「+ 添加特征」按钮
- **AND** 顶部有「重置为角色卡特征」按钮（仅 `sessionTraits` 存在时可见）

#### Scenario: 临时编辑徽标
- **WHEN** `sessionTraits` 存在
- **THEN** 「角色特征分类」标题旁显示「临时编辑中」徽标（黄色警告色 + EditOutlined 图标）
- **AND** 鼠标悬停 Tooltip 显示「当前特征为对话临时编辑，仅对此对话生效，不影响角色卡数据」

## REMOVED Requirements

（本次变更不移除任何现有需求）
