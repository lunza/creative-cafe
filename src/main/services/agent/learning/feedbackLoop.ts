/**
 * FeedbackLoop —— 反馈回流（适配 openclaw feedback-reflection.ts 理念）
 *
 * 来源：spec §二 Task 18.2（learning/feedbackLoop.ts）
 * 决策：适配（spec §三表格：feedback-reflection 适配）。openclaw 反思依赖 channel
 *       dispatch（feedback 来自 channel thumb_down），本项目扩展为多源反馈：
 *       thumb_down / low_rating / comment / correction。
 *
 * 职责：
 *  1. recordFeedback：记录用户反馈事件
 *  2. runReflection：调用 LLM 反思「为什么这次输出不好？如何改进？」
 *  3. 写回经验记忆（memoryStore，metadata.kind='feedback_learning'）
 *  4. 冷却机制（同 session 5 分钟内仅触发一次反思，照抄 openclaw COOLDOWN_MS）
 *
 * 设计约束（openclaw feedback-reflection.ts 原则）：
 *  - 冷却：DEFAULT_FEEDBACK_COOLDOWN_MS=5min，避免连续负面反馈导致 LLM 成本失控
 *  - JSON 输出：照抄 openclaw {"learning":"...","followUp":false,"userMessage":""}
 *  - 反思结论写入记忆：后续 prompt 可检索该经验避免重复错误
 *  - 失败降级：LLM 反思失败不抛错，仅记录 empty 状态
 *
 * 与 memoryStore 的关系：
 *  - feedback_learning 记忆 type='agent'，可被 agentLoop 检索
 *  - 检索时通过 metadata.kind='feedback_learning' 过滤
 */

import type { ILLMProvider, StreamChatRequest, IMemoryProvider } from '../contracts';
import type { FeedbackEvent, FeedbackReflectionResult } from './types';
import { DEFAULT_FEEDBACK_COOLDOWN_MS } from './types';
import { toAgentError } from '../infra/errors';

// ==================== 类型定义 ====================

/**
 * FeedbackLoop 构造配置。
 */
export interface FeedbackLoopConfig {
  llmProvider: ILLMProvider;
  memoryProvider: IMemoryProvider;
  /** 默认模型名（反思用） */
  defaultModel?: string;
  /** 冷却时间毫秒（默认 5 分钟） */
  cooldownMs?: number;
  /** 反思最大响应字符数（照抄 openclaw MAX_RESPONSE_CHARS） */
  maxResponseChars?: number;
  /** 冷却表最大条目数（照抄 openclaw MAX_COOLDOWN_ENTRIES） */
  maxCooldownEntries?: number;
  /** 调试日志 */
  verbose?: boolean;
}

// ==================== FeedbackLoop 实现 ====================

/**
 * 反馈回流服务。
 *
 * 数据流：
 *  1. recordFeedback：写入 feedback 事件到 memoryStore（type='agent', kind='feedback_event'）
 *  2. runReflection：检查冷却 → 调用 LLM 反思 → 写回 feedback_learning 记忆
 *
 * 冷却机制（照抄 openclaw lastReflectionBySession）：
 *  - 内存 Map<sessionId, lastReflectionAt>
 *  - 同 session 冷却期内 runReflection 直接返回 'cooldown'
 *  - 超过 maxCooldownEntries 时清理过期项
 */
export class FeedbackLoop {
  private readonly llmProvider: ILLMProvider;
  private readonly memoryProvider: IMemoryProvider;
  private readonly defaultModel?: string;
  private readonly cooldownMs: number;
  private readonly maxResponseChars: number;
  private readonly maxCooldownEntries: number;
  private readonly verbose: boolean;
  /** 冷却表：sessionId → lastReflectionAt */
  private readonly lastReflectionBySession = new Map<string, number>();

  constructor(config: FeedbackLoopConfig) {
    this.llmProvider = config.llmProvider;
    this.memoryProvider = config.memoryProvider;
    this.defaultModel = config.defaultModel;
    this.cooldownMs = config.cooldownMs ?? DEFAULT_FEEDBACK_COOLDOWN_MS;
    this.maxResponseChars = config.maxResponseChars ?? 500;
    this.maxCooldownEntries = config.maxCooldownEntries ?? 500;
    this.verbose = config.verbose ?? false;
  }

