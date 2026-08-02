/**
 * AgentModeService 单元测试 —— Agent 模式管理服务
 *
 * 来源：spec §add-agent-mode-management-and-center / Task 12
 *
 * 覆盖：
 *  1. 三态覆盖模式（force-on / force-off / auto）× supportsToolCalling
 *  2. reevaluate() 引擎快照评估
 *  3. onModeChanged() 事件回调通知 + 取消订阅
 *  4. setOverride() 覆盖设置
 *  5. 审计日志（active 翻转时写入 memoryStore）
 *  6. getStatus() 返回副本（防外部突变）
 *
 * Mock 策略：
 *  - memoryStore：vi.mock 模块级 mock，避免真实 SQLite 调用
 *  - 测试真实 AgentModeService 实现（非 mock），每个测试创建新实例避免单例状态污染
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AgentModeService } from '../agentModeService';
import type { AgentModeStatus } from '../agentConfigTypes';
import { getMemoryStore } from '../../memory/memoryStore';

// ==================== 模块级 Mock ====================

vi.mock('../../memory/memoryStore', () => ({
  getMemoryStore: vi.fn(),
}));

// ==================== Mock 工具 ====================

/**
 * 创建 mock MemoryStore。
 *
 * AgentModeService.logModeChange 仅使用 write 方法，其余方法提供空实现以满足类型。
 */
function createMockMemoryStore() {
  return {
    write: vi.fn().mockResolvedValue('mock-mem-id'),
    search: vi.fn().mockResolvedValue([]),
    read: vi.fn().mockResolvedValue(null),
    delete: vi.fn().mockResolvedValue(true),
  };
}

// ==================== 测试套件 ====================

