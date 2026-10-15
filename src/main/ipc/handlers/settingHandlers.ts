import { ipcMain, BrowserWindow } from 'electron';
import path from 'path';
import { getStorageService } from '../../services/storageService';
import { AppSetting } from '../../../shared/settings';
import type { AppSetting as AppSettingType } from '../../../renderer/types/setting';
// Spec: settings-feature-optimization-report / M-10, ST-6（保存前真实结构校验，
// 与 N3 迁移链共用 shared/settingValidator 校验器）
import { validateSetting } from '../../../shared/settingValidator';
import { getUserDataPath } from '../../utils/appPath';
import { createLogger, setLogLevel } from '../../services/logger';
import { reevaluateAgentModeFromSettings } from './agentHandlers';
// Spec: settings-feature-optimization-report / M-16, N5（设置变更事件总线）
// —— 主进程侧两个直接消费方：vector 缓存失效 + LAN API 热重启
import {
  vectorConfigManager,
  settingChangedEmitter,
  SETTING_CHANGED_EVENT
} from '../../services/VectorConfigManager';
import { startLanApiServer, stopLanApiServer } from '../../services/lanApiServer/server';

const logger = createLogger('setting-handler');

// 【M-16/N5】事件总线挂接只注册一次（settingHandlers 可能被重复调用）
let settingChangedSubscriptionsRegistered = false;

/**
 * 广播设置变更事件（写盘确认成功后调用，时序风险见报告 643 行裁定）。
 * 双通道：主进程 settingChangedEmitter（vector 缓存等挂接）+ 渲染层
 * setting:changed webContents 广播（preload 订阅）。
 */
function broadcastSettingChanged(payload: { presetName?: string; engineCount: number }): void {
  settingChangedEmitter.emit(SETTING_CHANGED_EVENT, payload);
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) {
      win.webContents.send('setting:changed', payload);
    }
  }
}

/**
 * 【M-16/N5】lanApi 配置变更检测 + 热重启。
 * 开关或端口变化时重启 LAN API 服务，无需重启应用（原行为：改了不生效直到重启）。
 */
function restartLanApiIfChanged(oldSetting: AppSettingType | null, newSetting: AppSettingType): void {
  const oldLan = (oldSetting as any)?.lanApi || {};
  const newLan = (newSetting as any)?.lanApi || {};
  const oldEnabled = oldLan.enabled !== false;
  const newEnabled = newLan.enabled !== false;
  const oldPort = typeof oldLan.port === 'number' && oldLan.port > 0 ? oldLan.port : 0;
  const newPort = typeof newLan.port === 'number' && newLan.port > 0 ? newLan.port : 0;
  if (oldEnabled === newEnabled && oldPort === newPort) return;
  logger.info('lanApi 配置变更，热重启 LAN API 服务', undefined, {
    oldEnabled, newEnabled, oldPort, newPort
  });
  stopLanApiServer();
  startLanApiServer();
}

// ========== 设置读写函数（使用 StorageManager） ==========

async function loadSetting(): Promise<AppSettingType | null> {
  try {
    logger.debug('开始加载设置');
    const storageService = getStorageService();
    // L-4/ST-7：等待 initializeDefaultData 完成再读——消除冷启动「立即打开设置页
    // 读到未初始化状态」的竞态窗口（原同步 getSettings 命中该窗口返回空设置）
    await storageService.getInitializing();
    // L-4/ST-7：原同步 getSettings 的 readFileSync 阻塞主进程事件循环，改异步读取
    const setting = await storageService.getSettingsAsync();
    
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
  // 【M-16/N5】vector 域缓存挂接：设置变更后立即失效 VectorConfigManager 的
  // 5 秒缓存（原行为：vector 域最长 5s 时延且与 EmbeddingService 直读即时
  // 行为分裂，DC-8）。与 agent:modeChanged 广播同一模式，仅注册一次。
  if (!settingChangedSubscriptionsRegistered) {
    settingChangedSubscriptionsRegistered = true;
    vectorConfigManager.onSettingChanged(() => {
      vectorConfigManager.clearCache();
    });
  }

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
      const setting = await loadSetting();
      
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
      // Spec: settings-feature-optimization-report / M-10 —— 保存前真实结构校验
      // （原 validateSetting 是 no-op，坏数据静默落盘）。骨架级校验失败即拒绝保存。
      const validation = validateSetting(setting);
      if (!validation.valid) {
        logger.error('设置校验失败，拒绝保存', undefined, { errors: validation.errors });
        return { success: false, error: `设置校验失败：${validation.errors.join('；')}` };
      }
      // 【M-16/N5】保存前快照旧值，用于 lanApi 变更检测
      const oldSetting = getStorageService().getSettings();
      const success = saveSetting(setting);
      if (success) {
        if (setting.logLevel) {
          setLogLevel(setting.logLevel);
        }
        // 【重点标记】保存设置后重新评估 Agent 模式状态
        // 确保引擎切换或能力清单更新后，agentModeService 与缓存的能力清单保持同步
        reevaluateAgentModeFromSettings(setting);
        // 【M-16/N5】事件总线：写盘确认成功后才广播（报告 643 行时序裁定），
        // vector 缓存挂接在下方订阅中清除；lanApi 开关/端口变更热重启服务
        restartLanApiIfChanged(oldSetting, setting);
        broadcastSettingChanged({
          presetName: setting.preset_name,
          engineCount: setting.aiEngines?.length || 0
        });
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
  // Spec: settings-feature-optimization-report / N6, M-17 —— Result 信封化，
  // 契约与 shared/types/setting.types.ts SettingPathResult 一致（原裸返回 string
  // 与渲染层声明不符）
  ipcMain.handle('setting:getPath', async () => {
    logger.debug('收到 setting:getPath 请求');
    try {
      // [Spec: migrate-user-data-to-project-root] 原 getAppDataPath()/creative-cafe/data 硬编码
      // APPDATA，dev 重定向后不会跟随 appData/ 新数据根，收敛到 getUserDataPath()/data
      const dataPath = path.join(getUserDataPath(), 'data');
      logger.info('返回设置路径', undefined, { path: dataPath });
      return { success: true, path: dataPath };
    } catch (error) {
      logger.error('setting:getPath 处理异常', error instanceof Error ? `Error: ${error.message}` : String(error), {
        errorLocation: 'settingHandlers.ts:setting:getPath'
      });
      return { success: false, error: error instanceof Error ? error.message : '获取设置路径失败' };
    }
  });

  logger.info('Setting handlers 注册完成');
}
