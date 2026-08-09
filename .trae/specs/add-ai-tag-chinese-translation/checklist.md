# Checklist

## 类型与数据层
- [x] `CategorizedTrait` 类型新增 `translation?: string` 字段，含 JSDoc 说明
- [x] `DynamicScenePrompt` 类型新增 `clothingTranslations?` / `poseTranslations?` / `sceneTranslations?` 三个可选字段
- [x] `CharacterTraitItem` 继承 `CategorizedTrait` 后 `translation` 字段可用（无需额外修改或已补）

## AI prompt 与解析
- [x] `CHARACTER_TRAIT_SYSTEM_PROMPT` 输出格式改为 `分类:tag|中文翻译`，示例同步更新
- [x] `buildDynamicTraitSystemPrompt` / `buildDynamicImageTraitSystemPrompt` 动态构建版同步加 `|中文翻译` 格式
- [x] `DYNAMIC_SCENE_SYSTEM_PROMPT` 三组 tag 输出格式改为 `tag|中文翻译` 逗号分隔
- [x] `parseTraitsFromContent` 解析 `|` 分隔翻译，无 `|` 时 `translation=undefined`（兼容旧格式）
- [x] `parseDynamicSceneResponse` 解析 `tag|中文翻译`，产出 `*Translations` 字段
- [x] `GenerateCharacterTraitsResult` / `GenerateDynamicScenePromptsResult` 类型扩展翻译字段

## 审计/编辑清空翻译
- [x] `applyTagAudit` 中 L2/L3 规范化替换时清空 `translation`
- [x] L3 颜色拆分：原 trait 替换为 featureTag 清空 translation；新增 colorPartTag trait 无 translation
- [x] L4 KNN 语义替换时清空 `translation`
- [x] L5 AI 兜底替换时清空 `translation`
- [x] `AssetManagerModal.handleSaveEdit` 手动编辑保存时清空 `translation`
- [x] `AssetGenerateModal` 特征行内编辑保存时清空 `translation`
- [x] `AssetManagerModal` 末轮人工审核 `onManualReplace` 替换时清空 `translation`
- [x] 用户手动新增 trait 时不带 `translation`

## 前端展示
- [x] `AssetManagerModal.renderTraitChip` 用 `<Tooltip>` 包裹 trait.text，translation 存在时显示
- [x] translation 为空时 Tooltip 不显示（不影响点击编辑）
- [x] `AssetGenerateModal` 特征 `<Tag>` 用 `<Tooltip>` 包裹，translation 存在时显示
- [x] translation 为空时 Tooltip 不显示（不影响点击切换启用）
- [x] `AssetManagerModal` 动态场景三组改为 Tag 列表展示（非 TextArea）
- [x] 动态场景 Tag hover 显示对应翻译
- [x] 动态场景 Tag 支持 × 删除（同步更新字符串 + *Translations）
- [x] 动态场景 Tag 支持双击行内编辑
- [x] 动态场景 Tag 列表末尾有「+ 添加」按钮
- [x] 动态场景编辑操作后 `*Translations` 与字符串一一对应

## 持久化与兼容
- [x] v2 manifest 加载时 `translation` 缺失兜底 `undefined`
- [x] v2 manifest 写入时 `translation` 完整序列化
- [x] 旧 `DynamicScenePrompt`（无 `*Translations`）加载不报错
- [x] `electron.d.ts` IPC 返回类型同步扩展

## 文档
- [x] `docs/FIX_RECORDS.md` 新增章节记录本次改动
- [x] `CODE_WIKI.md` 同步：类型表 / prompt 格式 / 动态场景 UI 说明

## 验证
- [x] tsc 类型检查无新错误（仅预存错误）
- [ ] AI 生成特征后，hover trait chip 显示中文翻译
- [ ] AI 生成动态场景后，hover 动态场景 Tag 显示中文翻译
- [ ] 手动编辑 trait 后，hover 不再显示翻译
- [ ] AI 兜底替换后，hover 不再显示翻译
- [ ] 旧角色卡（无 translation）加载后 hover 不显示翻译，不报错
- [ ] 动态场景 Tag 删除/编辑/新增后字符串与翻译数组保持同步
