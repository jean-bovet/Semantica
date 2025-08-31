import { Worker } from 'node:worker_threads';
import path from 'node:path';
import { RestartableProcess, ProcessState } from './RestartableProcess';

export class WorkerManager extends RestartableProcess {
  private workerReady = false;
  private initData: any;

  constructor(scriptPath: string, initData: any) {
    super({
      type: 'worker',
      scriptPath,
      memoryThreshold: 800 * 1024 * 1024, // 800MB
      checkInterval: 30000, // 30 seconds
      maxRestarts: 10,
      restartDelay: 1000
    });
    this.initData = initData;
  }

  protected spawn(): Worker {
    const worker = new Worker(this.config.scriptPath);
    this.workerReady = false;
    return worker;
  }

  protected setupHandlers(process: Worker): void {
    const worker = process as Worker;

    worker.on('message', (msg: any) => {
      // Handle ready signal
      if (msg.type === 'ready') {
        this.workerReady = true;
        console.log('Worker ready');
        // Send init data
        worker.postMessage({ type: 'init', ...this.initData });
      }
      // Handle memory response
      else if (msg.type === 'memory' && msg.id) {
        const callback = this.pendingCallbacks.get(msg.id);
        if (callback) {
          this.pendingCallbacks.delete(msg.id);
          callback(msg.payload);
        }
      }
      // Handle state response
      else if (msg.type === 'state' && msg.id) {
        const callback = this.pendingCallbacks.get(msg.id);
        if (callback) {
          this.pendingCallbacks.delete(msg.id);
          callback(msg.payload);
        }
      }
      // Handle other messages with callbacks
      else if (msg.id && this.pendingCallbacks.has(msg.id)) {
        const callback = this.pendingCallbacks.get(msg.id)!;
        this.pendingCallbacks.delete(msg.id);
        callback(msg.payload);
      }
      // Forward other messages to parent
      else {
        this.handleWorkerMessage(msg);
      }
    });

    worker.on('error', (err) => {
      console.error('Worker error:', err);
      // Clear all pending callbacks
      for (const callback of this.pendingCallbacks.values()) {
        callback({ error: err.message });
      }
      this.pendingCallbacks.clear();
    });

    worker.on('exit', (code) => {
      if (code !== 0 && code !== null && !this.isRestarting) {
        console.error(`Worker stopped with exit code ${code}`);
        // Auto-restart on unexpected exit
        setTimeout(() => this.restart(), 1000);
      }
    });
  }

  protected async getState(): Promise<ProcessState> {
    if (!this.process || !this.workerReady) {
      return {};
    }

    try {
      const state = await this.sendMessage({ type: 'getState' });
      return state || {};
    } catch (error) {
      console.error('Failed to get worker state:', error);
      return {};
    }
  }

  protected async restoreState(state: ProcessState): Promise<void> {
    if (!this.process || !this.workerReady) {
      return;
    }

    try {
      await this.sendMessage({ type: 'restoreState', state });
      console.log('Worker state restored');
    } catch (error) {
      console.error('Failed to restore worker state:', error);
    }
  }

  // Override to wait for worker ready
  async sendMessage(message: any): Promise<any> {
    // Wait for worker to be ready
    if (!this.workerReady) {
      await this.waitForReady();
    }
    return super.sendMessage(message);
  }

  private async waitForReady(timeout = 10000): Promise<void> {
    const startTime = Date.now();
    while (!this.workerReady) {
      if (Date.now() - startTime > timeout) {
        throw new Error('Worker initialization timeout');
      }
      await new Promise(resolve => setTimeout(resolve, 100));
    }
  }

  // Method to be overridden by subclasses to handle worker messages
  protected handleWorkerMessage(msg: any): void {
    // Override in subclass to handle specific message types
  }

  // Convenience method to check if worker is ready
  isReady(): boolean {
    return this.workerReady && this.isRunning();
  }
}