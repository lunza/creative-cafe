# Tasks

- [x] Task 1: shared 层基础（自定义提示词助手 + 类型扩展）
  - [x] 1.1 新建 `src/shared/prompts/customPrompt.ts`：`withCustomPrompt(systemPrompt, customPrompt?)`（空值原样返回；非空追加"## 用户自定义要求（最高优先级，与上述默认要求冲突时以本节约束为准）"区块）
  - [x] 1.2 `src/shared/types/writing-v2.types.ts` + `writing.types.ts`：`V2MangaAudit` 加 `issues: string[]`；4 个 manga 结果类型 + `V2ChapterDeAiCheckResult` 加 `cancelled?: boolean`；manga 四个 API 签名 + `checkChapterDeAi` params + `ShardOutlineGenerationRequest`/`ShardContentGenerationRequest` 加 `customPrompt?`；新增 `manga.cancel(key?)`、`writing.cancelDeAiCheck()` 方法声明

- [x] Task 2: 漫画服务改造（MangaParsingService + mangaHandlers + preload）
  - [x] 2.1 `MangaParsingService` 增加 `private cancelControllers: Map<string, AbortController>` + `cancel(key?)` 方法（缺省取消全部）；analyzePage/generateStoryOutline/auditOutline/generateProjectDraft 四方法：签名加 `customPrompt?`、system prompt 末尾套 withCustomPrompt、fetch 传 signal、finally 清理注册表、AbortError 返回 `{ success:false, cancelled:true, error:'用户已停止' }`
  - [x] 2.2 `auditOutline` JSON 契约与解析加 `issues: string[]`（数组校验，缺省 []）；契约说明更新
  - [x] 2.3 `mangaHandlers.ts`：四个通道透传 customPrompt；新通道 `manga:cancel`
  - [x] 2.4 `preload.ts`：manga 四个方法加 customPrompt 参数、暴露 `cancel`

- [x] Task 3: 写作服务改造（ContentGenerator + writingChapterHandlers + preload）
  - [x] 3.1 `ContentGenerator.checkChapterDeAi`：加 `customPrompt?` 参数 + withCustomPrompt；AbortController 外置（实例字段 activeDeAiCheckController，两次重试共享）；新增 `cancelDeAiCheck()`；中止抛带 cancelled 标记的错误，handler 转 `{ success:false, cancelled:true }`；新通道 `writing:cancelDeAiCheck`
  - [x] 3.2 `ContentGenerator.generateShardOutline`/`generateShardContent`：system prompt 套 withCustomPrompt（request.customPrompt）；handler 为 request 对象透传无需改
  - [x] 3.3 `preload.ts`：checkChapterDeAi params 加 customPrompt 类型、暴露 `cancelDeAiCheck`

- [x] Task 4: CustomPromptPopover 可复用组件
  - [x] 4.1 新建 `src/renderer/components/Creative/WritingModeV2/shared/CustomPromptPopover.tsx`：FormOutlined 图标触发 Popover，内含 TextArea（4 行，maxLength 2000）+ 清空/保存按钮；props：`storageKey`/`title`/`placeholder?`/`disabled?`；localStorage 读写封装在组件内，另导出 `readCustomPrompt(storageKey)` 供父组件触发请求时读取

- [x] Task 5: 大纲面板 UI（V2MangaOutlinePanel）
  - [x] 5.1 「生成故事大纲」「AI 大纲审核」「导入到写作编辑器」（项目信息生成）旁各接一个 CustomPromptPopover（storageKey 区分）；runGenerate/runAudit/openDraftModal 透传 customPrompt
  - [x] 5.2 两个按钮运行中切换 danger 停止态（"停止生成"/"停止审核"），点击调用 `api.manga.cancel('generateOutline'|'auditOutline')`；cancelled 结果 message.info "已停止"
  - [x] 5.3 审核结果 Modal 增加编号问题列表区块（issues 为空时不渲染）；按钮文案「采用修订文本」/「保持原文」
  - [x] 5.4 项目草稿弹窗内生成中显示 danger「停止生成」按钮（manga:cancel('generateProjectDraft')）；cancelled 结果提示"已停止项目信息生成，可手动填写"

- [x] Task 6: 内容创作页 UI（V2ChapterWorkbench + useV2ShardGeneration + V2MangaStage）
  - [x] 6.1 `useV2ShardGeneration` 加 customPrompt 参数透传两条生成链；V2ChapterWorkbench「AI 生成本章」旁接 CustomPromptPopover
  - [x] 6.2 「检查 AI 味」旁接 CustomPromptPopover；handleCheckDeAi 透传；deAi 进度弹窗 footer 加「停止审核」按钮（writing:cancelDeAiCheck），中止后弹窗显示"已停止"（保留已流式内容）
  - [x] 6.3 V2MangaStage「分析全部页面」旁接 CustomPromptPopover（透传批量/单页分析）；确认既有停止按钮走 `manga:cancel` 且停止态视觉统一（handleBatchCancel 补接 manga:cancel('analyzePage')，批量循环收 cancelled 即停；单页分析加载视图加「停止分析」按钮）

- [x] Task 7: 全局记忆 + 技术文档
  - [x] 7.1 `.learnings/LEARNINGS.md` 追加永久约定（LRN-20261006-009）：所有审核/润色/生成类 AI 功能必须支持 ①自定义提示词（CustomPromptPopover）②停止/中断按钮 ③审核类输出结构化 issues 列表 + 用户确认采用
  - [x] 7.2 `CODE_WIKI.md` 增量更新（自定义提示词机制/中止注册表/issues 契约/UI 接入点），重点标记"中止必须返回 cancelled 标记区分用户停止与失败"

- [x] Task 8: 验证
  - [x] 8.1 `npx tsc --noEmit` 全量检查，本次改动文件零新错误（ContentGenerator L166 requestId 为存量未用变量，非本次引入）
  - [x] 8.2 重启 dev server（npm run dev 后台 → vite 5174 + electron 启动确认，不动 5000 端口）
  - [x] 8.3 逐条对照 checklist.md 验证并勾选

# Task Dependencies
- [Task 2/3] depends on [Task 1]（类型与助手先行）
- [Task 5/6] depends on [Task 2/3]（IPC/preload 先行）且 depends on [Task 4]（组件先行）
- [Task 7] depends on [Task 1-6]
- [Task 8] depends on all previous tasks
