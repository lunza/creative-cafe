import React, { memo, useCallback, useEffect, useRef, useState } from 'react';
import { Button, Input, Spin, Alert, Space, Tag } from 'antd';
import { SendOutlined, StopOutlined, RobotOutlined } from '@ant-design/icons';
import type { AssistantMessage } from '@shared/types';
import AssistantSuggestionCard from './AssistantSuggestionCard';

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
  onRegenerate: (question: string) => void;
}

/**
 * 助手面板主体（Spec: add-ai-assistant-for-character-card-editor / Task 4）
 *
 * 负责：对话消息列表（用户/助手气泡）+ 建议卡片渲染 + 输入框 + 加载/错误/空状态。
 * 建议消息命中缓存时展示"基于之前的建议"标签与"重新获取建议"按钮。
 */
const CharacterCardAssistantPanel: React.FC<CharacterCardAssistantPanelProps> = ({
  messages,
  isLoading,
  error,
  onSend,
  onCancel,
  onRetry,
  onRegenerate,
}) => {
  const [input, setInput] = useState('');
  const listRef = useRef<HTMLDivElement>(null);

  // 新消息到达时自动滚动到底部
  useEffect(() => {
    const el = listRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages]);

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
              <div key={idx} style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 10 }}>
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

          // assistant 消息：找到前一条用户消息的内容（用于重新生成）
          const prevUserContent = idx > 0 && messages[idx - 1].role === 'user' ? messages[idx - 1].content : null;
          const hasSuggestions = (msg.suggestions?.length ?? 0) > 0;
          return (
            <div key={idx} style={{ display: 'flex', marginBottom: 10 }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                {msg.fromCache && prevUserContent && (
                  <Space size={4} style={{ marginBottom: 6 }}>
                    <Tag color="blue" style={{ fontSize: 11, marginRight: 0 }}>基于之前的建议</Tag>
                    <Button
                      type="link"
                      size="small"
                      style={{ fontSize: 11, padding: 0 }}
                      onClick={() => onRegenerate(prevUserContent)}
                    >
                      重新获取建议
                    </Button>
                  </Space>
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
                  {hasSuggestions ? (
                    <>
                      {(msg.suggestions ?? []).map((s, i) => (
                        <AssistantSuggestionCard key={i} suggestion={s} />
                      ))}
                      <div style={{ fontSize: 11, color: 'var(--text-tertiary, #666)', marginTop: 2 }}>
                        —— 可点击每条建议的复制按钮，将内容粘贴到编辑区域 ——
                      </div>
                    </>
                  ) : (
                    msg.content
                  )}
                </div>
              </div>
            </div>
          );
        })}

        {/* 加载指示 */}
        {isLoading && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '6px 2px' }}>
            <Spin size="small" />
            <span style={{ color: 'var(--text-secondary, #a0a0a0)', fontSize: 12.5 }}>正在分析角色卡内容并生成建议...</span>
            <Button type="link" size="small" icon={<StopOutlined />} style={{ fontSize: 12 }} onClick={onCancel}>
              取消
            </Button>
          </div>
        )}

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
          建议内容基于当前角色卡生成，修改角色卡后建议将自动更新
        </div>
      </div>
    </div>
  );
};

export default memo(CharacterCardAssistantPanel);