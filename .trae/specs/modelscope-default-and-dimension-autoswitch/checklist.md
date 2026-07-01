# Checklist

## ModelScope CLI 下载源（CLI 方式）
- [x] `modelDownloader.ts` 中 `findModelScopeExecutable()` 优先查 PATH（`where modelscope` / `which modelscope`）
- [x] Windows 下 PATH 未命中时，回退扫描 `%LOCALAPPDATA%\Programs\Python\Python*\Scripts\modelscope.exe`
- [x] `downloadFromModelScopeCLI()` 使用 `child_process.spawn` 执行 `modelscope download --model {id} --local_dir {path}`
- [x] spawn 启用 `shell: true` 以兼容 PATH 中带空格的可执行路径
- [x] stdout/stderr 实时采集，stderr 中匹配 `(\d+)%` 解析进度并回调 `onProgress`
- [x] 5 分钟超时保护，超时后 `child.kill()` 终止进程
- [x] 退出码为 0 视为成功；非 0 视为失败，记录 stderr 前 300 字符
- [x] `downloadModelFromHF` 优先调用 ModelScope CLI，失败后降级到 HuggingFace HTTP 源
- [x] 降级链路：ModelScope CLI → HF Mirror（HTTP）→ HuggingFace 官方（HTTP）
- [x] 原 ModelScope HTTP 源（`modelscope.cn/api/v1/...` 404 路径）已移除

## 模型名更换
- [x] `VectorConfigPanel.tsx` 的 `DEFAULT_CONFIGS.local.localModel` 已改为 `onnx-community/Qwen3-Embedding-0.6B-ONNX`
- [x] `LocalModelSelector` 的 Option 值和显示文本已更新
- [x] `EmbeddingWorkerService.ts` 中 3 处硬编码回退已更新
- [x] `rendererEmbeddingService.ts` 中硬编码回退已更新
- [x] Grep 确认 src/ 下无 `electroglyph/Qwen3-Embedding-0.6B-ONNX-uint8` 残留

## 维度推断
- [x] `inferDimensionFromModel` 映射表包含 `onnx-community/qwen3-embedding-0.6b` → 1024
- [x] 保留 `electroglyph/qwen3-embedding-0.6b` 和 `qwen3-embedding-0.6b` 旧映射（兼容性）

## 维度自动切换
- [x] `LOCAL_MODEL_DIMENSIONS` 映射常量已创建
- [x] `LocalModelSelector` 的 `onChange` 调用 `onModelChange` 回调
- [x] `renderModeSection` 传入的 `onModelChange` 回调正确查找维度并更新 form
- [x] 选择模型后 dimension Select 控件 UI 同步更新（`form.setFieldsValue` 触发重渲染）
- [x] 维度切换仅更新表单状态，不触发后端即时切换

## 验证
- [x] `where.exe modelscope` 确认 CLI 已安装：`C:\Users\a1299\AppData\Local\Programs\Python\Python314\Scripts\modelscope.exe`
- [x] `findModelScopeExecutable()` 返回 `'modelscope'`（PATH 命中）
- [x] `npm run build` 重新打包成功，dist 输出新 hash：`dist/main/modelDownloader-CfEMPXxi.js`（旧 `Cw4spqS7.js` 已被覆盖）
- [x] `npx tsc --noEmit` 无新增类型错误（823 个均为预存在错误，修改文件中无新引入错误）
- [x] 维度自动切换逻辑经代码审查确认正确
- [ ] 用户在运行中的 Electron 应用内实测下载流程（待用户验证）
