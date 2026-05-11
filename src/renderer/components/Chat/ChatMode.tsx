import React, { useCallback, useEffect, useRef, useState } from 'react';
import { CharacterDialogueChat } from '../Character/CharacterDialogueChat';
import type { CharacterInfo } from '../Character/CharacterDialogueChat';
import { useCharacterChatStore } from '../../stores/characterChatStore';
import { useDataStore } from '../../stores/dataStore';
import { message, Spin } from 'antd';
import './ChatModule.css';

interface ChatModeProps {
  isDialogMode?: boolean;
  onCloseDialog?: () => void;
}

export const ChatMode: React.FC<ChatModeProps> = ({
  isDialogMode,
  onCloseDialog,
}) => {
  const { currentTestChat, loadTestChat, setCurrentTestChat } = useCharacterChatStore();
  const { characters } = useDataStore();
  const [isLoading, setIsLoading] = useState(false);
  const [characterInfo, setCharacterInfo] = useState<CharacterInfo | null>(null);
  const loadingRef = useRef(false);

  const handleClose = useCallback(() => {
    if (onCloseDialog) {
      onCloseDialog();
    }
  }, [onCloseDialog]);

  const loadCharacter = useCallback(async (characterPath: string) => {
    if (loadingRef.current) return;
    loadingRef.current = true;
    setIsLoading(true);

    const character = characters.find((c: any) => c.path === characterPath);
    if (!character) {
      loadingRef.current = false;
      setIsLoading(false);
      return;
    }

    try {
      const content = await window.electronAPI.character.read(characterPath);
      const characterName = content.data?.name || character.name;
      const characterCardContent = content.data?.description || '';

      await loadTestChat(characterPath, characterPath);

      const isImageFile = characterPath.endsWith('.png') || characterPath.endsWith('.jpg') || characterPath.endsWith('.jpeg') || characterPath.endsWith('.webp');
      let avatarPath: string | undefined;
      if (isImageFile) {
        try {
          const result = await window.electronAPI.file.readAsBase64(characterPath);
          if (result?.success && result.data) {
            avatarPath = result.data;
          }
        } catch {
          avatarPath = content.avatar || undefined;
        }
      } else {
        avatarPath = content.avatar || undefined;
      }

      const info = {
        creativeId: characterPath,
        characterCardId: characterPath,
        characterCardName: characterName,
        characterCardContent,
        avatarPath,
        personality: content.data?.personality || '',
        scenario: content.data?.scenario || '',
        first_mes: content.data?.first_mes || '',
        mes_example: content.data?.mes_example || '',
        system_prompt: content.data?.system_prompt || '',
        creator_notes: content.data?.creator_notes || '',
        alternate_greetings: content.data?.alternate_greetings || [],
        tags: content.data?.tags || [],
        character_version: content.data?.character_version || '',
        creator: content.data?.creator || '',
      } as unknown as CharacterInfo;

      setCharacterInfo(info);
      setCurrentTestChat({
        ...info,
        messages: (currentTestChat as any)?.messages || [],
        createdAt: Date.now(),
        updatedAt: Date.now(),
      } as any);

      message.success(`已加载 ${characterName}`);
    } catch (error) {
      message.error('加载角色失败');
    } finally {
      loadingRef.current = false;
      setIsLoading(false);
    }
  }, [characters, loadTestChat, setCurrentTestChat, currentTestChat]);

  useEffect(() => {
    if (isDialogMode && characters.length > 0 && !characterInfo && !loadingRef.current) {
      loadCharacter(characters[0].path);
    }
  }, [isDialogMode, characters, characterInfo, loadCharacter]);

  const activeCharacterInfo = characterInfo || (currentTestChat as unknown as CharacterInfo);

  if (isLoading) {
    return (
      <div style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        height: '100%',
      }}>
        <Spin size="large" tip="加载中..." />
      </div>
    );
  }

  if (!activeCharacterInfo) {
    return null;
  }

  return (
    <CharacterDialogueChat
      characterInfo={activeCharacterInfo}
      open={isDialogMode === true}
      onClose={handleClose}
      avatarPath={(activeCharacterInfo as any)?.avatarPath}
    />
  );
};

export default ChatMode;
