import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Typography } from 'antd';
import type { SlashCommand } from './SlashCommandRegistry';

export interface SlashCommandAutoCompleteProps {
  /** 当前输入的命令文本（不含 / 前缀），如 're' */
  query: string;
  /** 当前命令名（已匹配的部分），如 'retry' */
  matchedCommand?: string;
  /** 是否显示 */
  visible: boolean;
  /** 命令列表 */
  commands: SlashCommand[];
  /** 选择命令回调 */
  onSelect: (command: SlashCommand) => void;
  /** 关闭回调 */
  onClose: () => void;
}

/**
 * 渲染命令名，高亮匹配 query 的部分
 */
function renderCommandName(name: string, query: string): React.ReactNode {
  if (!query) return name;
  const lowerName = name.toLowerCase();
  const lowerQuery = query.toLowerCase();
  const idx = lowerName.indexOf(lowerQuery);
  if (idx < 0) return name;
  return (
    <>
      {name.slice(0, idx)}
      <span style={{ color: '#c4b5fd' }}>{name.slice(idx, idx + query.length)}</span>
      {name.slice(idx + query.length)}
    </>
  );
}

const SlashCommandAutoComplete: React.FC<SlashCommandAutoCompleteProps> = ({
  query,
  matchedCommand,
  visible,
  commands,
  onSelect,
  onClose,
}) => {
  const [highlightedIndex, setHighlightedIndex] = useState(0);
  const itemRefs = useRef<(HTMLDivElement | null)[]>([]);

  // 当命令列表或 matchedCommand 变化时，重置高亮索引
  useEffect(() => {
    if (matchedCommand) {
      const idx = commands.findIndex(cmd => cmd.name === matchedCommand);
      setHighlightedIndex(idx >= 0 ? idx : 0);
    } else {
      setHighlightedIndex(0);
    }
  }, [commands, matchedCommand]);

  // 键盘导航处理
  const handleKeyDown = useCallback((e: KeyboardEvent) => {
    if (!visible || commands.length === 0) return;

    switch (e.key) {
      case 'ArrowUp':
        e.preventDefault();
        e.stopPropagation();
        setHighlightedIndex(prev => (prev <= 0 ? commands.length - 1 : prev - 1));
        break;
      case 'ArrowDown':
        e.preventDefault();
        e.stopPropagation();
        setHighlightedIndex(prev => (prev >= commands.length - 1 ? 0 : prev + 1));
        break;
      case 'Enter':
        e.preventDefault();
        e.stopPropagation();
        if (commands[highlightedIndex]) {
          onSelect(commands[highlightedIndex]);
        }
        break;
      case 'Escape':
        e.preventDefault();
        e.stopPropagation();
        onClose();
        break;
    }
  }, [visible, commands, highlightedIndex, onSelect, onClose]);

  // 全局监听键盘事件（capture 阶段，优先于输入框）
  useEffect(() => {
    if (visible) {
      window.addEventListener('keydown', handleKeyDown, true);
      return () => window.removeEventListener('keydown', handleKeyDown, true);
    }
  }, [visible, handleKeyDown]);

  // 选中项滚动到可见区域
  useEffect(() => {
    const item = itemRefs.current[highlightedIndex];
    if (item) {
      item.scrollIntoView({ block: 'nearest' });
    }
  }, [highlightedIndex]);

  if (!visible || commands.length === 0) return null;

  return (
    <div
      style={{
        position: 'absolute',
        bottom: '100%',
        left: 0,
        right: 0,
        maxHeight: '300px',
        overflowY: 'auto',
        background: 'rgba(30, 30, 46, 0.95)',
        backdropFilter: 'blur(10px)',
        border: '1px solid rgba(255, 255, 255, 0.1)',
        borderRadius: '12px',
        boxShadow: '0 -4px 20px rgba(0, 0, 0, 0.3)',
        zIndex: 1000,
        padding: '4px',
      }}
    >
      {commands.map((cmd, index) => (
        <div
          key={cmd.name}
          ref={(el) => { itemRefs.current[index] = el; }}
          onClick={() => onSelect(cmd)}
          onMouseEnter={() => setHighlightedIndex(index)}
          style={{
            padding: '8px 12px',
            borderRadius: '8px',
            cursor: 'pointer',
            background: index === highlightedIndex ? 'rgba(99, 102, 241, 0.2)' : 'transparent',
            transition: 'background 0.15s ease',
            display: 'flex',
            flexDirection: 'column',
            gap: '2px',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <Typography.Text style={{ color: '#8b5cf6', fontWeight: 500, fontSize: '14px' }}>
              /{renderCommandName(cmd.name, query)}
            </Typography.Text>
            {cmd.aliases && cmd.aliases.length > 0 && (
              <Typography.Text style={{ color: '#64748b', fontSize: '11px' }}>
                {cmd.aliases.map(a => `/${a}`).join(', ')}
              </Typography.Text>
            )}
            {cmd.requireConfirm && (
              <Typography.Text style={{ color: '#f59e0b', fontSize: '11px' }}>
                ⚠
              </Typography.Text>
            )}
          </div>
          <Typography.Text style={{ color: '#94a3b8', fontSize: '12px' }}>
            {cmd.description}
            {cmd.argDescription && (
              <span style={{ color: '#64748b', marginLeft: '4px' }}>{cmd.argDescription}</span>
            )}
          </Typography.Text>
        </div>
      ))}
    </div>
  );
};

export default SlashCommandAutoComplete;
