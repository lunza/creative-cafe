import React, { useEffect, useState, useCallback, useRef } from 'react';
import { Spin, message } from 'antd';
import { LoadingOutlined } from '@ant-design/icons';
import { CharacterDialogueChat } from '../Character/CharacterDialogueChat';
import { CharacterSelectorPanel } from '../Character/CharacterDialogueChat';
import { useCharacterSwitch } from '../Character/CharacterDialogueChat/useCharacterSwitch';
import { CharacterInfo } from '../Character/CharacterDialogueChat/CharacterDialogueChat.types';

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

interface UnifiedChatDialogProps {
  // Dialog display control
  open: boolean;
  onClose: () => void;
  
  // Character info (either one)
  initialCharacter?: Character;
  initialCharacterPath?: string;
  
  // Optional configuration
  showCharacterSelector?: boolean;
  characters?: Character[];
  onCharacterSelect?: (character: Character) => void;
  
  // Custom avatar path (optional override)
  avatarPath?: string;
}

export const UnifiedChatDialog: React.FC<UnifiedChatDialogProps> = ({
  open,
  onClose,
  initialCharacter,
  initialCharacterPath,
  showCharacterSelector = false,
  characters,
  onCharacterSelect,
  avatarPath: customAvatarPath,
}) => {
  const { switchCharacter } = useCharacterSwitch();
  
  const [characterInfo, setCharacterInfo] = useState<CharacterInfo | null>(null);
  const [avatarPath, setAvatarPath] = useState<string | undefined>(customAvatarPath);
  const [isLoading, setIsLoading] = useState(false);
  const [isSwitching, setIsSwitching] = useState(false);
  const isFirstLoadRef = useRef(true);

  const loadCharacter = useCallback(async (character: Character, isSwitch = false) => {
    if (!character?.path) return;
    
    // 切换时设置切换状态但不关闭对话框
    if (isSwitch) {
      setIsSwitching(true);
    } else {
      setIsLoading(true);
    }
    
    try {
      const result = await switchCharacter(character);
      if (result) {
        setCharacterInfo(result.characterInfo);
        setAvatarPath(result.avatarPath);
      }
    } catch (error) {
      message.error('加载角色卡失败');
    } finally {
      setIsLoading(false);
      setIsSwitching(false);
    }
  }, [switchCharacter]);

  // Load character when initialCharacter changes
  useEffect(() => {
    if (open && initialCharacter) {
      const isSwitch = !isFirstLoadRef.current;
      loadCharacter(initialCharacter, isSwitch);
      isFirstLoadRef.current = false;
    }
  }, [open, initialCharacter, loadCharacter]);

  // Load character when initialCharacterPath changes
  useEffect(() => {
    if (open && initialCharacterPath && !initialCharacter) {
      const character = characters?.find(c => c.path === initialCharacterPath);
      if (character) {
        const isSwitch = !isFirstLoadRef.current;
        loadCharacter(character, isSwitch);
        isFirstLoadRef.current = false;
      }
    }
  }, [open, initialCharacterPath, initialCharacter, characters, loadCharacter]);

  const handleCharacterSelect = useCallback(async (character: Character) => {
    await loadCharacter(character, true);
    onCharacterSelect?.(character);
  }, [loadCharacter, onCharacterSelect]);

  const handleClose = useCallback(() => {
    setCharacterInfo(null);
    setAvatarPath(undefined);
    isFirstLoadRef.current = true;
    onClose();
  }, [onClose]);

  // 首次加载时显示全屏 loading
  if (isLoading && !characterInfo) {
    return (
      <div style={{
        position: 'fixed',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 10000,
        background: 'rgba(0, 0, 0, 0.6)',
      }}>
        <Spin size="large" tip="加载角色卡中..." />
      </div>
    );
  }

  if (!characterInfo) {
    return null;
  }

  return (
    <>
      <CharacterDialogueChat
        characterInfo={characterInfo}
        open={open}
        onClose={handleClose}
        avatarPath={avatarPath}
        characters={showCharacterSelector ? characters : undefined}
        onCharacterSelect={showCharacterSelector ? handleCharacterSelect : undefined}
      />
      
      {/* 切换角色卡时的加载指示器 */}
      {isSwitching && (
        <div style={{
          position: 'fixed',
          top: '50%',
          left: '50%',
          transform: 'translate(-50%, -50%)',
          zIndex: 10001,
          background: 'rgba(0, 0, 0, 0.8)',
          borderRadius: '12px',
          padding: '24px 32px',
          display: 'flex',
          alignItems: 'center',
          gap: '12px',
          boxShadow: '0 8px 32px rgba(0, 0, 0, 0.4)',
          backdropFilter: 'blur(8px)',
        }}>
          <LoadingOutlined style={{ fontSize: '24px', color: '#8b5cf6' }} spin />
          <span style={{ color: '#fff', fontSize: '14px' }}>正在切换角色卡...</span>
        </div>
      )}
    </>
  );
};

export default UnifiedChatDialog;
