/**
 * 表格模板管理服务
 * 负责管理表格模板的创建、读取、更新、删除操作
 */

import fs from 'fs';
import path from 'path';
import { getUserDataPath } from '../../utils/appPath';

// 定义模板接口
export interface TableTemplate {
  id: string;
  name: string;
  description: string;
  sheets: TableSheet[];
  createdAt: string;
  updatedAt: string;
  version: string;
}

export interface TableSheet {
  name: string;
  description: string;
  headers: string[];
  order: number;
}

// 预定义的模板配置 - 基于 st-memory-enhancement 插件规范
const DEFAULT_TEMPLATES: TableTemplate[] = [
  {
    id: 'st-memory-enhancement-default',
    name: '记忆增强插件默认模板',
    description: '基于 st-memory-enhancement 插件设计规范的默认模板，包含时空、角色、社交、物品、事件等核心表格',
    sheets: [
      {
        name: '时空表格',
        description: '记录时空信息的表格，应保持在一行。记录时间和地点信息，帮助AI理解当前场景的时空背景。',
        headers: ['流水号', '唯一id', '时间', '地点', '描述', '备注'],
        order: 1
      },
      {
        name: '角色表格',
        description: '角色天生或不易改变的特征表格，思考本轮有否有其中的角色，他应作出什么反应。记录角色的基本信息、身份、关系和特征。',
        headers: ['流水号', '唯一id', '角色名', '身份', '关系', '特征', '备注'],
        order: 2
      },
      {
        name: '社交表格',
        description: '思考如果有角色和其他角色互动，应记录他们之间的关系和互动情况。记录角色之间的社交关系、互动历史和关系状态。',
        headers: ['流水号', '唯一id', '时间', '参与人', '事件', '结果', '备注'],
        order: 3
      },
      {
        name: '物品表格',
        description: '对某人很贵重或有特殊纪念意义的物品。记录物品的拥有人、描述、名称和重要性等信息。',
        headers: ['流水号', '唯一id', '物品名', '类型', '描述', '状态', '备注'],
        order: 4
      },
      {
        name: '事件表格',
        description: '记录角色经历的重要事件。记录事件的时间、名称、参与人、描述和影响等信息。',
        headers: ['流水号', '唯一id', '时间', '事件名', '参与人', '描述', '影响', '备注'],
        order: 5
      }
    ],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    version: '1.0.0'
  }
];

class TableTemplateService {
  private templateDir: string;
  private chatlogDir: string;

  constructor() {
    const userDataPath = getUserDataPath();
    this.templateDir = path.join(userDataPath, 'data', 'memories', 'templates');
    this.chatlogDir = path.join(userDataPath, 'data', 'memories', 'chatlog');
    
    // 确保目录存在
    this.ensureDirectories();
  }

  /**
   * 确保所需目录存在
   */
  private ensureDirectories() {
    if (!fs.existsSync(this.templateDir)) {
      fs.mkdirSync(this.templateDir, { recursive: true });
    }
    if (!fs.existsSync(this.chatlogDir)) {
      fs.mkdirSync(this.chatlogDir, { recursive: true });
    }
  }

  /**
   * 获取模板文件路径
   */
  private getTemplatePath(templateId: string): string {
    return path.join(this.templateDir, `${templateId}.json`);
  }

  /**
   * 获取所有模板
   */
  public getAllTemplates(): TableTemplate[] {
    const templates: TableTemplate[] = [];
    
    // 读取所有模板文件
    if (fs.existsSync(this.templateDir)) {
      const files = fs.readdirSync(this.templateDir);
      files.forEach(file => {
        if (file.endsWith('.json')) {
          const templatePath = path.join(this.templateDir, file);
          const template = JSON.parse(fs.readFileSync(templatePath, 'utf-8'));
          templates.push(template);
        }
      });
    }
    
    // 如果没有模板，返回默认模板
    if (templates.length === 0) {
      return DEFAULT_TEMPLATES;
    }
    
    return templates;
  }

