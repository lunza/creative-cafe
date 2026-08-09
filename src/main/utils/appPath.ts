/**
 * Electron app 路径获取工具
 * 解决 Vite 打包后 electron.app 未定义的问题
 */

import { app as electronApp } from 'electron';
import path from 'path';

// 安全地获取 electron app 对象
// 在 Vite 打包后的环境中，直接导入的 app 可能为 undefined
export const app = electronApp || (() => {
  try {
    const electron = require('electron');
    return electron?.app;
  } catch {
    return null;
  }
})();

/**
 * 安全地获取 Electron app 路径
 * @param type - 路径类型 (appData, userData, temp 等)
 * @returns 路径字符串
 */
export function getAppPath(type: string): string {
  try {
    // 优先使用安全获取的 app 对象
    if (app && typeof app.getPath === 'function') {
      return app.getPath(type);
    }
  } catch (e) {
    // 静默失败，使用兜底方案
  }
  
  // 最终兜底：使用环境变量
  switch (type) {
    case 'appData':
    case 'userData':
      return process.env.APPDATA || path.join(process.env.USERPROFILE || '', 'AppData', 'Roaming');
    case 'temp':
      return process.env.TEMP || process.env.TMP || path.join(process.env.USERPROFILE || '', 'AppData', 'Local', 'Temp');
    default:
      return process.env.APPDATA || path.join(process.env.USERPROFILE || '', 'AppData', 'Roaming');
  }
}

/**
 * 获取应用数据目录
 */
export function getAppDataPath(): string {
  return getAppPath('appData');
}

/**
 * 获取用户数据目录
 */
export function getUserDataPath(): string {
  return getAppPath('userData');
}

/**
 * 获取临时目录
 */
export function getTempPath(): string {
  return getAppPath('temp');
}

/**
 * 获取项目根目录
 * 优先使用 Electron 的 app.getAppPath()（开发环境返回项目根，含 package.json 的目录），
 * 失败时降级到 process.cwd()（与 fileService 等模块一致）。
 */
export function getProjectRoot(): string {
  try {
    if (app && typeof app.getAppPath === 'function') {
      return app.getAppPath();
    }
  } catch {
    // 静默失败，使用兜底方案
  }
  return process.cwd();
}

/**
 * 获取数据库文件存储目录。
 *
 * 开发环境（!app.isPackaged）：项目根目录/database（用户可直观查看向量文件、meta 文件等）
 * 生产环境（app.isPackaged）：userData/database（app.asar 只读，无法写入项目根）
 *
 * 用于 SqliteVecBackend 的向量 DB 文件路径 + tagRagService 的 meta 文件路径。
 */
export function getDatabaseDir(): string {
  try {
    if (app && typeof app.isPackaged === 'boolean' && !app.isPackaged) {
      // 开发环境：项目根目录/database
      return path.join(getProjectRoot(), 'database');
    }
  } catch {
    // 静默失败，使用兜底方案
  }
  // 生产环境或兜底：userData/database
  return path.join(getUserDataPath(), 'database');
}

/**
 * 将 __USER_DATA__ 占位符替换为实际用户数据路径
 * 仅当路径以 __USER_DATA__ 开头时执行替换，否则原样返回。
 * @param dir - 可能包含 __USER_DATA__ 占位符的路径
 * @returns 解析后的实际路径
 */
export function resolveUserDataPlaceholder(dir: string): string {
  if (dir.startsWith('__USER_DATA__')) {
    return dir.replace('__USER_DATA__', getUserDataPath());
  }
  return dir;
}
