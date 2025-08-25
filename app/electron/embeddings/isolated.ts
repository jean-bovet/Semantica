import { fork, ChildProcess } from 'node:child_process';
import path from 'node:path';
import { IEmbedder, EmbedderConfig } from './IEmbedder';

export class IsolatedEmbedder implements IEmbedder {
  private child: ChildProcess | null = null;
  private inflight = new Map<string, { resolve: Function, reject: Function }>();
  public filesSinceSpawn = 0; // Made public for shouldRestart check
  private ready = false;
  private initPromise: Promise<void> | null = null;
  private readonly maxFilesBeforeRestart: number;
  private readonly maxMemoryMB: number;

  constructor(private modelName = 'Xenova/multilingual-e5-small', config?: EmbedderConfig) {
    if (config?.modelName) this.modelName = config.modelName;
    this.maxFilesBeforeRestart = config?.maxFilesBeforeRestart || 500;
    this.maxMemoryMB = config?.maxMemoryMB || 1500;
  }

  private async spawnChild(): Promise<void> {
    if (this.child) {
      this.child.kill('SIGKILL');
      this.child = null;
    }

    this.ready = false;
    this.filesSinceSpawn = 0;
    this.inflight.clear();

    const childPath = path.join(__dirname, 'embedder.child.cjs');

    this.child = fork(childPath, [], { 
      execArgv: ['--expose-gc'],
      silent: false
    });

    this.child.on('message', (msg: any) => {
      if (msg.type === 'ready') {
        this.ready = true;
      } else if (msg.type === 'init:err') {
        console.error('Embedder init failed:', msg.error);
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

    // Wait for ready
    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error('Embedder init timeout'));
      }, 30000);

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
    if (!this.ready || !this.child) {
      if (!this.initPromise) {
        this.initPromise = this.spawnChild().finally(() => {
          this.initPromise = null;
        });
      }
      await this.initPromise;
    }
  }

  async embed(texts: string[], isQuery = false): Promise<number[][]> {
    await this.ensureReady();
    
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

      this.child!.send({ type: 'embed', id, texts, isQuery });
    });
  }

  /**
   * Initialize the embedder
   */
  async initialize(): Promise<boolean> {
    try {
      await this.ensureReady();
      return true;
    } catch (error) {
      console.error('Failed to initialize embedder:', error);
      return false;
    }
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
   * Check if the embedder should restart
   */
  shouldRestart(): boolean {
    const { rss, external } = process.memoryUsage();
    const rssMB = Math.round(rss / 1024 / 1024);
    const extMB = Math.round(external / 1024 / 1024);
    
    return rssMB > this.maxMemoryMB || 
           extMB > 300 || 
           this.filesSinceSpawn > this.maxFilesBeforeRestart;
  }

  /**
   * Restart the embedder
   */
  async restart(): Promise<void> {
    console.log(`Restarting embedder after ${this.filesSinceSpawn} files`);
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
    if (this.shouldRestart() && this.inflight.size === 0) {
      await this.restart();
      return true;
    }
    return false;
  }

  async shutdown(): Promise<void> {
    if (this.child) {
      try {
        this.child.send({ type: 'shutdown' });
        await new Promise(r => setTimeout(r, 200));
      } catch (e) {
        // Child may already be dead
      }
      this.child.kill('SIGTERM');
      await new Promise(r => setTimeout(r, 100));
      if (this.child.killed === false) {
        this.child.kill('SIGKILL');
      }
      this.child = null;
    }
    this.ready = false;
    this.inflight.clear();
  }
}

// Singleton instance
let embedder: IsolatedEmbedder | null = null;

export async function embed(texts: string[], isQuery = false): Promise<number[][]> {
  if (!embedder) {
    embedder = new IsolatedEmbedder();
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