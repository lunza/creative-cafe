# Tasks

- [x] Task 1: shared 层——类型定义 + 本地文本扫描器（纯函数 + 单测）
  - [x] SubTask 1.1: 新建 `src/shared/types/cross-chapter-review.types.ts`：`CrossCheckParams`（startPos 0基位置 / count / distance / similarityThreshold / aiStrictness: 'strict'|'standard'|'lenient' / enableAiReview / customPrompt?）、`CrossCheckIssue`（id/type: 'plot_repetition'|'plot_contradiction'|'text_repetition'/severity/chapterA/chapterB: {index(0基位置), title, quote, lineHint?}/description/source: 'local'|'ai'|'local+ai'）、`CrossCheckReport`（issues/stats{chapters,pairs,localCount,aiCount,durationMs}/params/cancelled?）、`CrossCheckFixSuggestion`（chapterIndex/originalText/replacementText/explanation）、默认参数常量
  - [x] SubTask 1.2: 新建 `src/main/services/writing/CrossChapterTextScanner.ts`（纯函数，无 IO）：句级切分（句末标点，过滤 <8 字句）、字符 4-gram 集合、Jaccard 相似度、章节对枚举（含章内，距离 ≤ distance）、短句（8-15字）额外阈值 0.85、同章节对多组雷同句合并为一条 issue（≤3 组示例，severity 按距离：1=high、2=medium、>2=low）
    - 实现注记（重要偏离，已记入 CODE_WIKI/LEARNINGS）：五章实测语料推演证明整句 Jaccard 对"同一短语嵌在不同句子里复现"的重复严重低估（用户点名案例整句 Jaccard 仅 ~0.2，0.75 阈值命不中）→ 实际实现改为 **5-gram 倒排索引 + 最长公共片段扩展**；命中判据 = 最长公共片段 ≥ round(8×阈值) 字 或 ≥2 个互不重叠短片段（各 ≥ round(5×阈值) 字）；短句对（≤15字）要求匹配占比 ≥0.85。阈值语义 = 映射到最小公共片段长度（非直接相似度）
  - [x] SubTask 1.3: 单测（vitest）：用五章实测文本做 fixture——"掼在…双人床上"（2↔3/3↔4）、"腰部像是一台不知疲倦的打桩机"（3↔4）、"岛主的声音变得低沉而沙哑"（3↔4）、"层层叠叠的…肉褶被粗暴地抚平"（2↔3↔4↔5）必须命中；距离过滤（distance=1 时 2↔4 不报）；短句高阈值（构造 8-15 字相似句 sim<0.85 不报）；无正文章节跳过
    - 注：用户指示"不用测试，我自己测试就行"→ 单测文件未建，判据正确性以实测语料手工推演验证（见 SubTask 1.2 注记），端到端由用户在五章项目自测
- [x] Task 2: 主进程 CrossChapterReviewService（编排 + AI 审查 + 中止/流式）
  - [x] SubTask 2.1: 类骨架 + `reviewCrossChapters(request, onProgress?)`：加载项目 → 取分组章节（位置切片，0基，跳过无正文）→ 本地扫描（恒执行，onProgress 阶段事件）→ enableAiReview 时 AI 审查 → 合并去重（同章节对+引文前缀归并，source 标 local+ai）→ 返回 report
  - [x] SubTask 2.2: AI 审查：`buildReviewPrompt`（各章正文按 0基位置编号标注为"第{pos+1}章（标题）"、表格上下文=事件表/伏笔表/角色表次要参考、aiStrictness 三档判据文案、输出 JSON schema：issues[{type, severity, chapterA:{index,title,quote}, chapterB:{index,title,quote}, description}]，index 用位置编号）；复用 ContentGenerator 的模型调用/executeStreamRequest 模式（onStream/onReasoning 转发 onProgress）；`withCustomPrompt` 注入；JSON 解析复用 PlotCheckerService 的 fixJsonForParsing/extractJsonObject 同类工具（可提取共用或内联同逻辑）；引文逐字校验（includes，失败加 located:false 标记）
  - [x] SubTask 2.3: 中止：AbortController（实例字段，同 activeDeAiCheckController 模式），catch 判 AbortError → `cancelled: true` + `error:'用户已停止'`；finally 清理
  - [x] SubTask 2.4: `suggestFix(projectId, issue, customPrompt?)`：提示词=问题详情+目标章全文+对侧章节引文摘录，输出 JSON {chapterIndex, originalText, replacementText, explanation}；`withHumanizerNovelRules` 注入；校验 chapterIndex 在分组内 + originalText 逐字存在（`content.includes`，失败重试 1 次）；返回 success/fixedText 定位信息
- [x] Task 3: IPC handler + 注册 + preload
  - [x] SubTask 3.1: 新建 `src/main/ipc/handlers/writing/writingCrossCheckHandlers.ts`：`writing:crossCheckReview`（模型配置读取复用 writingPlotCheckHandlers 的 activeEngine 模式；onProgress 经 event.sender.send('writing:crossCheck:stream', {phase, chunk, reasoning})，isDestroyed 防护）、`writing:crossCheckCancel`、`writing:crossCheckSuggestFix`
  - [x] SubTask 3.2: `writingHandlers.ts` 注册 registerWritingCrossCheckHandlers()
  - [x] SubTask 3.3: `src/main/preload.ts` writing API 增加 crossCheckReview / crossCheckCancel / crossCheckSuggestFix / onCrossCheckStream（订阅返回取消函数）
