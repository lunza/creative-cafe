/**
 * 表情显示 Provider — ExpressionProvider
 *
 * Spec: redesign-dialogue-pipeline-architecture / PromptComposer
 * Spec: add-character-expression-system
 *
 * 迁移自 PromptBuilder.ts::buildExpressionPrompt。
 * 开启后要求 AI 在回复正文末尾输出情绪标记（<<<EXPRESSION>>>key<<<END_EXPRESSION>>>）。
 *
 * 可用情绪键来源：useExpressionStore.getState().getAvailableEmotionKeys()
 * （合并预置 30 项 + 当前角色卡自定义情绪），与 hooks.ts 保持一致。
 */

import type { PromptProvider, DialoguePipelineContext } from '../pipeline.types';
import { buildExpressionPrompt } from '../../PromptBuilder';
import { useExpressionStore } from '../../../../../stores/expressionStore';

export class ExpressionProvider implements PromptProvider {
  readonly name = 'ExpressionProvider';
  readonly priority = 430;
  readonly section = 'suffix' as const;

  isActive(context: DialoguePipelineContext): boolean {
    return context.sessionConfig.customParameters?.expression_display === true;
  }

  async build(context: DialoguePipelineContext): Promise<string> {
    const charName = context.characterInfo.characterCardName || 'Character';
    // 合并预置情绪 + 当前角色卡自定义情绪（与 hooks.ts 一致）
    const availableEmotionKeys = useExpressionStore.getState().getAvailableEmotionKeys();
    return buildExpressionPrompt(charName, availableEmotionKeys);
  }
}
