/**
 * WorldBookPlanningService —— 世界书编写智能体规划服务
 *
 * 来源：spec §二 Task 3 / `implement-worldbook-authoring-agent`
 * 决策：自研（spec §三）。世界书规划是本项目特有业务，复用现有 AIService 调用底座，
 *       借鉴 openclaw 任务驱动行为模型与多轮对话上下文管理。
 *
 * 职责（spec §ADDED Requirements 智能体自驱扩展能力）：
 *  1. analyzePrompt(userPrompt)        — LLM 分析用户初始提示，识别设定维度，标注来源
 *  2. generateClarifyingQuestions(...) — 基于模糊点生成 2-4 个结构化澄清问题
 *  3. buildPlan(...)                   — 综合用户回答生成 AuthoringPlan
 *  4. expandDimensions(plan)           — 自驱扩展缺失但必要的维度
 *
 * 设计约束（对齐 `worldbookAuditService.ts` 与 `learning/dreamingService.ts` 模式）：
 *  - 接口契约：严格实现 `IPlanningServices`（worldbookAuthoringTypes.ts）
 *  - LLM 调用：通过 `LLMCallFn` 注入点抽象，便于测试 mock；
 *              默认实现使用 `AIService.callChatAPI`（非流式，规划是结构化 JSON 任务）
 *  - JSON 解析：`parseJsonLoose` 容忍 markdown 代码块包裹与前后噪声文本
 *  - 降级处理：LLM 失败时返回基础维度/通用问题/默认计划，绝不抛错中断主流程
 *  - 日志前缀：[WorldBookPlanningService]
 *
 * LLM 提示词策略说明：
 *  spec §二 Task 3.1 提到"复用 integrate-worldbook-ai-prompts 的 world-book.generate-new-entries
 *  提示词模板"，但该模板语义为"生成指定数量的世界书条目"（输出 entries JSON），
 *  与规划阶段"分析提示→识别维度→生成澄清问题"的语义不匹配。因此本服务采用
 *  规划专用的内联 system prompt（仍属于 world-book 模块语义），保证 LLM 输出
 *  符合本服务定义的 schema。后续若需统一提示词管理，可抽取为
 *  `world-book.analyze-prompt` / `world-book.clarifying-questions` 模板。
 */

import { AIService, aiService as defaultAiService, type ChatMessage } from '../../AIService';
import { toAgentError } from '../infra/errors';
import type {
  AuthoringDimension,
  AuthoringDimensionCategory,
  AuthoringDimensionSource,
  AuthoringPlan,
  ClarifyingQuestion,
  KeywordStrategy,
} from '../../../../shared/types/worldbook-authoring.types';
import type { IPlanningServices } from './worldbookAuthoringTypes';

// ==================== 日志前缀 ====================

const LOG_PREFIX = '[WorldBookPlanningService]';

// ==================== LLM 调用注入点 ====================

/**
 * LLM 调用函数类型（注入点，便于测试 mock）。
 *
 * 入参：systemPrompt + userPrompt（与 AIService.callChatAPI 的 messages 结构对齐）
 * 出参：LLM 返回的纯文本内容（调用方负责 JSON 解析）
 *
 * 默认实现 `createDefaultLLMCallFn(aiService)` 使用 AIService.callChatAPI（非流式）。
 * 测试中传入 mock 函数即可隔离真实 LLM 依赖。
 */
export type LLMCallFn = (systemPrompt: string, userPrompt: string) => Promise<string>;

/**
 * LLM 调用配置（透传给 AIService.callChatAPI 的运行时参数）。
 *
 * 字段对齐 `WorldBookAuthoringLLMConfig`，但本服务仅使用 model/temperature/maxTokens
 * 三项核心参数（baseUrl/apiKey 由 AIService 内部从全局配置读取，无需重复传入）。
 */
export interface PlanningLLMConfig {
  /** 模型名称（必填，由调用方从 WorldBookAuthoringConfig.llmConfig.model 传入） */
  model: string;
  /** 采样温度（默认 0.3，规划任务需要确定性输出，温度偏低） */
  temperature?: number;
  /** 最大输出 tokens（默认 2048，规划输出为短 JSON） */
  maxTokens?: number;
}

/**
 * 创建默认 LLM 调用函数（基于 AIService.callChatAPI 非流式调用）。
 *
 * 设计理由：规划阶段是结构化 JSON 任务，输出短且需要完整 JSON 解析，
 * 非流式比流式更合适（避免 SSE 分片带来的 JSON 拼接复杂度）。
 */
export function createDefaultLLMCallFn(
  aiService: AIService = defaultAiService,
  config?: PlanningLLMConfig
): LLMCallFn {
  return async (systemPrompt: string, userPrompt: string): Promise<string> => {
    const messages: ChatMessage[] = [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt },
    ];

    const model = config?.model ?? (await aiService.getModelName('gpt-4o-mini'));
    // 从引擎配置获取参数（与非 Agent 路径一致），config 可覆盖
    const aiConfig = await aiService.getConfig();
    const temperature = config?.temperature ?? aiConfig.temperature ?? 0.3;
    const maxTokens = config?.maxTokens ?? aiConfig.maxTokens ?? 4096;

    return aiService.callChatAPI(messages, {
      model,
      temperature,
      maxTokens,
      // 复用引擎配置的温度/token上限作为兜底，避免传入值超出后端限制
      timeoutMs: 60_000,
      maxRetries: 2,
    });
  };
}

// ==================== 工具函数 ====================

