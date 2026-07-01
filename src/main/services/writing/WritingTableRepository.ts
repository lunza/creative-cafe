import fs from 'fs';
import path from 'path';
import { WritingProject } from '../../../shared/types/writing.types';
import { getProjectDir } from './WritingProjectRepository';
import { addLog } from '../memory/chatLogService';

// ==================== 类型定义 ====================

export interface WritingTableData {
  sheets: string[];
  headers: Record<string, string[]>;
  data: Record<string, Record<string, any>[]>;
  sheetDescriptions: Record<string, string>;
}

export interface WritingTableConfig {
  enabled: boolean;
  autoOrganize: boolean;
  organizeMode: 'sync' | 'async';
  associatedTemplateId: string | null;
  associatedTemplateName: string;
  organizeRequirements?: string;
}

export interface WritingOrganizeProgress {
  projectId: string;
  status: 'idle' | 'running' | 'completed' | 'error';
  currentChapter: number;
  totalChapters: number;
  processedCount: number;
  errorCount: number;
  errors: string[];
  lastProcessedAt?: string;
  startedAt?: number | string;
}

/**
 * 表格数据对比记录 - compareTableData 的返回类型
 *
 * 注意：data 字段沿用 `Record<string, any>[]`（与 WritingTableData.data 对齐，
 * 与 shared/types/writing-table.types.ts 单一真源保持一致），不强行收窄为 unknown
 * 以避免 deduplicateTableData 等消费方的连锁类型错误（Set<string>.has(unknown) 等）。
 */
export interface TableChangeRecord {
  addedRows: Array<{ sheetName: string; rowIndex: number; rowData: Record<string, unknown> }>;
  modifiedCells: Array<{ sheetName: string; rowIndex: number; columnName: string; oldValue: unknown; newValue: unknown }>;
  deletedRows: Array<{ sheetName: string; rowIndex: number; rowData: Record<string, unknown> }>;
}

/**
 * 版本快照 - getVersionSnapshot 的返回类型
 *
 * 在 confirmVersion / rollbackVersion 中用于恢复/回退表格数据。
 */
export interface VersionSnapshot {
  id: string;
  projectId: string;
  chapterIndex?: number;
  originalData: WritingTableData;
  newData: WritingTableData;
  changeRecord: TableChangeRecord;
  createdAt: number;
  expiresAt: number;
}

// ==================== 路径 helper ====================

export function getWritingTablesDir(projectId: string): string {
  const projectDir = getProjectDir(projectId);
  const tablesDir = path.join(projectDir, 'tables');
  if (!fs.existsSync(tablesDir)) {
    fs.mkdirSync(tablesDir, { recursive: true });
  }
  return tablesDir;
}

export function getWritingTableFile(projectId: string): string {
  const tablesDir = getWritingTablesDir(projectId);
  return path.join(tablesDir, 'table-data.json');
}

export function getWritingTableConfigFile(projectId: string): string {
  const tablesDir = getWritingTablesDir(projectId);
  return path.join(tablesDir, 'table-config.json');
}

export function getWritingOrganizeProgressFile(projectId: string): string {
  const tablesDir = getWritingTablesDir(projectId);
  return path.join(tablesDir, 'organize-progress.json');
}

export function getVersionSnapshotFile(projectId: string): string {
  const tablesDir = getWritingTablesDir(projectId);
  return path.join(tablesDir, 'version-snapshot.json');
}

// ==================== 文件读写 helper ====================
// 这些函数被 TableOrganizeService / TableEditCommandExecutor 等模块复用。

export function loadTableData(projectId: string): WritingTableData | null {
  const tableFile = getWritingTableFile(projectId);
  try {
    if (fs.existsSync(tableFile)) {
      const data = fs.readFileSync(tableFile, 'utf8');
      return JSON.parse(data);
    }
  } catch (error) {
    console.error('[WritingStorage] Failed to load table data:', error);
  }
  return null;
}

export function saveTableDataFile(projectId: string, data: WritingTableData): void {
  const tableFile = getWritingTableFile(projectId);
  try {
    fs.writeFileSync(tableFile, JSON.stringify(data, null, 2), 'utf8');
  } catch (error) {
    console.error('[WritingStorage] Failed to save table data:', error);
  }
}

export function loadTableConfig(projectId: string): WritingTableConfig | null {
  const configFile = getWritingTableConfigFile(projectId);
  try {
    if (fs.existsSync(configFile)) {
      const data = fs.readFileSync(configFile, 'utf8');
      return JSON.parse(data);
    }
  } catch (error) {
    console.error('[WritingStorage] Failed to load table config:', error);
  }
  return null;
}

export function saveTableConfigFile(projectId: string, config: WritingTableConfig): void {
  const configFile = getWritingTableConfigFile(projectId);
  try {
    fs.writeFileSync(configFile, JSON.stringify(config, null, 2), 'utf8');
  } catch (error) {
    console.error('[WritingStorage] Failed to save table config:', error);
  }
}

