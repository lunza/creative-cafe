# 向量模型配置 Embedding 模式"禁用"选项 Spec

## Why
当前系统设置中的向量模型配置界面只提供"远程 API 模式"和"本地模型模式"两个 Embedding 模式选项，用户无法完全关闭向量化功能。部分用户场景下（如纯本地对话、调试、性能优化、不依赖 RAG 检索的使用方式），向量化服务会持续在后台触发 IPC 调用、占用 CPU/网络/磁盘资源，且相关错误日志噪音影响诊断体验。需要一个明确的"禁用"选项，让用户彻底关闭向量化服务，并同步禁用所有相关 UI 交互元素。

## What Changes
- **扩展 `EmbeddingMode` 类型**：在 `'remote' | 'local'` 基础上新增 `'disabled'` 取值
- **UI 下拉列表新增"禁用"选项**：在 `VectorConfigPanel.tsx` 的 Embedding 模式 Select 中追加"禁用"选项，以灰色不可选样式视觉区分（注：用户原文要求"该选项应显示为灰色不可选状态"，但实际功能是允许选择该选项；解读为选项本身在视觉上以灰色样式呈现以区别于其他可用模式，且选中后整个面板置灰。下方 Scenario 明确此语义）
- **禁用状态联动 UI 置灰**：选中"禁用"后，向量模型配置卡片内的所有 Form 控件（远程 API、本地模型、维度、缓存、检索参数、自动化设置、测试按钮等）同步置灰为 `disabled` 状态，保留"Embedding 模式"下拉本身可操作以便用户随时切换回可用模式
- **后端服务短路返回**：在 `EmbeddingService.generateEmbedding`、`EmbeddingService.generateEmbeddingBatch`、`ChatVectorizationService.vectorizeIncremental`、`KnowledgeBaseService` 向量化入口、`worldBookService` 向量化入口等所有向量化调用入口，检测到 `embeddingMode === 'disabled'` 时立即短路返回 `{ success: false, error: '向量化已禁用' }`（或等价跳过逻辑），确保不产生任何后台向量化请求
- **持久化禁用状态**：禁用状态写入 `settings.json` 的 `vector.embeddingMode` 字段，刷新页面或重新进入设置界面后保持
- **工具提示说明**：禁用选项提供 Tooltip 说明"禁用后所有向量化相关功能将停止，包括世界书/知识库自动向量化、聊天历史向量化检索、RAG 上下文注入等"
- **配置字段白名单同步**：`VectorConfigManager`、`ConfigCleanupService`、`vectorConfigSchema.ts` 三处白名单已包含 `embeddingMode` 字段，无需新增字段；但需确保 `sanitizeConfig` 不会过滤掉 `'disabled'` 取值
- **BREAKING**：`EmbeddingMode` 类型从 `'remote' | 'local'` 扩展为 `'remote' | 'local' | 'disabled'`，所有持有该类型的代码路径需兼容新取值

## Impact
- Affected specs:
  - `upgrade-vector-model-and-dimension-switching`（维度切换逻辑需兼容 disabled 模式，跳过维度推断）
  - `modelscope-default-and-dimension-autoswitch`（本地模型选择联动维度逻辑需在 disabled 模式下跳过）
- Affected code:
  - `src/main/types/vectorConfig.ts` — `EmbeddingMode` 类型扩展
  - `src/renderer/types/vectorConfig.ts` — `EmbeddingMode` 类型同步扩展
  - `src/renderer/components/Vector/VectorConfigPanel.tsx` — 下拉选项、UI 置灰联动、Tooltip
  - `src/main/services/EmbeddingService.ts` — `generateEmbedding` / `generateEmbeddingBatch` 入口短路
  - `src/main/services/ChatVectorizationService.ts` — `vectorizeIncremental` 入口短路
  - `src/main/services/KnowledgeBaseService.ts` — 向量化入口短路
  - `src/main/services/worldBookService.ts` — 向量化入口短路
  - `src/main/services/VectorConfigManager.ts` — `validateConfig` 接受 `'disabled'` 取值
  - `src/main/services/storageService.ts` — 默认配置兼容（如需）
  - `src/shared/settings.ts` — 默认配置兼容（如需）
  - `src/renderer/services/rendererEmbeddingService.ts` — 渲染层调用前置检查（可选优化，主进程短路已足够）
  - `src/renderer/stores/vectorStore.ts` — `setMode` 类型扩展（如需）

