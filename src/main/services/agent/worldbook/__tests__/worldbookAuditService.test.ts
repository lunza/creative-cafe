/**
 * WorldBookAuditService 单元测试 —— 三维度审计服务
 *
 * 来源：spec §二 Task 2 验证 / `implement-worldbook-authoring-agent`
 *
 * 覆盖：
 *  1. validateCompleteness：正例（全字段齐全）+ 反例（key 空 / content 空 / comment+name 空 /
 *     维度未覆盖 / 条目数不达标）+ 按 dimensionId 匹配 + 按 content 推断维度归属
 *  2. checkConsistency：关键词冲突（cosine < 0.3）+ 关键词不冲突 + 关系图有环 +
 *     LLM mock 返回矛盾 + LLM 失败降级
 *  3. evaluateConformance：全符合 + 部分偏离 + 向量化失败降级
 *  4. runFullAudit：聚合 + overallPassed 计算 + autoFixes/userDecisions 生成 +
 *     单维度失败不阻塞其他维度
 *
 * Mock 策略：
 *  - embeddingService：通过构造参数注入 mock，generateEmbedding 返回可控向量
 *  - llmCompare：通过构造参数注入 mock，避免真实 LLM 调用
 *  - 不依赖真实向量库 / AIService
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  WorldBookAuditService,
  type IEmbeddingProvider,
  type LLMCompareFn,
} from '../worldbookAuditService';
import type {
  AuthoringPlan,
  AuthoringDimension,
  AuditSeverity,
} from '../worldbookAuthoringTypes';

// ==================== 工具函数 ====================

/**
 * 创建 mock EmbeddingService。
 *
 * 向量化策略：根据文本内容生成可预测的向量，便于控制 cosine 相似度：
 *  - 包含 "underground" 的文本 → [1, 0, 0]
 *  - 包含 "skyscraper" 的文本 → [0, 1, 0]
 *  - 包含 "city" 的文本 → [0.7, 0.7, 0]（与上面两者都有中等相似度）
 *  - 默认 → [0.5, 0.5, 0.5]
 *
 * 这样可以精确控制 cosine 相似度：
 *  - "underground" vs "skyscraper" → cosine = 0（正交，< 0.3 = 冲突）
 *  - "underground" vs "city" → cosine ≈ 0.707（> 0.3 = 不冲突）
 */
function createMockEmbeddingService(
  overrides: Partial<IEmbeddingProvider> = {}
): IEmbeddingProvider & { calls: string[] } {
  const calls: string[] = [];
  return {
    async generateEmbedding(text: string) {
      calls.push(text);
      const lower = text.toLowerCase();
      // 根据文本内容生成可预测的向量
      if (lower.includes('underground')) {
        return { success: true, vector: [1, 0, 0] };
      }
      if (lower.includes('skyscraper')) {
        return { success: true, vector: [0, 1, 0] };
      }
      if (lower.includes('city') && lower.includes('detective')) {
        // 用于 conformance 测试：与 "city detective" 查询高度匹配
        return { success: true, vector: [0.9, 0.1, 0.1] };
      }
      if (lower.includes('city')) {
        return { success: true, vector: [0.7, 0.7, 0] };
      }
      if (lower.includes('detective')) {
        return { success: true, vector: [0.9, 0.1, 0.1] };
      }
      if (lower.includes('fantasy') || lower.includes('magic')) {
        return { success: true, vector: [0.1, 0.1, 0.9] };
      }
      if (lower.includes('irrelevant') || lower.includes('cooking')) {
        // 与 city/detective 完全正交，用于测试偏离
        return { success: true, vector: [0, 0, 1] };
      }
      return { success: true, vector: [0.5, 0.5, 0.5] };
    },
    ...overrides,
  } as IEmbeddingProvider & { calls: string[] };
}

