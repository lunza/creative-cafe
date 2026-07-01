/**
 * 记忆插件 - 模板管理 IPC handler
 *
 * 涵盖：
 *   - 模板 CRUD（getAllTemplates / getTemplate / createTemplate /
 *     updateTemplate / deleteTemplate）
 *   - 模板版本历史（getVersionHistory / restoreVersion）
 *   - 模板绑定状态查询（getTemplateBindingStatus）
 *   - 模板复制（copyTemplate）
 *
 * 对于「try/catch + console.error + throw」模式的 handler，统一通过
 * utils/wrapHandler 包装以消除重复样板；对于返回兜底值的 handler，
 * 保留原 try/catch 结构以保持 IPC 响应形态不变。
 */
import { ipcMain } from 'electron';
import { tableTemplateService, TableTemplate } from '../../../services/memory/tableTemplateService';
import { wrapHandler } from '../utils/wrapHandler';

export function registerMemoryTemplateHandlers(): void {
  // ========== 模板 CRUD ==========

  /**
   * 获取所有模板
   */
  ipcMain.handle(
    'memory:getAllTemplates',
    wrapHandler(async (): Promise<TableTemplate[]> => {
      console.log('获取所有模板...');
      const templates = tableTemplateService.getAllTemplates();
      console.log(`成功获取 ${templates.length} 个模板`);
      return templates;
    })
  );

  /**
   * 获取单个模板
   */
  ipcMain.handle(
    'memory:getTemplate',
    wrapHandler(async (_event, templateId: string): Promise<TableTemplate | null> => {
      console.log(`获取模板 ${templateId}...`);
      const template = tableTemplateService.getTemplate(templateId);
      console.log(`模板 ${templateId} 获取成功:`, template ? '找到' : '未找到');
      return template;
    })
  );

  /**
   * 创建新模板
   */
  ipcMain.handle(
    'memory:createTemplate',
    wrapHandler(async (_event, template: Omit<TableTemplate, 'id' | 'createdAt' | 'updatedAt' | 'version'>): Promise<TableTemplate> => {
      console.log('创建新模板:', template.name);
      console.log('模板数据:', JSON.stringify(template, null, 2));
      const createdTemplate = tableTemplateService.createTemplate(template);
      console.log('模板创建成功:', createdTemplate.id);
      return createdTemplate;
    })
  );

  /**
   * 更新模板
   */
  ipcMain.handle(
    'memory:updateTemplate',
    wrapHandler(async (_event, templateId: string, updates: Partial<TableTemplate>): Promise<TableTemplate | null> => {
      console.log(`更新模板 ${templateId}...`);
      console.log('更新数据:', JSON.stringify(updates, null, 2));
      const updatedTemplate = tableTemplateService.updateTemplate(templateId, updates);
      console.log(`模板 ${templateId} 更新成功`);
      return updatedTemplate;
    })
  );

  /**
   * 删除模板
   */
  ipcMain.handle(
    'memory:deleteTemplate',
    wrapHandler(async (_event, templateId: string): Promise<boolean> => {
      console.log(`删除模板 ${templateId}...`);
      const result = tableTemplateService.deleteTemplate(templateId);
      console.log(`模板 ${templateId} 删除 ${result ? '成功' : '失败'}`);
      return result;
    })
  );

  // ========== 模板版本历史 ==========

  /**
   * 获取模板版本历史
   */
  ipcMain.handle(
    'memory:getVersionHistory',
    wrapHandler(async (_event, templateId: string): Promise<string[]> => {
      return tableTemplateService.getVersionHistory(templateId);
    })
  );

  /**
   * 恢复历史版本
   */
  ipcMain.handle(
    'memory:restoreVersion',
    wrapHandler(async (_event, templateId: string, version: string): Promise<TableTemplate | null> => {
      return tableTemplateService.restoreVersion(templateId, version);
    })
  );

  // ========== 模板绑定状态 ==========

  /**
   * 获取模板绑定状态
   */
  ipcMain.handle('memory:getTemplateBindingStatus', async (): Promise<Record<string, boolean>> => {
    try {
      console.log('获取模板绑定状态...');
      const bindingStatus = tableTemplateService.getTemplateBindingStatus();
      console.log('模板绑定状态获取成功:', bindingStatus);
      return bindingStatus;
    } catch (error) {
      return {};
    }
  });

  // ========== 模板复制 ==========

  /**
   * 复制模板
   */
  ipcMain.handle(
    'memory:copyTemplate',
    wrapHandler(async (_event, sourceTemplateId: string, newTemplateName: string): Promise<TableTemplate> => {
      console.log('复制模板:', { sourceTemplateId, newTemplateName });
      const copiedTemplate = tableTemplateService.copyTemplate(sourceTemplateId, newTemplateName);
      console.log('模板复制成功:', copiedTemplate.id);
      return copiedTemplate;
    })
  );
}