/**
 * 宽松 JSON 解析（容忍 markdown 代码块包裹与前后噪声文本）。
 *
 * LLM 经常输出：
 *  - 纯 JSON：`{"key":"value"}`
 *  - markdown 代码块：```json\n{"key":"value"}\n```
 *  - 带前后噪声：`好的，以下是结果：\n```json\n{...}\n```\n希望对你有帮助`
 *
 * 本函数依次尝试：
 *  1. 去除 markdown 代码块包裹（```json ... ``` 或 ``` ... ```）
 *  2. 截取首个 `{` 到最后一个 `}` 之间的子串
 *  3. 直接 JSON.parse
 *
 * 全部失败时返回 null（调用方负责降级处理）。
 */
export function parseJsonLoose<T = unknown>(raw: string): T | null {
  if (!raw || typeof raw !== 'string') return null;

  // Step 1: 去除 markdown 代码块包裹
  // 匹配 ```json\n...\n``` 或 ```\n...\n```（DOTALL 模式，跨行匹配）
  const codeBlockMatch = raw.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  const candidate1 = codeBlockMatch ? codeBlockMatch[1] : raw;

  // Step 2: 尝试直接解析（已是纯 JSON 的情况）
  try {
    return JSON.parse(candidate1) as T;
  } catch {
    // 继续尝试截取子串
  }

  // Step 3: 截取首个 { 到最后一个 } 之间的子串
  const firstBrace = candidate1.indexOf('{');
  const lastBrace = candidate1.lastIndexOf('}');
  if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
    const candidate2 = candidate1.slice(firstBrace, lastBrace + 1);
    try {
      return JSON.parse(candidate2) as T;
    } catch {
      // 解析失败，返回 null
    }
  }

  // Step 4: 尝试解析数组（部分 LLM 可能返回 [...] 而非 {...}）
  const firstBracket = candidate1.indexOf('[');
  const lastBracket = candidate1.lastIndexOf(']');
  if (firstBracket !== -1 && lastBracket !== -1 && lastBracket > firstBracket) {
    const candidate3 = candidate1.slice(firstBracket, lastBracket + 1);
    try {
      return JSON.parse(candidate3) as T;
    } catch {
      // 解析失败，返回 null
    }
  }

  return null;
}

/**
 * 生成维度唯一 ID。
 *
 * 格式：`dim_${category}_${Date.now()}_${randomId}`
 *  - category 前缀便于日志中快速识别维度类型
 *  - Date.now + randomId 保证跨会话唯一性
 */
export function generateDimensionId(category: AuthoringDimensionCategory): string {
  const randomId = Math.random().toString(36).slice(2, 8);
  return `dim_${category}_${Date.now()}_${randomId}`;
}

/**
 * 推断默认关键词策略（dimension 未显式指定 keywordStrategy 时使用）。
 *
 * 默认采用 hybrid 模式（抽取 + 生成混合），与 worldbookTools.generateKeywords
 * 的默认行为对齐。
 */
export function inferDefaultKeywordStrategy(): KeywordStrategy {
  return {
    mode: 'hybrid',
    keywordsPerEntry: 5,
    primaryRatio: 0.6,
    enableSemanticExpansion: true,
  };
}

/**
 * 校验是否为合法的维度分类（防御性编程，LLM 可能返回未知枚举值）。
 */
function isValidCategory(value: unknown): value is AuthoringDimensionCategory {
  return (
    typeof value === 'string' &&
    [
      'worldview',
      'faction',
      'character',
      'location',
      'item',
      'event',
      'rule',
      'other',
    ].includes(value)
  );
}

/**
 * 校验是否为合法的维度来源。
 */
function isValidSource(value: unknown): value is AuthoringDimensionSource {
  return value === 'user' || value === 'agent-suggested';
}

// ==================== 降级常量 ====================

/**
 * LLM 失败时的基础维度清单（spec §二 Task 3.1 降级要求 4 个基础维度）。
 *
 * 全部标 source='agent-suggested'，因为 LLM 无法判断用户意图，
 * 保守地交由后续 expandDimensions / 用户回答补充。
 *
 * 注：spec §二 Task 3.1 明确要求"世界观/人物/地点/规则 4 个"，不在此处追加更多。
 */
const FALLBACK_DIMENSIONS: Array<{
  name: string;
  category: AuthoringDimensionCategory;
  description: string;
}> = [
  {
    name: '世界观背景',
    category: 'worldview',
    description: '世界的整体背景设定，包括时代、地理、历史与宇宙法则',
  },
  {
    name: '关键人物',
    category: 'character',
    description: '故事中的主要角色与次要角色，包括身份、关系与动机',
  },
  {
    name: '核心地点',
    category: 'location',
    description: '故事发生的关键场景、城市与建筑',
  },
  {
    name: '世界规则',
    category: 'rule',
    description: '世界的运行法则，包括物理/魔法/社会制度等',
  },
];

/**
 * 维度补充候选清单（用于 ensureMinimumDimensions 启发式保障）。
 *
 * spec §二 Task 3.1 启发式要求"至少识别 5 个维度（世界观/势力/人物/地点/规则是基础五大类）"。
 * 本清单包含全部 5 个基础分类 + 2 个扩展分类（item/event），用于在 LLM 返回维度不足 5 个时
 * 按 category 去重补充，保证满足"至少 5 个维度"的硬约束。
 *
 * 与 FALLBACK_DIMENSIONS 的区别：
 *  - FALLBACK_DIMENSIONS：LLM 完全失败时使用（spec 限定 4 个）
 *  - SUPPLEMENT_CANDIDATES：LLM 返回不足 5 个时按需补充（覆盖 5+ 个分类）
 */
