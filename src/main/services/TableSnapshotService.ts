import fs from 'fs/promises';
import path from 'path';
import { getUserDataPath } from '../utils/appPath';

export interface TableSnapshot {
  fileName: string;
  filePath: string;
  sequenceNumber: number;
  timestamp: number;
  sheetCount: number;
  totalRows: number;
  characterCardName: string;
  versionLinkId?: string;
}

interface TableSnapshotFile {
  versionLinkId?: string;
  timestamp: number;
  characterCardName: string;
  sheets: string[];
  headers: Record<string, string[]>;
  data: Record<string, any[]>;
  metadata: {
    sheetCount: number;
    totalRows: number;
  };
}

class TableSnapshotService {
  private getChatStorageBaseDir(): string {
    return path.join(getUserDataPath(), 'data', 'memories', 'chats');
  }

  getSnapshotDir(characterCardName: string): string {
    const sanitized = characterCardName.replace(/[<>:"/\\|?*\x00-\x1F]/g, '_');
    return path.join(this.getChatStorageBaseDir(), sanitized, 'versions', 'table');
  }

  async createSnapshot(
    characterCardName: string,
    tableData: any,
    versionLinkId: string
  ): Promise<string> {
    const snapshotDir = this.getSnapshotDir(characterCardName);
    await fs.mkdir(snapshotDir, { recursive: true });

    const existingSnapshots = await this.getExistingFiles(snapshotDir);
    const sequenceNumber = existingSnapshots.length > 0
      ? Math.max(...existingSnapshots.map(s => s.sequenceNumber)) + 1
      : 1;

    const timestamp = Date.now();
    const sanitized = characterCardName.replace(/[<>:"/\\|?*\x00-\x1F]/g, '_');
    const fileName = `${sequenceNumber}_${sanitized}_${timestamp}.json`;
    const filePath = path.join(snapshotDir, fileName);

    const sheets = Object.keys(tableData || {});
    const headers: Record<string, string[]> = {};
    const data: Record<string, any[]> = {};
    let totalRows = 0;

    for (const sheet of sheets) {
      const sheetData = tableData[sheet] || [];
      data[sheet] = sheetData;
      if (sheetData.length > 0) {
        headers[sheet] = Object.keys(sheetData[0]);
      } else {
        headers[sheet] = [];
      }
      totalRows += sheetData.length;
    }

    const snapshotData: TableSnapshotFile = {
      versionLinkId,
      timestamp,
      characterCardName,
      sheets,
      headers,
      data,
      metadata: {
        sheetCount: sheets.length,
        totalRows,
      },
    };

    await fs.writeFile(filePath, JSON.stringify(snapshotData, null, 2), 'utf8');

    return filePath;
  }

  async getSnapshots(characterCardName: string): Promise<TableSnapshot[]> {
    const snapshotDir = this.getSnapshotDir(characterCardName);

    try {
      await fs.access(snapshotDir);
    } catch {
      return [];
    }

    const files = await fs.readdir(snapshotDir);
    const snapshots: TableSnapshot[] = [];

    for (const file of files) {
      if (!file.endsWith('.json')) continue;

      const parsed = this.parseFileName(file);
      if (!parsed) continue;

      const filePath = path.join(snapshotDir, file);

      let sheetCount = 0;
      let totalRows = 0;
      try {
        const content = await fs.readFile(filePath, 'utf8');
        const snapshotData: TableSnapshotFile = JSON.parse(content);
        sheetCount = snapshotData.metadata?.sheetCount || 0;
        totalRows = snapshotData.metadata?.totalRows || 0;
      } catch {
      }

      snapshots.push({
        fileName: file,
        filePath,
        sequenceNumber: parsed.sequenceNumber,
        timestamp: parsed.timestamp,
        sheetCount,
        totalRows,
        characterCardName,
        versionLinkId: parsed.versionLinkId,
      });
    }

    snapshots.sort((a, b) => b.timestamp - a.timestamp);

    return snapshots;
  }

  async getSnapshotContent(filePath: string): Promise<any> {
    try {
      const content = await fs.readFile(filePath, 'utf8');
      return JSON.parse(content);
    } catch (error) {
      console.error('[TableSnapshotService] Failed to read snapshot:', filePath, error);
      throw error;
    }
  }

  async deleteSnapshot(filePath: string): Promise<boolean> {
    try {
      await fs.unlink(filePath);
      return true;
    } catch (error) {
      console.error('[TableSnapshotService] Failed to delete snapshot:', filePath, error);
      return false;
    }
  }

  private async getExistingFiles(snapshotDir: string): Promise<TableSnapshot[]> {
    try {
      await fs.access(snapshotDir);
    } catch {
      return [];
    }

    const files = await fs.readdir(snapshotDir);
    const snapshots: TableSnapshot[] = [];

    for (const file of files) {
      if (!file.endsWith('.json')) continue;

      const parsed = this.parseFileName(file);
      if (!parsed) continue;

      snapshots.push({
        fileName: file,
        filePath: path.join(snapshotDir, file),
        sequenceNumber: parsed.sequenceNumber,
        timestamp: parsed.timestamp,
        sheetCount: 0,
        totalRows: 0,
        characterCardName: parsed.characterCardName,
        versionLinkId: parsed.versionLinkId,
      });
    }

    return snapshots;
  }

  private parseFileName(fileName: string): { sequenceNumber: number; timestamp: number; characterCardName: string; versionLinkId?: string } | null {
    const match = fileName.match(/^(\d+)_(.+?)_(\d+)\.json$/);
    if (!match) return null;

    const sequenceNumber = parseInt(match[1], 10);
    const characterCardName = match[2];
    const timestamp = parseInt(match[3], 10);

    if (isNaN(sequenceNumber) || isNaN(timestamp)) {
      return null;
    }

    return {
      sequenceNumber,
      timestamp,
      characterCardName,
    };
  }
}

export const tableSnapshotService = new TableSnapshotService();
