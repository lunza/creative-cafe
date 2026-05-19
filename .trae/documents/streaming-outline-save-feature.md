# 流式大纲生成与手动保存功能实现计划

## 目标
将大纲生成流程从"生成→自动解析→自动保存"改为"生成→保留原始JSON→手动点击保存→解析并保存"，确保 AI 原始响应不因解析失败而丢失，同时支持在生成中点击按钮中止请求。

## 涉及文件
1. `src/main/services/writing/OutlineGenerator.ts` — 添加 AbortSignal 支持
2. `src/main/ipc/handlers/writingHandlers.ts` — 拆分 handler，新增 saveOutline
3. `src/main/preload.ts` — 新增 saveOutline IPC 方法
4. `src/renderer/components/Creative/WritingMode/WritingConfigModal.tsx` — 核心 UI 改动
5. `src/renderer/components/Creative/WritingMode/WritingConfigPanel.tsx` — 同步修改

---

## 步骤 1: OutlineGenerator 添加 AbortSignal 支持

**文件**: `src/main/services/writing/OutlineGenerator.ts`

### 1.1 添加 abortSignal 参数到 `generate()` 方法
```typescript
async generate(
  messages: ChatMessage[],
  modelConfig: ModelConfig,
  abortSignal?: AbortSignal  // 新增
): Promise<OutlineGenerationResult>
```

### 1.2 在 fetch 调用中传入 signal
```typescript
const response = await fetch(`${baseUrl}/v1/chat/completions`, {
  method: 'POST',
  headers,
  body: JSON.stringify(requestBody),
  signal: abortSignal  // 新增
});
```

### 1.3 在 `readStreamResponse()` 中处理 AbortError
在 while 循环中捕获 AbortError，当 abort 时返回已累积的内容而非抛异常：
```typescript
try {
  while (true) {
    const { done, value } = await reader.read();
    // ...existing logic
  }
} catch (error) {
  if (error instanceof DOMException && error.name === 'AbortError') {
    console.log('[OutlineGenerator] Stream aborted, returning accumulated content');
    return fullContent;  // 返回已累积内容
  }
  throw error;
}
```

### 1.4 修改 `generate()` 方法末尾逻辑
当 `rawContent` 来自 abort（非空但不完整），仍然返回而非抛异常：
```typescript
// 如果 rawContent 为空且没有 abort，才抛异常
if (!rawContent && !abortSignal?.aborted) {
  throw this.createError(...)
}
```

---

## 步骤 2: 修改 writingHandlers — 拆分生成与保存

**文件**: `src/main/ipc/handlers/writingHandlers.ts`

### 2.1 修改 `writing:generateOutline` handler
- 注册 abortController 到 `activeAbortControllers` map（使用固定 key 如 `'outline_generate'`）
- 将 abortController.signal 传递给 outlineGenerator.generate()
- **关键改动**：handler 返回原始 JSON 字符串，不执行解析逻辑
- 返回格式：`{ success: true, outline: null, outlineRaw: rawContent }`

```typescript
ipcMain.handle('writing:generateOutline', async (event, request) => {
  // ... 验证和加载资源 ...
  
  const abortController = new AbortController();
  activeAbortControllers.set('outline_generate', abortController);
  
  try {
    // ... 加载资源 ...
    
    // 注册 stream chunk 回调
    outlineGenerator.onStreamChunk((chunk: string) => {
      event.sender.send('writing:stream:chunk', { chunk });
    });
    
    const result = await outlineGenerator.generate(
      outlineGenerator.buildPrompt({ ...request, resources, _resourceContext: resourceContext }),
      request.modelConfig,
      abortController.signal  // 传入 signal
    );
    
    activeAbortControllers.delete('outline_generate');
    
    return {
      success: true,
      outline: null,      // 不返回解析后的大纲
      outlineRaw: result.rawContent  // 只返回原始 JSON
    };
  } catch (error) {
    activeAbortControllers.delete('outline_generate');
    // ... 错误处理 ...
  }
});
```

