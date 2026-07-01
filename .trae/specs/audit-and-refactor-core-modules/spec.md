# 创想咖啡厅（Creative Café）系统性优化重构建议清单 Spec

> 本文档是对项目 11 个核心模块（仪表盘、创作中心、创意管理、世界书、用户人设、角色卡、记忆管理、知识库、设置、提示词管理）及 3 大核心技术组件（向量存储、AI 引擎、提示词管理）进行系统性代码审计后形成的优化重构建议清单。
>
> 所有建议均以"不破坏现有业务功能与用户操作流程"为前提，问题按严重程度（高/中/低）与实施优先级（P0/P1/P2/P3）分级，并给出具体整改措施、量化预期与预估工时。

---

## Why

项目经多次迭代后积累了显著的技术债务：存在多个 2000+ 行的巨型组件/服务（WorldBookManager 5667 行、chatLogService 3671 行、WritingModeRightPanel 2941 行、WritingStorageService 2434 行、CharacterManager 2320 行）、跨模块大量重复实现（SSE 解析 6 处、AIConfigProvider 5 处、`resolveUserDataPlaceholder` 5 处、`standardizeWorldBookContent` 3 处）、以及若干数据正确性与性能隐患（`delayUntilRecursion` 类型 bug、EmbeddingService local 模式全链路失效、向量 `clear()` O(n²) 复杂度、每条消息同步读盘 3 次）。这些问题导致可维护性下降、扩展成本上升、部分功能在特定模式下不可用。本规范旨在提供一份可有序推进的整改清单，显著提升代码清晰度、可维护性、可扩展性与运行性能。

## What Changes

### 架构层面（核心技术底座）
- **引入 `IVectorBackend` 接口 + Repository 模式**，消除 `VecstoreVectorStore` 与 `VectorStoreService` 职责重叠，使向量后端可替换
- **统一 AI 引擎到 `AIService.streamChatAPI` + `SSEStreamParser`**，消除 6 处 SSE 重复实现
- **`EmbeddingService` Facade 化**，修复 local 模式全链路失效
- **废弃 `PromptOptimizer` mock 模块**，合并进 `PromptManagement`
- **抽取 `AIConfigProvider` 单例**，消除 5 处重复的 AI 配置获取逻辑
- **统一 `shared/types` 为单一真源**，引入 zod 做 IPC 边界契约校验

### 拆分层面（超大文件）
- 拆分 5 个 God Class：WorldBookManager、chatLogService、WritingModeRightPanel、WritingStorageService、CharacterManager
- 拆分 2 个超大 IPC handler 文件：writingHandlers（60 handler）、memoryHandlers（45 handler）
- 拆分 1 个超大 hook：useChapterGeneration（1554 行）

### 代码质量层面
- 消除 3 处数据正确性 bug（`delayUntilRecursion` 类型、`ExternalTableProcessingService` 空字段、`processMessagesCore` 同步 IO）
- 消除重复代码约 2000+ 行（重复函数、mock 实现、console.log 调试输出）
- any 类型滥用治理（35+ 处 → 引入强类型）
- 长列表虚拟化（WorldBookManager、ChatManager、WritingModeRightPanel）

### 架构一致性
- 统一 IPC 注册入口（合并 `setupIpcHandlers` 与 main/index.ts 手动注册）
- App.tsx switch-case 路由配置化
- preload 收敛通用 `invoke`（安全风险）

## Impact
- **Affected code**: 涉及 src/main/services/、src/main/ipc/handlers/、src/renderer/components/、src/renderer/stores/、src/shared/types/ 下约 60 个文件
- **Affected modules**: 全部 11 个核心模块均受影响，其中向量存储、AI 引擎、记忆管理、世界书、创作中心改动较大
- **风险评估**: 所有整改均保持外部 API（IPC channel 名、preload 命名空间、store 接口）不变，确保用户操作流程不受影响；拆分操作以"行为保持"为约束，配套测试验证

---

## ADDED Requirements

### Requirement: 向量存储三层抽象架构（IVectorBackend / VectorRepository / VectorStoreManager）

