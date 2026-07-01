# Tasks

- [x] Task 1: 将 ModelScope 添加为默认下载源（CLI 方式）
  - [x] SubTask 1.1: 在 `src/main/services/modelDownloader.ts` 中新增 `findModelScopeExecutable()` 函数，自动搜索 modelscope CLI（先查 PATH，再查 Windows Python Scripts 目录）
  - [x] SubTask 1.2: 新增 `downloadFromModelScopeCLI()` 函数，使用 `child_process.spawn` 执行 `modelscope download --model {model} --local_dir {path}` 命令
  - [x] SubTask 1.3: 在 `downloadModelFromHF` 中优先尝试 ModelScope CLI，失败后降级到 HuggingFace HTTP 源
  - [x] SubTask 1.4: 移除原 ModelScope HTTP 源（URL 404 问题），保留 HF Mirror + HuggingFace 作为降级

- [x] Task 2: 更换模型名为 ModelScope 仓库对应名称
  - [x] SubTask 2.1: 更新 `src/renderer/components/Vector/VectorConfigPanel.tsx` 中 `DEFAULT_CONFIGS.local.localModel`（L34）为 `onnx-community/Qwen3-Embedding-0.6B-ONNX`
  - [x] SubTask 2.2: 更新 `VectorConfigPanel.tsx` 的 `LocalModelSelector` 组件（L664-670）中的 `<Option>` 值和显示文本
  - [x] SubTask 2.3: 更新 `src/main/services/EmbeddingWorkerService.ts` 中 3 处硬编码回退（L98, L198, L210）为 `onnx-community/Qwen3-Embedding-0.6B-ONNX`
  - [x] SubTask 2.4: 更新 `src/renderer/services/rendererEmbeddingService.ts` L26 的硬编码回退为 `onnx-community/Qwen3-Embedding-0.6B-ONNX`

- [x] Task 3: 更新维度推断映射表
  - [x] SubTask 3.1: 在 `src/main/services/VecstoreVectorStore.ts` 的 `inferDimensionFromModel`（L329-362）映射表中添加 `'onnx-community/qwen3-embedding-0.6b': 1024`
  - [x] SubTask 3.2: 保留现有 `'electroglyph/qwen3-embedding-0.6b': 1024` 和 `'qwen3-embedding-0.6b': 1024` 旧映射（向后兼容，避免已下载的旧模型推断失败）

- [x] Task 4: 维度自动切换 UI 联动
  - [x] SubTask 4.1: 在 `VectorConfigPanel.tsx` 顶部新增 `LOCAL_MODEL_DIMENSIONS` 常量映射（L50-53）
  - [x] SubTask 4.2: `LocalModelSelector` 组件 props 扩展 `onModelChange?: (model: string) => void`，并在 Select `onChange` 中调用
  - [x] SubTask 4.3: `renderModeSection` 传入 `onModelChange` 回调：根据所选模型查 `LOCAL_MODEL_DIMENSIONS`，命中则 `form.setFieldsValue({ dimension })` 自动切换
  - [x] SubTask 4.4: 维度 Select 控件 tooltip 文案更新为"1024 维：本地模型 qwen3-emb-0.6b；4096 维：远程模型 qwen3-embedding-8b"

- [x] Task 5: 验证
  - [x] SubTask 5.1: `where modelscope` / `where.exe modelscope` 确认 CLI 已安装于 PATH（`C:\Users\a1299\AppData\Local\Programs\Python\Python314\Scripts\modelscope.exe`）
  - [x] SubTask 5.2: `findModelScopeExecutable()` 优先 `where modelscope`，命中即返回 `'modelscope'`；Windows 下若 PATH 未命中，回退扫描 `%LOCALAPPDATA%\Programs\Python\Python*\Scripts\modelscope.exe`
  - [x] SubTask 5.3: `npm run build` 重新打包，确认 dist 输出新 hash（`modelDownloader-CfEMPXxi.js`），旧 HTTP 404 代码已被覆盖
  - [x] SubTask 5.4: tsc 验证无新增类型错误（823 个均为预存在错误，修改文件中无新引入错误）

## 实现说明（CLI 方式 vs HTTP 方式）

**原 HTTP 方式问题**：ModelScope 的 HTTP API 路径 `https://modelscope.cn/api/v1/models/{model}/resolve/master/{file}` 对部分 ONNX 仓库返回 404，且文件逐个下载易出现 JSON 截断、校验失败等问题。

**CLI 方式优势**：
- 直接调用 `modelscope download --model {id} --local_dir {path}`，由 modelscope SDK 内部处理仓库元数据、文件列表、断点续传
- 整个仓库一次性下载，避免逐文件 404
- 进度信息从 stderr（tqdm 输出）解析，含 `%` 的行更新进度条
- 5 分钟超时保护，失败后降级到 HF Mirror + HuggingFace HTTP 源

**降级链路**：ModelScope CLI → HF Mirror（HTTP）→ HuggingFace 官方（HTTP）