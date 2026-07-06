/**
 * 写作模式 - 自定义模板管理 IPC handler
 *
 * 涵盖：
 *   - 小说类型模板管理（list / get / save / delete）
 *   - 写作风格模板管理（list / get / save / delete）
 *
 * list 方法合并预置模板和自定义模板，预置模板只读不可删除。
 */
import { ipcMain } from 'electron';
import { writingTemplateRepository } from '../../../services/writing/WritingTemplateRepository';
import { getPresetNovelTypeTemplates, getPresetWritingStyleTemplates } from '../../../services/writing/NovelTypeTemplates';
import { CustomNovelTypeTemplate, CustomWritingStyleTemplate } from '../../../../shared/types/writing.types';

export function registerWritingTemplateHandlers(): void {
  // ========== 小说类型模板 ==========

  // 列出所有小说类型模板（预置 + 自定义）
  ipcMain.handle('writing:template:novelType:list', async () => {
    try {
      const presets = getPresetNovelTypeTemplates();
      const customs = await writingTemplateRepository.listCustomNovelTypeTemplates();
      return { success: true, templates: [...presets, ...customs] };
    } catch (error) {
      return {
        success: false,
        templates: [],
        error: error instanceof Error ? error.message : 'Unknown error'
      };
    }
  });

  // 获取单个小说类型模板
  ipcMain.handle('writing:template:novelType:get', async (_event, id: string) => {
    try {
      // 先查预置模板
      const presets = getPresetNovelTypeTemplates();
      const preset = presets.find(t => t.id === id);
      if (preset) {
        return { success: true, template: preset };
      }
      // 再查自定义模板
      const custom = await writingTemplateRepository.getCustomNovelTypeTemplate(id);
      if (custom) {
        return { success: true, template: custom };
      }
      return { success: false, template: null, error: '模板不存在' };
    } catch (error) {
      return {
        success: false,
        template: null,
        error: error instanceof Error ? error.message : 'Unknown error'
      };
    }
  });

  // 保存（创建/更新）自定义小说类型模板
  ipcMain.handle('writing:template:novelType:save', async (_event, template: CustomNovelTypeTemplate) => {
    try {
      if (!template.id || !template.name || !template.systemPrompt) {
        return { success: false, error: '缺少必填字段（id, name, systemPrompt）' };
      }
      // 预置模板不允许覆盖保存
      if (template.isPreset) {
        return { success: false, error: '预置模板不可修改' };
      }
      const now = Date.now();
      const toSave: CustomNovelTypeTemplate = {
        ...template,
        isPreset: false,
        updatedAt: now,
        createdAt: template.createdAt || now
      };
      await writingTemplateRepository.saveCustomNovelTypeTemplate(toSave);
      return { success: true, id: toSave.id };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error'
      };
    }
  });

  // 删除自定义小说类型模板
  ipcMain.handle('writing:template:novelType:delete', async (_event, id: string) => {
    try {
      // 预置模板不允许删除
      const presets = getPresetNovelTypeTemplates();
      if (presets.some(t => t.id === id)) {
        return { success: false, error: '预置模板不可删除' };
      }
      await writingTemplateRepository.deleteCustomNovelTypeTemplate(id);
      return { success: true };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error'
      };
    }
  });

  // ========== 写作风格模板 ==========

  // 列出所有写作风格模板（预置 + 自定义）
  ipcMain.handle('writing:template:writingStyle:list', async () => {
    try {
      const presets = getPresetWritingStyleTemplates();
      const customs = await writingTemplateRepository.listCustomWritingStyleTemplates();
      return { success: true, templates: [...presets, ...customs] };
    } catch (error) {
      return {
        success: false,
        templates: [],
        error: error instanceof Error ? error.message : 'Unknown error'
      };
    }
  });

  // 获取单个写作风格模板
  ipcMain.handle('writing:template:writingStyle:get', async (_event, id: string) => {
    try {
      const presets = getPresetWritingStyleTemplates();
      const preset = presets.find(t => t.id === id);
      if (preset) {
        return { success: true, template: preset };
      }
      const custom = await writingTemplateRepository.getCustomWritingStyleTemplate(id);
      if (custom) {
        return { success: true, template: custom };
      }
      return { success: false, template: null, error: '模板不存在' };
    } catch (error) {
      return {
        success: false,
        template: null,
        error: error instanceof Error ? error.message : 'Unknown error'
      };
    }
  });

  // 保存（创建/更新）自定义写作风格模板
  ipcMain.handle('writing:template:writingStyle:save', async (_event, template: CustomWritingStyleTemplate) => {
    try {
      if (!template.id || !template.name || !template.description) {
        return { success: false, error: '缺少必填字段（id, name, description）' };
      }
      if (template.isPreset) {
        return { success: false, error: '预置模板不可修改' };
      }
      const now = Date.now();
      const toSave: CustomWritingStyleTemplate = {
        ...template,
        isPreset: false,
        updatedAt: now,
        createdAt: template.createdAt || now
      };
      await writingTemplateRepository.saveCustomWritingStyleTemplate(toSave);
      return { success: true, id: toSave.id };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error'
      };
    }
  });

  // 删除自定义写作风格模板
  ipcMain.handle('writing:template:writingStyle:delete', async (_event, id: string) => {
    try {
      const presets = getPresetWritingStyleTemplates();
      if (presets.some(t => t.id === id)) {
        return { success: false, error: '预置模板不可删除' };
      }
      await writingTemplateRepository.deleteCustomWritingStyleTemplate(id);
      return { success: true };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error'
      };
    }
  });
}