系统 SHALL 引入向量存储的三层抽象，将当前 `VecstoreVectorStore`（968 行，6 类职责混杂）与 `VectorStoreService`（907 行，Strategy 类内联）重构为清晰分层：

- `IVectorBackend` 接口（Strategy 模式）：封装 vecstore-wasm/faiss/duckdb 等可替换后端的 `add/addBatch/remove/getById/search/clear/persist` 原语，强制 `assertDimension(vector)` 维度校验
- `VectorRepository`（Repository 模式）：纯 CRUD + 维度校验 + 反向索引 `Map<id, sourceKey>`，不感知文件存储
- `VectorStoreManager`（Factory + Facade）：管多源 store 生命周期、LRU 上限、写入 debounce + 增量持久化

#### Scenario: 向量后端可替换
- **WHEN** 需要新增 faiss 后端
- **THEN** 仅需实现 `IVectorBackend` 接口，无需修改 Repository 与 Manager

#### Scenario: 批量写入不阻塞
- **WHEN** 调用 `addBatch` 写入 1000 条向量
- **THEN** 不触发 N 次全量 `persist`，由 debounce 延迟合并落盘，耗时下降 99%+

#### Scenario: clear 操作线性复杂度
- **WHEN** 调用 `clear()` 清空 10000 条向量
- **THEN** 通过重建实例完成，复杂度 O(1)，而非当前 O(n²) 全表扫描删除

**整改措施**：
1. 定义 `src/main/services/vector/IVectorBackend.ts` 接口
2. 将 `VecstoreVectorStore` 重构为 `VecstoreBackend implements IVectorBackend`（保留 WASM 适配）
3. 新建 `VectorRepository` 承接 CRUD + 反向索引
4. `VectorStoreService` 瘦身为 `VectorStoreManager` Facade
5. `VectorCache` 改为注入 Repository

**预期改进**：VecstoreVectorStore 968→~300 行，VectorStoreService 907→~250 行；clear 10000 向量从分钟级降至毫秒级；getById 从 O(n) 降至 O(1)；新增向量后端成本从"改 4 处"降为"实现 1 接口"
**优先级**：P0 **预估工时**：3 人天

---

### Requirement: 统一 AI 引擎收敛到 AIService + SSEStreamParser

系统 SHALL 将当前 4 套并行的 AI 引擎实现收敛到主进程 `AIService.streamChatAPI`（已含重试/退避/取消能力），SSE 行解析下沉为单一 `SSEStreamParser` 工具函数。

#### Scenario: 流式调用统一入口
- **WHEN** 任意模块（OutlineGenerator/ContentGenerator/PromptTemplateService/PlotCheckerService/WritingStyleLearningService）需要流式 AI 调用
- **THEN** 统一调用 `aiService.streamChatAPI`，不再各自手写 fetch + reader + SSE 解析

#### Scenario: 流式重试与取消对全部模块可用
- **WHEN** AI 请求失败或用户取消
- **THEN** 由 `streamChatAPI` 统一处理重试退避与 AbortController 取消，调用方无需重复实现

**整改措施**：
1. 确认 `AIService.streamChatAPI` + `SSEStreamParser`（AIService.ts:170-314）为唯一真源
2. `promptTemplateService.optimizePrompt`（L472-528）改为调用 `aiService.streamChatAPI`，删除手写 fetch
3. `OutlineGenerator`/`ContentGenerator`/`WritingStyleLearningService` 中的 SSE 解析替换为复用
4. renderer 侧 `AIService.tsx` 统一作为 IPC 转发层，删除 `ChatEngine.ts` 中重复的 `buildApiUrl/buildRequestBody`
5. SSE 解析提取为 `src/main/services/ai/SSEStreamParser.ts` 独立工具

**预期改进**：删除 ~600 行重复 SSE 代码；流式重试/取消能力对所有模块可用
**优先级**：P0 **预估工时**：2 人天

---

### Requirement: EmbeddingService Facade 化修复 local 模式

系统 SHALL 将 `EmbeddingService` 改为 Facade，在 local 模式下委托 `EmbeddingWorkerService`（worker_thread 隔离），修复当前主进程 12 处调用方在 local 模式下全部失效的严重缺陷。

