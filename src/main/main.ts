import { app, BrowserWindow, ipcMain, shell, dialog, crashReporter } from 'electron';
import { Worker } from 'node:worker_threads';
import path from 'node:path';
import fs from 'node:fs';
import { autoUpdater } from 'electron-updater';
import log from 'electron-log';
import { WorkerManager } from './utils/WorkerManager';

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
console.log('Crash dumps will be saved to:', crashDumpDir);
fs.mkdirSync(crashDumpDir, { recursive: true });

// Ensure single instance
const gotTheLock = app.requestSingleInstanceLock();

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

// Custom WorkerManager that handles app-specific messages
class AppWorkerManager extends WorkerManager {
  protected handleWorkerMessage(msg: any): void {
    if (msg.type === 'model:ready') {
      // Model is ready (either found or downloaded)
      console.log('Model ready:', msg.payload);
      win?.webContents.send('model:check:result', { exists: msg.payload.ready });
      if (msg.payload.ready) {
        win?.webContents.send('model:download:complete');
      }
    } else if (msg.type === 'progress') {
      win?.webContents.send('indexer:progress', { ...msg.payload, initialized: true });
    } else if (msg.type === 'model:check:result') {
      win?.webContents.send('model:check:result', msg.payload);
    } else if (msg.type === 'model:download:progress') {
      win?.webContents.send('model:download:progress', msg.payload);
    } else if (msg.type === 'model:download:complete') {
      isDownloadingModel = false;
      win?.webContents.send('model:download:complete');
    }
  }
}

let workerManager: AppWorkerManager | null = null;
let win: BrowserWindow | null = null;
let mainWindow: BrowserWindow | null = null;
let isDownloadingModel = false;

async function initializeWorker() {
  // Shutdown existing worker if any
  if (workerManager) {
    await workerManager.shutdown();
  }
  
  // Get userData path with fallback for test environments
  const userDataPath = app.getPath('userData') || path.join(require('os').tmpdir(), 'semantica-test')
  
  const dbDir = path.join(userDataPath, 'data');
  fs.mkdirSync(dbDir, { recursive: true });
  
  // Create models directory for ML models
  const modelsDir = path.join(userDataPath, 'models');
  fs.mkdirSync(modelsDir, { recursive: true });
  
  // Initialize WorkerManager with proper config
  workerManager = new AppWorkerManager(
    path.join(__dirname, 'worker.cjs'),
    { dbDir, userDataPath }
  );
  
  // Start the worker
  try {
    await workerManager.start();
    console.log('Worker initialized and ready');
    
    // Send initial progress with initialized flag
    const progress = await sendToWorker('progress');
    win?.webContents.send('indexer:progress', { ...progress, initialized: true });
  } catch (err) {
    console.error('Failed to initialize worker:', err);
  }
  
}

// waitForWorker removed - WorkerManager handles this internally

async function sendToWorker(type: string, payload: any = {}): Promise<any> {
  if (!workerManager) {
    throw new Error('Worker not initialized');
  }
  
  // WorkerManager automatically waits for ready state
  return workerManager.sendMessage({ type, payload });
}

if (gotTheLock) {
  app.whenReady().then(async () => {
    // Set About panel options
    app.setAboutPanelOptions({
      applicationName: 'Semantica',
      applicationVersion: app.getVersion(),
      copyright: 'Copyright © 2025 Jean Bovet',
      authors: ['Jean Bovet'],
      website: 'https://github.com/bovet/FSS',
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
  
  // Configure auto-updater logging
  autoUpdater.logger = log;
  (autoUpdater.logger as any).transports.file.level = 'info';
  log.info('App starting...');
  
  // Initialize auto-updater after a short delay
  setTimeout(() => {
    log.info('Checking for updates...');
    autoUpdater.checkForUpdatesAndNotify();
  }, 5000); // 5 second delay to let app fully load
  
  // Check for updates every 30 minutes
  setInterval(() => {
    autoUpdater.checkForUpdatesAndNotify();
  }, 30 * 60 * 1000);
  
  // Spawn worker and wait for it to be ready before setting up IPC handlers
  initializeWorker();
  try {
    // WorkerManager waits internally
    if (!workerManager) {
      throw new Error('Worker not initialized');
    }
    console.log('Worker initialized successfully');
  } catch (err) {
    console.error('Failed to initialize worker:', err);
    dialog.showErrorBox('Initialization Error', 'Failed to initialize the worker thread. The app may not function correctly.');
  }
  
  // Register all IPC handlers BEFORE loading the window content
  ipcMain.handle('model:check', async () => {
    return sendToWorker('checkModel');
  });
  
  ipcMain.handle('model:download', async () => {
    isDownloadingModel = true;
    return sendToWorker('downloadModel');
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
    if (!workerManager?.isReady()) {
      return {
        queued: 0,
        processing: 0,
        done: 0,
        errors: 0,
        initialized: false
      };
    }
    const progress = await sendToWorker('progress');
    return { ...progress, initialized: workerManager?.isReady() || false };
  });
  
  ipcMain.handle('search:query', async (_, { q, k }) => {
    return sendToWorker('search', { q, k });
  });
  
  ipcMain.handle('system:openPath', async (_, filePath: string) => {
    shell.showItemInFolder(filePath);
  });
  
  ipcMain.handle('system:openPreview', async (_, filePath: string) => {
    shell.openPath(filePath);
  });
  
  ipcMain.handle('db:stats', async () => {
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
  
  // NOW load the window content after all handlers are registered
  const isDev = process.env.NODE_ENV !== 'production';
  
  if (isDev) {
    win.loadURL('http://localhost:5173');
    win.webContents.openDevTools();
  } else {
    win.loadFile(path.join(__dirname, 'index.html'));
  }
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

app.on('before-quit', async (event) => {
  event.preventDefault();
  
  // Send shutdown signal to worker and wait
  if (workerManager) {
    await workerManager.shutdown();
  }
  
  app.exit(0);
});