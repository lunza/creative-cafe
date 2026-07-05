/**
 * 游戏模式 IPC handler 集成测试
 *
 * 覆盖场景（spec Task 5.9）：
 * 1. game:list 空列表与有数据列表
 * 2. game:createSave 创建存档并可通过 game:loadSave 读回
 * 3. game:generateNarrative 流式事件序列（chunk → complete）
 *    - mock AIService.streamChatAPI 模拟流式输出
 *    - 验证 onChunk / onComplete / onError 回调转换为 IPC 事件推送
 *    - 验证 activeAbortControllers 的注册与清理
 *
 * 测试策略：
 * - 使用 os.tmpdir() 创建临时 userData 目录，vi.mock 替换 getUserDataPath
 * - vi.mock 替换 electron 模块，捕获 ipcMain.handle 注册的 handler 与 event.sender.send 推送
 * - vi.mock 替换 AIService.streamChatAPI，模拟流式输出
 * - 不启动真实 Electron 进程，仅验证 handler → repository → IPC 事件 序列
 *
 * 注意：vi.mock 工厂在文件 import 之前执行（提升），因此工厂内引用的变量
 *       必须使用 vi.hoisted 创建（普通 const 在工厂内不可访问）。
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';

// ============================================================================
// vi.hoisted: 创建可在 vi.mock 工厂中访问的共享状态
// ============================================================================

const {
  tmpRootRef,
  ipcHandlers,
  mockStreamChunksRef,
  mockStreamFullTextRef,
  mockStreamShouldFailRef,
  mockStreamFailureErrorRef,
} = vi.hoisted(() => {
  type IpcHandler = (event: any, ...args: any[]) => Promise<any>;
  return {
    // 临时 userData 根目录（beforeEach 中赋值）
    tmpRootRef: { value: '' },
    // IPC handler 注册表
    ipcHandlers: new Map<string, IpcHandler>(),
    // mock stream 状态
    mockStreamChunksRef: { value: [] as string[] },
    mockStreamFullTextRef: { value: '' as string },
    mockStreamShouldFailRef: { value: false as boolean },
    mockStreamFailureErrorRef: { value: null as Error | null },
  };
});

// ============================================================================
// Mock 1: getUserDataPath（必须在 import 仓储之前 mock）
// ============================================================================

vi.mock('../../../../utils/appPath', () => ({
  getUserDataPath: () => tmpRootRef.value,
  getAppPath: () => tmpRootRef.value,
}));

// ============================================================================
// Mock 2: electron（捕获 ipcMain.handle 注册）
// ============================================================================

vi.mock('electron', () => {
  return {
    ipcMain: {
      handle: vi.fn((channel: string, handler: (event: any, ...args: any[]) => Promise<any>) => {
        ipcHandlers.set(channel, handler);
      }),
      on: vi.fn(),
      removeAllListeners: vi.fn(),
    },
    // ipcRenderer 仅在 preload 中使用，此处不需实现
    ipcRenderer: {
      on: vi.fn(),
      invoke: vi.fn(),
      removeListener: vi.fn(),
    },
    // app.getPath 兜底（getUserDataPath 已被 mock，不会调用）
    app: {
      getPath: vi.fn(() => tmpRootRef.value),
    },
    // BrowserWindow 等
    BrowserWindow: vi.fn(),
  };
});

// ============================================================================
// Mock 3: AIService.streamChatAPI（模拟流式输出）
// ============================================================================

vi.mock('../../../../services/AIService', () => {
  return {
    aiService: {
      streamChatAPI: vi.fn(
        async (
          _messages: any[],
          options: any,
          onChunk: (chunk: string) => void
        ): Promise<{ content: string; generationTime: number; model: string }> => {
          // 若 abortSignal 已取消，立即抛出
          if (options?.abortSignal?.aborted) {
            throw new Error('操作已被取消');
          }

          // 模拟流式输出
          for (const chunk of mockStreamChunksRef.value) {
            // 检查取消（每个 chunk 之间）
            if (options?.abortSignal?.aborted) {
              throw new Error('操作已被取消');
            }
            onChunk(chunk);
            // 让出事件循环，让 controller.abort 生效
            await new Promise<void>((resolve) => setImmediate(resolve));
          }

          if (mockStreamShouldFailRef.value && mockStreamFailureErrorRef.value) {
            throw mockStreamFailureErrorRef.value;
          }

          return {
            content: mockStreamFullTextRef.value,
            generationTime: 100,
            model: options?.model || 'test-model',
          };
        }
      ),
      // resolveModelConfig 中调用
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
// Mock 4: storageService + storageManager
// AIService 间接 import 的副作用模块，会触发 StorageManager 初始化
// （storageService.ts:726 `export default getStorageService()` 与
//  storageManager.ts:663 `export default getStorageManager()` 都会在 import 时执行）
// ============================================================================

vi.mock('../../../../services/storageService', () => {
  // 提供一个最小化的 mock，避免触发 electron-store / electron app.getPath
  return {
    getStorageService: vi.fn(() => ({
      // 测试中不会真正调用 storageService 方法，但保留空实现以兼容接口
    })),
    default: {},
  };
});

vi.mock('../../../../services/storageManager', () => {
  return {
    getStorageManager: vi.fn(() => ({
      // 空 StorageManager mock
    })),
    StorageManager: vi.fn(),
    default: {},
  };
});

// ============================================================================
// Mock 5: logger（避免触发 createLogger 内部的 electron 依赖）
// ============================================================================

vi.mock('../../../../services/logger', () => {
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

import { registerGameHandlers, abortAllActiveGameRequests } from '../../gameHandlers';
import {
  GameType,
  GameStatus,
  type GameMeta,
  type GameTableSchema,
} from '../../../../../shared/types/game.types';

// ============================================================================
// 测试工具函数
// ============================================================================

/**
 * 构造模拟的 IpcMainInvokeEvent
 * - sender.send 将推送的事件捕获到 sentEvents 数组供断言
 * - sender.isDestroyed 始终返回 false（窗口存活）
 */
