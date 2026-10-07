import { app, BrowserWindow, ipcMain, shell } from 'electron';
import path from 'path';
import { setupIpcHandlers } from './ipc';
import { abortAllActiveRequests } from './ipc/handlers/writingHandlers';
import { abortAllAIRequests } from './ipc/handlers/aiHandlers';
import { startLanApiServer, stopLanApiServer } from './services/lanApiServer/server';

// ========== 全局异常处理器（防止未捕获的 Promise rejection / 同步异常导致主进程崩溃） ==========
// 【重点标记】修复：增量向量化等 fire-and-forget 调用若产生逃逸异常，Node.js 16+ 默认会退出进程，
// 导致 vite-plugin-electron 的 taskkill 触发超时崩溃。此处仅记录日志，不退出进程。
process.on('unhandledRejection', (reason, _promise) => {
  console.error('[Main Process] UNHANDLED REJECTION (swallowed to prevent crash):', reason);
});

process.on('uncaughtException', (error) => {
  console.error('[Main Process] UNCAUGHT EXCEPTION (swallowed to prevent crash):', error);
  // 不调用 process.exit()，让进程继续运行；真正的致命错误由 Electron 自身处理
});

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

  // Abort all active generation requests on page refresh (F5/Cmd+R) or navigation
  mainWindow.webContents.on('will-navigate', () => {
    abortAllActiveRequests();
  });
}

app.whenReady().then(async () => {
  createWindow();
  setupIpcHandlers();

  // dev-only：无头 E2E 自动执行（Spec: add-novel-writing-pipeline-api）
  // 通过环境变量 PIPELINE_E2E_SCALE=smoke|full|v2-integrated 触发；打包版忽略。
  // - smoke/full：runE2E，报告落盘 data/writing-projects/exports/e2e-report-*.json
  // - v2-integrated：runV2IntegratedE2E（Spec: test-writing-v2-integrated-e2e），
  //   整合剧情审核单条修正 + 表格整理 + 表格上下文注入，报告落盘 exports/v2-integrated-report-*.json
  // 完成后不退出，便于 UI 查看。
  const e2eScale = process.env.PIPELINE_E2E_SCALE;
  if (!app.isPackaged && (e2eScale === 'smoke' || e2eScale === 'full' || e2eScale === 'v2-integrated')) {
    const { writingPipelineService } = await import('./services/writing/WritingPipelineService');
    setTimeout(() => {
      const runner =
        e2eScale === 'v2-integrated'
          ? writingPipelineService.runV2IntegratedE2E()
          : writingPipelineService.runE2E({ scale: e2eScale as 'smoke' | 'full' });
      runner
        .then((res) => {
          console.log(
            `[PipelineE2E] auto-run finished success=${res.success} verdict=${res.data?.report?.verdict ?? '-'} error=${res.error ?? ''}`
          );
        })
        .catch((e) => console.error('[PipelineE2E] auto-run crashed:', e));
    }, 6000);
  }

  // 启动内嵌 LAN API 服务（供局域网安卓客户端访问；Spec: add-android-chat-client / Task 1）
  startLanApiServer();

  // 初始化向量注册表服务
  (async () => {
    try {
      const { vectorRegistryService } = await import('./services/VectorRegistryService');
      await vectorRegistryService.initialize();
      console.log('[App] VectorRegistryService initialized successfully');
    } catch (error) {
      console.error('[App] Failed to initialize VectorRegistryService:', error);
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

// 关键修复：使用事件阻止机制确保异步持久化完成后再退出
let isQuitting = false;
let hasPersisted = false;

app.on('before-quit', (event) => {
  // 如果已经持久化完成，允许退出
  if (hasPersisted || isQuitting) {
    return;
  }

  // 停止内嵌 LAN API 服务（Spec: add-android-chat-client）
  stopLanApiServer();

  // 中止所有活跃的 AI HTTP 请求（世界书翻译/润色/审核等），避免退出后孤儿请求继续执行
  const cancelledAICount = abortAllAIRequests();
  if (cancelledAICount > 0) {
    console.log(`[App] before-quit: aborted ${cancelledAICount} active AI request(s)`);
  }

  // 阻止退出，先执行异步持久化
  event.preventDefault();
  console.log('[App] before-quit: blocking quit to persist vector data...');

  // 标记正在退出，防止死循环
  isQuitting = true;
  
  // 异步执行持久化，完成后再次调用 app.quit()
  (async () => {
    try {
      const { vectorStoreService } = await import('./services/VectorStoreService');
      const { vectorRegistryService } = await import('./services/VectorRegistryService');

      // sqlite-vec 后端：SQLite 通过 WAL 自动落盘，vectorStoreService.persist() 为 no-op；
      // 但 vectorRegistryService 仍需持久化 source/scope 元数据，故无条件调用。
      console.log('[App] Persisting vector registry (sqlite-vec auto-persists)...');
      await vectorStoreService.persist();
      await vectorRegistryService.persist();
      console.log('[App] Vector registry persisted successfully');
    } catch (error) {
      console.error('[App] Failed to persist vector data before quit:', error);
    } finally {
      hasPersisted = true;
      console.log('[App] Persist complete, quitting...');
      app.quit();
    }
  })();
});
