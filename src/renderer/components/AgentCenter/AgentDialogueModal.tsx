/**
 * AgentDialogueModal —— 智能体对话模态窗口（美化版 + 参数面板）
 *
 * 设计对标 CharacterDialogueChat，包含：
 *  - 多层渐变背景 + 模糊光球 + 网格点阵纹理
 *  - 不对称圆角消息气泡 + 毛玻璃 + 彩色阴影 + fadeInUp 入场动画
 *  - 36px 圆形头像（用户/AI 差异化渐变）
 *  - 发送者名称 + 序号标签
 *  - 2px 竖线流式光标
 *  - 打字指示器（首 token 前）
 *  - 胶囊形输入框 + 圆形渐变按钮
 *  - 脉冲滚动到底部按钮
 *  - 自定义细滚动条
 *  - 右侧折叠式参数面板（人格自定义 + 辅助模式）
 *  - 辅助模式选项卡片渲染（三色差异化）
 *  - 头部功能标识（人格/辅助模式标签）
 */
import React, { useState, useCallback, useMemo, useEffect, useRef } from 'react';
import { Modal, Tooltip, message } from 'antd';
import {
  SendOutlined, StopOutlined, RobotOutlined, ThunderboltOutlined,
  LoadingOutlined, VerticalAlignBottomOutlined, BulbOutlined,
  SettingOutlined, UserOutlined,
} from '@ant-design/icons';
import type { AgentConfig } from '../../../shared/types/agent-center.types';
import { useAgentDialogue } from './hooks/useAgentDialogue';
import { useAgentParams } from './hooks/useAgentParams';
import AgentParamPanel from './AgentParamPanel';
import { SlashCommandAutoComplete } from '../Common/SlashCommand';
import { slashCommandRegistry } from '../Common/SlashCommand/SlashCommandRegistry';
import { registerSystemCommands } from '../Common/SlashCommand/systemCommands';
import { registerBuiltinCommands } from '../Common/SlashCommand/builtinCommands';
import type { SlashCommand } from '../Common/SlashCommand/SlashCommandRegistry';
import './AgentDialogueModal.css';

// 注册系统指令与内置命令（模块级别执行，确保首次渲染前命令已注册）
let systemCommandsRegistered = false;
function ensureSystemCommandsRegistered() {
  if (!systemCommandsRegistered) {
    try { registerBuiltinCommands(); } catch { /* 已注册 */ }
    try { registerSystemCommands(); } catch { /* 已注册 */ }
    systemCommandsRegistered = true;
  }
}
ensureSystemCommandsRegistered();

/** 辅助模式选项卡片颜色配置 */
const OPTION_COLORS = [
  { tag: '稳妥推进', gradient: 'linear-gradient(135deg, #10b981 0%, #059669 100%)', color: '#34d399' },
  { tag: '平衡探索', gradient: 'linear-gradient(135deg, #6366f1 0%, #8b5cf6 100%)', color: '#818cf8' },
  { tag: '发散创新', gradient: 'linear-gradient(135deg, #f59e0b 0%, #ef4444 100%)', color: '#fbbf24' },
];

interface AgentDialogueModalProps {
  open: boolean;
  agent: AgentConfig | null;
  onClose: () => void;
}

/** fallback 智能体配置 */
const FALLBACK_AGENT: AgentConfig = {
  id: '', name: '', description: '', type: 'dialogue', status: 'enabled',
  isSystem: false, skills: [], mode: 'dialogue', createdAt: 0, updatedAt: 0,
};

