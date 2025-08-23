import { fork, ChildProcess } from 'node:child_process';
import path from 'node:path';

export class IsolatedEmbedder {
  private child: ChildProcess | null = null;
  private inflight = new Map<string, { resolve: Function, reject: Function }>();
  private filesSinceSpawn = 0;
  private ready = false;
  private initPromise: Promise<void> | null = null;

  constructor(private modelName = 'Xenova/all-MiniLM-L6-v2') {}

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

  async embed(texts: string[]): Promise<number[][]> {
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

      this.child!.send({ type: 'embed', id, texts });
    });
  }

  async checkMemoryAndRestart(): Promise<boolean> {
    const { rss, external } = process.memoryUsage();
    const rssMB = Math.round(rss / 1024 / 1024);
    const extMB = Math.round(external / 1024 / 1024);
    
    // Optimized limits for better performance
    const shouldRestart = rssMB > 1500 || extMB > 300 || this.filesSinceSpawn > 500;
    
    if (shouldRestart && this.inflight.size === 0) {
      console.log(`Restarting embedder: RSS=${rssMB}MB, External=${extMB}MB, Files=${this.filesSinceSpawn}`);
      if (this.child) {
        this.child.send({ type: 'shutdown' });
        await new Promise(r => setTimeout(r, 100));
        this.child.kill('SIGKILL');
      }
      await this.spawnChild();
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

export async function embed(texts: string[]): Promise<number[][]> {
  if (!embedder) {
    embedder = new IsolatedEmbedder();
  }
  return embedder.embed(texts);
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