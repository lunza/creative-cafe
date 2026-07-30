/**
 * GoalTracker —— 会话目标追踪（适配 openclaw goal-tools.ts 理念）
 *
 * 来源：spec §二 Task 18.2（learning/goalTracker.ts）
 * 决策：适配（spec §三表格：goal-tools 适配，本项目落 SQLite 而非 openclaw 的
 *       session store）。
 *
 * 职责：
 *  1. createSessionGoal：创建会话目标（仅用户/system 显式请求可创建，照抄 openclaw）
 *  2. getSessionGoal：读取当前会话目标快照
 *  3. updateSessionGoalStatus：更新状态（complete | blocked）
 *  4. 阻塞计数器：同一 blocker 连续 3 次才能置为 blocked（照抄 openclaw 规范：
 *     never ordinary difficulty/polish）
 *  5. token 用量累计（tokenBudget 上限保护）
 *
 * 落库策略：
 *  - 目标记录落 SQLite agent_memory 表（type='agent', metadata.kind='goal'）
 *  - 通过 MemoryProvider.write/search 间接操作，避免直接依赖 SQLite backend
 *  - 每次状态变更写新记忆条目（追加日志而非覆盖），便于审计
 *
 * 设计约束（openclaw goal-tools.ts 原则）：
 *  - create_goal 仅显式请求：用户主动 / system 触发，agent 不能自创目标
 *  - update_goal complete 仅在真正达成时使用
 *  - update_goal blocked 仅在「同 blocker 连续 3 次」时使用
 *  - 已存在目标时 create 失败（不覆盖）
 */

import type { IMemoryProvider, MemoryEntry } from '../contracts';
import type { GoalRecord, GoalStatus } from './types';
import { GOAL_BLOCKER_THRESHOLD } from './types';
import { toAgentError } from '../infra/errors';

// ==================== 类型定义 ====================

/**
 * GoalTracker 构造配置。
 */
export interface GoalTrackerConfig {
  memoryProvider: IMemoryProvider;
}

/**
 * 创建目标的参数。
 */
export interface CreateGoalParams {
  sessionId: string;
  characterId?: string;
  objective: string;
  tokenBudget?: number;
}

/**
 * 更新目标状态的参数。
 */
export interface UpdateGoalStatusParams {
  sessionId: string;
  status: 'complete' | 'blocked';
  note?: string;
  /** blocker 描述（status='blocked' 时必填，用于阻塞计数器） */
  blocker?: string;
  /** 本次新增的 token 消耗（可选，累计到 tokensUsed） */
  tokensDelta?: number;
  /** 操作者（user/agent/system，用于审计） */
  actor?: 'user' | 'agent' | 'system';
}

// ==================== GoalTracker 实现 ====================

/**
 * 会话目标追踪器。
 *
 * 实现 openclaw goal-tools.ts 理念：create/get/update 状态 + 阻塞计数器。
 *
 * 数据流：
 *  - create → 写入 memoryStore（type='agent', metadata.kind='goal', status='pending'）
 *  - get → 检索最新一条 goal 记忆
 *  - update → 读取当前状态 → 校验阻塞计数器 → 写入新状态记录
 */
export class GoalTracker {
  private readonly memoryProvider: IMemoryProvider;

  constructor(config: GoalTrackerConfig) {
    this.memoryProvider = config.memoryProvider;
  }

  /**
   * 创建会话目标。
   *
   * @throws Error 如果会话已有未完成目标（pending/in_progress/blocked）
   */
  async createGoal(params: CreateGoalParams): Promise<GoalRecord> {
    if (!params.sessionId) {
      throw toAgentError(new Error('sessionId is required'), 'GoalTracker.createGoal: missing sessionId');
    }
    if (!params.objective?.trim()) {
      throw toAgentError(new Error('objective is required'), 'GoalTracker.createGoal: missing objective');
    }

    // 检查是否已有未完成目标
    const existing = await this.getGoal(params.sessionId);
    if (existing && existing.status !== 'complete') {
      throw toAgentError(
        new Error(`Session ${params.sessionId} already has an active goal: ${existing.objective}`),
        'GoalTracker.createGoal: existing active goal'
      );
    }

    const now = Date.now();
    const goal: GoalRecord = {
      id: generateGoalId(),
      sessionId: params.sessionId,
      characterId: params.characterId,
      objective: params.objective.trim(),
      status: 'pending',
      tokenBudget: params.tokenBudget,
      tokensUsed: 0,
      createdAt: now,
      updatedAt: now,
    };

    await this.persistGoal(goal, 'create');
    return goal;
  }

