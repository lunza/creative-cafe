# 本地嵌入模型架构重构 Spec

## Why

当前本地向量化功能使用 `@xenova/transformers` (ONNX) 方案，经过 3 轮修复（§14.54 升级包、§14.56 文件整理、§14.57 下载校验）仍无法稳定运行。根本性缺陷包括：

1. **构建产物过期**：源码已改为 `import('@huggingface/transformers')`，但 `dist/main/index.js` 仍是 7/30 的旧构建，仍引用 `@xenova/transformers`。用户运行的是 Electron 生产模式（`electron .`），加载的是过期 dist。
2. **node_modules 不同步**：`package-lock.json` 仍列出 `@xenova/transformers`，`npm install` 未重新执行，两个包共存导致模块解析混乱。`@huggingface/jinja` 版本也不匹配（安装 0.2.2，需要 ^0.5.6）。
3. **架构支持不确定**：即使修复构建问题，`@huggingface/transformers` JS 版对 qwen3 架构的支持未经验证（Python 版需 ≥4.51.0），4B/8B 模型更是完全未验证。
4. **ONNX 文件管理脆弱**：ModelScope CLI 下载的 ONNX 文件结构混乱（临时目录、graph/权重分离），需要额外的 `reorganizeModelFiles` 整理逻辑，增加故障点。

用户要求：实现本地环境下对 Qwen3 系列模型（0.6B、4B、8B）的稳定加载与运行，优先考虑 GGUF/Q8 量化版本。

## 技术评估结论

经全面排查 5 种替代方案，**推荐 GGUF + llama.cpp (node-llama-cpp) 方案**：

| 方案 | 可行性 | Qwen3 支持 | Electron 兼容 | 资源占用(0.6B) | 推荐度 |
|------|--------|-----------|--------------|---------------|--------|
| **GGUF + llama.cpp** | ⭐⭐⭐⭐⭐ | ✅ 官方GGUF三尺寸 | ⭐⭐⭐⭐⭐ 官方支持 | ~0.8GB (Q4) | **首选** |
| ONNX Runtime 直调 | ⭐⭐⭐⭐ | ✅ 多ONNX版本 | ⭐⭐⭐⭐ 已有依赖 | ~1.5GB | 备选 |
| 修复 transformers.js | ⭐⭐⭐ | ⚠️ 0.6B验证 | ⭐⭐⭐⭐ | ~1.5GB | 不推荐 |
| fastembed | ⭐ | ❌ 不支持 | N/A | N/A | 排除 |
| Infinity Server | ⭐⭐ | ⚠️ 理论可行 | ❌ 需Python | ~2-4GB | 排除 |

**GGUF 方案核心优势**：
- Qwen 官方发布 GGUF 格式，0.6B/4B/8B 三尺寸齐全，无需担心导出兼容性
- `node-llama-cpp` 官方支持 Electron，有完整文档和 Electron 维护者背书
- Q4_K_M 量化下 0.6B 仅需 ~0.8GB 内存，4B ~3.2GB，8B ~6.5GB
- 原生支持 last-token pooling（Qwen3-Embedding 的标准池化策略）
- 支持 GPU 加速（CUDA/Metal/Vulkan）

## What Changes

### 阶段一：快速修复（让现有方案先跑起来）
- 删除 `node_modules` 和 `package-lock.json`，重新 `npm install` 清理依赖
- 执行 `npm run build` 重新构建 dist，确保 `@huggingface/transformers` 被正确引用
- 验证 0.6B 模型在开发模式和生产模式下都能加载

### 阶段二：架构重构（迁移到 GGUF + llama.cpp）
- **BREAKING** 移除 `@huggingface/transformers` 依赖，新增 `node-llama-cpp`
- **BREAKING** 模型格式从 ONNX 迁移到 GGUF（Q8_0 / Q4_K_M 量化）
- 重写 `EmbeddingWorkerService.ts` 底层实现，使用 node-llama-cpp API
- 重写 `modelDownloader.ts`，下载 GGUF 文件替代 ONNX
- 更新 `modelFileValidator.ts`，校验 GGUF 文件完整性
- 更新 `vite.config.ts`，external 化 `node-llama-cpp`
- 更新 `electron-builder` 配置，处理 node-llama-cpp 的 prebuilt binaries
- 保留 `EmbeddingService.ts` 接口层不变，上层调用方无感知

