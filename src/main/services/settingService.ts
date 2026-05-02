import { getStorageService } from './storageService';

class SettingService {
  async readSetting() {
    try {
      const storageService = getStorageService();
      const setting = storageService.getSettings();
      if (setting) {
        return { success: true, data: setting };
      }
      return { success: false, error: '设置不存在' };
    } catch (error) {
      console.error('Failed to read setting:', error);
      return { success: false, error: error instanceof Error ? error.message : '读取设置失败' };
    }
  }

  async writeSetting(setting: any) {
    try {
      const storageService = getStorageService();
      storageService.setSettings(setting);
      return { success: true };
    } catch (error) {
      console.error('Failed to write setting:', error);
      return { success: false, error: error instanceof Error ? error.message : '写入设置失败' };
    }
  }

  async validateSetting(setting: any) {
    try {
      // 暂时跳过验证
      return { valid: true };
    } catch (error) {
      return { valid: false, error };
    }
  }

  setSettingPath(_path: string) {
    // 已弃用：设置现在存储在 AppData 中
    console.warn('setSettingPath 已弃用，设置现在存储在 AppData 中');
  }
}

export const settingService = new SettingService();