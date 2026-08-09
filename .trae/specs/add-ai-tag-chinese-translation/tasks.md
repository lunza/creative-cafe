# Tasks

- [x] Task 1: 扩展类型定义（CategorizedTrait.translation + DynamicScenePrompt.*Translations）
  - [x] SubTask 1.1: `src/shared/types/characterTrait.types.ts` — `CategorizedTrait` 新增 `translation?: string` 字段（含 JSDoc：中文翻译，AI 生成时产出，编辑/替换时清空）
  - [x] SubTask 1.2: 同文件 `DynamicScenePrompt` 新增 `clothingTranslations?: string` / `poseTranslations?: string` / `sceneTranslations?: string`（逗号分隔，与 clothing/pose/scene 一一对应）
  - [x] SubTask 1.3: 确认 `CharacterTraitItem` 继承 `CategorizedTrait` 自动获得 `translation`（若类型定义需调整则补）

- [x] Task 2: 修改 AI prompt 输出格式 + 解析逻辑（characterTraitAIService.ts）
  - [x] SubTask 2.1: 修改 `CHARACTER_TRAIT_SYSTEM_PROMPT`（line 335）输出格式从 `分类:tag` 改为 `分类:tag|中文翻译`，更新示例
  - [x] SubTask 2.2: 修改 `buildDynamicTraitSystemPrompt` / `buildDynamicImageTraitSystemPrompt`（动态构建版）同步加 `|中文翻译` 格式
  - [x] SubTask 2.3: 修改 `DYNAMIC_SCENE_SYSTEM_PROMPT` 三组 tag 输出格式为 `tag|中文翻译` 逗号分隔
  - [x] SubTask 2.4: 修改 `parseTraitsFromContent` 解析 `分类:tag|中文翻译`：按 `|` 切分，trim 翻译，无 `|` 时 `translation=undefined`（兼容旧格式）
  - [x] SubTask 2.5: 修改 `parseDynamicSceneResponse` 解析 `tag|中文翻译`：产出 `clothing/Pose/Scene` + 对应 `*Translations` 字段（逗号分隔，一一对应）
  - [x] SubTask 2.6: `GenerateCharacterTraitsResult` / `GenerateDynamicScenePromptsResult` 类型扩展翻译字段（动态场景 result 新增 `clothingTranslations?` 等）

- [x] Task 3: applyTagAudit 替换时清空翻译（characterTraitAIService.ts）
  - [x] SubTask 3.1: L2/L3 规范化替换 trait.text 时 `trait.translation = undefined`
  - [x] SubTask 3.2: L3 颜色拆分：原 trait 替换为 featureTag 时清空 translation；新增 colorPartTag trait 无 translation
  - [x] SubTask 3.3: L4 KNN 语义替换 trait.text 时清空 translation
  - [x] SubTask 3.4: L5 AI 兜底替换 trait.text 时清空 translation（候选词为标签库 tag）

- [x] Task 4: store 编辑/替换清空翻译（characterTraitStore.ts + AssetManagerModal.tsx + AssetGenerateModal.tsx）
  - [x] SubTask 4.1: `AssetManagerModal.handleSaveEdit` 保存新 text 时 `translation=undefined`（由 store updateTrait 统一处理）
  - [x] SubTask 4.2: `AssetGenerateModal` 特征行内编辑保存时清空 translation（editedTraits 临时态清空）
  - [x] SubTask 4.3: `AssetManagerModal` 末轮人工审核替换 `onManualReplace` 时清空 translation（由 store updateTrait 统一处理）
  - [x] SubTask 4.4: `AssetGenerateModal` 临时新增 trait 时不带 translation（默认 undefined）
  - [x] SubTask 4.5: store `setTraits` / `updateTrait` 兼容 translation 字段透传（setTraits 保留 translation，updateTrait 清空 translation）

- [x] Task 5: AssetManagerModal.renderTraitChip Tooltip 展示翻译
  - [x] SubTask 5.1: 用 `<Tooltip title={trait.translation || ''}>` 包裹 trait.text 展示区
  - [x] SubTask 5.2: `trait.translation` 为空时 Tooltip 不显示（antd Tooltip 空title 不弹出）
  - [x] SubTask 5.3: 不影响点击进入编辑态的行为（Tooltip 不拦截 click）

- [x] Task 6: AssetGenerateModal 特征 Tag Tooltip 展示翻译
  - [x] SubTask 6.1: 用 `<Tooltip title={trait.translation || ''}>` 包裹特征 `<Tag>`
  - [x] SubTask 6.2: 翻译为空时 Tooltip 不显示
  - [x] SubTask 6.3: 不影响 Tag 点击切换启用行为

- [x] Task 7: AssetManagerModal 动态场景三组改为 Tag 列表展示
  - [x] SubTask 7.1: 新增 `renderDynamicSceneTagList(field)` 渲染函数（L3445）
  - [x] SubTask 7.2: 每个 tag 渲染为 `<Tag>`：hover Tooltip + × 删除 + 双击行内编辑
  - [x] SubTask 7.3: 末尾「+ 添加」按钮
  - [x] SubTask 7.4: 替换原 `<TextArea>`（保留底层字符串 state）
  - [x] SubTask 7.5: 编辑后 `*Translations` 与字符串一一对应

- [x] Task 8: 持久化与向后兼容验证
  - [x] SubTask 8.1: v2 manifest 加载时 `translation` 缺失自动兜底 `undefined`（`loadTraits` / `loadTraitData`）—— ⚠️ 发现并修复 `normalizeTraitItem` 丢弃 translation 字段的 bug，现已透传
  - [x] SubTask 8.2: v2 manifest 写入时 `translation` 字段完整序列化（`saveTraits` / `saveTraitData`）—— ⚠️ 同上，`normalizeTraitItem` 在 saveTraitData 中也被调用，修复后保存路径同步保留 translation
  - [x] SubTask 8.3: 旧 `DynamicScenePrompt`（无 `*Translations`）加载兜底 `undefined`，UI 不报错—— 已验证：loadTraitData 直接透传数组，UI useEffect 兜底为空字符串
  - [x] SubTask 8.4: `electron.d.ts` IPC 返回类型同步扩展（`generateCharacterTraits` / `generateDynamicScenePrompts`）—— 新增 clothingTranslations/poseTranslations/sceneTranslations；移除 AssetManagerModal 中的类型断言

- [x] Task 9: 文档增量更新
  - [x] SubTask 9.1: `docs/FIX_RECORDS.md` 新增章节 §7.21 记录本次改动（背景/设计决策/实施步骤/2 个重点 Bug/向后兼容/文件清单）
  - [x] SubTask 9.2: `CODE_WIKI.md` 同步（5 处增量改动）：类型表补 translation/*Translations / 服务表补 characterTraitAIService prompt 格式 / IPC 通道表补 generateDynamicScenePrompts 返回类型 / characterTraitService 补 normalizeTraitItem / 综述章节更新

# Task Dependencies

- Task 2 依赖 Task 1（类型先扩展，prompt 解析才能写入 translation）
- Task 3 依赖 Task 1（清空 translation 需要 CategorizedTrait 先有该字段）
- Task 4 依赖 Task 1
- Task 5 / 6 依赖 Task 1（Tooltip 读取 trait.translation）
- Task 7 依赖 Task 1 + Task 2（动态场景翻译字段 + 解析）
- Task 8 依赖 Task 1-7 全部完成
- Task 9 在所有功能 Task 完成后进行
- Task 1 / 2 / 3 / 4 可部分并行（类型扩展先行，其余依赖类型）
