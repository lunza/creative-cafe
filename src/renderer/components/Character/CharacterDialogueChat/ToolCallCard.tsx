// 工具调用可视化卡片组件（Spec: optimize-agent-interaction-from-openclaw / M2-Task5）
//
// 展示单次工具调用的完整生命周期：工具名 + 参数摘要 + 状态徽章 + 耗时 + 展开/收起输出。
// 三态样式：pending（灰色脉冲动画）、success（绿色勾 + 耗时）、error（红色叉 + 错误信息 + 重试按钮）。
// 深色主题，与现有 ChatMessageBubble 样式一致。

import React, { useState, useMemo } from 'react';
import { CheckOutlined, CloseOutlined, ReloadOutlined } from '@ant-design/icons';
import type { ToolCallInfo } from './chatReducer';
import { themeTokens } from '../../../styles/themeTokens';

interface ToolCallCardProps {
  toolCall: ToolCallInfo;
  onRetry?: (toolCall: ToolCallInfo) => void;
}

// 状态对应的样式配置
const statusConfig = {
  pending: {
    borderColor: themeTokens.toolPendingBorder,
    badgeBg: themeTokens.toolPendingBg,
    badgeColor: themeTokens.toolPendingText,
    badgeText: '执行中',
    icon: null as React.ReactNode,
    animation: 'tool-call-pulse 1.5s ease-in-out infinite',
  },
  success: {
    borderColor: themeTokens.toolSuccessBorder,
    badgeBg: themeTokens.toolSuccessBg,
    badgeColor: themeTokens.toolSuccessText,
    badgeText: '成功',
    icon: <CheckOutlined style={{ fontSize: '10px' }} />,
    animation: 'none',
  },
  error: {
    borderColor: themeTokens.toolErrorBorder,
    badgeBg: themeTokens.toolErrorBg,
    badgeColor: themeTokens.toolErrorText,
    badgeText: '失败',
    icon: <CloseOutlined style={{ fontSize: '10px' }} />,
    animation: 'none',
  },
};

