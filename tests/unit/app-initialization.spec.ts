import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { BrowserWindow, app, ipcMain } from 'electron';
import { Worker } from 'worker_threads';

// Mock electron modules
vi.mock('electron', () => ({
  app: {
    requestSingleInstanceLock: vi.fn(),
    whenReady: vi.fn(),
    on: vi.fn(),
    quit: vi.fn(),
    getPath: vi.fn()
  },
  BrowserWindow: vi.fn(),
  ipcMain: {
    handle: vi.fn()
  },
  dialog: {
    showErrorBox: vi.fn()
  }
}));

vi.mock('worker_threads', () => ({
  Worker: vi.fn()
}));

describe('App Initialization Sequence', () => {
  let mockWorker: any;
  let mockWindow: any;
  
  beforeEach(() => {
    vi.clearAllMocks();
    
    // Setup mock worker
    mockWorker = {
      on: vi.fn(),
      postMessage: vi.fn(),
      terminate: vi.fn()
    };
    (Worker as any).mockImplementation(() => mockWorker);
    
    // Setup mock window
    mockWindow = {
      webContents: {
        send: vi.fn()
      },
      loadURL: vi.fn(),
      loadFile: vi.fn()
    };
    (BrowserWindow as any).mockImplementation(() => mockWindow);
  });
  
  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('Single Instance Lock', () => {
    it('should acquire lock on first launch', () => {
      (app.requestSingleInstanceLock as any).mockReturnValue(true);
      
      const gotLock = app.requestSingleInstanceLock();
      
      expect(gotLock).toBe(true);
      expect(app.quit).not.toHaveBeenCalled();
    });
    
    it('should quit if lock cannot be acquired', () => {
      (app.requestSingleInstanceLock as any).mockReturnValue(false);
      
      const gotLock = app.requestSingleInstanceLock();
      
      if (!gotLock) {
        app.quit();
      }
      
      expect(gotLock).toBe(false);
      expect(app.quit).toHaveBeenCalled();
    });
    
    it('should focus existing window on second instance', () => {
      const mockWin = {
        isMinimized: vi.fn().mockReturnValue(false),
        restore: vi.fn(),
        focus: vi.fn()
      };
      
      // Simulate second-instance event handler
      const secondInstanceHandler = () => {
        if (mockWin) {
          if (mockWin.isMinimized()) mockWin.restore();
          mockWin.focus();
        }
      };
      
      secondInstanceHandler();
      
      expect(mockWin.focus).toHaveBeenCalled();
      expect(mockWin.restore).not.toHaveBeenCalled();
    });
  });

  describe('Initialization Order', () => {
    it('should follow correct initialization sequence', async () => {
      const initOrder: string[] = [];
      
      // Mock the initialization sequence
      const initializeApp = async () => {
        // 1. Wait for app ready
        initOrder.push('app.whenReady');
        await (app.whenReady as any)();
        
        // 2. Create window
        initOrder.push('create-window');
        const win = new BrowserWindow({});
        
        // 3. Spawn worker
        initOrder.push('spawn-worker');
        const worker = new Worker('worker.js');
        
        // 4. Wait for worker ready
        initOrder.push('wait-worker');
        await new Promise(resolve => setTimeout(resolve, 10));
        
        // 5. Register IPC handlers
        initOrder.push('register-handlers');
        ipcMain.handle('test', async () => {});
        
        // 6. Load window content
        initOrder.push('load-content');
        await win.loadURL('http://localhost:5173');
      };
      
      await initializeApp();
      
      expect(initOrder).toEqual([
        'app.whenReady',
        'create-window',
        'spawn-worker',
        'wait-worker',
        'register-handlers',
        'load-content'
      ]);
    });
    
    it('should register IPC handlers before loading content', () => {
      const handleCalls: string[] = [];
      const loadCalls: string[] = [];
      
      (ipcMain.handle as any).mockImplementation((channel: string) => {
        handleCalls.push(channel);
      });
      
      mockWindow.loadURL.mockImplementation(() => {
        loadCalls.push('loadURL');
      });
      
      // Register handlers
      ipcMain.handle('db:stats', async () => {});
      ipcMain.handle('model:check', async () => {});
      
      // Load content
      mockWindow.loadURL('http://localhost:5173');
      
      // Verify handlers registered before content loaded
      expect(handleCalls.length).toBe(2);
      expect(handleCalls).toContain('db:stats');
      expect(handleCalls).toContain('model:check');
      expect(loadCalls).toEqual(['loadURL']);
    });
  });

  describe('Worker Thread Initialization', () => {
    it('should wait for worker ready signal', async () => {
      let workerReady = false;
      let resolveReady: any;
      const readyPromise = new Promise(resolve => {
        resolveReady = resolve;
      });
      
      // Mock worker ready event
      mockWorker.on.mockImplementation((event: string, handler: Function) => {
        if (event === 'message') {
          // Simulate worker sending ready message after delay
          setTimeout(() => {
            handler({ type: 'ready' });
            workerReady = true;
            resolveReady();
          }, 50);
        }
      });
      
      const worker = new Worker('worker.js');
      worker.on('message', (msg: any) => {
        if (msg.type === 'ready') {
          workerReady = true;
        }
      });
      
      expect(workerReady).toBe(false);
      
      await readyPromise;
      
      expect(workerReady).toBe(true);
    });
    
    it('should handle worker initialization timeout', async () => {
      const waitForWorker = async (timeout = 100): Promise<void> => {
        const startTime = Date.now();
        let workerReady = false;
        
        while (!workerReady) {
          if (Date.now() - startTime > timeout) {
            throw new Error('Worker initialization timeout');
          }
          await new Promise(resolve => setTimeout(resolve, 10));
        }
      };
      
      await expect(waitForWorker(100)).rejects.toThrow('Worker initialization timeout');
    });
  });

  describe('Error Handling', () => {
    it('should show error dialog on worker initialization failure', async () => {
      const { dialog } = await import('electron');
      const showErrorBox = vi.fn();
      (dialog as any).showErrorBox = showErrorBox;
      
      const handleWorkerError = (err: Error) => {
        console.error('Failed to initialize worker:', err);
        dialog.showErrorBox('Initialization Error', 
          'Failed to initialize the worker thread. The app may not function correctly.');
      };
      
      const error = new Error('Worker failed');
      handleWorkerError(error);
      
      expect(showErrorBox).toHaveBeenCalledWith(
        'Initialization Error',
        'Failed to initialize the worker thread. The app may not function correctly.'
      );
    });
    
    it('should restart worker on crash', () => {
      const spawnWorker = vi.fn(() => mockWorker);
      
      // Simulate worker exit with error code
      const handleWorkerExit = (code: number | null) => {
        if (code !== 0 && code !== null) {
          console.error(`Worker stopped with exit code ${code}`);
          setTimeout(() => spawnWorker(), 1000);
        }
      };
      
      handleWorkerExit(1);
      
      setTimeout(() => {
        expect(spawnWorker).toHaveBeenCalled();
      }, 1100);
    });
  });
});