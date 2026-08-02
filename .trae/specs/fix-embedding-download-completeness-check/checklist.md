# Checklist

## 校验函数

- [x] `modelFileValidator.ts` 导出 `validateModelFiles(modelPath)` 函数，返回 `{ valid, missing, onnxFile, quantized }`
- [x] 校验 tokenizer.json / tokenizer_config.json / config.json / special_tokens_map.json 存在且非空
- [x] ONNX 多格式候选校验：model_quantized.onnx > model_int8.onnx > model_uint8.onnx > model_q4.onnx > model.onnx
- [x] 空文件（size === 0）被标注为 `(empty)` 加入 missing 列表

## ModelDownloadService 改造

- [x] `isModelDownloaded` 调用 `validateModelFiles`，全部通过才返回 true（不再仅检查目录非空）
- [x] `downloadModel` 在 `downloadModelFromHF` 返回 success 后调用 `validateModelFiles` 做最终校验
- [x] 下载后校验失败时返回 `{ success: false, error: "下载后文件仍不完整: <missing>" }`，前端显示「下载失败」
- [x] 下载后校验通过时返回 `{ success: true, localPath }`，前端显示「下载完成」

## modelDownloader 收紧判定

- [x] `downloadedFiles >= 4` 替换为 `validateModelFiles` 调用
- [x] ModelScope CLI 下载成功后也做文件校验（msResult.success 时校验文件，不完整则回退 HF 源）

## EmbeddingWorkerService 重构

- [x] `validateModelFiles` 改为调用 `modelFileValidator.validateModelFiles`，返回值结构不变
- [x] `initializeLocalModel` 中 `fileCheck.onnxFile` / `fileCheck.quantized` 引用仍正确
- [x] `reorganizeModelFiles` 逻辑保持不变（仍在 validateModelFiles 之前执行）

## 单元测试

- [x] `modelFileValidator` 测试覆盖：完整文件 / 缺失 ONNX / 空文件 / 多格式候选
- [x] `ModelDownloadService.isModelDownloaded` 测试覆盖：目录不存在 / 目录空 / 文件不全 / 文件齐全

## 回归验证

- [x] 0.6B 模型（有 model_quantized.onnx）通过 `validateModelFiles` 校验
- [x] `node scripts/repro-embedding-test.js` 输出 dimension = 1024（0.6B 模型加载成功）

## 文档

- [x] `docs/FIX_RECORDS.md` 新增章节记录 isModelDownloaded 误判修复（重点标记）
