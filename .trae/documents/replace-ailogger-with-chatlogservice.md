# Plan: Replace AiLogger.ts with chatLogService Logging System

## Problem Analysis

### Current State
项目中有两套AI交互日志记录机制：
1. **chatLogService.ts** (创作中心聊天模式) - 使用 `addLog` 函数，通过 `sendLogToRenderer` 发送到渲染进程显示，记录完整的请求/响应数据，**没有截断问题**
2. **AiLogger.ts** (写作模式) - 使用独立的文件日志系统，存在输入参数日志截断问题（[ContentGenerator.ts:108](file:///d:/AI/creative-cafe/src/main/services/writing/ContentGenerator.ts#L108) 截断为2000字符）

### Issues
- AiLogger.ts 的 `logDetailed` 使用 `JSON.stringify(data, null, 2)` 但受控制台限制会显示 `[truncated]`
- ContentGenerator.ts 主动截断 promptPreview 为2000字符
- 两套日志系统维护成本高，格式不一致

## Solution

### Step 1: Export addLog from chatLogService
**File**: `src/main/services/memory/chatLogService.ts`

- 将 `addLog` 函数从私有改为导出，供其他模块使用
- 保持现有功能不变

### Step 2: Update ContentGenerator.ts
**File**: `src/main/services/writing/ContentGenerator.ts`

- 删除 `import { logRequest, logResponse, logErrorWithContext, logDebug } from '../AiLogger'`
- 添加 `import { addLog } from '../memory/chatLogService'`
- 删除截断逻辑（第108行的 `promptPreview`）
- 使用 `addLog` 记录完整请求参数：
  ```typescript
  addLog('===== 写作模式: AI请求入参 =====', 'debug')
  addLog(`章节: ${request.chapterInfo?.index} - ${request.chapterInfo?.title}`, 'debug')
  addLog(`模型: ${modelName}`, 'debug')
  addLog(`温度: ${modelConfig.temperature}`, 'debug')
  addLog(`最大Token: ${modelConfig.maxTokens}`, 'debug')
  addLog('完整消息列表:', 'debug')
  messages.forEach((msg, idx) => {
    addLog(`--- message[${idx}] role=${msg.role}, content长度=${msg.content?.length || 0} ---`, 'debug')
    addLog(msg.content || '(empty)', 'debug')
  })
  ```
- 更新响应日志使用 `addLog`

### Step 3: Update writingHandlers.ts
**File**: `src/main/ipc/handlers/writingHandlers.ts`

- 删除 `import { logRequest, logResponse, logErrorWithContext, logInfo } from '../../services/AiLogger'`
- 添加 `import { addLog } from '../../services/memory/chatLogService'`
- 替换所有 `logRequest`, `logResponse`, `logErrorWithContext`, `logInfo` 为对应的 `addLog` 调用

### Step 4: Update AIAssistedChapterService.ts
**File**: `src/main/services/writing/AIAssistedChapterService.ts`

- 删除 `import { logRequest, logResponse, logErrorWithContext } from '../AiLogger'`
- 添加 `import { addLog } from '../memory/chatLogService'`
- 替换所有日志调用为 `addLog`

### Step 5: Delete AiLogger.ts
**File**: `src/main/services/AiLogger.ts`

- 完全删除此文件

### Step 6: Verify Imports
- 确保 `sendLogToRenderer` 从 `src/main/index.ts` 正确导出
- 确保所有导入路径正确

## Key Changes

### Before (AiLogger.ts approach)
```typescript
logRequest('writing:generateChapter:api', {
  promptPreview: promptString.substring(0, 2000) + '... [truncated]'
})
logDebug('fullPrompt', { fullPrompt: promptString })  // Still may be truncated in console
```

### After (chatLogService approach)
```typescript
addLog('===== 写作模式: AI请求入参 =====', 'debug')
addLog(`章节: ${chapterIndex} - ${chapterTitle}`, 'debug')
addLog('完整提示词:', 'debug')
addLog(promptString, 'debug')  // Complete, no truncation
```

## Benefits
1. 统一的日志记录机制（全局只有一种）
2. 完整的输入参数日志，无截断
3. 更简洁的代码（删除AiLogger.ts及其重复逻辑）
4. 一致的日志格式和输出方式
