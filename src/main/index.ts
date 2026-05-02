import { app, BrowserWindow, ipcMain, shell } from 'electron';
import path from 'path';
import { setupIpcHandlers } from './ipc';
import { registerMemoryHandlers } from './ipc/handlers/memoryHandlers';
import { registerCreativeHandlers } from './ipc/handlers/creativeHandlers';
import { registerCharacterChatHandlers } from './ipc/handlers/characterChatHandlers';

if (process.platform === 'win32') {
  try {
    require('child_process').execSync('chcp 65001', { stdio: 'ignore' });
  } catch {
  }
  process.stdout.setDefaultEncoding('utf8');
  process.stderr.setDefaultEncoding('utf8');
}

const isDev = !!(process.env.VITE_DEV_SERVER_URL) || process.env.NODE_ENV === 'development';

let mainWindow: BrowserWindow | null = null;

export function sendLogToRenderer(message: string, type: 'error' | 'warn' | 'info' | 'debug' = 'info') {
  if (mainWindow && mainWindow.webContents) {
    try {
      mainWindow.webContents.send('memory:log', message, type);
    } catch (error) {
      console.error('Error sending log to renderer:', error);
    }
  }
  console.log(`[${type.toUpperCase()}] ${message}`);
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 1200,
    minHeight: 700,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      webSecurity: true,
      allowRunningInsecureContent: false
    },
    frame: true,
    titleBarStyle: 'default',
    backgroundColor: '#ffffff'
  });

  const scriptSrc = isDev ? "'self' 'unsafe-inline' 'unsafe-eval'" : "'self' 'unsafe-inline'";

  mainWindow.webContents.session.webRequest.onHeadersReceived((details, callback) => {
      callback({
        responseHeaders: {
          ...details.responseHeaders,
          'Content-Security-Policy': [
            "default-src 'self'; " +
            `script-src ${scriptSrc}; ` +
            "style-src 'self' 'unsafe-inline'; " +
            "img-src 'self' data: blob:; " +
            "connect-src 'self' http://localhost:* http://127.0.0.1:* https://api.github.com https://raw.githubusercontent.com; " +
            "font-src 'self' data:; " +
            "media-src 'self' blob:; " +
            "worker-src 'self' blob:; " +
            "child-src 'self' blob:;"
          ]
        }
      });
    });

  if (isDev) {
    const devUrl = 'http://localhost:5174';
    console.log(`Loading development URL: ${devUrl}`);
    mainWindow.loadURL(devUrl);
  } else {
    console.log('Loading production file');
    mainWindow.loadFile(path.join(__dirname, '../index.html'));
  }

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

app.whenReady().then(async () => {
  createWindow();
  setupIpcHandlers();
  registerMemoryHandlers();
  registerCreativeHandlers();
  registerCharacterChatHandlers();

  (async () => {
    try {
      const { chatStorageService } = await import('./services/ChatStorageService');
      const result = await chatStorageService.migrateFromLegacyFile();
      if (result.migrated > 0) {
        console.log(`[Migration] Successfully migrated ${result.migrated} chats`);
        if (result.errors.length > 0) {
          console.warn('[Migration] Errors during migration:', result.errors);
        }
      } else if (result.success) {
        console.log('[Migration] No migration needed (no legacy file found)');
      } else {
        console.error('[Migration] Migration failed:', result.errors);
      }
    } catch (error) {
      console.error('[Migration] Migration failed:', error);
    }
  })();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
