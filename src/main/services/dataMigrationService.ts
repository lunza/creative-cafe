/**
 * dataMigrationService — 一次性用户数据迁移服务（旧 APPDATA 目录 → 新数据根）
 *
 * Spec: migrate-user-data-to-project-root / Task 3
 *
 * 背景：
 *   应用全部用户数据默认落在 %APPDATA%\creative-cafe（约 2.9GB），挤占 C 盘。
 *   本服务在 dev 模式首次启动时把旧目录的活跃数据整体迁移到 <projectRoot>/appData，
 *   可再生的 Chromium 缓存跳过（新位置会重建），迁移失败时回退旧目录保证系统不中断。
 *
 * 行为契约：
 *   1. 幂等：存在迁移标记 .migrated-from-appdata 或目标 data/settings.json 时直接跳过
 *   2. 白名单跳过：Cache / Code Cache / GPUCache / Dawn 系缓存 / Network / Session Storage 等可再生条目不迁移
 *   3. 永不覆盖：目标已存在的条目一律跳过
 *   4. 失败回退：任何 IO 错误 → 返回 { migrated: false, fallback: true }，
 *      调用方（index.ts）据此跳过 app.setPath('userData')，应用继续用旧目录
 *   5. 成功写标记：记录旧路径、新路径、时间戳、迁移条目数与字节数
 *
 * 跨卷迁移：C: → G: 跨卷 renameSync 会抛 EXDEV，自动降级为 cpSync 复制 + rmSync 删除。
 */

import * as fs from 'fs';
import * as path from 'path';
import { getDataRoot } from '../utils/appPath';

export interface MigrationResult {
  /** 本次是否实际迁移了数据 */
  migrated: boolean;
  /** true = 迁移失败，调用方必须跳过 setPath 回退旧目录 */
  fallback: boolean;
  /** true = 跳过（已迁移过 / 无数据可迁移） */
  skipped: boolean;
  entriesMoved?: number;
  bytesMoved?: number;
  reason?: string;
}

/** 旧目录下可再生的条目（Chromium 缓存 / 临时文件），迁移时跳过，删除后在新位置自动重建 */
export const SKIPPED_REGENERABLE_ENTRIES = new Set<string>([
  'Cache',
  'Code Cache',
  'GPUCache',
  'DawnGraphiteCache',
  'DawnWebGPUCache',
  'Service Worker',
  'Shared Dictionary',
  'Network',
  'blob_storage',
  'Session Storage',
  'DevToolsActivePort',
]);

/** 迁移标记文件名（位于新数据根下） */
export const MIGRATION_MARKER = '.migrated-from-appdata';

/**
 * 旧 userData 目录（%APPDATA%\creative-cafe）。
 * 不经过 Electron app 对象——迁移发生在 setPath 之前，且需与重定向后的
 * 默认 userData 区分，故直接由环境变量推导。
 */
export function getLegacyUserDataPath(): string {
  const appData =
    process.env.APPDATA ||
    path.join(process.env.USERPROFILE || '', 'AppData', 'Roaming');
  return path.join(appData, 'creative-cafe');
}

/** 新数据根（dev = 项目根/appData；打包 = 默认 userData） */
export function getNewDataRootPath(): string {
  return getDataRoot();
}

/** 递归统计文件/目录字节数（仅元数据遍历，不读内容） */
function entrySize(p: string): number {
  let st: fs.Stats;
  try {
    st = fs.statSync(p);
  } catch {
    return 0;
  }
  if (st.isFile()) return st.size;
  let total = 0;
  for (const name of fs.readdirSync(p)) {
    total += entrySize(path.join(p, name));
  }
  return total;
}

/**
 * 移动单个条目（不要求 dst 不存在）：同卷 renameSync（原子、快），跨卷 EXDEV → cpSync + rmSync。
 * @returns 迁移的字节数
 */
function moveEntry(src: string, dst: string): number {
  const size = entrySize(src);
  try {
    fs.renameSync(src, dst);
  } catch (err) {
    const code = (err as NodeJS.ErrnoException | null)?.code;
    if (code === 'EXDEV') {
      fs.cpSync(src, dst, { recursive: true, force: false, errorOnExist: true });
      fs.rmSync(src, { recursive: true, force: true });
    } else {
      throw err;
    }
  }
  return size;
}

