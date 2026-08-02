import { ipcMain } from 'electron';
import path from 'path';
import { getStorageService } from '../../services/storageService';
import { AppSetting } from '../../../shared/settings';
import type { AppSetting as AppSettingType } from '../../../renderer/types/setting';
import { getAppDataPath } from '../../utils/appPath';
import { createLogger, setLogLevel } from '../../services/logger';
import { reevaluateAgentModeFromSettings } from './agentHandlers';

const logger = createLogger('setting-handler');

// ========== 设置读写函数（使用 StorageManager） ==========

function loadSetting(): AppSettingType | null {
  try {
    logger.debug('开始加载设置');
    const storageService = getStorageService();
    const setting = storageService.getSettings();
    
    if (setting) {
      logger.info('设置加载成功', undefined, {
        presetName: setting.preset_name || 'unknown',
        engineCount: setting.aiEngines?.length || 0
      });
      return setting;
    }

    logger.warn('设置不存在，将使用默认设置');
    return null;
  } catch (error) {
    logger.error('加载设置失败', error instanceof Error ? `Error: ${error.message}\nStack: ${error.stack || 'No stack'}` : String(error), {
      errorType: error instanceof Error ? error.name : 'UnknownError',
      errorLocation: 'settingHandlers.ts:loadSetting',
      errorMessage: error instanceof Error ? error.message : String(error)
    });
    return null;
  }
}

function saveSetting(setting: AppSettingType): boolean {
  try {
    logger.info('开始保存设置', undefined, {
      presetName: setting.preset_name || 'unknown',
      dataSize: JSON.stringify(setting).length
    });

    const storageService = getStorageService();
    storageService.setSettings(setting);
    
    logger.info('设置保存成功', undefined, {
      presetName: setting.preset_name || 'unknown'
    });
    return true;
  } catch (error) {
    // 详细错误分类
    if (error instanceof Error) {
      if (error.message.includes('EACCES')) {
        logger.error('文件权限错误：无法写入设置文件', `Error: ${error.message}\nStack: ${error.stack || 'No stack'}`, {
          errorLocation: 'settingHandlers.ts:saveSetting',
          suggestion: '请检查应用程序是否有写入权限'
        });
      } else if (error.message.includes('ENOSPC')) {
        logger.error('磁盘空间不足：无法保存设置', `Error: ${error.message}\nStack: ${error.stack || 'No stack'}`, {
          errorLocation: 'settingHandlers.ts:saveSetting',
          suggestion: '请清理磁盘空间后重试'
        });
      } else {
        logger.error('保存设置失败', `Error: ${error.message}\nStack: ${error.stack || 'No stack'}`, {
          errorType: error.name,
          errorLocation: 'settingHandlers.ts:saveSetting',
          errorMessage: error.message,
          stack: error.stack
        });
      }
    } else {
      logger.error('保存设置时发生未知错误', undefined, {
        errorLocation: 'settingHandlers.ts:saveSetting',
        errorValue: String(error)
      });
    }
    return false;
  }
}

// ========== IPC Handler 注册 ==========

export function settingHandlers(): void {
  // 预加载日志级别
  try {
    const storageService = getStorageService();
    const settings = storageService.getSettings();
    if (settings?.logLevel) {
      setLogLevel(settings.logLevel);
    }
  } catch (e) {
    // 读取失败时保持默认 'info' 级别
  }

  logger.info('Setting handlers 初始化');

  // 加载设置
  ipcMain.handle('setting:load', async () => {
    logger.debug('收到 setting:load 请求');
    try {
      const setting = loadSetting();
      
      if (setting) {
        if (setting.logLevel) {
          setLogLevel(setting.logLevel);
        }
        return { success: true, setting };
      } else {
        logger.warn('设置不存在，返回默认设置');
        const defaultSetting = AppSetting.defaultSetting as AppSettingType;
        return { success: true, setting: defaultSetting };
      }
    } catch (error) {
      logger.error('setting:load 处理异常', error instanceof Error ? `Error: ${error.message}\nStack: ${error.stack || 'No stack'}` : String(error), {
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
    logger.debug('收到 setting:save 请求', undefined, {
      presetName: setting.preset_name,
      engineCount: setting.aiEngines?.length || 0
    });
    
    try {
      const success = saveSetting(setting);
      if (success) {
        if (setting.logLevel) {
          setLogLevel(setting.logLevel);
        }
        // 【重点标记】保存设置后重新评估 Agent 模式状态
        // 确保引擎切换或能力清单更新后，agentModeService 与缓存的能力清单保持同步
        reevaluateAgentModeFromSettings(setting);
        return { success: true };
      } else {
        return { 
          success: false, 
          error: '保存设置失败，请检查日志获取详细信息' 
        };
      }
    } catch (error) {
      logger.error('setting:save 处理异常', error instanceof Error ? `Error: ${error.message}\nStack: ${error.stack || 'No stack'}` : String(error), {
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
    logger.debug('收到 setting:getPath 请求');
    const dataPath = path.join(getAppDataPath(), 'creative-cafe', 'data');
    logger.info('返回设置路径', undefined, { path: dataPath });
    return dataPath;
  });

  logger.info('Setting handlers 注册完成');
}
