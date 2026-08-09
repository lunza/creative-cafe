/**
 * DedupPlugin — 去重检测后处理插件
 *
 * Spec: redesign-dialogue-pipeline-architecture / PostProcessingPipeline
 * Spec: optimize-chat-ai-intelligence / Task 5.2 + 5.3
 *
 * 在所有标签剥离插件执行完毕后，检测 AI 回复是否与已有内容重复：
 * - dialogue/retry 模式：与上一条 assistant 回复比较 n-gram Jaccard 相似度，
 *   > 0.8 时标记需要重试
 * - continuation 模式：与续写初始内容比较 overlap rate（重叠率），
 *   > 0.6 时标记需要重试
 *
 * 检测结果写入 context.dedupInfo，由 LogicEngine 的 DedupRetryTask 决定是否重试。
 *
 * 算法来自 utils/similarityUtils.ts，迁移自 CharacterDialogueChat.hooks.ts::onComplete
 * 中的去重检测逻辑。
 */

import type { PostProcessPlugin, DialoguePipelineContext, DedupInfo } from '../pipeline.types';
import {
  nGramJaccard,
  overlapRate,
  DEDUP_SIMILARITY_THRESHOLD,
  DEDUP_OVERLAP_THRESHOLD,
} from '../../utils/similarityUtils';

export class DedupPlugin implements PostProcessPlugin {
  readonly name = 'DedupPlugin';
  readonly priority = 700;

  /**
   * 检测是否需要进行去重检查。
   * 仅在 dialogue、continuation、retry 模式下执行。
   *
   * @param _content 当前内容
   * @param context 管线上下文
   * @returns pipelineMode 为 dialogue/continuation/retry 时返回 true
   */
  detect(_content: string, context: DialoguePipelineContext): boolean {
    const mode = context.pipelineMode;
    return mode === 'dialogue' || mode === 'continuation' || mode === 'retry';
  }

  /**
   * 执行去重检测。
   *
   * - dialogue/retry 模式：从 chatHistory 中获取上一条 assistant 回复，
   *   计算 n-gram Jaccard 相似度，> 0.8 时 needRetry=true
   * - continuation 模式：从 chatHistory 中获取续写的初始内容，
   *   计算 overlapRate，> 0.6 时 needRetry=true
   *
   * 结果写入 context.dedupInfo。
   *
   * @param content 当前内容（已剥离所有标签的纯净叙事内容）
   * @param context 管线上下文
   * @returns 原始 content（去重检测不修改内容）
   */
  process(content: string, context: DialoguePipelineContext): string {
    const mode = context.pipelineMode;

    // 从聊天历史中获取上一条 assistant 消息
    const chatHistory = context.retrievedContext?.chatHistory ?? [];
    const lastAssistant = [...chatHistory]
      .reverse()
      .find((msg) => msg.role === 'assistant');

    if (mode === 'continuation') {
      // 续写去重：检测 AI 是否原样重写已有内容
      if (!lastAssistant?.content || !content) {
        return content;
      }

      const initialContent = lastAssistant.content;
      // 剥离 initialContent 前缀，得到 AI 实际生成的"新部分"
      const newPart = content.startsWith(initialContent)
        ? content.slice(initialContent.length)
        : content;

      const overlap = overlapRate(newPart, initialContent);

      context.logs.push({
        level: 'info',
        stage: this.name,
        timestamp: Date.now(),
        message: `续写去重检查：overlap=${overlap.toFixed(3)}（阈值=${DEDUP_OVERLAP_THRESHOLD}）`,
      });

      if (overlap > DEDUP_OVERLAP_THRESHOLD) {
        const dedupInfo: DedupInfo = {
          needRetry: true,
          kind: 'continue',
          metric: overlap,
          exhausted: false,
          reason: `overlap=${overlap.toFixed(2)}`,
        };
        context.dedupInfo = dedupInfo;
      } else {
        // 未超阈值，无需重试
        context.dedupInfo = {
          needRetry: false,
          kind: 'none',
          metric: overlap,
          exhausted: false,
          reason: `overlap=${overlap.toFixed(2)}（低于阈值）`,
        };
      }
    } else {
      // dialogue / retry 模式：重试去重
      if (!lastAssistant?.content || !content) {
        return content;
      }

      const similarity = nGramJaccard(lastAssistant.content, content, 4);

      context.logs.push({
        level: 'info',
        stage: this.name,
        timestamp: Date.now(),
        message: `重试去重检查：similarity=${similarity.toFixed(3)}（阈值=${DEDUP_SIMILARITY_THRESHOLD}）`,
      });

      if (similarity > DEDUP_SIMILARITY_THRESHOLD) {
        const dedupInfo: DedupInfo = {
          needRetry: true,
          kind: 'retry',
          metric: similarity,
          exhausted: false,
          reason: `similarity=${similarity.toFixed(2)}`,
        };
        context.dedupInfo = dedupInfo;
      } else {
        context.dedupInfo = {
          needRetry: false,
          kind: 'none',
          metric: similarity,
          exhausted: false,
          reason: `similarity=${similarity.toFixed(2)}（低于阈值）`,
        };
      }
    }

    // 去重检测不修改内容
    return content;
  }
}
