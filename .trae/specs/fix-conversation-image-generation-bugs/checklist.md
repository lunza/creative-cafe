# Checklist

## Bug 4 — 图片持久化字段丢失
- [x] `characterChatStore.ts` `safeMessages` 映射包含 `generatedImage` 字段透传
- [x] `characterChatStore.ts` `safeMessages` 映射包含 `isImageMessage` 字段透传
- [x] `CharacterDialogueChat.hooks.ts` `messagesToSave` 映射包含 `generatedImage` 字段透传
- [x] `CharacterDialogueChat.hooks.ts` `messagesToSave` 映射包含 `isImageMessage` 字段透传
- [x] `addImageMessage` 将 base64 图片通过 `asset:save` IPC 保存到磁盘
- [x] 消息中 `generatedImage` 存储 assetId（如 `conv_1234567890`），非 base64 data URL
- [x] `ChatMessageBubble` 支持从 assetId 异步加载图片（`asset:getImagePath` + `file:readAsBase64`）
- [x] 重新打开对话后图片正确显示（非 `[生成图片]` 文本）
- [x] 旧消息（无 `generatedImage` 字段）兼容，正常显示文本内容

## Bug 1 — ConfigPanel 样式一致性
- [x] "图片生成设置"区域使用 CSS 类渲染（非内联 `style={{}}`）
- [x] 区域包含折叠头部（图标 + 标题 + Tooltip + 折叠箭头）
- [x] 内容区有卡片背景和边框（与 `parameter-panel-inner` 一致）
- [x] 区域可折叠/展开，动画与 ParameterPanel 一致
- [x] 折叠状态持久化到 localStorage
- [x] 新增 CSS 类定义在 `ConfigPanel.css` 中
- [x] 不同屏幕尺寸下布局与其他面板一致

## Bug 5 — buildSdOptions 共享函数
- [x] 共享纯函数 `buildSdOptionsFromConfig` 已提取到 `buildSdOptions.ts`
- [x] `detectGenderTag` 函数已提取到 `buildSdOptions.ts` 并导出
- [x] `BuildSdOptionsParams` 接口定义完整，包含所有依赖参数
- [x] `AssetGenerateModal.buildSdOptions` 改为调用共享纯函数
- [x] `handleGenerateImage` 改为调用共享纯函数
- [x] 两处调用的 SD 选项字段完全一致
- [x] AssetGenerateModal 原有功能不受影响

## Bug 2 — SD 选项缺失字段
- [x] `handleGenerateImage` 的 sdOptions 包含 `characterGenderTag` 字段
- [x] `characterGenderTag` 由 `detectGenderTag` 推断（分辨率 >= 1024x1024 时）
- [x] `selectedLoras` 通过 `useCharacterLoraStore.getState().loras` 直接读取（避免时序问题）
- [x] LoRA 数据在图片生成时正确携带

## Bug 3 — 角色特征分类列表
- [x] ConfigPanel 图片生成设置区域显示角色特征分类列表
- [x] 特征按 `SYSTEM_TRAIT_CATEGORIES` + 自定义分类 + 未分类分组
- [x] 每个分类有启用/禁用 Checkbox 开关
- [x] 分类开关切换时调用 `toggleTraitEnabled` 更新 store
- [x] `handleGenerateImage` 的 `characterTraits` 仅包含启用分类下的启用特征
- [x] 角色无特征时显示空状态引导文案
- [x] 分类列表样式与图片生成设置区域整体风格一致

## 技术文档更新
- [x] 根目录技术文档中 5 个 bug 已重点标记
- [x] Bug 4 的双重字段丢失根因已记录
- [x] Bug 2 的 LoRA 时序问题已记录
- [x] Bug 5 的 buildSdOptions 复用方案已记录

## 兼容性
- [x] 修复后现有对话（无图片消息）正常加载和显示
- [x] 修复后现有素材管理弹窗（AssetGenerateModal）功能不受影响
- [x] 修复后图片生成功能关闭时所有现有功能行为不变
- [x] 修复后角色特征管理页面（AssetManagerModal）功能不受影响
