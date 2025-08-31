import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { Worker } from 'node:worker_threads';
import path from 'node:path';
import fs from 'node:fs/promises';
import os from 'node:os';

/**
 * Integration tests for worker restart functionality
 * Tests the complete flow of worker state preservation and restoration
 */

describe('Worker Restart Integration', () => {
  let worker: Worker | null = null;
  let dbDir: string;
  let userDataPath: string;
  const pendingCallbacks = new Map<string, (data: any) => void>();

  async function sendMessage(worker: Worker, type: string, payload: any = {}): Promise<any> {
    return new Promise((resolve, reject) => {
      const id = Math.random().toString(36).substring(7);
      const timeout = setTimeout(() => {
        pendingCallbacks.delete(id);
        reject(new Error(`Message timeout for ${type}`));
      }, 5000);

      pendingCallbacks.set(id, (data) => {
        clearTimeout(timeout);
        resolve(data);
      });

      worker.postMessage({ type, payload, id });
    });
  }

  beforeEach(async () => {
    // Setup test directories
    const tmpDir = os.tmpdir();
    dbDir = path.join(tmpDir, 'test-worker-db-' + Date.now());
    userDataPath = path.join(tmpDir, 'test-worker-data-' + Date.now());
    
    await fs.mkdir(dbDir, { recursive: true });
    await fs.mkdir(userDataPath, { recursive: true });
  });

  afterEach(async () => {
    // Cleanup worker
    if (worker) {
      worker.postMessage({ type: 'shutdown' });
      await new Promise(r => setTimeout(r, 100));
      worker.terminate();
      worker = null;
    }

    // Cleanup directories
    try {
      await fs.rm(dbDir, { recursive: true, force: true });
      await fs.rm(userDataPath, { recursive: true, force: true });
    } catch (e) {
      // Ignore cleanup errors
    }

    pendingCallbacks.clear();
  });

  describe('State Preservation During Restart', () => {
    it('should preserve file processing queue during restart', async () => {
      // Skip if worker file doesn't exist
      const workerPath = path.join(__dirname, '../../dist/worker.cjs');
      try {
        await fs.access(workerPath);
      } catch {
        console.log('Skipping integration test - worker not built');
        return;
      }

      // Create first worker instance
      worker = new Worker(workerPath);
      
      // Setup message handler
      worker.on('message', (msg: any) => {
        if (msg.id && pendingCallbacks.has(msg.id)) {
          const callback = pendingCallbacks.get(msg.id)!;
          pendingCallbacks.delete(msg.id);
          callback(msg.payload);
        }
      });

      // Wait for ready
      await new Promise<void>((resolve) => {
        worker!.once('message', (msg) => {
          if (msg.type === 'ready') resolve();
        });
        worker!.postMessage({ type: 'init', dbDir, userDataPath });
      });

      // Add files to queue
      await sendMessage(worker, 'enqueue', { 
        paths: ['file1.txt', 'file2.txt', 'file3.txt'] 
      });

      // Get current state
      const state = await sendMessage(worker, 'getState');
      expect(state.queuedFiles).toBeDefined();
      
      // Simulate restart by terminating and creating new worker
      worker.postMessage({ type: 'shutdown' });
      await new Promise(r => setTimeout(r, 100));
      await worker.terminate();

      // Create new worker instance
      worker = new Worker(workerPath);
      worker.on('message', (msg: any) => {
        if (msg.id && pendingCallbacks.has(msg.id)) {
          const callback = pendingCallbacks.get(msg.id)!;
          pendingCallbacks.delete(msg.id);
          callback(msg.payload);
        }
      });

      // Wait for ready
      await new Promise<void>((resolve) => {
        worker!.once('message', (msg) => {
          if (msg.type === 'ready') resolve();
        });
        worker!.postMessage({ type: 'init', dbDir, userDataPath });
      });

      // Restore state
      await sendMessage(worker, 'restoreState', state);

      // Verify state was restored
      const newState = await sendMessage(worker, 'getState');
      expect(newState.queuedFiles).toContain('file1.txt');
      expect(newState.queuedFiles).toContain('file2.txt');
      expect(newState.queuedFiles).toContain('file3.txt');
    });

    it('should preserve pause state during restart', async () => {
      const workerPath = path.join(__dirname, '../../dist/worker.cjs');
      try {
        await fs.access(workerPath);
      } catch {
        console.log('Skipping integration test - worker not built');
        return;
      }

      // Create worker
      worker = new Worker(workerPath);
      worker.on('message', (msg: any) => {
        if (msg.id && pendingCallbacks.has(msg.id)) {
          const callback = pendingCallbacks.get(msg.id)!;
          pendingCallbacks.delete(msg.id);
          callback(msg.payload);
        }
      });

      // Initialize
      await new Promise<void>((resolve) => {
        worker!.once('message', (msg) => {
          if (msg.type === 'ready') resolve();
        });
        worker!.postMessage({ type: 'init', dbDir, userDataPath });
      });

      // Pause the worker
      await sendMessage(worker, 'pause');

      // Get state
      const state = await sendMessage(worker, 'getState');
      expect(state.paused).toBe(true);

      // Simulate restart
      worker.postMessage({ type: 'shutdown' });
      await new Promise(r => setTimeout(r, 100));
      await worker.terminate();

      // Create new worker
      worker = new Worker(workerPath);
      worker.on('message', (msg: any) => {
        if (msg.id && pendingCallbacks.has(msg.id)) {
          const callback = pendingCallbacks.get(msg.id)!;
          pendingCallbacks.delete(msg.id);
          callback(msg.payload);
        }
      });

      await new Promise<void>((resolve) => {
        worker!.once('message', (msg) => {
          if (msg.type === 'ready') resolve();
        });
        worker!.postMessage({ type: 'init', dbDir, userDataPath });
      });

      // Restore state
      await sendMessage(worker, 'restoreState', state);

      // Verify pause state preserved
      const newState = await sendMessage(worker, 'getState');
      expect(newState.paused).toBe(true);
    });
  });

  describe('Graceful Shutdown', () => {
    it('should complete graceful shutdown within timeout', async () => {
      const workerPath = path.join(__dirname, '../../dist/worker.cjs');
      try {
        await fs.access(workerPath);
      } catch {
        console.log('Skipping integration test - worker not built');
        return;
      }

      worker = new Worker(workerPath);
      worker.on('message', (msg: any) => {
        if (msg.id && pendingCallbacks.has(msg.id)) {
          const callback = pendingCallbacks.get(msg.id)!;
          pendingCallbacks.delete(msg.id);
          callback(msg.payload);
        }
      });

      await new Promise<void>((resolve) => {
        worker!.once('message', (msg) => {
          if (msg.type === 'ready') resolve();
        });
        worker!.postMessage({ type: 'init', dbDir, userDataPath });
      });

      // Send shutdown and measure time
      const startTime = Date.now();
      worker.postMessage({ type: 'shutdown' });
      
      // Wait for worker to exit
      await new Promise<void>((resolve) => {
        worker!.once('exit', () => resolve());
      });

      const shutdownTime = Date.now() - startTime;
      
      // Should shutdown within reasonable time (5 seconds max)
      expect(shutdownTime).toBeLessThan(5500);
      
      worker = null; // Already terminated
    });
  });

  describe('Memory Usage Tracking', () => {
    it('should return memory usage information', async () => {
      const workerPath = path.join(__dirname, '../../dist/worker.cjs');
      try {
        await fs.access(workerPath);
      } catch {
        console.log('Skipping integration test - worker not built');
        return;
      }

      worker = new Worker(workerPath);
      worker.on('message', (msg: any) => {
        if (msg.type === 'memory' && msg.id && pendingCallbacks.has(msg.id)) {
          const callback = pendingCallbacks.get(msg.id)!;
          pendingCallbacks.delete(msg.id);
          callback(msg.payload);
        } else if (msg.id && pendingCallbacks.has(msg.id)) {
          const callback = pendingCallbacks.get(msg.id)!;
          pendingCallbacks.delete(msg.id);
          callback(msg.payload);
        }
      });

      await new Promise<void>((resolve) => {
        worker!.once('message', (msg) => {
          if (msg.type === 'ready') resolve();
        });
        worker!.postMessage({ type: 'init', dbDir, userDataPath });
      });

      // Request memory usage
      const memoryUsage = await sendMessage(worker, 'getMemory');
      
      expect(memoryUsage).toBeDefined();
      expect(memoryUsage.rss).toBeGreaterThan(0);
      expect(memoryUsage.heapUsed).toBeGreaterThan(0);
      expect(memoryUsage.heapTotal).toBeGreaterThan(0);
    });
  });

  describe('Metrics Collection', () => {
    it('should return metrics data', async () => {
      const workerPath = path.join(__dirname, '../../dist/worker.cjs');
      try {
        await fs.access(workerPath);
      } catch {
        console.log('Skipping integration test - worker not built');
        return;
      }

      worker = new Worker(workerPath);
      worker.on('message', (msg: any) => {
        if (msg.id && pendingCallbacks.has(msg.id)) {
          const callback = pendingCallbacks.get(msg.id)!;
          pendingCallbacks.delete(msg.id);
          callback(msg.payload);
        }
      });

      await new Promise<void>((resolve) => {
        worker!.once('message', (msg) => {
          if (msg.type === 'ready') resolve();
        });
        worker!.postMessage({ type: 'init', dbDir, userDataPath });
      });

      // Get metrics
      const metrics = await sendMessage(worker, 'getMetrics');
      
      expect(metrics).toBeDefined();
      expect(metrics.filesProcessed).toBeDefined();
      expect(metrics.bytesProcessed).toBeDefined();
      expect(metrics.chunksCreated).toBeDefined();
      expect(metrics.embeddingsCreated).toBeDefined();
    });

    it('should return formatted metrics summary', async () => {
      const workerPath = path.join(__dirname, '../../dist/worker.cjs');
      try {
        await fs.access(workerPath);
      } catch {
        console.log('Skipping integration test - worker not built');
        return;
      }

      worker = new Worker(workerPath);
      worker.on('message', (msg: any) => {
        if (msg.id && pendingCallbacks.has(msg.id)) {
          const callback = pendingCallbacks.get(msg.id)!;
          pendingCallbacks.delete(msg.id);
          callback(msg.payload);
        }
      });

      await new Promise<void>((resolve) => {
        worker!.once('message', (msg) => {
          if (msg.type === 'ready') resolve();
        });
        worker!.postMessage({ type: 'init', dbDir, userDataPath });
      });

      // Get metrics summary
      const summary = await sendMessage(worker, 'getMetricsSummary');
      
      expect(summary).toBeDefined();
      expect(typeof summary).toBe('string');
      expect(summary).toContain('Processing Metrics');
      expect(summary).toContain('Files:');
      expect(summary).toContain('Data:');
    });
  });
});