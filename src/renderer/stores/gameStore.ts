/**
 * 游戏模式渲染进程 store（SubTask 6.1）
 *
 * 职责：
 * - 管理游戏列表、当前游戏 ID、当前存档 ID、剧情日志、表格数据快照、生成状态
 * - 提供 loadGames / selectGame / startNewGame / loadSave / saveGame / appendNarrativeChunk
 *   / applyTableEdits / generateNarrative / cancelGeneration 等 action
 * - 在模块加载时订阅 `window.electronAPI.game` 的 4 个事件
 *   （onNarrativeChunk / onNarrativeComplete / onNarrativeError / onTableUpdated），
 *   将事件推送到 store action。store 是单例，仅订阅一次。
 *
 * 设计要点：
 * - 事件订阅在 module load 顶层执行，检查 `typeof window !== 'undefined' && window.electronAPI?.game`
 *   后才订阅，避免在测试环境（无 window）下报错
 * - 流式 chunk 通过 `currentStreamingMessageId` 追踪当前流式目标消息：
 *   generateNarrative 重置为 null，首个 chunk 创建新 assistant 消息并记录其 id，
 *   后续 chunk 追加到该消息的 content
 * - 所有事件回调按 saveId 过滤，避免多存档并发时的事件串扰
 * - 生成完成（onNarrativeComplete）后用 fullText 覆盖流式累积的文本（authoritative）并触发自动保存
 *
 * 参考：src/renderer/stores/writingProjectStore.ts（zustand 模式）
 */

import { create } from 'zustand';
import type {
  GameIndexEntry,
  GameMeta,
  GameNarrativeMessage,
  GameNarrativeChunk,
  GameNarrativeComplete,
  GameNarrativeError,
  GameNarrativeRequest,
  GameTableData,
  GameTableSchema,
  GameTableEditCommand,
  GameTableUpdated,
  GameSaveData
} from '../../shared/types/game.types';
import { DEFAULT_GAME_TABLE_SCHEMA } from '../../shared/constants/game.constants';
import { GameTemplateRegistry } from '../components/Game/templates/GameTemplateRegistry';

// ==================== State 接口 ====================

export interface GameStoreState {
  // ----- 状态 -----
  /** 游戏列表（来自 games-index.json） */
  games: GameIndexEntry[];
  /** 当前选中的游戏 ID */
  currentGameId: string | null;
  /** 当前存档 ID */
  currentSaveId: string | null;
  /** 当前游戏元数据（缓存） */
  currentGame: GameMeta | null;
  /** 当前存档完整数据（meta + narrativeLog + stateSnapshot） */
  currentSave: GameSaveData | null;
  /** 剧情日志（与 currentSave.narrativeLog 同步，便于组件直接订阅） */
  narrativeLog: GameNarrativeMessage[];
  /** 表格数据快照 */
  tableData: GameTableData | null;
  /** AI 叙事生成中 */
  isGenerating: boolean;
  /** 加载游戏列表中 */
  isLoadingGames: boolean;
  /** 加载存档中 */
  isLoadingSave: boolean;
  /** 错误信息（如有） */
  error: string | null;
  /** 当前流式目标消息 ID（内部追踪字段） */
  currentStreamingMessageId: string | null;

  // ----- Actions -----
  loadGames: () => Promise<void>;
  selectGame: (gameId: string) => Promise<void>;
  startNewGame: (gameId: string) => Promise<void>;
  loadSave: (saveId: string) => Promise<void>;
  saveGame: () => Promise<void>;
  appendNarrativeChunk: (chunk: GameNarrativeChunk) => void;
  applyTableEdits: (commands: GameTableEditCommand[]) => Promise<void>;
  generateNarrative: (request: Partial<GameNarrativeRequest>) => Promise<void>;
  cancelGeneration: () => Promise<void>;
  setTableData: (tableData: GameTableData | null) => void;
  clearError: () => void;

