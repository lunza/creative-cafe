# 向量模型升级与维度切换架构 Spec

## Why
当前系统使用 3 个未实际投入使用的 384 维本地嵌入模型（all-MiniLM-L6-v2、paraphrase-multilingual-MiniLM-L12-v2、gte-small），与生产环境远程模型（qwen3-embedding-8b，4096 维）维度严重不匹配。需要：(1) 将本地模型统一替换为 qwen3-emb-0.6b（1024 维）作为统一的本地降级方案；(2) 构建支持 1024 维和 4096 维向量数据独立共存、自适应切换的底层架构，确保远程不可用时本地可作为临时替代，且两种维度的向量数据互不干扰。

## What Changes
- 将 3 个 384 维本地模型选项替换为单一的 `qwen3-emb-0.6b`（1024 维）选项
- 更新所有硬编码的默认模型回退引用（3 处服务层 + 1 处 UI 默认配置）
- 在渲染进程 VectorConfig 类型中补充 `dimension` 字段（与主进程类型对齐）
- 更新 `inferDimensionFromModel` 识别 qwen3-emb-0.6b → 1024 维
- **BREAKING** 修改向量存储路径包含维度：`vectors/{source}/{id}/{dimension}/vecstore.json`
- 变更维度切换行为：从"重建空存储"改为"加载对应维度的已有存储"
- 在 VectorConfigPanel 添加维度选择/展示 UI
- 实现存量 4096 维数据自动迁移到新路径结构
- 默认维度配置：本地模式 1024，远程模式 4096

## Impact
- Affected specs: 无（首次涉及向量架构的 spec）
- Affected code:
  - `src/renderer/components/Vector/VectorConfigPanel.tsx`（模型选项、维度 UI、DEFAULT_CONFIGS）
  - `src/main/services/EmbeddingWorkerService.ts`（默认模型回退、维度处理）
  - `src/renderer/services/rendererEmbeddingService.ts`（默认模型回退）
  - `src/main/services/VecstoreVectorStore.ts`（存储路径、维度切换、维度推断、reset 默认值）
  - `src/main/services/VectorStoreService.ts`（维度切换事件处理）
  - `src/main/services/VectorRepository.ts`（维度切换传递）
  - `src/main/services/VectorConfigManager.ts`（维度配置持久化白名单）
  - `src/main/types/vectorConfig.ts`（维度类型约束）
  - `src/renderer/types/vectorConfig.ts`（补充 dimension 字段）
  - `src/main/services/vector/IVectorBackend.ts`（维度切换接口契约）

## ADDED Requirements

### Requirement: 维度隔离的向量存储
系统 SHALL 为每个 (source, sourceId, dimension) 组合维护独立的向量存储文件，路径格式为 `userData/vectors/{source}/{safeSourceId}/{dimension}/vecstore.json`，确保不同维度的向量数据物理隔离、互不干扰。

#### Scenario: 1024 维和 4096 维数据共存
- **WHEN** 用户先使用本地模式（1024 维）向量化数据，再切换到远程模式（4096 维）向量化数据
- **THEN** 两个维度的 vecstore.json 文件分别存在于 `{dimension}/vecstore.json` 路径下
- **AND** 切换回 1024 维时，能加载到之前存储的 1024 维向量数据

#### Scenario: 维度切换不丢失数据
- **WHEN** 用户从 4096 维切换到 1024 维
- **THEN** 4096 维的 vecstore.json 文件保留在原路径
- **AND** 系统加载 1024 维路径下的 vecstore.json（若存在），或初始化空存储（若不存在）
- **AND** 切换过程中不删除任何维度的数据

### Requirement: 维度自适应检索
系统 SHALL 在向量检索时根据当前配置的维度自动选择对应维度的存储，上层应用无需感知维度差异。

#### Scenario: 检索自动匹配维度
- **WHEN** 当前配置维度为 1024，调用 vector:search
- **THEN** 系统从 1024 维存储路径加载向量进行相似度计算
- **AND** 返回结果维度与查询维度一致

#### Scenario: 维度不匹配的查询
- **WHEN** 查询向量维度与当前存储维度不一致
- **THEN** 系统返回空结果（现有行为保留），并记录警告日志

### Requirement: 维度配置接口
系统 SHALL 在 VectorConfig 中提供显式的 `dimension` 字段，取值为 1024 或 4096，用于配置当前向量维度。

