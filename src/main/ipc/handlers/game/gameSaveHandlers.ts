/**
 * 游戏模式 - 存档 IPC handler
 *
 * 涵盖：
 *   - game:createSave   创建新存档（生成 saveId、初始化 save.json + 空表格 + state-snapshot）
 *   - game:loadSave     读取存档（save.json + state-snapshot.json 合并）
 *   - game:listSaves    列出某游戏的所有存档（按 updatedAt 倒序）
 *   - game:deleteSave   删除存档（递归删除目录）
 *   - game:save         更新存档（剧情日志 / 状态快照 / 当前回合 / 节点等）
 *
 * 所有 handler 通过 wrapHandler 高阶函数统一 try/catch 兜底。
 * GameSaveRepository 方法均为同步实现，不抛出异常。
 */
import { ipcMain } from 'electron';
import { gameSaveRepository } from '../../../services/game/GameSaveRepository';
import type {
  GameSaveMeta,
  GameSaveData,
  GameType,
  GameTableSchema
} from '../../../../shared/types/game.types';
import { wrapHandler } from '../utils/wrapHandler';

export function registerGameSaveHandlers(): void {
  // ========== 存档 CRUD ==========

  /**
   * 创建新存档
   *
   * @param event IPC event
   * @param params { gameId, gameType, name, isAuto, tableSchema, initialState? }
   * @returns { success, meta? } meta 为新建存档元数据（含 saveId）
   */
  ipcMain.handle(
    'game:createSave',
    wrapHandler(async (
      _event,
      params: {
        gameId: string;
        gameType: GameType;
        name: string;
        isAuto: boolean;
        tableSchema: GameTableSchema;
        initialState?: Record<string, any>;
      }
    ) => {
      const meta: GameSaveMeta = gameSaveRepository.createSave(params);
      return { success: true, meta };
    })
  );

  /**
   * 加载存档
   * 不存在时返回 data: null
   */
  ipcMain.handle(
    'game:loadSave',
    wrapHandler(async (_event, saveId: string) => {
      const data: GameSaveData | null = gameSaveRepository.loadSave(saveId);
      return { success: true, data };
    })
  );

  /**
   * 列出某游戏的所有存档（按 updatedAt 倒序）
   */
  ipcMain.handle(
    'game:listSaves',
    wrapHandler(async (_event, gameId: string) => {
      const saves: GameSaveMeta[] = gameSaveRepository.listSaves(gameId);
      return { success: true, saves };
    })
  );

  /**
   * 删除存档（递归删除目录，含 save.json / tables/ / state-snapshot.json）
   */
  ipcMain.handle(
    'game:deleteSave',
    wrapHandler(async (_event, saveId: string) => {
      const ok = gameSaveRepository.deleteSave(saveId);
      return { success: ok };
    })
  );

  /**
   * 保存（更新）存档
   *
   * 支持更新字段（与 GameSaveRepository.updateSave updates 参数对齐）：
   *   - narrativeLog     剧情日志（覆盖）
   *   - stateSnapshot    状态快照（同步写入 state-snapshot.json）
   *   - currentTurn       当前回合
   *   - currentNodeId     当前剧情节点 ID
   *   - nodeTitle         当前节点标题
   *   - turnCount         已进行回合数
   *
   * 注意：本 handler 仅更新指定字段，不会自动追加 narrativeLog；
   *       如需追加消息请通过 game:narrative:complete 触发，或调用方先
   *       loadSave 读取后修改再 save（GameNarrativeService 内部已实现该模式）。
   */
  ipcMain.handle(
    'game:save',
    wrapHandler(async (
      _event,
      saveId: string,
      updates: {
        narrativeLog?: GameSaveData['narrativeLog'];
        stateSnapshot?: Record<string, any>;
        currentTurn?: number | null;
        currentNodeId?: string | null;
        nodeTitle?: string | null;
        turnCount?: number;
      }
    ) => {
      const ok = gameSaveRepository.updateSave(saveId, updates);
      return { success: ok };
    })
  );
}
