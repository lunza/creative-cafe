/**
 * useWorldBookAuthoring —— 世界书编写智能体编排 React Hook
 *
 * 来源：spec §二 Task 6.1（implement-worldbook-authoring-agent）
 *
 * 对标参考：`src/renderer/components/Creative/WritingMode/hooks/useWritingAgent.ts`
 *
 * 职责：
 *  1. 构建编写请求（userPrompt + worldBookPath + allowedWorldBookPaths + config）
 *  2. 调用 window.electronAPI.worldBookAgent.run / cancel / resume / status / answer
 *  3. 订阅 worldbookAgent:progress 事件流（含 phase='planning_clarifying' 携带 clarifyingQuestions）
 *  4. 暴露 start / cancel / resume / refreshStatus / submitAnswers 给 UI
 *
 * 设计约束（对齐 useWritingAgent.ts）：
 *  - 单实例守卫：后端 worldbookAuthoringService 已保证 worldBookPath 维度单实例；
 *    hook 侧通过 status.running 二次防护
 *  - 进度事件缓存上限 200 条（避免长编排在内存中无限增长）
 *  - 组件卸载时自动取消订阅 progress 事件（不取消后端编排，编排继续在后台运行）
 *  - 澄清问题交互：phase='planning_clarifying' 事件携带 clarifyingQuestions 扩展字段
 *    （主进程 worldbookAuthoringService 通过 intersection type 附加，
 *     AuthoringProgressEvent 公开类型未声明该字段），hook 内通过类型守卫读取
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import { message } from 'antd';
import type {
  AuthoringProgressEvent,
  AuthoringSession,
  AuthoringState,
  ClarifyingQuestion,
  AuditReport,
  AuthoringConfig,
  ThoughtStep,
} from '../../../../shared/types/worldbook-authoring.types';

// ==================== Hook 状态类型 ====================

/**
 * 编写运行结果（来自 worldBookAgent:run / resume 的 result 字段）。
 *
 * 与 electron.d.ts 中 worldBookAgent.run 返回的 result 结构一致；
 * 单独定义以便 hook 状态引用，避免 any。
 */
export interface WorldBookAuthoringRunResult {
  success: boolean;
  sessionId: string;
  finalState: AuthoringState | 'CANCELLED' | 'ERROR';
  generatedEntryIds: Array<number | string>;
  auditReport?: AuditReport;
  totalDurationMs: number;
  error?: string;
}

/**
 * useWorldBookAuthoring hook 暴露的状态。
 *
 * 字段对齐 useWritingAgent 的 WritingAgentState 模式：
 *  - running：是否正在编排
 *  - events：进度事件列表（最新追加到末尾）
 *  - latestEvent：最新一条事件
 *  - result：编排结果（编排完成后设置）
 *  - session：当前会话快照（status 查询返回，可恢复断点）
 *  - loadingStatus：是否正在加载状态
 *  - clarifyQuestions：当前等待用户回答的澄清问题列表
 *    （phase='planning_clarifying' 事件携带；用户回答后清空）
 *  - sessionId：当前活跃会话 ID（run 启动后填充，用于 cancel/answer 调用）
 */
export interface WorldBookAuthoringState {
  /** 是否正在编排 */
  running: boolean;
  /** 进度事件列表（最新追加到末尾） */
  events: AuthoringProgressEvent[];
  /** 最新一条事件 */
  latestEvent: AuthoringProgressEvent | null;
  /** 编排结果（编排完成后设置） */
  result: WorldBookAuthoringRunResult | null;
  /** 当前会话快照（status 查询返回） */
  session: AuthoringSession | null;
  /** 是否正在加载状态 */
  loadingStatus: boolean;
  /** 当前等待用户回答的澄清问题列表 */
  clarifyQuestions: ClarifyingQuestion[];
  /** 当前活跃会话 ID */
  sessionId: string | null;
  /** 思考步骤列表（来自 progress 事件携带的 thoughtStep，最新追加到末尾） */
  thoughtSteps: ThoughtStep[];
}

// ==================== 常量 ====================

/** 进度事件缓存上限（对齐 useWritingAgent.ts 的 MAX_EVENTS） */
const MAX_EVENTS = 200;

