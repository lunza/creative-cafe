/**
 * 游戏主页面左侧叙事面板（Task 11 / SubTask 11.2）
 *
 * 职责：
 * - 流式文本显示区：使用 react-markdown + rehype-raw 渲染 narrativeLog 中的消息
 * - 自动滚动到底部（最新消息）
 * - 当前正在生成时（isGenerating=true）显示 typing 指示器
 * - 选项区：当最新 assistant 消息包含 options 字段时渲染按钮列表
 *   （注：当前 GameNarrativeMessage 类型未定义 options 字段，本组件通过
 *   防御性读取 (message as any).options 支持未来扩展，无需修改类型）
 * - 用户输入框：自由文本输入，回车或点击发送按钮触发 generateNarrative
 *
 * 设计要点：
 * - **流式订阅位置**：gameStore 在模块加载时已通过 setupGameEventListeners() 订阅
 *   了 onNarrativeChunk / onNarrativeComplete / onNarrativeError / onTableUpdated
 *   4 个 IPC 事件并自动更新 narrativeLog；本组件**不重复订阅**，只消费 store 状态。
 *   组件内的 useEffect 仅用于日志记录（无操作副作用），便于将来调试。
 * - **生成中禁用输入框**：避免用户在等待 AI 回复时重复触发 generateNarrative
 *   导致 currentStreamingMessageId 状态错乱
 * - **空消息安全**：narrativeLog 为空时显示 Empty 占位提示
 *
 * 参考：
 * - src/renderer/components/Character/CharacterDialogueChat/MessageRenderer/MessageRenderer.tsx
 *   （react-markdown + rehype-raw + rehype-sanitize 用法）
 * - src/renderer/stores/gameStore.ts（narrativeLog / generateNarrative / isGenerating）
 */

import React, { useEffect, useRef, useState, useMemo } from 'react';
import { Button, Empty, Input, Space, Tag } from 'antd';
import { SendOutlined } from '@ant-design/icons';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeRaw from 'rehype-raw';
import { useGameStore } from '../../../stores/gameStore';
import type { GameNarrativeMessage } from '../../../../shared/types/game.types';

/**
 * 选项数据结构（未来扩展，当前 GameNarrativeMessage 未定义 options 字段）
 *
 * 当 AI 返回结构化选项时，将在 message.options 中存放 Option[] 数组。
 * 本组件通过 (message as any).options 防御性读取，避免修改类型定义。
 */
interface NarrativeOption {
  /** 选项文本（按钮显示） */
  label: string;
  /** 触发的 userAction 字符串（如 "build:farm" / "end_turn" / 自由文本） */
  action: string;
}

