/**
 * 提示词模板 IPC 处理器
 */

import { ipcMain } from 'electron';
import { getPromptTemplateService } from '../../services/PromptTemplateService';
import type {
  PromptTemplate,
  PromptPolishRequest
} from '../../../shared/types/promptTemplate.types';

export function registerPromptHandlers(): void {
  const service = getPromptTemplateService();

  // 获取所有模板
  ipcMain.handle('prompt:getAll', async () => {
    try {
      const data = service.getAllTemplates();
      return { success: true, data };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : '未知错误' };
    }
  });

  // 获取单个模板
  ipcMain.handle('prompt:get', async (_event, moduleId: string) => {
    try {
      const data = service.getTemplate(moduleId);
      return { success: true, data: data || undefined };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : '未知错误' };
    }
  });

  // 保存模板
  ipcMain.handle(
    'prompt:save',
    async (_event, template: PromptTemplate, modifiedBy: string, changeSummary: string) => {
      try {
        const data = service.saveTemplate(template, modifiedBy, changeSummary);
        return { success: true, data };
      } catch (error) {
        return { success: false, error: error instanceof Error ? error.message : '未知错误' };
      }
    }
  );

  // 获取历史记录
  ipcMain.handle('prompt:getHistory', async (_event, moduleId: string) => {
    try {
      const data = service.getHistory(moduleId);
      return { success: true, data };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : '未知错误' };
    }
  });

  // 回滚到指定版本
  ipcMain.handle(
    'prompt:rollback',
    async (_event, moduleId: string, version: number, modifiedBy: string) => {
      try {
        const data = service.rollback(moduleId, version, modifiedBy);
        if (!data) {
          return { success: false, error: '未找到指定版本的历史记录' };
        }
        return { success: true, data };
      } catch (error) {
        return { success: false, error: error instanceof Error ? error.message : '未知错误' };
      }
    }
  );

  // 清空指定模块的历史记录
  ipcMain.handle('prompt:clearHistory', async (_event, moduleId: string) => {
    try {
      const ok = service.clearHistory(moduleId);
      if (!ok) {
        return { success: false, error: '未找到该模块的历史记录' };
      }
      return { success: true };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : '未知错误' };
    }
  });

  // 构建提示词
  ipcMain.handle(
    'prompt:build',
    async (_event, moduleId: string, variables: Record<string, string>) => {
      try {
        const data = service.buildPrompt(moduleId, variables);
        return { success: true, data };
      } catch (error) {
        return { success: false, error: error instanceof Error ? error.message : '未知错误' };
      }
    }
  );

  // 校验模板
  ipcMain.handle('prompt:validate', async (_event, template: PromptTemplate) => {
    try {
      const data = service.validateTemplate(template);
      return { success: true, data };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : '未知错误' };
    }
  });

  // 重置模板为默认值
  ipcMain.handle('prompt:reset', async (_event, moduleId: string) => {
    try {
      const data = service.resetTemplate(moduleId);
      return { success: true, data: data || undefined };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : '未知错误' };
    }
  });

  // AI 优化提示词（带框架推荐 + 理由）
  ipcMain.handle(
    'prompt:optimize',
    async (_event, request: PromptPolishRequest) => {
      try {
        const data = await service.optimizePrompt(request);
        return { success: true, data };
      } catch (error) {
        return { success: false, error: error instanceof Error ? error.message : '未知错误' };
      }
    }
  );
}