#### Scenario: local 模式可用
- **WHEN** 用户切换到本地 embedding 模型
- **THEN** 聊天向量化、上下文检索、世界书/知识库检索全部正常工作（当前直接返回 `success:false`）

**整改措施**：
1. `EmbeddingService.generateEmbedding` 在 `mode==='local'` 时委托 `EmbeddingWorkerService`（已可用），删除直接返回失败的逻辑
2. 删除 `rendererEmbeddingService.ts` 中重复的 IPC 包装，统一走 `embedding:generate` IPC
3. `EmbeddingService.generateEmbedding` 返回前校验配置维度

**预期改进**：local 模式从"全链路失效"变为可用；删除 renderer 侧 ~150 行重复包装
**优先级**：P0 **预估工时**：1.5 人天

---

### Requirement: AIConfigProvider 单例消除 5 处重复

系统 SHALL 抽取 `AIConfigProvider` 单例，统一返回 `baseUrl/apiKey/apiKeyTransmission/systemPrompt/modelName`，所有写作服务（ContentGenerator/OutlineGenerator/DescriptionPolisher/WritingStyleLearningService/AIAssistedChapterService/WritingStorageService）依赖注入。

**整改措施**：新建 `src/main/services/ai/AIConfigProvider.ts`，删除 5 处重复实现（每处 ~120 行）
**预期改进**：删除 ~600 行重复代码；AI 引擎配置变更只需改 1 处
**优先级**：P1 **预估工时**：1.5 人天

---

### Requirement: 统一类型契约（shared 单一真源 + zod IPC 校验）

系统 SHALL 将 `shared/types/` 确立为类型定义的单一真源，`main/types/` 与 `renderer/types/` 仅 re-export；在 IPC 边界引入 zod schema 校验，消除 `as any` 断言。

**整改措施**：
1. 合并 `VectorItem`/`SearchResult` 的 shared 与 main 重复定义
2. 合并 `ChatMessage` 在 5 处的重复定义（shared/main/renderer/characterChatStore/chatLogService）
3. 合并 `WritingTableData` 与 `PlotCheckRequestData.writingTableData` 重复定义
4. 合并 `ConfigCleanupService.FORBIDDEN_VECTOR_FIELDS` 与 `VectorConfigManager.ALLOWED_VECTOR_CONFIG_FIELDS` 为 `vectorConfigSchema.ts` 单一真源
5. 关键 IPC handler 入口引入 zod 校验

**预期改进**：消除类型漂移风险；IPC 边界类型安全 +100%
**优先级**：P1 **预估工时**：1.5 人天

---

### Requirement: 路由配置化与 IPC 注册统一

系统 SHALL 将 App.tsx 的 switch-case 路由（13 tab）提取为配置注册表，并将分散在 `setupIpcHandlers()` 与 `main/index.ts` 手动调用的 IPC 注册统一到单一入口。

**整改措施**：
1. 新建 `src/renderer/routeConfig.ts`，Sidebar 菜单与 App.tsx render 均消费该配置
2. `main/index.ts` 中手动调用的 `registerMemoryHandlers/registerCreativeHandlers/registerCharacterChatHandlers/registerWritingHandlers/registerPromptHandlers` 迁入 `setupIpcHandlers()`
3. preload 收敛通用 `invoke(channel, ...args)`，仅暴露类型化命名空间（安全风险修复）

**预期改进**：新增 tab 只需改配置文件 1 处；IPC 注册一致；消除 preload 安全风险
**优先级**：P2 **预估工时**：1 人天

---

## MODIFIED Requirements

### Requirement: WorldBookManager 巨型组件拆分

将 `WorldBookManager.tsx`（5667 行，38 个 handler，0 useCallback、1 useMemo）按"功能域 + UI 区块"双维度拆分为：

