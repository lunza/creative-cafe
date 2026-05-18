# 对话功能修复失败 - 深度排查与修复计划

## 当前问题分析

### 日志证据

```
[getTableData] 从 chats 目录找到备份文件: C:\Users\master\AppData\Roaming\creative-cafe\data\memories\chats\狼人杀助手2.0.json
[IPC] memory:getTableData 返回结果: { "sheets": [], "headersKeys": [], "dataKeys": [], "dataSummary": {} }
```

**关键发现**：
1. 备份文件 `chats/狼人杀助手2.0.json` **存在且被成功读取**
2. 主进程成功返回了 `getTableData` 调用结果（空数据）
3. **之后渲染进程没有任何日志输出**，说明 `await window.electronAPI.memory.getTableData(chatId)` 返回值后，后续代码没有继续执行或 `addLog` 调用阻塞了

### 根因推断

`getTableData` 返回空数据后，渲染进程继续执行，但所有后续操作（`addLog`、`buildCompleteSystemPrompt`、Token 管理等）都使用 `addLog` 记录日志。如果 `addLog` 通过 IPC 发送日志到主进程时出现问题（例如 IPC 通道阻塞），整个执行流可能被挂起。

此外，备份文件读取返回的 `{ sheets: [], headers: {}, data: {} }` 虽然是合法的，但 `getTableData` 方法在正常路径下还会获取 `sheetDescriptions`（通过关联模板）。备份路径直接返回时缺少这个字段，可能导致下游代码异常。

### 核心问题

**`getTableData` 备份文件读取分支返回的对象结构与正常路径不一致**：
- 正常路径返回：`{ sheets, headers, data, sheetDescriptions }`
- 备份路径返回：`{ sheets, headers, data, sheetDescriptions: {} }`

虽然结构看起来一致，但问题可能在于备份文件本身的内容为空或格式不正确，导致返回了看似合法但实际上导致后续处理失败的数据。

## 修复方案

### 步骤1：在 `requestAIResponse` 函数中添加全局 try-catch 和关键节点 `console.log` 日志

**文件**：`src/renderer/components/Character/CharacterDialogueChat/CharacterDialogueChat.hooks.ts`

在 `requestAIResponse` 函数的最外层添加 try-catch 包裹，确保任何未捕获的异常都能被记录。同时在每个关键步骤添加 `console.log` 日志（不依赖 `addLog` 的 IPC 通道）：

```typescript
const requestAIResponse = useCallback(async (
  contextMessages: ChatMessage[],
  targetMessageId: string,
  initialContent: string = '',
  promptType: 'dialogue' | 'continuation' = 'dialogue'
) => {
  try {
    console.log('[DEBUG-FLOW] === requestAIResponse START ===');
    console.log('[DEBUG-FLOW] promptType:', promptType);
    console.log('[DEBUG-FLOW] contextMessages count:', contextMessages.length);

    // ... 现有代码：activeEngine 检查、effectiveParams 获取等 ...

    // 步骤A：向量知识库检索
    console.log('[DEBUG-FLOW] Step A: Starting context retrieval');
    // ... 现有 retrieval 代码 ...
    console.log('[DEBUG-FLOW] Step A: Context retrieval done, items:', vectorContextItems.length);

    // 记忆表格数据获取
    console.log('[DEBUG-FLOW] Step B: Starting memory table data fetch');
    console.log('[DEBUG-FLOW] memoryTableEnabledRef.current:', memoryTableEnabledRef.current);
    // ... 现有 getTableData 代码 ...
    console.log('[DEBUG-FLOW] Step B: Memory table data fetch done, memoryTableData length:', memoryTableData.length);

    // 构建 system prompt
    console.log('[DEBUG-FLOW] Step C: Starting buildCompleteSystemPrompt');
    console.log('[DEBUG-FLOW]   vectorContextItems:', vectorContextItems.length);
    console.log('[DEBUG-FLOW]   memoryTableData length:', memoryTableData.length);
    const finalSystemPrompt = buildCompleteSystemPrompt(...);
    console.log('[DEBUG-FLOW] Step C: buildCompleteSystemPrompt done, length:', finalSystemPrompt.length);

    // Token 管理
    console.log('[DEBUG-FLOW] Step D: Starting token management');
    // ... 现有 Token 管理代码 ...
    console.log('[DEBUG-FLOW] Step D: Token management done, messagesToUse count:', messagesToUse.length);

    // 调用 engine.sendMessage
    console.log('[DEBUG-FLOW] Step E: Calling engine.sendMessage');
    await engine.sendMessage(messagesToUse, finalSystemPrompt, engineConfigWithParams);
    console.log('[DEBUG-FLOW] Step E: engine.sendMessage returned');

    console.log('[DEBUG-FLOW] === requestAIResponse END ===');
  } catch (error) {
    console.error('[DEBUG-FLOW] !!! requestAIResponse UNCAUGHT EXCEPTION:', error);
    console.error('[DEBUG-FLOW] !!! error stack:', error instanceof Error ? error.stack : 'N/A');
    // 更新 UI 状态显示错误
    setState(prev => ({
      ...prev,
      messages: prev.messages.map(msg =>
        msg.id === targetMessageId
          ? { ...msg, content: `错误: ${error instanceof Error ? error.message : '未知错误'}`, status: 'error' as const }
          : msg
      ),
      isLoading: false,
      isStreaming: false,
      error: error instanceof Error ? error.message : '未知错误',
    }));
    message.error(`对话请求失败: ${error instanceof Error ? error.message : '未知错误'}`);
  }
}, [...]);
```

