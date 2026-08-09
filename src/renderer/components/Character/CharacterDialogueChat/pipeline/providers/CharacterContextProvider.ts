/**
 * 角色上下文 Provider — CharacterContextProvider
 *
 * Spec: redesign-dialogue-pipeline-architecture / PromptComposer
 *
 * 迁移自 PromptBuilder.ts::buildCharacterContext。
 * 构建角色卡信息段落（名称、个性、描述、场景、示例对话等），
 * 声明角色卡为绝对权威约束。
 *
 * 注意：长度引导约束（buildLengthGuidancePrompt）已分离到 LengthGuidanceProvider，
 * 本 Provider 不再包含长度引导逻辑。
 */

import type { PromptProvider, DialoguePipelineContext } from '../pipeline.types';
import { buildCharacterContext } from '../../PromptBuilder';

export class CharacterContextProvider implements PromptProvider {
  readonly name = 'CharacterContextProvider';
  readonly priority = 100;
  readonly section = 'context' as const;

  isActive(_context: DialoguePipelineContext): boolean {
    return true;
  }

  async build(context: DialoguePipelineContext): Promise<string> {
    const { characterInfo, selectedPersona } = context;
    const userName = selectedPersona?.name || 'User';

    // 映射 CharacterInfo → buildCharacterContext 所需的字段结构
    const characterContext = buildCharacterContext(
      {
        name: characterInfo.characterCardName,
        personality: characterInfo.personality,
        description: characterInfo.characterCardContent,
        scenario: characterInfo.scenario,
        mes_example: characterInfo.mes_example,
        system_prompt: characterInfo.system_prompt,
        creator_notes: characterInfo.creator_notes,
      },
      userName
      // 不传 options.minResponseChars —— 长度引导由 LengthGuidanceProvider 独立处理
    );

    return characterContext;
  }
}
