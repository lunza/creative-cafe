/**
 * SuggestedOptionsPlugin — 辅助模式推荐选项后处理插件
 *
 * Spec: redesign-dialogue-pipeline-architecture / PostProcessingPipeline
 * Spec: add-assist-mode-options
 *
 * 检测 AI 响应中的辅助模式推荐选项标签
 * （<<<SUGGESTED_OPTIONS>>>...<<<END_OPTIONS>>>），
 * 解析选项列表写入 context.suggestedOptions，并从内容中剥离选项标签。
 *
 * 【重点标记】修复：原仅匹配 HTML 注释格式，多数 AI 模型不生成 HTML 注释导致功能失效。
 * 现通过 AIIntentRecognizer + RobustParser 多格式容错匹配解决。
 *
 * 迁移自 CharacterDialogueChat.hooks.ts::onComplete 中的选项解析逻辑。
 */

import type { PostProcessPlugin, DialoguePipelineContext, DetectedIntent, SuggestedOption } from '../pipeline.types';
import { AIIntentRecognizer } from '../AIIntentRecognizer';

export class SuggestedOptionsPlugin implements PostProcessPlugin {
  readonly name = 'SuggestedOptionsPlugin';
  readonly priority = 300;

  /** AIIntentRecognizer 实例，用于检测 suggested_options 意图 */
  private readonly recognizer: AIIntentRecognizer;

  constructor() {
    this.recognizer = new AIIntentRecognizer();
  }

  /**
   * 检测内容中是否包含辅助模式推荐选项标签。
   * 使用 AIIntentRecognizer 检测 'suggested_options' 类型的意图。
   *
   * @param content 当前内容
   * @returns 包含选项标签时返回 true
   */
  detect(content: string, _context: DialoguePipelineContext): boolean {
    if (!content) return false;
    const intents = this.recognizer.detect(content);
    return intents.some((i) => i.type === 'suggested_options');
  }

  /**
   * 解析推荐选项并剥离选项标签。
   *
   * - 从检测到的 suggested_options 意图中提取选项文本列表
   * - 写入 context.suggestedOptions
   * - 使用 AIIntentRecognizer.stripIntents 剥离选项标签
   *
   * @param content 当前内容
   * @param context 管线上下文
   * @returns 剥离选项标签后的内容
   */
  process(content: string, context: DialoguePipelineContext): string {
    const intents = this.recognizer.detect(content);
    const optionsIntents: DetectedIntent[] = intents.filter(
      (i) => i.type === 'suggested_options',
    );

    if (optionsIntents.length === 0) {
      return content;
    }

    // 取首个匹配到的选项意图
    const optionsIntent = optionsIntents[0];
    const optionsData = optionsIntent.data as { options: string[] };

    // 转换为 SuggestedOption[] 格式
    const options: SuggestedOption[] = optionsData.options.map((text) => ({
      text,
    }));

    // 最多保留 3 个选项
    context.suggestedOptions = options.slice(0, 3);

    // 剥离选项标签
    const result = this.recognizer.stripIntents(content, optionsIntents);

    context.logs.push({
      level: 'info',
      stage: this.name,
      timestamp: Date.now(),
      message: `解析到 ${context.suggestedOptions.length} 个推荐选项，已剥离选项标签`,
    });

    return result;
  }
}
