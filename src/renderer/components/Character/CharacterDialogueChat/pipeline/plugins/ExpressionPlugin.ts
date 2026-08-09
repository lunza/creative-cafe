/**
 * ExpressionPlugin — 表情情绪标签后处理插件
 *
 * Spec: redesign-dialogue-pipeline-architecture / PostProcessingPipeline
 * Spec: add-character-expression-system
 *
 * 检测 AI 响应中的表情情绪标签（<<<EXPRESSION>>>key<<<END_EXPRESSION>>>），
 * 解析情绪键名写入 context.emotion，并从内容中剥离表情标签。
 *
 * 迁移自 CharacterDialogueChat.hooks.ts::onComplete 中的
 * parseExpressionFromContent 调用与情绪标记剥离逻辑。
 */

import type { PostProcessPlugin, DialoguePipelineContext, DetectedIntent } from '../pipeline.types';
import { AIIntentRecognizer } from '../AIIntentRecognizer';

export class ExpressionPlugin implements PostProcessPlugin {
  readonly name = 'ExpressionPlugin';
  readonly priority = 200;

  /** AIIntentRecognizer 实例，用于检测 expression 意图 */
  private readonly recognizer: AIIntentRecognizer;

  constructor() {
    this.recognizer = new AIIntentRecognizer();
  }

  /**
   * 检测内容中是否包含表情情绪标签。
   * 使用 AIIntentRecognizer 检测 'expression' 类型的意图。
   *
   * @param content 当前内容
   * @returns 包含表情标签时返回 true
   */
  detect(content: string, _context: DialoguePipelineContext): boolean {
    if (!content) return false;
    const intents = this.recognizer.detect(content);
    return intents.some((i) => i.type === 'expression');
  }

  /**
   * 解析情绪键名并剥离表情标签。
   *
   * - 从检测到的 expression 意图中提取 emotion 键名，写入 context.emotion
   * - 使用 AIIntentRecognizer.stripIntents 剥离表情标签
   *
   * @param content 当前内容
   * @param context 管线上下文
   * @returns 剥离表情标签后的内容
   */
  process(content: string, context: DialoguePipelineContext): string {
    const intents = this.recognizer.detect(content);
    const expressionIntents: DetectedIntent[] = intents.filter(
      (i) => i.type === 'expression',
    );

    if (expressionIntents.length === 0) {
      return content;
    }

    // 取置信度最高的意图
    const best = expressionIntents.reduce((a, b) =>
      a.confidence >= b.confidence ? a : b,
    );
    const emotion = (best.data as { emotion: string }).emotion;
    context.emotion = emotion;

    // 剥离表情标签
    const result = this.recognizer.stripIntents(content, expressionIntents);

    context.logs.push({
      level: 'info',
      stage: this.name,
      timestamp: Date.now(),
      message: `解析到情绪键 "${emotion}"（confidence=${best.confidence}），已剥离表情标签`,
    });

    return result;
  }
}
