/**
 * ThinkTagPlugin — 思考标签后处理插件
 *
 * Spec: redesign-dialogue-pipeline-architecture / PostProcessingPipeline
 * Spec: handle-think-tags-overflow
 *
 * 处理 AI 响应中的 think/thinking/thought/antml:thinking 推理标签。
 * 根据 sessionConfig.customParameters.think_tag_mode 决定处理方式：
 * - 'strip'：剥离思考内容（默认）
 * - 'strip_render'：存储时剥离，但记录思考内容到 context.thinkContent
 * - 'fold'：转换为 <details> 折叠块保留展示
 *
 * 迁移自 CharacterDialogueChat.hooks.ts::onComplete 中的 think 标签后处理逻辑，
 * 以及 messageProcessor.ts::stripThinkingTags / convertThinkingTags。
 */

import type { PostProcessPlugin, DialoguePipelineContext } from '../pipeline.types';
import type { ThinkTagMode } from '../../CharacterDialogueChat.types';
import { deriveThinkTagMode } from '../../CharacterDialogueChat.types';
import { stripThinkingTags, convertThinkingTags } from '../../utils/messageProcessor';
import { AIIntentRecognizer } from '../AIIntentRecognizer';

/**
 * think 标签检测正则 — 匹配任何 think 标签变体的开始标记。
 * 支持变体：think、thinking、thought、antml:thinking。
 */
const THINK_TAG_DETECT_REGEX = /<(think|thinking|thought|antml:thinking)\b[^>]*>/i;

export class ThinkTagPlugin implements PostProcessPlugin {
  readonly name = 'ThinkTagPlugin';
  readonly priority = 100;

  /** AIIntentRecognizer 实例，用于检测 think_tag 意图并提取内容 */
  private readonly recognizer: AIIntentRecognizer;

  constructor() {
    this.recognizer = new AIIntentRecognizer();
  }

  /**
   * 检测内容中是否包含 think/thinking/thought/antml:thinking 标签。
   *
   * @param content 当前内容
   * @returns 包含 think 标签时返回 true
   */
  detect(content: string, _context: DialoguePipelineContext): boolean {
    if (!content) return false;
    return THINK_TAG_DETECT_REGEX.test(content);
  }

  /**
   * 根据 think_tag_mode 处理思考标签。
   *
   * - 'strip'：使用 stripThinkingTags 移除思考内容
   * - 'strip_render'：使用 stripThinkingTags 移除（渲染时也会剥离），但记录思考内容
   * - 'fold'：使用 convertThinkingTags 转换为 <details> 折叠块
   *
   * 无论哪种模式，剥离的思考内容都会写入 context.thinkContent（如果有）。
   *
   * @param content 当前内容
   * @param context 管线上下文
   * @returns 处理后的内容
   */
  process(content: string, context: DialoguePipelineContext): string {
    // 从 sessionConfig 获取 think_tag_mode（向后兼容旧字段）
    const thinkTagMode: ThinkTagMode = deriveThinkTagMode(
      context.sessionConfig?.customParameters,
    );

    // 提取思考内容（用于写入 context.thinkContent）
    const intents = this.recognizer.detect(content);
    const thinkIntents = intents.filter((i) => i.type === 'think_tag');
    if (thinkIntents.length > 0) {
      // 拼接所有 think 标签的内容
      const thinkText = thinkIntents
        .map((i) => (i.data as { content: string }).content)
        .filter((text) => text.length > 0)
        .join('\n\n');
      if (thinkText.length > 0) {
        context.thinkContent = thinkText;
      }
    }

    let result: string;

    switch (thinkTagMode) {
      case 'fold':
        // 折叠展示：转换为 <details> 块
        result = convertThinkingTags(content);
        break;

      case 'strip_render':
        // 存储时剥离（渲染时也会剥离），思考内容已记录到 context.thinkContent
        result = stripThinkingTags(content);
        break;

      case 'strip':
      default:
        // 彻底移除思考内容
        result = stripThinkingTags(content);
        break;
    }

    // 记录日志
    if (result.length !== content.length) {
      context.logs.push({
        level: 'info',
        stage: this.name,
        timestamp: Date.now(),
        message: `think 标签已处理（mode=${thinkTagMode}），原始长度: ${content.length}, 处理后: ${result.length}`,
      });
    }

    return result;
  }
}
