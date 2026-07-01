import fs from 'fs/promises';
import fsSync from 'fs';
import path from 'path';
import { createLogger } from './logger';

const logger = createLogger('file-service');

class FileService {
  private getDataDir(): string {
    const projectRoot = process.cwd();
    return path.join(projectRoot, 'data');
  }

  async exists(filePath: string): Promise<boolean> {
    try {
      await fs.access(filePath);
      return true;
    } catch (error) {
      logger.info(`File not found: ${filePath}`);
      return false;
    }
  }

  async readFile(filePath: string): Promise<string> {
    try {
      return await fs.readFile(filePath, 'utf-8');
    } catch (error) {
      logger.error(`Failed to read file ${filePath}`, error instanceof Error ? `Error: ${error.message}\nStack: ${error.stack || 'No stack'}` : String(error), {
        errorType: error instanceof Error ? error.name : 'UnknownError',
        errorLocation: 'fileService.ts:20:readFile',
        filePath: filePath
      });
      throw error;
    }
  }

  async writeFile(filePath: string, content: string): Promise<void> {
    try {
      const dir = path.dirname(filePath);
      
      if (!fsSync.existsSync(dir)) {
        logger.info(`Creating directory: ${dir}`);
        await fs.mkdir(dir, { recursive: true });
      }
      
      await fs.writeFile(filePath, content, 'utf-8');
      logger.info(`File written successfully: ${filePath}`, undefined, { contentLength: content.length });
    } catch (error) {
      logger.error(`Failed to write file ${filePath}`, error instanceof Error ? `Error: ${error.message}\nStack: ${error.stack || 'No stack'}` : String(error), {
        errorType: error instanceof Error ? error.name : 'UnknownError',
        errorLocation: 'fileService.ts:24:writeFile',
        filePath: filePath,
        contentLength: content.length,
        errorCode: (error as any).code
      });
      throw error;
    }
  }

  async deleteFile(filePath: string): Promise<void> {
    try {
      await fs.unlink(filePath);
    } catch (error) {
      logger.error(`Failed to delete file ${filePath}`, error instanceof Error ? `Error: ${error.message}\nStack: ${error.stack || 'No stack'}` : String(error), {
        errorType: error instanceof Error ? error.name : 'UnknownError',
        errorLocation: 'fileService.ts:28:deleteFile',
        filePath: filePath
      });
      throw error;
    }
  }

  async createDirectory(dirPath: string): Promise<void> {
    try {
      await fs.mkdir(dirPath, { recursive: true });
    } catch (error) {
      logger.error(`Failed to create directory ${dirPath}`, error instanceof Error ? `Error: ${error.message}\nStack: ${error.stack || 'No stack'}` : String(error), {
        errorType: error instanceof Error ? error.name : 'UnknownError',
        errorLocation: 'fileService.ts:32:createDirectory',
        dirPath: dirPath
      });
      throw error;
    }
  }

  async listDirectory(dirPath: string): Promise<string[]> {
    try {
      return await fs.readdir(dirPath);
    } catch (error) {
      logger.error(`Failed to list directory ${dirPath}`, error instanceof Error ? `Error: ${error.message}\nStack: ${error.stack || 'No stack'}` : String(error), {
        errorType: error instanceof Error ? error.name : 'UnknownError',
        errorLocation: 'fileService.ts:36:listDirectory',
        dirPath: dirPath
      });
      throw error;
    }
  }

  async readJsonFile(fileName: string): Promise<any> {
    try {
      const dataDir = this.getDataDir();
      const filePath = path.join(dataDir, `${fileName}.json`);
      const content = await fs.readFile(filePath, 'utf-8');
      return JSON.parse(content);
    } catch (error) {
      logger.error(`Failed to read JSON file ${fileName}`, error instanceof Error ? `Error: ${error.message}\nStack: ${error.stack || 'No stack'}` : String(error), {
        errorType: error instanceof Error ? error.name : 'UnknownError',
        errorLocation: 'fileService.ts:40:readJsonFile',
        fileName: fileName,
        dataDir: this.getDataDir()
      });
      throw error;
    }
  }

  async writeBinaryFile(filePath: string, content: string, isBase64: boolean = true): Promise<void> {
    try {
      if (isBase64) {
        const buffer = Buffer.from(content, 'base64');
        await fs.writeFile(filePath, buffer);
      } else {
        await fs.writeFile(filePath, content);
      }
    } catch (error) {
      logger.error(`Failed to write binary file ${filePath}`, error instanceof Error ? `Error: ${error.message}\nStack: ${error.stack || 'No stack'}` : String(error), {
        errorType: error instanceof Error ? error.name : 'UnknownError',
        errorLocation: 'fileService.ts:52:writeBinaryFile',
        filePath: filePath,
        isBase64: isBase64,
        contentLength: content.length
      });
      throw error;
    }
  }
}

export const fileService = new FileService();