const SUPPLEMENT_CANDIDATES: Array<{
  name: string;
  category: AuthoringDimensionCategory;
  description: string;
}> = [
  ...FALLBACK_DIMENSIONS,
  {
    name: '核心势力',
    category: 'faction',
    description: '故事中的主要势力、组织与派系，包括其目标与相互关系',
  },
  {
    name: '关键事件',
    category: 'event',
    description: '推动剧情的关键历史事件与故事事件',
  },
];

/**
 * LLM 失败时的通用澄清问题（spec §二 Task 3.2 降级要求 2 个通用问题）。
 */
const FALLBACK_QUESTIONS: Array<{ question: string; why: string; options?: string[] }> = [
  {
    question: '故事发生的时代背景是什么？',
    why: '时代影响科技水平、社会结构与人物行为的可能性边界',
    options: ['古代（冷兵器/农耕社会）', '近代（工业革命/热兵器）', '现代（信息时代/全球化）', '未来（科幻/赛博朋克）'],
  },
  {
    question: '故事的主要冲突类型是什么？',
    why: '冲突类型决定需要重点展开的维度（如势力/人物/事件）',
    options: ['人vs人（势力/角色对立）', '人vs社会（体制/阶级对抗）', '人vs自然/超自然（生存/探险）', '内部冲突（自我成长/救赎）'],
  },
];

// ==================== 服务实现 ====================

/**
 * 世界书规划服务。
 *
 * 实现 `IPlanningServices` 接口的 4 个方法。无状态（每次调用独立），
 * 可作为单例使用（导出 `worldbookPlanningService`）。
 */
export class WorldBookPlanningService implements IPlanningServices {
  private readonly llmCallFn: LLMCallFn;

  constructor(
    /** LLM 调用函数（必填，测试中传入 mock） */
    llmCallFn?: LLMCallFn,
    /** AIService 实例（用于默认 llmCallFn，仅当 llmCallFn 未传入时使用） */
    aiService?: AIService,
    /** LLM 配置（用于默认 llmCallFn） */
    config?: PlanningLLMConfig
  ) {
    if (llmCallFn) {
      this.llmCallFn = llmCallFn;
    } else {
      this.llmCallFn = createDefaultLLMCallFn(aiService ?? defaultAiService, config);
    }
  }

  // ==================== SubTask 3.1: analyzePrompt ====================

  /**
   * 分析用户初始提示（spec §二 Task 3.1 / §ADDED Requirements 主动扩展内容维度）。
   *
   * LLM 分析初始提示，识别设定维度（世界观/势力/人物/地点/物品/事件/规则），
   * 标注用户明确提及 vs 智能体建议补充。
   *
   * 维度识别启发式（spec）：
   *  - 至少识别 5 个维度（世界观/势力/人物/地点/规则是基础）
   *  - 用户提示中未提及但必要的（如"侦探小说"未提"犯罪组织"）标 agent-suggested
   *
   * LLM 失败降级：返回基础维度清单（4 个，全标 agent-suggested）+ warn 日志。
   */
  async analyzePrompt(userPrompt: string, researchContext?: string): Promise<{
    dimensions: Array<{
      name: string;
      category: AuthoringDimensionCategory;
      source: 'user' | 'agent-suggested';
      description?: string;
    }>;
    themeSummary: string;
    ambiguities: string[];
  }> {
    if (!userPrompt || !userPrompt.trim()) {
      // 空提示直接降级（无需调用 LLM）
      console.warn(`${LOG_PREFIX} analyzePrompt: 用户提示为空，返回降级维度清单`);
      return this.fallbackAnalyzePrompt('');
    }

    // Spec: add-agent-web-search-tool — 若提供 researchContext，注入系统提示词作为参考资料
    // 未提供时（undefined / 空串）行为与原实现完全一致（向后兼容）
    const systemPrompt = researchContext && researchContext.trim()
      ? `${ANALYZE_PROMPT_SYSTEM}\n\n【参考资料（来自网络搜索，供参考但不必逐字沿用）】\n${researchContext.trim()}`
      : ANALYZE_PROMPT_SYSTEM;
    const userPromptContent = ANALYZE_PROMPT_USER_TEMPLATE.replace(
      '{{USER_PROMPT}}',
      userPrompt
    );

    let rawResponse: string;
    try {
      rawResponse = await this.llmCallFn(systemPrompt, userPromptContent);
    } catch (err) {
      const agentErr = toAgentError(err, 'analyzePrompt LLM call failed');
      console.warn(
        `${LOG_PREFIX} analyzePrompt: LLM 调用失败（${agentErr.category}），返回降级维度清单`,
        agentErr.message
      );
      return this.fallbackAnalyzePrompt(userPrompt);
    }

    const parsed = parseJsonLoose<AnalyzePromptLLMResponse>(rawResponse);
    if (!parsed || !Array.isArray(parsed.dimensions) || parsed.dimensions.length === 0) {
      console.warn(
        `${LOG_PREFIX} analyzePrompt: LLM 返回内容无法解析为有效 JSON，返回降级维度清单。原始响应前 200 字符:`,
        rawResponse.slice(0, 200)
      );
      return this.fallbackAnalyzePrompt(userPrompt);
    }

    // 过滤无效维度 + 规范化字段
    const dimensions: Array<{
      name: string;
      category: AuthoringDimensionCategory;
      source: 'user' | 'agent-suggested';
      description?: string;
    }> = [];
    for (const raw of parsed.dimensions) {
      if (!raw || typeof raw !== 'object') continue;
      const name = typeof raw.name === 'string' ? raw.name.trim() : '';
      if (!name) continue;
      const category = isValidCategory(raw.category) ? raw.category : 'other';
      const source = isValidSource(raw.source) ? raw.source : 'agent-suggested';
      const description =
        typeof raw.description === 'string' && raw.description.trim()
          ? raw.description.trim()
          : undefined;
      dimensions.push({ name, category, source, description });
    }

    if (dimensions.length === 0) {
      console.warn(
        `${LOG_PREFIX} analyzePrompt: LLM 返回维度全部无效，返回降级维度清单`
      );
      return this.fallbackAnalyzePrompt(userPrompt);
    }

    // 启发式保障：至少 5 个维度（spec §二 Task 3.1）
    // 若 LLM 识别不足 5 个，补充 agent-suggested 基础维度（去重）
    const ensured = this.ensureMinimumDimensions(dimensions, 5);

    const themeSummary =
      typeof parsed.themeSummary === 'string' && parsed.themeSummary.trim()
        ? parsed.themeSummary.trim()
        : userPrompt.slice(0, 80);

    const ambiguities = Array.isArray(parsed.ambiguities)
      ? parsed.ambiguities
          .filter((a: unknown): a is string => typeof a === 'string' && a.trim().length > 0)
          .map((a: string) => a.trim())
          .slice(0, 6)
      : [];

    return { dimensions: ensured, themeSummary, ambiguities };
  }

