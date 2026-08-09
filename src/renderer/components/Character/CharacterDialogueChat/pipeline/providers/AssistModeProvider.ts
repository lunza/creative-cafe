/**
 * 辅助模式 Provider — AssistModeProvider
 *
 * Spec: redesign-dialogue-pipeline-architecture / PromptComposer
 * Spec: add-assist-mode-options
 *
 * 迁移自 PromptBuilder.ts::buildAssistModePrompt。
 * 开启后要求 AI 在回复正文末尾以结构化格式输出 3 个推荐选项。
 */

import type { PromptProvider, DialoguePipelineContext } from '../pipeline.types';
import { buildAssistModePrompt } from '../../PromptBuilder';

export class AssistModeProvider implements PromptProvider {
  readonly name = 'AssistModeProvider';
  readonly priority = 420;
  readonly section = 'suffix' as const;

  isActive(context: DialoguePipelineContext): boolean {
    return context.sessionConfig.customParameters?.assist_mode === true;
  }

  async build(context: DialoguePipelineContext): Promise<string> {
    const charName = context.characterInfo.characterCardName || 'Character';
    return buildAssistModePrompt(charName);
  }
}
