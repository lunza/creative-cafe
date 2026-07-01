/**
 * 表格操作执行器
 * 负责：
 * - executeTableEditCommands：执行 tableEdit 命令（insertRow/updateRow/deleteRow），含去重检查
 * - executeTableOperations：执行 JSON 格式的表格操作（insert/update/delete）
 * - executeInsertOperation / executeUpdateOperation / executeDeleteOperation：底层行操作
 * - isSimilarName / levenshteinDistance：名称相似度计算（用于重复检测）
 * - generateSerialNumber / isExistingEntity / generateUniqueId：实体与流水号工具
 */

import fs from 'fs';
import path from 'path';
import { tableTemplateService } from './tableTemplateService';
import {
  addLog,
  getSafeChatId,
  ChatLogContext,
} from './logger';
import { resolveAvailableTemplate } from './associationRepository';
import type { TableEditCommand } from './tableEditParser';
import type { TableOperation } from './aiClient';

/**
 * 表格数据文件结构（chatlog/<safeChatId>.json）
 * 与 aiPromptBuilder / tableFileRepository 中的同名接口保持结构一致。
 */
interface TableDataFile {
  sheets: string[];
  headers?: Record<string, string[]>;
  data: Record<string, Record<string, unknown>[]>;
  sheetDescriptions?: Record<string, string>;
}

/**
 * 表格行数据：以字段索引（字符串形式的数字，如 '1' = 唯一id）为键。
 */
type TableRow = Record<string, unknown>;

/**
 * 检测两个名称是否相似（用于重复检测）
 * @param name1 名称1
 * @param name2 名称2
 * @returns 是否相似
 */
export function isSimilarName(name1: string, name2: string): boolean {
  if (!name1 || !name2) return false;

  const n1 = name1.trim().toLowerCase();
  const n2 = name2.trim().toLowerCase();

  // 完全相同
  if (n1 === n2) return true;

  // 一个包含另一个（长度差异不能太大）
  if (n1.includes(n2) || n2.includes(n1)) {
    const lengthRatio = Math.min(n1.length, n2.length) / Math.max(n1.length, n2.length);
    if (lengthRatio > 0.5) return true; // 长度比例大于50%认为是相似
  }

  // 计算编辑距离（Levenshtein distance）
  const distance = levenshteinDistance(n1, n2);
  const maxLength = Math.max(n1.length, n2.length);
  const similarity = 1 - distance / maxLength;

  // 相似度大于70%认为是相似的
  return similarity > 0.7;
}

/**
 * 计算两个字符串的Levenshtein编辑距离
 * @param s1 字符串1
 * @param s2 字符串2
 * @returns 编辑距离
 */
export function levenshteinDistance(s1: string, s2: string): number {
  const m = s1.length;
  const n = s2.length;

  // 创建二维数组
  const dp: number[][] = Array(m + 1).fill(null).map(() => Array(n + 1).fill(0));

  // 初始化
  for (let i = 0; i <= m; i++) dp[i][0] = i;
  for (let j = 0; j <= n; j++) dp[0][j] = j;

  // 动态规划计算编辑距离
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      if (s1[i - 1] === s2[j - 1]) {
        dp[i][j] = dp[i - 1][j - 1];
      } else {
        dp[i][j] = Math.min(
          dp[i - 1][j] + 1,     // 删除
          dp[i][j - 1] + 1,     // 插入
          dp[i - 1][j - 1] + 1  // 替换
        );
      }
    }
  }

  return dp[m][n];
}

/**
 * 执行tableEdit命令
 * @param chatId 聊天ID
 * @param commands tableEdit命令列表
 * @returns 执行结果
 */
