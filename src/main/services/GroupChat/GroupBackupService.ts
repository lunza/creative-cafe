import fs from 'fs';
import path from 'path';

export interface BackupPaths {
  chatsPath: string;
  backupsPath: string;
}

export class GroupBackupService {
  private static instance: GroupBackupService;
  private chatsPath: string;
  private backupsPath: string;

  private constructor(paths: BackupPaths) {
    this.chatsPath = paths.chatsPath;
    this.backupsPath = paths.backupsPath;

    if (!fs.existsSync(this.backupsPath)) {
      fs.mkdirSync(this.backupsPath, { recursive: true });
    }
  }

  static getInstance(paths: BackupPaths): GroupBackupService {
    if (!GroupBackupService.instance) {
      GroupBackupService.instance = new GroupBackupService(paths);
    }
    return GroupBackupService.instance;
  }

  createBackup(chatId: string, content: string): void {
    try {
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      const backupFileName = `${chatId}_${timestamp}.jsonl`;
      const backupPath = path.join(this.backupsPath, backupFileName);

      fs.writeFileSync(backupPath, content, 'utf-8');
    } catch (error) {
      console.error(`Failed to create backup for ${chatId}:`, error);
    }
  }

  getBackups(chatId: string): string[] {
    try {
      const files = fs.readdirSync(this.backupsPath);
      return files
        .filter((f) => f.startsWith(chatId) && f.endsWith('.jsonl'))
        .sort()
        .reverse();
    } catch {
      return [];
    }
  }

  restoreBackup(backupFileName: string, targetPath: string): boolean {
    try {
      const backupPath = path.join(this.backupsPath, backupFileName);
      if (!fs.existsSync(backupPath)) {
        return false;
      }

      const content = fs.readFileSync(backupPath, 'utf-8');
      fs.writeFileSync(targetPath, content, 'utf-8');
      return true;
    } catch (error) {
      console.error(`Failed to restore backup ${backupFileName}:`, error);
      return false;
    }
  }
}
