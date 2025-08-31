import { Worker } from 'node:worker_threads';
import { ChildProcess, fork } from 'node:child_process';
import path from 'node:path';

export interface RestartableConfig {
  type: 'worker' | 'child';
  scriptPath: string;
  maxRestarts?: number;
  restartDelay?: number;
  memoryThreshold?: number;
  checkInterval?: number;
}

export interface ProcessState {
  [key: string]: any;
}

export abstract class RestartableProcess {
  protected process: Worker | ChildProcess | null = null;
  protected isRestarting = false;
  protected restartCount = 0;
  protected memoryCheckInterval: NodeJS.Timeout | null = null;
  protected pendingCallbacks = new Map<string, (data: any) => void>();
  protected lastState: ProcessState | null = null;

  constructor(protected config: RestartableConfig) {
    this.config = {
      maxRestarts: 10,
      restartDelay: 1000,
      memoryThreshold: 800 * 1024 * 1024, // 800MB default
      checkInterval: 30000, // 30 seconds
      ...config
    };
  }

  protected abstract spawn(): Worker | ChildProcess;
  protected abstract setupHandlers(process: Worker | ChildProcess): void;
  protected abstract getState(): Promise<ProcessState>;
  protected abstract restoreState(state: ProcessState): Promise<void>;

  async start(): Promise<void> {
    if (this.process) {
      console.log('Process already running');
      return;
    }

    this.process = this.spawn();
    this.setupHandlers(this.process);
    this.startMemoryMonitoring();

    // Restore state if we have it (from a restart)
    if (this.lastState) {
      await this.restoreState(this.lastState);
      this.lastState = null;
    }
  }

  protected startMemoryMonitoring(): void {
    if (!this.config.memoryThreshold || !this.config.checkInterval) {
      return;
    }

    this.stopMemoryMonitoring();
    this.memoryCheckInterval = setInterval(() => {
      this.checkMemoryAndRestart();
    }, this.config.checkInterval);
  }

  protected stopMemoryMonitoring(): void {
    if (this.memoryCheckInterval) {
      clearInterval(this.memoryCheckInterval);
      this.memoryCheckInterval = null;
    }
  }

  protected async checkMemoryAndRestart(): Promise<void> {
    if (!this.process || this.isRestarting) {
      return;
    }

    const memoryUsage = await this.getMemoryUsage();
    if (memoryUsage > this.config.memoryThreshold!) {
      console.log(`Memory threshold exceeded (${Math.round(memoryUsage / 1024 / 1024)}MB), restarting...`);
      await this.restart();
    }
  }

  protected async getMemoryUsage(): Promise<number> {
    if (!this.process) return 0;

    if (this.config.type === 'worker') {
      // For worker threads, we need to get memory from inside the worker
      return new Promise((resolve) => {
        const id = Math.random().toString(36).substring(7);
        this.pendingCallbacks.set(id, (data) => {
          resolve(data.rss || 0);
        });
        (this.process as Worker).postMessage({ type: 'getMemory', id });
        
        // Timeout fallback
        setTimeout(() => {
          if (this.pendingCallbacks.has(id)) {
            this.pendingCallbacks.delete(id);
            resolve(0);
          }
        }, 1000);
      });
    } else {
      // For child processes, we can't easily get memory usage
      // Would need platform-specific code or external tools
      return 0;
    }
  }

  async restart(): Promise<void> {
    if (this.isRestarting) {
      console.log('Already restarting, skipping...');
      return;
    }

    if (this.restartCount >= this.config.maxRestarts!) {
      console.error('Max restarts reached, not restarting');
      return;
    }

    this.isRestarting = true;
    this.restartCount++;

    console.log(`Restarting process (attempt ${this.restartCount}/${this.config.maxRestarts})...`);

    try {
      // Save current state
      this.lastState = await this.getState();
      
      // Gracefully shutdown
      await this.shutdown();
      
      // Wait before restarting
      await new Promise(resolve => setTimeout(resolve, this.config.restartDelay));
      
      // Start fresh
      await this.start();
      
      console.log('Process restarted successfully');
    } catch (error) {
      console.error('Failed to restart process:', error);
    } finally {
      this.isRestarting = false;
    }
  }

  async shutdown(): Promise<void> {
    this.stopMemoryMonitoring();

    if (!this.process) {
      return;
    }

    try {
      // Send shutdown signal
      if (this.config.type === 'worker') {
        const worker = this.process as Worker;
        worker.postMessage({ type: 'shutdown' });
        await new Promise(resolve => setTimeout(resolve, 500));
        await worker.terminate();
      } else {
        const child = this.process as ChildProcess;
        child.send({ type: 'shutdown' });
        await new Promise(resolve => setTimeout(resolve, 500));
        child.kill('SIGTERM');
        await new Promise(resolve => setTimeout(resolve, 100));
        if (!child.killed) {
          child.kill('SIGKILL');
        }
      }
    } catch (error) {
      console.error('Error during shutdown:', error);
    } finally {
      this.process = null;
      this.pendingCallbacks.clear();
    }
  }

  isRunning(): boolean {
    return this.process !== null && !this.isRestarting;
  }

  sendMessage(message: any): Promise<any> {
    return new Promise((resolve, reject) => {
      if (!this.process) {
        reject(new Error('Process not running'));
        return;
      }

      const id = Math.random().toString(36).substring(7);
      const timeout = setTimeout(() => {
        if (this.pendingCallbacks.has(id)) {
          this.pendingCallbacks.delete(id);
          reject(new Error('Message timeout'));
        }
      }, 30000);

      this.pendingCallbacks.set(id, (data) => {
        clearTimeout(timeout);
        resolve(data);
      });

      message.id = id;
      
      if (this.config.type === 'worker') {
        (this.process as Worker).postMessage(message);
      } else {
        (this.process as ChildProcess).send(message);
      }
    });
  }
}