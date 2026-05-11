import React from 'react';
import { useDataStore } from '../../stores/dataStore';
import { UnifiedChatDialog } from './UnifiedChatDialog';

interface ChatModeProps {
  isDialogMode?: boolean;
  onCloseDialog?: () => void;
}

export const ChatMode: React.FC<ChatModeProps> = ({
  isDialogMode,
  onCloseDialog,
}) => {
  const { characters } = useDataStore();

  if (!isDialogMode || characters.length === 0) {
    return null;
  }

  return (
    <UnifiedChatDialog
      open={isDialogMode}
      onClose={onCloseDialog || (() => {})}
      initialCharacter={characters[0]}
      showCharacterSelector={true}
      characters={characters}
    />
  );
};

export default ChatMode;
