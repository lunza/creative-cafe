/**
 * useWritingAgent —— 写作智能体编排 React Hook
 *
 * 来源：spec §二 Task 15.2（前端"智能体写作"按钮 + 进度流 + 断点续跑）
 *
 * 职责：
 *  1. 构建 AgentWritingRequest（从当前项目配置 + AI 引擎配置提取 modelConfig/resources/generationParams）
 *  2. 调用 window.electronAPI.writing.agent.run / cancel / resume / status
 *  3. 订阅 writing-agent:progress 事件流，维护进度事件列表与最新状态
 *  4. 暴露 start / cancel / resume / refreshStatus 给 UI
 *
 * 设计约束：
 *  - 单实例守卫：后端已保证同一时刻仅一个编排运行；hook 侧通过 status.running 二次防护
 *  - 进度事件缓存上限 200 条（避免长编排在内存中无限增长）
 *  - 组件卸载时自动取消订阅 progress 事件（不取消后端编排，编排继续在后台运行）
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import { message } from 'antd';
import type {
  WritingAgentRequest,
  WritingAgentResult,
  WritingAgentStatus,
  WritingAgentEvent,
  AgentWritingOptions,
} from '../../../../../shared/types/writing-agent.types';
import { useWritingProjectStore } from '../../../../stores/writingProjectStore';
import { useSettingStore } from '../../../../stores/settingStore';
import type { AIEngineSetting } from '../../../../types/setting';

// ==================== Hook 状态类型 ====================

export interface WritingAgentState {
  /** 是否正在编排 */
  running: boolean;
  /** 是否存在可恢复的 checkpoint */
  hasCheckpoint: boolean;
  /** checkpoint 摘要 */
  checkpoint: WritingAgentStatus['checkpoint'];
  /** 进度事件列表（最新追加到末尾） */
  events: WritingAgentEvent[];
  /** 最新一条事件 */
  latestEvent: WritingAgentEvent | null;
  /** 编排结果（编排完成后设置） */
  result: WritingAgentResult | null;
  /** 是否正在加载状态 */
  loadingStatus: boolean;
}

// ==================== 常量 ====================

/** 进度事件缓存上限 */
const MAX_EVENTS = 200;

// ==================== Hook 实现 ====================

