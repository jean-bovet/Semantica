import { ChildProcess, fork } from 'node:child_process';
import path from 'node:path';
import { RestartableProcess, ProcessState } from './RestartableProcess';

interface EmbedderState extends ProcessState {
  filesSinceSpawn?: number;
  pendingRequests?: Array<{ id: string; chunks: string[] }>;
}

export class EmbedderManager extends RestartableProcess {
  private embedderReady = false;
  private modelName: string;
  private modelCachePath: string;
  private filesSinceSpawn = 0;
  private readonly maxFilesBeforeRestart = 200;
  private inflight = new Map<string, {
    resolve: (vectors: Float32Array[]) => void;
    reject: (error: Error) => void;
  }>();

  constructor(scriptPath: string, modelName: string, modelCachePath: string) {
    super({
      type: 'child',
      scriptPath,
      memoryThreshold: 300 * 1024 * 1024, // 300MB for embedder
      checkInterval: 30000, // Check every 30 seconds
      maxRestarts: 50, // Allow more restarts for embedder
      restartDelay: 1000
    });
    this.modelName = modelName;
    this.modelCachePath = modelCachePath;
  }

  protected spawn(): ChildProcess {
    console.log('[EmbedderManager] Spawning embedder child process...');
    this.embedderReady = false;
    this.filesSinceSpawn = 0;
    
    const child = fork(this.config.scriptPath, [], {
      execArgv: ['--expose-gc'],
      silent: false,
      env: {
        ...process.env,
        TRANSFORMERS_CACHE: this.modelCachePath,
        XDG_CACHE_HOME: this.modelCachePath,
        USER_DATA_PATH: path.dirname(this.modelCachePath)
      }
    });
    
    return child;
  }

  protected setupHandlers(process: ChildProcess): void {
    const child = process as ChildProcess;

    child.on('message', (msg: any) => {
      if (msg.type === 'ready') {
        console.log('[EmbedderManager] Received ready signal from child');
        this.embedderReady = true;
      } else if (msg.type === 'init:err') {
        console.error('[EmbedderManager] Embedder init failed:', msg.error);
        this.embedderReady = false;
        // Reject all pending requests
        for (const handler of this.inflight.values()) {
          handler.reject(new Error(msg.error));
        }
        this.inflight.clear();
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

    child.on('error', (err) => {
      console.error('[EmbedderManager] Child error:', err);
      for (const handler of this.inflight.values()) {
        handler.reject(err);
      }
      this.inflight.clear();
    });

    child.on('exit', (code) => {
      if (code !== 0 && code !== null && !this.isRestarting) {
        console.error(`[EmbedderManager] Child exited with code ${code}`);
        // Auto-restart on unexpected exit
        setTimeout(() => this.restart(), 1000);
      }
      this.embedderReady = false;
      for (const handler of this.inflight.values()) {
        handler.reject(new Error('Embedder process exited'));
      }
      this.inflight.clear();
    });

    // Send init message to child
    console.log('[EmbedderManager] Sending init message to child');
    child.send({ type: 'init', model: this.modelName });
  }

  protected async getState(): Promise<EmbedderState> {
    return {
      filesSinceSpawn: this.filesSinceSpawn,
      pendingRequests: Array.from(this.inflight.entries()).map(([id]) => ({
        id,
        chunks: [] // We don't store chunks in flight
      }))
    };
  }

  protected async restoreState(state: EmbedderState): Promise<void> {
    if (state.filesSinceSpawn) {
      this.filesSinceSpawn = state.filesSinceSpawn;
    }
    // Note: We can't restore in-flight requests as they need to be retried
    console.log('[EmbedderManager] State restored, files since spawn:', this.filesSinceSpawn);
  }

  // Check if we should restart based on file count
  async checkAndRestartIfNeeded(): Promise<void> {
    if (this.filesSinceSpawn >= this.maxFilesBeforeRestart) {
      console.log(`[EmbedderManager] Processed ${this.filesSinceSpawn} files, restarting for memory cleanup...`);
      await this.restart();
    }
  }

  // Override to check both memory and file count
  protected async checkMemoryAndRestart(): Promise<void> {
    // Check file count first
    if (this.filesSinceSpawn >= this.maxFilesBeforeRestart) {
      console.log(`[EmbedderManager] File threshold exceeded (${this.filesSinceSpawn}), restarting...`);
      await this.restart();
      return;
    }
    
    // Then check memory
    await super.checkMemoryAndRestart();
  }

  // Wait for embedder to be ready
  async waitForReady(timeout = 60000): Promise<void> {
    const startTime = Date.now();
    while (!this.embedderReady) {
      if (Date.now() - startTime > timeout) {
        throw new Error('Embedder initialization timeout');
      }
      await new Promise(resolve => setTimeout(resolve, 100));
    }
  }

  // Send embed request to child process
  async embed(chunks: string[]): Promise<Float32Array[]> {
    if (!this.embedderReady) {
      await this.waitForReady();
    }

    const id = Math.random().toString(36).substring(7);
    
    return new Promise((resolve, reject) => {
      // Set up timeout
      const timeout = setTimeout(() => {
        this.inflight.delete(id);
        reject(new Error('Embed timeout'));
      }, 30000);

      // Store handler
      this.inflight.set(id, {
        resolve: (vectors) => {
          clearTimeout(timeout);
          this.filesSinceSpawn++;
          resolve(vectors);
        },
        reject: (error) => {
          clearTimeout(timeout);
          reject(error);
        }
      });

      // Send message to child
      const child = this.process as ChildProcess;
      child.send({ type: 'embed', chunks, id });
    });
  }

  // Check if embedder is ready
  isReady(): boolean {
    return this.embedderReady && this.isRunning();
  }

  // Get file processing count
  getFilesSinceSpawn(): number {
    return this.filesSinceSpawn;
  }
}