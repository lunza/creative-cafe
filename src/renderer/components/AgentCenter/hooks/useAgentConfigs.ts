/**
 * useAgentConfigs —— 智能体配置列表管理 React Hook
 *
 * 来源：spec §add-agent-mode-management-and-center Task 5.2
 *
 * 职责：
 *  1. 挂载时通过 agent.config.list() 加载智能体配置列表
 *  2. 订阅 agent-config:changed 事件，配置变更时自动刷新
 *  3. 暴露 toggleStatus / updateConfig / updateSkills 供 UI 操作
 *
 * 放置于 src/renderer/components/AgentCenter/hooks/（AgentCenter 专用）。
 *
 * 对标参考：src/renderer/components/WorldBook/hooks/useWorldBookAuthoring.ts
 */
import { useState, useEffect, useCallback } from 'react';
import type { AgentConfig } from '@shared/types';

export function useAgentConfigs() {
  const [configs, setConfigs] = useState<AgentConfig[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const result = await window.electronAPI.agent.config.list();
      if (result.ok && result.configs) {
        setConfigs(result.configs);
        setError(null);
      } else {
        setError(result.error || '加载失败');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();

    const unsubscribe = window.electronAPI.agent.config.onConfigChanged(() => {
      refresh();
    });

    return () => {
      unsubscribe();
    };
  }, [refresh]);

  const toggleStatus = useCallback(async (id: string) => {
    const result = await window.electronAPI.agent.config.toggle(id);
    if (result.ok && result.config) {
      setConfigs(prev => prev.map(c => c.id === id ? result.config! : c));
    }
    return result;
  }, []);

  const updateConfig = useCallback(async (id: string, patch: Partial<AgentConfig>) => {
    const result = await window.electronAPI.agent.config.update(id, patch);
    if (result.ok && result.config) {
      setConfigs(prev => prev.map(c => c.id === id ? result.config! : c));
    }
    return result;
  }, []);

  const updateSkills = useCallback(async (id: string, skills: string[]) => {
    const result = await window.electronAPI.agent.config.updateSkills(id, skills);
    if (result.ok && result.config) {
      setConfigs(prev => prev.map(c => c.id === id ? result.config! : c));
    }
    return result;
  }, []);

  const createAgent = useCallback(async (config: Omit<AgentConfig, 'id' | 'createdAt' | 'updatedAt' | 'isSystem'>) => {
    const result = await window.electronAPI.agent.config.create(config);
    if (result.ok && result.config) {
      setConfigs(prev => [...prev, result.config!]);
    }
    return result;
  }, []);

  const deleteAgent = useCallback(async (id: string) => {
    const result = await window.electronAPI.agent.config.delete(id);
    if (result.ok) {
      setConfigs(prev => prev.filter(c => c.id !== id));
    }
    return result;
  }, []);

  return { configs, loading, error, refresh, toggleStatus, updateConfig, updateSkills, createAgent, deleteAgent };
}