/**
 * 创建 mock LLM 对比函数。
 *
 * 返回值为 vi.fn 创建的 Mock，调用时需 `as unknown as LLMCompareFn` 传入构造参数。
 * 检查调用次数时直接使用 `expect(fn).toHaveBeenCalledTimes(n)`。
 */
function createMockLLMCompare(
  conflicts: Array<{
    entryIds: Array<string | number>;
    description: string;
    severity: AuditSeverity;
  }> = []
) {
  return vi.fn(async () => conflicts);
}

/**
 * 创建测试用维度。
 */
function createDimension(overrides: Partial<AuthoringDimension> = {}): AuthoringDimension {
  return {
    id: overrides.id ?? 'dim-test',
    name: overrides.name ?? 'Test Dimension',
    category: overrides.category ?? 'other',
    targetEntryCount: overrides.targetEntryCount ?? 3,
    source: overrides.source ?? 'user',
    ...overrides,
  };
}

/**
 * 创建测试用编写计划。
 */
function createPlan(dimensions: AuthoringDimension[]): AuthoringPlan {
  return {
    goal: {
      theme: 'test theme',
      dimensions,
      targetTotalEntries: dimensions.reduce((sum, d) => sum + d.targetEntryCount, 0),
      qualityThreshold: 0.8,
    },
    clarifyingQuestions: [],
    userAnswers: [],
    createdAt: Date.now(),
  };
}

/**
 * 创建测试用条目。
 */
function createEntry(partial: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    uid: partial.uid ?? 1,
    key: partial.key ?? ['keyword1'],
    content: partial.content ?? 'Test content',
    comment: partial.comment ?? 'Test comment',
    name: partial.name ?? 'Test name',
    ...partial,
  };
}

// ==================== 测试套件 ====================

