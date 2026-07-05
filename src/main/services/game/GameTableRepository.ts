/**
 * 游戏表格数据仓储 - 管理存档的表格数据、配置与版本快照
 *
 * 持久化结构：
 * - `data/game-saves/<saveId>/tables/table-data.json`        表格数据
 * - `data/game-saves/<saveId>/tables/table-config.json`      表格配置
 * - `data/game-saves/<saveId>/tables/table-versions.json`    版本快照（用于回滚）
 *
 * 设计原则：
 * - 路径 helper 复用 GameSaveRepository 的同名函数（避免路径计算重复）
 * - applyTableEdits 复用 WritingTableRepository 的命令执行逻辑思路（按 sheetIndex 找 sheet、按 rowIndex 操作行）
 *   但**不直接 import writing 模块**（避免跨模块耦合），核心逻辑在本模块内重新实现
 * - sheetIndex 与 rowIndex 均为 1-based（与 tableEdit 协议对齐）
 * - 唯一 ID 字段为 "1"（与 WritingTableData 约定一致）
 */

import fs from 'fs';
import { safeWriteFile } from '../writing/WritingProjectRepository';
import {
  GameTableData,
  GameTableSchema,
  GameTableConfig,
  GameTableEditCommand,
  GameTableEditCommandType
} from '../../../shared/types/game.types';
import { createEmptyTableData } from '../../../shared/constants/game.constants';
import {
  getSaveTableDataPath,
  getSaveTableConfigPath,
  getSaveTableVersionsPath
} from './GameSaveRepository';

// ==================== 类型定义 ====================

/**
 * 表格数据变更记录 - compareTableData 的返回类型
 *
 * 与 WritingTableRepository.TableChangeRecord 同构，但 rowData 类型对齐
 * GameTableData.data 的元素类型（Record<string, any>[]）。
 */
export interface GameTableChangeRecord {
  addedRows: Array<{ sheetName: string; rowIndex: number; rowData: Record<string, any> }>;
  modifiedCells: Array<{
    sheetName: string;
    rowIndex: number;
    columnName: string;
    oldValue: unknown;
    newValue: unknown;
  }>;
  deletedRows: Array<{ sheetName: string; rowIndex: number; rowData: Record<string, any> }>;
}

/**
 * 版本快照 - getVersionSnapshot 的返回类型
 *
 * 在 confirmVersion / rollbackVersion 中用于恢复/回退表格数据。
 * 与 WritingTableRepository.VersionSnapshot 同构，但 saveId 替换 projectId。
 */
export interface VersionSnapshot {
  id: string;
  saveId: string;
  originalData: GameTableData;
  newData: GameTableData;
  changeRecord: GameTableChangeRecord;
  createdAt: number;
  expiresAt: number;
}

/**
 * 默认表格配置（新建存档时使用）
 */
const DEFAULT_TABLE_CONFIG: GameTableConfig = {
  enabled: true,
  autoOrganize: false,
  organizeMode: 'async',
  associatedTemplateId: null,
  associatedTemplateName: ''
};

/**
 * 版本快照有效期（24 小时，与 WritingTableRepository 一致）
 */
const VERSION_SNAPSHOT_TTL_MS = 24 * 60 * 60 * 1000;

// ==================== 仓储类 ====================

/**
 * 游戏表格数据持久化仓储
 *
 * 职责：
 * - 表格数据 CRUD（getTableData / saveTableData / initTableData）
 * - 应用 tableEdit 命令（applyTableEdits，来自 AI 回复末尾的 <tableEdit> 标签解析结果）
 * - 表格配置管理（getTableConfig / saveTableConfig）
 * - 版本快照管理（saveVersionSnapshot / getVersionSnapshot / confirmVersion / rollbackVersion）
 * - 表格数据对比（compareTableData）
 *
 * 注意：
 * - 不直接依赖 writing 模块的内部函数（applyTableEdits / compareTableData 核心逻辑在本模块重新实现）
 * - 仅复用 writing 模块的 safeWriteFile 工具函数
 * - sheetIndex 与 rowIndex 均为 1-based（与 tableEdit 协议对齐）
 */
export class GameTableRepository {
  // ==================== 表格数据 CRUD ====================

  /**
   * 读取存档的表格数据
   * 不存在时返回 null。
   */
  getTableData(saveId: string): GameTableData | null {
    const tablePath = getSaveTableDataPath(saveId);
    try {
      if (!fs.existsSync(tablePath)) {
        return null;
      }
      const data = fs.readFileSync(tablePath, 'utf8');
      return JSON.parse(data) as GameTableData;
    } catch (error) {
      console.error(`[GameTableRepository] Failed to load table data for save ${saveId}:`, error);
      return null;
    }
  }

