/**
 * 意图识别前置处理模块
 *
 * 在用户输入发送至执行智能体之前，通过轻量级 LLM 调用进行意图识别，
 * 将识别结果注入 systemPrompt，帮助执行智能体更准确地理解用户意图。
 *
 * 设计原则：
 *  - 快速：maxIterations=1, timeoutMs=8000，不阻塞主对话流太久
 *  - 容错：识别失败时静默降级，不阻断正常对话
 *  - 透明：将识别结果以「思考过程」形式展示给用户
 */

/** 意图类型 */
export type IntentType =
  | 'information_query'    // 信息查询
  | 'task_execution'       // 任务执行
  | 'problem_solving'      // 问题解决
  | 'advice_consultation'  // 建议咨询
  | 'creative_writing'     // 创作写作
  | 'casual_chat'          // 日常闲聊
  | 'system_command'       // 系统操作
  | 'code_development'     // 代码开发
  | 'data_analysis'        // 数据分析
  | 'unknown';             // 无法识别

/** 意图识别结果 */
export interface IntentRecognitionResult {
  /** 识别出的意图类型 */
  intentType: IntentType;
  /** 意图类型的中文名称 */
  intentLabel: string;
  /** 用户核心需求的一句话摘要 */
  summary: string;
  /** 智能体是否具备处理该意图的能力 */
  canHandle: boolean;
  /** 推荐的响应策略 */
  strategy: string;
  /** 识别置信度 0-1 */
  confidence: number;
  /** 原始 JSON 文本（调试用） */
  rawJson?: string;
}

/** 意图类型 → 中文标签映射 */
const INTENT_LABELS: Record<IntentType, string> = {
  information_query: '信息查询',
  task_execution: '任务执行',
  problem_solving: '问题解决',
  advice_consultation: '建议咨询',
  creative_writing: '创作写作',
  casual_chat: '日常闲聊',
  system_command: '系统操作',
  code_development: '代码开发',
  data_analysis: '数据分析',
  unknown: '未知意图',
};

/**
 * 构建意图识别的系统提示词。
 *
 * 要求 LLM 以严格 JSON 格式返回，避免解析失败。
 */
function buildIntentRecognitionPrompt(
  userInput: string,
  agentName: string,
  agentDescription: string,
  agentMode: string,
  isSystem: boolean,
): string {
  return `你是一个意图识别分析器。请分析用户的输入，识别其真实意图。

## 当前智能体信息
- 名称：${agentName}
- 描述：${agentDescription}
- 模式：${agentMode}
- 是否系统智能体：${isSystem ? '是' : '否'}

## 意图分类体系
- information_query：查询信息、了解事实、搜索资料
- task_execution：执行具体任务、创建/修改/删除内容
- problem_solving：解决技术问题、调试、排错
- advice_consultation：寻求建议、征求意见、方案咨询
- creative_writing：创作故事、写诗、编写剧本、角色设定
- casual_chat：闲聊、问候、情感交流
- system_command：调用系统功能、管理配置
- code_development：编写/审查/重构代码
- data_analysis：分析数据、统计、可视化

## 用户输入
${userInput}

## 输出要求
请以严格 JSON 格式返回，不要包含任何额外文本、Markdown 标记或代码块标记：
{
  "intentType": "意图类型（上述之一）",
  "summary": "用户核心需求的一句话摘要（中文，≤50字）",
  "canHandle": true或false（当前智能体是否具备处理该意图的能力）,
  "strategy": "推荐的响应策略（中文，≤100字）",
  "confidence": 0.0到1.0的数字
}`;
}

/**
 * 从 LLM 返回的文本中提取 JSON 对象。
 *
 * 处理以下情况：
 *  - 纯 JSON 文本
 *  - 被 ```json ... ``` 包裹的 JSON
 *  - 前后有多余文本的 JSON（提取第一个 { 到最后一个 }）
 */