### 2.2 新增 `writing:saveOutline` handler
```typescript
ipcMain.handle('writing:saveOutline', async (_event, { rawContent, config }) => {
  try {
    if (!rawContent) {
      return { success: false, error: '原始内容为空' };
    }
    
    const outline = outlineGenerator.parseOutlineResponse(rawContent);
    
    // 创建项目
    const projectResult = await ipcMain.emit('writing:createProject', { args: [config] });
    // 或者直接调用 writingStorageService 创建项目
    
    return {
      success: true,
      outline,
      outlineRaw: rawContent
    };
  } catch (error) {
    return {
      success: false,
      outline: null,
      outlineRaw: rawContent,  // 即使解析失败也返回原始内容
      error: error instanceof Error ? error.message : '解析失败'
    };
  }
});
```

### 2.3 修改 `writing:cancelGeneration` handler
确保能取消 outline 生成请求：
```typescript
ipcMain.handle('writing:cancelGeneration', async (_event, _params) => {
  // 取消大纲生成
  const outlineController = activeAbortControllers.get('outline_generate');
  if (outlineController) {
    outlineController.abort();
    activeAbortControllers.delete('outline_generate');
  }
  // ... 原有的章节生成取消逻辑 ...
  return { success: true };
});
```

---

## 步骤 3: 添加 preload IPC 方法

**文件**: `src/main/preload.ts`

### 3.1 在 writing API 中新增 `saveOutline` 方法
```typescript
writing: {
  // ... existing methods ...
  saveOutline: (rawContent: string, config: any) => 
    ipcRenderer.invoke('writing:saveOutline', { rawContent, config }),
  // ... existing methods ...
}
```

---

## 步骤 4: 修改 WritingConfigModal UI 和逻辑

**文件**: `src/renderer/components/Creative/WritingMode/WritingConfigModal.tsx`

### 4.1 新增/修改状态变量
```typescript
const [pendingRawJson, setPendingRawJson] = useState<string | null>(null);  // 存储 AI 原始响应
const [saving, setSaving] = useState(false);  // 保存中的 loading 状态
const [generationAborted, setGenerationAborted] = useState(false);  // 是否被中止
```

### 4.2 重构 `handleGenerateOutline` — 仅发送请求并存储原始 JSON
```typescript
const handleGenerateOutline = async (values: any) => {
  // ... 验证 ...
  
  setLoading(true);
  setIsGenerating(true);
  setStreamContent('');
  setError(null);
  setPendingRawJson(null);  // 清空之前的结果
  setGenerationAborted(false);
  lastConfigRef.current = { values, config };
  
  try {
    // ... 设置 stream 监听器 ...
    
    const result = await window.electronAPI.writing.generateOutline({
      resources: config.resources,
      parameters: config.parameters,
      modelConfig: config.modelConfig
    });
    
    // ... 清理监听器 ...
    
    // 关键改动：不自动解析/保存，只存储原始 JSON
    if (result.outlineRaw) {
      setPendingRawJson(result.outlineRaw);
      setStreamContent(result.outlineRaw);  // 显示完整 JSON
    } else if (!result.success) {
      message.error(result.error || '大纲生成失败');
    }
  } catch (error: any) {
    // ... 错误处理 ...
  } finally {
    setLoading(false);
    setIsGenerating(false);
  }
};
```

### 4.3 新增 `handleCancelGeneration` — 调用 IPC 中止请求
```typescript
const handleCancelGeneration = async () => {
  await window.electronAPI.writing.cancelGeneration('');  // 空字符串表示取消大纲生成
  setGenerationAborted(true);
  setLoading(false);
  setIsGenerating(false);
  message.info('已中止生成');
};
```

### 4.4 新增 `handleSaveOutline` — 解析并保存大纲
```typescript
const handleSaveOutline = async () => {
  if (!pendingRawJson || !lastConfigRef.current) return;
  
  setSaving(true);
  try {
    const result = await window.electronAPI.writing.saveOutline(
      pendingRawJson,
      lastConfigRef.current.config
    );
    
    if (result.success && result.outline) {
      useWritingModeStore.getState().setOutline(result.outline);
      useWritingModeStore.getState().setConfig(lastConfigRef.current.config);
      useWritingModeStore.getState().setOutlineRaw(pendingRawJson);
      onConfirm(lastConfigRef.current.config);
    } else {
      message.warning({
        content: `解析失败: ${result.error || '未知错误'}，但原始内容已保留`,
        duration: 10
      });
    }
  } catch (error: any) {
    message.error(error?.message || '保存大纲失败');
  } finally {
    setSaving(false);
  }
};
```

