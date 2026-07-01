import { useCallback, useMemo } from 'react';
import { UserPersona, CharacterInfo } from './CharacterDialogueChat.types';
import {
  buildDialoguePrompt as buildDialoguePromptPure,
  buildContinuationPrompt as buildContinuationPromptPure,
  formatVectorContextItems,
  buildFinalSystemPrompt,
  buildSystemPrompt as buildSystemPromptPure,
  type CharacterInfoForPrompt,
} from './PromptBuilder';

function mapCharacterInfoToPromptInfo(info: CharacterInfo): CharacterInfoForPrompt {
  return {
    characterCardName: info.characterCardName,
    personality: info.personality,
    characterCardContent: info.characterCardContent,
    scenario: info.scenario,
    mes_example: info.mes_example,
    system_prompt: info.system_prompt,
    creator_notes: info.creator_notes,
  };
}

export interface ContextVectorItem {
  source: string;
  score: number;
  content: string;
}

export function usePromptBuilder(
  characterInfo: CharacterInfo,
  selectedPersona?: UserPersona
) {
  const characterInfoRef = useMemo(() => mapCharacterInfoToPromptInfo(characterInfo), [
    characterInfo.characterCardName,
    characterInfo.personality,
    characterInfo.characterCardContent,
    characterInfo.scenario,
    characterInfo.mes_example,
    characterInfo.system_prompt,
    characterInfo.creator_notes,
  ]);

  const personaRef = useMemo(() => selectedPersona, [selectedPersona?.id]);

  const buildDialoguePrompt = useCallback(async (organizeMode?: 'sync' | 'async'): Promise<string> => {
    return buildDialoguePromptPure(characterInfoRef, personaRef, organizeMode);
  }, [characterInfoRef, personaRef]);

  const buildContinuationPrompt = useCallback(async (organizeMode?: 'sync' | 'async'): Promise<string> => {
    return buildContinuationPromptPure(characterInfoRef, personaRef, organizeMode);
  }, [characterInfoRef, personaRef]);

  const buildFinalPrompt = useCallback(async (
    promptType: 'dialogue' | 'continuation',
    vectorContextItems: ContextVectorItem[],
    organizeMode?: 'sync' | 'async'
  ): Promise<string> => {
    const basePrompt = promptType === 'continuation'
      ? await buildContinuationPrompt(organizeMode)
      : await buildDialoguePrompt(organizeMode);
    return await buildFinalSystemPrompt(basePrompt, vectorContextItems);
  }, [buildDialoguePrompt, buildContinuationPrompt]);

  const buildCompleteSystemPrompt = useCallback(async (
    promptType: 'dialogue' | 'continuation',
    vectorContextItems: ContextVectorItem[],
    memoryTableData?: string,
    organizeMode?: 'sync' | 'async',
    tableStructure?: { sheets: string[]; headers: Record<string, string[]>; descriptions: Record<string, string> }
  ): Promise<string> => {
    console.log('[usePromptBuilder] buildCompleteSystemPrompt 调用:');
    console.log('  - promptType:', promptType);
    console.log('  - vectorContextItems 数量:', vectorContextItems?.length || 0);
    console.log('  - memoryTableData 是否有值:', !!memoryTableData);
    console.log('  - memoryTableData 长度:', memoryTableData?.length || 0);
    if (memoryTableData) {
      console.log('  - memoryTableData 内容预览:', memoryTableData.substring(0, 200));
    }
    console.log('  - organizeMode:', organizeMode);
    console.log('  - tableStructure sheets:', tableStructure?.sheets);
    const result = await buildSystemPromptPure(characterInfoRef, personaRef, promptType, vectorContextItems, memoryTableData, organizeMode, tableStructure);
    console.log('  - 最终 system prompt 长度:', result.length);
    console.log('  - 最终 system prompt 末尾 300 字符:', result.substring(Math.max(0, result.length - 300)));
    return result;
  }, [characterInfoRef, personaRef]);

  const formatVectorContext = useCallback((items: ContextVectorItem[]): string => {
    return formatVectorContextItems(items);
  }, []);

  return {
    buildDialoguePrompt,
    buildContinuationPrompt,
    buildFinalPrompt,
    buildCompleteSystemPrompt,
    formatVectorContext,
  };
}
