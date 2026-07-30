/**
 * Learning 模块 barrel 导出 —— 自适应学习系统
 *
 * 来源：spec §二 Task 18（learning/dreaming）
 *
 * 模块组成：
 *  - types.ts：共享类型（DreamingConfig / GoalRecord / SteerMessage / FeedbackEvent）
 *  - pacing.ts：防失控 pacing 钳位（照抄 openclaw pacing.ts）
 *  - stagger.ts：防锁步抖动窗口（照抄 openclaw stagger.ts）
 *  - cronScheduler.ts：ILearningScheduler 实现（轻量自研 cron + pacing + stagger）
 *  - dreamingService.ts：短期→长期记忆摘要（3 相位：light/deep/rem）
 *  - goalTracker.ts：会话目标追踪（阻塞计数器，照抄 openclaw goal-tools 理念）
 *  - steerEngine.ts：行为引导（lease/inject/ack，照抄 openclaw steering-queue 理念）
 *  - feedbackLoop.ts：反馈回流（LLM 反思 → 经验记忆，照抄 openclaw feedback-reflection）
 *
 * 集成方式：
 *  - 在 agentHandlers.ts 初始化时调用 initLearningServices(backend, llmProvider, memoryProvider)
 *  - cronScheduler 按频率（默认每日 3 点）触发 dreamingService.runAll()
 *  - agentLoop 每轮调用 steerEngine.leasePendingSteer() 注入引导
 *  - 用户反馈通过 IPC agent:recordFeedback → feedbackLoop.recordAndReflect()
 *  - 用户/system 创建目标通过 IPC agent:createGoal → goalTracker.createGoal()
 */

// 类型
export type {
  DreamingPhase,
  DreamingExecutionConfig,
  DreamingPhaseConfig,
  DreamingConfig,
  DreamingPhaseResult,
  DreamingResult,
  GoalStatus,
  GoalRecord,
  SteerMessage,
  SteerLeaseBatch,
  FeedbackEvent,
  FeedbackReflectionResult,
} from './types';

// 默认配置
export {
  DEFAULT_DREAMING_CONFIG,
  DEFAULT_FEEDBACK_COOLDOWN_MS,
  GOAL_BLOCKER_THRESHOLD,
  MAX_STEER_PROMPT_CHARS,
  MAX_STEER_ITEM_CHARS,
} from './types';

// pacing
export {
  parseDurationMs,
  parseCronPacingBounds,
  resolvePacedNextRunAtMs,
} from './pacing';
export type { CronPacing, CronPacingBounds } from './pacing';

// stagger
export {
  DEFAULT_TOP_OF_HOUR_STAGGER_MS,
  normalizeCronStaggerMs,
  resolveDefaultCronStaggerMs,
  resolveCronStaggerMs,
  applyStaggerJitter,
} from './stagger';
export type { CronStaggerSchedule } from './stagger';

// cronScheduler
export {
  CronScheduler,
  getCronScheduler,
  resetCronScheduler,
  parseCronExpression,
  getNextCronRunMs,
} from './cronScheduler';
export type { CronJobRecord, CronTaskCallback } from './cronScheduler';
export type { ParsedCronExpr } from './cronScheduler';

// dreamingService
export {
  DreamingService,
  getDreamingService,
  resetDreamingService,
} from './dreamingService';
export type { DreamingServiceConfig } from './dreamingService';

// goalTracker
export {
  GoalTracker,
  getGoalTracker,
  resetGoalTracker,
} from './goalTracker';
export type {
  GoalTrackerConfig,
  CreateGoalParams,
  UpdateGoalStatusParams,
} from './goalTracker';

// steerEngine
export {
  SteerEngine,
  getSteerEngine,
  resetSteerEngine,
} from './steerEngine';

// feedbackLoop
export {
  FeedbackLoop,
  getFeedbackLoop,
  resetFeedbackLoop,
} from './feedbackLoop';
export type { FeedbackLoopConfig } from './feedbackLoop';

// ==================== 统一初始化 ====================

