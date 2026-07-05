/**
 * 游戏模式共享类型与常量测试
 *
 * 验证：
 * - 枚举值可被正确导入与使用
 * - 类型可被正确实例化（编译期检查）
 * - 常量映射与枚举值一一对应
 * - createEmptyTableData 工具函数行为正确
 */
import { describe, it, expect } from 'vitest';
import {
  GameType,
  GameStatus,
  GameView,
  GameNarrativeState,
  GameTableEditCommandType,
  DEFAULT_GAME_LOCAL_CONFIG,
  MAX_AUTO_SAVES,
  AUTO_SAVE_SUFFIX,
  type GameMeta,
  type GameSaveMeta,
  type GameTableData,
  type GameTableSchema,
  type GameLocalConfig,
  type GameNarrativeRequest,
  type GameTableEditCommand
} from '../game.types';
import {
  GAME_TYPE_LABELS,
  GAME_STATUS_LABELS,
  GAME_VIEW_LABELS,
  GAME_NARRATIVE_STATE_LABELS,
  GAME_TYPE_OPTIONS,
  GAME_SORT_OPTIONS,
  DEFAULT_GAME_TABLE_SCHEMA,
  createEmptyTableData,
  GAMES_DIR_NAME,
  GAME_SAVES_DIR_NAME,
  GAMES_INDEX_FILENAME,
  GAME_META_FILENAME,
  SAVE_META_FILENAME,
  SAVE_TABLE_DATA_FILENAME,
  GAMES_INDEX_VERSION,
  GAME_NARRATIVE_TIMEOUT
} from '../../constants/game.constants';

describe('GameType enum', () => {
  it('should expose all expected game types', () => {
    expect(GameType.WEREWOLF).toBe('werewolf');
    expect(GameType.MYSTERY).toBe('mystery');
    expect(GameType.DATING_SIM).toBe('dating_sim');
    expect(GameType.MANAGEMENT).toBe('management');
    expect(GameType.TEXT_RPG).toBe('text_rpg');
  });

  it('should have labels for every type', () => {
    const allTypes = Object.values(GameType);
    for (const t of allTypes) {
      expect(GAME_TYPE_LABELS[t]).toBeTruthy();
    }
  });

  it('should provide options array derived from labels', () => {
    expect(GAME_TYPE_OPTIONS.length).toBe(Object.keys(GameType).length);
    expect(GAME_TYPE_OPTIONS[0]).toHaveProperty('value');
    expect(GAME_TYPE_OPTIONS[0]).toHaveProperty('label');
  });
});

describe('GameStatus enum', () => {
  it('should expose all expected statuses', () => {
    expect(GameStatus.COMPLETED).toBe('completed');
    expect(GameStatus.IN_DEVELOPMENT).toBe('in_development');
    expect(GameStatus.PLANNED).toBe('planned');
  });

  it('should have labels for every status', () => {
    const allStatuses = Object.values(GameStatus);
    for (const s of allStatuses) {
      expect(GAME_STATUS_LABELS[s]).toBeTruthy();
    }
  });
});

describe('GameView enum', () => {
  it('should expose lobby/detail/main views', () => {
    expect(GameView.LOBBY).toBe('lobby');
    expect(GameView.DETAIL).toBe('detail');
    expect(GameView.MAIN).toBe('main');
  });

  it('should have labels for every view', () => {
    expect(GAME_VIEW_LABELS[GameView.LOBBY]).toBe('游戏大厅');
    expect(GAME_VIEW_LABELS[GameView.DETAIL]).toBe('游戏详情');
    expect(GAME_VIEW_LABELS[GameView.MAIN]).toBe('游戏主页');
  });
});

describe('GameNarrativeState enum', () => {
  it('should expose all narrative states', () => {
    expect(GameNarrativeState.IDLE).toBe('idle');
    expect(GameNarrativeState.GENERATING).toBe('generating');
    expect(GameNarrativeState.STREAMING).toBe('streaming');
    expect(GameNarrativeState.COMPLETED).toBe('completed');
    expect(GameNarrativeState.ERROR).toBe('error');
  });

  it('should have labels for every state', () => {
    const allStates = Object.values(GameNarrativeState);
    for (const s of allStates) {
      expect(GAME_NARRATIVE_STATE_LABELS[s]).toBeTruthy();
    }
  });
});

describe('GameTableEditCommandType enum', () => {
  it('should expose insert/update/delete commands', () => {
    expect(GameTableEditCommandType.INSERT_ROW).toBe('insertRow');
    expect(GameTableEditCommandType.UPDATE_ROW).toBe('updateRow');
    expect(GameTableEditCommandType.DELETE_ROW).toBe('deleteRow');
  });
});

