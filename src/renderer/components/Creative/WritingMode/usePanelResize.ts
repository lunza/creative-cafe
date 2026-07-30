import React, { useState, useCallback, useRef } from 'react';
import { MIN_PANEL_WIDTH, MAX_PANEL_WIDTH } from '../../../constants/writingModeConstants';

/**
 * usePanelResize —— 写作模式右侧面板拖拽 resize 逻辑（D2 拆分产物）
 *
 * 来源：spec §1.2 D2（WritingModeRightPanel 职责堆积，resize/tabs/渲染耦合）
 * 决策：将 resize handle 的状态与事件监听抽离为独立 hook，面板组件仅消费
 *       `{ isResizing, handleResizeMouseDown }`，职责单一化。
 *
 * 职责：
 *  1. 维护拖拽中状态（isResizing）与起始坐标 refs
 *  2. mousedown 记录起点，mousemove 钳位到 [MIN_PANEL_WIDTH, MAX_PANEL_WIDTH] 并回调 onResize
 *  3. mouseup 结束拖拽，自动清理监听器
 *
 * @param width 当前面板宽度（受控）
 * @param onResize 宽度变更回调（由父组件持久化到 store）
 * @returns `{ isResizing, handleResizeMouseDown }`
 */
export function usePanelResize(
  width: number,
  onResize: (width: number) => void
): {
  isResizing: boolean;
  handleResizeMouseDown: (e: React.MouseEvent) => void;
} {
  const [isResizing, setIsResizing] = useState(false);
  const resizeStartXRef = useRef<number>(0);
  const resizeStartWidthRef = useRef<number>(0);

  const handleResizeMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    setIsResizing(true);
    resizeStartXRef.current = e.clientX;
    resizeStartWidthRef.current = width;
  }, [width]);

  React.useEffect(() => {
    if (!isResizing) return;

    const handleMouseMove = (e: MouseEvent) => {
      const delta = resizeStartXRef.current - e.clientX;
      const newWidth = Math.max(
        MIN_PANEL_WIDTH,
        Math.min(MAX_PANEL_WIDTH, resizeStartWidthRef.current + delta)
      );
      onResize(newWidth);
    };

    const handleMouseUp = () => {
      setIsResizing(false);
    };

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };
  }, [isResizing, onResize]);

  return { isResizing, handleResizeMouseDown };
}