  /**
   * 获取模板绑定状态
   */
  public getTemplateBindingStatus(): Record<string, boolean> {
    const bindingStatus: Record<string, boolean> = {};
    
    // 读取所有模板文件
    if (fs.existsSync(this.templateDir)) {
      const files = fs.readdirSync(this.templateDir);
      files.forEach(file => {
        if (file.endsWith('.json')) {
          const templatePath = path.join(this.templateDir, file);
          const template = JSON.parse(fs.readFileSync(templatePath, 'utf-8'));
          // 检查模板是否有 chatId 属性，有则表示已绑定
          bindingStatus[template.id] = !!template.chatId;
        }
      });
    }
    
    return bindingStatus;
  }

  /**
   * 获取单个模板
   */
  public getTemplate(templateId: string): TableTemplate | null {
    const templatePath = this.getTemplatePath(templateId);
    
    if (fs.existsSync(templatePath)) {
      const template = JSON.parse(fs.readFileSync(templatePath, 'utf-8'));
      return template;
    }
    
    // 如果模板文件不存在，从默认模板中查找
    const defaultTemplate = DEFAULT_TEMPLATES.find(template => template.id === templateId);
    if (defaultTemplate) {
      return defaultTemplate;
    }
    
    return null;
  }

  /**
   * 创建新模板
   */
  public createTemplate(template: Omit<TableTemplate, 'id' | 'createdAt' | 'updatedAt' | 'version'>): TableTemplate {
    const newTemplate: TableTemplate = {
      ...template,
      id: `template-${Date.now()}`,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      version: '1.0.0'
    };
    
    const templatePath = this.getTemplatePath(newTemplate.id);
    fs.writeFileSync(templatePath, JSON.stringify(newTemplate, null, 2), 'utf-8');
    
    return newTemplate;
  }

  /**
   * 更新模板
   */
  public updateTemplate(templateId: string, updates: Partial<TableTemplate>): TableTemplate | null {
    const template = this.getTemplate(templateId);
    
    if (!template) {
      return null;
    }
    
    // 创建版本备份
    this.createVersionBackup(template);
    
    // 更新模板
    const updatedTemplate: TableTemplate = {
      ...template,
      ...updates,
      updatedAt: new Date().toISOString(),
      version: this.incrementVersion(template.version)
    };
    
    const templatePath = this.getTemplatePath(templateId);
    fs.writeFileSync(templatePath, JSON.stringify(updatedTemplate, null, 2), 'utf-8');
    
    return updatedTemplate;
  }

  /**
   * 删除模板
   */
  public deleteTemplate(templateId: string): boolean {
    const templatePath = this.getTemplatePath(templateId);
    
    if (fs.existsSync(templatePath)) {
      fs.unlinkSync(templatePath);
      return true;
    }
    
    return false;
  }

  /**
   * 保存模板
   */
  public saveTemplate(template: TableTemplate): void {
    const templatePath = this.getTemplatePath(template.id);
    
    // 确保模板目录存在
    if (!fs.existsSync(this.templateDir)) {
      fs.mkdirSync(this.templateDir, { recursive: true });
    }
    
    fs.writeFileSync(templatePath, JSON.stringify(template, null, 2), 'utf-8');
  }