1. `useWorldBookAIOperations` hook —— 迁出 `translateText`(176行)/`polishText`(206行)/`generateKeywords`/`handleGenerateNewEntries`(573行)/`handleGenerateEntries`(328行)/`handleAISortEntries`(300+行)/`handleTranslateAll`/`handlePolishAll` 等 AI 长函数（约 1800 行）
2. `WorldBookEntryEditor` —— 编辑条目 Modal
3. `WorldBookAIGenerateFlow` —— AI 生成世界书全流程
4. `WorldBookEntryTable` —— 条目列表 + 排序 + 批量操作（引入 `react-window` 虚拟化）
5. `WorldBookSortModal` / `WorldBookPolishModal` —— 独立 Modal
6. `useWorldBookFormState` —— 30+ useState 抽入 reducer/zustand slice
7. `WorldBookManager` 编排层 —— 目标 < 500 行

#### Scenario: 局部更新不触发整树重渲染
- **WHEN** 用户编辑单个条目的 formValues
- **THEN** 仅 `WorldBookEntryEditor` 重渲染，而非当前整树（5667 行组件 0 useCallback）

**预期改进**：单文件 5667→约 800 行；重渲染范围缩小至子组件；可维护性提升 3 倍
**优先级**：P0 **预估工时**：8 人天

---

### Requirement: chatLogService 巨型服务拆分

将 `chatLogService.ts`（3671 行，60+ 方法，7 类职责混杂）按职责拆分为 8 个文件，全部放在 `src/main/services/memory/` 下：

1. `chatSessionRepository.ts` —— JSONL 读取、会话列表（约 400 行）
2. `aiPromptBuilder.ts` —— `buildAIPrompt`/`buildAIPromptForProgressive`/`buildTableContext`（约 800 行）
3. `aiClient.ts` —— `callAIAPI`/`callAIAPIWithRetry`/`parseAIResponse`/`parseAIOperations`（约 300 行）
4. `tableFileRepository.ts` —— `getTableData`/`saveTableData`/`applyAIResults`（约 500 行）
5. `tableOperationExecutor.ts` —— `executeTableEditCommands`/`executeInsertOperation` 等 5 分支 + `isSimilarName`/`levenshteinDistance`（约 700 行）
6. `organizeOrchestrator.ts` —— `processChat`/`processChatProgressive`/`processChatFull`/锁与 AbortController/断点续传（约 600 行）
7. `associationRepository.ts` —— `associateTemplate`/`saveAssociation`/`migrateAssociations`（约 300 行）
8. `logger.ts` —— requestId/addLog 抽离

#### Scenario: processMessagesCore 内存化
- **WHEN** 处理 1000 条消息
- **THEN** 同步读盘次数从 3000 次降至 ≤10 次（入口缓存 tableData 对象，每 N 条落盘）

**整改措施**（含性能修复）：
1. 按上述 8 文件拆分
2. `processMessagesCore` 入口缓存 `tableData`，命令执行后只更新内存对象，每 N 条或末尾落盘
3. 进度文件改为追加写或每 10 条批量落盘
4. `safeChatId` 重复 10 处全部替换为 `sanitizeChatId()` 模块级函数
5. `ExternalTableProcessingService` 修复 `filePath` 空字段 bug，删除 4 个冗余代理方法

**预期改进**：单文件最大 ≤ 800 行；1000 条消息整理耗时降低 60%+；主进程不再卡顿
**优先级**：P0 **预估工时**：4.2 人天

---

### Requirement: WritingStorageService God Class 拆分

将 `WritingStorageService.ts`（2434 行，6 类不相干职责，69 方法）拆分为：
1. `WritingProjectRepository` —— 项目/章节/版本持久化
2. `WritingStyleRepository` —— 写作风格存储
3. `WritingTableRepository` —— 表格数据存储
4. `TableOrganizeService` —— 表格整理业务逻辑（含 AI 调用与 prompt 构建）
5. `TableEditCommandExecutor` —— 表格编辑指令解析执行
6. `AIConfigProvider` —— AI 配置获取（共享，见 ADDED Requirement）

**整改措施**：消除 `organizeTable` 中 `chapterInProject.status = 'organized' as any` 直接 mutate（改为不可变更新）；为 `ChapterStatus` 增加 `'organized'` 字面量消除 `as any`
**预期改进**：单文件平均行数下降 80%；可测试性提升；单元测试覆盖率可从 0 提至 60%+
**优先级**：P0 **预估工时**：5 人天