function extractJson(text: string): string | null {
  const trimmed = text.trim();

  // 情况 1：纯 JSON
  if (trimmed.startsWith('{') && trimmed.endsWith('}')) {
    return trimmed;
  }

  // 情况 2：被 ```json ... ``` 或 ``` ... ``` 包裹
  const codeBlockMatch = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (codeBlockMatch) {
    const inner = codeBlockMatch[1].trim();
    if (inner.startsWith('{') && inner.endsWith('}')) {
      return inner;
    }
  }

  // 情况 3：前后有多余文本，提取第一个 { 到最后一个 }
  const firstBrace = trimmed.indexOf('{');
  const lastBrace = trimmed.lastIndexOf('}');
  if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
    return trimmed.slice(firstBrace, lastBrace + 1);
  }

  return null;
}

/**
 * 解析意图识别结果。
 */
function parseIntentResult(rawJson: string): IntentRecognitionResult | null {
  try {
    const obj = JSON.parse(rawJson);

    // 验证 intentType
    const intentType = obj.intentType as IntentType;
    if (!INTENT_LABELS[intentType]) {
      return null;
    }

    return {
      intentType,
      intentLabel: INTENT_LABELS[intentType],
      summary: String(obj.summary || '').slice(0, 100),
      canHandle: Boolean(obj.canHandle),
      strategy: String(obj.strategy || '').slice(0, 200),
      confidence: typeof obj.confidence === 'number' ? Math.max(0, Math.min(1, obj.confidence)) : 0.5,
      rawJson,
    };
  } catch {
    return null;
  }
}

/**
 * 执行意图识别。
 *
 * 通过 agent.run IPC 调用 LLM，分析用户输入的意图。
 * 失败时返回 null，调用方应静默降级。
 *
 * @param userInput 用户原始输入
 * @param agent 当前智能体配置
 * @param globalSystemPrompt 全局系统提示词
 * @returns 意图识别结果，或 null（识别失败时）
 */
export async function recognizeIntent(
  userInput: string,
  agent: { name: string; description: string; mode: string; isSystem: boolean },
  globalSystemPrompt?: string,
): Promise<IntentRecognitionResult | null> {
  const prompt = buildIntentRecognitionPrompt(
    userInput,
    agent.name,
    agent.description,
    agent.mode,
    agent.isSystem,
  );

  try {
    const result = await window.electronAPI.agent.run({
      systemPrompt: `${globalSystemPrompt ? globalSystemPrompt + '\n\n' : ''}你是一个意图识别分析器。请严格按照 JSON 格式输出分析结果，不要添加任何额外文本。`,
      messages: [{ role: 'user', content: prompt }],
      context: { mode: 'dialogue' },
      maxIterations: 1,
      timeoutMs: 8000,
    });

    if (!result?.success || !result?.result?.content) {
      return null;
    }

    const rawText = result.result.content;
    const jsonStr = extractJson(rawText);
    if (!jsonStr) {
      return null;
    }

    return parseIntentResult(jsonStr);
  } catch {
    return null;
  }
}

/**
 * 将意图识别结果格式化为「思考过程」展示文本。
 */
export function formatIntentThought(intent: IntentRecognitionResult): string {
  const confidencePercent = Math.round(intent.confidence * 100);
  const handleIcon = intent.canHandle ? '✓' : '⚠';
  return `🔍 **意图识别**\n\n` +
    `**意图类型**：${intent.intentLabel}\n` +
    `**核心需求**：${intent.summary}\n` +
    `**响应策略**：${intent.strategy}\n` +
    `**能力匹配**：${handleIcon} ${intent.canHandle ? '可处理' : '可能需要额外信息'}\n` +
    `**置信度**：${confidencePercent}%`;
}

/**
 * 将意图识别结果注入执行智能体的 systemPrompt。
 *
 * 在原始 systemPrompt 后追加一段「用户意图分析」段落，
 * 帮助执行智能体更准确地理解用户需求。
 */
export function injectIntentIntoSystemPrompt(
  systemPrompt: string,
  intent: IntentRecognitionResult,
): string {
  return `${systemPrompt}

## 用户意图分析（前置识别）
- **识别意图**：${intent.intentLabel}
- **核心需求**：${intent.summary}
- **推荐策略**：${intent.strategy}
- **能力匹配**：${intent.canHandle ? '具备处理能力' : '可能需要额外信息或转介'}

请根据以上意图分析，针对性地回应用户需求。如果识别意图与实际不符，以用户实际需求为准。`;
}
