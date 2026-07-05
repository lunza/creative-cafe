/**
 * ManagementNarrativeService 集成测试
 *
 * 覆盖场景（spec Task 15.4）：
 * 1. ManagementPromptBuilder.buildSystemPrompt 包含资源经济规则
 * 2. ManagementPromptBuilder.buildUserPrompt 包含当前资源快照
 * 3. ManagementPromptBuilder.buildUserPrompt 包含玩家行动
 * 4. generateNarrative 调用 AIService.streamChatAPI（mock AIService）
 * 5. generateNarrative 处理 build:farm userAction 时扣除资源
 * 6. generateNarrative 处理 recruit:farmer userAction 时增加人口
 * 7. endTurn 结算产出（mock tableRepository 返回固定数据）
 * 8. endTurn 触发随机事件（mock Math.random）
 * 9. endTurn 回合数 +1
 * 10. tableEdit 命令被正确应用到 tableRepository
 *
 * mock 策略：
 * - vi.mock AIService 的 streamChatAPI（通过 GameNarrativeService 内部的 aiService 单例）
 * - vi.mock GameTableRepository 和 GameSaveRepository 的实例方法
 * - 通过构造函数注入 mock 依赖（ManagementNarrativeService 支持依赖注入）
 * - vi.hoisted + storageService/storageManager mock 模式（与 gameHandlers.test.ts 对齐）
 *
 * 【重点标记 - mock 链路】：
 * GameNarrativeService 内部硬编码 import { aiService } from '../../AIService'，
 * 因此必须 vi.mock AIService 整个模块（与 gameHandlers.test.ts 一致）。
 * 同时 AIService 模块会触发 storageService 与 storageManager 的副作用导入，
 * 需一并 vi.mock 以避免触发 electron-store / electron app.getPath。
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ============================================================================
// vi.hoisted: 创建可在 vi.mock 工厂中访问的共享状态
// ============================================================================

const {
  mockStreamChunksRef,
  mockStreamFullTextRef,
  mockTableDataRef,
  mockApplyTableEditsRef,
  mockUpdateSaveRef,
  mockRandomRef,
  applyTableEditsCallsRef,
  updateSaveCallsRef,
} = vi.hoisted(() => {
  return {
    // mock stream 状态
    mockStreamChunksRef: { value: [] as string[] },
    mockStreamFullTextRef: { value: '' as string },
    // mock tableRepository.getTableData 返回的固定数据
    mockTableDataRef: { value: null as any },
    // mock applyTableEdits 返回值
    mockApplyTableEditsRef: { value: null as any },
    // mock updateSave 返回值
    mockUpdateSaveRef: { value: true as boolean },
    // mock 随机源（next() 返回值）
    mockRandomRef: { value: 0.99 }, // 默认 > 0.6 表示无事件
    // 捕获 applyTableEdits 调用参数
    applyTableEditsCallsRef: { value: [] as Array<{ saveId: string; commands: any[] }> },
    // 捕获 updateSave 调用参数
    updateSaveCallsRef: { value: [] as Array<{ saveId: string; updates: any }> },
  };
});

// ============================================================================
// Mock 1: AIService（GameNarrativeService 内部 import { aiService }）
// ============================================================================

vi.mock('../../../../AIService', () => {
  return {
    aiService: {
      streamChatAPI: vi.fn(
        async (
          _messages: any[],
          options: any,
          onChunk: (chunk: string) => void
        ): Promise<{ content: string; generationTime: number; model: string }> => {
          // 模拟流式输出
          for (const chunk of mockStreamChunksRef.value) {
            onChunk(chunk);
            // 让出事件循环，让 controller.abort 生效
            await new Promise<void>((resolve) => setImmediate(resolve));
          }
          return {
            content: mockStreamFullTextRef.value,
            generationTime: 100,
            model: options?.model || 'test-model',
          };
        }
      ),
      getConfig: vi.fn(async () => ({
        baseUrl: 'http://test',
        model: 'test-model',
        apiKey: 'test-key',
        systemPrompt: '',
      })),
      getEngineConfig: vi.fn(async () => ({
        temperature: 0.7,
        maxTokens: 4096,
      })),
    },
  };
});

// ============================================================================
// Mock 2: storageService + storageManager（AIService 间接副作用导入）
// ============================================================================

vi.mock('../../../../storageService', () => {
  return {
    getStorageService: vi.fn(() => ({})),
    default: {},
  };
});

vi.mock('../../../../storageManager', () => {
  return {
    getStorageManager: vi.fn(() => ({})),
    StorageManager: vi.fn(),
    default: {},
  };
});

// ============================================================================
// Mock 3: logger（避免触发 createLogger 内部的 electron 依赖）
// ============================================================================

vi.mock('../../../../logger', () => {
  return {
    createLogger: vi.fn(() => ({
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      debug: vi.fn(),
    })),
  };
});

// ============================================================================
// Import 测试目标（必须在所有 vi.mock 之后）
// ============================================================================

import { ManagementPromptBuilder } from '../ManagementPromptBuilder';
import {
  ManagementNarrativeService,
  type RandomSource
} from '../ManagementNarrativeService';
import { GameNarrativeService } from '../../../GameNarrativeService';
import {
  GameType,
  GameStatus,
  type GameMeta,
  type GameTableSchema,
  type GameTableData,
  type GameNarrativeRequest,
  type GameTableEditCommand
} from '../../../../../../shared/types/game.types';

// ============================================================================
// 测试 fixtures
// ============================================================================

/**
 * 构造测试用 GameMeta
 */