  /**
   * 记录反馈事件（不触发反思）。
   *
   * @returns 事件 ID
   */
  async recordFeedback(event: Omit<FeedbackEvent, 'id' | 'createdAt'>): Promise<string> {
    if (!event.sessionId) {
      throw toAgentError(new Error('sessionId is required'), 'FeedbackLoop.recordFeedback: missing sessionId');
    }

    const id = generateFeedbackId();
    const now = Date.now();

    try {
      await this.memoryProvider.write({
        type: 'agent',
        content: this.summarizeEvent(event),
        source: `feedback:${id}`,
        metadata: {
          kind: 'feedback_event',
          feedbackId: id,
          sessionId: event.sessionId,
          characterId: event.characterId,
          agentResponse: event.agentResponse,
          userComment: event.userComment,
          kind2: event.kind,
          rating: event.rating,
          createdAt: now,
        },
        sessionId: event.sessionId,
        characterId: event.characterId,
      });
      return id;
    } catch (err) {
      throw toAgentError(err, 'FeedbackLoop.recordFeedback: persist failed');
    }
  }

  /**
   * 触发反思。
   *
   * 流程（照抄 openclaw runChannelFeedbackReflection）：
   *  1. 冷却检查：同 session 在 cooldownMs 内 → 返回 'cooldown'
   *  2. 构建反思 prompt（含被反馈的 agent 响应 + 用户评论）
   *  3. 调用 LLM 生成反思（JSON 输出）
   *  4. 解析 JSON → 写回 feedback_learning 记忆
   *  5. 更新冷却表
   *
   * @param params 反思参数
   * @returns 反思结果（status: cooldown / empty / complete）
   */
  async runReflection(params: {
    sessionId: string;
    agentResponse?: string;
    userComment?: string;
  }): Promise<FeedbackReflectionResult> {
    if (!params.sessionId) {
      throw toAgentError(new Error('sessionId is required'), 'FeedbackLoop.runReflection: missing sessionId');
    }

    // 1. 冷却检查
    const lastTime = this.lastReflectionBySession.get(params.sessionId) ?? Number.NEGATIVE_INFINITY;
    if (Date.now() - lastTime < this.cooldownMs) {
      return { status: 'cooldown' };
    }

    // 2. 构建 prompt
    const prompt = this.buildReflectionPrompt(params);

    if (!this.defaultModel) {
      if (this.verbose) {
        console.warn('[FeedbackLoop] no default model configured, skipping reflection');
      }
      return { status: 'empty' };
    }

    // 3. 调用 LLM
    const request: StreamChatRequest = {
      systemPrompt: 'You are a reflection subsystem. Reply with JSON only.',
      messages: [{ role: 'user', content: prompt }],
      modelName: this.defaultModel,
      temperature: 0.5,
      maxTokens: 512,
    };

    let response: string;
    try {
      const result = await this.llmProvider.streamChat(request);
      response = result.content;
    } catch (err) {
      if (this.verbose) {
        console.warn('[FeedbackLoop] LLM reflection failed:', err);
      }
      return { status: 'empty' };
    }

    // 4. 解析 JSON
    const parsed = this.parseReflectionResponse(response);
    if (!parsed) {
      return { status: 'empty' };
    }

    // 5. 写回经验记忆
    let memoryId: string | undefined;
    try {
      memoryId = await this.memoryProvider.write({
        type: 'agent',
        content: parsed.learning,
        source: `feedback_learning:${Date.now()}`,
        metadata: {
          kind: 'feedback_learning',
          sessionId: params.sessionId,
          followUp: parsed.followUp,
          userMessage: parsed.userMessage,
          createdAt: Date.now(),
        },
        sessionId: params.sessionId,
      });
    } catch (err) {
      if (this.verbose) {
        console.warn('[FeedbackLoop] write learning failed:', err);
      }
    }

    // 6. 更新冷却表
    this.lastReflectionBySession.set(params.sessionId, Date.now());
    this.cleanupCooldownTable();

    return {
      status: 'complete',
      learning: parsed.learning,
      followUp: parsed.followUp,
      userMessage: parsed.userMessage,
      memoryId,
    };
  }

  /**
   * 一站式 API：记录反馈 + 触发反思（若不在冷却期）。
   */
  async recordAndReflect(event: Omit<FeedbackEvent, 'id' | 'createdAt'>): Promise<{
    feedbackId: string;
    reflection: FeedbackReflectionResult;
  }> {
    const feedbackId = await this.recordFeedback(event);
    const reflection = await this.runReflection({
      sessionId: event.sessionId,
      agentResponse: event.agentResponse,
      userComment: event.userComment,
    });
    return { feedbackId, reflection };
  }

