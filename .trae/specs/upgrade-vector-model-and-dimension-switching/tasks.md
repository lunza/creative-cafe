# Tasks

- [x] Task 1: 替换本地嵌入模型定义为 qwen3-emb-0.6b
  - [x] SubTask 1.1: 确认 qwen3-emb-0.6b 的 ONNX 量化版本在 HuggingFace 上的确切模型名（如 electroglyph/Qwen3-Embedding-0.6B-ONNX-uint8 或 Xenova 等价物），并确认 transformers.js pipeline 可正常加载该模型
  - [x] SubTask 1.2: 更新 `src/renderer/components/Vector/VectorConfigPanel.tsx` 的 DEFAULT_CONFIGS.local.localModel（L34）为 qwen3-emb-0.6b 对应的模型名
  - [x] SubTask 1.3: 替换 `src/renderer/components/Vector/VectorConfigPanel.tsx` L640-660 的 3 个 384 维模型 `<Option>` 为单一 qwen3-emb-0.6b 选项
  - [x] SubTask 1.4: 更新 `src/main/services/EmbeddingWorkerService.ts` 中 3 处硬编码回退（L98, L198, L210）为 qwen3-emb-0.6b
  - [x] SubTask 1.5: 更新 `src/renderer/services/rendererEmbeddingService.ts` L26 的硬编码回退为 qwen3-emb-0.6b

- [x] Task 2: 更新维度推断逻辑识别 qwen3 系列
  - [x] SubTask 2.1: 在 `src/main/services/VecstoreVectorStore.ts` 的 inferDimensionFromModel（L290-319）中添加 qwen3-emb-0.6b → 1024 的映射
  - [x] SubTask 2.2: 确认 qwen3-embedding-8b → 4096 的映射已存在，若不存在则添加
  - [x] SubTask 2.3: 移除 3 个 Xenova 模型（all-MiniLM-L6-v2、paraphrase-multilingual-MiniLM-L12-v2、gte-small）的维度映射，避免混淆

- [x] Task 3: 实现维度隔离的向量存储路径
  - [x] SubTask 3.1: 修改 `src/main/services/VecstoreVectorStore.ts` 的 getStoreFilePath()（L373-379），在路径中包含 dimension：`vectors/{source}/{safeSourceId}/{dimension}/vecstore.json`
  - [x] SubTask 3.2: 确保 getStoreFilePath 调用时 dimension 字段已正确初始化（从 vectorConfig 读取或推断），处理 dimension 为 undefined 的边界情况
  - [x] SubTask 3.3: 更新 store reset 逻辑（L993 附近的 `this.dimension = 384`），改为从配置读取或根据 embeddingMode 推断

- [x] Task 4: 实现维度切换加载对应存储（而非重建）
  - [x] SubTask 4.1: 修改 `src/main/services/VecstoreVectorStore.ts` 的 handleDimensionChange（L331-360），从"重建空存储"改为"加载目标维度对应的存储文件"
  - [x] SubTask 4.2: 确保切换时旧维度的数据文件保留不被删除
  - [x] SubTask 4.3: 验证 `src/main/services/VectorRepository.ts` 的 handleDimensionChange（L513-521）和 `src/main/services/VectorStoreService.ts` 的 setupDimensionChangeListener（L425-437）的传递链路在新逻辑下正确工作

- [x] Task 5: 补充渲染进程类型与维度 UI
  - [x] SubTask 5.1: 在 `src/renderer/types/vectorConfig.ts` 中添加 `dimension?: 1024 | 4096` 字段到 VectorDefaults 类型
  - [x] SubTask 5.2: 在 `src/renderer/components/Vector/VectorConfigPanel.tsx` 中添加维度展示/选择 UI（显示当前维度，支持 1024/4096 切换，带说明文案）
  - [x] SubTask 5.3: 实现 embeddingMode 切换时维度的自动联动逻辑（local → 1024，remote → 4096），同时允许用户手动覆盖
  - [x] SubTask 5.4: 在 handleModeChange 中加入维度联动逻辑，切换模式时自动设置对应默认维度

- [x] Task 6: 实现存量数据自动迁移
  - [x] SubTask 6.1: 在 `src/main/services/VecstoreVectorStore.ts` 初始化时（或 VecstoreBackend 首次加载时）检测旧路径结构（路径无 dimension 子目录但存在 vecstore.json）
  - [x] SubTask 6.2: 读取旧 vecstore.json 的首条向量维度，将文件移动到 `vectors/{source}/{id}/{inferredDimension}/vecstore.json`
  - [x] SubTask 6.3: 记录迁移日志，处理迁移失败的情况（文件损坏、维度无法推断时跳过并记录错误日志，不阻塞其他文件迁移）
  - [x] SubTask 6.4: 确保迁移幂等——新路径已存在时跳过迁移

- [x] Task 7: 更新默认维度配置与持久化
  - [x] SubTask 7.1: 在 `src/renderer/components/Vector/VectorConfigPanel.tsx` 的 DEFAULT_CONFIGS.remote 中添加 `dimension: 4096`
  - [x] SubTask 7.2: 在 DEFAULT_CONFIGS.local 中添加 `dimension: 1024`
  - [x] SubTask 7.3: 确认 `src/main/services/VectorConfigManager.ts` 的持久化白名单（L34 附近）包含 dimension 字段，若不含则添加
  - [x] SubTask 7.4: 确认 `src/main/types/vectorConfig.ts` 的 VectorConfig 类型中 dimension 字段类型为 `1024 | 4096`（或 `number` 联合类型），与渲染进程类型对齐

- [x] Task 8: 集成验证
  - [x] SubTask 8.1: 验证本地模式生成 1024 维向量并存储到 `1024/vecstore.json` 路径
  - [x] SubTask 8.2: 验证远程模式生成 4096 维向量并存储到 `4096/vecstore.json` 路径
  - [x] SubTask 8.3: 验证维度切换后加载对应维度的存储文件（而非空存储）
  - [x] SubTask 8.4: 验证切换不删除另一维度数据（1024↔4096 来回切换数据都在）
  - [x] SubTask 8.5: 验证存量数据迁移正确执行（旧路径文件移动到新路径）
  - [x] SubTask 8.6: 运行 `npx tsc --noEmit` 类型检查，确认无新增错误（基线 821 个错误）

# Task Dependencies
- Task 2 依赖 Task 1（需要先确认 qwen3-emb-0.6b 模型名才能正确配置维度推断）
- Task 3 依赖 Task 2（存储路径需要正确的维度推断逻辑）
- Task 4 依赖 Task 3（维度切换加载需要新的存储路径结构）
- Task 5 依赖 Task 3（UI 维度展示需要后端存储路径支持）
- Task 6 依赖 Task 3（迁移目标路径需要新的 dimension 子目录结构）
- Task 7 独立，可与 Task 1-2 并行
- Task 8 依赖 Task 1-7 全部完成

# Parallelizable Work
- Task 1 和 Task 7 可并行（模型替换与默认配置更新无依赖）
- Task 5 的 UI 部分（SubTask 5.2）可与 Task 4 并行（UI 展示不依赖后端切换逻辑完成）