/**
 * 表格数据存储仓储。
 *
 * 职责：
 * - 表格数据 CRUD（getTableData/saveTableData/clearTableData/updateRowInTable）
 * - 表格配置管理（getTableConfig/saveTableConfig/associateTableTemplate）
 * - 整理进度文件读写（getOrganizeProgress/saveOrganizeProgress）
 * - 版本快照管理（saveVersionSnapshot/getVersionSnapshot/clearVersionSnapshot/confirmVersion/rollbackVersion）
 * - 表格数据对比（compareTableData）
 *
 * 所有方法签名与原 WritingStorageService 同名方法保持一致。
 * 注意：本仓储只关心表格数据/配置/版本，不依赖 WritingProjectRepository。
 * getChapterOrganizeStatus 接受 project 参数以避免跨仓储依赖。
 */
export class WritingTableRepository {
  async getTableData(projectId: string): Promise<WritingTableData | null> {
    return loadTableData(projectId);
  }

  async saveTableData(projectId: string, sheetName: string, sheetData: Record<string, unknown>[]): Promise<void> {
    const existing = loadTableData(projectId) || { sheets: [], headers: {}, data: {}, sheetDescriptions: {} };
    existing.data[sheetName] = sheetData;
    saveTableDataFile(projectId, existing);
  }

  async clearTableData(projectId: string): Promise<void> {
    const tableFile = getWritingTableFile(projectId);
    if (fs.existsSync(tableFile)) {
      fs.unlinkSync(tableFile);
    }
  }

  async updateRowInTable(projectId: string, sheetName: string, rowIndex: number, rowData: Record<string, unknown>): Promise<boolean> {
    const existing = loadTableData(projectId);
    if (!existing || !existing.data[sheetName]) return false;
    if (rowIndex >= existing.data[sheetName].length) return false;
    existing.data[sheetName][rowIndex] = rowData;
    saveTableDataFile(projectId, existing);
    return true;
  }

  async getTableConfig(projectId: string): Promise<WritingTableConfig | null> {
    return loadTableConfig(projectId);
  }

  async saveTableConfig(projectId: string, config: WritingTableConfig): Promise<void> {
    saveTableConfigFile(projectId, config);
  }

  async associateTableTemplate(projectId: string, templateId: string, templateName: string, templateSheets: Array<{ name: string; headers: string[]; description?: string }>): Promise<void> {
    if (!templateSheets || !Array.isArray(templateSheets) || templateSheets.length === 0) {
      console.error('[DEBUG Service] 模板页签数据为空');
      throw new Error('模板页签数据为空');
    }

    const tableData: WritingTableData = {
      sheets: templateSheets.map(s => s.name),
      headers: {},
      data: {},
      sheetDescriptions: {}
    };

    for (const sheet of templateSheets) {
      tableData.headers[sheet.name] = sheet.headers;
      tableData.data[sheet.name] = [];
      tableData.sheetDescriptions[sheet.name] = sheet.description || '';
    }

    saveTableDataFile(projectId, tableData);

    const config: WritingTableConfig = {
      enabled: true,
      autoOrganize: false,
      organizeMode: 'sync',
      associatedTemplateId: templateId,
      associatedTemplateName: templateName
    };
    saveTableConfigFile(projectId, config);
  }

  async getOrganizeProgress(projectId: string): Promise<WritingOrganizeProgress | null> {
    const progressFile = getWritingOrganizeProgressFile(projectId);
    try {
      if (fs.existsSync(progressFile)) {
        const data = fs.readFileSync(progressFile, 'utf8');
        return JSON.parse(data);
      }
    } catch (error) {
      console.error('[WritingStorage] Failed to load organize progress:', error);
    }
    return null;
  }

  saveOrganizeProgress(projectId: string, progress: WritingOrganizeProgress): void {
    const progressFile = getWritingOrganizeProgressFile(projectId);
    try {
      fs.writeFileSync(progressFile, JSON.stringify(progress, null, 2), 'utf8');
    } catch (error) {
      console.error('[WritingStorage] Failed to save organize progress:', error);
    }
  }

  /**
   * 计算章节整理状态。接受已加载的 project 以避免依赖 WritingProjectRepository。
   */
  getChapterOrganizeStatus(project: WritingProject | null): { chapterIndex: number; title: string; status: string }[] {
    if (!project?.outline?.chapters) return [];
    return project.outline.chapters
      .filter(ch => ch.content && ch.content.trim().length > 0)
      .map(ch => ({
        chapterIndex: ch.index,
        title: ch.title,
        status: ch.status || 'pending'
      }));
  }

  // ==================== 版本快照 ====================

  async saveVersionSnapshot(
    projectId: string,
    chapterIndex: number | undefined,
    originalData: WritingTableData,
    newData: WritingTableData
  ): Promise<void> {
    const changeRecord = this.compareTableData(originalData, newData);
    const snapshot = {
      id: `v-${Date.now()}`,
      projectId,
      chapterIndex,
      originalData,
      newData,
      changeRecord,
      createdAt: Date.now(),
      expiresAt: Date.now() + 24 * 60 * 60 * 1000 // 24小时后过期
    };

    const snapshotFile = getVersionSnapshotFile(projectId);
    try {
      fs.writeFileSync(snapshotFile, JSON.stringify(snapshot, null, 2), 'utf8');
      addLog(`[WritingOrganize] 版本快照已保存: ${snapshot.id}`, 'info');
    } catch (error) {
      console.error('[WritingStorage] Failed to save version snapshot:', error);
      throw error;
    }
  }