  /**
   * 确保维度清单至少包含 N 个维度（不足时补充基础维度，去重）。
   *
   * 用于满足 spec §二 Task 3.1 "至少识别 5 个维度" 的启发式要求。
   * 补充的维度标 source='agent-suggested'，避免误标为用户明确要求。
   *
   * 候选清单见 SUPPLEMENT_CANDIDATES（覆盖 6 个分类），按 category 去重补充。
   */
  private ensureMinimumDimensions(
    dimensions: Array<{
      name: string;
      category: AuthoringDimensionCategory;
      source: 'user' | 'agent-suggested';
      description?: string;
    }>,
    minCount: number
  ): typeof dimensions {
    if (dimensions.length >= minCount) return dimensions;

    const existingCategories = new Set(dimensions.map((d) => d.category));
    const result = [...dimensions];

    for (const candidate of SUPPLEMENT_CANDIDATES) {
      if (result.length >= minCount) break;
      if (existingCategories.has(candidate.category)) continue;
      result.push({
        name: candidate.name,
        category: candidate.category,
        source: 'agent-suggested',
        description: candidate.description,
      });
      existingCategories.add(candidate.category);
    }

    return result;
  }

  /**
   * analyzePrompt 降级：返回基础维度清单（4 个，全标 agent-suggested）。
   */
  private fallbackAnalyzePrompt(userPrompt: string): {
    dimensions: Array<{
      name: string;
      category: AuthoringDimensionCategory;
      source: 'user' | 'agent-suggested';
      description?: string;
    }>;
    themeSummary: string;
    ambiguities: string[];
  } {
    return {
      dimensions: FALLBACK_DIMENSIONS.map((d) => ({
        name: d.name,
        category: d.category,
        source: 'agent-suggested' as const,
        description: d.description,
      })),
      themeSummary: userPrompt.trim() ? userPrompt.slice(0, 80) : '未识别主题',
      ambiguities: ['用户提示信息不足，需要进一步澄清'],
    };
  }

  // ==================== SubTask 3.2: generateClarifyingQuestions ====================

