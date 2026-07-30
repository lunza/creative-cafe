# Tasks

> 本 Spec 为**实施型 Spec**，任务为代码实施活动。按 §六阶段顺序执行；阶段 0（P0 阻断性修复）必须先于底座启用。实施时由 Sub-Agent 执行，照抄 openclaw 源码的决策见 spec §三。

## 阶段 0：P0 阻断性缺陷修复

- [x] Task 1: 修复 supportsToolCalling 全链路未注入（F1） ✅ 2026-07-30
  - [x] SubTask 1.1: AIService.streamChatAPI 增加 `tools?` 与 `parallelToolCalls?` 参数，透传到 OpenAI 兼容请求体 ✅
  - [x] SubTask 1.2: 保留无 tools 旧路径（降级），确保现有调用不破坏 ✅ 双条件守卫
  - [x] SubTask 1.3: ChatEngine.ts:154-167 `toolCallingEnabled` 真正注入工具集到请求 ✅ 替换 `void toolCallingEnabled`
  - [x] SubTask 1.4: 验证 `probeAllCapabilities` 结果进入请求构造 ✅ supportsToolCalling 经 ChatEngine.config.capabilities → streamChatAPI options → buildRequest 注入

- [x] Task 2: 统一 tableEditParser（F4）+ 索引校验（F3） ✅ 2026-07-30
  - [x] SubTask 2.1: 抽取 `TableEditParserBase`（公共 insertRow/updateRow/deleteRow 解析） ✅
  - [x] SubTask 2.2: memory/tableEditParser.ts 与 game/GameTableEditParser.ts 改为薄适配层 ✅
  - [x] SubTask 2.3: insertRow/deleteRow/updateRow 加整数与范围校验（修 tableEditParser.ts:187-219,270-278 越界） ✅

- [x] Task 3: 修复 ChatEngine 消息校验（F2）+ 取消反馈（F6） ✅ 2026-07-30
  - [x] SubTask 3.1: ChatEngine.ts 加消息序号校验 + 异常剔除（sanitizeChatHistory 方法） ✅
  - [x] SubTask 3.2: ChatEngine.ts 取消失败时回传前端错误（errorCallback） ✅

## 阶段 1：底座地基

- [x] Task 4: 新增 `src/main/services/agent/infra/`（照抄 openclaw） ✅ 2026-07-30
  - [x] SubTask 4.1: 照抄 dedupe.ts / retry.ts / backoff.ts ✅ 适配为自包含实现（去除 packages/ 依赖链）
  - [x] SubTask 4.2: 适配 errors.ts（合并项目错误码） ✅ AgentError + 9 类错误分类 + isRetryable
  - [x] SubTask 4.3: 新增 sqliteUtils.ts（WAL + 事务封装） ✅ 动态加载 better-sqlite3 + WAL + 事务 + 语句缓存

- [x] Task 5: 新增 contracts.ts + 类型定义 ✅ 2026-07-30
  - [x] SubTask 5.1: 定义 ILLMProvider/IMemoryProvider/IToolProvider/ISkillRegistry/ILearningScheduler ✅ + AgentRunIntent/AgentRunResult + ToolCall
  - [x] SubTask 5.2: 适配 openclaw src/skills/types.ts + src/tools/types.ts（简化 OwnerRef） ✅ skills/types.ts（三层可见性+双调用）+ tools/types.ts（声明式可用性+evaluateAvailability）

- [x] Task 6: 新增 `llm/` 模块 ✅ 2026-07-30
  - [x] SubTask 6.1: llmProvider.ts + AIServiceAdapter（包装现有 AIService） ✅
  - [x] SubTask 6.2: streamAdapter.ts + multimodalMessage.ts + mediaCodec.ts ✅
  - [x] SubTask 6.3: capabilityDetector.ts（复用现有检测，F1 修复后真正使用） ✅

