import React, { useState, useRef, useEffect, useMemo, useCallback } from 'react';
import { Button, Tooltip, Select, message } from 'antd';
import { SendOutlined, StopOutlined, ClearOutlined, RobotOutlined, LoadingOutlined, HighlightOutlined } from '@ant-design/icons';
import { SlashCommandAutoComplete, slashCommandRegistry, registerBuiltinCommands, setSlashCommandCallbacks } from '../../Common/SlashCommand';
import type { SlashCommand } from '../../Common/SlashCommand';
import { QuickActionsMenu } from '../../Common/QuickActions';
import type { QuickActionItem } from '../../Common/QuickActions';
import TokenUsageBar from './TokenUsageBar';

interface ChatInputBarProps {
  onSend: (message: string) => void;
  onCancel?: () => void;
  onStopOrganizing?: () => void;
  disabled?: boolean;
  isStreaming?: boolean;
  isOrganizing?: boolean;
  placeholder?: string;
  // 新增 props（Spec: add-ai-user-reply-button）
  onGenerateUserReply?: (currentInput?: string) => void;
  isGeneratingUserReply?: boolean;
  generatedReplyText?: string;
  onGeneratedReplyTextConsumed?: () => void;
  // 人称属性 props（Spec: add-person-attribute-to-ai-reply）
  userReplyPerson?: 'first' | 'second' | 'third';
  onUserReplyPersonChange?: (person: 'first' | 'second' | 'third') => void;
  // 润色输入 props（Spec: refine-user-input-text）
  onPolishInput?: (text: string) => void;
  isPolishingInput?: boolean;
  polishFlashKey?: number;
  // 斜杠命令 & 快捷操作回调（Spec: optimize-agent-interaction-from-openclaw / M1）
  onRetry?: () => void;
  onContinue?: () => void;
  onClear?: () => void;
  onReset?: () => void;
  quickActionItems?: {
    dialogueActions?: QuickActionItem[];
    contentActions?: QuickActionItem[];
    settingActions?: QuickActionItem[];
  };
  // Token 使用量进度条（Spec: optimize-agent-interaction-from-openclaw / M3-Task11）
  tokenUsage?: { used: number; total: number } | null;
  onCompressContext?: () => void;
  isCompressing?: boolean;
}

