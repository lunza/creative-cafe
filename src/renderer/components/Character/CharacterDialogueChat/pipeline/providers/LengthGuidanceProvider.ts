/**
 * 回复长度引导 Provider — LengthGuidanceProvider
 *
 * Spec: redesign-dialogue-pipeline-architecture / PromptComposer
 * Spec: fix-ai-response-length-degradation / Task 3.2 + Task 4.2
 *
 * 迁移自 PromptBuilder.ts::buildLengthGuidancePrompt。
 * 在系统提示末尾注入字数下限约束，防止 AI 在持续对话中复制逐渐缩短的回复模式。
 *
 * 强化模式：当最近 3 轮 assistant 回复均低于阈值时，追加强化约束段落。
 * 迁移自 hooks.ts::shouldStrengthenLength 逻辑，从 context.messagesToSend
 * 中提取最近 assistant 消息长度进行判定。
 */

import type { PromptProvider, DialoguePipelineContext } from '../pipeline.types';
import { buildLengthGuidancePrompt } from '../../PromptBuilder';

/** 默认最小回复字数（与 hooks.ts 一致） */
const DEFAULT_MIN_RESPONSE_CHARS = 300;

/**
 * 判定是否需要启用强化模式。
 * 迁移自 hooks.ts::shouldStrengthenLength。
 *
 * @param messages 待发送的消息列表
 * @param threshold 最小回复字数阈值
 * @returns 最近 3 轮 assistant 回复均低于阈值时返回 true
 */
function shouldStrengthen(messages: { role: string; content: string }[], threshold: number): boolean {
  if (!threshold || threshold <= 0) return false;
  // 从末尾向前查找 assistant 消息
  const assistantLengths: number[] = [];
  for (let i = messages.length - 1; i >= 0 && assistantLengths.length < 3; i--) {
    if (messages[i].role === 'assistant') {
      assistantLengths.push(messages[i].content.length);
    }
  }
  if (assistantLengths.length < 3) return false;
  return assistantLengths.every(len => len > 0 && len < threshold);
}

export class LengthGuidanceProvider implements PromptProvider {
  readonly name = 'LengthGuidanceProvider';
  readonly priority = 400;
  readonly section = 'suffix' as const;

  isActive(_context: DialoguePipelineContext): boolean {
    return true;
  }

  async build(context: DialoguePipelineContext): Promise<string> {
    const minResponseChars = context.sessionConfig.customParameters?.min_response_chars ?? DEFAULT_MIN_RESPONSE_CHARS;
    if (!minResponseChars || minResponseChars <= 0) return '';

    const charName = context.characterInfo.characterCardName || 'Character';
    const strengthen = shouldStrengthen(context.messagesToSend, minResponseChars);

    return buildLengthGuidancePrompt(minResponseChars, strengthen, charName);
  }
}
