import fs from 'fs/promises';
import fsSync from 'fs';
import path from 'path';
import { getUserDataPath } from '../utils/appPath';

class AvatarService {
  private avatarDir: string;

  constructor() {
    this.avatarDir = path.join(getUserDataPath(), 'data', 'avatars');
    console.log('[AvatarService] Avatar directory:', this.avatarDir);
    this.ensureDirectoryExists();
  }

  private async ensureDirectoryExists() {
    if (!fsSync.existsSync(this.avatarDir)) {
      await fs.mkdir(this.avatarDir, { recursive: true });
      console.log('[AvatarService] Created avatar directory:', this.avatarDir);
    }
  }

  async listAvatars() {
    try {
      await this.ensureDirectoryExists();
      const files = await fs.readdir(this.avatarDir);
      
      const avatars = await Promise.all(
        files
          .filter(f => f.endsWith('.json'))
          .map(async file => {
            const filePath = path.join(this.avatarDir, file);
            const stats = await fs.stat(filePath);
            
            return {
              name: file,
              path: filePath,
              size: stats.size,
              modified: stats.mtime
            };
          })
      );
      
      return avatars;
    } catch (error) {
      console.error('[AvatarService] Failed to list avatars:', error);
      return [];
    }
  }

  async readAvatar(filePath: string) {
    try {
      if (!fsSync.existsSync(filePath)) {
        return null;
      }
      
      const content = await fs.readFile(filePath, 'utf8');
      return JSON.parse(content);
    } catch (error) {
      console.error('[AvatarService] Failed to read avatar:', error);
      return null;
    }
  }

  async writeAvatar(filePath: string, data: any) {
    try {
      const dir = path.dirname(filePath);
      if (!fsSync.existsSync(dir)) {
        await fs.mkdir(dir, { recursive: true });
      }
      
      await fs.writeFile(filePath, JSON.stringify(data, null, 2), 'utf8');
      return { success: true };
    } catch (error) {
      console.error('[AvatarService] Failed to write avatar:', error);
      return { success: false, error };
    }
  }

  async deleteAvatar(filePath: string) {
    try {
      if (!fsSync.existsSync(filePath)) {
        return { success: false, error: 'File not found' };
      }
      
      await fs.unlink(filePath);
      return { success: true };
    } catch (error) {
      console.error('[AvatarService] Failed to delete avatar:', error);
      return { success: false, error };
    }
  }

  setAvatarDir(dir: string) {
    let resolvedPath = dir;
    if (!path.isAbsolute(dir)) {
      resolvedPath = path.join(getUserDataPath(), dir);
    }
    this.avatarDir = path.normalize(resolvedPath);
    console.log('[AvatarService] Avatar directory set to:', this.avatarDir);
    this.ensureDirectoryExists();
  }

  getAvatarDir() {
    return this.avatarDir;
  }
}

export const avatarService = new AvatarService();
