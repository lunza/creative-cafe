import * as fs from 'fs';
import * as path from 'path';
import { getUserDataPath } from '../utils/appPath';

export interface PathValidationResult {
  valid: boolean;
  error?: string;
  exists: boolean;
  isDirectory: boolean;
  canRead: boolean;
  canWrite: boolean;
}

const MODULE_DIR_MAP: Record<string, string> = {
  character: 'characters',
  worldbook: 'worldbooks',
  avatar: 'avatars',
  creative: 'creatives',
  memory: 'memories',
  plugin: 'plugins',
};

class PathService {
  private basePath: string;
  private customPaths: Record<string, string> = {};

  constructor() {
    this.basePath = path.join(getUserDataPath(), 'data');
    this.ensureBaseDir();
  }

  private ensureBaseDir() {
    try {
      if (!fs.existsSync(this.basePath)) {
        fs.mkdirSync(this.basePath, { recursive: true });
        console.log(`[PathService] Created base directory: ${this.basePath}`);
      }
    } catch (error) {
      console.error('[PathService] Failed to create base directory:', error);
    }
  }

  getDefaultPath(module: string): string {
    const dirName = MODULE_DIR_MAP[module];
    if (!dirName) {
      throw new Error(`Unknown module: ${module}`);
    }
    return path.join(this.basePath, dirName);
  }

  getCustomPath(module: string): string {
    return this.customPaths[module] || this.getDefaultPath(module);
  }

  setCustomPath(module: string, customPath: string): void {
    this.customPaths[module] = customPath;
  }

  loadCustomPaths(paths: Record<string, string>): void {
    this.customPaths = { ...paths };
  }

  clearCustomPath(module: string): void {
    delete this.customPaths[module];
  }

  getAllPaths(): Record<string, string> {
    const result: Record<string, string> = {};
    for (const module of Object.keys(MODULE_DIR_MAP)) {
      result[module] = this.getCustomPath(module);
    }
    return result;
  }

  validatePath(targetPath: string): PathValidationResult {
    const result: PathValidationResult = {
      valid: true,
      exists: false,
      isDirectory: false,
      canRead: false,
      canWrite: false,
    };

    try {
      result.exists = fs.existsSync(targetPath);
      
      if (!result.exists) {
        result.valid = true;
        return result;
      }

      result.isDirectory = fs.statSync(targetPath).isDirectory();

      if (!result.isDirectory) {
        result.valid = false;
        result.error = '指定的路径不是目录';
        return result;
      }

      try {
        fs.accessSync(targetPath, fs.constants.R_OK);
        result.canRead = true;
      } catch {
        result.canRead = false;
        result.valid = false;
        result.error = '目录没有读取权限';
        return result;
      }

      try {
        fs.accessSync(targetPath, fs.constants.W_OK);
        result.canWrite = true;
      } catch {
        result.canWrite = false;
        result.valid = false;
        result.error = '目录没有写入权限';
        return result;
      }
    } catch (error) {
      result.valid = false;
      result.error = error instanceof Error ? error.message : '路径验证失败';
    }

    return result;
  }

  async ensureDirExists(targetPath: string): Promise<boolean> {
    try {
      if (!fs.existsSync(targetPath)) {
        fs.mkdirSync(targetPath, { recursive: true });
        console.log(`[PathService] Created directory: ${targetPath}`);
      }
      return true;
    } catch (error) {
      console.error(`[PathService] Failed to create directory ${targetPath}:`, error);
      return false;
    }
  }

  async ensureAllModuleDirs(): Promise<void> {
    for (const module of Object.keys(MODULE_DIR_MAP)) {
      const dirPath = this.getCustomPath(module);
      await this.ensureDirExists(dirPath);
    }
  }

  getBasePath(): string {
    return this.basePath;
  }
}

export const pathService = new PathService();
