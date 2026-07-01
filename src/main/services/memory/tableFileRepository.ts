/**
 * 表格文件仓储
 * 负责：
 * - getTableData / saveTableData：表格 JSON 文件读写（Task 6 在 getTableData 返回值增加 filePath 字段）
 * - applyAIResults：应用 AI 处理结果
 * - autoInitializeChatSession：首次对话时自动绑定默认模板并创建空表格
 * - deleteChatSession：删除聊天会话表格文件
 * - rollbackTableData：整理失败时回滚表格数据
 * - saveProcessingResult：保存整理结果到 _processing_results.json
 */

import fs from 'fs';
import path from 'path';
import { tableTemplateService } from './tableTemplateService';
import type { TableTemplate, TableSheet } from './tableTemplateService';
import {
  addLog,
  getSafeChatId,
  AIProcessingResult,
  ChatLogContext,
} from './logger';
import {
  associateTemplate,
  getAssociatedTemplate,
  resolveAvailableTemplate,
  setSessionProcessedStatus,
} from './associationRepository';
import type { TableOperation } from './aiClient';

/**
 * 表格数据返回结构（getTableData 返回值）
 * 与 aiPromptBuilder.TableDataFile 等结构一致，但 filePath 为运行时附加字段。
 */
interface TableDataResult {
  sheets: string[];
  headers: Record<string, string[]>;
  data: Record<string, Record<string, unknown>[]>;
  sheetDescriptions: Record<string, string>;
  filePath: string;
}

/**
 * 表格数据文件结构（chatlog/<safeChatId>.json）
 */
interface TableDataFile {
  sheets: string[];
  headers?: Record<string, string[]>;
  data: Record<string, Record<string, unknown>[]>;
  sheetDescriptions?: Record<string, string>;
}

/**
 * 回滚表格数据：将表格文件恢复到整理前的备份内容（用于整理失败时恢复）
 */
export function rollbackTableData(backup: string | null, filePath: string): void {
  if (backup && filePath && fs.existsSync(filePath)) {
    try {
      addLog('[TableOrganize] 检测到严重错误，正在回滚表格数据到备份状态...', 'error');
      fs.writeFileSync(filePath, backup, 'utf-8');
      addLog('[TableOrganize] 表格数据已回滚到处理前的状态', 'info');
    } catch (rollbackError) {
      addLog(`[TableOrganize] 回滚表格数据失败: ${rollbackError}`, 'error');
    }
  }
}

/**
 * 保存整理结果到 chatId_processing_results.json，并标记会话为已处理。
 */
export function saveProcessingResult(ctx: ChatLogContext, chatId: string, templateId: string, operations: TableOperation[]): void {
  const resultsPath = path.join(ctx.chatlogDir, `${chatId}_processing_results.json`);

  const processingResult = {
    chatId,
    templateId,
    operations,
    processedAt: new Date().toISOString()
  };

  try {
    fs.writeFileSync(resultsPath, JSON.stringify(processingResult, null, 2), 'utf-8');
    addLog(`处理结果已保存: ${resultsPath}`, 'debug');

    // 同时标记会话为已处理
    setSessionProcessedStatus(ctx, chatId, true);
  } catch (error) {
    console.error('保存处理结果失败:', error);
    // 不抛出错误，继续执行
  }
}

/**
 * 应用 AI 处理结果到表格文件（JSON格式）
 */
export function applyAIResults(ctx: ChatLogContext, chatId: string, results: AIProcessingResult[]): string {
  // 替换 chatId 中的路径分隔符和特殊字符，避免文件路径错误
  const safeChatId = getSafeChatId(chatId);

  // 构建JSON文件路径
  const jsonPath = path.join(ctx.chatlogDir, `${safeChatId}.json`);

  if (!fs.existsSync(jsonPath)) {
    throw new Error('表格文件不存在');
  }

  // 读取JSON文件
  const jsonData = JSON.parse(fs.readFileSync(jsonPath, 'utf-8')) as TableDataFile;

  results.forEach(result => {
    if (jsonData.data[result.sheetName]) {
      // 添加新数据
      result.updates.forEach(update => {
        jsonData.data[result.sheetName].push(update);
      });
    }
  });

  // 保存JSON文件
  fs.writeFileSync(jsonPath, JSON.stringify(jsonData, null, 2), 'utf-8');
  return jsonPath;
}

