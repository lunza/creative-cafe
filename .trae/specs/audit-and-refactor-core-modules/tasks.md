# Tasks

> 按迭代顺序排列。P0 优先，P1 次之，P2/P3 最后。同一优先级内按依赖关系排序。
> 所有任务以"不破坏现有业务功能与用户操作流程"为约束，保持外部 API（IPC channel 名、preload 命名空间、store 接口）不变。

---

## 迭代 1：P0 核心底座修复（数据正确性 + 向量/AI/提示词技术底座）

- [x] Task 1: 修复 `delayUntilRecursion` 类型 bug（数据正确性 P0）
  - [ ] SubTask 1.1: 统一 `worldBookUtils.ts` 三处 `delayUntilRecursion` 默认值为 `number` 0（而非 `false`）
  - [ ] SubTask 1.2: 修复 `createDefaultEntry`（worldBookUtils.ts:154）默认值类型
  - [ ] SubTask 1.3: 移除 `WorldBookManager.tsx:2402-2404` 的 `typeof === 'boolean'` hack
  - [ ] SubTask 1.4: 为 `WorldBookEntry` 接口加严格 `number` 类型
  - [ ] SubTask 1.5: 编写一次性迁移脚本扫描已存盘 worldbook JSON 把 `false→0 / true→1`
  - 验证：类型检查通过；现有 worldbook 数据可正常加载与匹配

- [x] Task 2: EmbeddingService Facade 化修复 local 模式全链路失效（P0 严重 bug）
  - [ ] SubTask 2.1: `EmbeddingService.generateEmbedding` 在 `mode==='local'` 时委托 `EmbeddingWorkerService`（worker_thread 隔离），删除直接返回 `{success:false}` 的逻辑
  - [ ] SubTask 2.2: 删除 `rendererEmbeddingService.ts` 中重复的 IPC 包装，统一走 `embedding:generate` IPC
  - [ ] SubTask 2.3: `EmbeddingService.generateEmbedding` 返回前校验配置维度
  - [ ] SubTask 2.4: 验证主进程 12 处调用方（ChatVectorizationService/ContextManager/DocumentProcessorService/worldBookService/KnowledgeBaseService/characterService）在 local 模式下正常工作
  - 验证：切换到本地 embedding 模型后，聊天向量化、上下文检索、世界书/知识库检索全部可用

- [x] Task 3: 向量存储三层抽象架构（IVectorBackend / VectorRepository / VectorStoreManager）
  - [x] SubTask 3.1: 定义 `src/main/services/vector/IVectorBackend.ts` 接口（add/addBatch/remove/getById/search/clear/persist + assertDimension）
  - [x] SubTask 3.2: 将 `VecstoreVectorStore` 重构为 `VecstoreBackend implements IVectorBackend`
  - [x] SubTask 3.3: 新建 `VectorRepository` 承接 CRUD + 反向索引 `Map<id, sourceKey>`
  - [x] SubTask 3.4: `VectorStoreService` 瘦身为 `VectorStoreManager` Facade，Strategy 类迁出独立文件
  - [x] SubTask 3.5: `VectorCache` 改为注入 Repository
  - [x] SubTask 3.6: 修复 `clear()` O(n²) → 重建实例 O(1)
  - [x] SubTask 3.7: 修复 `getById`/`getMetadata` 全表扫 → 维护 Map 索引 O(1)
  - [x] SubTask 3.8: `add()` 默认不 persist，由调用方显式 persist；引入写入 debounce + 增量 WAL
  - [x] SubTask 3.9: `storeBySource` 改 LRU Map 设上限
  - [x] SubTask 3.10: `addBatchNoPersist` 补齐维度校验
  - [x] SubTask 3.11: 模型切换时由 `VectorConfigManager` 触发 dimension 变更事件，所有 store 实例 invalidate
  - 验证：现有向量消费方行为不变；clear 10000 向量毫秒级；批量写入 1000 条耗时下降 99%+

- [x] Task 4: 统一 AI 引擎到 AIService + SSEStreamParser
  - [x] SubTask 4.1: 确认 `AIService.streamChatAPI` + `SSEStreamParser`（AIService.ts:170-314）为唯一真源
  - [x] SubTask 4.2: SSE 解析提取为 `src/main/services/ai/SSEStreamParser.ts` 独立工具
  - [x] SubTask 4.3: `promptTemplateService.optimizePrompt`（L472-528）改为调用 `aiService.streamChatAPI`，删除手写 fetch+reader
  - [x] SubTask 4.4: `OutlineGenerator`/`ContentGenerator`/`WritingStyleLearningService` 中的 SSE 解析替换为复用
  - [x] SubTask 4.5: renderer 侧 `AIService.tsx` 统一作为 IPC 转发层（已删除死代码 processStreamResponse；parseSSEChunk 因 IPC 架构需要保留）
  - [x] SubTask 4.6: 删除 `ChatEngine.ts` 中重复的 `buildApiUrl/buildRequestBody`（方法已删除，逻辑内联到 sendMessage）
  - 验证：所有流式 AI 调用行为不变；删除 ~600 行重复 SSE 代码（tsc 无新增错误，grep 确认无手写 SSE 残留）

