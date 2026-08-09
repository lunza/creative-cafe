/**
 * 用户人设 Provider — PersonaProvider
 *
 * Spec: redesign-dialogue-pipeline-architecture / PromptComposer
 *
 * 迁移自 PromptBuilder.ts::buildPersonaSection。
 * 构建用户人设段落，包括通用人设引导或具名人设描述。
 */

import type { PromptProvider, DialoguePipelineContext } from '../pipeline.types';
import { buildPersonaSection } from '../../PromptBuilder';

export class PersonaProvider implements PromptProvider {
  readonly name = 'PersonaProvider';
  readonly priority = 110;
  readonly section = 'context' as const;

  isActive(_context: DialoguePipelineContext): boolean {
    return true;
  }

  async build(context: DialoguePipelineContext): Promise<string> {
    return buildPersonaSection(context.selectedPersona);
  }
}
