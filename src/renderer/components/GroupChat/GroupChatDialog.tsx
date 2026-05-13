import React, { useState, useCallback, useEffect, useMemo } from 'react';
import { Modal, message, Spin } from 'antd';
import { CloseOutlined } from '@ant-design/icons';
import { useSettingStore } from '../../stores/settingStore';
import { useGroupChatStore } from '../../stores/groupChatStore';
import { useGroupDialogueChat } from '../../hooks/useGroupDialogueChat';
import { CharacterListPanel } from './CharacterListPanel';
import { GroupDropZone } from './GroupDropZone';
import { GroupSettingsPanel } from './GroupSettingsPanel';
import { CharacterCard } from '../../hooks/useGroupGeneration';
import { AIEngineConfig } from '../Common/ChatEngine/ChatEngine.types';
import { ActivationStrategy, GenerationMode } from '../../../shared/types/groupChat.types';
import type { Group } from '../../../shared/types/groupChat.types';
import './GroupChat.css';

interface GroupChatDialogProps {
  open: boolean;
  onClose: () => void;
}

interface DragCharacter {
  name: string;
  path: string;
  avatar?: string;
}

export const GroupChatDialog: React.FC<GroupChatDialogProps> = ({ open, onClose }) => {
  const { selectedGroup, editGroup } = useGroupChatStore();
  const { setting } = useSettingStore();
  const [isOver, setIsOver] = useState(false);
  const [dragChar, setDragChar] = useState<DragCharacter | null>(null);

  const engineConfig = useMemo<AIEngineConfig | null>(() => {
    if (!setting || !setting.aiEngines || setting.aiEngines.length === 0) return null;
    if (setting.activeEngineId) {
      return setting.aiEngines.find((e: any) => e.id === setting.activeEngineId) || null;
    }
    return setting.aiEngines[0] || null;
  }, [setting]);

  const [currentGroup, setCurrentGroup] = useState<Group | null>(selectedGroup);

  useEffect(() => {
    setCurrentGroup(selectedGroup);
  }, [selectedGroup]);

  const characters = useMemo<Map<string, CharacterCard>>(() => {
    const map = new Map<string, CharacterCard>();
    if (currentGroup) {
      currentGroup.members.forEach((member) => {
        map.set(member, {
          description: '',
          personality: '',
          scenario: '',
          mesExample: '',
          systemPrompt: '',
          talkativeness: 1,
          creatorComment: '',
          postHistoryInstructions: '',
          characterBook: {
            recursive: false,
            extensions: [],
            defaultMetadata: { position: 'before_char_def', disable: false },
          },
        });
      });
    }
    return map;
  }, [currentGroup]);

  const {
    state,
    sendMessage,
    cancelRequest,
    clearChat,
    stopAutoMode,
    groupedMessages,
  } = useGroupDialogueChat({
    group: currentGroup,
    characters,
    userName: 'User',
    engineConfig,
  });

  useEffect(() => {
    if (currentGroup) clearChat();
  }, [currentGroup?.id, clearChat]);

  const handleClose = useCallback(() => {
    if (state.isStreaming) cancelRequest();
    stopAutoMode();
    onClose();
  }, [state.isStreaming, cancelRequest, stopAutoMode, onClose]);

  const handleDragStart = useCallback((char: DragCharacter, e: React.DragEvent) => {
    e.dataTransfer.setData('application/json', JSON.stringify(char));
    e.dataTransfer.effectAllowed = 'copy';
    setDragChar(char);
  }, []);

  const handleDrop = useCallback(
    (char: DragCharacter) => {
      if (!currentGroup) return;
      if (currentGroup.members.includes(char.path) || currentGroup.disabled_members.includes(char.path)) {
        message.info('该角色已在群聊中');
        return;
      }
      setCurrentGroup((prev) =>
        prev
          ? {
              ...prev,
              members: [...prev.members, char.path],
              disabled_members: prev.disabled_members.filter((p) => p !== char.path),
            }
          : null
      );
      setDragChar(null);
    },
    [currentGroup]
  );

  const handleGroupCreated = useCallback(
    (group: Group) => {
      setCurrentGroup(group);
      editGroup(group);
    },
    [editGroup]
  );

  const handleRemoveMember = useCallback((path: string) => {
    setCurrentGroup((prev) =>
      prev
        ? {
            ...prev,
            members: prev.members.filter((m) => m !== path),
          }
        : null
    );
  }, []);

  const handleSaveSettings = useCallback(
    async (config: Partial<Group>) => {
      if (!currentGroup) return;
      const updated = await editGroup({ ...currentGroup, ...config });
      if (updated) {
        setCurrentGroup(updated);
      }
    },
    [currentGroup, editGroup]
  );

  if (!open) return null;

  return (
    <Modal
      open={open}
      onCancel={handleClose}
      footer={null}
      width="95vw"
      closable={false}
      className="gc-dialog"
      maskClosable={false}
      style={{ top: 20, maxWidth: '100%' }}
    >
      <div className="gc-layout">
        {/* 关闭按钮 */}
        <button className="gc-close-btn" onClick={handleClose}>
          <CloseOutlined style={{ fontSize: 16 }} />
        </button>

        {/* 左侧：角色列表 */}
        <div className="gc-layout-left">
          <CharacterListPanel
            selectedPaths={currentGroup?.members || []}
            onCharacterDragStart={handleDragStart}
          />
        </div>

        {/* 中间：拖拽区 + 聊天 */}
        <div className="gc-layout-center">
          <GroupDropZone
            group={currentGroup}
            characters={characters}
            isOver={isOver}
            onDrop={handleDrop}
            onGroupCreated={handleGroupCreated}
            onRemoveMember={handleRemoveMember}
            messages={groupedMessages}
            isStreaming={state.isStreaming}
            error={state.error}
            onSend={sendMessage}
            onCancel={cancelRequest}
            disabled={state.isLoading || state.isStreaming || !currentGroup}
            onStartGroup={() => {}}
          />
        </div>

        {/* 右侧：设置面板 */}
        <div className="gc-layout-right">
          <GroupSettingsPanel group={currentGroup} onSave={handleSaveSettings} />
        </div>
      </div>
    </Modal>
  );
};