#### Scenario: 本地模式默认维度
- **WHEN** 用户选择本地嵌入模式（local）
- **THEN** 默认 dimension 自动设为 1024（对应 qwen3-emb-0.6b）

#### Scenario: 远程模式默认维度
- **WHEN** 用户选择远程嵌入模式（remote）
- **THEN** 默认 dimension 自动设为 4096（对应 qwen3-embedding-8b）
- **AND** 用户可手动修改为其他维度（兼容其他远程模型）

### Requirement: 存量数据自动迁移
系统 SHALL 在首次启动新版本时，自动将旧路径结构（`vectors/{source}/{id}/vecstore.json`）的存量数据迁移到新路径结构（`vectors/{source}/{id}/{dimension}/vecstore.json`），迁移维度根据存量数据的实际维度推断。

#### Scenario: 迁移 4096 维存量数据
- **WHEN** 系统启动时检测到旧路径存在 vecstore.json，且新路径不存在
- **THEN** 读取 vecstore.json 中的向量维度
- **AND** 将文件移动到 `vectors/{source}/{id}/{inferredDimension}/vecstore.json`
- **AND** 记录迁移日志

#### Scenario: 已迁移则跳过
- **WHEN** 新路径已存在 vecstore.json
- **THEN** 跳过迁移，保留新路径数据

#### Scenario: 迁移失败容错
- **WHEN** 旧 vecstore.json 损坏无法读取维度
- **THEN** 记录错误日志，跳过该文件的迁移，不阻塞其他文件迁移

## MODIFIED Requirements

### Requirement: 本地嵌入模型
系统 SHALL 仅支持 `qwen3-emb-0.6b`（1024 维）作为本地嵌入模型选项，移除原有的 3 个 384 维模型选项。

#### Scenario: 本地模型选择
- **WHEN** 用户在向量配置面板查看本地模型选项
- **THEN** 仅显示 `qwen3-emb-0.6b` 一个选项
- **AND** 默认选中该选项

#### Scenario: 模型加载
- **WHEN** 系统初始化本地嵌入模型
- **THEN** 使用 `qwen3-emb-0.6b` 作为默认模型名
- **AND** 若用户未配置模型，回退到 `qwen3-emb-0.6b` 而非 `Xenova/all-MiniLM-L6-v2`

### Requirement: 维度切换处理
系统 SHALL 在检测到维度配置变更时，加载目标维度对应的存储文件，而非重建空存储。

#### Scenario: 维度切换加载对应存储
- **WHEN** VECTOR_DIMENSION_CHANGE_EVENT 触发，新维度为 1024
- **THEN** VecstoreBackend 加载 `vectors/{source}/{id}/1024/vecstore.json`
- **AND** 若该文件存在，恢复其中的向量数据
- **AND** 若该文件不存在，初始化空存储

#### Scenario: 维度切换不中断服务
- **WHEN** 维度切换发生时
- **THEN** 切换完成后系统立即可用于新的向量操作
- **AND** 切换过程不阻塞主进程超过 2 秒

### Requirement: 维度推断
系统 SHALL 在 `inferDimensionFromModel` 中识别 qwen3-emb-0.6b 模型并返回 1024 维，识别 qwen3-embedding-8b 模型并返回 4096 维。

#### Scenario: 推断本地模型维度
- **WHEN** 调用 inferDimensionFromModel('qwen3-emb-0.6b')
- **THEN** 返回 1024

#### Scenario: 推断远程模型维度
- **WHEN** 调用 inferDimensionFromModel('qwen3-embedding-8b')
- **THEN** 返回 4096

### Requirement: VecstoreBackend 默认维度
系统 SHALL 不再硬编码默认维度为 384，改为从 VectorConfig 配置中读取 dimension 字段，若无配置则根据 embeddingMode 推断（local→1024，remote→4096）。

#### Scenario: 从配置读取维度
- **WHEN** VecstoreBackend 初始化
- **THEN** dimension 从 vectorConfig.dimension 读取
- **AND** 若 dimension 未配置，根据 embeddingMode 推断默认值

## REMOVED Requirements

### Requirement: 384 维本地模型支持
**Reason**: 3 个 384 维 Xenova 模型尚未投入实际使用，且与目标远程模型（4096 维）维度差距过大，无保留价值
**Migration**: 无需迁移（模型未实际使用），直接从选项列表移除
