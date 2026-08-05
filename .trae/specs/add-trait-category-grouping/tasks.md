# Tasks

- [x] Task 1: 定义共享类型与系统分类常量
  - [x] SubTask 1.1: 在 `src/shared/types/` 新建 `characterTrait.types.ts`，定义 `TraitCategory` / `CharacterTraitItem` / `TraitCombination` / `CharacterTraitManifestV2`（含 `version: 2`），并在 index 统一导出
  - [x] SubTask 1.2: 定义 `SYSTEM_TRAIT_CATEGORIES` 常量（头部/身体/衣物配饰/背景环境/人物姿势/人物表情，`isSystem=true`）与 `UNCATEGORIZED_CATEGORY_ID = 'uncategorized'`
  - [x] SubTask 1.3: 定义 `genTraitId()` 工具（`crypto.randomUUID()` 或时间戳+随机数兜底，保证唯一）

- [x] Task 2: 升级主进程存储服务为 v2 + 迁移
  - [x] SubTask 2.1: 在 `characterTraitService.ts` 新增 v2 manifest 结构与 `loadTraitData(cardId)` 方法（返回完整 `{ traits: CharacterTraitItem[], customCategories, combinations, activeCombinationId, appearanceDescription }`）
  - [x] SubTask 2.2: 实现 v1→v2 自动迁移：检测 `version !== 2` 时，将 `string[]` 映射为 `CharacterTraitItem[]`（`categoryId='uncategorized'`、`enabled=true`），补 `customCategories=[]` / `combinations=[]` / `activeCombinationId=null`
  - [x] SubTask 2.3: 实现 `saveTraitData(cardId, data)` 覆盖写入 v2（`version:2`），保留 `appearanceDescription`
  - [x] SubTask 2.4: 保留旧 `loadTraits` / `saveTraits`（string[] 语义）作为废弃适配层，内部委托 v2 方法并做扁平化转换，避免破坏未迁移调用方

- [x] Task 3: 升级 IPC 通道
  - [x] SubTask 3.1: 在 `characterTraitHandlers.ts` 新增 `character-trait:loadData`（返回完整 v2 数据）与 `character-trait:saveData`（保存完整 v2 数据），保留旧 `list`/`save` 作为兼容
  - [x] SubTask 3.2: 在 `src/main/ipc/index.ts` 注册新通道（确认注册顺序与既有 characterTrait 一致）
  - [x] SubTask 3.3: 在 `src/preload.ts` 暴露 `window.electronAPI.characterTrait.loadData` / `saveData`，并在 `electron.d.ts` 补全类型声明

- [x] Task 4: 升级前端 store
  - [x] SubTask 4.1: `characterTraitStore.ts` 的 `traits` 由 `string[]` 改为 `CharacterTraitItem[]`，新增 `customCategories` / `combinations` / `activeCombinationId` state
  - [x] SubTask 4.2: `loadTraits` 改调 `loadData`，填充全部 v2 字段
  - [x] SubTask 4.3: `saveTraits` 改调 `saveData`，乐观更新 + 失败回滚覆盖全部 v2 字段
  - [x] SubTask 4.4: 重构 `addTrait` / `removeTrait` / `updateTrait` 适配 `CharacterTraitItem[]`（addTrait 默认 `categoryId='uncategorized'`、`enabled=true`；removeTrait 同步从组合 traitIds 清理失效引用）
  - [x] SubTask 4.5: 新增 actions：`addCategory` / `updateCategory` / `deleteCategory`（删除分类时其下特征回退 `uncategorized`）/ `moveTrait(traitId, targetCategoryId)` / `toggleTraitEnabled(traitId)` / `saveCombination(name)` / `applyCombination(id)` / `deleteCombination(id)`
  - [x] SubTask 4.6: `setTraits(string[])` 适配 AI 生成：新串以 `uncategorized` + `enabled=true` 追加或替换（保留既有已分类项不丢失）