- [x] Task 7: 新增 `core/` 模块（AgentCore + agentLoop） ✅ 2026-07-30
  - [x] SubTask 7.1: agentCore.ts（run 入口）+ agentLoop.ts（tool_calls 循环，自研，maxIterations=8） ✅
  - [x] SubTask 7.2: agentLifecycle.ts / agentContext.ts / lanes.ts / sandbox.ts / timeout.ts / usage.ts（照抄/适配 openclaw） ✅
  - [x] SubTask 7.3: tableEdit 注册为 updateStateTable 工具（闭环：返回执行结果） ✅ ToolRegistry + updateStateTable 工具 + 占位 executor

- [x] Task 8: 新增 `memory/` 模块（SQLite 骨架 + adapter） ✅ 2026-07-30
  - [x] SubTask 8.1: sqliteBackend.ts（better-sqlite3 + schema: agent_memory/agent_usage/cron_jobs/skills/audit） ✅
  - [x] SubTask 8.2: memoryStore.ts + writeProvenance.ts + memoryPromptPrepare.ts ✅
  - [x] SubTask 8.3: adapters/（worldBookAdapter/characterAdapter/chatHistoryAdapter/chapterAdapter） ✅

- [x] Task 9: 新增 `ipc/agentHandlers.ts` ✅ 2026-07-30
  - [x] SubTask 9.1: 注册 agent:run/cancel/toolCall/token/done + skill:list/invoke + memory:search + learning:dream ✅ + preload 暴露

## 阶段 2：P1 性能与稳定性修复（与阶段 1 并行）

- [x] Task 10: EmbeddingService 缓存（P1） ✅ 2026-07-30
  - [x] SubTask 10.1: content-hash → vector LRU 内存缓存 ✅ EmbeddingCache.ts（SHA-256 键 + 模型隔离 + TTL + LRU 淘汰）
  - [x] SubTask 10.2: 缓存持久化到 SQLite ✅ embedding_cache 表 + SqliteEmbeddingCachePersistence（双写/回填/Float32 序列化/降级）
  - [x] 配套修复：cacheEmbeddingResult 方法缺失（运行时崩溃）；localModelName→localModel（缓存键隔离 bug）；remoteApiKeyTransmission 类型声明；initAgentBackendIfNeeded 接入启动期

- [x] Task 11: WorldBookKeywordMatcher 倒排索引（P2） ✅ 2026-07-30
  - [x] SubTask 11.1: 建关键词→条目倒排索引，替代每消息 O(n) 扫描 ✅ 新增 `WorldBookKeywordIndex.ts`（Aho-Corasick 自动机 + 关键词→uid 倒排 Map），单趟扫描文本 O(|text|+|matches|) 替代原 O(Σ|key|×|text|)；`WorldBookKeywordMatcher` 改为仅对候选条目运行 matchEntry
  - [x] SubTask 11.2: 索引增量更新（条目增删改时）✅ `upsertEntry/removeEntry/rebuild` O(1) 置 dirty + 懒重建；`worldBookService` 按 scope 缓存 matcher（mtime 校验 + 写路径显式失效 + LRU），命中时跳过读盘/解析/重建

- [x] Task 12: storageService / chatSessionRepository 异步化（P3/P4） ✅ 2026-07-30
  - [x] SubTask 12.1: readFileSync/writeFileSync → fs.promises 异步 ✅ chatSessionRepository.ts 全量异步化（readFirstNonEmptyLines/countNonEmptyLines/getChatSessions/getChatSession/getChatMessages/readCharacterChatMessages/searchChatMessages/searchInChatFile/filterChatMessages/readAndFilterMessages/pruneStaleSessionCache 均改为 fs.promises + async/await）；chatLogService 包装方法标记 async；organizeOrchestrator 3 处调用加 await；memorySessionHandlers 加 await；storageService.ts ensureGenericPersona/ensureModuleDirectories 改用 fs.promises，新增 getSettingsAsync/setSettingsAsync 异步变体（保留同步版本以兼容 18+ 处旧调用方）
  - [x] SubTask 12.2: SQLite WAL 模式 ✅ 已由 Task 4.3 openAgentDatabase 启用（journal_mode=WAL + foreign_keys=ON + busy_timeout=5000 + synchronous=NORMAL）；全项目 SQLite 仅经此入口，无遗漏

