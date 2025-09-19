import path from 'node:path';
import { IEmbedder, EmbedderConfig } from './IEmbedder';
import { ChildProcessManager } from '../utils/ChildProcessManager';
import { ProcessMemoryMonitor } from '../utils/ProcessMemoryMonitor';
import { ModelPathResolver } from './ModelPathResolver';
import { IPCMessageBuilder, MessageTypeGuards } from './IPCMessageProtocol';

export class IsolatedEmbedder implements IEmbedder {
  private processManager: ChildProcessManager | null = null;
  private memoryMonitor: ProcessMemoryMonitor;
  private pathResolver: ModelPathResolver;
  private inflight = new Map<string, { resolve: Function, reject: Function }>();
  public filesSinceSpawn = 0; // Made public for shouldRestart check
  private ready = false;
  private initPromise: Promise<void> | null = null;
  private readonly config: Required<EmbedderConfig>;

  constructor(private modelName = 'Xenova/multilingual-e5-small', config?: EmbedderConfig) {
    this.config = {
      modelName: config?.modelName || this.modelName,
      maxFilesBeforeRestart: config?.maxFilesBeforeRestart || 500,
      maxMemoryMB: config?.maxMemoryMB || 1500,
      batchSize: config?.batchSize || 32
    };

    // Update modelName if provided in config
    if (this.config.modelName) {
      this.modelName = this.config.modelName;
    }

    // Initialize utilities
    this.memoryMonitor = ProcessMemoryMonitor.forEmbedder(this.config.maxMemoryMB);
    this.pathResolver = new ModelPathResolver(this.modelName);
  }
  
  /**
   * Get memory usage of the child process
   */
  private async getChildMemoryUsage(): Promise<{ rss: number; vsz: number } | null> {
    const status = this.processManager?.getStatus();
    if (!status?.pid) return null;

    const memInfo = await this.memoryMonitor.getMemoryUsage(status.pid);
    return memInfo ? { rss: memInfo.rss, vsz: memInfo.vsz } : null;
  }
  
  public async initialize(): Promise<boolean> {
    // Ensure child process is spawned and model is loaded
    // Model MUST already exist at this point (checked by worker)
    await this.ensureReady();
    return true;
  }

