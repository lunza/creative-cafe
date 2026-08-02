/**
 * 可复用流式文本渲染组件
 *
 * 来源：Spec: optimize-agent-interaction-from-openclaw / M5-Task17
 * 决策：从 CharacterDialogueChat 的 ChatMessageBubble 中抽取流式渲染逻辑
 *
 * 职责：
 *  1. 渲染文本内容（支持/不支持 Markdown）
 *  2. 流式接收时显示闪烁光标
 *  3. 通过 enableMarkdown prop 控制是否渲染 Markdown
 */

import React from 'react';

export interface ChatStreamRendererProps {
  /** 文本内容 */
  content: string;
  /** 是否正在流式接收 */
  streaming?: boolean;
  /** 是否启用 Markdown 渲染（默认 false，agent 模式用纯文本） */
  enableMarkdown?: boolean;
  /** 自定义 Markdown 渲染器（启用 Markdown 时使用） */
  markdownRenderer?: (content: string) => React.ReactNode;
  /** 文字颜色 */
  color?: string;
}

export const ChatStreamRenderer: React.FC<ChatStreamRendererProps> = ({
  content,
  streaming = false,
  enableMarkdown = false,
  markdownRenderer,
  color,
}) => {
  return (
    <>
      {enableMarkdown && markdownRenderer
        ? markdownRenderer(content)
        : <span style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word', color }}>{content}</span>
      }
      {streaming && (
        <span
          style={{
            display: 'inline-block',
            width: '8px',
            height: '14px',
            marginLeft: '2px',
            background: 'var(--text-secondary, #999)',
            verticalAlign: 'text-bottom',
            animation: 'chatStreamRendererBlink 1s infinite',
          }}
        />
      )}
      <style>{`
        @keyframes chatStreamRendererBlink {
          0%, 50% { opacity: 1; }
          51%, 100% { opacity: 0; }
        }
      `}</style>
    </>
  );
};

export default ChatStreamRenderer;
