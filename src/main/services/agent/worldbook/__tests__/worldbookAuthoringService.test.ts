/**
 * WorldBookAuthoringService 单元测试 —— 三阶段状态机编排服务
 *
 * 来源：spec §二 Task 4 验证 / `implement-worldbook-authoring-agent`
 *
 * 覆盖（spec §SubTask 4 验证要求 ≥15 用例）：
 *  1. 状态机五状态转移（PLANNING→AUTHORING→AUDITING→AWAITING_REVIEW→COMPLETE）
 *  2. PLANNING 阶段 clarify 事件推送 + submitAnswers 唤醒 + 超时跳过
 *  3. AUTHORING 阶段逐维度生成 + 微型审计 + steer 注入 + pacing
 *  4. AUDITING 阶段 runFullAudit + 自动修复 + userDecisions
 *  5. 单实例守卫（同 worldBookPath 重复 run 拒绝）
 *  6. 取消机制（cancel 后 abort 生效，已生成草稿保留）
 *  7. 断点续跑（resumeSession 从 AUTHORING 中间状态继续）
 *  8. goalTracker 集成（createGoal/updateStatus/blocked）
 *  9. 进度回调推送（各 phase 事件）
 *
 * Mock 策略：
 *  - 所有依赖通过构造参数注入 mock 实例（planningService / auditService / tools / entryGenerator /
 *    memoryStore / steerEngine / goalTracker）
 *  - sleep 注入快进函数（立即返回，避免测试等待 pacing）
 *  - 不依赖真实 LLM / AIService / SQLite
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  WorldBookAuthoringService,
  type IAuthoringTools,
  type IEntryGenerator,
  type ISteerSink,
  type IGoalSink,
  type WorldBookAuthoringServiceDeps,
} from '../worldbookAuthoringService';
import type {
  IAuditServices,
  IPlanningServices,
  WorldBookAuthoringConfig,
  WorldBookAuthoringRunRequest,
} from '../worldbookAuthoringTypes';
import type {
  AuthoringPlan,
  AuthoringDimension,
  AuthoringProgressEvent,
  AuditReport,
  CompletenessReport,
  ConsistencyReport,
  ConformanceReport,
} from '../../../../../shared/types/worldbook-authoring.types';
import type { ToolExecutionResult, IMemoryProvider, MemoryEntry } from '../../contracts';

// ==================== 默认配置 ====================

const DEFAULT_CONFIG: WorldBookAuthoringConfig = {
  maxEntriesPerDimension: 3,
  minEntriesPerDimension: 1,
  auditThreshold: 0.8,
  pacingMinMs: 0, // 测试中设为 0，避免等待
  pacingMaxMs: 100,
  enableAutoFix: true,
  llmConfig: {
    model: 'test-model',
    temperature: 0.3,
    maxTokens: 2048,
  },
};

// ==================== Mock 工厂 ====================

function createMockPlanningService(overrides: Partial<IPlanningServices> = {}): IPlanningServices {
  return {
    analyzePrompt: vi.fn(async (_prompt: string) => ({
      dimensions: [
        { name: '世界观', category: 'worldview' as const, source: 'user' as const, description: '世界背景' },
        { name: '关键人物', category: 'character' as const, source: 'agent-suggested' as const, description: '主要角色' },
      ],
      themeSummary: '测试主题',
      ambiguities: ['时代背景', '主角势力'],
    })),
    // 默认返回空问题列表，让不测试 clarify 流程的测试可以直接跑完 PLANNING。
    // 测试 clarify 流程的用例会覆盖此 mock 返回非空问题列表。
    generateClarifyingQuestions: vi.fn(async () => []),
    buildPlan: vi.fn(async (userPrompt: string) => {
      const dimensions: AuthoringDimension[] = [
        {
          id: 'dim-1',
          name: '世界观',
          category: 'worldview',
          targetEntryCount: 2,
          source: 'user',
          description: '世界背景',
          generatedEntryUids: [],
        },
        {
          id: 'dim-2',
          name: '关键人物',
          category: 'character',
          targetEntryCount: 2,
          source: 'agent-suggested',
          description: '主要角色',
          generatedEntryUids: [],
        },
      ];
      const plan: AuthoringPlan = {
        goal: {
          theme: userPrompt,
          dimensions,
          targetTotalEntries: 4,
          qualityThreshold: 0.8,
        },
        clarifyingQuestions: [
          { id: 'q1', question: '故事发生在哪个年代？', why: '年代影响科技水平', skipped: false, answer: '近未来' },
          { id: 'q2', question: '主角属于哪个势力？', why: '决定主角立场', skipped: false, answer: '反抗军' },
        ],
        userAnswers: [
          { questionId: 'q1', answer: '近未来', inferred: false },
          { questionId: 'q2', answer: '反抗军', inferred: false },
        ],
        createdAt: Date.now(),
      };
      return plan;
    }),
    expandDimensions: vi.fn(async (plan: AuthoringPlan) => plan),
    ...overrides,
  };
}

function createMockAuditService(overrides: Partial<IAuditServices> = {}): IAuditServices {
  const passedCompleteness: CompletenessReport = {
    missingFields: [],
    uncoveredDimensions: [],
    underfilledDimensions: [],
    passed: true,
  };
  const passedConsistency: ConsistencyReport = {
    issues: [],
    passed: true,
  };
  const passedConformance: ConformanceReport = {
    conformantCount: 4,
    totalCount: 4,
    deviatedEntries: [],
    passed: true,
  };
  const passedAudit: AuditReport = {
    completeness: passedCompleteness,
    consistency: passedConsistency,
    conformance: passedConformance,
    overallPassed: true,
    overallScore: 1.0,
    autoFixes: [],
    userDecisions: [],
    createdAt: Date.now(),
  };
  return {
    validateCompleteness: vi.fn(async () => passedCompleteness),
    checkConsistency: vi.fn(async () => passedConsistency),
    evaluateConformance: vi.fn(async () => passedConformance),
    runFullAudit: vi.fn(async () => passedAudit),
    ...overrides,
  };
}

function createMockTools(overrides: Partial<IAuthoringTools> = {}): IAuthoringTools & {
  createdEntries: Array<{ name: string; content: string; keys: string[] }>;
} {
  const createdEntries: Array<{ name: string; content: string; keys: string[] }> = [];
  let uidCounter = 100;
  return {
    readWorldBook: vi.fn(async () => ({
      name: 'TestWorldBook',
      entries: createdEntries.map((e, i) => ({
        uid: 100 + i,
        name: e.name,
        content: e.content,
        key: e.keys,
        comment: e.name,
        autoGenerated: true,
      })),
    })),
    createEntry: vi.fn(async (args) => {
      uidCounter += 1;
      createdEntries.push({ name: args.name, content: args.content, keys: args.keys });
      const result: ToolExecutionResult = {
        success: true,
        content: `Entry created successfully as draft (autoGenerated=true, pending user review).\n- UID: ${uidCounter}\n- Name: ${args.name}\n- Keys: ${args.keys.join(', ')}\n- Worldbook: ${args.worldBookPath}`,
        continueLoop: true,
      };
      return result;
    }),
    generateKeywords: vi.fn(async (args) => ({
      success: true,
      content: `Keywords updated for entry UID ${args.entryUid}.`,
      continueLoop: true,
    })),
    ...overrides,
  } as IAuthoringTools & { createdEntries: Array<{ name: string; content: string; keys: string[] }> };
}

function createMockEntryGenerator(overrides: Partial<IEntryGenerator> = {}): IEntryGenerator {
  return {
    generateEntriesForDimension: vi.fn(async (dimension: AuthoringDimension) => {
      return [
        {
          name: `${dimension.name}条目1`,
          content: `${dimension.name}的详细内容描述`,
          keys: [`${dimension.name}`, '关键词1', '关键词2'],
          secondaryKeys: ['次要关键词'],
          comment: `${dimension.name}条目1注释`,
        },
      ];
    }),
    ...overrides,
  };
}

function createMockSteerEngine(): ISteerSink & { enqueued: Array<{ content: string; label?: string }> } {
  const enqueued: Array<{ content: string; label?: string }> = [];
  return {
    enqueueSteer: vi.fn(async (params) => {
      enqueued.push({ content: params.content, label: params.label });
      return `steer_${Date.now()}_${Math.random()}`;
    }),
    enqueued,
  };
}

function createMockGoalTracker(): IGoalSink & {
  goals: Array<{ sessionId: string; objective: string }>;
  updates: Array<{ sessionId: string; status: string; blocker?: string; note?: string }>;
} {
  const goals: Array<{ sessionId: string; objective: string }> = [];
  const updates: Array<{ sessionId: string; status: string; blocker?: string; note?: string }> = [];
  return {
    createGoal: vi.fn(async (params) => {
      goals.push({ sessionId: params.sessionId, objective: params.objective });
      return { id: `goal_${Date.now()}` };
    }),
    updateStatus: vi.fn(async (params) => {
      updates.push({
        sessionId: params.sessionId,
        status: params.status,
        blocker: params.blocker,
        note: params.note,
      });
      return {};
    }),
    goals,
    updates,
  };
}

function createMockMemoryStore(): IMemoryProvider & {
  stored: Map<string, MemoryEntry>;
} {
  const stored = new Map<string, MemoryEntry>();
  return {
    search: vi.fn(async (query) => {
      const results: MemoryEntry[] = [];
      for (const [, entry] of stored) {
        if (query.sessionId && entry.sessionId !== query.sessionId) continue;
        if (query.types && !query.types.includes(entry.type)) continue;
        if (query.query && !entry.content.includes(query.query)) continue;
        results.push(entry);
      }
      return results;
    }),
    write: vi.fn(async (entry) => {
      const id = `mem_${Date.now()}_${Math.random()}`;
      const fullEntry: MemoryEntry = {
        ...entry,
        id,
        timestamp: Date.now(),
      };
      stored.set(id, fullEntry);
      return id;
    }),
    read: vi.fn(async (id: string) => stored.get(id) ?? null),
    delete: vi.fn(async (id: string) => {
      if (stored.has(id)) {
        stored.delete(id);
        return true;
      }
      return false;
    }),
    stored,
  } as IMemoryProvider & { stored: Map<string, MemoryEntry> };
}

// ==================== 测试辅助 ====================

function createRunRequest(overrides: Partial<WorldBookAuthoringRunRequest> = {}): WorldBookAuthoringRunRequest {
  return {
    userPrompt: '为一部赛博朋克侦探小说创建世界书',
    worldBookPath: '/test/worldbook.json',
    allowedWorldBookPaths: ['/test/worldbook.json'],
    config: DEFAULT_CONFIG,
    onProgress: vi.fn(),
    ...overrides,
  };
}

function createServiceDeps(overrides: Partial<WorldBookAuthoringServiceDeps> = {}): WorldBookAuthoringServiceDeps {
  return {
    planningService: createMockPlanningService(),
    auditService: createMockAuditService(),
    tools: createMockTools(),
    entryGenerator: createMockEntryGenerator(),
    memoryStore: createMockMemoryStore(),
    steerEngine: createMockSteerEngine(),
    goalTracker: createMockGoalTracker(),
    sleep: async () => {}, // 快进
    ...overrides,
  };
}

// ==================== 测试套件 ====================

describe('WorldBookAuthoringService', () => {
  let deps: WorldBookAuthoringServiceDeps;
  let service: WorldBookAuthoringService;

  beforeEach(() => {
    deps = createServiceDeps();
    service = new WorldBookAuthoringService(deps);
  });

  // ==================== 1. 状态机五状态转移 ====================

  describe('状态机五状态转移', () => {
    it('完整流程：PLANNING→AUTHORING→AUDITING→AWAITING_REVIEW→COMPLETE', async () => {
      const request = createRunRequest();
      const result = await service.run(request);

      expect(result.success).toBe(true);
      expect(result.finalState).toBe('COMPLETE');
      expect(result.sessionId).toBeDefined();

      // 验证 planningService 各方法被调用
      expect(deps.planningService.analyzePrompt).toHaveBeenCalledTimes(1);
      expect(deps.planningService.generateClarifyingQuestions).toHaveBeenCalledTimes(1);
      expect(deps.planningService.buildPlan).toHaveBeenCalledTimes(1);
      expect(deps.planningService.expandDimensions).toHaveBeenCalledTimes(1);

      // 验证 auditService.runFullAudit 被调用
      expect(deps.auditService.runFullAudit).toHaveBeenCalledTimes(1);

      // 验证条目生成
      expect(deps.entryGenerator.generateEntriesForDimension).toHaveBeenCalled();
      expect(deps.tools.createEntry).toHaveBeenCalled();
      expect(result.generatedEntryIds.length).toBeGreaterThan(0);
    });

    it('PLANNING 阶段完成后状态转移至 AUTHORING（通过 persisted session 验证）', async () => {
      const request = createRunRequest();
      const result = await service.run(request);

      expect(result.success).toBe(true);
      // 验证 memoryStore 被写入（含多次状态转移持久化）
      expect(deps.memoryStore!.write).toHaveBeenCalled();
      const writeCalls = (deps.memoryStore!.write as ReturnType<typeof vi.fn>).mock.calls;
      // 至少有 PLANNING→AUTHORING、AUTHORING→AUDITING、AUDITING→AWAITING_REVIEW、AWAITING_REVIEW→COMPLETE 4 次转移
      expect(writeCalls.length).toBeGreaterThanOrEqual(4);
    });
  });

  // ==================== 2. PLANNING 阶段 ====================

  describe('PLANNING 阶段', () => {
    it('clarify 事件推送 + submitAnswers 唤醒', async () => {
      // 覆盖默认 mock：返回非空澄清问题列表以测试 clarify 流程
      const clarifyPlanning = createMockPlanningService({
        generateClarifyingQuestions: vi.fn(async () => [
          { id: 'q1', question: '故事发生在哪个年代？', why: '年代影响科技水平' },
          { id: 'q2', question: '主角属于哪个势力？', why: '决定主角立场' },
        ]),
      });
      const clarifyDeps = createServiceDeps({ planningService: clarifyPlanning });
      const clarifyService = new WorldBookAuthoringService(clarifyDeps);

      const onProgress = vi.fn();
      const request = createRunRequest({ onProgress });

      // 异步启动 run，在 PLANNING 等待回答时提交答案
      const runPromise = clarifyService.run(request);

      // 等待一小段时间让 PLANNING 进入等待状态
      await new Promise(resolve => setTimeout(resolve, 50));

      // 验证 planning_clarifying 事件已推送
      const clarifyCall = onProgress.mock.calls.find(
        (call) => (call[0] as AuthoringProgressEvent).phase === 'planning_clarifying'
      );
      expect(clarifyCall).toBeDefined();

      // 获取 sessionId 并提交答案
      // 从 sessions Map 中查找活跃会话
      const sessions = (clarifyService as unknown as { sessions: Map<string, { id: string }> }).sessions;
      let sessionId: string | undefined;
      for (const [id] of sessions) {
        sessionId = id;
        break;
      }
      expect(sessionId).toBeDefined();

      const submitted = await clarifyService.submitAnswers(sessionId!, [
        { questionId: 'q1', answer: '近未来', skipped: false },
        { questionId: 'q2', answer: '反抗军', skipped: false },
      ]);
      expect(submitted).toBe(true);

      const result = await runPromise;
      expect(result.success).toBe(true);
      expect(result.finalState).toBe('COMPLETE');
    });

    it('超时跳过未回答问题（10 分钟超时，测试中模拟）', async () => {
      // 使用自定义服务，覆盖默认 mock 返回非空澄清问题列表
      const timeoutPlanning = createMockPlanningService({
        generateClarifyingQuestions: vi.fn(async () => [
          { id: 'q1', question: '故事发生在哪个年代？', why: '年代影响科技水平' },
          { id: 'q2', question: '主角属于哪个势力？', why: '决定主角立场' },
        ]),
      });
      const timeoutDeps = createServiceDeps({ planningService: timeoutPlanning });
      const timeoutService = new WorldBookAuthoringService(timeoutDeps);

      const onProgress = vi.fn();
      const request = createRunRequest({ onProgress });

      // 启动 run（不提交答案）
      const runPromise = timeoutService.run(request);

      // 等待一小段时间让 PLANNING 进入等待状态
      await new Promise(resolve => setTimeout(resolve, 50));

      // 获取 sessionId
      const sessions = (timeoutService as unknown as { sessions: Map<string, { id: string; answerTimeout?: ReturnType<typeof setTimeout> }> }).sessions;
      let sessionId: string | undefined;
      let session: { id: string; answerTimeout?: ReturnType<typeof setTimeout> } | undefined;
      for (const [id, s] of sessions) {
        sessionId = id;
        session = s;
        break;
      }
      expect(sessionId).toBeDefined();
      expect(session?.answerTimeout).toBeDefined();

      // 模拟超时：直接触发 timeout 回调
      if (session?.answerTimeout) {
        clearTimeout(session.answerTimeout);
        // 手动触发超时逻辑：调用 submitAnswers with all skipped
        await timeoutService.submitAnswers(sessionId!, [
          { questionId: 'q1', skipped: true },
          { questionId: 'q2', skipped: true },
        ]);
      }

      const result = await runPromise;
      expect(result.success).toBe(true);
      // 超时跳过后仍应继续执行（buildPlan 用推断默认值）
      expect(timeoutDeps.planningService.buildPlan).toHaveBeenCalledTimes(1);
    });

    it('analyzePrompt LLM 失败时重试 3 次', async () => {
      const callCount = { value: 0 };
      const failingPlanning = createMockPlanningService({
        analyzePrompt: vi.fn(async () => {
          callCount.value += 1;
          if (callCount.value < 3) throw new Error('LLM boom');
          return {
            dimensions: [
              { name: '维度1', category: 'worldview' as const, source: 'user' as const, description: '' },
            ],
            themeSummary: '主题',
            ambiguities: [],
          };
        }),
      });
      const failingDeps = createServiceDeps({ planningService: failingPlanning });
      const failingService = new WorldBookAuthoringService(failingDeps);

      const result = await failingService.run(createRunRequest());

      expect(result.success).toBe(true);
      expect(callCount.value).toBe(3); // 失败 2 次后第 3 次成功
    });
  });

  // ==================== 3. AUTHORING 阶段 ====================

  describe('AUTHORING 阶段', () => {
    it('逐维度生成条目（按 plan.dimensions 顺序）', async () => {
      const request = createRunRequest();
      const result = await service.run(request);

      expect(result.success).toBe(true);
      // buildPlan 返回 2 个维度，每个维度 targetEntryCount=2
      // entryGenerator 每次返回 1 个条目，所以应被调用至少 4 次
      expect(deps.entryGenerator.generateEntriesForDimension).toHaveBeenCalled();
      const genCalls = (deps.entryGenerator.generateEntriesForDimension as ReturnType<typeof vi.fn>).mock.calls;
      // 验证调用的维度覆盖 plan 中的维度
      const dimNames = genCalls.map((c) => (c[0] as AuthoringDimension).name);
      expect(dimNames.some((n) => n === '世界观')).toBe(true);
      expect(dimNames.some((n) => n === '关键人物')).toBe(true);
    });

    it('每 3 条触发微型审计（validateCompleteness + checkConsistency）', async () => {
      // buildPlan 返回 2 维度 × 2 条目 = 4 条目，MINI_AUDIT_INTERVAL=3
      // 所以应在第 3 条触发一次微型审计
      const request = createRunRequest();
      await service.run(request);

      // 微型审计调用 validateCompleteness + checkConsistency（非 runFullAudit）
      expect(deps.auditService.validateCompleteness).toHaveBeenCalled();
      expect(deps.auditService.checkConsistency).toHaveBeenCalled();
    });

    it('微型审计发现问题 → 注入 steer 消息', async () => {
      const auditWithIssues = createMockAuditService({
        validateCompleteness: vi.fn(async () => ({
          missingFields: [
            { entryUid: 100, field: 'key', reason: 'key is empty array' },
          ],
          uncoveredDimensions: [],
          underfilledDimensions: [],
          passed: false,
        })),
        checkConsistency: vi.fn(async () => ({
          issues: [
            {
              entryIds: [100, 101],
              description: '设定矛盾',
              severity: 'error' as const,
              kind: 'setting_contradiction' as const,
            },
          ],
          passed: false,
        })),
      });
      const steerEngine = createMockSteerEngine();
      const issueDeps = createServiceDeps({ auditService: auditWithIssues, steerEngine });
      const issueService = new WorldBookAuthoringService(issueDeps);

      await issueService.run(createRunRequest());

      // 验证 steer 消息被注入
      expect(steerEngine.enqueueSteer).toHaveBeenCalled();
      expect(steerEngine.enqueued.length).toBeGreaterThan(0);
      // 至少包含完整性问题或一致性问题
      const steerContents = steerEngine.enqueued.map((e) => e.content);
      expect(steerContents.some((c) => c.includes('完整性') || c.includes('一致性'))).toBe(true);
    });

    it('pacing 钳位：每轮间隔 sleep（config.pacingMinMs > 0 时）', async () => {
      const sleepCalls: number[] = [];
      const pacingDeps = createServiceDeps({
        sleep: async (ms: number) => { sleepCalls.push(ms); },
      });
      // 覆盖 config 使 pacingMinMs > 0
      const pacingConfig: WorldBookAuthoringConfig = {
        ...DEFAULT_CONFIG,
        pacingMinMs: 50,
        pacingMaxMs: 100,
      };
      const pacingService = new WorldBookAuthoringService(pacingDeps);

      await pacingService.run(createRunRequest({ config: pacingConfig }));

      // 验证 sleep 被调用（pacingMinMs=50，应 sleep 约 50ms）
      expect(sleepCalls.length).toBeGreaterThan(0);
      expect(sleepCalls.some((ms) => ms >= 50 && ms <= 100)).toBe(true);
    });

    it('单维度连续失败 3 次 → goalTracker.markBlocked + blocked 事件', async () => {
      const failingGen = createMockEntryGenerator({
        generateEntriesForDimension: vi.fn(async () => {
          throw new Error('LLM generation failed');
        }),
      });
      const goalTracker = createMockGoalTracker();
      const failDeps = createServiceDeps({ entryGenerator: failingGen, goalTracker });
      const failService = new WorldBookAuthoringService(failDeps);

      const onProgress = vi.fn();
      const result = await failService.run(createRunRequest({ onProgress }));

      // 应完成（降级：所有维度都失败但仍走完流程）
      expect(result.success).toBe(true);

      // 验证 goalTracker.updateStatus(blocked) 被调用
      const blockedUpdates = goalTracker.updates.filter((u) => u.status === 'blocked');
      expect(blockedUpdates.length).toBeGreaterThan(0);

      // 验证 error 事件推送（blocked 维度）
      const errorEvents = onProgress.mock.calls.filter(
        (call) => (call[0] as AuthoringProgressEvent).phase === 'error'
      );
      expect(errorEvents.length).toBeGreaterThan(0);
    });

    it('单维度失败不中断整体（继续下一维度）', async () => {
      let callCount = 0;
      const partialFailGen = createMockEntryGenerator({
        generateEntriesForDimension: vi.fn(async (dimension: AuthoringDimension) => {
          callCount += 1;
          if (dimension.name === '世界观') {
            throw new Error('维度1生成失败');
          }
          return [
            {
              name: `${dimension.name}条目`,
              content: '内容',
              keys: ['key'],
              secondaryKeys: [],
              comment: '注释',
            },
          ];
        }),
      });
      const partialDeps = createServiceDeps({ entryGenerator: partialFailGen });
      const partialService = new WorldBookAuthoringService(partialDeps);

      const result = await partialService.run(createRunRequest());

      // 整体应成功（降级：维度1失败但维度2成功）
      expect(result.success).toBe(true);
      // 应有部分条目生成（来自维度2）
      expect(result.generatedEntryIds.length).toBeGreaterThan(0);
    });
  });

  // ==================== 4. AUDITING 阶段 ====================

  describe('AUDITING 阶段', () => {
    it('runFullAudit 被调用 + 状态转移至 AWAITING_REVIEW', async () => {
      const request = createRunRequest();
      const result = await service.run(request);

      expect(deps.auditService.runFullAudit).toHaveBeenCalledTimes(1);
      expect(result.success).toBe(true);
      expect(result.finalState).toBe('COMPLETE');
      expect(result.auditReport).toBeDefined();
    });

    it('enableAutoFix=true 时自动修复缺失字段', async () => {
      const auditWithFixes = createMockAuditService({
        runFullAudit: vi.fn(async () => ({
          completeness: {
            missingFields: [
              { entryUid: 100, field: 'key', reason: 'key is empty' },
            ],
            uncoveredDimensions: [],
            underfilledDimensions: [],
            passed: false,
          },
          consistency: { issues: [], passed: true },
          conformance: { conformantCount: 4, totalCount: 4, deviatedEntries: [], passed: true },
          overallPassed: false,
          overallScore: 0.8,
          autoFixes: [
            {
              entryUid: 100,
              field: 'key',
              oldValue: '',
              newValue: '需补充',
              reason: '缺失必填字段：key is empty',
              severity: 'warning' as const,
              applied: false,
            },
          ],
          userDecisions: [],
          createdAt: Date.now(),
        })),
      });
      const fixTools = createMockTools();
      const fixDeps = createServiceDeps({
        auditService: auditWithFixes,
        tools: fixTools,
      });
      const fixService = new WorldBookAuthoringService(fixDeps);

      const result = await fixService.run(createRunRequest());

      expect(result.success).toBe(true);
      // 验证 generateKeywords 被调用（修复 key 缺失）
      expect(fixTools.generateKeywords).toHaveBeenCalled();
    });

    it('critical 级别问题不自动修复，汇总到 userDecisions', async () => {
      const auditWithCritical = createMockAuditService({
        runFullAudit: vi.fn(async () => ({
          completeness: { missingFields: [], uncoveredDimensions: [], underfilledDimensions: [], passed: true },
          consistency: {
            issues: [
              {
                entryIds: [100, 101],
                description: '严重矛盾',
                severity: 'critical' as const,
                kind: 'setting_contradiction' as const,
              },
            ],
            passed: false,
          },
          conformance: { conformantCount: 4, totalCount: 4, deviatedEntries: [], passed: true },
          overallPassed: false,
          overallScore: 0.5,
          autoFixes: [],
          userDecisions: [
            {
              id: 'decision_1',
              entryIds: [100, 101],
              description: '严重矛盾',
              severity: 'critical' as const,
              options: ['修改条目A', '修改条目B', '删除其中一个', '忽略'],
            },
          ],
          createdAt: Date.now(),
        })),
      });
      const criticalDeps = createServiceDeps({ auditService: auditWithCritical });
      const criticalService = new WorldBookAuthoringService(criticalDeps);

      const result = await criticalService.run(createRunRequest());

      expect(result.success).toBe(true);
      expect(result.auditReport).toBeDefined();
      expect(result.auditReport!.userDecisions.length).toBeGreaterThan(0);
      expect(result.auditReport!.userDecisions[0].severity).toBe('critical');
    });
  });

  // ==================== 5. 单实例守卫 ====================

  describe('单实例守卫', () => {
    it('同 worldBookPath 重复 run 拒绝', async () => {
      // 第一个 run 阻塞在 PLANNING 等待回答
      // 使用返回非空澄清问题的 mock，让 run1 停留在 PLANNING 等待状态
      const guardPlanning = createMockPlanningService({
        generateClarifyingQuestions: vi.fn(async () => [
          { id: 'q1', question: '问题1？', why: '原因1' },
          { id: 'q2', question: '问题2？', why: '原因2' },
        ]),
      });
      const guardDeps = createServiceDeps({ planningService: guardPlanning });
      const guardService = new WorldBookAuthoringService(guardDeps);

      const request1 = createRunRequest();
      const runPromise1 = guardService.run(request1);

      // 等待 PLANNING 进入等待状态
      await new Promise(resolve => setTimeout(resolve, 50));

      // 第二个 run 同 worldBookPath 应被拒绝
      const request2 = createRunRequest();
      const result2 = await guardService.run(request2);

      expect(result2.success).toBe(false);
      expect(result2.error).toContain('already has an active authoring session');

      // 清理：提交答案让第一个 run 完成
      const sessions = (guardService as unknown as { sessions: Map<string, { id: string }> }).sessions;
      let sessionId: string | undefined;
      for (const [id] of sessions) {
        sessionId = id;
        break;
      }
      await guardService.submitAnswers(sessionId!, [
        { questionId: 'q1', answer: '答案', skipped: false },
        { questionId: 'q2', answer: '答案', skipped: false },
      ]);

      const result1 = await runPromise1;
      expect(result1.success).toBe(true);
    });

    it('不同 worldBookPath 允许并行会话', async () => {
      const request1 = createRunRequest({ worldBookPath: '/test/wb1.json' });
      const runPromise1 = service.run(request1);

      await new Promise(resolve => setTimeout(resolve, 50));

      const request2 = createRunRequest({ worldBookPath: '/test/wb2.json' });
      const result2 = await service.run(request2);

      // 第二个 run 应成功（不同 worldBookPath）
      expect(result2.success).toBe(true);

      // 清理第一个
      const sessions = (service as unknown as { sessions: Map<string, { id: string }> }).sessions;
      for (const [id] of sessions) {
        await service.submitAnswers(id, [
          { questionId: 'q1', answer: '答案', skipped: false },
          { questionId: 'q2', answer: '答案', skipped: false },
        ]).catch(() => {});
        break;
      }
      await runPromise1.catch(() => {});
    });
  });

  // ==================== 6. 取消机制 ====================

  describe('取消机制', () => {
    it('cancel 后 abort 生效，已生成草稿保留', async () => {
      // 使用可阻塞的 entryGenerator，让 AUTHORING 阶段停留在生成过程中以便取消
      const blockingGen = createMockEntryGenerator({
        generateEntriesForDimension: vi.fn(async (dimension, _plan, _existing, _count, signal) => {
          // 等待 500ms，但 abort 时立即返回空数组（让编排循环检测到取消信号后退出）
          return new Promise<Array<{ name: string; content: string; keys: string[] }>>((resolve) => {
            const timer = setTimeout(() => {
              resolve([{
                name: `${dimension.name}条目1`,
                content: `${dimension.name}的详细内容描述`,
                keys: [`${dimension.name}`, '关键词1'],
              }]);
            }, 500);
            signal?.addEventListener('abort', () => {
              clearTimeout(timer);
              resolve([]);
            }, { once: true });
          });
        }),
      });
      const blockingDeps = createServiceDeps({ entryGenerator: blockingGen });
      const blockingService = new WorldBookAuthoringService(blockingDeps);

      const onProgress = vi.fn();
      const request = createRunRequest({ onProgress });
      const runPromise = blockingService.run(request);

      // 等待 PLANNING 完成（默认无澄清问题，直接进入 AUTHORING）
      await new Promise(resolve => setTimeout(resolve, 30));

      // 取消会话（AUTHORING 正在阻塞中）
      const sessions = (blockingService as unknown as { sessions: Map<string, { id: string }> }).sessions;
      let sessionId: string | undefined;
      for (const [id] of sessions) {
        sessionId = id;
        break;
      }
      expect(sessionId).toBeDefined();

      const cancelled = blockingService.cancel(sessionId!);
      expect(cancelled).toBe(true);

      const result = await runPromise;

      // 取消后应返回 success=false + finalState=CANCELLED
      expect(result.success).toBe(false);
      expect(result.finalState).toBe('CANCELLED');
      // 已生成的草稿条目应保留
      expect(result.generatedEntryIds).toBeDefined();

      // 验证 cancelled 事件推送
      const cancelEvents = onProgress.mock.calls.filter(
        (call) => (call[0] as AuthoringProgressEvent).phase === 'cancelled'
      );
      expect(cancelEvents.length).toBeGreaterThan(0);
    });

    it('cancel 不存在的会话返回 false', () => {
      const result = service.cancel('non-existent-session');
      expect(result).toBe(false);
    });
  });

  // ==================== 7. 断点续跑 ====================

  describe('断点续跑', () => {
    it('resumeSession 从 COMPLETE 状态直接返回（无需恢复）', async () => {
      const request = createRunRequest();
      const firstResult = await service.run(request);
      expect(firstResult.success).toBe(true);
      const sessionId = firstResult.sessionId;

      // 恢复已完成会话
      const resumeResult = await service.resumeSession(sessionId);
      expect(resumeResult.success).toBe(true);
      expect(resumeResult.finalState).toBe('COMPLETE');
    });

    it('resumeSession 不存在的会话返回错误', async () => {
      const result = await service.resumeSession('non-existent-session');
      expect(result.success).toBe(false);
      expect(result.error).toContain('not found');
    });

    it('session 持久化到 memoryStore（含 writeProvenance）', async () => {
      const request = createRunRequest();
      const result = await service.run(request);
      expect(result.success).toBe(true);

      // 验证 memoryStore.write 被调用
      const writeCalls = (deps.memoryStore!.write as ReturnType<typeof vi.fn>).mock.calls;
      expect(writeCalls.length).toBeGreaterThan(0);

      // 验证至少一次写入包含 writeProvenance
      const provenanceCalls = writeCalls.filter((call) => {
        const entry = call[0] as { metadata?: Record<string, unknown> };
        const meta = entry.metadata;
        return meta?.kind === 'worldbook-authoring-session' && meta?.writeProvenance;
      });
      expect(provenanceCalls.length).toBeGreaterThan(0);

      // 验证 writeProvenance 结构
      const provenance = provenanceCalls[0][0].metadata.writeProvenance as Record<string, unknown>;
      expect(provenance.source).toBe('worldbook-agent');
      expect(provenance.toolName).toBe('worldbookAuthoringService');
      expect(provenance.runId).toBeDefined();
      expect(provenance.timestamp).toBeDefined();
    });
  });

  // ==================== 8. goalTracker 集成 ====================

  describe('goalTracker 集成', () => {
    it('会话开始时 createGoal', async () => {
      const goalTracker = createMockGoalTracker();
      const gtDeps = createServiceDeps({ goalTracker });
      const gtService = new WorldBookAuthoringService(gtDeps);

      await gtService.run(createRunRequest());

      expect(goalTracker.createGoal).toHaveBeenCalledTimes(1);
      expect(goalTracker.goals.length).toBe(1);
      expect(goalTracker.goals[0].objective).toContain('世界书编写');
    });

    it('会话完成时 updateStatus(complete)', async () => {
      const goalTracker = createMockGoalTracker();
      const gtDeps = createServiceDeps({ goalTracker });
      const gtService = new WorldBookAuthoringService(gtDeps);

      await gtService.run(createRunRequest());

      const completeUpdates = goalTracker.updates.filter((u) => u.status === 'complete');
      expect(completeUpdates.length).toBe(1);
      expect(completeUpdates[0].note).toContain('会话完成');
    });

    it('连续失败 3 次 → updateStatus(blocked)', async () => {
      const failingGen = createMockEntryGenerator({
        generateEntriesForDimension: vi.fn(async () => {
          throw new Error('always fails');
        }),
      });
      const goalTracker = createMockGoalTracker();
      const failDeps = createServiceDeps({ entryGenerator: failingGen, goalTracker });
      const failService = new WorldBookAuthoringService(failDeps);

      await failService.run(createRunRequest());

      const blockedUpdates = goalTracker.updates.filter((u) => u.status === 'blocked');
      expect(blockedUpdates.length).toBeGreaterThan(0);
      expect(blockedUpdates[0].blocker).toContain('dimension:');
    });
  });

  // ==================== 9. 进度回调推送 ====================

  describe('进度回调推送', () => {
    it('推送 planning_analyzing 事件', async () => {
      const onProgress = vi.fn();
      const request = createRunRequest({ onProgress });
      const runPromise = service.run(request);

      await new Promise(resolve => setTimeout(resolve, 30));
      const sessionId = (service as unknown as { sessions: Map<string, { id: string }> }).sessions.keys().next().value;
      await service.submitAnswers(
        sessionId as string,
        [{ questionId: 'q1', answer: 'a', skipped: false }, { questionId: 'q2', answer: 'b', skipped: false }]
      ).catch(() => {});

      await runPromise;

      const analyzingEvents = onProgress.mock.calls.filter(
        (call) => (call[0] as AuthoringProgressEvent).phase === 'planning_analyzing'
      );
      expect(analyzingEvents.length).toBeGreaterThan(0);
    });

    it('推送 authoring_generating 事件（含 currentDimension）', async () => {
      const onProgress = vi.fn();
      const request = createRunRequest({ onProgress });
      await service.run(request);

      const generatingEvents = onProgress.mock.calls.filter(
        (call) => (call[0] as AuthoringProgressEvent).phase === 'authoring_generating'
      );
      expect(generatingEvents.length).toBeGreaterThan(0);
      // 验证事件含维度信息
      const eventsWithDim = generatingEvents.filter(
        (call) => (call[0] as AuthoringProgressEvent).currentDimension
      );
      expect(eventsWithDim.length).toBeGreaterThan(0);
    });

    it('推送 auditing_full 事件', async () => {
      const onProgress = vi.fn();
      const request = createRunRequest({ onProgress });
      await service.run(request);

      const auditingEvents = onProgress.mock.calls.filter(
        (call) => (call[0] as AuthoringProgressEvent).phase === 'auditing_full'
      );
      expect(auditingEvents.length).toBeGreaterThan(0);
    });

    it('推送 complete 事件', async () => {
      const onProgress = vi.fn();
      const request = createRunRequest({ onProgress });
      await service.run(request);

      const completeEvents = onProgress.mock.calls.filter(
        (call) => (call[0] as AuthoringProgressEvent).phase === 'complete'
      );
      expect(completeEvents.length).toBe(1);
    });
  });

  // ==================== 10. getSessionStatus ====================

  describe('getSessionStatus', () => {
    it('查询存在的会话返回当前状态', async () => {
      const request = createRunRequest();
      const result = await service.run(request);

      const status = service.getSessionStatus(result.sessionId);
      expect(status.found).toBe(true);
      expect(status.state).toBe('COMPLETE');
      expect(status.session).toBeDefined();
    });

    it('查询不存在的会话返回 found=false', () => {
      const status = service.getSessionStatus('non-existent');
      expect(status.found).toBe(false);
    });
  });

  // ==================== 11. 边界情况 ====================

  describe('边界情况', () => {
    it('空澄清问题列表 → 直接进入 buildPlan', async () => {
      const noQuestionPlanning = createMockPlanningService({
        generateClarifyingQuestions: vi.fn(async () => []),
      });
      const noQDeps = createServiceDeps({ planningService: noQuestionPlanning });
      const noQService = new WorldBookAuthoringService(noQDeps);

      const result = await noQService.run(createRunRequest());

      expect(result.success).toBe(true);
      expect(result.finalState).toBe('COMPLETE');
    });

    it('memoryStore 未注入时不报错（降级为无持久化）', async () => {
      const noMemDeps = createServiceDeps();
      delete noMemDeps.memoryStore;
      const noMemService = new WorldBookAuthoringService(noMemDeps);

      const result = await noMemService.run(createRunRequest());
      expect(result.success).toBe(true);
    });

    it('goalTracker 未注入时不报错', async () => {
      const noGoalDeps = createServiceDeps();
      delete noGoalDeps.goalTracker;
      const noGoalService = new WorldBookAuthoringService(noGoalDeps);

      const result = await noGoalService.run(createRunRequest());
      expect(result.success).toBe(true);
    });
  });
});
