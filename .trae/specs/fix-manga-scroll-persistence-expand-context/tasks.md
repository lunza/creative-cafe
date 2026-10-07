# Tasks

- [x] Task 1: 修复右侧 Tabs 滚动（antd 6 类名修正）
  - SubTask 1.1: 修改 `src/renderer/styles/App.css` 中 `.v2-manga-stage-tabs` 系列规则：`.ant-tabs-content-holder` → `.ant-tabs-body-holder`（`flex:1; min-height:0`）；新增 `.ant-tabs-body { height: 100% }`；`.ant-tabs-tabpane { height: 100% }` → `.ant-tabs-content { height: 100% }`；`.ant-tabs-tabpane-active { overflow-y: auto }` → `.ant-tabs-content:not(.ant-tabs-content-hidden) { overflow-y: auto }`；补 `.ant-tabs-nav { flex-shrink: 0 }`
  - SubTask 1.2: 验证：重启 dev server 后在应用中打开一个多分镜页的分析结果（或用测试数据），用 devtools 确认 `.v2-manga-stage-tabs .ant-tabs-content` 存在且 `overflow-y: auto` 生效、内容可滚动
- [x] Task 2: 漫画记录全局持久化 store
  - SubTask 2.1: `src/shared/types/writing-v2.types.ts`：`MangaComicRecord` 增加 `mangaMeta?: MangaMetaInfo` 字段（记录自包含）
  - SubTask 2.2: 新建 `src/renderer/components/Creative/WritingModeV2/manga/useMangaComicStore.ts`：zustand + persist 中间件（localStorage，key 如 `creative-cafe-manga-comics-v1`），state 为 `comics: MangaComicRecord[]`，action：`upsertComic(record)`（按 folderPath 去重，更新 updatedAt 并置顶）、`removeComic(id)`、`getByFolder(path)`
  - SubTask 2.3: 验证：typecheck 零错误；在应用 console 中调用 store action 后刷新页面，localStorage 中数据仍在
- [x] Task 3: V2MangaStage 改接全局 store（替换项目级持久化）
  - SubTask 3.1: 移除对 `currentProject.mangaComics` 的读写：upsert effect 改为写 `useMangaComicStore`（record 携带当前 mangaMeta 快照）；列表数据源改为 store；`handleOpenRecord` 增加还原 `record.mangaMeta` 到 stage 的 mangaMeta 状态；`handleDeleteRecord` 改调 store.removeComic
  - SubTask 3.2: `src/shared/types/writing.types.ts`：移除 `WritingProject.mangaComics` 字段及 `MangaComicRecord` 导入
  - SubTask 3.3: 验证：typecheck 零错误；未选项目时导入漫画 + 分析 1 页 → 刷新应用 → 页签列表可见该记录且可打开恢复
- [x] Task 4: 跨页上下文表格扩充（类型 + 主进程）
  - SubTask 4.1: `writing-v2.types.ts`：`MangaPageSummary` 增加 `panelCount: number`、`panelPlots: string`（逐分镜剧情，"分镜1: …；分镜2: …"）、`actions: string`（角色动作摘要）、`texts: string`（关键对话/旁白/拟音摘录，带引号，总长截断至 300 字）、`continuity: string`（叙事衔接）
  - SubTask 4.2: `MangaParsingService.ts`：`buildPageSummary` 同步扩充新字段（与渲染层逻辑一致）；`MAX_CONTEXT_PAGES` 10 → 100；`buildContextTable` 改为 7 列格式：`| 页码 | 角色(表情) | 角色动作 | 场景 | 逐分镜剧情 | 关键文本 | 情感 | 叙事衔接 |`（每单元格软截断 300 字；页码列可含分镜数如 "P5(4格)"）
  - SubTask 4.3: 验证：typecheck 零错误；manga 单测更新并通过；手工构造 3 页分析数据调用 buildContextTable，确认每页信息量 ≥100 字
- [x] Task 5: 渲染层摘要同步 + 分镜细节提示词
  - SubTask 5.1: `mangaSummaryUtils.ts`：`analysisToSummary` 同步扩充新字段（与主进程 buildPageSummary 逻辑保持一致，注释标明同步关系）
  - SubTask 5.2: `MangaParsingService.buildSystemPrompt`：分镜解析规则第 4 条后追加要求「每个分镜的 plot 不少于 40 字，须包含画面视觉细节、角色动作与表情、关键信息，不得一句话概括」
  - SubTask 5.3: 验证：typecheck 零错误；「上下文预览」Tab 显示扩充后的表格（自动，预览渲染 table 字符串）
- [x] Task 6: 整体验证与文档
  - SubTask 6.1: `npm run typecheck` 本次修改文件零错误；`npx vitest run src/main/services/manga` 通过
  - SubTask 6.2: 重启 dev server（禁止动 5000 端口进程），应用中实测：a) 分析结果面板可滚动 b) 未选项目时导入+分析后刷新，列表可见且可恢复 c) 上下文预览表格为 7 列富信息格式
  - SubTask 6.3: `CODE_WIKI.md` 增量更新（重点标记：antd 6 Tabs 类名陷阱、无项目场景持久化陷阱、上下文扩充）

# Task Dependencies

- Task 3 depends on Task 2（store 先行）
- Task 4 与 Task 1、Task 2 无依赖，可并行
- Task 5 depends on Task 4（类型先行）
- Task 6 depends on 全部
