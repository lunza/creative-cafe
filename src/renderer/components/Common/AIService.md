# AI 服务组件文档

## 组件简介

AIService 是一个基于 Vercel AI SDK 的 AI 服务器请求公用组件，用于封装与 AI 服务器之间的消息请求与响应交互功能。该组件提供了统一的 API 接口，支持请求参数的灵活配置、完整的错误处理机制、请求状态管理等功能。

## 目录结构

```
src/renderer/components/Common/
├── AIService.tsx          # 主组件文件
├── AIService.types.ts     # 类型定义文件
├── AIService.utils.ts     # 工具函数文件
└── AIService.md           # 文档文件
```

## 核心功能

1. **请求封装**：封装 Vercel AI SDK 的核心请求逻辑
2. **参数配置**：支持灵活的请求参数配置
3. **错误处理**：实现完整的错误处理机制
4. **状态管理**：添加请求状态管理
5. **可复用性**：确保组件的可复用性与可扩展性

## API 接口

### 类：AIService

#### 构造函数

```typescript
new AIService(config: AIServiceConfig)
```

**参数**：
- `config`：AI 服务配置，包含默认模型、API 密钥等信息

**返回值**：
- AIService 实例

#### 方法：sendChatRequest

发送聊天请求

```typescript
async sendChatRequest(options: AIRequestOptions): Promise<AIResult>
```

**参数**：
- `options`：请求参数，包含模型、消息、温度等配置

**返回值**：
- `AIResult`：包含响应数据、错误信息、请求状态等

#### 方法：sendStreamChatRequest

发送流式聊天请求

```typescript
async sendStreamChatRequest(options: AIRequestOptions, streamOptions: AIStreamOptions): Promise<void>
```

**参数**：
- `options`：请求参数，包含模型、消息、温度等配置
- `streamOptions`：流式响应选项，包含回调函数

#### 方法：sendCompletionRequest

发送补全请求

```typescript
async sendCompletionRequest(options: AIRequestOptions): Promise<AIResult>
```

**参数**：
- `options`：请求参数，包含模型、消息、温度等配置

**返回值**：
- `AIResult`：包含响应数据、错误信息、请求状态等

#### 方法：sendStreamCompletionRequest

发送流式补全请求

```typescript
async sendStreamCompletionRequest(options: AIRequestOptions, streamOptions: AIStreamOptions): Promise<void>
```

**参数**：
- `options`：请求参数，包含模型、消息、温度等配置
- `streamOptions`：流式响应选项，包含回调函数

#### 方法：getConfig

获取配置

```typescript
getConfig(): AIServiceConfig
```

**返回值**：
- `AIServiceConfig`：当前配置

#### 方法：updateConfig

更新配置

```typescript
updateConfig(config: Partial<AIServiceConfig>): void
```

**参数**：
- `config`：新的配置部分

### Hook：useAIService

自定义 Hook，用于在 React 组件中使用 AI 服务

```typescript
function useAIService(config: AIServiceConfig): {
  aiService: AIService;
  status: AIRequestStatus;
  response: any;
  error: AIError | null;
  responseTime: number | null;
  sendChatRequest: (options: AIRequestOptions) => Promise<AIResult>;
  sendStreamChatRequest: (options: AIRequestOptions, streamOptions: AIStreamOptions) => Promise<void>;
  sendCompletionRequest: (options: AIRequestOptions) => Promise<AIResult>;
  sendStreamCompletionRequest: (options: AIRequestOptions, streamOptions: AIStreamOptions) => Promise<void>;
  reset: () => void;
}
```

**参数**：
- `config`：AI 服务配置

**返回值**：
- 包含 AI 服务实例、请求状态、响应数据、错误信息等

### 默认导出

```typescript
// 默认配置
export const defaultAIServiceConfig: AIServiceConfig

// 默认 AI 服务实例
export const defaultAIService: AIService
```

## 类型定义

### AIRequestOptions

请求参数类型

```typescript
interface AIRequestOptions {
  model: string;           // 模型名称
  baseUrl?: string;        // API 基础 URL
  apiKey?: string;         // API 密钥
  messages: AIChatMessage[]; // 消息内容
  temperature?: number;    // 温度参数
  maxTokens?: number;      // 最大 tokens
  context?: Record<string, any>; // 上下文信息
  [key: string]: any;      // 其他参数
}
```

### AIChatMessage

聊天消息类型

```typescript
interface AIChatMessage {
  role: 'user' | 'assistant' | 'system'; // 角色
  content: string;                       // 内容
  name?: string;                        // 名称
}
```

### AIResponse

响应类型

```typescript
interface AIResponse {
  content: string;        // 响应内容
  finishReason: string;   // 完成状态
  usage?: {
    promptTokens: number;    // 提示词 tokens
    completionTokens: number; // 完成 tokens
    totalTokens: number;      // 总 tokens
  };
  id: string;            // 响应 ID
  [key: string]: any;    // 其他响应数据
}
```

### AIError

错误类型

```typescript
interface AIError {
  message: string;                // 错误消息
  type: 'network' | 'server' | 'api' | 'validation' | 'unknown'; // 错误类型
  code?: string;                  // 错误代码
  details?: any;                  // 错误详情
}
```

### AIRequestStatus

状态类型

```typescript
type AIRequestStatus = 'idle' | 'loading' | 'success' | 'error';
```

### AIServiceConfig

AI 服务配置类型