  /**
   * 生成澄清问题（spec §二 Task 3.2 / §ADDED Requirements 主动提出澄清问题）。
   *
   * 基于提示分析中的模糊点，生成 2-4 个结构化澄清问题，每问题附"为什么需要"说明。
   *
   * 策略：
   *  - 优先针对 agent-suggested 维度提问（让用户确认是否需要）
   *  - 避免提问用户已明确的内容
   *  - 问题数量约束在 2-4 个（spec 硬要求）
   *
   * LLM 失败降级：返回 2 个通用问题 + warn。
   */
  async generateClarifyingQuestions(promptAnalysis: {
    dimensions: Array<{
      name: string;
      category: AuthoringDimensionCategory;
      source: 'user' | 'agent-suggested';
      description?: string;
    }>;
    themeSummary: string;
    ambiguities: string[];
  }): Promise<Array<{ id: string; question: string; why: string; options?: string[] }>> {
    if (!promptAnalysis || !Array.isArray(promptAnalysis.dimensions)) {
      console.warn(
        `${LOG_PREFIX} generateClarifyingQuestions: promptAnalysis 无效，返回降级问题`
      );
      return this.fallbackClarifyingQuestions();
    }

    const dimensionsContext = promptAnalysis.dimensions
      .map(
        (d) =>
          `- ${d.name} [category=${d.category}, source=${d.source}]${
            d.description ? `：${d.description}` : ''
          }`
      )
      .join('\n');

    const ambiguitiesContext =
      promptAnalysis.ambiguities && promptAnalysis.ambiguities.length > 0
        ? promptAnalysis.ambiguities.map((a) => `- ${a}`).join('\n')
        : '（无明显模糊点，请基于维度清单生成针对性问题）';

    const systemPrompt = CLARIFY_PROMPT_SYSTEM;
    const userPromptContent = CLARIFY_PROMPT_USER_TEMPLATE.replace(
      '{{THEME_SUMMARY}}',
      promptAnalysis.themeSummary || '未提供主题摘要'
    )
      .replace('{{DIMENSIONS_CONTEXT}}', dimensionsContext)
      .replace('{{AMBIGUITIES_CONTEXT}}', ambiguitiesContext);

    let rawResponse: string;
    try {
      rawResponse = await this.llmCallFn(systemPrompt, userPromptContent);
    } catch (err) {
      const agentErr = toAgentError(err, 'generateClarifyingQuestions LLM call failed');
      console.warn(
        `${LOG_PREFIX} generateClarifyingQuestions: LLM 调用失败（${agentErr.category}），返回降级问题`,
        agentErr.message
      );
      return this.fallbackClarifyingQuestions();
    }

    const parsed = parseJsonLoose<{ questions?: Array<{ question?: string; why?: string; options?: string[] }> }>(
      rawResponse
    );
    if (!parsed || !Array.isArray(parsed.questions) || parsed.questions.length === 0) {
      console.warn(
        `${LOG_PREFIX} generateClarifyingQuestions: LLM 返回内容无法解析为有效 JSON，返回降级问题。原始响应前 200 字符:`,
        rawResponse.slice(0, 200)
      );
      return this.fallbackClarifyingQuestions();
    }

    // 过滤无效问题 + 生成 ID + 数量约束（2-4）
    const questions: Array<{ id: string; question: string; why: string; options?: string[] }> = [];
    for (let i = 0; i < parsed.questions.length && questions.length < 4; i++) {
      const q = parsed.questions[i];
      if (!q || typeof q !== 'object') continue;
      const question = typeof q.question === 'string' ? q.question.trim() : '';
      if (!question) continue;
      const why =
        typeof q.why === 'string' && q.why.trim()
          ? q.why.trim()
          : '该信息有助于细化世界书设定';
      const options = Array.isArray(q.options)
        ? q.options.filter((o): o is string => typeof o === 'string' && o.trim()).map((o) => o.trim())
        : [];
      questions.push({
        id: `q_${Date.now()}_${i}_${Math.random().toString(36).slice(2, 6)}`,
        question,
        why,
        ...(options.length > 0 ? { options } : {}),
      });
    }

    // 数量下限保障：若 LLM 返回不足 2 个，补充通用问题
    if (questions.length < 2) {
      const fallback = this.fallbackClarifyingQuestions();
      for (const q of fallback) {
        if (questions.length >= 2) break;
        // 避免重复（按 question 文本去重）
        if (!questions.some((existing) => existing.question === q.question)) {
          questions.push(q);
        }
      }
    }

    return questions.slice(0, 4);
  }

  /**
   * generateClarifyingQuestions 降级：返回 2 个通用问题。
   */
  private fallbackClarifyingQuestions(): Array<{ id: string; question: string; why: string; options?: string[] }> {
    return FALLBACK_QUESTIONS.map((q, i) => ({
      id: `q_fallback_${i}_${Math.random().toString(36).slice(2, 6)}`,
      question: q.question,
      why: q.why,
      ...(q.options ? { options: q.options } : {}),
    }));
  }

  // ==================== SubTask 3.3: buildPlan ====================

  /**
   * 构建编写计划（spec §二 Task 3.3 / §ADDED Requirements 用户初始提示触发规划阶段）。
   *
   * 综合用户初始提示、澄清问题回答、提示分析，生成 AuthoringPlan：
   *  - goal.theme = userPrompt
   *  - goal.dimensions = promptAnalysis.dimensions（根据 answers 调整）
   *  - goal.targetTotalEntries = sum(dimensions.targetEntryCount)
   *  - goal.qualityThreshold = 0.8（默认，spec §设计理念 §6 auditThreshold）
   *  - clarifyingQuestions = answers（保留用户回答或 skipped 标记）
   *  - userAnswers = answers.filter(!skipped).map(...).join('\n')
   *
   * 跳过的问题：由智能体推断默认值，在维度 reason 中标注"智能体推断"。
   *
   * 注：本方法不调用 LLM（纯本地综合逻辑），无降级需求。
   */
  async buildPlan(
    userPrompt: string,
    answers: Array<{
      questionId: string;
      question: string;
      answer?: string;
      skipped: boolean;
    }>,
    promptAnalysis: {
      dimensions: Array<{
        name: string;
        category: AuthoringDimensionCategory;
        source: 'user' | 'agent-suggested';
        description?: string;
      }>;
      themeSummary: string;
      ambiguities: string[];
    }
  ): Promise<AuthoringPlan> {
    // 1. 将 promptAnalysis.dimensions 转换为完整 AuthoringDimension[]
    //    （补充 id / targetEntryCount / keywordStrategy）
    const dimensions: AuthoringDimension[] = promptAnalysis.dimensions.map((d) => {
      const id = generateDimensionId(d.category);
      // 默认每维度 3 个条目（spec §二 Task 3 brief 默认值，受 maxEntriesPerDimension 钳位）
      const targetEntryCount = 3;
      return {
        id,
        name: d.name,
        category: d.category,
        targetEntryCount,
        source: d.source,
        keywordStrategy: inferDefaultKeywordStrategy(),
        description: d.description,
        generatedEntryUids: [],
      };
    });

    // 2. 根据用户回答调整维度（targetEntryCount / 移除跳过的 agent-suggested 维度）
    const adjustedDimensions = this.adjustDimensionsByAnswers(dimensions, answers);

    // 3. 构建 clarifyingQuestions（保留用户回答或 skipped 标记 + 智能体推断默认值）
    const clarifyingQuestions: ClarifyingQuestion[] = answers.map((a) => {
      const inferredDefault = a.skipped
        ? this.inferDefaultForQuestion(a.question)
        : undefined;
      return {
        id: a.questionId,
        question: a.question,
        // why 字段在 generateClarifyingQuestions 阶段产生，此处由调用方传入或留空
        why: '', // 调用方在编排层会合并原始 ClarifyingQuestion
        answer: a.answer,
        skipped: a.skipped,
        inferredDefault,
      };
    });

    // 4. 构建 userAnswers（仅含未跳过的回答 + 跳过时的智能体推断默认值）
    const userAnswers = clarifyingQuestions.map((q) => ({
      questionId: q.id,
      answer: q.skipped ? q.inferredDefault ?? '（智能体未推断出默认值）' : q.answer ?? '',
      inferred: q.skipped,
    }));

    // 5. 计算总目标条目数
    const targetTotalEntries = adjustedDimensions.reduce(
      (sum, d) => sum + d.targetEntryCount,
      0
    );

    // 6. 组装 AuthoringPlan
    const plan: AuthoringPlan = {
      goal: {
        theme: userPrompt,
        dimensions: adjustedDimensions,
        targetTotalEntries,
        qualityThreshold: 0.8, // 默认质量门槛，对齐 spec §设计理念 §6
      },
      clarifyingQuestions,
      userAnswers,
      createdAt: Date.now(),
    };

    return plan;
  }

