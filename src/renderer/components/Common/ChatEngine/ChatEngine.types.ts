// 聊天引擎类型定义

import { ChatMessage } from './CharacterTestChat.types';

// AI引擎配置接口
export interface AIEngineConfig {
  id: string;
  name: string;
  api_url: string;
  api_key?: string;
  model_name: string;
  api_key_transmission?: 'header' | 'body';
  api_mode?: 'chat_completion' | 'text_completion';
  max_tokens?: number;
  temperature?: number;
  system_prompt?: string;
  // 自定义AI参数（用于覆盖默认配置）
  top_p?: number;
  frequency_penalty?: number;
  presence_penalty?: number;
}

// 流式回调函数类型
export type StreamCallback = (chunk: string, isDone: boolean) => void;

// 完成回调函数类型
export type CompleteCallback = (response: AIResponse) => void;

// 错误回调函数类型
export type ErrorCallback = (error: AIError) => void;

// AI响应接口
export interface AIResponse {
  content: string;
  finishReason: string;
  usage?: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  };
  id: string;
}

// AI错误接口
export interface AIError {
  message: string;
  type: 'network' | 'server' | 'api' | 'validation' | 'unknown';
  code?: string;
  details?: any;
}

// 聊天引擎接口（策略模式）
export interface IChatEngine {
  sendMessage(
    messages: ChatMessage[],
    systemPrompt: string,
    config: AIEngineConfig
  ): Promise<void>;
  
  cancelRequest(): void;
  
  onStream(callback: StreamCallback): void;
  onComplete(callback: CompleteCallback): void;
  onError(callback: ErrorCallback): void;
}

// 引擎工厂配置接口
export interface EngineFactoryConfig {
  engineType: 'default' | 'vercel' | 'custom';
  config: AIEngineConfig;
}