const NarrativePanel: React.FC = () => {
  const narrativeLog = useGameStore((s) => s.narrativeLog);
  const isGenerating = useGameStore((s) => s.isGenerating);
  const currentSaveId = useGameStore((s) => s.currentSaveId);
  const generateNarrative = useGameStore((s) => s.generateNarrative);

  const [inputText, setInputText] = useState('');
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const messagesContainerRef = useRef<HTMLDivElement>(null);

  // ----- 流式订阅：store 已订阅，组件无需重复订阅 -----
  // 此 effect 仅用于日志记录，便于将来调试流式事件链路；无操作副作用
  useEffect(() => {
    // store 模块加载时已通过 setupGameEventListeners() 订阅 4 个 IPC 事件
    // 组件只需消费 store 状态（narrativeLog / isGenerating / error）
    // 此处保留空 effect 作为日志埋点位置，便于将来插入调试代码
    return () => {
      // 无需清理（store 单例订阅与组件生命周期无关）
    };
  }, []);

  // ----- 自动滚动到底部（narrativeLog 或 isGenerating 变化时触发） -----
  useEffect(() => {
    if (messagesEndRef.current) {
      messagesEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [narrativeLog, isGenerating]);

  // ----- 提取最新 assistant 消息的选项（如有） -----
  const latestOptions = useMemo<NarrativeOption[]>(() => {
    if (narrativeLog.length === 0) return [];
    // 从后向前查找最新的 assistant 消息
    for (let i = narrativeLog.length - 1; i >= 0; i--) {
      const msg = narrativeLog[i];
      if (msg.role === 'assistant') {
        // 防御性读取 options 字段（类型未定义，但支持未来扩展）
        const opts = (msg as unknown as { options?: NarrativeOption[] }).options;
        if (Array.isArray(opts) && opts.length > 0) {
          return opts;
        }
        return [];
      }
    }
    return [];
  }, [narrativeLog]);

  // ----- 发送用户行动 -----
  const handleSend = () => {
    const text = inputText.trim();
    if (!text || isGenerating) return;
    if (!currentSaveId) return;
    void generateNarrative({ userAction: text });
    setInputText('');
  };

  // ----- 点击选项按钮 -----
  const handleOptionClick = (option: NarrativeOption) => {
    if (isGenerating || !currentSaveId) return;
    void generateNarrative({ userAction: option.action });
  };

  // ----- 输入框回车发送（Shift+Enter 换行） -----
  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  return (
    <div className="narrative-panel" data-testid="narrative-panel">
      {/* 流式文本显示区 */}
      <div
        className="narrative-panel__messages"
        ref={messagesContainerRef}
        data-testid="narrative-panel-messages"
      >
        {narrativeLog.length === 0 ? (
          <Empty
            description="游戏尚未开始，请在下方输入行动或选择选项"
            style={{ marginTop: 80 }}
          />
        ) : (
          <>
            {narrativeLog.map((msg) => (
              <NarrativeMessageItem key={msg.id} message={msg} />
            ))}
            {/* typing 指示器：仅 isGenerating 且最后一条非 assistant 流式追加时显示 */}
            {isGenerating && <TypingIndicator />}
            <div ref={messagesEndRef} />
          </>
        )}
      </div>

      {/* 选项区（如有） */}
      {latestOptions.length > 0 && (
        <div
          className="narrative-panel__options"
          data-testid="narrative-panel-options"
          style={{
            padding: '8px 12px',
            borderTop: '1px solid rgba(255, 255, 255, 0.1)',
            background: 'rgba(0, 0, 0, 0.15)'
          }}
        >
          <Space wrap size="small">
            {latestOptions.map((opt, idx) => (
              <Button
                key={`${opt.action}-${idx}`}
                onClick={() => handleOptionClick(opt)}
                disabled={isGenerating}
                data-testid={`narrative-option-${idx}`}
              >
                {opt.label}
              </Button>
            ))}
          </Space>
        </div>
      )}

      {/* 用户输入框 */}
      <div className="narrative-panel__input" data-testid="narrative-panel-input">
        <Space.Compact style={{ width: '100%' }}>
          <Input.TextArea
            value={inputText}
            onChange={(e) => setInputText(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={
              isGenerating ? 'AI 正在生成回复，请稍候...' : '输入你的行动...（Enter 发送，Shift+Enter 换行）'
            }
            disabled={isGenerating}
            autoSize={{ minRows: 1, maxRows: 4 }}
            style={{ resize: 'none' }}
          />
          <Button
            type="primary"
            icon={<SendOutlined />}
            onClick={handleSend}
            disabled={isGenerating || !inputText.trim()}
            data-testid="narrative-panel-send"
          >
            发送
          </Button>
        </Space.Compact>
      </div>
    </div>
  );
};

/**
 * 单条叙事消息渲染
 *
 * - role=user：玩家行动（右对齐气泡，蓝色背景）
 * - role=assistant：AI 叙事（左对齐，markdown 渲染）
 * - role=system：系统提示（居中，灰色文本）
 */
const NarrativeMessageItem: React.FC<{ message: GameNarrativeMessage }> = ({ message }) => {
  const { role, content, speakerName, turn } = message;

  if (role === 'system') {
    return (
      <div
        className="narrative-message narrative-message--system"
        data-testid="narrative-message-system"
        style={{
          textAlign: 'center',
          padding: '8px 12px',
          margin: '4px 0',
          color: 'rgba(255, 255, 255, 0.45)',
          fontSize: 12,
          fontStyle: 'italic'
        }}
      >
        {content}
      </div>
    );
  }

  if (role === 'user') {
    return (
      <div
        className="narrative-message narrative-message--user"
        data-testid="narrative-message-user"
        style={{
          display: 'flex',
          justifyContent: 'flex-end',
          margin: '8px 0'
        }}
      >
        <div
          style={{
            maxWidth: '80%',
            padding: '8px 12px',
            borderRadius: '12px',
            background: 'rgba(24, 144, 255, 0.15)',
            border: '1px solid rgba(24, 144, 255, 0.3)',
            whiteSpace: 'pre-wrap',
            wordBreak: 'break-word'
          }}
        >
          {content}
        </div>
      </div>
    );
  }

  // assistant
  return (
    <div
      className="narrative-message narrative-message--assistant"
      data-testid="narrative-message-assistant"
      style={{ margin: '8px 0' }}
    >
      {(speakerName || turn !== undefined) && (
        <div style={{ marginBottom: 4, fontSize: 12, color: 'rgba(255, 255, 255, 0.55)' }}>
          {speakerName && <Tag color="purple" style={{ marginRight: 6 }}>{speakerName}</Tag>}
          {turn !== undefined && <span>回合 {turn}</span>}
        </div>
      )}
      <div
        className="narrative-message__content"
        style={{
          padding: '12px 16px',
          borderRadius: '12px',
          background: 'rgba(255, 255, 255, 0.05)',
          border: '1px solid rgba(255, 255, 255, 0.08)',
          color: 'inherit',
          lineHeight: 1.7,
          wordBreak: 'break-word'
        }}
      >
        <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeRaw]}>
          {content}
        </ReactMarkdown>
      </div>
    </div>
  );
};

/**
 * Typing 指示器（生成中）
 *
 * 三点闪烁动画，表示 AI 正在生成回复。
 */
const TypingIndicator: React.FC = () => {
  return (
    <div
      className="narrative-panel__typing"
      data-testid="narrative-panel-typing"
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        margin: '8px 0',
        padding: '8px 12px',
        color: 'rgba(255, 255, 255, 0.55)',
        fontSize: 12
      }}
    >
      <span className="typing-dot" style={typingDotStyle(0)}>·</span>
      <span className="typing-dot" style={typingDotStyle(1)}>·</span>
      <span className="typing-dot" style={typingDotStyle(2)}>·</span>
      <span>AI 正在思考...</span>
    </div>
  );
};

/** Typing 点的样式（CSS-in-JS 避免污染全局样式） */
function typingDotStyle(index: number): React.CSSProperties {
  return {
    fontSize: 24,
    lineHeight: 1,
    animation: `typing-blink 1.4s infinite ${index * 0.2}s`,
    color: 'rgba(24, 144, 255, 0.8)'
  };
}

export default NarrativePanel;
export { NarrativePanel };
