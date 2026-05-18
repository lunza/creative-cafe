# AI 请求卡死问题修复计划

## 问题分析

用户报告 AI 服务器请求有约 50% 概率卡死。通过代码分析发现根本原因：

### 调用链分析

1. **ChatEngine.ts:81** — `timeout: 0` （无超时限制）
2. **aiHandlers.ts:269** — `const effectiveTimeout = timeout || 0` （timeout=0 时仍为 0）
3. **aiHandlers.ts:271** — `if (effectiveTimeout && effectiveTimeout > 0)` （条件不满足，超时机制完全不生效）
4. **aiHandlers.ts:291** — `await fetch(url, ...)` 执行时**没有任何超时保护**

### 根因

`timeout: 0` 被传送到主进程后，因为 `0 || 0 = 0`，`effectiveTimeout` 始终为 0。后续的 `if (effectiveTimeout && effectiveTimeout > 0)` 条件不满足，超时定时器永远不会被设置。这意味着 `fetch()` 调用在以下情况下会无限期挂起：
- AI 服务器响应慢（TTFB 延迟高）
- 网络连接不稳定
- 服务器端处理时间过长

50% 的卡死概率表明服务器响应时间不稳定，有时快有时慢，但没有超时机制来检测和处理慢响应。

## 修复方案

### 方案：添加合理的默认超时机制

采用**双层超时策略**：
1. **连接超时**：30 秒（检测网络连接问题）
2. **请求超时**：120 秒（检测服务器响应慢的问题）

### 修改 1：修改 ChatEngine.ts 的默认超时值

**文件**：`src/renderer/components/Common/ChatEngine/ChatEngine.ts:81`

**修改前**：
```typescript
timeout: 0, // 无超时限制
```

**修改后**：
```typescript
timeout: 120000, // 默认 120 秒超时（AI 生成通常较长）
```

### 修改 2：在 aiHandlers.ts 中添加连接超时和请求超时

**文件**：`src/main/ipc/handlers/aiHandlers.ts:269-296`

**修改前**：
```typescript
const effectiveTimeout = timeout || 0; // 默认无超时限制

if (effectiveTimeout && effectiveTimeout > 0) {
  timeoutId = setTimeout(() => {
    logWarn(`AI 请求超时 (${effectiveTimeout}ms)，正在中止请求`, {...});
    controller?.abort();
  }, effectiveTimeout);
  activeRequests.set(senderId, { controller, timeoutId });
}

const response = await fetch(url, {...});
```

**修改后**：
```typescript
// 添加连接超时（30秒）和请求超时
const CONNECTION_TIMEOUT = 30000; // 30秒连接超时
const effectiveTimeout = timeout || 120000; // 默认 120 秒请求超时

logInfo(`正在发送流式请求到 ${url}...`, {
  timestamp: startTimeStr,
  url: url,
  method: method,
  connectionTimeout: CONNECTION_TIMEOUT,
  requestTimeout: effectiveTimeout
});

// 设置连接超时检测
const connectionTimeoutId = setTimeout(() => {
  logWarn(`AI 请求连接超时 (${CONNECTION_TIMEOUT}ms)，正在中止请求`, {
    timestamp: new Date().toISOString(),
    url: url,
  });
  controller?.abort();
}, CONNECTION_TIMEOUT);

// 设置请求超时
timeoutId = setTimeout(() => {
  logWarn(`AI 请求响应超时 (${effectiveTimeout}ms)，正在中止请求`, {
    timestamp: new Date().toISOString(),
    url: url,
    timeout: effectiveTimeout
  });
  controller?.abort();
}, effectiveTimeout);

activeRequests.set(senderId, { controller, timeoutId, connectionTimeoutId });

try {
  const response = await fetch(url, {...});
  
  // 连接成功，清除连接超时
  clearTimeout(connectionTimeoutId);
  ...
}
```

### 修改 3：更新 ActiveRequest 接口

**文件**：`src/main/ipc/handlers/aiHandlers.ts`（类型定义处）

增加 `connectionTimeoutId` 字段到 `ActiveRequest` 接口。

### 修改 4：在取消和清理逻辑中清除连接超时

在 `ai:cancel` handler 和请求完成后的清理逻辑中，增加对 `connectionTimeoutId` 的清除。

## 技术要点

| 要点 | 说明 |
|------|------|
| **连接超时 30 秒** | 检测网络连接问题（DNS 解析、TCP 连接、TLS 握手） |
| **请求超时 120 秒** | 检测服务器响应慢的问题（TTFB + 流式传输） |
| **默认值 120 秒** | AI 生成通常较长，120 秒足够覆盖大多数场景 |
| **可配置** | 保留 `timeout` 参数，允许上层自定义超时时间 |
| **日志增强** | 区分"连接超时"和"请求超时"，便于排查问题 |

## 实施步骤

1. 修改 `ChatEngine.ts` 的默认 timeout 从 0 改为 120000
2. 在 `aiHandlers.ts` 中添加连接超时机制（30 秒）
3. 修改 `aiHandlers.ts` 的请求超时默认值从 0 改为 120000
4. 更新 `ActiveRequest` 接口和清理逻辑
5. 更新 CHANGELOG.md
