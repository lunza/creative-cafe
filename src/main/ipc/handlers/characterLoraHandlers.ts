/**
 * 角色卡 LoRA 管理 IPC 处理器（2026-07-29 bug 修复）
 *
 * 【重点标记 - 按角色独立存储 LoRA】
 *
 * 通道列表：
 *   - character-lora:list   读取角色卡 LoRA 模型清单
 *   - character-lora:save   保存角色卡 LoRA 模型清单（覆盖写入）
 *
 * 注册模式参照 registerCharacterTraitHandlers()。
 *
 * 参数与返回值与 characterLoraService 方法签名对齐：
 *   - list : (characterCardId: string) => Promise<Array<{ name: string; weight: number }>>
 *   - save : (args: { characterCardId, loras }) => Promise<{ success, error? }>
 */
import { ipcMain } from 'electron';
import { characterLoraService } from '../../services/characterLoraService';

export function registerCharacterLoraHandlers() {
  /**
   * 读取角色卡 LoRA 模型清单。
   * - 文件不存在：返回 []
   * - 解析失败：返回 []
   */
  ipcMain.handle('character-lora:list', async (_event, characterCardId: string) => {
    try {
      return await characterLoraService.loadLoras(characterCardId);
    } catch (error) {
      console.error('[CharacterLoraHandler] list failed:', error);
      return [];
    }
  });

  /**
   * 保存角色卡 LoRA 模型清单（覆盖写入 loras.json）。
   * 参数采用对象形式，便于扩展字段。
   */
  ipcMain.handle(
    'character-lora:save',
    async (
      _event,
      args: {
        characterCardId: string;
        loras: Array<{ name: string; weight: number }>;
      }
    ) => {
      try {
        const { characterCardId, loras } = args;
        return await characterLoraService.saveLoras(characterCardId, loras);
      } catch (error) {
        console.error('[CharacterLoraHandler] save failed:', error);
        return {
          success: false,
          error: error instanceof Error ? error.message : 'Unknown error',
        };
      }
    }
  );
}