const ChatInputBar: React.FC<ChatInputBarProps> = ({
  onSend,
  onCancel,
  onStopOrganizing,
  disabled = false,
  isStreaming = false,
  isOrganizing = false,
  placeholder = 'Type a message...',
  onGenerateUserReply,
  isGeneratingUserReply = false,
  generatedReplyText,
  onGeneratedReplyTextConsumed,
  userReplyPerson = 'first',
  onUserReplyPersonChange,
  onPolishInput,
  isPolishingInput = false,
  polishFlashKey,
  onRetry,
  onContinue,
  onClear,
  onReset,
  quickActionItems,
  tokenUsage,
  onCompressContext,
  isCompressing,
}) => {
  const [input, setInput] = useState('');
  const [flashBorder, setFlashBorder] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // 斜杠命令状态（Spec: optimize-agent-interaction-from-openclaw / M1-Task1）
  const [slashVisible, setSlashVisible] = useState(false);
  const [slashQuery, setSlashQuery] = useState('');
  const inputContainerRef = useRef<HTMLDivElement>(null);

  // 注册斜杠命令回调（组件挂载时注入实际处理函数）
  useEffect(() => {
    setSlashCommandCallbacks({
      onReset: () => { onReset?.(); },
      onRetry: () => { onRetry?.(); },
      onContinue: () => { onContinue?.(); },
      onPolish: () => { onPolishInput?.(input); },
      onAIReply: () => { onGenerateUserReply?.(input.trim() || undefined); },
      onClear: () => { onClear?.(); },
      onModelChange: (model: string) => { message.info(`模型切换功能开发中: ${model}`); },
      onHelp: () => {
        const cmds = slashCommandRegistry.getAll();
        const helpText = cmds.map(c => `/${c.name} - ${c.description}`).join('\n');
        message.info('可用命令:\n' + helpText, 10);
      },
    });
    registerBuiltinCommands();
  }, [onReset, onRetry, onContinue, onPolishInput, onGenerateUserReply, onClear, input]);

  // 斜杠命令过滤列表
  const slashCommands = useMemo(() => {
    return slashCommandRegistry.search(slashQuery);
  }, [slashQuery]);

  // 处理输入变化，检测斜杠命令
  const handleInputChange = useCallback((e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const value = e.target.value;
    setInput(value);

    // 检测斜杠命令前缀
    if (value.startsWith('/') && !isStreaming && !isOrganizing) {
      const afterSlash = value.slice(1);
      // 检查是否有空格（表示命令名已完成，开始输入参数）
      const spaceIdx = afterSlash.indexOf(' ');
      if (spaceIdx >= 0) {
        const cmdName = afterSlash.slice(0, spaceIdx);
        const cmd = slashCommandRegistry.get(cmdName);
        if (cmd) {
          // 命令已匹配，隐藏补全（参数输入阶段暂不补全参数）
          setSlashVisible(false);
        } else {
          setSlashVisible(false);
        }
      } else {
        // 命令名输入阶段
        setSlashQuery(afterSlash);
        setSlashVisible(true);
      }
    } else {
      setSlashVisible(false);
    }
  }, [isStreaming, isOrganizing]);

  // 选择斜杠命令
  const handleSlashCommandSelect = useCallback((cmd: SlashCommand) => {
    setSlashVisible(false);
    setInput('');
    // 执行命令
    cmd.handler('', { input: '', characterCardId: undefined });
  }, []);

  // 关闭斜杠补全
  const handleSlashClose = useCallback(() => {
    setSlashVisible(false);
  }, []);

  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
      textareaRef.current.style.height = `${Math.min(textareaRef.current.scrollHeight, 150)}px`;
    }
  }, [input]);

  // 当外部传入生成文本时，使用 document.execCommand('insertText') 填入 textarea 并注册浏览器 undo stack，
  // 使 Ctrl+Z 可回退到润色前文本（Spec: fix-polish-input-undo-and-target / Bug 1 修复）
  // 该机制同时服务于 AI回复 / 润色 / 卷回 三条 generatedReplyText 填充路径（正向副作用）
  // execCommand 已废弃但在 Chromium/Electron 中仍受支持，且是唯一能注册 undo stack 的方式
  useEffect(() => {
    if (generatedReplyText && generatedReplyText.length > 0) {
      // 暂存到局部常量，防止 onGeneratedReplyTextConsumed 清空后闭包失效
      const textToInsert = generatedReplyText;
      onGeneratedReplyTextConsumed?.();
      // 异步执行，确保 textarea 已渲染
      setTimeout(() => {
        if (textareaRef.current) {
          textareaRef.current.focus();
          // 全选当前内容，便于 execCommand 替换
          textareaRef.current.select();
          let inserted = false;
          try {
            // execCommand('insertText') 替换选区并注册到浏览器 undo stack
            inserted = document.execCommand('insertText', false, textToInsert);
          } catch {
            inserted = false;
          }
          // Fallback：execCommand 不支持时直接 setInput（无 undo 支持，但保证功能可用）
          if (!inserted) {
            setInput(textToInsert);
          }
          // 无论哪种路径，光标定位到末尾
          const len = textToInsert.length;
          textareaRef.current.setSelectionRange(len, len);
        }
      }, 0);
    }
  }, [generatedReplyText, onGeneratedReplyTextConsumed]);

  // 润色完成时的边框高亮动画（Spec: refine-user-input-text / Task 3.4）
  useEffect(() => {
    if (polishFlashKey && polishFlashKey > 0) {
      setFlashBorder(true);
      const timer = setTimeout(() => setFlashBorder(false), 600);
      return () => clearTimeout(timer);
    }
  }, [polishFlashKey]);

  const handleSend = () => {
    if (input.trim() && !disabled) {
      onSend(input.trim());
      setInput('');
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    // 斜杠命令补全可见时，Enter 由补全组件处理（capture 阶段），不触发发送
    if (slashVisible) {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
      }
      return;
    }
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  return (
    <div style={{
      display: 'flex',
      gap: '12px',
      padding: '16px 20px',
      background: 'var(--chat-input-bg, rgba(30, 30, 46, 0.6))',
      backdropFilter: 'blur(10px)',
      borderTop: '1px solid var(--chat-input-border, rgba(255, 255, 255, 0.1))',
    }}>
      <style>{`
        .person-select-dropdown .ant-select-item {
          color: #e2e8f0 !important;
        }
        .person-select-dropdown .ant-select-item-option-active {
          background: rgba(99, 102, 241, 0.2) !important;
        }
        .person-select-dropdown .ant-select-item-option-selected {
          background: rgba(99, 102, 241, 0.3) !important;
        }
      `}</style>
      {/* 快捷操作菜单（Spec: optimize-agent-interaction-from-openclaw / M1-Task3） */}
      {/* ⚡按钮，聚合常用操作，在非流式/非整理状态下显示 */}
      {!isStreaming && !isOrganizing && quickActionItems && (
        <div style={{ alignSelf: 'center', flexShrink: 0 }}>
          <QuickActionsMenu
            dialogueActions={quickActionItems.dialogueActions}
            contentActions={quickActionItems.contentActions}
            settingActions={quickActionItems.settingActions}
            disabled={disabled || isGeneratingUserReply || isPolishingInput}
          />
        </div>
      )}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0, position: 'relative' }} ref={inputContainerRef}>
      {/* Token 使用量进度条（Spec: optimize-agent-interaction-from-openclaw / M3-Task11） */}
      {tokenUsage && !isStreaming && !isOrganizing && (
        <div style={{ marginBottom: '6px' }}>
          <TokenUsageBar
            used={tokenUsage.used}
            total={tokenUsage.total}
            onCompress={onCompressContext}
            isCompressing={isCompressing}
          />
        </div>
      )}
      <SlashCommandAutoComplete
        query={slashQuery}
        visible={slashVisible}
        commands={slashCommands}
        onSelect={handleSlashCommandSelect}
        onClose={handleSlashClose}
      />
      <textarea
        ref={textareaRef}
        value={input}
        onChange={handleInputChange}
        onKeyDown={handleKeyDown}
        placeholder={placeholder}
        disabled={(disabled && !isStreaming) || isGeneratingUserReply || isPolishingInput}
        rows={1}
        style={{
          width: '100%',
          background: 'var(--chat-input-bg, rgba(15, 15, 26, 0.8))',
          border: '1px solid var(--chat-input-border, rgba(255, 255, 255, 0.1))',
          borderRadius: '24px',
          padding: '12px 20px',
          color: 'var(--chat-input-color, #e2e8f0)',
          fontSize: '14px',
          resize: 'none',
          outline: 'none',
          fontFamily: 'inherit',
          lineHeight: '1.5',
          minHeight: '44px',
          maxHeight: '150px',
          overflow: 'hidden',
          overflowY: 'auto',
          scrollbarWidth: 'none',
          msOverflowStyle: 'none',
          transition: 'border-color 0.2s ease, box-shadow 0.3s ease',
          ...(flashBorder ? { boxShadow: '0 0 0 2px rgba(20, 184, 166, 0.6)' } : {}),
        }}
        onFocus={(e) => {
          if (flashBorder) return;  // 润色动画进行中，不覆盖
          e.target.style.borderColor = 'var(--chat-input-border-focus, var(--primary-color, #6366f1))';
          e.target.style.boxShadow = '0 0 0 2px rgba(99, 102, 241, 0.2)';
        }}
        onBlur={(e) => {
          if (flashBorder) return;  // 润色动画进行中，不覆盖
          e.target.style.borderColor = 'var(--chat-input-border, rgba(255, 255, 255, 0.1))';
          e.target.style.boxShadow = 'none';
        }}
        className="chat-textarea"
      />
      {!isStreaming && !isOrganizing && (
        <div style={{ textAlign: 'right', fontSize: '11px', color: 'var(--chat-input-placeholder, #8c8c8c)', paddingTop: '4px', paddingRight: '4px' }}>
          Enter 发送 · Shift+Enter 换行
        </div>
      )}
      </div>

      {isStreaming ? (
        <Tooltip title="停止生成">
          <Button
            type="primary"
            danger
            icon={<StopOutlined />}
            onClick={onCancel}
            size="large"
            style={{
              borderRadius: '50%',
              width: '44px',
              height: '44px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              background: 'linear-gradient(135deg, #ef4444 0%, #dc2626 100%)',
              border: 'none',
              boxShadow: '0 4px 12px rgba(239, 68, 68, 0.4)',
              alignSelf: 'center',
              flexShrink: 0,
            }}
          />
        </Tooltip>
      ) : isOrganizing ? (
        <Tooltip title="停止整理">
          <Button
            type="primary"
            danger
            icon={<ClearOutlined />}
            onClick={onStopOrganizing}
            size="large"
            style={{
              borderRadius: '50%',
              width: '44px',
              height: '44px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              background: 'linear-gradient(135deg, #f59e0b 0%, #d97706 100%)',
              border: 'none',
              boxShadow: '0 4px 12px rgba(245, 158, 11, 0.4)',
              alignSelf: 'center',
              flexShrink: 0,
            }}
          />
        </Tooltip>
      ) : (
        <div style={{ display: 'flex', alignItems: 'center', gap: '4px', alignSelf: 'center', flexShrink: 0 }}>
          {/* 人称选择器（Spec: add-person-attribute-to-ai-reply / Task 3.3） */}
          {/* 位于 AI回复按钮左侧，控制生成回复的叙事视角（第一/第二/第三人称） */}
          <Select
            size="small"
            value={userReplyPerson}
            onChange={(v) => onUserReplyPersonChange?.(v as 'first' | 'second' | 'third')}
            disabled={disabled || isStreaming || isOrganizing || isGeneratingUserReply || isPolishingInput}
            style={{
              width: '110px',
            }}
            popupClassName="person-select-dropdown"
          >
            <Select.Option value="first">第一人称（我）</Select.Option>
            <Select.Option value="second">第二人称（你）</Select.Option>
            <Select.Option value="third">第三人称（他/她）</Select.Option>
          </Select>
          {/* AI回复按钮（Spec: add-ai-user-reply-button / Task 3.3） */}
          {/* 位于 Send Message 按钮左侧，点击后以当前用户人设生成对话内容填入输入框（不自动发送）。
              生成中时变为停止态，点击触发取消（与 Send 按钮 streaming 态对称）。 */}
          <Tooltip title={isGeneratingUserReply ? '停止生成' : '以当前用户人设生成对话回复'}>
            <Button
              type="primary"
              icon={isGeneratingUserReply ? <LoadingOutlined /> : <RobotOutlined />}
              onClick={() => {
                if (isGeneratingUserReply) {
                  onCancel?.();
                } else {
                  // 传入输入框内容作为用户指令（为空时传 undefined，保持原有行为）
                  onGenerateUserReply?.(input.trim() || undefined);
                }
              }}
              disabled={!isGeneratingUserReply && (disabled || isStreaming || isOrganizing || isPolishingInput)}
              size="large"
              style={{
                borderRadius: '50%',
                width: '44px',
                height: '44px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                background: isGeneratingUserReply
                  ? 'linear-gradient(135deg, #ef4444 0%, #dc2626 100%)'  // 停止态：红色（与 Stop 按钮一致）
                  : 'linear-gradient(135deg, #8b5cf6 0%, #6366f1 100%)',  // 正常态：紫色渐变（区别于 Send 按钮的蓝紫色）
                border: 'none',
                boxShadow: isGeneratingUserReply
                  ? '0 4px 12px rgba(239, 68, 68, 0.4)'
                  : '0 4px 12px rgba(139, 92, 246, 0.4)',
                transition: 'all 0.2s ease',
              }}
            />
          </Tooltip>
          {/* 润色按钮（Spec: refine-user-input-text / Task 3.5） */}
          {/* 位于 AI回复按钮与 Send 按钮之间，点击后润色当前输入框文本。
              润色中时变为停止态，点击触发取消（与 AI回复 按钮生成态对称）。 */}
          <Tooltip title={isPolishingInput ? '停止润色' : '润色当前输入文本（结合对话上下文与角色人设）'}>
            <Button
              type="primary"
              icon={isPolishingInput ? <LoadingOutlined /> : <HighlightOutlined />}
              onClick={() => {
                if (isPolishingInput) {
                  onCancel?.();
                } else {
                  onPolishInput?.(input);
                }
              }}
              disabled={!isPolishingInput && (!input.trim() || disabled || isStreaming || isOrganizing || isGeneratingUserReply)}
              size="large"
              style={{
                borderRadius: '50%',
                width: '44px',
                height: '44px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                background: isPolishingInput
                  ? 'linear-gradient(135deg, #ef4444 0%, #dc2626 100%)'  // 停止态：红色
                  : 'linear-gradient(135deg, #14b8a6 0%, #06b6d4 100%)',  // 正常态：青色渐变
                border: 'none',
                boxShadow: isPolishingInput
                  ? '0 4px 12px rgba(239, 68, 68, 0.4)'
                  : '0 4px 12px rgba(20, 184, 166, 0.4)',
                transition: 'all 0.2s ease',
              }}
            />
          </Tooltip>
          <Tooltip title="发送消息">
            <Button
              type="primary"
              icon={<SendOutlined />}
              onClick={handleSend}
              disabled={!input.trim() || disabled || isGeneratingUserReply || isPolishingInput}
              size="large"
              style={{
                borderRadius: '50%',
                width: '44px',
                height: '44px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                background: input.trim() && !disabled && !isGeneratingUserReply && !isPolishingInput
                  ? 'var(--chat-send-btn-bg, linear-gradient(135deg, #6366f1 0%, #8b5cf6 100%))'
                  : 'var(--chat-send-btn-disabled-bg, rgba(99, 102, 241, 0.1))',
                border: input.trim() && !disabled && !isGeneratingUserReply && !isPolishingInput
                  ? 'none'
                  : '1px solid var(--chat-send-btn-disabled-border, rgba(99, 102, 241, 0.3))',
                boxShadow: input.trim() && !disabled && !isGeneratingUserReply && !isPolishingInput
                  ? 'var(--chat-send-btn-shadow, 0 4px 12px rgba(99, 102, 241, 0.4))'
                  : 'none',
                transition: 'all 0.2s ease',
              }}
            />
          </Tooltip>
        </div>
      )}
    </div>
  );
};

export default ChatInputBar;