```typescript
interface AIServiceConfig {
  defaultModel: string;       // 默认模型
  defaultBaseUrl?: string;    // 默认 API 基础 URL
  defaultApiKey?: string;     // 默认 API 密钥
  defaultTemperature?: number; // 默认温度参数
  defaultMaxTokens?: number;  // 默认最大 tokens
  retryAttempts?: number;     // 重试次数
  retryDelay?: number;        // 重试延迟（毫秒）
}
```

### AIResult

AI 服务结果类型

```typescript
interface AIResult {
  response?: AIResponse;     // 响应数据
  error?: AIError;          // 错误信息
  status: AIRequestStatus;   // 请求状态
  responseTime?: number;     // 响应时间（毫秒）
}
```

### AIStreamCallback

流式响应回调类型

```typescript
type AIStreamCallback = (chunk: string, isDone: boolean) => void;
```

### AIStreamOptions

流式响应选项类型

```typescript
interface AIStreamOptions {
  onStream: AIStreamCallback;  // 流式回调
  onError?: (error: AIError) => void; // 错误回调
  onComplete?: (response: AIResponse) => void; // 完成回调
}
```

## 使用示例

### 基本使用

```typescript
import { AIService, defaultAIServiceConfig } from './Common/AIService';

// 创建 AI 服务实例
const aiService = new AIService({
  ...defaultAIServiceConfig,
  defaultModel: 'gpt-3.5-turbo',
  defaultApiKey: 'your-api-key'
});

// 发送聊天请求
async function sendMessage() {
  const result = await aiService.sendChatRequest({
    messages: [
      {
        role: 'user',
        content: 'Hello, how are you?'
      }
    ]
  });

  if (result.status === 'success') {
    console.log('Response:', result.response?.content);
  } else {
    console.error('Error:', result.error?.message);
  }
}
```

### 使用 Hook

```typescript
import React, { useState } from 'react';
import { useAIService, defaultAIServiceConfig } from './Common/AIService';

function ChatComponent() {
  const [message, setMessage] = useState('');
  const [response, setResponse] = useState('');
  
  const {
    status,
    error,
    sendChatRequest
  } = useAIService({
    ...defaultAIServiceConfig,
    defaultModel: 'gpt-3.5-turbo',
    defaultApiKey: 'your-api-key'
  });

  const handleSend = async () => {
    const result = await sendChatRequest({
      messages: [
        {
          role: 'user',
          content: message
        }
      ]
    });

    if (result.status === 'success') {
      setResponse(result.response?.content || '');
    }
  };

  return (
    <div>
      <input
        type="text"
        value={message}
        onChange={(e) => setMessage(e.target.value)}
      />
      <button onClick={handleSend} disabled={status === 'loading'}>
        {status === 'loading' ? 'Sending...' : 'Send'}
      </button>
      {error && <div>Error: {error.message}</div>}
      {response && <div>Response: {response}</div>}
    </div>
  );
}
```

### 流式请求

```typescript
import { AIService, defaultAIServiceConfig } from './Common/AIService';

// 创建 AI 服务实例
const aiService = new AIService({
  ...defaultAIServiceConfig,
  defaultModel: 'gpt-3.5-turbo',
  defaultApiKey: 'your-api-key'
});

// 发送流式聊天请求
async function sendStreamMessage() {
  let fullResponse = '';

  await aiService.sendStreamChatRequest(
    {
      messages: [
        {
          role: 'user',
          content: 'Write a short story about a cat'
        }
      ]
    },
    {
      onStream: (chunk, isDone) => {
        fullResponse += chunk;
        console.log('Chunk:', chunk);
        if (isDone) {
          console.log('Full response:', fullResponse);
        }
      },
      onError: (error) => {
        console.error('Error:', error.message);
      },
      onComplete: (response) => {
        console.log('Complete response:', response);
      }
    }
  );
}
```

## 错误处理

AIService 提供了完整的错误处理机制，能够捕获并处理以下类型的错误：

1. **网络错误**：网络连接失败、超时等
2. **服务器错误**：服务器返回 5xx 错误
3. **API 错误**：API 返回 4xx 错误
4. **验证错误**：请求参数验证失败
5. **未知错误**：其他类型的错误

## 配置选项

| 配置项 | 类型 | 默认值 | 说明 |
|--------|------|--------|------|
| defaultModel | string | 'gpt-3.5-turbo' | 默认模型 |
| defaultBaseUrl | string | undefined | 默认 API 基础 URL |
| defaultApiKey | string | undefined | 默认 API 密钥 |
| defaultTemperature | number | 0.7 | 默认温度参数 |
| defaultMaxTokens | number | 1000 | 默认最大 tokens |
| retryAttempts | number | 3 | 重试次数 |
| retryDelay | number | 1000 | 重试延迟（毫秒） |

## 最佳实践

1. **使用默认配置**：对于简单场景，使用默认配置可以快速开始
2. **自定义配置**：对于复杂场景，根据需要自定义配置
3. **错误处理**：总是处理请求可能出现的错误
4. **流式请求**：对于长响应，使用流式请求可以提高用户体验
5. **参数验证**：在发送请求前，确保请求参数的正确性

## 注意事项

1. **API 密钥安全**：不要在代码中硬编码 API 密钥，应该使用环境变量或安全的配置管理
2. **请求限制**：注意 API 的请求频率限制，避免超出限制
3. **错误重试**：对于网络错误，可以使用重试机制提高可靠性
4. **响应时间**：对于复杂请求，响应时间可能较长，应该提供加载状态
5. **数据安全**：不要在请求中包含敏感信息

## 版本历史

### v1.0.0
- 初始版本
- 支持聊天请求和补全请求
- 支持流式响应
- 实现完整的错误处理
- 提供自定义 Hook
