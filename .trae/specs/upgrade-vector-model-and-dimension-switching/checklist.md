# Checklist

## 模型替换
- [x] qwen3-emb-0.6b 的 ONNX 量化版本模型名已确认，transformers.js 可正常加载
- [x] VectorConfigPanel.tsx 的 DEFAULT_CONFIGS.local.localModel 已改为 qwen3-emb-0.6b
- [x] VectorConfigPanel.tsx 的本地模型 Option 列表仅包含 qwen3-emb-0.6b（3 个 Xenova 选项已移除）
- [x] EmbeddingWorkerService.ts 中 3 处硬编码回退（L98, L198, L210）已更新为 qwen3-emb-0.6b
- [x] rendererEmbeddingService.ts 中硬编码回退（L26）已更新为 qwen3-emb-0.6b

## 维度推断
- [x] inferDimensionFromModel 能正确识别 qwen3-emb-0.6b 返回 1024
- [x] inferDimensionFromModel 能正确识别 qwen3-embedding-8b 返回 4096
- [x] 3 个 Xenova 模型的维度映射已移除，无残留副作用

## 维度隔离存储
- [x] getStoreFilePath() 路径包含 dimension 子目录：`vectors/{source}/{safeSourceId}/{dimension}/vecstore.json`
- [x] dimension 为 undefined 时有合理的回退推断逻辑（不抛错）
- [x] store reset 不再硬编码 384，改为从配置读取或按 embeddingMode 推断
- [x] 1024 维和 4096 维数据物理存储在不同文件中

## 维度切换
- [x] handleDimensionChange 加载对应维度存储文件（而非重建空存储）
- [x] 维度切换不删除另一维度的数据文件
- [x] 维度切换事件传递链路完整（VectorStoreService → VectorRepository → VecstoreBackend）
- [x] 切换过程不阻塞主进程超过 2 秒

## 类型与 UI
- [x] src/renderer/types/vectorConfig.ts 包含 dimension 字段（类型 1024 | 4096）
- [x] src/main/types/vectorConfig.ts 的 dimension 类型与渲染进程对齐
- [x] VectorConfigPanel 显示当前维度
- [x] 维度选择 UI 支持 1024/4096 切换，带说明文案
- [x] embeddingMode 切换时维度自动联动（local→1024，remote→4096）
- [x] 用户可手动覆盖自动联动的维度值

## 数据迁移
- [x] 检测旧路径结构（无 dimension 子目录）的逻辑正确
- [x] 迁移时正确读取存量 vecstore.json 的向量维度
- [x] 迁移失败（文件损坏等）有日志记录和容错处理，不阻塞其他迁移
- [x] 迁移幂等——新路径已存在时跳过
- [x] 迁移日志可在应用日志中查看

## 默认配置
- [x] DEFAULT_CONFIGS.remote 包含 dimension: 4096
- [x] DEFAULT_CONFIGS.local 包含 dimension: 1024
- [x] VectorConfigManager 持久化白名单包含 dimension 字段
- [x] handleModeChange 中包含维度联动逻辑

## 集成验证
- [x] 本地模式生成 1024 维向量并正确存储到 1024/vecstore.json
- [x] 远程模式生成 4096 维向量并正确存储到 4096/vecstore.json
- [x] 维度切换后加载对应维度的存储（非空存储）
- [x] 1024↔4096 来回切换，两边数据都保留
- [x] 存量数据迁移正确执行（旧路径文件移动到新路径）
- [x] 检索时自动匹配当前维度存储
- [x] 维度不匹配的查询返回空结果并记录警告
- [x] `npx tsc --noEmit` 无新增错误（基线 821 个）
