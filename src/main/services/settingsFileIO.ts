/**
 * settings.json 文件 I/O 辅助（Spec: settings-feature-optimization-report / H-2 + H-4 + H-12）
 *
 * 解决三个深层顽疾：
 * 1. 非原子写：writeFileSync 直接覆盖，崩溃中途产生半截 JSON（DC-3/ST-3）
 *    → tmp 文件 + rename 原子替换
 * 2. 损坏零恢复：坏文件静默留存，IPC 返回内存默认值，磁盘永不修复（ST-3/DC-2）
 *    → 读取失败时备份坏文件为 .corrupt-<时间戳> 并原子重写空对象
 * 3. 无迁移：parse 后即用，结构演进靠隐式兜底（DC-2）
 *    → 读取成功后先过 migrateSettings 迁移链（shared/settingMigrations.ts）
 *
 * 纯 fs 模块，不导入 electron，可在 vitest node 环境单测。
 *
 * 串行化说明：所有 settings.json 写操作最终收敛到 StorageManager.writeToSettingsFile
 * 这一唯一同步写路径（本模块提供原子写实现）。Node 单线程事件循环保证同步写操作
 * 之间不会交错，由此消除原「storageService 双写 + 知识库 read-modify-write」的
 * lost-update 竞态窗口（DC-3）。
 */

import fs from 'fs';
import fsp from 'fs/promises';
import { migrateSettings } from '../../shared/settingMigrations';

export type SettingsLogLevel = 'error' | 'warn' | 'info' | 'debug';
export type SettingsLogFn = (message: string, type?: SettingsLogLevel, context?: any) => void;

/**
 * 原子写 JSON 文件：先写 .tmp 临时文件，再 unlink 目标 + rename。
 * Windows 下 fs.rename 无法覆盖已存在文件，故先删除目标。
 * 崩溃窗口内磁盘上要么是完整的旧文件、要么是完整的 .tmp 文件，不会出现半截 JSON。
 */
export function atomicWriteJsonSync(filePath: string, data: unknown): void {
  const tmpPath = `${filePath}.tmp`;
  fs.writeFileSync(tmpPath, JSON.stringify(data, null, 2), 'utf-8');
  if (fs.existsSync(filePath)) {
    fs.unlinkSync(filePath);
  }
  fs.renameSync(tmpPath, filePath);
}

export type JsonFileRead =
  | { status: 'missing' }
  | { status: 'ok'; data: any }
  | { status: 'corrupt'; error: Error };

/** 读取并解析 JSON 文件。文件不存在返回 missing，解析失败返回 corrupt。 */
export function readJsonFile(filePath: string): JsonFileRead {
  if (!fs.existsSync(filePath)) {
    return { status: 'missing' };
  }
  try {
    return { status: 'ok', data: JSON.parse(fs.readFileSync(filePath, 'utf-8')) };
  } catch (error) {
    return { status: 'corrupt', error: error as Error };
  }
}

/**
 * 损坏恢复：把坏文件备份为 `<filePath>.corrupt-<时间戳>`，原子重写为空对象，返回空对象。
 * 空对象语义与「文件缺失」一致（readFromSettingsFile 对缺失文件返回 {}），
 * 上层 loadSetting 拿到空对象后走默认设置路径，应用以默认值运行且磁盘文件已被修复。
 *
 * @returns 恢复后的对象（{}）；备份本身也失败时返回 null（调用方走原降级路径）
 */
export function recoverCorruptSettingsFile(filePath: string, log: SettingsLogFn): any | null {
  try {
    const backupPath = `${filePath}.corrupt-${Date.now()}`;
    fs.copyFileSync(filePath, backupPath);
    atomicWriteJsonSync(filePath, {});
    log(`settings.json 检测到损坏，已备份坏文件至 ${backupPath} 并重写为空对象`, 'warn', {
      errorLocation: 'settingsFileIO.ts:recoverCorruptSettingsFile'
    });
    return {};
  } catch (backupError) {
    log(`settings.json 损坏恢复失败（备份亦失败）: ${backupError instanceof Error ? backupError.message : '未知错误'}`, 'error', {
      errorLocation: 'settingsFileIO.ts:recoverCorruptSettingsFile'
    });
    return null;
  }
}

export interface SettingsReadResult {
  /** 迁移后的设置对象；文件不存在时为 null */
  data: any;
  /** 是否触发了损坏恢复 */
  corrupted: boolean;
  /** 迁移变更清单（审计用） */
  migrated: string[];
  /** 读取/迁移结果与磁盘内容不一致（损坏恢复或迁移发生），调用方应原子回写 */
  needsWriteBack: boolean;
}

