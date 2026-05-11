import React, { useEffect, useState } from 'react';
import { Spin, Empty } from 'antd';
import { useDataStore } from '../../stores/dataStore';
import { UnifiedChatDialog } from './UnifiedChatDialog';

interface SingleChatDialogProps {
  isDialogMode?: boolean;
  onCloseDialog?: () => void;
}

export const SingleChatDialog: React.FC<SingleChatDialogProps> = ({
  isDialogMode,
  onCloseDialog,
}) => {
  const { characters, fetchCharacters, loading } = useDataStore();
  const [isFetching, setIsFetching] = useState(false);
  const [fetchAttempted, setFetchAttempted] = useState(false);

  useEffect(() => {
    if (isDialogMode && characters.length === 0 && !loading && !fetchAttempted) {
      setIsFetching(true);
      setFetchAttempted(true);
      fetchCharacters().finally(() => {
        setIsFetching(false);
      });
    }
  }, [isDialogMode, characters.length, loading, fetchAttempted, fetchCharacters]);

  if (!isDialogMode) {
    return null;
  }

  if (isFetching || (loading && characters.length === 0)) {
    return (
      <div style={{
        position: 'fixed',
        inset: 0,
        zIndex: 1000,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: 'rgba(0, 0, 0, 0.5)',
        backdropFilter: 'blur(8px)',
      }}>
        <Spin size="large" tip="加载角色数据中..." />
      </div>
    );
  }

  if (characters.length === 0) {
    return (
      <div style={{
        position: 'fixed',
        inset: 0,
        zIndex: 1000,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: 'rgba(0, 0, 0, 0.5)',
        backdropFilter: 'blur(8px)',
      }}>
        <Empty
          description="暂无角色卡，请先在角色管理中添加角色"
          style={{ color: '#fff' }}
        />
      </div>
    );
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

export default SingleChatDialog;