describe('WorldBookAuditService', () => {
  let embeddingService: ReturnType<typeof createMockEmbeddingService>;
  let llmCompare: ReturnType<typeof createMockLLMCompare>;
  let service: WorldBookAuditService;

  beforeEach(() => {
    embeddingService = createMockEmbeddingService();
    llmCompare = createMockLLMCompare();
    service = new WorldBookAuditService({
      embeddingService,
      llmCompare: llmCompare as unknown as LLMCompareFn,
    });
  });

  // ==================== SubTask 2.1: validateCompleteness ====================

  describe('validateCompleteness', () => {
    it('正例：全字段齐全 + 维度覆盖 + 条目数达标 → passed=true', async () => {
      const dim = createDimension({
        id: 'dim-1',
        name: 'City',
        targetEntryCount: 2,
      });
      const plan = createPlan([dim]);
      const entries = [
        createEntry({ uid: 1, key: ['city'], content: 'city content 1', dimensionId: 'dim-1' }),
        createEntry({ uid: 2, key: ['city'], content: 'city content 2', dimensionId: 'dim-1' }),
      ];

      const report = await service.validateCompleteness(plan, entries);

      expect(report.passed).toBe(true);
      expect(report.missingFields).toHaveLength(0);
      expect(report.uncoveredDimensions).toHaveLength(0);
      expect(report.underfilledDimensions).toHaveLength(0);
    });

    it('反例：key 为空数组 → missingFields 包含 key', async () => {
      const dim = createDimension({ id: 'dim-1', name: 'City', targetEntryCount: 1 });
      const plan = createPlan([dim]);
      const entries = [
        createEntry({ uid: 1, key: [], content: 'city content', dimensionId: 'dim-1' }),
      ];

      const report = await service.validateCompleteness(plan, entries);

      expect(report.passed).toBe(false);
      expect(report.missingFields).toContainEqual({
        entryUid: 1,
        field: 'key',
        reason: 'key is empty array or missing',
      });
    });

    it('反例：content 为空字符串 → missingFields 包含 content', async () => {
      const dim = createDimension({ id: 'dim-1', name: 'City', targetEntryCount: 1 });
      const plan = createPlan([dim]);
      const entries = [
        createEntry({ uid: 1, key: ['city'], content: '', dimensionId: 'dim-1' }),
      ];

      const report = await service.validateCompleteness(plan, entries);

      expect(report.passed).toBe(false);
      expect(report.missingFields).toContainEqual({
        entryUid: 1,
        field: 'content',
        reason: 'content is empty string or missing',
      });
    });

    it('反例：comment 和 name 都为空 → missingFields 包含 comment', async () => {
      const dim = createDimension({ id: 'dim-1', name: 'City', targetEntryCount: 1 });
      const plan = createPlan([dim]);
      const entries = [
        createEntry({
          uid: 1,
          key: ['city'],
          content: 'city content',
          comment: '',
          name: '',
          dimensionId: 'dim-1',
        }),
      ];

      const report = await service.validateCompleteness(plan, entries);

      expect(report.passed).toBe(false);
      expect(report.missingFields).toContainEqual({
        entryUid: 1,
        field: 'comment',
        reason: 'both comment and name are empty',
      });
    });

    it('反例：维度未覆盖 → uncoveredDimensions 非空', async () => {
      const dim1 = createDimension({ id: 'dim-1', name: 'City', targetEntryCount: 1 });
      const dim2 = createDimension({ id: 'dim-2', name: 'Character', targetEntryCount: 1 });
      const plan = createPlan([dim1, dim2]);
      const entries = [
        createEntry({ uid: 1, key: ['city'], content: 'city content', dimensionId: 'dim-1' }),
        // dim-2 无任何条目
      ];

      const report = await service.validateCompleteness(plan, entries);

      expect(report.passed).toBe(false);
      expect(report.uncoveredDimensions).toHaveLength(1);
      expect(report.uncoveredDimensions[0]).toEqual({
        dimensionId: 'dim-2',
        dimensionName: 'Character',
      });
    });

    it('反例：条目数不达标 → underfilledDimensions 非空', async () => {
      const dim = createDimension({
        id: 'dim-1',
        name: 'City',
        targetEntryCount: 5, // 目标 5 条，需 >= 4 条才达标（5 * 0.8 = 4）
      });
      const plan = createPlan([dim]);
      const entries = [
        createEntry({ uid: 1, key: ['city'], content: 'city content 1', dimensionId: 'dim-1' }),
        createEntry({ uid: 2, key: ['city'], content: 'city content 2', dimensionId: 'dim-1' }),
        // 仅 2 条，2/5 = 0.4 < 0.8 → 未达标
      ];

      const report = await service.validateCompleteness(plan, entries);

      expect(report.passed).toBe(false);
      expect(report.underfilledDimensions).toHaveLength(1);
      expect(report.underfilledDimensions[0]).toEqual({
        dimensionId: 'dim-1',
        dimensionName: 'City',
        targetCount: 5,
        actualCount: 2,
        achievementRate: 0.4,
      });
    });

    it('按 dimensionId 匹配维度：条目归入对应维度', async () => {
      const dim1 = createDimension({ id: 'dim-city', name: 'City', targetEntryCount: 1 });
      const dim2 = createDimension({ id: 'dim-char', name: 'Character', targetEntryCount: 1 });
      const plan = createPlan([dim1, dim2]);
      const entries = [
        createEntry({ uid: 1, key: ['city'], content: 'city content', dimensionId: 'dim-city' }),
        createEntry({ uid: 2, key: ['hero'], content: 'hero content', dimensionId: 'dim-char' }),
      ];

      const report = await service.validateCompleteness(plan, entries);

      expect(report.passed).toBe(true);
      expect(report.uncoveredDimensions).toHaveLength(0);
    });

    it('按 content/name 推断维度归属：无 dimensionId 时按关键词匹配', async () => {
      const dim = createDimension({
        id: 'dim-city',
        name: 'City',
        targetEntryCount: 1,
      });
      const plan = createPlan([dim]);
      // 条目无 dimensionId，但 content 包含 "city"，应归入 dim-city
      const entries = [
        createEntry({
          uid: 1,
          key: ['keyword'],
          content: 'The city is a bustling metropolis',
          dimensionId: undefined,
        }),
      ];

      const report = await service.validateCompleteness(plan, entries);

      expect(report.passed).toBe(true);
      expect(report.uncoveredDimensions).toHaveLength(0);
    });

    it('条目数刚好达到 80% 阈值 → passed=true', async () => {
      const dim = createDimension({
        id: 'dim-1',
        name: 'City',
        targetEntryCount: 5, // 5 * 0.8 = 4，需 >= 4 条
      });
      const plan = createPlan([dim]);
      const entries = [
        createEntry({ uid: 1, key: ['city'], content: 'content 1', dimensionId: 'dim-1' }),
        createEntry({ uid: 2, key: ['city'], content: 'content 2', dimensionId: 'dim-1' }),
        createEntry({ uid: 3, key: ['city'], content: 'content 3', dimensionId: 'dim-1' }),
        createEntry({ uid: 4, key: ['city'], content: 'content 4', dimensionId: 'dim-1' }),
      ];

      const report = await service.validateCompleteness(plan, entries);

      expect(report.passed).toBe(true);
      expect(report.underfilledDimensions).toHaveLength(0);
    });
  });

  // ==================== SubTask 2.2: checkConsistency ====================

  describe('checkConsistency', () => {
    it('无冲突时通过 → passed=true', async () => {
      const entries = [
        createEntry({
          uid: 1,
          key: ['city'],
          content: 'The city is a bustling metropolis',
        }),
        createEntry({
          uid: 2,
          key: ['forest'],
          content: 'The forest is dark and mysterious',
        }),
      ];

      const report = await service.checkConsistency(entries);

      expect(report.passed).toBe(true);
      expect(report.issues).toHaveLength(0);
    });

    it('关键词冲突：共享 key 且 cosine < 0.3 → 标记 keyword_conflict', async () => {
      const entries = [
        createEntry({
          uid: 1,
          key: ['city'],
          content: 'The city is entirely underground',
        }),
        createEntry({
          uid: 2,
          key: ['city'],
          content: 'The city has many skyscrapers',
        }),
      ];

      const report = await service.checkConsistency(entries);

      const conflict = report.issues.find((i) => i.kind === 'keyword_conflict');
      expect(conflict).toBeDefined();
      expect(conflict!.entryIds).toContain(1);
      expect(conflict!.entryIds).toContain(2);
      expect(conflict!.severity).toBe('error');
      expect(report.passed).toBe(false);
    });

    it('关键词不冲突：共享 key 但 cosine > 0.3 → 不标记', async () => {
      const entries = [
        createEntry({
          uid: 1,
          key: ['city'],
          content: 'The city is underground',  // [1, 0, 0]
        }),
        createEntry({
          uid: 2,
          key: ['city'],
          content: 'The city has underground tunnels',  // 包含 "underground" → [1, 0, 0]
        }),
      ];

      const report = await service.checkConsistency(entries);

      const conflict = report.issues.find((i) => i.kind === 'keyword_conflict');
      expect(conflict).toBeUndefined();
    });

    it('关系图有环 → 标记 relation_cycle', async () => {
      const entries = [
        createEntry({
          uid: 1,
          key: ['a'],
          content: 'entry A',
          relations: [{ targetId: 2, type: 'depends_on' }],
        }),
        createEntry({
          uid: 2,
          key: ['b'],
          content: 'entry B',
          relations: [{ targetId: 3, type: 'depends_on' }],
        }),
        createEntry({
          uid: 3,
          key: ['c'],
          content: 'entry C',
          relations: [{ targetId: 1, type: 'depends_on' }], // 形成环 1→2→3→1
        }),
      ];

      const report = await service.checkConsistency(entries);

      const cycle = report.issues.find((i) => i.kind === 'relation_cycle');
      expect(cycle).toBeDefined();
      expect(cycle!.severity).toBe('error');
      expect(cycle!.entryIds).toContain(1);
      expect(cycle!.entryIds).toContain(2);
      expect(cycle!.entryIds).toContain(3);
      expect(report.passed).toBe(false);
    });

    it('LLM mock 返回矛盾 → 标记 setting_contradiction', async () => {
      const llmWithConflict = createMockLLMCompare([
        {
          entryIds: [1, 2],
          description: '条目A说城市在地下，条目B说摩天大楼林立',
          severity: 'error',
        },
      ]);
      const serviceWithLLM = new WorldBookAuditService({
        embeddingService,
        llmCompare: llmWithConflict as unknown as LLMCompareFn,
      });

      const entries = [
        createEntry({ uid: 1, key: ['a'], content: 'entry A content' }),
        createEntry({ uid: 2, key: ['b'], content: 'entry B content' }),
      ];

      const report = await serviceWithLLM.checkConsistency(entries);

      const contradiction = report.issues.find((i) => i.kind === 'setting_contradiction');
      expect(contradiction).toBeDefined();
      expect(contradiction!.description).toContain('地下');
      expect(contradiction!.severity).toBe('error');
      expect(llmWithConflict).toHaveBeenCalledTimes(1);
    });

    it('LLM 失败降级：不抛错，仅跳过设定矛盾检测', async () => {
      const failingLLM = vi.fn(async () => {
        throw new Error('LLM service unavailable');
      });
      const serviceWithFailingLLM = new WorldBookAuditService({
        embeddingService,
        llmCompare: failingLLM as unknown as LLMCompareFn,
      });

      const entries = [
        createEntry({ uid: 1, key: ['a'], content: 'entry A content' }),
        createEntry({ uid: 2, key: ['b'], content: 'entry B content' }),
      ];

      const report = await serviceWithFailingLLM.checkConsistency(entries);

      // LLM 失败 → 不抛错，仅跳过 setting_contradiction 检测
      expect(report.issues.find((i) => i.kind === 'setting_contradiction')).toBeUndefined();
      // 其他维度的检测仍应正常执行（这里无关键词冲突、无关系图环）
      expect(report.passed).toBe(true);
    });

    it('关系图无环：DAG 不报 cycle', async () => {
      const entries = [
        createEntry({
          uid: 1,
          key: ['a'],
          content: 'entry A',
          relations: [{ targetId: 2, type: 'depends_on' }],
        }),
        createEntry({
          uid: 2,
          key: ['b'],
          content: 'entry B',
          relations: [{ targetId: 3, type: 'depends_on' }],
        }),
        createEntry({
          uid: 3,
          key: ['c'],
          content: 'entry C',
          // 无 relations，不形成环
        }),
      ];

      const report = await service.checkConsistency(entries);

      const cycle = report.issues.find((i) => i.kind === 'relation_cycle');
      expect(cycle).toBeUndefined();
    });
  });

  // ==================== SubTask 2.3: evaluateConformance ====================

  describe('evaluateConformance', () => {
    it('全符合：所有条目与用户提示 cosine >= 0.4 → passed=true', async () => {
      const entries = [
        createEntry({ uid: 1, key: ['city'], content: 'The city detective solves crimes' }),
        createEntry({ uid: 2, key: ['noir'], content: 'A detective in the city investigates' }),
      ];

      const report = await service.evaluateConformance(
        'cyberpunk city detective story',
        [],
        entries
      );

      expect(report.totalCount).toBe(2);
      expect(report.conformantCount).toBe(2);
      expect(report.deviatedEntries).toHaveLength(0);
      expect(report.passed).toBe(true);
    });

    it('部分偏离：部分条目与用户提示 cosine < 0.4 → 标记为 deviated', async () => {
      const entries = [
        // city detective → [0.9, 0.1, 0.1]，与查询 "city detective" 高度匹配
        createEntry({ uid: 1, key: ['city'], content: 'The city detective story' }),
        // cooking → [0, 0, 1]，与 city/detective 正交 → 偏离
        createEntry({ uid: 2, key: ['food'], content: 'cooking recipes for breakfast' }),
      ];

      const report = await service.evaluateConformance(
        'cyberpunk city detective story',
        [],
        entries
      );

      expect(report.totalCount).toBe(2);
      expect(report.conformantCount).toBe(1);
      expect(report.deviatedEntries).toHaveLength(1);
      expect(report.deviatedEntries[0].entryUid).toBe(2);
      expect(report.deviatedEntries[0].score).toBeLessThan(0.4);
      expect(report.passed).toBe(false); // 1/2 = 0.5 < 0.8
    });

    it('向量化失败降级：单个条目向量化失败时跳过，不阻塞审计', async () => {
      const partialFailEmbedding: IEmbeddingProvider = {
        async generateEmbedding(text: string) {
          // 查询文本正常向量化
          if (text.includes('cyberpunk')) {
            return { success: true, vector: [0.9, 0.1, 0.1] };
          }
          // 包含 "fail-me" 的文本向量化失败
          if (text.includes('fail-me')) {
            return { success: false, error: 'mock vectorization failure' };
          }
          // 其他正常
          return { success: true, vector: [0.9, 0.1, 0.1] };
        },
      };
      const serviceWithPartialFail = new WorldBookAuditService({
        embeddingService: partialFailEmbedding,
        llmCompare,
      });

      const entries = [
        createEntry({ uid: 1, key: ['city'], content: 'city detective content' }),
        createEntry({ uid: 2, key: ['bad'], content: 'fail-me content' }), // 向量化失败
      ];

      const report = await serviceWithPartialFail.evaluateConformance(
        'cyberpunk story',
        [],
        entries
      );

      // 失败的条目被跳过，仅评估成功的条目
      expect(report.totalCount).toBe(1); // 仅 1 个成功评估
      expect(report.conformantCount).toBe(1);
      expect(report.deviatedEntries).toHaveLength(0);
      expect(report.passed).toBe(true);
    });

    it('embeddingService 未注入 → 返回默认通过报告（降级）', async () => {
      const serviceNoEmbedding = new WorldBookAuditService({ llmCompare });

      const entries = [
        createEntry({ uid: 1, key: ['city'], content: 'city content' }),
      ];

      const report = await serviceNoEmbedding.evaluateConformance(
        'test prompt',
        [],
        entries
      );

      // 降级：返回默认通过报告
      expect(report.passed).toBe(true);
      expect(report.totalCount).toBe(1);
      expect(report.conformantCount).toBe(1);
    });

    it('查询文本向量化失败 → 降级返回默认通过报告', async () => {
      const failOnQueryEmbedding: IEmbeddingProvider = {
        async generateEmbedding(text: string) {
          if (text.includes('cyberpunk')) {
            return { success: false, error: 'query vectorization failed' };
          }
          return { success: true, vector: [0.5, 0.5, 0.5] };
        },
      };
      const serviceWithQueryFail = new WorldBookAuditService({
        embeddingService: failOnQueryEmbedding,
        llmCompare,
      });

      const entries = [
        createEntry({ uid: 1, key: ['city'], content: 'city content' }),
      ];

      const report = await serviceWithQueryFail.evaluateConformance(
        'cyberpunk story',
        [],
        entries
      );

      // 查询向量化失败 → 降级返回默认通过报告
      expect(report.passed).toBe(true);
      expect(report.totalCount).toBe(1);
      expect(report.conformantCount).toBe(1);
    });

    it('clarifications 回答被合并到查询文本中', async () => {
      const entries = [
        createEntry({ uid: 1, key: ['city'], content: 'The city detective story' }),
      ];

      const report = await service.evaluateConformance(
        'story',  // 仅 "story" 无法匹配 city/detective
        [
          { questionId: 'q1', answer: 'cyberpunk city detective' },  // 澄清回答补充关键词
        ],
        entries
      );

      // 合并后查询文本包含 "city detective"，应与条目匹配
      expect(report.totalCount).toBe(1);
      expect(report.conformantCount).toBe(1);
      expect(report.passed).toBe(true);
    });
  });

  // ==================== SubTask 2.4: runFullAudit ====================

  describe('runFullAudit', () => {
    it('聚合三维度：全过 → overallPassed=true', async () => {
      const dim = createDimension({ id: 'dim-1', name: 'City', targetEntryCount: 1 });
      const plan = createPlan([dim]);
      const entries = [
        createEntry({
          uid: 1,
          key: ['city'],
          content: 'The city detective story',
          dimensionId: 'dim-1',
        }),
      ];

      const report = await service.runFullAudit(
        plan,
        entries,
        'cyberpunk city detective story',
        []
      );

      expect(report.overallPassed).toBe(true);
      expect(report.completeness.passed).toBe(true);
      expect(report.consistency.passed).toBe(true);
      expect(report.conformance.passed).toBe(true);
      expect(report.overallScore).toBeGreaterThan(0.8);
    });

    it('聚合三维度：完整性失败 → overallPassed=false', async () => {
      const dim = createDimension({ id: 'dim-1', name: 'City', targetEntryCount: 5 });
      const plan = createPlan([dim]);
      const entries = [
        createEntry({
          uid: 1,
          key: [],  // key 为空 → 完整性失败
          content: '',
          dimensionId: 'dim-1',
        }),
      ];

      const report = await service.runFullAudit(plan, entries, 'test', []);

      expect(report.completeness.passed).toBe(false);
      expect(report.overallPassed).toBe(false);
    });

    it('autoFixes 生成：缺失字段标"需补充"', async () => {
      const dim = createDimension({ id: 'dim-1', name: 'City', targetEntryCount: 1 });
      const plan = createPlan([dim]);
      const entries = [
        createEntry({
          uid: 1,
          key: [],  // key 缺失
          content: 'city content',
          dimensionId: 'dim-1',
        }),
      ];

      const report = await service.runFullAudit(plan, entries, 'test', []);

      const keyFix = report.autoFixes.find((f) => f.field === 'key');
      expect(keyFix).toBeDefined();
      expect(keyFix!.newValue).toBe('需补充');
      expect(keyFix!.severity).toBe('warning');
      expect(keyFix!.applied).toBe(false);
    });

    it('autoFixes 生成：未覆盖维度标"需生成条目"', async () => {
      const dim1 = createDimension({ id: 'dim-1', name: 'City', targetEntryCount: 1 });
      const dim2 = createDimension({ id: 'dim-2', name: 'Character', targetEntryCount: 1 });
      const plan = createPlan([dim1, dim2]);
      const entries = [
        createEntry({
          uid: 1,
          key: ['city'],
          content: 'city content',
          dimensionId: 'dim-1',
        }),
        // dim-2 未覆盖
      ];

      const report = await service.runFullAudit(plan, entries, 'test', []);

      const dimFix = report.autoFixes.find(
        (f) => f.entryUid === 'dim:dim-2' && f.field === 'entries'
      );
      expect(dimFix).toBeDefined();
      expect(dimFix!.newValue).toBe('需生成条目');
      expect(dimFix!.reason).toContain('Character');
    });

    it('userDecisions 生成：critical 级别一致性问题需用户决策', async () => {
      const llmWithCritical = createMockLLMCompare([
        {
          entryIds: [1, 2],
          description: '严重矛盾：条目A与条目B完全冲突',
          severity: 'critical',
        },
      ]);
      const serviceWithCritical = new WorldBookAuditService({
        embeddingService,
        llmCompare: llmWithCritical as unknown as LLMCompareFn,
      });

      const dim = createDimension({ id: 'dim-1', name: 'City', targetEntryCount: 1 });
      const plan = createPlan([dim]);
      const entries = [
        createEntry({ uid: 1, key: ['a'], content: 'entry A', dimensionId: 'dim-1' }),
        createEntry({ uid: 2, key: ['b'], content: 'entry B', dimensionId: 'dim-1' }),
      ];

      const report = await serviceWithCritical.runFullAudit(
        plan,
        entries,
        'test',
        []
      );

      expect(report.userDecisions.length).toBeGreaterThan(0);
      const decision = report.userDecisions[0];
      expect(decision.severity).toBe('critical');
      expect(decision.options).toContain('忽略');
      expect(decision.entryIds).toContain(1);
      expect(decision.entryIds).toContain(2);
    });

    it('单维度失败不阻塞其他维度：完整性异常时一致性与符合度仍执行', async () => {
      // 通过让 validateCompleteness 抛错来模拟单维度失败
      // 方案：传入一个会导致 validateCompleteness 内部异常的 plan（goal 为 undefined）
      // 但 TypeScript 类型要求 plan.goal 存在，改用 spy 方式
      const dim = createDimension({ id: 'dim-1', name: 'City', targetEntryCount: 1 });
      const plan = createPlan([dim]);
      const entries = [
        createEntry({
          uid: 1,
          key: ['city'],
          content: 'The city detective story',
          dimensionId: 'dim-1',
        }),
      ];

      // 用 spy 让 validateCompleteness 抛错
      const spy = vi.spyOn(service, 'validateCompleteness').mockRejectedValueOnce(
        new Error('mock completeness failure')
      );

      const report = await service.runFullAudit(
        plan,
        entries,
        'cyberpunk city detective story',
        []
      );

      // 完整性降级为默认失败报告
      expect(report.completeness.passed).toBe(false);
      expect(report.completeness.missingFields).toHaveLength(0); // 降级后的空报告
      // 一致性与符合度仍正常执行
      expect(report.consistency.passed).toBe(true);
      expect(report.conformance.passed).toBe(true);
      // overallPassed = false（因完整性失败）
      expect(report.overallPassed).toBe(false);

      spy.mockRestore();
    });

    it('overallScore 计算：三维度加权平均（completeness 0.4 / consistency 0.4 / conformance 0.2）', async () => {
      const dim = createDimension({ id: 'dim-1', name: 'City', targetEntryCount: 1 });
      const plan = createPlan([dim]);
      const entries = [
        createEntry({
          uid: 1,
          key: ['city'],
          content: 'The city detective story',
          dimensionId: 'dim-1',
        }),
      ];

      const report = await service.runFullAudit(
        plan,
        entries,
        'cyberpunk city detective story',
        []
      );

      // 三维度全过 → 各项分数应为 1 → overallScore = 1*0.4 + 1*0.4 + 1*0.2 = 1
      expect(report.overallScore).toBeCloseTo(1, 5);
    });

    it('createdAt 时间戳被填充', async () => {
      const dim = createDimension({ id: 'dim-1', name: 'City', targetEntryCount: 1 });
      const plan = createPlan([dim]);
      const entries = [
        createEntry({
          uid: 1,
          key: ['city'],
          content: 'city content',
          dimensionId: 'dim-1',
        }),
      ];

      const before = Date.now();
      const report = await service.runFullAudit(plan, entries, 'test', []);
      const after = Date.now();

      expect(report.createdAt).toBeGreaterThanOrEqual(before);
      expect(report.createdAt).toBeLessThanOrEqual(after);
    });
  });

  // ==================== 单例导出验证 ====================

  describe('单例导出', () => {
    it('worldbookAuditService 单例已导出且实现 IAuditServices', async () => {
      const { worldbookAuditService: singleton } = await import('../worldbookAuditService');
      expect(singleton).toBeDefined();
      expect(typeof singleton.validateCompleteness).toBe('function');
      expect(typeof singleton.checkConsistency).toBe('function');
      expect(typeof singleton.evaluateConformance).toBe('function');
      expect(typeof singleton.runFullAudit).toBe('function');
    });
  });
});