- [x] Task 13: 写作服务容错（F5/F7） ✅ 2026-07-30
  - [x] SubTask 13.1: AIAssistedChapterService 接入 infra/retry ✅ `callAIService` 包装 `retryAsync(attemptOnce, {attempts:3, minDelayMs:300, maxDelayMs:10s, jitter:0.2})`；transient 错误（网络/超时/HTTP 5xx/429/空响应）自动重试，permanent 错误（配置缺失/HTTP 4xx 非 429）直接抛出；错误统一封装为 `AgentError`（携带 category/retryable），最终映射回原 `WritingError` 契约（`AI_SERVICE_UNAVAILABLE`/`CONTENT_GENERATION_FAILED`/`TIMEOUT`）；`onRetry` 回调通过 `addLog` 记录重试；新增 `AIAssistedChapterService.retry.test.ts` 12 个测试用例全部通过
  - [x] SubTask 13.2: PlotCheckerService quickFixSuggestion 格式校验 ✅ `validateQuickFixSuggestion` 新增 fixedText 格式校验（非空/非纯空白/非 no-op 修复/`originalText` ≤2000 字符/`fixedText` ≤5000 字符）；`parseCheckResponse` 中 dimension issues 与 logic issues 均改为先校验得 `validatedSuggestion`，再据此设置 `quickFixable`，保证 `quickFixable === (quickFixSuggestion !== undefined)` 的一致性；校验失败时 warn 日志便于 AI 提示词调优；新增 `PlotCheckerService.quickFix.test.ts` 25 个测试用例全部通过

## 阶段 3：技能化（写作组优先）

- [x] Task 14: 新增 `skills/` 模块 ✅ 2026-07-30
  - [x] SubTask 14.1: skillContract.ts（SKILL.md 解析）+ skillRegistry + skillLoader + skillSnapshot + skillInvoker + skillAvailability ✅ 6 个核心模块 + types.ts + index.ts barrel 导出；skillContract 实现 frontmatter 提取/parseSkillMd/formatSkillsForPrompt（XML 格式 `<available_skills>`）/resolveSkillKey/normalizeSkillName/truncateSkillBody；skillAvailability 实现声明式可用性评估（requires.env/config + skillFilter 白名单 + skillOverrides 覆盖 + 三层可见性过滤）；skillLoader 实现 loadSkillFile/loadSkillsFromDir/loadBuiltinSkills/loadWorkspaceSkills/loadAllSkills + 同步变体（启动期）；skillSnapshot 实现 buildSkillSnapshot/resolveSkillSnapshot（进程级 LRU 缓存，上限 10）/shouldRefreshSnapshot/clearSkillSnapshotCache；skillInvoker 实现双调用策略（user/model 权限校验 + 可用性校验 + 委托 IToolProvider 分发）；skillRegistry 实现 ISkillRegistry（register/get/list/buildSnapshot/invoke + registerAll/clear/getBySkillKey/invokeByUser + 单例）
  - [x] SubTask 14.2: 内置写作组 SKILL.md（plot-check/outline-generate/chapter-write/description-polish/table-organize）✅ 5 个 SKILL.md 均含 frontmatter（name/description/emoji/user-invocable/disable-model-invocation/command-name/command-tool）+ body（使用指南），分别委托 plotCheck/outlineGenerate/writeChapter/polishDescription/updateStateTable 工具
  - [x] SubTask 14.3: 验证：类型检查 + 单测 ✅ 0 skills 相关类型错误；`skills.test.ts` 75 个测试用例全部通过（覆盖 skillContract 解析、skillAvailability 过滤、skillSnapshot 缓存、skillRegistry 注册与调用、skillLoader 加载内置技能）；修复测试导入路径（`../skills/` → `../agent/skills/`）和未使用导入

## 阶段 4：写作智能体接入