## ADDED Requirements

### Requirement: Embedding 模式"禁用"选项
系统 SHALL 在向量模型配置面板的 Embedding 模式下拉列表中提供一个"禁用"选项，允许用户彻底关闭向量化服务。

#### Scenario: 禁用选项在 UI 中的视觉呈现
- **WHEN** 用户打开系统设置 → 向量模型配置面板
- **THEN** Embedding 模式下拉列表显示 3 个选项：远程 API 模式、本地模型模式、禁用
- **AND** "禁用"选项在列表中以灰色文字呈现，与其他两个可用模式视觉区分
- **AND** "禁用"选项可被选中（不是 `disabled` 属性的不可选 option）

#### Scenario: 选择"禁用"选项后面板置灰
- **WHEN** 用户从 Embedding 模式下拉选择"禁用"
- **THEN** 向量模型配置卡片内除 Embedding 模式下拉本身外的所有 Form 控件（包括但不限于：远程 API 配置组、本地模型选择、向量维度、缓存配置、检索参数、自动化设置、测试嵌入连接按钮、测试存储连接按钮）同步置灰为 `disabled` 状态
- **AND** Embedding 模式下拉保持可用，允许用户随时切换回远程 API 模式或本地模型模式
- **AND** 面板顶部或下拉附近显示警示文案（如 Alert 提示），说明"向量化已禁用，所有 RAG 检索/自动向量化功能将停止"

#### Scenario: 禁用选项的工具提示
- **WHEN** 用户悬停在"禁用"选项或其附近的问号图标上
- **THEN** 显示 Tooltip，内容说明禁用向量化的影响范围："禁用后所有向量化相关功能将停止，包括世界书/知识库自动向量化、聊天历史向量化检索、RAG 上下文注入等。已存储的向量数据保留，重新启用后可继续使用。"

### Requirement: 禁用状态下后端服务短路
系统 SHALL 在 `embeddingMode === 'disabled'` 时，所有向量化服务调用入口立即短路返回，不产生任何后台向量化请求（IPC 调用、网络请求、磁盘 IO）。

#### Scenario: EmbeddingService.generateEmbedding 在禁用时短路
- **WHEN** `embeddingMode === 'disabled'`，任何调用方调用 `EmbeddingService.generateEmbedding(text)`
- **THEN** 立即返回 `{ success: false, error: '向量化已禁用' }`
- **AND** 不触发任何网络请求或本地模型加载
- **AND** 记录 debug 级别日志 `[EmbeddingService] 向量化已禁用，跳过 generateEmbedding`

#### Scenario: ChatVectorizationService.vectorizeIncremental 在禁用时短路
- **WHEN** `embeddingMode === 'disabled'`，触发 `chatHistory:vectorizeIncremental` IPC
- **THEN** 立即返回 `{ success: true, skipped: true, reason: 'disabled' }`（保持 success: true 避免触发错误处理路径）
- **AND** 不调用 EmbeddingService，不读写向量存储
- **AND** 记录 info 级别日志 `[ChatVectorizationService] 向量化已禁用，跳过增量向量化`

#### Scenario: 知识库/世界书向量化在禁用时短路
- **WHEN** `embeddingMode === 'disabled'`，触发 `knowledge:vectorize` / `knowledge:vectorizeAll` / `worldBook:vectorize` IPC
- **THEN** 立即返回 `{ success: false, error: '向量化已禁用，请先在系统设置中启用向量化' }`（手动触发的向量化明确告知用户原因）
- **AND** 不调用 EmbeddingService
- **AND** 记录 info 级别日志