function makeMockEvent() {
  const sentEvents: Array<{ channel: string; args: any[] }> = [];
  const event = {
    sender: {
      isDestroyed: () => false,
      send: (channel: string, ...args: any[]) => {
        sentEvents.push({ channel, args });
      },
    },
  };
  return { event, sentEvents };
}

/**
 * 调用已注册的 IPC handler
 */
async function invokeHandler(channel: string, event: any, ...args: any[]): Promise<any> {
  const handler = ipcHandlers.get(channel);
  if (!handler) {
    throw new Error(`No handler registered for channel: ${channel}`);
  }
  return await handler(event, ...args);
}

/**
 * 等待所有 microtask 与 setImmediate 完成
 */
async function flushMicrotasks(): Promise<void> {
  await new Promise<void>((resolve) => setImmediate(resolve));
}

// ============================================================================
// 测试 fixtures
// ============================================================================

function makeGameMeta(overrides: Partial<GameMeta> = {}): GameMeta {
  const now = Date.now();
  return {
    id: 'test-game-1',
    type: GameType.MANAGEMENT,
    title: '测试游戏',
    subtitle: '副标题',
    description: '这是一个测试游戏',
    gameplay: '玩法说明',
    developer: '测试开发者',
    version: '1.0.0',
    status: GameStatus.IN_DEVELOPMENT,
    tags: ['测试', '经营'],
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

function makeTableSchema(): GameTableSchema {
  return {
    sheets: ['资源'],
    headers: {
      资源: ['流水号', '唯一id', '资源名', '数量', '单位'],
    },
    sheetDescriptions: {
      资源: '记录资源信息',
    },
  };
}

// ============================================================================
// 测试套件
// ============================================================================

describe('Game IPC Handlers (Integration)', () => {
  beforeEach(() => {
    // 重置临时目录
    tmpRootRef.value = fs.mkdtempSync(path.join(os.tmpdir(), 'cc-game-ipc-test-'));

    // 重置 handler 注册表（避免上次测试残留）
    ipcHandlers.clear();

    // 重置 mock 状态
    mockStreamChunksRef.value = [];
    mockStreamFullTextRef.value = '';
    mockStreamShouldFailRef.value = false;
    mockStreamFailureErrorRef.value = null;

    // 重置所有 vi.fn 调用计数
    vi.clearAllMocks();

    // 注册所有 game handler
    registerGameHandlers();
  });

  afterEach(() => {
    // 清理临时目录
    if (fs.existsSync(tmpRootRef.value)) {
      fs.rmSync(tmpRootRef.value, { recursive: true, force: true });
    }
    // 清理活跃的 AbortController（避免跨测试污染）
    abortAllActiveGameRequests();
  });

  // ==================== SubTask 5.1: game:list / getMeta / createGame ====================

  describe('SubTask 5.1: 游戏元数据 IPC handler', () => {
    it('game:list 在空索引时应返回空数组', async () => {
      const { event } = makeMockEvent();
      const result = await invokeHandler('game:list', event);

      expect(result.success).toBe(true);
      expect(result.games).toEqual([]);
    });

    it('game:createGame 后 game:list 应返回该游戏', async () => {
      const { event } = makeMockEvent();
      const meta = makeGameMeta({ id: 'game-create-1', title: '创建测试' });

      const createResult = await invokeHandler('game:createGame', event, meta);
      expect(createResult.success).toBe(true);

      const listResult = await invokeHandler('game:list', event);
      expect(listResult.success).toBe(true);
      expect(listResult.games).toHaveLength(1);
      expect(listResult.games[0].id).toBe('game-create-1');
      expect(listResult.games[0].title).toBe('创建测试');
    });

    it('game:getMeta 应返回完整元数据', async () => {
      const { event } = makeMockEvent();
      const meta = makeGameMeta({ id: 'game-getmeta-1' });
      await invokeHandler('game:createGame', event, meta);

      const result = await invokeHandler('game:getMeta', event, 'game-getmeta-1');
      expect(result.success).toBe(true);
      expect(result.meta).not.toBeNull();
      expect(result.meta.id).toBe('game-getmeta-1');
      expect(result.meta.description).toBe(meta.description);
      expect(result.meta.version).toBe(meta.version);
    });

    it('game:getMeta 在游戏不存在时应返回 meta: null', async () => {
      const { event } = makeMockEvent();
      const result = await invokeHandler('game:getMeta', event, 'nonexistent');
      expect(result.success).toBe(true);
      expect(result.meta).toBeNull();
    });

    it('game:updateGame 应更新元数据并刷新索引', async () => {
      const { event } = makeMockEvent();
      const meta = makeGameMeta({ id: 'game-update-1', title: '原标题' });
      await invokeHandler('game:createGame', event, meta);

      const updateResult = await invokeHandler(
        'game:updateGame',
        event,
        'game-update-1',
        { title: '新标题', status: GameStatus.COMPLETED }
      );
      expect(updateResult.success).toBe(true);

      // 验证 meta 已更新
      const getResult = await invokeHandler('game:getMeta', event, 'game-update-1');
      expect(getResult.meta.title).toBe('新标题');
      expect(getResult.meta.status).toBe(GameStatus.COMPLETED);

      // 验证索引已同步
      const listResult = await invokeHandler('game:list', event);
      expect(listResult.games[0].title).toBe('新标题');
      expect(listResult.games[0].status).toBe(GameStatus.COMPLETED);
    });

    it('game:deleteGame 应删除游戏与索引条目', async () => {
      const { event } = makeMockEvent();
      const meta = makeGameMeta({ id: 'game-del-1' });
      await invokeHandler('game:createGame', event, meta);

      const delResult = await invokeHandler('game:deleteGame', event, 'game-del-1');
      expect(delResult.success).toBe(true);

      const listResult = await invokeHandler('game:list', event);
      expect(listResult.games).toHaveLength(0);
    });
  });

  // ==================== SubTask 5.2: createSave / loadSave / listSaves ====================

  describe('SubTask 5.2: 存档 IPC handler', () => {
    it('game:createSave 应创建存档并返回 meta（含 saveId）', async () => {
      const { event } = makeMockEvent();
      // 先创建游戏
      const meta = makeGameMeta({ id: 'game-save-1' });
      await invokeHandler('game:createGame', event, meta);

      // 创建存档
      const result = await invokeHandler('game:createSave', event, {
        gameId: 'game-save-1',
        gameType: GameType.MANAGEMENT,
        name: '测试存档',
        isAuto: false,
        tableSchema: makeTableSchema(),
      });

      expect(result.success).toBe(true);
      expect(result.meta).toBeDefined();
      expect(result.meta.id).toBeDefined();
      expect(result.meta.gameId).toBe('game-save-1');
      expect(result.meta.gameType).toBe(GameType.MANAGEMENT);
      expect(result.meta.name).toBe('测试存档');
      expect(result.meta.isAuto).toBe(false);
    });

    it('game:loadSave 应返回完整存档数据（含 narrativeLog 与 stateSnapshot）', async () => {
      const { event } = makeMockEvent();
      await invokeHandler('game:createGame', event, makeGameMeta({ id: 'game-load-1' }));

      // 创建存档（含 initialState）
      const createResult = await invokeHandler('game:createSave', event, {
        gameId: 'game-load-1',
        gameType: GameType.MANAGEMENT,
        name: '带状态存档',
        isAuto: false,
        tableSchema: makeTableSchema(),
        initialState: { coins: 500, food: 50 },
      });
      const saveId = createResult.meta.id;

      // 读取存档
      const loadResult = await invokeHandler('game:loadSave', event, saveId);
      expect(loadResult.success).toBe(true);
      expect(loadResult.data).not.toBeNull();
      expect(loadResult.data.meta.id).toBe(saveId);
      expect(loadResult.data.narrativeLog).toEqual([]);
      expect(loadResult.data.stateSnapshot).toEqual({ coins: 500, food: 50 });
    });

    it('game:listSaves 应返回指定游戏的所有存档（按 updatedAt 倒序）', async () => {
      const { event } = makeMockEvent();
      await invokeHandler('game:createGame', event, makeGameMeta({ id: 'game-list-1' }));

      // 创建 2 个存档
      const r1 = await invokeHandler('game:createSave', event, {
        gameId: 'game-list-1',
        gameType: GameType.MANAGEMENT,
        name: '存档1',
        isAuto: false,
        tableSchema: makeTableSchema(),
      });
      // 等待一段时间确保 updatedAt 不同
      await new Promise<void>((resolve) => setTimeout(resolve, 5));
      const r2 = await invokeHandler('game:createSave', event, {
        gameId: 'game-list-1',
        gameType: GameType.MANAGEMENT,
        name: '存档2',
        isAuto: false,
        tableSchema: makeTableSchema(),
      });

      const listResult = await invokeHandler('game:listSaves', event, 'game-list-1');
      expect(listResult.success).toBe(true);
      expect(listResult.saves).toHaveLength(2);
      // 倒序：最新的在前
      expect(listResult.saves[0].id).toBe(r2.meta.id);
      expect(listResult.saves[1].id).toBe(r1.meta.id);
    });

    it('game:save 应更新存档的 narrativeLog 与 currentTurn', async () => {
      const { event } = makeMockEvent();
      await invokeHandler('game:createGame', event, makeGameMeta({ id: 'game-update-save-1' }));

      const createResult = await invokeHandler('game:createSave', event, {
        gameId: 'game-update-save-1',
        gameType: GameType.MANAGEMENT,
        name: '测试',
        isAuto: false,
        tableSchema: makeTableSchema(),
      });
      const saveId = createResult.meta.id;

      // 更新 narrativeLog 与 currentTurn
      const newLog = [
        {
          id: 'msg-1',
          role: 'user' as const,
          content: '玩家行动',
          timestamp: Date.now(),
          turn: 1,
        },
        {
          id: 'msg-2',
          role: 'assistant' as const,
          content: 'AI 回复',
          timestamp: Date.now() + 1,
          turn: 1,
        },
      ];
      const saveResult = await invokeHandler('game:save', event, saveId, {
        narrativeLog: newLog,
        currentTurn: 1,
        turnCount: 1,
      });
      expect(saveResult.success).toBe(true);

      // 验证已更新
      const loadResult = await invokeHandler('game:loadSave', event, saveId);
      expect(loadResult.data.narrativeLog).toEqual(newLog);
      expect(loadResult.data.meta.currentTurn).toBe(1);
      expect(loadResult.data.meta.turnCount).toBe(1);
      expect(loadResult.data.meta.messageCount).toBe(2);
    });

    it('game:deleteSave 应删除存档', async () => {
      const { event } = makeMockEvent();
      await invokeHandler('game:createGame', event, makeGameMeta({ id: 'game-del-save-1' }));

      const createResult = await invokeHandler('game:createSave', event, {
        gameId: 'game-del-save-1',
        gameType: GameType.MANAGEMENT,
        name: '待删除',
        isAuto: false,
        tableSchema: makeTableSchema(),
      });
      const saveId = createResult.meta.id;

      const delResult = await invokeHandler('game:deleteSave', event, saveId);
      expect(delResult.success).toBe(true);

      // 验证已删除
      const loadResult = await invokeHandler('game:loadSave', event, saveId);
      expect(loadResult.data).toBeNull();
    });
  });

  // ==================== SubTask 5.3: 表格 handler ====================

  describe('SubTask 5.3: 表格数据 IPC handler', () => {
    it('game:getTableData 在新建存档后应返回空表格（按 schema 初始化）', async () => {
      const { event } = makeMockEvent();
      await invokeHandler('game:createGame', event, makeGameMeta({ id: 'game-tbl-1' }));

      const createResult = await invokeHandler('game:createSave', event, {
        gameId: 'game-tbl-1',
        gameType: GameType.MANAGEMENT,
        name: '表格测试',
        isAuto: false,
        tableSchema: makeTableSchema(),
      });
      const saveId = createResult.meta.id;

      const result = await invokeHandler('game:getTableData', event, saveId);
      expect(result.success).toBe(true);
      expect(result.data).not.toBeNull();
      expect(result.data.sheets).toEqual(['资源']);
      expect(result.data.data['资源']).toEqual([]);
    });

    it('game:applyTableEdits 应正确执行 INSERT_ROW 命令', async () => {
      const { event } = makeMockEvent();
      await invokeHandler('game:createGame', event, makeGameMeta({ id: 'game-edits-1' }));

      const createResult = await invokeHandler('game:createSave', event, {
        gameId: 'game-edits-1',
        gameType: GameType.MANAGEMENT,
        name: '表格编辑测试',
        isAuto: false,
        tableSchema: makeTableSchema(),
      });
      const saveId = createResult.meta.id;

      const result = await invokeHandler('game:applyTableEdits', event, saveId, [
        {
          type: 'insertRow' as const,
          sheetIndex: 1,
          rowData: {
            '1': 'res-1',
            '2': 'res-1',
            '3': '金币',
            '4': 500,
            '5': '个',
          },
          raw: '<insertRow sheetIndex="1"><rowData>...</rowData></insertRow>',
        },
      ]);

      expect(result.success).toBe(true);
      expect(result.changes.commandsExecuted).toBe(1);
      expect(result.changes.affectedSheets).toEqual(['资源']);
      expect(result.changes.errors).toEqual([]);

      // 验证数据已写入
      const loadResult = await invokeHandler('game:getTableData', event, saveId);
      expect(loadResult.data.data['资源']).toHaveLength(1);
      expect(loadResult.data.data['资源'][0]['3']).toBe('金币');
    });

    it('game:applyTableEdits 在空命令时应返回 success: true（无操作）', async () => {
      const { event } = makeMockEvent();
      await invokeHandler('game:createGame', event, makeGameMeta({ id: 'game-empty-edits' }));

      const createResult = await invokeHandler('game:createSave', event, {
        gameId: 'game-empty-edits',
        gameType: GameType.MANAGEMENT,
        name: '空命令测试',
        isAuto: false,
        tableSchema: makeTableSchema(),
      });

      const result = await invokeHandler(
        'game:applyTableEdits',
        event,
        createResult.meta.id,
        []
      );
      expect(result.success).toBe(true);
      expect(result.changes.commandsExecuted).toBe(0);
    });
  });

  // ==================== SubTask 5.5: 配置 handler ====================

  describe('SubTask 5.5: 游戏本地配置 IPC handler', () => {
    it('game:getConfig 在不存在时应返回默认配置', async () => {
      const { event } = makeMockEvent();
      await invokeHandler('game:createGame', event, makeGameMeta({ id: 'game-cfg-1' }));

      const result = await invokeHandler('game:getConfig', event, 'game-cfg-1');
      expect(result.success).toBe(true);
      expect(result.config).toBeDefined();
      expect(result.config.temperature).toBe(0.7);
      expect(result.config.maxTokens).toBe(32768);
      expect(result.config.organizeMode).toBe('async');
    });

    it('game:saveConfig 应持久化配置并可读回', async () => {
      const { event } = makeMockEvent();
      await invokeHandler('game:createGame', event, makeGameMeta({ id: 'game-cfg-2' }));

      const newConfig = {
        activeEngineId: 'engine-x',
        temperature: 0.5,
        maxTokens: 8192,
        organizeMode: 'sync' as const,
        ansiTheme: 'dark',
        autoSave: false,
      };
      const saveResult = await invokeHandler('game:saveConfig', event, 'game-cfg-2', newConfig);
      expect(saveResult.success).toBe(true);

      const loadResult = await invokeHandler('game:getConfig', event, 'game-cfg-2');
      expect(loadResult.config).toEqual(newConfig);
    });
  });

  // ==================== SubTask 5.4: generateNarrative 流式事件序列 ====================

  describe('SubTask 5.4: generateNarrative 流式事件序列', () => {
    /**
     * 辅助：注册所有 game handler 后，准备一个存档供叙事生成调用
     */
    async function prepareSaveForNarrative(): Promise<{ saveId: string; gameId: string }> {
      const { event } = makeMockEvent();
      const gameId = 'game-narrative-1';
      await invokeHandler('game:createGame', event, makeGameMeta({ id: gameId }));

      const createSaveResult = await invokeHandler('game:createSave', event, {
        gameId,
        gameType: GameType.MANAGEMENT,
        name: '叙事测试存档',
        isAuto: false,
        tableSchema: makeTableSchema(),
      });

      return { saveId: createSaveResult.meta.id, gameId };
    }

    it('generateNarrative 应通过 IPC 事件推送 chunk → complete 序列', async () => {
      // 准备存档
      const { saveId, gameId } = await prepareSaveForNarrative();

      // 配置 mock stream 输出
      mockStreamChunksRef.value = ['第一段', '第二段', '第三段'];
      mockStreamFullTextRef.value = '第一段第二段第三段';

      const { event, sentEvents } = makeMockEvent();

      // 调用 generateNarrative（handler 立即返回 success: true，实际生成在后台异步）
      const result = await invokeHandler('game:generateNarrative', event, {
        gameId,
        saveId,
        gameType: GameType.MANAGEMENT,
        userAction: '查看资源',
        organizeMode: 'async',
        tableSchema: makeTableSchema(),
      });

      expect(result.success).toBe(true);

      // 等待后台 generateNarrative 完成（多次 flush 让 microtask 队列走完）
      for (let i = 0; i < 30; i++) {
        await flushMicrotasks();
      }

      // 验证 chunk 事件
      const chunkEvents = sentEvents.filter((e) => e.channel === 'game:narrative:chunk');
      expect(chunkEvents.length).toBe(3);
      expect(chunkEvents[0].args[0]).toEqual({
        saveId,
        chunk: '第一段',
        index: 0,
      });
      expect(chunkEvents[1].args[0]).toEqual({
        saveId,
        chunk: '第二段',
        index: 1,
      });
      expect(chunkEvents[2].args[0]).toEqual({
        saveId,
        chunk: '第三段',
        index: 2,
      });

      // 验证 complete 事件
      const completeEvents = sentEvents.filter((e) => e.channel === 'game:narrative:complete');
      expect(completeEvents.length).toBe(1);
      const completePayload = completeEvents[0].args[0];
      expect(completePayload.saveId).toBe(saveId);
      expect(completePayload.fullText).toBe('第一段第二段第三段');
      expect(completePayload.model).toBe('test-model');
      expect(completePayload.generationTime).toBeGreaterThan(0);
      expect(completePayload.tableChanges).toBeDefined();
      expect(completePayload.tableEdits).toEqual([]);

      // 验证错误事件未推送
      const errorEvents = sentEvents.filter((e) => e.channel === 'game:narrative:error');
      expect(errorEvents.length).toBe(0);
    });

    it('generateNarrative 完成（无 tableEdit）后不应推送 game:table:updated 事件', async () => {
      const { saveId, gameId } = await prepareSaveForNarrative();
      mockStreamChunksRef.value = ['一段叙事文本'];
      mockStreamFullTextRef.value = '一段叙事文本';

      const { event, sentEvents } = makeMockEvent();

      await invokeHandler('game:generateNarrative', event, {
        gameId,
        saveId,
        gameType: GameType.MANAGEMENT,
        userAction: '观察',
        organizeMode: 'async',
        tableSchema: makeTableSchema(),
      });

      // 等待后台完成
      for (let i = 0; i < 30; i++) {
        await flushMicrotasks();
      }

      const tableUpdatedEvents = sentEvents.filter((e) => e.channel === 'game:table:updated');
      // 没有任何 tableEdit，所以不应推送 table:updated
      expect(tableUpdatedEvents.length).toBe(0);
    });

    it('generateNarrative 含 tableEdit 时应推送 game:table:updated 事件', async () => {
      const { saveId, gameId } = await prepareSaveForNarrative();
      // 配置 mock 输出含 tableEdit 标签（使用函数式协议格式，对齐 GameTableEditParser）
      const tableEditXml =
        '<!-- <tableEdit>\ninsertRow(1, {"1":"res-1","3":"金币","4":"100"})\n</tableEdit> -->';
      mockStreamChunksRef.value = ['叙事文本', tableEditXml];
      mockStreamFullTextRef.value = '叙事文本' + tableEditXml;

      const { event, sentEvents } = makeMockEvent();

      await invokeHandler('game:generateNarrative', event, {
        gameId,
        saveId,
        gameType: GameType.MANAGEMENT,
        userAction: '添加资源',
        organizeMode: 'async',
        tableSchema: makeTableSchema(),
      });

      // 等待后台完成（多给一些时间）
      for (let i = 0; i < 30; i++) {
        await flushMicrotasks();
      }

      const completeEvents = sentEvents.filter((e) => e.channel === 'game:narrative:complete');
      expect(completeEvents.length).toBe(1);

      const tableUpdatedEvents = sentEvents.filter((e) => e.channel === 'game:table:updated');
      // 应推送 table:updated 事件
      expect(tableUpdatedEvents.length).toBe(1);
      expect(tableUpdatedEvents[0].args[0].saveId).toBe(saveId);
      expect(tableUpdatedEvents[0].args[0].changes.commandsExecuted).toBeGreaterThanOrEqual(1);
    });

    it('generateNarrative 完成后应将玩家行动与 AI 回复持久化到 narrativeLog', async () => {
      const { saveId, gameId } = await prepareSaveForNarrative();
      mockStreamChunksRef.value = ['AI 叙事文本'];
      mockStreamFullTextRef.value = 'AI 叙事文本';

      const { event } = makeMockEvent();

      await invokeHandler('game:generateNarrative', event, {
        gameId,
        saveId,
        gameType: GameType.MANAGEMENT,
        userAction: '查看周边',
        organizeMode: 'async',
        tableSchema: makeTableSchema(),
      });

      // 等待后台完成
      for (let i = 0; i < 30; i++) {
        await flushMicrotasks();
      }

      // 验证 narrativeLog 已持久化（通过 game:loadSave 读回）
      const loadResult = await invokeHandler('game:loadSave', event, saveId);
      expect(loadResult.data.narrativeLog).toHaveLength(2);
      expect(loadResult.data.narrativeLog[0].role).toBe('user');
      expect(loadResult.data.narrativeLog[0].content).toBe('查看周边');
      expect(loadResult.data.narrativeLog[1].role).toBe('assistant');
      expect(loadResult.data.narrativeLog[1].content).toBe('AI 叙事文本');
    });

    it('cancelGeneration 应取消活跃请求并推送 error 事件（code=aborted）', async () => {
      const { saveId, gameId } = await prepareSaveForNarrative();
      // 配置较多 chunk 让请求有足够时间被取消
      mockStreamChunksRef.value = ['chunk-1', 'chunk-2', 'chunk-3', 'chunk-4', 'chunk-5'];
      mockStreamFullTextRef.value = '完整文本';

      const { event, sentEvents } = makeMockEvent();

      // 发起生成
      await invokeHandler('game:generateNarrative', event, {
        gameId,
        saveId,
        gameType: GameType.MANAGEMENT,
        userAction: '长时间行动',
        organizeMode: 'async',
        tableSchema: makeTableSchema(),
      });

      // 立即取消（不等后台完成）
      const cancelResult = await invokeHandler('game:cancelGeneration', event, saveId);
      expect(cancelResult.success).toBe(true);
      expect(cancelResult.cancelled).toBe(true);

      // 等待后台 generateNarrative 处理 abort 信号
      for (let i = 0; i < 30; i++) {
        await flushMicrotasks();
      }

      // 应推送 error 事件（code 包含 aborted）
      const errorEvents = sentEvents.filter((e) => e.channel === 'game:narrative:error');
      expect(errorEvents.length).toBe(1);
      expect(errorEvents[0].args[0].saveId).toBe(saveId);
      expect(errorEvents[0].args[0].code).toBe('aborted');
    });

    it('cancelGeneration 在无活跃请求时应返回 cancelled: false', async () => {
      const { event } = makeMockEvent();
      const result = await invokeHandler('game:cancelGeneration', event, 'nonexistent-save-id');
      expect(result.success).toBe(true);
      expect(result.cancelled).toBe(false);
    });

    it('abortAllActiveGameRequests 应取消所有活跃请求', async () => {
      // 简单验证函数可调用且不抛错
      expect(() => abortAllActiveGameRequests()).not.toThrow();
    });
  });

  // ==================== SubTask 5.6: 聚合入口 ====================

  describe('SubTask 5.6: 聚合入口 registerGameHandlers', () => {
    it('应注册所有 game:* handler 频道', () => {
      const expectedChannels = [
        // meta
        'game:list',
        'game:getMeta',
        'game:createGame',
        'game:updateGame',
        'game:deleteGame',
        // save
        'game:createSave',
        'game:loadSave',
        'game:listSaves',
        'game:deleteSave',
        'game:save',
        // table
        'game:getTableData',
        'game:saveTableData',
        'game:applyTableEdits',
        'game:getVersionSnapshot',
        'game:confirmVersion',
        'game:rollbackVersion',
        // narrative
        'game:generateNarrative',
        'game:cancelGeneration',
        // config
        'game:getConfig',
        'game:saveConfig',
      ];

      for (const channel of expectedChannels) {
        expect(ipcHandlers.has(channel)).toBe(true);
      }
    });
  });
});
