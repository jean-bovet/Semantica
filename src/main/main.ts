import { app, BrowserWindow, ipcMain, shell, dialog, crashReporter, Notification } from 'electron';
import { Worker } from 'node:worker_threads';
import path from 'node:path';
import fs from 'node:fs';
import { autoUpdater } from 'electron-updater';
import log from 'electron-log';
import { logger } from '../shared/utils/logger';
import {
  isStartupStageMessage,
  isStartupErrorMessage,
  type StartupStageMessage,
  type StartupErrorMessage,
  type DownloadProgressMessage
} from '../shared/types/startup';

// Enable crash reporter to capture native crashes
crashReporter.start({
  productName: 'Semantica',
  companyName: 'Jean Bovet',
  submitURL: '', // Leave empty to just save locally
  uploadToServer: false,
  ignoreSystemCrashHandler: false,
  rateLimit: false,
  compress: true,
  globalExtra: {
    _version: '1.0.0',
    _processType: 'main'
  }
});

// Log where crash dumps are saved
const crashDumpDir = app.getPath('crashDumps');
logger.log('STARTUP', 'Crash dumps will be saved to:', crashDumpDir);
fs.mkdirSync(crashDumpDir, { recursive: true });

// Override userData path if specified (for testing)
if (process.env.USER_DATA_PATH) {
  app.setPath('userData', process.env.USER_DATA_PATH);
  logger.log('STARTUP', 'Using custom userData path:', process.env.USER_DATA_PATH);
}

// Ensure single instance (unless disabled for testing)
let gotTheLock = true;
if (!process.env.ELECTRON_DISABLE_SINGLETON) {
  gotTheLock = app.requestSingleInstanceLock();
  
  if (!gotTheLock) {
    app.quit();
  } else {
    app.on('second-instance', () => {
      // Someone tried to run a second instance, focus our window instead
      if (win) {
        if (win.isMinimized()) win.restore();
        win.focus();
      }
    });
  }
}

let worker: Worker | null = null;
let win: BrowserWindow | null = null;
let mainWindow: BrowserWindow | null = null;
let workerReady = false;
const pendingCallbacks = new Map<string, (data: any) => void>();
let startupTimeout: NodeJS.Timeout | null = null;
let startupRetries = 0;
const MAX_STARTUP_RETRIES = 3;
const STARTUP_TIMEOUT_MS = 60000; // 60 seconds

function spawnWorker() {
  worker?.terminate().catch(() => {});
  workerReady = false;
  
  worker = new Worker(path.join(__dirname, 'worker.cjs'));

  worker.on('message', (msg: any) => {
    // Handle typed startup protocol messages with validation
    if (isStartupStageMessage(msg)) {
      logger.log('STARTUP', `Stage: ${msg.stage} - ${msg.message || ''}`);

      // Forward to renderer
      win?.webContents.send('startup:stage', msg);

      // Clear timeout if we reach 'ready' stage
      if (msg.stage === 'ready') {
        workerReady = true; // Set worker ready flag
        if (startupTimeout) {
          clearTimeout(startupTimeout);
          startupTimeout = null;
        }
        startupRetries = 0; // Reset retry counter on success
      }
    } else if (isStartupErrorMessage(msg)) {
      logger.error('STARTUP', `Error: ${msg.code} - ${msg.message}`);

      // Forward to renderer
      win?.webContents.send('startup:error', msg);

      // Clear timeout
      if (startupTimeout) {
        clearTimeout(startupTimeout);
        startupTimeout = null;
      }
    } else if (msg.channel === 'model:download:progress') {
      const progressMsg = msg as DownloadProgressMessage;
      // Forward to renderer for UI
      win?.webContents.send('model:download:progress', {
        file: progressMsg.file,
        progress: progressMsg.progress,
        loaded: progressMsg.loaded,
        total: progressMsg.total
      });
    } else if (msg.type === 'ready') {
      workerReady = true;
      logger.log('WORKER', 'Worker ready - starting initialization');
      // Worker will auto-start initialization
    } else if (msg.type === 'files:loaded') {
      // Existing files have been loaded from database
      win?.webContents.send('files:loaded');
    } else if (msg.type === 'progress') {
      win?.webContents.send('indexer:progress', { ...msg.payload, initialized: true });
    } else if (msg.type === 'pipeline:status') {
      // Log pipeline status to main process console AND send to renderer console
      logger.log('PIPELINE-STATUS', msg.payload);
      // Also send to renderer process console (which shows in browser dev tools)
      win?.webContents.executeJavaScript(`console.log(${JSON.stringify(msg.payload)})`);
    } else if (msg.id && pendingCallbacks.has(msg.id)) {
      const callback = pendingCallbacks.get(msg.id)!;
      pendingCallbacks.delete(msg.id);
      callback(msg.payload);
    }
  });
  
  worker.on('error', (err) => {
    logger.error('WORKER', 'Worker error:', err);
  });
  
  worker.on('exit', (code) => {
    if (code !== 0 && code !== null) {
      // Only respawn on actual errors, not on intentional termination
      logger.error('WORKER', `Worker stopped with exit code ${code}`);

      // Handle retry logic with limit
      if (startupRetries < MAX_STARTUP_RETRIES) {
        startupRetries++;
        logger.log('WORKER', `Retrying worker spawn (attempt ${startupRetries}/${MAX_STARTUP_RETRIES})...`);
        setTimeout(spawnWorker, 1000);
      } else {
        logger.error('WORKER', 'Max retries exceeded, not respawning');
        win?.webContents.send('startup:error', {
          channel: 'startup:error',
          code: 'STARTUP_TIMEOUT',
          message: 'Worker failed to start after multiple attempts'
        });
      }
    }
  });

  // Setup startup timeout supervision
  startupTimeout = setTimeout(() => {
    logger.error('STARTUP', 'Startup timeout exceeded');
    if (startupRetries < MAX_STARTUP_RETRIES) {
      startupRetries++;
      logger.log('STARTUP', `Retrying startup (attempt ${startupRetries}/${MAX_STARTUP_RETRIES})...`);
      worker?.postMessage({ type: 'startup:retry' });
    } else {
      win?.webContents.send('startup:error', {
        channel: 'startup:error',
        code: 'STARTUP_TIMEOUT',
        message: 'Startup exceeded timeout limit'
      });
    }
  }, STARTUP_TIMEOUT_MS);

  // Get userData path with fallback for test environments
  const userDataPath = app.getPath('userData') || path.join(require('os').tmpdir(), 'semantica-test')

  const dbDir = path.join(userDataPath, 'data');
  fs.mkdirSync(dbDir, { recursive: true });

  // Create models directory for ML models
  const modelsDir = path.join(userDataPath, 'models');
  fs.mkdirSync(modelsDir, { recursive: true });

  // Pass both paths to worker
  worker.postMessage({
    type: 'init',
    dbDir,
    userDataPath
  });
}

