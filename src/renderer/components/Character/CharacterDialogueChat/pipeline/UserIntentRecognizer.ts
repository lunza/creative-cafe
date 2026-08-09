/**
 * 用户意图识别模块 — UserIntentRecognizer
 *
 * Spec: redesign-dialogue-pipeline-architecture / IntentRecognizer
 *
 * 包含显式意图识别（UI 操作映射）和隐式意图识别（NLU 关键词匹配）。
 * - resolveExplicit：由 UI 操作（按钮/快捷键）直接指定，confidence=1.0
 * - detectImplicit：从用户输入文本中推断意图，confidence<1.0（需用户确认）
 */

import type {
  UserAction,
  UserIntent,
  DialogueContext,
} from './pipeline.types';

/** 续写意图关键词 */
const CONTINUATION_KEYWORDS = [
  '继续',
  '接着说',
  '接着写',
  '继续写',
  'go on',
  'continue',
];

/** 重试意图关键词 */
const RETRY_KEYWORDS = [
  '重试',
  '再来一次',
  '重新生成',
  '重新回答',
  'retry',
  'regenerate',
];

/** 续写意图置信度 */
const CONTINUATION_CONFIDENCE = 0.85;

/** 重试意图置信度 */
const RETRY_CONFIDENCE = 0.80;

export class UserIntentRecognizer {
  /**
   * 解析显式意图：将 UI 操作映射为 UserIntent，置信度固定为 1.0。
   *
   * @param action 用户 UI 操作
   * @returns 用户意图
   */
  resolveExplicit(action: UserAction): UserIntent {
    switch (action.type) {
      case 'sendMessage':
        return { type: 'dialogue', confidence: 1.0 };

      case 'continueConversation':
        return { type: 'continuation', confidence: 1.0 };

      case 'retryMessage':
        return {
          type: 'retry',
          confidence: 1.0,
          targetMessageId: action.targetMessageId,
        };

      case 'polishInput':
        return {
          type: 'polish',
          confidence: 1.0,
          targetText: action.targetText,
        };

      case 'generateUserReply':
        return { type: 'userReply', confidence: 1.0 };
    }
  }

  /**
   * 检测隐式意图：通过 NLU 关键词匹配从用户输入文本中推断意图。
   * 置信度 < 1.0，需用户确认后才会切换管线模式。
   *
   * 匹配优先级：续写 > 重试（续写关键词更具体，优先匹配）。
   * 匹配方式为简单子串包含（不区分大小写），不依赖外部 NLU 库。
   *
   * @param text 用户输入文本
   * @param _context 对话上下文（当前实现未使用，预留未来扩展如疑问句/情感检测）
   * @returns 检测到的意图，未匹配返回 null
   */
  detectImplicit(text: string, _context: DialogueContext): UserIntent | null {
    if (!text) return null;

    const lowerText = text.toLowerCase();

    // 续写意图检测
    for (const keyword of CONTINUATION_KEYWORDS) {
      if (lowerText.includes(keyword.toLowerCase())) {
        return { type: 'continuation', confidence: CONTINUATION_CONFIDENCE };
      }
    }

    // 重试意图检测
    for (const keyword of RETRY_KEYWORDS) {
      if (lowerText.includes(keyword.toLowerCase())) {
        return { type: 'retry', confidence: RETRY_CONFIDENCE, targetMessageId: '' };
      }
    }

    return null;
  }
}
