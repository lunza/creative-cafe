/**
 * WorldBookPlanningService 单元测试 —— 对话式规划服务（4 个方法）
 *
 * 来源：spec §二 Task 3 / `implement-worldbook-authoring-agent`
 *
 * 覆盖（spec §二 Task 3 验证要求 ≥12 用例）：
 *  1. analyzePrompt：
 *     - 正常返回维度
 *     - LLM 失败降级（返回 4 个基础维度 + agent-suggested）
 *     - JSON 解析（含 markdown 代码块包裹）
 *     - 至少 5 个维度启发式保障
 *     - 空用户提示降级
 *     - LLM 返回无效 JSON 降级
 *  2. generateClarifyingQuestions：
 *     - 正常生成问题
 *     - LLM 失败降级（2 个通用问题）
 *     - 问题数量约束（2-4，超出截断 / 不足补充）
 *     - markdown 代码块包裹解析
 *  3. buildPlan：
 *     - 综合用户回答生成计划
 *     - 跳过问题推断默认值
 *     - targetEntryCount 调整（agent-suggested 维度相关跳过时降级）
 *  4. expandDimensions：
 *     - 补充缺失维度
 *     - 避免重复（已有同 category 不追加）
 *     - source 标注（agent-suggested）
 *  5. 工具函数：
 *     - parseJsonLoose 各种格式
 *     - generateDimensionId 唯一性
 *     - inferDefaultKeywordStrategy 默认值
 *
 * 测试策略：
 *  - 通过 LLMCallFn 注入点 mock LLM 调用，不依赖真实 LLM
 *  - 每个用例独立构造 service 实例，避免状态污染
 *  - 验证返回值结构 + 关键字段 + 降级行为
 */

import { describe, it, expect, vi } from 'vitest';
import {
  WorldBookPlanningService,
  parseJsonLoose,
  generateDimensionId,
  inferDefaultKeywordStrategy,
  type LLMCallFn,
} from '../worldbookPlanningService';
import type {
  AuthoringPlan,
  AuthoringDimensionCategory,
} from '../../../../../shared/types/worldbook-authoring.types';

// ==================== Mock LLM 工厂 ====================

/**
 * 创建 mock LLM 调用函数。
 *
 * @param responses 预设的 LLM 响应列表（按调用顺序消费，超出后循环或返回最后一个）
 * @param calls 记录调用次数的引用对象（可选，用于断言调用次数）
 */
function createMockLLM(responses: string[], calls?: { count: number }): LLMCallFn {
  let index = 0;
  return vi.fn(async (_systemPrompt: string, _userPrompt: string): Promise<string> => {
    if (calls) calls.count += 1;
    const response = responses[index] ?? responses[responses.length - 1] ?? '';
    index += 1;
    return response;
  });
}

/**
 * 创建总是失败的 mock LLM 调用函数。
 */
function createFailingLLM(error: Error = new Error('LLM boom')): LLMCallFn {
  return vi.fn(async (): Promise<string> => {
    throw error;
  });
}

// ==================== 测试数据 ====================

const VALID_ANALYZE_RESPONSE = JSON.stringify({
  themeSummary: '赛博朋克侦探小说',
  ambiguities: ['故事发生的具体年代', '主角所属势力', '科技水平'],
  dimensions: [
    {
      name: '赛博朋克世界观',
      category: 'worldview',
      source: 'user',
      description: '高科技低生活的赛博朋克社会背景',
    },
    {
      name: '侦探主角',
      category: 'character',
      source: 'user',
      description: '主角侦探的身份背景',
    },
    {
      name: '地下犯罪组织',
      category: 'faction',
      source: 'agent-suggested',
      description: '侦探小说必要的对立势力',
    },
    {
      name: '核心都市',
      category: 'location',
      source: 'agent-suggested',
      description: '故事发生的主要城市',
    },
    {
      name: '科技与义体规则',
      category: 'rule',
      source: 'agent-suggested',
      description: '义体改造、网络入侵等技术规则',
    },
  ],
});

