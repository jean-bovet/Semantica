import { app, BrowserWindow, ipcMain, shell, dialog } from 'electron';
import { Worker } from 'node:worker_threads';
import path from 'node:path';
import fs from 'node:fs';

let worker: Worker | null = null;
let win: BrowserWindow | null = null;
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
    } else if (msg.type === 'progress') {
      win?.webContents.send('indexer:progress', msg.payload);
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
    if (code !== 0) {
      console.error(`Worker stopped with exit code ${code}`);
      setTimeout(spawnWorker, 1000);
    }
  });
  
  const dbDir = path.join(app.getPath('userData'), 'data');
  fs.mkdirSync(dbDir, { recursive: true });
  worker.postMessage({ type: 'init', dbDir });
}

function sendToWorker(type: string, payload: any = {}): Promise<any> {
  return new Promise((resolve, reject) => {
    if (!worker || !workerReady) {
      reject(new Error('Worker not ready'));
      return;
    }
    
    const id = Math.random().toString(36).substring(7);
    pendingCallbacks.set(id, resolve);
    
    worker.postMessage({ type, payload, id });
    
    setTimeout(() => {
      if (pendingCallbacks.has(id)) {
        pendingCallbacks.delete(id);
        reject(new Error('Worker timeout'));
      }
    }, 30000);
  });
}

app.whenReady().then(() => {
  win = new BrowserWindow({
    width: 1200,
    height: 800,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    },
    titleBarStyle: 'hiddenInset',
    vibrancy: 'sidebar'
  });
  
  const isDev = process.env.NODE_ENV !== 'production';
  
  if (isDev) {
    win.loadURL('http://localhost:5173');
    win.webContents.openDevTools();
  } else {
    win.loadFile(path.join(__dirname, '../index.html'));
  }
  
  spawnWorker();
  
  if (isDev) {
    const workerPath = path.join(__dirname, 'worker.cjs');
    fs.watchFile(workerPath, { interval: 1000 }, () => {
      console.log('Worker changed, respawning...');
      spawnWorker();
    });
  }
  
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
    return sendToWorker('progress');
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
});

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

app.on('before-quit', () => {
  worker?.terminate();
});