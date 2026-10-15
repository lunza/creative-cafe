/**
 * useSettingChanged —— 设置变更事件订阅 React Hook（共享）
 *
 * Spec: settings-feature-optimization-report / M-16, N5（设置变更事件总线）
 *
 * 职责：
 *  订阅主进程 `setting:changed` 广播（setting:save 写盘确认成功后发出），
 *  供各 store / 组件在设置变更后刷新本地状态，替代「每次操作时实时读盘」的
 *  隐性约定（DC-8 时延分裂的渲染层解法）。
 *
 * 对标参考：src/renderer/hooks/useAgentMode.ts（agent:modeChanged 订阅模式）
 *
 * 用法：
 * ```ts
 * useSettingChanged(() => {
 *   // 重新拉取设置或刷新本地状态
 * });
 * ```
 */
import { useEffect, useRef } from 'react';

/**
 * 订阅设置变更事件。
 * @param callback 设置变更后的回调（payload 含 presetName / engineCount 摘要）
 */
export function useSettingChanged(callback: (payload: { presetName?: string; engineCount: number }) => void): void {
  const callbackRef = useRef(callback);
  callbackRef.current = callback;

  useEffect(() => {
    const api = window.electronAPI?.setting;
    if (!api?.onChanged) return;
    return api.onChanged((payload) => {
      callbackRef.current(payload);
    });
  }, []);
}