/**
 * 合并移动：目录递归下沉合并，文件永不覆盖。
 * 处理上一次迁移中途崩溃留下的部分迁移状态（如目标已有空 data/ 目录），
 * 确保源端仍存在的文件能继续迁入，而目标已存在的文件一律保留（永不覆盖）。
 * @returns 迁移的字节数
 */
function mergeMove(src: string, dst: string): number {
  const st = fs.statSync(src);
  if (!st.isDirectory()) {
    return moveEntry(src, dst);
  }
  fs.mkdirSync(dst, { recursive: true });
  let total = 0;
  for (const name of fs.readdirSync(src)) {
    const s = path.join(src, name);
    const d = path.join(dst, name);
    if (fs.existsSync(d)) {
      // 两侧同名：仅当双方都是目录时继续递归合并；文件/类型冲突一律保留目标
      if (fs.statSync(s).isDirectory() && fs.statSync(d).isDirectory()) {
        total += mergeMove(s, d);
      }
    } else {
      total += mergeMove(s, d);
    }
  }
  return total;
}

/**
 * 执行一次性迁移（幂等、可回退）。
 *
 * ⚠️ 本函数为同步实现，且必须在全局数据服务模块被 import 之前调用（index.ts 模块顶层）：
 * 模块级单例（CategoryDictionaryService / ThumbnailService / storageManager 等）在构造时
 * 即锁定 userData 派生路径，若 setPath 晚于它们被 import，路径会分裂到新旧两处。
 *
 * @param fromOverride 旧目录路径覆盖（单测注入临时目录，生产不传）
 * @param toOverride 新数据根路径覆盖（单测注入临时目录，生产不传）
 */
export function migrateUserDataOnce(
  fromOverride?: string,
  toOverride?: string
): MigrationResult {
  const legacyRoot = fromOverride || getLegacyUserDataPath();
  const targetRoot = toOverride || getNewDataRootPath();
  const legacySettings = path.join(legacyRoot, 'data', 'settings.json');
  const targetSettings = path.join(targetRoot, 'data', 'settings.json');
  const markerPath = path.join(targetRoot, MIGRATION_MARKER);

  // —— 幂等短路 ——
  if (fs.existsSync(markerPath)) {
    return { migrated: false, skipped: true, fallback: false, reason: 'marker-exists' };
  }
  if (fs.existsSync(targetSettings)) {
    return { migrated: false, skipped: true, fallback: false, reason: 'target-settings-exists' };
  }
  if (!fs.existsSync(legacySettings)) {
    // 新装 / 旧目录无有效数据：无需迁移
    return { migrated: false, skipped: true, fallback: false, reason: 'legacy-settings-missing' };
  }

  try {
    fs.mkdirSync(targetRoot, { recursive: true });
    let entriesMoved = 0;
    let bytesMoved = 0;
    for (const name of fs.readdirSync(legacyRoot)) {
      // 可再生 Chromium 缓存 / 临时文件跳过
      if (SKIPPED_REGENERABLE_ENTRIES.has(name)) continue;
      if (name.endsWith('.TMP')) continue;
      const src = path.join(legacyRoot, name);
      const dst = path.join(targetRoot, name);
      // 目录递归合并、文件永不覆盖（mergeMove 内部处理）
      bytesMoved += mergeMove(src, dst);
      entriesMoved += 1;
    }

    fs.writeFileSync(
      markerPath,
      JSON.stringify(
        {
          from: legacyRoot,
          to: targetRoot,
          timestamp: new Date().toISOString(),
          entriesMoved,
          bytesMoved,
        },
        null,
        2
      )
    );
    console.log(
      `[DataMigration] migrated ${entriesMoved} entries, ` +
        `${(bytesMoved / 1024 / 1024).toFixed(1)} MB: ${legacyRoot} -> ${targetRoot}`
    );
    return { migrated: entriesMoved > 0, skipped: false, fallback: false, entriesMoved, bytesMoved };
  } catch (err) {
    // —— 失败回退：不 setPath，应用继续用旧目录 ——
    console.error('[DataMigration] migration failed, falling back to legacy userData dir:', err);
    return { migrated: false, skipped: false, fallback: true, reason: String(err) };
  }
}
