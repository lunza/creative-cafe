/**
 * 游戏存档仓储 - 管理存档目录、存档元数据与自定义状态快照
 *
 * 持久化结构：
 * - `data/game-saves/<saveId>/save.json`                存档元数据 + 剧情日志 + 状态快照
 * - `data/game-saves/<saveId>/state-snapshot.json`       模板自定义状态快照
 * - `data/game-saves/<saveId>/tables/`                  表格数据目录（由 GameTableRepository 管理）
 *
 * 设计原则：
 * - 复用 `safeWriteFile`（先 .tmp 再 rename）保证写入原子性
 * - 自动存档轮转：保留最近 MAX_AUTO_SAVES（=5）个 isAuto=true 的存档，超出则删除最旧的
 * - copySave 复用源存档目录所有文件（含 tables/ 子目录）
 */

import fs from 'fs';
import path from 'path';
import { v4 as uuidv4 } from 'uuid';
import { getUserDataPath } from '../../utils/appPath';
import { safeWriteFile } from '../writing/WritingProjectRepository';
import {
  GameType,
  GameSaveMeta,
  GameSaveData,
  GameNarrativeMessage,
  GameTableSchema
} from '../../../shared/types/game.types';
import { MAX_AUTO_SAVES } from '../../../shared/types/game.types';
import {
  GAME_SAVES_DIR_NAME,
  SAVE_META_FILENAME,
  SAVE_STATE_SNAPSHOT_FILENAME,
  SAVE_TABLE_DATA_FILENAME,
  SAVE_TABLE_CONFIG_FILENAME,
  SAVE_TABLE_VERSIONS_FILENAME,
  createEmptyTableData
} from '../../../shared/constants/game.constants';

// ==================== 路径 helper ====================

/**
 * 获取游戏存档根目录（userData/data/game-saves/）
 * 不存在时自动创建。
 */
export function getGameSavesDir(): string {
  const dataDir = path.join(getUserDataPath(), 'data');
  if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
  }
  const savesDir = path.join(dataDir, GAME_SAVES_DIR_NAME);
  if (!fs.existsSync(savesDir)) {
    fs.mkdirSync(savesDir, { recursive: true });
  }
  return savesDir;
}

/**
 * 获取单个存档目录（userData/data/game-saves/<saveId>/）
 * 不存在时自动创建。
 */
export function getSaveDir(saveId: string): string {
  const saveDir = path.join(getGameSavesDir(), saveId);
  if (!fs.existsSync(saveDir)) {
    fs.mkdirSync(saveDir, { recursive: true });
  }
  return saveDir;
}

/**
 * 获取存档元数据文件路径（<saveDir>/save.json）
 */
export function getSaveMetaPath(saveId: string): string {
  return path.join(getSaveDir(saveId), SAVE_META_FILENAME);
}

/**
 * 获取存档表格数据目录（<saveDir>/tables/）
 * 不存在时自动创建。
 */
export function getSaveTablesDir(saveId: string): string {
  const tablesDir = path.join(getSaveDir(saveId), 'tables');
  if (!fs.existsSync(tablesDir)) {
    fs.mkdirSync(tablesDir, { recursive: true });
  }
  return tablesDir;
}

/**
 * 获取存档表格数据文件路径（<saveDir>/tables/table-data.json）
 */
export function getSaveTableDataPath(saveId: string): string {
  return path.join(getSaveTablesDir(saveId), SAVE_TABLE_DATA_FILENAME);
}

/**
 * 获取存档表格配置文件路径（<saveDir>/tables/table-config.json）
 */
export function getSaveTableConfigPath(saveId: string): string {
  return path.join(getSaveTablesDir(saveId), SAVE_TABLE_CONFIG_FILENAME);
}

/**
 * 获取存档表格版本快照文件路径（<saveDir>/tables/table-versions.json）
 */
export function getSaveTableVersionsPath(saveId: string): string {
  return path.join(getSaveTablesDir(saveId), SAVE_TABLE_VERSIONS_FILENAME);
}

/**
 * 获取存档自定义状态快照路径（<saveDir>/state-snapshot.json）
 */
export function getSaveStateSnapshotPath(saveId: string): string {
  return path.join(getSaveDir(saveId), SAVE_STATE_SNAPSHOT_FILENAME);
}

// ==================== 仓储类 ====================

