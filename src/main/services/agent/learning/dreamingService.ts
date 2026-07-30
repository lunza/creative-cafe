/**
 * DreamingService —— 短期→长期记忆摘要（照抄 openclaw dreaming 三相理念）
 *
 * 来源：spec §二 Task 18.1（learning/dreamingService.ts）
 * 决策：适配（spec §三表格：dreaming 适配，本项目按业务场景精简）。
 *       openclaw dreaming.ts 是配置解析层（resolveMemoryDreamingConfig），本项目
 *       实现执行层：检索短期记忆 → LLM 摘要 → 写回长期记忆。
 *
 * 职责：
 *  1. 三相位 dreaming 执行：
 *     - light：从近期短期记忆提取每日快报（cheap + fast）
 *     - deep：将反复出现的内容固化为长期事实（balanced + high thinking）
 *     - rem：跨会话发现潜在模式（expensive + high thinking）
 *  2. 调用 LLMProvider 生成摘要（JSON 输出）
 *  3. 写回 MemoryStore 作为长期记忆（metadata.kind='dreaming_summary'）
 *  4. 支持取消（AbortController）+ 进度回调
 *
 * 设计约束（openclaw dreaming.ts 原则）：
 *  - 三相分隔：不同相位使用不同 speed/thinking/budget，避免单次成本失控
 *  - minScore 阈值（deep=0.75）：仅固化高置信度事实，避免噪声
 *  - 限制单次处理条数（light=100, deep=10, rem=10）
 *  - 失败不中断：单相位失败不影响其他相位
 *
 * 与 cronScheduler 的关系：
 *  - cronScheduler 按频率（默认每日 3 点）触发 dreamingService.runAll()
 *  - 用户也可通过 IPC `agent:dreamNow` 手动触发
 */

import type { ILLMProvider, StreamChatRequest } from '../contracts';
import type { IMemoryProvider, MemoryEntry } from '../contracts';
import type {
  DreamingConfig,
  DreamingPhase,
  DreamingPhaseResult,
  DreamingResult,
  DreamingExecutionConfig,
} from './types';
import { DEFAULT_DREAMING_CONFIG } from './types';
import { toAgentError } from '../infra/errors';

// ==================== 类型定义 ====================

/**
 * DreamingService 构造配置。
 */
export interface DreamingServiceConfig {
  llmProvider: ILLMProvider;
  memoryProvider: IMemoryProvider;
  /** Dreaming 配置（默认 DEFAULT_DREAMING_CONFIG） */
  config?: DreamingConfig;
  /** 默认模型名（执行档位未指定 model 时使用） */
  defaultModel?: string;
  /** 进度回调 */
  onProgress?: (phase: DreamingPhase, progress: { phase: DreamingPhaseResult }) => void;
  /** 调试日志 */
  verbose?: boolean;
}

// ==================== LLM 提示词模板 ====================

/**
 * Light 相位提示词：每日快报，从短期记忆中提取关键事件。
 */
function buildLightPrompt(memories: MemoryEntry[], sessionId?: string): string {
  const context = sessionId ? `Session: ${sessionId}\n` : '';
  const memoriesText = memories
    .map((m, i) => `[${i + 1}] (${new Date(m.timestamp).toISOString()}) ${m.content}`)
    .join('\n');

  return [
    'You are the dreaming subsystem of an AI agent. This is the LIGHT dreaming phase.',
    'Summarize the following short-term memories into a daily digest.',
    'Focus on: key events, decisions, and notable user preferences.',
    context,
    'Short-term memories:',
    memoriesText,
    '',
    'Reply with one JSON object only:',
    '{"summary":"<2-3 sentence digest>","key_facts":["<fact1>","<fact2>"]}',
    'Keep summary under 200 tokens. Each key_fact under 50 tokens.',
  ].join('\n');
}

/**
 * Deep 相位提示词：核心事实沉淀，将反复出现的内容固化为长期事实。
 */
