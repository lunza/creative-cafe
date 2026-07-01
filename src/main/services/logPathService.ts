import * as fs from 'fs';
import * as path from 'path';

function getLogBaseDir(): string {
  try {
    // 获取 Electron 应用的安装路径
    const { app } = require('electron');
    const appPath = app.getAppPath();
    return path.join(appPath, 'logs');
  } catch (e) {
    // 降级方案：使用 __dirname 向上推导到项目根目录
    // src/main/services/logPathService.ts -> 项目根目录
    const projectRoot = path.join(__dirname, '..', '..', '..');
    return path.join(projectRoot, 'logs');
  }
}

export function getLogDir(): string {
  const logBaseDir = getLogBaseDir();
  if (!fs.existsSync(logBaseDir)) {
    fs.mkdirSync(logBaseDir, { recursive: true });
  }
  return logBaseDir;
}

/**
 * 获取模块专属日志目录：logs/<moduleName>/
 * 按模块分目录存放日志文件，避免所有日志散落在 logs 根目录
 */
export function getModuleLogDir(moduleName: string): string {
  const moduleDir = path.join(getLogDir(), moduleName);
  if (!fs.existsSync(moduleDir)) {
    fs.mkdirSync(moduleDir, { recursive: true });
  }
  return moduleDir;
}

export function getLogFilePath(fileName: string): string {
  return path.join(getLogDir(), fileName);
}
