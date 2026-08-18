import fs from 'fs/promises';
import path from 'path';
import { getUserDataPath } from '../utils/appPath';

export interface VersionLinkRecord {
  versionLinkId: string;
  timestamp: number;
  triggerType: 'auto' | 'manual' | 'aiOrganize';
  chatVersion: {
    exists: boolean;
    filePath: string;
    messageCount: number;
  };
  tableSnapshot: {
    exists: boolean;
    filePath: string;
    sheetCount: number;
    totalRows: number;
  };
  consistencyStatus: 'matched' | 'mismatched' | 'partial';
}

export interface VersionIndex {
  characterCardName: string;
  lastUpdated: number;
  versions: VersionLinkRecord[];
}

export interface ChangeLogEntry {
  timestamp: number;
  versionLinkId: string;
  action: 'create_chat_version' | 'create_table_snapshot' | 'create_linked_version' | 'edit_version' | 'delete_version' | 'migrate_snapshot' | 'consistency_check';
  source: 'user' | 'ai' | 'system';
  description: string;
  affectedFiles: string[];
}

export interface ConsistencyReport {
  characterCardName: string;
  totalVersions: number;
  matchedCount: number;
  partialCount: number;
  mismatchedCount: number;
  orphanedChatFiles: string[];
  orphanedTableFiles: string[];
  details: Array<{
    versionLinkId: string;
    status: 'matched' | 'mismatched' | 'partial';
    issues: string[];
  }>;
}

class VersionLinkerService {
  /** 联动版本历史上限，超出时删除最旧版本 */
  private readonly MAX_LINKED_VERSIONS = 10;

