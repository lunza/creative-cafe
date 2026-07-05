/**
 * 文本相似度与重叠率计算工具
 *
 * Spec: optimize-chat-ai-intelligence / Task 5.1
 * 借鉴 SillyTavern 防重复机制，为重试/续写去重提供应用层算法。
 *
 * 设计要点：
 * - 字符级 n-gram（中文友好，无需空格分词）
 * - Jaccard 相似度 = |A ∩ B| / |A ∪ B|
 * - 性能要求（spec Scenario: 去重计算性能）：500 字文本对 < 50ms
 *   实现使用 Set 与单次遍历，500 字文本约生成 497 个 4-gram，
 *   Jaccard 计算为 O(min(|A|, |B|))，实测远低于 50ms 阈值。
 */

/**
 * 默认 n-gram 长度。
 *
 * Spec 约定 n=4：对中文文本，4 字符粒度能较好平衡"敏感度"与"抗噪声"——
 * 太短（n=1/2）会将常见汉字组合误判为相似，太长（n=8+）则对小幅改写过度敏感。
 */
const DEFAULT_N = 4;

/**
 * 提取文本的字符级 n-gram 集合。
 *
 * 字符级而非词级，因中文无空格分词；使用 Set 自动去重以计算 Jaccard。
 * 文本会先做轻量标准化（去除首尾空白），避免边缘空白干扰。
 *
 * 短文本（长度 < n）作为一个完整 gram 返回，覆盖短回复场景。
 *
 * @param text 原始文本
 * @param n n-gram 长度（默认 4）
 * @returns n-gram 字符串集合
 */
function extractNGrams(text: string, n: number = DEFAULT_N): Set<string> {
  if (!text) return new Set<string>();
  const normalized = text.trim();
  if (normalized.length === 0) return new Set<string>();
  if (normalized.length < n) {
    // 短文本直接作为一个 gram（覆盖短回复场景）
    return new Set<string>([normalized]);
  }
  const grams = new Set<string>();
  for (let i = 0; i <= normalized.length - n; i++) {
    grams.add(normalized.slice(i, i + n));
  }
  return grams;
}

/**
 * 计算两个文本的 n-gram Jaccard 相似度。
 *
 * Jaccard 相似度 = |A ∩ B| / |A ∪ B|
 *
 * Spec: optimize-chat-ai-intelligence / Task 5.1
 * 用于重试去重：与上一条 assistant 回复相似度 > 0.8 时自动重新生成。
 *
 * 边界处理：
 * - 两空文本：约定返回 1.0（两空集视为相同，避免空回复触发无意义重试）
 * - 其中一为空：返回 0.0（无交集）
 * - 优化：在较小集合上迭代以降低交集计算成本
 *
 * @param textA 文本 A
 * @param textB 文本 B
 * @param n n-gram 长度（默认 4，spec 约定）
 * @returns 0-1 之间的相似度
 *   - 1.0：n-gram 集合完全相同
 *   - 0.0：无任何公共 n-gram
 */
export function nGramJaccard(textA: string, textB: string, n: number = DEFAULT_N): number {
  const setA = extractNGrams(textA, n);
  const setB = extractNGrams(textB, n);

  // 两个空集的并集为空，约定返回 1.0（两空文本视为相同）
  if (setA.size === 0 && setB.size === 0) return 1.0;
  // 其中一个为空，无交集
  if (setA.size === 0 || setB.size === 0) return 0.0;

  // 在较小集合上迭代以计算交集（性能优化）
  const [smaller, larger] = setA.size <= setB.size ? [setA, setB] : [setB, setA];
  let intersection = 0;
  for (const gram of smaller) {
    if (larger.has(gram)) intersection++;
  }

  const union = setA.size + setB.size - intersection;
  return union === 0 ? 0 : intersection / union;
}

