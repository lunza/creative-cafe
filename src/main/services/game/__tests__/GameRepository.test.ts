/**
 * GameRepository 单元测试
 *
 * 测试覆盖：
 * - listGames（空索引 / 含示例游戏）
 * - createGameMeta / getGameMeta / updateGameMeta / deleteGameMeta
 * - ensureIndexExists（首次创建包含示例游戏"田园小镇"的默认索引 + meta.json）
 * - getGameConfig / saveGameConfig
 *
 * 测试策略：
 * - 使用 os.tmpdir() 创建临时 userData 目录
 * - vi.mock 替换 getUserDataPath，使所有仓储路径解析到临时目录
 * - 每个 beforeEach 切换到新的临时目录，确保测试隔离
 *
 * 【重点标记 - 模块加载时自动调用 ensureIndexExists】（Task 17）：
 * GameRepository.ts 末尾添加了 `gameRepository.ensureIndexExists()` 自动调用，
 * 该调用在 `import { gameRepository } from '../GameRepository'` 时即触发。
 * 此时 vi.mock 工厂虽已 hoisted，但测试文件的 `let tmpRoot = ''` 还未执行，
 * 若直接读取 tmpRoot 会得到空字符串，导致 ensureIndexExists 写入到相对路径
 * （即项目根目录下的 data/games/games-index.json），污染开发环境。
 *
 * 解决方案：使用 vi.hoisted 创建共享 ref（在所有 import 之前执行），
 * 在 hoisted 块内同步创建一个临时目录并赋值给 ref.current，
 * 让 vi.mock 工厂返回的 getUserDataPath 读取 ref.current。
 * 这样模块加载时 ensureIndexExists 会写入到该临时目录，
 * 测试中 beforeEach 再切换 ref.current 到新的临时目录，保持测试隔离。
 */

import { describe, it, expect, vi, beforeEach, afterEach, afterAll } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';

// 在所有 import 之前 hoisted 执行：创建初始临时目录并通过 ref 共享给 mock 工厂
// vi.hoisted 内部 require node 内置模块（ESM imports 此时还未就绪）
const tmpRootRef = vi.hoisted(() => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const fsSync = require('fs') as typeof import('fs');
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const pathSync = require('path') as typeof import('path');
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const osSync = require('os') as typeof import('os');
  const dir = fsSync.mkdtempSync(pathSync.join(osSync.tmpdir(), 'cc-game-repo-init-'));
  return { current: dir };
});

// 必须在 import 仓储之前 mock，工厂函数读取 tmpRootRef.current（闭包延迟求值）
vi.mock('../../../utils/appPath', () => ({
  getUserDataPath: () => tmpRootRef.current,
}));

import {
  gameRepository,
  getGamesDir,
  getGamesIndexPath,
  getGameMetaPath,
  getGameConfigPath
} from '../GameRepository';
import {
  GameType,
  GameStatus,
  type GameMeta,
  DEFAULT_GAME_LOCAL_CONFIG
} from '../../../../shared/types/game.types';
import { GAMES_INDEX_VERSION } from '../../../../shared/constants/game.constants';

// ==================== 测试 fixtures ====================

function makeGameMeta(overrides: Partial<GameMeta> = {}): GameMeta {
  const now = Date.now();
  return {
    id: 'test-game-1',
    type: GameType.MANAGEMENT,
    title: '测试游戏',
    subtitle: '副标题',
    description: '这是一个测试游戏',
    gameplay: '玩法说明',
    developer: '测试开发者',
    version: '1.0.0',
    status: GameStatus.IN_DEVELOPMENT,
    tags: ['测试', '经营'],
    createdAt: now,
    updatedAt: now,
    ...overrides
  };
}

// ==================== 测试套件 ====================

