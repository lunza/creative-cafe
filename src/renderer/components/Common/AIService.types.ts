// AI 服务类型定义

// 请求参数类型
export interface AIRequestOptions {
  // 模型名称
  model: string;
  // API 基础 URL
  baseUrl?: string;
  // API 密钥
  apiKey?: string;
  // 消息内容
  messages: AIChatMessage[];
  // 温度参数
  temperature?: number;
  // 最大 tokens
  maxTokens?: number;
  // 上下文信息
  context?: Record<string, any>;
  // 其他参数
  [key: string]: any;
}

// 聊天消息类型
export interface AIChatMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
  name?: string;
}

// 响应类型
export interface AIResponse {
  // 响应内容
  content: string;
  // 完成状态
  finishReason: string;
  // 消耗的 tokens
  usage?: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  };
  // 响应 ID
  id: string;
  // 其他响应数据
  [key: string]: any;
}

// 错误类型
export interface AIError {
  // 错误消息
  message: string;
  // 错误类型
  type: 'network' | 'server' | 'api' | 'validation' | 'unknown';
  // 错误代码
  code?: string;
  // 错误详情
  details?: any;
}

// 状态类型
export type AIRequestStatus = 'idle' | 'loading' | 'success' | 'error';

// AI 服务配置类型
export interface AIServiceConfig {
  // 默认模型
  defaultModel: string;
  // 默认 API 基础 URL
  defaultBaseUrl?: string;
  // 默认 API 密钥
  defaultApiKey?: string;
  // 默认温度参数
  defaultTemperature?: number;
  // 默认最大 tokens
  defaultMaxTokens?: number;
  // 重试次数
  retryAttempts?: number;
  // 重试延迟（毫秒）
  retryDelay?: number;
  // 请求超时（毫秒）
  timeout?: number;
  // 系统提示词
  systemPrompt?: string;
}

// AI 服务结果类型
export interface AIResult {
  // 响应数据
  response?: AIResponse;
  // 错误信息
  error?: AIError;
  // 请求状态
  status: AIRequestStatus;
  // 响应时间（毫秒）
  responseTime?: number;
}

// 流式响应回调类型
export type AIStreamCallback = (chunk: string, isDone: boolean) => void;

// 流式响应选项类型
export interface AIStreamOptions {
  // 流式回调
  onStream: AIStreamCallback;
  // 错误回调
  onError?: (error: AIError) => void;
  // 完成回调
  onComplete?: (response: AIResponse) => void;
}
