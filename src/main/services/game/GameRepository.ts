/**
 * 游戏元数据仓储 - 管理游戏索引与单个游戏元数据/本地配置
 *
 * 持久化结构：
 * - `data/games/games-index.json`          游戏索引（摘要列表）
 * - `data/games/<gameId>/meta.json`        游戏完整元数据
 * - `data/games/<gameId>/config.json`      游戏本地配置（AI 引擎、温度等）
 *
 * 设计原则：
 * - 复用 `safeWriteFile`（先 .tmp 再 rename）保证写入原子性
 * - 复用 `getUserDataPath()` 获取 userData 目录
 * - 不直接依赖 writing 模块的内部函数，仅复用 safeWriteFile
 * - 索引文件首次启动若不存在，写入包含示例游戏"田园小镇"的默认索引（Task 17）
 */

import fs from 'fs';
import path from 'path';
import { getUserDataPath } from '../../utils/appPath';
import { safeWriteFile } from '../writing/WritingProjectRepository';
import {
  GameMeta,
  GameIndexEntry,
  GamesIndex,
  GameLocalConfig,
  GameType,
  GameStatus,
  DEFAULT_GAME_LOCAL_CONFIG
} from '../../../shared/types/game.types';
import {
  GAMES_DIR_NAME,
  GAMES_INDEX_FILENAME,
  GAME_META_FILENAME,
  GAME_CONFIG_FILENAME,
  GAMES_INDEX_VERSION
} from '../../../shared/constants/game.constants';

// ==================== 路径 helper ====================

/**
 * 获取游戏数据根目录（userData/data/games/）
 * 不存在时自动创建。
 */
export function getGamesDir(): string {
  const dataDir = path.join(getUserDataPath(), 'data');
  if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
  }
  const gamesDir = path.join(dataDir, GAMES_DIR_NAME);
  if (!fs.existsSync(gamesDir)) {
    fs.mkdirSync(gamesDir, { recursive: true });
  }
  return gamesDir;
}

/**
 * 获取单个游戏目录（userData/data/games/<gameId>/）
 * 不存在时自动创建。
 */
export function getGameDir(gameId: string): string {
  const gameDir = path.join(getGamesDir(), gameId);
  if (!fs.existsSync(gameDir)) {
    fs.mkdirSync(gameDir, { recursive: true });
  }
  return gameDir;
}

/**
 * 获取游戏索引文件路径（userData/data/games/games-index.json）
 */
export function getGamesIndexPath(): string {
  return path.join(getGamesDir(), GAMES_INDEX_FILENAME);
}

/**
 * 获取单个游戏元数据文件路径（userData/data/games/<gameId>/meta.json）
 */
export function getGameMetaPath(gameId: string): string {
  return path.join(getGameDir(gameId), GAME_META_FILENAME);
}

/**
 * 获取单个游戏本地配置文件路径（userData/data/games/<gameId>/config.json）
 */
export function getGameConfigPath(gameId: string): string {
  return path.join(getGameDir(gameId), GAME_CONFIG_FILENAME);
}

// ==================== 索引读写 helper ====================

/**
 * 读取游戏索引文件
 * 不存在或解析失败时返回空索引（version: '1.0.0', games: []）
 */
function loadIndex(): GamesIndex {
  const indexPath = getGamesIndexPath();
  try {
    if (fs.existsSync(indexPath)) {
      const data = fs.readFileSync(indexPath, 'utf8');
      const parsed = JSON.parse(data) as GamesIndex;
      if (!parsed || !Array.isArray(parsed.games)) {
        return { version: GAMES_INDEX_VERSION, games: [] };
      }
      return parsed;
    }
  } catch (error) {
    console.error('[GameRepository] Failed to load games index:', error);
  }
  return { version: GAMES_INDEX_VERSION, games: [] };
}

/**
 * 写入游戏索引文件（使用 safeWriteFile 原子写入）
 */
function saveIndex(index: GamesIndex): boolean {
  const indexPath = getGamesIndexPath();
  return safeWriteFile(indexPath, JSON.stringify(index, null, 2), 'utf8');
}

