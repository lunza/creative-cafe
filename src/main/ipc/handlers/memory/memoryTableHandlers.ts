/**
 * 记忆插件 - 表格文件 / tableEdit 命令 IPC handler
 *
 * 涵盖：
 *   - 表格文件 CRUD（createTableFile / readTableFile / updateTableFile）
 *   - 行级更新（updateRowInTable）
 *   - tableEdit 命令解析与执行（parseTableEdit / executeTableEditCommands）
 *   - 表格数据整体读写（getTableData / saveTableData / clearTableData）
 *
 * 对于「try/catch + console.error + throw」模式的 handler，统一通过
 * utils/wrapHandler 包装以消除重复样板；对于返回兜底值的 handler，
 * 保留原 try/catch 结构以保持 IPC 响应形态不变。
 *
 * 注意：`memory:getTableData` 包含 IPC 序列化校验逻辑（原始行为），
 * 不能简单交给 wrapHandler 包装，需保留原结构。
 */
import fs from 'fs';
import path from 'path';
import { ipcMain, IpcMainInvokeEvent } from 'electron';
import { tableTemplateService } from '../../../services/memory/tableTemplateService';
import { tableEditParser } from '../../../services/memory/tableEditParser';
import { chatLogService } from '../../../services/memory/chatLogService';
import { getUserDataPath } from '../../../utils/appPath';
import { wrapHandler } from '../utils/wrapHandler';

