# 漫画解析：滚动修复 + 持久化修复 + 上下文表格扩充 Spec

## Why

前两轮修复未生效：1）右侧页分析面板仍不可滚动（上次 CSS 用了 antd 5 的类名，而项目是 antd 6.5.3，Tabs DOM 类名已变）；2）已解析漫画列表仍看不到（持久化挂在 V2 项目上，但漫画解析页签无需项目即可使用，未选项目时静默跳过持久化）。同时用户提出新需求：跨页上下文表格字段太少，需扩充且每页信息不少于 100 字。

## 已核实的根因（2026-10-05 探索结论）

1. **滚动**：antd 6.5.3 的 Tabs（底层 `@rc-component/tabs`）DOM 结构为
   `.ant-tabs > .ant-tabs-nav + .ant-tabs-body-holder > .ant-tabs-body > .ant-tabs-content(每页签一个，非激活带 -hidden)`。
   上次在 `App.css` 写的选择器是 antd 5 的 `.ant-tabs-content-holder` / `.ant-tabs-tabpane` / `.ant-tabs-tabpane-active`——antd 6 中不存在，CSS 全部落空。
   高度链本身是通的：`WritingV2Entry` L155（`flex:1 overflow:hidden` flex column）→ `V2AssetsStage` L58（`flex:1 minHeight:0`）→ `V2MangaStage` 根（`height:100%` flex column）→ 右列（`flex:4 1 0` flex column）→ Tabs（`flex:1 minHeight:0`）。
2. **持久化**：`WritingV2Entry.stageDisabled('assets')` 返回 false——素材/漫画阶段**无需项目**即可进入；而漫画记录的 upsert effect 依赖 `currentProjectId`，未选项目时直接 return，数据只留在内存。
3. **上下文表格**：`MangaPageSummary` 仅 5 个内容字段；`buildPageSummary`（主进程 L746）与 `analysisToSummary`（渲染层 mangaSummaryUtils.ts）都只取 `panels[0].plot` 作为关键剧情（其余分镜剧情丢失）、只取第一条对话；`MAX_CONTEXT_PAGES = 10`（只携带最近 10 页）；表格 6 列，信息密度低。

## What Changes

- **修复**：`App.css` 中 `.v2-manga-stage-tabs` 系列选择器改为 antd 6 实际类名（`.ant-tabs-body-holder` / `.ant-tabs-body` / `.ant-tabs-content`），使右侧 Tabs 内容区内部滚动生效
- **修复（BREAKING 内部数据模型）**：漫画记录持久化从「V2 项目内 `mangaComics` 字段」迁移为**渲染层全局持久化 store**（zustand + persist 中间件，localStorage，与 uiStore 同模式）；`MangaComicRecord` 增加 `mangaMeta` 快照字段使其自包含；移除 `WritingProject.mangaComics` 字段（本功能最近新增、无用户数据，无迁移成本）
- **新增**：跨页上下文表格扩充——`MangaPageSummary` 增加 `panelCount` / `panelPlots`（逐分镜剧情）/ `actions`（角色动作）/ `texts`（关键文本摘录）/ `continuity`（叙事衔接）字段；主进程与渲染层两处摘要构建同步扩充；`buildContextTable` 改为 7 列富信息格式（每页 ≥100 字）；`MAX_CONTEXT_PAGES` 从 10 提升到 100
- **强化**：页面分析提示词要求每个分镜 plot 不少于 40 字（细节化描述），保证组装出的每页上下文自然达到 100 字以上

## Impact