const VALID_ANALYZE_RESPONSE_WITH_MARKDOWN =
  '好的，以下是分析结果：\n```json\n' + VALID_ANALYZE_RESPONSE + '\n```\n希望对你有帮助';

const VALID_CLARIFY_RESPONSE = JSON.stringify({
  questions: [
    {
      question: '故事发生在哪个年代？',
      why: '年代影响科技水平与社会结构设定',
    },
    {
      question: '主角属于哪个势力？',
      why: '决定主角的立场与对立面',
    },
    {
      question: '是否需要详细展开地下犯罪组织？',
      why: 'agent-suggested 维度，需用户确认是否纳入',
    },
  ],
});

const VALID_CLARIFY_RESPONSE_WITH_MARKDOWN =
  '```json\n' + VALID_CLARIFY_RESPONSE + '\n```';

// ==================== 测试套件 ====================

describe('WorldBookPlanningService', () => {
  // ========== 1. analyzePrompt 测试 ==========

  describe('analyzePrompt', () => {
    it('正常返回维度清单与主题摘要', async () => {
      const llm = createMockLLM([VALID_ANALYZE_RESPONSE]);
      const service = new WorldBookPlanningService(llm);

      const result = await service.analyzePrompt('为一部赛博朋克侦探小说创建世界书');

      expect(result.themeSummary).toBe('赛博朋克侦探小说');
      expect(result.ambiguities).toHaveLength(3);
      expect(result.ambiguities[0]).toBe('故事发生的具体年代');
      expect(result.dimensions).toHaveLength(5);
      // 验证维度字段结构
      const worldview = result.dimensions.find((d) => d.category === 'worldview');
      expect(worldview).toBeDefined();
      expect(worldview?.name).toBe('赛博朋克世界观');
      expect(worldview?.source).toBe('user');
      expect(worldview?.description).toContain('赛博朋克');
      // 验证 agent-suggested 标注
      const faction = result.dimensions.find((d) => d.category === 'faction');
      expect(faction?.source).toBe('agent-suggested');
    });

    it('LLM 失败时降级返回 4 个基础维度（全标 agent-suggested）', async () => {
      const llm = createFailingLLM(new Error('网络错误'));
      const service = new WorldBookPlanningService(llm);

      const result = await service.analyzePrompt('一部奇幻小说');

      // 降级：4 个基础维度
      expect(result.dimensions).toHaveLength(4);
      const categories = result.dimensions.map((d) => d.category);
      expect(categories).toEqual(
        expect.arrayContaining(['worldview', 'character', 'location', 'rule'])
      );
      // 全部标 agent-suggested
      expect(result.dimensions.every((d) => d.source === 'agent-suggested')).toBe(true);
      // themeSummary 应为用户提示的前缀（截断）
      expect(result.themeSummary).toContain('奇幻小说');
      // ambiguities 应有降级提示
      expect(result.ambiguities.length).toBeGreaterThan(0);
    });

    it('正确解析带 markdown 代码块包裹的 JSON', async () => {
      const llm = createMockLLM([VALID_ANALYZE_RESPONSE_WITH_MARKDOWN]);
      const service = new WorldBookPlanningService(llm);

      const result = await service.analyzePrompt('赛博朋克侦探小说');

      // 应能正确解析（不应降级）
      expect(result.dimensions).toHaveLength(5);
      expect(result.themeSummary).toBe('赛博朋克侦探小说');
    });

    it('LLM 返回无效 JSON 时降级', async () => {
      const llm = createMockLLM(['这不是 JSON，也无法解析']);
      const service = new WorldBookPlanningService(llm);

      const result = await service.analyzePrompt('某主题');

      // 降级到 4 个基础维度
      expect(result.dimensions).toHaveLength(4);
      expect(result.dimensions.every((d) => d.source === 'agent-suggested')).toBe(true);
    });

    it('LLM 返回少于 5 个维度时通过启发式补充到 5 个', async () => {
      const shortResponse = JSON.stringify({
        themeSummary: '简单主题',
        ambiguities: [],
        dimensions: [
          { name: '世界观', category: 'worldview', source: 'user' },
          { name: '主角', category: 'character', source: 'user' },
        ],
      });
      const llm = createMockLLM([shortResponse]);
      const service = new WorldBookPlanningService(llm);

      const result = await service.analyzePrompt('简单提示');

      // 应补充到至少 5 个
      expect(result.dimensions.length).toBeGreaterThanOrEqual(5);
      // 补充的维度应标 agent-suggested
      const agentSuggested = result.dimensions.filter((d) => d.source === 'agent-suggested');
      expect(agentSuggested.length).toBeGreaterThanOrEqual(3);
      // 不应有重复 category
      const categories = result.dimensions.map((d) => d.category);
      expect(new Set(categories).size).toBe(categories.length);
    });

    it('空用户提示直接降级（不调用 LLM）', async () => {
      const calls = { count: 0 };
      const llm = createMockLLM([VALID_ANALYZE_RESPONSE], calls);
      const service = new WorldBookPlanningService(llm);

      const result = await service.analyzePrompt('');

      // 应降级，不调用 LLM
      expect(calls.count).toBe(0);
      expect(result.dimensions).toHaveLength(4);
      expect(result.themeSummary).toBe('未识别主题');
    });

    it('过滤 LLM 返回的无效维度（缺 name 或非法 category）', async () => {
      const mixedResponse = JSON.stringify({
        themeSummary: '测试',
        ambiguities: [],
        dimensions: [
          { name: '有效维度', category: 'worldview', source: 'user' },
          { name: '', category: 'character', source: 'user' }, // 缺 name，应被过滤
          { name: '非法分类', category: 'invalid_category', source: 'user' }, // 非法 category，规范化为 other
          { category: 'location', source: 'user' }, // 缺 name，应被过滤
        ],
      });
      const llm = createMockLLM([mixedResponse]);
      const service = new WorldBookPlanningService(llm);

      const result = await service.analyzePrompt('测试');

      // 有效维度：2 个（'有效维度' + '非法分类' 被规范化为 other）
      // 但 LLM 只返回 1 个有效 + 1 个规范化为 other = 2 个，会触发启发式补充到 5
      expect(result.dimensions.length).toBeGreaterThanOrEqual(2);
      const validDim = result.dimensions.find((d) => d.name === '有效维度');
      expect(validDim).toBeDefined();
      expect(validDim?.category).toBe('worldview');
      // 非法 category 被规范化为 'other'
      const otherDim = result.dimensions.find((d) => d.name === '非法分类');
      expect(otherDim).toBeDefined();
      expect(otherDim?.category).toBe('other');
    });
  });

  // ========== 2. generateClarifyingQuestions 测试 ==========

  describe('generateClarifyingQuestions', () => {
    const sampleAnalysis = {
      dimensions: [
        { name: '赛博朋克世界观', category: 'worldview' as const, source: 'user' as const },
        {
          name: '地下犯罪组织',
          category: 'faction' as const,
          source: 'agent-suggested' as const,
          description: '侦探小说必要的对立势力',
        },
      ],
      themeSummary: '赛博朋克侦探小说',
      ambiguities: ['故事发生的具体年代', '主角所属势力'],
    };

    it('正常生成 2-4 个澄清问题', async () => {
      const llm = createMockLLM([VALID_CLARIFY_RESPONSE]);
      const service = new WorldBookPlanningService(llm);

      const questions = await service.generateClarifyingQuestions(sampleAnalysis);

      // 3 个问题（在 2-4 范围内）
      expect(questions).toHaveLength(3);
      // 每个问题含 id / question / why
      for (const q of questions) {
        expect(q.id).toBeTruthy();
        expect(q.question).toBeTruthy();
        expect(q.why).toBeTruthy();
      }
      // 验证问题内容
      expect(questions[0].question).toBe('故事发生在哪个年代？');
      expect(questions[0].why).toBe('年代影响科技水平与社会结构设定');
    });

    it('LLM 失败时降级返回 2 个通用问题', async () => {
      const llm = createFailingLLM();
      const service = new WorldBookPlanningService(llm);

      const questions = await service.generateClarifyingQuestions(sampleAnalysis);

      // 降级：2 个通用问题
      expect(questions).toHaveLength(2);
      // 应包含通用问题文本
      const questionTexts = questions.map((q) => q.question);
      expect(questionTexts.some((q) => q.includes('时代'))).toBe(true);
      expect(questionTexts.some((q) => q.includes('冲突'))).toBe(true);
      // 每个问题仍需有 id 和 why
      for (const q of questions) {
        expect(q.id).toBeTruthy();
        expect(q.why).toBeTruthy();
      }
    });

    it('正确解析带 markdown 代码块包裹的 JSON', async () => {
      const llm = createMockLLM([VALID_CLARIFY_RESPONSE_WITH_MARKDOWN]);
      const service = new WorldBookPlanningService(llm);

      const questions = await service.generateClarifyingQuestions(sampleAnalysis);

      expect(questions).toHaveLength(3);
      expect(questions[0].question).toBe('故事发生在哪个年代？');
    });

    it('LLM 返回超过 4 个问题时截断到 4 个', async () => {
      const overflowResponse = JSON.stringify({
        questions: [
          { question: '问题1', why: '原因1' },
          { question: '问题2', why: '原因2' },
          { question: '问题3', why: '原因3' },
          { question: '问题4', why: '原因4' },
          { question: '问题5', why: '原因5' },
          { question: '问题6', why: '原因6' },
        ],
      });
      const llm = createMockLLM([overflowResponse]);
      const service = new WorldBookPlanningService(llm);

      const questions = await service.generateClarifyingQuestions(sampleAnalysis);

      // 截断到 4 个
      expect(questions).toHaveLength(4);
      // 应为前 4 个问题
      expect(questions[0].question).toBe('问题1');
      expect(questions[3].question).toBe('问题4');
    });

    it('LLM 返回不足 2 个问题时补充通用问题', async () => {
      const underflowResponse = JSON.stringify({
        questions: [{ question: '唯一问题', why: '唯一原因' }],
      });
      const llm = createMockLLM([underflowResponse]);
      const service = new WorldBookPlanningService(llm);

      const questions = await service.generateClarifyingQuestions(sampleAnalysis);

      // 应补充到至少 2 个
      expect(questions.length).toBeGreaterThanOrEqual(2);
      // 第一个应为 LLM 返回的问题
      expect(questions[0].question).toBe('唯一问题');
    });

    it('promptAnalysis 无效时降级', async () => {
      const llm = createMockLLM([VALID_CLARIFY_RESPONSE]);
      const service = new WorldBookPlanningService(llm);

      // 传入无效 promptAnalysis
      const questions = await service.generateClarifyingQuestions({} as never);

      expect(questions).toHaveLength(2);
      // 应为通用问题
      const questionTexts = questions.map((q) => q.question);
      expect(questionTexts.some((q) => q.includes('时代'))).toBe(true);
    });
  });

  // ========== 3. buildPlan 测试 ==========

  describe('buildPlan', () => {
    const samplePromptAnalysis = {
      dimensions: [
        {
          name: '赛博朋克世界观',
          category: 'worldview' as AuthoringDimensionCategory,
          source: 'user' as const,
          description: '赛博朋克背景',
        },
        {
          name: '侦探主角',
          category: 'character' as AuthoringDimensionCategory,
          source: 'user' as const,
        },
        {
          name: '地下犯罪组织',
          category: 'faction' as AuthoringDimensionCategory,
          source: 'agent-suggested' as const,
          description: '对立势力',
        },
      ],
      themeSummary: '赛博朋克侦探小说',
      ambiguities: [],
    };

    it('综合用户回答生成 AuthoringPlan', async () => {
      const llm = createMockLLM([]); // buildPlan 不调用 LLM
      const service = new WorldBookPlanningService(llm);

      const answers = [
        {
          questionId: 'q1',
          question: '故事发生在哪个年代？',
          answer: '2077年',
          skipped: false,
        },
        {
          questionId: 'q2',
          question: '主角属于哪个势力？',
          answer: '独立侦探',
          skipped: false,
        },
      ];

      const plan = await service.buildPlan(
        '为一部赛博朋克侦探小说创建世界书',
        answers,
        samplePromptAnalysis
      );

      // goal 字段
      expect(plan.goal.theme).toBe('为一部赛博朋克侦探小说创建世界书');
      expect(plan.goal.dimensions).toHaveLength(3);
      expect(plan.goal.qualityThreshold).toBe(0.8);
      // targetTotalEntries = 3 维度 × 3 = 9
      expect(plan.goal.targetTotalEntries).toBe(9);

      // 每个维度应有 id / keywordStrategy / targetEntryCount
      for (const dim of plan.goal.dimensions) {
        expect(dim.id).toMatch(/^dim_\w+_\d+_\w+$/);
        expect(dim.targetEntryCount).toBe(3);
        expect(dim.keywordStrategy).toBeDefined();
        expect(dim.keywordStrategy?.mode).toBe('hybrid');
        expect(dim.generatedEntryUids).toEqual([]);
      }

      // clarifyingQuestions 应保留用户回答
      expect(plan.clarifyingQuestions).toHaveLength(2);
      expect(plan.clarifyingQuestions[0].id).toBe('q1');
      expect(plan.clarifyingQuestions[0].answer).toBe('2077年');
      expect(plan.clarifyingQuestions[0].skipped).toBe(false);

      // userAnswers 应含用户回答
      expect(plan.userAnswers).toHaveLength(2);
      expect(plan.userAnswers[0].questionId).toBe('q1');
      expect(plan.userAnswers[0].answer).toBe('2077年');
      expect(plan.userAnswers[0].inferred).toBe(false);

      // createdAt 应为有效时间戳
      expect(plan.createdAt).toBeLessThanOrEqual(Date.now());
    });

    it('跳过的问题由智能体推断默认值并标注 inferred=true', async () => {
      const llm = createMockLLM([]);
      const service = new WorldBookPlanningService(llm);

      const answers = [
        {
          questionId: 'q1',
          question: '故事发生在哪个年代？',
          skipped: true, // 用户跳过
        },
        {
          questionId: 'q2',
          question: '主角属于哪个势力？',
          answer: '独立侦探',
          skipped: false,
        },
      ];

      const plan = await service.buildPlan(
        '赛博朋克侦探小说',
        answers,
        samplePromptAnalysis
      );

      // 跳过的问题应标注 inferred=true
      const skippedAnswer = plan.userAnswers.find((a) => a.questionId === 'q1');
      expect(skippedAnswer?.inferred).toBe(true);
      // 应有智能体推断的默认值
      expect(skippedAnswer?.answer).toBeTruthy();
      expect(skippedAnswer?.answer).toContain('智能体推断');

      // 未跳过的问题应保留原回答
      const answered = plan.userAnswers.find((a) => a.questionId === 'q2');
      expect(answered?.inferred).toBe(false);
      expect(answered?.answer).toBe('独立侦探');
    });

    it('agent-suggested 维度相关问题时降低 targetEntryCount', async () => {
      const llm = createMockLLM([]);
      const service = new WorldBookPlanningService(llm);

      // 构造场景：用户跳过"是否需要地下犯罪组织"的问题
      // 该问题文本包含"地下犯罪组织"，应触发 faction 维度的 targetEntryCount 降级
      const answers = [
        {
          questionId: 'q1',
          question: '是否需要详细展开地下犯罪组织？',
          skipped: true, // 用户跳过 → agent-suggested faction 维度应降级
        },
      ];

      const plan = await service.buildPlan('侦探小说', answers, samplePromptAnalysis);

      // faction 维度的 targetEntryCount 应从 3 降级到 1
      const factionDim = plan.goal.dimensions.find((d) => d.category === 'faction');
      expect(factionDim).toBeDefined();
      expect(factionDim?.targetEntryCount).toBeLessThan(3);
      expect(factionDim?.targetEntryCount).toBe(1);
      // description 应标注"智能体推断"
      expect(factionDim?.description).toContain('智能体推断');

      // 其他维度不应降级
      const worldviewDim = plan.goal.dimensions.find((d) => d.category === 'worldview');
      expect(worldviewDim?.targetEntryCount).toBe(3);
    });

    it('空 answers 时正常生成计划（无降级）', async () => {
      const llm = createMockLLM([]);
      const service = new WorldBookPlanningService(llm);

      const plan = await service.buildPlan('某主题', [], samplePromptAnalysis);

      expect(plan.goal.dimensions).toHaveLength(3);
      expect(plan.goal.targetTotalEntries).toBe(9);
      expect(plan.clarifyingQuestions).toHaveLength(0);
      expect(plan.userAnswers).toHaveLength(0);
    });
  });

  // ========== 4. expandDimensions 测试 ==========

  describe('expandDimensions', () => {
    /**
     * 构造测试用 plan（仅含 worldview 一个维度）。
     */
    function makeSparsePlan(): AuthoringPlan {
      return {
        goal: {
          theme: '测试主题',
          dimensions: [
            {
              id: 'dim_worldview_1',
              name: '世界观',
              category: 'worldview',
              targetEntryCount: 3,
              source: 'user',
              keywordStrategy: inferDefaultKeywordStrategy(),
              generatedEntryUids: [],
            },
          ],
          targetTotalEntries: 3,
          qualityThreshold: 0.8,
        },
        clarifyingQuestions: [],
        userAnswers: [],
        createdAt: Date.now(),
      };
    }

    it('补充缺失的 character/location/rule 维度', async () => {
      const service = new WorldBookPlanningService(createMockLLM([]));
      const plan = makeSparsePlan();

      const expanded = await service.expandDimensions(plan);

      // 应补充 character / location / rule 三个维度
      expect(expanded.goal.dimensions).toHaveLength(4);
      const categories = expanded.goal.dimensions.map((d) => d.category);
      expect(categories).toEqual(
        expect.arrayContaining(['worldview', 'character', 'location', 'rule'])
      );
      // targetTotalEntries 应更新（4 × 3 = 12）
      expect(expanded.goal.targetTotalEntries).toBe(12);
    });

    it('已有同 category 维度时不重复追加', async () => {
      const service = new WorldBookPlanningService(createMockLLM([]));
      const plan = makeSparsePlan();
      // 添加 character 维度
      plan.goal.dimensions.push({
        id: 'dim_character_1',
        name: '主角',
        category: 'character',
        targetEntryCount: 2,
        source: 'user',
        keywordStrategy: inferDefaultKeywordStrategy(),
        generatedEntryUids: [],
      });

      const expanded = await service.expandDimensions(plan);

      // character 不应重复，仅补充 location / rule
      const characterDims = expanded.goal.dimensions.filter((d) => d.category === 'character');
      expect(characterDims).toHaveLength(1);
      // 总维度数 = 2（原有）+ 2（补充 location/rule）= 4
      expect(expanded.goal.dimensions).toHaveLength(4);
    });

    it('追加维度标 source=agent-suggested', async () => {
      const service = new WorldBookPlanningService(createMockLLM([]));
      const plan = makeSparsePlan();

      const expanded = await service.expandDimensions(plan);

      // 新增的维度应全部标 agent-suggested
      const newDims = expanded.goal.dimensions.filter((d) => d.id !== 'dim_worldview_1');
      expect(newDims.length).toBe(3);
      for (const dim of newDims) {
        expect(dim.source).toBe('agent-suggested');
        // description 应含"智能体建议补充以保证世界书完整性"
        expect(dim.description).toContain('智能体建议补充以保证世界书完整性');
      }
    });

    it('不修改原 plan 的 user 维度', async () => {
      const service = new WorldBookPlanningService(createMockLLM([]));
      const plan = makeSparsePlan();
      const originalDimCount = plan.goal.dimensions.length;
      const originalUserDim = plan.goal.dimensions[0];

      const expanded = await service.expandDimensions(plan);

      // 原 plan 不应被修改
      expect(plan.goal.dimensions).toHaveLength(originalDimCount);
      expect(plan.goal.dimensions[0]).toBe(originalUserDim);
      // expanded 应是不同对象
      expect(expanded).not.toBe(plan);
      expect(expanded.goal).not.toBe(plan.goal);
      // 但原 user 维度对象应被保留（浅拷贝）
      expect(expanded.goal.dimensions[0]).toBe(originalUserDim);
    });

    it('plan 已含全部必要维度时不扩展', async () => {
      const service = new WorldBookPlanningService(createMockLLM([]));
      const plan = makeSparsePlan();
      // 添加 character / location / rule
      for (const cat of ['character', 'location', 'rule'] as const) {
        plan.goal.dimensions.push({
          id: `dim_${cat}_1`,
          name: cat,
          category: cat,
          targetEntryCount: 3,
          source: 'user',
          keywordStrategy: inferDefaultKeywordStrategy(),
          generatedEntryUids: [],
        });
      }

      const expanded = await service.expandDimensions(plan);

      // 不应有新增维度
      expect(expanded.goal.dimensions).toHaveLength(plan.goal.dimensions.length);
    });

    it('空 plan 或无效 plan 安全返回', async () => {
      const service = new WorldBookPlanningService(createMockLLM([]));

      // 传入无效 plan
      const result1 = await service.expandDimensions({} as AuthoringPlan);
      expect(result1).toEqual({} as AuthoringPlan);

      // 传入空 dimensions 的 plan
      const emptyPlan: AuthoringPlan = {
        goal: {
          theme: 't',
          dimensions: [],
          targetTotalEntries: 0,
          qualityThreshold: 0.8,
        },
        clarifyingQuestions: [],
        userAnswers: [],
        createdAt: Date.now(),
      };
      const result2 = await service.expandDimensions(emptyPlan);
      // 空维度时应补充全部 3 个必要维度
      expect(result2.goal.dimensions).toHaveLength(3);
    });
  });

  // ========== 5. 工具函数测试 ==========

  describe('工具函数', () => {
    describe('parseJsonLoose', () => {
      it('解析纯 JSON', () => {
        const result = parseJsonLoose('{"a":1,"b":"x"}');
        expect(result).toEqual({ a: 1, b: 'x' });
      });

      it('解析 markdown 代码块包裹的 JSON', () => {
        const result = parseJsonLoose('```json\n{"a":1}\n```');
        expect(result).toEqual({ a: 1 });
      });

      it('解析无语言标记的代码块', () => {
        const result = parseJsonLoose('```\n{"a":1}\n```');
        expect(result).toEqual({ a: 1 });
      });

      it('解析带前后噪声文本的 JSON', () => {
        const result = parseJsonLoose('好的，以下是结果：\n{"a":1}\n希望对你有帮助');
        expect(result).toEqual({ a: 1 });
      });

      it('解析代码块 + 前后噪声', () => {
        const result = parseJsonLoose('分析中...\n```json\n{"a":1}\n```\n完成');
        expect(result).toEqual({ a: 1 });
      });

      it('解析 JSON 数组', () => {
        const result = parseJsonLoose('[1,2,3]');
        expect(result).toEqual([1, 2, 3]);
      });

      it('无效输入返回 null', () => {
        expect(parseJsonLoose('')).toBeNull();
        expect(parseJsonLoose('not json at all')).toBeNull();
        expect(parseJsonLoose(null as unknown as string)).toBeNull();
      });

      it('解析嵌套 JSON', () => {
        const result = parseJsonLoose('{"a":{"b":[1,2]}}');
        expect(result).toEqual({ a: { b: [1, 2] } });
      });
    });

    describe('generateDimensionId', () => {
      it('生成符合格式的 ID', () => {
        const id = generateDimensionId('worldview');
        expect(id).toMatch(/^dim_worldview_\d+_[a-z0-9]+$/);
      });

      it('不同调用生成不同 ID（唯一性）', () => {
        const ids = new Set<string>();
        for (let i = 0; i < 100; i++) {
          ids.add(generateDimensionId('character'));
        }
        expect(ids.size).toBe(100);
      });

      it('ID 包含 category 前缀', () => {
        for (const cat of [
          'worldview',
          'faction',
          'character',
          'location',
          'item',
          'event',
          'rule',
          'other',
        ] as AuthoringDimensionCategory[]) {
          const id = generateDimensionId(cat);
          expect(id.startsWith(`dim_${cat}_`)).toBe(true);
        }
      });
    });

    describe('inferDefaultKeywordStrategy', () => {
      it('返回 hybrid 模式的默认策略', () => {
        const strategy = inferDefaultKeywordStrategy();
        expect(strategy.mode).toBe('hybrid');
        expect(strategy.keywordsPerEntry).toBe(5);
        expect(strategy.primaryRatio).toBe(0.6);
        expect(strategy.enableSemanticExpansion).toBe(true);
      });
    });
  });

  // ========== 6. 集成场景测试 ==========

  describe('集成场景', () => {
    it('完整规划流程：analyze → clarify → buildPlan → expand', async () => {
      // 模拟完整流程：LLM 返回分析结果与澄清问题
      const llm = createMockLLM([VALID_ANALYZE_RESPONSE, VALID_CLARIFY_RESPONSE]);
      const service = new WorldBookPlanningService(llm);

      // Step 1: analyzePrompt
      const analysis = await service.analyzePrompt('为一部赛博朋克侦探小说创建世界书');
      expect(analysis.dimensions.length).toBeGreaterThanOrEqual(5);

      // Step 2: generateClarifyingQuestions
      const questions = await service.generateClarifyingQuestions(analysis);
      expect(questions.length).toBeGreaterThanOrEqual(2);

      // Step 3: buildPlan（模拟用户回答）
      const answers = questions.slice(0, 2).map((q, i) => ({
        questionId: q.id,
        question: q.question,
        answer: i === 0 ? '2077年' : '独立侦探',
        skipped: false,
      }));
      const plan = await service.buildPlan('赛博朋克侦探小说', answers, analysis);
      expect(plan.goal.dimensions.length).toBeGreaterThanOrEqual(5);

      // Step 4: expandDimensions（应补充缺失的必要维度）
      const expandedPlan = await service.expandDimensions(plan);
      const expandedCategories = new Set(expandedPlan.goal.dimensions.map((d) => d.category));
      // 至少应包含 character / location / rule（若原 plan 已有则不重复）
      expect(expandedCategories.has('character')).toBe(true);
      expect(expandedCategories.has('location')).toBe(true);
      expect(expandedCategories.has('rule')).toBe(true);
    });

    it('LLM 全程失败时仍能完成降级流程', async () => {
      const llm = createFailingLLM();
      const service = new WorldBookPlanningService(llm);

      // analyzePrompt 降级
      const analysis = await service.analyzePrompt('某主题');
      expect(analysis.dimensions).toHaveLength(4);

      // generateClarifyingQuestions 降级
      const questions = await service.generateClarifyingQuestions(analysis);
      expect(questions).toHaveLength(2);

      // buildPlan 不依赖 LLM，正常生成
      const answers = questions.map((q) => ({
        questionId: q.id,
        question: q.question,
        skipped: true, // 模拟用户全部跳过
      }));
      const plan = await service.buildPlan('某主题', answers, analysis);
      expect(plan.goal.dimensions).toHaveLength(4);

      // expandDimensions 应补充缺失维度（plan 有 worldview/character/location/rule，
      // 缺 faction/item/event，但 expandDimensions 只补 character/location/rule，所以这里不补充）
      const expanded = await service.expandDimensions(plan);
      // 原 4 个维度已包含 character/location/rule，不重复追加
      expect(expanded.goal.dimensions).toHaveLength(4);
    });
  });
});