## Impact

- **Affected code**：
  - `src/main/services/EmbeddingWorkerService.ts`（底层重写）
  - `src/main/services/modelDownloader.ts`（GGUF 下载逻辑）
  - `src/main/services/modelFileValidator.ts`（GGUF 校验）
  - `src/main/services/ModelDownloadService.ts`（适配新校验）
  - `vite.config.ts`（external 更新）
  - `package.json`（依赖变更）
  - `electron-builder.yml` 或 `package.json` build 配置（native binary 打包）
- **Affected specs**：`fix-embedding-download-completeness-check`（校验逻辑需适配 GGUF）
- **向后兼容**：`EmbeddingService` 接口层不变；已有向量缓存维度需迁移（0.6B ONNX 1024 维 → 0.6B GGUF 1024 维，维度一致可保留缓存）

## ADDED Requirements

### Requirement: GGUF 模型加载

系统 SHALL 使用 node-llama-cpp 加载 GGUF 格式的 Qwen3-Embedding 模型，替代 ONNX + transformers.js 方案。

#### Scenario: 0.6B 模型加载

- **WHEN** 用户选择 `Qwen3-Embedding-0.6B-GGUF` 并点击测试
- **THEN** 系统使用 node-llama-cpp 加载 Q8_0 量化 GGUF 文件
- **AND** 使用 `--pooling last` 策略生成嵌入
- **AND** 返回 1024 维向量

#### Scenario: 4B 模型加载

- **WHEN** 用户选择 `Qwen3-Embedding-4B-GGUF` 并点击测试
- **THEN** 系统加载 Q8_0 或 Q4_K_M 量化 GGUF 文件
- **AND** 返回 2560 维向量

#### Scenario: 模型加载失败

- **WHEN** GGUF 文件损坏或内存不足
- **THEN** 返回可读的错误信息，指导用户检查文件或降低量化精度

### Requirement: GGUF 模型下载

系统 SHALL 从 ModelScope 或 HuggingFace 下载 GGUF 格式模型文件，并校验完整性。

#### Scenario: 首次下载

- **WHEN** 用户首次选择某个 GGUF 模型
- **THEN** 系统从 ModelScope 下载对应 GGUF 文件到 `models/<model-name>/` 目录
- **AND** 下载完成后校验文件存在且非空
- **AND** 校验通过后标记为「已下载」

#### Scenario: 下载中断恢复

- **WHEN** 下载中断后用户再次点击下载
- **THEN** 系统检测到文件不完整，重新下载
- **AND** 不会因残留文件误判为「已下载」

## MODIFIED Requirements

### Requirement: 本地嵌入模型配置

**原逻辑**：支持 ONNX 格式模型，通过 transformers.js 的 `pipeline('feature-extraction')` 加载。

**新逻辑**：支持 GGUF 格式模型，通过 node-llama-cpp 的 `LlamaModel` + `LlamaContext` + `getEmbedding()` 加载。模型选择列表更新为 GGUF 版本。

### Requirement: 模型文件校验

**原逻辑**：校验 tokenizer.json + onnx/*.onnx 等多个文件。

**新逻辑**：校验单个 GGUF 文件存在且非空（GGUF 是单文件格式，包含模型权重和 tokenizer）。

## REMOVED Requirements

### Requirement: ONNX 模型文件管理

**Reason**：GGUF 是单文件格式，无需 tokenizer.json / config.json / onnx/ 子目录等多文件管理，也无需 `reorganizeModelFiles` 整理逻辑。

**Migration**：已有的 ONNX 模型目录需用户手动删除（或系统提供清理选项），重新下载 GGUF 格式。

### Requirement: transformers.js 依赖

**Reason**：`@huggingface/transformers` 及其依赖链（onnxruntime-node 等）由 node-llama-cpp 替代。node-llama-cpp 自带 llama.cpp 原生绑定，不依赖 ONNX Runtime。

**Migration**：`package.json` 移除 `@huggingface/transformers`，新增 `node-llama-cpp`。`vite.config.ts` 的 external 和 commonjsOptions.ignore 同步更新。