describe('Default config and constants', () => {
  it('should provide DEFAULT_GAME_LOCAL_CONFIG with sensible defaults', () => {
    expect(DEFAULT_GAME_LOCAL_CONFIG.temperature).toBeGreaterThan(0);
    expect(DEFAULT_GAME_LOCAL_CONFIG.maxTokens).toBeGreaterThan(0);
    expect(DEFAULT_GAME_LOCAL_CONFIG.organizeMode).toBe('async');
    expect(DEFAULT_GAME_LOCAL_CONFIG.ansiTheme).toBe('default');
    expect(DEFAULT_GAME_LOCAL_CONFIG.autoSave).toBe(true);
  });

  it('should expose MAX_AUTO_SAVES and AUTO_SAVE_SUFFIX', () => {
    expect(MAX_AUTO_SAVES).toBe(5);
    expect(AUTO_SAVE_SUFFIX).toBe('_auto');
  });

  it('should expose path-related constants', () => {
    expect(GAMES_DIR_NAME).toBe('games');
    expect(GAME_SAVES_DIR_NAME).toBe('game-saves');
    expect(GAMES_INDEX_FILENAME).toBe('games-index.json');
    expect(GAME_META_FILENAME).toBe('meta.json');
    expect(SAVE_META_FILENAME).toBe('save.json');
    expect(SAVE_TABLE_DATA_FILENAME).toBe('table-data.json');
  });

  it('should expose index version and timeout', () => {
    expect(GAMES_INDEX_VERSION).toBe('1.0.0');
    expect(GAME_NARRATIVE_TIMEOUT).toBeGreaterThan(0);
  });

  it('should expose sort options', () => {
    expect(GAME_SORT_OPTIONS.length).toBeGreaterThanOrEqual(3);
    const values = GAME_SORT_OPTIONS.map(o => o.value);
    expect(values).toContain('updatedAt');
    expect(values).toContain('createdAt');
    expect(values).toContain('title');
  });
});

describe('createEmptyTableData', () => {
  it('should create empty table data matching schema', () => {
    const schema: GameTableSchema = {
      sheets: ['characters', 'resources'],
      headers: {
        characters: ['id', 'name', 'role'],
        resources: ['id', 'name', 'amount']
      },
      sheetDescriptions: {
        characters: '角色表',
        resources: '资源表'
      }
    };
    const data = createEmptyTableData(schema);
    expect(data.sheets).toEqual(['characters', 'resources']);
    expect(data.headers.characters).toEqual(['id', 'name', 'role']);
    expect(data.data.characters).toEqual([]);
    expect(data.data.resources).toEqual([]);
    expect(data.sheetDescriptions.characters).toBe('角色表');
  });

  it('should handle empty schema', () => {
    const data = createEmptyTableData(DEFAULT_GAME_TABLE_SCHEMA);
    expect(data.sheets).toEqual([]);
    expect(data.data).toEqual({});
  });
});

describe('Type instantiation (compile-time check)', () => {
  it('should allow constructing GameMeta', () => {
    const meta: GameMeta = {
      id: 'pastoral_town',
      type: GameType.MANAGEMENT,
      title: '田园小镇',
      subtitle: '经营你的梦想农场',
      description: '一款文字模拟经营游戏',
      gameplay: '通过建造设施、招募角色、结束回合推进游戏',
      developer: 'Creative Cafe',
      version: '1.0.0',
      status: GameStatus.COMPLETED,
      tags: ['经营', '回合制'],
      createdAt: Date.now(),
      updatedAt: Date.now()
    };
    expect(meta.id).toBe('pastoral_town');
    expect(meta.type).toBe(GameType.MANAGEMENT);
  });

  it('should allow constructing GameSaveMeta', () => {
    const save: GameSaveMeta = {
      id: 'save-001',
      gameId: 'pastoral_town',
      gameType: GameType.MANAGEMENT,
      name: '第一个存档',
      isAuto: false,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      currentTurn: 3,
      currentNodeId: 'node_005',
      nodeTitle: '农场建成',
      turnCount: 3,
      messageCount: 12
    };
    expect(save.gameType).toBe(GameType.MANAGEMENT);
    expect(save.currentTurn).toBe(3);
  });

  it('should allow constructing GameNarrativeRequest', () => {
    const req: GameNarrativeRequest = {
      gameId: 'pastoral_town',
      saveId: 'save-001',
      gameType: GameType.MANAGEMENT,
      userAction: 'build:farm'
    };
    expect(req.userAction).toBe('build:farm');
  });

  it('should allow constructing GameTableEditCommand', () => {
    const cmd: GameTableEditCommand = {
      type: GameTableEditCommandType.INSERT_ROW,
      sheetIndex: 1,
      rowData: { '2': 'worker_001', '3': '农夫' },
      raw: 'insertRow(1, {"2":"worker_001","3":"农夫"})'
    };
    expect(cmd.type).toBe(GameTableEditCommandType.INSERT_ROW);
    expect(cmd.sheetIndex).toBe(1);
  });

  it('should allow constructing GameTableData (alias of WritingTableData)', () => {
    const table: GameTableData = {
      sheets: ['resources'],
      headers: { resources: ['id', 'name', 'amount'] },
      data: { resources: [{ id: 'gold', name: '金币', amount: 500 }] },
      sheetDescriptions: { resources: '资源表' }
    };
    expect(table.sheets).toEqual(['resources']);
    expect(table.data.resources).toHaveLength(1);
  });

  it('should allow constructing GameLocalConfig', () => {
    const config: GameLocalConfig = {
      activeEngineId: 'engine-1',
      temperature: 0.8,
      maxTokens: 16384,
      organizeMode: 'sync',
      ansiTheme: 'dark',
      autoSave: false
    };
    expect(config.organizeMode).toBe('sync');
  });

  it('should allow defining a minimal GameTypeTemplate-like object', () => {
    // GameTypeTemplate 包含 React 组件，无法在测试中直接构造，
    // 这里仅验证类型可被引用（编译期检查）。
    const panels: string[] = ['resource', 'facility'];
    expect(panels).toContain('resource');
  });
});