  /**
   * 获取会话当前目标。
   *
   * 返回最新一条目标记录；若最新状态为 complete（含用户清除），返回 null。
   *
   * ⚠️ BUG 修复（Task 18.2 单元测试发现）：
   *   原逻辑用 `goalEntries.find((g) => g.status !== 'complete')` 找「最新未完成」，
   *   但当目标经历 pending → in_progress → complete 后，最新记录是 complete，
   *   find 会跳过最新 complete 记录、回退到旧的 in_progress/pending 记录，
   *   导致目标 complete 后 getGoal 仍返回旧未完成状态，
   *   进而 createGoal 误判「已有未完成目标」而拒绝新目标创建。
   *
   *   修复：取 updatedAt 最大的记录（最新状态快照），若其非 complete 则返回，否则 null。
   *   这符合「追加日志」模式：每条记录是一次状态快照，最新快照代表当前状态。
   */
  async getGoal(sessionId: string): Promise<GoalRecord | null> {
    if (!sessionId) return null;
    try {
      const results = await this.memoryProvider.search({
        query: '',
        types: ['agent'],
        sessionId,
        limit: 50,
      });

      const goalEntries = results
        .filter((m) => (m.metadata as any)?.kind === 'goal')
        .map(memoryEntryToGoalRecord)
        .filter((g): g is GoalRecord => g !== null)
        .sort((a, b) => b.updatedAt - a.updatedAt);

      if (goalEntries.length === 0) return null;
      // 取最新状态快照：非 complete 则返回，否则 null
      const latest = goalEntries[0];
      return latest.status !== 'complete' ? latest : null;
    } catch (err) {
      console.warn('[GoalTracker] getGoal failed:', err);
      return null;
    }
  }

  /**
   * 更新目标状态。
   *
   * 阻塞计数器逻辑（照抄 openclaw 规范）：
   *  - status='blocked' 时，若 blocker 与上次不同，重置计数为 1
   *  - 若 blocker 相同，计数 +1
   *  - 计数 ≥ GOAL_BLOCKER_THRESHOLD（3）时才真正置为 blocked
   *  - 未达阈值时状态保持 in_progress，仅记录 blocker 计数
   *
   * @throws Error 如果会话无目标或目标已完成
   */
  async updateStatus(params: UpdateGoalStatusParams): Promise<GoalRecord> {
    if (!params.sessionId) {
      throw toAgentError(new Error('sessionId is required'), 'GoalTracker.updateStatus: missing sessionId');
    }

    const current = await this.getGoal(params.sessionId);
    if (!current) {
      throw toAgentError(
        new Error(`No active goal for session ${params.sessionId}`),
        'GoalTracker.updateStatus: no active goal'
      );
    }
    if (current.status === 'complete') {
      throw toAgentError(
        new Error(`Goal already complete: ${current.objective}`),
        'GoalTracker.updateStatus: goal already complete'
      );
    }

    // 累计 token 用量
    const tokensUsed = (current.tokensUsed ?? 0) + (params.tokensDelta ?? 0);

    // token 预算保护（超额时自动标记 blocked，blocker='token_budget_exceeded'）
    if (current.tokenBudget && tokensUsed > current.tokenBudget) {
      const updated: GoalRecord = {
        ...current,
        status: 'blocked',
        tokensUsed,
        note: params.note ?? 'Token budget exceeded',
        blocker: 'token_budget_exceeded',
        consecutiveBlockerCount: GOAL_BLOCKER_THRESHOLD,
        updatedAt: Date.now(),
      };
      await this.persistGoal(updated, 'update:token_budget_exceeded');
      return updated;
    }

    if (params.status === 'complete') {
      const updated: GoalRecord = {
        ...current,
        status: 'complete',
        tokensUsed,
        note: params.note,
        blocker: undefined,
        consecutiveBlockerCount: 0,
        updatedAt: Date.now(),
      };
      await this.persistGoal(updated, 'update:complete');
      return updated;
    }

    // status === 'blocked'：阻塞计数器
    const isSameBlocker = current.blocker && params.blocker && current.blocker === params.blocker;
    const newCount = isSameBlocker ? (current.consecutiveBlockerCount ?? 0) + 1 : 1;
    const shouldBlock = newCount >= GOAL_BLOCKER_THRESHOLD;

    const updated: GoalRecord = {
      ...current,
      status: shouldBlock ? 'blocked' : 'in_progress',
      tokensUsed,
      note: params.note,
      blocker: params.blocker,
      consecutiveBlockerCount: newCount,
      updatedAt: Date.now(),
    };
    await this.persistGoal(
      updated,
      shouldBlock ? `update:blocked:${params.blocker}` : `update:blocker_count:${newCount}`
    );
    return updated;
  }