/** 思考步骤缓存上限（避免长编排 thoughtSteps 无限增长） */
const MAX_THOUGHT_STEPS = 100;

/**
 * 类型守卫：判断 progress 事件是否携带 clarifyingQuestions 扩展字段。
 *
 * 设计原因：主进程 worldbookAuthoringService 在 PLANNING 阶段推送
 * phase='planning_clarifying' 事件时，通过 intersection type
 * `AuthoringProgressEvent & { clarifyingQuestions?: ... }` 附加问题列表
 * （见 worldbookAuthoringService.ts:576）。AuthoringProgressEvent 公开类型
 * 未声明该字段，故 hook 内通过类型守卫安全访问。
 *
 * @param event 进度事件
 * @returns 是否携带 clarifyingQuestions 字段（且为数组）
 */
function hasClarifyingQuestions(
  event: AuthoringProgressEvent
): event is AuthoringProgressEvent & { clarifyingQuestions: ClarifyingQuestion[] } {
  return (
    event.phase === 'planning_clarifying' &&
    Array.isArray(
      (event as AuthoringProgressEvent & { clarifyingQuestions?: unknown }).clarifyingQuestions
    )
  );
}

// ==================== Hook 实现 ====================

/**
 * 世界书编写智能体编排 hook。
 *
 * @param worldBookPath 主世界书文件绝对路径（由 Modal props 传入，
 *                      Task 7 中 WorldBookManager 将当前选中世界书路径透传至此）
 */
