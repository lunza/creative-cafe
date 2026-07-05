/**
 * gameStore 单元测试（SubTask 6.3）
 *
 * 覆盖关键场景（按 task 要求）：
 * - loadGames：成功 / electronAPI 不可用 / 抛错
 * - selectGame：成功设置 currentGame / 抛错设置 error
 * - startNewGame：调用 createSave 后自动 loadSave
 * - appendNarrativeChunk：首个 chunk 创建新 assistant 消息 / 后续 chunk 追加 /
 *   saveId 不匹配时不写入
 * - generateNarrative：设置 isGenerating=true 并调用 IPC（fire-and-forget） /
 *   未选择游戏时设置 error
 * - 事件订阅：模块加载时调用 4 个 on* 监听器
 * - _handleNarrativeComplete：用 fullText 覆盖流式累积内容并触发自动保存
 * - _handleNarrativeError：设置 error 并复位 isGenerating
 * - _handleTableUpdated：拉取最新表格数据
 * - saveGame：无存档时安全跳过
 * - cancelGeneration：复位 isGenerating
 *
 * 测试环境：vitest environment: 'node'（无 window）
 * 测试策略：
 * - 使用 `vi.hoisted` 在 import store 之前设置 `globalThis.window.electronAPI.game`
 *   以便 store 模块加载时的事件订阅器能拿到 mock API
 * - mock API 的 `on*` 监听器将回调推入 `capturedListeners`，测试可直接调用
 *   回调来模拟主进程推送事件
 *
 * 参考：src/renderer/components/Character/CharacterDialogueChat/__tests__/e2e-chat-flow.test.ts
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  GameType,
  GameStatus,
  GameTableEditCommandType,
  type GameMeta,
  type GameIndexEntry,
  type GameSaveData,
  type GameTableData,
  type GameNarrativeChunk,
  type GameNarrativeComplete,
  type GameNarrativeError,
  type GameTableUpdated,
  type GameTableEditCommand
} from '../../../shared/types/game.types';

// ==================== Mock 设置（必须在 import store 之前生效） ====================

/**
 * vi.hoisted 的回调会在所有 import 之前执行，因此可在此设置 globalThis.window。
 *
 * 返回 mockGameApi 与 capturedListeners，供测试用例访问。
 */
const { mockGameApi, capturedListeners } = vi.hoisted(() => {
  // 捕获的 IPC 事件回调（按事件类型分组）
  const listeners = {
    chunk: [] as Array<(data: any) => void>,
    complete: [] as Array<(data: any) => void>,
    error: [] as Array<(data: any) => void>,
    tableUpdated: [] as Array<(data: any) => void>
  };

  // mock 的 game API（与 preload 契约一致）
  const api = {
    list: vi.fn(),
    getMeta: vi.fn(),
    createGame: vi.fn(),
    updateGame: vi.fn(),
    deleteGame: vi.fn(),
    createSave: vi.fn(),
    loadSave: vi.fn(),
    listSaves: vi.fn(),
    deleteSave: vi.fn(),
    save: vi.fn(),
    getTableData: vi.fn(),
    saveTableData: vi.fn(),
    applyTableEdits: vi.fn(),
    getVersionSnapshot: vi.fn(),
    confirmVersion: vi.fn(),
    rollbackVersion: vi.fn(),
    generateNarrative: vi.fn(),
    cancelGeneration: vi.fn(),
    getConfig: vi.fn(),
    saveConfig: vi.fn(),
    onNarrativeChunk: vi.fn((cb: (data: any) => void) => {
      listeners.chunk.push(cb);
      return () => {};
    }),
    onNarrativeComplete: vi.fn((cb: (data: any) => void) => {
      listeners.complete.push(cb);
      return () => {};
    }),
    onNarrativeError: vi.fn((cb: (data: any) => void) => {
      listeners.error.push(cb);
      return () => {};
    }),
    onTableUpdated: vi.fn((cb: (data: any) => void) => {
      listeners.tableUpdated.push(cb);
      return () => {};
    })
  };

  // 在 store 模块加载前设置 globalThis.window
  (globalThis as any).window = { electronAPI: { game: api } };

  return { mockGameApi: api, capturedListeners: listeners };
});

// ==================== Import store（此时 window 已就绪，订阅器会执行） ====================

import { useGameStore } from '../gameStore';

// ==================== 测试 fixtures ====================