describe('AgentModeService', () => {
  let service: AgentModeService;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getMemoryStore).mockReturnValue(
      createMockMemoryStore() as unknown as ReturnType<typeof getMemoryStore>,
    );
    service = new AgentModeService();
  });

  // ==================== 1. 三态覆盖模式 ====================

  describe('三态覆盖模式', () => {
    it('force-on → active=true，即使 supportsToolCalling=false', () => {
      service.reevaluate({
        useAgent: true,
        agentModeOverride: 'force-on',
        capabilities: { supportsToolCalling: false },
      });

      expect(service.isAgentModeActive()).toBe(true);
      expect(service.getStatus().reason).toBe('force-on');
    });

    it('force-off → active=false，即使 supportsToolCalling=true', () => {
      service.reevaluate({
        useAgent: true,
        agentModeOverride: 'force-off',
        capabilities: { supportsToolCalling: true },
      });

      expect(service.isAgentModeActive()).toBe(false);
      expect(service.getStatus().reason).toBe('force-off');
    });

    it('auto + supportsToolCalling=true → active=true', () => {
      service.reevaluate({
        useAgent: true,
        agentModeOverride: 'auto',
        capabilities: { supportsToolCalling: true },
      });

      expect(service.isAgentModeActive()).toBe(true);
      expect(service.getStatus().reason).toBe('tool-calling-supported');
    });

    it('auto + supportsToolCalling=false → active=false', () => {
      service.reevaluate({
        useAgent: true,
        agentModeOverride: 'auto',
        capabilities: { supportsToolCalling: false },
      });

      expect(service.isAgentModeActive()).toBe(false);
      expect(service.getStatus().reason).toBe('tool-calling-unsupported');
    });
  });

  // ==================== 2. reevaluate() 引擎快照 ====================

  describe('reevaluate', () => {
    it('auto + supportsToolCalling=true → active', () => {
      service.reevaluate({
        useAgent: true,
        agentModeOverride: 'auto',
        capabilities: { supportsToolCalling: true },
      });

      expect(service.isAgentModeActive()).toBe(true);
    });

    it('auto + supportsToolCalling=false → inactive', () => {
      service.reevaluate({
        useAgent: true,
        agentModeOverride: 'auto',
        capabilities: { supportsToolCalling: false },
      });

      expect(service.isAgentModeActive()).toBe(false);
    });

    it('force-on + supportsToolCalling=false → active', () => {
      service.reevaluate({
        useAgent: true,
        agentModeOverride: 'force-on',
        capabilities: { supportsToolCalling: false },
      });

      expect(service.isAgentModeActive()).toBe(true);
    });

    it('capabilities 缺失时 supportsToolCalling 默认 false → inactive', () => {
      service.reevaluate({
        useAgent: true,
        agentModeOverride: 'auto',
      });

      expect(service.isAgentModeActive()).toBe(false);
      expect(service.getStatus().supportsToolCalling).toBe(false);
    });
  });

  // ==================== 3. 事件回调通知 ====================

  describe('onModeChanged 事件回调', () => {
    it('状态变更时回调被调用，传入新状态副本', () => {
      const callback = vi.fn();
      const unsubscribe = service.onModeChanged(callback);

      service.reevaluate({
        useAgent: true,
        agentModeOverride: 'force-on',
        capabilities: { supportsToolCalling: false },
      });

      expect(callback).toHaveBeenCalledTimes(1);
      const status = callback.mock.calls[0][0] as AgentModeStatus;
      expect(status.active).toBe(true);
      expect(status.reason).toBe('force-on');
      expect(status.override).toBe('force-on');
      expect(status.supportsToolCalling).toBe(false);

      unsubscribe();
    });

    it('语义未变化时不触发回调', () => {
      // 先设置一个已知状态
      service.reevaluate({
        useAgent: true,
        agentModeOverride: 'force-on',
        capabilities: { supportsToolCalling: false },
      });

      const callback = vi.fn();
      service.onModeChanged(callback);

      // 再次设置完全相同的状态 → 语义未变 → 不触发
      service.reevaluate({
        useAgent: true,
        agentModeOverride: 'force-on',
        capabilities: { supportsToolCalling: false },
      });

      expect(callback).not.toHaveBeenCalled();
    });

    it('取消订阅后不再接收回调', () => {
      const callback = vi.fn();
      const unsubscribe = service.onModeChanged(callback);

      unsubscribe();

      service.reevaluate({
        useAgent: true,
        agentModeOverride: 'force-on',
        capabilities: { supportsToolCalling: false },
      });

      expect(callback).not.toHaveBeenCalled();
    });

    it('单个回调异常不中断其他回调', () => {
      // 抑制 console.warn 输出
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

      const errorCallback = vi.fn(() => {
        throw new Error('callback error');
      });
      const normalCallback = vi.fn();

      service.onModeChanged(errorCallback);
      service.onModeChanged(normalCallback);

      service.reevaluate({
        useAgent: true,
        agentModeOverride: 'force-on',
        capabilities: { supportsToolCalling: false },
      });

      expect(errorCallback).toHaveBeenCalledTimes(1);
      expect(normalCallback).toHaveBeenCalledTimes(1);

      warnSpy.mockRestore();
    });
  });

  // ==================== 4. setOverride() ====================

  describe('setOverride', () => {
    it('设置 force-on → 状态反映 force-on', () => {
      // 先初始化为 auto + supportsToolCalling=true
      service.reevaluate({
        useAgent: true,
        agentModeOverride: 'auto',
        capabilities: { supportsToolCalling: true },
      });
      expect(service.isAgentModeActive()).toBe(true);

      // 设置 force-on（active 不变，但 override/reason 变化 → 语义变化）
      service.setOverride('force-on');
      expect(service.isAgentModeActive()).toBe(true);
      expect(service.getStatus().override).toBe('force-on');
      expect(service.getStatus().reason).toBe('force-on');
    });

    it('设置 force-off → 状态反映 force-off', () => {
      // 先初始化为 auto + supportsToolCalling=true（active=true）
      service.reevaluate({
        useAgent: true,
        agentModeOverride: 'auto',
        capabilities: { supportsToolCalling: true },
      });
      expect(service.isAgentModeActive()).toBe(true);

      // 设置 force-off → active 翻转为 false
      service.setOverride('force-off');
      expect(service.isAgentModeActive()).toBe(false);
      expect(service.getStatus().override).toBe('force-off');
      expect(service.getStatus().reason).toBe('force-off');
    });

    it('设置回 auto → 基于 supportsToolCalling 恢复', () => {
      // 先初始化为 auto + supportsToolCalling=true
      service.reevaluate({
        useAgent: true,
        agentModeOverride: 'auto',
        capabilities: { supportsToolCalling: true },
      });

      // 设置 force-off
      service.setOverride('force-off');
      expect(service.isAgentModeActive()).toBe(false);

      // 设置回 auto → 恢复为 supportsToolCalling=true 的结果
      service.setOverride('auto');
      expect(service.isAgentModeActive()).toBe(true);
      expect(service.getStatus().override).toBe('auto');
      expect(service.getStatus().reason).toBe('tool-calling-supported');
    });

    it('force-on → auto（supportsToolCalling=false）→ 恢复 inactive', () => {
      // 初始化为 auto + supportsToolCalling=false
      service.reevaluate({
        useAgent: true,
        agentModeOverride: 'auto',
        capabilities: { supportsToolCalling: false },
      });
      expect(service.isAgentModeActive()).toBe(false);

      // force-on → active
      service.setOverride('force-on');
      expect(service.isAgentModeActive()).toBe(true);

      // 回到 auto → supportsToolCalling=false → inactive
      service.setOverride('auto');
      expect(service.isAgentModeActive()).toBe(false);
      expect(service.getStatus().reason).toBe('tool-calling-unsupported');
    });
  });

  // ==================== 5. 审计日志 ====================

  describe('审计日志', () => {
    it('active 翻转时写审计日志到 memoryStore', async () => {
      const mockStore = createMockMemoryStore();
      vi.mocked(getMemoryStore).mockReturnValue(
        mockStore as unknown as ReturnType<typeof getMemoryStore>,
      );

      // 初始 active=false → reevaluate force-on → active=true（翻转）
      service.reevaluate({
        useAgent: true,
        agentModeOverride: 'force-on',
        capabilities: { supportsToolCalling: false },
      });

      // logModeChange 是异步 fire-and-forget，需等待微任务
      await vi.waitFor(() => {
        expect(mockStore.write).toHaveBeenCalledTimes(1);
      });

      const writeArg = mockStore.write.mock.calls[0][0];
      expect(writeArg.source).toBe('agent-mode-switch');
      expect(writeArg.type).toBe('agent');
      const content = JSON.parse(writeArg.content);
      expect(content.action).toBe('agent-mode-changed');
      expect(content.from).toBe(false);
      expect(content.to).toBe(true);
    });

    it('active 未翻转时不写审计日志', async () => {
      const mockStore = createMockMemoryStore();
      vi.mocked(getMemoryStore).mockReturnValue(
        mockStore as unknown as ReturnType<typeof getMemoryStore>,
      );

      // 初始 active=false, override=auto, supportsToolCalling=false
      // reevaluate with force-off → active 仍为 false（未翻转），但 override/reason 变化
      service.reevaluate({
        useAgent: true,
        agentModeOverride: 'force-off',
        capabilities: { supportsToolCalling: false },
      });

      // 等待微任务执行
      await new Promise((resolve) => setTimeout(resolve, 10));

      expect(mockStore.write).not.toHaveBeenCalled();
    });
  });

  // ==================== 6. getStatus 返回副本 ====================

  describe('getStatus', () => {
    it('返回状态副本，修改不影响内部状态', () => {
      service.reevaluate({
        useAgent: true,
        agentModeOverride: 'force-on',
        capabilities: { supportsToolCalling: true },
      });

      const status1 = service.getStatus();
      status1.active = false;
      status1.override = 'force-off';

      const status2 = service.getStatus();
      expect(status2.active).toBe(true);
      expect(status2.override).toBe('force-on');
    });
  });

  // ==================== 单例导出验证 ====================

  describe('单例导出', () => {
    it('agentModeService 单例已导出且包含所有公开方法', async () => {
      const { agentModeService: singleton } = await import('../agentModeService');
      expect(singleton).toBeDefined();
      expect(typeof singleton.isAgentModeActive).toBe('function');
      expect(typeof singleton.getStatus).toBe('function');
      expect(typeof singleton.setOverride).toBe('function');
      expect(typeof singleton.reevaluate).toBe('function');
      expect(typeof singleton.onModeChanged).toBe('function');
    });
  });
});
