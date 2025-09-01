import { fork, ChildProcess } from 'node:child_process';
import path from 'node:path';
import { IEmbedder, EmbedderConfig } from './IEmbedder';

export class IsolatedEmbedder implements IEmbedder {
  private child: ChildProcess | null = null;
  private inflight = new Map<string, { resolve: Function, reject: Function }>();
  public filesSinceSpawn = 0; // Made public for shouldRestart check
  private ready = false;
  private initPromise: Promise<void> | null = null;
  private spawning = false; // Prevent multiple spawns
  private readonly maxFilesBeforeRestart: number;
  private readonly maxMemoryMB: number;
  constructor(private modelName = 'Xenova/multilingual-e5-small', config?: EmbedderConfig) {
    if (config?.modelName) this.modelName = config.modelName;
    this.maxFilesBeforeRestart = config?.maxFilesBeforeRestart || 500;
    this.maxMemoryMB = config?.maxMemoryMB || 1500;  // This is the actual limit for child process
  }
  
  /**
   * Get memory usage of the child process
   */
  private async getChildMemoryUsage(): Promise<{ rss: number; vsz: number } | null> {
    if (!this.child || !this.child.pid) return null;
    
    try {
      // Use ps to get memory info for the child process
      const { execSync } = require('child_process');
      const result = execSync(`ps -o rss=,vsz= -p ${this.child.pid}`).toString().trim();
      const [rss, vsz] = result.split(/\s+/).map(Number);
      return { 
        rss: rss / 1024, // Convert KB to MB
        vsz: vsz / 1024  // Convert KB to MB
      };
    } catch (_e) {
      return null;
    }
  }
  
  public async initialize(): Promise<boolean> {
    // Ensure child process is spawned and model is loaded
    // Model MUST already exist at this point (checked by worker)
    await this.ensureReady();
    return true;
  }

  private async spawnChild(): Promise<void> {
    // Prevent multiple simultaneous spawns
    if (this.spawning) {
      // Wait for existing spawn to complete (max 30 seconds)
      let waitTime = 0;
      while (this.spawning && waitTime < 30000) {
        await new Promise(r => setTimeout(r, 100));
        waitTime += 100;
      }
      // If still spawning after 30s, something is wrong
      if (this.spawning) {
        this.spawning = false;
        if (this.child) {
          this.child.kill('SIGKILL');
          this.child = null;
        }
      }
      // Check if ready after waiting
      if (this.ready) {
        return;
      }
    }
    
    this.spawning = true;
    
    if (this.child) {
      this.child.kill('SIGKILL');
      this.child = null;
    }

    this.ready = false;
    this.filesSinceSpawn = 0;
    this.inflight.clear();

    // In production with ASAR, the embedder.child.cjs is in the dist folder
    // For testing, process.resourcesPath might be undefined
    const childPath = process.env.NODE_ENV === 'production' && process.resourcesPath
      ? path.join(process.resourcesPath, 'app.asar', 'dist', 'embedder.child.cjs')
      : path.join(__dirname, 'embedder.child.cjs');
    
    // Set model cache directory to userData instead of node_modules
    // In worker thread, electron is not available, use USER_DATA_PATH env var
    const userDataPath = process.env.USER_DATA_PATH || path.join(require('os').homedir(), '.offline-search');
    const modelCachePath = path.join(userDataPath, 'models');
    
    this.child = fork(childPath, [], { 
      execArgv: ['--expose-gc'],
      silent: false,
      env: {
        ...process.env,
        TRANSFORMERS_CACHE: modelCachePath,
        XDG_CACHE_HOME: modelCachePath
      }
    });

    this.child.on('message', (msg: any) => {
      if (msg.type === 'ready') {
        this.ready = true;
      } else if (msg.type === 'init:err') {
        console.error('[ISOLATED] Embedder init failed:', msg.error);
        this.ready = false;
      } else if (msg.id) {
        const handler = this.inflight.get(msg.id);
        if (handler) {
          this.inflight.delete(msg.id);
          if (msg.type === 'embed:ok') {
            handler.resolve(msg.vectors);
          } else {
            handler.reject(new Error(msg.error));
          }
        }
      }
    });

    this.child.on('error', (err) => {
      console.error('Embedder child error:', err);
      for (const handler of this.inflight.values()) {
        handler.reject(err);
      }
      this.inflight.clear();
    });

    this.child.on('exit', (code) => {
      if (code !== 0 && code !== null) {
        console.error(`Embedder child exited with code ${code}`);
      }
      this.ready = false;
      for (const handler of this.inflight.values()) {
        handler.reject(new Error('Embedder process exited'));
      }
      this.inflight.clear();
    });

    // Send init message
    this.child.send({ type: 'init', model: this.modelName });

    // Wait for ready (model should already exist, but may need to reload)
    try {
      await new Promise<void>((resolve, reject) => {
        const timeout = setTimeout(() => {
          console.error('[ISOLATED] Embedder init timeout after 60 seconds');
          // Kill the child process if it's not responding
          if (this.child) {
            console.log('[ISOLATED] Killing unresponsive child process');
            this.child.kill('SIGKILL');
            this.child = null;
          }
          reject(new Error('Embedder init timeout'));
        }, 60000); // 60 seconds (model needs to reload after restart)
        
        const checkReady = setInterval(() => {
          if (this.ready) {
            clearInterval(checkReady);
            clearTimeout(timeout);
            resolve();
          }
        }, 100); // Check every 100ms
      });
    } finally {
      // Always mark spawning as complete, even on error
      this.spawning = false;
    }
  }

