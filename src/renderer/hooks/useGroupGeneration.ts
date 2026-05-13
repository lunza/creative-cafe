import { useCallback } from 'react';
import { GenerationMode, Group } from '../types/groupChat.types';

interface CharacterCard {
  name: string;
  description?: string;
  personality?: string;
  scenario?: string;
  first_mes?: string;
  data?: Record<string, any>;
}

export function useGroupGeneration() {
  const applyJoinTemplate = useCallback((
    text: string,
    characterName: string,
    joinPrefix: string,
    joinSuffix: string
  ): string => {
    if (!text) return text;

    const processedPrefix = joinPrefix
      .replace(/{{char}}/g, characterName)
      .replace(/{{Char}}/g, characterName.charAt(0).toUpperCase() + characterName.slice(1));

    const processedSuffix = joinSuffix
      .replace(/{{char}}/g, characterName)
      .replace(/{{Char}}/g, characterName.charAt(0).toUpperCase() + characterName.slice(1));

    return processedPrefix + text + processedSuffix;
  }, []);

  const buildSwapSystemPrompt = useCallback((
    activeCharacter: CharacterCard,
    group: Group,
    allCharacters: Map<string, CharacterCard>
  ): string => {
    const parts: string[] = [];

    if (activeCharacter.description) {
      parts.push(`[Description of ${activeCharacter.name}]\n${activeCharacter.description}`);
    }

    if (activeCharacter.personality) {
      parts.push(`[Personality of ${activeCharacter.name}]\n${activeCharacter.personality}`);
    }

    if (activeCharacter.scenario) {
      parts.push(`[Scenario]\n${activeCharacter.scenario}`);
    }

    parts.push(`\nYou are ${activeCharacter.name} in the group "${group.name}".`);
    parts.push(`Group members: ${group.members.join(', ')}.`);
    parts.push(`Only respond as ${activeCharacter.name}. Do not speak for other characters.`);

    return parts.join('\n\n');
  }, []);

  const buildAppendSystemPrompt = useCallback((
    group: Group,
    allCharacters: Map<string, CharacterCard>,
    joinPrefix: string,
    joinSuffix: string
  ): string => {
    const parts: string[] = [];

    for (const memberName of group.members) {
      const character = allCharacters.get(memberName);
      if (!character) continue;

      const cardText = [
        character.description ? `[Description of ${character.name}]\n${character.description}` : '',
        character.personality ? `[Personality of ${character.name}]\n${character.personality}` : '',
      ].filter(Boolean).join('\n\n');

      const templatedText = applyJoinTemplate(cardText, character.name, joinPrefix, joinSuffix);
      parts.push(templatedText);
    }

    if (parts.length > 0) {
      parts.push(
        `\nThis is a group chat with members: ${group.members.join(', ')}.`,
        `Each character should respond in their own voice and personality.`,
        `Do not speak for other characters.`
      );
    }

    return parts.join('\n\n');
  }, [applyJoinTemplate]);

  const buildSystemPrompt = useCallback((
    mode: GenerationMode,
    activeCharacter: CharacterCard | null,
    group: Group,
    allCharacters: Map<string, CharacterCard>
  ): string => {
    switch (mode) {
      case GenerationMode.SWAP:
        if (!activeCharacter) return '';
        return buildSwapSystemPrompt(activeCharacter, group, allCharacters);

      case GenerationMode.APPEND:
        return buildAppendSystemPrompt(
          group,
          allCharacters,
          group.generation_mode_join_prefix || '',
          group.generation_mode_join_suffix || ''
        );

      case GenerationMode.APPEND_DISABLED:
      default:
        return `[Group: ${group.name}]\nMembers: ${group.members.join(', ')}`;
    }
  }, [buildSwapSystemPrompt, buildAppendSystemPrompt]);

  const formatCharacterDisplay = useCallback((
    character: CharacterCard,
    mode: GenerationMode,
    joinPrefix: string,
    joinSuffix: string
  ): string => {
    if (mode === GenerationMode.SWAP) {
      return character.name;
    }

    const cardSummary = [
      character.name,
      character.description ? character.description.substring(0, 200) : '',
    ].filter(Boolean).join(' - ');

    return applyJoinTemplate(cardSummary, character.name, joinPrefix, joinSuffix);
  }, [applyJoinTemplate]);

  return {
    buildSystemPrompt,
    buildSwapSystemPrompt,
    buildAppendSystemPrompt,
    formatCharacterDisplay,
    applyJoinTemplate,
  };
}

export type { CharacterCard };
