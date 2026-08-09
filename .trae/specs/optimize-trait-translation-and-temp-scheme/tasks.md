# Tasks

- [x] Task 1: 类型扩展 — `CategorizedTrait` / `CharacterTraitItem` / `TraitCombination` 新增字段
  - [x] SubTask 1.1: `src/shared/types/characterTrait.types.ts` 中 `CategorizedTrait` 新增 `originalText?: string` 字段（含 JSDoc 注释说明：拆分前原始文本，手动编辑后清空）
  - [x] SubTask 1.2: `src/shared/types/characterTrait.types.ts` 中 `CharacterTraitItem` 新增 `originalText?: string` 字段（含 JSDoc 注释，语义同 CategorizedTrait.originalText，随 v2 manifest 持久化）
  - [x] SubTask 1.3: `src/shared/types/characterTrait.types.ts` 中 `TraitCombination` 新增 `traitSnapshot?: CharacterTraitItem[]` 可选字段（含 JSDoc：完整特征快照，含临时标签/文本修改/启用状态；与 traitIds 互斥但可共存，应用时优先 traitSnapshot）
  - [x] SubTask 1.4: `electron.d.ts` 同步 `TraitCombination` 类型扩展（如存在内联类型签名）

- [x] Task 2: 翻译继承 — `characterTraitAIService.applyTagAudit` 三场景保留 translation
  - [x] SubTask 2.1: L3 颜色拆分场景（约 L1173-1186）：原 trait 替换为 featureTag 时继承 `trait.translation`（而非 `undefined`）；新增 colorPartTag trait 也继承同一 translation；两者均设置 `originalText = v.tag`（原始复合标签文本）
  - [x] SubTask 2.2: L2/L3 规范化替换场景（约 L1188-1198）：trait.text 替换为 canonicalName 时继承 `trait.translation`（而非 `undefined`）
  - [x] SubTask 2.3: L4 KNN 语义替换场景（约 L1199-1210）：trait.text 替换为 top1.name 时继承 `trait.translation`（而非 `undefined`）
  - [x] SubTask 2.4: 更新三处注释，将「标签库标准 tag 无需翻译」改为「翻译从源标签继承，保留 AI 原始翻译供用户参考」

- [x] Task 3: normalizeTraitItem 兜底 — `characterTraitService.ts` 处理 originalText 字段
  - [x] SubTask 3.1: `normalizeTraitItem`（约 L171-188）新增 `originalText` 字段兜底：`typeof r.originalText === 'string' && r.originalText ? r.originalText : undefined`
  - [x] SubTask 3.2: 更新 JSDoc 注释说明 originalText 字段的兜底行为

- [x] Task 4: 拆分标签 UI 标识 — AssetManagerModal / AssetGenerateModal Tooltip 增强
  - [x] SubTask 4.1: 在 `AssetManagerModal.tsx` 的 `CharacterTraitTabContent` 特征 Tag 渲染处，当 `trait.originalText` 存在时在 Tag 内显示 `SplitCellsOutlined` 图标（import from `@ant-design/icons`）
  - [x] SubTask 4.2: 在 `AssetManagerModal.tsx` 的特征 Tooltip 中，当 `trait.originalText` 存在时显示多行内容：`原标签：{originalText}` / `拆分为：{text}` / `翻译：{translation}`
  - [x] SubTask 4.3: 在 `AssetGenerateModal.tsx` 的 `renderTraitsPanel` 特征 Tag 渲染处同步实现 SubTask 4.1 + 4.2（两个组件的特征渲染逻辑需一致）
  - [x] SubTask 4.4: 自动过滤场景的 `isAutoFiltered` 标签不显示拆分图标（保持灰态删除线，Tooltip 仍显示自动过滤提示）

- [x] Task 5: 替换 AI 图片识别按钮 — AssetGenerateModal 按钮布局改造
  - [x] SubTask 5.1: 在 `AssetGenerateModal.tsx` 约 L1800-1824，将"AI 图片识别"按钮（`EyeOutlined` + `handleImageRecognize`）替换为"临时方案保存"按钮（`SaveOutlined` + 新 handler）
  - [x] SubTask 5.2: 保留 `handleImageRecognize` 函数定义和 `imageRecognizing` / `supportsVision` 状态（不删除后端代码），仅移除按钮渲染入口
  - [x] SubTask 5.3: 新增 `handleSaveTempScheme` handler：弹出方案名输入框（Modal.confirm 或 InputModal），校验空名/重名后调用 store.saveCombination(name, true)（第二参数标记来自 AssetGenerateModal，写入 traitSnapshot）

