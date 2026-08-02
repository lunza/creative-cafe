# Tasks

- [x] Task 1: 创建共享模型文件校验模块 `modelFileValidator.ts`
  - [x] SubTask 1.1: 新建 `src/main/services/modelFileValidator.ts`，导出 `validateModelFiles(modelPath)` 函数
  - [x] SubTask 1.2: 实现关键文件存在性 + 非空校验（tokenizer.json / tokenizer_config.json / config.json / special_tokens_map.json）
  - [x] SubTask 1.3: 实现 ONNX 多格式候选校验（model_quantized / model_int8 / model_uint8 / model_q4 / model.onnx），返回 `{ valid, missing, onnxFile, quantized }`
  - [x] SubTask 1.4: 空文件检测——文件存在但 size === 0 时标注为 `(empty)` 加入 missing 列表

- [x] Task 2: 改造 `ModelDownloadService` 使用共享校验函数
  - [x] SubTask 2.1: `isModelDownloaded` 改为调用 `validateModelFiles`，全部校验通过才返回 true
  - [x] SubTask 2.2: `downloadModel` 在 `downloadModelFromHF` 返回 success 后调用 `validateModelFiles` 做最终校验，校验失败返回 `{ success: false, error: "下载后文件仍不完整: <missing>" }`

- [x] Task 3: 收紧 `modelDownloader.ts` 成功判定
  - [x] SubTask 3.1: 将 `downloadedFiles >= 4` 替换为调用 `validateModelFiles` 校验关键文件齐全
  - [x] SubTask 3.2: 校验失败时返回 `{ success: false, error: "缺失文件: <missing>" }`

- [x] Task 4: 重构 `EmbeddingWorkerService.validateModelFiles` 使用共享校验函数
  - [x] SubTask 4.1: 将 `EmbeddingWorkerService.validateModelFiles` 改为调用 `modelFileValidator.validateModelFiles`，保持返回值结构不变
  - [x] SubTask 4.2: 确认 `initializeLocalModel` 中对 `fileCheck.onnxFile` / `fileCheck.quantized` 的引用仍然正确

- [x] Task 5: 编写单元测试
  - [x] SubTask 5.1: 为 `modelFileValidator.validateModelFiles` 编写测试（完整文件 / 缺失 ONNX / 空文件 / 多格式候选）
  - [x] SubTask 5.2: 为 `ModelDownloadService.isModelDownloaded` 编写测试（目录不存在 / 目录空 / 文件不全 / 文件齐全）

- [x] Task 6: 验证 0.6B 模型不回归
  - [x] SubTask 6.1: 确认 0.6B 模型（有 model_quantized.onnx）通过 `validateModelFiles` 校验
  - [x] SubTask 6.2: 运行 `node scripts/repro-embedding-test.js` 确认 0.6B 模型仍能加载

- [x] Task 7: 增量更新技术文档
  - [x] SubTask 7.1: 在 `docs/FIX_RECORDS.md` 新增章节记录本次修复（重点标记 isModelDownloaded 误判问题）

# Task Dependencies

- [Task 2] depends on [Task 1]
- [Task 3] depends on [Task 1]
- [Task 4] depends on [Task 1]
- [Task 5] depends on [Task 1, Task 2]
- [Task 6] depends on [Task 4]
- [Task 7] depends on [Task 6]
- [Task 2, Task 3, Task 4] 可并行