function makeGameMeta(overrides: Partial<GameMeta> = {}): GameMeta {
  const now = Date.now();
  return {
    id: 'pastoral_town',
    type: GameType.MANAGEMENT,
    title: '田园小镇',
    subtitle: '经营你的梦想农场',
    description: '一款文字模拟经营游戏',
    gameplay: '资源经济：每回合产出食物、金币。\n回合制：每回合可建造一个设施。',
    developer: 'CreativeCafe',
    version: '1.0.0',
    status: GameStatus.COMPLETED,
    tags: ['经营', '回合制'],
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

/**
 * 构造测试用经营游戏 schema（5 个 sheet）
 */
function makeManagementSchema(): GameTableSchema {
  return {
    sheets: ['characters', 'resources', 'facilities', 'events', 'stats'],
    headers: {
      characters: ['流水号', '唯一id', '角色名', '身份', '状态'],
      resources: ['流水号', '唯一id', '资源名', '数量', '每回合变化'],
      facilities: ['流水号', '唯一id', '设施名', '等级', '建造成本', '产出'],
      events: ['流水号', '唯一id', '回合', '描述', '效果'],
      stats: ['流水号', '唯一id', '键', '值']
    },
    sheetDescriptions: {
      characters: '记录小镇居民',
      resources: '记录 4 种资源',
      facilities: '记录已建设施',
      events: '记录历史事件',
      stats: '记录全局统计'
    }
  };
}

/**
 * 构造测试用 tableData（含 4 种资源 + 1 设施 + 1 stats 行）
 *
 * resources sheet（索引=2）字段：
 * - 行 1: 金币，数量 500
 * - 行 2: 食物，数量 50，每回合变化 0
 * - 行 3: 木材，数量 30
 * - 行 4: 人口，数量 5
 *
 * facilities sheet（索引=3）：
 * - 行 1: farm 农场，等级 1，建造成本 50，产出 food:5
 *
 * stats sheet（索引=5）：
 * - 行 1: turn，值 3
 */
function makeTableData(): GameTableData {
  return {
    sheets: ['characters', 'resources', 'facilities', 'events', 'stats'],
    headers: makeManagementSchema().headers,
    data: {
      characters: [
        { '1': 1, '2': 'farmer_001', '3': '农夫张三', '4': '农夫', '5': '活跃' }
      ],
      resources: [
        { '1': 1, '2': 'gold', '3': '金币', '4': 500, '5': 0 },
        { '1': 2, '2': 'food', '3': '食物', '4': 50, '5': 0 },
        { '1': 3, '2': 'wood', '3': '木材', '4': 30, '5': 0 },
        { '1': 4, '2': 'population', '3': '人口', '4': 5, '5': 0 }
      ],
      facilities: [
        {
          '1': 1,
          '2': 'farm_001',
          '3': '农场',
          '4': 1,
          '5': 50,
          '6': 'food:5'
        }
      ],
      events: [],
      stats: [{ '1': 1, '2': 'turn', '3': 'turn', '4': 3 }]
    },
    sheetDescriptions: makeManagementSchema().sheetDescriptions
  };
}

/**
 * 构造 mock tableRepository
 *
 * - getTableData 返回 mockTableDataRef.value
 * - applyTableEdits 记录调用 + 返回 mockApplyTableEditsRef.value
 */
function makeMockTableRepository() {
  return {
    getTableData: vi.fn((_saveId: string) => mockTableDataRef.value),
    applyTableEdits: vi.fn((saveId: string, commands: GameTableEditCommand[]) => {
      applyTableEditsCallsRef.value.push({ saveId, commands });
      if (mockApplyTableEditsRef.value) {
        return mockApplyTableEditsRef.value;
      }
      return {
        success: true,
        changes: {
          commandsExecuted: commands.length,
          affectedSheets: ['resources'],
          errors: []
        }
      };
    })
  };
}

/**
 * 构造 mock saveRepository
 *
 * - loadSave 返回最小存档数据
 * - updateSave 记录调用 + 返回 mockUpdateSaveRef.value
 */
function makeMockSaveRepository() {
  return {
    loadSave: vi.fn((_saveId: string) => ({
      meta: {
        id: 'save-1',
        gameId: 'pastoral_town',
        gameType: GameType.MANAGEMENT,
        name: '测试存档',
        isAuto: false,
        createdAt: Date.now(),
        updatedAt: Date.now(),
        currentTurn: 3,
        currentNodeId: null,
        nodeTitle: null,
        turnCount: 3,
        messageCount: 0
      },
      narrativeLog: [],
      stateSnapshot: {}
    })),
    updateSave: vi.fn((saveId: string, updates: any) => {
      updateSaveCallsRef.value.push({ saveId, updates });
      return mockUpdateSaveRef.value;
    })
  };
}

/**
 * 构造 mock 随机源
 *
 * 返回 mockRandomRef.value
 */
function makeMockRandomSource(): RandomSource {
  return {
    next: () => mockRandomRef.value
  };
}

/**
 * 构造测试用 ManagementNarrativeService 实例
 *
 * - 注入真实的 GameNarrativeService 实例（其内部 aiService 已被 vi.mock 替换）
 * - 通过 narrativeService.setGameTableRepository / setGameSaveRepository 注入 mock
 *   依赖（GameNarrativeService 内部会用这些 mock 应用 AI 返回的 tableEdit）
 * - 注入 mock 的 tableRepository / saveRepository / randomSource 给 ManagementNarrativeService
 *   自身使用（用于 build / recruit / endTurn 中的资源变更应用）
 *
 * 【重点标记 - mock 注入双重路径】：
 * ManagementNarrativeService 自身持有 tableRepository / saveRepository 用于 build/recruit/endTurn，
 * 但其内部委托的 GameNarrativeService 也有自己独立的 tableRepository / saveRepository
 * （通过 setGameTableRepository / setGameSaveRepository setter 注入），用于应用 AI 返回的 tableEdit。
 * 必须两边都注入同一个 mock 实例，否则 GameNarrativeService 内部会因 gameTableRepository=null
 * 跳过 tableEdit 应用（导致测试 10c 失败）。
 */
function makeService(): {
  service: ManagementNarrativeService;
  tableRepository: ReturnType<typeof makeMockTableRepository>;
  saveRepository: ReturnType<typeof makeMockSaveRepository>;
} {
  const narrativeService = new GameNarrativeService();
  const tableRepository = makeMockTableRepository();
  const saveRepository = makeMockSaveRepository();
  const randomSource = makeMockRandomSource();
  const promptBuilder = new ManagementPromptBuilder();

  // 【关键】同时注入给 GameNarrativeService，让其内部也能调用 mock 的 applyTableEdits
  narrativeService.setGameTableRepository(tableRepository as any);
  narrativeService.setGameSaveRepository(saveRepository as any);

  const service = new ManagementNarrativeService(
    narrativeService,
    promptBuilder,
    tableRepository as any,
    saveRepository as any,
    randomSource
  );

  return { service, tableRepository, saveRepository };
}

/**
 * 等待所有 microtask 完成
 */
async function flushMicrotasks(times = 30): Promise<void> {
  for (let i = 0; i < times; i++) {
    await new Promise<void>((resolve) => setImmediate(resolve));
  }
}

// ============================================================================
// 测试套件
// ============================================================================

describe('ManagementNarrativeService (集成测试)', () => {
  let promptBuilder: ManagementPromptBuilder;

  beforeEach(() => {
    promptBuilder = new ManagementPromptBuilder();

    // 重置所有 mock 状态
    mockStreamChunksRef.value = ['叙事文本'];
    mockStreamFullTextRef.value = '叙事文本';
    mockTableDataRef.value = makeTableData();
    mockApplyTableEditsRef.value = null;
    mockUpdateSaveRef.value = true;
    mockRandomRef.value = 0.99; // > 0.6，无事件
    applyTableEditsCallsRef.value = [];
    updateSaveCallsRef.value = [];

    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // ==================== SubTask 15.4 测试 1-3：PromptBuilder 单元测试 ====================

  describe('ManagementPromptBuilder', () => {
    it('1. buildSystemPrompt 包含资源经济规则', () => {
      const meta = makeGameMeta();
      const schema = makeManagementSchema();
      const prompt = promptBuilder.buildSystemPrompt(meta, schema);

      expect(prompt).toContain('【资源经济规则】');
      expect(prompt).toContain('金币');
      expect(prompt).toContain('食物');
      expect(prompt).toContain('木材');
      expect(prompt).toContain('人口');
      // 包含资源变更原则
      expect(prompt).toContain('build:');
      expect(prompt).toContain('recruit:');
      expect(prompt).toContain('end_turn');
    });

    it('2. buildUserPrompt 包含当前资源快照', () => {
      const tableSnapshot = makeTableData();
      const prompt = promptBuilder.buildUserPrompt({
        userAction: 'build:farm',
        currentTurn: 3,
        tableSnapshot,
        recentEvents: ['丰收年，食物 +10']
      });

      expect(prompt).toContain('【当前资源快照】');
      // 资源名与数量
      expect(prompt).toContain('金币');
      expect(prompt).toContain('500');
      expect(prompt).toContain('食物');
      expect(prompt).toContain('50');
      expect(prompt).toContain('木材');
      expect(prompt).toContain('30');
      expect(prompt).toContain('人口');
      expect(prompt).toContain('5');
    });

    it('3. buildUserPrompt 包含玩家行动', () => {
      const tableSnapshot = makeTableData();
      const prompt = promptBuilder.buildUserPrompt({
        userAction: 'build:farm',
        currentTurn: 3,
        tableSnapshot,
        recentEvents: []
      });

      expect(prompt).toContain('【玩家行动】');
      expect(prompt).toContain('build:farm');
      // 包含当前回合
      expect(prompt).toContain('【当前回合】');
      expect(prompt).toContain('第 3 回合');
    });
  });

  // ==================== SubTask 15.4 测试 4：generateNarrative 调用 AIService.streamChatAPI ====================

  describe('generateNarrative 调用 AIService', () => {
    it('4. 自由文本 userAction 触发 narrativeService.generateNarrative 调用 streamChatAPI', async () => {
      const { service } = makeService();

      const request: GameNarrativeRequest = {
        gameId: 'pastoral_town',
        saveId: 'save-1',
        gameType: GameType.MANAGEMENT,
        userAction: '巡视农场',
        organizeMode: 'async',
        tableSchema: makeManagementSchema()
      };

      const chunks: Array<{ chunk: string; index: number }> = [];
      let completeResult: any = null;
      let errorResult: any = null;

      await service.generateNarrative(
        request,
        {
          onChunk: (chunk, index) => chunks.push({ chunk, index }),
          onComplete: (result) => { completeResult = result; },
          onError: (error, code) => { errorResult = { error, code }; }
        }
      );

      // 等待异步流式完成
      await flushMicrotasks();

      // 应触发 onChunk（每个 chunk 至少一次）
      expect(chunks.length).toBeGreaterThan(0);
      expect(chunks[0].chunk).toBe('叙事文本');
      // 应触发 onComplete
      expect(completeResult).not.toBeNull();
      expect(completeResult.fullText).toBe('叙事文本');
      // 不应触发 onError
      expect(errorResult).toBeNull();
    });
  });

  // ==================== SubTask 15.4 测试 5：build:farm 扣除资源 ====================

  describe('userAction: build:<facility_id>', () => {
    it('5. build:farm 应调用 applyTableEdits 扣除金币与木材', async () => {
      const { service, tableRepository } = makeService();

      const request: GameNarrativeRequest = {
        gameId: 'pastoral_town',
        saveId: 'save-1',
        gameType: GameType.MANAGEMENT,
        userAction: 'build:farm',
        organizeMode: 'async',
        tableSchema: makeManagementSchema()
      };

      await service.generateNarrative(request, {
        onChunk: () => {},
        onComplete: () => {},
        onError: () => {}
      });
      await flushMicrotasks();

      // 应至少调用 applyTableEdits 一次（资源扣减）
      expect(applyTableEditsCallsRef.value.length).toBeGreaterThanOrEqual(1);

      // 检查扣减命令：应在 resources sheet（索引=2）的 updateRow
      const firstCall = applyTableEditsCallsRef.value[0];
      const resourceUpdateCommands = firstCall.commands.filter(
        (c) => c.sheetIndex === 2 && c.type === 'updateRow'
      );

      // farm 成本 = { gold: 50, wood: 10 }，应扣减 2 种资源
      expect(resourceUpdateCommands.length).toBe(2);

      // 验证扣减后的值
      // gold 原 500 → 500 - 50 = 450
      // wood 原 30 → 30 - 10 = 20
      const goldUpdate = resourceUpdateCommands.find(
        (c) => c.rowData?.['4'] === '450'
      );
      const woodUpdate = resourceUpdateCommands.find(
        (c) => c.rowData?.['4'] === '20'
      );
      expect(goldUpdate).toBeDefined();
      expect(woodUpdate).toBeDefined();

      // 验证 tableRepository.applyTableEdits 被调用
      expect(tableRepository.applyTableEdits).toHaveBeenCalled();
    });

    it('未在成本表中的 facility_id 不调用 applyTableEdits（仅叙事）', async () => {
      const { service, tableRepository } = makeService();

      const request: GameNarrativeRequest = {
        gameId: 'pastoral_town',
        saveId: 'save-1',
        gameType: GameType.MANAGEMENT,
        userAction: 'build:unknown_facility',
        organizeMode: 'async',
        tableSchema: makeManagementSchema()
      };

      await service.generateNarrative(request, {
        onChunk: () => {},
        onComplete: () => {},
        onError: () => {}
      });
      await flushMicrotasks();

      // 未在成本表中 → 不应调用 applyTableEdits（资源扣减部分）
      // 注意：GameNarrativeService 内部仍可能调用 applyTableEdits 应用 AI 返回的 tableEdit，
      // 但本测试中 mock streamChatAPI 返回的"叙事文本"无 tableEdit 标签，所以不应触发
      expect(applyTableEditsCallsRef.value.length).toBe(0);
      expect(tableRepository.applyTableEdits).not.toHaveBeenCalled();
    });
  });

  // ==================== SubTask 15.4 测试 6：recruit:farmer 增加人口 ====================

  describe('userAction: recruit:<character_id>', () => {
    it('6. recruit:farmer 应扣减金币并增加人口', async () => {
      const { service, tableRepository } = makeService();

      const request: GameNarrativeRequest = {
        gameId: 'pastoral_town',
        saveId: 'save-1',
        gameType: GameType.MANAGEMENT,
        userAction: 'recruit:farmer',
        organizeMode: 'async',
        tableSchema: makeManagementSchema()
      };

      await service.generateNarrative(request, {
        onChunk: () => {},
        onComplete: () => {},
        onError: () => {}
      });
      await flushMicrotasks();

      // 应调用 applyTableEdits
      expect(applyTableEditsCallsRef.value.length).toBeGreaterThanOrEqual(1);
      expect(tableRepository.applyTableEdits).toHaveBeenCalled();

      // 检查扣减命令
      const firstCall = applyTableEditsCallsRef.value[0];
      const resourceUpdateCommands = firstCall.commands.filter(
        (c) => c.sheetIndex === 2 && c.type === 'updateRow'
      );

      // farmer 成本 = { gold: 20 }，加上 population -1（即"扣减 -1" = 增加 1）
      // 应有 2 条 updateRow 命令
      expect(resourceUpdateCommands.length).toBe(2);

      // gold 原 500 → 500 - 20 = 480
      const goldUpdate = resourceUpdateCommands.find(
        (c) => c.rowData?.['4'] === '480'
      );
      expect(goldUpdate).toBeDefined();

      // population 原 5 → 5 + 1 = 6
      const populationUpdate = resourceUpdateCommands.find(
        (c) => c.rowData?.['4'] === '6'
      );
      expect(populationUpdate).toBeDefined();
    });
  });

  // ==================== SubTask 15.4 测试 7：endTurn 结算产出 ====================

  describe('endTurn 流程', () => {
    it('7. endTurn 结算产出：facilities production 累加到 resources', async () => {
      const { service } = makeService();

      await service.endTurn('save-1', {
        onChunk: () => {},
        onComplete: () => {},
        onError: () => {}
      });
      await flushMicrotasks();

      // farm 设施 production = "food:5"
      // food 原 50 → 50 + 5 = 55
      const firstCall = applyTableEditsCallsRef.value[0];
      const foodUpdate = firstCall.commands.find(
        (c) =>
          c.sheetIndex === 2 &&
          c.type === 'updateRow' &&
          c.rowData?.['4'] === '55'
      );
      expect(foodUpdate).toBeDefined();
    });

    it('8. endTurn 触发随机事件：mock 随机源为 0.1 时触发丰收事件', async () => {
      // next() = 0.1 < 0.3 → 丰收事件，食物 +10
      mockRandomRef.value = 0.1;
      const { service } = makeService();

      await service.endTurn('save-1', {
        onChunk: () => {},
        onComplete: () => {},
        onError: () => {}
      });
      await flushMicrotasks();

      // 应在 events sheet（索引=4）insertRow 记录事件
      const firstCall = applyTableEditsCallsRef.value[0];
      const eventInsert = firstCall.commands.find(
        (c) => c.sheetIndex === 4 && c.type === 'insertRow'
      );
      expect(eventInsert).toBeDefined();
      // 描述应包含"丰收"
      expect(eventInsert?.rowData?.['4']).toContain('丰收');

      // 食物应在产出结算（+5）后再 +10 = 50 + 5 + 10 = 65
      // 注意：产出结算与事件效果都通过 updateRow 应用，最终值取决于命令顺序
      // 我们直接验证存在食物 +10 的效果（值 = 65 或 60，取决于命令合并顺序）
      const foodUpdates = firstCall.commands.filter(
        (c) =>
          c.sheetIndex === 2 &&
          c.type === 'updateRow' &&
          c.rowData?.['4'] === '65'
      );
      // 至少有一条 updateRow 让食物变成 65（farm 产出 +5 后再 +10）
      expect(foodUpdates.length).toBeGreaterThanOrEqual(1);
    });

    it('8b. endTurn 触发随机事件：mock 随机源为 0.4 时触发灾害事件（食物 -20）', async () => {
      // next() = 0.4，0.3 <= 0.4 < 0.5 → 灾害事件，食物 -20
      mockRandomRef.value = 0.4;
      const { service } = makeService();

      await service.endTurn('save-1', {
        onChunk: () => {},
        onComplete: () => {},
        onError: () => {}
      });
      await flushMicrotasks();

      const firstCall = applyTableEditsCallsRef.value[0];
      const eventInsert = firstCall.commands.find(
        (c) => c.sheetIndex === 4 && c.type === 'insertRow'
      );
      expect(eventInsert).toBeDefined();
      expect(eventInsert?.rowData?.['4']).toContain('灾害');
    });

    it('8c. endTurn 触发随机事件：mock 随机源为 0.55 时触发旅人来访事件（人口 +1）', async () => {
      // next() = 0.55，0.5 <= 0.55 < 0.6 → 旅人来访，人口 +1
      mockRandomRef.value = 0.55;
      const { service } = makeService();

      await service.endTurn('save-1', {
        onChunk: () => {},
        onComplete: () => {},
        onError: () => {}
      });
      await flushMicrotasks();

      const firstCall = applyTableEditsCallsRef.value[0];
      const eventInsert = firstCall.commands.find(
        (c) => c.sheetIndex === 4 && c.type === 'insertRow'
      );
      expect(eventInsert).toBeDefined();
      expect(eventInsert?.rowData?.['4']).toContain('旅人');
    });

    it('8d. endTurn 无事件：mock 随机源为 0.99 时不触发事件', async () => {
      // next() = 0.99 >= 0.6 → 无事件
      mockRandomRef.value = 0.99;
      const { service } = makeService();

      await service.endTurn('save-1', {
        onChunk: () => {},
        onComplete: () => {},
        onError: () => {}
      });
      await flushMicrotasks();

      const firstCall = applyTableEditsCallsRef.value[0];
      const eventInsert = firstCall.commands.find(
        (c) => c.sheetIndex === 4 && c.type === 'insertRow'
      );
      // 不应有事件记录
      expect(eventInsert).toBeUndefined();
    });

    it('9. endTurn 回合数 +1：stats sheet 的 turn 行更新', async () => {
      const { service } = makeService();

      await service.endTurn('save-1', {
        onChunk: () => {},
        onComplete: () => {},
        onError: () => {}
      });
      await flushMicrotasks();

      // 原 turn=3，endTurn 后应为 4
      const firstCall = applyTableEditsCallsRef.value[0];
      const turnUpdate = firstCall.commands.find(
        (c) =>
          c.sheetIndex === 5 &&
          c.type === 'updateRow' &&
          c.rowData?.['4'] === '4'
      );
      expect(turnUpdate).toBeDefined();
    });

    it('9b. endTurn 通过 saveRepository.updateSave 更新 currentTurn', async () => {
      const { service, saveRepository } = makeService();

      await service.endTurn('save-1', {
        onChunk: () => {},
        onComplete: () => {},
        onError: () => {}
      });
      await flushMicrotasks();

      // 应调用 saveRepository.updateSave，updates 含 currentTurn=4
      expect(updateSaveCallsRef.value.length).toBeGreaterThanOrEqual(1);
      const endTurnSaveCall = updateSaveCallsRef.value[0];
      expect(endTurnSaveCall.saveId).toBe('save-1');
      expect(endTurnSaveCall.updates.currentTurn).toBe(4);
      expect(endTurnSaveCall.updates.turnCount).toBe(4);
      expect(saveRepository.updateSave).toHaveBeenCalled();
    });
  });

  // ==================== SubTask 15.4 测试 10：tableEdit 命令应用验证 ====================

  describe('tableEdit 命令应用', () => {
    it('10. endTurn 生成的所有 tableEdit 命令都通过 applyTableEdits 应用', async () => {
      const { service, tableRepository } = makeService();

      await service.endTurn('save-1', {
        onChunk: () => {},
        onComplete: () => {},
        onError: () => {}
      });
      await flushMicrotasks();

      // 应调用 applyTableEdits
      expect(tableRepository.applyTableEdits).toHaveBeenCalled();

      // 第一次调用是 endTurn 内部的资源结算 + 事件 + 回合 +1
      const firstCall = applyTableEditsCallsRef.value[0];
      expect(firstCall.saveId).toBe('save-1');
      // 至少有一条 updateRow 命令（食物产出 / 回合 +1）
      expect(firstCall.commands.length).toBeGreaterThan(0);

      // 验证所有命令都有 type / sheetIndex / raw 字段
      for (const cmd of firstCall.commands) {
        expect(cmd.type).toBeDefined();
        expect(cmd.sheetIndex).toBeGreaterThanOrEqual(1);
        expect(cmd.raw).toBeTypeOf('string');
      }
    });

    it('10b. generateNarrative 中 build:farm 触发的 applyTableEdits 命令格式正确', async () => {
      const { service } = makeService();

      const request: GameNarrativeRequest = {
        gameId: 'pastoral_town',
        saveId: 'save-1',
        gameType: GameType.MANAGEMENT,
        userAction: 'build:farm',
        organizeMode: 'async',
        tableSchema: makeManagementSchema()
      };

      await service.generateNarrative(request, {
        onChunk: () => {},
        onComplete: () => {},
        onError: () => {}
      });
      await flushMicrotasks();

      const firstCall = applyTableEditsCallsRef.value[0];
      // 所有命令应是 updateRow 类型（资源扣减）
      const allUpdates = firstCall.commands.every(
        (c) => c.type === 'updateRow' || c.type === 'insertRow' || c.type === 'deleteRow'
      );
      expect(allUpdates).toBe(true);

      // 应在 resources sheet（索引=2）
      const allResourcesSheet = firstCall.commands.every(
        (c) => c.sheetIndex === 2
      );
      expect(allResourcesSheet).toBe(true);

      // 应有 rowIndex 字段（updateRow 必填）
      for (const cmd of firstCall.commands) {
        if (cmd.type === 'updateRow' || cmd.type === 'deleteRow') {
          expect(cmd.rowIndex).toBeGreaterThanOrEqual(1);
        }
      }
    });

    it('10c. AI 返回的 tableEdit 命令在叙事完成后被 GameNarrativeService 应用到 tableRepository', async () => {
      const { service, tableRepository } = makeService();

      // 配置 mock stream 返回含 tableEdit 标签的回复
      const tableEditXml =
        '<!--  <tableEdit>\ninsertRow(2, {"2":"gold_test","3":"测试资源","4":"999","5":"0"})\n</tableEdit> -->';
      mockStreamChunksRef.value = ['叙事文本', tableEditXml];
      mockStreamFullTextRef.value = '叙事文本' + tableEditXml;

      const request: GameNarrativeRequest = {
        gameId: 'pastoral_town',
        saveId: 'save-1',
        gameType: GameType.MANAGEMENT,
        userAction: '自由文本',
        organizeMode: 'async',
        tableSchema: makeManagementSchema()
      };

      await service.generateNarrative(request, {
        onChunk: () => {},
        onComplete: () => {},
        onError: () => {}
      });
      await flushMicrotasks();

      // 应触发 applyTableEdits（GameNarrativeService 内部应用 tableEdit）
      expect(tableRepository.applyTableEdits).toHaveBeenCalled();

      // 找到含 insertRow 的调用（不是 build:farmer 的 updateRow 调用）
      const insertCall = applyTableEditsCallsRef.value.find((call) =>
        call.commands.some((c: any) => c.type === 'insertRow')
      );
      expect(insertCall).toBeDefined();
    });
  });

  // ==================== 边界场景 ====================

  describe('边界场景', () => {
    it('表格数据不存在时 endTurn 应触发 onError', async () => {
      mockTableDataRef.value = null;
      const { service } = makeService();

      let errorCode: string | null = null;
      let errorMsg: string | null = null;

      await service.endTurn('save-1', {
        onChunk: () => {},
        onComplete: () => {},
        onError: (error, code) => {
          errorMsg = error;
          errorCode = code;
        }
      });
      await flushMicrotasks();

      expect(errorMsg).toContain('表格数据不存在');
      expect(errorCode).toBe('table_not_found');
    });

    it('build:farm 在表格数据不存在时不应抛错（仅记日志）', async () => {
      mockTableDataRef.value = null;
      const { service } = makeService();

      const request: GameNarrativeRequest = {
        gameId: 'pastoral_town',
        saveId: 'save-1',
        gameType: GameType.MANAGEMENT,
        userAction: 'build:farm',
        organizeMode: 'async',
        tableSchema: makeManagementSchema()
      };

      // 不应抛错
      let error: any = null;
      try {
        await service.generateNarrative(request, {
          onChunk: () => {},
          onComplete: () => {},
          onError: () => {}
        });
      } catch (e) {
        error = e;
      }
      await flushMicrotasks();

      expect(error).toBeNull();
    });
  });
});
