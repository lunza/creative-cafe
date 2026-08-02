/**
 * AgentModeService —— Agent 模式管理服务
 *
 * 来源：spec §add-agent-mode-management-and-center / Task 2
 *
 * 职责：
 *  1. 根据用户覆盖设置（override）+ 模型工具调用能力（supportsToolCalling）
 *     判定 Agent 模式是否激活。
 *  2. 提供 getStatus / isAgentModeActive / setOverride / reevaluate 接口。
 *  3. 模式切换时广播事件（onModeChanged 订阅）+ 写审计日志（memoryStore）。
 *
 * 判定逻辑（核心）：
 *  - override === 'force-on'  → active=true,  reason='force-on'
 *  - override === 'force-off' → active=false, reason='force-off'
 *  - override === 'auto'      → active=supportsToolCalling,
 *                                reason='tool-calling-supported' | 'tool-calling-unsupported'
 *
 * 单例：模块导出唯一实例 agentModeService。实际初始化在 app 启动后由
 * reevaluate(activeEngine) 触发（传入当前激活引擎的设置与能力）。
 */

import type {
  AgentModeOverride,
  AgentModeReason,
  AgentModeStatus,
} from './agentConfigTypes';
import { getMemoryStore } from '../memory/memoryStore';

/**
 * reevaluate 接收的最小引擎描述。
 *
 * 为避免主进程跨层依赖渲染进程类型（src/renderer/types/setting.ts），
 * 此处内联定义 reevaluate 所需的最小字段集，而非直接引用 AIEngineSetting。
 * 调用方（Task 3/4 的 IPC / 启动流程）从 AIEngineSetting 中提取这些字段传入。
 */
export interface ActiveEngineSnapshot {
  /** @deprecated 已被 agentModeOverride 三态开关替代，保留为只读兼容快照 */
  useAgent: boolean;
  /** Agent 模式覆盖设置（三态开关） */
  agentModeOverride: AgentModeOverride;
  /** 后端能力探测（仅关注 supportsToolCalling） */
  capabilities?: {
    supportsToolCalling?: boolean;
  };
}

/**
 * Agent 模式管理服务。
 *
 * 状态机：override × supportsToolCalling → { active, reason }。
 * 状态变更时：
 *  - 语义变化（active / reason / supportsToolCalling / override 任一改变）→ 广播新状态给订阅者
 *  - active 翻转（true↔false）→ 额外写审计日志到 memoryStore
 */
export class AgentModeService {
  private status: AgentModeStatus = {
    active: false,
    reason: 'tool-calling-unsupported',
    supportsToolCalling: false,
    override: 'auto',
    lastChangedAt: Date.now(),
  };

  private readonly callbacks = new Set<(status: AgentModeStatus) => void>();

  /** 获取当前模式状态（返回副本，防止外部突变） */
  getStatus(): AgentModeStatus {
    return { ...this.status };
  }

  /** Agent 模式是否激活 */
  isAgentModeActive(): boolean {
    return this.status.active;
  }

  /**
   * 设置覆盖开关，基于当前 supportsToolCalling 重新评估并触发回调。
   *
   * @param override 新的覆盖设置
   */
  setOverride(override: AgentModeOverride): void {
    this.applyEvaluation(override, this.status.supportsToolCalling);
  }

  /**
   * 当引擎切换或能力变化时重新评估模式状态。
   *
   * 读取引擎设置中的 agentModeOverride 与 capabilities.supportsToolCalling，
   * 重新计算 active / reason，必要时广播 + 审计。
   *
   * @param activeEngine 当前激活引擎的最小快照
   */
  reevaluate(activeEngine: ActiveEngineSnapshot): void {
    // agentModeOverride 为 Task 1 新增字段，旧 settings.json 可能缺失，缺省 'auto'
    const override: AgentModeOverride = activeEngine.agentModeOverride ?? 'auto';
    const supportsToolCalling = activeEngine.capabilities?.supportsToolCalling ?? false;
    this.applyEvaluation(override, supportsToolCalling);
  }

  /**
   * 订阅模式变更事件。
   *
   * @param callback 状态变更回调（接收状态副本）
   * @returns 取消订阅函数
   */
  onModeChanged(callback: (status: AgentModeStatus) => void): () => void {
    this.callbacks.add(callback);
    return () => {
      this.callbacks.delete(callback);
    };
  }

  // ==================== 内部方法 ====================

  /**
   * 核心：根据 override + supportsToolCalling 计算新状态，必要时广播 + 审计。
   *
   * 语义变化（active/reason/supportsToolCalling/override 任一改变）才更新状态并广播；
   * 仅 active 翻转时写审计日志。
   */
  private applyEvaluation(override: AgentModeOverride, supportsToolCalling: boolean): void {
    let active: boolean;
    let reason: AgentModeReason;

    if (override === 'force-on') {
      active = true;
      reason = 'force-on';
    } else if (override === 'force-off') {
      active = false;
      reason = 'force-off';
    } else {
      // override === 'auto'
      active = supportsToolCalling;
      reason = supportsToolCalling ? 'tool-calling-supported' : 'tool-calling-unsupported';
    }

    const prev = this.status;
    const semanticChanged =
      prev.active !== active ||
      prev.reason !== reason ||
      prev.supportsToolCalling !== supportsToolCalling ||
      prev.override !== override;

    if (!semanticChanged) {
      return;
    }

    const activeFlipped = prev.active !== active;

    this.status = {
      active,
      reason,
      supportsToolCalling,
      override,
      lastChangedAt: Date.now(),
    };

    // 广播新状态（传副本，避免订阅者突变内部状态）
    const snapshot: AgentModeStatus = { ...this.status };
    for (const cb of this.callbacks) {
      try {
        cb(snapshot);
      } catch (err) {
        // 单个回调异常不中断其他回调
        console.warn('[AgentModeService] onModeChanged callback threw:', err);
      }
    }

    // active 翻转时写审计日志（异步，失败仅告警，不阻断模式切换）
    if (activeFlipped) {
      void this.logModeChange(prev.active, active, reason);
    }
  }

  /**
   * 写模式切换审计记录到 memoryStore。
   *
   * memoryStore.write 写入 agent_memory 表；type 必须为合法 MemoryType，
   * 故使用 'agent'（agent 自主记忆），审计语义由 source='agent-mode-switch'
   * 与 content 中的 action 字段承载。
   *
   * 注意：getMemoryStore() 在 SQLite 未初始化时会同步抛错；write 为异步且可能失败。
   * 全部包裹在 try-catch 中，失败仅 console.warn，绝不阻断模式切换。
   */
  private async logModeChange(
    from: boolean,
    to: boolean,
    reason: AgentModeReason,
  ): Promise<void> {
    try {
      const store = getMemoryStore();
      await store.write({
        type: 'agent',
        content: JSON.stringify({
          action: 'agent-mode-changed',
          from,
          to,
          reason,
          timestamp: Date.now(),
        }),
        source: 'agent-mode-switch',
      });
    } catch (err) {
      console.warn('[AgentModeService] Failed to write mode-change audit log:', err);
    }
  }
}

// ==================== 单例 ====================

/** Agent 模式管理服务单例（全应用共享） */
export const agentModeService = new AgentModeService();
