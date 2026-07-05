/**
 * 游戏模式 IPC handler 聚合注册入口
 *
 * Task 5: 将游戏模式 IPC handler 按领域拆分为 5 个子文件：
 *   - game/gameMetaHandlers.ts          游戏元数据 CRUD（list / getMeta / createGame / updateGame / deleteGame）
 *   - game/gameSaveHandlers.ts          存档 CRUD（createSave / loadSave / listSaves / deleteSave / save）
 *   - game/gameTableHandlers.ts         表格数据 CRUD + 版本快照（getTableData / saveTableData / applyTableEdits / getVersionSnapshot / confirmVersion / rollbackVersion）
 *   - game/gameNarrativeHandlers.ts     AI 叙事流式生成（generateNarrative / cancelGeneration）
 *                                       （并托管 activeAbortControllers 与 abortAllActiveGameRequests 函数）
 *   - game/gameConfigHandlers.ts        游戏本地配置（getConfig / saveConfig）
 *
 * 本文件仅做聚合注册，不再持有具体业务逻辑。
 *
 * 入口签名：
 *   - export function registerGameHandlers()                       注册所有 game:* handler
 *   - export function abortAllActiveGameRequests()                  取消所有活跃生成（由 gameNarrativeHandlers 重新导出）
 *
 * 在 registerGameHandlers() 内部完成 GameNarrativeService 的依赖注入：
 *   - gameNarrativeService.setGameRepository(gameRepository)
 *   - gameNarrativeService.setGameSaveRepository(gameSaveRepository)
 *   - gameNarrativeService.setGameTableRepository(gameTableRepository)
 *
 * 参考文件：
 *   - src/main/ipc/handlers/writingHandlers.ts（writing 模式的聚合入口）
 *   - utils/wrapHandler.ts（高阶函数统一 try/catch + console.error + throw 兜底）
 */
import { registerGameMetaHandlers } from './game/gameMetaHandlers';
import { registerGameSaveHandlers } from './game/gameSaveHandlers';
import { registerGameTableHandlers } from './game/gameTableHandlers';
import {
  registerGameNarrativeHandlers,
  abortAllActiveGameRequests
} from './game/gameNarrativeHandlers';
import { registerGameConfigHandlers } from './game/gameConfigHandlers';

// 依赖注入所需的仓库单例
import { gameRepository } from '../../services/game/GameRepository';
import { gameSaveRepository } from '../../services/game/GameSaveRepository';
import { gameTableRepository } from '../../services/game/GameTableRepository';
import { gameNarrativeService } from '../../services/game/GameNarrativeService';

// 重新导出 abortAllActiveGameRequests，保持 main/index.ts 调用方式不变
// （与 writingHandlers.ts 重新导出 abortAllActiveRequests 同模式）
export { abortAllActiveGameRequests };

/**
 * 注册所有游戏模式 IPC handler
 *
 * 调用顺序：
 *   1. 先完成 GameNarrativeService 的依赖注入（setter 注入仓库单例）
 *   2. 再注册 IPC handler（避免 handler 已注册但 service 依赖未就绪）
 *
 * 注意：GameNarrativeService 设计为「依赖未注入时优雅降级」，
 *       因此即使不调用本函数，service 也能工作（仅功能受限）。
 *       但建议在 setupIpcHandlers 中始终调用本函数，确保依赖注入完成。
 */
export function registerGameHandlers(): void {
  // 1. 完成 GameNarrativeService 的依赖注入
  //    主进程启动时一次性注入仓库单例，后续 generateNarrative 调用直接使用
  gameNarrativeService.setGameRepository(gameRepository);
  gameNarrativeService.setGameSaveRepository(gameSaveRepository);
  gameNarrativeService.setGameTableRepository(gameTableRepository);

  // 2. 注册各领域 IPC handler
  registerGameMetaHandlers();
  registerGameSaveHandlers();
  registerGameTableHandlers();
  registerGameNarrativeHandlers();
  registerGameConfigHandlers();
}