/**
 * 游戏存档持久化仓储
 *
 * 职责：
 * - 创建新存档（生成 saveId、初始化 save.json + 空表格 + 状态快照）
 * - 加载存档（save.json + state-snapshot.json 合并）
 * - 列出某游戏的所有存档（按 updatedAt 倒序）
 * - 更新存档（剧情日志、状态快照、当前回合、节点等）
 * - 删除存档（递归删除目录）
 * - 自动存档轮转（保留最近 MAX_AUTO_SAVES 个）
 * - 复制存档（另存为）
 *
 * 注意：
 * - 表格数据由 GameTableRepository 单独管理，本类在 createSave 时仅初始化空表格
 * - 状态快照单独存于 state-snapshot.json，避免每次更新都重写 save.json
 */
export class GameSaveRepository {
  /**
   * 创建新存档
   * - 生成 saveId（uuid）
   * - 创建目录与 tables 子目录
   * - 初始化 save.json（含 meta + 空 narrativeLog）
   * - 按 schema 初始化空表格
   * - 若提供 initialState 则写入 state-snapshot.json
   *
   * @returns 创建好的存档元数据
   */
  createSave(params: {
    gameId: string;
    gameType: GameType;
    name: string;
    isAuto: boolean;
    tableSchema: GameTableSchema;
    initialState?: Record<string, any>;
  }): GameSaveMeta {
    const { gameId, gameType, name, isAuto, tableSchema, initialState } = params;
    const saveId = uuidv4();
    const now = Date.now();

    // 创建存档目录（getSaveDir 会自动 mkdir）
    const saveDir = getSaveDir(saveId);
    void saveDir; // 仅触发目录创建

    // 初始化空表格（按 schema）
    const tableData = createEmptyTableData(tableSchema);
    const tableDataPath = getSaveTableDataPath(saveId);
    const tableSaved = safeWriteFile(
      tableDataPath,
      JSON.stringify(tableData, null, 2),
      'utf8'
    );
    if (!tableSaved) {
      console.error(`[GameSaveRepository] Failed to init table data for save ${saveId}`);
    }

    // 写入状态快照（若提供 initialState）
    let stateSnapshotPath: string | undefined;
    if (initialState !== undefined) {
      const snapshotPath = getSaveStateSnapshotPath(saveId);
      const snapSaved = safeWriteFile(
        snapshotPath,
        JSON.stringify(initialState, null, 2),
        'utf8'
      );
      if (snapSaved) {
        stateSnapshotPath = SAVE_STATE_SNAPSHOT_FILENAME;
      } else {
        console.error(`[GameSaveRepository] Failed to init state snapshot for save ${saveId}`);
      }
    }

    // 构造存档元数据
    const meta: GameSaveMeta = {
      id: saveId,
      gameId,
      gameType,
      name,
      isAuto,
      createdAt: now,
      updatedAt: now,
      currentTurn: null,
      currentNodeId: null,
      nodeTitle: null,
      turnCount: 0,
      messageCount: 0,
      stateSnapshotPath
    };

    // 写入 save.json（含 meta + 空 narrativeLog，不含 stateSnapshot 全量数据）
    const saveData: GameSaveData = {
      meta,
      narrativeLog: []
    };
    if (initialState !== undefined) {
      saveData.stateSnapshot = initialState;
    }
    const savePath = getSaveMetaPath(saveId);
    const saved = safeWriteFile(savePath, JSON.stringify(saveData, null, 2), 'utf8');
    if (!saved) {
      console.error(`[GameSaveRepository] Failed to write save.json for save ${saveId}`);
    }

    return meta;
  }

  /**
   * 加载存档
   * - 读取 save.json
   * - 若 state-snapshot.json 存在则覆盖 saveData.stateSnapshot
   *
   * @returns 存档数据，不存在时返回 null
   */
  loadSave(saveId: string): GameSaveData | null {
    const savePath = getSaveMetaPath(saveId);
    try {
      if (!fs.existsSync(savePath)) {
        return null;
      }
      const data = fs.readFileSync(savePath, 'utf8');
      const saveData = JSON.parse(data) as GameSaveData;
      if (!saveData || !saveData.meta) {
        return null;
      }

      // 优先从独立 state-snapshot.json 读取最新状态快照
      const snapshotPath = getSaveStateSnapshotPath(saveId);
      if (fs.existsSync(snapshotPath)) {
        try {
          const snapRaw = fs.readFileSync(snapshotPath, 'utf8');
          saveData.stateSnapshot = JSON.parse(snapRaw);
        } catch (error) {
          console.error(`[GameSaveRepository] Failed to read state snapshot for ${saveId}:`, error);
        }
      }

      return saveData;
    } catch (error) {
      console.error(`[GameSaveRepository] Failed to load save ${saveId}:`, error);
      return null;
    }
  }

