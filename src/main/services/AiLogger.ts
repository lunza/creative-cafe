import path from 'path';
import fs from 'fs';

const LOG_CONFIG = {
  MAX_FILE_SIZE: 10 * 1024 * 1024,
  MAX_FILES: 5,
  LOG_DIR: 'logs',
  LOG_FILE: 'ai-handler.log'
};

const LOG_LEVELS = {
  ERROR: 'ERROR',
  WARN: 'WARN',
  INFO: 'INFO',
  DEBUG: 'DEBUG'
} as const;

const getLogDir = (): string => path.join(process.cwd(), LOG_CONFIG.LOG_DIR);
const getLogPath = (): string => path.join(getLogDir(), LOG_CONFIG.LOG_FILE);

const rotateLogFile = (): void => {
  try {
    const logPath = getLogPath();
    if (!fs.existsSync(logPath)) return;
    const stats = fs.statSync(logPath);
    if (stats.size >= LOG_CONFIG.MAX_FILE_SIZE) {
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      const rotatedPath = path.join(getLogDir(), `ai-handler-${timestamp}.log`);
      fs.renameSync(logPath, rotatedPath);
      const existingLogs = fs.readdirSync(getLogDir())
        .filter(file => file.startsWith('ai-handler-') && file.endsWith('.log'))
        .sort()
        .reverse();
      while (existingLogs.length >= LOG_CONFIG.MAX_FILES) {
        const oldestLog = existingLogs.pop();
        if (oldestLog) fs.unlinkSync(path.join(getLogDir(), oldestLog));
      }
    }
  } catch (e) {
    console.error('[AiLogger] Failed to rotate log file:', e);
  }
};

const logToFile = (level: string, message: string, details?: string): void => {
  try {
    const logDir = getLogDir();
    if (!fs.existsSync(logDir)) fs.mkdirSync(logDir, { recursive: true });
    rotateLogFile();
    const logPath = getLogPath();
    const displayTime = new Date().toLocaleString('zh-CN', {
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false
    });
    const levelPrefix = `[${level.padEnd(5)}]`;
    const timePrefix = `[${displayTime}]`;
    let logMessage = `${timePrefix} ${levelPrefix} ${message}`;
    if (details) {
      logMessage += `\n${' '.repeat(20)}${details.split('\n').join('\n' + ' '.repeat(20))}`;
    }
    fs.appendFileSync(logPath, logMessage + '\n\n');
  } catch (e) {
    console.error('[AiLogger] Failed to write to log file:', e);
  }
};

const logDetailed = (level: string, title: string, data: any): void => {
  try {
    const details = JSON.stringify(data, null, 2);
    logToFile(level, title, details);
  } catch (e) {
    logToFile(level, `${title}: ${String(data)}`);
  }
};

export const logError = (message: string, error?: Error, context?: any): void => {
  const errorDetails = error ? `Error: ${error.message}\nStack: ${error.stack || 'No stack'}` : '';
  const contextDetails = context ? `Context: ${JSON.stringify(context, null, 2)}` : '';
  const details = [errorDetails, contextDetails].filter(Boolean).join('\n');
  logToFile(LOG_LEVELS.ERROR, message, details);
  console.error(`[AiLogger] ${message}`, error, context);
};

export const logWarn = (message: string, context?: any): void => {
  const contextDetails = context ? `Context: ${JSON.stringify(context, null, 2)}` : '';
  logToFile(LOG_LEVELS.WARN, message, contextDetails);
  console.warn(`[AiLogger] ${message}`, context);
};

export const logInfo = (message: string, context?: any): void => {
  const contextDetails = context ? `Context: ${JSON.stringify(context, null, 2)}` : '';
  logToFile(LOG_LEVELS.INFO, message, contextDetails);
  console.info(`[AiLogger] ${message}`, context);
};

export const logDebug = (message: string, context?: any): void => {
  const contextDetails = context ? `Context: ${JSON.stringify(context, null, 2)}` : '';
  logToFile(LOG_LEVELS.DEBUG, message, contextDetails);
  console.debug(`[AiLogger] ${message}`, context);
};

export const logRequest = (operation: string, data: any): void => {
  logDetailed(LOG_LEVELS.INFO, `写作模式AI请求: ${operation}`, {
    operation,
    timestamp: new Date().toISOString(),
    ...data
  });
};

export const logResponse = (operation: string, status: string, data: any): void => {
  logDetailed(LOG_LEVELS.INFO, `写作模式AI响应: ${operation}`, {
    operation,
    status,
    timestamp: new Date().toISOString(),
    ...data
  });
};

export const logErrorWithContext = (operation: string, error: any, context?: any): void => {
  logError(`写作模式AI错误: ${operation}`, error instanceof Error ? error : new Error(String(error)), context);
};