/**
 * 从 GameMeta 提取索引摘要字段
 * 字段为 GameMeta 的子集，新增字段需同步更新。
 */
function toIndexEntry(meta: GameMeta): GameIndexEntry {
  return {
    id: meta.id,
    type: meta.type,
    title: meta.title,
    subtitle: meta.subtitle,
    status: meta.status,
    coverPath: meta.coverPath,
    tags: meta.tags,
    createdAt: meta.createdAt,
    updatedAt: meta.updatedAt
  };
}

// ==================== 默认示例游戏元数据（Task 17） ====================

/**
 * 默认示例游戏元数据 - "田园小镇"
 *
 * 用于首次启动时写入 `userData/data/games/pastoral_town/meta.json`，
 * 让游戏大厅能展示并可启动该游戏。
 *
 * 与项目根目录 `data/games/pastoral_town/meta.json` 内容一致（后者作为版本控制下的种子参考）。
 * 修改时请同步更新两处，避免运行时与种子数据漂移。
 *
 * 字段说明：
 * - type: GameType.MANAGEMENT（'management'，对应 ManagementGameTemplate）
 * - status: GameStatus.COMPLETED（'completed'，可完整游玩）
 * - templateKey: 与 GameType 一致，预留供同一类型多模板扩展
 * - createdAt / updatedAt: 1735689600000（2025-01-01 00:00:00 UTC，固定值便于回归验证）
 */
const DEFAULT_PASTORAL_TOWN_META: GameMeta = {
  id: 'pastoral_town',
  type: GameType.MANAGEMENT,
  status: GameStatus.COMPLETED,
  title: '田园小镇',
  subtitle: '经营你的梦想农场',
  description:
    '一款 AI 驱动的文字模拟经营游戏。扮演新任镇长，从零开始建设你的梦想小镇。通过建造设施、招募角色、管理资源，将荒芜的土地变成繁荣的田园小镇。每回合都会触发 AI 生成的独特剧情，让你的每一次游玩都与众不同。',
  gameplay:
    '游戏采用回合制。每回合你可以：\n1. 建造设施（农场、伐木场、市集等）—— 消耗资源，提供产出\n2. 招募角色（农夫、木匠、商人等）—— 消耗金币，增加人口\n3. 结束回合 —— 结算产出，触发随机事件，回合数 +1\n\n资源说明：\n- 金币：通用货币，用于建造和招募\n- 食物：维持人口所需，不足时人口减少\n- 木材：建造设施的必要资源\n- 人口：影响税收和产出\n\n随机事件：每回合结束时有概率触发丰收、灾害、旅人来访等事件，影响资源或解锁新内容。',
  developer: 'Creative Cafe Team',
  version: '1.0.0',
  tags: ['经营', '模拟', '建设'],
  templateKey: GameType.MANAGEMENT,
  createdAt: 1735689600000,
  updatedAt: 1735689600000
};

// ==================== 仓储类 ====================

/**
 * 游戏元数据/配置持久化仓储
 *
 * 职责：
 * - 游戏索引 CRUD（listGames / ensureIndexExists）
 * - 游戏元数据 CRUD（getGameMeta / createGameMeta / updateGameMeta / deleteGameMeta）
 * - 游戏本地配置读写（getGameConfig / saveGameConfig）
 *
 * 注意：所有写入均使用 safeWriteFile（先 .tmp 再 rename）保证原子性。
 *
 * 模块加载时自动调用 `ensureIndexExists()`（详见文件末尾）：
 * 首次启动若索引文件不存在，写入包含示例游戏"田园小镇"的默认索引与 meta.json。
 */
export class GameRepository {
  /**
   * 列出所有已注册游戏的摘要
   * 索引文件不存在时返回空数组。
   */
  listGames(): GameIndexEntry[] {
    return loadIndex().games;
  }

