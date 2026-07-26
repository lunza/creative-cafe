# 修复剧情检查返回综合评分=0、问题总数=0（第二次修复）

## 背景

用户报告写作模式剧情检查功能 AI 返回了正常的 JSON，但日志仍显示 `综合评分=0, 问题总数=0`。这是第二次修复——第一次修复添加了 `extractJsonObject` 方法处理"带前后缀文本的 JSON"，但问题仍然存在。

## 根因分析

**综合评分=0 的唯一可能**是 `parseCheckResponse` 走到了 `createFallbackReport` 分支（L552-571），即两次 `JSON.parse` 均失败。正常解析路径不可能产生 overallScore=0（即使 AI 返回 `overall_score: 0`，由于 `0 || Math.round(...)` 的 falsy 特性，结果也会是 50 而非 0）。

### AI 原始响应未被记录

`checkChapter` 方法（L995-1001）接收 `rawContent` 后直接传给 `parseCheckResponse`，**没有在 info 级别记录原始响应**。`parseCheckResponse` 内的 JSON 预览日志都是 debug 级别，默认不可见。这导致无法从日志确认 AI 到底返回了什么。

### JSON 解析失败的 3 个潜在根因

1. **fixJsonForParsing 步骤 3 正则破坏 JSON**（L614）：
   ```ts
   result = result.replace(/(\{|\,)\s*([a-zA-Z_$][a-zA-Z0-9_$]*)\s*:/g, '$1 "$2":');
   ```
   这个正则不考虑字符串边界。如果 JSON 字符串值内部包含 `{key:` 或 `,key:` 模式（在 description/suggestion/analysis 字段中常见），会错误插入引号破坏 JSON 结构。

2. **fixChineseQuotes 在 JSON.parse 之前执行**（L212）：
   fixChineseQuotes 对所有输入执行，即使 JSON 本身已经有效。如果 JSON 字符串值内包含中文引号，`inString` 状态追踪可能出错，破坏原本有效的 JSON。

