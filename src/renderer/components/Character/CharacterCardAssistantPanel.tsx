import React, { memo, useCallback, useEffect, useRef, useState } from 'react';
import { Button, Input, Spin, Alert, Tag, Tooltip } from 'antd';
import { SendOutlined, StopOutlined, RobotOutlined, RollbackOutlined, ReloadOutlined } from '@ant-design/icons';
import type { AssistantMessage } from '@shared/types';

const EXAMPLE_QUESTIONS = [
  '我想给这个角色添加一个能体现她正直善良的背景，我应该怎么做？',
  '我想为这个角色的购物场景添加对话样例，为我提供建议',
  '帮我优化系统提示词，让角色表现更生动自然',
  '当前角色性格设定是否自洽？请给出完善建议',
];

interface CharacterCardAssistantPanelProps {
  messages: AssistantMessage[];
  isLoading: boolean;
  error: string | null;
  onSend: (question: string, options?: { forceRegenerate?: boolean }) => Promise<void>;
  onCancel: () => void;
  onRetry: () => Promise<void>;
  /** 重新生成最后一条回复（由容器提供） */
  onRegenerateLast: () => void;
  /** 卷回到指定用户消息：返回消息内容（供回填输入框），找不到返回 null */
  onRollbackMessage: (timestamp: number) => string | null;
}

/**
 * 助手面板主体（Spec: add-ai-assistant-for-character-card-editor / Task 4）
 *
 * 负责：对话消息列表（用户/助手气泡，自然文本展示）+ 输入框 + 加载/错误/空状态。
 * 消息操作（hover 显示）：用户消息「卷回到输入框」，最后一条回复「重新生成」。
 */

/** hover 才显示的操作按钮组 */
const HoverActions: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [visible, setVisible] = useState(false);
  return (
    <div
      style={{ display: 'flex', gap: 2, opacity: visible ? 1 : 0, transition: 'opacity 0.15s' }}
      onMouseEnter={() => setVisible(true)}
      onMouseLeave={() => setVisible(false)}
    >
      {children}
    </div>
  );
};

