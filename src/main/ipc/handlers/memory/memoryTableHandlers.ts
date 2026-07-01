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
import { ipcMain, IpcMainInvokeEvent } from 'electron';
import { tableTemplateService } from '../../../services/memory/tableTemplateService';
import { tableEditParser } from '../../../services/memory/tableEditParser';
import { chatLogService } from '../../../services/memory/chatLogService';
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
}
