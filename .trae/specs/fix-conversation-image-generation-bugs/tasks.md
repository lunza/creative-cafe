# Tasks

- [x] Task 1: 修复 Bug 4 — 图片持久化字段丢失（最高优先级，阻断功能）
  - [x] SubTask 1.1: 修复 `characterChatStore.ts` 第 105-118 行 `safeMessages` 映射，添加 `generatedImage` 和 `isImageMessage` 字段透传
  - [x] SubTask 1.2: 修复 `CharacterDialogueChat.hooks.ts` 第 1499-1511 行 `messagesToSave` 映射，添加 `generatedImage` 和 `isImageMessage` 字段透传
  - [x] SubTask 1.3: 修改 `addImageMessage` 方法：将 base64 图片通过 `asset:save` IPC 保存到磁盘（assetType='general'，assetId=`conv_{timestamp}`），消息中 `generatedImage` 存储 assetId 而非 data URL
  - [x] SubTask 1.4: 在 `ChatMessageBubble.tsx` 中新增图片加载逻辑：当 `generatedImage` 是 assetId（非 data URL 前缀）时，通过 `asset:getImagePath` + `file:readAsBase64` 异步加载为 data URL 后显示

- [x] Task 2: 修复 Bug 1 — ConfigPanel 图片生成设置区域样式重构
  - [x] SubTask 2.1: 在 `ConfigPanel.css` 中新增 `image-gen-panel` 系列 CSS 类（`image-gen-panel`、`image-gen-panel-header`、`image-gen-panel-title`、`image-gen-panel-content`、`image-gen-panel-inner`），参考 `parameter-panel` 系列样式
  - [x] SubTask 2.2: 在 `ConfigPanel.tsx` 中将"图片生成设置"区域（第 151-187 行）从内联样式重构为 CSS 类结构，添加折叠头部（PictureOutlined 图标 + 标题 + Tooltip + 折叠箭头）
  - [x] SubTask 2.3: 添加折叠/展开状态管理（collapsed state + localStorage 持久化 `image-gen-panel-collapsed`，与 ParameterPanel 模式一致）

- [x] Task 3: 修复 Bug 5 — 提取 buildSdOptions 为共享纯函数
  - [x] SubTask 3.1: 新建 `buildSdOptions.ts`，将 `AssetGenerateModal.buildSdOptions`（第 970-1074 行）和 `detectGenderTag`（第 295-312 行）的核心逻辑提取为纯函数 `buildSdOptionsFromConfig(params)`，接收 sdConfig、enabledTraitTexts、effectiveTraits、characterLoras、selectedSize、selectedCameraAngle 等依赖作为参数
  - [x] SubTask 3.2: 定义 `BuildSdOptionsParams` 接口，包含所有依赖参数
  - [x] SubTask 3.3: 在 `AssetGenerateModal.tsx` 中将 `buildSdOptions` useCallback 改为调用共享纯函数，`detectGenderTag` 改为从共享文件导入
  - [x] SubTask 3.4: 在 `handleGenerateImage` 中调用共享纯函数构建 sdOptions，替换第 454-506 行的内联构建

- [x] Task 4: 修复 Bug 2 — 补齐缺失的 SD 选项字段（依赖 Task 3，已在 Task 3 中完成）
  - [x] SubTask 4.1: 确认共享函数 `buildSdOptionsFromConfig` 包含 `characterGenderTag` 逻辑（从 effectiveTraits 推断性别，分辨率 ≥ 1024×1024 时注入）
  - [x] SubTask 4.2: 在 `handleGenerateImage` 中改用 `useCharacterLoraStore.getState().loras` 直接读取 LoRA（替代 React 订阅的 `characterLoras` 变量），避免 `await loadCharacterLoras` 后 store 未传播的时序问题

- [x] Task 5: 修复 Bug 3 — 角色特征分类列表 UI 与筛选
  - [x] SubTask 5.1: 在 ConfigPanel 图片生成设置区域内新增特征分类列表子区域，从 `characterTraitStore` 订阅 `traits` 和 `globalCategories`
  - [x] SubTask 5.2: 按 `SYSTEM_TRAIT_CATEGORIES` + `globalCategories` + `UNCATEGORIZED_CATEGORY` 分组显示特征，每个分类显示名称 + 特征 tag 文本 + 启用/禁用 Checkbox
  - [x] SubTask 5.3: 分类开关切换时调用 `characterTraitStore` 逐个 `toggleTraitEnabled` 切换该分类下所有特征的 enabled 状态
  - [x] SubTask 5.4: 在 `handleGenerateImage` 中确保 `enabledTraitTexts` 仅包含 `enabled=true` 的特征（已有逻辑，验证分类禁用后正确过滤）
  - [x] SubTask 5.5: 添加特征分类列表的空状态提示（角色无特征时显示引导文案）
  - [x] SubTask 5.6: 新增 ConfigPanel props 传递角色特征相关数据（characterCardId 已有，需确保 traitStore 在 ConfigPanel 中可订阅）

- [x] Task 6: 更新技术文档
  - [x] SubTask 6.1: 在根目录技术文档中对 5 个 bug 进行重点标记（特别是 Bug 4 双重字段丢失根因和 Bug 2 LoRA 时序问题）
  - [x] SubTask 6.2: 增量更新 `add-conversation-image-generation` 相关文档，补充修复内容

# Task Dependencies
- Task 1（Bug 4）独立，最高优先级
- Task 2（Bug 1）独立，可与 Task 1 并行
- Task 3（Bug 5）独立，可与 Task 1/2 并行
- Task 4（Bug 2）depends on Task 3（需先提取共享函数再补齐字段）
- Task 5（Bug 3）depends on Task 2（特征分类列表 UI 需在重构后的样式区域内添加）
- Task 6 depends on Task 1-5（全部修复后更新文档）