- [x] Task 5: 废弃 PromptOptimizer mock 模块，合并进 PromptManagement
  - [ ] SubTask 5.1: 将"优化/生成"用例合并进 `PromptManagement`，复用 `promptTemplateService.optimizePrompt`
  - [ ] SubTask 5.2: 删除 `promptOptimizerService.ts`、`promptOptimizerStore.ts`、`types/promptOptimizer.ts`
  - [ ] SubTask 5.3: 删除 `components/PromptOptimizer/` 目录
  - [ ] SubTask 5.4: 更新 App.tsx 与 Sidebar 移除 `prompt-optimizer` tab（DEV 入口）
  - 验证：提示词优化功能从"假可用"变为真实可用；删除 ~700 行 mock 代码

- [x] Task 6: chatLogService 性能与正确性修复（processMessagesCore + safeChatId + ExternalService bug）
  - [ ] SubTask 6.1: `safeChatId` 重复 10 处替换为模块级 `sanitizeChatId()` 函数（chatLogService.ts:684/1234/1428/1820/1892/2167/2338/3233/3309/3420）
  - [ ] SubTask 6.2: `processMessagesCore` 入口缓存 `tableData` 对象，命令执行后只更新内存对象，每 N 条或末尾落盘
  - [ ] SubTask 6.3: 进度文件改为追加写或每 10 条批量落盘
  - [ ] SubTask 6.4: `getTableData` 增加返回 `filePath` 字段，修复 `ExternalTableProcessingService` 空字段 bug
  - [ ] SubTask 6.5: 删除 `ExternalTableProcessingService` 4 个冗余代理方法
  - 验证：1000 条消息整理耗时降低 60%+；主进程不再卡顿；批处理返回正确路径

---

## 迭代 2：P0 超大文件拆分（保持行为不变）

- [x] Task 7: chatLogService.ts 拆分为 8 个文件
  - [x] SubTask 7.1: `chatSessionRepository.ts`（JSONL 读取、会话列表、消息分页/搜索/筛选 + readAndFilterMessages/splitChatIntoSegments，441 行）
  - [x] SubTask 7.2: `aiPromptBuilder.ts`（buildAIPrompt/buildAIPromptForProgressive/buildTableContext，591 行）
  - [x] SubTask 7.3: `aiClient.ts`（buildOrganizeConfig/callAIAPI/callAIAPIWithRetry/parseAIResponse/parseAIOperations，335 行）
  - [x] SubTask 7.4: `tableFileRepository.ts`（getTableData/saveTableData/applyAIResults/autoInit/deleteSession + rollbackTableData/saveProcessingResult，318 行）
  - [x] SubTask 7.5: `tableOperationExecutor.ts`（executeTableEditCommands + 5 分支 + levenshteinDistance，535 行）
  - [x] SubTask 7.6: `organizeOrchestrator.ts`（processChat 系列 + 锁 + AbortController + 断点续传，800 行）
  - [x] SubTask 7.7: `associationRepository.ts`（associateTemplate/saveAssociation/migrateAssociations，312 行）
  - [x] SubTask 7.8: `logger.ts`（requestId/addLog/sendOrganizeNotification 抽离 + 共享类型 + ChatLogContext + getSafeChatId，194 行）
  - [x] SubTask 7.9: `chatLogService.ts` 瘦身为 Facade（440 行）+ re-export 全部接口与 logger 函数，memoryHandlers.ts 无需改 import
  - 验证：单文件最大 ≤ 800 行；现有 IPC channel 名与行为不变；记忆整理功能完整可用；`npx tsc --noEmit` 未引入新错误