/**
 * 计算新内容前缀包含 initialContent 的比例（重叠率）。
 *
 * Spec: optimize-chat-ai-intelligence / Task 5.3
 * 用于续写场景：检测 AI 是否原样重写已有内容（而非添加新内容）。
 *
 * 算法：找 initialContent 与 newContent 的最长公共前缀长度，
 *      除以 initialContent 长度。
 *
 * 含义：
 *   - 若 newContent 以完整 initialContent 开头（理想续写：AI 返回 initialContent + 新内容）
 *     → 重叠率 = 1.0（但此场景下"新内容"应为 initialContent 之后的部分，
 *       调用方应先剥离 initialContent 前缀再传入 newContent）
 *   - 若 newContent 开头与 initialContent 完全不匹配 → 重叠率 = 0
 *   - 若 newContent 前缀部分匹配 initialContent → 0-1 之间的比例
 *
 * 调用约定（续写去重场景）：
 *   调用方应传入"AI 实际生成的部分"（已剥离 initialContent 前缀）作为 newContent，
 *   传入"续写前的原始内容"作为 initialContent。
 *   若 AI 原样重写 initialContent，则剥离前 newContent = initialContent + 新内容，
 *   剥离后 newContent' = 新内容；若新内容仍以 initialContent 开头 → 高重叠率。
 *
 * @param newContent 新内容（建议为剥离 initialContent 前缀后的 AI 实际生成部分）
 * @param initialContent 续写时的初始内容
 * @returns 0-1 之间的重叠率
 */
export function overlapRate(newContent: string, initialContent: string): number {
  if (!initialContent || initialContent.length === 0) return 0;
  if (!newContent) return 0;

  // 找最长公共前缀
  const minLen = Math.min(newContent.length, initialContent.length);
  let commonPrefix = 0;
  for (let i = 0; i < minLen; i++) {
    if (newContent[i] === initialContent[i]) {
      commonPrefix++;
    } else {
      break;
    }
  }

  return commonPrefix / initialContent.length;
}

// ==================== 去重决策（Spec: optimize-chat-ai-intelligence / Task 5.2 + 5.3） ====================

/**
 * 默认去重参数（与 hooks.ts 保持一致）。
 *
 * 这些常量同步导出供测试与未来调参使用；hooks.ts 内部也定义了同名常量，
 * 两处需保持一致（如修改需同步更新）。
 */
export const DEDUP_SIMILARITY_THRESHOLD = 0.8;
export const DEDUP_OVERLAP_THRESHOLD = 0.6;
export const DEDUP_MAX_RETRIES = 2;

/**
 * 去重检测类型。
 * - 'retry'：重试去重（nGramJaccard 与上一条 assistant 回复比较）
 * - 'continue'：续写去重（overlapRate 与 initialContent 比较）
 * - 'none'：未触发去重（无需重试）
 */
export type DedupKind = 'retry' | 'continue' | 'none';

/**
 * 去重决策结果。
 *
 * 由 `evaluateDedupRetry` 纯函数计算，供 hooks.ts::requestAIResponse onComplete
 * 与单元测试共用，确保决策逻辑可独立验证。
 */
export interface DedupDecision {
  /** 是否应当重新生成 */
  shouldRetry: boolean;
  /** 触发的去重类型 */
  kind: DedupKind;
  /** 计算得到的指标值（similarity 或 overlap，0-1） */
  metric: number;
  /** 是否已重试耗尽（shouldRetry=false 但指标超阈值） */
  exhausted: boolean;
  /** 决策原因描述（用于日志） */
  reason: string;
}