const actionBtnStyle: React.CSSProperties = {
  fontSize: 11,
  padding: 0,
  height: 20,
  color: 'var(--text-secondary, #999)',
};
const CharacterCardAssistantPanel: React.FC<CharacterCardAssistantPanelProps> = ({
  messages,
  isLoading,
  error,
  onSend,
  onCancel,
  onRetry,
  onRegenerateLast,
  onRollbackMessage,
}) => {
  const [input, setInput] = useState('');
  const listRef = useRef<HTMLDivElement>(null);

  // 新消息到达时自动滚动到底部
  useEffect(() => {
    const el = listRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages]);

  /** 卷回：截断对话并回填输入框 */
  const handleRollback = useCallback((timestamp: number) => {
    const content = onRollbackMessage(timestamp);
    if (content) setInput(content);
  }, [onRollbackMessage]);

  const handleSend = useCallback(() => {
    const q = input.trim();
    if (!q || isLoading) return;
    setInput('');
    void onSend(q);
  }, [input, isLoading, onSend]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    // Enter 发送，Shift+Enter 换行
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  }, [handleSend]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      {/* 消息列表区 */}
      <div ref={listRef} style={{ flex: 1, overflowY: 'auto', padding: '4px 2px 8px' }}>
        {messages.length === 0 && !isLoading && (
          <div style={{ padding: '12px 4px' }}>
            <div style={{ textAlign: 'center', marginBottom: 12, color: 'var(--text-secondary, #a0a0a0)', fontSize: 13 }}>
              <RobotOutlined style={{ fontSize: 26, display: 'block', marginBottom: 8 }} />
              我是角色卡设计助手，基于当前已填写的角色卡内容提供针对性建议。
              <br />
              试试向我提问：
            </div>
            {EXAMPLE_QUESTIONS.map((q) => (
              <div
                key={q}
                onClick={() => !isLoading && void onSend(q)}
                style={{
                  marginBottom: 8,
                  padding: '8px 10px',
                  borderRadius: 8,
                  border: '1px dashed var(--border-base, #404040)',
                  fontSize: 12,
                  cursor: isLoading ? 'not-allowed' : 'pointer',
                  color: 'var(--text-primary, #ddd)',
                  transition: 'border-color 0.2s, background 0.2s',
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.borderColor = '#1890ff';
                  e.currentTarget.style.background = 'rgba(24,144,255,0.08)';
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.borderColor = 'var(--border-base, #404040)';
                  e.currentTarget.style.background = 'transparent';
                }}
              >
                {q}
              </div>
            ))}
          </div>
        )}

        {messages.map((msg, idx) => {
          if (msg.role === 'user') {
            return (
              <div key={idx} style={{ display: 'flex', justifyContent: 'flex-end', alignItems: 'center', gap: 4, marginBottom: 10 }}>
                <HoverActions>
                  <Tooltip title="卷回到输入框（移除该消息及之后的对话）">
                    <Button
                      type="text"
                      size="small"
                      icon={<RollbackOutlined />}
                      style={actionBtnStyle}
                      disabled={isLoading}
                      onClick={() => handleRollback(msg.timestamp)}
                    />
                  </Tooltip>
                </HoverActions>
                <div
                  style={{
                    maxWidth: '85%',
                    background: 'rgba(24, 144, 255, 0.15)',
                    border: '1px solid rgba(24,144,255,0.35)',
                    borderRadius: '10px 10px 2px 10px',
                    padding: '8px 12px',
                    fontSize: 13,
                    whiteSpace: 'pre-wrap',
                    wordBreak: 'break-word',
                    color: 'var(--text-primary, #fff)',
                  }}
                >
                  {msg.content}
                </div>
              </div>
            );
          }

          // 流式占位消息（最后一条 assistant 且内容为空）：不渲染空气泡，由底部 spinner 提示
          const isStreamingPlaceholder = !msg.content && isLoading && idx === messages.length - 1;
          if (isStreamingPlaceholder) return null;

          // 重新生成按钮：仅最后一条回复且非加载中
          const isLastAssistant = idx === messages.length - 1 && !!msg.content && !isLoading;
          return (
            <div key={idx} style={{ display: 'flex', marginBottom: 10 }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                {msg.fromCache && (
                  <Tag color="blue" style={{ fontSize: 11, marginBottom: 6 }}>来自之前的回复</Tag>
                )}
                <div
                  style={{
                    background: 'rgba(255,255,255,0.04)',
                    border: '1px solid var(--border-base, #404040)',
                    borderRadius: '10px 10px 10px 2px',
                    padding: '10px 12px',
                    fontSize: 13,
                    whiteSpace: 'pre-wrap',
                    wordBreak: 'break-word',
                    color: 'var(--text-primary, #fff)',
                  }}
                >
                  {msg.content}
                </div>
                {isLastAssistant && (
                  <HoverActions>
                    <Tooltip title="重新生成（忽略缓存）">
                      <Button
                        type="text"
                        size="small"
                        icon={<ReloadOutlined />}
                        style={actionBtnStyle}
                        onClick={onRegenerateLast}
                      />
                    </Tooltip>
                  </HoverActions>
                )}
              </div>
            </div>
          );
        })}

        {/* 加载指示：流式生成中（最后一条 assistant 已有内容）显示"正在生成"，否则显示"正在思考" */}
        {isLoading && (() => {
          const last = messages[messages.length - 1];
          const streaming = last?.role === 'assistant' && !!last.content;
          return (
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '6px 2px' }}>
              <Spin size="small" />
              <span style={{ color: 'var(--text-secondary, #a0a0a0)', fontSize: 12.5 }}>
                {streaming ? '正在生成...' : '正在思考...'}
              </span>
              <Button type="link" size="small" icon={<StopOutlined />} style={{ fontSize: 12 }} onClick={onCancel}>
                取消
              </Button>
            </div>
          );
        })()}

        {/* 错误状态 */}
        {error && !isLoading && (
          <Alert
            type="error"
            showIcon
            message={error}
            style={{ marginTop: 6 }}
            action={
              <Button size="small" danger onClick={() => void onRetry()}>
                重试
              </Button>
            }
          />
        )}
      </div>

      {/* 输入区 */}
      <div style={{ borderTop: '1px solid var(--border-base, #333)', paddingTop: 8 }}>
        <Input.TextArea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="输入你的问题，Enter 发送（Shift+Enter 换行）"
          autoSize={{ minRows: 2, maxRows: 4 }}
          disabled={isLoading}
          style={{ fontSize: 13 }}
        />
        <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 6 }}>
          <Button
            type="primary"
            size="small"
            icon={<SendOutlined />}
            disabled={isLoading || !input.trim()}
            onClick={handleSend}
          >
            发送
          </Button>
        </div>
        <div style={{ fontSize: 11, color: 'var(--text-tertiary, #666)', paddingTop: 2 }}>
          回复基于当前角色卡内容生成，修改角色卡后将重新生成
        </div>
      </div>
    </div>
  );
};

export default memo(CharacterCardAssistantPanel);