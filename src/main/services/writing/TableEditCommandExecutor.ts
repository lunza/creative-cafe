import { WritingTableData, saveTableDataFile } from './WritingTableRepository';
import { TableEditCommand } from '../memory/tableEditParser';
import { addLog } from '../memory/chatLogService';

/**
 * 表格编辑指令执行器。
 *
 * 职责：
 * - 接收 tableEditParser 解析出的 commands 列表
 * - 在内存中的 existingTableData 上执行 insertRow/updateRow/deleteRow
 * - 处理唯一 ID 重复时的合并更新逻辑
 * - 执行完毕后持久化到磁盘
 *
 * 从原 WritingStorageService.executeTableEditCommands 提取，逻辑保持完全一致。
 * 通过构造函数注入依赖（addLog 当前仍直接 import，但已隔离到此处）。
 */
export class TableEditCommandExecutor {
  /**
   * 在 existingTableData 上执行 commands，并立即持久化到磁盘。
   *
   * @param projectId 项目 ID（用于持久化路径）
   * @param commands tableEditParser 解析出的命令数组
   * @param existingTableData 内存中的表格数据（会被 mutate 并持久化）
   */
  execute(
    projectId: string,
    commands: TableEditCommand[],
    existingTableData: WritingTableData
  ): void {
    for (const command of commands) {
      try {
        const { type, tableIndex, rowIndex, data } = command;

        // 将 0-based tableIndex 转换为 sheet 名称
        if (tableIndex === undefined || tableIndex === null) {
          addLog(`[WritingOrganize] 命令缺少 tableIndex: ${JSON.stringify(command)}`, 'warn');
          continue;
        }

        const sheetName = existingTableData.sheets[tableIndex];
        if (!sheetName) {
          addLog(`[WritingOrganize] 页签不存在: tableIndex=${tableIndex}, sheets=${JSON.stringify(existingTableData.sheets)}`, 'warn');
          continue;
        }

        if (!existingTableData.data[sheetName]) {
          addLog(`[WritingOrganize] 页签数据不存在: ${sheetName}`, 'warn');
          continue;
        }

        addLog(`[WritingOrganize] 执行命令: ${type}(表格${tableIndex + 1}=${sheetName}${rowIndex !== undefined ? `,行${rowIndex + 1}` : ''})`, 'debug');

        if (type === 'insertRow') {
          const rowData = data || {};
          const uniqueId = rowData['1']; // "1" 对应唯一 ID 字段（索引1）

          if (uniqueId) {
            // 检查是否已存在相同唯一 ID 的行
            const existingIndex = existingTableData.data[sheetName].findIndex(
              (row) => row['1'] === uniqueId
            );

            if (existingIndex >= 0) {
              // 已存在相同唯一 ID，跳过插入或合并更新
              existingTableData.data[sheetName][existingIndex] = {
                ...existingTableData.data[sheetName][existingIndex],
                ...rowData
              };
              addLog(`[WritingOrganize] insertRow 去重: ${sheetName}, 唯一ID=${uniqueId} 已存在，执行合并更新`, 'debug');
            } else {
              // 唯一 ID 不存在，正常插入
              existingTableData.data[sheetName].push(rowData);
              addLog(`[WritingOrganize] insertRow 成功: ${sheetName}, 新增1行`, 'debug');
            }
          } else {
            // 没有唯一 ID 字段，直接插入
            existingTableData.data[sheetName].push(rowData);
            addLog(`[WritingOrganize] insertRow 成功: ${sheetName}, 新增1行（无唯一ID）`, 'debug');
          }
        } else if (type === 'updateRow' && typeof rowIndex === 'number') {
          if (rowIndex >= 0 && rowIndex < existingTableData.data[sheetName].length) {
            existingTableData.data[sheetName][rowIndex] = {
              ...existingTableData.data[sheetName][rowIndex],
              ...data
            };
            addLog(`[WritingOrganize] updateRow 成功: ${sheetName}, 行${rowIndex + 1}`, 'debug');
          } else {
            addLog(`[WritingOrganize] updateRow 行索引越界: rowIndex=${rowIndex}, 总行数=${existingTableData.data[sheetName].length}`, 'warn');
          }
        } else if (type === 'deleteRow' && typeof rowIndex === 'number') {
          if (rowIndex >= 0 && rowIndex < existingTableData.data[sheetName].length) {
            existingTableData.data[sheetName].splice(rowIndex, 1);
            addLog(`[WritingOrganize] deleteRow 成功: ${sheetName}, 行${rowIndex + 1}`, 'debug');
          } else {
            addLog(`[WritingOrganize] deleteRow 行索引越界: rowIndex=${rowIndex}, 总行数=${existingTableData.data[sheetName].length}`, 'warn');
          }
        } else {
          addLog(`[WritingOrganize] 未知命令类型: ${type}`, 'warn');
        }
      } catch (error) {
        addLog(`[WritingOrganize] 执行命令失败: ${error instanceof Error ? error.message : String(error)}`, 'error');
        console.error('[WritingOrganize] 执行命令失败:', error);
      }
    }

    saveTableDataFile(projectId, existingTableData);
    addLog(`[WritingOrganize] 表格数据已保存到文件`, 'debug');
  }
}
