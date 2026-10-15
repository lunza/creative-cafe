/**
 * dataMigrationService 单元测试
 *
 * Spec: migrate-user-data-to-project-root / Task 3 / SubTask 3.6
 *
 * 验证目标：
 *   1. 首次迁移：旧目录活跃数据（data/settings.json、data/子目录、顶层文件）移入新数据根，
 *      可再生 Chromium 缓存白名单条目（Cache/Code Cache/Network 等）与 *.TMP 被跳过
 *   2. 迁移成功写入标记文件（含旧路径/新路径/时间戳/条目数/字节数）
 *   3. 幂等：标记已存在 → 跳过；目标 data/settings.json 已存在 → 跳过；旧目录无 settings → 跳过
 *   4. 失败回退：目标路径不可建（被同名文件占用 → mkdirSync 抛错）→ fallback: true 且不写标记
 *   5. 永不覆盖：目标已存在的同名条目不被覆盖
 *
 * 测试策略：
 *   - 用 os.tmpdir() 临时目录模拟旧/新目录，走真实 fs IO（rename 同卷，覆盖 moveEntry 主路径）
 *   - vi.mock appPath 避免 electron 依赖（单测通过参数覆盖路径，不依赖 getDataRoot 真实值）
 *   - 不触碰真实 %APPDATA%
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

vi.mock('../../utils/appPath', () => ({
  getDataRoot: vi.fn(() => '/fake/appdata'),
}));

import {
  migrateUserDataOnce,
  MIGRATION_MARKER,
  SKIPPED_REGENERABLE_ENTRIES,
} from '../dataMigrationService';

let tmpRoot: string;
let fromDir: string;
let toDir: string;

function seedLegacyDir() {
  // 活跃数据
  fs.mkdirSync(path.join(fromDir, 'data', 'character-assets'), { recursive: true });
  fs.writeFileSync(path.join(fromDir, 'data', 'settings.json'), '{"engines":[]}');
  fs.writeFileSync(path.join(fromDir, 'data', 'character-assets', 'a.png'), 'png-bytes');
  fs.mkdirSync(path.join(fromDir, 'thumbnails'), { recursive: true });
  fs.writeFileSync(path.join(fromDir, 'thumbnails', 't1.png'), 'thumb');
  fs.writeFileSync(path.join(fromDir, 'character-favorites.json'), '{}');
  // 白名单可再生条目（不应迁移）
  for (const name of ['Cache', 'Code Cache', 'Network', 'Session Storage']) {
    fs.mkdirSync(path.join(fromDir, name), { recursive: true });
    fs.writeFileSync(path.join(fromDir, name, 'x.bin'), 'cache-bytes');
  }
  // 临时文件（不应迁移）
  fs.writeFileSync(path.join(fromDir, 'Preferences~abc.TMP'), 'tmp');
  // 遗留重复目录（迁移保留，Task 7 单独清理）
  fs.mkdirSync(path.join(fromDir, 'vectors'), { recursive: true });
  fs.writeFileSync(path.join(fromDir, 'vectors', 'legacy.db'), 'legacy-vector');
}

beforeEach(() => {
  tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'data-mig-test-'));
  fromDir = path.join(tmpRoot, 'legacy');
  toDir = path.join(tmpRoot, 'appData');
  fs.mkdirSync(fromDir, { recursive: true });
  seedLegacyDir();
});

afterEach(() => {
  fs.rmSync(tmpRoot, { recursive: true, force: true });
});

describe('dataMigrationService.migrateUserDataOnce', () => {
  it('首次迁移：活跃数据移入新根，白名单与 *.TMP 跳过，写迁移标记', async () => {
    const res = await migrateUserDataOnce(fromDir, toDir);

    expect(res.migrated).toBe(true);
    expect(res.fallback).toBe(false);
    expect(res.skipped).toBe(false);
    expect(res.entriesMoved).toBeGreaterThanOrEqual(4);
    expect(res.bytesMoved).toBeGreaterThan(0);

    // 活跃数据已迁移
    expect(fs.existsSync(path.join(toDir, 'data', 'settings.json'))).toBe(true);
    expect(fs.readFileSync(path.join(toDir, 'data', 'settings.json'), 'utf8')).toBe('{"engines":[]}');
    expect(fs.existsSync(path.join(toDir, 'data', 'character-assets', 'a.png'))).toBe(true);
    expect(fs.existsSync(path.join(toDir, 'thumbnails', 't1.png'))).toBe(true);
    expect(fs.existsSync(path.join(toDir, 'character-favorites.json'))).toBe(true);
    // 遗留目录随迁（删除决策在 Task 7）
    expect(fs.existsSync(path.join(toDir, 'vectors', 'legacy.db'))).toBe(true);

    // 源端已移走（move 而非 copy）
    expect(fs.existsSync(path.join(fromDir, 'data', 'settings.json'))).toBe(false);

    // 白名单可再生条目未迁移（仍留在旧目录）
    expect(fs.existsSync(path.join(toDir, 'Cache'))).toBe(false);
    expect(fs.existsSync(path.join(toDir, 'Code Cache'))).toBe(false);
    expect(fs.existsSync(path.join(toDir, 'Network'))).toBe(false);
    expect(fs.existsSync(path.join(fromDir, 'Cache', 'x.bin'))).toBe(true);

    // *.TMP 未迁移
    expect(fs.readdirSync(toDir).some((n) => n.endsWith('.TMP'))).toBe(false);

    // 标记文件写入且内容完整
    const marker = JSON.parse(fs.readFileSync(path.join(toDir, MIGRATION_MARKER), 'utf8'));
    expect(marker.from).toBe(fromDir);
    expect(marker.to).toBe(toDir);
    expect(marker.timestamp).toBeTruthy();
    expect(marker.entriesMoved).toBe(res.entriesMoved);
  });

  it('幂等：迁移标记已存在 → 跳过且不再移动', async () => {
    await migrateUserDataOnce(fromDir, toDir);
    const res = await migrateUserDataOnce(fromDir, toDir);
    expect(res.skipped).toBe(true);
    expect(res.reason).toBe('marker-exists');
    expect(res.migrated).toBe(false);
    expect(res.fallback).toBe(false);
  });

  it('幂等：目标 data/settings.json 已存在（无标记）→ 跳过', async () => {
    fs.mkdirSync(path.join(toDir, 'data'), { recursive: true });
    fs.writeFileSync(path.join(toDir, 'data', 'settings.json'), '{"x":1}');
    const res = await migrateUserDataOnce(fromDir, toDir);
    expect(res.skipped).toBe(true);
    expect(res.reason).toBe('target-settings-exists');
  });

  it('旧目录无 settings.json（新装场景）→ 跳过，不视为失败', async () => {
    fs.rmSync(path.join(fromDir, 'data', 'settings.json'));
    const res = await migrateUserDataOnce(fromDir, toDir);
    expect(res.skipped).toBe(true);
    expect(res.reason).toBe('legacy-settings-missing');
    expect(res.fallback).toBe(false);
  });

  it('失败回退：目标路径被同名文件占用 → mkdirSync 抛错 → fallback: true 且不写标记', async () => {
    fs.writeFileSync(toDir, 'blocker-file');
    const res = await migrateUserDataOnce(fromDir, toDir);
    expect(res.fallback).toBe(true);
    expect(res.migrated).toBe(false);
    expect(res.reason).toBeTruthy();
    expect(fs.existsSync(path.join(toDir, MIGRATION_MARKER))).toBe(false);
    // 旧数据未动
    expect(fs.existsSync(path.join(fromDir, 'data', 'settings.json'))).toBe(true);
  });

  it('永不覆盖：目标已存在的同名条目保留原内容', async () => {
    fs.mkdirSync(path.join(toDir, 'data'), { recursive: true });
    // 故意不放 settings.json（否则整体跳过），只占位一个子目录
    fs.mkdirSync(path.join(toDir, 'data', 'character-assets'), { recursive: true });
    fs.writeFileSync(path.join(toDir, 'data', 'character-assets', 'a.png'), 'existing-asset');
    fs.writeFileSync(path.join(fromDir, 'data', 'settings.json'), '{"engines":[]}');

    const res = await migrateUserDataOnce(fromDir, toDir);
    expect(res.fallback).toBe(false);
    // a.png 未被覆盖，settings.json 正常迁入
    expect(fs.readFileSync(path.join(toDir, 'data', 'character-assets', 'a.png'), 'utf8')).toBe('existing-asset');
    expect(fs.existsSync(path.join(toDir, 'data', 'settings.json'))).toBe(true);
  });

  it('白名单常量与 spec 约定一致', () => {
    for (const name of [
      'Cache', 'Code Cache', 'GPUCache', 'DawnGraphiteCache', 'DawnWebGPUCache',
      'Service Worker', 'Shared Dictionary', 'Network', 'blob_storage',
      'Session Storage', 'DevToolsActivePort',
    ]) {
      expect(SKIPPED_REGENERABLE_ENTRIES.has(name)).toBe(true);
    }
  });
});