- [x] Task 5: 重构 CharacterTraitTabContent UI
  - [x] SubTask 5.1: 顶部工具栏：保留「AI 生成特征」+「保存」，新增「组合方案」下拉（切换/保存当前为方案/删除方案）+ 启用统计（如「已启用 5/12」）
  - [x] SubTask 5.2: 主体改为分类分组面板：系统分类 + 自定义分类 + 未分类，按 `order` 排列；每分类可折叠，展示该分类下特征 chip
  - [x] SubTask 5.3: 特征 chip 交互：点击启用/禁用切换（视觉区分 enabled/disabled）、`closable` 删除、点击文字进入编辑；chip 附「移动到分类」下拉
  - [x] SubTask 5.4: 分类头操作：自定义分类支持重命名/删除；提供「新建分类」入口
  - [x] SubTask 5.5: 底部添加区：输入框 +「添加」+ 目标分类下拉（默认未分类）
  - [x] SubTask 5.6: 保留 `appearanceDescription` 编辑区（原 UI 行为不变）

- [x] Task 6: 下游生成对接适配
  - [x] SubTask 6.1: `AssetGenerateModal.buildSdOptions` 将 `characterTraits` 由「全部 `string[]`」改为「`traits.filter(t => t.enabled).map(t => t.text)`」
  - [x] SubTask 6.2: 确认 `sdGenerationService.applyTraitsAndLora` 与 `{traits}` 占位符替换**零改动**（仅接收 `string[]`）
  - [x] SubTask 6.3: 验证立绘 / 一般图像 / 三视图 / 表情四条生成路径均能拿到启用特征子集

- [x] Task 7: AI 特征生成集成适配
  - [x] SubTask 7.1: 确认 `characterTraitAIService` 仍返回 `string[]`（不改 AI 提示词与返回结构）
  - [x] SubTask 7.2: 调用 AI 生成后经 store `setTraits` 入库，新特征落「未分类」+ `enabled=true`，用户手动归类

- [x] Task 8: 迁移与回归验证
  - [x] SubTask 8.1: 构造一份 v1 traits.json（含 `string[]` 与 `appearanceDescription`），验证加载后自动转为 v2 且数据无损
  - [x] SubTask 8.2: 验证 v2 保存后再加载为 `version:2`，字段完整
  - [x] SubTask 8.3: 验证删除分类后其下特征回退未分类、删除组合不影响特征、移动特征后 enabled 状态保留
  - [x] SubTask 8.4: 验证应用组合后手动切换 enabled 进入手动模式（activeCombinationId=null）
  - [x] SubTask 8.5: `npx tsc --noEmit` 对修改文件零新增错误
  - [x] 【重点标记 - Task 6 遗漏修复】`ExpressionGenerateModal.tsx` 下游适配：Task 6 原仅覆盖 `AssetGenerateModal.tsx`，遗漏 `ExpressionGenerateModal.tsx`（表情生成 single-expression / batch-expression 路径）。store 升级后该文件 4 处 TS2353 错误（CharacterTraitItem[] 不匹配 string[]）。修复：派生 `enabledTraitTexts`（filter enabled + map text），显式 `characterTraits: enabledTraitTexts` 传参，覆盖两条表情生成路径的 buildSdOptions + buildNLExpressionPrompt + buildExpressionGenerationPrompt。

# Task Dependencies
- Task 2 依赖 Task 1（类型定义）
- Task 3 依赖 Task 2（service 方法）
- Task 4 依赖 Task 3（IPC + 类型声明）
- Task 5 依赖 Task 4（store actions）
- Task 6 依赖 Task 4（store 暴露 enabled 特征）
- Task 7 依赖 Task 4（setTraits 适配）
- Task 8 依赖 Task 1-7 全部完成（端到端回归）
- Task 1 / Task 7（AI 服务确认不改）可较早并行启动