  /**
   * 列出某游戏的所有存档
   * 扫描 game-saves 目录下所有存档，过滤 gameId 匹配项
   * 按 updatedAt 倒序排列（最新的在最前）
   */
  listSaves(gameId: string): GameSaveMeta[] {
    const savesDir = getGameSavesDir();
    const result: GameSaveMeta[] = [];
    try {
      if (!fs.existsSync(savesDir)) {
        return [];
      }
      const entries = fs.readdirSync(savesDir);
      for (const entry of entries) {
        const saveDir = path.join(savesDir, entry);
        try {
          const stat = fs.statSync(saveDir);
          if (!stat.isDirectory()) continue;
        } catch {
          continue;
        }

        const savePath = path.join(saveDir, SAVE_META_FILENAME);
        if (!fs.existsSync(savePath)) continue;

        try {
          const data = fs.readFileSync(savePath, 'utf8');
          const saveData = JSON.parse(data) as GameSaveData;
          if (saveData?.meta && saveData.meta.gameId === gameId) {
            result.push(saveData.meta);
          }
        } catch (error) {
          console.error(`[GameSaveRepository] Failed to read save ${entry}:`, error);
        }
      }
    } catch (error) {
      console.error(`[GameSaveRepository] Failed to list saves for ${gameId}:`, error);
      return [];
    }

    // 按 updatedAt 倒序
    result.sort((a, b) => b.updatedAt - a.updatedAt);
    return result;
  }

  /**
   * 更新存档
   * - 读取现有 save.json
   * - 应用 updates（narrativeLog / stateSnapshot / currentTurn / currentNodeId / nodeTitle / turnCount）
   * - 刷新 meta.updatedAt / meta.messageCount
   * - 若更新 stateSnapshot 则同步写入独立的 state-snapshot.json
   *
   * @returns 更新成功返回 true，存档不存在或失败返回 false
   */
  updateSave(
    saveId: string,
    updates: {
      narrativeLog?: GameNarrativeMessage[];
      stateSnapshot?: Record<string, any>;
      currentTurn?: number | null;
      currentNodeId?: string | null;
      nodeTitle?: string | null;
      turnCount?: number;
    }
  ): boolean {
    const savePath = getSaveMetaPath(saveId);
    try {
      if (!fs.existsSync(savePath)) {
        console.warn(`[GameSaveRepository] updateSave: save ${saveId} not found`);
        return false;
      }

      const data = fs.readFileSync(savePath, 'utf8');
      const saveData = JSON.parse(data) as GameSaveData;

      // 应用更新
      if (updates.narrativeLog !== undefined) {
        saveData.narrativeLog = updates.narrativeLog;
        saveData.meta.messageCount = updates.narrativeLog.length;
      }
      if (updates.stateSnapshot !== undefined) {
        saveData.stateSnapshot = updates.stateSnapshot;
        // 同步写入独立的 state-snapshot.json
        const snapshotPath = getSaveStateSnapshotPath(saveId);
        const snapSaved = safeWriteFile(
          snapshotPath,
          JSON.stringify(updates.stateSnapshot, null, 2),
          'utf8'
        );
        if (!snapSaved) {
          console.error(`[GameSaveRepository] Failed to write state snapshot for ${saveId}`);
        }
        if (!saveData.meta.stateSnapshotPath) {
          saveData.meta.stateSnapshotPath = SAVE_STATE_SNAPSHOT_FILENAME;
        }
      }
      if (updates.currentTurn !== undefined) {
        saveData.meta.currentTurn = updates.currentTurn;
      }
      if (updates.currentNodeId !== undefined) {
        saveData.meta.currentNodeId = updates.currentNodeId;
      }
      if (updates.nodeTitle !== undefined) {
        saveData.meta.nodeTitle = updates.nodeTitle;
      }
      if (updates.turnCount !== undefined) {
        saveData.meta.turnCount = updates.turnCount;
      }

      saveData.meta.updatedAt = Date.now();

      const saved = safeWriteFile(savePath, JSON.stringify(saveData, null, 2), 'utf8');
      return saved;
    } catch (error) {
      console.error(`[GameSaveRepository] Failed to update save ${saveId}:`, error);
      return false;
    }
  }