#### Scenario: 禁用状态下自动向量化开关被覆盖
- **WHEN** `embeddingMode === 'disabled'`，且 `autoVectorizeWorldBook === true` 或 `autoVectorizeKnowledge === true`
- **THEN** 自动向量化逻辑在入口处检测到 disabled 模式后跳过执行
- **AND** 不修改用户配置的 `autoVectorizeWorldBook` / `autoVectorizeKnowledge` 开关状态（用户重新启用向量化后开关恢复生效）

### Requirement: 禁用状态持久化
系统 SHALL 将"禁用"选择持久化到 `settings.json` 的 `vector.embeddingMode` 字段，确保页面刷新或重新进入设置界面后状态保持。

#### Scenario: 禁用状态保存
- **WHEN** 用户选择"禁用"选项并点击保存设置
- **THEN** `settings.json` 的 `vector.embeddingMode` 字段写入 `"disabled"`
- **AND** `VectorConfigManager.saveVectorConfig` 接受并持久化该取值
- **AND** `sanitizeConfig` 白名单不过滤掉 `'disabled'` 取值

#### Scenario: 禁用状态加载
- **WHEN** 用户刷新页面或重新进入设置界面
- **AND** `settings.json` 中 `vector.embeddingMode === "disabled"`
- **THEN** VectorConfigPanel 初始化时 Embedding 模式下拉自动选中"禁用"
- **AND** 所有相关 Form 控件同步置灰

#### Scenario: 禁用状态下维度字段处理
- **WHEN** `embeddingMode === 'disabled'`
- **THEN** `dimension` 字段保持原值不变（不强制覆盖）
- **AND** `handleModeChange` 在切换到 disabled 模式时不执行维度推断
- **AND** 用户切换回 remote/local 模式时，按原有逻辑恢复默认维度（remote→4096, local→按模型推断）

## MODIFIED Requirements

### Requirement: EmbeddingMode 类型定义
`EmbeddingMode` 类型 SHALL 包含 `'remote'`、`'local'`、`'disabled'` 三个取值，分别对应远程 API 模式、本地模型模式、禁用模式。所有持有 `EmbeddingMode` 类型的代码路径（主进程 / 渲染进程 / 共享类型）SHALL 同步更新类型定义并兼容新取值。

#### Scenario: 类型定义同步
- **WHEN** 开发者查看 `src/main/types/vectorConfig.ts` 和 `src/renderer/types/vectorConfig.ts`
- **THEN** `EmbeddingMode` 类型定义为 `'remote' | 'local' | 'disabled'`

### Requirement: VectorConfigManager.validateConfig 接受 disabled
`VectorConfigManager.validateConfig` SHALL 接受 `embeddingMode === 'disabled'` 为合法取值，不再要求 disabled 模式下必须配置 remoteApiUrl / remoteApiKey。

#### Scenario: disabled 模式跳过远程配置校验
- **WHEN** 调用 `validateConfig({ embeddingMode: 'disabled' })`
- **THEN** 返回 `{ valid: true, errors: [] }`
- **AND** 不检查 `remoteApiUrl` / `remoteApiKey` 是否存在

### Requirement: VectorConfigPanel handleModeChange 兼容 disabled
`handleModeChange` SHALL 在切换到 `'disabled'` 模式时跳过维度推断和模式特定字段保留逻辑，仅更新 `embeddingMode` 字段并触发 UI 置灰。

#### Scenario: 切换到 disabled 模式
- **WHEN** 用户从 remote/local 切换到 disabled
- **THEN** `form.setFieldsValue({ embeddingMode: 'disabled' })`
- **AND** 不修改 `dimension` / `remoteModel` / `localModel` 等字段（保留用户已填值，便于切换回原模式时恢复）
- **AND** 触发面板置灰状态

## REMOVED Requirements
无