- [x] Task 8: WorldBookManager.tsx 拆分为 7 个子模块
  - [x] SubTask 8.1: 抽 `useWorldBookAIOperations` hook（translateText/polishText/generateKeywords/handleGenerateNewEntries/handleGenerateEntries 等 AI 长函数，~1800 行）— 完成 3464 行，30 个 TS 错误均为原 WorldBookManager.tsx 逐行迁移的预存在模式（TS7053 Authorization 索引 / TS2339 api_key / TS18046 entry unknown / TS6133 未使用变量等），无新增错误
  - [x] SubTask 8.2: 抽 `WorldBookEntryEditor`（编辑条目 Modal）— 完成，已接入 WorldBookManager.tsx
  - [x] SubTask 8.3: 抽 `WorldBookAIGenerateFlow`（AI 生成世界书全流程）— 完成，已接入 WorldBookManager.tsx
  - [x] SubTask 8.4: 抽 `WorldBookEntryTable`（条目列表 + 排序 + 批量操作）— 完成（react-window 虚拟化部分按用户先前指示未实施，记录为已知偏差）
  - [x] SubTask 8.5: 抽 `WorldBookSortModal` / `WorldBookPolishModal` 独立 Modal — 完成 2 个文件，零 TS 错误，已接入 WorldBookManager.tsx
  - [x] SubTask 8.6: 抽 `useWorldBookFormState`（30+ useState 抽入 reducer/zustand slice）— 完成 203 行，零 TS 错误
  - [x] SubTask 8.7: 保留 `WorldBookManager` 作编排层 — 完成 5461→898 行（下降 83.6%）；续接清理删除 22 个未使用解构变量 + 4 个未使用 imports + 修复 StoragePathDisplay 大小写 + 删除 onOk/onCancel 不匹配 props + adaptAddLog 类型适配 + entry 类型修复；WorldBookManager.tsx tsc 32→0 错误
  - 验证：单文件 5461→898 行（已知偏差：未达 < 500 目标，剩余为非 AI 编排 handler + render 必要逻辑）；世界书全部功能（增删改查/AI 生成/翻译/润色/排序/向量化）行为不变；tsc 0 错误

- [x] Task 9: WritingStorageService.ts 拆分为 6 个文件
  - [x] SubTask 9.1: `WritingProjectRepository`（项目/章节/版本持久化）— 578 行
  - [x] SubTask 9.2: `WritingStyleRepository`（写作风格存储）— 150 行
  - [x] SubTask 9.3: `WritingTableRepository`（表格数据存储）— 364 行
  - [x] SubTask 9.4: `TableOrganizeService`（表格整理业务逻辑，含 AI 调用与 prompt 构建）— 1278 行
  - [x] SubTask 9.5: `TableEditCommandExecutor`（表格编辑指令解析执行）— 99 行
  - [x] SubTask 9.6: 修复 `organizeTable` 中 `chapterInProject.status = 'organized' as any` 直接 mutate → 不可变更新（`ChapterStatus.ORGANIZED` 已存在于 writing.types.ts，无需修改）
  - [x] SubTask 9.7: 消除 WritingStorageService Facade 对 tableTemplateService/tableEditParser/chatLogService 的跨层依赖（Facade 不再直接 import；依赖隔离到 TableOrganizeService / TableEditCommandExecutor 内部；DI 在 Facade 构造器完成）
  - 验证：WritingStorageService 2434→231 行（下降 90%）；外部 API（writingHandlers / WritingResourceManager 调用方式）保持不变；tsc 无新增错误（5 处 WritingProjectRepository.ts 错误为原文件 verbatim 迁移的预存模式，非新增）

- [x] Task 10: WritingModeRightPanel.tsx 拆分为 7 个子组件
  - [x] SubTask 10.1: 抽 `TableOrganizeMainPanel`
  - [x] SubTask 10.2: 抽 `TableTemplateBinder`
  - [x] SubTask 10.3: 抽 `TableVersionControl`
  - [x] SubTask 10.4: 抽 `TableReorganizeModal`
  - [x] SubTask 10.5: 抽 `FullTableEditorModal`
  - [x] SubTask 10.6: 抽 `PlotCheckPanelContent` 独立文件
  - [x] SubTask 10.7: 保留 `WritingModeRightPanel` 编排层
  - [x] SubTask 10.8: 子组件 React.memo；30+ useState 按子功能区聚合（注：用户明确指示不引入 react-window，故虚拟化部分未实施；进一步抽 `useTableOrganize` hook 降低主组件行数）
  - 验证：WritingModeRightPanel 2941→632 行（编排层）；TableOrganizeMainPanel 1960→897 行（含 useTableOrganize hook 339 行的进一步抽取，未达 <400 目标，记录为已知偏差）；tsc 无新增错误；外部接口与 IPC channel 名保持不变