export function executeTableEditCommands(ctx: ChatLogContext, chatId: string, commands: TableEditCommand[]): { success: boolean; executed: number; errors: string[] } {
  const result = { success: true, executed: 0, errors: [] as string[] };

  if (!commands || commands.length === 0) {
    addLog('没有需要执行的tableEdit命令', 'debug');
    return result;
  }

  // 确保表格文件存在（修复异步整理模式下表格文件未创建的问题）
  const safeChatId = getSafeChatId(chatId);
  const tableFilePath = path.join(ctx.chatlogDir, `${safeChatId}.json`);
  addLog(`[executeTableEditCommands] chatlogDir=${ctx.chatlogDir}, safeChatId=${safeChatId}, tableFilePath=${tableFilePath}, exists=${fs.existsSync(tableFilePath)}`, 'debug');
  if (!fs.existsSync(tableFilePath)) {
    addLog(`[executeTableEditCommands] 表格文件不存在，尝试自动初始化: ${tableFilePath}`, 'info');
    const templateId = resolveAvailableTemplate(ctx, chatId);
    addLog(`[executeTableEditCommands] resolveAvailableTemplate 返回: ${templateId}`, 'debug');
    if (!templateId) {
      addLog('[executeTableEditCommands] 没有可用的表格模板，无法自动创建', 'error');
      result.errors.push('表格文件不存在且没有可用的模板');
      return result;
    }
    try {
      addLog(`[executeTableEditCommands] 调用 createTableFile, templateId=${templateId}`, 'debug');
      const createdPath = tableTemplateService.createTableFile(chatId, templateId, safeChatId);
      addLog(`[executeTableEditCommands] createTableFile 返回路径: ${createdPath}, 创建后 exists=${fs.existsSync(tableFilePath)}`, 'debug');
      addLog(`[executeTableEditCommands] 表格文件已自动创建: ${tableFilePath}`, 'info');
      if (!fs.existsSync(tableFilePath)) {
        addLog(`[executeTableEditCommands] 警告：表格文件创建后验证失败: ${tableFilePath}`, 'error');
        result.errors.push('表格文件创建后验证失败');
        return result;
      }
    } catch (createError) {
      addLog(`[executeTableEditCommands] 创建表格文件失败: ${createError}`, 'error');
      console.error(`[executeTableEditCommands] createTableFile 异常:`, createError);
      result.errors.push(`创建表格文件失败: ${createError}`);
      return result;
    }
  } else {
    addLog(`[executeTableEditCommands] 表格文件已存在: ${tableFilePath}`, 'info');
  }

  addLog(`开始执行 ${commands.length} 个tableEdit命令`, 'info');

  commands.forEach((command, index) => {
    try {
      const { type, tableIndex, rowIndex, data } = command;

      addLog(`执行命令 ${index + 1}/${commands.length}: ${type}(表格${tableIndex}${rowIndex !== undefined ? `,行${rowIndex}` : ''})`, 'debug');

      let success = false;

      switch (type) {
        case 'insertRow':
          // 去重检查：读取当前表格数据，检查是否已存在相同唯一ID或相似名称的记录
          const existingTable = tableTemplateService.getTableByIndex(chatId, tableIndex);
          if (existingTable && existingTable.data && Array.isArray(existingTable.data)) {
            const existingRows = existingTable.data as TableRow[];
            const rowData = data || {};
            const uniqueId = rowData['1']; // 字段索引1是唯一id（0-based，AI的字段2转换后为1）
            const itemName = rowData['2'] || ''; // 字段索引2是物品名/角色名等（0-based）

            // 1. 首先检查唯一ID是否重复
            const isDuplicateById = uniqueId && existingRows.some((row) => row['1'] === uniqueId);

            // 2. 如果唯一ID不重复，检查名称是否相似（物品名、角色名等）
            let isDuplicateByName = false;
            let similarRowIndex = -1;
            if (!isDuplicateById && itemName) {
              for (let i = 0; i < existingRows.length; i++) {
                const existingName = String(existingRows[i]['2'] || ''); // 字段索引2是名称
                if (existingName && isSimilarName(itemName, existingName)) {
                  isDuplicateByName = true;
                  similarRowIndex = i;
                  addLog(`检测到名称相似重复(新名称="${itemName}", 现有名称="${existingName}")，行索引=${i + 1}`, 'warn');
                  break;
                }
              }
            }

            if (isDuplicateById) {
              addLog(`检测到重复插入(唯一id=${uniqueId})，转换为更新操作`, 'warn');
              // 找到已存在记录的行索引（0-based）
              const existingRowIndex = existingRows.findIndex((row) => row['1'] === uniqueId);
              if (existingRowIndex >= 0) {
                // 转换为updateRow命令
                success = tableTemplateService.updateRowInTable(chatId, tableIndex, existingRowIndex, rowData);
                if (success) {
                  addLog(`insertRow转updateRow执行成功: 表格${tableIndex},行${existingRowIndex + 1}`, 'info');
                } else {
                  result.errors.push(`insertRow转updateRow失败: 表格${tableIndex},行${existingRowIndex + 1}`);
                }
              } else {
                success = tableTemplateService.insertRowToTable(chatId, tableIndex, rowData);
              }
            } else if (isDuplicateByName && similarRowIndex >= 0) {
              addLog(`检测到名称相似重复，转换为更新操作(行${similarRowIndex + 1})`, 'warn');
              // 名称相似，转换为updateRow
              success = tableTemplateService.updateRowInTable(chatId, tableIndex, similarRowIndex, rowData);
              if (success) {
                addLog(`insertRow转updateRow(名称相似)执行成功: 表格${tableIndex},行${similarRowIndex + 1}`, 'info');
              } else {
                result.errors.push(`insertRow转updateRow(名称相似)失败: 表格${tableIndex},行${similarRowIndex + 1}`);
              }
            } else {
              success = tableTemplateService.insertRowToTable(chatId, tableIndex, rowData);
              if (success) {
                addLog(`insertRow 执行成功: 表格${tableIndex}`, 'info');
              } else {
                result.errors.push(`insertRow 失败: 表格${tableIndex}`);
              }
            }
          } else {
            success = tableTemplateService.insertRowToTable(chatId, tableIndex, data || {});
          }
          break;

        case 'updateRow':
          if (rowIndex === undefined) {
            result.errors.push(`updateRow 失败: 缺少行索引参数`);
            addLog('updateRow 失败: 缺少行索引参数', 'error');
          } else {
            success = tableTemplateService.updateRowInTable(chatId, tableIndex, rowIndex, data || {});
            if (success) {
              addLog(`updateRow 执行成功: 表格${tableIndex},行${rowIndex + 1}`, 'info');
            } else {
              result.errors.push(`updateRow 失败: 表格${tableIndex},行${rowIndex + 1}`);
            }
          }
          break;


        case 'deleteRow':
          if (rowIndex === undefined) {
            result.errors.push(`deleteRow 失败: 缺少行索引参数`);
            addLog('deleteRow 失败: 缺少行索引参数', 'error');
          } else {
            success = tableTemplateService.deleteRowFromTable(chatId, tableIndex, rowIndex);
            if (success) {
              addLog(`deleteRow 执行成功: 表格${tableIndex},行${rowIndex + 1}`, 'info');
            } else {
              result.errors.push(`deleteRow 失败: 表格${tableIndex},行${rowIndex + 1}`);
            }
          }
          break;

        default:
          result.errors.push(`未知命令类型: ${type}`);
          addLog(`未知命令类型: ${type}`, 'error');
          break;
      }

      if (success) {
        result.executed++;
      }
    } catch (error) {
      const errorMsg = `命令 ${index + 1} 执行异常: ${error instanceof Error ? error.message : String(error)}`;
      result.errors.push(errorMsg);
      addLog(errorMsg, 'error');
      if (error instanceof Error && error.stack) {
        addLog(`错误堆栈: ${error.stack}`, 'debug');
      }
    }
  });

  if (result.errors.length > 0) {
    addLog(`命令执行完成，但有 ${result.errors.length} 个错误`, 'warn');
    result.errors.forEach(err => addLog(`  错误: ${err}`, 'warn'));
  } else {
    addLog(`所有 ${result.executed} 个命令执行成功`, 'info');
  }

  return result;
}

