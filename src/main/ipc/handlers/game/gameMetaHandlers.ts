/**
 * 游戏模式 - 游戏元数据 IPC handler
 *
 * 涵盖：
 *   - game:list         列出所有已注册游戏摘要（games-index.json）
 *   - game:getMeta      读取单个游戏完整元数据（meta.json）
 *   - game:createGame   创建新游戏（写入 meta.json + 更新索引）
 *   - game:updateGame   更新游戏元数据（部分字段）
 *   - game:deleteGame   删除游戏（递归删除目录 + 移除索引条目）
 *
 * 所有 handler 通过 wrapHandler 高阶函数统一 try/catch 兜底；
 * 业务层 GameRepository 方法均为同步实现（基于 fs.readFileSync / safeWriteFile），
 * 不抛出异常，仅返回 boolean / null / 数组，因此 wrapHandler 主要兜底未知异常。
 *
 * 返回值规范（与 writing 模块一致）：
 *   - 成功：{ success: true, ...payload }
 *   - 失败：{ success: false, error: string }
 */
import { ipcMain } from 'electron';
import { gameRepository } from '../../../services/game/GameRepository';
import type { GameMeta, GameIndexEntry } from '../../../../shared/types/game.types';
import { wrapHandler } from '../utils/wrapHandler';

export function registerGameMetaHandlers(): void {
  // ========== 游戏元数据 CRUD ==========

  /**
   * 列出所有已注册游戏的摘要
   * 不存在索引时返回空数组
   */
  ipcMain.handle(
    'game:list',
    wrapHandler(async () => {
      const games: GameIndexEntry[] = gameRepository.listGames();
      return { success: true, games };
    })
  );

  /**
   * 读取单个游戏完整元数据
   * 不存在时返回 data: null（保持响应形态统一）
   */
  ipcMain.handle(
    'game:getMeta',
    wrapHandler(async (_event, gameId: string) => {
      const meta: GameMeta | null = gameRepository.getGameMeta(gameId);
      return { success: true, meta };
    })
  );

  /**
   * 创建新游戏
   * 调用方需自行生成 GameMeta（含 id / 时间戳）
   * 返回 success 表示写入是否成功
   */
  ipcMain.handle(
    'game:createGame',
    wrapHandler(async (_event, meta: GameMeta) => {
      const ok = gameRepository.createGameMeta(meta);
      return { success: ok };
    })
  );

  /**
   * 更新游戏元数据（部分字段）
   * 不允许通过 update 修改 id（仓库内部已忽略 id 字段）
   */
  ipcMain.handle(
    'game:updateGame',
    wrapHandler(async (_event, gameId: string, updates: Partial<GameMeta>) => {
      const ok = gameRepository.updateGameMeta(gameId, updates);
      return { success: ok };
    })
  );

  /**
   * 删除游戏
   * 注意：仅清理游戏侧数据（meta.json / config.json），
   * 不会级联删除 game-saves/ 下的存档（存档生命周期由 GameSaveRepository 单独管理）
   */
  ipcMain.handle(
    'game:deleteGame',
    wrapHandler(async (_event, gameId: string) => {
      const ok = gameRepository.deleteGameMeta(gameId);
      return { success: ok };
    })
  );
}
