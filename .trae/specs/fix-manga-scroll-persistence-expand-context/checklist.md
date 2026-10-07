# Checklist

## 滚动修复
- [x] App.css 中 `.v2-manga-stage-tabs` 规则使用 antd 6 实际类名（`.ant-tabs-body-holder` / `.ant-tabs-body` / `.ant-tabs-content`），不再引用 antd 5 的 `.ant-tabs-content-holder` / `.ant-tabs-tabpane`（已对照 node_modules/@rc-component/tabs 源码逐一核实类名）
- [x] 应用中单页分析长结果（剧情理解及后续内容）可在右侧面板内滚动，无遮挡（CSS 高度链已按 antd 6 实际 DOM 结构核实：body-holder flex:1 → body/content height:100% → active 面板 overflow-y:auto；dev server 已重启生效）

## 持久化修复
- [x] `MangaComicRecord` 含 `mangaMeta?` 快照字段
- [x] 新增 `useMangaComicStore`（zustand + persist/localStorage），提供 upsertComic（按 folderPath 去重）/ removeComic
- [x] V2MangaStage 持久化读写全部改接全局 store，不再依赖 `currentProject`（upsert effect 不再检查 currentProjectId）
- [x] `WritingProject.mangaComics` 字段已移除
- [x] 未选择任何 V2 项目时：导入漫画 → 分析页面 → 刷新应用 → 漫画解析页签列表仍可见该记录（upsert 不再依赖项目；localStorage 跨重启持久）
- [x] 点击「打开」：页面列表刷新、逐页分析（含手动修正）、mangaMeta 快照全部恢复
- [x] 删除记录：确认后从列表消失，localStorage 同步更新

## 上下文表格扩充
- [x] `MangaPageSummary` 含 panelCount / panelPlots / actions / texts / continuity 新字段
- [x] 主进程 `buildPageSummary` 与渲染层 `analysisToSummary` 均生成新字段且逻辑一致（双向注释标明同步关系）
- [x] `MAX_CONTEXT_PAGES` = 100
- [x] `buildContextTable` 输出 8 列富信息格式，单测验证每页信息量 ≥100 字（11/11 通过，含 5 个新增用例）
- [x] 分析提示词要求每分镜 plot ≥40 字（分镜解析规则第 7 条）
- [x] 「上下文预览」Tab 正常显示扩充后的表格（预览组件直接渲染主进程 table 字符串，自动生效）

## 通用
- [x] typecheck 本次修改文件零错误；manga 单测通过（11/11）
- [x] dev server 重启生效（未触碰 5000 端口进程）
- [x] CODE_WIKI.md 增量更新（含 antd 6 Tabs 类名陷阱、无项目持久化陷阱重点标记）
