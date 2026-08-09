/**
 * ImageGenPlugin — 图片生成请求后处理插件（预留）
 *
 * Spec: redesign-dialogue-pipeline-architecture / PostProcessingPipeline
 * Spec: 图片生成接入接口（预留）
 *
 * 检测 AI 响应中的图片生成请求标签
 * （<<<GENERATE_IMAGE>>>prompt<<<END_IMAGE>>>），
 * 解析生成请求写入 context.imageGenRequests，并从内容中剥离标签。
 *
 * 本插件仅负责解析和存储请求，不实际生成图片。
 * 实际的图片生成由 LogicEngine 的 ImageGenTask 完成（未来实现）。
 */

import type { PostProcessPlugin, DialoguePipelineContext, DetectedIntent, ImageGenRequest } from '../pipeline.types';
import { AIIntentRecognizer } from '../AIIntentRecognizer';

export class ImageGenPlugin implements PostProcessPlugin {
  readonly name = 'ImageGenPlugin';
  readonly priority = 500;

  /** AIIntentRecognizer 实例，用于检测 image_generation 意图 */
  private readonly recognizer: AIIntentRecognizer;

  constructor() {
    this.recognizer = new AIIntentRecognizer();
  }

  /**
   * 检测内容中是否包含图片生成请求标签。
   * 使用 AIIntentRecognizer 检测 'image_generation' 类型的意图。
   *
   * @param content 当前内容
   * @returns 包含图片生成标签时返回 true
   */
  detect(content: string, _context: DialoguePipelineContext): boolean {
    if (!content) return false;
    const intents = this.recognizer.detect(content);
    return intents.some((i) => i.type === 'image_generation');
  }

  /**
   * 提取图片生成请求并剥离标签。
   *
   * - 从检测到的 image_generation 意图中提取生成提示词
   * - 构造 ImageGenRequest 写入 context.imageGenRequests
   * - 使用 AIIntentRecognizer.stripIntents 剥离图片生成标签
   *
   * 注意：本方法仅解析和存储请求，不实际调用图片生成 API。
   *
   * @param content 当前内容
   * @param context 管线上下文
   * @returns 剥离图片生成标签后的内容
   */
  process(content: string, context: DialoguePipelineContext): string {
    const intents = this.recognizer.detect(content);
    const imageGenIntents: DetectedIntent[] = intents.filter(
      (i) => i.type === 'image_generation',
    );

    if (imageGenIntents.length === 0) {
      return content;
    }

    // 将每个意图转换为 ImageGenRequest
    const requests: ImageGenRequest[] = imageGenIntents.map((intent) => {
      const data = intent.data as { prompt: string };
      return {
        prompt: data.prompt,
        // 默认上下文为 inline（行内生成）
        context: 'inline' as const,
      };
    });

    context.imageGenRequests = requests;

    // 剥离图片生成标签
    const result = this.recognizer.stripIntents(content, imageGenIntents);

    context.logs.push({
      level: 'info',
      stage: this.name,
      timestamp: Date.now(),
      message: `检测到 ${requests.length} 个图片生成请求（预留功能，未实际生成）`,
    });

    return result;
  }
}
