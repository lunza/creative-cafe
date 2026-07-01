# ModelScope 默认下载源与本地模型维度自动切换 Spec

## Why
当前模型下载源硬编码为 HuggingFace Mirror + HuggingFace 官方，国内用户下载不稳定。同时用户选择本地模型时维度不会自动联动，需要手动切换 dimension 字段，容易遗漏导致维度不匹配。

## What Changes
- 将模型下载源默认改为 ModelScope，HuggingFace Mirror 和 HuggingFace 官方作为 fallback
- 模型名从 `electroglyph/Qwen3-Embedding-0.6B-ONNX-uint8` 更换为 `onnx-community/Qwen3-Embedding-0.6B-ONNX`（对应 ModelScope 仓库）
- ModelScope URL 格式与 HuggingFace 不同（`/resolve/master/` vs `/resolve/main/`，且需 `/api/v1/models/` 前缀），下载逻辑需适配
- 在 `LocalModelSelector` 的 `onChange` 中，根据所选模型自动切换 dimension 字段值

## Impact
- Affected code:
  - `src/main/services/modelDownloader.ts` — 下载源数组、URL 构造
  - `src/main/services/ModelDownloadService.ts` — 无需修改（委托给 modelDownloader）
  - `src/renderer/components/Vector/VectorConfigPanel.tsx` — 模型名、维度联动
  - `src/main/services/EmbeddingWorkerService.ts` — 硬编码回退模型名
  - `src/renderer/services/rendererEmbeddingService.ts` — 硬编码回退模型名
  - `src/main/services/VecstoreVectorStore.ts` — `inferDimensionFromModel` 需添加新模型名映射

## ADDED Requirements

### Requirement: ModelScope 作为默认下载源
系统 SHALL 将 ModelScope 作为本地嵌入模型下载的首选源，HuggingFace Mirror 和 HuggingFace 官方作为降级 fallback。

#### Scenario: 从 ModelScope 下载成功
- **WHEN** 用户点击下载 `onnx-community/Qwen3-Embedding-0.6B-ONNX`
- **THEN** 系统优先从 `https://modelscope.cn/api/v1/models/onnx-community/Qwen3-Embedding-0.6B-ONNX/resolve/master/{file}` 下载
- **AND** 下载成功后模型文件存储在 `userData/models/onnx-community/Qwen3-Embedding-0.6B-ONNX/` 目录

#### Scenario: ModelScope 失败后降级到 HuggingFace
- **WHEN** ModelScope 下载某个文件失败（超时、404 等）
- **THEN** 系统自动尝试 HF Mirror 源
- **AND** 若 HF Mirror 也失败，尝试 HuggingFace 官方源

### Requirement: 本地模型选择时维度自动切换
系统 SHALL 在用户从本地模型下拉列表选择模型时，自动将该模型的已知维度写入表单的 `dimension` 字段。

#### Scenario: 选择 qwen3-emb-0.6b 模型
- **WHEN** 用户在本地模型下拉中选择 `onnx-community/Qwen3-Embedding-0.6B-ONNX`
- **THEN** 表单的 `dimension` 字段自动设置为 `1024`
- **AND** UI 上的维度选择控件同步更新显示

#### Scenario: 选择未知维度的模型
- **WHEN** 用户选择了一个不在维度映射表中的模型
- **THEN** dimension 字段保持当前值不变（不强制覆盖）

## MODIFIED Requirements

### Requirement: 本地嵌入模型默认配置
默认本地嵌入模型为 `onnx-community/Qwen3-Embedding-0.6B-ONNX`（ModelScope 仓库），维度 1024。所有硬编码回退路径中的模型名同步更新。

### Requirement: inferDimensionFromModel 模型映射表
`inferDimensionFromModel` 的映射表 SHALL 包含 `onnx-community/qwen3-embedding-0.6b` → 1024 的映射，并保留 `electroglyph/qwen3-embedding-0.6b` → 1024 以兼容已下载的旧模型。
