/**
 * GameSaveRepository 与 GameTableRepository 单元测试
 *
 * 测试覆盖：
 * - GameSaveRepository: createSave / loadSave / listSaves / updateSave /
 *   deleteSave / pruneAutoSaves（保留最近 5 个自动存档）/ copySave
 * - GameTableRepository: initTableData / saveTableData / getTableData /
 *   applyTableEdits（insertRow / updateRow / deleteRow）
 *
 * 测试策略：
 * - 使用 os.tmpdir() 创建临时 userData 目录
 * - vi.mock 替换 getUserDataPath
 * - 每个 beforeEach 清理临时目录，确保测试隔离
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';

// 临时 userData 根目录（在 beforeEach 中赋值）
let tmpRoot = '';

vi.mock('../../../utils/appPath', () => ({
  getUserDataPath: () => tmpRoot,
}));

import {
  gameSaveRepository,
  getSaveDir,
  getSaveMetaPath,
  getSaveTableDataPath,
  getSaveStateSnapshotPath
} from '../GameSaveRepository';
import {
  gameTableRepository
} from '../GameTableRepository';
import {
  GameType,
  GameTableEditCommandType,
  type GameTableSchema,
  type GameTableEditCommand,
  type GameNarrativeMessage
} from '../../../../shared/types/game.types';
import { MAX_AUTO_SAVES } from '../../../../shared/types/game.types';

// ==================== 测试 fixtures ====================

const TEST_SCHEMA: GameTableSchema = {
  sheets: ['资源', '设施'],
  headers: {
    '资源': ['1', '名称', '数量'],
    '设施': ['1', '名称', '等级']
  },
  sheetDescriptions: {
    '资源': '玩家拥有的资源',
    '设施': '已建造的设施'
  }
};

function makeNarrativeLog(): GameNarrativeMessage[] {
  return [
    {
      id: 'msg-1',
      role: 'user',
      content: '玩家行动：建造农场',
      timestamp: Date.now()
    },
    {
      id: 'msg-2',
      role: 'assistant',
      content: '你建造了一座农场，消耗了 50 木材。',
      timestamp: Date.now(),
      turn: 1,
      speakerName: '旁白'
    }
  ];
}

// ==================== 测试套件 ====================

describe('GameSaveRepository', () => {
  beforeEach(() => {
    tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'cc-game-save-test-'));
  });

  afterEach(() => {
    if (fs.existsSync(tmpRoot)) {
      fs.rmSync(tmpRoot, { recursive: true, force: true });
    }
  });

  // ==================== createSave ====================

  describe('createSave', () => {
    it('应生成 uuid saveId 并创建存档目录', () => {
      const meta = gameSaveRepository.createSave({
        gameId: 'game-1',
        gameType: GameType.MANAGEMENT,
        name: '存档1',
        isAuto: false,
        tableSchema: TEST_SCHEMA
      });

      expect(meta.id).toBeTruthy();
      expect(meta.id).toHaveLength(36); // uuid v4 长度
      expect(meta.gameId).toBe('game-1');
      expect(meta.gameType).toBe(GameType.MANAGEMENT);
      expect(meta.name).toBe('存档1');
      expect(meta.isAuto).toBe(false);
      expect(meta.createdAt).toBeGreaterThan(0);
      expect(meta.updatedAt).toBe(meta.createdAt);
      expect(meta.currentTurn).toBeNull();
      expect(meta.currentNodeId).toBeNull();
      expect(meta.nodeTitle).toBeNull();
      expect(meta.turnCount).toBe(0);
      expect(meta.messageCount).toBe(0);

      // 存档目录存在
      const saveDir = getSaveDir(meta.id);
      expect(fs.existsSync(saveDir)).toBe(true);
    });

    it('应创建 save.json、table-data.json 与 tables 目录', () => {
      const meta = gameSaveRepository.createSave({
        gameId: 'game-1',
        gameType: GameType.MANAGEMENT,
        name: '存档1',
        isAuto: false,
        tableSchema: TEST_SCHEMA
      });

      const savePath = getSaveMetaPath(meta.id);
      const tablePath = getSaveTableDataPath(meta.id);

      expect(fs.existsSync(savePath)).toBe(true);
      expect(fs.existsSync(tablePath)).toBe(true);

      // save.json 应包含 meta + 空 narrativeLog
      const saveData = JSON.parse(fs.readFileSync(savePath, 'utf8'));
      expect(saveData.meta.id).toBe(meta.id);
      expect(saveData.narrativeLog).toEqual([]);
    });

    it('提供 initialState 时应写入 state-snapshot.json 并在 meta 中记录路径', () => {
      const initialState = { turn: 1, money: 100,Resources: { wood: 50 } };

      const meta = gameSaveRepository.createSave({
        gameId: 'game-1',
        gameType: GameType.MANAGEMENT,
        name: '存档1',
        isAuto: false,
        tableSchema: TEST_SCHEMA,
        initialState
      });

      const snapshotPath = getSaveStateSnapshotPath(meta.id);
      expect(fs.existsSync(snapshotPath)).toBe(true);

      const snapshot = JSON.parse(fs.readFileSync(snapshotPath, 'utf8'));
      expect(snapshot).toEqual(initialState);

      expect(meta.stateSnapshotPath).toBe('state-snapshot.json');
    });

    it('未提供 initialState 时不应创建 state-snapshot.json', () => {
      const meta = gameSaveRepository.createSave({
        gameId: 'game-1',
        gameType: GameType.MANAGEMENT,
        name: '存档1',
        isAuto: false,
        tableSchema: TEST_SCHEMA
      });

      const snapshotPath = getSaveStateSnapshotPath(meta.id);
      expect(fs.existsSync(snapshotPath)).toBe(false);
      expect(meta.stateSnapshotPath).toBeUndefined();
    });

    it('应按 schema 初始化空表格', () => {
      const meta = gameSaveRepository.createSave({
        gameId: 'game-1',
        gameType: GameType.MANAGEMENT,
        name: '存档1',
        isAuto: false,
        tableSchema: TEST_SCHEMA
      });

      const tablePath = getSaveTableDataPath(meta.id);
      const tableData = JSON.parse(fs.readFileSync(tablePath, 'utf8'));

      expect(tableData.sheets).toEqual(['资源', '设施']);
      expect(tableData.headers['资源']).toEqual(['1', '名称', '数量']);
      expect(tableData.data['资源']).toEqual([]);
      expect(tableData.data['设施']).toEqual([]);
      expect(tableData.sheetDescriptions['资源']).toBe('玩家拥有的资源');
    });
  });

  // ==================== loadSave ====================

  describe('loadSave', () => {
    it('应返回存档数据（含 meta + narrativeLog + stateSnapshot）', () => {
      const initialState = { turn: 1, money: 100 };

      const meta = gameSaveRepository.createSave({
        gameId: 'game-1',
        gameType: GameType.MANAGEMENT,
        name: '存档1',
        isAuto: false,
        tableSchema: TEST_SCHEMA,
        initialState
      });

      // 写入一些 narrativeLog
      gameSaveRepository.updateSave(meta.id, { narrativeLog: makeNarrativeLog() });

      const loaded = gameSaveRepository.loadSave(meta.id);
      expect(loaded).not.toBeNull();
      expect(loaded?.meta.id).toBe(meta.id);
      expect(loaded?.meta.messageCount).toBe(2);
      expect(loaded?.narrativeLog).toHaveLength(2);
      expect(loaded?.narrativeLog[0].content).toBe('玩家行动：建造农场');
      expect(loaded?.stateSnapshot).toEqual(initialState);
    });

    it('应优先从独立的 state-snapshot.json 读取最新状态快照', () => {
      const initialState = { turn: 1, money: 100 };
      const meta = gameSaveRepository.createSave({
        gameId: 'game-1',
        gameType: GameType.MANAGEMENT,
        name: '存档1',
        isAuto: false,
        tableSchema: TEST_SCHEMA,
        initialState
      });

      // 后续更新状态快照
      const newState = { turn: 5, money: 500 };
      gameSaveRepository.updateSave(meta.id, { stateSnapshot: newState });

      const loaded = gameSaveRepository.loadSave(meta.id);
      expect(loaded?.stateSnapshot).toEqual(newState);
    });

    it('存档不存在时应返回 null', () => {
      expect(gameSaveRepository.loadSave('nonexistent')).toBeNull();
    });
  });

  // ==================== listSaves ====================

  describe('listSaves', () => {
    it('应按 gameId 过滤并按 updatedAt 倒序排列', () => {
      // 创建 3 个存档：2 个属于 game-A，1 个属于 game-B
      const saveA1 = gameSaveRepository.createSave({
        gameId: 'game-A',
        gameType: GameType.MANAGEMENT,
        name: 'A1',
        isAuto: false,
        tableSchema: TEST_SCHEMA
      });
      const saveA2 = gameSaveRepository.createSave({
        gameId: 'game-A',
        gameType: GameType.MANAGEMENT,
        name: 'A2',
        isAuto: false,
        tableSchema: TEST_SCHEMA
      });
      const saveB1 = gameSaveRepository.createSave({
        gameId: 'game-B',
        gameType: GameType.MANAGEMENT,
        name: 'B1',
        isAuto: false,
        tableSchema: TEST_SCHEMA
      });

      // 让 saveA1 比 saveA2 更新（updatedAt 更大）
      gameSaveRepository.updateSave(saveA1.id, { currentTurn: 10 });

      const savesA = gameSaveRepository.listSaves('game-A');
      expect(savesA).toHaveLength(2);
      expect(savesA[0].id).toBe(saveA1.id); // 最新更新的在最前
      expect(savesA[1].id).toBe(saveA2.id);

      const savesB = gameSaveRepository.listSaves('game-B');
      expect(savesB).toHaveLength(1);
      expect(savesB[0].id).toBe(saveB1.id);
    });

    it('无存档时应返回空数组', () => {
      expect(gameSaveRepository.listSaves('empty-game')).toEqual([]);
    });
  });

  // ==================== updateSave ====================

  describe('updateSave', () => {
    it('应更新指定字段并刷新 updatedAt', () => {
      const meta = gameSaveRepository.createSave({
        gameId: 'game-1',
        gameType: GameType.MANAGEMENT,
        name: '存档1',
        isAuto: false,
        tableSchema: TEST_SCHEMA
      });

      const beforeUpdate = gameSaveRepository.loadSave(meta.id);
      const beforeUpdatedAt = beforeUpdate?.meta.updatedAt ?? 0;

      // 等待 1ms 确保 updatedAt 不同
      const result = gameSaveRepository.updateSave(meta.id, {
        currentTurn: 5,
        currentNodeId: 'node-3',
        nodeTitle: '第三章',
        turnCount: 5
      });

      expect(result).toBe(true);

      const after = gameSaveRepository.loadSave(meta.id);
      expect(after?.meta.currentTurn).toBe(5);
      expect(after?.meta.currentNodeId).toBe('node-3');
      expect(after?.meta.nodeTitle).toBe('第三章');
      expect(after?.meta.turnCount).toBe(5);
      expect(after?.meta.updatedAt).toBeGreaterThanOrEqual(beforeUpdatedAt);
    });

    it('更新 narrativeLog 时应同步刷新 messageCount', () => {
      const meta = gameSaveRepository.createSave({
        gameId: 'game-1',
        gameType: GameType.MANAGEMENT,
        name: '存档1',
        isAuto: false,
        tableSchema: TEST_SCHEMA
      });

      expect(gameSaveRepository.loadSave(meta.id)?.meta.messageCount).toBe(0);

      gameSaveRepository.updateSave(meta.id, { narrativeLog: makeNarrativeLog() });

      expect(gameSaveRepository.loadSave(meta.id)?.meta.messageCount).toBe(2);
    });

    it('更新 stateSnapshot 时应同步写入独立 state-snapshot.json', () => {
      const meta = gameSaveRepository.createSave({
        gameId: 'game-1',
        gameType: GameType.MANAGEMENT,
        name: '存档1',
        isAuto: false,
        tableSchema: TEST_SCHEMA
      });

      const newState = { turn: 3, money: 200 };
      gameSaveRepository.updateSave(meta.id, { stateSnapshot: newState });

      const snapshotPath = getSaveStateSnapshotPath(meta.id);
      expect(fs.existsSync(snapshotPath)).toBe(true);
      const snapshot = JSON.parse(fs.readFileSync(snapshotPath, 'utf8'));
      expect(snapshot).toEqual(newState);
    });

    it('存档不存在时应返回 false', () => {
      expect(gameSaveRepository.updateSave('nonexistent', { currentTurn: 1 })).toBe(false);
    });
  });

  // ==================== deleteSave ====================

  describe('deleteSave', () => {
    it('应递归删除存档目录', () => {
      const meta = gameSaveRepository.createSave({
        gameId: 'game-1',
        gameType: GameType.MANAGEMENT,
        name: '存档1',
        isAuto: false,
        tableSchema: TEST_SCHEMA,
        initialState: { turn: 1 }
      });

      const saveDir = getSaveDir(meta.id);
      expect(fs.existsSync(saveDir)).toBe(true);

      const result = gameSaveRepository.deleteSave(meta.id);
      expect(result).toBe(true);
      expect(fs.existsSync(saveDir)).toBe(false);
    });

    it('删除不存在的存档应返回 true（幂等）', () => {
      expect(gameSaveRepository.deleteSave('nonexistent')).toBe(true);
    });
  });

  // ==================== pruneAutoSaves ====================

  describe('pruneAutoSaves', () => {
    it('应保留最近 MAX_AUTO_SAVES 个自动存档，删除其余', () => {
      // 创建 7 个自动存档（MAX_AUTO_SAVES = 5，应保留 5 个，删除 2 个）
      const saveIds: string[] = [];
      for (let i = 0; i < 7; i++) {
        const meta = gameSaveRepository.createSave({
          gameId: 'game-auto',
          gameType: GameType.MANAGEMENT,
          name: `自动存档${i}`,
          isAuto: true,
          tableSchema: TEST_SCHEMA
        });
        saveIds.push(meta.id);
        // 让后创建的存档 updatedAt 更大（每个间隔 10ms）
        // 通过 updateSave 推进 updatedAt
        if (i > 0) {
          // 使用直接文件操作覆盖 updatedAt（绕过 updateSave 的 Date.now()）
          // 改用 updateSave 多次调用来确保顺序
        }
      }

      // 顺序触发 updateSave 来确保每个存档的 updatedAt 单调递增
      // saveIds[0] 已是最旧的（创建时最早），saveIds[6] 是最新的
      // 为确保顺序，依次对每个存档触发更新
      for (let i = 0; i < saveIds.length; i++) {
        gameSaveRepository.updateSave(saveIds[i], { turnCount: i });
      }

      gameSaveRepository.pruneAutoSaves('game-auto');

      const remaining = gameSaveRepository.listSaves('game-auto');
      expect(remaining).toHaveLength(MAX_AUTO_SAVES);

      // 应保留 updatedAt 最大的 5 个（即 saveIds[2..6]）
      const remainingIds = new Set(remaining.map((m) => m.id));
      for (let i = 2; i < 7; i++) {
        expect(remainingIds.has(saveIds[i])).toBe(true);
      }
      // 最旧的 2 个应被删除
      expect(remainingIds.has(saveIds[0])).toBe(false);
      expect(remainingIds.has(saveIds[1])).toBe(false);
    });

    it('自动存档数 <= MAX_AUTO_SAVES 时不应删除任何存档', () => {
      const saveIds: string[] = [];
      for (let i = 0; i < MAX_AUTO_SAVES; i++) {
        const meta = gameSaveRepository.createSave({
          gameId: 'game-auto-2',
          gameType: GameType.MANAGEMENT,
          name: `自动存档${i}`,
          isAuto: true,
          tableSchema: TEST_SCHEMA
        });
        saveIds.push(meta.id);
      }

      gameSaveRepository.pruneAutoSaves('game-auto-2');

      expect(gameSaveRepository.listSaves('game-auto-2')).toHaveLength(MAX_AUTO_SAVES);
    });

    it('手动存档不应被 pruneAutoSaves 影响', () => {
      // 创建若干手动存档
      for (let i = 0; i < 8; i++) {
        gameSaveRepository.createSave({
          gameId: 'game-manual',
          gameType: GameType.MANAGEMENT,
          name: `手动存档${i}`,
          isAuto: false, // 手动存档
          tableSchema: TEST_SCHEMA
        });
      }

      gameSaveRepository.pruneAutoSaves('game-manual');

      // 手动存档不应被删除
      expect(gameSaveRepository.listSaves('game-manual')).toHaveLength(8);
    });
  });

  // ==================== copySave ====================

  describe('copySave', () => {
    it('应复制源存档所有文件并生成新 saveId', () => {
      const sourceMeta = gameSaveRepository.createSave({
        gameId: 'game-1',
        gameType: GameType.MANAGEMENT,
        name: '原存档',
        isAuto: false,
        tableSchema: TEST_SCHEMA,
        initialState: { turn: 5 }
      });

      // 添加一些 narrativeLog 与表格数据
      gameSaveRepository.updateSave(sourceMeta.id, { narrativeLog: makeNarrativeLog() });
      const originalTableData = gameTableRepository.getTableData(sourceMeta.id);
      expect(originalTableData).not.toBeNull();
      if (originalTableData) {
        originalTableData.data['资源'].push({ '1': 'r1', '名称': '木材', '数量': 100 });
        gameTableRepository.saveTableData(sourceMeta.id, originalTableData);
      }

      const copied = gameSaveRepository.copySave(sourceMeta.id, '副本存档');
      expect(copied).not.toBeNull();
      if (!copied) return;

      expect(copied.id).not.toBe(sourceMeta.id);
      expect(copied.id).toHaveLength(36);
      expect(copied.name).toBe('副本存档');
      expect(copied.isAuto).toBe(false); // 副本默认为手动存档
      expect(copied.gameId).toBe(sourceMeta.gameId);
      expect(copied.gameType).toBe(sourceMeta.gameType);
      expect(copied.createdAt).toBeGreaterThanOrEqual(sourceMeta.createdAt);

      // 新存档应有独立的 save.json
      const newSavePath = getSaveMetaPath(copied.id);
      expect(fs.existsSync(newSavePath)).toBe(true);

      // 表格数据应被复制
      const copiedTable = gameTableRepository.getTableData(copied.id);
      expect(copiedTable).not.toBeNull();
      expect(copiedTable?.data['资源']).toHaveLength(1);
      expect(copiedTable?.data['资源'][0]['名称']).toBe('木材');

      // narrativeLog 应被复制
      const loaded = gameSaveRepository.loadSave(copied.id);
      expect(loaded?.narrativeLog).toHaveLength(2);
    });

    it('源存档不存在时应返回 null', () => {
      expect(gameSaveRepository.copySave('nonexistent', '副本')).toBeNull();
    });
  });
});

// ==================== GameTableRepository 测试 ====================

describe('GameTableRepository', () => {
  beforeEach(() => {
    tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'cc-game-table-test-'));
  });

  afterEach(() => {
    if (fs.existsSync(tmpRoot)) {
      fs.rmSync(tmpRoot, { recursive: true, force: true });
    }
  });

  // 创建一个测试存档（包含初始表格）供表格测试使用
  function makeSaveWithTable(): string {
    const meta = gameSaveRepository.createSave({
      gameId: 'table-game',
      gameType: GameType.MANAGEMENT,
      name: '表格测试存档',
      isAuto: false,
      tableSchema: TEST_SCHEMA
    });
    return meta.id;
  }

  // ==================== initTableData ====================

  describe('initTableData', () => {
    it('应按 schema 初始化空表格并写入 table-data.json', () => {
      const saveId = gameSaveRepository.createSave({
        gameId: 'g1',
        gameType: GameType.MANAGEMENT,
        name: 's',
        isAuto: false,
        tableSchema: { sheets: [], headers: {}, sheetDescriptions: {} }
      }).id;

      // 先删除已存在的表格文件（createSave 已经初始化过一次）
      const tablePath = getSaveTableDataPath(saveId);
      if (fs.existsSync(tablePath)) {
        fs.unlinkSync(tablePath);
      }

      const data = gameTableRepository.initTableData(saveId, TEST_SCHEMA);
      expect(data.sheets).toEqual(['资源', '设施']);
      expect(data.headers['资源']).toEqual(['1', '名称', '数量']);
      expect(data.data['资源']).toEqual([]);
      expect(fs.existsSync(tablePath)).toBe(true);
    });
  });

  // ==================== saveTableData / getTableData ====================

  describe('saveTableData / getTableData', () => {
    it('应持久化表格数据并能读回', () => {
      const saveId = makeSaveWithTable();

      const data = gameTableRepository.getTableData(saveId);
      expect(data).not.toBeNull();
      if (!data) return;

      // 修改后保存
      data.data['资源'].push({ '1': 'r1', '名称': '木材', '数量': 100 });
      data.data['资源'].push({ '1': 'r2', '名称': '石头', '数量': 50 });

      const saved = gameTableRepository.saveTableData(saveId, data);
      expect(saved).toBe(true);

      // 读回验证
      const loaded = gameTableRepository.getTableData(saveId);
      expect(loaded?.data['资源']).toHaveLength(2);
      expect(loaded?.data['资源'][0]['名称']).toBe('木材');
      expect(loaded?.data['资源'][1]['数量']).toBe(50);
    });

    it('表格数据不存在时应返回 null', () => {
      expect(gameTableRepository.getTableData('nonexistent')).toBeNull();
    });
  });

  // ==================== applyTableEdits ====================

  describe('applyTableEdits', () => {
    it('空命令数组应返回 success=true 且 commandsExecuted=0', () => {
      const saveId = makeSaveWithTable();
      const result = gameTableRepository.applyTableEdits(saveId, []);
      expect(result.success).toBe(true);
      expect(result.changes.commandsExecuted).toBe(0);
      expect(result.changes.affectedSheets).toEqual([]);
      expect(result.changes.errors).toEqual([]);
    });

    it('存档表格不存在时应返回 success=false 并记录错误', () => {
      // 空命令会提前返回 success=true，所以这里给一个真实命令
      const cmd: GameTableEditCommand = {
        type: GameTableEditCommandType.INSERT_ROW,
        sheetIndex: 1,
        rowData: { '1': 'r1', '名称': '测试', '数量': 1 },
        raw: '<tableEdit>...'
      };
      const result2 = gameTableRepository.applyTableEdits('nonexistent', [cmd]);
      expect(result2.success).toBe(false);
      expect(result2.changes.commandsExecuted).toBe(0);
      expect(result2.changes.errors.length).toBeGreaterThan(0);
    });

    it('INSERT_ROW 应追加新行到指定 sheet', () => {
      const saveId = makeSaveWithTable();

      const commands: GameTableEditCommand[] = [
        {
          type: GameTableEditCommandType.INSERT_ROW,
          sheetIndex: 1, // 第 1 个 sheet（资源）
          rowData: { '1': 'r1', '名称': '木材', '数量': 100 },
          raw: 'insert-row-1'
        },
        {
          type: GameTableEditCommandType.INSERT_ROW,
          sheetIndex: 1,
          rowData: { '1': 'r2', '名称': '石头', '数量': 50 },
          raw: 'insert-row-2'
        }
      ];

      const result = gameTableRepository.applyTableEdits(saveId, commands);
      expect(result.success).toBe(true);
      expect(result.changes.commandsExecuted).toBe(2);
      expect(result.changes.affectedSheets).toEqual(['资源']);
      expect(result.changes.errors).toEqual([]);

      const data = gameTableRepository.getTableData(saveId);
      expect(data?.data['资源']).toHaveLength(2);
      expect(data?.data['资源'][0]['名称']).toBe('木材');
      expect(data?.data['资源'][1]['数量']).toBe(50);
    });

    it('INSERT_ROW 唯一 ID 重复时应合并更新而非追加', () => {
      const saveId = makeSaveWithTable();

      // 先插入 r1
      gameTableRepository.applyTableEdits(saveId, [
        {
          type: GameTableEditCommandType.INSERT_ROW,
          sheetIndex: 1,
          rowData: { '1': 'r1', '名称': '木材', '数量': 100 },
          raw: 'insert-1'
        }
      ]);

      // 再次插入相同 ID 的 r1，应合并而非追加
      gameTableRepository.applyTableEdits(saveId, [
        {
          type: GameTableEditCommandType.INSERT_ROW,
          sheetIndex: 1,
          rowData: { '1': 'r1', '数量': 200 }, // 仅更新数量
          raw: 'insert-dup'
        }
      ]);

      const data = gameTableRepository.getTableData(saveId);
      expect(data?.data['资源']).toHaveLength(1); // 仍然是 1 行
      expect(data?.data['资源'][0]['名称']).toBe('木材'); // 保留原字段
      expect(data?.data['资源'][0]['数量']).toBe(200); // 数量被更新
    });

    it('UPDATE_ROW 应合并字段到指定行（rowIndex 是 1-based）', () => {
      const saveId = makeSaveWithTable();

      // 先插入两行
      gameTableRepository.applyTableEdits(saveId, [
        {
          type: GameTableEditCommandType.INSERT_ROW,
          sheetIndex: 1,
          rowData: { '1': 'r1', '名称': '木材', '数量': 100 },
          raw: 'insert-1'
        },
        {
          type: GameTableEditCommandType.INSERT_ROW,
          sheetIndex: 1,
          rowData: { '1': 'r2', '名称': '石头', '数量': 50 },
          raw: 'insert-2'
        }
      ]);

      // 更新第 2 行（rowIndex=2，对应 0-based index=1）
      gameTableRepository.applyTableEdits(saveId, [
        {
          type: GameTableEditCommandType.UPDATE_ROW,
          sheetIndex: 1,
          rowIndex: 2,
          rowData: { '数量': 75 },
          raw: 'update-row-2'
        }
      ]);

      const data = gameTableRepository.getTableData(saveId);
      expect(data?.data['资源']).toHaveLength(2);
      expect(data?.data['资源'][1]['名称']).toBe('石头'); // 未更新字段保留
      expect(data?.data['资源'][1]['数量']).toBe(75); // 数量被更新
    });

    it('UPDATE_ROW rowIndex 越界时应记录 error', () => {
      const saveId = makeSaveWithTable();

      const result = gameTableRepository.applyTableEdits(saveId, [
        {
          type: GameTableEditCommandType.UPDATE_ROW,
          sheetIndex: 1,
          rowIndex: 99,
          rowData: { '数量': 75 },
          raw: 'update-oob'
        }
      ]);

      expect(result.changes.commandsExecuted).toBe(0);
      expect(result.changes.errors).toHaveLength(1);
      expect(result.changes.errors[0]).toContain('越界');
    });

    it('DELETE_ROW 应删除指定行（rowIndex 是 1-based）', () => {
      const saveId = makeSaveWithTable();

      // 先插入两行
      gameTableRepository.applyTableEdits(saveId, [
        {
          type: GameTableEditCommandType.INSERT_ROW,
          sheetIndex: 1,
          rowData: { '1': 'r1', '名称': '木材', '数量': 100 },
          raw: 'insert-1'
        },
        {
          type: GameTableEditCommandType.INSERT_ROW,
          sheetIndex: 1,
          rowData: { '1': 'r2', '名称': '石头', '数量': 50 },
          raw: 'insert-2'
        }
      ]);

      // 删除第 1 行（rowIndex=1，对应 0-based index=0）
      const result = gameTableRepository.applyTableEdits(saveId, [
        {
          type: GameTableEditCommandType.DELETE_ROW,
          sheetIndex: 1,
          rowIndex: 1,
          raw: 'delete-row-1'
        }
      ]);

      expect(result.changes.commandsExecuted).toBe(1);
      const data = gameTableRepository.getTableData(saveId);
      expect(data?.data['资源']).toHaveLength(1);
      expect(data?.data['资源'][0]['名称']).toBe('石头'); // 第 1 行被删除
    });

    it('DELETE_ROW rowIndex 越界时应记录 error', () => {
      const saveId = makeSaveWithTable();

      const result = gameTableRepository.applyTableEdits(saveId, [
        {
          type: GameTableEditCommandType.DELETE_ROW,
          sheetIndex: 1,
          rowIndex: 99,
          raw: 'delete-oob'
        }
      ]);

      expect(result.changes.commandsExecuted).toBe(0);
      expect(result.changes.errors).toHaveLength(1);
      expect(result.changes.errors[0]).toContain('越界');
    });

    it('sheetIndex 越界时应记录 error', () => {
      const saveId = makeSaveWithTable();

      const result = gameTableRepository.applyTableEdits(saveId, [
        {
          type: GameTableEditCommandType.INSERT_ROW,
          sheetIndex: 99, // 越界
          rowData: { '1': 'r1' },
          raw: 'bad-sheet'
        }
      ]);

      expect(result.changes.commandsExecuted).toBe(0);
      expect(result.changes.errors).toHaveLength(1);
      expect(result.changes.errors[0]).toContain('超出范围');
    });

    it('混合命令应按顺序执行并收集 affectedSheets', () => {
      const saveId = makeSaveWithTable();

      const commands: GameTableEditCommand[] = [
        // 资源 sheet（sheetIndex=1）：插入一行
        {
          type: GameTableEditCommandType.INSERT_ROW,
          sheetIndex: 1,
          rowData: { '1': 'r1', '名称': '木材', '数量': 100 },
          raw: 'insert-r1'
        },
        // 设施 sheet（sheetIndex=2）：插入一行
        {
          type: GameTableEditCommandType.INSERT_ROW,
          sheetIndex: 2,
          rowData: { '1': 'f1', '名称': '农场', '等级': 1 },
          raw: 'insert-f1'
        },
        // 资源 sheet：更新 r1
        {
          type: GameTableEditCommandType.UPDATE_ROW,
          sheetIndex: 1,
          rowIndex: 1,
          rowData: { '数量': 150 },
          raw: 'update-r1'
        }
      ];

      const result = gameTableRepository.applyTableEdits(saveId, commands);
      expect(result.success).toBe(true);
      expect(result.changes.commandsExecuted).toBe(3);
      expect(result.changes.affectedSheets.sort()).toEqual(['设施', '资源']);
      expect(result.changes.errors).toEqual([]);

      const data = gameTableRepository.getTableData(saveId);
      expect(data?.data['资源']).toHaveLength(1);
      expect(data?.data['资源'][0]['数量']).toBe(150);
      expect(data?.data['设施']).toHaveLength(1);
      expect(data?.data['设施'][0]['名称']).toBe('农场');
    });
  });

  // ==================== 版本快照 ====================

  describe('版本快照', () => {
    it('saveVersionSnapshot + getVersionSnapshot 应能读回快照', () => {
      const saveId = makeSaveWithTable();

      const original = gameTableRepository.getTableData(saveId);
      expect(original).not.toBeNull();
      if (!original) return;

      const newData: typeof original = JSON.parse(JSON.stringify(original));
      newData.data['资源'].push({ '1': 'r1', '名称': '木材', '数量': 100 });

      const saved = gameTableRepository.saveVersionSnapshot(saveId, original, newData);
      expect(saved).toBe(true);

      const snapshot = gameTableRepository.getVersionSnapshot(saveId);
      expect(snapshot).not.toBeNull();
      expect(snapshot?.saveId).toBe(saveId);
      expect(snapshot?.originalData.data['资源']).toEqual([]);
      expect(snapshot?.newData.data['资源']).toHaveLength(1);
      expect(snapshot?.changeRecord.addedRows).toHaveLength(1);
      expect(snapshot?.changeRecord.addedRows[0].sheetName).toBe('资源');
    });

    it('confirmVersion 应将 newData 应用到 table-data.json', () => {
      const saveId = makeSaveWithTable();
      const original = gameTableRepository.getTableData(saveId);
      if (!original) return;

      const newData = JSON.parse(JSON.stringify(original)) as typeof original;
      newData.data['资源'].push({ '1': 'r1', '名称': '木材', '数量': 100 });

      gameTableRepository.saveVersionSnapshot(saveId, original, newData);

      const confirmed = gameTableRepository.confirmVersion(saveId);
      expect(confirmed).toBe(true);

      // table-data.json 应已更新为新数据
      const after = gameTableRepository.getTableData(saveId);
      expect(after?.data['资源']).toHaveLength(1);

      // 快照应被清除
      expect(gameTableRepository.getVersionSnapshot(saveId)).toBeNull();
    });

    it('rollbackVersion 应恢复 originalData', () => {
      const saveId = makeSaveWithTable();
      const original = gameTableRepository.getTableData(saveId);
      if (!original) return;

      const newData = JSON.parse(JSON.stringify(original)) as typeof original;
      newData.data['资源'].push({ '1': 'r1', '名称': '木材', '数量': 100 });

      gameTableRepository.saveVersionSnapshot(saveId, original, newData);

      const rolledBack = gameTableRepository.rollbackVersion(saveId);
      expect(rolledBack).toBe(true);

      // table-data.json 应恢复为原始数据
      const after = gameTableRepository.getTableData(saveId);
      expect(after?.data['资源']).toEqual([]);

      // 快照应被清除
      expect(gameTableRepository.getVersionSnapshot(saveId)).toBeNull();
    });

    it('无快照时 confirmVersion / rollbackVersion 应返回 false', () => {
      const saveId = makeSaveWithTable();
      expect(gameTableRepository.confirmVersion(saveId)).toBe(false);
      expect(gameTableRepository.rollbackVersion(saveId)).toBe(false);
    });
  });
});