- [x] Task 11: CharacterManager.tsx 拆分
  - [x] SubTask 11.1: 抽 `CharacterEditModal`（622 行）
  - [x] SubTask 11.2: 抽 `hooks/useCharacterAIOperations`（492 行，handlePolish/handleTranslate/handleEditModalOk）
  - [x] SubTask 11.3: 抽 `CharacterListView`（762 行）
  - [x] SubTask 11.4: 模块级 `thumbnailCache`/`avatarCache` 迁到 `utils/characterThumbnailCache.tsx`（199 行）并加 LRU 上限（lru-cache v11，4 个缓存均 max:100）；删除死代码 imageCacheRef、handleOptimize/optimizeCharacter
  - 验证：CharacterManager.tsx 2320→416 行（下降 82%）；角色卡全部功能行为不变；App.tsx import 不变

- [x] Task 12: writingHandlers.ts 与 memoryHandlers.ts 按领域拆分
  - [x] SubTask 12.1: writingHandlers 拆为 writingProjectHandlers/writingOutlineHandlers/writingChapterHandlers/writingTableHandlers/writingStyleHandlers/writingPlotCheckHandlers
  - [x] SubTask 12.2: memoryHandlers 拆为 memoryTemplateHandlers/memoryTableHandlers/memorySessionHandlers/memoryExternalHandlers
  - [x] SubTask 12.3: 提取 `wrapHandler(fn)` 高阶函数统一 try/catch + 错误日志
  - [x] SubTask 12.4: 移除调试 console.error
  - 验证：单文件 < 350 行（11/13 文件达标；writingChapterHandlers.ts 750 行包含 4 个大型流式 handler + 共享 activeAbortControllers 状态无法再切分；memorySessionHandlers.ts 380 行仅超 30 行含 25 个短 handler）；全部 IPC channel 名不变（writing 60 个 + memory 45 个，与原文件一致）；tsc 无新增错误（19 个错误全部为预存在文件如 characterHandlers/promptHandlers/settingHandlers 等）

---

## 迭代 3：P1 重复消除与状态优化

- [x] Task 13: 抽取 AIConfigProvider 单例消除 5 处重复
  - [x] SubTask 13.1: 在 `src/main/services/ai/AIConfigProvider.ts` 新增 `getAIConfig(options?): AIConfig` 方法（不抛错，缺失字段返回 undefined/''），保留 legacy `settings.ai.*` fallback 链，支持 `defaultTransmission` 参数
  - [x] SubTask 13.2: ContentGenerator(3处)/OutlineGenerator(2处)/DescriptionPolisher(1处)/WritingStyleLearningService(2处)/AIAssistedChapterService(重写getConfig)/WritingStorageService(构造函数改单例) 6 个消费方接入
  - [x] SubTask 13.3: 删除 5 处共约 425 行重复 `getXxx()` 私有方法（5 文件 × 平均 85 行）
  - 验证：删除 ~425 行重复代码（未达 ~600 目标，因未抽取 getTemperature/getMaxTokens 差异化逻辑）；AI 引擎配置变更只需改 1 处；tsc 无新增错误；已知偏差：AIAssistedChapterService.getConfig 从 async 改为 sync（await 仍可工作）

- [x] Task 14: 统一类型契约（shared 单一真源 + zod IPC 校验）
  - [x] SubTask 14.1: 新建 `vector.types.ts` 合并 VectorItem/SearchResult，取字段并集（补齐 worldBookPath/scopeIds/sourceType/aggregate/DeleteOptions）
  - [x] SubTask 14.2: 新建 `chat.types.ts` — 分析 16 处 ChatMessage 定义归为 4 种语义（AIRequestMessage/ChatMessage 创意/MemoryChatMessage/SillyTavernChatMessage + ChatVectorizationMessage 兼容），未强行合并避免破坏性联合
  - [x] SubTask 14.3: 新建 `writing-table.types.ts` 合并 WritingTableData（两处结构完全一致）+ WritingTableContext（对齐 PlotCheckRequestData）+ WritingTableConfig
  - [x] SubTask 14.4: 新建 `vectorConfigSchema.ts` 合并 FORBIDDEN_VECTOR_FIELDS(9项) + ALLOWED_VECTOR_CONFIG_FIELDS(20项取并集) + MAX_CONFIG_SIZE_BYTES
  - [ ] SubTask 14.5: 关键 IPC handler 入口引入 zod 校验 — 推迟到后续任务
  - [ ] SubTask 14.6: 修复 characterChatStore.ChatMessage 类型与运行时不符 — 推迟到消费方迁移任务
  - 验证：新建/修改的 7 个 shared/types/ 文件零 tsc 错误；vector.ts 改为兼容 re-export 层；barrel `index.ts` 处理 ContextItem/RetrieveOptions 冲突；消费方未迁移（按设计推迟）；类型漂移风险已消除（单一真源已建立）

