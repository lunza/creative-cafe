import { useCallback } from 'react';
import { message } from 'antd';
import { useLogStore } from '../../../stores/logStore';
import { CharacterInfo } from './CharacterDialogueChat.types';

interface Character {
  name: string;
  path: string;
  size: number;
  modified: Date;
  characterName?: string;
  version?: string;
  creator?: string;
  tags?: string[];
  cardVersion?: 'v1' | 'v2' | 'v3';
}

interface SwitchCharacterResult {
  characterInfo: CharacterInfo;
  avatarPath?: string;
}

export function useCharacterSwitch() {
  const addLog = useLogStore(state => state.addLog);

  const switchCharacter = useCallback(async (character: Character): Promise<SwitchCharacterResult | null> => {
    addLog(`[CharacterSwitch] 切换角色卡: ${character.name}`);
    try {
      const content = await window.electronAPI.character.read(character.path);
      const characterName = content.data?.name || character.name;
      const characterCardContent = content.data?.description || '';

      const characterInfo: CharacterInfo = {
        creativeId: character.path,
        characterCardId: character.path,
        characterCardName: characterName,
        characterCardContent,
        personality: content.data?.personality || '',
        scenario: content.data?.scenario || '',
        first_mes: content.data?.first_mes || '',
        mes_example: content.data?.mes_example || '',
        system_prompt: content.data?.system_prompt || '',
        creator_notes: content.data?.creator_notes || '',
        tags: content.data?.tags || [],
        character_version: content.data?.character_version || '',
        creator: content.data?.creator || '',
      };

      let avatarPath: string | undefined;
      const isImageFile = character.path.endsWith('.png') || character.path.endsWith('.jpg') || character.path.endsWith('.jpeg') || character.path.endsWith('.webp');
      if (isImageFile) {
        try {
          const result = await window.electronAPI.file.readAsBase64(character.path);
          if (result?.success && result.data) {
            avatarPath = result.data;
          }
        } catch {
          avatarPath = undefined;
        }
      } else {
        avatarPath = content.avatar || undefined;
      }

      addLog(`[CharacterSwitch] 角色卡切换成功: ${characterName}`, 'info');
      return { characterInfo, avatarPath };
    } catch (error) {
      addLog(`[CharacterSwitch] 读取角色卡失败: ${character.path}`, 'error');
      message.error('读取角色卡失败');
      return null;
    }
  }, [addLog]);

  return { switchCharacter };
}
