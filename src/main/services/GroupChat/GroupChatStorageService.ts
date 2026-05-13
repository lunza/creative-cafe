import fs from 'fs';
import path from 'path';
import sanitize from 'sanitize-filename';
import writeAtomic from 'write-file-atomic';
import { GroupChatMessage, GroupChatHeader } from '../../../shared/types/groupChat.types';
import { UserDirectories } from '../storage.types';
import { GroupIntegrityChecker } from './GroupIntegrityChecker';
import { GroupBackupService } from './GroupBackupService';

export class GroupChatStorageService {
  private static instance: GroupChatStorageService;
  private groupChatsPath: string;
  private backupsPath: string;
  private integrityChecker: GroupIntegrityChecker;
  private backupService: GroupBackupService;

  private constructor(directories: UserDirectories) {
    this.groupChatsPath = directories.groupChats;
    this.backupsPath = path.join(directories.backups, 'group-chats');

    if (!fs.existsSync(this.groupChatsPath)) {
      fs.mkdirSync(this.groupChatsPath, { recursive: true });
    }
    if (!fs.existsSync(this.backupsPath)) {
      fs.mkdirSync(this.backupsPath, { recursive: true });
    }

    this.integrityChecker = GroupIntegrityChecker.getInstance();
    this.backupService = GroupBackupService.getInstance({
      chatsPath: this.groupChatsPath,
      backupsPath: this.backupsPath,
    });
  }

  static getInstance(directories: UserDirectories): GroupChatStorageService {
    if (!GroupChatStorageService.instance) {
      GroupChatStorageService.instance = new GroupChatStorageService(directories);
    }
    return GroupChatStorageService.instance;
  }

  static resetInstance(): void {
    GroupChatStorageService.instance = null as any;
  }

  async getChat(chatId: string): Promise<(GroupChatHeader | GroupChatMessage)[]> {
    const chatPath = path.join(this.groupChatsPath, sanitize(`${chatId}.jsonl`));

    if (!fs.existsSync(chatPath)) {
      return [];
    }

    try {
      const content = fs.readFileSync(chatPath, 'utf-8');
      const lines = content.split('\n').filter((line) => line.trim());
      const messages: (GroupChatHeader | GroupChatMessage)[] = [];

      for (const line of lines) {
        try {
          const parsed = JSON.parse(line);
          messages.push(parsed);
        } catch {
          continue;
        }
      }

      return messages;
    } catch (error) {
      console.error(`Error reading group chat ${chatId}:`, error);
      return [];
    }
  }

  async getChatInfo(chatId: string): Promise<{
    file_id: string;
    file_name: string;
    file_size: string;
    chat_items: number;
    mes: string;
    last_mes: number | string;
    chat_metadata?: Record<string, any>;
  } | null> {
    const chatPath = path.join(this.groupChatsPath, sanitize(`${chatId}.jsonl`));

    if (!fs.existsSync(chatPath)) {
      return null;
    }

    const stats = fs.statSync(chatPath);
    const content = fs.readFileSync(chatPath, 'utf-8');
    const lines = content.split('\n').filter((line) => line.trim());

    let metadata: Record<string, any> | undefined;
    let lastMessage: string = '';
    let lastMesTimestamp: number | string = 0;

    for (const line of lines) {
      try {
        const parsed = JSON.parse(line);
        if (parsed.chat_metadata) {
          metadata = parsed.chat_metadata;
        } else if (parsed.mes) {
          lastMessage = parsed.mes;
          lastMesTimestamp = parsed.send_date || 0;
        }
      } catch {
        continue;
      }
    }

    return {
      file_id: chatId,
      file_name: `${chatId}.jsonl`,
      file_size: `${(stats.size / 1024).toFixed(2)} KB`,
      chat_items: lines.length - (metadata ? 1 : 0),
      mes: lastMessage,
      last_mes: lastMesTimestamp,
      chat_metadata: metadata,
    };
  }

  async saveChat(
    chatId: string,
    chat: (GroupChatHeader | GroupChatMessage)[],
    force: boolean = false
  ): Promise<{ ok: true } | { error: string }> {
    const chatPath = path.join(this.groupChatsPath, sanitize(`${chatId}.jsonl`));

    if (chat.length > 0) {
      const firstItem = chat[0];
      if ('chat_metadata' in firstItem) {
        const header = firstItem as GroupChatHeader;
        const integrityCheck = this.integrityChecker.checkIntegrity(
          chatPath,
          header.chat_metadata.integrity
        );

        if (!integrityCheck && !force) {
          return { error: 'integrity' };
        }
      }
    }

    const jsonlContent = chat.map((item) => JSON.stringify(item)).join('\n');

    try {
      await writeAtomic(chatPath, jsonlContent);
      this.backupService.createBackup(chatId, jsonlContent);
      return { ok: true };
    } catch (error) {
      console.error(`Error saving group chat ${chatId}:`, error);
      return { error: 'save_failed' };
    }
  }

  async deleteChat(chatId: string): Promise<boolean> {
    const chatPath = path.join(this.groupChatsPath, sanitize(`${chatId}.jsonl`));

    if (!fs.existsSync(chatPath)) {
      return false;
    }

    fs.unlinkSync(chatPath);
    return true;
  }

  async importChat(
    content: string,
    suggestedId?: string
  ): Promise<string> {
    const chatId = suggestedId || `import_${Date.now()}`;
    const chatPath = path.join(this.groupChatsPath, sanitize(`${chatId}.jsonl`));

    await writeAtomic(chatPath, content);

    return chatId;
  }
}
