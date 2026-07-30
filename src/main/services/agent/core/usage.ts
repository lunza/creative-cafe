/**
 * Usage 追踪 —— 适配 openclaw agent-core token 计量理念
 *
 * 来源：g:\AI\creative-cafe\sillytavern-source\openclaw-main\packages\agent-core\src\agent-loop.ts
 *       （L271-L571 内部 usage 累积）+ packages/agent-core/src/types.ts（usage 字段）
 * 决策：适配（spec §三）。openclaw 在 agentLoop 中累积 usage 并回传到 AgentRunResult；
 *       本项目照搬其累积模型，简化为进程内 UsageTracker（无持久化，持久化由 memoryStore 负责）。
 *
 * 职责：
 *  1. UsageTracker：累积多轮 LLM 调用的 token 用量
 *  2. 支持上限保护（maxTotalTokens），超限时 agentLoop 可主动停止
 *  3. 工具执行耗时统计（durationMs）
 *
 * 设计约束（openclaw AGENTS.md）：
 *  - usage 是 prompt：每轮 LLM 返回的 usage 累积到总 usage，最终回传给调用方
 *  - 不在热路径重新计算（仅累积 LLM 返回值）
 *  - 上限保护防止成本失控（如死循环 maxIterations 触发高额 token 消耗）
 */

// ==================== 类型定义 ====================

/**
 * 单次 LLM 调用的 token 用量（OpenAI usage 字段格式）。
 */
export interface TokenUsage {
  /** 输入 token 数 */
  promptTokens?: number;
  /** 输出 token 数 */
  completionTokens?: number;
  /** 总 token 数（通常 = prompt + completion，部分后端直接返回） */
  totalTokens?: number;
}

/**
 * 工具调用耗时记录。
 */
export interface ToolDurationRecord {
  /** 工具名 */
  name: string;
  /** 执行耗时（毫秒） */
  durationMs: number;
  /** 是否成功 */
  success: boolean;
}

/**
 * 累积后的总 usage。
 */
export interface AccumulatedUsage extends TokenUsage {
  /** 累计 LLM 调用次数 */
  llmCalls: number;
  /** 累计工具调用次数 */
  toolCalls: number;
  /** 累计工具执行总耗时（毫秒） */
  totalToolDurationMs: number;
}

// ==================== UsageTracker ====================

/**
 * Usage 追踪器。
 *
 * agentLoop 每次调用 LLM 后调用 addUsage()，每次工具执行后调用 addToolDuration()，
 * 最终通过 getUsage() 获取累积结果，注入 AgentRunResult.usage。
 *
 * 上限保护：若设置 maxTotalTokens，addUsage() 返回 false 表示已超限，
 * agentLoop 应据此停止后续迭代。
 */
export class UsageTracker {
  private promptTokens = 0;
  private completionTokens = 0;
  private totalTokens = 0;
  private llmCalls = 0;
  private toolCalls = 0;
  private totalToolDurationMs = 0;
  private readonly maxTotalTokens?: number;

  constructor(options?: { maxTotalTokens?: number }) {
    this.maxTotalTokens = options?.maxTotalTokens;
  }

  /**
   * 累积一次 LLM 调用的 usage。
   *
   * @param usage LLM 返回的 usage（可能为 undefined，此时仅计数 llmCalls）
   * @returns true 表示未超限，false 表示已超 maxTotalTokens（agentLoop 应停止）
   */
  addUsage(usage?: TokenUsage): boolean {
    this.llmCalls += 1;
    if (usage) {
      this.promptTokens += usage.promptTokens ?? 0;
      this.completionTokens += usage.completionTokens ?? 0;
      // totalTokens 优先使用后端返回值，否则按 prompt + completion 估算
      this.totalTokens +=
        usage.totalTokens ??
        (usage.promptTokens ?? 0) + (usage.completionTokens ?? 0);
    }
    // 上限检查
    if (this.maxTotalTokens !== undefined && this.totalTokens > this.maxTotalTokens) {
      return false;
    }
    return true;
  }

  /**
   * 累积一次工具调用的耗时。
   */
  addToolDuration(record: ToolDurationRecord): void {
    this.toolCalls += 1;
    this.totalToolDurationMs += record.durationMs;
  }

  /**
   * 获取当前累积的 usage 快照。
   */
  getUsage(): AccumulatedUsage {
    return {
      promptTokens: this.promptTokens || undefined,
      completionTokens: this.completionTokens || undefined,
      totalTokens: this.totalTokens || undefined,
      llmCalls: this.llmCalls,
      toolCalls: this.toolCalls,
      totalToolDurationMs: this.totalToolDurationMs,
    };
  }

  /**
   * 是否已超过 token 上限。
   */
  isOverLimit(): boolean {
    return (
      this.maxTotalTokens !== undefined && this.totalTokens > this.maxTotalTokens
    );
  }

  /**
   * 重置（用于 agentLoop 复用 UsageTracker 实例的场景）。
   */
  reset(): void {
    this.promptTokens = 0;
    this.completionTokens = 0;
    this.totalTokens = 0;
    this.llmCalls = 0;
    this.toolCalls = 0;
    this.totalToolDurationMs = 0;
  }
}

// ==================== 便捷工具 ====================

/**
 * 默认 token 上限（防止死循环烧 token）。
 * 单次 agent 运行最多消耗 200K tokens（约等于 1 美元的 GPT-4 调用）。
 */
export const DEFAULT_MAX_TOTAL_TOKENS = 200_000;

/**
 * 合并多个 usage 快照（用于子 agent 结果汇总）。
 */
export function mergeUsage(...usages: Array<TokenUsage | undefined>): TokenUsage {
  let promptTokens = 0;
  let completionTokens = 0;
  let totalTokens = 0;
  let hasAny = false;
  for (const u of usages) {
    if (!u) continue;
    hasAny = true;
    promptTokens += u.promptTokens ?? 0;
    completionTokens += u.completionTokens ?? 0;
    totalTokens += u.totalTokens ?? (u.promptTokens ?? 0) + (u.completionTokens ?? 0);
  }
  if (!hasAny) return {};
  return {
    promptTokens: promptTokens || undefined,
    completionTokens: completionTokens || undefined,
    totalTokens: totalTokens || undefined,
  };
}