  // ----- 事件处理（由模块顶层订阅器调用） -----
  _handleNarrativeComplete: (data: GameNarrativeComplete) => void;
  _handleNarrativeError: (data: GameNarrativeError) => void;
  _handleTableUpdated: (data: GameTableUpdated) => void;

  // ----- Getters -----
  getCurrentGame: () => GameMeta | null;
  getCurrentSave: () => GameSaveData | null;
}

// ==================== 工具函数 ====================

/**
 * 生成消息 ID
 *
 * 不引入 uuid 依赖，使用时间戳 + 随机字符串足够。
 */
function generateMessageId(): string {
  return `msg_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}

/**
 * 提取错误消息（容错）
 */
function getErrorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (typeof err === 'string') return err;
  try {
    return JSON.stringify(err);
  } catch {
    return String(err);
  }
}

/**
 * 安全访问 window.electronAPI.game
 *
 * 在测试环境或主进程上下文中 window 可能不存在，需做防护。
 */
function getGameAPI() {
  if (typeof window === 'undefined') return null;
  return window.electronAPI?.game ?? null;
}

// ==================== 初始状态 ====================

const INITIAL_STATE: Omit<
  GameStoreState,
  | 'loadGames'
  | 'selectGame'
  | 'startNewGame'
  | 'loadSave'
  | 'saveGame'
  | 'appendNarrativeChunk'
  | 'applyTableEdits'
  | 'generateNarrative'
  | 'cancelGeneration'
  | 'setTableData'
  | 'clearError'
  | '_handleNarrativeComplete'
  | '_handleNarrativeError'
  | '_handleTableUpdated'
  | 'getCurrentGame'
  | 'getCurrentSave'
> = {
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

// ==================== Store 实现 ====================

export const useGameStore = create<GameStoreState>((set, get) => ({
  ...INITIAL_STATE,

  // ---------------- loadGames ----------------
  loadGames: async () => {
    const api = getGameAPI();
    if (!api) {
      set({ games: [], isLoadingGames: false });
      return;
    }
    set({ isLoadingGames: true, error: null });
    try {
      // IPC 返回 { success, games }（与 writing 模式一致），需解构 games 数组
      const result = await api.list();
      const games = result?.success ? (result.games ?? []) : [];
      set({ games, isLoadingGames: false });
    } catch (err) {
      console.error('[gameStore] loadGames failed:', err);
      set({
        games: [],
        isLoadingGames: false,
        error: `加载游戏列表失败：${getErrorMessage(err)}`
      });
    }
  },

  // ---------------- selectGame ----------------
  selectGame: async (gameId) => {
    const api = getGameAPI();
    set({ currentGameId: gameId, isLoadingSave: true, error: null });
    if (!api) {
      set({ currentGame: null, isLoadingSave: false });
      return;
    }
    try {
      // IPC 返回 { success, meta }，需解构 meta
      const result = await api.getMeta(gameId);
      const meta = result?.success ? result.meta : null;
      set({ currentGame: meta, isLoadingSave: false });
    } catch (err) {
      console.error('[gameStore] selectGame failed:', err);
      set({
        currentGame: null,
        isLoadingSave: false,
        error: `加载游戏元数据失败：${getErrorMessage(err)}`
      });
    }
  },

  // ---------------- startNewGame ----------------
  startNewGame: async (gameId) => {
    const api = getGameAPI();
    if (!api) {
      set({ error: '游戏服务不可用' });
      return;
    }
    set({ error: null });
    try {
      // 从 currentGame 获取 gameType，再从 GameTemplateRegistry 获取 tableSchema / initialState
      const currentGame = get().currentGame;
      const gameType = currentGame?.id === gameId ? currentGame.type : null;
      let tableSchema: GameTableSchema = DEFAULT_GAME_TABLE_SCHEMA;
      let initialState: Record<string, any> | undefined;
      if (gameType) {
        const template = GameTemplateRegistry.get(gameType);
        if (template) {
          if (template.tableSchema) {
            tableSchema = template.tableSchema;
          }
          if (typeof template.getInitialState === 'function') {
            initialState = template.getInitialState();
          }
        }
      }
      const result = await api.createSave({
        gameId,
        gameType: gameType ?? ('UNKNOWN' as any),
        name: `新游戏_${Date.now()}`,
        isAuto: false,
        tableSchema,
        initialState
      });
      if (!result?.success || !result.meta) {
        set({ error: '创建新游戏失败' });
        return;
      }
      // GameSaveMeta.id 即为 saveId
      await get().loadSave(result.meta.id);
    } catch (err) {
      console.error('[gameStore] startNewGame failed:', err);
      set({ error: `创建新游戏失败：${getErrorMessage(err)}` });
    }
  },

  // ---------------- loadSave ----------------
  loadSave: async (saveId) => {
    const api = getGameAPI();
    set({
      currentSaveId: saveId,
      isLoadingSave: true,
      error: null,
      currentStreamingMessageId: null
    });
    if (!api) {
      set({
        narrativeLog: [],
        tableData: null,
        currentSave: null,
        isLoadingSave: false
      });
      return;
    }
    try {
      // IPC 返回 { success, data }，需解构 data
      const result = await api.loadSave(saveId);
      const saveData = result?.success ? result.data : null;
      if (!saveData) {
        set({
          narrativeLog: [],
          tableData: null,
          currentSave: null,
          isLoadingSave: false,
          error: '存档不存在或已损坏'
        });
        return;
      }
      // 同步加载表格数据；失败时退化为 null（不阻塞读档）
      let tableData: GameTableData | null = null;
      try {
        // IPC 返回 { success, data }，需解构 data（data 可能为 undefined，需兜底）
        const tableResult = await api.getTableData(saveId);
        tableData = tableResult?.success ? (tableResult.data ?? null) : null;
      } catch (err) {
        console.warn('[gameStore] getTableData failed, defaulting to null:', err);
      }
      set({
        currentSave: saveData,
        narrativeLog: saveData.narrativeLog ?? [],
        tableData,
        isLoadingSave: false
      });
    } catch (err) {
      console.error('[gameStore] loadSave failed:', err);
      set({
        narrativeLog: [],
        tableData: null,
        currentSave: null,
        isLoadingSave: false,
        error: `加载存档失败：${getErrorMessage(err)}`
      });
    }
  },

  // ---------------- saveGame ----------------
  saveGame: async () => {
    const { currentSave, currentSaveId, narrativeLog } = get();
    if (!currentSave || !currentSaveId) {
      console.warn('[gameStore] saveGame: no current save, skip');
      return;
    }
    const api = getGameAPI();
    if (!api) {
      return;
    }
    try {
      // IPC save 签名为 (saveId, updates)，仅传需要更新的字段
      const updates: Parameters<typeof api.save>[1] = {
        narrativeLog,
        currentTurn: currentSave.meta.currentTurn ?? null,
        currentNodeId: currentSave.meta.currentNodeId ?? null,
        nodeTitle: currentSave.meta.nodeTitle ?? null,
        turnCount: currentSave.meta.turnCount ?? 0
      };
      await api.save(currentSaveId, updates);
      const updatedSave: GameSaveData = {
        ...currentSave,
        narrativeLog,
        meta: {
          ...currentSave.meta,
          updatedAt: Date.now(),
          messageCount: narrativeLog.length
        }
      };
      set({ currentSave: updatedSave });
    } catch (err) {
      console.error('[gameStore] saveGame failed:', err);
      set({ error: `保存游戏失败：${getErrorMessage(err)}` });
    }
  },

  // ---------------- appendNarrativeChunk ----------------
  appendNarrativeChunk: (chunk) => {
    const { currentSaveId, currentStreamingMessageId, narrativeLog } = get();
    // 按 saveId 过滤，避免多存档并发时事件串扰
    if (chunk.saveId !== currentSaveId) {
      return;
    }
    const chunkText = chunk.chunk ?? '';
    if (chunkText.length === 0) {
      return;
    }

    // 已有流式目标消息 → 追加到该消息
    if (currentStreamingMessageId) {
      const idx = narrativeLog.findIndex((m) => m.id === currentStreamingMessageId);
      if (idx >= 0) {
        const updatedLog = [...narrativeLog];
        updatedLog[idx] = {
          ...updatedLog[idx],
          content: updatedLog[idx].content + chunkText
        };
        set({ narrativeLog: updatedLog });
        return;
      }
    }

    // 否则创建新的 assistant 消息并记录其 id
    const newMessage: GameNarrativeMessage = {
      id: generateMessageId(),
      role: 'assistant',
      content: chunkText,
      timestamp: Date.now()
    };
    set({
      narrativeLog: [...narrativeLog, newMessage],
      currentStreamingMessageId: newMessage.id
    });
  },

  // ---------------- applyTableEdits ----------------
  applyTableEdits: async (commands) => {
    const { currentSaveId } = get();
    if (!currentSaveId) {
      set({ error: '无当前存档，无法应用表格编辑' });
      return;
    }
    const api = getGameAPI();
    if (!api) {
      return;
    }
    try {
      const result = await api.applyTableEdits(currentSaveId, commands);
      if (!result.success) {
        const errs = result.changes.errors?.join('; ') ?? 'unknown';
        set({ error: `表格编辑失败：${errs}` });
      }
      // 刷新本地表格数据快照
      try {
        // IPC 返回 { success, data }，需解构 data（data 可能为 undefined，需兜底）
        const tableResult = await api.getTableData(currentSaveId);
        const tableData = tableResult?.success ? (tableResult.data ?? null) : null;
        set({ tableData });
      } catch (err) {
        console.warn('[gameStore] applyTableEdits: refresh getTableData failed:', err);
      }
    } catch (err) {
      console.error('[gameStore] applyTableEdits failed:', err);
      set({ error: `应用表格编辑失败：${getErrorMessage(err)}` });
    }
  },

  // ---------------- generateNarrative ----------------
  generateNarrative: async (request) => {
    const { currentSaveId, currentGameId, currentGame } = get();
    if (!currentSaveId || !currentGameId || !currentGame) {
      set({ error: '未选择游戏或存档，无法生成叙事' });
      return;
    }
    const api = getGameAPI();
    if (!api) {
      set({ error: '游戏服务不可用' });
      return;
    }

    // 用 store 中的当前 game/save 信息填充必填字段，request 中提供的字段优先
    const {
      userAction = '',
      modelConfig,
      organizeMode,
      templateSystemPrompt,
      tableSchema
    } = request;
    const fullRequest: GameNarrativeRequest = {
      gameId: currentGameId,
      saveId: currentSaveId,
      gameType: currentGame.type,
      userAction,
      modelConfig,
      organizeMode,
      templateSystemPrompt,
      tableSchema
    };

    // 重置流式追踪状态，并标记生成中
    set({ isGenerating: true, error: null, currentStreamingMessageId: null });

    // Fire-and-forget：不 await，完成通过 onNarrativeComplete 事件回调
    api.generateNarrative(fullRequest).catch((err: unknown) => {
      console.error('[gameStore] generateNarrative IPC error:', err);
      set({
        isGenerating: false,
        currentStreamingMessageId: null,
        error: `生成叙事失败：${getErrorMessage(err)}`
      });
    });
  },

  // ---------------- cancelGeneration ----------------
  cancelGeneration: async () => {
    const { currentSaveId } = get();
    if (!currentSaveId) {
      set({ isGenerating: false, currentStreamingMessageId: null });
      return;
    }
    const api = getGameAPI();
    try {
      if (api) {
        await api.cancelGeneration(currentSaveId);
      }
    } catch (err) {
      console.error('[gameStore] cancelGeneration failed:', err);
    } finally {
      set({ isGenerating: false, currentStreamingMessageId: null });
    }
  },

  // ---------------- setTableData ----------------
  setTableData: (tableData) => set({ tableData }),

  // ---------------- clearError ----------------
  clearError: () => set({ error: null }),

  // ---------------- _handleNarrativeComplete ----------------
  _handleNarrativeComplete: (data) => {
    const { currentSaveId, currentStreamingMessageId, narrativeLog } = get();
    if (data.saveId !== currentSaveId) {
      return;
    }

    // 若流式过程中已累积消息，用 fullText 覆盖（authoritative）
    if (currentStreamingMessageId) {
      const idx = narrativeLog.findIndex((m) => m.id === currentStreamingMessageId);
      if (idx >= 0) {
        const updatedLog = [...narrativeLog];
        updatedLog[idx] = {
          ...updatedLog[idx],
          content: data.fullText
        };
        set({
          narrativeLog: updatedLog,
          isGenerating: false,
          currentStreamingMessageId: null
        });
        // 触发自动保存
        void get().saveGame();
        return;
      }
    }

    // 否则直接 push 一条完整的 assistant 消息
    const newMessage: GameNarrativeMessage = {
      id: generateMessageId(),
      role: 'assistant',
      content: data.fullText,
      timestamp: Date.now()
    };
    set({
      narrativeLog: [...narrativeLog, newMessage],
      isGenerating: false,
      currentStreamingMessageId: null
    });
    void get().saveGame();
  },

  // ---------------- _handleNarrativeError ----------------
  _handleNarrativeError: (data) => {
    const { currentSaveId } = get();
    if (data.saveId !== currentSaveId) {
      return;
    }
    set({
      isGenerating: false,
      currentStreamingMessageId: null,
      error: `AI 叙事生成失败：${data.error}`
    });
  },

  // ---------------- _handleTableUpdated ----------------
  _handleTableUpdated: (data) => {
    const { currentSaveId } = get();
    if (!currentSaveId || data.saveId !== currentSaveId) {
      return;
    }
    const api = getGameAPI();
    if (!api) {
      return;
    }
    // 拉取最新表格数据（IPC 返回 { success, data }，需解构 data）
    api
      .getTableData(currentSaveId)
      .then((result) => {
        const tableData = result?.success ? (result.data ?? null) : null;
        set({ tableData });
      })
      .catch((err) => {
        console.error('[gameStore] _handleTableUpdated: refresh failed:', err);
      });
  },

  // ---------------- Getters ----------------
  getCurrentGame: () => get().currentGame,
  getCurrentSave: () => get().currentSave
}));

// ==================== 模块加载时订阅 IPC 事件 ====================
//
// store 是单例，仅订阅一次。在测试环境（无 window.electronAPI）下安全跳过。
// 订阅通过 `useGameStore.getState()` 获取最新 action 引用，避免闭包陈旧。
//
// 注意：on* 监听器返回 unsubscribe 函数，此处不保存返回值——模块卸载时不取消订阅
// （进程级单例，与渲染进程同生命周期）。

function setupGameEventListeners(): void {
  if (typeof window === 'undefined' || !window.electronAPI?.game) {
    return;
  }
  const game = window.electronAPI.game;

  game.onNarrativeChunk((chunk: GameNarrativeChunk) => {
    useGameStore.getState().appendNarrativeChunk(chunk);
  });

  game.onNarrativeComplete((data: GameNarrativeComplete) => {
    useGameStore.getState()._handleNarrativeComplete(data);
  });

  game.onNarrativeError((data: GameNarrativeError) => {
    useGameStore.getState()._handleNarrativeError(data);
  });

  game.onTableUpdated((data: GameTableUpdated) => {
    useGameStore.getState()._handleTableUpdated(data);
  });
}

setupGameEventListeners();