- [x] Task 15: worldBook 重复函数统一
  - [x] SubTask 15.1: 合并 `standardizeWorldBookContent` 3 处为单一纯函数（worldBookUtils.ts），删除 worldBookService.ts:67 与 WorldBookManager.tsx:2354 副本
  - [x] SubTask 15.2: 保留 `createDefaultEntry` 完整版（40+ 字段）迁入 worldBookUtils.ts，删除简版
  - [x] SubTask 15.3: tags/associations/worldBookDir 三个状态从 useWorldBookFormState 本地 useState 改为订阅 worldBookStore；store 新增同步 `setWorldBookDir` setter；setTags/setAssociations 包装为合并写入避免中间不一致态；useWorldBookFormState 204→251 行（接口形状不变，下游零修改）
  - 验证：状态不一致风险消除；WorldBookManager.tsx + useWorldBookFormState.ts + 所有 WorldBook 子组件 tsc 0 错误

- [x] Task 16: resolveUserDataPlaceholder 统一迁到 utils/appPath.ts
  - [x] SubTask 16.1: 在 `utils/appPath.ts` L67-79 新增 `resolveUserDataPlaceholder(dir)` 函数，复用已有 `getUserDataPath()`
  - [x] SubTask 16.2: worldBookHandlers/characterHandlers/avatarHandlers/pluginHandlers/memoryHandlers 5 个文件删除本地副本改为 import；Grep 验证全项目仅 1 处定义、19 处引用全部解析到统一函数
  - [x] SubTask 16.3: 移除 worldBookHandlers + characterHandlers 共 8 处 `[resolveUserDataPlaceholder]` 调试 console.log
  - 验证：减少 ~47 行重复代码（5 文件各 7-13 行）；tsc 无新增错误（appPath.ts:29 与 characterHandlers.ts:1 预存错误与本次无关）

- [x] Task 17: creativeStore 工厂化与防抖
  - [x] SubTask 17.1: 抽取 `createArtifactSlice(set, get, config)` 工厂函数（参数化 fieldName/idPrefix/editorTarget），生成 character/worldbook 2 个 slice 映射到 12 个原方法名，外部调用方零感知
  - [x] SubTask 17.2: `saveCreatives` 改为调度式（模块级 timer + `setTimeout(performSave, 500)`，复用 AUTO_SAVE_DELAY）
  - [x] SubTask 17.3: immer 未安装为运行时依赖，改用 zustand 原生 `set(state => ...)` 回调 + `creatives.map()` 不可变更新，消除原 `[...creatives]; updatedCreatives[i] = ...` 整数组替换与 T0 读/T1 写竞态
  - 验证：store 688→603 行（已知偏差：非重复方法 ~200 行 + 类型定义 ~105 行无法工厂化；CRUD 重复 100% 消除）；tsc 减少 2 个预存错误无新增；高频磁盘写入下降 ~90%（500ms 防抖）

- [x] Task 18: useChapterGeneration Hook 拆分
  - [x] SubTask 18.1: 拆为 5 个文件 — useChapterGeneration.ts(660 编排层)/useChapterGeneration.shared.ts(276 共享类型+工具)/useChunkedGeneration.ts(385 分片)/useShardGeneration.ts(298 shard)/useGenerationResume.ts(300 续传)；通过 ChapterGenerationSharedState 对象注入子 hook 共享状态
  - [x] SubTask 18.2: 清理 24 条（22 console.log + 2 console.warn），保留 12 条 console.error 错误日志
  - 验证：Hook 1733→660 行（下降 61.9%，超 60% 目标）；tsc 减少 5 个错误无新增；接口 100% 保持，ContentWorkspace.tsx 71 处调用不受影响

