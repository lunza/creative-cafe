# 写作模式 AI 交互日志持久化方案

## 问题描述

写作模式下的 AI 交互（大纲生成、章节生成等）没有记录到 `ai-handler.log` 日志文件中，导致无法追踪和排查 AI 交互过程中的问题。

## 现有日志基础设施

`src/main/ipc/handlers/aiHandlers.ts` 中已有一套完整的日志系统：
- **日志路径**: `logs/ai-handler.log`（基于 `process.cwd()`）
- **日志配置**: 最大文件 10MB，最多保留 5 个轮转文件
- **日志函数**:
  - `logToFile(level, message, details?)` - 基础日志写入
  - `logDetailed(level, title, data)` - 结构化 JSON 数据日志
  - `logError(message, error?, context?)` - 错误日志
  - `logWarn(message, context?)` - 警告日志
  - `logInfo(message, context?)` - 信息日志
  - `logDebug(message, context?)` - 调试日志
- **日志轮转**: `rotateLogFile()` 自动检查文件大小并轮转
- **脱敏机制**: 请求头 `Authorization` 和请求体 `api_key` 会被自动脱敏

## 需要添加日志的位置

### 1. `writing:generateOutline` IPC 处理器
- 请求日志: prompt 内容、参数配置（小说类型、写作风格、章节数等）、时间戳、项目 ID
- 响应日志: 生成的大纲内容（原始文本）、解析结果（章节数）、耗时、状态

### 2. `writing:saveOutline` IPC 处理器
- 请求日志: 原始大纲内容、参数配置、时间戳、项目 ID
- 响应日志: 创建的项目 ID、状态

### 3. `writing:generateChapter` IPC 处理器
- 请求日志: 章节信息、前序章节摘要、参数配置、时间戳、项目 ID、章节索引
- 响应日志: 生成的章节内容长度、耗时、状态

### 4. ContentGenerator 类
- 在 `generateStream` 方法中添加请求和响应日志

### 5. OutlineGenerator 类
- 在 `generateOutline` 方法中添加请求和响应日志

## 实现方案

### 步骤 1: 在 writingHandlers.ts 中引入日志函数

将 `aiHandlers.ts` 中的日志函数提取为共享模块，或直接在 `writingHandlers.ts` 中复制相同的日志逻辑，保持日志格式一致。

**推荐方式**: 创建共享日志模块 `src/main/services/AiLogger.ts`，将日志逻辑从 `aiHandlers.ts` 中抽离出来供写作模块复用。

### 步骤 2: 在 IPC 处理器中添加日志

在 `registerWritingHandlers` 中为每个 AI 相关的 IPC 处理器添加请求和响应日志。

### 步骤 3: 在生成器类中添加日志

在 `ContentGenerator` 和 `OutlineGenerator` 的关键方法中添加日志。

## 日志格式

采用与 `aiHandlers.ts` 一致的格式：
```
[YYYY-MM-DD HH:MM:SS] [INFO ] 消息内容
                     详细数据（JSON 格式）

```

示例：
```
[2026-05-21 10:30:00] [INFO ] 写作模式收到AI请求: writing:generateOutline
                     {
                       "projectId": "writing_project_xxx",
                       "timestamp": "2026-05-21T10:30:00.000Z",
                       "novelType": "web_novel",
                       "writingStyle": "serious",
                       "chapterCount": 20,
                       "targetWordCount": 200000,
                       "includeEnding": true
                     }

[2026-05-21 10:30:15] [INFO ] 写作模式AI请求完成: writing:generateOutline
                     {
                       "status": "success",
                       "chaptersCount": 20,
                       "rawContentLength": 15420,
                       "processingTime": 15234
                     }

```

## 影响范围

- 新增文件: `src/main/services/AiLogger.ts`
- 修改文件:
  - `src/main/ipc/handlers/writingHandlers.ts`
  - `src/main/services/writing/ContentGenerator.ts`
  - `src/main/services/writing/OutlineGenerator.ts`

## 错误处理

- 日志写入失败时捕获异常，仅输出 `console.error` 而不影响主流程
- 使用 `try-catch` 包裹所有日志写入操作
- 日志轮转失败时仅记录错误，不阻断主流程
