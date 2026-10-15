/**
 * 【Phase 3 / L3 - conversation-mode-optimization-report】全屏滚动锁定 Hook（R4）。
 *
 * 全屏切换的 body overflow 锁定逻辑原内联在 ChatModal（CharacterDialogueChat 全屏模式），
 * 提取为共享 Hook 供任意全屏浮层复用。FullscreenDialog 采用 CSS 方案（.fullscreen-dialog
 * 自身 overflow: hidden）无需 JS 锁定，故不重复使用本 Hook。
 */
import { useEffect } from 'react';

export function useBodyScrollLock(locked: boolean): void {
  useEffect(() => {
    if (locked) {
      document.body.style.overflow = 'hidden';
    } else {
      document.body.style.overflow = '';
    }
    return () => {
      document.body.style.overflow = '';
    };
  }, [locked]);
}