export function useWritingAgent(projectId: string) {
  const [state, setState] = useState<WritingAgentState>({
    running: false,
    hasCheckpoint: false,
    checkpoint: null,
    events: [],
    latestEvent: null,
    result: null,
    loadingStatus: false,
  });

  /** progress 事件订阅取消函数 */
  const unsubscribeRef = useRef<(() => void) | null>(null);

  // ==================== 进度事件订阅 ====================

  const handleProgressEvent = useCallback((event: WritingAgentEvent) => {
    setState((prev) => {
      const newEvents = [...prev.events, event];
      // 超过上限时丢弃最旧的事件
      if (newEvents.length > MAX_EVENTS) {
        newEvents.splice(0, newEvents.length - MAX_EVENTS);
      }
      return {
        ...prev,
        events: newEvents,
        latestEvent: event,
        // 收到 started 事件时清除上次结果
        result: event.type === 'started' ? null : prev.result,
      };
    });
  }, []);

  /**
   * 订阅 progress 事件。
   * 在 start/resume 之前调用，确保事件不丢失。
   */
  const subscribeProgress = useCallback(() => {
    // 先取消旧订阅
    if (unsubscribeRef.current) {
      unsubscribeRef.current();
      unsubscribeRef.current = null;
    }
    if (window.electronAPI?.writing?.agent?.onProgress) {
      unsubscribeRef.current = window.electronAPI.writing.agent.onProgress(handleProgressEvent);
    }
  }, [handleProgressEvent]);

  // 组件卸载时取消订阅
  useEffect(() => {
    return () => {
      if (unsubscribeRef.current) {
        unsubscribeRef.current();
        unsubscribeRef.current = null;
      }
    };
  }, []);

  // ==================== 状态查询 ====================

  const refreshStatus = useCallback(async () => {
    if (!window.electronAPI?.writing?.agent?.status) return;
    setState((prev) => ({ ...prev, loadingStatus: true }));
    try {
      const status: WritingAgentStatus = await window.electronAPI.writing.agent.status();
      setState((prev) => ({
        ...prev,
        running: status.running,
        hasCheckpoint: status.hasCheckpoint,
        checkpoint: status.checkpoint,
        loadingStatus: false,
      }));
    } catch (err) {
      setState((prev) => ({ ...prev, loadingStatus: false }));
      console.error('[useWritingAgent] refreshStatus failed:', err);
    }
  }, []);

  // 挂载时查询一次状态
  useEffect(() => {
    refreshStatus();
  }, [refreshStatus]);

  // ==================== 请求构建 ====================

  /**
   * 从当前项目配置 + AI 引擎配置构建 AgentWritingRequest。
   *
   * @param options 编排选项（由 UI 传入）
   * @param startChapterIndex 起始章节（可选，默认由后端决定）
   * @param endChapterIndex 结束章节（可选，默认到大纲末尾）
   */
  const buildRequest = useCallback(
    (
      options: AgentWritingOptions,
      startChapterIndex?: number,
      endChapterIndex?: number
    ): WritingAgentRequest | { error: string } => {
      const currentProject = useWritingProjectStore.getState().getCurrentProject();
      if (!currentProject) {
        return { error: '未找到当前项目' };
      }
      if (!currentProject.outline?.chapters?.length) {
        return { error: '项目大纲为空，请先生成大纲' };
      }

      // 获取 AI 引擎配置
      const currentSetting = useSettingStore.getState().setting;
      const engines: AIEngineSetting[] = currentSetting?.aiEngines || [];
      const engine = engines.find((e) => e.id === currentSetting?.activeEngineId) || engines[0];
      if (!engine) {
        return { error: '未配置 AI 引擎，请先在设置中配置 AI 服务' };
      }
      if (!engine.model_name) {
        return { error: '未配置 AI 模型名称' };
      }

      // 处理 max_tokens 默认值
      let maxTokens = engine.max_tokens;
      if (maxTokens === undefined || maxTokens === null || Number.isNaN(maxTokens) || maxTokens === 0) {
        maxTokens = 32768;
      }

      const modelConfig = {
        model: engine.model_name,
        temperature: Number(engine.temperature ?? 0.7),
        maxTokens: Number(maxTokens),
      };

      // 从项目配置提取生成参数与资源
      const params = currentProject.config?.parameters;
      const projectResources = currentProject.config?.resources || {};

      const request: WritingAgentRequest = {
        projectId,
        startChapterIndex,
        endChapterIndex,
        modelConfig,
        resources: {
          worldBookIds: projectResources.worldBookIds || [],
          characterCardIds: projectResources.characterCardIds || [],
          userPersonaIds: projectResources.userPersonaIds || [],
          knowledgeItemIds: projectResources.knowledgeItemIds || [],
          writingStyleIds: projectResources.writingStyleIds || [],
        },
        generationParams: {
          style: String(params?.writingStyle || 'serious'),
          perspective: String(params?.narrativePerspective || 'third_person'),
          novelType: String(params?.novelType || 'web_novel'),
          constraints: [],
        },
        customNovelTypeId: params?.customNovelTypeId,
        customWritingStyleId: params?.customWritingStyleId,
        options,
      };
      return request;
    },
    [projectId]
  );

  // ==================== 启动编排 ====================

  const start = useCallback(
    async (
      options: AgentWritingOptions,
      startChapterIndex?: number,
      endChapterIndex?: number
    ): Promise<WritingAgentResult | null> => {
      const built = buildRequest(options, startChapterIndex, endChapterIndex);
      if ('error' in built) {
        message.error(built.error);
        return null;
      }

      // 先订阅 progress，确保事件不丢失
      subscribeProgress();

      // 清空旧事件与结果
      setState((prev) => ({
        ...prev,
        events: [],
        latestEvent: null,
        result: null,
        running: true,
      }));

      try {
        const result = await window.electronAPI.writing.agent.run(built);
        setState((prev) => ({
          ...prev,
          result,
          running: false,
        }));

        if (result.success) {
          message.success(
            `智能体写作完成：成功 ${result.succeededChapters}，跳过 ${result.skippedChapters}，失败 ${result.failedChapters}`
          );
        } else if (result.cancelled) {
          message.info('智能体写作已取消');
        } else {
          message.error(result.error || '智能体写作失败');
        }

        // 刷新 checkpoint 状态
        await refreshStatus();
        return result;
      } catch (err) {
        const errMsg = err instanceof Error ? err.message : String(err);
        setState((prev) => ({ ...prev, running: false }));
        message.error(`智能体写作异常：${errMsg}`);
        return null;
      }
    },
    [buildRequest, subscribeProgress, refreshStatus]
  );

  // ==================== 取消编排 ====================

  const cancel = useCallback(async (): Promise<void> => {
    try {
      const res = await window.electronAPI.writing.agent.cancel();
      if (res.success) {
        message.info('已发送取消请求，正在等待当前章节完成...');
      } else {
        message.warning(res.error || '取消失败');
      }
      await refreshStatus();
    } catch (err) {
      console.error('[useWritingAgent] cancel failed:', err);
    }
  }, [refreshStatus]);

  // ==================== 断点续跑 ====================

  const resume = useCallback(
    async (options: AgentWritingOptions): Promise<WritingAgentResult | null> => {
      const built = buildRequest(options);
      if ('error' in built) {
        message.error(built.error);
        return null;
      }

      subscribeProgress();
      setState((prev) => ({
        ...prev,
        events: [],
        latestEvent: null,
        result: null,
        running: true,
      }));

      try {
        const result = await window.electronAPI.writing.agent.resume(built);
        setState((prev) => ({
          ...prev,
          result,
          running: false,
        }));

        if (result.success) {
          message.success(
            `智能体写作续跑完成：成功 ${result.succeededChapters}，跳过 ${result.skippedChapters}，失败 ${result.failedChapters}`
          );
        } else if (result.cancelled) {
          message.info('智能体写作续跑已取消');
        } else {
          message.error(result.error || '智能体写作续跑失败');
        }

        await refreshStatus();
        return result;
      } catch (err) {
        const errMsg = err instanceof Error ? err.message : String(err);
        setState((prev) => ({ ...prev, running: false }));
        message.error(`智能体写作续跑异常：${errMsg}`);
        return null;
      }
    },
    [buildRequest, subscribeProgress, refreshStatus]
  );

  return {
    state,
    start,
    cancel,
    resume,
    refreshStatus,
  };
}