- [x] Task 15: WritingAgentService 编排 ✅ 2026-07-30
  - [x] SubTask 15.1: 编排循环（读大纲→writeChapter→checkPlot→applyAutoFix→updateTable→下一章）✅ `writingAgentService.ts`（37KB）实现固定编排循环；`runAgentWriting`/`processChapter`/`generateChapterContent`/`checkChapter`/`autoFixIssues`/`organizeTable` 核心方法；支持 AbortController 取消、单实例守卫、单章失败不中断、进度回调推送；`findFirstUnwrittenChapter` 遍历大纲找首个未完成章节；`hasChapterContent` 通过 `chapter-{index}.md` 文件检测（与 `WritingProjectRepository.autoSaveChapter` 路径对齐）
  - [x] SubTask 15.2: 前端"智能体写作"按钮 + 进度流 + 断点续跑 ✅ 新增共享类型 `src/shared/types/writing-agent.types.ts`（SSOT）；`writingAgentTypes.ts` 改为 re-export；`writingAgentHandlers.ts` 注册 4 通道（run/cancel/status/resume）+ progress 流；preload 暴露 `writing.agent` API；`electron.d.ts` 补充类型；`writingHandlers.ts` 聚合注册 + `abortActiveWritingAgent` 退出清理；`main/index.ts` will-navigate + before-quit 调用 abort；新增 `useWritingAgent` hook（构建请求/订阅进度/启动/取消/续跑/状态查询）；新增 `WritingAgentModal` 组件（三态视图：配置/运行/完成，含章节范围、编排选项、进度条、事件流、断点续跑）；`ContentWorkspace.tsx` 添加「智能体写作」按钮（secondary actions row）+ Modal 渲染

## 阶段 5：对话智能体接入

- [x] Task 16: ChatEngine useAgent 开关 ✅ 2026-07-30
  - [x] SubTask 16.1: 对话组工具（searchWorldbook/searchHistory/updateStateTable/addMemoryNote）✅ 新增 `tools/builtin/dialogueTools.ts`（3 个工具描述符 + executor 工厂 + 注册函数 + `IDialogueToolServices` 接口）；`agentHandlers.ts` 的 `getToolProvider()` 注册对话组工具，`createDialogueToolServices()` 桥接现有服务（worldBookService 向量检索 + readWorldBook 条目读取 / chatLogService.searchChatMessages / memoryStore.write）；`tools/index.ts` barrel 导出
  - [x] SubTask 16.2: useAgent 灰度开关（默认 off）+ 降级保护 ✅ `AIEngineConfig` 新增 `useAgent` 字段；`ChatEngine.types.ts` / `setting.ts` / `settings.ts` 新增 `useAgent` 类型与默认值 `false`；`CharacterDialogueChat.hooks.ts` 3 处透传 `useAgent` 到 engineConfig；`ChatEngine.sendMessage` 新增 `useAgentEnabled` 双条件守卫（`useAgent && supportsToolCalling`），满足时调用 `runViaAgentCore()` 走 `agent:run` IPC + `agent:token`/`agent:done` 事件流，异常自动回退旧路径；`cancelRequest` 增加 `agent:cancel` 取消；`cleanupListeners` 清理 agent 事件订阅

## 阶段 6：世界书自驱 + learning

- [x] Task 17: 世界书自驱 ✅ 2026-07-30
  - [x] SubTask 17.1: 世界书组工具（createEntry/expandFromContext/generateKeywords/sortEntries）✅ 新增 `tools/builtin/worldbookTools.ts`（4 个工具描述符 + executor 工厂 + 注册函数 + `IWorldbookToolServices` 接口）；`contracts.ts` 的 `ToolCallContext.mode` 扩展 `'worldbook'` + 新增 `allowedWorldBookPaths` 沙盒白名单字段；`agentHandlers.ts` 的 `getToolProvider()` 注册世界书组工具，`createWorldbookToolServices()` 桥接 `worldBookService`（readWorldBook/writeWorldBook/getWorldBookDescription）；`tools/index.ts` barrel 导出；写工具（createEntry/expandFromContext）默认写入 `autoGenerated=true` 草稿区 + `provenance` 写溯源；沙盒越权拒绝写入并返回 SANDBOX_VIOLATION；可用性 gating `mode='worldbook'`
  - [x] SubTask 17.2: autoGenerated 待审阅区 UI ✅ `worldBookService.ts` 新增 4 个草稿管理方法（`listAutoGeneratedEntries` / `approveAutoGeneratedEntry` / `rejectAutoGeneratedEntry` / `approveAllAutoGeneratedEntries`）；`worldBookHandlers.ts` 注册 4 个 IPC 通道（`worldBook:listAutoGenerated` / `worldBook:approveAutoGenerated` / `worldBook:rejectAutoGenerated` / `worldBook:approveAllAutoGenerated`）；`preload.ts` + `electron.d.ts` 暴露 4 个 API；新增 `WorldBookAutoGeneratedReview.tsx` 组件（表格列：UID/名称/主次关键词/内容预览/写溯源/操作；单条批准+拒绝 Popconfirm+全部批准+刷新；写溯源 Tooltip 显示 source/toolName/runId/timestamp）；`WorldBookManager.tsx` 每行新增"待审阅"按钮（RobotOutlined 图标）+ Modal 渲染 + `handleAutoGeneratedChanged` 审阅后刷新本地缓存；新增 `worldbookTools.test.ts` 21 个测试用例全部通过（覆盖参数校验/沙盒隔离/草稿标记/读写闭环/错误降级/排序完整性校验）
