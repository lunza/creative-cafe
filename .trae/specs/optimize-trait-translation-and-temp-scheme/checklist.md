# Checklist

## 类型扩展（Task 1）
- [x] `CategorizedTrait` 新增 `originalText?: string` 字段，含 JSDoc 注释（拆分前原始文本，手动编辑后清空）
- [x] `CharacterTraitItem` 新增 `originalText?: string` 字段，含 JSDoc 注释（语义同 CategorizedTrait，随 v2 manifest 持久化）
- [x] `TraitCombination` 新增 `traitSnapshot?: CharacterTraitItem[]` 可选字段，含 JSDoc（完整特征快照，应用时优先于 traitIds）
- [x] `electron.d.ts` 中 `TraitCombination` 内联类型签名同步（如存在）— 无内联签名，通过 `import type` 引用，无需同步

## 翻译继承（Task 2）
- [x] L3 颜色拆分：featureTag 继承源 trait.translation（不再 `undefined`）
- [x] L3 颜色拆分：colorPartTag 继承源 trait.translation（新增 trait 也设 translation）
- [x] L3 颜色拆分：featureTag 和 colorPartTag 均设置 `originalText = v.tag`（原始复合标签）
- [x] L2/L3 规范化替换：canonicalName 继承源 trait.translation（不再 `undefined`）
- [x] L4 KNN 语义替换：top1.name 继承源 trait.translation（不再 `undefined`）
- [x] 三处注释更新：从「标签库标准 tag 无需翻译」改为「翻译从源标签继承」
- [x] 无替换场景（L1 直接命中 / 评级词 / 全失败）translation 行为不变

## normalizeTraitItem 兜底（Task 3）
- [x] `normalizeTraitItem` 新增 `originalText` 字段兜底（非字符串/空字符串 → undefined）
- [x] 旧数据（无 originalText 字段）加载时兜底 undefined
- [x] JSDoc 注释更新说明 originalText 兜底行为

## 拆分标签 UI 标识（Task 4）
- [x] AssetManagerModal 特征 Tag：`trait.originalText` 存在时显示 `SplitCellsOutlined` 图标
- [x] AssetManagerModal 特征 Tooltip：`trait.originalText` 存在时显示多行（原标签/拆分为/翻译）
- [x] AssetGenerateModal `renderTraitsPanel` 同步实现拆分图标 + 增强 Tooltip
- [x] 自动过滤标签（`isAutoFiltered`）不显示拆分图标（保持灰态删除线）
- [x] 非拆分标签不显示拆分图标（现有行为不变）
- [x] 手动编辑标签文本后 `originalText` 清空（`handleConfirmEditTrait` 同步清空 `originalText: undefined`）

## 替换 AI 图片识别按钮（Task 5）
- [x] AssetGenerateModal "AI 图片识别"按钮替换为"组合方案"下拉 + 存方案/删方案按钮（`SaveOutlined`）
- [x] `handleImageRecognize` 函数保留但不再绑定按钮（`void` 引用避免 TS6133）
- [x] `imageRecognizing` / `supportsVision` 状态保留（不删除，`void` 引用）
- [x] 新增 `handleSaveTempScheme` handler：弹出方案名输入框 + 空名/重名校验
- [x] 后端 `ai:recognizeImageTraits` IPC 通道保留不删

## 组合方案下拉（Task 6）
- [x] AssetGenerateModal 新增"组合方案" Select 组件（与 AssetManagerModal 布局一致）
- [x] Select options 从 `characterTraitStore.combinations` 派生
- [x] Select 包含"手动模式"（`__manual__`）选项
- [x] "存方案"按钮调用 `handleSaveTempScheme`
- [x] "删方案"按钮调用 `handleDeleteCombination`（含确认框）
- [x] `handleApplyCombination`：traitSnapshot 方案 → 用快照替换 editedTraits
- [x] `handleApplyCombination`：traitIds 方案 → 切换 enabled 状态
- [x] 从 store 订阅 combinations / activeCombinationId / saveCombination / applyCombination / deleteCombination

## store 扩展（Task 7）
- [x] `saveCombination` 支持 `traitSnapshot` 参数（从 AssetGenerateModal 传入 editedTraits 快照）
- [x] `applyCombination` 支持 traitSnapshot 方案（用快照替换 store traits）
- [x] `applyCombination` 支持 traitIds 方案（现有逻辑不变）
- [x] `saveCombination` / `deleteCombination` 修改 state 后立即调用 `saveTraits()` 持久化
- [x] 向后兼容：旧方案（仅 traitIds）正常加载和应用

## AssetManagerModal 组合方案下拉支持 traitSnapshot（Task 8）
- [x] `handleApplyCombination` 增加 traitSnapshot 分支 — store 已处理，前端透传即可
- [x] 组合方案下拉 options 对含 traitSnapshot 的方案添加视觉标识（📋 emoji）

## 跨页面联动
- [x] AssetGenerateModal 保存的方案出现在 AssetManagerModal 下拉中（共享 characterTraitStore）
- [x] AssetManagerModal 保存的方案出现在 AssetGenerateModal 下拉中（共享 characterTraitStore）
- [x] 一侧删除方案，另一侧下拉同步更新（共享 state + 持久化）
- [x] 方案数据持久化到 v2 manifest（跨会话保留，saveTraits → traits.json）

## 文档（Task 9）
- [x] `docs/FIX_RECORDS.md` 新增章节（§7.23 Task 4+8 / §7.24 Task 1+2+3+5+6+7+9，含翻译继承 / 临时方案 / 组合方案扩展 / 按钮移除 / 教训）
- [x] `CODE_WIKI.md` 类型表更新（CharacterTraitItem.originalText / CategorizedTrait.originalText / TraitCombination.traitSnapshot）
- [x] `CODE_WIKI.md` 服务表更新（applyTagAudit 翻译继承说明 + Task 7 store 层 traitSnapshot 文档）
- [x] `CODE_WIKI.md` 组件说明更新（AssetGenerateModal 组合方案下拉 + §18 AssetManagerModal 拆分标识）

## 验证
- [x] 类型检查通过（`tsc --noEmit` 无新增错误，仅剩预存 tsconfig 配置错误）
- [ ] 翻译继承：AI 生成特征 → 审计替换后 → 替换标签保留中文翻译（运行时验证，待手动测试）
- [ ] 翻译分配：AI 生成复合标签 → 颜色拆分后 → 两个子标签均保留翻译 + originalText（运行时验证，待手动测试）
- [ ] 拆分图标：拆分标签显示 SplitCellsOutlined 图标，hover 显示原标签/拆分标签/翻译（运行时验证，待手动测试）
- [ ] 临时方案保存：编辑特征 → 保存方案 → 关闭弹窗 → 重新打开 → 选择方案 → editedTraits 恢复（运行时验证，待手动测试）
- [ ] 跨页面同步：AssetGenerateModal 保存方案 → AssetManagerModal 下拉可见（运行时验证，待手动测试）
- [ ] 向后兼容：旧角色卡（无 originalText / 无 traitSnapshot）加载无异常（运行时验证，待手动测试）
- [x] 手动编辑标签后 originalText 清空（不再是拆分标识）— 代码验证：`handleConfirmEditTrait` L1500 `originalText: undefined`