/**
 * 评估是否应当触发去重重试。
 *
 * Spec: optimize-chat-ai-intelligence / Task 5.2 + 5.3
 * 纯函数封装 hooks.ts::onComplete 中的去重决策逻辑，便于单元测试。
 *
 * 决策规则：
 * 1. 若提供 previousResponse（重试场景）：计算 nGramJaccard(previousResponse, newContent)
 *    - > similarityThreshold 且 retryCount < maxRetries → shouldRetry=true, kind='retry'
 *    - > similarityThreshold 且 retryCount >= maxRetries → exhausted=true, 保留最后结果
 * 2. 若未提供 previousResponse 但 promptType='continuation' 且有 initialContent（续写场景）：
 *    剥离 newContent 的 initialContent 前缀，计算 overlapRate(newPart, initialContent)
 *    - > overlapThreshold 且 retryCount < maxRetries → shouldRetry=true, kind='continue'
 *    - > overlapThreshold 且 retryCount >= maxRetries → exhausted=true
 * 3. 否则 → kind='none', shouldRetry=false
 *
 * @param params.previousResponse 重试去重比较基准（上一条 assistant 回复）
 * @param params.newContent 新生成的内容（已剥离 tableEdit 标签的显示内容）
 * @param params.initialContent 续写时的初始内容（用于 overlapRate 计算）
 * @param params.promptType 提示词类型（'dialogue' / 'continuation'）
 * @param params.retryCount 当前重试次数（0 = 首次）
 * @param params.maxRetries 最大重试次数（默认 2）
 * @param params.similarityThreshold 相似度阈值（默认 0.8）
 * @param params.overlapThreshold 重叠率阈值（默认 0.6）
 */
export function evaluateDedupRetry(params: {
  previousResponse?: string;
  newContent: string;
  initialContent?: string;
  promptType: 'dialogue' | 'continuation';
  retryCount: number;
  maxRetries?: number;
  similarityThreshold?: number;
  overlapThreshold?: number;
}): DedupDecision {
  const {
    previousResponse,
    newContent,
    initialContent,
    promptType,
    retryCount,
  } = params;
  const maxRetries = params.maxRetries ?? DEDUP_MAX_RETRIES;
  const similarityThreshold = params.similarityThreshold ?? DEDUP_SIMILARITY_THRESHOLD;
  const overlapThreshold = params.overlapThreshold ?? DEDUP_OVERLAP_THRESHOLD;

  // 重试去重：previousResponse 提供时优先走此分支
  if (previousResponse && newContent) {
    const similarity = nGramJaccard(previousResponse, newContent, 4);
    if (similarity > similarityThreshold) {
      if (retryCount < maxRetries) {
        return {
          shouldRetry: true,
          kind: 'retry',
          metric: similarity,
          exhausted: false,
          reason: `similarity=${similarity.toFixed(2)}`,
        };
      }
      return {
        shouldRetry: false,
        kind: 'retry',
        metric: similarity,
        exhausted: true,
        reason: `similarity=${similarity.toFixed(2)} (exhausted after ${retryCount + 1} attempts)`,
      };
    }
    return {
      shouldRetry: false,
      kind: 'none',
      metric: similarity,
      exhausted: false,
      reason: `similarity=${similarity.toFixed(2)} (below threshold)`,
    };
  }

  // 续写去重：promptType='continuation' 且有 initialContent
  if (promptType === 'continuation' && initialContent && newContent) {
    const newPart = newContent.startsWith(initialContent)
      ? newContent.slice(initialContent.length)
      : newContent;
    const overlap = overlapRate(newPart, initialContent);
    if (overlap > overlapThreshold) {
      if (retryCount < maxRetries) {
        return {
          shouldRetry: true,
          kind: 'continue',
          metric: overlap,
          exhausted: false,
          reason: `overlap=${overlap.toFixed(2)}`,
        };
      }
      return {
        shouldRetry: false,
        kind: 'continue',
        metric: overlap,
        exhausted: true,
        reason: `overlap=${overlap.toFixed(2)} (exhausted after ${retryCount + 1} attempts)`,
      };
    }
    return {
      shouldRetry: false,
      kind: 'none',
      metric: overlap,
      exhausted: false,
      reason: `overlap=${overlap.toFixed(2)} (below threshold)`,
    };
  }

  // 无去重触发
  return {
    shouldRetry: false,
    kind: 'none',
    metric: 0,
    exhausted: false,
    reason: 'no dedup applicable',
  };
}