  async getVersionSnapshot(projectId: string): Promise<VersionSnapshot | null> {
    const snapshotFile = getVersionSnapshotFile(projectId);
    try {
      if (fs.existsSync(snapshotFile)) {
        const data = fs.readFileSync(snapshotFile, 'utf8');
        const snapshot: VersionSnapshot = JSON.parse(data);

        // 检查是否过期
        if (Date.now() > snapshot.expiresAt) {
          addLog(`[WritingOrganize] 版本快照已过期，自动清理`, 'info');
          await this.clearVersionSnapshot(projectId);
          return null;
        }

        return snapshot;
      }
    } catch (error) {
      console.error('[WritingStorage] Failed to load version snapshot:', error);
    }
    return null;
  }

  async clearVersionSnapshot(projectId: string): Promise<void> {
    const snapshotFile = getVersionSnapshotFile(projectId);
    try {
      if (fs.existsSync(snapshotFile)) {
        fs.unlinkSync(snapshotFile);
        addLog(`[WritingOrganize] 版本快照已清除`, 'info');
      }
    } catch (error) {
      console.error('[WritingStorage] Failed to clear version snapshot:', error);
    }
  }

  async confirmVersion(projectId: string): Promise<{ success: boolean; error?: string }> {
    try {
      const snapshot = await this.getVersionSnapshot(projectId);
      if (!snapshot) {
        return { success: false, error: '无可确认的版本快照' };
      }

      // 将新版本数据覆盖到原始数据
      saveTableDataFile(projectId, snapshot.newData);
      addLog(`[WritingOrganize] 版本已确认，新数据已覆盖`, 'info');

      // 清除快照
      await this.clearVersionSnapshot(projectId);

      return { success: true };
    } catch (error) {
      console.error('[WritingStorage] Failed to confirm version:', error);
      return { success: false, error: error instanceof Error ? error.message : '确认版本失败' };
    }
  }

  async rollbackVersion(projectId: string): Promise<{ success: boolean; error?: string }> {
    try {
      const snapshot = await this.getVersionSnapshot(projectId);
      if (!snapshot) {
        return { success: false, error: '无可回退的版本快照' };
      }

      // 恢复原始数据
      saveTableDataFile(projectId, snapshot.originalData);
      addLog(`[WritingOrganize] 版本已回退，原始数据已恢复`, 'info');

      // 清除快照
      await this.clearVersionSnapshot(projectId);

      return { success: true };
    } catch (error) {
      console.error('[WritingStorage] Failed to rollback version:', error);
      return { success: false, error: error instanceof Error ? error.message : '回退版本失败' };
    }
  }

  compareTableData(
    originalData: WritingTableData,
    newData: WritingTableData
  ): TableChangeRecord {
    const addedRows: TableChangeRecord['addedRows'] = [];
    const modifiedCells: TableChangeRecord['modifiedCells'] = [];
    const deletedRows: TableChangeRecord['deletedRows'] = [];

    // 遍历所有 sheet
    for (const sheetName of newData.sheets) {
      const originalRows = originalData.data[sheetName] || [];
      const newRows = newData.data[sheetName] || [];

      // 找出新增的行
      for (let i = 0; i < newRows.length; i++) {
        const newRow = newRows[i];
        const uniqueId = newRow['1'];

        // 检查是否在原始数据中存在
        const existsInOriginal = originalRows.some(row => row['1'] === uniqueId);

        if (!existsInOriginal && uniqueId) {
          addedRows.push({ sheetName, rowIndex: i, rowData: newRow });
        }
      }

      // 找出删除的行
      for (let i = 0; i < originalRows.length; i++) {
        const originalRow = originalRows[i];
        const uniqueId = originalRow['1'];

        // 检查是否在新数据中存在
        const existsInNew = newRows.some(row => row['1'] === uniqueId);

        if (!existsInNew && uniqueId) {
          deletedRows.push({ sheetName, rowIndex: i, rowData: originalRow });
        }
      }

      // 找出修改的单元格
      for (let i = 0; i < newRows.length; i++) {
        const newRow = newRows[i];
        const uniqueId = newRow['1'];

        // 找到对应的原始行
        const originalRow = originalRows.find(row => row['1'] === uniqueId);

        if (originalRow) {
          // 比较每个字段
          const headers = newData.headers[sheetName] || [];
          for (const header of headers) {
            const oldValue = originalRow[header];
            const newValue = newRow[header];

            if (JSON.stringify(oldValue) !== JSON.stringify(newValue)) {
              modifiedCells.push({
                sheetName,
                rowIndex: i,
                columnName: header,
                oldValue,
                newValue
              });
            }
          }
        }
      }
    }

    return { addedRows, modifiedCells, deletedRows };
  }
}