---

### Requirement: WritingModeRightPanel 巨型组件拆分

将 `WritingModeRightPanel.tsx`（2941 行，内含 `TableOrganizePanelContent` 1960 行 + 30 useState）按子功能拆为：
1. `TableOrganizeMainPanel`
2. `TableTemplateBinder`
3. `TableVersionControl`
4. `TableReorganizeModal`
5. `FullTableEditorModal`
6. `PlotCheckPanelContent`（独立文件）
7. `WritingModeRightPanel` 编排层

**整改措施**：长列表引入 `react-window`；子组件 `React.memo`；30+ useState 按子功能区聚合到子组件局部 state
**预期改进**：单组件 1960→<400 行；1000 行表格渲染时间下降 60%+
**优先级**：P0 **预估工时**：4 人天

---

### Requirement: CharacterManager 巨型组件拆分

将 `CharacterManager.tsx`（2320 行）抽出 `CharacterEditModal`、`CharacterAIOperations` hook（迁出 `handlePolish` 162 行 / `handleTranslate` 117 行 / `handleEditModalOk` 182 行）、`CharacterListView`；模块级 `thumbnailCache`/`avatarCache` 迁到独立 `characterThumbnailCache.ts` 并加 LRU 上限。

**预期改进**：代码量减少 ~60%；编辑模态可独立测试
**优先级**：P0 **预估工时**：4 人天

---

### Requirement: KnowledgeBaseManager 巨型组件拆分

将 `KnowledgeBaseManager.tsx`（1425 行，30+ useState，6 块互不相关 UI）按 Tab 拆分为 `KnowledgeItemList.tsx` / `DocumentTreePanel.tsx` / `VectorSearchPanel.tsx` / `UploadDocumentModal.tsx`；列定义用 `useMemo`；删除 store 与本地重复的分页状态。

**预期改进**：单文件 < 300 行；重渲染次数减少 ~40%
**优先级**：P1 **预估工时**：1.5 人天

---

### Requirement: Settings.tsx handleSave 重构

将 `handleSave`（165 行，串行 4 个 `setDirectory` IPC）重构为 `updateDirectoryFor(kind, path)` 工具函数 + `Promise.allSettled` 并发；合并 `testResult`/`engineTestResult` 重复字段。

**预期改进**：handleSave 缩至 30 行；4 目录更新并发执行，耗时 -50%
**优先级**：P1 **预估工时**：0.5 人天

---

### Requirement: ChatManager 数据流统一

统一 `handleOpenTableOrganize`（读废弃的 `setting?.api_key`）与 `startProgressiveProcessing`（走 `aiEngines.find`）两条路径为 `useAiConfig()` hook；`processingMessages`/`processingDetails` 数组加上限 100 条 + 分页。

**预期改进**：消除配置分裂；内存无限增长消除
**优先级**：P1 **预估工时**：1 人天

---

### Requirement: useChapterGeneration Hook 拆分

将 `useChapterGeneration.ts`（1554 行，3 类生成工作流）拆分为 `useChapterGeneration`（单章）/ `useChunkedGeneration`（分片）/ `useShardGeneration`（shard）/ `useGenerationResume`（续传）4 个子 hook，主 hook 做组合。

**预期改进**：Hook 行数下降 60%
**优先级**：P1 **预估工时**：3 人天

---

### Requirement: creativeStore 工厂化与防抖

抽取 `createArtifactSlice(kind: 'characterCard'|'worldBook')` 工厂函数消除 12 个重复 CRUD 方法（~370 行）；`saveCreatives` 引入防抖（参考 `writingProjectStore.triggerAutoSave` 的 `AUTO_SAVE_DELAY`）；采用 zustand selector + immer 细粒度更新避免整数组替换。

**预期改进**：store 654→~300 行；高频聊天场景磁盘写入下降 ~90%；重渲染缩小 70%
**优先级**：P1 **预估工时**：2.5 人天

---

### Requirement: IPC handler 文件按领域拆分