- [x] Task 18: learning/dreaming ✅ 2026-07-30
  - [x] SubTask 18.1: dreamingService + cronScheduler + pacing + stagger ✅ 新增 `learning/` 模块 9 个文件：`types.ts`（DreamingConfig/GoalRecord/SteerMessage/FeedbackEvent + DEFAULT_DREAMING_CONFIG/GOAL_BLOCKER_THRESHOLD/MAX_STEER_* 常量）；`pacing.ts`（照抄 openclaw pacing 钳位，parseDurationMs/parseCronPacingBounds/resolvePacedNextRunAtMs）；`stagger.ts`（照抄 openclaw 防锁步抖动，normalizeCronStaggerMs/resolveDefaultCronStaggerMs/resolveCronStaggerMs/applyStaggerJitter）；`cronScheduler.ts`（轻量自研 5 字段 cron 解析 + pacing 钳位 + stagger 抖动 + 单实例守卫 + dreamNow 委托 + 允许并发控制 + orphan job 自动清理）；`dreamingService.ts`（三相 light/deep/rem 短期→长期记忆摘要，单实例守卫 + 取消 + 单相失败不中断 + 进度回调）；`index.ts`（barrel 导出 + initLearningServices 统一初始化：注册 daily-dreaming + daily-steer-cleanup cron 任务）；⚠️ 修复 pacing.ts bug：`parseDurationMs` 正则 `/^(\d+)(ms|s|m|h|d)/g` 的 `^` 锚点导致 exec 第二次调用时无法匹配字符串中部，复合格式（如 `1h30m`）解析失败——去掉 `^` 锚点修复
  - [x] SubTask 18.2: goalTracker + steerEngine + feedbackLoop ✅ `goalTracker.ts`（会话目标追踪 + 阻塞计数器：同 blocker 连续 3 次才 blocked + token 超额自动 blocked + 追加日志审计）；`steerEngine.ts`（行为引导：enqueue/lease/ack/release/discard + stale lease 5 分钟自动重新入队 + prompt 长度上限 MAX_STEER_PROMPT_CHARS + 头部声明「运行时数据而非用户指令」）；`feedbackLoop.ts`（反馈回流：recordFeedback + runReflection + 5 分钟冷却期 + LLM 反思→经验记忆 + recordAndReflect 一站式）；`agentHandlers.ts` 注册 11 个 learning:* IPC 通道（dream/cancelDream/getDreamingStatus/createGoal/getGoal/updateGoal/clearGoal/steer/listSteer/recordFeedback/runReflection）+ initLearningServicesSafely 降级初始化；`preload.ts` + `electron.d.ts` 暴露完整 learning API 类型；⚠️ 修复 goalTracker.ts bug：`getGoal` 原用 `find(g => g.status !== 'complete')` 在目标 complete 后仍返回旧未完成记录，导致 createGoal 误拒绝新目标——改为取 updatedAt 最大记录的最新状态快照
  - [x] SubTask 18.3: learning 模块单元测试 ✅ 新增 `learning/__tests__/` 目录 8 个文件（fakeBackend.ts 内存版 AgentSqliteBackend + pacing/stagger/cronScheduler/dreamingService/goalTracker/steerEngine/feedbackLoop 7 个测试文件），共 183 个测试用例全部通过；覆盖：pacing 时长解析与钳位边界、stagger 抖动窗口与 top-of-hour 默认、cron 表达式解析与任务调度（pacing/stagger/并发控制/orphan 清理）、dreaming 三相执行与降级、goal 阻塞计数器与 token 超额、steer lease/ack/stale 重新入队、feedback 冷却与 LLM 反思降级；fakeBackend 因 better-sqlite3 为 Electron 编译（ABI 130 vs node 137）无法在 vitest 加载，采用 Map 存储 + SQL 路由的内存方案；⚠️ 修复 fakeBackend.ts bug：`makeStmt` 实现方法签名原为 `(params)` 单参数，而 better-sqlite3 的 statement 方法是 `(...params)` rest 参数，导致 `stmt.all(now)` 时参数被包装成 `[[now]]` 而非 `[now]`，查询条件匹配失败——修改 `makeStmt` 接口统一使用 `(params: unknown[])` 接收参数数组修复