export function useWorldBookAuthoring(worldBookPath: string) {
  const [state, setState] = useState<WorldBookAuthoringState>({
    running: false,
    events: [],
    latestEvent: null,
    result: null,
    session: null,
    loadingStatus: false,
    clarifyQuestions: [],
    sessionId: null,
    thoughtSteps: [],
  });

  /** progress 事件订阅取消函数 */
  const unsubscribeRef = useRef<(() => void) | null>(null);

  // ==================== 进度事件订阅 ====================

  /**
   * 处理 progress 事件。
   *
   * - 追加到 events 列表（超过上限丢弃最旧的）
   * - 更新 latestEvent
   * - 若事件为 phase='planning_clarifying' 且携带 clarifyingQuestions，
   *   将问题列表写入 state.clarifyQuestions（供 UI 渲染问题输入区）
   * - 若事件为 phase='complete' / 'cancelled' / 'error'，清空 clarifyQuestions
   */
  const handleProgressEvent = useCallback((event: AuthoringProgressEvent) => {
    setState((prev) => {
      const newEvents = [...prev.events, event];
      // 超过上限时丢弃最旧的事件
      if (newEvents.length > MAX_EVENTS) {
        newEvents.splice(0, newEvents.length - MAX_EVENTS);
      }

      // 澄清问题处理
      let clarifyQuestions = prev.clarifyQuestions;
      if (hasClarifyingQuestions(event)) {
        // 推送了新的澄清问题 → 更新待回答列表
        clarifyQuestions = event.clarifyingQuestions;
      } else if (
        event.phase === 'complete' ||
        event.phase === 'cancelled' ||
        event.phase === 'error'
      ) {
        // 会话结束 → 清空待回答列表
        clarifyQuestions = [];
      }

      // 思考步骤处理：事件携带 thoughtStep 时追加到时间线
      let thoughtSteps = prev.thoughtSteps;
      if (event.thoughtStep) {
        thoughtSteps = [...thoughtSteps, event.thoughtStep];
        // 上限 100 条，超出丢弃最旧的
        if (thoughtSteps.length > MAX_THOUGHT_STEPS) {
          thoughtSteps = thoughtSteps.slice(thoughtSteps.length - MAX_THOUGHT_STEPS);
        }
      }

      return {
        ...prev,
        events: newEvents,
        latestEvent: event,
        clarifyQuestions,
        thoughtSteps,
        // 从 progress 事件中提取 sessionId，解决阻塞调用期间 state.sessionId 仍为 null 的时序问题
        sessionId: event.sessionId ?? prev.sessionId,
      };
    });
  }, []);

  /**
   * 订阅 progress 事件。
   * 在 start/resume 之前调用，确保事件不丢失。
   */
  const subscribeProgress = useCallback(() => {
    // 先取消旧订阅（避免重复订阅导致事件重复回调）
    if (unsubscribeRef.current) {
      unsubscribeRef.current();
      unsubscribeRef.current = null;
    }
    if (window.electronAPI?.worldBookAgent?.onProgress) {
      unsubscribeRef.current = window.electronAPI.worldBookAgent.onProgress(handleProgressEvent);
    }
  }, [handleProgressEvent]);

  // 组件卸载时取消订阅（不取消后端编排，编排继续在后台运行）
  useEffect(() => {
    return () => {
      if (unsubscribeRef.current) {
        unsubscribeRef.current();
        unsubscribeRef.current = null;
      }
    };
  }, []);

  // ==================== 状态查询 ====================

  /**
   * 查询会话状态。
   * - 传入 sessionId：查询单会话状态
   * - 不传：查询所有活跃会话（当前后端返回 sessions: []，前端仅用于探活）
   *
   * 同时更新 state.session / state.sessionId / state.running。
   */
  const refreshStatus = useCallback(
    async (sessionId?: string): Promise<void> => {
      if (!window.electronAPI?.worldBookAgent?.status) return;
      setState((prev) => ({ ...prev, loadingStatus: true }));
      try {
        const res = await window.electronAPI.worldBookAgent.status(sessionId);
        if (res?.ok) {
          setState((prev) => ({
            ...prev,
            session: res.session ?? null,
            sessionId: res.session?.id ?? prev.sessionId,
            // 后端 session.state 反映真实运行状态；session 不存在时认为不在运行
            running: res.session
              ? !['COMPLETE', 'CANCELLED', 'ERROR'].includes(res.session.state)
              : false,
            loadingStatus: false,
          }));
        } else {
          // 查询失败（如 SESSION_NOT_FOUND）：视为不在运行
          setState((prev) => ({
            ...prev,
            session: null,
            running: false,
            loadingStatus: false,
          }));
        }
      } catch (err) {
        setState((prev) => ({ ...prev, loadingStatus: false }));
        console.error('[useWorldBookAuthoring] refreshStatus failed:', err);
      }
    },
    []
  );

  // 挂载时查询一次状态（探活后端是否有可恢复的会话）
  useEffect(() => {
    refreshStatus();
  }, [refreshStatus]);

  // ==================== 请求构建 ====================

  /**
   * 构建启动请求的 config 部分。
   *
   * @param qualityThreshold 用户在配置态调整的质量门槛 [0, 1]
   * @param enableWebSearch 是否启用网络搜索补充上下文（Spec: add-agent-web-search-tool / Task 11）。
   *        默认 false（对齐 DEFAULT_AUTHORING_CONFIG.enableWebSearch）。
   *        true 时同时设置 webSearchMaxResults=5（与默认值一致；后续可由设置面板覆盖）。
   * @returns AuthoringConfig（仅渲染进程可见字段，主进程会合并默认值与 LLM 配置）
   */
  const buildConfig = useCallback(
    (qualityThreshold: number, enableWebSearch: boolean = false): AuthoringConfig => {
      // 渲染进程仅构造 AuthoringConfig 字段；
      // 主进程 worldbookAuthoringService 会合并 DEFAULT_AUTHORING_CONFIG 与 llmConfig。
      return {
        maxEntriesPerDimension: 5,
        minEntriesPerDimension: 2,
        auditThreshold: Math.max(0, Math.min(1, qualityThreshold)),
        pacingMinMs: 2000,
        pacingMaxMs: 30000,
        enableAutoFix: true,
        // Spec: add-agent-web-search-tool — 透传网络搜索开关与结果数上限
        // 字段可选；false 时主进程 isWebSearchEnabled 返回 false，跳过所有 webSearch 调用（向后兼容）
        enableWebSearch,
        webSearchMaxResults: 5,
      };
    },
    []
  );

  // ==================== 启动编排 ====================

  /**
   * 启动编写会话。
   *
   * 流程：
   *  1. 校验入参（userPrompt / worldBookPath 非空）
   *  2. 订阅 progress 事件（先订阅，确保事件不丢失）
   *  3. 清空旧 events / result / clarifyQuestions
   *  4. 调用 worldBookAgent.run
   *  5. 根据 ok 字段判定成功/失败，写入 state.result
   *
   * @param userPrompt 用户初始提示
   * @param qualityThreshold 质量门槛 [0, 1]（默认 0.8）
   * @param enableWebSearch 是否启用网络搜索补充上下文（Spec: add-agent-web-search-tool / Task 11，默认 false）
   * @returns 编排结果（成功）或 null（失败/取消）
   */
  const start = useCallback(
    async (
      userPrompt: string,
      qualityThreshold: number = 0.8,
      enableWebSearch: boolean = false
    ): Promise<WorldBookAuthoringRunResult | null> => {
      // 入参校验
      if (!userPrompt.trim()) {
        message.error('请输入初始提示');
        return null;
      }
      if (!worldBookPath) {
        message.error('未选择世界书文件，无法启动智能体编写');
        return null;
      }

      const config = buildConfig(qualityThreshold, enableWebSearch);

      // 先订阅 progress，确保事件不丢失
      subscribeProgress();

      // 清空旧事件与结果
      setState((prev) => ({
        ...prev,
        events: [],
        latestEvent: null,
        result: null,
        running: true,
        clarifyQuestions: [],
        session: null,
      }));

      try {
        const res = await window.electronAPI.worldBookAgent.run({
          userPrompt,
          worldBookPath,
          allowedWorldBookPaths: [worldBookPath],
          config,
        });

        if (!res?.ok || !res.result) {
          // 启动失败：AGENT_MODE_DISABLED / RUN_FAILED / INVALID_ARGS
          const errMsg = res?.error ?? 'RUN_FAILED';
          const reason = res?.reason ?? '智能体编写启动失败';
          setState((prev) => ({ ...prev, running: false }));
          if (errMsg === 'AGENT_MODE_DISABLED') {
            message.error(`Agent 模式未开启：${reason}`);
          } else {
            message.error(reason);
          }
          return null;
        }

        const result = res.result;
        setState((prev) => ({
          ...prev,
          result,
          running: false,
          sessionId: result.sessionId,
        }));

        // 用户提示
        if (result.success) {
          message.success(
            `智能体编写完成：生成 ${result.generatedEntryIds.length} 条草稿条目`
          );
        } else if (result.finalState === 'CANCELLED') {
          message.info('智能体编写已取消，已生成的草稿条目保留在待审阅区');
        } else {
          message.error(result.error || '智能体编写失败');
        }

        // 刷新会话状态
        await refreshStatus(result.sessionId);
        return result;
      } catch (err) {
        const errMsg = err instanceof Error ? err.message : String(err);
        setState((prev) => ({ ...prev, running: false }));
        message.error(`智能体编写异常：${errMsg}`);
        return null;
      }
    },
    [worldBookPath, buildConfig, subscribeProgress, refreshStatus]
  );

  // ==================== 取消编排 ====================

  /**
   * 取消当前会话。
   * 已生成的草稿条目保留（spec §Requirement: 断点续跑与取消）。
   */
  const cancel = useCallback(async (): Promise<void> => {
    const sessionId = state.sessionId;
    if (!sessionId) {
      message.warning('无活跃会话可取消');
      return;
    }
    try {
      const res = await window.electronAPI.worldBookAgent.cancel(sessionId);
      if (res?.ok) {
        message.info('已发送取消请求，正在等待当前操作完成...');
      } else {
        const code = res?.error ?? 'CANCEL_FAILED';
        if (code === 'SESSION_NOT_FOUND') {
          // 会话已结束，无需取消
          message.info('会话已结束');
        } else {
          message.warning(res?.reason || '取消失败');
        }
      }
      await refreshStatus(sessionId);
    } catch (err) {
      console.error('[useWorldBookAuthoring] cancel failed:', err);
    }
  }, [state.sessionId, refreshStatus]);

  // ==================== 断点续跑 ====================

  /**
   * 从断点恢复会话。
   *
   * @param sessionId 待恢复的会话 ID（若不传则使用 state.sessionId）
   */
  const resume = useCallback(
    async (sessionId?: string): Promise<WorldBookAuthoringRunResult | null> => {
      const sid = sessionId ?? state.sessionId;
      if (!sid) {
        message.error('无可恢复的会话');
        return null;
      }

      // 先订阅 progress，确保事件不丢失
      subscribeProgress();

      setState((prev) => ({
        ...prev,
        events: [],
        latestEvent: null,
        result: null,
        running: true,
        clarifyQuestions: [],
      }));

      try {
        const res = await window.electronAPI.worldBookAgent.resume(sid);

        if (!res?.ok || !res.result) {
          const errMsg = res?.error ?? 'RESUME_FAILED';
          const reason = res?.reason ?? '智能体编写续跑失败';
          setState((prev) => ({ ...prev, running: false }));
          if (errMsg === 'AGENT_MODE_DISABLED') {
            message.error(`Agent 模式未开启：${reason}`);
          } else {
            message.error(reason);
          }
          return null;
        }

        const result = res.result;
        setState((prev) => ({
          ...prev,
          result,
          running: false,
          sessionId: result.sessionId,
        }));

        if (result.success) {
          message.success(
            `智能体编写续跑完成：共生成 ${result.generatedEntryIds.length} 条草稿条目`
          );
        } else if (result.finalState === 'CANCELLED') {
          message.info('智能体编写续跑已取消');
        } else {
          message.error(result.error || '智能体编写续跑失败');
        }

        await refreshStatus(result.sessionId);
        return result;
      } catch (err) {
        const errMsg = err instanceof Error ? err.message : String(err);
        setState((prev) => ({ ...prev, running: false }));
        message.error(`智能体编写续跑异常：${errMsg}`);
        return null;
      }
    },
    [state.sessionId, subscribeProgress, refreshStatus]
  );

  // ==================== 回答澄清问题 ====================

  /**
   * 提交澄清问题的回答。
   *
   * 用户在运行态回答 / 跳过问题后调用，通过 worldbookAgent:answer 回传到主进程，
   * 唤醒 worldbookAuthoringService 中等待的 Promise（spec §Requirement: 主动提出澄清问题）。
   *
   * @param answers 回答列表（questionId + answer? + skipped）
   * @returns 是否成功提交（true=主进程已接受，false=会话未在等待回答或提交失败）
   */
  const submitAnswers = useCallback(
    async (
      answers: Array<{ questionId: string; answer?: string; skipped: boolean }>
    ): Promise<boolean> => {
      const sessionId = state.sessionId;
      if (!sessionId) {
        message.error('无活跃会话，无法提交回答');
        return false;
      }
      try {
        const res = await window.electronAPI.worldBookAgent.answer(sessionId, answers);
        if (res?.ok) {
          // 提交成功 → 清空待回答问题列表
          setState((prev) => ({ ...prev, clarifyQuestions: [] }));
          message.success('已提交回答，智能体继续规划...');
          return true;
        }
        const code = res?.error ?? 'ANSWER_FAILED';
        if (code === 'NOT_AWAITING_ANSWERS') {
          message.warning('会话未在等待回答（可能已超时或状态已变）');
        } else {
          message.error(res?.reason || '提交回答失败');
        }
        return false;
      } catch (err) {
        console.error('[useWorldBookAuthoring] submitAnswers failed:', err);
        message.error('提交回答异常');
        return false;
      }
    },
    [state.sessionId]
  );

  // ==================== 重置（用于"重新开始"） ====================

  /**
   * 重置 hook 状态到初始配置态（保留 sessionId 探活能力）。
   *
   * 用于完成态"重新开始"按钮：清空 result / events / clarifyQuestions，
   * 让 Modal 回到配置态视图。
   */
  const reset = useCallback((): void => {
    setState({
      running: false,
      events: [],
      latestEvent: null,
      result: null,
      session: null,
      loadingStatus: false,
      clarifyQuestions: [],
      sessionId: null,
      thoughtSteps: [],
    });
  }, []);

  return {
    state,
    start,
    cancel,
    resume,
    refreshStatus,
    submitAnswers,
    reset,
  };
}