  /**
   * 清除会话目标（用户手动清除，照抄 openclaw user-facing controls clear it）。
   *
   * 实际操作：将当前目标标记为 complete（note='cleared by user'），
   * 而非物理删除（保留审计记录）。
   */
  async clearGoal(sessionId: string): Promise<void> {
    const current = await this.getGoal(sessionId);
    if (!current) return;
    const cleared: GoalRecord = {
      ...current,
      status: 'complete',
      note: 'cleared by user',
      updatedAt: Date.now(),
    };
    await this.persistGoal(cleared, 'clear:user');
  }

  // ==================== 内部方法 ====================

  /**
   * 持久化 goal 记录到 memoryStore。
   *
   * 采用「追加日志」策略：每次状态变更写新条目，便于审计与状态回溯。
   */
  private async persistGoal(goal: GoalRecord, action: string): Promise<void> {
    try {
      await this.memoryProvider.write({
        type: 'agent',
        content: `Goal: ${goal.objective} [${goal.status}]`,
        source: `goal:${goal.id}`,
        metadata: {
          kind: 'goal',
          goalId: goal.id,
          sessionId: goal.sessionId,
          characterId: goal.characterId,
          objective: goal.objective,
          status: goal.status,
          tokenBudget: goal.tokenBudget,
          tokensUsed: goal.tokensUsed,
          note: goal.note,
          blocker: goal.blocker,
          consecutiveBlockerCount: goal.consecutiveBlockerCount,
          createdAt: goal.createdAt,
          updatedAt: goal.updatedAt,
          action,
        },
        sessionId: goal.sessionId,
        characterId: goal.characterId,
      });
    } catch (err) {
      throw toAgentError(err, `GoalTracker.persistGoal failed: ${action}`);
    }
  }
}

// ==================== 工具函数 ====================

/**
 * 将 MemoryEntry 转换为 GoalRecord。
 *
 * 从 metadata 中提取 goal 字段（追加日志模式下，每条记忆都是一次状态快照）。
 */
function memoryEntryToGoalRecord(entry: MemoryEntry): GoalRecord | null {
  const meta = entry.metadata as any;
  if (!meta || meta.kind !== 'goal') return null;

  return {
    id: meta.goalId ?? entry.id,
    sessionId: meta.sessionId ?? entry.sessionId ?? '',
    characterId: meta.characterId,
    objective: meta.objective ?? entry.content,
    status: (meta.status as GoalStatus) ?? 'pending',
    tokenBudget: meta.tokenBudget,
    tokensUsed: meta.tokensUsed ?? 0,
    note: meta.note,
    blocker: meta.blocker,
    consecutiveBlockerCount: meta.consecutiveBlockerCount ?? 0,
    createdAt: meta.createdAt ?? entry.timestamp,
    updatedAt: meta.updatedAt ?? entry.timestamp,
  };
}

let goalCounter = 0;
function generateGoalId(): string {
  goalCounter += 1;
  return `goal_${Date.now()}_${goalCounter}`;
}

// ==================== 单例 ====================

let trackerInstance: GoalTracker | null = null;

export function getGoalTracker(config?: GoalTrackerConfig): GoalTracker {
  if (!trackerInstance && config) {
    trackerInstance = new GoalTracker(config);
  }
  if (!trackerInstance) {
    throw new Error('GoalTracker not initialized. Call getGoalTracker(config) first.');
  }
  return trackerInstance;
}

export function resetGoalTracker(): void {
  trackerInstance = null;
}