  /**
   * 创建表格文件（JSON格式）
   */
  public createTableFile(chatId: string, templateId: string, safeChatId?: string): string {
    const template = this.getTemplate(templateId);
    
    if (!template) {
      throw new Error('模板不存在');
    }
    
    // 如果没有提供 safeChatId，则自己处理
    const finalSafeChatId = safeChatId || chatId
      .replace(/\//g, '_')
      .replace(/\\/g, '_')
      .replace(/\s+/g, '_')
      .replace(/@/g, '_')
      .replace(/-/g, '_')
      .replace(/:/g, '_')
      .replace(/\*/g, '_')
      .replace(/\?/g, '_')
      .replace(/"/g, '_')
      .replace(/</g, '_')
      .replace(/>/g, '_')
      .replace(/\|/g, '_');
    
    // 构建JSON文件路径
    const jsonPath = path.join(this.chatlogDir, `${finalSafeChatId}.json`);
    
    // 确保chatlog目录存在
    if (!fs.existsSync(this.chatlogDir)) {
      fs.mkdirSync(this.chatlogDir, { recursive: true });
    }
    
    // 构建JSON数据结构
    const jsonData = {
      sheets: template.sheets.map(sheet => sheet.name),
      headers: {},
      data: {}
    };
    
    // 为每个工作表初始化数据和表头
    template.sheets.forEach(sheet => {
      jsonData.headers[sheet.name] = sheet.headers;
      jsonData.data[sheet.name] = [];
    });
    
    // 保存JSON文件
    fs.writeFileSync(jsonPath, JSON.stringify(jsonData, null, 2), 'utf-8');
    
    return jsonPath;
  }

  /**
   * 读取表格文件（JSON格式）
   */
  public readTableFile(chatId: string): Record<string, any[]> {
    // 替换 chatId 中的路径分隔符和特殊字符，避免文件路径错误
    const safeChatId = chatId
      .replace(/\//g, '_')
      .replace(/\\/g, '_')
      .replace(/\s+/g, '_')
      .replace(/@/g, '_')
      .replace(/-/g, '_')
      .replace(/:/g, '_')
      .replace(/\*/g, '_')
      .replace(/\?/g, '_')
      .replace(/"/g, '_')
      .replace(/</g, '_')
      .replace(/>/g, '_')
      .replace(/\|/g, '_');
    
    // 构建JSON文件路径
    const jsonPath = path.join(this.chatlogDir, `${safeChatId}.json`);
    
    if (!fs.existsSync(jsonPath)) {
      throw new Error('表格文件不存在');
    }
    
    // 读取JSON文件
    const jsonData = JSON.parse(fs.readFileSync(jsonPath, 'utf-8'));
    
    return jsonData.data || {};
  }

  /**
   * 更新表格文件（JSON格式）
   */
  public updateTableFile(chatId: string, sheetName: string, data: any[]): string {
    // 替换 chatId 中的路径分隔符和特殊字符，避免文件路径错误
    const safeChatId = chatId
      .replace(/\//g, '_')
      .replace(/\\/g, '_')
      .replace(/\s+/g, '_')
      .replace(/@/g, '_')
      .replace(/-/g, '_')
      .replace(/:/g, '_')
      .replace(/\*/g, '_')
      .replace(/\?/g, '_')
      .replace(/"/g, '_')
      .replace(/</g, '_')
      .replace(/>/g, '_')
      .replace(/\|/g, '_');
    
    // 构建JSON文件路径
    const jsonPath = path.join(this.chatlogDir, `${safeChatId}.json`);
    
    if (!fs.existsSync(jsonPath)) {
      throw new Error('表格文件不存在');
    }
    
    // 读取JSON文件
    const jsonData = JSON.parse(fs.readFileSync(jsonPath, 'utf-8'));
    
    // 更新工作表数据
    jsonData.data[sheetName] = data;
    
    // 保存JSON文件
    fs.writeFileSync(jsonPath, JSON.stringify(jsonData, null, 2), 'utf-8');
    
    return jsonPath;
  }

  /**
   * 检查模板名称是否存在
   */
  private isTemplateNameExists(name: string, excludeId?: string): boolean {
    const allTemplates = this.getAllTemplates();
    return allTemplates.some(template => 
      template.name === name && template.id !== excludeId
    );
  }

  /**
   * 从系统模板复制创建用户模板
   * @param sourceTemplateId 源模板ID
   * @param newTemplateName 新模板名称
   * @returns 新创建的模板
   */
  public copyTemplate(sourceTemplateId: string, newTemplateName: string): TableTemplate {
    // 查找源模板
    const sourceTemplate = this.getTemplate(sourceTemplateId);
    if (!sourceTemplate) {
      throw new Error('源模板不存在');
    }

    // 检查名称唯一性，如存在重名则添加数字后缀
    let finalTemplateName = newTemplateName;
    let suffix = 1;
    while (this.isTemplateNameExists(finalTemplateName)) {
      finalTemplateName = `${newTemplateName}_${suffix}`;
      suffix++;
    }

    // 深度复制源模板
    const copiedTemplate: TableTemplate = JSON.parse(JSON.stringify(sourceTemplate));

    // 确保每个sheet都有"流水号"和"唯一id"字段
    copiedTemplate.sheets.forEach(sheet => {
      if (!sheet.headers.includes('流水号')) {
        sheet.headers.unshift('流水号');
      }
      if (!sheet.headers.includes('唯一id')) {
        sheet.headers.unshift('唯一id');
      }
    });

    // 生成新的ID、时间戳和版本号
    const newTemplate: TableTemplate = {
      ...copiedTemplate,
      id: `template-${Date.now()}`,
      name: finalTemplateName,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      version: '1.0.0'
    };

    // 保存新模板
    this.saveTemplate(newTemplate);

    return newTemplate;
  }

  /**
   * 创建版本备份
   */
  private createVersionBackup(template: TableTemplate) {
    const backupDir = path.join(this.templateDir, 'backups');
    
    if (!fs.existsSync(backupDir)) {
      fs.mkdirSync(backupDir, { recursive: true });
    }
    
    const backupPath = path.join(backupDir, `${template.id}_v${template.version}_${Date.now()}.json`);
    fs.writeFileSync(backupPath, JSON.stringify(template, null, 2), 'utf-8');
  }

  /**
   * 版本号递增
   */
  private incrementVersion(version: string): string {
    const parts = version.split('.').map(Number);
    parts[2] = (parts[2] || 0) + 1;
    return parts.join('.');
  }

  /**
   * 安全化 chatId，替换路径分隔符和特殊字符
   */
  private safeChatId(chatId: string): string {
    return chatId
      .replace(/\//g, '_')
      .replace(/\\/g, '_')
      .replace(/\s+/g, '_')
      .replace(/@/g, '_')
      .replace(/-/g, '_')
      .replace(/:/g, '_')
      .replace(/\*/g, '_')
      .replace(/\?/g, '_')
      .replace(/"/g, '_')
      .replace(/</g, '_')
      .replace(/>/g, '_')
      .replace(/\|/g, '_');
  }

  /**
   * 读取 JSON 文件并解析
   */
  private readJsonFile(chatId: string): any {
    const safeId = this.safeChatId(chatId);
    const jsonPath = path.join(this.chatlogDir, `${safeId}.json`);

    if (!fs.existsSync(jsonPath)) {
      return null;
    }

    return JSON.parse(fs.readFileSync(jsonPath, 'utf-8'));
  }

  /**
   * 保存 JSON 文件
   */
  private saveJsonFile(chatId: string, jsonData: any): void {
    const safeId = this.safeChatId(chatId);
    const jsonPath = path.join(this.chatlogDir, `${safeId}.json`);

    if (!fs.existsSync(jsonPath)) {
      throw new Error('表格文件不存在');
    }

    fs.writeFileSync(jsonPath, JSON.stringify(jsonData, null, 2), 'utf-8');
  }

  /**
   * 通过索引获取特定表格
   */
  public getTableByIndex(chatId: string, tableIndex: number): { name: string; headers: string[]; data: any[] } | null {
    try {
      const jsonData = this.readJsonFile(chatId);

      if (!jsonData) {
        console.error(`[TableTemplateService] 表格文件不存在: ${chatId}`);
        return null;
      }

      if (!jsonData.sheets || !Array.isArray(jsonData.sheets)) {
        console.error(`[TableTemplateService] JSON 文件缺少 sheets 数组: ${chatId}`);
        return null;
      }

      if (tableIndex < 0 || tableIndex >= jsonData.sheets.length) {
        console.error(`[TableTemplateService] 表格索引超出范围: ${tableIndex}, 总数: ${jsonData.sheets.length}`);
        return null;
      }

      const tableName = jsonData.sheets[tableIndex];
      const headers = jsonData.headers?.[tableName] || [];
      const data = jsonData.data?.[tableName] || [];

      return { name: tableName, headers, data };
    } catch (error) {
      console.error(`[TableTemplateService] 获取表格失败 (索引: ${tableIndex}):`, error);
      return null;
    }
  }

  /**
   * 通过索引更新表格数据
   */
  public updateTableByIndex(chatId: string, tableIndex: number, data: any[]): boolean {
    try {
      const jsonData = this.readJsonFile(chatId);

      if (!jsonData) {
        console.error(`[TableTemplateService] 表格文件不存在: ${chatId}`);
        return false;
      }

      if (!jsonData.sheets || !Array.isArray(jsonData.sheets)) {
        console.error(`[TableTemplateService] JSON 文件缺少 sheets 数组: ${chatId}`);
        return false;
      }

      if (tableIndex < 0 || tableIndex >= jsonData.sheets.length) {
        console.error(`[TableTemplateService] 表格索引超出范围: ${tableIndex}, 总数: ${jsonData.sheets.length}`);
        return false;
      }

      const tableName = jsonData.sheets[tableIndex];

      if (!jsonData.data) {
        jsonData.data = {};
      }

      jsonData.data[tableName] = data;
      this.saveJsonFile(chatId, jsonData);

      console.log(`[TableTemplateService] 成功更新表格 (索引: ${tableIndex}, 名称: ${tableName}, 数据行数: ${data.length})`);
      return true;
    } catch (error) {
      console.error(`[TableTemplateService] 更新表格失败 (索引: ${tableIndex}):`, error);
      return false;
    }
  }

  /**
   * 向指定表格插入新行
   */
  public insertRowToTable(chatId: string, tableIndex: number, rowData: Record<string, string>): boolean {
    try {
      const jsonData = this.readJsonFile(chatId);

      if (!jsonData) {
        console.error(`[TableTemplateService] 表格文件不存在: ${chatId}`);
        return false;
      }

      if (!jsonData.sheets || !Array.isArray(jsonData.sheets)) {
        console.error(`[TableTemplateService] JSON 文件缺少 sheets 数组: ${chatId}`);
        return false;
      }

      if (tableIndex < 0 || tableIndex >= jsonData.sheets.length) {
        console.error(`[TableTemplateService] 表格索引超出范围: ${tableIndex}, 总数: ${jsonData.sheets.length}`);
        return false;
      }

      const tableName = jsonData.sheets[tableIndex];

      if (!jsonData.data) {
        jsonData.data = {};
      }

      if (!jsonData.data[tableName]) {
        jsonData.data[tableName] = [];
      }

      const existingData = jsonData.data[tableName];
      const nextSerialNumber = existingData.length + 1;

      // 将 rowData 的字段索引保持原样（AI返回的索引从1开始对应唯一id，2开始对应自定义字段）
      // 系统自动生成的流水号使用 "0" 作为键
      const newRowData: Record<string, string> = {};
      for (const [key, value] of Object.entries(rowData)) {
        // 如果AI返回了"0"或"流水号"（流水号），跳过它，由系统自动生成
        if (key === '0' || key === '流水号') continue;
        newRowData[key] = value;
      }

      const newRow = {
        '0': String(nextSerialNumber),
        ...newRowData
      };

      jsonData.data[tableName].push(newRow);
      this.saveJsonFile(chatId, jsonData);

      console.log(`[TableTemplateService] 成功插入行到表格 (索引: ${tableIndex}, 名称: ${tableName}, 流水号: ${nextSerialNumber})`);
      console.log(`[TableTemplateService] 新行数据:`, JSON.stringify(newRow));
      return true;
    } catch (error) {
      console.error(`[TableTemplateService] 插入行失败 (索引: ${tableIndex}):`, error);
      return false;
    }
  }

  /**
   * 更新指定表格中的特定行
   */
  public updateRowInTable(chatId: string, tableIndex: number, rowIndex: number, rowData: Record<string, string>): boolean {
    try {
      const jsonData = this.readJsonFile(chatId);

      if (!jsonData) {
        console.error(`[TableTemplateService] 表格文件不存在: ${chatId}`);
        return false;
      }

      if (!jsonData.sheets || !Array.isArray(jsonData.sheets)) {
        console.error(`[TableTemplateService] JSON 文件缺少 sheets 数组: ${chatId}`);
        return false;
      }

      if (tableIndex < 0 || tableIndex >= jsonData.sheets.length) {
        console.error(`[TableTemplateService] 表格索引超出范围: ${tableIndex}, 总数: ${jsonData.sheets.length}`);
        return false;
      }

      const tableName = jsonData.sheets[tableIndex];

      if (!jsonData.data || !jsonData.data[tableName]) {
        console.error(`[TableTemplateService] 表格数据不存在: ${tableName}`);
        return false;
      }

      const tableData = jsonData.data[tableName];

      if (rowIndex < 0 || rowIndex >= tableData.length) {
        console.error(`[TableTemplateService] 行索引超出范围: ${rowIndex}, 总行数: ${tableData.length}`);
        return false;
      }

      tableData[rowIndex] = {
        ...tableData[rowIndex],
        ...rowData
      };

      // 确保流水号不会被覆盖
      tableData[rowIndex]['0'] = tableData[rowIndex]['0'] || String(rowIndex + 1);

      this.saveJsonFile(chatId, jsonData);

      console.log(`[TableTemplateService] 成功更新行 (索引: ${tableIndex}, 名称: ${tableName}, 行号: ${rowIndex})`);
      return true;
    } catch (error) {
      console.error(`[TableTemplateService] 更新行失败 (索引: ${tableIndex}, 行号: ${rowIndex}):`, error);
      return false;
    }
  }

  /**
   * 从指定表格删除特定行
   */
  public deleteRowFromTable(chatId: string, tableIndex: number, rowIndex: number): boolean {
    try {
      const jsonData = this.readJsonFile(chatId);

      if (!jsonData) {
        console.error(`[TableTemplateService] 表格文件不存在: ${chatId}`);
        return false;
      }

      if (!jsonData.sheets || !Array.isArray(jsonData.sheets)) {
        console.error(`[TableTemplateService] JSON 文件缺少 sheets 数组: ${chatId}`);
        return false;
      }

      if (tableIndex < 0 || tableIndex >= jsonData.sheets.length) {
        console.error(`[TableTemplateService] 表格索引超出范围: ${tableIndex}, 总数: ${jsonData.sheets.length}`);
        return false;
      }

      const tableName = jsonData.sheets[tableIndex];

      if (!jsonData.data || !jsonData.data[tableName]) {
        console.error(`[TableTemplateService] 表格数据不存在: ${tableName}`);
        return false;
      }

      const tableData = jsonData.data[tableName];

      if (rowIndex < 0 || rowIndex >= tableData.length) {
        console.error(`[TableTemplateService] 行索引超出范围: ${rowIndex}, 总行数: ${tableData.length}`);
        return false;
      }

      // 删除指定行
      tableData.splice(rowIndex, 1);

      // 重新编号流水号
      tableData.forEach((row: any, index: number) => {
        row['0'] = String(index + 1);
      });

      this.saveJsonFile(chatId, jsonData);

      console.log(`[TableTemplateService] 成功删除行 (索引: ${tableIndex}, 名称: ${tableName}, 行号: ${rowIndex}, 剩余行数: ${tableData.length})`);
      return true;
    } catch (error) {
      console.error(`[TableTemplateService] 删除行失败 (索引: ${tableIndex}, 行号: ${rowIndex}):`, error);
      return false;
    }
  }

  /**
   * 获取模板版本历史
   */
  public getVersionHistory(templateId: string): string[] {
    const backupDir = path.join(this.templateDir, 'backups');
    const versions: string[] = [];
    
    if (fs.existsSync(backupDir)) {
      const files = fs.readdirSync(backupDir);
      files.forEach(file => {
        if (file.startsWith(`${templateId}_v`)) {
          const match = file.match(/_v([^_]+)_/);
          if (match) {
            versions.push(match[1]);
          }
        }
      });
    }
    
    return versions.sort();
  }

  /**
   * 恢复历史版本
   */
  public restoreVersion(templateId: string, version: string): TableTemplate | null {
    const backupDir = path.join(this.templateDir, 'backups');
    const backupFile = `${templateId}_v${version}_*.json`;
    
    const files = fs.readdirSync(backupDir);
    const matchingFile = files.find(f => f.startsWith(`${templateId}_v${version}_`));
    
    if (matchingFile) {
      const backupPath = path.join(backupDir, matchingFile);
      const template = JSON.parse(fs.readFileSync(backupPath, 'utf-8'));
      
      // 恢复为当前版本
      const currentPath = this.getTemplatePath(templateId);
      fs.writeFileSync(currentPath, JSON.stringify(template, null, 2), 'utf-8');
      
      return template;
    }
    
    return null;
  }
}

// 导出单例实例
export const tableTemplateService = new TableTemplateService();
