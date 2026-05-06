import { ipcMain } from 'electron';
import fs from 'fs';
import path from 'path';
import { getStorageService } from '../../services/storageService';
import { AppSetting } from '../../../shared/settings';
import type { AppSetting as AppSettingType } from '../../../renderer/types/setting';
import { getAppDataPath } from '../../utils/appPath';

// 日志级别
const LOG_LEVELS = {
  ERROR: 'ERROR',
  WARN: 'WARN',
  INFO: 'INFO',
  DEBUG: 'DEBUG'
};

// ========== 主进程日志函数（写入文件 + console） ==========

// 获取日志目录的路径（使用 AppData）
const getLogDir = (): string => {
  return path.join(getAppDataPath(), 'creative-cafe', 'logs');
};

// 获取日志文件路径
const getLogPath = (): string => {
  return path.join(getLogDir(), 'setting-handler.log');
};

// 简单日志函数
const logToFile = (level: string, message: string, details?: string) => {
  try {
    const logDir = getLogDir();
    if (!fs.existsSync(logDir)) {
      fs.mkdirSync(logDir, { recursive: true });
    }

    const logPath = getLogPath();
    const timestamp = new Date().toISOString();
    const displayTime = new Date().toLocaleString('zh-CN', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false
    });

    const levelPrefix = `[${level.padEnd(5)}]`;
    const timePrefix = `[${displayTime}]`;
    let logMessage = `${timePrefix} ${levelPrefix} ${message}`;

    if (details) {
      logMessage += `\n${' '.repeat(20)}${details.split('\n').join('\n' + ' '.repeat(20))}`;
    }

    fs.appendFileSync(logPath, logMessage + '\n\n');
  } catch (e) {
    // 日志写入失败时静默处理，避免影响主功能
  }
};

// 详细日志函数
const logDetailed = (level: string, title: string, data: any) => {
  try {
    const details = JSON.stringify(data, null, 2);
    logToFile(level, `${title}`, details);
  } catch (e) {
    logToFile(level, `${title}: ${String(data)}`);
  }
};

// 错误日志
const logError = (message: string, error?: Error, context?: any) => {
  const errorDetails = error ? `Error: ${error.message}\nStack: ${error.stack || 'No stack'}` : '';
  const contextDetails = context ? `Context: ${JSON.stringify(context, null, 2)}` : '';
  const details = [errorDetails, contextDetails].filter(Boolean).join('\n');
  logToFile(LOG_LEVELS.ERROR, message, details);
  console.error(`[Setting Handler] ${message}`, error, context);
};

// 信息日志
const logInfo = (message: string, context?: any) => {
  const contextDetails = context ? `Context: ${JSON.stringify(context, null, 2)}` : '';
  logToFile(LOG_LEVELS.INFO, message, contextDetails);
  console.info(`[Setting Handler] ${message}`, context);
};

// 警告日志
const logWarn = (message: string, context?: any) => {
  const contextDetails = context ? `Context: ${JSON.stringify(context, null, 2)}` : '';
  logToFile(LOG_LEVELS.WARN, message, contextDetails);
  console.warn(`[Setting Handler] ${message}`, context);
};

// 调试日志
const logDebug = (message: string, context?: any) => {
  const contextDetails = context ? `Context: ${JSON.stringify(context, null, 2)}` : '';
  logToFile(LOG_LEVELS.DEBUG, message, contextDetails);
  console.debug(`[Setting Handler] ${message}`, context);
};

// ========== 设置读写函数（使用 StorageManager） ==========

function loadSetting(): AppSettingType | null {
  try {
    logDebug('开始加载设置');
    const storageService = getStorageService();
    const setting = storageService.getSettings();
    
    if (setting) {
      logInfo('设置加载成功', {
        presetName: setting.preset_name || 'unknown',
        engineCount: setting.aiEngines?.length || 0
      });
      return setting;
    }

    logWarn('设置不存在，将使用默认设置');
    return null;
  } catch (error) {
    logError('加载设置失败', error, {
      errorType: error instanceof Error ? error.name : 'UnknownError',
      errorLocation: 'settingHandlers.ts:loadSetting',
      errorMessage: error instanceof Error ? error.message : String(error)
    });
    return null;
  }
}

function saveSetting(setting: AppSettingType): boolean {
  try {
    logInfo('开始保存设置', {
      presetName: setting.preset_name || 'unknown',
      dataSize: JSON.stringify(setting).length
    });

    const storageService = getStorageService();
    storageService.setSettings(setting);
    
    logInfo('设置保存成功', {
      presetName: setting.preset_name || 'unknown'
    });
    return true;
  } catch (error) {
    // 详细错误分类
    if (error instanceof Error) {
      if (error.message.includes('EACCES')) {
        logError('文件权限错误：无法写入设置文件', error, {
          errorLocation: 'settingHandlers.ts:saveSetting',
          suggestion: '请检查应用程序是否有写入权限'
        });
      } else if (error.message.includes('ENOSPC')) {
        logError('磁盘空间不足：无法保存设置', error, {
          errorLocation: 'settingHandlers.ts:saveSetting',
          suggestion: '请清理磁盘空间后重试'
        });
      } else {
        logError('保存设置失败', error, {
          errorType: error.name,
          errorLocation: 'settingHandlers.ts:saveSetting',
          errorMessage: error.message,
          stack: error.stack
        });
      }
    } else {
      logError('保存设置时发生未知错误', undefined, {
        errorLocation: 'settingHandlers.ts:saveSetting',
        errorValue: String(error)
      });
    }
    return false;
  }
}

// ========== IPC Handler 注册 ==========

export function settingHandlers(): void {
  logInfo('Setting handlers 初始化');

  // 加载设置
  ipcMain.handle('setting:load', async () => {
    logDebug('收到 setting:load 请求');
    try {
      const setting = loadSetting();
      
      if (setting) {
        return { success: true, setting };
      } else {
        logWarn('设置不存在，返回默认设置');
        const defaultSetting = AppSetting.defaultSetting as AppSettingType;
        return { success: true, setting: defaultSetting };
      }
    } catch (error) {
      logError('setting:load 处理异常', error, {
        errorLocation: 'settingHandlers.ts:setting:load'
      });
      return { 
        success: false, 
        error: error instanceof Error ? error.message : '加载设置失败' 
      };
    }
  });

  // 保存设置
  ipcMain.handle('setting:save', async (_event, setting: AppSettingType) => {
    logDebug('收到 setting:save 请求', {
      presetName: setting.preset_name,
      engineCount: setting.aiEngines?.length || 0
    });
    
    try {
      const success = saveSetting(setting);
      if (success) {
        return { success: true };
      } else {
        return { 
          success: false, 
          error: '保存设置失败，请检查日志获取详细信息' 
        };
      }
    } catch (error) {
      logError('setting:save 处理异常', error, {
        errorLocation: 'settingHandlers.ts:setting:save',
        presetName: setting.preset_name
      });
      return { 
        success: false, 
        error: error instanceof Error ? error.message : '保存设置时发生未知错误' 
      };
    }
  });

  // 获取设置路径（返回 AppData 路径）
  ipcMain.handle('setting:getPath', async () => {
    logDebug('收到 setting:getPath 请求');
    const dataPath = path.join(getAppDataPath(), 'creative-cafe', 'data');
    logInfo('返回设置路径', { path: dataPath });
    return dataPath;
  });

  logInfo('Setting handlers 注册完成');
}
