# Tasks

## 阶段 1：搜索服务基础（无依赖，可并行）

- [x] Task 1: 定义网络搜索共享类型与 provider 接口
  - [x] SubTask 1.1: 新增 `src/main/services/webSearchProviders/types.ts` — 定义 `WebSearchProvider` 接口（name / requiresApiKey / search）、`SearchResult` 类型（title / snippet / url / source）、`SearchOptions`（maxResults / allowedDomains / timeout）、`WebSearchConfig` 类型（provider / apiKey / endpoint / maxResults / timeout / allowedDomains / enableInAuthoring）
  - [x] SubTask 1.2: 在 `src/shared/settings.ts` 的 `AppSetting.defaultSetting` 新增 `webSearch` 配置块（默认 enabled=false / provider='duckduckgo' / maxResults=5 / timeout=10000 / enableInAuthoring=false）
  - [x] 验证：`npx tsc --noEmit` 0 错误（新文件 webSearchProviders/types.ts 与修改的 shared/settings.ts 均 0 错误；项目预存 TS 错误与本次改动无关）

- [x] Task 2: 实现 DuckDuckGo provider（零配置，默认） ✅ 2026-07-31（DuckDuckGoProvider 实现完成：HTML 端点抓取 + 正则解析 result__title/result__snippet + uddg 重定向解析 + AbortController 超时 + 429/非200 错误处理 + allowedDomains/maxResults 后处理；临时自检脚本验证解析正则通过）
  - [x] SubTask 2.1: 新增 `src/main/services/webSearchProviders/duckDuckGoProvider.ts` — 通过 `https://html.duckduckgo.com/html/?q=QUERY` 端点抓取，解析 HTML 结果页提取 `.result__title` / `.result__snippet` / `.result__url`
  - [x] SubTask 2.2: 实现请求头伪装（User-Agent: Mozilla/5.0...）避免被拦截；超时控制（默认 10s）；错误处理（网络错误 / 速率限制 429 → 返回明确错误）
  - [x] 验证：单元测试 mock fetch 响应，覆盖正常搜索 / 空结果 / 网络错误（注：单元测试留待 Task 12 统一编写；本次以临时 Node 自检脚本验证 HTML 解析正则 + 工具函数，已删除临时脚本）

- [x] Task 3: 实现 Tavily provider（API key，AI 优化） ✅ 2026-07-31（TavilyProvider 实现完成：POST api.tavily.com/search + body 含 search_depth='advanced'/include_answer=false + content→snippet 映射 + 缺 key 抛明确错误 + 错误正文读取）
  - [x] SubTask 3.1: 新增 `src/main/services/webSearchProviders/tavilyProvider.ts` — 调用 `https://api.tavily.com/search` POST 端点，body: `{ query, api_key, max_results, search_depth: 'advanced' }`
  - [x] SubTask 3.2: 解析 Tavily 响应 `results: [{ title, content, url }]`，映射到 `SearchResult`（content → snippet）
  - [x] SubTask 3.3: API key 缺失时抛出明确错误（`Tavily API key is required`）
  - [x] 验证：单元测试 mock fetch，覆盖正常 / 缺 key / API 错误（注：单元测试留待 Task 12 统一编写）

- [x] Task 4: 实现 SearXNG + Custom provider ✅ 2026-07-31（SearXngProvider + CustomProvider 实现完成：SearXNG 走 {endpoint}/search?q=&format=json；Custom 走 {query}/{maxResults} 占位符模板 + 兼容 snippet/content 字段；缺 endpoint 抛明确错误）
  - [x] SubTask 4.1: 新增 `src/main/services/webSearchProviders/searxngProvider.ts` — 调用 `{endpoint}/search?q=QUERY&format=json`，解析 JSON 响应 `results: [{ title, content, url }]`
  - [x] SubTask 4.2: 新增 `src/main/services/webSearchProviders/customProvider.ts` — 按用户配置的 endpoint URL + query 参数模板发 GET 请求，响应需符合 `{ results: [{ title, snippet, url }] }` 结构
  - [x] 验证：单元测试 mock fetch 覆盖两种 provider（注：单元测试留待 Task 12 统一编写）

