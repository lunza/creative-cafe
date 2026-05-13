import React, { useState, useCallback, useRef } from 'react';
import { PlusOutlined, DeleteOutlined, UserAddOutlined, TeamOutlined, SendOutlined, StopOutlined } from '@ant-design/icons';
import { message } from 'antd';
import { ActivationStrategy, GenerationMode } from '../../../shared/types/groupChat.types';
import { Group } from '../../../shared/types/groupChat.types';
import { CharacterCard } from '../../hooks/useGroupGeneration';
import { GroupChatMessages } from './GroupChatMessages';
import type { GroupDialogueMessage } from '../../types/groupChat.types';
import './GroupChat.css';

interface CharacterInfo {
  name: string;
  path: string;
  avatar?: string;
}

interface GroupDropZoneProps {
  group: Group | null;
  characters: Map<string, CharacterCard>;
  isOver: boolean;
  onDrop: (character: CharacterInfo) => void;
  onGroupCreated: (group: Group) => void;
  onRemoveMember: (path: string) => void;
  messages: GroupDialogueMessage[];
  isStreaming: boolean;
  error: string | null;
  onSend: (text: string) => Promise<void>;
  onCancel: () => void;
  disabled: boolean;
  onStartGroup: () => void;
}

export const GroupDropZone: React.FC<GroupDropZoneProps> = ({
  group,
  characters,
  isOver,
  onDrop,
  onGroupCreated,
  onRemoveMember,
  messages,
  isStreaming,
  error,
  onSend,
  onCancel,
  disabled,
  onStartGroup,
}) => {
  const [groupName, setGroupName] = useState(group?.name || '新群聊');
  const [groupDescription, setGroupDescription] = useState('');
  const [inputValue, setInputValue] = useState('');
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const dropZoneRef = useRef<HTMLDivElement>(null);

  const members = group?.members || [];
  const disabledMembers = group?.disabled_members || [];

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      const data = e.dataTransfer.getData('application/json');
      if (data) {
        try {
          const char: CharacterInfo = JSON.parse(data);
          onDrop(char);
        } catch {
          // ignore
        }
      }
    },
    [onDrop]
  );

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
  }, []);

  const handleCreateGroup = useCallback(() => {
    const newGroup: Group = {
      id: crypto.randomUUID(),
      name: groupName || '新群聊',
      description: groupDescription,
      members: members.filter((m) => !disabledMembers.includes(m)),
      disabled_members: [...disabledMembers],
      activation_strategy: ActivationStrategy.NATURAL,
      generation_mode: GenerationMode.SWAP,
      auto_mode_delay: 5,
      generation_mode_join_prefix: '',
      generation_mode_join_suffix: '',
      allow_self_respond: false,
    };
    onGroupCreated(newGroup);
    message.success('群聊已创建');
  }, [groupName, groupDescription, members, disabledMembers, onGroupCreated]);

  const handleSend = useCallback(async () => {
    const text = inputValue.trim();
    if (!text || disabled) return;
    setInputValue('');
    await onSend(text);
  }, [inputValue, disabled, onSend]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        handleSend();
      }
    },
    [handleSend]
  );

  React.useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
      textareaRef.current.style.height = `${textareaRef.current.scrollHeight}px`;
    }
  }, [inputValue]);

  React.useEffect(() => {
    setGroupName(group?.name || '新群聊');
  }, [group?.name]);

  const avatarCollage = members.slice(0, 5).map((path) => {
    const info = characters.get(path);
    return { name: info?.name || path.split('/').pop() || '?', avatar: info?.avatar || '' };
  });

  return (
    <div className="gc-panel gc-panel-center">
      {/* 上部：拖拽放置区 + 群聊信息 */}
      <div
        className={`gc-drop-zone ${isOver ? 'gc-drop-zone-over' : ''} ${members.length > 0 ? 'gc-drop-zone-active' : ''}`}
        onDrop={handleDrop}
        onDragOver={handleDragOver}
        ref={dropZoneRef}
      >
        {members.length === 0 ? (
          <div className="gc-drop-zone-empty">
            <div className="gc-drop-zone-icon">
              <UserAddOutlined style={{ fontSize: 40 }} />
            </div>
            <h3>拖拽角色到此处创建群聊</h3>
            <p>从左侧角色列表拖拽角色卡片到这里</p>
          </div>
        ) : (
          <div className="gc-drop-zone-content">
            {/* 群聊标题编辑 */}
            <div className="gc-group-title-row">
              <input
                className="gc-group-name-input"
                value={groupName}
                onChange={(e) => setGroupName(e.target.value)}
                onBlur={handleCreateGroup}
                onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); handleCreateGroup(); } }}
              />
              <span className="gc-group-member-count">{members.length} 位成员</span>
            </div>

            {/* 头像拼贴 */}
            <div className="gc-avatar-collage">
              {avatarCollage.map((a, i) => (
                <div key={i} className="gc-avatar-collage-item" style={{ marginLeft: i > 0 ? -8 : 0, zIndex: 5 - i }}>
                  {a.avatar ? (
                    <img src={a.avatar} alt={a.name} />
                  ) : (
                    <span>{a.name.charAt(0)}</span>
                  )}
                </div>
              ))}
              {members.length > 5 && (
                <div className="gc-avatar-collage-more" style={{ marginLeft: -8, zIndex: 0 }}>
                  +{members.length - 5}
                </div>
              )}
              {/* 添加按钮 */}
              <div className="gc-avatar-collage-add">
                <PlusOutlined style={{ fontSize: 12 }} />
              </div>
            </div>

            {/* 成员标签 */}
            <div className="gc-member-tags">
              {members.map((path) => {
                const info = characters.get(path);
                const name = info?.name || path.split('/').pop() || '?';
                return (
                  <span key={path} className="gc-member-tag">
                    <span className="gc-member-tag-dot" />
                    {name}
                    <button className="gc-member-tag-remove" onClick={() => onRemoveMember(path)}>
                      <DeleteOutlined style={{ fontSize: 10 }} />
                    </button>
                  </span>
                );
              })}
            </div>

            {/* 开始群聊按钮 */}
            {messages.length === 0 && (
              <button className="gc-start-chat-btn" onClick={onStartGroup}>
                <SendOutlined /> 开始群聊
              </button>
            )}
          </div>
        )}
      </div>

      {/* 下部：消息展示 + 输入 */}
      <div className="gc-chat-area">
        <GroupChatMessages
          messages={messages}
          isStreaming={isStreaming}
          error={error}
          membersCount={members.length}
        />

        {members.length > 0 && (
          <div className="gc-input-bar">
            <textarea
              ref={textareaRef}
              className="gc-input-textarea"
              value={inputValue}
              onChange={(e) => setInputValue(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder={isStreaming ? '正在生成回复...' : '输入消息，Enter 发送，Shift+Enter 换行'}
              disabled={disabled}
              rows={1}
            />
            {isStreaming ? (
              <button className="gc-input-btn gc-input-btn-stop" onClick={onCancel}>
                <StopOutlined style={{ fontSize: 16 }} />
              </button>
            ) : (
              <button
                className="gc-input-btn gc-input-btn-send"
                onClick={handleSend}
                disabled={disabled || !inputValue.trim()}
              >
                <SendOutlined style={{ fontSize: 14 }} />
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
};