export function registerMemoryTableHandlers(): void {
  // ========== 表格文件 CRUD ==========

  /**
   * 创建表格文件
   */
  ipcMain.handle(
    'memory:createTableFile',
    wrapHandler(async (_event: IpcMainInvokeEvent, chatId: string, templateId: string): Promise<string> => {
      return tableTemplateService.createTableFile(chatId, templateId);
    })
  );

  /**
   * 读取表格文件
   */
  ipcMain.handle(
    'memory:readTableFile',
    wrapHandler(async (_event: IpcMainInvokeEvent, chatId: string): Promise<Record<string, any[]>> => {
      return tableTemplateService.readTableFile(chatId);
    })
  );

  /**
   * 更新表格文件
   */
  ipcMain.handle(
    'memory:updateTableFile',
    wrapHandler(async (_event: IpcMainInvokeEvent, chatId: string, sheetName: string, data: any[]): Promise<string> => {
      return tableTemplateService.updateTableFile(chatId, sheetName, data);
    })
  );

  // ========== 行级更新 ==========

  /**
   * 更新表格中的特定行
   */
  ipcMain.handle('memory:updateRowInTable', async (
    _event: IpcMainInvokeEvent,
    chatId: string,
    tableIndex: number,
    rowIndex: number,
    rowData: Record<string, string>
  ): Promise<boolean> => {
    try {
      return tableTemplateService.updateRowInTable(chatId, tableIndex, rowIndex, rowData);
    } catch (error) {
      return false;
    }
  });

  // ========== tableEdit 命令解析与执行 ==========

  /**
   * 直接执行tableEdit命令（用于异步整理模式）
   */
  ipcMain.handle('memory:executeTableEditCommands', async (
    _event: IpcMainInvokeEvent,
    chatId: string,
    commands: any[]
  ): Promise<{ success: boolean; executed: number; errors: string[] }> => {
    try {
      console.log('[IPC] 执行tableEdit命令:', { chatId, commandCount: commands.length });
      return chatLogService.executeTableEditCommands(chatId, commands);
    } catch (error) {
      return { success: false, executed: 0, errors: [error instanceof Error ? error.message : String(error)] };
    }
  });

  /**
   * 解析tableEdit命令（用于异步整理模式）
   */
  ipcMain.handle('memory:parseTableEdit', async (
    _event: IpcMainInvokeEvent,
    content: string
  ): Promise<{ success: boolean; commands: any[]; errors: string[] }> => {
    try {
      console.log('[IPC] 解析tableEdit命令:', { contentLength: content.length });
      return tableEditParser.parse(content);
    } catch (error) {
      return { success: false, commands: [], errors: [error instanceof Error ? error.message : String(error)] };
    }
  });

  // ========== 表格数据整体读写 ==========

  /**
   * 清理表格数据（删除表格JSON文件并重置进度）
   */
  ipcMain.handle(
    'memory:clearTableData',
    wrapHandler(async (_event: IpcMainInvokeEvent, chatId: string): Promise<{ success: boolean }> => {
      console.log('清理表格数据:', chatId);
      chatLogService.clearTableData(chatId);
      return { success: true };
    })
  );

  /**
   * 获取表格数据
   *
   * 包含 IPC 序列化校验：若结果无法被 JSON.stringify 序列化（例如含循环引用
   * 或非普通对象），则返回空结构以避免 IPC 传输失败。保留原始行为。
   */
  ipcMain.handle('memory:getTableData', async (_event: IpcMainInvokeEvent, chatId: string): Promise<any> => {
    console.log('[IPC] memory:getTableData 请求, chatId:', chatId);
    const result = chatLogService.getTableData(chatId);

    // 确保返回的数据是纯 JSON 可序列化的，避免 IPC 传输失败
    const serializableResult = {
      sheets: result?.sheets || [],
      headers: result?.headers || {},
      data: result?.data || {},
      sheetDescriptions: result?.sheetDescriptions || {}
    };

    try {
      JSON.stringify(serializableResult);
      console.log('[IPC] memory:getTableData 数据序列化验证通过');
    } catch (e) {
      console.error('[IPC] memory:getTableData 数据序列化失败，返回空数据:', e);
      return { sheets: [], headers: {}, data: {}, sheetDescriptions: {} };
    }

    console.log('[IPC] memory:getTableData 返回结果:', JSON.stringify({
      sheets: serializableResult.sheets,
      headersKeys: Object.keys(serializableResult.headers),
      dataKeys: Object.keys(serializableResult.data),
      dataSummary: Object.fromEntries(Object.entries(serializableResult.data).map(([k, v]) => [k, Array.isArray(v) ? v.length : typeof v]))
    }, null, 2));

    console.log('[IPC] memory:getTableData 即将通过 IPC 返回数据');
    return serializableResult;
  });

  /**
   * 保存表格数据
   */
  ipcMain.handle(
    'memory:saveTableData',
    wrapHandler(async (_event: IpcMainInvokeEvent, chatId: string, sheetName: string, sheetData: any[]): Promise<void> => {
      console.log('保存表格数据:', { chatId, sheetName, dataCount: sheetData.length });
      chatLogService.saveTableData(chatId, sheetName, sheetData);
      console.log('表格数据保存成功');
    })
  );

  // ========== 表格快照恢复 ==========

  /**
   * 从快照文件恢复表格数据
   *
   * 读取版本链中的表格快照文件，将其数据写回当前聊天表格文件。
   * 成功时返回 { success: true, sheets, headers, data }，
   * 失败时返回 { success: false, error: string }。
   */
  ipcMain.handle('memory:restoreTableFromSnapshot', async (
    _event: IpcMainInvokeEvent,
    chatId: string,
    versionLinkId: string
  ): Promise<{ success: boolean; sheets?: string[]; headers?: Record<string, string[]>; data?: Record<string, any[]>; error?: string }> => {
    try {
      const safeChatId = chatId.replace(/[<>:"/\\|?*\x00-\x1F]/g, '_');
      const userDataPath = getUserDataPath();

      // 构建快照文件路径: {userDataPath}/data/memories/chats/{safeChatId}/versions/table/{versionLinkId}.json
      const snapshotPath = path.join(userDataPath, 'data', 'memories', 'chats', safeChatId, 'versions', 'table', `${versionLinkId}.json`);

      if (!fs.existsSync(snapshotPath)) {
        return { success: false, error: '表格快照不存在' };
      }

      // 读取快照数据
      const snapshotContent = fs.readFileSync(snapshotPath, 'utf8');
      const snapshotData = JSON.parse(snapshotContent);

      const sheets: string[] = snapshotData.sheets || [];
      const headers: Record<string, string[]> = snapshotData.headers || {};
      const data: Record<string, any[]> = snapshotData.data || {};

      // 构建当前表格文件路径: {userDataPath}/data/memories/chatlog/{safeChatId}.json
      const currentTablePath = path.join(userDataPath, 'data', 'memories', 'chatlog', `${safeChatId}.json`);

      // 确保目录存在
      const chatlogDir = path.dirname(currentTablePath);
      if (!fs.existsSync(chatlogDir)) {
        fs.mkdirSync(chatlogDir, { recursive: true });
      }

      // 写入当前表格文件，格式与现有表格文件一致
      fs.writeFileSync(currentTablePath, JSON.stringify({ sheets, headers, data, sheetDescriptions: {} }, null, 2), 'utf8');

      console.log('[IPC] 表格快照恢复成功:', { chatId, versionLinkId, sheets, dataCount: Object.keys(data).length });

      return { success: true, sheets, headers, data };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      console.error('[IPC] 表格快照恢复失败:', errorMessage);
      return { success: false, error: errorMessage };
    }
  });
}