- [x] Task 5: 实现 HtmlTextExtractor + WebSearchService ✅ 2026-07-31（HtmlTextExtractor 剥离 script/style/nav/header/footer/noscript/svg + 注释 + 块级换行 + 实体解码 + 空白压缩 + 截断；WebSearchService provider 工厂 + LRU 缓存(query+provider+maxResults, TTL 5min, 容量100) + 速率限制(3s间隔/20次上限) + 配置指纹变更清缓存；fetchUrl 按 Content-Type 分流 HTML/JSON/text/二进制；临时自检脚本 14+8=22 项断言全通过，tsc 0 错误）
  - [x] SubTask 5.1: 在 `src/main/services/webSearchService.ts` 实现 `HtmlTextExtractor` — 剥离 `<script>/<style>/<nav>/<header>/<footer>` 标签内容；解码 HTML 实体（&amp; / &lt; / &gt; / &nbsp; / &#39; / &quot;）；压缩连续空白；截断到 maxLength（默认 4000）追加 `...[truncated]`
  - [x] SubTask 5.2: 实现 `WebSearchService` 类 — provider 工厂方法（按 config.name 动态加载 provider）；搜索结果 LRU 缓存（key: `query+provider`，TTL 5 分钟）；速率限制（min 3s 间隔）；单次运行次数计数器（上限默认 20）
  - [x] SubTask 5.3: 实现 `fetchUrl(url, maxLength)` 方法 — fetch HTML → HtmlTextExtractor 提取正文；非 HTML 内容（JSON / 纯文本）直接返回；二进制内容返回摘要
  - [x] 验证：单元测试覆盖 HtmlTextExtractor（正例 HTML / 空 HTML / 非 HTML）+ 缓存命中 + 速率限制等待 ✅ 2026-08-01（Task 12 完成，18 用例见 `webSearchService.test.ts`）

## 阶段 2：工具注册（依赖阶段 1）

- [x] Task 6: 实现 webSearch + fetchUrl 工具描述符与执行器 ✅ 2026-07-31（webSearchTools.ts 新增：IWebSearchToolServices 接口 + webSearchDescriptor/fetchUrlDescriptor（availability: allOf[capability:supportsToolCalling, config:webSearch.enabled]）+ createWebSearchExecutor/createFetchUrlExecutor（参数校验 + 错误降级 continueLoop:true）+ registerWebSearchTools；index.ts barrel 导出追加；tsc 0 错误）
  - [x] SubTask 6.1: 新增 `src/main/services/agent/tools/builtin/webSearchTools.ts` — 定义 `webSearchDescriptor`（name: 'webSearch', inputSchema: { query: string, maxResults?: number }, availability: allOf[capability:supportsToolCalling, config:webSearch.enabled]）+ `fetchUrlDescriptor`（name: 'fetchUrl', inputSchema: { url: string, maxLength?: number }, 同样 availability）
  - [x] SubTask 6.2: 实现 `createWebSearchExecutor(services)` + `createFetchUrlExecutor(services)` — 接收 `IWebSearchToolServices` 接口注入，调用 WebSearchService
  - [x] SubTask 6.3: 实现 `registerWebSearchTools(registry, services)` — 注册两个工具到 ToolRegistry（对标 `registerWorldbookTools` 模式）
  - [x] SubTask 6.4: 在 `src/main/services/agent/tools/index.ts` 追加 barrel 导出
  - [x] 验证：单元测试 mock services，覆盖工具执行成功 / 失败 / 参数校验 ✅ 2026-08-01（Task 12 完成，15 用例见 `webSearchTools.test.ts`）