  /**
   * 保存存档的表格数据（使用 safeWriteFile 原子写入）
   */
  saveTableData(saveId: string, data: GameTableData): boolean {
    const tablePath = getSaveTableDataPath(saveId);
    return safeWriteFile(tablePath, JSON.stringify(data, null, 2), 'utf8');
  }

  /**
   * 按 schema 初始化空表格
   * - 调用 createEmptyTableData(schema) 生成空数据
   * - 写入 table-data.json
   * - 同时初始化默认 table-config.json
   *
   * @returns 初始化好的空表格数据
   */
  initTableData(saveId: string, schema: GameTableSchema): GameTableData {
    const emptyData = createEmptyTableData(schema);
    this.saveTableData(saveId, emptyData);
    // 同时写入默认配置
    this.saveTableConfig(saveId, { ...DEFAULT_TABLE_CONFIG });
    return emptyData;
  }

  // ==================== 表格配置 ====================

  /**
   * 读取存档的表格配置
   * 不存在时返回 null。
   */
  getTableConfig(saveId: string): GameTableConfig | null {
    const configPath = getSaveTableConfigPath(saveId);
    try {
      if (!fs.existsSync(configPath)) {
        return null;
      }
      const data = fs.readFileSync(configPath, 'utf8');
      return JSON.parse(data) as GameTableConfig;
    } catch (error) {
      console.error(`[GameTableRepository] Failed to load table config for save ${saveId}:`, error);
      return null;
    }
  }

  /**
   * 保存存档的表格配置
   */
  saveTableConfig(saveId: string, config: GameTableConfig): boolean {
    const configPath = getSaveTableConfigPath(saveId);
    return safeWriteFile(configPath, JSON.stringify(config, null, 2), 'utf8');
  }

  // ==================== applyTableEdits ====================

