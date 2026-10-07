# Checklist

## 类型与 IPC 契约
- [x] `writing-v2.types.ts` 包含全部漫画解析类型（MangaPage/MangaPageAnalysis/MangaPageSummary/MangaTextExtraction/MangaPanelAnalysis/MangaCharacterAnalysis/MangaSceneAnalysis/MangaCharacterSummary/MangaChapterSuggestion/MangaAnalysisResult/V2MangaAPI 等）
- [x] `WritingV2API` 包含 `manga: V2MangaAPI` 字段
- [x] `electron.d.ts` 声明 `writingV2.manga` 类型（`writingV2: WritingV2API` 引用，接口扩展后自动生效）
- [x] `preload.ts` `writingV2.manga` 命名空间全类型化，无 any（5 方法均带完整参数/返回类型）
- [x] `writingV2Service.ts` 包含 manga 子命名空间方法（透传封装，WritingV2API 扩展后自动可用）

## 主进程服务
- [x] `MangaParsingService.scanFolder` 正确过滤图片扩展名（JPG/PNG/WebP/BMP/TIFF）——单测验证 notes.txt 被过滤
- [x] `MangaParsingService.scanFolder` 按数字序号排序（无数字时字母序）——单测验证 2<10<45<100、abc.bmp 排最后
- [x] `MangaParsingService.analyzePage` 构建正确多模态请求（OpenAI Vision 协议：image_url data URI + 非流式）
- [x] `MangaParsingService.analyzePage` 注入跨页上下文表格（第 2 页起，最多 10 页）
- [x] `MangaParsingService.analyzePage` 注入阅读顺序指令（leftToRight/rightToLeft 影响格子编号说明）
- [x] `MangaParsingService.analyzePage` JSON 解析容错（直接 parse → 首尾大括号提取 → ```json 代码块提取 三级回退）
- [x] `MangaParsingService.buildContextTable` 生成正确 Markdown 表格（表头 + 每页一行）
- [x] `mangaHandlers.ts` 注册 5 个通道（scanFolder/analyzePage/buildContextTable/generateOutline/exportAnalysis）
- [x] `ipc/index.ts` 注册 manga handler（registerMangaHandlers 调用）
- [x] AI 调用失败时返回明确错误信息（HTTP 状态码/网络错误/空内容/JSON 解析失败 均返回 error，不抛异常）

## 导入与浏览
- [x] 用户选择文件夹后正确扫描图片文件（selectDirectory → scanFolder → 页面列表 + 总页数 message）
- [x] 无图片文件时显示提示（「未找到支持的图片文件」，单测验证）
- [x] 页面列表按序号升序显示（单测验证 index 1-based 连续）
- [x] 图片正确加载展示（data URI，file:readAsBase64 返回完整 data URI）
- [x] 上一页/下一页按钮边界禁用（currentIndex<=1 / >=pages.length）
- [x] 页码指示器正确更新（第 X / N 页）

## 阅读顺序
- [x] 提供「从左到右」/「从右到左」Radio 切换（V2MangaReadingOrderToggle）
- [x] 切换时缩略图排列方向即时反转（orderedPages reverse）
- [x] 切换时 AI 分析 prompt 注入对应阅读顺序（readingOrder 传入 analyzePage → buildSystemPrompt）
- [x] 已分析页面不自动重分析（analysisMap 不随切换变化）

## AI 分析
- [x] 「分析此页」按钮检测 `supportsVision`，不满足时提示（按钮 disabled + Alert + message.warning 双重）
- [x] 分析中显示加载状态（Spin + 「AI 分析中，请稍候...」）
- [x] 分析成功后右侧面板展示结果分区（角色/场景/剧情/情感 4 区 + 文本嵌于剧情格内）
- [x] 跨页上下文表格正确生成并注入（ContextPreview 可视化 + prompt 注入）
- [x] AI 返回格式错误时显示提示 + 重试按钮（message.error + 「重新分析」按钮）
- [x] 分析结果可手动修正（角色增删改/场景 4 字段/逐格剧情情绪/文本增删改 全字段）
- [x] 修正后标记「已修正」（userModified → Tag，导出 Markdown 中带 [已修正]）

## 批量分析
- [x] 「分析全部页面」按钮串行逐页分析（for 循环 await）
- [x] 进度条显示 current/total（antd Progress + 文本）
- [x] 跳过已分析且未修正的页（workMap.has 检查）
- [x] 「取消」按钮在当前页完成后停止（batchCancelRef 在每页循环开头检查）
- [x] 已分析部分保留（workMap 增量写入 state）

## 创作支持
- [x] 「生成故事大纲」基于全部页面分析结果（summaries → generateStoryOutline）
- [x] 大纲文本正确展示（pre 块 + 复制按钮）
- [x] 「导入到写作编辑器」正确设置项目 outline 并跳转（parseOutline → patchProject({outline, outlineRaw}) → setStage('outline')，与 V2OutlineWorkbench 同款模式）
- [x] 导出 Markdown 文件包含：大纲 + 角色表 + 逐页分析（buildMarkdown 三段结构）
- [x] 导出文件路径正确展示（message.success 含完整路径）

## 用户体验
- [x] V2AssetsStage 新增「漫画解析」Tab（PictureOutlined 图标）
- [x] 未导入时显示 Empty 状态（含格式/命名提示 + 导入按钮）
- [x] 加载状态不阻塞 UI（异步 IPC，按钮级 loading）
- [x] 错误信息透出真实原因（res.error 直接展示，主进程区分 HTTP 状态/网络/格式错误）

## 验证
- [x] `npm run typecheck` V2 + manga 文件零错误（首次检查发现 5 个错误已全部修复：Divider orientation/patchProject 字段/未用导入/残留 pages 引用；存量无关模块预存错误未变动）
- [x] `npm test` 存量用例不回归（1491 通过；4 个失败均在 PromptTemplateService/skills/agentModeService，与本次变更无关）
- [x] 运行时验证：`MangaParsingService.test.ts` 6 单测全通过（过滤/排序/index/路径/空目录/不存在目录）；Electron 应用启动成功、manga IPC 注册无异常；AI 分析 UI 链路已编译注入（实际 AI 调用依赖用户配置的多模态模型）
- [x] dev server 已重启（StopCommand 终止旧进程 → 确认无残留 → 全新 `npm run dev`，全程未触碰 5000 端口进程）
- [x] `CODE_WIKI.md` 增量更新（Phase 10 漫画解析模式章节，含架构/验证/约束提醒）