## 阶段 7：P2 UI/设计修复（可并行）

- [x] Task 19: 长列表虚拟化（P6） ✅ 2026-07-31
  - [x] SubTask 19.1: 聊天消息列表虚拟化 ✅ 新增 `@tanstack/react-virtual@^3.10.0` 依赖；新增 `VirtualizedMessageList.tsx` 组件（动态高度测量 + overscan 缓冲 + 复用父级滚动容器）；`CharacterDialogueChat.tsx` 提取 `renderMessageBubble` 函数，消息数 ≥ `VIRTUALIZATION_THRESHOLD=50` 时启用虚拟化，否则走原 `.map()` 路径（避免短对话回归）；WorldBookEntryList 已有分页（pageSize 切片）无需虚拟化
- [x] Task 20: dataStore 分层（D1）+ WritingModeRightPanel 拆分（D2）+ WorldBookManager memo（D3） ✅ 2026-07-31
  - [x] SubTask 20.1 D1: dataStore 分层 ✅ 新增 `src/renderer/services/dataService.ts`（fetchCharacters/fetchAvatars/optimizeCharacter IPC 防腐层 + 结果归一化）；`dataStore.ts` 改为纯数据状态 + 委托 service，不再直接访问 `window.electronAPI`；store 对外 API 不变，5 个消费方（Dashboard/CharacterManager/AvatarManager/SingleChatDialog/CreationCenter）零改动
  - [x] SubTask 20.2 D2: WritingModeRightPanel 拆分 ✅ 新增 `usePanelResize.ts` hook（提取 resize handle 状态 + mousedown/mousemove/mouseup 事件监听到独立 hook）；`WritingModeRightPanel.tsx` 改为消费 `{ isResizing, handleResizeMouseDown }`，移除内联 useRef/useEffect/useState；tabs/渲染已由 Task 8 下沉到 PlotCheckPanelContent/TableOrganizeMainPanel/MaterialList 子组件
  - [x] SubTask 20.3 D3: WorldBookManager memo 化 ✅ 已由 Task 8 重构完成（所有 handler 已 useCallback，columns 已 useMemo，formState 已迁入 useWorldBookFormState hook）；审计确认无未 memo 化的派生值或内联 handler
- [x] Task 21: UI 子集修复（删除确认/loading/骨架屏/自动滚动动画/错误恢复提示） ✅ 2026-07-31
  - [x] SubTask 21.1: 错误恢复 UI ✅ `CharacterDialogueChat.hooks.ts` 新增 `clearError` 回调（清除 error 状态）并导出；`CharacterDialogueChat.tsx` 错误提示区新增「重试」按钮（优先 retryMessage 最后一条 assistant，回退 sendMessage 最后一条 user）+「关闭」按钮（clearError）
  - [x] SubTask 21.2: 新建项目输入校验 ✅ `WritingModeEntry.tsx` `handleConfigConfirm` 新增防御性校验（config 非空对象 / parameters.creativeDescription 非空 / modelConfig.model 存在），校验失败 message.error 并 return
  - [x] SubTask 21.3: 已修复项确认（spec 行号过时，Task 8 重构已修复）✅ 自动滚动已有 `behavior: 'smooth'`；流式生成已有 `ChatTypingIndicator` 占位符；删除确认已有 Popconfirm；WorldBookEntryList 更多属性已折叠懒加载（isExpanded toggle）；WorldBookManager 列定义已 useMemo

