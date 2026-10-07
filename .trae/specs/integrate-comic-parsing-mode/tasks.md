# Tasks

> 漫画解析模式集成到写作模式 2.0
> 前置依赖：`refactor-writing-mode-v2` Phase 0-7 已完成（V2 assets 阶段已存在）

## Phase 1 — 地基（类型 + IPC + 主进程服务）

- [x] Task 1: 类型契约定义
  - [x] SubTask 1.1: `shared/types/writing-v2.types.ts` 新增漫画解析类型
    - `MangaReadingOrder = 'leftToRight' | 'rightToLeft'`
    - `MangaPage { index, fileName, absolutePath, fileSize }`
    - `MangaTextExtraction { content, type: 'dialogue'|'narration'|'soundEffect', position }`
    - `MangaPanelAnalysis { panelIndex, plot, emotion, texts: MangaTextExtraction[] }`
    - `MangaCharacterAnalysis { name, expression, action }`
    - `MangaSceneAnalysis { environment, time, location, atmosphere }`
    - `MangaPageAnalysis { pageAnalysis: { characters, scene, panels, overallEmotion, narrativeContinuity }, readingOrder, analyzedAt, userModified: boolean }`
    - `MangaPageSummary { pageIndex, characters, scene, keyPlot, emotion, keyDialogue }`
    - `MangaAnalysisResult { pages: MangaPageAnalysis[], characters: MangaCharacterSummary[], storyOutline: string, chapterSuggestions: MangaChapterSuggestion[], folderPath, totalPages, analyzedAt }`
    - `MangaCharacterSummary { name, appearances: { pageIndex, expression, action }[] }`
    - `MangaChapterSuggestion { chapterIndex, title, summary, pageRange: [start, end] }`
    - `V2MangaScanResult { success, pages: MangaPage[], total, error? }`
    - `V2MangaAnalyzeResult { success, analysis: MangaPageAnalysis | null, summary: MangaPageSummary | null, error? }`
    - `V2MangaContextResult { success, table: string, error? }`
    - `V2MangaOutlineResult { success, outline: string, error? }`
    - `V2MangaExportResult { success, filePath?, error? }`
    - `V2MangaAPI` 接口（preload `writingV2.manga` 契约）
  - [x] SubTask 1.2: `WritingV2API` 新增 `manga: V2MangaAPI` 字段
  - [x] SubTask 1.3: `electron.d.ts` 补声明 `writingV2.manga`（`electron.d.ts` 通过 `writingV2: WritingV2API` 引用接口，Task 1.2 已自动覆盖）

- [x] Task 2: 主进程 MangaParsingService
  - [x] SubTask 2.1: 新建 `src/main/services/manga/MangaParsingService.ts`
    - `scanFolder(folderPath)`: fs.readdirSync → 过滤图片扩展名 → 提取数字序号排序 → 返回 MangaPage[]
    - `analyzePage(params)`: 读图片 base64 → 构建 prompt（含跨页上下文）→ fetch LLM → 解析 JSON → 返回 MangaPageAnalysis + MangaPageSummary
    - `buildContextTable(summaries)`: 生成 Markdown 表格字符串
    - `generateStoryOutline(summaries)`: 汇总所有摘要 → 调用 AI 生成大纲
    - 错误处理：图片读取失败/AI 调用失败/JSON 解析失败 均返回明确 error
  - [x] SubTask 2.2: 新建 `src/main/ipc/handlers/mangaHandlers.ts`
    - `manga:scanFolder` handler
    - `manga:analyzePage` handler（入参：imagePath, readingOrder, previousSummaries[]）
    - `manga:buildContextTable` handler（入参：summaries[]）
    - `manga:generateOutline` handler（入参：summaries[], projectContext?）
    - `manga:exportAnalysis` handler（入参：result, filePath）→ 写 Markdown 文件
  - [x] SubTask 2.3: `src/main/ipc/index.ts` 注册 manga handler
  - [x] SubTask 2.4: `src/main/preload.ts` 新增 `writingV2.manga` 命名空间（全类型化）

- [x] Task 3: 渲染层服务封装
  - [x] SubTask 3.1: `src/renderer/services/writingV2Service.ts` 新增 `manga` 子命名空间方法（该服务为透传封装，返回完整 `WritingV2API`，Task 1.2 后 `manga` 自动可用，无需改代码）
  - [x] SubTask 3.2: 类型引用 `writing-v2.types.ts` 中的 V2MangaAPI 类型

## Phase 2 — UI（导入 + 浏览 + 阅读顺序）