  private async ensureReady(): Promise<void> {
    if (!this.ready || !this.child) {
      if (!this.initPromise) {
        this.initPromise = this.spawnChild()
          .catch((err) => {
            console.error('[ISOLATED] Failed to spawn child:', err);
            // Reset state on failure
            this.ready = false;
            this.child = null;
            this.spawning = false;
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
    
    // Double-check child process is available
    if (!this.child || !this.child.connected) {
      throw new Error('Embedder child process is not connected');
    }
    
    // Check memory periodically to prevent crashes
    if (this.filesSinceSpawn > 50 && this.filesSinceSpawn % 10 === 0) {  // Check every 10 files after 50
      const childMem = await this.getChildMemoryUsage();
      if (childMem && childMem.rss > this.maxMemoryMB * 0.95) {  // Restart at 95% of limit
        await this.restart();
        await this.ensureReady();
      }
    }
    
    return new Promise((resolve, reject) => {
      const id = Math.random().toString(36).slice(2);
      
      const timeout = setTimeout(() => {
        this.inflight.delete(id);
        reject(new Error('Embed timeout'));
      }, 60000);

      this.inflight.set(id, {
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
        if (!this.child) {
          throw new Error('Child process is not available');
        }
        // Check if child is still connected before sending
        if (!this.child.connected) {
          throw new Error('Child process disconnected');
        }
        this.child.send({ type: 'embed', id, texts, isQuery });
      } catch (err: any) {
        this.inflight.delete(id);
        clearTimeout(timeout);
        // If EPIPE error, the child died - mark as not ready
        if (err.code === 'EPIPE' || err.message?.includes('disconnected')) {
          this.ready = false;
          this.child = null;
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
          
          // If child process died, restart it
          if (!this.child || !this.child.connected) {
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
    // Check child process memory if available
    const childMem = await this.getChildMemoryUsage();
    if (childMem) {
      return childMem.rss > this.maxMemoryMB || 
             this.filesSinceSpawn > this.maxFilesBeforeRestart;
    }
    
    // If no child process, don't restart
    return false;
  }

  /**
   * Restart the embedder
   */
  async restart(): Promise<void> {
    await this.shutdown();
    await this.spawnChild();
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
    if (this.child) {
      try {
        // Check if child is still connected before sending message
        if (this.child.connected) {
          this.child.send({ type: 'shutdown' });
          await new Promise(r => setTimeout(r, 200));
        }
      } catch (_e) {
        // Child may already be dead or disconnected
      }
      
      try {
        // Try graceful termination first
        if (!this.child.killed) {
          this.child.kill('SIGTERM');
          await new Promise(r => setTimeout(r, 100));
        }
        
        // Force kill if still alive
        if (this.child && !this.child.killed) {
          this.child.kill('SIGKILL');
        }
      } catch (_e) {
        // Process might already be dead
      }
      
      this.child = null;
    }
    this.ready = false;
    this.inflight.clear();
  }
}

// Singleton instance - ensure only one exists globally
let embedder: IsolatedEmbedder | null = null;
let embedderInitializing = false;
let embedderInitPromise: Promise<void> | null = null;

export async function embed(texts: string[], isQuery = false): Promise<number[][]> {
  // If embedder doesn't exist and not already initializing, create it
  if (!embedder && !embedderInitializing) {
    embedderInitializing = true;
    // Increase the restart threshold to reduce frequency of restarts
    embedder = new IsolatedEmbedder('Xenova/multilingual-e5-small', {
      maxFilesBeforeRestart: 5000,  // Increased from 1000 to reduce restart frequency
      maxMemoryMB: 1500
    });
    embedderInitPromise = embedder.initialize().then(() => {
      embedderInitializing = false;
      embedderInitPromise = null;
    }).catch((err) => {
      embedderInitializing = false;
      embedderInitPromise = null;
      embedder = null;
      throw err;
    });
  }
  
  // Wait for initialization if in progress
  if (embedderInitPromise) {
    await embedderInitPromise;
  }
  
  // If still no embedder after waiting, try once more
  if (!embedder) {
    embedder = new IsolatedEmbedder('Xenova/multilingual-e5-small', {
      maxFilesBeforeRestart: 5000,
      maxMemoryMB: 1500
    });
    await embedder.initialize();
  }
  
  return embedder.embed(texts, isQuery);
}

export async function checkEmbedderMemory(): Promise<boolean> {
  if (embedder) {
    return embedder.checkMemoryAndRestart();
  }
  return false;
}

export async function shutdownEmbedder(): Promise<void> {
  if (embedder) {
    await embedder.shutdown();
    embedder = null;
  }
}

