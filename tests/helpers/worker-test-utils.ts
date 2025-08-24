import { Worker } from 'node:worker_threads';
import path from 'node:path';

export class TestWorker {
  private worker: Worker | null = null;
  private messageHandlers = new Map<string, (msg: any) => void>();
  private progressCallbacks: Array<(progress: any) => void> = [];

  async init(dbDir: string): Promise<void> {
    this.worker = new Worker(path.join(__dirname, '../../dist/worker.cjs'));
    
    this.worker.on('message', (msg) => {
      if (msg.type === 'progress') {
        this.progressCallbacks.forEach(cb => cb(msg.payload));
      }
      if (msg.id && this.messageHandlers.has(msg.id)) {
        const handler = this.messageHandlers.get(msg.id)!;
        this.messageHandlers.delete(msg.id);
        handler(msg);
      }
    });

    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('Worker init timeout')), 10000);
      this.worker!.once('message', (msg) => {
        if (msg.type === 'ready') {
          clearTimeout(timeout);
          resolve();
        }
      });
      this.worker!.postMessage({ type: 'init', dbDir });
    });
  }

  async sendMessage(type: string, payload: any = {}): Promise<any> {
    if (!this.worker) throw new Error('Worker not initialized');
    
    return new Promise((resolve, reject) => {
      const id = Math.random().toString(36);
      const timeout = setTimeout(() => {
        this.messageHandlers.delete(id);
        reject(new Error(`Message timeout: ${type}`));
      }, 10000);
      
      this.messageHandlers.set(id, (msg) => {
        clearTimeout(timeout);
        if (msg.error) {
          reject(new Error(msg.error));
        } else {
          resolve(msg.payload);
        }
      });
      
      this.worker!.postMessage({ type, payload, id });
    });
  }

  onProgress(callback: (progress: any) => void): () => void {
    this.progressCallbacks.push(callback);
    return () => {
      const idx = this.progressCallbacks.indexOf(callback);
      if (idx >= 0) this.progressCallbacks.splice(idx, 1);
    };
  }

  async waitForIndexing(expectedFiles: number, maxWait: number = 10000): Promise<void> {
    const startTime = Date.now();
    
    return new Promise((resolve, reject) => {
      const checkInterval = setInterval(async () => {
        try {
          const stats = await this.sendMessage('stats');
          if (stats.indexedFiles >= expectedFiles) {
            clearInterval(checkInterval);
            resolve();
          } else if (Date.now() - startTime > maxWait) {
            clearInterval(checkInterval);
            reject(new Error(`Indexing timeout: expected ${expectedFiles} files, got ${stats.indexedFiles}`));
          }
        } catch (e) {
          clearInterval(checkInterval);
          reject(e);
        }
      }, 500);
    });
  }

  async waitForProgress(condition: (progress: any) => boolean, maxWait: number = 10000): Promise<void> {
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        cleanup();
        reject(new Error('Progress wait timeout'));
      }, maxWait);
      
      const cleanup = this.onProgress((progress) => {
        if (condition(progress)) {
          clearTimeout(timeout);
          cleanup();
          resolve();
        }
      });
    });
  }

  async terminate(): Promise<void> {
    if (this.worker) {
      await this.worker.terminate();
      this.worker = null;
    }
  }

  async watchStart(roots: string[], options: any = {}): Promise<any> {
    return this.sendMessage('watchStart', { roots, options });
  }

  async enqueue(paths: string[]): Promise<any> {
    return this.sendMessage('enqueue', { paths });
  }

  async search(query: string, k: number = 10): Promise<any> {
    return this.sendMessage('search', { q: query, k });
  }

  async getStats(): Promise<any> {
    return this.sendMessage('stats');
  }

  async getProgress(): Promise<any> {
    return this.sendMessage('progress');
  }

  async getWatchedFolders(): Promise<string[]> {
    return this.sendMessage('getWatchedFolders');
  }
}