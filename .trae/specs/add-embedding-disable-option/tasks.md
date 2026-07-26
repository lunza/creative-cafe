# Tasks

- [x] Task 1: 扩展 `EmbeddingMode` 类型定义，添加 `'disabled'` 取值
  - [x] SubTask 1.1: 修改 `src/main/types/vectorConfig.ts` 的 `EmbeddingMode` 类型
  - [x] SubTask 1.2: 修改 `src/renderer/types/vectorConfig.ts` 的 `EmbeddingMode` 类型
  - [x] SubTask 1.3: 检查 `src/renderer/stores/vectorStore.ts` 的 `mode` 字段类型，如需同步则更新
  - [x] SubTask 1.4: 检查 `src/shared/settings.ts` 和 `src/renderer/types/setting.ts` 的相关类型，确保 `'disabled'` 取值被接受

- [x] Task 2: 修改 `VectorConfigPanel.tsx` 的 UI，添加"禁用"选项与置灰联动
  - [x] SubTask 2.1: 在 `renderModeSection` 的 Embedding 模式 Select 中追加"禁用"Option，使用灰色文字样式（如 `style={{ color: '#999' }}`）视觉区分
  - [x] SubTask 2.2: 为"禁用"Option 附近添加 Tooltip，说明禁用向量化的影响范围
  - [x] SubTask 2.3: 修改 `handleModeChange`，当 `newMode === 'disabled'` 时跳过维度推断与 `MODE_FIELD_MAP` 字段保留逻辑，仅 `form.setFieldsValue({ embeddingMode: 'disabled' })` 并 `setActiveEmbeddingMode('disabled')`
  - [x] SubTask 2.4: 在 `renderModeSection` 添加 `activeEmbeddingMode === 'disabled'` 分支：渲染 Alert 警示文案，并将除 Embedding 模式下拉外的所有 Form 控件区域（modeFields / renderCommonSection / renderRetrievalSection / renderAutomationSection / 测试按钮组）置为 `disabled`
  - [x] SubTask 2.5: 确保 `initializeForm` 能正确从 `settings.vector.embeddingMode === 'disabled'` 初始化面板到禁用状态

- [x] Task 3: 修改 `VectorConfigManager.ts` 的 `validateConfig`，接受 `embeddingMode === 'disabled'`
  - [x] SubTask 3.1: 修改 `validateConfig` 中的 `embeddingMode` 合法值检查，从 `['remote', 'local']` 扩展为 `['remote', 'local', 'disabled']`
  - [x] SubTask 3.2: 修改远程 API 配置校验逻辑，仅当 `embeddingMode === 'remote'` 时检查 `remoteApiUrl` / `remoteApiKey`（disabled 模式跳过）
  - [x] SubTask 3.3: 验证 `sanitizeConfig` 不会因 `'disabled'` 取值而过滤字段（白名单已含 `embeddingMode`，预期无需修改，确认即可）

- [x] Task 4: 在 `EmbeddingService.ts` 添加 disabled 模式短路逻辑
  - [x] SubTask 4.1: 修改 `generateEmbedding(text)`，在 `ensureConfigLoaded` 后检查 `embeddingMode === 'disabled'`，立即返回 `{ success: false, error: '向量化已禁用' }` 并记录 debug 日志
  - [x] SubTask 4.2: 修改 `generateEmbeddingBatch(texts)`（如存在）或 `generateBatch`，添加同样的短路检查
  - [x] SubTask 4.3: 检查 `testConnection` / `testLocalConnection` 等测试方法，disabled 模式下返回明确错误（不进行实际连接测试）

- [x] Task 5: 在 `ChatVectorizationService.ts` 添加 disabled 模式短路逻辑
  - [x] SubTask 5.1: 修改 `vectorizeIncremental(chatId, messages)`，在入口处读取 `vectorConfigManager.loadVectorConfig().embeddingMode`，若为 `'disabled'` 立即返回 `{ success: true, skipped: true, reason: 'disabled' }` 并记录 info 日志
  - [x] SubTask 5.2: 检查 `vectorize(chatId, messages)`（全量向量化，如存在）添加同样短路
  - [x] SubTask 5.3: 检查 `retrieve(chatId, queryText, topK, minScore)`，disabled 模式下返回空数组（检索功能停用）

- [x] Task 6: 在 `KnowledgeBaseService.ts` 和 `worldBookService.ts` 添加 disabled 模式短路逻辑
  - [x] SubTask 6.1: 修改 `KnowledgeBaseService` 的 `vectorize(id)` / `vectorizeAll()` 方法，disabled 模式下返回 `{ success: false, error: '向量化已禁用，请先在系统设置中启用向量化' }`
  - [x] SubTask 6.2: 修改 `worldBookService` 的 `vectorize(path)` 方法，disabled 模式下返回同样错误
  - [x] SubTask 6.3: 检查两个 Service 中的自动向量化触发点（创建/编辑知识库、创建/编辑世界书），disabled 模式下跳过

- [x] Task 7: 验证配置持久化与状态恢复
  - [x] SubTask 7.1: 验证 `settings.json` 中 `vector.embeddingMode === "disabled"` 能被 `VectorConfigPanel` 正确加载并初始化到禁用状态
  - [x] SubTask 7.2: 验证 `ConfigCleanupService` 不会在配置清理时误删 `embeddingMode: 'disabled'` 字段
  - [x] SubTask 7.3: 验证从 disabled 切换回 remote/local 后，所有 Form 控件恢复可用，且维度字段按原有逻辑恢复默认值

# Task Dependencies
- Task 2 依赖 Task 1（UI 需要新类型才能通过类型检查）
- Task 4 / 5 / 6 依赖 Task 1（服务层短路检查需要新类型）
- Task 3 可与 Task 2 / 4 / 5 / 6 并行（独立修改 VectorConfigManager）
- Task 7 依赖 Task 1-6 全部完成