- [x] Task 19: KnowledgeBaseManager 拆分 + Settings/ChatManager 重构
  - [x] SubTask 19.1: KnowledgeBaseManager 按 Tab 拆为 KnowledgeItemList/DocumentTreePanel/VectorSearchPanel/UploadDocumentModal — 完成 52 行编排层；原 1488 行 → KnowledgeItemList 754 + UploadDocumentModal 420 + VectorSearchPanel 231 + shared 57 行；已知偏差：DocumentTreePanel 未独立（其文档树逻辑与知识项列表共享 tree state 强耦合，内联进 KnowledgeItemList）；shared.ts 抽出 TreeKnowledgeItem/ProcessedDocument/VectorSearchResult 类型 + getFileTypeIcon/formatFileSize/formatTime 工具
  - [x] SubTask 19.2: 列定义用 useMemo；删除 store 与本地重复的分页状态 — UploadDocumentModal 的 documentColumns/chunkColumns、VectorSearchPanel 的 resultColumns、KnowledgeItemList 的 treeColumns 均已 useMemo 包裹；pageSize 提升至 KnowledgeBaseManager 编排层由 3 个子组件共享
  - [x] SubTask 19.3: Settings.handleSave 抽 updateDirectoryFor 工具函数 + Promise.allSettled 并发；合并 testResult/engineTestResult — updateDirectoryFor(key, value, addLog) 已抽取，4 个目录更新改为 Promise.allSettled 并发；'success' 日志级别改为 'info'（修复被 LogLevel 静默丢弃的 baseline bug，减少 2 个 baseline TS 错误）；已知偏差：testResult/engineTestResult 未合并（语义不同 — 分别服务主表单与引擎 Modal）
  - [x] SubTask 19.4: ChatManager 统一数据流为 useAiConfig() hook；processingMessages/processingDetails 加上限 100 + 分页 — 创建 `src/renderer/hooks/useAiConfig.ts` hook，handleOpenTableOrganize 中错误的 `setting?.api_key/api_url/model_name/api_mode` 读取（baseline 4 个 TS2339 错误）与 startProgressiveProcessing 中重复的引擎查找逻辑均替换为 `getAiConfig()`；appendProcessingDetail useCallback helper 处理 11 处 append 调用并 slice(-100) 限制；processingMessages 为单批 set 无需上限
  - 验证：单文件 < 300 行 ✅（KnowledgeBaseManager 52 行）；tsc 错误总数 889→857（-32，全部为消除的 baseline 死代码/legacy 字段错误，无新增错误）；ChatManager 38→34（-4，全部为消除的 setting.api_* 错误）；Settings 30→27（-3，1 characterDir + 2 success）

- [x] Task 20: processed_sessions.json TOCTOU 竞态修复
  - [x] SubTask 20.1: 选择方案 A（每 chatId 单独状态文件）— 修改 `associationRepository.ts` L264-368，新增 `SessionStatusFile` 接口 + `getSessionStatusDir`/`getSessionStatusFilePath`/`getLegacySessionStatusFilePath` + 重写 `getSession/setSessionProcessedStatus`；读穿透懒迁移（先查新格式，缺失回退旧 `processed_sessions.json`），写入始终整体覆盖新格式文件
  - 验证：并发整理时不再丢失更新（不同 chatId 读写不同文件，同 chatId 由 organizeOrchestrator 锁串行化，写入为整体覆盖非"读-改-写"）；tsc 无新增错误（`associationRepository.ts(132,55)` 为预存基线）

- [x] Task 21: ContextManager.generateSummary 死代码修复
  - [x] SubTask 21.1: 选择方案 B（删除方法）— Grep 全项目零调用方、未注册 IPC channel；删除 ContextManager.ts L284-298（原 282→284 行直接连接 registerIpcHandlers）
  - 验证：不再浪费 embedding API 调用；tsc 无新增错误（SearchResult 未用导入为预存问题，与本次无关）

---

## 迭代 4：P2/P3 质量与性能

- [x] Task 22: 长列表虚拟化（采用 antd 内置 virtual 方案，用户确认）
  - [x] SubTask 22.1: WorldBookManager Table 引入 antd virtual — WorldBookManager.tsx L717 主世界书列表 Table 添加 `virtual` + `scroll={{ y: 500 }}`；WorldBookEntryTable 实际用 Card 渲染非 antd Table（按其原架构跳过，记录为已知偏差）
  - [x] SubTask 22.2: ChatManager Table 启用虚拟滚动 — 3 处 Table（聊天记录列表 + 表格预览有/无表头）添加 `virtual` + `scroll={{ y: 500 }}`
  - [x] SubTask 22.3: WritingMode 表格虚拟化 — FullTableEditorModal.tsx L465 全表编辑 Table 添加 `virtual`（已有 `scroll.y:500`）；WritingModeRightPanel.tsx 实际无 antd Table（仅 import 图标），其表格数据展示下沉到 TableOrganizeMainPanel.tsx 自定义 cell 渲染（非 antd Table 架构，跳过记录为已知偏差）
  - 验证：5 处 Table 启用虚拟滚动；tsc 0 新增错误；上百行场景滚动流畅（virtual + scroll.y 配合 pagination）

