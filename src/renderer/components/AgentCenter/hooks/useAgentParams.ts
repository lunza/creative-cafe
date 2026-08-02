/**
 * useAgentParams — 智能体对话参数持久化 hook
 *
 * 按 agentId 将参数配置持久化到 localStorage，
 * 切换智能体时自动加载对应配置。
 */
import { useState, useEffect, useCallback } from 'react';

/** 辅助模式强度 */
export type AssistModeIntensity = 'low' | 'medium' | 'high';

/** 智能体对话参数 */
export interface AgentParams {
  /** 自定义人格文本（引导回复语气/表达方式/应答风格/破限规则） */
  customPersonality: string;
  /** 辅助模式开关 */
  assistMode: boolean;
  /** 辅助模式强度 */
  assistModeIntensity: AssistModeIntensity;
}

/** 默认参数 */
export const DEFAULT_AGENT_PARAMS: AgentParams = {
  customPersonality: '',
  assistMode: false,
  assistModeIntensity: 'medium',
};

/** localStorage key 前缀 */
const STORAGE_PREFIX = 'agent-params-';

/** 从 localStorage 加载参数 */
function loadParams(agentId: string): AgentParams {
  if (!agentId) return { ...DEFAULT_AGENT_PARAMS };
  try {
    const raw = localStorage.getItem(STORAGE_PREFIX + agentId);
    if (!raw) return { ...DEFAULT_AGENT_PARAMS };
    const parsed = JSON.parse(raw);
    return {
      customPersonality: typeof parsed.customPersonality === 'string' ? parsed.customPersonality : '',
      assistMode: typeof parsed.assistMode === 'boolean' ? parsed.assistMode : false,
      assistModeIntensity: ['low', 'medium', 'high'].includes(parsed.assistModeIntensity) ? parsed.assistModeIntensity : 'medium',
    };
  } catch {
    return { ...DEFAULT_AGENT_PARAMS };
  }
}

/** 保存参数到 localStorage */
function saveParams(agentId: string, params: AgentParams): void {
  if (!agentId) return;
  try {
    localStorage.setItem(STORAGE_PREFIX + agentId, JSON.stringify(params));
  } catch {
    // 存储失败时静默
  }
}

/**
 * 使用智能体参数。
 *
 * @param agentId 智能体 ID，切换时自动加载对应配置
 * @returns { params, updateParams, resetParams }
 */
export function useAgentParams(agentId: string) {
  const [params, setParams] = useState<AgentParams>(() => loadParams(agentId));

  // 切换 agentId 时重新加载
  useEffect(() => {
    setParams(loadParams(agentId));
  }, [agentId]);

  /** 更新部分参数（实时持久化） */
  const updateParams = useCallback((partial: Partial<AgentParams>) => {
    setParams(prev => {
      const next = { ...prev, ...partial };
      saveParams(agentId, next);
      return next;
    });
  }, [agentId]);

  /** 重置为默认值（实时持久化） */
  const resetParams = useCallback(() => {
    const defaults = { ...DEFAULT_AGENT_PARAMS };
    setParams(defaults);
    saveParams(agentId, defaults);
  }, [agentId]);

  return { params, updateParams, resetParams };
}