  private async spawnChild(): Promise<void> {
    console.log('[ISOLATED] Starting embedder spawn with ChildProcessManager...');

    // Clean up existing process manager
    if (this.processManager) {
      await this.processManager.shutdown();
      this.processManager = null;
    }

    this.ready = false;
    this.filesSinceSpawn = 0;
    this.inflight.clear();

    // Get child script path using environment logic
    const childPath = process.env.NODE_ENV === 'production' && process.resourcesPath
      ? path.join(process.resourcesPath, 'app.asar', 'dist', 'embedder.child.cjs')
      : path.join(__dirname, '../../main/worker/embedder.child.cjs');

    // Get environment variables from path resolver
    const envVars = this.pathResolver.getTransformersEnv();

    // Create and configure the process manager
    this.processManager = new ChildProcessManager({
      scriptPath: childPath,
      env: {
        ...envVars,
        // Force pure Node.js mode
        ELECTRON_RUN_AS_NODE: '1',
        // Disable ONNX optimizations that might cause issues
        ORT_DISABLE_ALL_OPTIONAL_OPTIMIZERS: '1'
      },
      timeout: 60000,
      onStdout: (data) => {
        const lines = data.split('\n');
        for (const line of lines) {
          if (line.trim()) {
            console.log(`[EMBEDDER-OUT] ${line}`);
          }
        }
      },
      onStderr: (data) => {
        console.error(`[EMBEDDER-ERR] ${data}`);
      }
    });

    // Set up event handlers
    this.processManager.on('ready', () => {
      console.log('[ISOLATED] Embedder ready');
      this.ready = true;
    });

    this.processManager.on('error', (err) => {
      console.error('[ISOLATED] Embedder child error:', err);
      this.ready = false;

      // Reject all pending operations
      for (const handler of this.inflight.values()) {
        handler.reject(err);
      }
      this.inflight.clear();
    });

    this.processManager.on('exit', (code, signal) => {
      console.error(`[ISOLATED] Embedder child exited with code ${code}, signal ${signal}`);
      this.ready = false;

      // Reject all pending operations
      for (const handler of this.inflight.values()) {
        handler.reject(new Error('Embedder process exited'));
      }
      this.inflight.clear();
    });

    this.processManager.on('message', (msg: any) => {
      if (MessageTypeGuards.isEmbedSuccessMessage(msg) || MessageTypeGuards.isEmbedErrorMessage(msg)) {
        const handler = this.inflight.get(msg.id);
        if (handler) {
          this.inflight.delete(msg.id);
          if (MessageTypeGuards.isEmbedSuccessMessage(msg)) {
            handler.resolve(msg.vectors);
          } else {
            handler.reject(new Error(msg.error));
          }
        }
      } else if (MessageTypeGuards.isInitErrorMessage(msg)) {
        console.error('[ISOLATED] Embedder init failed:', msg.error);
        this.ready = false;
      }
    });

    // Start the process
    await this.processManager.start();

    // Send init message
    const initMessage = IPCMessageBuilder.init(this.modelName);
    this.processManager.send(initMessage);

    // Wait for ready signal
    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error('Embedder init timeout'));
      }, 60000);

      const checkReady = setInterval(() => {
        if (this.ready) {
          clearInterval(checkReady);
          clearTimeout(timeout);
          resolve();
        }
      }, 100);
    });
  }

  private async ensureReady(): Promise<void> {
    if (!this.ready || !this.processManager) {
      if (!this.initPromise) {
        this.initPromise = this.spawnChild()
          .catch((err) => {
            console.error('[ISOLATED] Failed to spawn child:', err);
            // Reset state on failure
            this.ready = false;
            this.processManager = null;
            throw err;
          })
          .finally(() => {
            this.initPromise = null;
          });
      }
      await this.initPromise;
    }
  }

  async embed(texts: string[], isQuery = false): Promise<number[][]> {
    await this.ensureReady();

    // Double-check process manager is available
    if (!this.processManager || !this.processManager.isConnected()) {
      throw new Error('Embedder child process is not connected');
    }

    // Check memory periodically to prevent crashes
    if (this.filesSinceSpawn > 50 && this.filesSinceSpawn % 10 === 0) {  // Check every 10 files after 50
      const status = this.processManager.getStatus();
      if (status.pid) {
        const checkResult = await this.memoryMonitor.checkMemoryAndRestart(status.pid, this.filesSinceSpawn);
        if (checkResult.shouldRestart) {
          console.log('[ISOLATED] Memory limit reached, restarting embedder:', checkResult.reason);
          await this.restart();
          await this.ensureReady();
        }
      }
    }

    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.inflight.delete(embedMessage.id);
        reject(new Error('Embed timeout'));
      }, 60000);

      // Create typed embed message
      const embedMessage = IPCMessageBuilder.embed(texts, isQuery);

      this.inflight.set(embedMessage.id, {
        resolve: (vectors: number[][]) => {
          clearTimeout(timeout);
          this.filesSinceSpawn++;
          resolve(vectors);
        },
        reject: (err: Error) => {
          clearTimeout(timeout);
          reject(err);
        }
      });

      try {
        if (!this.processManager) {
          throw new Error('Process manager is not available');
        }

        this.processManager.send(embedMessage);
      } catch (err: any) {
        this.inflight.delete(embedMessage.id);
        clearTimeout(timeout);

        // If process died, mark as not ready
        if (err.message?.includes('not connected') || err.message?.includes('disconnected')) {
          this.ready = false;
          this.processManager = null;
        }
        reject(new Error(`Failed to send message to embedder: ${err.message || err}`));
      }
    });
  }


  /**
   * Embed text with retry logic
   */
  async embedWithRetry(texts: string[], maxRetries = 3): Promise<number[][]> {
    let lastError: Error | null = null;
    
    for (let attempt = 0; attempt < maxRetries; attempt++) {
      try {
        return await this.embed(texts);
      } catch (error: any) {
        lastError = error;
        console.warn(`Embed attempt ${attempt + 1} failed:`, error.message);
        
        if (attempt < maxRetries - 1) {
          // Wait before retry with exponential backoff
          await new Promise(r => setTimeout(r, Math.pow(2, attempt) * 1000));
          
          // If process died, restart it
          if (!this.processManager || !this.processManager.isConnected()) {
            await this.restart();
          }
        }
      }
    }
    
    throw lastError || new Error('Embed failed after retries');
  }

  /**
   * Check if the embedder should restart based on memory usage
   */
  async shouldRestart(): Promise<boolean> {
    const status = this.processManager?.getStatus();
    if (!status?.pid) {
      return false;
    }

    // Check memory using the monitor
    const checkResult = await this.memoryMonitor.checkMemoryAndRestart(status.pid, this.filesSinceSpawn);

    // Also check file count threshold
    const fileThresholdExceeded = this.filesSinceSpawn > this.config.maxFilesBeforeRestart;

    return checkResult.shouldRestart || fileThresholdExceeded;
  }

  /**
   * Restart the embedder
   */
  async restart(): Promise<void> {
    if (this.processManager) {
      await this.processManager.restart();
    } else {
      await this.spawnChild();
    }
  }

  /**
   * Get embedder statistics
   */
  getStats() {
    const memoryUsage = process.memoryUsage();
    return {
      filesSinceSpawn: this.filesSinceSpawn,
      isReady: this.ready,
      memoryUsage: {
        rss: Math.round(memoryUsage.rss / 1024 / 1024),
        heapUsed: Math.round(memoryUsage.heapUsed / 1024 / 1024),
        external: Math.round(memoryUsage.external / 1024 / 1024)
      }
    };
  }


  async checkMemoryAndRestart(): Promise<boolean> {
    const shouldRestart = await this.shouldRestart();
    if (shouldRestart && this.inflight.size === 0) {
      await this.restart();
      return true;
    }
    return false;
  }

  async shutdown(): Promise<void> {
    if (this.processManager) {
      try {
        // Send shutdown message
        const shutdownMessage = IPCMessageBuilder.shutdown();
        this.processManager.send(shutdownMessage);
      } catch (_e) {
        // Process may already be dead or disconnected
      }

      await this.processManager.shutdown();
      this.processManager = null;
    }

    this.ready = false;
    this.inflight.clear();
  }
}