  /**
   * 根据用户回答调整维度清单。
   *
   * 调整规则（spec §二 Task 3.3）：
   *  - 用户跳过的 agent-suggested 维度：降低 targetEntryCount（从 3 降到 1）或移除
   *    （此处采用降级到 1 的策略，保留维度但减少条目，避免完全丢失设定可能性）
   *  - 用户回答扩展维度细节：在维度 description 中追加用户回答摘要
   *  - 用户明确跳过的维度：在 description 中标注"智能体推断"
   *
   * 注：当前实现采用保守策略（降级而非移除），因为完全移除可能丢失完整性。
   * expandDimensions 阶段会进一步补全缺失的必要维度。
   */
  private adjustDimensionsByAnswers(
    dimensions: AuthoringDimension[],
    answers: Array<{
      questionId: string;
      question: string;
      answer?: string;
      skipped: boolean;
    }>
  ): AuthoringDimension[] {
    if (!answers || answers.length === 0) return dimensions;

    // 收集所有用户回答文本，用于在维度 description 中追加细节
    const answeredText = answers
      .filter((a) => !a.skipped && a.answer)
      .map((a) => `${a.question}: ${a.answer}`)
      .join('；');

    // 收集跳过的问题（用于标注"智能体推断"）
    const skippedQuestions = answers.filter((a) => a.skipped);

    return dimensions.map((d) => {
      const adjusted: AuthoringDimension = { ...d };

      // 对 agent-suggested 维度，若用户跳过了相关问题，降低 targetEntryCount
      if (d.source === 'agent-suggested' && skippedQuestions.length > 0) {
        // 启发式：若任一跳过的问题文本包含该维度名称或 category 关键词，降低其条目数
        const relatedSkipped = skippedQuestions.some(
          (q) =>
            q.question.includes(d.name) ||
            q.question.includes(d.category) ||
            (d.description && q.question.includes(d.description.slice(0, 4)))
        );
        if (relatedSkipped) {
          adjusted.targetEntryCount = Math.max(1, d.targetEntryCount - 2);
          adjusted.description = `${
            d.description ?? ''
          }（用户跳过相关问题，由智能体推断默认值，目标条目数降级为 ${adjusted.targetEntryCount}）`.trim();
        }
      }

      // 在 description 中追加用户回答摘要（仅对未跳过的回答）
      if (answeredText && !adjusted.description?.includes(answeredText)) {
        adjusted.description = adjusted.description
          ? `${adjusted.description}｜用户补充：${answeredText}`
          : `用户补充：${answeredText}`;
      }

      return adjusted;
    });
  }

  /**
   * 为跳过的问题推断默认值（spec §二 Task 3.3）。
   *
   * 采用关键词启发式：根据问题中的关键词映射到合理默认值。
   * 无法推断时返回 undefined（调用方在 userAnswers 中以占位文本兜底）。
   */
  private inferDefaultForQuestion(question: string): string | undefined {
    if (!question) return undefined;
    const lower = question.toLowerCase();

    if (lower.includes('时代') || lower.includes('年代') || lower.includes('时间')) {
      return '近未来（智能体推断）';
    }
    if (lower.includes('冲突') || lower.includes('矛盾')) {
      return '势力对抗（智能体推断）';
    }
    if (lower.includes('主角') || lower.includes('角色')) {
      return '中型势力边缘人物（智能体推断）';
    }
    if (lower.includes('地点') || lower.includes('场景') || lower.includes('城市')) {
      return '主要都市（智能体推断）';
    }
    if (lower.includes('科技') || lower.includes('魔法')) {
      return '中等发达科技/低魔设定（智能体推断）';
    }
    if (lower.includes('势力') || lower.includes('组织')) {
      return '存在 2-3 个对立势力（智能体推断）';
    }

    return undefined;
  }

  // ==================== SubTask 3.4: expandDimensions ====================

