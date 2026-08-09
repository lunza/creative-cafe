# Checklist

## 数据模型
- [x] `CharacterTraitItem` 接口含 `weight?: number` 字段 + 完整 JSDoc（默认 1.0 / 范围 0.1-10.0 / 持久化于 manifest）
- [x] `CategorizedTrait` 接口含 `weight?: number` 字段 + 完整 JSDoc（AI 生成时产出）
- [x] `normalizeTraitItem` 透传 weight 并做范围校验（0.1-10.0，越界兜底 undefined，保留 1 位小数）
- [x] 旧数据加载（无 weight 字段）兜底 undefined 不报错

## SD 生成管线
- [x] `SDGenerationOptions.characterTraits` 类型为 `Array<{ text: string; weight?: number }>`
- [x] `applyTraitsAndLora` 对 `weight !== 1.0 && weight !== undefined` 的 tag 格式化为 `(text:weight)` 语法
- [x] 默认权重（1.0 或 undefined）的 tag 保持 `text` 原样不加括号
- [x] 去重逻辑 key 仍为 `text.trim().toLowerCase()`（不带权重语法）
- [x] `applyTraitsAndLora` 日志记录带权重的 tag 数量

## 前端派生层
- [x] `enabledTraitTexts` 类型为 `Array<{ text: string; weight?: number }>`
- [x] `buildSdOptions` 的 `characterTraits` 字段透传 weight
- [x] `handleGenerateTraitPrompts` 的 `baseTraits` 仅取 `.text` 拼接（不带权重语法）
- [x] `ExpressionGenerateModal` 适配 `characterTraits` 新类型
- [x] 所有使用 `enabledTraitTexts` / `characterTraits` 的位置类型兼容

## AI 生成适配
- [x] LLM prompt 输出格式扩展为 `分类:tag|中文翻译|权重`（权重可选）
- [x] `parseTraitsFromContent` / `parseTraitsAndDescription` 支持第三段 `|权重` 解析
- [x] 权重解析范围 0.1-10.0，越界兜底 undefined
- [x] 旧格式（无权重段）兼容解析为 undefined
- [x] `generateTraitPrompts` / `generateDynamicScenePrompts` 的 prompt 同步扩展

## 审计 weight 处理
- [x] L4 KNN 替换时继承原 weight（仅 text 替换，weight 保持）
- [x] L3 颜色拆分后两个 trait weight 均为 undefined（重置）
- [x] L5 AI 兜底替换时继承原 weight
- [x] 手动编辑 trait.text 时 weight 保持不变
- [x] `validateTagsAgainstLibrary` 不受 weight 影响

## Store 层
- [x] `setTraits` 透传 `CategorizedTrait.weight` 到 `CharacterTraitItem.weight`
- [x] `saveCombination` / `applyCombination` 的 `traitSnapshot` 透传 weight
- [x] `updateTrait` action 不意外清空 weight

## UI 权重编辑 — AssetGenerateModal
- [x] 非默认权重的 Tag 旁显示权重徽标（`×1.5`，>1.0 暖色 / <1.0 冷色）
- [x] 【2026-08-07 用户反馈调整】默认权重（1.0 或 undefined）也显示权重徽标（`×1.0`，灰色弱化 + 虚线边框），让用户能点击进入编辑器修改（原设计「默认权重不显示」导致用户无法修改 1.0 权重）
- [x] 权重编辑 Popover 含 InputNumber（0.1-10.0，步长 0.1）+ Slider + 重置按钮
- [x] `handleUpdateTraitWeight(traitId, weight)` handler 更新 `editedTraits`
- [x] Tooltip 中追加权重信息行（始终显示，默认权重用次级文本色弱化）

## UI 权重编辑 — AssetManagerModal
- [x] 权重徽标视觉与 AssetGenerateModal 一致
- [x] 权重编辑 Popover 复用相同结构
- [x] `handleUpdateTraitWeight` 更新 store 并持久化
- [x] 【2026-08-07 用户反馈调整】默认权重也显示徽标（与 AssetGenerateModal 同步调整）

## 提示词生成面板
- [x] `renderPromptGenPanel` 结果区为非默认权重 trait 显示权重徽标
- [x] `handleApplyGeneratedTraits` 透传 `CategorizedTrait.weight` 到 `CharacterTraitItem.weight`

## IPC 类型同步
- [x] `electron.d.ts` 中 `generateCharacterTraits` / `generateTraitPrompts` / `recognizeImageTraits` 返回类型含 weight
- [x] `preload.ts` IPC 透传无需改动（weight 随结构化对象透传）

## 文档与文案
- [x] `CODE_WIKI.md` 类型表更新（CharacterTraitItem / CategorizedTrait / SDGenerationOptions.characterTraits）
- [x] `CODE_WIKI.md` `applyTraitsAndLora` 描述补充权重格式化逻辑
- [x] `docs/FIX_RECORDS.md` §7.24 记录权重功能实现
- [x] 所有新增 UI 文案专业中文润色（无生硬机翻感）

## TypeScript 编译验证
- [x] `npm run typecheck` 无新增类型错误（项目预先存在的错误除外）
- [x] `AssetGenerateModal.tsx` / `AssetManagerModal.tsx` / `sdGenerationService.ts` / `characterTraitAIService.ts` / `characterTraitStore.ts` / `characterTraitService.ts` 均无新增 TS 错误
