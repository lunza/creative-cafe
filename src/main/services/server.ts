import Fastify from 'fastify';
import { configRoutes } from './routes/configRoutes';
import { worldBookRoutes } from './routes/worldBookRoutes';
import { characterRoutes } from './routes/characterRoutes';
import fs from 'fs';
import path from 'path';

// 日志配置
const LOG_CONFIG = {
  MAX_FILE_SIZE: 10 * 1024 * 1024, // 10MB
  MAX_FILES: 5,
  LOG_DIR: 'logs',
  LOG_FILE: 'server.log'
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
    if (!fs.existsSync(logPath)) {
      return;
    }

    const stats = fs.statSync(logPath);
    if (stats.size >= LOG_CONFIG.MAX_FILE_SIZE) {
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      const rotatedPath = path.join(getLogDir(), `server-${timestamp}.log`);

      fs.renameSync(logPath, rotatedPath);

      const existingLogs = fs.readdirSync(getLogDir())
        .filter(file => file.startsWith('server-') && file.endsWith('.log'))
        .sort()
        .reverse();

      while (existingLogs.length >= LOG_CONFIG.MAX_FILES) {
        const oldestLog = existingLogs.pop();
        if (oldestLog) {
          fs.unlinkSync(path.join(getLogDir(), oldestLog));
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
    if (!fs.existsSync(logDir)) {
      fs.mkdirSync(logDir, { recursive: true });
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

    fs.appendFileSync(logPath, logMessage + '\n\n');
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
  console.error(`[Server] ${message}`, error, context);
};

// 信息日志
const logInfo = (message: string, context?: any) => {
  const contextDetails = context ? `Context: ${JSON.stringify(context, null, 2)}` : '';
  logToFile(LOG_LEVELS.INFO, message, contextDetails);
  console.info(`[Server] ${message}`, context);
};

const fastify = Fastify({
  logger: false
});

export async function startServer() {
  try {
    await fastify.register(configRoutes);
    await fastify.register(worldBookRoutes);
    await fastify.register(characterRoutes);

    await fastify.listen({ port: 3000, host: '127.0.0.1' });
    logInfo('Server running on http://127.0.0.1:3000');
  } catch (err) {
    logError('Failed to start server', err instanceof Error ? err : undefined, {
      errorType: err instanceof Error ? err.name : 'UnknownError',
      errorLocation: 'server.ts:10:startServer'
    });
    process.exit(1);
  }
}

export { fastify };
