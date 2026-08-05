/**
 * 角色特征管理 IPC 处理器
 *
 * Spec:
 *  - add-asset-and-trait-management / Task 2（v1 基线）
 *  - add-trait-category-grouping / Task 3（v2 升级）
 *
 * 通道列表：
 *   - character-trait:list            读取角色卡视觉特征 tag 数组（v1 string[] 兼容）
 *   - character-trait:save            保存角色卡视觉特征 tag 数组（v1 string[] 兼容，覆盖写入，含外观描述）
 *   - character-trait:loadDescription  读取角色卡外观描述（中文自然语言）
 *   - character-trait:clear           清除角色卡视觉特征文件（幂等）
 *   - character-trait:loadData         读取角色卡完整 v2 数据（含分类/组合）
 *   - character-trait:saveData        保存角色卡完整 v2 数据（覆盖写入）
 *
 * 注册模式参照 registerExpressionHandlers()：导出 registerCharacterTraitHandlers() 函数。
 *
 * v2 通道（loadData / saveData）为推荐入口，分类/组合/移动/启用的细粒度操作
 * 由 store 层读取 v2 → 修改 → 保存 v2 完成，不新增细粒度 IPC。
 *
 * service 内部已 try/catch 兜底；外层 handler 再 try/catch 是为 IPC 序列化失败
 * 等极端场景提供最后兜底，保证渲染进程永不收到 reject。
 */
import { ipcMain } from 'electron';
import { characterTraitService } from '../../services/characterTraitService';
import type { CharacterTraitManifestV2 } from '../../../shared/types/characterTrait.types';

export function registerCharacterTraitHandlers() {
  /**
   * 读取角色卡视觉特征 tag 数组（v1 string[] 兼容）。
   * - 文件不存在：返回 []
   * - 解析失败：返回 []
   * @deprecated 改用 character-trait:loadData 获取完整 v2 数据
   */
  ipcMain.handle('character-trait:list', async (_event, characterCardId: string) => {
    try {
      return await characterTraitService.loadTraits(characterCardId);
    } catch (error) {
      console.error('[CharacterTraitHandler] list failed:', error);
      return [];
    }
  });

  /**
   * 保存角色卡视觉特征 tag 数组（v1 string[] 兼容，覆盖写入 traits.json）。
   * 参数采用对象形式，与 expression:saveImage 保持一致，便于扩展字段。
   * @deprecated 改用 character-trait:saveData 保存完整 v2 数据
   */
  ipcMain.handle(
    'character-trait:save',
    async (
      _event,
      args: {
        characterCardId: string;
        traits: string[];
        appearanceDescription?: string;
      }
    ) => {
      try {
        const { characterCardId, traits, appearanceDescription } = args;
        return await characterTraitService.saveTraits(characterCardId, traits, appearanceDescription);
      } catch (error) {
        console.error('[CharacterTraitHandler] save failed:', error);
        return {
          success: false,
          error: error instanceof Error ? error.message : 'Unknown error',
        };
      }
    }
  );

  /**
   * 读取角色卡外观描述（中文自然语言）。
   * - 文件不存在或字段缺失：返回空串 ''
   */
  ipcMain.handle(
    'character-trait:loadDescription',
    async (_event, characterCardId: string) => {
      try {
        return await characterTraitService.loadAppearanceDescription(characterCardId);
      } catch (error) {
        console.error('[CharacterTraitHandler] loadDescription failed:', error);
        return '';
      }
    }
  );

  /**
   * 清除角色卡视觉特征文件（删除 traits.json）。
   * - 文件不存在：视为幂等成功
   */
  ipcMain.handle(
    'character-trait:clear',
    async (_event, characterCardId: string) => {
      try {
        return await characterTraitService.clearTraits(characterCardId);
      } catch (error) {
        console.error('[CharacterTraitHandler] clear failed:', error);
        return {
          success: false,
          error: error instanceof Error ? error.message : 'Unknown error',
        };
      }
    }
  );

  /**
   * 读取角色卡完整 v2 特征数据（Spec: add-trait-category-grouping / Task 3）。
   * - 文件不存在：返回空白 v2 manifest（traits:[], customCategories:[], combinations:[], activeCombinationId:null）
   * - v1 数据：内部自动迁移为 v2 后返回
   * - 字段缺失：防御性兜底补全
   */
  ipcMain.handle(
    'character-trait:loadData',
    async (_event, characterCardId: string) => {
      try {
        return await characterTraitService.loadTraitData(characterCardId);
      } catch (error) {
        console.error('[CharacterTraitHandler] loadData failed:', error);
        // 兜底返回空白 v2，避免渲染进程收到 reject
        return characterTraitService.loadTraitData(characterCardId);
      }
    }
  );

  /**
   * 保存角色卡完整 v2 特征数据（覆盖写入 traits.json，version 强制为 2）。
   * 参数采用对象形式，与 save 通道风格一致。
   */
  ipcMain.handle(
    'character-trait:saveData',
    async (
      _event,
      args: { characterCardId: string; data: CharacterTraitManifestV2 }
    ) => {
      try {
        const { characterCardId, data } = args;
        return await characterTraitService.saveTraitData(characterCardId, data);
      } catch (error) {
        console.error('[CharacterTraitHandler] saveData failed:', error);
        return {
          success: false,
          error: error instanceof Error ? error.message : 'Unknown error',
        };
      }
    }
  );
}