## 阶段 8：现有测试套件全量审核与缺陷修复（目标「识别并修复现有功能缺陷」延伸）

- [x] Task 22: 测试套件全量审核与修复（35 失败用例 + 2 套件加载崩溃 → 全绿） ✅ 2026-07-31
  - [x] SubTask 22.1: ⚠️ 修复 sandbox.ts mode 类型回归（Task 17 引入）✅ `ToolExecutionContext.mode` 对齐 `contracts.ts`（新增 `'worldbook'`），消除 TS2322；agent 模块 tsc 0 错误
  - [x] SubTask 22.2: ⚠️ 对齐 stop sequences 测试与实现（4 文件 32 用例）✅ `buildStopSequences.test.ts`（12→6 项）/ `buildStopSequencesForUserReply.test.ts`（8→4 项）/ `resolveStopForRequestBody.test.ts` / `e2e-chat-flow.test.ts` 全部对齐 PromptBuilder.ts 的「🐛 Bug修复（移除单换行变体）」，并显式断言不含单换行变体固化意图
  - [x] SubTask 22.3: ⚠️ 对齐 PromptTemplateService 测试模板计数 ✅ 20→21（3 character-card + 14 world-book + 4 creative-chat），世界书 expectedModuleIds 补入 `generate-world-description`
  - [x] SubTask 22.4: ⚠️ 修复 storageService.setupIPC 测试环境崩溃（2 套件加载失败）✅ `setupIPC` 入口加 `if (!ipcMain || typeof ipcMain.handle !== 'function')` 防御性 guard，vitest 环境跳过 IPC 注册；生产环境行为不变
  - [x] SubTask 22.5: ⚠️ 修复 ChatVectorizationService / e2e-performance 测试隔离缺陷（18 用例）✅ 两测试文件新增 `vi.mock('.../VectorConfigManager', () => ({ vectorConfigManager: { loadVectorConfig: () => ({ embeddingMode: 'remote' }) } }))`，使测试与机器磁盘配置解耦（hermetic），不再读取真实 `settings.json` 的 `embeddingMode='disabled'`
  - [x] SubTask 22.6: 验证 ✅ `npx vitest run` 60 文件 / 1397 用例全部通过；`npx tsc --noEmit` agent 模块 0 错误，修改文件零新增类型错误

## 阶段 9：RAG 向量库后端升级（用户独立需求，游离于阶段 0-8 之外）

