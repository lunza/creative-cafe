/**
 * ContentProtectionPlugin — 通用内容长度保护检查插件
 *
 * Spec: redesign-dialogue-pipeline-architecture / PostProcessingPipeline
 * Spec: fix-think-strip-content-protection
 *
 * 在所有其他插件执行完毕后，检查内容长度是否异常缩短。
 * 比较原始内容长度与处理后内容长度，计算预期剥离量（来自所有已检测意图的 rawMatch），
 * 若实际缩短量 > 预期剥离量 × 1.2（20% 容差），记录警告日志。
 *
 * 【重点标记】此插件解决原 onComplete 中的内容保护硬编码问题：
 * 原逻辑使用 thinkTagsStripped / optionsStripped / emotionStripped 等标志位
 * 逐个跳过检查，新增插件需同步修改标志位。现改为自动计算预期剥离量，
 * 无需硬编码任何标志位。
 *
 * 注意：本插件不修改内容，仅检查并记录日志。
 */

import type { PostProcessPlugin, DialoguePipelineContext } from '../pipeline.types';
import { AIIntentRecognizer } from '../AIIntentRecognizer';

/**
 * 内容保护容差比例 — 实际缩短量允许超过预期剥离量的 20%。
 *
 * 超过此比例时视为异常内容丢失，记录警告。
 */
const PROTECTION_TOLERANCE = 0.2;

export class ContentProtectionPlugin implements PostProcessPlugin {
  readonly name = 'ContentProtectionPlugin';
  readonly priority = 600;

  /** AIIntentRecognizer 实例，用于计算预期剥离量 */
  private readonly recognizer: AIIntentRecognizer;

  constructor() {
    this.recognizer = new AIIntentRecognizer();
  }

  /**
   * 始终返回 true — 在所有其他插件处理完毕后执行检查。
   *
   * @returns true
   */
  detect(_content: string, _context: DialoguePipelineContext): boolean {
    return true;
  }

  /**
   * 检查内容长度是否异常缩短。
   *
   * 算法：
   * 1. 原始内容长度 = context.rawResponse.length
   * 2. 处理后内容长度 = content.length
   * 3. 实际缩短量 = 原始长度 - 处理后长度
   * 4. 预期剥离量 = 对原始内容调用 AIIntentRecognizer.detect，
   *    累加所有意图的 rawMatch.length
   * 5. 若实际缩短量 > 预期剥离量 × (1 + 容差)，记录警告
   *
   * 本方法不修改内容，直接返回原始 content。
   *
   * @param content 当前内容（经所有前序插件处理后的内容）
   * @param context 管线上下文
   * @returns 原始 content（不修改）
   */
  process(content: string, context: DialoguePipelineContext): string {
    const rawLength = context.rawResponse?.length ?? 0;
    const processedLength = content.length;

    // 原始内容为空或处理后内容更长（折叠模式可能增加内容），无需检查
    if (rawLength === 0 || processedLength >= rawLength) {
      return content;
    }

    const actualReduction = rawLength - processedLength;

    // 对原始内容调用 AIIntentRecognizer.detect，计算预期剥离量
    const intents = this.recognizer.detect(context.rawResponse);
    const expectedReduction = intents.reduce(
      (sum, intent) => sum + (intent.rawMatch?.length ?? 0),
      0,
    );

    // 计算容差上限：预期剥离量 × (1 + 20%)
    const allowedReduction = expectedReduction * (1 + PROTECTION_TOLERANCE);

    if (actualReduction > allowedReduction) {
      // 内容异常缩短，记录警告
      const warningMsg =
        `内容保护警告：实际缩短 ${actualReduction} 字符，` +
        `预期剥离 ${expectedReduction} 字符（容差 ${PROTECTION_TOLERANCE * 100}%），` +
        `原始 ${rawLength} → 处理后 ${processedLength}。` +
        `可能存在未识别的内容丢失。`;

      context.logs.push({
        level: 'warn',
        stage: this.name,
        timestamp: Date.now(),
        message: warningMsg,
        data: {
          rawLength,
          processedLength,
          actualReduction,
          expectedReduction,
          allowedReduction,
          intentCount: intents.length,
        },
      });
    }

    // 不修改内容，仅检查
    return content;
  }
}