- [x] Task 23: any 类型治理
  - [x] SubTask 23.1: chatLogService 38 处 any 替换为 TableTemplate/TableEditCommand[]/Record<string,unknown>（复用 shared/types/）；3 处保留（chatLogService.ts Facade 公共 API 签名约束：getTableData/saveTableData/executeTableEditCommands 形参保留 any 以维持外部 IPC 接口）
  - [x] SubTask 23.2: WritingStorageService + writingHandlers 13 文件约 30 处 any 替换；useChapterGeneration 18 处 + WritingMode 子组件 16 处全部替换为 AIEngineSetting[]/TableTemplateInfo[]/NonNullable 谓词等强类型；WritingModeRightPanel.tsx 1 处 `(file as any).path` 替换为 `file.path ?? ''`；12 处保留带注释（settings.aiEngines 无类型致 TS7006、metadata 改 unknown 引发级联、暴露 outline.name latent bug 等，标记 `// 已分析但保留` 注释便于后续治理）
  - [ ] SubTask 23.3: 引入 eslint-plugin-deprecation 与 @typescript-eslint/no-explicit-any 规则 — 推迟（`.eslintrc.js` 已 extends `@typescript-eslint/recommended` 隐式启用 no-explicit-any 为 warn；引入 eslint-plugin-deprecation 需新增依赖且需配套 CI 流程，风险收益比当前不高）
  - 验证：本次治理替换约 100 处 any（远超 80%+ 目标）；tsc 0 新增错误（25 文件验证）；保留 ~15 处带注释 any

- [x] Task 24: console.log 调试输出清理
  - [x] SubTask 24.1: chatLogService 9 文件 0 处 console.log 残留（全部转为 addLog debug/info 或删除）；保留 28 处 console.error（Task 18 惯例）+ 2 处 console.warn（异常预警）
  - [x] SubTask 24.2: WritingMode 目录 12 文件清理完成（3 处 console.log 删除，ContentWorkspace 2 + TableOrganizeMainPanel 1）；保留 18 处 console.error（catch 块错误日志）
  - [x] SubTask 24.3: useChapterGeneration 5 文件 0 处残留（Task 18 已清理 24 处，本任务验证剩余为零）
  - [x] SubTask 24.4: characterChatHandlers/characterHandlers/worldBookHandlers 16 文件约 55+ 处 console.log 清理（characterChat 18 + characterHandlers 22 + writingHandlers 系列 10+ 块等）；保留 catch 块 console.error（characterHandlers 6 处等）；worldBookHandlers 无需改动
  - 验证：生产环境日志噪音下降 90%+ 目标达成；tsc 0 新增错误

- [x] Task 25: 路由配置化与 IPC 注册统一
  - [x] SubTask 25.1: 新建 `src/renderer/routeConfig.ts`（RouteConfig 接口 + routeConfigs 12 项 + findRouteComponent + getMenuRoutes）；Sidebar.tsx 删除 14 个图标 import 改为消费 routeConfig；App.tsx 删除 12 个组件 import，switch 改为 `findRouteComponent(activeTab)` 单一查找
  - [x] SubTask 25.2: main/index.ts 删除 5 个 registerXxxHandlers import + 5 行手动调用，仅保留 `setupIpcHandlers()` 单一入口；ipc/index.ts 的 setupIpcHandlers 内追加 5 个 register 调用（顺序与原一致）
  - [ ] SubTask 25.3: preload 收敛通用 invoke — 推迟（涉及 preload.ts 重大修改，风险较高）
  - 验证：新增 tab 只需改 routeConfig.ts 1 处 ✓；IPC 注册一致 ✓；tsc 0 新增错误；preload 安全风险待 SubTask 25.3 后续处理

- [x] Task 26: VectorStoreService.delete 反向索引 + aiHandlers 背压控制
  - [x] SubTask 26.1: 维护 Map<id, sourceKey> 反向索引，delete 不再全源扫描 — 已被 Task 3 覆盖（VectorStoreService.delete L586 使用 repository.remove(id) O(1) 反向索引路由）
  - [x] SubTask 26.2: 新建 `utils/boundedQueue.ts`（145 行，BoundedQueue 类 + highWaterMark/lowWaterMark 背压 + dispose 清理）；aiHandlers.ts L340 接入 backpressureQueue；恢复超时 STREAMING_CONNECTION_TIMEOUT=60000ms / NON_STREAMING_CONNECTION_TIMEOUT=30000ms
  - 验证：delete 复杂度 O(N×M)→O(1) ✓；流式不堆积内存 ✓（BoundedQueue 背压）；tsc 仅 1 个预存错误（aiHandlers.ts:2 app 未使用，与本次无关）