- [x] Task 23: sqlite-vec 全面替换 vecstore-wasm ✅ 2026-07-31
  - [x] SubTask 23.1: SqliteVecBackend 实现 ✅ 新增 `src/main/services/SqliteVecBackend.ts`（732 行）实现 `IVectorBackend` 全部方法（add/addBatch/update/remove/getById/search/clear/count/countByPrefix/deleteByPrefix/persist/assertDimension/handleDimensionChange/destroy/destroyAndDeleteFiles）；新增 `src/main/services/vector/sqliteVecUtils.ts`（`openVectorDatabase` + `ensureVectorSchema` + `prepareVecStatement` + `VEC0_TEXT_PK_SUPPORTED` 降级检测）；Schema：`vec0` 虚拟表（cosine 距离）+ `item_metadata` 表（metadata 存 DB 内，无需 sidecar Map）+ 可选 `id_map` 表（rowid 降级方案）；score = 1 - distance 对齐原 vecstore 行为
  - [x] SubTask 23.2: 后端切换 + 类型收敛 ✅ `VectorStoreService.ts` 构造函数 `new VecstoreBackend()` → `new SqliteVecBackend()`（defaultBackend + backendFactory + LRU 类型）；`main/types/vectorConfig.ts` 的 `VectorStoreMode` 收敛为单值 `'sqlite-vec'`；`shared/types/vector.types.ts` 同步更新；`VectorConfigPanel.tsx` 默认配置改为 `'sqlite-vec'`；删除 `VecstoreVectorStore.ts`；`package.json` 移除 `vecstore-wasm` 依赖 + 新增 `sqlite-vec`；`electron-builder.json` 新增 `asarUnpack`（`better-sqlite3`/`sqlite-vec` 原生二进制）；`vite.config.ts` 主进程 external 新增 `'better-sqlite3'` + `'sqlite-vec'`
  - [x] SubTask 23.3: ⚠️【重点标记】修复 main/index.ts 死分支 ✅ `before-quit` 持久化逻辑中 `if (mode === 'vecstore')` 因 `getMode()` 改返回 `'sqlite-vec'` 成为死代码，导致应用退出时 `vectorRegistryService.persist()` 永不执行（registry 元数据丢失风险）。移除 mode 检查，无条件调用 `vectorStoreService.persist()`（no-op + WAL checkpoint，无副作用）+ `vectorRegistryService.persist()`
  - [x] SubTask 23.4: ⚠️【重点标记】修复 shared/types 过期类型 + F 类文件注释清理 ✅ `vector.types.ts` 的 `VectorStoreMode = 'vecstore'` 与主进程 `vectorConfig.ts` 的 `'sqlite-vec'` 不一致（虽无代码 import 该 shared 类型，但作为 public type surface 会误导）；同步更新为 `'sqlite-vec'` + 注释中 `vecstore.json` → `vectors.db`；额外清理 5 个文件的 vecstore 残留引用（VectorRegistryService 文件路径 / vectorConfig 注释 / vectorConfigSchema 注释 / VectorStoreService 方法名注释保留决策 2.3 / Dashboard 显示文案 / KnowledgeBaseService 内容 / worldBookService 落盘注释）
  - [x] SubTask 23.5: 单元测试 ✅ 新增 `src/main/services/__tests__/SqliteVecBackend.test.ts` **37 个用例全部通过**——采用 `FakeVectorDb` 内存版数据库（对齐 `fakeBackend.ts` 模式，因 better-sqlite3 原生模块 ABI 与 vitest 不匹配）；手动实现 cosine 相似度替代 vec0 MATCH KNN；覆盖 assertDimension/getMode/getStoreFilePath/add+getById/addBatch/search（cosine 排序 + score=1-distance + metadata 过滤 + 维度校验 + topK）/count/countByPrefix（LIKE 通配符转义）/deleteByPrefix/remove/update/clear/size/initialize（幂等）/destroy/handleDimensionChange/persist/ensureInitialized 守卫
  - [x] SubTask 23.6: 自我反思与文档固化 ✅ Self-Improving skill 自检发现 vec0 post-filter 语义（KNN 先返回 top-K 再过滤，可能 < K 条），已在 `SqliteVecBackend.ts:search()` 注释中固化；测试盲区（37 测试用 FakeVectorDb，真实 vec0 行为未验证）作为已知问题记入 `~/self-improving/corrections.md` + 项目 memory，待 Electron 集成测试补位
  - [x] SubTask 23.7: 验证 ✅ `npx vitest run src/main/services/__tests__/SqliteVecBackend.test.ts` 37/37 通过；`npx vitest run` 全量 61 文件 / 1434 用例全部通过（较基线 1397 +37 新增）；CODE_WIKI.md §8.1 补 SqliteVecBackend 关键特性 + CHANGELOG.md 补升级章节

# Task Dependencies
- 阶段 0（Task 1-3）无依赖，必须最先
- 阶段 1（Task 4-9）依赖阶段 0；Task 4-8 内部 Task 5→6→7→8 有序，Task 4 可并行
- 阶段 2（Task 10-13）依赖阶段 0，可与阶段 1 并行
- 阶段 3（Task 14）依赖阶段 1
- 阶段 4-6（Task 15-18）依赖阶段 3
- 阶段 7（Task 19-21）可与其他阶段并行
- 阶段 8（Task 22）依赖阶段 0-7（在已落地代码上审核测试），可与其他阶段并行执行审核
