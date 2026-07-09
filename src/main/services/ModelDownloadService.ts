import { ipcMain } from 'electron';
import * as fs from 'fs';
import * as path from 'path';
import { getProjectRoot } from '../utils/appPath';

export class ModelDownloadService {
  private cacheDir: string | null = null;
  private downloadingModels = new Map<string, { progress: number; status: string }>();

  private getCacheDir(): string {
    if (!this.cacheDir) {
      this.cacheDir = path.join(getProjectRoot(), 'models');
    }
    return this.cacheDir;
  }

  private ensureCacheDir(): void {
    const dir = this.getCacheDir();
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
  }

  getModelLocalPath(modelName: string): string {
    return path.join(this.getCacheDir(), modelName);
  }

  isModelDownloaded(modelName: string): boolean {
    const modelPath = this.getModelLocalPath(modelName);
    if (!fs.existsSync(modelPath)) {
      return false;
    }
    const files = fs.readdirSync(modelPath);
    return files.length > 0;
  }

  async downloadModel(
    modelName: string, 
    onProgress?: (progress: number, status: string) => void
  ): Promise<{ success: boolean; localPath: string; error?: string }> {
    this.ensureCacheDir();
    const localPath = this.getModelLocalPath(modelName);
    
    if (this.isModelDownloaded(modelName)) {
      return { success: true, localPath };
    }

    this.downloadingModels.set(modelName, { progress: 0, status: 'preparing' });
    onProgress?.(0, 'preparing');

    try {
      const { downloadModelFromHF } = await import('./modelDownloader');
      const result = await downloadModelFromHF(modelName, localPath, (progress, status) => {
        this.downloadingModels.set(modelName, { progress, status });
        onProgress?.(progress, status);
      });

      if (result.success) {
        this.downloadingModels.delete(modelName);
        return { success: true, localPath };
      } else {
        this.downloadingModels.delete(modelName);
        return result;
      }
    } catch (error) {
      this.downloadingModels.delete(modelName);
      return { 
        success: false, 
        localPath, 
        error: error instanceof Error ? error.message : 'Unknown error' 
      };
    }
  }

  getDownloadProgress(modelName: string): { progress: number; status: string } | null {
    return this.downloadingModels.get(modelName) || null;
  }

  registerIpcHandlers(): void {
    ipcMain.handle('model:download', async (_event, { modelName }: { modelName: string }) => {
      return this.downloadModel(modelName, (progress, status) => {
        _event.sender.send('model:downloadProgress', { modelName, progress, status });
      });
    });

    ipcMain.handle('model:isDownloaded', async (_event, { modelName }: { modelName: string }) => {
      return this.isModelDownloaded(modelName);
    });

    ipcMain.handle('model:getCacheDir', async () => {
      return this.getCacheDir();
    });
  }
}

export const modelDownloadService = new ModelDownloadService();