const ToolCallCard: React.FC<ToolCallCardProps> = ({ toolCall, onRetry }) => {
  const [expanded, setExpanded] = useState(false);

  const config = statusConfig[toolCall.status];

  // 计算耗时（毫秒）
  const durationMs = useMemo(() => {
    if (toolCall.startTime && toolCall.endTime) {
      return toolCall.endTime - toolCall.startTime;
    }
    return null;
  }, [toolCall.startTime, toolCall.endTime]);

  // 参数 JSON 字符串
  const argsJson = useMemo(() => {
    try {
      return JSON.stringify(toolCall.args, null, 2);
    } catch {
      return String(toolCall.args);
    }
  }, [toolCall.args]);

  // 参数摘要（折叠状态，前 100 字符）
  const argsSummary = useMemo(() => {
    const flat = argsJson.replace(/\s+/g, ' ').trim();
    return flat.length > 100 ? flat.substring(0, 100) + '...' : flat;
  }, [argsJson]);

  const hasArgs = toolCall.args && Object.keys(toolCall.args).length > 0;

  return (
    <>
      <style>{`
        @keyframes tool-call-pulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.5; }
        }
      `}</style>
      <div
        style={{
          borderRadius: '8px',
          background: 'var(--chat-bubble-assistant-bg)',
          border: `1px solid ${config.borderColor}`,
          overflow: 'hidden',
          transition: 'border-color 0.3s ease',
          animation: config.animation,
        }}
      >
        {/* 头部行：工具图标 + 工具名 + 状态徽章 + 耗时 */}
        <div
          onClick={() => setExpanded(prev => !prev)}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
            padding: '8px 12px',
            cursor: 'pointer',
            userSelect: 'none',
          }}
        >
          <span style={{ fontSize: '13px', flexShrink: 0 }}>🔧</span>
          <span style={{
            fontSize: '13px',
            fontWeight: 600,
            color: themeTokens.toolTitle,
            flex: 1,
            minWidth: 0,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}>
            {toolCall.toolName}
          </span>

          {/* 状态徽章 */}
          <span style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: '4px',
            fontSize: '11px',
            padding: '2px 8px',
            borderRadius: '10px',
            background: config.badgeBg,
            color: config.badgeColor,
            fontWeight: 500,
            flexShrink: 0,
          }}>
            {config.icon}
            {config.badgeText}
          </span>

          {/* 耗时 */}
          {durationMs !== null && (
            <span style={{
              fontSize: '11px',
              color: 'var(--chat-action-text, #9ca3af)',
              flexShrink: 0,
            }}>
              {durationMs}ms
            </span>
          )}

          {/* 展开/收起指示器 */}
          <span style={{
            fontSize: '10px',
            color: 'var(--chat-action-text, #9ca3af)',
            flexShrink: 0,
            transition: 'transform 0.3s ease',
            transform: expanded ? 'rotate(90deg)' : 'rotate(0deg)',
          }}>
            ▶
          </span>
        </div>

        {/* 折叠状态：参数摘要 */}
        {!expanded && hasArgs && (
          <div style={{
            padding: '0 12px 8px 28px',
            fontSize: '11px',
            color: 'var(--chat-action-text, #9ca3af)',
            fontFamily: 'monospace',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}>
            {argsSummary}
          </div>
        )}

        {/* 展开状态：完整参数 + 输出 */}
        {expanded && (
          <div
            style={{
              maxHeight: '400px',
              overflow: 'auto',
              transition: 'max-height 0.3s cubic-bezier(0.4, 0, 0.2, 1)',
            }}
          >
            {/* 完整参数 */}
            {hasArgs && (
              <div style={{ padding: '0 12px 8px 12px' }}>
                <div style={{
                  fontSize: '10px',
                  color: themeTokens.dim,
                  marginBottom: '4px',
                  textTransform: 'uppercase',
                  letterSpacing: '0.5px',
                }}>
                  参数
                </div>
                <pre style={{
                  margin: 0,
                  padding: '8px 10px',
                  background: themeTokens.code,
                  borderRadius: '6px',
                  fontSize: '11px',
                  fontFamily: 'monospace',
                  color: themeTokens.toolOutput,
                  overflow: 'auto',
                  whiteSpace: 'pre-wrap',
                  wordBreak: 'break-all',
                }}>
                  {argsJson}
                </pre>
              </div>
            )}

            {/* 输出结果 */}
            {toolCall.result && (
              <div style={{ padding: '0 12px 8px 12px' }}>
                <div style={{
                  fontSize: '10px',
                  color: themeTokens.dim,
                  marginBottom: '4px',
                  textTransform: 'uppercase',
                  letterSpacing: '0.5px',
                }}>
                  输出
                </div>
                <pre style={{
                  margin: 0,
                  padding: '8px 10px',
                  background: themeTokens.code,
                  borderRadius: '6px',
                  fontSize: '11px',
                  fontFamily: 'monospace',
                  color: themeTokens.toolOutput,
                  overflow: 'auto',
                  whiteSpace: 'pre-wrap',
                  wordBreak: 'break-all',
                  maxHeight: '200px',
                }}>
                  {toolCall.result}
                </pre>
              </div>
            )}

            {/* 错误信息 */}
            {toolCall.error && (
              <div style={{ padding: '0 12px 8px 12px' }}>
                <div style={{
                  fontSize: '10px',
                  color: themeTokens.error,
                  marginBottom: '4px',
                  textTransform: 'uppercase',
                  letterSpacing: '0.5px',
                }}>
                  错误
                </div>
                <pre style={{
                  margin: 0,
                  padding: '8px 10px',
                  background: themeTokens.toolErrorBg,
                  borderRadius: '6px',
                  fontSize: '11px',
                  fontFamily: 'monospace',
                  color: themeTokens.toolErrorText,
                  overflow: 'auto',
                  whiteSpace: 'pre-wrap',
                  wordBreak: 'break-all',
                }}>
                  {toolCall.error}
                </pre>
                {/* 重试按钮 */}
                {onRetry && (
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      onRetry(toolCall);
                    }}
                    style={{
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: '4px',
                      marginTop: '8px',
                      padding: '4px 12px',
                      fontSize: '12px',
                      borderRadius: '6px',
                      border: `1px solid ${themeTokens.toolErrorBorder}`,
                      background: themeTokens.toolErrorBg,
                      color: themeTokens.toolErrorText,
                      cursor: 'pointer',
                      transition: 'all 0.2s ease',
                    }}
                    onMouseEnter={(e) => {
                      e.currentTarget.style.background = 'var(--tool-error-bg)';
                      e.currentTarget.style.borderColor = 'var(--tool-error-border)';
                      e.currentTarget.style.filter = 'brightness(1.2)';
                    }}
                    onMouseLeave={(e) => {
                      e.currentTarget.style.background = 'var(--tool-error-bg)';
                      e.currentTarget.style.borderColor = 'var(--tool-error-border)';
                      e.currentTarget.style.filter = 'none';
                    }}
                  >
                    <ReloadOutlined style={{ fontSize: '11px' }} />
                    重试
                  </button>
                )}
              </div>
            )}
          </div>
        )}
      </div>
    </>
  );
};

export default ToolCallCard;
