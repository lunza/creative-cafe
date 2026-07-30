import React from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';

/**
 * VirtualizedMessageList —— 聊天消息长列表虚拟化（P6 性能修复）
 *
 * 来源：spec §1.3 P6（消息列表无虚拟化，长对话渲染卡顿）
 * 决策：采用 @tanstack/react-virtual v3 动态高度虚拟化，仅在消息数超过
 *       VIRTUALIZATION_THRESHOLD 时启用；小列表仍走原 .map() 路径（由调用方切换），
 *       避免短对话引入虚拟化开销与回归风险。
 *
 * 职责：
 *  1. 复用父级滚动容器（getScrollElement），不引入额外嵌套
 *  2. 动态测量每条消息高度（measureElement），支持变长内容
 *  3. overscan 缓冲，平滑滚动
 *  4. 保留 auto-scroll 能力：总高度占位 div 保证滚动条正确，末尾 ref 由父级保留
 *
 * 设计约束：
 *  - 不改变 ChatMessageBubble 的 props 契约，仅控制「何时渲染」
 *  - 虚拟项用 position: absolute + translateY 定位，外层 spacer 撑总高度
 */

/** 启用虚拟化的消息数阈值（低于此值走原 .map() 路径） */
export const VIRTUALIZATION_THRESHOLD = 50;

/** 默认 overscan 行数（可视区上下各缓冲的额外项） */
const DEFAULT_OVERSCAN = 8;

interface VirtualizedMessageListProps<T> {
  /** 消息列表 */
  items: T[];
  /** 父级滚动容器 ref（getScrollElement） */
  scrollElementRef: React.RefObject<HTMLDivElement>;
  /** 渲染单条消息 */
  renderItem: (item: T, index: number) => React.ReactNode;
  /** 每条消息的预估高度（px），用于初始化虚拟化器 */
  estimateSize?: number;
  /** overscan 缓冲行数 */
  overscan?: number;
}

/**
 * 虚拟化消息列表。
 *
 * 用法：
 * ```tsx
 * <VirtualizedMessageList
 *   items={messages}
 *   scrollElementRef={scrollContainerRef}
 *   renderItem={(msg, index) => <ChatMessageBubble ... />}
 * />
 * ```
 */
function VirtualizedMessageListInner<T>({
  items,
  scrollElementRef,
  renderItem,
  estimateSize = 120,
  overscan = DEFAULT_OVERSCAN,
}: VirtualizedMessageListProps<T>) {
  const rowVirtualizer = useVirtualizer({
    count: items.length,
    getScrollElement: () => scrollElementRef.current,
    estimateSize: () => estimateSize,
    overscan,
    // 动态高度测量：测量实际 DOM 节点高度并更新虚拟化器
    measureElement: typeof window !== 'undefined' && navigator.userAgent.indexOf('Firefox') === -1
      ? (element) => element.getBoundingClientRect().height
      : undefined,
  });

  const virtualItems = rowVirtualizer.getVirtualItems();
  const totalSize = rowVirtualizer.getTotalSize();

  return (
    <div
      style={{
        height: `${totalSize}px`,
        width: '100%',
        position: 'relative',
      }}
    >
      {virtualItems.map((virtualItem) => (
        <div
          key={virtualItem.key}
          data-index={virtualItem.index}
          ref={rowVirtualizer.measureElement}
          style={{
            position: 'absolute',
            top: 0,
            left: 0,
            width: '100%',
            transform: `translateY(${virtualItem.start}px)`,
          }}
        >
          {renderItem(items[virtualItem.index], virtualItem.index)}
        </div>
      ))}
    </div>
  );
}

export const VirtualizedMessageList = React.memo(VirtualizedMessageListInner) as typeof VirtualizedMessageListInner;

/**
 * useVirtualizationThreshold —— 判断是否应启用虚拟化的便捷 hook。
 *
 * @param count 当前消息数
 * @returns 是否超过阈值
 */
export function shouldVirtualize(count: number): boolean {
  return count >= VIRTUALIZATION_THRESHOLD;
}