将 `writingHandlers.ts`（1909 行，60 handler 跨 6 领域）拆为 `writingProjectHandlers`/`writingOutlineHandlers`/`writingChapterHandlers`/`writingTableHandlers`/`writingStyleHandlers`/`writingPlotCheckHandlers`；将 `memoryHandlers.ts`（681 行，45 handler 跨 4 业务）拆为 `memoryTemplateHandlers`/`memoryTableHandlers`/`memorySessionHandlers`/`memoryExternalHandlers`；提取 `wrapHandler(fn)` 高阶函数统一 try/catch。

**预期改进**：单文件 < 350 行；定位 handler 时间下降 60%
**优先级**：P1 **预估工时**：2.5 人天

---

### Requirement: worldBook 数据正确性修复（delayUntilRecursion 类型 bug）

统一 `delayUntilRecursion` 为 `number` 类型（SillyTavern 规范），移除 `WorldBookManager.tsx:2402` 的 `typeof === 'boolean'` hack；编写一次性迁移脚本扫描已存盘 worldbook JSON 把 `false→0 / true→1`；为 `WorldBookEntry` 接口加严格类型。

**预期改进**：消除潜在匹配/向量化误激活；类型安全 +100%
**优先级**：P0 **预估工时**：0.5 人天

---

### Requirement: processed_sessions.json TOCTOU 竞态修复

将 `setSessionProcessedStatus` 的"读-改-写"非原子操作改为：①每 chatId 单独状态文件；或②全程加全局文件锁；或③迁移到 SQLite。

**预期改进**：消除并发整理时丢失更新风险
**优先级**：P1 **预估工时**：0.5 人天

---

### Requirement: 向量维度校验一致化

在 `IVectorBackend` 接口强制 `assertDimension(vector)`；`addBatchNoPersist` 补齐维度校验（当前跳过）；`EmbeddingService.generateEmbedding` 返回前校验配置维度；模型切换时由 `VectorConfigManager` 触发 `dimension` 变更事件，所有 store 实例 invalidate。

**预期改进**：消除模型切换后维度不匹配导致的写入失败与缓存脏读
**优先级**：P1 **预估工时**：1 人天

---

## REMOVED Requirements

### Requirement: PromptOptimizer mock 模块删除
**Reason**: `promptOptimizerService.callLLMAPI`（L248-262）是 `setTimeout(1500)+return 硬编码字符串` 的 mock 实现，`calculateComparison` 评分纯模拟；与 `PromptManagement` 走两套互不兼容的类型（`renderer/types/promptOptimizer.ts` vs `shared/types/promptTemplate.types.ts`），模板无法互通，功能"假可用"。
**Migration**: 将"优化/生成"用例合并进 `PromptManagement`，复用 `promptTemplateService.optimizePrompt`（已有真实 AI 调用）；删除 `promptOptimizerService.ts`、`promptOptimizerStore.ts`、`types/promptOptimizer.ts` 及 `components/PromptOptimizer/` 目录。
**优先级**：P0 **预估工时**：2.5 人天

### Requirement: ContextManager.generateSummary 死代码删除
**Reason**: `ContextManager.ts:284-298` 调用 `embeddingService.generateEmbedding(prompt)` 但返回值未使用，直接 `return text.substring(0, 200)`，每次调用浪费一次远程 API 请求，且语义错误（摘要应调用 chat API 而非 embedding）。
**Migration**: 改用 `aiService.callChatAPI`；或直接删除该方法（若无调用方）。
**优先级**：P1 **预估工时**：0.2 人天

### Requirement: WritingEngine 空壳服务合并
**Reason**: `WritingEngine.ts`（71 行）仅代理转发 outlineGenerator/contentGenerator，`cancelGeneration` 是空方法，未承担协调职责。
**Migration**: 合并到调用方或彻底承担编排职责（推荐后者，作为写作流程的 Facade）。
**优先级**：P2 **预估工时**：0.5 人天