3. **extractJsonObject 调用条件太窄**（L196）：
   ```ts
   if (!extracted || !jsonStr.startsWith('{')) {
   ```
   当 markdown 代码块正则匹配成功（`extracted=true`）且内容以 `{` 开头时不触发。但代码块正则使用非贪婪匹配 `[\s\S]*?`，如果 JSON 字符串值内部包含 ` ``` `，会截断 JSON。截断的 JSON 以 `{` 开头但以非 `}` 结尾，extractJsonObject 不会触发。

### 解析流程的问题

当前流程：
```
rawContent → markdown提取 → extractJsonObject(条件) → fixChineseQuotes → JSON.parse → (失败) → fixJsonForParsing → JSON.parse → (失败) → fallback
```

问题：
- fixChineseQuotes 在 JSON.parse 之前无条件执行，可能破坏有效 JSON
- fixJsonForParsing 的正则不考虑字符串边界，可能破坏 JSON
- 没有先尝试直接 JSON.parse（跳过所有修复）

## 修改方案

### 修改文件

- `src/main/services/writing/PlotCheckerService.ts`

### 变更 1：记录 AI 原始响应（info 级别）

**位置**：`checkChapter` 方法，L1000 之后

**原因**：当前 rawContent 未被记录，无法从日志确认 AI 实际返回内容

**改动**：在 `const report = this.parseCheckResponse(...)` 之前添加：
```ts
addLog(`【剧情检查】AI 原始响应长度: ${rawContent.length}`, 'info');
addLog(`【剧情检查】AI 原始响应前500字符: ${rawContent.substring(0, 500)}`, 'info');
addLog(`【剧情检查】AI 原始响应后500字符: ${rawContent.substring(Math.max(0, rawContent.length - 500))}`, 'info');
```

### 变更 2：重构 parseCheckResponse 解析流程

**位置**：`parseCheckResponse` 方法，L175-227

**原因**：当前流程在 JSON.parse 之前无条件执行 fixChineseQuotes，可能破坏有效 JSON；fixJsonForParsing 正则不考虑字符串边界

**改动**：将解析流程改为多策略尝试，按优先级从低破坏性到高破坏性：

```ts
private parseCheckResponse(rawContent: string, chapterIndex: number, chapterContent?: string): PlotCheckReport {
  let jsonStr = rawContent.trim();

  // 步骤1: markdown 代码块提取
  const patterns = [
    /```(?:json)?\s*([\s\S]*?)```/,
    /```\s*([\s\S]*?)```/,
  ];
  let extracted = false;
  for (const pattern of patterns) {
    const match = jsonStr.match(pattern);
    if (match && match[1]) {
      jsonStr = match[1].trim();
      extracted = true;
      break;
    }
  }

  // 步骤2: 提取最外层 JSON 对象（无条件执行，处理代码块截断和前后缀文本）
  const extractedJson = this.extractJsonObject(jsonStr);
  if (extractedJson) {
    jsonStr = extractedJson;
  }

  addLog(`【剧情检查】JSON 提取完成, 长度: ${jsonStr.length}`, 'debug');
  addLog(`【剧情检查】JSON 前200字符: ${jsonStr.substring(0, 200)}`, 'debug');

  // 步骤3: 多策略解析（按破坏性递增排序）
  const strategies = [
    { name: '直接解析', fn: (s: string) => s },
    { name: '修复中文引号', fn: (s: string) => this.fixChineseQuotes(s) },
    { name: '修复JSON格式', fn: (s: string) => this.fixJsonForParsing(this.fixChineseQuotes(s)) },
  ];

  let parsed: any = null;
  let lastError: any = null;
  for (const { name, fn } of strategies) {
    try {
      const processed = fn(jsonStr);
      parsed = JSON.parse(processed);
      addLog(`【剧情检查】JSON 解析成功（策略: ${name}）`, 'debug');
      break;
    } catch (err) {
      lastError = err;
      addLog(`【剧情检查】策略"${name}"失败: ${err instanceof Error ? err.message : String(err)}`, 'debug');
    }
  }

  if (!parsed) {
    addLog(`【剧情检查】所有解析策略均失败，最后错误: ${lastError instanceof Error ? lastError.message : String(lastError)}`, 'error');
    addLog(`【剧情检查】JSON 前500字符: ${jsonStr.substring(0, 500)}`, 'debug');
    return this.createFallbackReport(chapterIndex);
  }

  // ... 后续解析维度数据逻辑保持不变 ...
}
```

### 变更 3：修复 fixJsonForParsing 步骤 3 正则

**位置**：`fixJsonForParsing` 方法，L614

**原因**：正则 `/(\{|\,)\s*([a-zA-Z_$][a-zA-Z0-9_$]*)\s*:/g` 不考虑字符串边界，会在字符串值内部错误插入引号

**改动**：将步骤 3 改为字符级遍历，只在字符串外部执行未加引号键名的修复：

```ts
// 步骤3: 处理键名未加引号的情况（仅在字符串外部）
inString = false;
escapeNext = false;
let step3Result = '';
for (let i = 0; i < result.length; i++) {
  const char = result[i];
  if (escapeNext) { step3Result += char; escapeNext = false; continue; }
  if (char === '\\') { step3Result += char; escapeNext = true; continue; }
  if (char === '"') { inString = !inString; step3Result += char; continue; }
  if (!inString && (char === '{' || char === ',')) {
    // 检查后面是否跟着未加引号的标识符
    const rest = result.substring(i + 1);
    const keyMatch = rest.match(/^\s*([a-zA-Z_$][a-zA-Z0-9_$]*)\s*:/);
    if (keyMatch) {
      step3Result += char + ' "' + keyMatch[1] + '":';
      i += keyMatch[0].length; // 跳过已处理的部分
      continue;
    }
  }
  step3Result += char;
}
result = step3Result;
```

### 变更 4：extractJsonObject 无条件执行

**位置**：`parseCheckResponse` 步骤 2

**原因**：当前条件 `!extracted || !jsonStr.startsWith('{')` 在代码块匹配成功且内容以 `{` 开头时不触发，无法处理代码块截断情况

**改动**：已在变更 2 的新流程中改为无条件执行 extractJsonObject

## 验证步骤

1. **类型检查**：修改后运行 `GetDiagnostics` 确认无 TypeScript 错误
2. **日志验证**：用户下次执行剧情检查时，info 级别日志应包含：
   - `【剧情检查】AI 原始响应长度: XXX`
   - `【剧情检查】AI 原始响应前500字符: ...`
   - `【剧情检查】AI 原始响应后500字符: ...`
3. **功能验证**：
   - 如果 AI 返回有效 JSON（无 markdown 代码块、无前后缀），策略"直接解析"应成功
   - 如果 AI 返回带中文引号的 JSON，策略"修复中文引号"应成功
   - 如果 AI 返回带字面换行/未加引号键名的 JSON，策略"修复JSON格式"应成功
   - 综合评分和问题总数应反映 AI 实际返回值，不再是 0

## 假设与决策

- **假设**：AI 确实返回了包含 overall_score 和 dimension_scores 的 JSON，但格式可能有瑕疵（中文引号、字面换行、未加引号键名等）
- **决策**：采用多策略递进解析，先尝试最小破坏性的直接解析，失败后逐步加强修复力度。这避免了对有效 JSON 的误修复
- **不改动**：`fixChineseQuotes` 方法本身保持不变（其逻辑对纯中文引号场景正确），只是不再无条件在 JSON.parse 之前执行
- **不改动**：`extractJsonObject` 方法本身保持不变（实现正确），只是调用方式改为无条件
