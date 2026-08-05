# Checklist

## 数据结构
- [x] `src/shared/types/characterTrait.types.ts` 定义 `TraitCategory` / `CharacterTraitItem` / `TraitCombination` / `CharacterTraitManifestV2` 并统一导出
- [x] `SYSTEM_TRAIT_CATEGORIES` 常量包含 6 个预设分类（头部/身体/衣物配饰/背景环境/人物姿势/人物表情），均 `isSystem=true`
- [x] `UNCATEGORIZED_CATEGORY_ID = 'uncategorized'` 已定义
- [x] `CharacterTraitItem` 含 `id` / `text` / `categoryId` / `enabled` 四字段
- [x] `genTraitId()` 保证全局唯一

## 存储与迁移
- [x] `characterTraitService` 支持加载 v2 完整数据（traits/customCategories/combinations/activeCombinationId/appearanceDescription）
- [x] v1 traits.json（`traits: string[]`）加载时自动迁移为 v2：特征归「未分类」、`enabled=true`、`appearanceDescription` 保留
- [x] 迁移后保存写入 `version: 2`
- [x] 旧 `loadTraits` / `saveTraits`（string[] 语义）保留为兼容适配层，未迁移调用方不报错

## IPC
- [x] `character-trait:loadData` 返回完整 v2 数据
- [x] `character-trait:saveData` 保存完整 v2 数据
- [x] 新通道在 `ipc/index.ts` 注册
- [x] `preload.ts` 暴露 `characterTrait.loadData` / `saveData`
- [x] `electron.d.ts` 补全类型声明

## Store
- [x] `traits` 升级为 `CharacterTraitItem[]`，新增 `customCategories` / `combinations` / `activeCombinationId`
- [x] `loadTraits` / `saveTraits` 走 v2，乐观更新 + 失败回滚覆盖全部字段
- [x] `addTrait` 默认 `categoryId='uncategorized'`、`enabled=true`
- [x] `removeTrait` 同步从组合 `traitIds` 清理失效引用
- [x] 分类 CRUD：`addCategory` / `updateCategory` / `deleteCategory`（删除时特征回退未分类，系统分类不可删/改名）
- [x] `moveTrait(traitId, targetCategoryId)` 仅改 `categoryId`，保留 `enabled` 与 `id`
- [x] `toggleTraitEnabled(traitId)` 切换 `enabled`，且手动切换后 `activeCombinationId=null`
- [x] 组合：`saveCombination(name)` 快照当前启用 traitIds / `applyCombination(id)` 设置启用集 + activeCombinationId / `deleteCombination(id)`（若为当前激活则置 null）
- [x] `setTraits(string[])` 适配 AI 生成：新特征落未分类 + enabled，保留既有已分类项

## UI
- [x] 顶部工具栏：AI 生成 + 保存 + 组合方案下拉（切换/保存/删除）+ 启用统计
- [x] 主体按分类分组（系统/自定义/未分类），可折叠，按 order 排列
- [x] 特征 chip：启用/禁用切换视觉区分、closable 删除、点击文字编辑、移动到分类下拉
- [x] 自定义分类可重命名/删除；系统分类不可
- [x] 提供「新建分类」入口
- [x] 底部添加区含目标分类下拉（默认未分类）
- [x] `appearanceDescription` 编辑区保留

## 下游兼容
- [x] `buildSdOptions` 传 `characterTraits = traits.filter(t => t.enabled).map(t => t.text)`
- [x] `sdGenerationService.applyTraitsAndLora` 与 `{traits}` 替换逻辑零改动（仍接收 string[]）
- [x] 立绘 / 一般图像 / 三视图 / 表情四条生成路径均拿到启用特征子集

## 扩展性
- [x] 新增系统分类仅需追加常量，无需迁移已有 traits.json
- [x] 特征字段扩展不改存储/IPC/下游拼接结构

## 验证
- [x] v1→v2 迁移：含 string[] 与 appearanceDescription 的旧文件加载后数据无损
- [x] v2 保存后再加载字段完整、version=2
- [x] 删除分类后其下特征回退未分类、删除组合不影响特征、移动后 enabled 保留
- [x] 应用组合后手动切换 enabled 进入手动模式（activeCombinationId=null）
- [x] 组合中 traitId 失效（特征被删）时静默跳过不报错
- [x] `npx tsc --noEmit` 对修改文件零新增错误

## Task 8 验证期间发现并修复的遗漏
- [x] 【重点标记】`ExpressionGenerateModal.tsx` 下游适配遗漏（Task 6 仅覆盖 AssetGenerateModal）：store 升级后该文件 4 处 `characterTraits`（CharacterTraitItem[]）直接传给 `buildNLExpressionPrompt` / `buildExpressionGenerationPrompt`（期望 string[]）触发 TS2353。修复方式：派生 `enabledTraitTexts`（filter enabled + map text），显式 `characterTraits: enabledTraitTexts` 传参，覆盖 single-expression / batch-expression 两条表情生成路径。