function makeGameMeta(overrides: Partial<GameMeta> = {}): GameMeta {
  const now = Date.now();
  return {
    id: 'pastoral_town',
    type: GameType.MANAGEMENT,
    title: '田园小镇',
    subtitle: '经营你的梦想农场',
    description: '这是一个经营类示例游戏',
    gameplay: '建造设施 / 招募村民 / 结束回合',
    developer: 'creative-cafe',
    version: '1.0.0',
    status: GameStatus.COMPLETED,
    tags: ['经营', '回合制'],
    createdAt: now,
    updatedAt: now,
    ...overrides
  };
}

function makeIndexEntry(overrides: Partial<GameIndexEntry> = {}): GameIndexEntry {
  const now = Date.now();
  return {
    id: 'pastoral_town',
    type: GameType.MANAGEMENT,
    title: '田园小镇',
    subtitle: '经营你的梦想农场',
    status: GameStatus.COMPLETED,
    tags: ['经营'],
    createdAt: now,
    updatedAt: now,
    ...overrides
  };
}

function makeSaveData(overrides: Partial<GameSaveData> = {}): GameSaveData {
  const now = Date.now();
  return {
    meta: {
      id: 'save-001',
      gameId: 'pastoral_town',
      gameType: GameType.MANAGEMENT,
      name: '初始存档',
      isAuto: false,
      createdAt: now,
      updatedAt: now,
      currentTurn: 1,
      currentNodeId: 'start',
      nodeTitle: '开场',
      turnCount: 1,
      messageCount: 0
    },
    narrativeLog: [],
    ...overrides
  };
}

function makeTableData(): GameTableData {
  return {
    sheets: ['resources'],
    headers: { resources: ['id', 'name', 'amount'] },
    data: { resources: [{ id: 'gold', name: '金币', amount: 500 }] },
    sheetDescriptions: { resources: '资源列表' }
  };
}

function makeChunk(saveId: string, chunk: string, index: number): GameNarrativeChunk {
  return { saveId, chunk, index };
}

function makeComplete(saveId: string, fullText: string): GameNarrativeComplete {
  return {
    saveId,
    fullText,
    tableChanges: { commandsExecuted: 0, affectedSheets: [], errors: [] },
    tableEdits: [],
    generationTime: 100,
    model: 'test-model'
  };
}

function makeError(saveId: string, error: string): GameNarrativeError {
  return { saveId, error, code: 'TEST_ERROR' };
}

function makeTableUpdated(saveId: string): GameTableUpdated {
  return {
    saveId,
    changes: { commandsExecuted: 1, affectedSheets: ['resources'], errors: [] }
  };
}

function makeTableEditCommand(): GameTableEditCommand {
  return {
    type: GameTableEditCommandType.INSERT_ROW,
    sheetIndex: 1,
    rowData: { id: 'food', name: '食物', amount: 50 },
    raw: 'insertRow(1, {"id":"food","name":"食物","amount":50})'
  };
}

// ==================== 测试辅助 ====================

const INITIAL_STATE = {
  games: [],
  currentGameId: null,
  currentSaveId: null,
  currentGame: null,
  currentSave: null,
  narrativeLog: [],
  tableData: null,
  isGenerating: false,
  isLoadingGames: false,
  isLoadingSave: false,
  error: null,
  currentStreamingMessageId: null
};

function resetStore() {
  useGameStore.setState({ ...INITIAL_STATE });
}

function resetMocks() {
  // 清空所有 mock 的调用记录与返回值，但保留 on* 回调注册（因为 store 已订阅）
  mockGameApi.list.mockReset();
  mockGameApi.getMeta.mockReset();
  mockGameApi.createGame.mockReset();
  mockGameApi.updateGame.mockReset();
  mockGameApi.deleteGame.mockReset();
  mockGameApi.createSave.mockReset();
  mockGameApi.loadSave.mockReset();
  mockGameApi.listSaves.mockReset();
  mockGameApi.deleteSave.mockReset();
  mockGameApi.save.mockReset();
  mockGameApi.getTableData.mockReset();
  mockGameApi.saveTableData.mockReset();
  mockGameApi.applyTableEdits.mockReset();
  mockGameApi.getVersionSnapshot.mockReset();
  mockGameApi.confirmVersion.mockReset();
  mockGameApi.rollbackVersion.mockReset();
  mockGameApi.generateNarrative.mockReset();
  mockGameApi.cancelGeneration.mockReset();
  mockGameApi.getConfig.mockReset();
  mockGameApi.saveConfig.mockReset();
  // 注意：on* 监听器不清空，保留 store 在 module load 时的订阅
}

