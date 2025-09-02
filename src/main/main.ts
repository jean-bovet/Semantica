import { app, BrowserWindow, ipcMain, shell, dialog, crashReporter } from 'electron';
import { Worker } from 'node:worker_threads';
import path from 'node:path';
import fs from 'node:fs';
import { autoUpdater } from 'electron-updater';
import log from 'electron-log';

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

let worker: Worker | null = null;
let win: BrowserWindow | null = null;
let mainWindow: BrowserWindow | null = null;
let workerReady = false;
const pendingCallbacks = new Map<string, (data: any) => void>();

function spawnWorker() {
  worker?.terminate().catch(() => {});
  workerReady = false;
  
  worker = new Worker(path.join(__dirname, 'worker.cjs'));
  
  worker.on('message', (msg: any) => {
    if (msg.type === 'ready') {
      workerReady = true;
      console.log('Worker ready');
      // Send initial progress with initialized flag
      sendToWorker('progress').then((progress: any) => {
        win?.webContents.send('indexer:progress', { ...progress, initialized: true });
      });
    } else if (msg.type === 'model:ready') {
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
      win?.webContents.send('model:download:complete');
    } else if (msg.id && pendingCallbacks.has(msg.id)) {
      const callback = pendingCallbacks.get(msg.id)!;
      pendingCallbacks.delete(msg.id);
      callback(msg.payload);
    }
  });
  
  worker.on('error', (err) => {
    console.error('Worker error:', err);
  });
  
  worker.on('exit', (code) => {
    if (code !== 0 && code !== null) {
      // Only respawn on actual errors, not on intentional termination
      console.error(`Worker stopped with exit code ${code}`);
      setTimeout(spawnWorker, 1000);
    }
  });
  
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

async function waitForWorker(timeout = 10000): Promise<void> {
  const startTime = Date.now();
  while (!workerReady) {
    if (Date.now() - startTime > timeout) {
      throw new Error('Worker initialization timeout');
    }
    await new Promise(resolve => setTimeout(resolve, 100));
  }
}

function sendToWorker(type: string, payload: any = {}): Promise<any> {
  return new Promise(async (resolve, reject) => {
    // For model operations, ensure worker is ready first
    if ((type === 'checkModel' || type === 'downloadModel') && !workerReady) {
      try {
        await waitForWorker();
      } catch (err) {
        reject(err);
        return;
      }
    }
    
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
  spawnWorker();
  try {
    await waitForWorker();
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
  if (worker) {
    worker.postMessage({ type: 'shutdown' });
    await new Promise(resolve => setTimeout(resolve, 500));
    worker.terminate();
  }
  
  app.exit(0);
});