- [x] Task 6: 组合方案下拉 — AssetGenerateModal 新增"组合方案"选择组件
  - [x] SubTask 6.1: 在 `AssetGenerateModal.tsx` 特征面板头部区域（原 AI 图片识别按钮位置附近）新增"组合方案" Select 组件 + "存方案"按钮 + "删方案"按钮（与 AssetManagerModal 的组合方案下拉布局一致）
  - [x] SubTask 6.2: Select 的 options 从 `characterTraitStore.combinations` 派生，value 为 `activeCombinationId ?? '__manual__'`，onChange 调用 `handleApplyCombination`
  - [x] SubTask 6.3: 新增 `handleApplyCombination` handler：若方案含 `traitSnapshot`，用快照深拷贝替换 `editedTraits`；若仅含 `traitIds`，则将 `editedTraits` 中匹配 id 的特征置 enabled=true，其余置 enabled=false
  - [x] SubTask 6.4: 新增 `handleDeleteCombination` handler：弹出确认框后调用 store.deleteCombination，删除后 editedTraits 保持不变（不强制重置）
  - [x] SubTask 6.5: 从 store 订阅 `combinations` / `activeCombinationId` / `saveCombination` / `applyCombination` / `deleteCombination`（AssetGenerateModal 已有 useCharacterTraitStore 调用，补充订阅缺失字段）

- [x] Task 7: store 扩展 — `characterTraitStore` 支持 traitSnapshot 保存/应用
  - [x] SubTask 7.1: 修改 `saveCombination(name: string, includeSnapshot?: boolean)`（约 L1116）：当 `includeSnapshot=true` 时，将当前 `editedTraits` 或 `traits` 完整深拷贝写入 `traitSnapshot` 字段；否则仅写 `traitIds`（现有逻辑）
  - [x] SubTask 7.2: 修改 `applyCombination(combinationId)`（约 L1152）：若方案含 `traitSnapshot`，用快照深拷贝替换 store `traits`（完整覆盖，含临时标签）；若仅含 `traitIds`，按现有逻辑切换 enabled
  - [x] SubTask 7.3: 确保 `saveCombination` / `applyCombination` / `deleteCombination` 修改 state 后调用 `get().saveTraits()` 持久化（现有 saveCombination 不立即持久化，需与动态场景方案一致改为立即持久化）
  - [x] SubTask 7.4: ⚠️ 注意 `saveCombination` 从 AssetGenerateModal 调用时，需要将 `editedTraits`（弹窗工作副本）作为快照源传入，而非 store `traits`。考虑增加参数 `saveCombination(name, snapshot?: CharacterTraitItem[])` 直接传入快照数据

- [x] Task 8: AssetManagerModal 组合方案下拉支持 traitSnapshot 方案
  - [x] SubTask 8.1: 在 `AssetManagerModal.tsx` 的 `handleApplyCombination`（约 L3127）中增加 traitSnapshot 分支：若方案含 traitSnapshot，用快照替换 store traits；否则现有 traitIds 逻辑
  - [x] SubTask 8.2: 在 `AssetManagerModal.tsx` 的组合方案下拉 options 中，对含 traitSnapshot 的方案添加视觉标识（如方案名后加 `(含临时标签)` 后缀或图标），帮助用户区分方案类型

- [x] Task 9: 文档增量更新
  - [x] SubTask 9.1: `docs/FIX_RECORDS.md` 新增章节记录本次改动（翻译继承修复 / 临时方案保存功能 / 组合方案扩展 / AI 图片识别按钮移除 / 涉及文件清单 / 教训）
  - [x] SubTask 9.2: `CODE_WIKI.md` 同步：`CharacterTraitItem` / `CategorizedTrait` / `TraitCombination` 类型表更新 / `applyTagAudit` 翻译继承说明 / AssetGenerateModal 组合方案下拉说明 / 涉及文件

# Task Dependencies
- [Task 2] depends on [Task 1]（翻译继承需要 originalText 字段先定义）
- [Task 3] depends on [Task 1]（normalizeTraitItem 兜底需要 originalText 字段先定义）
- [Task 4] depends on [Task 1]（UI 标识需要 originalText 字段先定义）
- [Task 5] depends on [Task 7]（保存按钮需要 store 支持 traitSnapshot）
- [Task 6] depends on [Task 7]（下拉应用方案需要 store 支持 traitSnapshot）
- [Task 8] depends on [Task 7]（AssetManagerModal 应用方案需要 store 支持 traitSnapshot）
- [Task 1] 无依赖，可优先执行
- [Task 9] 依赖所有前序任务完成
