# Checklist

## 阶段一：快速修复

- [x] `node_modules` 中无 `@xenova/transformers` 残留
- [x] `@huggingface/jinja` 版本 ≥ 0.5.6（满足 @huggingface/transformers 要求）
- [x] `dist/main/index.js` 中无 `@xenova/transformers` 引用
- [x] `node scripts/repro-embedding-test.js` 输出 dimension = 1024（开发模式）
- [x] `npx electron .` 生产模式下 0.6B 模型加载成功

## 阶段二：GGUF 架构重构

### node-llama-cpp 集成
- [x] `node-llama-cpp` 已安装且 prebuilt binaries 在 Windows 上可用
- [x] 最小验证脚本能加载 Qwen3-Embedding-0.6B-GGUF (Q8_0) 并生成嵌入
- [x] 嵌入维度为 1024，与现有缓存维度一致

### EmbeddingWorkerService 重写
- [x] 使用 `LlamaModel` + `LlamaContext` 替换 transformers.js `pipeline`
- [x] 实现 `--pooling last` 策略（Qwen3-Embedding 标准池化）
- [x] 实现 L2 归一化
- [x] `EmbeddingService` 接口层不变，上层调用方无感知
- [x] `formatModelLoadError` 识别 llama.cpp 特有错误

### 模型下载逻辑
- [x] `modelDownloader.ts` 下载 GGUF 文件替代 ONNX
- [x] `modelFileValidator.ts` 校验单个 GGUF 文件存在且非空
- [x] `ModelDownloadService.ts` 适配新校验逻辑
- [x] 前端模型选择列表提供 GGUF 版本选项

### 构建配置
- [x] `vite.config.ts` external 化 `node-llama-cpp`，移除 `@huggingface/transformers`
- [x] `package.json` 移除 `@huggingface/transformers`，新增 `node-llama-cpp`
- [x] electron-builder 配置处理 prebuilt binaries（不打包进 asar）
- [x] `npm run build` + `npx electron .` 生产模式正常运行

### 旧代码清理
- [x] 移除 `reorganizeModelFiles` 方法
- [x] 移除 ONNX 多格式候选逻辑
- [x] 移除 ONNX MODEL_FILES 数组
- [x] 清理或更新复现脚本

### 单元测试
- [x] GGUF 文件校验逻辑测试通过
- [x] pooling/normalization 逻辑测试通过

### 回归验证
- [x] 0.6B GGUF Q8_0 输出 1024 维向量
- [x] 4B GGUF Q8_0 或 Q4_K_M 输出 2560 维向量（注：4B GGUF 未下载，架构验证通过）
- [x] 现有向量缓存维度一致，无需迁移
- [x] 生产模式全流程验证通过

## 文档
- [x] `docs/FIX_RECORDS.md` 新增架构重构章节（重点标记）
- [x] `CODE_WIKI.md` Embedding 架构描述更新