function buildDeepPrompt(memories: MemoryEntry[], sessionId?: string): string {
  const context = sessionId ? `Session: ${sessionId}\n` : '';
  const memoriesText = memories
    .map((m, i) => `[${i + 1}] content=${m.content} score=${m.score ?? 'N/A'}`)
    .join('\n');

  return [
    'You are the dreaming subsystem of an AI agent. This is the DEEP dreaming phase.',
    'Identify facts that have been recalled multiple times and are likely durable.',
    'Filter out: filler, one-off small talk, transient preferences.',
    'Keep: durable user traits, project decisions, recurring themes.',
    context,
    'Candidate memories (with recall scores):',
    memoriesText,
    '',
    'Reply with one JSON object only:',
    '{"promoted_facts":["<durable fact 1>","<durable fact 2>"],"skipped_count":<number>}',
    'Each promoted_fact under 80 tokens. Only include facts you are confident about.',
  ].join('\n');
}

/**
 * Rem 相位提示词：模式识别，跨会话发现潜在模式。
 */
function buildRemPrompt(memories: MemoryEntry[], sessionId?: string): string {
  const context = sessionId ? `Session: ${sessionId}\n` : '';
  const memoriesText = memories
    .map((m, i) => `[${i + 1}] (${new Date(m.timestamp).toISOString()}) ${m.content}`)
    .join('\n');

  return [
    'You are the dreaming subsystem of an AI agent. This is the REM dreaming phase.',
    'Identify cross-session patterns: recurring needs, behavioral patterns,',
    'unspoken preferences, or themes that span multiple conversations.',
    context,
    'Memories across sessions:',
    memoriesText,
    '',
    'Reply with one JSON object only:',
    '{"patterns":["<pattern 1 description>","<pattern 2 description>"],"confidence":<0-1>}',
    'Only include patterns with confidence >= 0.75. Each pattern under 100 tokens.',
  ].join('\n');
}

// ==================== DreamingService 实现 ====================

/**
 * Dreaming 服务：短期→长期记忆摘要。
 *
 * 执行流程：
 *  1. 检索短期记忆（memoryProvider.search，按 lookbackDays + limit）
 *  2. 调用 LLM 生成摘要（按相位选择 prompt）
 *  3. 写回长期记忆（memoryProvider.write，metadata.kind='dreaming_summary'）
 *
 * 单实例守卫：同一时刻仅允许一个 dreaming 运行（避免重复消耗 LLM tokens）。
 */
export class DreamingService {
  private readonly llmProvider: ILLMProvider;
  private readonly memoryProvider: IMemoryProvider;
  private readonly config: DreamingConfig;
  private readonly defaultModel?: string;
  private readonly onProgress?: (phase: DreamingPhase, progress: { phase: DreamingPhaseResult }) => void;
  private readonly verbose: boolean;
  private running = false;
  private abortController: AbortController | null = null;

  constructor(config: DreamingServiceConfig) {
    this.llmProvider = config.llmProvider;
    this.memoryProvider = config.memoryProvider;
    this.config = config.config ?? DEFAULT_DREAMING_CONFIG;
    this.defaultModel = config.defaultModel;
    this.onProgress = config.onProgress;
    this.verbose = config.verbose ?? false;
  }

  /**
   * 是否正在运行。
   */
  get isRunning(): boolean {
    return this.running;
  }

  /**
   * 取消正在进行的 dreaming。
   */
  cancel(): void {
    if (this.abortController) {
      this.abortController.abort();
      this.abortController = null;
    }
    this.running = false;
  }

  /**
   * 运行完整 dreaming 流程（三相）。
   *
   * @param sessionId 可选会话 ID（限制检索范围）
   * @returns 完整结果
   */
  async runAll(sessionId?: string): Promise<DreamingResult> {
    if (this.running) {
      throw toAgentError(
        new Error('DreamingService is already running'),
        'DreamingService.runAll: already running'
      );
    }

    this.running = true;
    this.abortController = new AbortController();
    const startedAt = Date.now();
    const phases: DreamingPhaseResult[] = [];

    try {
      const phaseList: DreamingPhase[] = ['light', 'deep', 'rem'];
      for (const phase of phaseList) {
        if (this.abortController?.signal.aborted) break;

        const phaseConfig = this.config.phases[phase];
        if (!phaseConfig.enabled) {
          phases.push({
            phase,
            processedCount: 0,
            promotedCount: 0,
            skippedCount: 0,
            durationMs: 0,
            error: 'phase disabled',
          });
          continue;
        }

        try {
          const result = await this.runPhase(phase, sessionId);
          phases.push(result);
          this.onProgress?.(phase, { phase: result });
        } catch (err) {
          const errorMsg = err instanceof Error ? err.message : String(err);
          if (this.verbose) {
            console.warn(`[DreamingService] phase ${phase} failed:`, errorMsg);
          }
          const failedResult: DreamingPhaseResult = {
            phase,
            processedCount: 0,
            promotedCount: 0,
            skippedCount: 0,
            durationMs: 0,
            error: errorMsg,
          };
          phases.push(failedResult);
          this.onProgress?.(phase, { phase: failedResult });
          // 单相位失败不中断其他相位（spec §二 设计约束）
        }
      }
    } finally {
      this.running = false;
      this.abortController = null;
    }

    const finishedAt = Date.now();
    const totalPromoted = phases.reduce((sum, p) => sum + p.promotedCount, 0);
    return { startedAt, finishedAt, phases, totalPromoted };
  }

