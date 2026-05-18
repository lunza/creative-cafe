# 写作模式 SSE 流式响应解析修复计划

## 一、问题背景

当前 `OutlineGenerator.readStreamResponse()` 使用简单的按行分割方式解析 SSE 流，导致 JSON 解析失败：

```
[OutlineGenerator] Failed to parse SSE line: data: {"id":"0616076b-a8c4-461f-aebd-f245392e2e84","object":"chat.completion.chunk","created":177911...
```

根因：SSE 数据在网络传输中被 TCP 分包，`data:` 行可能被切割到多个 chunk 中，导致 JSON.parse 时数据不完整。

## 二、参考方案：聊天模式的 SSE 处理

聊天模式（`aiHandlers.ts` + `ChatEngine.ts`）采用了成熟的流式响应处理方案：

### 主进程层（aiHandlers.ts）
- 使用 `TextDecoder.decode(value)` 解码二进制 chunk
- 持续累加 `accumulatedData` 存储完整 SSE 原始数据
- 每个 chunk 通过 IPC 传递给渲染进程，同时携带 `accumulatedData`

### 渲染进程层（ChatEngine.ts）
- 基于 `accumulatedData` 做行分割（而非单个 chunk）
- 使用 `lastProcessedLineCount` 追踪已处理行数，避免重复解析
- 只处理新增的 `data:` 行
- 4 层降级解析策略应对非标准格式

## 三、修复方案

### 核心问题

`OutlineGenerator` 在主进程中直接发起 `fetch` 并读取 SSE 流，但没有参考 `aiHandlers.ts` 的成熟模式：
1. 没有持续累加原始数据
2. 按单个 chunk 做 `\n` 分割，导致跨 chunk 的 `data:` 行被截断
3. 没有多层降级解析策略

### 步骤 1: 重写 OutlineGenerator 的流读取逻辑

参考 `aiHandlers.ts` 的实现，重写 `readStreamResponse()` 方法：

**关键改进**：
1. 使用 `TextDecoder.decode(value, { stream: true })` 正确处理 UTF-8 多字节字符边界
2. 累积所有原始 SSE 数据到 `accumulatedData`
3. 基于完整 `accumulatedData` 做行分割和 `data:` 过滤
4. 使用 `lastProcessedLineCount` 避免重复处理已解析的行
5. 实现 3 层降级解析策略：
   - 优先：正则匹配 `data:` 行 + JSON.parse → 提取 `delta.content`
   - 降级：将整个 `accumulatedData` 作为单个 JSON 解析
   - 终极：正则提取 `"content":"..."` 字段

### 步骤 2: 同步修复 ContentGenerator

`ContentGenerator.ts` 的流式响应读取逻辑与 `OutlineGenerator` 类似，需要应用相同的修复。

### 步骤 3: 增加详细日志

在流读取完成后输出：
- 累积的 SSE 原始数据长度
- 成功解析的 data: 行数量
- 最终提取的纯文本内容长度和前 200 字符

### 步骤 4: 验证修复

1. 运行 `npm run build` 确认编译通过
2. 检查 TypeScript 诊断信息

## 四、预期输出

- SSE 流式响应被正确解析，不再出现 "Failed to parse SSE line" 错误
- 大纲内容完整回显到 UI
- 添加详细诊断日志便于后续排查