/**
 * settings.json 统一读取入口：读取 → 损坏恢复 → schema 迁移。
 * 三个原读取路径（storageService.getSettings / getSettingsAsync / storageManager.readFromSettingsFile）
 * 全部收敛到本函数，保证损坏恢复与迁移行为一致。
 */
export function readSettingsFile(settingsPath: string, log: SettingsLogFn): SettingsReadResult {
  const file = readJsonFile(settingsPath);

  if (file.status === 'missing') {
    return { data: null, corrupted: false, migrated: [], needsWriteBack: false };
  }

  if (file.status === 'corrupt') {
    log(`settings.json 解析失败（${file.error.message}），启动损坏恢复`, 'warn', {
      errorLocation: 'settingsFileIO.ts:readSettingsFile'
    });
    const recovered = recoverCorruptSettingsFile(settingsPath, log);
    return { data: recovered, corrupted: true, migrated: [], needsWriteBack: recovered !== null };
  }

  const { setting, changes, needsWriteBack } = migrateSettings(file.data);
  if (changes.length > 0) {
    log(`settings.json schema 迁移完成（v1→当前）: ${changes.join('; ')}`, 'info', {
      errorLocation: 'settingsFileIO.ts:readSettingsFile',
      changes
    });
  }
  return { data: setting, corrupted: false, migrated: changes, needsWriteBack };
}

// ========== 异步变体（L-4/ST-7：启动期同步 I/O 异步化） ==========
// 同步 readSettingsFile 的 readFileSync 在主进程解析 1400+ 行 JSON 时阻塞事件循环；
// 冷启动 settings:load 命中同步路径 + initializeDefaultData 后台竞态窗口 → 偶发空设置。
// 异步变体用 fs.promises 读文件，行为（损坏恢复 + 迁移）与同步版完全一致。
// 写回仍用 atomicWriteJsonSync：写操作必须与唯一同步写路径（H-2）串行化，
// 异步 rename 会重开 lost-update 竞态窗口。

/** 异步读取并解析 JSON 文件。文件不存在返回 missing，解析失败返回 corrupt。 */
export async function readJsonFileAsync(filePath: string): Promise<JsonFileRead> {
  try {
    const content = await fsp.readFile(filePath, 'utf-8');
    return { status: 'ok', data: JSON.parse(content) };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return { status: 'missing' };
    }
    return { status: 'corrupt', error: error as Error };
  }
}

/** 异步损坏恢复：备份坏文件 + 原子重写空对象（语义与同步版一致）。 */
export async function recoverCorruptSettingsFileAsync(filePath: string, log: SettingsLogFn): Promise<any | null> {
  try {
    const backupPath = `${filePath}.corrupt-${Date.now()}`;
    await fsp.copyFile(filePath, backupPath);
    atomicWriteJsonSync(filePath, {});
    log(`settings.json 检测到损坏，已备份坏文件至 ${backupPath} 并重写为空对象`, 'warn', {
      errorLocation: 'settingsFileIO.ts:recoverCorruptSettingsFileAsync'
    });
    return {};
  } catch (backupError) {
    log(`settings.json 损坏恢复失败（备份亦失败）: ${backupError instanceof Error ? backupError.message : '未知错误'}`, 'error', {
      errorLocation: 'settingsFileIO.ts:recoverCorruptSettingsFileAsync'
    });
    return null;
  }
}

/** 异步版 settings.json 统一读取入口：读取 → 损坏恢复 → schema 迁移（L-4/ST-7）。 */
export async function readSettingsFileAsync(settingsPath: string, log: SettingsLogFn): Promise<SettingsReadResult> {
  const file = await readJsonFileAsync(settingsPath);

  if (file.status === 'missing') {
    return { data: null, corrupted: false, migrated: [], needsWriteBack: false };
  }

  if (file.status === 'corrupt') {
    log(`settings.json 解析失败（${file.error.message}），启动损坏恢复`, 'warn', {
      errorLocation: 'settingsFileIO.ts:readSettingsFileAsync'
    });
    const recovered = await recoverCorruptSettingsFileAsync(settingsPath, log);
    return { data: recovered, corrupted: true, migrated: [], needsWriteBack: recovered !== null };
  }

  const { setting, changes, needsWriteBack } = migrateSettings(file.data);
  if (changes.length > 0) {
    log(`settings.json schema 迁移完成（v1→当前）: ${changes.join('; ')}`, 'info', {
      errorLocation: 'settingsFileIO.ts:readSettingsFileAsync',
      changes
    });
  }
  return { data: setting, corrupted: false, migrated: changes, needsWriteBack };
}