  /**
   * 自驱扩展维度（spec §二 Task 3.4 / §ADDED Requirements 主动扩展内容维度）。
   *
   * 识别 plan 中缺失但对世界书完整性必要的维度，追加到 plan 并标注"智能体建议"。
   *
   * 启发式规则（spec §二 Task 3.4）：
   *  - 若 plan 无 'character' 维度，追加"关键人物"维度
   *  - 若 plan 无 'location' 维度，追加"核心地点"维度
   *  - 若 plan 无 'rule' 维度，追加"世界规则"维度
   *  - 每个追加维度标 source='agent-suggested' + reason="智能体建议补充以保证世界书完整性"
   *  - 避免重复：若 plan 已有同 category 维度则不追加
   *
   * 注：本方法不调用 LLM（纯启发式规则），无降级需求。
   * 不修改原 plan 的 user 维度（隔离原则，spec §二 Task 3.4）。
   */
  async expandDimensions(plan: AuthoringPlan): Promise<AuthoringPlan> {
    if (!plan || !plan.goal || !Array.isArray(plan.goal.dimensions)) {
      return plan;
    }

    // 收集已有维度的 category 集合
    const existingCategories = new Set(
      plan.goal.dimensions.map((d) => d.category)
    );

    // 必要维度补充清单（spec §二 Task 3.4 启发式规则）
    const requiredDimensions: Array<{
      name: string;
      category: AuthoringDimensionCategory;
      description: string;
    }> = [
      {
        name: '关键人物',
        category: 'character',
        description: '故事中的主要角色与次要角色，包括身份、关系与动机（智能体建议补充以保证世界书完整性）',
      },
      {
        name: '核心地点',
        category: 'location',
        description: '故事发生的关键场景、城市与建筑（智能体建议补充以保证世界书完整性）',
      },
      {
        name: '世界规则',
        category: 'rule',
        description: '世界的运行法则，包括物理/魔法/社会制度等（智能体建议补充以保证世界书完整性）',
      },
    ];

    const newDimensions: AuthoringDimension[] = [];
    for (const required of requiredDimensions) {
      // 避免重复：若 plan 已有同 category 维度则不追加
      if (existingCategories.has(required.category)) continue;

      const id = generateDimensionId(required.category);
      newDimensions.push({
        id,
        name: required.name,
        category: required.category,
        targetEntryCount: 3,
        source: 'agent-suggested',
        keywordStrategy: inferDefaultKeywordStrategy(),
        description: required.description,
        generatedEntryUids: [],
      });
      existingCategories.add(required.category);
    }

    if (newDimensions.length === 0) {
      // 无需扩展
      return plan;
    }

    // 组装扩展后的 plan（不修改原 plan 的 user 维度）
    const expandedDimensions = [...plan.goal.dimensions, ...newDimensions];
    const expandedTargetTotalEntries = expandedDimensions.reduce(
      (sum, d) => sum + d.targetEntryCount,
      0
    );

    const expandedPlan: AuthoringPlan = {
      ...plan,
      goal: {
        ...plan.goal,
        dimensions: expandedDimensions,
        targetTotalEntries: expandedTargetTotalEntries,
      },
    };

    return expandedPlan;
  }
}

// ==================== 单例导出 ====================

/**
 * 规划服务单例。
 *
 * 使用默认 LLM 调用函数（基于 AIService.callChatAPI）。
 * 测试中应直接 `new WorldBookPlanningService(mockLLMCallFn)` 创建实例。
 */
export const worldbookPlanningService = new WorldBookPlanningService();

// ==================== LLM 提示词模板（内联） ====================

/**
 * analyzePrompt 系统提示词。
 *
 * 要求 LLM 输出严格 JSON，schema 见 `AnalyzePromptLLMResponse`。
 *
 * 设计要点：
 *  - 强制 JSON-only 输出（与 world-book.generate-new-entries 模板的格式约束一致）
 *  - 明确维度分类枚举与来源枚举，避免 LLM 自创枚举值
 *  - 启发式要求至少 5 个维度
 */
const ANALYZE_PROMPT_SYSTEM = `你是一个世界书（Lorebook）规划分析助手。你的任务是分析用户的初始提示，识别需要覆盖的设定维度，并标注每个维度的来源（用户明确提及 vs 智能体建议补充）。

【输出格式强制要求】
- 你的响应必须且只能是一个合法的 JSON 对象
- 不要输出任何分析、推理、说明、解释文字
- 不要使用任何 Markdown 标记（如反引号代码块等）
- 响应的第一个字符必须是 "{"，最后一个字符必须是 "}"
- 不要包含 "让我..."、"好的..."、"以下是..." 等引导语

【JSON Schema】
{
  "themeSummary": "string，主题摘要（10-30 字，概括用户提示的核心主题）",
  "ambiguities": ["string", ...]，用户提示中的模糊点列表（1-5 个，每个 10-30 字，用于生成澄清问题），
  "dimensions": [
    {
      "name": "string，维度名称（如'地下势力'/'主角团队'/'魔法体系'）",
      "category": "枚举值，必须为以下之一：worldview | faction | character | location | item | event | rule | other",
      "source": "枚举值，必须为以下之一：user | agent-suggested（user=用户提示中明确提及；agent-suggested=智能体建议补充）",
      "description": "string，可选，维度应覆盖的内容描述（10-50 字）"
    }
  ]
}

【维度识别规则】
1. 至少识别 5 个维度（世界观/势力/人物/地点/规则是基础五大类）
2. 用户提示中明确提及的维度标 source="user"（如"赛博朋克侦探小说"提及了世界观=赛博朋克、人物=侦探）
3. 用户未提及但对世界书完整性必要的维度标 source="agent-suggested"（如"侦探小说"未提及"犯罪组织/地下势力"应主动建议）
4. 维度名称要具体、可识别（避免过于泛化如"背景设定"）
5. category 必须从枚举值中选取，无法归类时使用 "other"

【示例】
用户提示："为一部赛博朋克侦探小说创建世界书"
输出：
{
  "themeSummary": "赛博朋克背景下的侦探推理故事",
  "ambiguities": ["故事发生的具体年代", "主角所属势力", "科技与魔法的混合程度"],
  "dimensions": [
    {"name": "赛博朋克世界观", "category": "worldview", "source": "user", "description": "高科技低生活的赛博朋克社会背景"},
    {"name": "侦探主角", "category": "character", "source": "user", "description": "主角侦探的身份、背景与能力"},
    {"name": "地下犯罪组织", "category": "faction", "source": "agent-suggested", "description": "侦探小说必要的对立势力"},
    {"name": "核心都市", "category": "location", "source": "agent-suggested", "description": "故事发生的主要城市与场景"},
    {"name": "科技与义体规则", "category": "rule", "source": "agent-suggested", "description": "义体改造、网络入侵等技术规则"},
    {"name": "关键案件事件", "category": "event", "source": "agent-suggested", "description": "推动剧情的关键案件与事件"}
  ]
}

开始分析，只输出 JSON：`;