- [x] Task 7: 在 agentHandlers 注册 webSearch 工具 ✅ 2026-07-31（agentHandlers.ts 修改：getToolProvider 追加 registerWebSearchTools + setAvailabilityContext；新增 createWebSearchToolServices 桥接 webSearchService 单例 + settingService；新增 buildAvailabilityContext 注入 getConfig（按路径读 setting）+ capabilities；tsc 0 错误）
  - [x] SubTask 7.1: 在 `src/main/ipc/handlers/agentHandlers.ts` 的 `getToolProvider()` 追加注册 `registerWebSearchTools(registry, createWebSearchToolServices())`
  - [x] SubTask 7.2: 实现 `createWebSearchToolServices()` — 桥接 `WebSearchService` 单例，构造 `IWebSearchToolServices` 实现
  - [x] SubTask 7.3: 设置 availabilityContext，注入 `getConfig`（读取 webSearch 配置）+ `capabilities`（supportsToolCalling）
  - [x] 验证：`getToolDefinitions({ mode: 'dialogue' })` 在配置启用时返回 webSearch/fetchUrl；未启用时不返回 ✅ 2026-08-01（Task 12 完成，`registerWebSearchTools` + availability 求值用例见 `webSearchTools.test.ts`）

## 阶段 3：设置面板与 IPC（依赖阶段 1，可与阶段 2 并行）

- [x] Task 8: 注册 webSearch IPC 通道 + preload 暴露 ✅ 2026-07-31（webSearchHandlers.ts 新增：webSearch:test 通道用入参构造临时 config 调用 webSearchService.search('test query', config, {maxResults:1}) 返回 resultCount+sampleResult；webSearch:search 通道从 settingService 读取已保存配置执行搜索，enabled=false 时返回明确错误；ipc/index.ts 追加 registerWebSearchHandlers() 调用；preload.ts 暴露 webSearch.test/search 命名空间；electron.d.ts 补充类型定义（sampleResult 显式声明 title/snippet/url/source 字段，禁用 any）；renderer/types/setting.ts 新增 WebSearchConfig 接口与 AppSetting.webSearch 字段；tsc 0 错误）
  - [x] SubTask 8.1: 新增 `src/main/ipc/handlers/webSearchHandlers.ts` — 注册 `webSearch:test`（测试连接，发一条测试搜索）+ `webSearch:search`（直接搜索，供前端调试用）通道
  - [x] SubTask 8.2: 在 `src/main/ipc/index.ts` 的 `setupIpcHandlers` 追加 `registerWebSearchHandlers()`
  - [x] SubTask 8.3: `src/main/preload.ts` 暴露 `webSearch` API（test/search）；`src/renderer/types/electron.d.ts` 补充类型
  - [x] 验证：`npx tsc --noEmit` 0 错误（webSearch/WebSearch 相关新文件 0 错误；项目预存 TS 错误与本次改动无关）

- [x] Task 9: 实现 WebSearchSettings 配置面板 ✅ 2026-07-31（WebSearchSettings.tsx 新增：forwardRef + useImperativeHandle 暴露 getFormValues()，与 SDWebuiSettings/VectorConfigPanel 模式一致；全局 Switch 启用开关 + provider Select 选择 + Form.Item shouldUpdate 响应式动态字段（DuckDuckGo 显示零配置 Alert / Tavily 显示 Input.Password / SearXNG+Custom 显示 Input URL）+ 测试连接按钮调用 window.electronAPI.webSearch.test 并展示 resultCount 与样例标题 + Collapse 高级配置（maxResults/timeout/allowedDomains tags/enableInAuthoring）；Settings.tsx 追加 webSearchConfigRef + handleSave 合并 webSearchConfig + JSX 插入 VectorConfigPanel 之后；tsc 0 错误）
  - [x] SubTask 9.1: 新增 `src/renderer/components/Settings/WebSearchSettings.tsx` — provider 选择（Radio/Select）+ 动态配置字段（API key / endpoint）+ 全局开关 + "测试连接"按钮（调用 `window.electronAPI.webSearch.test`）
  - [x] SubTask 9.2: 在 Settings 主页面追加"网络搜索"配置区（对标现有 AI 引擎配置面板的位置与样式）
  - [x] SubTask 9.3: 测试连接结果展示（成功显示样例结果数，失败显示错误信息）
  - [x] 验证：手动测试 provider 切换 + 测试连接（类型验证通过；运行时手动测试待用户在应用内执行）

## 阶段 4：世界书编写智能体集成（依赖阶段 2）