### Requirement: PersonaManager stub 迁移完成
**Reason**: `PersonaManager.tsx` 仅 5 行 `export { AvatarManager as PersonaManager }`，Avatar→Persona 重命名停滞；与 `CharacterDialogueChat/PersonaPanel.tsx` 是两套并存路径。
**Migration**: 完成迁移，删除 AvatarManager 文件，统一术语为 Persona。
**优先级**：P2 **预估工时**：1 人天

### Requirement: normalizeVector 死导入清理
**Reason**: `EmbeddingService.ts:4` import `normalizeVector` 但全文未调用；`vectorMath.ts` 的 `cosineSimilarity`/`euclideanDistance`/`dotProduct` 仅在文件内部使用（实际相似度计算下沉到 WASM），TS 实现为孤儿代码。
**Migration**: 删除死导入；若保留 TS 实现作 fallback，需在 `IVectorBackend` 中显式调用路径。
**优先级**：P3 **预估工时**：0.2 人天

---

## 跨模块重复代码清单（统一消除）

以下重复实现需统一消除，按优先级排序：

| # | 重复函数/逻辑 | 重复处数 | 位置 | 整改 | 优先级 | 工时 |
|---|---|---|---|---|---|---|
| 1 | `standardizeWorldBookContent` | 3 处 | worldBookUtils.ts:16 / worldBookService.ts:67 / WorldBookManager.tsx:2354 | 合并为单一纯函数 | P1 | 0.5d |
| 2 | `createDefaultEntry` | 2 处 | worldBookUtils.ts:129 (13字段) / WorldBookManager.tsx:2469 (40+字段) | 保留完整版迁入 utils | P1 | 0.3d |
| 3 | `resolveUserDataPlaceholder` | 5 处 | worldBookHandlers/characterHandlers/avatarHandlers/pluginHandlers/memoryHandlers | 迁到 utils/appPath.ts | P1 | 0.3d |
| 4 | `safeChatId` 链式 replace | 10 处 | chatLogService.ts 多处 | 替换为 `sanitizeChatId()` | P0 | 0.2d |
| 5 | AI 配置获取 | 5+ 处 | ContentGenerator/OutlineGenerator/DescriptionPolisher/WritingStyleLearningService/WritingStorageService | 抽取 `AIConfigProvider` | P1 | 1.5d |
| 6 | SSE 行解析 | 6 处 | AIService/AIService.tsx/ChatEngine/promptTemplateService/OutlineGenerator/ContentGenerator | 下沉为 `SSEStreamParser` | P0 | 2d |
| 7 | creativeStore CRUD | 6×2 处 | characterCard 与 worldBook 各 6 方法 | `createArtifactSlice` 工厂 | P1 | 1d |
| 8 | `MIN_PANEL_WIDTH/MAX_PANEL_WIDTH` | 2 处 | writingModeUIStore.ts:51 / WritingModeRightPanel.tsx:32 | 单一定义 | P3 | 0.1d |

---

## 性能瓶颈与内存风险清单

| # | 问题 | 位置 | 影响 | 整改 | 优先级 | 工时 |
|---|---|---|---|---|---|---|
| 1 | `processMessagesCore` 每条消息同步读盘 3 次 | chatLogService.ts:2505-2608 | 1000 条=3000 次同步 IO，主进程卡顿 | 内存化 + 批量落盘 | P0 | 1d |
| 2 | 向量 `clear()` O(n²) | VecstoreVectorStore.ts:914-919 | 1 万向量触发 1 亿次操作 | 重建实例 | P0 | 0.3d |
| 3 | 每次 `add()` 触发全量 persist | VecstoreVectorStore.ts:427,793-850 | 批量写入性能极差 | debounce + 增量 WAL | P0 | 1d |
| 4 | `getById`/`getMetadata` 全表扫 | VecstoreVectorStore.ts:740-766 | O(n) 单条定位 | 维护 Map 索引 | P0 | 0.5d |
| 5 | `VectorStoreService.delete` 全源扫描 | VectorStoreService.ts:620-664 | O(N×M) | 反向索引 | P1 | 0.5d |
| 6 | `getChatSessions` 全目录同步扫描无缓存 | chatLogService.ts:257-320 | N×M 次同步 IO | 目录索引缓存 | P2 | 0.8d |
| 7 | `thumbnailCache` 全局 Map 无上限 | ChatManager.tsx:48-49 / CharacterManager.tsx:83-184 | 内存单调增长 | LRU 容器 | P3 | 0.2d |
| 8 | `storeBySource` Map 无 LRU 上限 | VectorStoreService | 长时间运行内存增长 | LRU Map | P1 | 0.3d |
| 9 | 长列表未虚拟化 | WorldBookManager/ChatManager/WritingModeRightPanel | 上百行卡顿 | `react-window` | P2 | 1d |
| 10 | creativeStore 每次更新全量同步保存无防抖 | creativeStore.ts 多处 | 高频聊天磁盘 IO | 防抖 + immer | P1 | 1.5d |
| 11 | `aiHandlers` 流式转发无背压 | aiHandlers.ts:143-300 | chunk 内存堆积 | 有界队列 + 水线 | P2 | 0.8d |
| 12 | `processingDetails` 数组无上限 | ChatManager.tsx:263 | 长时间整理内存增长 | 上限 100 + 分页 | P1 | 0.3d |

