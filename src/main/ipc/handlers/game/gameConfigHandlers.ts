/**
 * 游戏模式 - 游戏本地配置 IPC handler
 *
 * 涵盖：
 *   - game:getConfig     读取单个游戏的本地配置（config.json）
 *   - game:saveConfig    保存单个游戏的本地配置
 *
 * GameLocalConfig 字段：activeEngineId / temperature / maxTokens / organizeMode / ansiTheme / autoSave
 * 不存在 config.json 时 getGameConfig 返回 DEFAULT_GAME_LOCAL_CONFIG（不写盘）
 *
 * 所有 handler 通过 wrapHandler 高阶函数统一 try/catch 兜底。
 */
import { ipcMain } from 'electron';
import { gameRepository } from '../../../services/game/GameRepository';
import type { GameLocalConfig } from '../../../../shared/types/game.types';
import { wrapHandler } from '../utils/wrapHandler';

export function registerGameConfigHandlers(): void {
  // ========== 游戏本地配置 CRUD ==========

  /**
   * 读取游戏本地配置
   * 不存在时返回 DEFAULT_GAME_LOCAL_CONFIG（仓库内部已处理）
   */
  ipcMain.handle(
    'game:getConfig',
    wrapHandler(async (_event, gameId: string) => {
      const config: GameLocalConfig = gameRepository.getGameConfig(gameId);
      return { success: true, config };
    })
  );

  /**
   * 保存游戏本地配置
   */
  ipcMain.handle(
    'game:saveConfig',
    wrapHandler(async (_event, gameId: string, config: GameLocalConfig) => {
      const ok = gameRepository.saveGameConfig(gameId, config);
      return { success: ok };
    })
  );
}