  getCharacterDir(characterCardName: string): string {
    const sanitized = characterCardName.replace(/[<>:"/\\|?*\x00-\x1F]/g, '_');
    return path.join(getUserDataPath(), 'data', 'memories', 'chats', sanitized);
  }

  generateVersionLinkId(): string {
    const now = new Date();
    const yyyy = now.getFullYear();
    const mm = String(now.getMonth() + 1).padStart(2, '0');
    const dd = String(now.getDate()).padStart(2, '0');
    const hh = String(now.getHours()).padStart(2, '0');
    const min = String(now.getMinutes()).padStart(2, '0');
    const ss = String(now.getSeconds()).padStart(2, '0');
    const random = Math.random().toString(36).substring(2, 8);
    return `v${yyyy}${mm}${dd}_${hh}${min}${ss}_${random}`;
  }

  async getVersionIndex(characterCardName: string): Promise<VersionIndex> {
    const characterDir = this.getCharacterDir(characterCardName);
    const indexPath = path.join(characterDir, 'version-index.json');

    try {
      await fs.access(indexPath);
      const content = await fs.readFile(indexPath, 'utf8');
      return JSON.parse(content);
    } catch {
      return {
        characterCardName,
        lastUpdated: Date.now(),
        versions: [],
      };
    }
  }

  async saveVersionIndex(characterCardName: string, index: VersionIndex): Promise<void> {
    const characterDir = this.getCharacterDir(characterCardName);
    const indexPath = path.join(characterDir, 'version-index.json');

    await fs.mkdir(characterDir, { recursive: true });

    index.lastUpdated = Date.now();
    await fs.writeFile(indexPath, JSON.stringify(index, null, 2), 'utf8');
  }

  async addChangeLog(characterCardName: string, entry: Omit<ChangeLogEntry, 'timestamp'>): Promise<void> {
    const characterDir = this.getCharacterDir(characterCardName);
    const logPath = path.join(characterDir, 'change-log.json');

    let entries: ChangeLogEntry[] = [];
    try {
      await fs.access(logPath);
      const content = await fs.readFile(logPath, 'utf8');
      entries = JSON.parse(content);
    } catch {
    }

    const newEntry: ChangeLogEntry = {
      ...entry,
      timestamp: Date.now(),
    };

    entries.push(newEntry);

    await fs.mkdir(characterDir, { recursive: true });
    await fs.writeFile(logPath, JSON.stringify(entries, null, 2), 'utf8');
  }

  async getChangeLog(characterCardName: string, options?: { limit?: number }): Promise<ChangeLogEntry[]> {
    const characterDir = this.getCharacterDir(characterCardName);
    const logPath = path.join(characterDir, 'change-log.json');

    try {
      await fs.access(logPath);
      const content = await fs.readFile(logPath, 'utf8');
      const entries: ChangeLogEntry[] = JSON.parse(content);

      if (options?.limit && options.limit > 0) {
        return entries.slice(-options.limit);
      }

      return entries;
    } catch {
      return [];
    }
  }

  async createLinkedVersion(
    characterCardName: string,
    options: {
      messages?: any[];
      tableData?: any;
      metadata?: any;
      triggerType?: 'auto' | 'manual' | 'aiOrganize';
      source?: 'user' | 'ai' | 'system';
      description?: string;
      // 复用已存在的聊天版本文件（由 chatVersionService.createVersion 创建）。
      // 提供后跳过聊天版本创建，仅创建表格快照并关联到该文件，保持版本ID一致。
      existingChatVersionFilePath?: string;
    } = {}
  ): Promise<VersionLinkRecord> {
    const characterDir = this.getCharacterDir(characterCardName);
    const chatDir = path.join(characterDir, 'versions', 'chat');
    const tableDir = path.join(characterDir, 'versions', 'table');

    await fs.mkdir(tableDir, { recursive: true });

    // 决定 versionLinkId / 聊天版本文件（复用或新建）
    let versionLinkId: string;
    let chatFilePath: string;
    let chatTimestamp: number;
    let messageCount: number;

    if (options.existingChatVersionFilePath) {
      versionLinkId = path.basename(options.existingChatVersionFilePath, '.json');
      chatFilePath = options.existingChatVersionFilePath;
      try {
        const existingContent = await fs.readFile(chatFilePath, 'utf8');
        const existingData = JSON.parse(existingContent);
        chatTimestamp = existingData.version?.timestamp || existingData.timestamp || Date.now();
        messageCount = existingData.messages?.length || 0;
      } catch {
        chatTimestamp = Date.now();
        messageCount = options.messages?.length || 0;
      }
    } else {
      versionLinkId = this.generateVersionLinkId();
      chatTimestamp = Date.now();
      chatFilePath = path.join(chatDir, `${versionLinkId}.json`);
      messageCount = options.messages?.length || 0;

      await fs.mkdir(chatDir, { recursive: true });

      const chatData = {
        versionLinkId,
        timestamp: chatTimestamp,
        messages: options.messages || [],
        metadata: options.metadata || {},
      };
      await fs.writeFile(chatFilePath, JSON.stringify(chatData, null, 2), 'utf8');

      await this.addChangeLog(characterCardName, {
        versionLinkId,
        action: 'create_chat_version',
        source: options.source || 'user',
        description: options.description || 'Created chat version',
        affectedFiles: [chatFilePath],
      });
    }

    const tableTimestamp = Date.now();
    const tableFilePath = path.join(tableDir, `${versionLinkId}.json`);
    const sheets = options.tableData ? Object.keys(options.tableData) : [];
    const headers: Record<string, string[]> = {};
    const data: Record<string, any[]> = {};
    let totalRows = 0;

    for (const sheet of sheets) {
      const sheetData = options.tableData?.[sheet] || [];
      data[sheet] = sheetData;
      headers[sheet] = sheetData.length > 0 ? Object.keys(sheetData[0]) : [];
      totalRows += sheetData.length;
    }

    const tableSnapshotData = {
      versionLinkId,
      timestamp: tableTimestamp,
      characterCardName,
      sheets,
      headers,
      data,
      metadata: {
        sheetCount: sheets.length,
        totalRows,
      },
    };
    await fs.writeFile(tableFilePath, JSON.stringify(tableSnapshotData, null, 2), 'utf8');

    await this.addChangeLog(characterCardName, {
      versionLinkId,
      action: 'create_table_snapshot',
      source: options.source || 'user',
      description: options.description || 'Created table snapshot',
      affectedFiles: [tableFilePath],
    });

    const index = await this.getVersionIndex(characterCardName);

    const linkRecord: VersionLinkRecord = {
      versionLinkId,
      timestamp: chatTimestamp,
      triggerType: options.triggerType || 'manual',
      chatVersion: {
        exists: true,
        filePath: chatFilePath,
        messageCount,
      },
      tableSnapshot: {
        exists: true,
        filePath: tableFilePath,
        sheetCount: sheets.length,
        totalRows,
      },
      consistencyStatus: Math.abs(tableTimestamp - chatTimestamp) <= 5000 ? 'matched' : 'partial',
    };

    index.versions.push(linkRecord);
    await this.saveVersionIndex(characterCardName, index);

    // 版本上限控制：超出 MAX_LINKED_VERSIONS 时删除最旧版本
    await this.enforceVersionLimit(characterCardName, index);

    await this.addChangeLog(characterCardName, {
      versionLinkId,
      action: 'create_linked_version',
      source: options.source || 'user',
      description: options.description || 'Created linked version',
      affectedFiles: [chatFilePath, tableFilePath],
    });

    return linkRecord;
  }

  /**
   * 版本上限控制：当联动版本数超过 MAX_LINKED_VERSIONS 时，
   * 按 timestamp 升序删除最旧版本（聊天版本文件 + 表格快照文件 + 索引记录）。
   */
  private async enforceVersionLimit(characterCardName: string, index: VersionIndex): Promise<void> {
    if (index.versions.length <= this.MAX_LINKED_VERSIONS) {
      return;
    }

    const overflowCount = index.versions.length - this.MAX_LINKED_VERSIONS;
    const sorted = [...index.versions].sort((a, b) => a.timestamp - b.timestamp);
    const toRemove = sorted.slice(0, overflowCount);

    for (const record of toRemove) {
      // 删除聊天版本文件
      try {
        await fs.unlink(record.chatVersion.filePath);
      } catch {
        // 文件可能不存在，忽略
      }
      // 删除表格快照文件
      try {
        await fs.unlink(record.tableSnapshot.filePath);
      } catch {
        // 文件可能不存在，忽略
      }
      await this.addChangeLog(characterCardName, {
        versionLinkId: record.versionLinkId,
        action: 'delete_version',
        source: 'system',
        description: `Exceeded MAX_LINKED_VERSIONS (${this.MAX_LINKED_VERSIONS}), removed oldest linked version`,
        affectedFiles: [record.chatVersion.filePath, record.tableSnapshot.filePath],
      });
    }

    const removedIds = new Set(toRemove.map(r => r.versionLinkId));
    index.versions = index.versions.filter(v => !removedIds.has(v.versionLinkId));
    await this.saveVersionIndex(characterCardName, index);
  }

  async getLinkedVersion(
    characterCardName: string,
    versionLinkId: string
  ): Promise<{ chatVersion: any | null; tableSnapshot: any | null; linkRecord: VersionLinkRecord | null }> {
    const characterDir = this.getCharacterDir(characterCardName);
    const chatFilePath = path.join(characterDir, 'versions', 'chat', `${versionLinkId}.json`);
    const tableFilePath = path.join(characterDir, 'versions', 'table', `${versionLinkId}.json`);

    let chatVersion: any | null = null;
    let tableSnapshot: any | null = null;

    try {
      const chatContent = await fs.readFile(chatFilePath, 'utf8');
      chatVersion = JSON.parse(chatContent);
    } catch {
    }

    try {
      const tableContent = await fs.readFile(tableFilePath, 'utf8');
      tableSnapshot = JSON.parse(tableContent);
    } catch {
    }

    const index = await this.getVersionIndex(characterCardName);
    const linkRecord = index.versions.find(v => v.versionLinkId === versionLinkId) || null;

    return { chatVersion, tableSnapshot, linkRecord };
  }

  async verifyConsistency(characterCardName: string): Promise<ConsistencyReport> {
    const characterDir = this.getCharacterDir(characterCardName);
    const chatDir = path.join(characterDir, 'versions', 'chat');
    const tableDir = path.join(characterDir, 'versions', 'table');

    const index = await this.getVersionIndex(characterCardName);

    const chatFiles = new Set<string>();
    const tableFiles = new Set<string>();

    try {
      await fs.access(chatDir);
      const files = await fs.readdir(chatDir);
      for (const file of files) {
        if (file.endsWith('.json')) {
          chatFiles.add(file.replace('.json', ''));
        }
      }
    } catch {
    }

    try {
      await fs.access(tableDir);
      const files = await fs.readdir(tableDir);
      for (const file of files) {
        if (file.endsWith('.json')) {
          tableFiles.add(file.replace('.json', ''));
        }
      }
    } catch {
    }

    const indexedIds = new Set(index.versions.map(v => v.versionLinkId));

    const orphanedChatFiles: string[] = [];
    for (const chatFile of chatFiles) {
      if (!indexedIds.has(chatFile)) {
        orphanedChatFiles.push(path.join(chatDir, `${chatFile}.json`));
      }
    }

    const orphanedTableFiles: string[] = [];
    for (const tableFile of tableFiles) {
      if (!indexedIds.has(tableFile)) {
        orphanedTableFiles.push(path.join(tableDir, `${tableFile}.json`));
      }
    }

    const details: Array<{
      versionLinkId: string;
      status: 'matched' | 'mismatched' | 'partial';
      issues: string[];
    }> = [];

    let matchedCount = 0;
    let partialCount = 0;
    let mismatchedCount = 0;

    for (const record of index.versions) {
      const issues: string[] = [];
      let status: 'matched' | 'mismatched' | 'partial' = 'matched';

      const chatExists = chatFiles.has(record.versionLinkId);
      const tableExists = tableFiles.has(record.versionLinkId);

      if (!chatExists && !tableExists) {
        issues.push('Both chat version and table snapshot files are missing');
        status = 'mismatched';
      } else if (!chatExists) {
        issues.push('Chat version file is missing');
        status = 'mismatched';
      } else if (!tableExists) {
        issues.push('Table snapshot file is missing');
        status = 'mismatched';
      } else {
        let chatTimestamp = 0;
        let tableTimestamp = 0;

        try {
          const chatContent = await fs.readFile(path.join(chatDir, `${record.versionLinkId}.json`), 'utf8');
          const chatData = JSON.parse(chatContent);
          chatTimestamp = chatData.timestamp || 0;
        } catch {
          issues.push('Failed to read chat version file');
        }

        try {
          const tableContent = await fs.readFile(path.join(tableDir, `${record.versionLinkId}.json`), 'utf8');
          const tableData = JSON.parse(tableContent);
          tableTimestamp = tableData.timestamp || 0;
        } catch {
          issues.push('Failed to read table snapshot file');
        }

        if (chatTimestamp > 0 && tableTimestamp > 0) {
          const diff = Math.abs(tableTimestamp - chatTimestamp);
          if (diff > 5000) {
            issues.push(`Timestamp difference (${diff}ms) exceeds 5000ms threshold`);
            status = 'partial';
          }
        }

        if (record.chatVersion.messageCount === 0 && issues.length === 0) {
          issues.push('Chat version has 0 messages');
          status = 'partial';
        }

        if (record.tableSnapshot.sheetCount === 0 && issues.length === 0) {
          issues.push('Table snapshot has 0 sheets');
          status = 'partial';
        }
      }

      if (status === 'matched') matchedCount++;
      else if (status === 'partial') partialCount++;
      else mismatchedCount++;

      details.push({
        versionLinkId: record.versionLinkId,
        status,
        issues,
      });
    }

    await this.addChangeLog(characterCardName, {
      versionLinkId: 'system',
      action: 'consistency_check',
      source: 'system',
      description: `Consistency check completed: ${matchedCount} matched, ${partialCount} partial, ${mismatchedCount} mismatched`,
      affectedFiles: [],
    });

    return {
      characterCardName,
      totalVersions: index.versions.length,
      matchedCount,
      partialCount,
      mismatchedCount,
      orphanedChatFiles,
      orphanedTableFiles,
      details,
    };
  }

  async updateConsistencyStatus(
    characterCardName: string,
    versionLinkId: string,
    status: 'matched' | 'mismatched' | 'partial'
  ): Promise<void> {
    const index = await this.getVersionIndex(characterCardName);

    const record = index.versions.find(v => v.versionLinkId === versionLinkId);
    if (record) {
      record.consistencyStatus = status;
      await this.saveVersionIndex(characterCardName, index);
    }
  }
}

export const versionLinkerService = new VersionLinkerService();