  // ==================== 内部方法 ====================

  /**
   * 构建反思 prompt（照抄 openclaw buildReflectionPrompt）。
   */
  private buildReflectionPrompt(params: {
    agentResponse?: string;
    userComment?: string;
  }): string {
    const response = params.agentResponse;
    const truncated =
      response && response.length > this.maxResponseChars
        ? `${response.slice(0, this.maxResponseChars)}...`
        : response;

    return [
      'A user indicated your previous response was not helpful.',
      truncated ? `\nYour response was:\n> ${truncated}` : undefined,
      params.userComment ? `\nUser\'s comment: "${params.userComment}"` : undefined,
      '\nBriefly reflect: what could you improve? Consider tone, length, accuracy, relevance, and specificity. ' +
        'Reply with one JSON object only: {"learning":"...","followUp":false,"userMessage":""}. ' +
        'Keep learning to 1-2 sentences. Set followUp only when the user needs a direct reply.',
    ]
      .filter(Boolean)
      .join('\n');
  }

  /**
   * 解析 LLM 反思响应（照抄 openclaw parseReflectionResponse）。
   *
   * 支持：
   *  - 纯 JSON
   *  - ```json 代码块包裹
   *  - 失败时回退为将整段文本作为 learning（仅非空时）
   */
  private parseReflectionResponse(text: string): {
    learning: string;
    followUp: boolean;
    userMessage?: string;
  } | null {
    const trimmed = text.trim();
    const candidates = [
      trimmed,
      ...(trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i)?.slice(1, 2) ?? []),
    ];
    for (const candidate of candidates) {
      try {
        const value = JSON.parse(candidate.trim()) as Record<string, unknown>;
        const learning = typeof value.learning === 'string' ? value.learning.trim() : '';
        if (!learning) continue;
        const followUp =
          value.followUp === true ||
          (typeof value.followUp === 'string' &&
            ['true', 'yes'].includes(value.followUp.trim().toLowerCase()));
        const userMessage =
          typeof value.userMessage === 'string' ? value.userMessage.trim() : '';
        return { learning, followUp, userMessage: userMessage || undefined };
      } catch {
        // 继续尝试下一个候选
      }
    }
    return trimmed ? { learning: trimmed, followUp: false } : null;
  }

  /**
   * 清理冷却表（照抄 openclaw 冷却表清理逻辑）。
   */
  private cleanupCooldownTable(): void {
    if (this.lastReflectionBySession.size <= this.maxCooldownEntries) return;
    const now = Date.now();
    for (const [key, time] of this.lastReflectionBySession) {
      if (now - time >= this.cooldownMs) {
        this.lastReflectionBySession.delete(key);
      }
    }
  }

  /**
   * 将反馈事件总结为可读字符串。
   */
  private summarizeEvent(event: Omit<FeedbackEvent, 'id' | 'createdAt'>): string {
    const parts: string[] = [`Feedback (${event.kind})`];
    if (event.rating !== undefined) parts.push(`rating=${event.rating}`);
    if (event.userComment) parts.push(`comment="${event.userComment}"`);
    if (event.agentResponse) {
      const truncated =
        event.agentResponse.length > 200
          ? event.agentResponse.slice(0, 200) + '...'
          : event.agentResponse;
      parts.push(`agentResponse="${truncated}"`);
    }
    return parts.join(' ');
  }
}

// ==================== 工具函数 ====================

let feedbackCounter = 0;
function generateFeedbackId(): string {
  feedbackCounter += 1;
  return `fb_${Date.now()}_${feedbackCounter}`;
}

// ==================== 单例 ====================

let feedbackInstance: FeedbackLoop | null = null;

export function getFeedbackLoop(config?: FeedbackLoopConfig): FeedbackLoop {
  if (!feedbackInstance && config) {
    feedbackInstance = new FeedbackLoop(config);
  }
  if (!feedbackInstance) {
    throw new Error('FeedbackLoop not initialized. Call getFeedbackLoop(config) first.');
  }
  return feedbackInstance;
}

export function resetFeedbackLoop(): void {
  feedbackInstance = null;
}