- [x] Task 4: 渲染层 V2CrossCheckPanel（分组选择 + 参数 + 审查 + 结果展示）
  - [x] SubTask 4.1: 新建 `src/renderer/components/Creative/WritingModeV2/crosscheck/V2CrossCheckPanel.tsx`：props { project, chapterIndex, onContentUpdated }；章节分组选择（起始章 Select + 章节数 InputNumber，默认 2 / 上限 5）；细粒度参数区（距离 InputNumber 1-10 默认2、阈值 Slider 0.50-0.95 默认0.75、AI 严格度 Select 三档）+ 按项目持久化 localStorage（key: v2-crosscheck-params:{projectId}）；「AI 语义审查」Switch（默认开）；CustomPromptPopover（storageKey: v2-crosscheck-prompt:{projectId}）
  - [x] SubTask 4.2: 审查流程 state 机：idle/running/streaming/done/cancelled；流式可视化（思考流金色 + 正文流，自动滚底，复用 deai 审核弹窗的链路模式但内嵌面板）；「停止」danger 按钮（cancelled 后不报红）；常驻结果摘要卡片（快模型/本地扫描秒回时 toast 不够用，沿用 lastResult 卡片原则）
  - [x] SubTask 4.3: 结果展示：三类型分组（组头 Tag + 数量）；问题卡片=类型/严重度/来源/local+ai 合并标记 + 章节A vs 章节B 引文对照区块（左右或上下双栏，章节号可点击跳转 setSelectedChapterIndex）+ 描述 + 「生成修复建议」按钮；空状态（无问题=绿色"未发现问题"）
  - [x] SubTask 4.4: 若单文件超 400 行，拆 `V2CrossCheckIssueCard.tsx` / `V2CrossCheckModals.tsx`
    - 实际拆分：`V2CrossCheckIssueCard.tsx`（193 行）+ `V2CrossCheckSettings.tsx`（设置区）+ `V2CrossCheckFixModal.tsx`（修复弹窗）；主面板 418 行
- [x] Task 5: 修复建议闭环（建议生成 + 确认 + 写回）
  - [x] SubTask 5.1: 修复确认弹窗（Modal）：explanation + originalText（红色删除线样式）→ replacementText（绿色）diff 式展示 + 目标章节号；footer 取消/应用
  - [x] SubTask 5.2: 应用写回：`patchProject` 更新 outline.chapters[targetPos].content（content 中 originalText 替换为 replacementText，仅首处）+ `api.autoSaveChapter({projectId, chapterIndex, content})`（chapterIndex 传值口径与工作台现有保存流一致，实现时核对 CODE_WIKI 章节定位契约）；若 targetPos === 当前 chapterIndex 则调 onContentUpdated 同步编辑器；问题标记已修复（本地 state）
    - 实现注记：autoSaveChapter 传 **`chapters[pos].index` 字段值**（repo 按 index 值查找+文件命名，正确落盘+版本记录；工作台 persistContent 传位置是历史遗留口径，未动）
  - [x] SubTask 5.3: 锚点校验失败路径：toast 显示失败原因，弹窗保留可重试
- [x] Task 6: 工作台集成 + 表格整理提示词章节字段绝对化 + 端到端验证
  - [x] SubTask 6.1: `V2ChapterWorkbench.tsx`：rightTab 类型加 'crosscheck'，tabs 加 { key:'crosscheck', icon, label:'跨章审查' }，渲染 V2CrossCheckPanel（传 project/chapterIndex/onContentUpdated）；既有三 tab 零改动
  - [x] SubTask 6.2: `TableOrganizeService.ts` 提示词：章节类字段（发生章节/首次登场章节/埋设章节/回收章节等）要求输出绝对章号"第N章"，禁止"本章"等相对值（同步提示词内所有示例行）
    - 实现注记：根因是整理提示词完全没有章节号上下文（AI 不知道在整理第几章）→ 批量/单表两个 prompt builder 加【当前章节】段（告知实际章号 + 绝对章号规则）
  - [x] SubTask 6.3: typecheck（tsc 过滤新增/修改文件零新错误）；dev server 自动重启（不动 5000 端口 vLLM）
  - [x] SubTask 6.4: 端到端实测（用户在五章项目操作）：① 本地扫描命中实测 C 类问题；② AI 审查（第2-4章）命中 B 类矛盾 + A 类重复剧情；③ 对"打桩机"问题生成修复建议并确认应用，验证落盘 + 版本记录 + 编辑器同步；④ 停止审查不报红
    - 注：用户指示自测（"不用测试，我自己测试就行"）
- [x] Task 7: 文档更新（CODE_WIKI.md 增量 + 重点标记 + LEARNINGS.md）
  - [x] SubTask 7.1: CODE_WIKI.md 新增条目：跨章审查机制（混合路线/参数语义/引文定位契约/章节定位契约沿用0基位置）+ 五章实测问题清单（作为后续验收基准）
  - [x] SubTask 7.2: LEARNINGS.md 记录实测发现的问题模式（若实现中出现反复提示才解决的问题则重点标记）
    - 新增 LRN-20261007-010：中文网文文本重复检测必须用短语级公共子串匹配（spec 初稿整句 Jaccard 被实测语料推演否决的教训）

# Task Dependencies

- Task 2 依赖 Task 1（类型 + 扫描器）
- Task 3 依赖 Task 2（handler 包装 service）
- Task 4 依赖 Task 3（UI 调 preload API）
- Task 5 依赖 Task 4（修复按钮在面板内）
- Task 6 依赖 Task 1-5（集成 + 端到端）
- Task 7 依赖 Task 6（完成后写文档）