/**
 * 生成唯一ID
 */
export function generateUniqueId(): string {
  return `id_${Date.now()}_${Math.floor(Math.random() * 10000)}`;
}

/**
 * 生成流水号
 */
export function generateSerialNumber(sheetData: TableRow[]): number {
  if (sheetData.length === 0) {
    return 1;
  }
  const serialNumbers = sheetData.map(item => parseInt(String(item['流水号'] ?? '0'))).filter(num => !isNaN(num));
  return serialNumbers.length > 0 ? Math.max(...serialNumbers) + 1 : 1;
}

/**
 * 检查是否为现有实体
 */
export function isExistingEntity(sheetData: TableRow[], data: TableRow): boolean {
  if (!data['唯一id']) {
    return false;
  }
  return sheetData.some(item => item['唯一id'] === data['唯一id']);
}

/**
 * 执行表格操作（JSON格式）
 */
export function executeTableOperations(ctx: ChatLogContext, chatId: string, templateId: string, operations: TableOperation[]): string {
  try {
    // 替换 chatId 中的路径分隔符和特殊字符，避免文件路径错误
    const safeChatId = getSafeChatId(chatId);

    // 确保目录存在
    if (!fs.existsSync(ctx.chatlogDir)) {
      addLog(`目录 ${ctx.chatlogDir} 不存在，创建目录`, 'info');
      fs.mkdirSync(ctx.chatlogDir, { recursive: true });
    }

    // 构建JSON文件路径
    const jsonPath = path.join(ctx.chatlogDir, `${safeChatId}.json`);
    addLog(`尝试访问 JSON 文件: ${jsonPath}`, 'info');
    addLog(`检查文件是否存在: ${fs.existsSync(jsonPath) ? '是' : '否'}`, 'info');

    // 读取或创建JSON文件
    let jsonData: TableDataFile = { sheets: [], data: {} };
    if (fs.existsSync(jsonPath)) {
      addLog(`读取现有 JSON 文件: ${jsonPath}`, 'info');
      const existingData = fs.readFileSync(jsonPath, 'utf8');
      jsonData = JSON.parse(existingData) as TableDataFile;
    } else {
      addLog(`JSON 文件不存在，创建新文件: ${jsonPath}`, 'info');
      // 从模板中获取工作表信息
      const template = tableTemplateService.getTemplate(templateId);
      if (template) {
        addLog(`从模板 ${templateId} 中获取工作表信息`, 'info');
        // 初始化工作表和数据
        jsonData = {
          sheets: template.sheets.map(sheet => sheet.name),
          data: {}
        };
        // 为每个工作表初始化数据
        template.sheets.forEach(sheet => {
          jsonData.data[sheet.name] = [];
        });
      } else {
        addLog(`模板 ${templateId} 不存在，使用默认数据结构`, 'warn');
        // 初始化默认数据结构
        jsonData = { sheets: [], data: {} };
      }
    }

    addLog(`JSON 文件包含的工作表: ${jsonData.sheets.join(', ')}`, 'info');

    // 执行操作
    let operationCount = 0;
    operations.forEach((operation, index) => {
      try {
        const { sheetName, operation: opType, data, condition, description } = operation;
        const opData: TableRow = data ?? {};
        const opCondition: TableRow = condition ?? {};

        addLog(`执行操作 ${index + 1}/${operations.length}: ${opType} 到 ${sheetName}`, 'info');
        addLog(`操作数据: ${JSON.stringify(opData)}`, 'debug');
        addLog(`操作条件: ${JSON.stringify(opCondition)}`, 'debug');
        addLog(`操作说明: ${description}`, 'debug');

        // 确保工作表存在
        if (!jsonData.sheets.includes(sheetName)) {
          addLog(`工作表 ${sheetName} 不存在，创建新工作表`, 'info');
          jsonData.sheets.push(sheetName);
          jsonData.data[sheetName] = [];
        }

        let sheetData: TableRow[] = jsonData.data[sheetName] || [];
        addLog(`工作表 ${sheetName} 当前数据行数: ${sheetData.length}`, 'debug');

        if (opType === 'insert') {
          // 检查是否为现有实体
          const isExisting = isExistingEntity(sheetData, opData);
          if (isExisting) {
            // 更新现有实体
            for (let i = 0; i < sheetData.length; i++) {
              if (sheetData[i]['唯一id'] === opData['唯一id']) {
                Object.assign(sheetData[i], opData);
                addLog(`执行更新操作成功，更新现有实体`, 'info');
                operationCount++;
                break;
              }
            }
          } else {
            // 为新实体生成唯一ID和流水号
            const newData: TableRow = { ...opData };
            if (!newData['唯一id']) {
              newData['唯一id'] = generateUniqueId();
            }
            newData['流水号'] = generateSerialNumber(sheetData);
            sheetData.push(newData);
            addLog(`执行插入操作成功，创建新实体`, 'info');
            operationCount++;
          }
        } else if (opType === 'update') {
          // 执行更新操作
          for (let i = 0; i < sheetData.length; i++) {
            let match = true;
            for (const [key, value] of Object.entries(opCondition)) {
              if (sheetData[i][key] !== value) {
                match = false;
                break;
              }
            }
            if (match) {
              Object.assign(sheetData[i], opData);
              addLog(`执行更新操作成功`, 'info');
              operationCount++;
              break;
            }
          }
        } else if (opType === 'delete') {
          // 执行删除操作
          const initialLength = sheetData.length;
          sheetData = sheetData.filter(row => {
            for (const [key, value] of Object.entries(opCondition)) {
              if (row[key] !== value) {
                return true;
              }
            }
            return false;
          });
          if (sheetData.length < initialLength) {
            addLog(`执行删除操作成功`, 'info');
            operationCount++;
          }
        } else {
          addLog(`未知的操作类型: ${opType}`, 'warn');
        }

        // 更新工作表数据
        jsonData.data[sheetName] = sheetData;
        addLog(`更新工作表 ${sheetName} 成功`, 'info');
      } catch (error) {
        addLog(`执行操作 ${index + 1} 失败: ${error}`, 'error');
      }
    });

    // 保存 JSON 文件
    addLog(`保存 JSON 文件: ${jsonPath}`, 'info');
    try {
      fs.writeFileSync(jsonPath, JSON.stringify(jsonData, null, 2), 'utf8');
      addLog(`文件保存成功`, 'info');
    } catch (saveError) {
      addLog(`保存 JSON 文件失败: ${saveError}`, 'error');
      if (saveError instanceof Error) {
        addLog(`错误堆栈: ${saveError.stack}`, 'error');
      }
      throw saveError;
    }
    addLog(`保存 JSON 文件成功`, 'info');
    addLog(`共执行 ${operationCount} 个操作`, 'info');

    // 如果没有执行任何操作，记录警告但不抛出错误
    if (operationCount === 0) {
      addLog('警告: 没有执行任何表格操作（AI 可能没有从聊天记录中提取到可操作的信息）', 'warn');
    }

    return jsonPath;
  } catch (error) {
    addLog(`执行表格操作失败: ${error}`, 'error');
    throw error;
  }
}