### 4.5 修改按钮区域 UI
```tsx
{isGenerating && !pendingRawJson && (
  /* 生成中: 显示流式内容 + 中止按钮 */
  <div style={{ marginTop: 16 }}>
    <div style={{ marginBottom: 8, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
      <span style={{ fontWeight: 600 }}>AI 生成中...</span>
      <Button danger onClick={handleCancelGeneration}>中止生成</Button>
    </div>
    <TextArea ref={streamRef} value={streamContent} readOnly rows={12} 
      style={{ fontFamily: 'monospace', fontSize: 13, lineHeight: 1.6 }} />
  </div>
)}

{pendingRawJson && !isGenerating && (
  /* 生成完成: 显示完整 JSON + 保存/重新生成按钮 */
  <div style={{ marginTop: 16 }}>
    <div style={{ marginBottom: 8, fontWeight: 600 }}>AI 生成完成 — 请查看后保存</div>
    <TextArea ref={streamRef} value={streamContent} readOnly rows={12}
      style={{ fontFamily: 'monospace', fontSize: 13, lineHeight: 1.6 }} />
  </div>
)}

{generationAborted && !pendingRawJson && (
  /* 被中止: 提示 + 重试按钮 */
  <div style={{ marginTop: 16, textAlign: 'center' }}>
    <div style={{ marginBottom: 16, color: '#999' }}>生成已中止</div>
    <Button type="primary" onClick={handleRetryGeneration}>重试</Button>
  </div>
)}
```

### 4.6 修改底部按钮
```tsx
{!isGenerating && pendingRawJson && (
  <>
    <Button onClick={() => { setPendingRawJson(null); handleGenerateOutline(form.getFieldsValue()); }}>
      重新生成
    </Button>
    <Button type="primary" loading={saving} onClick={handleSaveOutline} size="large">
      保存大纲
    </Button>
  </>
)}

{!isGenerating && !pendingRawJson && !generationAborted && (
  <>
    <Button onClick={handleManualCreateOutline}>手动创建大纲</Button>
    <Button type="primary" onClick={() => handleGenerateOutline(form.getFieldsValue())} size="large">
      生成大纲
    </Button>
  </>
)}
```

---

## 步骤 5: 同步修改 WritingConfigPanel

**文件**: `src/renderer/components/Creative/WritingMode/WritingConfigPanel.tsx`

应用与 WritingConfigModal 相同的修改逻辑（步骤 4.1 ~ 4.6）。

---

## 关键交互流程

```
用户填写表单 → 点击"生成大纲"
  → AI 请求开始，按钮变为"中止生成"(红色)
  → 流式内容实时显示在下方文本区
  → 用户可随时点击"中止生成"终止请求
  
AI 请求完成
  → 流式内容完整显示（完整 JSON 原始响应）
  → 出现两个按钮: "重新生成" 和 "保存大纲"
  → 原始 JSON 保留在 pendingRawJson 中

用户点击"保存大纲"
  → 发送 rawContent 到主进程解析
  → 解析成功: 写入 Store，关闭 Modal，进入创作模式
  → 解析失败: 提示错误，但仍显示原始内容，用户可手动修正后保存
```

## 技术要点

1. **Abort 机制**: OutlineGenerator.generate() 需要支持 AbortSignal，fetch 和 stream reader 都能响应 abort
2. **临时存储**: pendingRawJson 存储在组件 state 中，关闭 Modal 时自动丢弃
3. **解析错误处理**: 即使解析失败，rawContent 也会返回给前端显示
4. **向后兼容**: 保留 existing IPC 接口，新增 saveOutline 而非替换
