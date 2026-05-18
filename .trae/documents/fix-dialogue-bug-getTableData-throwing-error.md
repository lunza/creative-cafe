# 对话功能Bug排查与修复计划

## 问题分析

用户输入信息后系统未调用AI引擎进行对话，日志在 `[IPC] memory:getTableData 返回结果` 后就停止了。

### 排查路径

1. **用户发送消息** → `sendMessage()` (CharacterDialogueChat.hooks.ts:995)
2. **调用 requestAIResponse** (CharacterDialogueChat.hooks.ts:401)
3. **获取上下文检索** → `retrieveWithKeywords` 成功
4. **获取记忆表格数据** → `getTableData(chatId)` (line 559)
5. **构建 system prompt** → `buildCompleteSystemPrompt` (line 627)
6. **Token管理与截断** (line 639)
7. **调用 engine.sendMessage** (line 976)

### 根因定位

**核心问题**：`chatLogService.getTableData()` (chatLogService.ts:3214) 在表格JSON文件不存在时**抛出异常** (`throw new Error('文件不存在: ...')`)。

虽然这个异常在 `requestAIResponse` 的 `try-catch` (line 554-621) 中被捕获并打印日志，但从用户提供的日志来看，异常发生后流程中断，后续日志（如 `[CharacterDialogueChat] System prompt length`、`[CharacterDialogueChat] === Request Assembly ===`、`engine.sendMessage` 相关日志）均未输出，说明整个 `requestAIResponse` 函数可能在某处发生了**未预期的中断**。

### 详细代码分析

```typescript
// chatLogService.ts:3200-3214
if (!fs.existsSync(jsonPath)) {
  console.error('文件不存在:', jsonPath);
  // 尝试从 chats 目录查找备份文件
  const fallbackPath = path.join(this.chatsDir, `${safeChatId}.json`);
  if (fs.existsSync(fallbackPath)) {
    // ... 成功读取备份
    return { sheets: [], headers: {}, data: {}, sheetDescriptions: {} };
  }
  throw new Error(`文件不存在: ${jsonPath}`);  // ❌ 这里抛出异常！
}
```

这个 `throw` 会在 `getTableData` 调用时被 renderer 端的 `catch` (line 619) 捕获，但根据用户的日志，日志在 `memory:getTableData 返回结果` 后就没有了。这说明**可能还存在其他问题**，或者 `throw` 后的错误处理没有正确继续流程。

实际上，查看代码流程，`throw` 后的 catch (line 619-621) 仅打印日志，然后继续执行 `buildCompleteSystemPrompt` 等后续步骤。但用户日志显示后续没有任何输出，说明可能有以下情况之一：

1. **`buildCompleteSystemPrompt` 或其他后续代码抛出异常但没有被捕获**
2. **`buildCompleteSystemPrompt` 内部存在无限循环或阻塞**
3. **`requestAIResponse` 函数在某处被提前 return 但没有日志**

经过仔细分析，最可能的问题是：`getTableData` 抛出的异常被 IPC 层传递到 renderer 时，可能没有被正确作为 Promise reject 传递，导致 renderer 端的 `await window.electronAPI.memory.getTableData(chatId)` 挂起不返回。

## 修复方案

### 修复 1：修改 `chatLogService.ts` 的 `getTableData` 方法

当表格文件不存在时，**不抛出异常**，而是返回空数据结构，允许对话继续。

**文件**：`src/main/services/memory/chatLogService.ts:3200-3214`

**修改前**：
```typescript
if (!fs.existsSync(jsonPath)) {
  console.error('文件不存在:', jsonPath);
  const fallbackPath = path.join(this.chatsDir, `${safeChatId}.json`);
  if (fs.existsSync(fallbackPath)) {
    // ...
    return { sheets: [], headers: {}, data: {}, sheetDescriptions: {} };
  }
  throw new Error(`文件不存在: ${jsonPath}`);  // ❌
}
```

**修改后**：
```typescript
if (!fs.existsSync(jsonPath)) {
  console.log('[getTableData] 表格文件不存在 (新对话或尚未创建表格):', jsonPath);
  const fallbackPath = path.join(this.chatsDir, `${safeChatId}.json`);
  if (fs.existsSync(fallbackPath)) {
    console.log('[getTableData] 从 chats 目录找到备份文件:', fallbackPath);
    const content = fs.readFileSync(fallbackPath, 'utf8');
    const jsonData = JSON.parse(content);
    return { sheets: jsonData.sheets || [], headers: jsonData.headers || {}, data: jsonData.data || {}, sheetDescriptions: {} };
  }
  console.log('[getTableData] 备份文件也不存在，返回空数据');
  return { sheets: [], headers: {}, data: {}, sheetDescriptions: {} };  // ✅
}
```

### 修复 2：在 `requestAIResponse` 中增加异常后的继续日志

**文件**：`src/renderer/components/Character/CharacterDialogueChat/CharacterDialogueChat.hooks.ts:619-624`

**修改前**：
```typescript
} catch (error) {
  addLog(`[CharacterDialogueChat] Failed to load memory table data: ${error}`, 'error');
}
```

**修改后**：
```typescript
} catch (error) {
  addLog(`[CharacterDialogueChat] Failed to load memory table data (will use empty data): ${error}`, 'error');
  // 继续执行，memoryTableData 为空字符串，不影响对话
}
addLog('[CharacterDialogueChat] 记忆表格数据处理完成，继续构建系统提示词', 'info');
```

### 修复 3：在 Token 管理前后增加调试日志

**文件**：`src/renderer/components/Character/CharacterDialogueChat/CharacterDialogueChat.hooks.ts:638-650`

在构建 system prompt 之后、Token 截断之前增加确认日志：

```typescript
// Debug: 显示提示词末尾（背景知识注入位置）
const promptTail = finalSystemPrompt.substring(Math.max(0, finalSystemPrompt.length - 500));
addLog(`[CharacterDialogueChat] System prompt length: ${finalSystemPrompt.length}, tail: ...${promptTail}`, 'info');

// 新增：确认可以继续
addLog('[CharacterDialogueChat] 提示词构建完成，开始 Token 管理', 'info');

// ========== Token管理与上下文截断 ==========
```

## 修复步骤

1. 修改 `chatLogService.ts` 的 `getTableData` 方法，使文件不存在时返回空数据而非抛异常
2. 在 `CharacterDialogueChat.hooks.ts` 中增加更多调试日志，便于后续排查
3. 重新构建应用并测试对话功能