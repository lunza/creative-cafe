/**
 * 游戏模式 - 表格数据 IPC handler
 *
 * 涵盖：
 *   - game:getTableData          读取存档的表格数据
 *   - game:saveTableData          保存存档的表格数据
 *   - game:applyTableEdits        应用 tableEdit 命令（INSERT_ROW / UPDATE_ROW / DELETE_ROW）
 *   - game:getVersionSnapshot     读取版本快照（用于回滚前的预览）
 *   - game:confirmVersion         确认版本（应用 newData 并清除快照）
 *   - game:rollbackVersion        回滚版本（恢复 originalData 并清除快照）
 *
 * 所有 handler 通过 wrapHandler 高阶函数统一 try/catch 兜底。
 * GameTableRepository 方法均为同步实现。
 */
import { ipcMain } from 'electron';
import { gameTableRepository } from '../../../services/game/GameTableRepository';
import type {
  GameTableData,
  GameTableEditCommand
} from '../../../../shared/types/game.types';
import { wrapHandler } from '../utils/wrapHandler';

export function registerGameTableHandlers(): void {
  // ========== 表格数据 CRUD ==========

  /**
   * 读取存档的表格数据
   * 不存在时返回 data: null
   */
  ipcMain.handle(
    'game:getTableData',
    wrapHandler(async (_event, saveId: string) => {
      const data: GameTableData | null = gameTableRepository.getTableData(saveId);
      return { success: true, data };
    })
  );

  /**
   * 保存存档的表格数据（覆盖写入 table-data.json）
   */
  ipcMain.handle(
    'game:saveTableData',
    wrapHandler(async (_event, saveId: string, tableData: GameTableData) => {
      const ok = gameTableRepository.saveTableData(saveId, tableData);
      return { success: ok };
    })
  );

  /**
   * 应用 tableEdit 命令
   *
   * 命令协议（来自 AI 回复末尾的 <tableEdit> 标签解析结果）：
   *   - type: INSERT_ROW / UPDATE_ROW / DELETE_ROW
   *   - sheetIndex: 1-based
   *   - rowIndex: 1-based（INSERT_ROW 时无）
   *   - rowData: 行数据（INSERT_ROW / UPDATE_ROW 时存在）
   *
   * 返回 { success, changes: { commandsExecuted, affectedSheets, errors } }：
   *   - commandsExecuted：成功执行的命令数
   *   - affectedSheets：去重后的受影响 sheet 名列表
   *   - errors：按命令收集的错误信息列表（不影响其他命令执行）
   */
  ipcMain.handle(
    'game:applyTableEdits',
    wrapHandler(async (_event, saveId: string, commands: GameTableEditCommand[]) => {
      const result = gameTableRepository.applyTableEdits(saveId, commands);
      return {
        success: result.success,
        changes: result.changes
      };
    })
  );

  // ========== 版本快照 ==========

  /**
   * 读取版本快照
   * 不存在或已过期时返回 snapshot: null（过期会自动清理）
   */
  ipcMain.handle(
    'game:getVersionSnapshot',
    wrapHandler(async (_event, saveId: string) => {
      const snapshot = gameTableRepository.getVersionSnapshot(saveId);
      return { success: true, snapshot };
    })
  );

  /**
   * 确认版本（应用 newData 到 table-data.json 并清除快照）
   * 无快照或失败返回 success: false
   */
  ipcMain.handle(
    'game:confirmVersion',
    wrapHandler(async (_event, saveId: string) => {
      const ok = gameTableRepository.confirmVersion(saveId);
      return { success: ok };
    })
  );

  /**
   * 回滚版本（恢复 originalData 到 table-data.json 并清除快照）
   * 无快照或失败返回 success: false
   */
  ipcMain.handle(
    'game:rollbackVersion',
    wrapHandler(async (_event, saveId: string) => {
      const ok = gameTableRepository.rollbackVersion(saveId);
      return { success: ok };
    })
  );
}