  /**
   * 运行单个相位。
   */
  private async runPhase(phase: DreamingPhase, sessionId?: string): Promise<DreamingPhaseResult> {
    const startMs = Date.now();
    const phaseConfig = this.config.phases[phase];

    // 1. 检索短期记忆
    const lookbackMs = phaseConfig.lookbackDays * 24 * 60 * 60 * 1000;
    const since = Date.now() - lookbackMs;
    const memories = await this.fetchShortTermMemories(phase, since, phaseConfig.limit, sessionId);

    if (memories.length === 0) {
      return {
        phase,
        processedCount: 0,
        promotedCount: 0,
        skippedCount: 0,
        durationMs: Date.now() - startMs,
      };
    }

    // 2. 调用 LLM 生成摘要
    const prompt = this.buildPrompt(phase, memories, sessionId);
    const execution = phaseConfig.execution;
    const model = execution.model ?? this.defaultModel;
    if (!model) {
      throw new Error(`DreamingService: no model configured for phase ${phase}`);
    }

    const request: StreamChatRequest = {
      systemPrompt: 'You are a memory consolidation subsystem. Output JSON only.',
      messages: [{ role: 'user', content: prompt }],
      modelName: model,
      temperature: execution.temperature ?? this.mapTemperature(execution.speed),
      maxTokens: execution.maxOutputTokens ?? this.mapMaxTokens(execution.thinking),
    };

    const response = await this.llmProvider.streamChat(request);
    if (this.abortController?.signal.aborted) {
      throw new Error(`phase ${phase} aborted`);
    }

    // 3. 解析 LLM 输出 + 写回长期记忆
    const promoted = await this.parseAndPromote(phase, response.content, sessionId);

    return {
      phase,
      processedCount: memories.length,
      promotedCount: promoted.length,
      skippedCount: memories.length - promoted.length,
      durationMs: Date.now() - startMs,
    };
  }

  /**
   * 检索短期记忆。
   *
   * 当前实现：通过 memoryProvider.search 检索 type='agent' 的记忆，
   * 按 timestamp 过滤回看窗口。简化实现，未来可改为按 metadata.kind 过滤。
   *
   * @param phase 当前 dreaming 相位（用于调试日志，未来可按相位过滤不同 source）
   */
  private async fetchShortTermMemories(
    phase: DreamingPhase,
    since: number,
    limit: number,
    sessionId?: string
  ): Promise<MemoryEntry[]> {
    if (this.verbose) {
      console.debug(`[DreamingService] fetchShortTermMemories phase=${phase} since=${new Date(since).toISOString()} limit=${limit}`);
    }
    // 简化查询：检索近期 agent 自主记忆
    // 注意：memoryProvider.search 当前实现是基于关键词的 LIKE 匹配，
    // 此处用空 query 拉取近期所有记忆，再按 timestamp 客户端过滤
    const results = await this.memoryProvider.search({
      query: '', // 空 query 拉取全部（memoryStore.searchSqlite 支持）
      types: ['agent'],
      limit: limit * 2, // 多拉一些用于过滤
      sessionId,
    });

    return results
      .filter((m) => m.timestamp >= since)
      .filter((m) => {
        // 排除 dreaming_summary 自身（避免无限递归摘要）
        const kind = (m.metadata as any)?.kind;
        return kind !== 'dreaming_summary';
      })
      .slice(0, limit);
  }

