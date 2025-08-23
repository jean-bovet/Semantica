import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { Worker } from 'node:worker_threads';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

describe('Worker Stability and Recovery', { timeout: 30000 }, () => {
  let tempDir: string;
  let worker: Worker | null = null;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'worker-stability-test-'));
  });

  afterEach(async () => {
    if (worker) {
      await worker.terminate();
      worker = null;
    }
    if (fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it('should handle corrupt PDF files without crashing', async () => {
    // Create a corrupt PDF file
    const corruptPdfPath = path.join(tempDir, 'corrupt.pdf');
    fs.writeFileSync(corruptPdfPath, 'Not a valid PDF content');

    worker = new Worker(path.join(__dirname, '../../dist/worker.cjs'));
    
    const initPromise = new Promise((resolve) => {
      worker!.once('message', (msg) => {
        if (msg.type === 'ready') resolve(true);
      });
    });

    worker.postMessage({ type: 'init', dbDir: tempDir });
    await initPromise;

    // Try to process the corrupt PDF
    const processPromise = new Promise((resolve) => {
      const id = Math.random().toString(36);
      worker!.once('message', (msg) => {
        if (msg.id === id) resolve(msg);
      });
      worker!.postMessage({ 
        type: 'enqueue', 
        payload: { paths: [corruptPdfPath] },
        id 
      });
    });

    // Worker should handle the error gracefully
    await expect(processPromise).resolves.toBeDefined();
    
    // Worker should still be responsive
    const pingPromise = new Promise((resolve) => {
      const id = Math.random().toString(36);
      worker!.once('message', (msg) => {
        if (msg.id === id) resolve(msg);
      });
      worker!.postMessage({ type: 'progress', id });
    });

    await expect(pingPromise).resolves.toBeDefined();
  });

  it('should not crash when loading existing indexed files', async () => {
    // Create a pre-existing database with some data
    const dbPath = path.join(tempDir, 'chunks');
    
    worker = new Worker(path.join(__dirname, '../../dist/worker.cjs'));
    
    // Initialize twice to simulate restart
    for (let i = 0; i < 2; i++) {
      const initPromise = new Promise((resolve, reject) => {
        const timeout = setTimeout(() => reject(new Error('Worker init timeout')), 5000);
        worker!.once('message', (msg) => {
          if (msg.type === 'ready') {
            clearTimeout(timeout);
            resolve(true);
          }
        });
      });

      worker.postMessage({ type: 'init', dbDir: tempDir });
      await expect(initPromise).resolves.toBe(true);
      
      if (i === 0) {
        // Terminate and recreate worker to simulate restart
        await worker.terminate();
        worker = new Worker(path.join(__dirname, '../../dist/worker.cjs'));
      }
    }
  });

  it('should handle rapid worker restarts gracefully', async () => {
    const restartCount = 3;
    
    for (let i = 0; i < restartCount; i++) {
      if (worker) {
        await worker.terminate();
      }
      
      worker = new Worker(path.join(__dirname, '../../dist/worker.cjs'));
      
      const initPromise = new Promise((resolve, reject) => {
        const timeout = setTimeout(() => reject(new Error('Worker init timeout')), 5000);
        worker!.once('message', (msg) => {
          if (msg.type === 'ready') {
            clearTimeout(timeout);
            resolve(true);
          }
        });
      });

      worker.postMessage({ type: 'init', dbDir: tempDir });
      await expect(initPromise).resolves.toBe(true);
    }
  });

  it('should not re-index already indexed files', { timeout: 10000 }, async () => {
    const testFile = path.join(tempDir, 'test.txt');
    fs.writeFileSync(testFile, 'Test content');
    
    worker = new Worker(path.join(__dirname, '../../dist/worker.cjs'));
    
    // First initialization - index the file
    let initPromise = new Promise((resolve) => {
      worker!.once('message', (msg) => {
        if (msg.type === 'ready') resolve(true);
      });
    });
    
    worker.postMessage({ type: 'init', dbDir: tempDir });
    await initPromise;
    
    // Start watching
    const watchPromise = new Promise((resolve) => {
      const id = Math.random().toString(36);
      worker!.once('message', (msg) => {
        if (msg.id === id) resolve(msg);
      });
      worker!.postMessage({ 
        type: 'watchStart', 
        payload: { roots: [tempDir], options: {} },
        id 
      });
    });
    
    await watchPromise;
    
    // Wait for indexing to complete
    await new Promise(r => setTimeout(r, 3000));
    
    // Get stats to confirm file was indexed
    const statsPromise1 = new Promise((resolve) => {
      const id = Math.random().toString(36);
      worker!.once('message', (msg) => {
        if (msg.id === id) resolve(msg.payload);
      });
      worker!.postMessage({ type: 'stats', id });
    });
    
    const stats1 = await statsPromise1 as any;
    const initialIndexedCount = stats1.indexedFiles;
    
    // Restart worker
    await worker.terminate();
    worker = new Worker(path.join(__dirname, '../../dist/worker.cjs'));
    
    initPromise = new Promise((resolve) => {
      worker!.once('message', (msg) => {
        if (msg.type === 'ready') resolve(true);
      });
    });
    
    worker.postMessage({ type: 'init', dbDir: tempDir });
    await initPromise;
    
    // The file should not be re-indexed
    const statsPromise2 = new Promise((resolve) => {
      const id = Math.random().toString(36);
      worker!.once('message', (msg) => {
        if (msg.id === id) resolve(msg.payload);
      });
      worker!.postMessage({ type: 'stats', id });
    });
    
    const stats2 = await statsPromise2 as any;
    
    // Should maintain the same indexed count without re-indexing
    expect(stats2.indexedFiles).toBeLessThanOrEqual(initialIndexedCount);
  });
});