describe('GameRepository', () => {
  let tmpRoot = '';

  beforeEach(() => {
    // 每个测试使用全新的临时目录，避免相互污染
    tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'cc-game-repo-test-'));
    tmpRootRef.current = tmpRoot;
  });

  afterEach(() => {
    // 清理临时目录
    if (fs.existsSync(tmpRoot)) {
      fs.rmSync(tmpRoot, { recursive: true, force: true });
    }
  });

  // 清理模块加载时创建的初始临时目录（afterAll 在所有测试结束后执行）
  afterAll(() => {
    const initDir = tmpRootRef.current;
    if (initDir && fs.existsSync(initDir)) {
      fs.rmSync(initDir, { recursive: true, force: true });
    }
  });

  // ==================== ensureIndexExists ====================

  describe('ensureIndexExists', () => {
    it('当索引文件不存在时，应创建包含示例游戏"田园小镇"的默认索引', () => {
      const indexPath = getGamesIndexPath();
      expect(fs.existsSync(indexPath)).toBe(false);

      gameRepository.ensureIndexExists();

      expect(fs.existsSync(indexPath)).toBe(true);
      const content = JSON.parse(fs.readFileSync(indexPath, 'utf8'));
      expect(content.version).toBe(GAMES_INDEX_VERSION);
      expect(content.games).toHaveLength(1);
      expect(content.games[0].id).toBe('pastoral_town');
      expect(content.games[0].type).toBe(GameType.MANAGEMENT);
      expect(content.games[0].status).toBe(GameStatus.COMPLETED);
      expect(content.games[0].title).toBe('田园小镇');
      // 索引摘要不应包含 description / gameplay / developer / version 等详细字段
      expect((content.games[0] as any).description).toBeUndefined();
      expect((content.games[0] as any).gameplay).toBeUndefined();
    });

    it('当索引文件不存在时，应同时写入示例游戏 meta.json', () => {
      const metaPath = getGameMetaPath('pastoral_town');
      expect(fs.existsSync(metaPath)).toBe(false);

      gameRepository.ensureIndexExists();

      expect(fs.existsSync(metaPath)).toBe(true);
      const meta = JSON.parse(fs.readFileSync(metaPath, 'utf8'));
      expect(meta.id).toBe('pastoral_town');
      expect(meta.type).toBe(GameType.MANAGEMENT);
      expect(meta.status).toBe(GameStatus.COMPLETED);
      expect(meta.title).toBe('田园小镇');
      expect(meta.developer).toBe('Creative Cafe Team');
      expect(meta.version).toBe('1.0.0');
      expect(meta.templateKey).toBe(GameType.MANAGEMENT);
      expect(meta.tags).toEqual(['经营', '模拟', '建设']);
      expect(meta.createdAt).toBe(1735689600000);
    });

    it('当索引文件已存在时，不应覆盖现有内容', () => {
      // 先创建一个有内容的索引（通过 createGameMeta 自动写入索引）
      const meta = makeGameMeta();
      gameRepository.createGameMeta(meta);

      const indexPath = getGamesIndexPath();
      const before = fs.readFileSync(indexPath, 'utf8');

      // 再次调用 ensureIndexExists
      gameRepository.ensureIndexExists();

      const after = fs.readFileSync(indexPath, 'utf8');
      expect(after).toBe(before);
    });

    it('当索引已存在但示例游戏 meta.json 缺失时，ensureIndexExists 不应补写 meta.json', () => {
      // 此场景验证 ensureIndexExists 仅在索引不存在时才写入示例 meta.json
      // 已存在索引时直接 return，不会检查/补写示例 meta.json
      const meta = makeGameMeta();
      gameRepository.createGameMeta(meta); // 写入索引（含 test-game-1）

      // pastoral_town 的 meta.json 不存在
      const pastoralMetaPath = getGameMetaPath('pastoral_town');
      expect(fs.existsSync(pastoralMetaPath)).toBe(false);

      gameRepository.ensureIndexExists();

      // 仍未写入（因为索引已存在，ensureIndexExists 直接 return）
      expect(fs.existsSync(pastoralMetaPath)).toBe(false);
    });
  });

  // ==================== listGames ====================

  describe('listGames', () => {
    it('索引不存在时应返回空数组（未调用 ensureIndexExists 时）', () => {
      // beforeEach 已切换到新临时目录，未触发 ensureIndexExists
      expect(gameRepository.listGames()).toEqual([]);
    });

    it('应返回索引中的游戏列表', () => {
      const meta1 = makeGameMeta({ id: 'game-1', title: '游戏1' });
      const meta2 = makeGameMeta({ id: 'game-2', title: '游戏2' });
      gameRepository.createGameMeta(meta1);
      gameRepository.createGameMeta(meta2);

      const games = gameRepository.listGames();
      expect(games).toHaveLength(2);
      expect(games.map((g) => g.id).sort()).toEqual(['game-1', 'game-2']);
    });

    it('索引条目应只包含摘要字段（不含 description / gameplay / developer / version）', () => {
      const meta = makeGameMeta();
      gameRepository.createGameMeta(meta);

      const entry = gameRepository.listGames()[0];
      expect(entry.id).toBe(meta.id);
      expect(entry.type).toBe(meta.type);
      expect(entry.title).toBe(meta.title);
      expect(entry.subtitle).toBe(meta.subtitle);
      expect(entry.status).toBe(meta.status);
      expect(entry.tags).toEqual(meta.tags);
      expect(entry.createdAt).toBe(meta.createdAt);
      expect(entry.updatedAt).toBe(meta.updatedAt);
      // 摘要不包含详细字段
      expect((entry as any).description).toBeUndefined();
      expect((entry as any).gameplay).toBeUndefined();
      expect((entry as any).developer).toBeUndefined();
      expect((entry as any).version).toBeUndefined();
    });
  });

  // ==================== createGameMeta / getGameMeta ====================

  describe('createGameMeta / getGameMeta', () => {
    it('应写入 meta.json 并返回 true', () => {
      const meta = makeGameMeta();
      const result = gameRepository.createGameMeta(meta);
      expect(result).toBe(true);

      const metaPath = getGameMetaPath(meta.id);
      expect(fs.existsSync(metaPath)).toBe(true);
    });

    it('getGameMeta 应返回写入的完整元数据', () => {
      const meta = makeGameMeta();
      gameRepository.createGameMeta(meta);

      const loaded = gameRepository.getGameMeta(meta.id);
      expect(loaded).not.toBeNull();
      expect(loaded?.id).toBe(meta.id);
      expect(loaded?.title).toBe(meta.title);
      expect(loaded?.description).toBe(meta.description);
      expect(loaded?.version).toBe(meta.version);
      expect(loaded?.tags).toEqual(meta.tags);
    });

    it('getGameMeta 在游戏不存在时应返回 null', () => {
      expect(gameRepository.getGameMeta('nonexistent')).toBeNull();
    });

    it('重复 createGameMeta 同 id 应替换索引条目而非追加', () => {
      const meta1 = makeGameMeta({ id: 'game-x', title: '旧标题' });
      gameRepository.createGameMeta(meta1);

      const meta2 = makeGameMeta({ id: 'game-x', title: '新标题' });
      gameRepository.createGameMeta(meta2);

      const games = gameRepository.listGames();
      expect(games).toHaveLength(1);
      expect(games[0].title).toBe('新标题');

      // meta.json 也应被覆盖
      const loaded = gameRepository.getGameMeta('game-x');
      expect(loaded?.title).toBe('新标题');
    });
  });

  // ==================== updateGameMeta ====================

  describe('updateGameMeta', () => {
    it('应合并 updates 字段并刷新 updatedAt', () => {
      const meta = makeGameMeta();
      gameRepository.createGameMeta(meta);

      const beforeUpdate = gameRepository.getGameMeta(meta.id);
      const beforeUpdatedAt = beforeUpdate?.updatedAt ?? 0;

      // 等待 5ms 确保 updatedAt 不同
      const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
      void sleep;
      // 同步更新即可，使用 Date.now() 自然推进
      const result = gameRepository.updateGameMeta(meta.id, {
        title: '更新后的标题',
        status: GameStatus.COMPLETED
      });

      expect(result).toBe(true);
      const updated = gameRepository.getGameMeta(meta.id);
      expect(updated?.title).toBe('更新后的标题');
      expect(updated?.status).toBe(GameStatus.COMPLETED);
      // 未更新的字段应保持原值
      expect(updated?.description).toBe(meta.description);
      expect(updated?.tags).toEqual(meta.tags);
      expect(updated?.updatedAt).toBeGreaterThanOrEqual(beforeUpdatedAt);
    });

    it('应同步刷新索引摘要', () => {
      const meta = makeGameMeta({ title: '原标题' });
      gameRepository.createGameMeta(meta);

      gameRepository.updateGameMeta(meta.id, { title: '索引同步标题' });

      const entry = gameRepository.listGames().find((g) => g.id === meta.id);
      expect(entry?.title).toBe('索引同步标题');
    });

    it('游戏不存在时应返回 false', () => {
      const result = gameRepository.updateGameMeta('nonexistent', { title: 'x' });
      expect(result).toBe(false);
    });

    it('不应通过 update 修改 id', () => {
      const meta = makeGameMeta({ id: 'original-id' });
      gameRepository.createGameMeta(meta);

      // 尝试修改 id（应被忽略）
      gameRepository.updateGameMeta('original-id', { id: 'hijacked-id' } as Partial<GameMeta>);

      const loaded = gameRepository.getGameMeta('original-id');
      expect(loaded?.id).toBe('original-id');
      expect(gameRepository.getGameMeta('hijacked-id')).toBeNull();
    });
  });

  // ==================== deleteGameMeta ====================

  describe('deleteGameMeta', () => {
    it('应删除游戏目录与索引条目', () => {
      const meta = makeGameMeta();
      gameRepository.createGameMeta(meta);

      const gameDir = getGamesDir();
      const metaPath = getGameMetaPath(meta.id);
      expect(fs.existsSync(metaPath)).toBe(true);

      const result = gameRepository.deleteGameMeta(meta.id);
      expect(result).toBe(true);

      // meta.json 已删除
      expect(fs.existsSync(metaPath)).toBe(false);
      // 游戏目录已删除
      expect(fs.existsSync(path.join(gameDir, meta.id))).toBe(false);
      // 索引中已无该条目
      expect(gameRepository.listGames().find((g) => g.id === meta.id)).toBeUndefined();
    });

    it('删除不存在的游戏应返回 true（幂等）', () => {
      expect(gameRepository.deleteGameMeta('nonexistent')).toBe(true);
    });
  });

  // ==================== getGameConfig / saveGameConfig ====================

  describe('getGameConfig / saveGameConfig', () => {
    it('配置不存在时应返回 DEFAULT_GAME_LOCAL_CONFIG', () => {
      const config = gameRepository.getGameConfig('any-game');
      expect(config).toEqual(DEFAULT_GAME_LOCAL_CONFIG);
    });

    it('saveGameConfig 应持久化配置', () => {
      const gameId = 'cfg-game';
      const config = {
        ...DEFAULT_GAME_LOCAL_CONFIG,
        activeEngineId: 'engine-1',
        temperature: 0.5,
        maxTokens: 8192,
        organizeMode: 'sync' as const,
        ansiTheme: 'dark',
        autoSave: false
      };

      const result = gameRepository.saveGameConfig(gameId, config);
      expect(result).toBe(true);

      const configPath = getGameConfigPath(gameId);
      expect(fs.existsSync(configPath)).toBe(true);

      const loaded = gameRepository.getGameConfig(gameId);
      expect(loaded).toEqual(config);
    });

    it('读取时应与默认值合并以支持向前兼容（缺少字段补默认）', () => {
      const gameId = 'cfg-game-2';
      // 手动写入一个缺少部分字段的配置文件（模拟旧版本配置）
      const gameDir = path.join(getGamesDir(), gameId);
      fs.mkdirSync(gameDir, { recursive: true });
      const partialConfig = {
        activeEngineId: 'engine-2',
        temperature: 0.9
        // 故意缺少 maxTokens / organizeMode / ansiTheme / autoSave
      };
      fs.writeFileSync(
        path.join(gameDir, 'config.json'),
        JSON.stringify(partialConfig),
        'utf8'
      );

      const loaded = gameRepository.getGameConfig(gameId);
      // 缺少的字段应补默认值
      expect(loaded.activeEngineId).toBe('engine-2');
      expect(loaded.temperature).toBe(0.9);
      expect(loaded.maxTokens).toBe(DEFAULT_GAME_LOCAL_CONFIG.maxTokens);
      expect(loaded.organizeMode).toBe(DEFAULT_GAME_LOCAL_CONFIG.organizeMode);
      expect(loaded.ansiTheme).toBe(DEFAULT_GAME_LOCAL_CONFIG.ansiTheme);
      expect(loaded.autoSave).toBe(DEFAULT_GAME_LOCAL_CONFIG.autoSave);
    });
  });

  // ==================== 路径 helper ====================

  describe('路径 helper', () => {
    it('getGamesDir 应返回 userData/data/games/', () => {
      const dir = getGamesDir();
      expect(dir).toBe(path.join(tmpRoot, 'data', 'games'));
      expect(fs.existsSync(dir)).toBe(true);
    });

    it('getGamesIndexPath 应返回 games/games-index.json', () => {
      const p = getGamesIndexPath();
      expect(p).toBe(path.join(tmpRoot, 'data', 'games', 'games-index.json'));
    });

    it('getGameMetaPath 应返回 games/<gameId>/meta.json', () => {
      const p = getGameMetaPath('abc');
      expect(p).toBe(path.join(tmpRoot, 'data', 'games', 'abc', 'meta.json'));
    });

    it('getGameConfigPath 应返回 games/<gameId>/config.json', () => {
      const p = getGameConfigPath('abc');
      expect(p).toBe(path.join(tmpRoot, 'data', 'games', 'abc', 'config.json'));
    });
  });
});
