import fs from 'fs/promises';
import fsSync from 'fs';
import path from 'path';

// 日志配置
const LOG_CONFIG = {
  MAX_FILE_SIZE: 10 * 1024 * 1024, // 10MB
  MAX_FILES: 5,
  LOG_DIR: 'logs',
  LOG_FILE: 'file-service.log'
};

// 日志级别
const LOG_LEVELS = {
  ERROR: 'ERROR',
  WARN: 'WARN',
  INFO: 'INFO',
  DEBUG: 'DEBUG'
};

// 获取日志目录路径
const getLogDir = (): string => {
  return path.join(process.cwd(), LOG_CONFIG.LOG_DIR);
};

// 获取日志文件路径
const getLogPath = (): string => {
  return path.join(getLogDir(), LOG_CONFIG.LOG_FILE);
};

// 检查并执行日志文件轮转
const rotateLogFile = () => {
  try {
    const logPath = getLogPath();
    if (!fsSync.existsSync(logPath)) {
      return;
    }

    const stats = fsSync.statSync(logPath);
    if (stats.size >= LOG_CONFIG.MAX_FILE_SIZE) {
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      const rotatedPath = path.join(getLogDir(), `file-service-${timestamp}.log`);

      fsSync.renameSync(logPath, rotatedPath);

      const existingLogs = fsSync.readdirSync(getLogDir())
        .filter(file => file.startsWith('file-service-') && file.endsWith('.log'))
        .sort()
        .reverse();

      while (existingLogs.length >= LOG_CONFIG.MAX_FILES) {
        const oldestLog = existingLogs.pop();
        if (oldestLog) {
          fsSync.unlinkSync(path.join(getLogDir(), oldestLog));
        }
      }
    }
  } catch (e) {
    console.error('Failed to rotate log file:', e);
  }
};

// 简单日志函数
const logToFile = (level: string, message: string, details?: string) => {
  try {
    const logDir = getLogDir();
    if (!fsSync.existsSync(logDir)) {
      fsSync.mkdirSync(logDir, { recursive: true });
    }

    rotateLogFile();

    const logPath = getLogPath();
    const timestamp = new Date().toISOString();
    const displayTime = new Date().toLocaleString('zh-CN', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false
    });

    const levelPrefix = `[${level.padEnd(5)}]`;
    const timePrefix = `[${displayTime}]`;
    let logMessage = `${timePrefix} ${levelPrefix} ${message}`;

    if (details) {
      logMessage += `\n${' '.repeat(20)}${details.split('\n').join('\n' + ' '.repeat(20))}`;
    }

    fsSync.appendFileSync(logPath, logMessage + '\n\n');
  } catch (e) {
    console.error('Failed to write to log file:', e);
  }
};

// 错误日志
const logError = (message: string, error?: Error, context?: any) => {
  const errorDetails = error ? `Error: ${error.message}\nStack: ${error.stack || 'No stack'}` : '';
  const contextDetails = context ? `Context: ${JSON.stringify(context, null, 2)}` : '';
  const details = [errorDetails, contextDetails].filter(Boolean).join('\n');
  logToFile(LOG_LEVELS.ERROR, message, details);
  console.error(`[File Service] ${message}`, error, context);
};

// 信息日志
const logInfo = (message: string, context?: any) => {
  const contextDetails = context ? `Context: ${JSON.stringify(context, null, 2)}` : '';
  logToFile(LOG_LEVELS.INFO, message, contextDetails);
  console.info(`[File Service] ${message}`, context);
};

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
      logInfo(`File not found: ${filePath}`);
      return false;
    }
  }

  async readFile(filePath: string): Promise<string> {
    try {
      return await fs.readFile(filePath, 'utf-8');
    } catch (error) {
      logError(`Failed to read file ${filePath}`, error, {
        errorType: error instanceof Error ? error.name : 'UnknownError',
        errorLocation: 'fileService.ts:20:readFile',
        filePath: filePath
      });
      throw error;
    }
  }

  async writeFile(filePath: string, content: string): Promise<void> {
    try {
      await fs.writeFile(filePath, content, 'utf-8');
    } catch (error) {
      logError(`Failed to write file ${filePath}`, error, {
        errorType: error instanceof Error ? error.name : 'UnknownError',
        errorLocation: 'fileService.ts:24:writeFile',
        filePath: filePath,
        contentLength: content.length
      });
      throw error;
    }
  }

  async deleteFile(filePath: string): Promise<void> {
    try {
      await fs.unlink(filePath);
    } catch (error) {
      logError(`Failed to delete file ${filePath}`, error, {
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
      logError(`Failed to create directory ${dirPath}`, error, {
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
      logError(`Failed to list directory ${dirPath}`, error, {
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
      logError(`Failed to read JSON file ${fileName}`, error, {
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
      logError(`Failed to write binary file ${filePath}`, error, {
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
