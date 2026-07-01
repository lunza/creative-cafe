import * as fs from 'fs';
import * as path from 'path';
import { getModuleLogDir } from './logPathService';

/**
 * 统一的主进程日志服务
 * 提供 createLogger 工厂函数，按模块生成带有控制台输出与文件落盘能力的日志实例
 */

export interface Logger {
  error: (message: string, details?: string, context?: any) => void;
  warn: (message: string, details?: string, context?: any) => void;
  info: (message: string, details?: string, context?: any) => void;
  debug: (message: string, details?: string, context?: any) => void;
}

export type LogLevel = 'error' | 'warn' | 'info' | 'debug';

// 日志文件相关配置
const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB
const MAX_FILES = 5; // 每个模块最多保留的日志文件数量

let currentLogLevel: LogLevel = 'info';

const LOG_LEVEL_PRIORITY: Record<string, number> = {
  'DEBUG': 1,
  'INFO': 2,
  'WARN': 3,
  'ERROR': 4
};

export function setLogLevel(level: LogLevel): void {
  currentLogLevel = level;
}

// 将数字补齐为 2 位字符串
function pad2(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

// 生成 YYYYMMDD_HHMMSS 格式的时间戳，用于日志文件名
function getFileTimestamp(date: Date): string {
  const year = date.getFullYear();
  const month = pad2(date.getMonth() + 1);
  const day = pad2(date.getDate());
  const hours = pad2(date.getHours());
  const minutes = pad2(date.getMinutes());
  const seconds = pad2(date.getSeconds());
  return `${year}${month}${day}_${hours}${minutes}${seconds}`;
}

// 生成 YYYY-MM-DD HH:mm:ss 格式的可读时间戳，用于日志行
function getReadableTimestamp(date: Date): string {
  const year = date.getFullYear();
  const month = pad2(date.getMonth() + 1);
  const day = pad2(date.getDate());
  const hours = pad2(date.getHours());
  const minutes = pad2(date.getMinutes());
  const seconds = pad2(date.getSeconds());
  return `${year}-${month}-${day} ${hours}:${minutes}:${seconds}`;
}

/**
 * 创建一个与指定模块绑定的日志实例
 * @param moduleName 模块名称，用于日志前缀与文件命名
 */
export function createLogger(moduleName: string): Logger {
  // 当前日志实例正在写入的文件路径，首次写入或轮转时创建
  let currentLogPath: string | null = null;

  // 根据当前时间生成新的日志文件路径
  function createNewLogFile(): string {
    const timestamp = getFileTimestamp(new Date());
    const fileName = `${moduleName}_${timestamp}.log`;
    return path.join(getModuleLogDir(moduleName), fileName);
  }

  // 清理旧日志文件，为新文件腾出空间，保留最多 MAX_FILES 个
  function cleanupOldLogFiles(): void {
    try {
      const logDir = getModuleLogDir(moduleName);
      const prefix = `${moduleName}_`;
      const files = fs.readdirSync(logDir)
        .filter(file => file.startsWith(prefix) && file.endsWith('.log'))
        .sort()
        .reverse(); // 最新的排在前面

      // 删除最旧的文件，直到数量少于上限，为新文件留出位置
      while (files.length >= MAX_FILES) {
        const oldest = files.pop();
        if (oldest) {
          fs.unlinkSync(path.join(logDir, oldest));
        }
      }
    } catch (e) {
      console.error('Failed to cleanup old log files:', e);
    }
  }

  // 确保存在可写的日志文件，必要时执行轮转
  function ensureLogFile(): string {
    if (currentLogPath) {
      // 检查当前文件大小，超过上限则轮转
      try {
        const stats = fs.statSync(currentLogPath);
        if (stats.size >= MAX_FILE_SIZE) {
          currentLogPath = createNewLogFile();
          cleanupOldLogFiles();
        }
      } catch (e) {
        // 文件可能尚不存在，重新创建
        currentLogPath = createNewLogFile();
        cleanupOldLogFiles();
      }
      return currentLogPath;
    }

    // 首次写入：创建新文件
    currentLogPath = createNewLogFile();
    cleanupOldLogFiles();
    return currentLogPath;
  }

  // 核心写入逻辑：同时输出到控制台与文件
  function writeLog(level: string, message: string, details?: string, context?: any): void {
    // 日志级别过滤：仅输出配置级别及以上级别的日志
    const logPriority = LOG_LEVEL_PRIORITY[level] || 0;
    const configuredPriority = LOG_LEVEL_PRIORITY[currentLogLevel.toUpperCase()] || 0;
    if (logPriority < configuredPriority) {
      return;
    }

    // 控制台输出：使用 [moduleName] 前缀与对应级别的 console 方法
    const consoleMessage = `[${moduleName}] ${message}`;
    switch (level) {
      case 'ERROR':
        console.error(consoleMessage);
        break;
      case 'WARN':
        console.warn(consoleMessage);
        break;
      case 'INFO':
        console.info(consoleMessage);
        break;
      case 'DEBUG':
        console.debug(consoleMessage);
        break;
    }

    // 文件落盘
    try {
      const logPath = ensureLogFile();
      const timestamp = getReadableTimestamp(new Date());

      // 行格式：[YYYY-MM-DD HH:mm:ss] [LEVEL] [moduleName] message
      let logLine = `[${timestamp}] [${level}] [${moduleName}] ${message}`;

      // 追加 details，缩进 2 个空格
      if (details) {
        logLine += `\n  ${details.split('\n').join('\n  ')}`;
      }

      // 追加 context（对象），以 JSON 格式缩进 2 个空格
      if (context && typeof context === 'object') {
        const contextStr = JSON.stringify(context, null, 2);
        logLine += `\n  ${contextStr.split('\n').join('\n  ')}`;
      }

      // 条目之间以 \n 分隔
      fs.appendFileSync(logPath, logLine + '\n');
    } catch (e) {
      console.error('Failed to write to log file:', e);
    }
  }

  return {
    error: (message, details, context) => writeLog('ERROR', message, details, context),
    warn: (message, details, context) => writeLog('WARN', message, details, context),
    info: (message, details, context) => writeLog('INFO', message, details, context),
    debug: (message, details, context) => writeLog('DEBUG', message, details, context),
  };
}
