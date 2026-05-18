# 记忆表格数据拼接全面排查计划

## 问题现状
用户反馈：在 AI 请求日志中找不到 "--- 记忆表格数据 ---" 的拼接记录。
经过多次修复后，代码逻辑表面上正确，但数据仍未成功传递到最终的 AI 请求参数中。

## 完整数据流分析

### 数据流路径（4个关键环节）

```
┌─────────────────────────────────────────────────────────────────────┐
│  环节1: 数据源（后端）                                               │
│  chatLogService.getTableData(chatId)                                │
│  → 读取 .json 文件，返回 { sheets, headers, data }                    │
└──────────────────────────────┬──────────────────────────────────────┘
                               │
┌──────────────────────────────▼──────────────────────────────────────┐
│  环节2: IPC 传递（main → renderer）                                  │
│  ipcRenderer.invoke('memory:getTableData', chatId)                  │
│  → window.electronAPI.memory.getTableData(chatId)                    │
└──────────────────────────────┬──────────────────────────────────────┘
                               │
┌──────────────────────────────▼──────────────────────────────────────┐
│  环节3: 前端构建（hooks → PromptBuilder）                            │
│  hooks 中格式化 memoryTableData（Markdown 表格）                     │
│  → buildCompleteSystemPrompt(promptType, vectorContextItems, memoryTableData) │
│  → usePromptBuilder.buildCompleteSystemPrompt(...)                   │
│  → PromptBuilder.buildSystemPromptPure(..., memoryTableData)         │
│  → PromptBuilder.buildFinalSystemPrompt(..., memoryTableData)        │
└──────────────────────────────┬──────────────────────────────────────┘
                               │
┌──────────────────────────────▼──────────────────────────────────────┐
│  环节4: AI 请求（system prompt 发送）                                │
│  ChatEngine 将 system prompt 发送到 AI API                           │
│  → AI 请求 messages[0].content 包含 "--- 记忆表格数据 ---"            │
└─────────────────────────────────────────────────────────────────────┘
```

## 可能的问题点

### 问题点1: 用户未实际开启"是否启用"开关
- `memoryTableEnabledRef.current` 始终为 `false`
- 用户可能只在界面上看到开关，但未真正切换

### 问题点2: 表格数据文件不存在或格式不对
- `getTableData` 返回 `{ sheets: [], headers: {}, data: {} }`
- JSON 文件路径不匹配（chatId 转换规则不一致）
- 文件已存在但数据结构不对

### 问题点3: `tableResult.data` 为空对象
- `sheets` 有值但 `data[sheetName]` 为空
- 条件判断 `tableResult.data` 在 data 为空对象 `{}` 时仍为 truthy，但实际无数据

### 问题点4: PromptBuilder 未正确追加数据
- `usePromptBuilder` 的签名修改后，`buildCompleteSystemPrompt` 是否正确透传了 `memoryTableData`
- `buildFinalSystemPrompt` 追加逻辑是否正确执行

## 排查步骤

### 第一步：验证数据源
1. 检查磁盘上 `data/memories/chats/` 目录是否有 `.json` 文件
2. 验证文件内容格式是否符合 `{ sheets, headers, data }` 结构
3. 添加 `getTableData` 的详细日志（文件路径、内容摘要）

### 第二步：验证 IPC 传递
1. 在 `memoryHandlers.ts` 中添加 `getTableData` 返回值日志
2. 在 `preload.ts` 中验证返回值完整性

### 第三步：验证前端构建
1. 在 `usePromptBuilder.ts` 的 `buildCompleteSystemPrompt` 中添加日志
2. 验证 `memoryTableData` 参数是否正确传入
3. 在 `PromptBuilder.ts` 的 `buildFinalSystemPrompt` 中添加日志

### 第四步：验证最终发送
1. 利用已有的 `aiHandlers.ts` 请求体日志
2. 检查 `messages[0].content` 的末尾 500 字符

## 系统测试用例设计

### 测试1: 正常流程测试
- **前置条件**：开启"是否启用"开关，存在有效的表格数据文件
- **期望结果**：AI 请求的 system prompt 中包含 "--- 记忆表格数据 ---" 部分

### 测试2: 开关状态测试
- **前置条件**：关闭"是否启用"开关
- **期望结果**：不调用 `getTableData`，system prompt 不包含记忆表格数据

### 测试3: 空数据测试
- **前置条件**：开启开关，但表格数据文件不存在或为空
- **期望结果**：优雅处理，不报错，system prompt 不包含记忆表格数据

### 测试4: 数据格式错误测试
- **前置条件**：JSON 文件格式损坏
- **期望结果**：捕获异常，日志记录错误，不中断对话

### 测试5: 大数据量测试
- **前置条件**：表格包含超过 50 行数据
- **期望结果**：已移除 50 行限制，所有数据正确拼接

## 实施步骤

1. 在 `chatLogService.getTableData` 中添加详细日志
2. 在 `memoryHandlers.ts` 的 IPC handler 中添加返回值日志
3. 在 `usePromptBuilder.ts` 的 `buildCompleteSystemPrompt` 中添加参数日志
4. 在 `PromptBuilder.ts` 的 `buildFinalSystemPrompt` 中添加追加结果日志
5. 编写并执行系统测试用例
6. 根据日志输出定位断裂环节并修复