  /**
   * 应用 tableEdit 命令
   *
   * 命令协议（来自 AI 回复末尾的 <tableEdit> 标签解析结果）：
   * - type: INSERT_ROW / UPDATE_ROW / DELETE_ROW
   * - sheetIndex: 1-based（与表格在 schema.sheets 数组中的位置对应）
   * - rowIndex: 1-based（INSERT_ROW 时无此字段）
   * - rowData: 行数据（INSERT_ROW / UPDATE_ROW 时存在）
   *
   * 行为：
   * - INSERT_ROW: 若 rowData['1']（唯一 ID）已存在则合并更新，否则追加
   * - UPDATE_ROW: 按 rowIndex-1 找到行并合并字段；越界则记 error
   * - DELETE_ROW: 按 rowIndex-1 找到行并删除；越界则记 error
   * - 任何单条命令失败不会中断后续命令（errors 收集）
   *
   * @returns { success, changes }：success 表示整体执行是否完成持久化；
   *          changes.commandsExecuted 表示成功执行的命令数；
   *          changes.affectedSheets 是去重后的受影响 sheet 名列表；
   *          changes.errors 是按命令收集的错误信息列表
   */
  applyTableEdits(
    saveId: string,
    commands: GameTableEditCommand[]
  ): {
    success: boolean;
    changes: {
      commandsExecuted: number;
      affectedSheets: string[];
      errors: string[];
    };
  } {
    const emptyResult = {
      success: false,
      changes: { commandsExecuted: 0, affectedSheets: [] as string[], errors: [] as string[] }
    };

    if (!commands || commands.length === 0) {
      return {
        success: true,
        changes: { commandsExecuted: 0, affectedSheets: [], errors: [] }
      };
    }

    const tableData = this.getTableData(saveId);
    if (!tableData) {
      emptyResult.changes.errors.push(`存档 ${saveId} 的表格数据不存在，无法应用 tableEdit`);
      return emptyResult;
    }

    let commandsExecuted = 0;
    const affectedSheets = new Set<string>();
    const errors: string[] = [];

    for (const command of commands) {
      try {
        const { type, sheetIndex, rowIndex, rowData } = command;

        if (sheetIndex === undefined || sheetIndex === null) {
          errors.push(`命令缺少 sheetIndex: ${command.raw}`);
          continue;
        }

        // sheetIndex 是 1-based，转换为 0-based
        const sheetName = tableData.sheets[sheetIndex - 1];
        if (!sheetName) {
          errors.push(
            `sheetIndex=${sheetIndex} 超出范围（共 ${tableData.sheets.length} 个 sheet）: ${command.raw}`
          );
          continue;
        }

        if (!tableData.data[sheetName]) {
          errors.push(`sheet "${sheetName}" 数据不存在: ${command.raw}`);
          continue;
        }

        const rows = tableData.data[sheetName];

        if (type === GameTableEditCommandType.INSERT_ROW) {
          const newRow = rowData || {};
          const uniqueId = newRow['1'];

          if (uniqueId) {
            // 检查唯一 ID 是否已存在
            const existingIdx = rows.findIndex((r) => r['1'] === uniqueId);
            if (existingIdx >= 0) {
              // 已存在相同唯一 ID，合并更新
              rows[existingIdx] = { ...rows[existingIdx], ...newRow };
            } else {
              rows.push(newRow);
            }
          } else {
            // 没有唯一 ID 字段，直接追加
            rows.push(newRow);
          }
          affectedSheets.add(sheetName);
          commandsExecuted++;
        } else if (type === GameTableEditCommandType.UPDATE_ROW) {
          if (rowIndex === undefined || rowIndex === null) {
            errors.push(`UPDATE_ROW 缺少 rowIndex: ${command.raw}`);
            continue;
          }
          // rowIndex 是 1-based，转换为 0-based
          const idx = rowIndex - 1;
          if (idx >= 0 && idx < rows.length) {
            rows[idx] = { ...rows[idx], ...(rowData || {}) };
            affectedSheets.add(sheetName);
            commandsExecuted++;
          } else {
            errors.push(
              `UPDATE_ROW rowIndex=${rowIndex} 越界（sheet "${sheetName}" 共 ${rows.length} 行）: ${command.raw}`
            );
          }
        } else if (type === GameTableEditCommandType.DELETE_ROW) {
          if (rowIndex === undefined || rowIndex === null) {
            errors.push(`DELETE_ROW 缺少 rowIndex: ${command.raw}`);
            continue;
          }
          const idx = rowIndex - 1;
          if (idx >= 0 && idx < rows.length) {
            rows.splice(idx, 1);
            affectedSheets.add(sheetName);
            commandsExecuted++;
          } else {
            errors.push(
              `DELETE_ROW rowIndex=${rowIndex} 越界（sheet "${sheetName}" 共 ${rows.length} 行）: ${command.raw}`
            );
          }
        } else {
          errors.push(`未知命令类型: ${type} (${command.raw})`);
        }
      } catch (error) {
        errors.push(
          `执行命令异常: ${error instanceof Error ? error.message : String(error)} (${command.raw})`
        );
      }
    }

    // 持久化更新后的表格数据
    const saved = this.saveTableData(saveId, tableData);

    return {
      success: saved,
      changes: {
        commandsExecuted,
        affectedSheets: Array.from(affectedSheets),
        errors
      }
    };
  }

  // ==================== 表格数据对比 ====================

  /**
   * 对比两份表格数据，返回变更记录
   *
   * 复用 WritingTableRepository.compareTableData 的核心逻辑思路：
   * - 遍历 newData.sheets
   * - 找新增行（newRow['1'] 不在 originalRows 中）
   * - 找删除行（originalRow['1'] 不在 newRows 中）
   * - 找修改的单元格（按 headers 逐字段对比）
   *
   * 注意：仅对比 sheet 在 newData.sheets 中存在的部分。
   */
  compareTableData(
    originalData: GameTableData,
    newData: GameTableData
  ): GameTableChangeRecord {
    const addedRows: GameTableChangeRecord['addedRows'] = [];
    const modifiedCells: GameTableChangeRecord['modifiedCells'] = [];
    const deletedRows: GameTableChangeRecord['deletedRows'] = [];

    for (const sheetName of newData.sheets) {
      const originalRows = originalData.data[sheetName] || [];
      const newRows = newData.data[sheetName] || [];

      // 找出新增的行
      for (let i = 0; i < newRows.length; i++) {
        const newRow = newRows[i];
        const uniqueId = newRow['1'];
        if (!uniqueId) continue;

        const existsInOriginal = originalRows.some((row) => row['1'] === uniqueId);
        if (!existsInOriginal) {
          addedRows.push({ sheetName, rowIndex: i, rowData: newRow });
        }
      }

      // 找出删除的行
      for (let i = 0; i < originalRows.length; i++) {
        const originalRow = originalRows[i];
        const uniqueId = originalRow['1'];
        if (!uniqueId) continue;

        const existsInNew = newRows.some((row) => row['1'] === uniqueId);
        if (!existsInNew) {
          deletedRows.push({ sheetName, rowIndex: i, rowData: originalRow });
        }
      }

      // 找出修改的单元格
      for (let i = 0; i < newRows.length; i++) {
        const newRow = newRows[i];
        const uniqueId = newRow['1'];
        if (!uniqueId) continue;

        const originalRow = originalRows.find((row) => row['1'] === uniqueId);
        if (!originalRow) continue;

        const headers = newData.headers[sheetName] || [];
        for (const header of headers) {
          const oldValue = originalRow[header];
          const newValue = newRow[header];
          if (JSON.stringify(oldValue) !== JSON.stringify(newValue)) {
            modifiedCells.push({
              sheetName,
              rowIndex: i,
              columnName: header,
              oldValue,
              newValue
            });
          }
        }
      }
    }

    return { addedRows, modifiedCells, deletedRows };
  }

