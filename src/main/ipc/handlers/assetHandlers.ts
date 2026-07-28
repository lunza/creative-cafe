/**
 * 素材管理 IPC 处理器（Spec: add-asset-and-trait-management / Task 7）
 *
 * 通道列表：
 *   - asset:list          读取角色卡 × assetType 的素材包 manifest
 *   - asset:save          保存素材图像（base64）并更新 manifest
 *   - asset:delete        删除指定素材图像并从 manifest 移除
 *   - asset:getImagePath  获取指定素材的图像绝对路径（包装为 { success, imagePath, error? }）
 *
 * 注册模式参照 registerExpressionHandlers()：导出 registerAssetHandlers() 函数。
 *
 * 参数与返回值与 assetService 方法签名对齐：
 *   - listAssets     : (characterCardId, assetType) => Promise<AssetManifest>
 *   - saveAsset      : (characterCardId, assetType, assetId, imageBase64, slot?) =>
 *                      Promise<{ success, error?, imagePath? }>
 *   - deleteAsset    : (characterCardId, assetType, assetId) => Promise<{ success, error? }>
 *   - getAssetPath   : (characterCardId, assetType, assetId) => Promise<string | null>
 *
 * 注意：asset:getImagePath 把 service 返回的 string|null 包装为
 *       `{ success, imagePath: string|null, error? }` 结构，
 *       与 expression:getImagePath 返回结构保持一致，便于 store 统一处理。
 *
 * service 内部已 try/catch 兜底；外层 handler 再 try/catch 提供 IPC 兜底。
 */
import { ipcMain } from 'electron';
import { assetService } from '../../services/assetService';
import type { AssetType, ThreeViewSlot } from '../../services/assetService';

export function registerAssetHandlers() {
  /**
   * 读取指定角色卡 × assetType 的素材清单。
   * 不存在时返回默认空 manifest（service 内部已处理）。
   */
  ipcMain.handle(
    'asset:list',
    async (
      _event,
      args: {
        characterCardId: string;
        assetType: AssetType;
      }
    ) => {
      try {
        const { characterCardId, assetType } = args;
        return await assetService.listAssets(characterCardId, assetType);
      } catch (error) {
        console.error('[AssetHandler] list failed:', error);
        // 兜底返回空 manifest，与 service 的错误返回形态一致
        return {
          characterCardId: args?.characterCardId ?? '',
          version: 1 as const,
          assets: {},
        };
      }
    }
  );

  /**
   * 保存素材图像并更新 manifest。
   * - 三视图类型 assetId 仅允许 front / side / back（service 内部校验）
   * - 非 three-view 类型忽略 slot
   * - 返回 imagePath 为图像绝对路径
   */
  ipcMain.handle(
    'asset:save',
    async (
      _event,
      args: {
        characterCardId: string;
        assetType: AssetType;
        assetId: string;
        imageBase64: string;
        slot?: ThreeViewSlot;
      }
    ) => {
      try {
        const { characterCardId, assetType, assetId, imageBase64, slot } = args;
        return await assetService.saveAsset(
          characterCardId,
          assetType,
          assetId,
          imageBase64,
          slot
        );
      } catch (error) {
        console.error('[AssetHandler] save failed:', error);
        return {
          success: false,
          error: error instanceof Error ? error.message : 'Unknown error',
        };
      }
    }
  );

  /**
   * 删除指定素材的图像文件并从 manifest.assets 移除条目。
   * - 图像不存在视为幂等成功
   * - manifest 不存在该条目时不更新 manifest
   */
  ipcMain.handle(
    'asset:delete',
    async (
      _event,
      args: {
        characterCardId: string;
        assetType: AssetType;
        assetId: string;
      }
    ) => {
      try {
        const { characterCardId, assetType, assetId } = args;
        return await assetService.deleteAsset(characterCardId, assetType, assetId);
      } catch (error) {
        console.error('[AssetHandler] delete failed:', error);
        return {
          success: false,
          error: error instanceof Error ? error.message : 'Unknown error',
        };
      }
    }
  );

  /**
   * 获取指定素材的图像绝对路径，包装为 { success, imagePath, error? } 结构。
   * - 文件不存在：imagePath = null，success = true
   * - 异常：success = false，error 描述错误
   *
   * 【重点标记 - CSP 兼容】返回的 imagePath 为磁盘绝对路径，
   * 渲染进程不应直接用于 <img src>（会被 CSP 拦截），
   * 需通过 file.readAsBase64 转 data URL，与 expression:getImagePath 处理方式一致。
   */
  ipcMain.handle(
    'asset:getImagePath',
    async (
      _event,
      args: {
        characterCardId: string;
        assetType: AssetType;
        assetId: string;
      }
    ) => {
      try {
        const { characterCardId, assetType, assetId } = args;
        const imagePath = await assetService.getAssetPath(
          characterCardId,
          assetType,
          assetId
        );
        return { success: true, imagePath };
      } catch (error) {
        console.error('[AssetHandler] getImagePath failed:', error);
        return {
          success: false,
          imagePath: null,
          error: error instanceof Error ? error.message : 'Unknown error',
        };
      }
    }
  );
}