---

## UI/UX 与代码质量清单

| # | 问题 | 位置 | 整改 | 优先级 | 工时 |
|---|---|---|---|---|---|
| 1 | any 类型滥用 35+ 处（chatLogService）+ 16-32 处（其他大文件） | 多处 | 替换为强类型 + eslint 规则 | P2 | 2d |
| 2 | console.log 调试输出 50+ 处（chatLogService）+ 101 处（WritingMode）+ 36 处（useChapterGeneration） | 多处 | 统一改用 logger | P3 | 1.5d |
| 3 | `characterChatStore.ChatMessage` 类型与运行时不符 | characterChatStore.ts:4-9 | 扩展接口或抽 `PersistedChatMessage` | P1 | 0.3d |
| 4 | `ExternalTableProcessingService` 读取不存在 `filePath` 字段 | chatLogService.ts:3532-3667 | 修复返回值 | P1 | 0.3d |
| 5 | Dashboard 图标别名冗余 | Dashboard.tsx:13-17 | 按语义引入不同图标 | P3 | 0.1d |
| 6 | 世界书 store 与组件本地状态重复（tags/associations/worldBookDir） | worldBookStore.ts vs WorldBookManager.tsx | 组件订阅 store | P1 | 0.5d |
| 7 | CreationCenter 直接 import WritingModeEntry 强耦合 | CreationCenter.tsx:11 | lazy mount 解耦 | P3 | 0.5d |

---

## 优先级与工时总览

| 优先级 | 问题数 | 累计工时 | 说明 |
|--------|--------|----------|------|
| P0 | 15 | ~33 人天 | 数据正确性 bug、核心技术底座重构、超大文件拆分（含性能修复） |
| P1 | 18 | ~22 人天 | 重复代码消除、状态管理优化、中等组件拆分、类型契约 |
| P2 | 10 | ~9 人天 | 性能优化、虚拟列表、any 治理、架构一致性 |
| P3 | 7 | ~3.5 人天 | 代码质量、死代码清理、UI 细节 |
| **合计** | **50** | **~67.5 人天** | 建议分 4 个迭代推进 |

### 迭代规划建议
- **迭代 1（P0 核心底座，~10 人天）**：EmbeddingService Facade 化、向量三层抽象、AI 引擎统一、PromptOptimizer 删除、delayUntilRecursion 修复、processMessagesCore 性能、向量性能修复
- **迭代 2（P0 超大文件拆分，~23 人天）**：WorldBookManager、chatLogService、WritingStorageService、WritingModeRightPanel、CharacterManager、writingHandlers/memoryHandlers 拆分
- **迭代 3（P1 重复消除与状态优化，~22 人天）**：AIConfigProvider、creativeStore 工厂化、useChapterGeneration、重复函数统一、类型契约、组件中等拆分
- **迭代 4（P2/P3 质量与性能，~12.5 人天）**：any 治理、console 清理、虚拟列表、路由配置化、死代码清理

每个迭代内任务可并行推进，迭代间存在依赖（如 P0 拆分完成后再做 P1 重复消除可避免返工）。