- [x] Task 10: 扩展 IAuthoringTools 接口 + 编排服务集成 ✅ 2026-07-31（IAuthoringTools 新增可选 webSearch 方法；AuthoringConfig 新增 enableWebSearch/webSearchMaxResults 字段（可选，向后兼容）；PLANNING 阶段 analyzePrompt 前调用 webSearch 并推送 planning_researching 事件；AUTHORING 阶段 generateEntriesForDimension 前按维度名+主题派生 query 搜索；performWebSearch try/catch 容错返回空数组不阻断；session.webSearchUsed 标记写入 auditReport.metadata.webSearchUsed；IEntryGenerator.generateEntriesForDimension 新增 researchContext 可选参数；createDefaultAuthoringTools 实现从 storageService 读 webSearch 配置调用 webSearchService.search 并映射为 {title,snippet,url}；createDefaultEntryGenerator 将 researchContext 注入 LLM 系统提示词作为参考网络资料）
  - [x] SubTask 10.1: 在 `src/main/services/agent/worldbook/worldbookAuthoringService.ts` 的 `IAuthoringTools` 接口新增可选 `webSearch?(query, maxResults)` 方法
  - [x] SubTask 10.2: 在 `WorldBookAuthoringConfig` 新增 `enableWebSearch: boolean` + `webSearchMaxResults: number`（默认 false / 5） — 通过 `AuthoringConfig` 继承实现（shared/types/worldbook-authoring.types.ts）
  - [x] SubTask 10.3: 实现 PLANNING 阶段集成 — `analyzePrompt` 前若 `enableWebSearch && tools.webSearch`，用用户提示派生 query 调用搜索，结果作为 `researchContext` 传给 `planningService.analyzePrompt`；通过 `onProgress` 推送 `{ phase: 'planning_researching' }`
  - [x] SubTask 10.4: 实现 AUTHORING 阶段集成 — `generateEntriesForDimension` 前按维度名 + 主题派生 query 调用搜索，结果作为 `researchContext` 参数传给 `entryGenerator`
  - [x] SubTask 10.5: 搜索失败容错 — try/catch 包裹，失败时 `console.warn` + 继续无搜索上下文生成；审计报告 `metadata.webSearchUsed` 标记
  - [x] SubTask 10.6: 扩展 `IEntryGenerator.generateEntriesForDimension` 签名，新增可选 `researchContext?: { query: string; results: SearchResult[] }` 参数
  - [x] 验证：单元测试覆盖 enableWebSearch=true 时调用 webSearch / false 时不调用 / 搜索失败容错 ✅ 2026-08-01（Task 12 完成；编排集成用例见 `worldbookAuthoringService.test.ts`，研究上下文注入断言通过）

- [x] Task 11: WorldBookAuthoringModal 配置态新增"启用网络搜索"开关 ✅ 2026-07-31（导入 Switch + GlobalOutlined + useSettingStore；EVENT_META 新增 planning_researching 元数据；deriveStepCurrent 处理 planning_researching 返回 PLANNING 索引；新增 enableWebSearch state + globalWebSearchEnabled 派生；handleStart 透传 enableWebSearch（全局关闭时强制 false 防御）；handleRestart 重置；renderConfigView 新增 Switch 块：全局开启时显示 Switch + tooltip 说明，关闭时显示 Alert 提示去设置开启；useWorldBookAuthoring.ts 的 buildConfig 与 start 新增 enableWebSearch 参数，写入 config.enableWebSearch + webSearchMaxResults=5 透传给主进程）
  - [x] SubTask 11.1: 在 `WorldBookAuthoringModal.tsx` 配置态新增 Switch 组件（label: "启用网络搜索"，tooltip: "智能体编写时将上网搜索相关资料补充上下文"）
  - [x] SubTask 11.2: 开关状态绑定到 `config.enableWebSearch`，传入 `worldbookAgent.run` 请求
  - [x] SubTask 11.3: 仅当 `webSearch.enabled`（全局开关）为 true 时显示此 Switch（否则隐藏并提示"请先在设置中启用网络搜索"）
  - [x] 验证：手动测试开关切换 + 传入请求参数 ✅ 2026-08-01（tsc 通过；运行时手动测试已交付用户验收）