/**
 * 删除聊天会话
 */
export function deleteChatSession(ctx: ChatLogContext, chatId: string): boolean {
  const excelPath = path.join(ctx.chatlogDir, `${chatId}.xlsx`);

  if (fs.existsSync(excelPath)) {
    fs.unlinkSync(excelPath);
    return true;
  }

  return false;
}

/**
 * 自动初始化聊天会话（首次对话时自动绑定默认模板并创建空表格）
 */
export function autoInitializeChatSession(ctx: ChatLogContext, chatId: string): boolean {
  // 检查表格文件是否存在
  const safeChatId = getSafeChatId(chatId);
  const tableFilePath = path.join(ctx.chatlogDir, `${safeChatId}.json`);
  const tableFileExists = fs.existsSync(tableFilePath);

  // 检查是否已存在关联关系
  const existingTemplateId = getAssociatedTemplate(ctx, chatId);
  if (existingTemplateId && tableFileExists) {
    addLog(`[AutoInit] 聊天会话 ${chatId} 已有关联模板 ${existingTemplateId} 且表格文件存在，跳过初始化`, 'info');
    return false;
  }

  // 如果关联存在但表格文件缺失，使用可用模板重建表格文件
  if (existingTemplateId && !tableFileExists) {
    addLog(`[AutoInit] 聊天会话 ${chatId} 有关联模板 ${existingTemplateId} 但表格文件缺失，尝试重建`, 'info');
    const templateId = resolveAvailableTemplate(ctx, chatId);
    if (!templateId) {
      addLog('[AutoInit] 没有可用的表格模板，无法重建', 'error');
      return false;
    }
    try {
      tableTemplateService.createTableFile(chatId, templateId, safeChatId);
      addLog(`[AutoInit] 表格文件已重建: ${tableFilePath} (模板: ${templateId})`, 'info');
      return true;
    } catch (rebuildError) {
      addLog(`[AutoInit] 重建表格文件失败: ${rebuildError}`, 'error');
      console.error('[AutoInit] Rebuild table file error:', rebuildError);
      return false;
    }
  }

  addLog(`[AutoInit] 开始自动初始化聊天会话: ${chatId}`, 'info');

  try {
    // 获取默认模板ID（取第一个可用模板）
    const allTemplates = tableTemplateService.getAllTemplates();
    if (!allTemplates || allTemplates.length === 0) {
      addLog('[AutoInit] 没有可用的表格模板，无法自动初始化', 'error');
      return false;
    }

    const defaultTemplateId = allTemplates[0].id;
    addLog(`[AutoInit] 使用默认模板: ${defaultTemplateId} (${allTemplates[0].name})`, 'info');

    // 调用现有的 associateTemplate 方法完成初始化
    // associateTemplate 内部会：
    //   - 创建模板副本（包含 originalTemplateId, chatId 等元数据）
    //   - 调用 createTableFile 创建空表格JSON文件
    //   - 调用 saveAssociation 保存关联关系
    associateTemplate(ctx, chatId, defaultTemplateId);

    addLog(`[AutoInit] 聊天会话 ${chatId} 自动初始化完成`, 'info');
    return true;
  } catch (error) {
    addLog(`[AutoInit] 自动初始化失败: ${error}`, 'error');
    console.error('[AutoInit] Auto initialization error:', error);
    return false;
  }
}

/**
 * 获取表格数据（JSON格式）
 */