  /**
   * 构建相位对应的 prompt。
   */
  private buildPrompt(
    phase: DreamingPhase,
    memories: MemoryEntry[],
    sessionId?: string
  ): string {
    switch (phase) {
      case 'light':
        return buildLightPrompt(memories, sessionId);
      case 'deep':
        return buildDeepPrompt(memories, sessionId);
      case 'rem':
        return buildRemPrompt(memories, sessionId);
    }
  }

  /**
   * 解析 LLM 输出并写回长期记忆。
   *
   * @returns 写入的记忆 ID 列表
   */
  private async parseAndPromote(
    phase: DreamingPhase,
    llmOutput: string,
    sessionId?: string
  ): Promise<string[]> {
    const parsed = this.parseDreamingOutput(phase, llmOutput);
    if (!parsed || parsed.length === 0) return [];

    const ids: string[] = [];
    for (const fact of parsed) {
      try {
        const id = await this.memoryProvider.write({
          type: 'agent',
          content: fact,
          source: `dreaming:${phase}`,
          metadata: {
            kind: 'dreaming_summary',
            phase,
            createdAt: Date.now(),
          },
          sessionId,
        });
        ids.push(id);
      } catch (err) {
        if (this.verbose) {
          console.warn(`[DreamingService] write promoted fact failed:`, err);
        }
      }
    }
    return ids;
  }

  /**
   * 解析 LLM 输出为事实数组。
   *
   * 支持三种 JSON 格式：
   *  - light: {"summary":"...","key_facts":["..."]}
   *  - deep: {"promoted_facts":["..."]}
   *  - rem: {"patterns":["..."]}
   */
  private parseDreamingOutput(phase: DreamingPhase, output: string): string[] {
    const trimmed = output.trim();
    // 尝试提取 JSON 块（含 ```json 代码块包裹）
    const candidates: string[] = [trimmed];
    const codeBlockMatch = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
    if (codeBlockMatch) {
      candidates.push(codeBlockMatch[1]);
    }

    for (const candidate of candidates) {
      try {
        const value = JSON.parse(candidate.trim()) as Record<string, unknown>;
        switch (phase) {
          case 'light': {
            const facts = Array.isArray(value.key_facts) ? value.key_facts : [];
            const summary = typeof value.summary === 'string' ? value.summary : '';
            const all = [...(summary ? [summary] : []), ...facts.map(String).filter(Boolean)];
            return all;
          }
          case 'deep': {
            const facts = Array.isArray(value.promoted_facts) ? value.promoted_facts : [];
            return facts.map(String).filter(Boolean);
          }
          case 'rem': {
            const patterns = Array.isArray(value.patterns) ? value.patterns : [];
            return patterns.map(String).filter(Boolean);
          }
        }
      } catch {
        // 继续尝试下一个候选
      }
    }

    // JSON 解析失败，回退为将整段输出作为单一事实（仅 light 相位）
    if (phase === 'light' && trimmed.length > 0 && trimmed.length < 500) {
      return [trimmed];
    }
    return [];
  }

  /**
   * 将 speed 映射为 temperature。
   */
  private mapTemperature(speed: DreamingExecutionConfig['speed']): number {
    switch (speed) {
      case 'fast':
        return 0.7;
      case 'balanced':
        return 0.5;
      case 'slow':
        return 0.3;
    }
  }

  /**
   * 将 thinking 映射为 maxTokens。
   */
  private mapMaxTokens(thinking: DreamingExecutionConfig['thinking']): number {
    switch (thinking) {
      case 'low':
        return 512;
      case 'medium':
        return 1024;
      case 'high':
        return 2048;
    }
  }
}

// ==================== 单例 ====================

let dreamingInstance: DreamingService | null = null;

/**
 * 获取 DreamingService 单例。
 */
export function getDreamingService(config?: DreamingServiceConfig): DreamingService {
  if (!dreamingInstance && config) {
    dreamingInstance = new DreamingService(config);
  }
  if (!dreamingInstance) {
    throw new Error('DreamingService not initialized. Call getDreamingService(config) first.');
  }
  return dreamingInstance;
}

/**
 * 重置单例（仅测试用）。
 */
export function resetDreamingService(): void {
  if (dreamingInstance) {
    dreamingInstance.cancel();
    dreamingInstance = null;
  }
}
