# Tasks

- [x] Task 1: 自定义同义词映射表服务 + IPC + L0 查询
  - [x] SubTask 1.1: 新增 `src/main/services/userSynonymMapService.ts`：加载/保存 `{userData}/data/user-synonym-map.json`（`Record<string, string>`，key 小写），提供 `getMap()`/`addMapping(original, replacement)`/`removeMapping(original)`/`lookup(tag)` 方法，内存 Map 缓存 + 写入即持久化
  - [x] SubTask 1.2: 在 `src/main/ipc/` 注册 `tagRag:getUserSynonymMap` / `tagRag:addUserSynonymMapping` / `tagRag:removeUserSynonymMapping` IPC（参考现有 tagRag IPC 注册模式）
  - [x] SubTask 1.3: `src/preload/` 暴露新 IPC（参考现有 tagRag preload 暴露模式）
  - [x] SubTask 1.4: `tagRagService.validateTagsAgainstLibrary` 新增 L0 分支：在 L1 之前调 `userSynonymMapService.lookup(tag)`，命中则 `isValid=true, canonicalName=映射目标, source='user-map'`，跳过 L1-L4
  - [x] SubTask 1.5: `tagRagService` 初始化时调 `userSynonymMapService.load()` 加载映射表（与 ensureLoaded 类似，避免空查询）

- [x] Task 2: L3b 否定性修饰词剥离
  - [x] SubTask 2.1: 在 `tagRagService.ts` 新增 `NEGATION_MODIFIERS` 常量：`['brimless', 'sleeveless', 'strapless', 'topless', 'bottomless', 'hairless', 'wireless', 'collarless']`
  - [x] SubTask 2.2: 新增 `stripNegationModifier(tag: string): string` 函数：从 tag 开头剥离否定性修饰词（空格/下划线兼容），返回剩余核心词；核心词为空或与原 tag 相同时返回空串（不可剥离）
  - [x] SubTask 2.3: `validateTagsAgainstLibrary` 在 L3 颜色拆分之后、L4 KNN 之前新增 L3b 分支：`stripNegationModifier(tag)` 得核心词 → 查 name/alias（含空格/下划线互转）→ 命中则 `isValid=true, canonicalName=核心词 canonicalName, source='negation-strip'`
  - [x] SubTask 2.4: `validateTagsAgainstLibrary` 返回类型新增 `source?: 'user-map' | 'name' | 'alias' | 'color-split' | 'negation-strip' | 'knn'` 字段，L0-L4 各分支设对应 source

- [x] Task 3: 前端人工审核入口（末轮）
  - [x] SubTask 3.1: `RagQualityReport.tsx` tagValidation item 类型新增 `source?` + `manuallyReplaced?: boolean` + `manualReplacement?: string` 字段
  - [x] SubTask 3.2: 对 `isValid=false` 的项显示「手动替换」按钮，点击展开 inline 输入框；用户输入替换词回车 → 调 `onManualReplace(item.tag, replacement)` 回调
  - [x] SubTask 3.3: `manuallyReplaced=true` 的项显示「🟣 已手动替换：tag → manualReplacement」+ 撤销按钮（调 `onRevertManualReplace(item.tag, item.manualReplacement)`）
  - [x] SubTask 3.4: `RagQualityReportProps` 新增 `onManualReplace(originalTag, replacement)` 与 `onRevertManualReplace(originalTag, replacement)` 回调

- [x] Task 4: AssetManagerModal 手动替换处理 + 撤销
  - [x] SubTask 4.1: 实现 `handleManualReplace(originalTag, replacement)`：找到 `text === originalTag` 的 trait 调 `updateTrait(trait.id, replacement)`；调 IPC `tagRag.addUserSynonymMapping(originalTag, replacement)` 持久化；更新 ragDebug 对应项 `manuallyReplaced=true, manualReplacement=replacement`
  - [x] SubTask 4.2: 实现 `handleRevertManualReplace(originalTag, replacement)`：找到 `text === replacement` 的 trait 调 `updateTrait(trait.id, originalTag)` 还原；调 IPC `tagRag.removeUserSynonymMapping(originalTag)` 删除映射；清除 ragDebug 对应项 `manuallyReplaced/manualReplacement`
  - [x] SubTask 4.3: 传递 `onManualReplace` / `onRevertManualReplace` 到 RagQualityReport

- [x] Task 5: 单元测试 + 文档更新
  - [x] SubTask 5.1: `tagRagService.test.ts` 新增 L0 自定义映射测试（mock userSynonymMapService.lookup 命中 → source='user-map'）+ L3b 修饰词剥离测试（brimless cap→hat、sleeveless dress→dress、short hair 不剥离）
  - [x] SubTask 5.2: `userSynonymMapService` 单元测试（load/add/remove/lookup + 持久化到临时文件）
  - [x] SubTask 5.3: tsc 类型检查通过 + 全部 vitest 测试通过
  - [x] SubTask 5.4: `docs/FIX_RECORDS.md` 追加新小节记录多轮审计机制（根因/方案/三轮审计设计/source 字段）；`CODE_WIKI.md` 更新 validateTagsAgainstLibrary 匹配链描述（L0-L4 六层 + source 字段）+ 服务表新增 userSynonymMapService

# Task Dependencies

- Task 2 依赖 Task 1（L3b 在 L0-L3 之后，返回类型 source 字段需与 Task 1 协调）
- Task 3 依赖 Task 1+2（source/manuallyReplaced 类型 + ragDebug 透传）
- Task 4 依赖 Task 3（前端回调签名）+ Task 1（IPC add/remove mapping）
- Task 5 依赖 Task 1-4