// Legacy singleton functions - DEPRECATED: Use EmbedderFactory instead
// These are kept for backward compatibility but should be replaced

import { EmbedderFactory, defaultEmbedderFactory } from './EmbedderFactory';

// Global instance for backward compatibility
let legacyEmbedder: IsolatedEmbedder | null = null;
let legacyInitializing = false;
let legacyInitPromise: Promise<void> | null = null;

/**
 * @deprecated Use EmbedderFactory.createIsolatedEmbedder() instead
 */
export async function embed(texts: string[], isQuery = false): Promise<number[][]> {
  console.warn('[DEPRECATED] embed() function is deprecated. Use EmbedderFactory.createIsolatedEmbedder() instead.');

  // Use factory to create embedder if needed
  if (!legacyEmbedder && !legacyInitializing) {
    legacyInitializing = true;

    try {
      legacyEmbedder = defaultEmbedderFactory.createIsolatedEmbedder();
      legacyInitPromise = legacyEmbedder.initialize().then(() => {
        legacyInitializing = false;
        legacyInitPromise = null;
      });
    } catch (err) {
      legacyInitializing = false;
      legacyInitPromise = null;
      legacyEmbedder = null;
      throw err;
    }
  }

  // Wait for initialization if in progress
  if (legacyInitPromise) {
    await legacyInitPromise;
  }

  // If still no embedder after waiting, create one
  if (!legacyEmbedder) {
    legacyEmbedder = defaultEmbedderFactory.createIsolatedEmbedder();
    await legacyEmbedder.initialize();
  }

  return legacyEmbedder.embed(texts, isQuery);
}

/**
 * @deprecated Use embedder.checkMemoryAndRestart() directly instead
 */
export async function checkEmbedderMemory(): Promise<boolean> {
  console.warn('[DEPRECATED] checkEmbedderMemory() function is deprecated. Use embedder.checkMemoryAndRestart() directly instead.');

  if (legacyEmbedder) {
    return legacyEmbedder.checkMemoryAndRestart();
  }
  return false;
}

/**
 * @deprecated Use embedder.shutdown() directly instead
 */
export async function shutdownEmbedder(): Promise<void> {
  console.warn('[DEPRECATED] shutdownEmbedder() function is deprecated. Use embedder.shutdown() directly instead.');

  if (legacyEmbedder) {
    await legacyEmbedder.shutdown();
    legacyEmbedder = null;
  }
}