export function getTableData(ctx: ChatLogContext, chatId: string): TableDataResult {
  // tableTemplateService 将表格数据保存在 chatlog/ 目录下
  const safeChatId = getSafeChatId(chatId);

  // 从 chatlog 目录读取（tableTemplateService 保存的位置）
  const jsonPath = path.join(ctx.chatlogDir, `${safeChatId}.json`);

  addLog(`[getTableData] chatId=${chatId}, safeChatId=${safeChatId}, jsonPath=${jsonPath}, exists=${fs.existsSync(jsonPath)}`, 'debug');

  if (!fs.existsSync(jsonPath)) {
    addLog(`[getTableData] 表格文件不存在 (新对话或尚未创建表格): ${jsonPath}`, 'debug');
    // 尝试从 chats 目录查找（旧版 processChat 可能保存到这里）
    const fallbackPath = path.join(ctx.chatsDir, `${safeChatId}.json`);
    if (fs.existsSync(fallbackPath)) {
      addLog(`[getTableData] 从 chats 目录找到备份文件: ${fallbackPath}`, 'debug');
      try {
        const content = fs.readFileSync(fallbackPath, 'utf8');
        const jsonData = JSON.parse(content) as Partial<TableDataFile>;
        const hasData = (jsonData.sheets && jsonData.sheets.length > 0) ||
                        (jsonData.data && Object.keys(jsonData.data).length > 0);

        if (hasData) {
          addLog('[getTableData] 备份文件包含有效数据，直接返回', 'debug');
          return {
            sheets: jsonData.sheets || [],
            headers: jsonData.headers || {},
            data: jsonData.data || {},
            sheetDescriptions: {},
            filePath: fallbackPath
          };
        }

        addLog('[getTableData] 备份文件存在但数据为空，尝试自动初始化', 'debug');
        // fall through to auto-init
      } catch (e) {
        console.error('[getTableData] 读取备份文件失败:', e);
        // fall through to auto-init
      }
    }

    addLog('[getTableData] 尝试自动初始化聊天会话', 'debug');
    const initSuccess = autoInitializeChatSession(ctx, chatId);

    if (initSuccess) {
      addLog('[getTableData] 自动初始化成功，重新读取表格数据', 'info');
      return getTableData(ctx, chatId);
    }

    addLog('[getTableData] 自动初始化失败，返回空数据', 'debug');
    return { sheets: [], headers: {}, data: {}, sheetDescriptions: {}, filePath: '' };
  }

  try {
    const content = fs.readFileSync(jsonPath, 'utf8');
    const jsonData = JSON.parse(content) as TableDataFile;

    const sheets = jsonData.sheets || [];
    const headers = jsonData.headers || {};
    const data = jsonData.data || {};

    // 获取关联模板的表格描述信息
    let sheetDescriptions: Record<string, string> = {};
    try {
      const templateId = getAssociatedTemplate(ctx, chatId);
      if (templateId) {
        const templates = tableTemplateService.getAllTemplates();
        const template = templates?.find((t: TableTemplate) => t.id === templateId);
        if (template && template.sheets) {
          template.sheets.forEach((sheet: TableSheet) => {
            if (sheet.name) {
              sheetDescriptions[sheet.name] = sheet.description || '';
            }
          });
        }
      }
    } catch (descError) {
      console.warn('获取表格描述信息失败:', descError);
    }

    return { sheets, headers, data, sheetDescriptions, filePath: jsonPath };
  } catch (error) {
    console.error('读取JSON文件失败:', error);
    throw new Error(`读取JSON文件失败: ${(error as Error).message}`);
  }
}

/**
 * 保存表格数据（JSON格式）
 */
export function saveTableData(ctx: ChatLogContext, chatId: string, sheetName: string, sheetData: Record<string, unknown>[]): void {
  try {
    // 替换 chatId 中的路径分隔符和特殊字符，避免文件路径错误
    const safeChatId = getSafeChatId(chatId);

    // 确保目录存在
    if (!fs.existsSync(ctx.chatlogDir)) {
      fs.mkdirSync(ctx.chatlogDir, { recursive: true });
    }

    // 构建JSON文件路径
    const jsonPath = path.join(ctx.chatlogDir, `${safeChatId}.json`);

    addLog(`保存表格数据: chatId=${chatId}, sheetName=${sheetName}, rows=${sheetData.length}`, 'debug');

    // 读取现有文件或创建新文件
    let jsonData: TableDataFile = { sheets: [], data: {} };
    if (fs.existsSync(jsonPath)) {
      const existingData = fs.readFileSync(jsonPath, 'utf8');
      jsonData = JSON.parse(existingData) as TableDataFile;
    }

    // 更新工作表数据
    if (!jsonData.sheets.includes(sheetName)) {
      jsonData.sheets.push(sheetName);
    }
    jsonData.data[sheetName] = sheetData;

    // 保存文件
    fs.writeFileSync(jsonPath, JSON.stringify(jsonData, null, 2), 'utf8');
    addLog(`JSON文件保存成功: ${jsonPath}`, 'info');
  } catch (error) {
    console.error('保存表格数据失败:', error);
    throw error;
  }
}
