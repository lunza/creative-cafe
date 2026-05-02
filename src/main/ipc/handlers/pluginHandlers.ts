import { ipcMain } from 'electron';
import { pluginService } from '../../services/pluginService';
import { getUserDataPath } from '../../utils/appPath';
import { getStorageService } from '../../services/storageService';

function resolveUserDataPlaceholder(dir: string): string {
  if (dir.startsWith('__USER_DATA__')) {
    return dir.replace('__USER_DATA__', getUserDataPath());
  }
  return dir;
}

export function pluginHandlers() {
  // 初始化时从设置中加载插件路径
  try {
    const storageService = getStorageService();
    const settings = storageService.getSettings();
    if (settings && settings.pluginPath) {
      const resolvedPath = resolveUserDataPlaceholder(settings.pluginPath);
      console.log('[pluginHandlers] 从设置中加载插件路径:', resolvedPath);
      pluginService.setPluginDir(resolvedPath);
    } else {
      // 如果没有设置，使用默认路径
      const defaultPath = resolveUserDataPlaceholder('__USER_DATA__/data/plugins');
      console.log('[pluginHandlers] 使用默认插件路径:', defaultPath);
      pluginService.setPluginDir(defaultPath);
    }
  } catch (error) {
    console.error('[pluginHandlers] 加载插件路径失败:', error);
    const defaultPath = resolveUserDataPlaceholder('__USER_DATA__/data/plugins');
    pluginService.setPluginDir(defaultPath);
  }

  ipcMain.handle('plugin:getAvailable', async (_event, forceRefresh?: boolean) => {
    return await pluginService.getAvailablePlugins(forceRefresh);
  });

  ipcMain.handle('plugin:getInstalled', async () => {
    return await pluginService.getInstalledPlugins();
  });

  ipcMain.handle('plugin:toggle', async (_event, pluginId: string, enabled: boolean) => {
    return await pluginService.togglePlugin(pluginId, enabled);
  });

  ipcMain.handle('plugin:uninstall', async (_event, pluginId: string) => {
    return await pluginService.uninstallPlugin(pluginId);
  });

  ipcMain.handle('plugin:getDirectory', async () => {
    return pluginService.getPluginDir();
  });

  ipcMain.handle('plugin:setDirectory', async (_event, dir: string) => {
    const resolvedDir = resolveUserDataPlaceholder(dir);
    console.log('plugin:setDirectory called with dir:', dir);
    console.log('plugin:setDirectory resolved dir:', resolvedDir);
    pluginService.setPluginDir(resolvedDir);
    const pluginDir = pluginService.getPluginDir();
    console.log('Plugin directory after setting:', pluginDir);
    return { success: true, pluginDir };
  });

  ipcMain.handle('plugin:checkUpdates', async () => {
    return await pluginService.checkAndUpdatePlugins();
  });

  ipcMain.handle('plugin:updateDescriptions', async (_event, translatedPlugins: any[]) => {
    return await pluginService.updatePluginDescriptions(translatedPlugins);
  });

  ipcMain.handle('plugin:install', async (_event, url: string, branch?: string) => {
    return await pluginService.installPlugin(url, branch);
  });

  ipcMain.handle('plugin:uninstallById', async (_event, pluginId: string) => {
    return await pluginService.uninstallPluginById(pluginId);
  });
}
