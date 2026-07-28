/**
 * 角色特征管理 IPC 处理器（Spec: add-asset-and-trait-management / Task 2）
 *
 * 通道列表：
 *   - character-trait:list            读取角色卡视觉特征 tag 数组
 *   - character-trait:save            保存角色卡视觉特征 tag 数组（覆盖写入，含外观描述）
 *   - character-trait:loadDescription 读取角色卡外观描述（中文自然语言）
 *   - character-trait:clear           清除角色卡视觉特征文件（幂等）
 *
 * 注册模式参照 registerExpressionHandlers()：导出 registerCharacterTraitHandlers() 函数。
 *
 * 参数与返回值与 characterTraitService 方法签名对齐：
 *   - list  : (characterCardId: string) => Promise<string[]>
 *   - save  : (characterCardId: string, traits: string[]) => Promise<{ success, error? }>
 *   - clear : (characterCardId: string) => Promise<{ success, error? }>
 *
 * service 内部已 try/catch 兜底；外层 handler 再 try/catch 是为 IPC 序列化失败
 * 等极端场景提供最后兜底，保证渲染进程永不收到 reject。
 */
import { ipcMain } from 'electron';
import { characterTraitService } from '../../services/characterTraitService';

export function registerCharacterTraitHandlers() {
  /**
   * 读取角色卡视觉特征 tag 数组。
   * - 文件不存在：返回 []
   * - 解析失败：返回 []
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
   * 保存角色卡视觉特征 tag 数组（覆盖写入 traits.json）。
   * 参数采用对象形式，与 expression:saveImage 保持一致，便于扩展字段。
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
}