- [x] Task 4: 漫画解析容器组件
  - [x] SubTask 4.1: 新建 `manga/V2MangaStage.tsx`
    - 布局：顶部工具栏（导入/阅读顺序/批量分析+进度）+ 左侧图片浏览 + 右侧子 Tab（当前页分析/上下文预览/大纲与导出）
    - 管理 `currentIndex`/`readingOrder`/`pages`/`analysisMap` 状态
    - 未导入时显示 Empty + 导入按钮
  - [x] SubTask 4.2: `V2AssetsStage.tsx` 新增「漫画解析」Tab（icon: PictureOutlined）
  - [x] SubTask 4.3: 新建 `manga/V2MangaImport.tsx`（合并进 V2MangaStage 顶部工具栏 + 空态导入按钮，功能等价：selectDirectory → scanFolder → 页面列表/总页数）
  - [x] SubTask 4.4: 新建 `manga/V2MangaViewer.tsx`
    - 图片展示（`file.readAsBase64` → data URI → `<img>`）
    - 上一页/下一页按钮（边界禁用）
    - 页码指示器 `X / N`
    - 点击缩略图跳转

- [x] Task 5: 阅读顺序配置
  - [x] SubTask 5.1: 新建 `manga/V2MangaReadingOrderToggle.tsx`
    - Radio：「从左到右」/「从右到左」
    - 切换时更新 Stage 中的 readingOrder
    - 缩略图导航条根据阅读顺序反转排列（V2MangaViewer 内实现）

## Phase 3 — AI 分析 + 结果展示

- [x] Task 6: 单页分析
  - [x] SubTask 6.1: 新建 `manga/V2MangaAnalysisPanel.tsx`
    - 「分析此页」按钮（检测 supportsVision）
    - 加载状态（Spin + 「AI 分析中...」）
    - 分析完成后展示结果分区
  - [x] SubTask 6.2: 手动修正（合并进 V2MangaAnalysisPanel）
    - 角色区：列表 + 每行可编辑（name/expression/action）+ 增删
    - 场景区：4 个输入框（environment/time/location/atmosphere）
    - 剧情区：逐格 plot + emotion 文本域
    - 文本区：列表（content/type/position），支持增删改
    - 「保存修正」按钮 → 更新 analysisMap
    - 「已修正」标签标记
  - [x] SubTask 6.3: 新建 `manga/V2MangaContextPreview.tsx`
    - 展示跨页上下文表格
    - 「重新生成」按钮（基于当前修正后的摘要重建）

- [x] Task 7: 批量分析
  - [x] SubTask 7.1: 批量进度（合并进 V2MangaStage 工具栏：antd Progress + current/total + 取消按钮）
  - [x] SubTask 7.2: `V2MangaStage` 实现批量分析逻辑
    - 串行逐页：for (page of pages) → analyzePage → 更新 results
    - 跳过已分析的页
    - 取消标志（useRef，⚠️ 项目规则：防重入必须用 useRef）
    - 完成后提示

## Phase 4 — 创作支持 + 导出

- [x] Task 8: 故事大纲生成
  - [x] SubTask 8.1: 新建 `manga/V2MangaOutlinePanel.tsx`
    - 「生成故事大纲」按钮（需 ≥ 1 页已分析）
    - 加载状态 → 展示大纲文本
    - 「复制大纲」按钮
  - [x] SubTask 8.2: 「导入到写作编辑器」
    - 调用 `manga.generateOutline`（如未生成）→ `writingV2.parseOutline` 解析为结构化大纲
    - `patchProject` 设置当前项目 `outline` 字段
    - `setStage('outline')` 跳转大纲工作台
  - [x] SubTask 8.3: 导出 Markdown（合并进 V2MangaOutlinePanel）
    - 「导出 Markdown」按钮
    - `file.selectDirectory` 选保存位置 → `manga:exportAnalysis` 写文件
    - 显示文件路径

## Phase 5 — 验证 + 文档

- [x] Task 9: 验证
  - [x] SubTask 9.1: `npm run typecheck` 本次新增/修改文件零错误（存量无关模块的预存错误未变动）
  - [x] SubTask 9.2: `npm test` 存量用例不回归（1491 通过；4 个失败均在 PromptTemplateService/skills/agentModeService，与本次变更无关）
  - [x] SubTask 9.3: 运行时验证
    - `MangaParsingService.test.ts` 新增 6 个单测全部通过：过滤扩展名/数字序号排序/index 连续/绝对路径/空目录报错/不存在目录报错
    - Electron 应用启动成功（主进程完整初始化，manga IPC handler 注册无异常）
    - AI 分析路径（单页/批量/大纲/导出 UI 链路）已编译通过并注入 preload，实际 AI 调用需在应用中用已配置的多模态模型执行
  - [x] SubTask 9.4: dev server 已重启（本次为全新启动，未触碰 5000 端口进程）
  - [x] SubTask 9.5: `CODE_WIKI.md` 增量更新（漫画解析模式章节）

# Task Dependencies

- Task 2 依赖 Task 1（类型先行）
- Task 3 依赖 Task 1 + Task 2（preload + 服务封装）
- Task 4 依赖 Task 3（UI 需要服务封装）
- Task 5 依赖 Task 4（阅读顺序在 Stage 组件中）
- Task 6 依赖 Task 4 + Task 5（分析需要浏览 + 阅读顺序）
- Task 7 依赖 Task 6（批量基于单页分析）
- Task 8 依赖 Task 7（大纲基于全部分析结果）
- Task 9 依赖 Task 8（全部功能完成后验证）