  /**
   * 读取单个游戏元数据
   * 不存在时返回 null。
   */
  getGameMeta(gameId: string): GameMeta | null {
    const metaPath = getGameMetaPath(gameId);
    try {
      if (!fs.existsSync(metaPath)) {
        return null;
      }
      const data = fs.readFileSync(metaPath, 'utf8');
      return JSON.parse(data) as GameMeta;
    } catch (error) {
      console.error(`[GameRepository] Failed to load game meta for ${gameId}:`, error);
      return null;
    }
  }

  /**
   * 创建游戏元数据
   * - 写入 meta.json
   * - 同步更新索引（追加或替换同 id 条目）
   *
   * @returns 写入成功返回 true，失败返回 false
   */
  createGameMeta(meta: GameMeta): boolean {
    try {
      const metaPath = getGameMetaPath(meta.id);
      const saved = safeWriteFile(metaPath, JSON.stringify(meta, null, 2), 'utf8');
      if (!saved) {
        console.error(`[GameRepository] Failed to write meta.json for ${meta.id}`);
        return false;
      }

      const index = loadIndex();
      const entry = toIndexEntry(meta);
      const existingIdx = index.games.findIndex((g) => g.id === meta.id);
      if (existingIdx >= 0) {
        index.games[existingIdx] = entry;
      } else {
        index.games.push(entry);
      }
      return saveIndex(index);
    } catch (error) {
      console.error(`[GameRepository] Failed to create game meta for ${meta.id}:`, error);
      return false;
    }
  }

  /**
   * 更新游戏元数据（部分字段）
   * - 读取现有 meta，合并 updates（updatedAt 自动刷新）
   * - 写回 meta.json 并刷新索引摘要
   *
   * @returns 更新成功返回 true，游戏不存在或失败返回 false
   */
  updateGameMeta(gameId: string, updates: Partial<GameMeta>): boolean {
    try {
      const existing = this.getGameMeta(gameId);
      if (!existing) {
        console.warn(`[GameRepository] updateGameMeta: game ${gameId} not found`);
        return false;
      }

      // 不允许通过 update 修改 id（会破坏目录与索引的对应关系）
      const { id: _ignoredId, ...safeUpdates } = updates;
      void _ignoredId;

      const updated: GameMeta = {
        ...existing,
        ...safeUpdates,
        id: existing.id,
        updatedAt: Date.now()
      };

      const metaPath = getGameMetaPath(gameId);
      const saved = safeWriteFile(metaPath, JSON.stringify(updated, null, 2), 'utf8');
      if (!saved) {
        return false;
      }

      const index = loadIndex();
      const entry = toIndexEntry(updated);
      const idx = index.games.findIndex((g) => g.id === gameId);
      if (idx >= 0) {
        index.games[idx] = entry;
      } else {
        index.games.push(entry);
      }
      return saveIndex(index);
    } catch (error) {
      console.error(`[GameRepository] Failed to update game meta for ${gameId}:`, error);
      return false;
    }
  }

  /**
   * 删除游戏元数据
   * - 递归删除游戏目录
   * - 从索引中移除对应条目
   *
   * 注意：本方法仅清理游戏侧数据，不会级联删除 `data/game-saves/` 下的存档
   * （存档生命周期由 GameSaveRepository 单独管理）。
   *
   * @returns 删除成功返回 true，失败返回 false
   */
  deleteGameMeta(gameId: string): boolean {
    try {
      const gameDir = getGameDir(gameId);
      if (fs.existsSync(gameDir)) {
        fs.rmSync(gameDir, { recursive: true, force: true });
      }

      const index = loadIndex();
      const before = index.games.length;
      index.games = index.games.filter((g) => g.id !== gameId);
      const after = index.games.length;
      if (before !== after) {
        saveIndex(index);
      }
      return true;
    } catch (error) {
      console.error(`[GameRepository] Failed to delete game meta for ${gameId}:`, error);
      return false;
    }
  }