  // ==================== 版本快照 ====================

  /**
   * 保存版本快照（用于回滚）
   *
   * 在 applyTableEdits 之前由调用方触发，记录原始数据与目标新数据。
   * 与 WritingTableRepository.saveVersionSnapshot 同构。
   *
   * @param saveId        存档 ID
   * @param originalData  原始数据（用于 rollback）
   * @param newData       新数据（用于 confirm）
   * @returns 写入成功返回 true，失败返回 false
   */
  saveVersionSnapshot(
    saveId: string,
    originalData: GameTableData,
    newData: GameTableData
  ): boolean {
    const changeRecord = this.compareTableData(originalData, newData);
    const snapshot: VersionSnapshot = {
      id: `v-${Date.now()}`,
      saveId,
      originalData,
      newData,
      changeRecord,
      createdAt: Date.now(),
      expiresAt: Date.now() + VERSION_SNAPSHOT_TTL_MS
    };

    const snapshotPath = getSaveTableVersionsPath(saveId);
    return safeWriteFile(snapshotPath, JSON.stringify(snapshot, null, 2), 'utf8');
  }

  /**
   * 读取版本快照
   * - 不存在或已过期时返回 null（过期会自动清理）
   */
  getVersionSnapshot(saveId: string): VersionSnapshot | null {
    const snapshotPath = getSaveTableVersionsPath(saveId);
    try {
      if (!fs.existsSync(snapshotPath)) {
        return null;
      }
      const data = fs.readFileSync(snapshotPath, 'utf8');
      const snapshot = JSON.parse(data) as VersionSnapshot;

      // 检查是否过期
      if (Date.now() > snapshot.expiresAt) {
        this.clearVersionSnapshot(saveId);
        return null;
      }

      return snapshot;
    } catch (error) {
      console.error(
        `[GameTableRepository] Failed to load version snapshot for save ${saveId}:`,
        error
      );
      return null;
    }
  }

  /**
   * 清除版本快照文件
   */
  clearVersionSnapshot(saveId: string): void {
    const snapshotPath = getSaveTableVersionsPath(saveId);
    try {
      if (fs.existsSync(snapshotPath)) {
        fs.unlinkSync(snapshotPath);
      }
    } catch (error) {
      console.error(
        `[GameTableRepository] Failed to clear version snapshot for save ${saveId}:`,
        error
      );
    }
  }

  /**
   * 确认版本（应用 newData 到 table-data.json 并清除快照）
   *
   * @returns 成功返回 true，无快照或失败返回 false
   */
  confirmVersion(saveId: string): boolean {
    const snapshot = this.getVersionSnapshot(saveId);
    if (!snapshot) {
      return false;
    }
    const saved = this.saveTableData(saveId, snapshot.newData);
    if (saved) {
      this.clearVersionSnapshot(saveId);
    }
    return saved;
  }

  /**
   * 回滚版本（恢复 originalData 到 table-data.json 并清除快照）
   *
   * @returns 成功返回 true，无快照或失败返回 false
   */
  rollbackVersion(saveId: string): boolean {
    const snapshot = this.getVersionSnapshot(saveId);
    if (!snapshot) {
      return false;
    }
    const saved = this.saveTableData(saveId, snapshot.originalData);
    if (saved) {
      this.clearVersionSnapshot(saveId);
    }
    return saved;
  }
}

// ==================== 单例 ====================

export const gameTableRepository: GameTableRepository = new GameTableRepository();