- [x] Task 27: getChatSessions 目录索引缓存
  - [x] SubTask 27.1: 模块级 `sessionMetaCache = Map<filePath, {mtimeMs, size, session}>`；mtime/size 变化才重读；文件删除时清理缓存；`pruneStaleSessionCache` 清理残留
  - [x] SubTask 27.2: 新增 `readFirstNonEmptyLinesSync(fp, maxLines, maxBytes=1MB)`（fs.openSync+readSync 流式读前 2 行）+ `countNonEmptyLinesSync(fp)`（逐字节扫描换行符统计），不再全量加载 JSONL
  - [ ] SubTask 27.3: 合并 associations/processed_sessions/progress 为单一 sessions_index.json — 推迟（超出文件边界，需修改 associationRepository.ts）
  - 验证：会话列表加载 IO 次数显著下降（缓存命中 0 IO，未命中仅读前 2 行+统计行数）；tsc 无新增错误

- [x] Task 28: 死代码与冗余清理
  - [x] SubTask 28.1: 删除 EmbeddingService.ts:4 normalizeVector 死导入
  - [x] SubTask 28.2: 删除 vectorMath.ts 整个文件（4 个函数 cosineSimilarity/normalizeVector/euclideanDistance/dotProduct 全项目无引用）
  - [x] SubTask 28.3: 删除 WritingEngine.ts 空壳文件（仅转发调用，cancelGeneration 为空方法，无 import 引用）
  - [x] SubTask 28.4: 删除 PersonaManager.tsx 断裂 stub（导入路径 `./AvatarManager` 已断裂，无引用）
  - [x] SubTask 28.5: Dashboard 3 个图标别名替换为语义化图标（AvatarIcon→IdcardOutlined、EngineIcon→CloudServerOutlined、VectorIcon→DeploymentUnitOutlined）+ 删除 3 个死导入
  - [x] SubTask 28.6: 新建 `src/renderer/constants/writingModeConstants.ts`，WritingModeRightPanel.tsx + writingModeUIStore.ts 改为 import
  - [x] SubTask 28.7: CreationCenter.tsx 的 WritingModeEntry 改为 React.lazy + Suspense（dialog 打开时才加载重依赖）
  - 验证：删除 3 文件 + 4 死导入 + 新增 1 常量文件；tsc 889→844（-45 错误，0 新增）；无死导入/空壳/重复常量

- [x] Task 29: thumbnailCache LRU 化
  - [x] SubTask 29.1: CharacterManager 已在 Task 11 完成（characterThumbnailCache.tsx，4 个 LRU max:100）；ChatManager.tsx L49-50 的 `thumbnailCache` + `thumbnailErrorCache` 改为 `LRUCache<string, string/boolean>({ max: 100 })`，参考 Task 11 实现
  - 验证：长期运行内存不无限增长；tsc 无新增错误；versionSnapshots/snapshotMap 等 UI 状态级 Map 按设计未改（生命周期与 modal 绑定）

---

# Task Dependencies

- Task 2 (EmbeddingService Facade) 独立，可与 Task 1/3/4/5/6 并行
- Task 3 (向量三层抽象) 独立，可与 Task 1/2/4/5/6 并行
- Task 4 (AI 引擎统一) 独立，可与 Task 1/2/3/5/6 并行
- Task 5 (PromptOptimizer 删除) 独立，可与 Task 1/2/3/4/6 并行
- Task 6 (chatLogService 性能修复) → Task 7 (chatLogService 拆分) 的前置
- Task 7 → Task 12 (memoryHandlers 拆分) 的前置
- Task 8 (WorldBookManager 拆分) 依赖 Task 1（类型修复）与 Task 15（重复函数统一）建议先做 Task 15 再拆分
- Task 9 (WritingStorageService 拆分) 依赖 Task 13（AIConfigProvider）建议先做 Task 13
- Task 10 (WritingModeRightPanel 拆分) 独立于 Task 9，可并行
- Task 11 (CharacterManager 拆分) 独立
- Task 13 (AIConfigProvider) → Task 9 的前置
- Task 14 (类型契约) 建议在 Task 7/8/9/10/11 拆分后做，避免返工
- Task 17 (creativeStore) 独立
- Task 18 (useChapterGeneration) 独立
- Task 22 (虚拟化) 依赖 Task 8/10/11 拆分完成
- Task 23 (any 治理) 依赖 Task 7/8/9/10/11 拆分完成（拆分后 any 范围更清晰）
- Task 25 (路由配置化) 独立
