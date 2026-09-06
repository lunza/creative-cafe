import React, { memo, useEffect, useState } from 'react';
import { Button } from 'antd';
import { RobotOutlined, CloseOutlined, ClearOutlined } from '@ant-design/icons';
import type { UseCharacterCardAssistantResult } from './hooks/useCharacterCardAssistant';
import CharacterCardAssistantPanel from './CharacterCardAssistantPanel';

interface CharacterCardAssistantProps {
  /** 面板是否展开（由外部入口按钮控制） */
  open: boolean;
  /** 助手 hook 结果（由 CharacterEditModal 实例化并传入） */
  assistant: UseCharacterCardAssistantResult;
}

/**
 * 悬浮助手面板容器（Spec: add-ai-assistant-for-character-card-editor / Task 5）
 *
 * 定位：以绝对定位悬浮在角色卡编辑弹窗（Modal）右侧内容区域。
 * 行为：
 * - 外部点击不自动收回（不注册任何外部点击关闭逻辑），由右上角关闭按钮手动收起
 * - 展开/收起使用 CSS transition 动画（opacity + translateX）
 * - React.memo 减少无关重渲染
 */
const CharacterCardAssistant: React.FC<CharacterCardAssistantProps> = ({ open, assistant }) => {
  const {
    messages,
    isLoading,
    error,
    sendQuestion,
    cancel,
    retry,
    regenerate,
    rollbackToMessage,
    closePanel,
    clear,
  } = assistant;

  // 关闭动画：open=false 时先播放淡出动画（200ms），再卸载
  const [rendered, setRendered] = useState<boolean>(open);
  useEffect(() => {
    if (open) {
      setRendered(true);
    } else {
      const timer = setTimeout(() => setRendered(false), 200);
      return () => clearTimeout(timer);
    }
  }, [open]);

  if (!rendered) return null;

  return (
    <div
      style={{
        position: 'absolute',
        top: 52,
        right: 8,
        width: 360,
        height: 'min(calc(100vh - 220px), 560px)',
        minHeight: 320,
        zIndex: 10,
        display: 'flex',
        flexDirection: 'column',
        background: 'var(--bg-panel, #1f1f1f)',
        border: '1px solid var(--border-base, #404040)',
        borderRadius: 10,
        boxShadow: '0 6px 24px rgba(0,0,0,0.45)',
        opacity: open ? 1 : 0,
        transform: open ? 'translateX(0)' : 'translateX(24px)',
        transition: 'opacity 0.2s ease, transform 0.2s ease',
      }}
    >
      {/* 头部：标题 + 清空 + 关闭 */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 6,
          padding: '10px 12px',
          borderBottom: '1px solid var(--border-base, #333)',
          flexShrink: 0,
        }}
      >
        <span style={{ color: '#1890ff' }}>
          <RobotOutlined />
        </span>
        <span style={{ fontWeight: 600, fontSize: 14, flex: 1, color: 'var(--text-primary, #fff)' }}>
          智能助手
        </span>
        <Button
          type="text"
          size="small"
          icon={<ClearOutlined />}
          onClick={clear}
          title="清空对话"
          style={{ color: 'var(--text-secondary, #aaa)' }}
        />
        <Button
          type="text"
          size="small"
          icon={<CloseOutlined />}
          onClick={closePanel}
          title="关闭助手（外部点击不会自动关闭）"
          style={{ color: 'var(--text-secondary, #aaa)' }}
        />
      </div>

      {/* 主体 */}
      <div style={{ flex: 1, padding: '10px 12px', overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
        <CharacterCardAssistantPanel
          messages={messages}
          isLoading={isLoading}
          error={error}
          onSend={sendQuestion}
          onCancel={cancel}
          onRetry={() => retry()}
          onRegenerateLast={() => void regenerate()}
          onRollbackMessage={rollbackToMessage}
        />
      </div>
    </div>
  );
};

export default memo(CharacterCardAssistant);