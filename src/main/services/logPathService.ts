import * as fs from 'fs';
import * as path from 'path';

export const LOG_BASE_DIR = path.join('D:', 'AI', 'creative-cafe', 'logs');

export function getLogDir(): string {
  if (!fs.existsSync(LOG_BASE_DIR)) {
    fs.mkdirSync(LOG_BASE_DIR, { recursive: true });
  }
  return LOG_BASE_DIR;
}

export function getLogFilePath(fileName: string): string {
  return path.join(getLogDir(), fileName);
}