  /**
   * 读取游戏本地配置
   * 不存在时返回 DEFAULT_GAME_LOCAL_CONFIG（不写盘）。
   */
  getGameConfig(gameId: string): GameLocalConfig {
    const configPath = getGameConfigPath(gameId);
    try {
      if (!fs.existsSync(configPath)) {
        return { ...DEFAULT_GAME_LOCAL_CONFIG };
      }
      const data = fs.readFileSync(configPath, 'utf8');
      const parsed = JSON.parse(data) as Partial<GameLocalConfig>;
      // 与默认值合并，确保新增字段有默认值（向前兼容）
      return { ...DEFAULT_GAME_LOCAL_CONFIG, ...parsed };
    } catch (error) {
      console.error(`[GameRepository] Failed to load game config for ${gameId}:`, error);
      return { ...DEFAULT_GAME_LOCAL_CONFIG };
    }
  }

  /**
   * 保存游戏本地配置
   */
  saveGameConfig(gameId: string, config: GameLocalConfig): boolean {
    try {
      const configPath = getGameConfigPath(gameId);
      return safeWriteFile(configPath, JSON.stringify(config, null, 2), 'utf8');
    } catch (error) {
      console.error(`[GameRepository] Failed to save game config for ${gameId}:`, error);
      return false;
    }
  }

  /**
   * 确保索引文件存在
   *
   * 首次启动时若索引文件不存在，写入包含示例游戏"田园小镇"的默认索引，
   * 并同时写入示例游戏的 meta.json（如该文件也不存在）。
   * 已存在索引文件时不做任何操作（保留用户已有的修改或自定义游戏列表）。
   *
   * 设计动机（Task 17）：
   * - 让游戏大厅在首次启动时即可展示并可启动示例游戏"田园小镇"，
   *   避免用户面对空大厅需要手动创建游戏。
   * - 默认索引仅写入一次（已存在则跳过），用户后续可在大厅中删除/修改该示例游戏。
   *
   * 副作用：
   * - 创建 `userData/data/games/games-index.json`（含示例游戏摘要）
   * - 创建 `userData/data/games/pastoral_town/meta.json`（含示例游戏完整元数据）
   *
   * 失败处理：写入失败仅打印日志不抛错，避免阻塞主进程启动。
   */
  ensureIndexExists(): void {
    try {
      const indexPath = getGamesIndexPath();
      if (fs.existsSync(indexPath)) {
        return; // 已存在，保留现有内容
      }

      // 1. 写入示例游戏 meta.json（如不存在）
      const pastoralMetaPath = getGameMetaPath(DEFAULT_PASTORAL_TOWN_META.id);
      if (!fs.existsSync(pastoralMetaPath)) {
        const written = safeWriteFile(
          pastoralMetaPath,
          JSON.stringify(DEFAULT_PASTORAL_TOWN_META, null, 2),
          'utf8'
        );
        if (!written) {
          console.error(
            `[GameRepository] Failed to write default meta.json for ${DEFAULT_PASTORAL_TOWN_META.id}`
          );
        }
      }

      // 2. 写入默认索引（包含示例游戏摘要）
      const defaultIndex: GamesIndex = {
        version: GAMES_INDEX_VERSION,
        games: [toIndexEntry(DEFAULT_PASTORAL_TOWN_META)]
      };
      saveIndex(defaultIndex);
    } catch (error) {
      console.error('[GameRepository] Failed to ensure index exists:', error);
    }
  }
}

// ==================== 单例 ====================

export const gameRepository: GameRepository = new GameRepository();

// ==================== 模块加载时自动初始化 ====================

/**
 * 模块加载时自动确保索引存在
 *
 * 首次启动时若 `userData/data/games/games-index.json` 不存在，
 * 会写入包含示例游戏"田园小镇"的默认索引，并同时写入示例游戏的 meta.json。
 *
 * 已存在索引文件时不做任何操作（保留用户已有的修改）。
 *
 * 注意：此调用在模块加载时执行一次，无需调用方显式触发。
 * 测试环境通过 vi.mock 替换 getUserDataPath 指向临时目录，避免污染开发环境。
 */
gameRepository.ensureIndexExists();