import type { AgentSqliteBackend } from '../memory/sqliteBackend';
import type { ILLMProvider, IMemoryProvider } from '../contracts';
import { getCronScheduler } from './cronScheduler';
import { getDreamingService } from './dreamingService';
import { getGoalTracker } from './goalTracker';
import { getSteerEngine } from './steerEngine';
import { getFeedbackLoop } from './feedbackLoop';

/**
 * Learning 模块统一初始化配置。
 */
export interface InitLearningConfig {
  backend: AgentSqliteBackend;
  llmProvider: ILLMProvider;
  memoryProvider: IMemoryProvider;
  defaultModel?: string;
  /** 是否启动 cron 调度器（默认 true） */
  autoStartScheduler?: boolean;
  /** 调试日志 */
  verbose?: boolean;
}

/**
 * 初始化结果。
 */
export interface InitLearningResult {
  cronScheduler: ReturnType<typeof getCronScheduler>;
  dreamingService: ReturnType<typeof getDreamingService>;
  goalTracker: ReturnType<typeof getGoalTracker>;
  steerEngine: ReturnType<typeof getSteerEngine>;
  feedbackLoop: ReturnType<typeof getFeedbackLoop>;
}

/**
 * 统一初始化 learning 模块的所有服务。
 *
 * 在 agentHandlers.ts 初始化期调用：
 *  1. 创建 CronScheduler（不自动 start）
 *  2. 创建 DreamingService（注入 llm/memory provider）
 *  3. 创建 GoalTracker / SteerEngine / FeedbackLoop
 *  4. 将 DreamingService.runAll 注册为 cron 任务（默认每日 3 点）
 *  5. 将 SteerEngine.discardStaleSteer 注册为每日清理任务
 *  6. autoStartScheduler=true 时启动 CronScheduler
 *
 * 幂等：重复调用返回已初始化的实例（不重复创建）。
 */
export function initLearningServices(config: InitLearningConfig): InitLearningResult {
  const cronScheduler = getCronScheduler({
    backend: config.backend,
  });

  const dreamingService = getDreamingService({
    llmProvider: config.llmProvider,
    memoryProvider: config.memoryProvider,
    defaultModel: config.defaultModel,
    verbose: config.verbose,
  });

  const goalTracker = getGoalTracker({
    memoryProvider: config.memoryProvider,
  });

  const steerEngine = getSteerEngine({
    backend: config.backend,
  });

  const feedbackLoop = getFeedbackLoop({
    llmProvider: config.llmProvider,
    memoryProvider: config.memoryProvider,
    defaultModel: config.defaultModel,
    verbose: config.verbose,
  });

  // 桥接：dreamNow 委托给 DreamingService
  cronScheduler.setDreamingCallback(async (sessionId) => {
    await dreamingService.runAll(sessionId);
  });

  // 注册定时任务（仅首次注册，避免重复）
  const existingJobs = cronScheduler.getPendingTasks();
  const hasDreamingJob = existingJobs.some((j) => j.label === 'daily-dreaming');
  if (!hasDreamingJob) {
    cronScheduler.schedule(
      '0 3 * * *', // 默认每日凌晨 3 点
      async () => {
        await dreamingService.runAll();
      },
      {
        label: 'daily-dreaming',
        minIntervalMs: 60 * 60 * 1000, // 至少 1 小时间隔（pacing 防失控）
        staggerMs: 5 * 60 * 1000, // 5 分钟抖动
        allowConcurrent: false,
      }
    );
  }

  const hasCleanupJob = existingJobs.some((j) => j.label === 'daily-steer-cleanup');
  if (!hasCleanupJob) {
    cronScheduler.schedule(
      '0 4 * * *', // 默认每日凌晨 4 点（dreaming 之后）
      async () => {
        await steerEngine.discardStaleSteer();
      },
      {
        label: 'daily-steer-cleanup',
        allowConcurrent: false,
      }
    );
  }

  if (config.autoStartScheduler !== false) {
    cronScheduler.start();
  }

  return { cronScheduler, dreamingService, goalTracker, steerEngine, feedbackLoop };
}
