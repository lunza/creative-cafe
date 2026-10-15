/**
 * useAgentMode —— Agent 模式状态管理 React Hook（共享）
 *
 * 来源：spec §add-agent-mode-management-and-center Task 5.1 + 5.3
 *
 * 职责：
 *  1. 挂载时通过 agent.mode.getStatus() 查询初始模式状态
 *  2. 订阅 agent:modeChanged 事件，模式变更时实时更新
 *  3. 暴露 setOverride 供 UI 切换三态开关（auto / force-on / force-off）
 *
 * 放置于 src/renderer/hooks/（共享位置），供 Header、Sidebar、ChatEngine 等
 * 非 AgentCenter 组件复用。
 *
 * 对标参考：src/renderer/components/WorldBook/hooks/useWorldBookAuthoring.ts
 */
import { useState, useEffect, useCallback } from 'react';
import type { AgentModeStatus, AgentModeOverride } from '@shared/types';

export function useAgentMode() {
  const [isActive, setIsActive] = useState(false);
  const [status, setStatus] = useState<AgentModeStatus | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let mounted = true;
    const agentModeApi = window.electronAPI?.agent?.mode;

    // 【回归走查发现】裸浏览器模式（npm run dev 只起 vite，无 Electron preload）
    // 下 window.electronAPI 为 undefined，本 effect 直接读 .agent 抛 TypeError，
    // Sidebar/Header 顶层消费本 hook → 整树卸载白屏。加防御降级：API 缺失时
    // 保持默认状态（isActive=false）仅结束 loading，UI 正常渲染。
    if (!agentModeApi) {
      setLoading(false);
      return;
    }

    // 查询初始状态
    agentModeApi.getStatus().then(result => {
      if (mounted && result.ok && result.status) {
        setStatus(result.status);
        setIsActive(result.status.active);
      }
      if (mounted) setLoading(false);
    }).catch(() => {
      // IPC 调用失败时，保持默认状态（isActive=false），仅结束 loading
      if (mounted) setLoading(false);
    });

    // 订阅模式变更事件
    const unsubscribe = agentModeApi.onModeChanged((newStatus) => {
      if (mounted) {
        setStatus(newStatus);
        setIsActive(newStatus.active);
      }
    });

    return () => {
      mounted = false;
      unsubscribe();
    };
  }, []);

  const setOverride = useCallback(async (override: AgentModeOverride) => {
    // 浏览器模式防御：API 缺失时返回失败 Result，调用方按失败路径处理
    if (!window.electronAPI?.agent?.mode) {
      return { ok: false, error: 'Agent 模式 API 不可用（非 Electron 环境）' } as any;
    }
    const result = await window.electronAPI.agent.mode.setOverride(override);
    if (result.ok && result.status) {
      setStatus(result.status);
      setIsActive(result.status.active);
    }
    return result;
  }, []);

  return { isActive, status, loading, setOverride };
}
