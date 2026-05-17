import fs from 'fs/promises';
import path from 'path';
import { getUserDataPath } from '../utils/appPath';
import { versionLinkerService } from './VersionLinkerService';

export interface ChatVersion {
  fileName: string;
  filePath: string;
  sequenceNumber: number;
  timestamp: number;
  messageCount: number;
  characterCardName: string;
  versionLinkId?: string;
}

interface ChatVersionFile {
  versionLinkId?: string;
  version: {
    sequenceNumber: number;
    timestamp: number;
    messageCount: number;
    characterCardName: string;
  };
  messages: any[];
  metadata: any;
}

class ChatVersionService {
  private readonly MAX_VERSIONS = 20;

  private getChatStorageBaseDir(): string {
    return path.join(getUserDataPath(), 'data', 'memories', 'chats');
  }

  getVersionsDir(characterCardName: string): string {
    const sanitized = characterCardName.replace(/[<>:"/\\|?*\x00-\x1F]/g, '_');
    return path.join(this.getChatStorageBaseDir(), sanitized, 'versions', 'chat');
  }

  async createVersion(
    characterCardName: string,
    messages: any[],
    metadata: any,
    versionLinkId?: string
  ): Promise<string> {
    const versionsDir = this.getVersionsDir(characterCardName);
    await fs.mkdir(versionsDir, { recursive: true });

    const existingVersions = await this.getExistingFiles(versionsDir);

    if (existingVersions.length >= this.MAX_VERSIONS) {
      await this.deleteOldestVersion(characterCardName);
    }

    const versions = await this.getExistingFiles(versionsDir);
    const sequenceNumber = versions.length > 0
      ? Math.max(...versions.map(v => v.sequenceNumber)) + 1
      : 1;

    const timestamp = Date.now();
    const sanitized = characterCardName.replace(/[<>:"/\\|?*\x00-\x1F]/g, '_');
    const finalVersionLinkId = versionLinkId || versionLinkerService.generateVersionLinkId();
    const fileName = `${finalVersionLinkId}.json`;
    const filePath = path.join(versionsDir, fileName);

    const versionData: ChatVersionFile = {
      versionLinkId: finalVersionLinkId,
      version: {
        sequenceNumber,
        timestamp,
        messageCount: messages.length,
        characterCardName,
      },
      messages,
      metadata,
    };

    await fs.writeFile(filePath, JSON.stringify(versionData, null, 2), 'utf8');

    return filePath;
  }

  async getVersionList(characterCardName: string): Promise<ChatVersion[]> {
    const versionsDir = this.getVersionsDir(characterCardName);

    try {
      await fs.access(versionsDir);
    } catch {
      return [];
    }

    const files = await fs.readdir(versionsDir);
    const versions: ChatVersion[] = [];

    for (const file of files) {
      if (!file.endsWith('.json')) continue;

      const filePath = path.join(versionsDir, file);

      let versionLinkId = '';
      let sequenceNumber = 0;
      let timestamp = 0;
      let messageCount = 0;
      try {
        const content = await fs.readFile(filePath, 'utf8');
        const data: ChatVersionFile = JSON.parse(content);
        versionLinkId = data.versionLinkId || file.replace('.json', '');
        sequenceNumber = data.version?.sequenceNumber || 0;
        timestamp = data.version?.timestamp || 0;
        messageCount = data.messages?.length || 0;
      } catch {
        continue;
      }

      versions.push({
        fileName: file,
        filePath,
        sequenceNumber,
        timestamp,
        messageCount,
        characterCardName,
        versionLinkId,
      });
    }

    versions.sort((a, b) => b.timestamp - a.timestamp);

    return versions;
  }

  async getVersionContent(filePath: string): Promise<any> {
    try {
      const content = await fs.readFile(filePath, 'utf8');
      return JSON.parse(content);
    } catch (error) {
      console.error('[ChatVersionService] Failed to read version:', filePath, error);
      throw error;
    }
  }

  async deleteVersion(filePath: string): Promise<boolean> {
    try {
      await fs.unlink(filePath);
      return true;
    } catch (error) {
      console.error('[ChatVersionService] Failed to delete version:', filePath, error);
      return false;
    }
  }

  async deleteOldestVersion(characterCardName: string): Promise<boolean> {
    const versionsDir = this.getVersionsDir(characterCardName);

    try {
      await fs.access(versionsDir);
    } catch {
      return false;
    }

    const files = await fs.readdir(versionsDir);
    const jsonFiles = files.filter(f => f.endsWith('.json'));

    if (jsonFiles.length === 0) {
      return false;
    }

    const fileTimestamps: Array<{ fileName: string; timestamp: number }> = [];
    for (const file of jsonFiles) {
      const filePath = path.join(versionsDir, file);
      let timestamp = 0;
      try {
        const content = await fs.readFile(filePath, 'utf8');
        const data: ChatVersionFile = JSON.parse(content);
        timestamp = data.version?.timestamp || 0;
      } catch {
        continue;
      }
      fileTimestamps.push({ fileName: file, timestamp });
    }

    if (fileTimestamps.length === 0) {
      return false;
    }

    fileTimestamps.sort((a, b) => a.timestamp - b.timestamp);
    const oldestFilePath = path.join(versionsDir, fileTimestamps[0].fileName);

    return await this.deleteVersion(oldestFilePath);
  }

  private async getExistingFiles(versionsDir: string): Promise<ChatVersion[]> {
    try {
      await fs.access(versionsDir);
    } catch {
      return [];
    }

    const files = await fs.readdir(versionsDir);
    const versions: ChatVersion[] = [];

    for (const file of files) {
      if (!file.endsWith('.json')) continue;

      const filePath = path.join(versionsDir, file);

      let data: ChatVersionFile | null = null;
      try {
        const content = await fs.readFile(filePath, 'utf8');
        data = JSON.parse(content);
      } catch {
        continue;
      }

      if (!data) continue;

      versions.push({
        fileName: file,
        filePath,
        sequenceNumber: data.version?.sequenceNumber || 0,
        timestamp: data.version?.timestamp || 0,
        messageCount: data.messages?.length || 0,
        characterCardName: data.version?.characterCardName || '',
        versionLinkId: data.versionLinkId || file.replace('.json', ''),
      });
    }

    return versions;
  }
}

export const chatVersionService = new ChatVersionService();
