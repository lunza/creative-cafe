# 综合修复：AI 响应中 HTML 注释封装对象解析兼容性

## 问题描述

当 AI 在 tableEdit 命令的 JSON 数据值中嵌入 HTML 注释（如 `"3":"露娜<!-- 兽 -->"`）时，解析器完全失效，所有命令无法执行。

## AI 返回的实际数据示例

```html
<!--  <tableEdit>
insertRow(2, {"2":"zhudi_001","3":"朱迪<!-- 药 -->","4":"药剂师/兔兽娘"})
insertRow(2, {"2":"luna_002","3":"露娜<!-- 兽 -->","4":"普通兽娘/地狱犬"})
insertRow(2, {"2":"diane_003","3":"黛安<!-- 黑 -->","4":"黑客/赤狐"})
...
</tableEdit> -->
```

## 根因分析

### 核心问题：`extractCommentText` 的非贪婪正则在遇到嵌套 HTML 注释时错误截断

`tableEditParser.ts:L141` 使用 `HTML_COMMENT_REGEX = /<!--([\s\S]*?)-->/g`（非贪婪 `*?`）匹配所有 HTML 注释。

当 `content` 为（hooks.ts 传入的内容）：
```
<!--
insertRow(2, {"2":"zhudi_001","3":"朱迪<!-- 药 -->","4":"..."})
-->
```

非贪婪正则 `<!--([\s\S]*?)-->` 的匹配行为：
1. 引擎找到第一个 `<!--`（在 `insertRow` 之前）
2. `[\s\S]*?` 非贪婪，尽可能少匹配
3. 找到第一个 `-->`（即 `药 -->`）
4. **第一个匹配结果**：捕获组 = `\ninsertRow(2, {"2":"zhudi_001","3":"朱迪`

然后引擎继续从 `药 -->` 之后搜索：
5. 找到下一个 `<!--`（即 `兽 -->` 的开头）
6. 匹配到最近的 `-->`
7. **第二个匹配结果**：捕获组 = ` 兽 `

最终 `comments.join('\n')` 产生：
```
insertRow(2, {"2":"zhudi_001","3":"朱迪
 兽 
...
```

导致：
1. **所有 `insertRow` 命令的 JSON 数据被截断**（如 `{"2":"zhudi_001","3":"朱迪` 不完整）
2. **嵌套注释内容被当作独立行**（如 `兽`、`药`、`黑` 等）
3. `JSON.parse` 对截断的数据失败 → 所有命令解析失败
4. 结果：**18 条命令全部失败，0 条执行成功**

### 失效链路

```
AI返回包含嵌套注释的tableEdit
  → CharacterDialogueChat.hooks.ts 正则捕获 <tableEdit>...</tableEdit> 内容
  → 包装为 <tableEdit><!--\n...嵌套注释...\n--></tableEdit>
  → tableEditParser.parse()
  → extractTableEditContents() 提取 <tableEdit> 标签内容
  → extractCommentText() 用非贪婪正则匹配所有 <!-- --> 
  → 嵌套注释（如 <!-- 兽 -->）打断外层注释的完整性
  → 提取的内容被截断
  → parseCommands() 尝试解析截断的命令行
  → parseDataObject() JSON.parse 失败
  → 0 条命令执行成功
```

## 修复方案

### 修复点1：重写 `parseCommands` 方法，不依赖 HTML 注释提取

**修改文件**: `src/main/services/memory/tableEditParser.ts`

**修改位置**: `parseCommands` 方法（L105-L136）

**方案**: 不通过 `extractCommentText` 提取 HTML 注释，而是直接在内容中按行匹配 `insertRow(...)`、`updateRow(...)`、`deleteRow(...)` 命令。命令行格式固定为 `命令名(参数)`，可以直接用正则匹配每一行，完全绕过 HTML 注释的问题。

具体实现：
1. 将内容按 `\n` 分割为行
2. 对每一行，依次尝试匹配 `INSERT_ROW_REGEX`、`UPDATE_ROW_REGEX`、`DELETE_ROW_REGEX`
3. 匹配成功则解析该命令
4. 匹配失败则跳过该行（使用 debug 日志，不产生 error）

这样即使行中包含 `<!-- 兽 -->` 这样的嵌套注释，只要命令行本身的结构完整（如 `insertRow(2, {"3":"朱迪<!-- 药 -->","4":"..."})`），正则就能正确匹配并提取。

### 修复点2：修改 `parseDataObject` 清理 JSON 值中的嵌套 HTML 注释

**修改文件**: `src/main/services/memory/tableEditParser.ts`

**修改位置**: `parseDataObject` 方法（L270-L305）

**方案**: 在尝试解析 JSON 之前，先清理 JSON 字符串中所有嵌套的 `<!-- xxx -->` 注释（这些是 AI 在数据值中嵌入的标记，不是实际数据）。

```typescript
private parseDataObject(dataStr: string): Record<string, string> | null {
  // 清理 JSON 字符串中的嵌套 HTML 注释（如 "朱迪<!-- 药 -->" → "朱迪"）
  const cleanedStr = dataStr.replace(/<!--[\s\S]*?-->/g, '');
  
  try {
    // 首先尝试直接解析清理后的 JSON
    try {
      const parsed = JSON.parse(cleanedStr);
      if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)) {
        const result: Record<string, string> = {};
        for (const [key, value] of Object.entries(parsed)) {
          result[key] = String(value);
        }
        return result;
      }
    } catch {
      // 直接解析失败，尝试规范化后解析
    }
    // ... 后续规范化逻辑不变
}
```

### 修复点3：更新 `parseCommands` 中的日志策略

对于无法匹配任何命令格式的行（可能是空白行、注释行等），使用 `debug` 级别日志而非 `error`，避免产生大量无关错误。

## 实施步骤

1. 修改 `tableEditParser.ts` 的 `parseCommands` 方法，改为直接按行匹配命令正则，不再依赖 `extractCommentText`
2. 修改 `tableEditParser.ts` 的 `parseDataObject` 方法，在解析前清理 JSON 中的嵌套 HTML 注释
3. 验证修改后代码正确性
4. 更新技术文档

## 涉及文件

| 文件 | 修改类型 |
|------|---------|
| `src/main/services/memory/tableEditParser.ts` | 修改 - parseCommands 重写 + parseDataObject 增强 |