function sendToWorker(type: string, payload: any = {}): Promise<any> {
  return new Promise(async (resolve, reject) => {
    // Don't wait for worker on model operations - coordinator handles this now
    if (!worker || !workerReady) {
      reject(new Error('Worker not ready'));
      return;
    }
    
    const id = Math.random().toString(36).substring(7);
    pendingCallbacks.set(id, resolve);
    
    worker.postMessage({ type, payload, id });
    
    // Use longer timeout for model operations (5 minutes)
    const timeout = (type === 'checkModel' || type === 'downloadModel') ? 300000 : 30000;
    setTimeout(() => {
      if (pendingCallbacks.has(id)) {
        pendingCallbacks.delete(id);
        reject(new Error('Worker timeout'));
      }
    }, timeout);
  });
}

if (gotTheLock) {
  app.whenReady().then(async () => {
    // Set About panel options
    app.setAboutPanelOptions({
      applicationName: 'Semantica',
      applicationVersion: app.getVersion(),
      copyright: 'Copyright © 2025 Jean Bovet',
      authors: ['Jean Bovet'],
      website: 'https://github.com/jean-bovet/Semantica',
      iconPath: path.join(__dirname, '../../build/icon.png')
    });

    win = new BrowserWindow({
    width: 1200,
    height: 800,
    icon: path.join(__dirname, '../../build/icon.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    },
    titleBarStyle: 'hiddenInset',
    vibrancy: 'sidebar'
  });

  mainWindow = win;

  const isDev = process.env.NODE_ENV !== 'production';

  // Load UI immediately
  if (isDev) {
    win?.loadURL('http://localhost:5173');
  } else {
    win?.loadFile(path.join(__dirname, 'index.html'));
  }

  // Configure auto-updater logging
  autoUpdater.logger = log;
  (autoUpdater.logger as any).transports.file.level = 'info';
  log.info('App starting...');

  // Force update checking in dev mode if UPDATE_URL is set
  const updateUrl = process.env.UPDATE_URL || process.env.ELECTRON_UPDATER_URL;
  if (updateUrl) {
    log.info(`Using custom update URL: ${updateUrl}`);
    autoUpdater.forceDevUpdateConfig = true; // Force update checking in dev mode
    autoUpdater.setFeedURL({
      provider: 'generic',
      url: updateUrl
    });
  }


  // Handle update downloaded event - prompt for restart
  autoUpdater.on('update-downloaded', (info) => {
    log.info('Update downloaded:', info);
    dialog.showMessageBox(mainWindow!, {
      type: 'info',
      title: 'Update Ready',
      message: `Version ${info.version} has been downloaded. The application will restart to apply the update.`,
      buttons: ['Restart Now', 'Later'],
      defaultId: 0
    }).then((result) => {
      if (result.response === 0) {
        autoUpdater.quitAndInstall();
      }
    });
  });

  autoUpdater.on('error', (error) => {
    log.error('Update error:', error);
  });

  // Wait for renderer to load before spawning worker
  // This ensures React component is mounted and listening for startup events
  win.webContents.once('did-finish-load', () => {
    logger.log('STARTUP', 'Renderer loaded, spawning worker...');
    spawnWorker();
  });

  // Register all IPC handlers

  // Startup retry handler
  ipcMain.handle('startup:retry', async () => {
    logger.log('STARTUP', 'Retry requested from renderer');
    startupRetries = 0; // Reset retry counter
    worker?.postMessage({ type: 'startup:retry' });
    return { success: true };
  });

  ipcMain.handle('app:quit', () => {
    logger.log('APP', 'Quit requested from renderer');
    app.quit();
  });

  ipcMain.handle('updater:check', async () => {
    log.info('Manual update check triggered from settings');
    try {
      const result = await autoUpdater.checkForUpdates();
      if (result) {
        return { available: true, version: result.updateInfo.version };
      }
      return { available: false };
    } catch (error) {
      log.error('Update check failed:', error);
      throw error;
    }
  });
  
  ipcMain.handle('updater:version', async () => {
    return app.getVersion();
  });
  
  ipcMain.handle('dialog:selectFolders', async () => {
    const result = await dialog.showOpenDialog(win!, {
      properties: ['openDirectory', 'multiSelections']
    });
    return result.filePaths;
  });
  
  ipcMain.handle('indexer:watchStart', async (_, { roots, options }) => {
    return sendToWorker('watchStart', { roots, options });
  });
  
  ipcMain.handle('indexer:enqueue', async (_, { paths }) => {
    return sendToWorker('enqueue', { paths });
  });
  
  ipcMain.handle('indexer:pause', async () => {
    return sendToWorker('pause');
  });
  
  ipcMain.handle('indexer:resume', async () => {
    return sendToWorker('resume');
  });
  
  ipcMain.handle('indexer:progress', async () => {
    // Return a default progress if worker is not ready yet
    if (!workerReady) {
      return {
        queued: 0,
        processing: 0,
        done: 0,
        errors: 0,
        initialized: false
      };
    }
    const progress = await sendToWorker('progress');
    return { ...progress, initialized: workerReady };
  });

  ipcMain.handle('worker:isReady', async () => {
    return workerReady;
  });

  ipcMain.handle('search:query', async (_, { q, k }) => {
    return sendToWorker('search', { q, k });
  });
  
  ipcMain.handle('system:openPath', async (_, filePath: string) => {
    shell.showItemInFolder(filePath);
  });
  
  ipcMain.handle('system:openExternal', async (_, url: string) => {
    shell.openExternal(url);
  });
  
  ipcMain.handle('system:openPreview', async (_, filePath: string) => {
    shell.openPath(filePath);
  });
  
  ipcMain.handle('db:stats', async () => {
    // Return default stats if worker isn't ready yet
    if (!workerReady) {
      return {
        totalChunks: 0,
        indexedFiles: 0,
        folderStats: []
      };
    }
    return sendToWorker('stats');
  });
  
  ipcMain.handle('system:getDataPath', () => {
    const userDataPath = app.getPath('userData') || path.join(require('os').tmpdir(), 'semantica-test');
    return path.join(userDataPath, 'data');
  });
  
  ipcMain.handle('indexer:getWatchedFolders', async () => {
    return sendToWorker('getWatchedFolders');
  });
  
  ipcMain.handle('settings:get', async () => {
    return sendToWorker('getSettings');
  });
  
  ipcMain.handle('settings:update', async (_, settings) => {
    return sendToWorker('updateSettings', settings);
  });
  
  ipcMain.handle('indexer:reindexAll', async () => {
    return sendToWorker('reindexAll');
  });
  
  ipcMain.handle('indexer:searchFiles', async (_, query: string) => {
    return sendToWorker('searchFiles', query);
  });
  
  ipcMain.handle('dialog:confirm', async (_, title: string, message: string) => {
    const { response } = await dialog.showMessageBox(mainWindow!, {
      type: 'question',
      buttons: ['Cancel', 'Continue'],
      defaultId: 1,
      cancelId: 0,
      title,
      message
    });
    return response === 1;
  });
  
  ipcMain.handle('dialog:error', async (_, title: string, message: string) => {
    dialog.showErrorBox(title, message);
  });
  });
}

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    app.whenReady().then(() => {});
  }
});

// Proper shutdown coordination to prevent SIGABRT crash
// Guard flag to prevent infinite loop when app.quit() triggers before-quit again
let isShuttingDown = false;

app.on('before-quit', async (event) => {
  // Allow quit to proceed if already cleaned up
  if (isShuttingDown) {
    return; // Don't prevent, let it quit naturally
  }

  // Prevent quit until cleanup is complete
  event.preventDefault();
  isShuttingDown = true;

  log.info('App shutting down...');

  // Send shutdown message to worker and wait for completion
  if (worker) {
    try {
      await new Promise<void>((resolve) => {
        // Set timeout to ensure we don't hang forever
        const timeout = setTimeout(() => {
          log.warn('Worker shutdown timeout, forcing quit');
          resolve();
        }, 5000); // 5 second timeout

        // Send shutdown message
        worker.postMessage({ type: 'shutdown' });

        // Wait for worker to exit
        worker.once('exit', () => {
          clearTimeout(timeout);
          log.info('Worker exited cleanly');
          resolve();
        });
      });
    } catch (error) {
      log.error('Error during worker shutdown:', error);
    }
  }

  // Now allow the app to quit
  app.quit();
});