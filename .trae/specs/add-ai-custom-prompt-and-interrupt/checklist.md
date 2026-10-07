# Checklist

## 自定义提示词机制
- [x] `withCustomPrompt` 空值时 system prompt 逐字节不变；非空时末尾追加"用户自定义要求（最高优先级）"区块
- [x] 大纲审核/大纲生成/项目草稿生成/页面分析四个漫画功能 API 均接受并注入 customPrompt（MangaParsingService 四方法 withCustomPrompt ×4，L363/610/786/959）
- [x] 章节「检查 AI 味」API 接受并注入 customPrompt（preload params + ContentGenerator）
- [x] 一键生成本章的 customPrompt 同时注入分片大纲与分片内容两条生成链（handleAutoGenerate → planShards/generateShard 双链透传）
- [x] CustomPromptPopover 组件存在，输入按功能 key 持久化到 localStorage，重开应用后回填，各入口互不串扰（6 个独立 storageKey）
- [x] 6 个入口（大纲审核/大纲生成/项目草稿/检查AI味/生成本章/页面分析）均已接入 CustomPromptPopover（V2MangaOutlinePanel ×3、V2ChapterWorkbench ×2、V2MangaStage ×1）

## 大纲审核问题列表
- [x] `V2MangaAudit` 类型含 `issues: string[]`，`auditOutline` JSON 契约要求模型逐条列出问题（无问题为空数组），原 5 字段不变（契约 L740 + 解析 L850 数组校验）
- [x] 大纲审核结果 Modal 展示编号问题列表（样式对齐章节 AI 味审核弹窗），issues 为空时不渲染列表（L546-553）
- [x] 用户可「采用修订文本」（替换大纲并保存）或「保持原文」（仅关闭弹窗）（footer L520-526）

## 停止/中断
- [x] `MangaParsingService` AbortController 注册表覆盖 analyzePage/generateStoryOutline/auditOutline/generateProjectDraft，`manga:cancel(key?)` 缺省取消全部（cancelControllers L200/209-214，四 key 注册 L309/548/703/895）
- [x] 中止后返回 `{ success:false, cancelled:true, error:'用户已停止' }`，前端显示"已停止"而非错误（writingChapterHandlers L834-837；前端 6 入口 cancelled 分支 message.info）
- [x] `checkChapterDeAi` 可被 `writing:cancelDeAiCheck` 中止，进度弹窗 footer 有「停止审核」按钮，中止后保留已流式内容（deAiStopped 态：弹窗不关、流式内容保留、标题「已停止」Tag）
- [x] 「生成故事大纲」「AI 大纲审核」按钮运行中切换 danger 停止态，点击中止请求（V2MangaOutlinePanel L404/L418）
- [x] 项目草稿生成弹窗内有停止按钮（handleStopDraft L258/L616）
- [x] 「分析全部页面」停止按钮走 `manga:cancel`，停止态视觉统一（handleBatchCancel 补接 manga:cancel('analyzePage')，批量循环收 cancelled 即 break，已分析页保留）
- [x] 一键生成本章（writing:cancelGeneration）与世界书批量操作（ai:cancel）现状不受影响（无回归，代码路径未改动）
- [x] 并发场景：停止其中一个请求不影响另一个进行中的请求（注册表按功能 key 隔离 AbortController）

## 记忆与文档
- [x] `.learnings/LEARNINGS.md` 追加永久约定（自定义提示词 + 停止按钮 + issues 列表三件套，LRN-20261006-009）
- [x] `CODE_WIKI.md` 增量更新（含 cancelled 标记的 ⚠️ 重点标记）
- [x] `npx tsc --noEmit` 本次改动文件零新错误（ContentGenerator L166 requestId 为存量未用变量）
- [x] dev server 已重启并确认启动（vite 5174 + electron 进程，5000 端口进程未动）