/**
 * analyzePrompt 用户提示词模板。
 *
 * 占位符 {{USER_PROMPT}} 由调用方替换为用户原始提示。
 */
const ANALYZE_PROMPT_USER_TEMPLATE = `用户初始提示：
{{USER_PROMPT}}

请分析上述提示，识别需要覆盖的设定维度，并标注每个维度的来源。只输出 JSON。`;

/**
 * generateClarifyingQuestions 系统提示词。
 *
 * 要求 LLM 输出 2-4 个结构化澄清问题，每问题附 why 说明。
 */
const CLARIFY_PROMPT_SYSTEM = `你是一个世界书规划澄清问题生成助手。基于已识别的维度与模糊点，生成 2-4 个结构化澄清问题，每问题附"为什么需要这个信息"的说明。

【输出格式强制要求】
- 你的响应必须且只能是一个合法的 JSON 对象
- 不要输出任何分析、推理、说明、解释文字
- 不要使用任何 Markdown 标记
- 响应的第一个字符必须是 "{"，最后一个字符必须是 "}"

【JSON Schema】
{
  "questions": [
    {
      "question": "string，问题内容（10-30 字，如'故事发生在哪个年代？'）",
      "why": "string，为什么需要这个信息（10-40 字，如'年代影响科技水平与社会结构设定'）",
      "options": ["string", "string", "string"]
    }
  ]
}

【问题生成规则】
1. 生成 2-4 个问题（不要少于 2 个，不要多于 4 个）
2. 优先针对 source="agent-suggested" 的维度提问（让用户确认是否需要这些维度）
3. 针对模糊点（ambiguities）提问，避免提问用户已明确的内容
4. 每个问题必须附 why 说明，解释为什么需要这个信息
5. 问题要具体、可回答（避免过于宽泛如"请描述你的世界"）
6. 避免重复或语义相近的问题
7. 每个问题必须附带至少 3 个预设选项（options 数组），选项应为具体的、可直接选择的答案（如"古代/近代/现代/未来"），不要输出模糊的选项

【示例】
输入维度：地下犯罪组织[agent-suggested]、核心都市[agent-suggested]、科技与义体规则[agent-suggested]
模糊点：故事发生的具体年代、主角所属势力
输出：
{
  "questions": [
    {"question": "故事发生在哪个年代？", "why": "年代影响科技水平与社会结构设定", "options": ["古代（冷兵器时代）", "近代（工业革命时期）", "现代（信息时代）", "未来（赛博朋克）"]},
    {"question": "主角属于哪个势力？", "why": "决定主角的立场与对立面，影响势力维度的展开方向", "options": ["执法方/官方势力", "地下组织/犯罪集团", "中立/自由职业者"]},
    {"question": "是否需要详细展开地下犯罪组织？", "why": "agent-suggested 维度，需用户确认是否纳入", "options": ["详细展开（多层级组织结构）", "简要提及（仅关键人物）", "不需要"]}
  ]
}

开始生成，只输出 JSON：`;

/**
 * generateClarifyingQuestions 用户提示词模板。
 *
 * 占位符：
 *  - {{THEME_SUMMARY}}：主题摘要
 *  - {{DIMENSIONS_CONTEXT}}：维度清单上下文（含 name/category/source/description）
 *  - {{AMBIGUITIES_CONTEXT}}：模糊点列表上下文
 */
const CLARIFY_PROMPT_USER_TEMPLATE = `主题摘要：{{THEME_SUMMARY}}

已识别维度清单：
{{DIMENSIONS_CONTEXT}}

模糊点：
{{AMBIGUITIES_CONTEXT}}

请基于以上信息生成 2-4 个澄清问题。只输出 JSON。`;

// ==================== LLM 响应类型 ====================

/**
 * analyzePrompt LLM 响应 schema（用于 parseJsonLoose 的类型参数）。
 */
interface AnalyzePromptLLMResponse {
  themeSummary?: string;
  ambiguities?: unknown[];
  dimensions?: Array<{
    name?: unknown;
    category?: unknown;
    source?: unknown;
    description?: unknown;
  }>;
}
