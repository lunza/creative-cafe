/**
 * AIService — AI 交互模块
 *
 * Spec: redesign-dialogue-pipeline-architecture / Requirement: AI 交互模块（AIService）
 *
 * 封装引擎实例管理、流式通信和错误处理，作为 Pipeline 的 AIService Stage。
 * 职责：
 * - 通过 ChatEngineFactory 获取/复用引擎实例
 * - 管理流式回调（onStream / onComplete / onError）
 * - 300 秒超时自动取消并触发 onError
 * - 故障转移事件订阅
 *
 * 迁移自 CharacterDialogueChat.hooks.ts 中的引擎调用逻辑
 * （engine 创建 ~1098 行、stream 回调 ~1102 行、complete 回调 ~1120 行、
 *   error 回调 ~1639 行、timeout 设置 ~616 行、failover 订阅 ~542 行）。
 */

import type { DialoguePipelineContext } from './pipeline.types';
import type {
  AIEngineConfig,
  EngineCapabilities,
  IChatEngine,
  AIResponse,
  AIError,
} from '../../../Common/ChatEngine/ChatEngine.types';
import { getDefaultEngineCapabilities } from '../../../Common/ChatEngine/ChatEngine.types';
import { ChatEngineFactory } from '../../../Common/ChatEngine/ChatEngine.factory';

/**
 * AIService 回调接口 — 流式通信回调集合。
 */
export interface AIServiceCallbacks {
  /** 流式 chunk 回调，传入当前 chunk 和累积内容 */
  onStream: (chunk: string, accumulated: string) => void;
  /** 完成回调，传入完整内容和结束原因 */
  onComplete: (fullContent: string, finishReason: string) => void;
  /** 错误回调 */
  onError: (error: Error) => void;
}

/**
 * 故障转移信息。
 */
export interface FailoverInfo {
  /** 切换前的 provider */
  fromProvider: string;
  /** 切换后的 provider */
  toProvider: string;
}

/** 超时时间（毫秒）— AI 生成通常较长，统一 300 秒 */
const STREAM_TIMEOUT_MS = 300_000;

/**
 * AIService — AI 交互服务层。
 *
 * 封装 ChatEngineFactory 引擎实例管理和流式通信，
 * 提供 sendMessage / cancel / getCapabilities / setupFailoverSubscription 接口。
 */
export class AIService {
  /** 当前引擎实例 */
  private currentEngine: IChatEngine | null = null;
  /** 当前引擎配置（用于 getCapabilities） */
  private currentEngineConfig: AIEngineConfig | null = null;
  /** 超时计时器句柄 */
  private timeoutHandle: ReturnType<typeof setTimeout> | null = null;

  /**
   * 发送消息并管理流式响应。
   *
   * 流程：
   * 1. 通过 ChatEngineFactory 获取/复用引擎实例
   * 2. 注册 onStream / onComplete / onError 回调（在 sendMessage 之前注册）
   * 3. 启动 300 秒超时定时器
   * 4. 调用 engine.sendMessage 发起请求
   *
   * @param context 管线上下文，包含 messagesToSend / systemPrompt / engineConfig / stopSequences
   * @param callbacks 流式通信回调集合
   */
  async sendMessage(
    context: DialoguePipelineContext,
    callbacks: AIServiceCallbacks,
  ): Promise<void> {
    // 确保停止序列注入到引擎配置中（Spec: 注入 engineConfig 和 stopSequences）
    const finalConfig: AIEngineConfig = {
      ...context.engineConfig,
      stopSequences:
        context.stopSequences.length > 0
          ? context.stopSequences
          : context.engineConfig.stopSequences,
    };

    // 通过工厂获取或复用引擎实例
    const engine = ChatEngineFactory.getInstance().getOrCreateDefaultEngine(finalConfig);
    this.currentEngine = engine;
    this.currentEngineConfig = finalConfig;

    // 流式内容累积变量
    let accumulatedContent = '';

    // 清除可能存在的旧超时定时器
    this.clearStreamTimeout();

    // 设置 300 秒超时 — 超时后取消请求并触发 onError
    this.timeoutHandle = setTimeout(() => {
      engine.cancelRequest();
      callbacks.onError(new Error(`AI 响应超时（${STREAM_TIMEOUT_MS / 1000} 秒）`));
    }, STREAM_TIMEOUT_MS);

    // 注册流式回调 — 累积 chunk 并通知调用方
    engine.onStream((chunk: string, _isDone: boolean) => {
      if (chunk) {
        accumulatedContent += chunk;
        callbacks.onStream(chunk, accumulatedContent);
      }
    });

    // 注册完成回调 — 清除超时，传递完整内容和结束原因
    engine.onComplete((response: AIResponse) => {
      this.clearStreamTimeout();
      // 优先使用流式累积内容，兜底使用服务端返回内容
      const fullContent = accumulatedContent || response.content || '';
      callbacks.onComplete(fullContent, response.finishReason || 'stop');
    });

    // 注册错误回调 — 清除超时，将 AIError 转换为 Error 传递
    engine.onError((error: AIError) => {
      this.clearStreamTimeout();
      callbacks.onError(new Error(error.message));
    });

    // 发起 AI 请求 — 捕获 sendMessage 本身抛出的异常
    try {
      await engine.sendMessage(
        context.messagesToSend,
        context.systemPrompt,
        finalConfig,
      );
    } catch (err) {
      this.clearStreamTimeout();
      callbacks.onError(err instanceof Error ? err : new Error(String(err)));
    }
  }

  /**
   * 取消当前请求。
   * 通过引擎 cancelRequest 中断请求，并清除超时定时器。
   */
  cancel(): void {
    this.clearStreamTimeout();
    if (this.currentEngine) {
      this.currentEngine.cancelRequest();
    }
  }

  /**
   * 获取当前引擎的能力配置。
   * 返回当前引擎配置中的 capabilities，缺省时返回默认能力。
   */
  getCapabilities(): EngineCapabilities {
    if (this.currentEngineConfig?.capabilities) {
      return this.currentEngineConfig.capabilities;
    }
    return getDefaultEngineCapabilities();
  }

  /**
   * 订阅故障转移事件。
   * 当引擎 provider 发生切换时，通过回调通知调用方。
   *
   * @param onFailover 故障转移回调
   * @returns 清理函数，调用后取消订阅
   */
  setupFailoverSubscription(
    onFailover: (info: FailoverInfo) => void,
  ): () => void {
    const electronAPI = (window as any).electronAPI;
    // electronAPI 不可用时返回空清理函数
    if (!electronAPI?.ai?.failover?.onFailover) {
      return () => {};
    }

    const unsubscribe = electronAPI.ai.failover.onFailover(
      (data: {
        type: 'retry' | 'switch';
        toProvider?: string;
        toModel?: string;
        reason: string;
        attempt?: number;
      }) => {
        // 从当前引擎配置获取切换前的 provider 名称
        const fromProvider = this.currentEngineConfig?.name || '';
        const toProvider = data.toProvider || data.toModel || '';
        onFailover({ fromProvider, toProvider });
      },
    );

    return () => {
      if (typeof unsubscribe === 'function') {
        unsubscribe();
      }
    };
  }

  /**
   * 清除超时定时器（内部方法）。
   */
  private clearStreamTimeout(): void {
    if (this.timeoutHandle) {
      clearTimeout(this.timeoutHandle);
      this.timeoutHandle = null;
    }
  }
}