  /**
   * 删除存档
   * 递归删除存档目录（包含 save.json / tables/ / state-snapshot.json）
   */
  deleteSave(saveId: string): boolean {
    try {
      const saveDir = path.join(getGameSavesDir(), saveId);
      if (fs.existsSync(saveDir)) {
        fs.rmSync(saveDir, { recursive: true, force: true });
      }
      return true;
    } catch (error) {
      console.error(`[GameSaveRepository] Failed to delete save ${saveId}:`, error);
      return false;
    }
  }

  /**
   * 自动存档轮转
   * - 列出某游戏的所有 isAuto=true 的存档
   * - 按 updatedAt 倒序排列
   * - 保留前 MAX_AUTO_SAVES 个，删除其余
   */
  pruneAutoSaves(gameId: string): void {
    try {
      const autoSaves = this.listSaves(gameId).filter((m) => m.isAuto);
      if (autoSaves.length <= MAX_AUTO_SAVES) {
        return;
      }
      // listSaves 已按 updatedAt 倒序，所以从 MAX_AUTO_SAVES 开始是较旧的
      const toDelete = autoSaves.slice(MAX_AUTO_SAVES);
      for (const meta of toDelete) {
        this.deleteSave(meta.id);
      }
    } catch (error) {
      console.error(`[GameSaveRepository] Failed to prune auto saves for ${gameId}:`, error);
    }
  }

  /**
   * 复制存档（另存为）
   * - 读取源存档的所有文件（含 tables/ 子目录）
   * - 生成新的 saveId 与 newName
   * - 复制到新存档目录，并刷新 meta.id / meta.name / meta.isAuto=false / 时间戳
   *
   * @returns 新存档元数据，源存档不存在或失败时返回 null
   */
  copySave(sourceSaveId: string, newName: string): GameSaveMeta | null {
    const sourceDir = path.join(getGameSavesDir(), sourceSaveId);
    if (!fs.existsSync(sourceDir)) {
      console.warn(`[GameSaveRepository] copySave: source ${sourceSaveId} not found`);
      return null;
    }

    const sourceSavePath = getSaveMetaPath(sourceSaveId);
    if (!fs.existsSync(sourceSavePath)) {
      console.warn(`[GameSaveRepository] copySave: source save.json not found`);
      return null;
    }

    try {
      const newSaveId = uuidv4();
      const newDir = getSaveDir(newSaveId);
      const now = Date.now();

      // 递归复制目录
      this.copyDirSync(sourceDir, newDir);

      // 读取并修改新 save.json
      const newSavePath = path.join(newDir, SAVE_META_FILENAME);
      const data = fs.readFileSync(newSavePath, 'utf8');
      const saveData = JSON.parse(data) as GameSaveData;

      saveData.meta.id = newSaveId;
      saveData.meta.name = newName;
      saveData.meta.isAuto = false; // 另存为的副本默认是手动存档
      saveData.meta.createdAt = now;
      saveData.meta.updatedAt = now;

      safeWriteFile(newSavePath, JSON.stringify(saveData, null, 2), 'utf8');

      return saveData.meta;
    } catch (error) {
      console.error(`[GameSaveRepository] Failed to copy save ${sourceSaveId}:`, error);
      return null;
    }
  }

  /**
   * 递归复制目录（内部辅助方法）
   * 不复制 .tmp 文件（避免 safeWriteFile 残留）
   */
  private copyDirSync(src: string, dest: string): void {
    if (!fs.existsSync(dest)) {
      fs.mkdirSync(dest, { recursive: true });
    }
    const entries = fs.readdirSync(src);
    for (const entry of entries) {
      // 跳过 .tmp 残留文件
      if (entry.endsWith('.tmp')) continue;

      const srcPath = path.join(src, entry);
      const destPath = path.join(dest, entry);
      const stat = fs.statSync(srcPath);
      if (stat.isDirectory()) {
        this.copyDirSync(srcPath, destPath);
      } else {
        fs.copyFileSync(srcPath, destPath);
      }
    }
  }
}

// ==================== 单例 ====================

export const gameSaveRepository: GameSaveRepository = new GameSaveRepository();