beforeEach(() => {
  resetStore();
  resetMocks();
});

// ==================== 测试套件 ====================

describe('gameStore', () => {
  // ---------------- 模块加载时的事件订阅 ----------------
  describe('module-load event subscription', () => {
    it('should subscribe to all 4 IPC events when module loads', () => {
      // store 在 import 时已执行 setupGameEventListeners()
      // 注意：mockReset() 不会清空 on* 的实现（因为我们在 hoisted 中重新设置过）
      // 但 mock.calls 会累积，因此检查 toHaveBeenCalled 至少 1 次
      expect(mockGameApi.onNarrativeChunk).toHaveBeenCalled();
      expect(mockGameApi.onNarrativeComplete).toHaveBeenCalled();
      expect(mockGameApi.onNarrativeError).toHaveBeenCalled();
      expect(mockGameApi.onTableUpdated).toHaveBeenCalled();
    });

    it('should have captured at least one callback per event type', () => {
      expect(capturedListeners.chunk.length).toBeGreaterThanOrEqual(1);
      expect(capturedListeners.complete.length).toBeGreaterThanOrEqual(1);
      expect(capturedListeners.error.length).toBeGreaterThanOrEqual(1);
      expect(capturedListeners.tableUpdated.length).toBeGreaterThanOrEqual(1);
    });
  });

  // ---------------- loadGames ----------------
  describe('loadGames', () => {
    it('should call window.electronAPI.game.list and set games', async () => {
      const entries = [makeIndexEntry({ id: 'game-1' }), makeIndexEntry({ id: 'game-2' })];
      mockGameApi.list.mockResolvedValue({ success: true, games: entries });

      await useGameStore.getState().loadGames();

      expect(mockGameApi.list).toHaveBeenCalledTimes(1);
      expect(useGameStore.getState().games).toEqual(entries);
      expect(useGameStore.getState().isLoadingGames).toBe(false);
      expect(useGameStore.getState().error).toBeNull();
    });

    it('should set games to empty array when API returns empty', async () => {
      mockGameApi.list.mockResolvedValue({ success: true, games: [] });

      await useGameStore.getState().loadGames();

      expect(useGameStore.getState().games).toEqual([]);
      expect(useGameStore.getState().isLoadingGames).toBe(false);
    });

    it('should set error when API throws', async () => {
      const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
      mockGameApi.list.mockRejectedValue(new Error('network failure'));

      await useGameStore.getState().loadGames();

      expect(useGameStore.getState().games).toEqual([]);
      expect(useGameStore.getState().isLoadingGames).toBe(false);
      expect(useGameStore.getState().error).toContain('加载游戏列表失败');
      expect(useGameStore.getState().error).toContain('network failure');
      errorSpy.mockRestore();
    });

    it('should handle null response gracefully', async () => {
      mockGameApi.list.mockResolvedValue(null as any);

      await useGameStore.getState().loadGames();

      expect(useGameStore.getState().games).toEqual([]);
    });

    it('should handle unsuccessful response gracefully', async () => {
      mockGameApi.list.mockResolvedValue({ success: false, error: 'db locked' });

      await useGameStore.getState().loadGames();

      expect(useGameStore.getState().games).toEqual([]);
    });
  });

  // ---------------- selectGame ----------------
  describe('selectGame', () => {
    it('should call getMeta and set currentGame', async () => {
      const meta = makeGameMeta({ id: 'game-1', title: 'Test Game' });
      mockGameApi.getMeta.mockResolvedValue({ success: true, meta });

      await useGameStore.getState().selectGame('game-1');

      expect(mockGameApi.getMeta).toHaveBeenCalledWith('game-1');
      expect(useGameStore.getState().currentGameId).toBe('game-1');
      expect(useGameStore.getState().currentGame).toEqual(meta);
      expect(useGameStore.getState().isLoadingSave).toBe(false);
    });

    it('should set null currentGame when getMeta returns null', async () => {
      mockGameApi.getMeta.mockResolvedValue({ success: true, meta: null });

      await useGameStore.getState().selectGame('missing');

      expect(useGameStore.getState().currentGame).toBeNull();
      expect(useGameStore.getState().currentGameId).toBe('missing');
    });

    it('should set error when getMeta throws', async () => {
      const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
      mockGameApi.getMeta.mockRejectedValue(new Error('404'));

      await useGameStore.getState().selectGame('game-x');

      expect(useGameStore.getState().currentGame).toBeNull();
      expect(useGameStore.getState().error).toContain('加载游戏元数据失败');
      expect(useGameStore.getState().error).toContain('404');
      errorSpy.mockRestore();
    });
  });

  // ---------------- startNewGame ----------------
  describe('startNewGame', () => {
    it('should create save then load it', async () => {
      // startNewGame 内部从 currentGame 获取 gameType，需先设置 currentGame
      useGameStore.setState({ currentGame: makeGameMeta({ id: 'pastoral_town' }) });
      const saveId = 'new-save-001';
      // createSave 返回 { success, meta }，meta.id 即为 saveId
      mockGameApi.createSave.mockResolvedValue({
        success: true,
        meta: { id: saveId, gameId: 'pastoral_town', gameType: GameType.MANAGEMENT, name: '新游戏', isAuto: false, createdAt: Date.now(), updatedAt: Date.now(), currentTurn: 1, currentNodeId: null, nodeTitle: null, turnCount: 0, messageCount: 0 }
      });
      const saveData = makeSaveData();
      mockGameApi.loadSave.mockResolvedValue({ success: true, data: saveData });
      mockGameApi.getTableData.mockResolvedValue({ success: true, data: makeTableData() });

      await useGameStore.getState().startNewGame('pastoral_town');

      expect(mockGameApi.createSave).toHaveBeenCalledTimes(1);
      const callArg = mockGameApi.createSave.mock.calls[0][0];
      expect(callArg.gameId).toBe('pastoral_town');
      expect(callArg.gameType).toBe(GameType.MANAGEMENT);
      expect(callArg.name).toMatch(/^新游戏_\d+$/);
      expect(callArg.isAuto).toBe(false);
      expect(callArg.tableSchema).toBeDefined();
      expect(mockGameApi.loadSave).toHaveBeenCalledWith(saveId);
      expect(useGameStore.getState().currentSaveId).toBe(saveId);
      expect(useGameStore.getState().currentSave).toEqual(saveData);
    });

    it('should set error when createSave returns unsuccessful', async () => {
      useGameStore.setState({ currentGame: makeGameMeta({ id: 'pastoral_town' }) });
      mockGameApi.createSave.mockResolvedValue({ success: false });

      await useGameStore.getState().startNewGame('pastoral_town');

      expect(useGameStore.getState().error).toContain('创建新游戏失败');
    });

    it('should set error when createSave throws', async () => {
      useGameStore.setState({ currentGame: makeGameMeta({ id: 'pastoral_town' }) });
      const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
      mockGameApi.createSave.mockRejectedValue(new Error('disk full'));

      await useGameStore.getState().startNewGame('pastoral_town');

      expect(useGameStore.getState().error).toContain('创建新游戏失败');
      expect(useGameStore.getState().error).toContain('disk full');
      expect(useGameStore.getState().currentSaveId).toBeNull();
      errorSpy.mockRestore();
    });
  });

  // ---------------- loadSave ----------------
  describe('loadSave', () => {
    it('should set currentSaveId / narrativeLog / tableData', async () => {
      const saveData = makeSaveData({
        narrativeLog: [
          { id: 'm1', role: 'assistant', content: 'hello', timestamp: 1 }
        ]
      });
      const tableData = makeTableData();
      mockGameApi.loadSave.mockResolvedValue({ success: true, data: saveData });
      mockGameApi.getTableData.mockResolvedValue({ success: true, data: tableData });

      await useGameStore.getState().loadSave('save-001');

      expect(mockGameApi.loadSave).toHaveBeenCalledWith('save-001');
      expect(mockGameApi.getTableData).toHaveBeenCalledWith('save-001');
      expect(useGameStore.getState().currentSaveId).toBe('save-001');
      expect(useGameStore.getState().currentSave).toEqual(saveData);
      expect(useGameStore.getState().narrativeLog).toEqual(saveData.narrativeLog);
      expect(useGameStore.getState().tableData).toEqual(tableData);
      expect(useGameStore.getState().isLoadingSave).toBe(false);
    });

    it('should set error when loadSave returns null', async () => {
      mockGameApi.loadSave.mockResolvedValue({ success: true, data: null });

      await useGameStore.getState().loadSave('missing');

      expect(useGameStore.getState().currentSave).toBeNull();
      expect(useGameStore.getState().error).toContain('存档不存在或已损坏');
    });

    it('should continue loading when getTableData throws (degrade to null)', async () => {
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
      const saveData = makeSaveData();
      mockGameApi.loadSave.mockResolvedValue({ success: true, data: saveData });
      mockGameApi.getTableData.mockRejectedValue(new Error('table corrupt'));

      await useGameStore.getState().loadSave('save-001');

      expect(useGameStore.getState().currentSave).toEqual(saveData);
      expect(useGameStore.getState().tableData).toBeNull();
      expect(useGameStore.getState().error).toBeNull();
      warnSpy.mockRestore();
    });
  });

  // ---------------- saveGame ----------------
  describe('saveGame', () => {
    it('should call IPC save with current narrativeLog', async () => {
      const saveData = makeSaveData();
      useGameStore.setState({ currentSave: saveData, currentSaveId: 'save-001' });
      const newMsg = { id: 'm1', role: 'assistant' as const, content: 'hi', timestamp: 1 };
      useGameStore.setState({ narrativeLog: [newMsg] });

      await useGameStore.getState().saveGame();

      expect(mockGameApi.save).toHaveBeenCalledTimes(1);
      // IPC save 签名为 (saveId, updates)
      expect(mockGameApi.save).toHaveBeenCalledWith('save-001', expect.objectContaining({
        narrativeLog: [newMsg]
      }));
      expect(useGameStore.getState().currentSave?.narrativeLog).toEqual([newMsg]);
      expect(useGameStore.getState().currentSave?.meta.messageCount).toBe(1);
    });

    it('should be a no-op when no current save', async () => {
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
      await useGameStore.getState().saveGame();
      expect(mockGameApi.save).not.toHaveBeenCalled();
      warnSpy.mockRestore();
    });
  });

  // ---------------- appendNarrativeChunk ----------------
  describe('appendNarrativeChunk', () => {
    beforeEach(() => {
      // 模拟已加载存档
      useGameStore.setState({
        currentSaveId: 'save-001',
        currentSave: makeSaveData(),
        narrativeLog: []
      });
    });

    it('should create a new assistant message on first chunk', () => {
      const chunk = makeChunk('save-001', 'Hello', 0);

      useGameStore.getState().appendNarrativeChunk(chunk);

      const log = useGameStore.getState().narrativeLog;
      expect(log).toHaveLength(1);
      expect(log[0].role).toBe('assistant');
      expect(log[0].content).toBe('Hello');
      expect(useGameStore.getState().currentStreamingMessageId).toBe(log[0].id);
    });

    it('should append to existing streaming message on subsequent chunks', () => {
      const chunk1 = makeChunk('save-001', 'Hello', 0);
      const chunk2 = makeChunk('save-001', ' world', 1);

      useGameStore.getState().appendNarrativeChunk(chunk1);
      useGameStore.getState().appendNarrativeChunk(chunk2);

      const log = useGameStore.getState().narrativeLog;
      expect(log).toHaveLength(1);
      expect(log[0].content).toBe('Hello world');
    });

    it('should ignore chunks for other saveId', () => {
      const chunk = makeChunk('other-save', 'Hello', 0);

      useGameStore.getState().appendNarrativeChunk(chunk);

      expect(useGameStore.getState().narrativeLog).toHaveLength(0);
    });

    it('should ignore empty chunk text', () => {
      const chunk = makeChunk('save-001', '', 0);

      useGameStore.getState().appendNarrativeChunk(chunk);

      expect(useGameStore.getState().narrativeLog).toHaveLength(0);
    });

    it('should create new streaming message after previous generation completed', () => {
      // 第一轮
      useGameStore.getState().appendNarrativeChunk(makeChunk('save-001', 'A', 0));
      useGameStore.getState().appendNarrativeChunk(makeChunk('save-001', 'B', 1));
      expect(useGameStore.getState().narrativeLog).toHaveLength(1);

      // 模拟 generateNarrative 被调用：重置 currentStreamingMessageId
      useGameStore.setState({ currentStreamingMessageId: null });

      // 第二轮首个 chunk 应创建新消息
      useGameStore.getState().appendNarrativeChunk(makeChunk('save-001', 'C', 0));

      const log = useGameStore.getState().narrativeLog;
      expect(log).toHaveLength(2);
      expect(log[0].content).toBe('AB');
      expect(log[1].content).toBe('C');
    });
  });

  // ---------------- generateNarrative ----------------
  describe('generateNarrative', () => {
    beforeEach(() => {
      useGameStore.setState({
        currentGameId: 'pastoral_town',
        currentSaveId: 'save-001',
        currentGame: makeGameMeta()
      });
    });

    it('should set isGenerating=true and call IPC generateNarrative (fire-and-forget)', async () => {
      // generateNarrative 不 await IPC 完成，但需要返回一个 resolved promise 以避免 catch
      mockGameApi.generateNarrative.mockResolvedValue(undefined);

      // 注意：generateNarrative action 本身是 async，但 IPC 调用是 fire-and-forget
      await useGameStore.getState().generateNarrative({ userAction: 'build:farm' });

      expect(useGameStore.getState().isGenerating).toBe(true);
      expect(useGameStore.getState().currentStreamingMessageId).toBeNull();
      expect(mockGameApi.generateNarrative).toHaveBeenCalledTimes(1);
      const req = mockGameApi.generateNarrative.mock.calls[0][0];
      expect(req.gameId).toBe('pastoral_town');
      expect(req.saveId).toBe('save-001');
      expect(req.gameType).toBe(GameType.MANAGEMENT);
      expect(req.userAction).toBe('build:farm');
    });

    it('should fill required fields from current state when request omits them', async () => {
      mockGameApi.generateNarrative.mockResolvedValue(undefined);

      await useGameStore.getState().generateNarrative({});

      const req = mockGameApi.generateNarrative.mock.calls[0][0];
      expect(req.gameId).toBe('pastoral_town');
      expect(req.saveId).toBe('save-001');
      expect(req.gameType).toBe(GameType.MANAGEMENT);
      expect(req.userAction).toBe('');
    });

    it('should pass through optional fields (templateSystemPrompt, tableSchema, etc.)', async () => {
      mockGameApi.generateNarrative.mockResolvedValue(undefined);
      const tableSchema = {
        sheets: ['resources'],
        headers: { resources: ['id', 'name'] },
        sheetDescriptions: { resources: '资源' }
      };

      await useGameStore.getState().generateNarrative({
        userAction: 'end_turn',
        templateSystemPrompt: 'You are a narrator',
        tableSchema,
        organizeMode: 'sync'
      });

      const req = mockGameApi.generateNarrative.mock.calls[0][0];
      expect(req.templateSystemPrompt).toBe('You are a narrator');
      expect(req.tableSchema).toEqual(tableSchema);
      expect(req.organizeMode).toBe('sync');
    });

    it('should set error and reset isGenerating when no current save', async () => {
      useGameStore.setState({ currentSaveId: null });

      await useGameStore.getState().generateNarrative({ userAction: 'x' });

      expect(useGameStore.getState().error).toContain('未选择游戏或存档');
      expect(useGameStore.getState().isGenerating).toBe(false);
      expect(mockGameApi.generateNarrative).not.toHaveBeenCalled();
    });

    it('should set isGenerating=false on IPC sync error (catch handler)', async () => {
      const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
      // 模拟 IPC 调用立即 reject（catch 分支会被触发）
      mockGameApi.generateNarrative.mockRejectedValue(new Error('ipc failed'));

      await useGameStore.getState().generateNarrative({ userAction: 'x' });
      // 等待微任务队列清空（catch 是异步的）
      await Promise.resolve();
      await Promise.resolve();

      expect(useGameStore.getState().isGenerating).toBe(false);
      expect(useGameStore.getState().error).toContain('生成叙事失败');
      expect(useGameStore.getState().error).toContain('ipc failed');
      errorSpy.mockRestore();
    });
  });

  // ---------------- cancelGeneration ----------------
  describe('cancelGeneration', () => {
    it('should call cancelGeneration IPC and reset isGenerating', async () => {
      mockGameApi.cancelGeneration.mockResolvedValue(undefined);
      useGameStore.setState({ currentSaveId: 'save-001', isGenerating: true });

      await useGameStore.getState().cancelGeneration();

      expect(mockGameApi.cancelGeneration).toHaveBeenCalledWith('save-001');
      expect(useGameStore.getState().isGenerating).toBe(false);
    });

    it('should reset isGenerating even if no currentSaveId', async () => {
      useGameStore.setState({ currentSaveId: null, isGenerating: true });

      await useGameStore.getState().cancelGeneration();

      expect(useGameStore.getState().isGenerating).toBe(false);
    });

    it('should reset isGenerating even if IPC throws', async () => {
      const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
      mockGameApi.cancelGeneration.mockRejectedValue(new Error('ipc'));
      useGameStore.setState({ currentSaveId: 'save-001', isGenerating: true });

      await useGameStore.getState().cancelGeneration();

      expect(useGameStore.getState().isGenerating).toBe(false);
      errorSpy.mockRestore();
    });
  });

  // ---------------- applyTableEdits ----------------
  describe('applyTableEdits', () => {
    it('should call applyTableEdits IPC and refresh tableData', async () => {
      const tableData = makeTableData();
      mockGameApi.applyTableEdits.mockResolvedValue({
        success: true,
        changes: { commandsExecuted: 1, affectedSheets: ['resources'], errors: [] }
      });
      mockGameApi.getTableData.mockResolvedValue({ success: true, data: tableData });
      useGameStore.setState({ currentSaveId: 'save-001' });

      await useGameStore.getState().applyTableEdits([makeTableEditCommand()]);

      expect(mockGameApi.applyTableEdits).toHaveBeenCalledWith('save-001', [
        expect.objectContaining({ type: GameTableEditCommandType.INSERT_ROW })
      ]);
      expect(useGameStore.getState().tableData).toEqual(tableData);
    });

    it('should set error when result.success is false', async () => {
      mockGameApi.applyTableEdits.mockResolvedValue({
        success: false,
        changes: {
          commandsExecuted: 0,
          affectedSheets: [],
          errors: ['bad command']
        }
      });
      mockGameApi.getTableData.mockResolvedValue({ success: true, data: null });
      useGameStore.setState({ currentSaveId: 'save-001' });

      await useGameStore.getState().applyTableEdits([makeTableEditCommand()]);

      expect(useGameStore.getState().error).toContain('表格编辑失败');
      expect(useGameStore.getState().error).toContain('bad command');
    });

    it('should set error when no currentSaveId', async () => {
      useGameStore.setState({ currentSaveId: null });

      await useGameStore.getState().applyTableEdits([makeTableEditCommand()]);

      expect(useGameStore.getState().error).toContain('无当前存档');
      expect(mockGameApi.applyTableEdits).not.toHaveBeenCalled();
    });
  });

  // ---------------- 事件处理 ----------------
  describe('_handleNarrativeComplete', () => {
    it('should overwrite streaming message with fullText and trigger saveGame', async () => {
      const saveData = makeSaveData();
      useGameStore.setState({
        currentSaveId: 'save-001',
        currentSave: saveData,
        narrativeLog: [
          { id: 'm1', role: 'assistant', content: 'partial', timestamp: 1 }
        ],
        currentStreamingMessageId: 'm1',
        isGenerating: true
      });
      mockGameApi.save.mockResolvedValue(undefined);

      const complete = makeComplete('save-001', 'full authoritative text');
      useGameStore.getState()._handleNarrativeComplete(complete);

      // 等待异步 saveGame 完成
      await Promise.resolve();
      await Promise.resolve();

      const state = useGameStore.getState();
      expect(state.isGenerating).toBe(false);
      expect(state.currentStreamingMessageId).toBeNull();
      expect(state.narrativeLog[0].content).toBe('full authoritative text');
      expect(mockGameApi.save).toHaveBeenCalled();
    });

    it('should push new message if no streaming target', () => {
      useGameStore.setState({
        currentSaveId: 'save-001',
        narrativeLog: [],
        currentStreamingMessageId: null,
        isGenerating: true
      });

      const complete = makeComplete('save-001', 'complete text');
      useGameStore.getState()._handleNarrativeComplete(complete);

      const state = useGameStore.getState();
      expect(state.narrativeLog).toHaveLength(1);
      expect(state.narrativeLog[0].content).toBe('complete text');
      expect(state.isGenerating).toBe(false);
    });

    it('should ignore events for other saveId', () => {
      useGameStore.setState({
        currentSaveId: 'save-001',
        narrativeLog: [],
        isGenerating: true
      });

      const complete = makeComplete('other-save', 'should be ignored');
      useGameStore.getState()._handleNarrativeComplete(complete);

      expect(useGameStore.getState().narrativeLog).toHaveLength(0);
      expect(useGameStore.getState().isGenerating).toBe(true);
    });
  });

  describe('_handleNarrativeError', () => {
    it('should set error and reset isGenerating', () => {
      useGameStore.setState({
        currentSaveId: 'save-001',
        isGenerating: true,
        currentStreamingMessageId: 'm1'
      });

      useGameStore.getState()._handleNarrativeError(makeError('save-001', 'timeout'));

      const state = useGameStore.getState();
      expect(state.isGenerating).toBe(false);
      expect(state.currentStreamingMessageId).toBeNull();
      expect(state.error).toContain('AI 叙事生成失败');
      expect(state.error).toContain('timeout');
    });

    it('should ignore events for other saveId', () => {
      useGameStore.setState({
        currentSaveId: 'save-001',
        isGenerating: true,
        error: null
      });

      useGameStore.getState()._handleNarrativeError(makeError('other-save', 'x'));

      expect(useGameStore.getState().isGenerating).toBe(true);
      expect(useGameStore.getState().error).toBeNull();
    });
  });

  describe('_handleTableUpdated', () => {
    it('should refresh tableData from IPC', async () => {
      const tableData = makeTableData();
      mockGameApi.getTableData.mockResolvedValue({ success: true, data: tableData });
      useGameStore.setState({ currentSaveId: 'save-001', tableData: null });

      useGameStore.getState()._handleTableUpdated(makeTableUpdated('save-001'));

      // 等待异步 getTableData 完成
      await Promise.resolve();
      await Promise.resolve();

      expect(mockGameApi.getTableData).toHaveBeenCalledWith('save-001');
      expect(useGameStore.getState().tableData).toEqual(tableData);
    });

    it('should ignore events for other saveId', async () => {
      useGameStore.setState({ currentSaveId: 'save-001', tableData: null });

      useGameStore.getState()._handleTableUpdated(makeTableUpdated('other-save'));

      await Promise.resolve();
      expect(mockGameApi.getTableData).not.toHaveBeenCalled();
    });
  });

  // ---------------- 事件回调被捕获 ----------------
  describe('captured event callbacks (integration with subscription)', () => {
    it('should route onNarrativeChunk events to appendNarrativeChunk via captured callback', () => {
      useGameStore.setState({
        currentSaveId: 'save-001',
        narrativeLog: []
      });

      // 模拟主进程推送事件
      const callback = capturedListeners.chunk[0];
      expect(callback).toBeDefined();
      callback(makeChunk('save-001', 'routed text', 0));

      expect(useGameStore.getState().narrativeLog).toHaveLength(1);
      expect(useGameStore.getState().narrativeLog[0].content).toBe('routed text');
    });

    it('should route onNarrativeError events to _handleNarrativeError', () => {
      useGameStore.setState({
        currentSaveId: 'save-001',
        isGenerating: true,
        error: null
      });

      const callback = capturedListeners.error[0];
      callback(makeError('save-001', 'routed error'));

      expect(useGameStore.getState().isGenerating).toBe(false);
      expect(useGameStore.getState().error).toContain('routed error');
    });
  });

  // ---------------- Getters ----------------
  describe('getters', () => {
    it('getCurrentGame returns currentGame', () => {
      const meta = makeGameMeta();
      useGameStore.setState({ currentGame: meta });
      expect(useGameStore.getState().getCurrentGame()).toEqual(meta);
    });

    it('getCurrentSave returns currentSave', () => {
      const save = makeSaveData();
      useGameStore.setState({ currentSave: save });
      expect(useGameStore.getState().getCurrentSave()).toEqual(save);
    });

    it('getCurrentGame returns null when not set', () => {
      expect(useGameStore.getState().getCurrentGame()).toBeNull();
    });
  });

  // ---------------- setTableData / clearError ----------------
  describe('setTableData / clearError', () => {
    it('setTableData replaces tableData', () => {
      const td = makeTableData();
      useGameStore.getState().setTableData(td);
      expect(useGameStore.getState().tableData).toEqual(td);

      useGameStore.getState().setTableData(null);
      expect(useGameStore.getState().tableData).toBeNull();
    });

    it('clearError resets error to null', () => {
      useGameStore.setState({ error: 'something broke' });
      useGameStore.getState().clearError();
      expect(useGameStore.getState().error).toBeNull();
    });
  });
});