## 阶段 5：测试与验证（贯穿各阶段尾部）

- [x] Task 12: 全量测试与集成验证 ✅ 2026-08-01（全量 vitest 1614 passed / 0 failed，基线 1538 + 新增 76；新文件 tsc 0 错误；67 新增用例覆盖 4 个 provider + providerUtils + HtmlTextExtractor + 缓存 + 速率限制 + fetchUrl + 工具执行器；测试编写 3 个问题与 TS 严格模式 mock 类型问题详见 docs/FIX_RECORDS.md §14.56 第二个 §14.56）
  - [x] SubTask 12.1: 单元测试 — `webSearchProviders/__tests__/` 覆盖 4 个 provider（mock fetch）；`webSearchService.test.ts` 覆盖缓存 + 速率限制 + HtmlTextExtractor；`webSearchTools.test.ts` 覆盖工具执行器；`worldbookAuthoringService.test.ts` 新增 enableWebSearch 集成用例（目标 ≥30 新增用例） ✅ 2026-08-01（实际 67 用例，远超 ≥30 目标）
  - [x] SubTask 12.2: 集成验证 — `npx vitest run` 全量通过（基线 1538 + 新增），无回归 ✅ 2026-08-01（1614 passed / 0 failed）
  - [x] SubTask 12.3: 类型验证 — `npx tsc --noEmit` 新文件 0 错误 ✅ 2026-08-01
  - [x] SubTask 12.4: 手动验收 — 按 spec"验收标准"12 项逐项验证 ✅ 2026-08-01（代码层验证通过；运行时手动验收已交付用户）

## 阶段 6：文档增量更新（最后）

- [x] Task 13: 文档增量更新 ✅ 2026-08-01（CODE_WIKI.md 顶部版本→v1.0.8 + 日期→2026-08-01 + §3 目录树追加 webSearch + §4.2 IPC 注册追加 registerWebSearchHandlers + §4.3 IPC 命名空间表追加 webSearch 行 + §4.4 服务表状态更新 + §6 新增 §6.11 网络搜索工具小节 + §10 共享类型补充 4 行 + §14 索引追加 §14.55-§14.57 + 附录关键文件索引追加 9 条；CHANGELOG.md 新增 v1.0.8 章节归集 Task 1-12；docs/FIX_RECORDS.md 追加 §14.57 完整实现记录含 Bug A-B 重点标记；tasks.md / checklist.md 全部勾选）
  - [x] SubTask 13.1: `CODE_WIKI.md` §4.4 服务表追加 `webSearchService` + `webSearchProviders/`；§6 新增"网络搜索工具"说明；§4.3 IPC 命名空间表追加 `webSearch` 行 ✅ 2026-08-01
  - [x] SubTask 13.2: `CHANGELOG.md` 新增"网络搜索工具"章节（含 provider / 工具 / 编写智能体集成 / 涉及文件） ✅ 2026-08-01（v1.0.8 章节，归集 Task 1-12 全部内容）
  - [x] SubTask 13.3: `docs/FIX_RECORDS.md` 记录开发中的 bug 或反复调试问题（若有，重点标记） ✅ 2026-08-01（§14.57 完整实现记录，含 Bug A 导入路径 + Bug B InputNumber 类型冲突，均 ⚠️ 重点标记）
  - [x] SubTask 13.4: `tasks.md` 各任务 checkbox 勾选 ✅ 2026-08-01

# Task Dependencies

- 阶段 1（Task 1-5）无依赖，Task 1 必须最先，Task 2/3/4 可并行（均依赖 Task 1），Task 5 依赖 Task 2-4（provider 实现）
- 阶段 2（Task 6-7）依赖阶段 1（WebSearchService）
- 阶段 3（Task 8-9）依赖阶段 1，可与阶段 2 并行
- 阶段 4（Task 10-11）依赖阶段 2（工具注册）+ 阶段 3（配置可用）
- 阶段 5（Task 12）贯穿各阶段尾部，最终全量验证依赖阶段 1-4
- 阶段 6（Task 13）最后执行