### 步骤2：在 `getTableData` 备份文件读取分支增加 `sheetDescriptions` 字段

**文件**：`src/main/services/memory/chatLogService.ts`

确保备份文件读取分支返回的对象结构与正常路径完全一致：

```typescript
if (fs.existsSync(fallbackPath)) {
  console.log('[getTableData] 从 chats 目录找到备份文件:', fallbackPath);
  try {
    const content = fs.readFileSync(fallbackPath, 'utf8');
    const jsonData = JSON.parse(content);
    // 确保返回结构与正常路径一致
    return { 
      sheets: jsonData.sheets || [], 
      headers: jsonData.headers || {}, 
      data: jsonData.data || {}, 
      sheetDescriptions: {} 
    };
  } catch (e) {
    console.error('[getTableData] 读取备份文件失败:', e);
  }
}
```

### 步骤3：在 `buildCompleteSystemPrompt` 方法中添加防御性检查

**文件**：`src/renderer/components/Character/CharacterDialogueChat/usePromptBuilder.ts`

检查 `buildCompleteSystemPrompt` 方法内部是否有潜在问题：

1. 确认方法不会因传入空数据而挂起
2. 在方法入口和出口添加 `console.log`

### 步骤4：在 IPC 层添加序列化验证日志

**文件**：`src/main/ipc/handlers/memoryHandlers.ts`

在 `memory:getTableData` handler 中，确保返回值可以被正确序列化：

```typescript
ipcMain.handle('memory:getTableData', async (event: IpcMainInvokeEvent, chatId: string): Promise<any> => {
  console.log('[IPC] memory:getTableData 请求, chatId:', chatId);
  const result = chatLogService.getTableData(chatId);
  
  // 验证返回数据可序列化
  const serializableResult = {
    sheets: result?.sheets || [],
    headers: result?.headers || {},
    data: result?.data || {},
    sheetDescriptions: result?.sheetDescriptions || {}
  };
  
  try {
    JSON.stringify(serializableResult);
    console.log('[IPC] memory:getTableData 数据序列化验证通过');
  } catch (e) {
    console.error('[IPC] memory:getTableData 数据序列化失败:', e);
    return { sheets: [], headers: {}, data: {}, sheetDescriptions: {} };
  }
  
  console.log('[IPC] memory:getTableData 返回结果:', JSON.stringify({
    sheets: serializableResult.sheets,
    headersKeys: Object.keys(serializableResult.headers),
    dataKeys: Object.keys(serializableResult.data)
  }, null, 2));
  
  return serializableResult;
});
```

## 实施步骤

1. 在 `CharacterDialogueChat.hooks.ts` 的 `requestAIResponse` 函数外层添加全局 try-catch 包裹
2. 在 `requestAIResponse` 的每个关键步骤添加 `console.log` 调试日志（Step A through Step E）
3. 在 `memoryHandlers.ts` 的 `memory:getTableData` handler 中添加序列化验证
4. 在 `chatLogService.ts` 的备份文件读取分支确保返回结构一致
5. 在 `usePromptBuilder.ts` 的 `buildCompleteSystemPrompt` 方法中添加入口/出口日志
6. 重新构建并测试，查看新增的 `[DEBUG-FLOW]` 日志来确定流程在哪一步中断

## 预期效果

新增的 `console.log` 日志（不依赖 `addLog` 的 IPC 通道）应该能够精确指出流程在哪一步中断：

- `[DEBUG-FLOW] Step A: Context retrieval done` → 上下文检索正常
- `[DEBUG-FLOW] Step B: Memory table data fetch done` → getTableData 调用正常
- `[DEBUG-FLOW] Step C: buildCompleteSystemPrompt done` → 提示词构建正常
- `[DEBUG-FLOW] Step D: Token management done` → Token 管理正常
- `[DEBUG-FLOW] Step E: Calling engine.sendMessage` → 引擎调用正常

如果某一步之后的日志没有出现，就说明问题出在那一步和下一步之间。
