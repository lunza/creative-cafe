/**
 * 能力检测器 —— 复用现有 AIService 能力探测
 *
 * 来源：spec §二 Task 6.3（capabilityDetector.ts，复用现有检测，F1 修复后真正使用）
 * 决策：适配。openclaw 有独立的能力检测模块，本项目复用 AIService.probeAllCapabilities
 *       （F1 修复后结果真正进入请求构造），不重复造轮子。
 *
 * 职责：
 *  1. 检测模型是否支持工具调用 / 视觉 / 思维链 / 停止序列等
 *  2. 缓存检测结果（避免每次请求都探测，openclaw 理念：热路径携带已准备的事实）
 *  3. 提供降级判定（supportsToolCalling=false 时 agentLoop 回退到纯文本）
 *
 * 设计约束：
 *  - 探测结果按 modelName 缓存（进程级，模型不变不重探）
 *  - 探测失败时保守降级（全部 false，走纯文本路径）
 */

import type { AIService } from '../../AIService';
import { createDedupeCache, type DedupeCache } from '../infra/dedupe';

// ==================== 类型定义 ====================

export interface ModelCapabilities {
  supportsStopArray: boolean;
  supportsRepPen: boolean;
  supportsDrySampler: boolean;
  supportsVision: boolean;
  supportsThinking: boolean;
  supportsToolCalling: boolean;
}

// ==================== 能力检测器 ====================

/**
 * 模型能力检测器。
 *
 * 缓存策略：按 `${baseUrl}|${modelName}` 缓存探测结果，TTL 10 分钟。
 * 同一模型在 TTL 内不重复探测（openclaw 理念：热路径携带已准备的事实，
 * 不在请求时重新发现）。
 */
export class CapabilityDetector {
  /** 探测去重缓存：防止短时间内对同一模型并发探测 */
  private readonly probeDedupe: DedupeCache;
  /** 探测结果缓存：modelName → capabilities */
  private readonly resultCache = new Map<string, ModelCapabilities>();

  constructor(
    private readonly aiService: AIService,
    options?: { ttlMs?: number; maxSize?: number }
  ) {
    this.probeDedupe = createDedupeCache({
      ttlMs: options?.ttlMs ?? 600_000, // 10 分钟 TTL
      maxSize: options?.maxSize ?? 64,
    });
  }

  /**
   * 检测模型能力（带缓存）。
   *
   * @param config 探测配置（baseUrl / apiKey / modelName 等）
   * @returns 能力检测结果；探测失败时返回全 false（保守降级）
   */
  async detect(config: {
    baseUrl: string;
    apiKey: string;
    apiKeyTransmission: string;
    modelName: string;
  }): Promise<ModelCapabilities> {
    const cacheKey = `${config.baseUrl}|${config.modelName}`;

    // 命中缓存直接返回
    const cached = this.resultCache.get(cacheKey);
    if (cached) return cached;

    // 去重：同一模型短时间内不重复探测
    if (this.probeDedupe.check(cacheKey)) {
      // 已有探测在进行中，返回保守降级值（调用方可稍后重试获取真实结果）
      return CONSERVATIVE_FALLBACK;
    }

    try {
      const result = await this.aiService.probeAllCapabilities(config);
      const capabilities: ModelCapabilities = {
        supportsStopArray: result.supportsStopArray,
        supportsRepPen: result.supportsRepPen,
        supportsDrySampler: result.supportsDrySampler,
        supportsVision: result.supportsVision,
        supportsThinking: result.supportsThinking,
        supportsToolCalling: result.supportsToolCalling,
      };
      this.resultCache.set(cacheKey, capabilities);
      return capabilities;
    } catch {
      // 探测失败：保守降级，走纯文本路径
      return CONSERVATIVE_FALLBACK;
    }
  }

  /**
   * 清除指定模型的缓存（模型配置变更时调用）。
   */
  invalidate(baseUrl: string, modelName: string): void {
    const cacheKey = `${baseUrl}|${modelName}`;
    this.resultCache.delete(cacheKey);
    this.probeDedupe.delete(cacheKey);
  }

  /**
   * 清除所有缓存。
   */
  clear(): void {
    this.resultCache.clear();
    this.probeDedupe.clear();
  }
}

/**
 * 保守降级值：全部能力为 false。
 * 探测失败或进行中时返回，确保 agentLoop 回退到纯文本路径（spec §5.1 降级保护）。
 */
export const CONSERVATIVE_FALLBACK: ModelCapabilities = {
  supportsStopArray: false,
  supportsRepPen: false,
  supportsDrySampler: false,
  supportsVision: false,
  supportsThinking: false,
  supportsToolCalling: false,
};
