/**
 * 用户人设素材管理 IPC 处理器
 *
 * 通道列表：
 *   - persona-asset:list          读取人设素材清单
 *   - persona-asset:save          保存素材图像
 *   - persona-asset:delete        删除素材
 *   - persona-asset:getImagePath  获取素材磁盘路径
 *   - persona-asset:clearAll      清除人设全部素材
 */

import { ipcMain } from 'electron';
import { personaAssetService } from '../../services/personaAssetService';

export function registerPersonaAssetHandlers() {
  /** 读取人设素材清单 */
  ipcMain.handle(
    'persona-asset:list',
    async (_event, args: { personaId: string }) => {
      try {
        return await personaAssetService.listAssets(args.personaId);
      } catch (error) {
        console.error('[PersonaAssetHandler] list failed:', error);
        return { personaId: args?.personaId ?? '', version: 1 as const, assets: {} };
      }
    },
  );

  /** 保存素材图像 */
  ipcMain.handle(
    'persona-asset:save',
    async (
      _event,
      args: { personaId: string; imageId: string; imageBase64: string },
    ) => {
      try {
        const { personaId, imageId, imageBase64 } = args;
        return await personaAssetService.saveAsset(personaId, imageId, imageBase64);
      } catch (error) {
        console.error('[PersonaAssetHandler] save failed:', error);
        return {
          success: false,
          error: error instanceof Error ? error.message : 'Unknown error',
        };
      }
    },
  );

  /** 删除素材 */
  ipcMain.handle(
    'persona-asset:delete',
    async (_event, args: { personaId: string; imageId: string }) => {
      try {
        const { personaId, imageId } = args;
        return await personaAssetService.deleteAsset(personaId, imageId);
      } catch (error) {
        console.error('[PersonaAssetHandler] delete failed:', error);
        return {
          success: false,
          error: error instanceof Error ? error.message : 'Unknown error',
        };
      }
    },
  );

  /** 获取素材磁盘路径 */
  ipcMain.handle(
    'persona-asset:getImagePath',
    async (_event, args: { personaId: string; imageId: string }) => {
      try {
        const { personaId, imageId } = args;
        return await personaAssetService.getImagePathForRenderer(personaId, imageId);
      } catch (error) {
        console.error('[PersonaAssetHandler] getImagePath failed:', error);
        return {
          success: false,
          error: error instanceof Error ? error.message : 'Unknown error',
        };
      }
    },
  );

  /** 清除人设全部素材 */
  ipcMain.handle(
    'persona-asset:clearAll',
    async (_event, args: { personaId: string }) => {
      try {
        return await personaAssetService.clearAllAssets(args.personaId);
      } catch (error) {
        console.error('[PersonaAssetHandler] clearAll failed:', error);
        return {
          success: false,
          error: error instanceof Error ? error.message : 'Unknown error',
        };
      }
    },
  );
}
