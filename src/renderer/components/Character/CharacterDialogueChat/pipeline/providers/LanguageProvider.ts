/**
 * 语言约束 Provider — LanguageProvider
 *
 * Spec: redesign-dialogue-pipeline-architecture / PromptComposer
 *
 * 迁移自 PromptBuilder.ts::buildLanguagePrompt。
 * 根据用户选择的语言在系统提示中注入语言要求，默认中文。
 */

import type { PromptProvider, DialoguePipelineContext } from '../pipeline.types';
import { buildLanguagePrompt } from '../../PromptBuilder';

export class LanguageProvider implements PromptProvider {
  readonly name = 'LanguageProvider';
  readonly priority = 410;
  readonly section = 'suffix' as const;

  isActive(_context: DialoguePipelineContext): boolean {
    return true;
  }

  async build(context: DialoguePipelineContext): Promise<string> {
    const language = context.sessionConfig.customParameters?.language ?? 'zh';
    return buildLanguagePrompt(language);
  }
}