/**
 * 执行插入操作
 */
export function executeInsertOperation(data: unknown[][], newRow: Record<string, unknown>): void {
  // 获取表头
  const headers = (data[0] as string[]) ?? [];

  // 构建新行
  const row = headers.map(header => newRow[header] ?? '');

  // 添加新行
  data.push(row);
}

/**
 * 执行更新操作
 */
export function executeUpdateOperation(data: unknown[][], updates: Record<string, unknown>, condition: Record<string, unknown>): void {
  // 获取表头
  const headers = (data[0] as string[]) ?? [];

  // 遍历数据行
  for (let i = 1; i < data.length; i++) {
    const row = data[i] as unknown[];
    let match = true;

    // 检查是否匹配条件
    for (const [key, value] of Object.entries(condition)) {
      const headerIndex = headers.indexOf(key);
      if (headerIndex === -1 || row[headerIndex] !== value) {
        match = false;
        break;
      }
    }

    // 如果匹配，更新数据
    if (match) {
      for (const [key, value] of Object.entries(updates)) {
        const headerIndex = headers.indexOf(key);
        if (headerIndex !== -1) {
          row[headerIndex] = value;
        }
      }
    }
  }
}

/**
 * 执行删除操作
 */
export function executeDeleteOperation(data: unknown[][], condition: Record<string, unknown>): void {
  // 获取表头
  const headers = (data[0] as string[]) ?? [];

  // 遍历数据行，从后往前删除
  for (let i = data.length - 1; i >= 1; i--) {
    const row = data[i] as unknown[];
    let match = true;

    // 检查是否匹配条件
    for (const [key, value] of Object.entries(condition)) {
      const headerIndex = headers.indexOf(key);
      if (headerIndex === -1 || row[headerIndex] !== value) {
        match = false;
        break;
      }
    }

    // 如果匹配，删除行
    if (match) {
      data.splice(i, 1);
    }
  }
}
