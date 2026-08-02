# 修复嵌入模型下载完整性校验 Spec

## Why

用户点击「下载」按钮直接显示「Qwen3-Embedding-4B-ONNX 下载完成」，但点击「测试」按钮仍报「本地模型文件缺失或损坏: onnx/model_quantized.onnx」。

根因：`ModelDownloadService.isModelDownloaded` 仅检查模型目录非空（`files.length > 0`）即判定「已下载」，导致不完整/损坏的下载被跳过——`downloadModel` 据此直接返回 `{ success: true }`，前端误显示「下载完成」，但 ONNX 权重文件实际缺失或被截断。同时 `modelDownloader.ts` 的 `downloadedFiles >= 4` 判定也过于宽松（7 个文件只下 4 个就算成功），且 ModelScope CLI 下载中断后 exit code 仍为 0 时被误判为成功。

## What Changes

- **提取共享校验函数**：新建 `src/main/services/modelFileValidator.ts`，导出 `validateModelFiles(modelPath)` 函数，校验关键文件存在且非空（tokenizer.json / tokenizer_config.json / config.json / special_tokens_map.json + onnx/*.onnx 多格式候选），返回 `{ valid, missing, onnxFile, quantized }`。消除 `EmbeddingWorkerService` 与 `ModelDownloadService` 的校验逻辑重复。
- **改造 `isModelDownloaded`**：从「目录非空」改为调用 `validateModelFiles`，只有关键文件齐全且非空才返回 true。
- **改造 `downloadModel` 跳过逻辑**：`isModelDownloaded` 返回 true 时仍做一次完整性校验；若不完整则**不跳过下载**，继续走下载流程（复用 ModelScope/HF 下载逻辑，已存在的文件会被跳过，缺失/损坏的会被重新下载）。
- **新增下载后校验**：`downloadModelFromHF` 返回 success 后，调用 `validateModelFiles` 做最终校验；校验失败则返回 `{ success: false, error: 明确缺失文件清单 }`，避免前端误显示「下载完成」。
- **收紧 `modelDownloader.ts` 成功判定**：将 `downloadedFiles >= 4` 改为校验关键文件（tokenizer.json + config.json + 至少一个 ONNX 文件）齐全，而非固定数字阈值。

## Impact

- **Affected code**：
  - `src/main/services/ModelDownloadService.ts`（核心改造：isModelDownloaded + downloadModel）
  - `src/main/services/modelDownloader.ts`（收紧成功判定 + 下载后校验）
  - `src/main/services/modelFileValidator.ts`（新增共享校验函数）
  - `src/main/services/EmbeddingWorkerService.ts`（refactor：validateModelFiles 改为调用共享函数，保持外部行为不变）
- **Affected specs**：`fix-embedding-download-completeness-check`（本 spec）
- **前端无需改动**：`VectorConfigPanel.tsx` 已基于 `result.success` 判定下载结果，后端返回更准确的 success 标志后前端行为自动正确。
- **向后兼容**：0.6B 模型（有 model_quantized.onnx）走原路径不受影响；4B 模型（可能只有 model.onnx）也能通过多格式候选校验。

## ADDED Requirements

### Requirement: 模型下载完整性校验

系统在判定模型「已下载」和「下载完成」时，SHALL 校验关键文件存在且非空，而非仅检查目录非空。

#### Scenario: 目录存在但 ONNX 权重文件缺失

- **WHEN** 模型目录存在且有 tokenizer 文件，但 `onnx/` 子目录无任何 `.onnx` 文件（如 ModelScope CLI 下载中断后仅下载了 tokenizer）
- **THEN** `isModelDownloaded` 返回 false
- **AND** `downloadModel` 不跳过下载，继续走下载流程补全缺失文件

#### Scenario: 目录存在但文件为空（占位文件）

- **WHEN** 模型目录存在且文件名齐全，但某关键文件大小为 0（如下载中断创建了空文件）
- **THEN** `isModelDownloaded` 返回 false
- **AND** `validateModelFiles` 在 missing 列表中标注该文件为「(empty)」

#### Scenario: 下载完成后校验失败

- **WHEN** `downloadModelFromHF` 返回 success，但 `validateModelFiles` 校验发现仍有文件缺失
- **THEN** `downloadModel` 返回 `{ success: false, error: "下载后文件仍不完整: <missing 列表>" }`
- **AND** 前端显示「下载失败」而非「下载完成」

#### Scenario: 下载完成后校验通过

- **WHEN** `downloadModelFromHF` 返回 success 且 `validateModelFiles` 校验通过
- **THEN** `downloadModel` 返回 `{ success: true, localPath }`
- **AND** 前端显示「下载完成」

### Requirement: 多格式 ONNX 文件兼容

系统 SHALL 支持多种 ONNX 量化格式，按优先级匹配，不硬编码单一文件名。

#### Scenario: 4B 模型仅有全精度 model.onnx

- **WHEN** 模型目录 `onnx/` 子目录只有 `model.onnx`（fp32），无 `model_quantized.onnx`
- **THEN** `validateModelFiles` 返回 `{ valid: true, onnxFile: 'onnx/model.onnx', quantized: false }`
- **AND** 不报「onnx/model_quantized.onnx 缺失」

## MODIFIED Requirements

### Requirement: isModelDownloaded 判定逻辑

**原逻辑**：检查模型目录存在且 `files.length > 0`（目录非空）即返回 true。

**新逻辑**：调用 `validateModelFiles` 校验关键文件（tokenizer.json / tokenizer_config.json / config.json / special_tokens_map.json + onnx/*.onnx 多格式候选）存在且非空，全部通过才返回 true。

### Requirement: downloadModel 跳过逻辑

**原逻辑**：`isModelDownloaded` 返回 true 时直接返回 `{ success: true, localPath }`，跳过下载。

**新逻辑**：`isModelDownloaded` 返回 true 时直接返回成功（此时校验已通过）；返回 false 时继续走下载流程。下载完成后再次调用 `validateModelFiles` 做最终校验，校验失败则返回 `{ success: false, error }`。

### Requirement: modelDownloader 成功判定

**原逻辑**：`downloadedFiles >= 4` 即返回 success（7 个文件只下 4 个就算成功）。

**新逻辑**：调用 `validateModelFiles` 校验关键文件齐全；校验通过才返回 success，否则返回 `{ success: false, error: "缺失文件: <missing>" }`。

## REMOVED Requirements

### Requirement: 基于文件计数的下载成功判定

**Reason**：`downloadedFiles >= 4` 的固定阈值无法适应不同模型的文件结构差异（如 4B 模型可能没有 vocab.txt 但有 merges.txt），且无法检测文件内容是否完整（空文件/截断文件仍被计入）。

**Migration**：替换为基于关键文件存在性 + 非空校验的 `validateModelFiles` 调用。
