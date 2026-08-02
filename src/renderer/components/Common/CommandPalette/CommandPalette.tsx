import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import './CommandPalette.css';

export interface CommandPaletteItem {
  /** 唯一 key */
  key: string;
  /** 显示名称 */
  label: string;
  /** 描述/说明 */
  description?: string;
  /** 图标（ReactNode） */
  icon?: React.ReactNode;
  /** 分类 */
  category: 'navigation' | 'actions' | 'skills' | 'settings';
  /** 快捷键提示 */
  shortcut?: string;
  /** 是否禁用 */
  disabled?: boolean;
  /** 执行回调 */
  onExecute: () => void;
}

export interface CommandPaletteProps {
  /** 是否可见 */
  visible: boolean;
  /** 关闭回调 */
  onClose: () => void;
  /** 命令列表 */
  items: CommandPaletteItem[];
}

const CATEGORY_LABELS: Record<CommandPaletteItem['category'], string> = {
  navigation: '导航',
  actions: '操作',
  skills: '技能',
  settings: '设置',
};

const CATEGORY_ORDER: CommandPaletteItem['category'][] = ['navigation', 'actions', 'skills', 'settings'];

const CommandPalette: React.FC<CommandPaletteProps> = ({ visible, onClose, items }) => {
  const [searchQuery, setSearchQuery] = useState('');
  const [debouncedQuery, setDebouncedQuery] = useState('');
  const [selectedIndex, setSelectedIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // 250ms 防抖搜索
  useEffect(() => {
    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current);
    }
    debounceTimerRef.current = setTimeout(() => {
      setDebouncedQuery(searchQuery);
    }, 250);
    return () => {
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current);
      }
    };
  }, [searchQuery]);

  // 打开时聚焦输入框并重置状态
  useEffect(() => {
    if (visible) {
      setSearchQuery('');
      setDebouncedQuery('');
      setSelectedIndex(0);
      setTimeout(() => {
        inputRef.current?.focus();
      }, 0);
    }
  }, [visible]);

  // 过滤与分组逻辑
  const { displayItems, isSearching, hasResults } = useMemo(() => {
    const query = debouncedQuery.toLowerCase().trim();

    if (!query) {
      // 无搜索时按分类排序
      const sorted = [...items].sort((a, b) => {
        const aIdx = CATEGORY_ORDER.indexOf(a.category);
        const bIdx = CATEGORY_ORDER.indexOf(b.category);
        return aIdx - bIdx;
      });
      return { displayItems: sorted, isSearching: false, hasResults: sorted.length > 0 };
    }

    // 搜索时模糊匹配 label 和 description，按相关性排序
    const matched = items
      .map(item => {
        const labelLower = item.label.toLowerCase();
        const descLower = (item.description || '').toLowerCase();
        let score = 0;
        if (labelLower.includes(query)) {
          score += 10;
          if (labelLower.startsWith(query)) score += 5;
        }
        if (descLower.includes(query)) {
          score += 3;
        }
        return { item, score };
      })
      .filter(({ score }) => score > 0)
      .sort((a, b) => b.score - a.score)
      .map(({ item }) => item);

    return { displayItems: matched, isSearching: true, hasResults: matched.length > 0 };
  }, [items, debouncedQuery]);

  // 搜索查询变化时重置选中索引
  useEffect(() => {
    setSelectedIndex(0);
  }, [debouncedQuery]);

  // 选中项超出范围时重置
  useEffect(() => {
    if (selectedIndex >= displayItems.length && displayItems.length > 0) {
      setSelectedIndex(0);
    }
  }, [displayItems, selectedIndex]);

  // 滚动到选中项
  useEffect(() => {
    const listEl = listRef.current;
    if (!listEl) return;
    const selectedEl = listEl.querySelector(`[data-index="${selectedIndex}"]`) as HTMLElement;
    if (selectedEl) {
      selectedEl.scrollIntoView({ block: 'nearest' });
    }
  }, [selectedIndex]);

  const handleExecute = useCallback(
    (item: CommandPaletteItem) => {
      if (item.disabled) return;
      item.onExecute();
      onClose();
    },
    [onClose]
  );

  // 键盘导航：移动选中项
  const moveSelection = useCallback(
    (direction: 'up' | 'down') => {
      setSelectedIndex(prev => {
        const len = displayItems.length;
        if (len === 0) return 0;
        let next = prev;
        for (let i = 0; i < len; i++) {
          next = direction === 'down' ? (next + 1) % len : (next - 1 + len) % len;
          if (!displayItems[next].disabled) {
            return next;
          }
        }
        return prev;
      });
    },
    [displayItems]
  );

  // 全局键盘事件监听（capture 阶段，优先于 antd Modal 的 ESC 处理）
  useEffect(() => {
    if (!visible) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        onClose();
      } else if (e.key === 'ArrowDown') {
        e.preventDefault();
        moveSelection('down');
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        moveSelection('up');
      } else if (e.key === 'Enter') {
        e.preventDefault();
        const item = displayItems[selectedIndex];
        if (item && !item.disabled) {
          handleExecute(item);
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown, true);
    return () => window.removeEventListener('keydown', handleKeyDown, true);
  }, [visible, onClose, displayItems, selectedIndex, handleExecute, moveSelection]);

  // 点击遮罩层关闭
  const handleOverlayClick = useCallback(
    (e: React.MouseEvent) => {
      if (e.target === e.currentTarget) {
        onClose();
      }
    },
    [onClose]
  );

  // 渲染单个命令项
  const renderItem = useCallback(
    (item: CommandPaletteItem, index: number) => {
      const isSelected = index === selectedIndex;
      return (
        <div
          key={item.key}
          data-index={index}
          onClick={() => handleExecute(item)}
          onMouseEnter={() => !item.disabled && setSelectedIndex(index)}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '10px',
            padding: '10px 12px',
            borderRadius: '8px',
            cursor: item.disabled ? 'not-allowed' : 'pointer',
            background: isSelected ? 'rgba(99, 102, 241, 0.2)' : 'transparent',
            opacity: item.disabled ? 0.4 : 1,
            transition: 'background 0.15s ease',
            margin: '2px 0',
          }}
        >
          {item.icon && (
            <span style={{ display: 'flex', alignItems: 'center', fontSize: '16px', color: 'rgba(255, 255, 255, 0.6)', flexShrink: 0 }}>
              {item.icon}
            </span>
          )}
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: '14px', color: 'rgba(255, 255, 255, 0.9)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
              {item.label}
            </div>
            {item.description && (
              <div style={{ fontSize: '12px', color: 'rgba(255, 255, 255, 0.4)', marginTop: '2px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                {item.description}
              </div>
            )}
          </div>
          {item.shortcut && (
            <span style={{ fontSize: '12px', color: 'rgba(255, 255, 255, 0.3)', flexShrink: 0, fontFamily: 'monospace' }}>
              {item.shortcut}
            </span>
          )}
        </div>
      );
    },
    [selectedIndex, handleExecute]
  );

  // 渲染分组列表
  const renderGroupedList = useCallback(() => {
    let lastCategory: CommandPaletteItem['category'] | null = null;
    return displayItems.map((item, index) => {
      const fragments: React.ReactNode[] = [];
      if (item.category !== lastCategory) {
        fragments.push(
          <div
            key={`header-${item.category}`}
            style={{
              fontSize: '11px',
              fontWeight: 600,
              color: 'rgba(255, 255, 255, 0.35)',
              textTransform: 'uppercase',
              letterSpacing: '0.05em',
              padding: '8px 12px 4px',
              marginTop: index > 0 ? '4px' : '0',
            }}
          >
            {CATEGORY_LABELS[item.category]}
          </div>
        );
        lastCategory = item.category;
      }
      fragments.push(renderItem(item, index));
      return <React.Fragment key={item.key}>{fragments}</React.Fragment>;
    });
  }, [displayItems, renderItem]);

  if (!visible) return null;

  return (
    <div
      className="command-palette-overlay"
      onClick={handleOverlayClick}
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        zIndex: 10000,
        display: 'flex',
        alignItems: 'flex-start',
        justifyContent: 'center',
        paddingTop: '15vh',
        background: 'rgba(0, 0, 0, 0.5)',
        backdropFilter: 'blur(4px)',
        WebkitBackdropFilter: 'blur(4px)',
      }}
    >
      <div
        className="command-palette"
        style={{
          width: '600px',
          maxHeight: '400px',
          background: 'rgba(30, 30, 46, 0.98)',
          backdropFilter: 'blur(20px)',
          WebkitBackdropFilter: 'blur(20px)',
          borderRadius: '16px',
          border: '1px solid rgba(255, 255, 255, 0.1)',
          boxShadow: '0 20px 60px rgba(0, 0, 0, 0.5)',
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
        }}
      >
        <input
          ref={inputRef}
          type="text"
          value={searchQuery}
          onChange={e => setSearchQuery(e.target.value)}
          placeholder="搜索命令..."
          style={{
            width: '100%',
            boxSizing: 'border-box',
            background: 'rgba(15, 15, 26, 0.8)',
            border: '1px solid rgba(255, 255, 255, 0.1)',
            borderRadius: '12px',
            color: 'rgba(255, 255, 255, 0.9)',
            fontSize: '16px',
            padding: '12px 16px',
            outline: 'none',
            margin: '12px',
            flexShrink: 0,
          }}
        />
        <div
          ref={listRef}
          className="command-palette-list"
          style={{
            flex: 1,
            overflowY: 'auto',
            overflowX: 'hidden',
            maxHeight: '300px',
            padding: '0 12px 12px',
          }}
        >
          {hasResults ? (
            isSearching ? (
              displayItems.map((item, index) => (
                <React.Fragment key={item.key}>{renderItem(item, index)}</React.Fragment>
              ))
            ) : (
              renderGroupedList()
            )
          ) : (
            <div
              style={{
                textAlign: 'center',
                padding: '32px 16px',
                color: 'rgba(255, 255, 255, 0.3)',
                fontSize: '14px',
              }}
            >
              未找到匹配的命令
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default CommandPalette;