const AgentDialogueModal: React.FC<AgentDialogueModalProps> = ({ open, agent, onClose }) => {
  const effectiveAgent = agent ?? FALLBACK_AGENT;
  const { params, updateParams, resetParams } = useAgentParams(effectiveAgent.id);
  const { messages, streaming, sendMessage, cancel, reset, optimizeInput, isOptimizing, cancelOptimize, isRecognizingIntent, lastIntent } = useAgentDialogue(effectiveAgent, params);

  const [inputValue, setInputValue] = useState('');
  const [autoCompleteVisible, setAutoCompleteVisible] = useState(false);
  const [showScrollBtn, setShowScrollBtn] = useState(false);
  const [isScrollNearBottom, setIsScrollNearBottom] = useState(true);
  const [paramPanelOpen, setParamPanelOpen] = useState(false);

  const messagesContainerRef = useRef<HTMLDivElement>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  // 智能体信息
  const agentName = agent?.name || '智能体';
  const agentDesc = agent?.description || '';
  const emoji = agent?.identity?.emoji;

  // 全部已注册命令列表
  const allCommands = useMemo(() => slashCommandRegistry.getAll(), []);

  const autoCompleteQuery = useMemo(() => {
    if (!inputValue.startsWith('/')) return '';
    const afterSlash = inputValue.slice(1);
    if (afterSlash.includes(' ')) return '';
    return afterSlash;
  }, [inputValue]);

  const filteredCommands = useMemo(() => {
    if (!autoCompleteQuery) return allCommands;
    return allCommands.filter(cmd =>
      cmd.name.includes(autoCompleteQuery) || cmd.name.toLowerCase().includes(autoCompleteQuery.toLowerCase())
    );
  }, [autoCompleteQuery, allCommands]);

  // 自动滚动到底部
  const scrollToBottom = useCallback((smooth = true) => {
    messagesEndRef.current?.scrollIntoView({ behavior: smooth ? 'smooth' : 'instant' });
  }, []);

  // 消息变化或流式状态变化时自动滚动
  useEffect(() => {
    if (isScrollNearBottom) {
      scrollToBottom();
    }
  }, [messages, scrollToBottom, isScrollNearBottom]);

  // 滚动事件处理
  const handleScroll = useCallback((e: React.UIEvent<HTMLDivElement>) => {
    const el = e.currentTarget;
    const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    const nearBottom = distanceFromBottom < 100;
    setIsScrollNearBottom(nearBottom);
    setShowScrollBtn(distanceFromBottom > 200);
  }, []);

  /** 发送消息 */
  const handleSend = useCallback(() => {
    const content = inputValue.trim();
    if (!content || streaming || isOptimizing) return;
    setInputValue('');
    setAutoCompleteVisible(false);
    setIsScrollNearBottom(true);
    void sendMessage(content);
  }, [inputValue, streaming, isOptimizing, sendMessage]);

  /** 点击辅助模式选项 */
  const handleOptionClick = useCallback((optionText: string) => {
    setInputValue(optionText);
  }, []);

  /** 键盘事件 */
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (autoCompleteVisible && (e.key === 'Enter' || e.key === 'ArrowUp' || e.key === 'ArrowDown' || e.key === 'Escape')) {
        return;
      }
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        handleSend();
      }
    },
    [handleSend, autoCompleteVisible],
  );

  /** 停止生成 */
  const handleStop = useCallback(() => { void cancel(); }, [cancel]);

  /** 优化输入 */
  const handleOptimize = useCallback(async () => {
    if (isOptimizing) { cancelOptimize(); return; }
    const text = inputValue.trim();
    if (!text) { message.warning('请先输入需要优化的文本'); return; }
    if (streaming) return;
    const optimized = await optimizeInput(text);
    if (optimized && optimized !== text) {
      setInputValue(optimized);
      message.success('已优化输入');
    }
  }, [inputValue, isOptimizing, streaming, cancelOptimize, optimizeInput]);

  /** Modal 关闭后清理 */
  const handleAfterClose = useCallback(() => {
    if (agent) reset();
  }, [agent, reset]);

  // 判断是否显示打字指示器（最后一条是用户消息且正在流式）
  const showTypingIndicator = streaming && messages.length > 0 && messages[messages.length - 1].role === 'user';

  // 当前正在流式的 assistant 消息索引
  const streamingMsgIndex = useMemo(() => {
    if (!streaming) return -1;
    for (let i = messages.length - 1; i >= 0; i--) {
      if (messages[i].role === 'assistant' && messages[i].streaming) return i;
    }
    return -1;
  }, [messages, streaming]);

  // 辅助模式强度标签
  const intensityLabel = params.assistModeIntensity === 'low' ? '低' : params.assistModeIntensity === 'high' ? '高' : '中';

  return (
    <Modal
      open={open}
      onCancel={onClose}
      footer={null}
      width={paramPanelOpen ? 1200 : 900}
      destroyOnClose
      afterClose={handleAfterClose}
      className="agent-dialogue-modal"
      styles={{ body: { padding: 0 } }}
      title={null}
      centered
      mask={{ style: { backdropFilter: 'blur(8px)', background: 'rgba(0,0,0,0.6)' } }}
    >
      <div style={{ position: 'relative', height: '70vh', minHeight: 500, borderRadius: 16, overflow: 'hidden', display: 'flex' }}>
        {/* 背景装饰层 */}
        <div className="agent-chat-area-bg">
          <div className="agent-chat-bg-orb" />
          <div className="agent-chat-bg-orb" />
          <div className="agent-chat-bg-orb" />
        </div>
        <div className="agent-chat-bg-grid" />

        {/* 左侧：对话区 */}
        <div style={{ position: 'relative', zIndex: 1, display: 'flex', flexDirection: 'column', height: '100%', flex: 1, minWidth: 0 }}>
          {/* 头部 */}
          <div style={{
            display: 'flex', alignItems: 'center', gap: 12,
            padding: '14px 20px',
            background: 'var(--chat-header-bg)',
            backdropFilter: 'blur(10px)',
            borderBottom: '1px solid var(--chat-header-border)',
            flexShrink: 0,
          }}>
            <div style={{
              width: 40, height: 40, borderRadius: '50%',
              overflow: 'hidden', flexShrink: 0,
              boxShadow: '0 2px 8px rgba(0,0,0,0.15)',
              border: '2px solid var(--secondary-color, #8b5cf6)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              background: 'linear-gradient(135deg, #8b5cf6 0%, #a855f7 100%)',
              fontSize: 20,
            }}>
              {emoji ? emoji : <RobotOutlined style={{ color: '#fff', fontSize: 20 }} />}
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{
                fontSize: 16, fontWeight: 600,
                color: 'var(--chat-header-text-primary)',
                whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
              }}>
                {agentName}
              </div>
              <div style={{
                fontSize: 12, color: 'var(--chat-header-text-secondary)',
                whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
              }}>
                {agentDesc || '智能体对话'}
              </div>
            </div>
            {agent?.isSystem && (
              <span style={{
                fontSize: 10, fontWeight: 500, padding: '2px 8px', borderRadius: 10,
                background: 'rgba(139, 92, 246, 0.15)', color: 'var(--secondary-color, #8b5cf6)',
                border: '1px solid rgba(139, 92, 246, 0.3)',
              }}>
                SYSTEM
              </span>
            )}
            {/* 人格标签 */}
            {params.customPersonality && (
              <Tooltip title={params.customPersonality.slice(0, 100)}>
                <span style={{
                  fontSize: 10, fontWeight: 500, padding: '2px 8px', borderRadius: 10,
                  display: 'flex', alignItems: 'center', gap: 4,
                  background: 'rgba(139, 92, 246, 0.15)', color: '#a855f7',
                  border: '1px solid rgba(139, 92, 246, 0.3)',
                }}>
                  <UserOutlined style={{ fontSize: 10 }} />
                  人格
                </span>
              </Tooltip>
            )}
            {/* 辅助模式标签 */}
            {params.assistMode && (
              <span style={{
                fontSize: 10, fontWeight: 500, padding: '2px 8px', borderRadius: 10,
                display: 'flex', alignItems: 'center', gap: 4,
                background: 'rgba(245, 158, 11, 0.15)', color: '#fbbf24',
                border: '1px solid rgba(245, 158, 11, 0.3)',
              }}>
                <BulbOutlined style={{ fontSize: 10 }} />
                辅助·{intensityLabel}
              </span>
            )}
            {/* 意图识别状态指示器 */}
            {isRecognizingIntent && (
              <span style={{
                fontSize: 10, fontWeight: 500, padding: '2px 8px', borderRadius: 10,
                display: 'flex', alignItems: 'center', gap: 4,
                background: 'rgba(99, 102, 241, 0.15)', color: 'var(--primary-color, #6366f1)',
                border: '1px solid rgba(99, 102, 241, 0.3)',
              }}>
                <LoadingOutlined style={{ fontSize: 10 }} spin />
                识别意图
              </span>
            )}
            {!isRecognizingIntent && lastIntent && (
              <Tooltip title={`${lastIntent.intentLabel} · ${lastIntent.summary}`}>
                <span style={{
                  fontSize: 10, fontWeight: 500, padding: '2px 8px', borderRadius: 10,
                  display: 'flex', alignItems: 'center', gap: 4,
                  background: lastIntent.canHandle
                    ? 'rgba(82, 196, 26, 0.12)'
                    : 'rgba(250, 173, 20, 0.12)',
                  color: lastIntent.canHandle
                    ? 'var(--color-success, #52c41a)'
                    : 'var(--color-warning, #faad14)',
                  border: `1px solid ${lastIntent.canHandle
                    ? 'rgba(82, 196, 26, 0.3)'
                    : 'rgba(250, 173, 20, 0.3)'}`,
                }}>
                  <BulbOutlined style={{ fontSize: 10 }} />
                  {lastIntent.intentLabel}
                </span>
              </Tooltip>
            )}
            {/* 参数面板切换按钮 */}
            <Tooltip title={paramPanelOpen ? '收起参数面板' : '展开参数面板'}>
              <button
                onClick={() => setParamPanelOpen(!paramPanelOpen)}
                style={{
                  width: 32, height: 32, borderRadius: '50%', flexShrink: 0,
                  border: 'none', cursor: 'pointer',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  fontSize: 14,
                  background: paramPanelOpen
                    ? 'rgba(99, 102, 241, 0.15)'
                    : 'transparent',
                  color: paramPanelOpen
                    ? 'var(--primary-color, #6366f1)'
                    : 'var(--chat-header-text-secondary, #8c8c8c)',
                  transition: 'all 0.2s ease',
                }}
              >
                <SettingOutlined />
              </button>
            </Tooltip>
          </div>

          {/* 消息列表 */}
          <div
            ref={messagesContainerRef}
            onScroll={handleScroll}
            className="agent-chat-messages"
            style={{
              flex: 1, overflowY: 'auto', padding: '20px 24px',
              scrollBehavior: 'smooth',
            }}
          >
            {messages.length <= 1 && !streaming ? (
              // 空状态 / 欢迎界面
              <div style={{
                height: '100%', display: 'flex', flexDirection: 'column',
                alignItems: 'center', justifyContent: 'center',
              }}>
                <div style={{
                  width: 80, height: 80, borderRadius: '50%',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  fontSize: 36,
                  background: 'linear-gradient(135deg, #8b5cf6 0%, #a855f7 100%)',
                  boxShadow: 'var(--chat-empty-shadow, 0 8px 32px rgba(139,92,246,0.4))',
                  marginBottom: 20,
                }}>
                  {emoji ? emoji : <RobotOutlined style={{ color: '#fff', fontSize: 36 }} />}
                </div>
                <div style={{
                  fontSize: 20, fontWeight: 600, marginBottom: 8,
                  color: 'var(--chat-empty-text-primary)',
                }}>
                  {agentName}
                </div>
                <div style={{
                  fontSize: 14, lineHeight: 1.6, textAlign: 'center', maxWidth: 400,
                  color: 'var(--chat-empty-text-secondary)',
                }}>
                  {agentDesc || '输入消息开始对话'}
                </div>
                <div style={{
                  marginTop: 16, fontSize: 12,
                  color: 'var(--chat-empty-text-secondary)',
                }}>
                  输入消息或 /世界书 /角色卡 /编写 /审核…（Enter 发送）
                </div>
              </div>
            ) : (
              <>
                {messages.map((msg, idx) => {
                  const isUser = msg.role === 'user';

                  // 计算 AI 消息序号
                  let aiSeq = 0;
                  if (!isUser) {
                    for (let i = 0; i <= idx; i++) {
                      if (messages[i].role === 'assistant') aiSeq++;
                    }
                  }

                  const isStreamingThis = idx === streamingMsgIndex;

                  return (
                    <div key={idx} style={{
                      display: 'flex', marginBottom: 20,
                      justifyContent: isUser ? 'flex-end' : 'flex-start',
                      animation: 'agentFadeInUp 0.3s ease-out',
                    }}>
                      <div style={{
                        display: 'flex', gap: 12, maxWidth: '75%', minWidth: 0,
                        flexDirection: isUser ? 'row-reverse' : 'row',
                      }}>
                        {/* 头像 */}
                        <div style={{
                          width: 36, height: 36, borderRadius: '50%',
                          overflow: 'hidden', flexShrink: 0,
                          boxShadow: '0 2px 8px rgba(0,0,0,0.15)',
                          border: '2px solid ' + (isUser ? 'var(--primary-color, #6366f1)' : 'var(--secondary-color, #8b5cf6)'),
                          display: 'flex', alignItems: 'center', justifyContent: 'center',
                          background: isUser
                            ? 'linear-gradient(135deg, #6366f1 0%, #8b5cf6 100%)'
                            : 'linear-gradient(135deg, #8b5cf6 0%, #a855f7 100%)',
                        }}>
                          {emoji && !isUser ? (
                            <span style={{ fontSize: 16 }}>{emoji}</span>
                          ) : (
                            <span style={{ color: '#fff', fontSize: 16, fontWeight: 'bold' }}>
                              {isUser ? 'U' : (agentName.charAt(0).toUpperCase() || 'A')}
                            </span>
                          )}
                        </div>

                        {/* 消息内容区 */}
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 6, minWidth: 0, flex: 1 }}>
                          {/* 发送者名称 */}
                          <div style={{
                            fontSize: 12, color: 'var(--text-secondary, #6b7280)',
                            padding: isUser ? '0 12px' : '0 4px',
                            display: 'flex', alignItems: 'center', gap: 6,
                          }}>
                            {isUser ? 'You' : agentName}
                            {!isUser && aiSeq > 0 && (
                              <span style={{
                                fontSize: 10, color: 'var(--text-tertiary, rgba(255,255,255,0.35))',
                                background: 'rgba(255,255,255,0.06)', padding: '1px 6px',
                                borderRadius: 8, fontWeight: 500,
                              }}>
                                #{aiSeq}
                              </span>
                            )}
                          </div>

                          {/* 消息气泡 */}
                          <div style={{
                            background: isUser
                              ? 'var(--chat-bubble-user-bg, linear-gradient(135deg, #6366f1 0%, #8b5cf6 100%))'
                              : 'var(--chat-bubble-assistant-bg, rgba(30,30,46,0.8))',
                            color: isUser
                              ? 'var(--chat-bubble-user-color, #fff)'
                              : 'var(--chat-bubble-assistant-color, #e2e8f0)',
                            padding: '12px 16px',
                            borderRadius: isUser ? '18px 18px 4px 18px' : '18px 18px 18px 4px',
                            wordBreak: 'break-word', overflowWrap: 'break-word', overflow: 'hidden',
                            backdropFilter: 'blur(10px)',
                            boxShadow: isUser
                              ? 'var(--chat-bubble-user-shadow, 0 4px 12px rgba(99,102,241,0.3))'
                              : 'var(--chat-bubble-assistant-shadow, 0 4px 12px rgba(0,0,0,0.2))',
                            position: 'relative',
                            transition: 'all 0.3s cubic-bezier(0.4, 0, 0.2, 1)',
                          }}>
                            {/* 消息内容 */}
                            <div style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word', lineHeight: 1.7, fontSize: 14 }}>
                              {msg.content}
                              {/* 流式光标 */}
                              {isStreamingThis && (
                                <span style={{
                                  display: 'inline-block',
                                  width: 2, height: '1em',
                                  backgroundColor: 'var(--chat-cursor-color, #e2e8f0)',
                                  marginLeft: 2,
                                  animation: 'agentBlink 1s step-end infinite',
                                  verticalAlign: 'text-bottom',
                                }} />
                              )}
                            </div>
                          </div>

                          {/* 辅助模式推荐选项 */}
                          {!isUser && msg.suggestedOptions && msg.suggestedOptions.length > 0 && (
                            <div style={{ marginTop: 8 }}>
                              <div style={{
                                fontSize: 11, color: 'var(--chat-header-text-secondary, #8c8c8c)',
                                marginBottom: 6, paddingLeft: 4,
                              }}>
                                AI 推荐了以下对话方向
                              </div>
                              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                                {msg.suggestedOptions.map((option, optIdx) => {
                                  const colorCfg = OPTION_COLORS[optIdx] || OPTION_COLORS[0];
                                  // 解析动作描写和对话内容
                                  const parts: { text: string; isAction: boolean }[] = [];
                                  const regex = /\(([^)]*)\)|"([^"]*)"/g;
                                  let m;
                                  let lastIdx = 0;
                                  while ((m = regex.exec(option)) !== null) {
                                    if (m.index > lastIdx) {
                                      parts.push({ text: option.slice(lastIdx, m.index).trim(), isAction: false });
                                    }
                                    if (m[1] !== undefined) {
                                      parts.push({ text: m[1], isAction: true });
                                    } else if (m[2] !== undefined) {
                                      parts.push({ text: m[2], isAction: false });
                                    }
                                    lastIdx = regex.lastIndex;
                                  }
                                  if (lastIdx < option.length) {
                                    parts.push({ text: option.slice(lastIdx).trim(), isAction: false });
                                  }

                                  return (
                                    <button
                                      key={optIdx}
                                      onClick={() => handleOptionClick(option)}
                                      style={{
                                        display: 'flex', alignItems: 'center', gap: 8,
                                        padding: '8px 12px',
                                        borderRadius: 10,
                                        border: '1px solid rgba(255,255,255,0.08)',
                                        background: 'rgba(255,255,255,0.04)',
                                        cursor: 'pointer',
                                        textAlign: 'left',
                                        transition: 'all 0.2s ease',
                                        color: 'var(--chat-bubble-assistant-color, #e2e8f0)',
                                        fontSize: 13,
                                      }}
                                      onMouseEnter={(e) => {
                                        e.currentTarget.style.background = 'rgba(255,255,255,0.08)';
                                        e.currentTarget.style.borderColor = colorCfg.color + '40';
                                        e.currentTarget.style.transform = 'translateX(2px)';
                                      }}
                                      onMouseLeave={(e) => {
                                        e.currentTarget.style.background = 'rgba(255,255,255,0.04)';
                                        e.currentTarget.style.borderColor = 'rgba(255,255,255,0.08)';
                                        e.currentTarget.style.transform = 'translateX(0)';
                                      }}
                                    >
                                      {/* 编号 */}
                                      <span style={{
                                        width: 22, height: 22, borderRadius: '50%',
                                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                                        fontSize: 11, fontWeight: 600, color: '#fff', flexShrink: 0,
                                        background: colorCfg.gradient,
                                      }}>
                                        {optIdx + 1}
                                      </span>
                                      {/* 标签 */}
                                      <span style={{
                                        fontSize: 10, fontWeight: 500, padding: '1px 6px', borderRadius: 8,
                                        color: colorCfg.color,
                                        background: colorCfg.color + '15',
                                        flexShrink: 0,
                                      }}>
                                        {colorCfg.tag}
                                      </span>
                                      {/* 文本 */}
                                      <span style={{ flex: 1, minWidth: 0 }}>
                                        {parts.map((part, pIdx) => (
                                          <span
                                            key={pIdx}
                                            style={part.isAction
                                              ? { fontStyle: 'italic', color: 'rgba(255,255,255,0.55)' }
                                              : { color: 'rgba(255,255,255,0.95)' }
                                            }
                                          >
                                            {part.isAction ? `(${part.text})` : `"${part.text}"`}
                                          </span>
                                        ))}
                                      </span>
                                    </button>
                                  );
                                })}
                              </div>
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })}

                {/* 打字指示器 */}
                {showTypingIndicator && (
                  <div style={{
                    display: 'flex', marginBottom: 20, justifyContent: 'flex-start',
                    animation: 'agentFadeInUp 0.3s ease-out',
                  }}>
                    <div style={{ display: 'flex', gap: 12, maxWidth: '75%' }}>
                      <div style={{
                        width: 36, height: 36, borderRadius: '50%', overflow: 'hidden', flexShrink: 0,
                        boxShadow: '0 2px 8px rgba(0,0,0,0.15)',
                        border: '2px solid var(--secondary-color, #8b5cf6)',
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        background: 'linear-gradient(135deg, #8b5cf6 0%, #a855f7 100%)',
                      }}>
                        {emoji ? <span style={{ fontSize: 16 }}>{emoji}</span> : <span style={{ color: '#fff', fontSize: 16, fontWeight: 'bold' }}>{agentName.charAt(0).toUpperCase()}</span>}
                      </div>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                        <div style={{ fontSize: 12, color: 'var(--text-secondary, #6b7280)', padding: '0 4px' }}>
                          {agentName}
                        </div>
                        <div style={{
                          background: 'var(--chat-bubble-assistant-bg, rgba(30,30,46,0.8))',
                          padding: '14px 20px',
                          borderRadius: '18px 18px 18px 4px',
                          backdropFilter: 'blur(10px)',
                          boxShadow: '0 4px 12px rgba(0,0,0,0.2)',
                          display: 'flex', alignItems: 'center', gap: 8,
                        }}>
                          <LoadingOutlined style={{ fontSize: 16, color: 'var(--secondary-color, #8b5cf6)' }} spin />
                          <span style={{ color: 'var(--text-secondary, #9ca3af)', fontSize: 14 }}>Thinking...</span>
                        </div>
                      </div>
                    </div>
                  </div>
                )}

                <div ref={messagesEndRef} />
              </>
            )}
          </div>

          {/* 滚动到底部按钮 */}
          {showScrollBtn && (
            <button
              onClick={() => { scrollToBottom(); setShowScrollBtn(false); }}
              style={{
                position: 'absolute', bottom: 90, right: 24,
                width: 36, height: 36, borderRadius: '50%',
                border: 'none', cursor: 'pointer',
                background: 'var(--chat-send-btn-bg, linear-gradient(135deg, #6366f1 0%, #8b5cf6 100%))',
                boxShadow: 'var(--chat-send-btn-shadow, 0 4px 12px rgba(99,102,241,0.4))',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                color: '#fff', fontSize: 14, zIndex: 5,
                animation: 'agentPulse 2s infinite',
              }}
            >
              <VerticalAlignBottomOutlined />
            </button>
          )}

          {/* 输入区域 */}
          <div style={{
            padding: '14px 20px',
            background: 'var(--chat-header-bg)',
            backdropFilter: 'blur(10px)',
            borderTop: '1px solid var(--chat-header-border)',
            flexShrink: 0,
          }}>
            <div style={{ display: 'flex', gap: 10, alignItems: 'flex-end', position: 'relative' }}>
              <div style={{ flex: 1, position: 'relative' }}>
                <SlashCommandAutoComplete
                  query={autoCompleteQuery}
                  visible={autoCompleteVisible && filteredCommands.length > 0}
                  commands={filteredCommands}
                  onSelect={(cmd: SlashCommand) => {
                    setInputValue(`/${cmd.name} `);
                    setAutoCompleteVisible(false);
                  }}
                  onClose={() => setAutoCompleteVisible(false)}
                />
                <textarea
                  className="agent-chat-textarea"
                  value={inputValue}
                  onChange={(e) => {
                    setInputValue(e.target.value);
                    const val = e.target.value;
                    if (val.startsWith('/') && !val.includes(' ')) {
                      setAutoCompleteVisible(true);
                    } else {
                      setAutoCompleteVisible(false);
                    }
                  }}
                  onKeyDown={handleKeyDown}
                  rows={1}
                  placeholder="输入消息或 /世界书 /角色卡 /编写 /审核…（Enter 发送）"
                  disabled={streaming}
                  style={{
                    width: '100%', boxSizing: 'border-box',
                    minHeight: 44, maxHeight: 120,
                    padding: '12px 20px',
                    borderRadius: 24,
                    border: '1px solid var(--chat-input-border, rgba(255,255,255,0.1))',
                    background: 'var(--chat-input-bg, rgba(15,15,26,0.8))',
                    color: 'var(--chat-input-color, #e2e8f0)',
                    fontSize: 14, lineHeight: 1.6,
                    fontFamily: 'inherit',
                    resize: 'none', outline: 'none',
                    transition: 'border-color 0.2s ease, box-shadow 0.2s ease',
                  }}
                  onFocus={(e) => {
                    e.currentTarget.style.borderColor = 'var(--chat-input-border-focus, #6366f1)';
                    e.currentTarget.style.boxShadow = '0 0 0 2px rgba(99,102,241,0.2)';
                  }}
                  onBlur={(e) => {
                    e.currentTarget.style.borderColor = 'var(--chat-input-border, rgba(255,255,255,0.1))';
                    e.currentTarget.style.boxShadow = 'none';
                  }}
                />
              </div>

              {/* 优化输入按钮 */}
              <Tooltip title={isOptimizing ? '取消优化' : '优化输入内容'}>
                <button
                  onClick={handleOptimize}
                  disabled={streaming || (!isOptimizing && !inputValue.trim())}
                  style={{
                    width: 44, height: 44, borderRadius: '50%', flexShrink: 0,
                    border: 'none', cursor: (streaming || (!isOptimizing && !inputValue.trim())) ? 'not-allowed' : 'pointer',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    fontSize: 18, color: '#fff',
                    background: isOptimizing
                      ? 'linear-gradient(135deg, #ef4444 0%, #dc2626 100%)'
                      : 'linear-gradient(135deg, #14b8a6 0%, #06b6d4 100%)',
                    boxShadow: isOptimizing
                      ? '0 4px 12px rgba(239,68,68,0.4)'
                      : '0 4px 12px rgba(20,184,166,0.3)',
                    opacity: (streaming || (!isOptimizing && !inputValue.trim())) ? 0.5 : 1,
                    transition: 'all 0.2s ease',
                  }}
                >
                  {isOptimizing ? <LoadingOutlined spin /> : <ThunderboltOutlined />}
                </button>
              </Tooltip>

              {/* 发送/停止按钮 */}
              {streaming ? (
                <button
                  onClick={handleStop}
                  style={{
                    width: 44, height: 44, borderRadius: '50%', flexShrink: 0,
                    border: 'none', cursor: 'pointer',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    fontSize: 18, color: '#fff',
                    background: 'linear-gradient(135deg, #ef4444 0%, #dc2626 100%)',
                    boxShadow: '0 4px 12px rgba(239,68,68,0.4)',
                    transition: 'all 0.2s ease',
                  }}
                >
                  <StopOutlined />
                </button>
              ) : (
                <button
                  onClick={handleSend}
                  disabled={!inputValue.trim() || isOptimizing}
                  style={{
                    width: 44, height: 44, borderRadius: '50%', flexShrink: 0,
                    border: 'none', cursor: (!inputValue.trim() || isOptimizing) ? 'not-allowed' : 'pointer',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    fontSize: 18, color: '#fff',
                    background: 'var(--chat-send-btn-bg, linear-gradient(135deg, #6366f1 0%, #8b5cf6 100%))',
                    boxShadow: 'var(--chat-send-btn-shadow, 0 4px 12px rgba(99,102,241,0.4))',
                    opacity: (!inputValue.trim() || isOptimizing) ? 0.5 : 1,
                    transition: 'all 0.2s ease',
                  }}
                >
                  <SendOutlined />
                </button>
              )}
            </div>

            {/* 键盘提示 */}
            <div style={{
              marginTop: 6, fontSize: 11, color: 'var(--chat-header-text-secondary, #8c8c8c)',
              textAlign: 'center',
            }}>
              Enter 发送 · Shift+Enter 换行
            </div>
          </div>
        </div>

        {/* 右侧：参数面板 */}
        {paramPanelOpen && (
          <div style={{
            width: 300, flexShrink: 0,
            borderLeft: '1px solid var(--chat-header-border)',
            background: 'var(--chat-header-bg)',
            backdropFilter: 'blur(10px)',
            zIndex: 2,
            overflow: 'hidden',
            animation: 'agentFadeInUp 0.2s ease-out',
          }}>
            <AgentParamPanel
              params={params}
              onParamsChange={updateParams}
              onReset={resetParams}
            />
          </div>
        )}
      </div>
    </Modal>
  );
};

export default AgentDialogueModal;