- Affected specs: integrate-comic-parsing-mode（漫画解析模式：滚动/持久化/跨页上下文三条 Requirement 的修复与增强）
- Affected code:
  - `src/renderer/styles/App.css`（Tabs 滚动 CSS 选择器）
  - `src/renderer/components/Creative/WritingModeV2/manga/useMangaComicStore.ts`（新增，全局持久化 store）
  - `src/renderer/components/Creative/WritingModeV2/manga/V2MangaStage.tsx`（持久化读写改接全局 store；恢复时还原 mangaMeta 快照）
  - `src/shared/types/writing-v2.types.ts`（`MangaComicRecord` 加 `mangaMeta?`；`MangaPageSummary` 扩充字段）
  - `src/shared/types/writing.types.ts`（移除 `WritingProject.mangaComics`）
  - `src/main/services/manga/MangaParsingService.ts`（`buildPageSummary` 扩充、`buildContextTable` 新格式、`MAX_CONTEXT_PAGES=100`、分析提示词分镜 plot 字数要求）
  - `src/renderer/components/Creative/WritingModeV2/manga/mangaSummaryUtils.ts`（`analysisToSummary` 同步扩充）

## ADDED Requirements

### Requirement: 已解析漫画全局持久化列表

系统 SHALL 将已解析漫画记录持久化到应用级存储（不依赖 V2 项目选择），用户在漫画解析页签随时可见、可打开、可删除。

#### Scenario: 未选择项目也能持久化
- **WHEN** 用户未选择任何 V2 项目，导入漫画文件夹并完成 1 页以上分析
- **THEN** 漫画记录（文件夹、页面列表、阅读顺序、逐页分析、mangaMeta 快照）写入 localStorage，应用重启后仍存在

#### Scenario: 页签列表展示
- **WHEN** 用户进入漫画解析页签且没有漫画处于打开状态
- **THEN** 显示「已解析漫画（N）」列表，按 updatedAt 倒序，每项含文件夹名、总页数/已解析页数、打开/删除按钮

#### Scenario: 打开历史漫画
- **WHEN** 用户点击列表中某条记录的「打开」
- **THEN** 重扫来源文件夹刷新页面列表（文件夹不存在时按保存的列表恢复并提示），恢复全部逐页分析（含手动修正）与 mangaMeta 快照到工作区

### Requirement: 富信息跨页上下文

系统 SHALL 在分析第 N 页时，将之前最多 100 页的分析结果组装为每页不少于 100 字的富信息上下文注入提示词。

#### Scenario: 上下文包含逐分镜剧情
- **WHEN** 某页有 5 个分镜且已完成分析
- **THEN** 该页在上下文中的条目包含：角色（表情/动作）、场景（地点/时间/氛围）、逐分镜剧情（分镜 1: …；分镜 2: ……）、关键对话/旁白摘录、情感基调、叙事衔接说明

#### Scenario: 长漫画全文携带
- **WHEN** 漫画已分析 120 页，分析第 121 页
- **THEN** 携带最近 100 页的富信息上下文（此前为最近 10 页）

## MODIFIED Requirements

### Requirement: 页分析面板滚动（原 integrate-comic-parsing-mode「识别结果预览」）

右侧「当前页分析」Tab 的内容区 SHALL 在内容超出可视高度时内部滚动，剧情理解及后续内容可完整查看。

#### Scenario: 长分析结果可滚动
- **WHEN** 单页分析结果（角色/场景/逐格剧情/情感/文本）总高度超出面板可视区域
- **THEN** Tab 内容区出现内部滚动条，用户可滚动查看全部内容；左侧浏览区与工具栏不被遮挡

### Requirement: 页面分析分镜细节度（原「漫画内容识别」）

页面分析提示词 SHALL 要求每个分镜的 plot 不少于 40 字，包含画面视觉内容、角色动作/表情、关键信息，为跨页上下文提供足够信息量。

#### Scenario: 分镜剧情细节化
- **WHEN** AI 输出某分镜的 plot 字段
- **THEN** 该字段不少于 40 字，包含画面细节描述（而非一句话概括）

## REMOVED Requirements

### Requirement: 漫画记录存储于 V2 项目
**Reason**: 漫画解析页签无需项目即可使用，项目级存储导致未选项目时持久化静默丢失
**Migration**: `WritingProject.mangaComics` 字段移除（该字段为最近新增，生产数据中无内容，无需迁移脚本）；记录迁移至应用级 localStorage store，记录结构增加 `mangaMeta` 快照后与项目解耦
