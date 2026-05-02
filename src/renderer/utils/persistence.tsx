import { AppSetting } from '../types/setting';
import { useLogStore } from '../stores/logStore';

// 存储键名
const STORAGE_KEY = 'travenManagerSetting';
const VERSION_KEY = 'travenManagerVersion';

// 添加日志的函数
const addLog = (message: string, type: 'error' | 'warn' | 'info' | 'debug' = 'info') => {
  // 由于 persistence.tsx 不是 React 组件，不能直接使用 useLogStore 钩子
  // 这里直接使用 console.log 作为备选
  console.log(`[${type.toUpperCase()}] ${message}`);
};

/**
 * 检查 localStorage 是否可用
 * @returns 是否可用
 */
const isLocalStorageAvailable = (): boolean => {
  try {
    const testKey = '__travenManagerTest__';
    localStorage.setItem(testKey, testKey);
    localStorage.removeItem(testKey);
    return true;
  } catch (error) {
    return false;
  }
};

/**
 * 持久化模块 - 处理配置的存储和读取
 */
export class Persistence {
  /**
   * 保存配置到本地存储
   * @param setting 设置对象
   * @returns 是否保存成功
   */
  static saveSetting(setting: AppSetting): boolean {
    try {
      addLog('开始保存设置', 'info');
      addLog(`设置对象: ${JSON.stringify(setting)}`, 'info');
      
      // 检查设置是否为null或undefined
      if (!setting) {
        addLog('设置对象为null或undefined', 'error');
        return false;
      }
      
      addLog('设置对象有效', 'debug');
      
      // 检查设置是否可以被序列化
      let serializedSetting;
      try {
        serializedSetting = JSON.stringify(setting);
        addLog(`设置序列化成功，长度: ${serializedSetting.length}`, 'info');
      } catch (serializationError) {
        addLog(`设置序列化失败: ${serializationError}`, 'error');
        return false;
      }
      
      // 检查 localStorage 是否可用
      if (isLocalStorageAvailable()) {
        addLog('使用 localStorage 保存设置', 'info');
        try {
          // 先清除旧配置
          localStorage.removeItem(STORAGE_KEY);
          addLog('旧设置已清除', 'info');
          
          // 保存新设置
          localStorage.setItem(STORAGE_KEY, serializedSetting);
          addLog('设置保存到 localStorage 成功', 'info');
          
          // 验证保存是否成功
          const savedSetting = localStorage.getItem(STORAGE_KEY);
          if (savedSetting) {
            addLog(`设置验证成功，长度: ${savedSetting.length}`, 'info');
            
            // 验证设置是否正确
            try {
              const parsedSetting = JSON.parse(savedSetting);
              addLog('设置解析成功', 'info');
              addLog(`保存的设置: ${JSON.stringify(parsedSetting)}`, 'info');
            } catch (parseError) {
              addLog(`设置解析失败: ${parseError}`, 'error');
              return false;
            }
            
            return true;
          } else {
            addLog('配置保存后读取失败', 'error');
            return false;
          }
        } catch (storageError) {
          addLog(`保存到 localStorage 失败: ${storageError}`, 'error');
          return false;
        }
      } else {
        addLog('localStorage 不可用', 'error');
        return false;
      }
    } catch (error) {
      addLog(`保存设置失败: ${error}`, 'error');
      return false;
    }
  }

  /**
   * 从本地存储读取设置
   * @returns 设置对象或null
   */
  static readSetting(): AppSetting | null {
    try {
      addLog('开始从本地存储读取设置', 'info');
      
      // 检查 localStorage 是否可用
      if (isLocalStorageAvailable()) {
        addLog('使用 localStorage 读取设置', 'info');
        
        // 从 localStorage 读取设置
        const serializedSetting = localStorage.getItem(STORAGE_KEY);
        addLog(`从 localStorage 读取设置: ${serializedSetting ? '成功' : '失败'}`, 'info');
        
        if (!serializedSetting) {
          addLog('没有找到保存的设置', 'info');
          return null;
        }
        
        try {
          const setting = JSON.parse(serializedSetting);
          addLog('设置读取成功', 'info');
          addLog(`读取的设置: ${JSON.stringify(setting)}`, 'info');
          return setting;
        } catch (parseError) {
          addLog(`设置解析失败: ${parseError}`, 'error');
          return null;
        }
      } else {
        addLog('localStorage 不可用', 'error');
        return null;
      }
    } catch (error) {
      addLog(`读取设置失败: ${error}`, 'error');
      return null;
    }
  }

  /**
   * 保存版本信息
   * @param version 版本号
   * @returns 是否保存成功
   */
  static saveVersion(version: string): boolean {
    try {
      if (isLocalStorageAvailable()) {
        localStorage.setItem(VERSION_KEY, version);
        return true;
      }
      return false;
    } catch (error) {
      console.error('保存版本信息失败:', error);
      return false;
    }
  }

  /**
   * 读取版本信息
   * @returns 版本号或null
   */
  static loadVersion(): string | null {
    try {
      if (isLocalStorageAvailable()) {
        return localStorage.getItem(VERSION_KEY);
      }
      return null;
    } catch (error) {
      console.error('读取版本信息失败:', error);
      return null;
    }
  }

  /**
   * 清除所有配置
   * @returns 是否清除成功
   */
  static clearAll(): boolean {
    try {
      if (isLocalStorageAvailable()) {
        localStorage.removeItem(STORAGE_KEY);
        localStorage.removeItem(VERSION_KEY);
        return true;
      }
      return false;
    } catch (error) {
      console.error('清除配置失败:', error);
      return false;
    }
  }

  /**
   * 检查存储是否可用
   * @returns 是否可用
   */
  static isStorageAvailable(): boolean {
    return isLocalStorageAvailable();
  }
}
