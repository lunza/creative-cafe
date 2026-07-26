/**
 * 角色卡表情管理系统 IPC 处理器（Spec: add-character-expression-system / Task 1）
 *
 * 通道列表：
 *   - expression:list              读取角色卡表情包 manifest
 *   - expression:saveImage         保存表情图像（base64）并更新 manifest
 *   - expression:deleteImage       删除指定情绪的图像文件
 *   - expression:addCustomEmotion  添加自定义情绪类别
 *   - expression:removeCustomEmotion 移除自定义情绪类别（含图像）
 *   - expression:getImagePath      获取指定情绪的图像绝对路径
 *
 * 注册模式参照 registerMemoryHandlers()：导出 registerExpressionHandlers() 函数。
 */
import { ipcMain } from 'electron';
import { expressionService } from '../../services/expressionService';

export function registerExpressionHandlers() {
  ipcMain.handle('expression:list', async (_event, characterCardId: string) => {
    try {
      const manifest = await expressionService.listExpressions(characterCardId);
      return manifest;
    } catch (error) {
      console.error('[expression:list] failed:', error);
      return {
        characterCardId,
        version: 1 as const,
        expressions: {},
        customEmotions: [],
      };
    }
  });

  ipcMain.handle(
    'expression:saveImage',
    async (
      _event,
      args: {
        characterCardId: string;
        emotionKey: string;
        imageBase64: string;
        isCustom: boolean;
        label?: string;
      }
    ) => {
      try {
        const { characterCardId, emotionKey, imageBase64, isCustom, label } = args;
        return await expressionService.saveImage(
          characterCardId,
          emotionKey,
          imageBase64,
          isCustom,
          label
        );
      } catch (error) {
        console.error('[expression:saveImage] failed:', error);
        return {
          success: false,
          error: error instanceof Error ? error.message : 'Unknown error',
        };
      }
    }
  );

  ipcMain.handle(
    'expression:deleteImage',
    async (
      _event,
      args: {
        characterCardId: string;
        emotionKey: string;
      }
    ) => {
      try {
        const { characterCardId, emotionKey } = args;
        return await expressionService.deleteImage(characterCardId, emotionKey);
      } catch (error) {
        console.error('[expression:deleteImage] failed:', error);
        return {
          success: false,
          error: error instanceof Error ? error.message : 'Unknown error',
        };
      }
    }
  );

  ipcMain.handle(
    'expression:addCustomEmotion',
    async (
      _event,
      args: {
        characterCardId: string;
        key: string;
        label: string;
      }
    ) => {
      try {
        const { characterCardId, key, label } = args;
        return await expressionService.addCustomEmotion(characterCardId, key, label);
      } catch (error) {
        console.error('[expression:addCustomEmotion] failed:', error);
        return {
          success: false,
          error: error instanceof Error ? error.message : 'Unknown error',
        };
      }
    }
  );

  ipcMain.handle(
    'expression:removeCustomEmotion',
    async (
      _event,
      args: {
        characterCardId: string;
        key: string;
      }
    ) => {
      try {
        const { characterCardId, key } = args;
        return await expressionService.removeCustomEmotion(characterCardId, key);
      } catch (error) {
        console.error('[expression:removeCustomEmotion] failed:', error);
        return {
          success: false,
          error: error instanceof Error ? error.message : 'Unknown error',
        };
      }
    }
  );

  ipcMain.handle(
    'expression:getImagePath',
    async (
      _event,
      args: {
        characterCardId: string;
        emotionKey: string;
      }
    ) => {
      try {
        const { characterCardId, emotionKey } = args;
        const imagePath = await expressionService.getImagePath(characterCardId, emotionKey);
        return { success: true, imagePath };
      } catch (error) {
        console.error('[expression:getImagePath] failed:', error);
        return {
          success: false,
          imagePath: null,
          error: error instanceof Error ? error.message : 'Unknown error',
        };
      }
    }
  );
}
