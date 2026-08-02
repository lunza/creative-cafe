/**
 * 用户意图识别 —— 适配 openclaw 意图驱动技能推荐
 *
 * 来源：参考 openclaw 用户意图识别机制
 * 决策：自研（openclaw 依赖 LLM 意图分类，本项目首期使用关键词规则匹配，延迟 < 10ms）
 *
 * 职责：
 *  1. 定义意图类型（DIALOGUE/WRITE/QUERY/ACTION/HELP）
 *  2. 关键词规则匹配，识别用户消息意图
 *  3. 根据意图推荐相关技能（动态调整技能可用性）
 *  4. 生成意图注入 prompt 文本
 */

// ==================== 意图类型 ====================

/**
 * 用户意图类型。
 *
 * - DIALOGUE: 日常对话/闲聊（默认）
 * - WRITE: 写作/续写/改写
 * - QUERY: 查询/搜索/查找
 * - ACTION: 操作/整理/排序/更新
 * - HELP: 求助/如何/怎么
 */
export type IntentType = 'DIALOGUE' | 'WRITE' | 'QUERY' | 'ACTION' | 'HELP';

/**
 * 意图识别结果。
 */
export interface IntentResult {
  /** 识别到的意图类型 */
  intent: IntentType;
  /** 匹配到的关键词（用于调试/日志） */
  matchedKeywords: string[];
  /** 置信度（0-1，匹配关键词数量越多越高） */
  confidence: number;
}

// ==================== 关键词规则 ====================

/**
 * 意图关键词规则表。
 *
 * 每个意图对应一组关键词，消息中包含任一关键词即匹配该意图。
 * 匹配优先级：WRITE > QUERY > ACTION > HELP > DIALOGUE（默认）。
 */
const INTENT_KEYWORD_RULES: Record<Exclude<IntentType, 'DIALOGUE'>, string[]> = {
  WRITE: [
    '写一段', '写一个', '写一篇', '续写', '改写', '润色', '扩写', '缩写',
    '创作', '编写', '起草', '撰写', '描写', '叙述', '改编',
    '生成文章', '生成故事', '生成段落', '生成章节',
  ],
  QUERY: [
    '查一下', '查询', '搜索', '查找', '找一下', '找找',
    '什么是', '解释一下', '介绍一下', '了解',
    '还记得', '记不记得', '之前说过',
  ],
  ACTION: [
    '整理', '排序', '更新', '修改', '删除', '添加',
    '保存', '导出', '导入', '备份', '恢复',
    '设置', '配置', '调整', '切换',
  ],
  HELP: [
    '怎么', '如何', '怎样', '帮助', '帮忙',
    '不会', '不懂', '不明白', '不清楚',
    '可以吗', '能行吗', '行不行',
  ],
};

/**
 * 意图 → 推荐技能名映射。
 *
 * 根据识别到的意图，推荐相关技能（用于动态调整技能可用性）。
 * 实际技能名需与 SKILL.md 中定义的 name 字段一致。
 */
const INTENT_SKILL_RECOMMENDATIONS: Record<IntentType, string[]> = {
  DIALOGUE: [],
  WRITE: ['chapter-write', 'description-polish', 'plot-check'],
  QUERY: ['memory-search', 'knowledge-query'],
  ACTION: ['memory-organize', 'table-update'],
  HELP: [],
};

// ==================== 意图识别 ====================

/**
 * 识别用户消息的意图。
 *
 * 纯关键词匹配，延迟 < 10ms。
 * 匹配优先级：WRITE > QUERY > ACTION > HELP > DIALOGUE（默认）。
 *
 * @param message 用户消息文本
 * @returns 意图识别结果（未识别时默认为 DIALOGUE）
 */
export function recognizeIntent(message: string): IntentResult {
  if (!message || !message.trim()) {
    return { intent: 'DIALOGUE', matchedKeywords: [], confidence: 0 };
  }

  const text = message.toLowerCase();
  const intentOrder: Array<Exclude<IntentType, 'DIALOGUE'>> = ['WRITE', 'QUERY', 'ACTION', 'HELP'];

  for (const intent of intentOrder) {
    const keywords = INTENT_KEYWORD_RULES[intent];
    const matched: string[] = [];

    for (const keyword of keywords) {
      if (text.includes(keyword.toLowerCase())) {
        matched.push(keyword);
      }
    }

    if (matched.length > 0) {
      // 置信度：匹配关键词数量 / 该意图关键词总数，上限 1.0
      const confidence = Math.min(matched.length / Math.max(keywords.length * 0.3, 1), 1.0);
      return { intent, matchedKeywords: matched, confidence };
    }
  }

  // 未匹配任何关键词，默认为 DIALOGUE
  return { intent: 'DIALOGUE', matchedKeywords: [], confidence: 0 };
}

// ==================== 技能推荐 ====================

/**
 * 根据意图获取推荐技能名列表。
 *
 * 用于动态调整技能可用性：将推荐技能优先展示给用户/模型。
 *
 * @param intent 识别到的意图
 * @returns 推荐技能名列表（空数组表示无推荐）
 */
export function getIntentSkillRecommendations(intent: IntentType): string[] {
  return INTENT_SKILL_RECOMMENDATIONS[intent] ?? [];
}

// ==================== Prompt 注入 ====================

/**
 * 生成意图注入 prompt 文本。
 *
 * 格式：`[用户意图: {intent}]`
 * 仅在非 DIALOGUE 意图时生成（DIALOGUE 为默认，无需注入）。
 *
 * @param result 意图识别结果
 * @returns prompt 文本（DIALOGUE 意图返回空字符串）
 */
export function buildIntentPrompt(result: IntentResult): string {
  if (result.intent === 'DIALOGUE') {
    return '';
  }

  const intentDescriptions: Record<Exclude<IntentType, 'DIALOGUE'>, string> = {
    WRITE: '写作/创作',
    QUERY: '查询/搜索',
    ACTION: '操作/整理',
    HELP: '求助/指导',
  };

  const description = intentDescriptions[result.intent] || result.intent;
  return `\n\n[用户意图: ${result.intent}（${description}）置信度: ${(result.confidence * 100).toFixed(0)}%]`;
}
