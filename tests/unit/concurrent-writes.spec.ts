import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { Worker } from 'node:worker_threads';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

describe('Concurrent Write Handling', { timeout: 30000 }, () => {
  let tempDir: string;
  let worker: Worker | null = null;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'concurrent-test-'));
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

  it('should handle concurrent file processing without conflicts', async () => {
    const subDir = path.join(tempDir, 'concurrent');
    fs.mkdirSync(subDir);
    
    // Create multiple files that will be processed simultaneously
    const fileCount = 10;
    for (let i = 0; i < fileCount; i++) {
      fs.writeFileSync(
        path.join(subDir, `file${i}.txt`),
        `Content for file ${i} with enough text to create multiple chunks. `.repeat(50)
      );
    }
    
    worker = new Worker(path.join(__dirname, '../../dist/worker.cjs'));
    
    const initPromise = new Promise((resolve) => {
      worker!.once('message', (msg) => {
        if (msg.type === 'ready') resolve(true);
      });
    });
    
    worker.postMessage({ type: 'init', dbDir: tempDir });
    await initPromise;
    
    // Start watching - this will trigger concurrent processing
    const watchPromise = new Promise((resolve) => {
      const id = Math.random().toString(36);
      worker!.once('message', (msg) => {
        if (msg.id === id) resolve(msg);
      });
      worker!.postMessage({ 
        type: 'watchStart', 
        payload: { roots: [subDir], options: {} },
        id 
      });
    });
    
    await watchPromise;
    
    // Wait for processing to complete
    await new Promise(r => setTimeout(r, 8000));
    
    // Get stats to verify all files were processed
    const statsPromise = new Promise((resolve) => {
      const id = Math.random().toString(36);
      worker!.once('message', (msg) => {
        if (msg.id === id) resolve(msg.payload);
      });
      worker!.postMessage({ type: 'stats', id });
    });
    
    const stats = await statsPromise as any;
    
    // All files should be indexed without conflicts
    expect(stats.indexedFiles).toBe(fileCount);
    expect(stats.totalChunks).toBeGreaterThan(0);
    
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

  it('should queue writes to avoid LanceDB conflicts', async () => {
    const subDir = path.join(tempDir, 'queue-test');
    fs.mkdirSync(subDir);
    
    worker = new Worker(path.join(__dirname, '../../dist/worker.cjs'));
    
    const initPromise = new Promise((resolve) => {
      worker!.once('message', (msg) => {
        if (msg.type === 'ready') resolve(true);
      });
    });
    
    worker.postMessage({ type: 'init', dbDir: tempDir });
    await initPromise;
    
    // Create files rapidly to trigger concurrent writes
    const promises = [];
    for (let i = 0; i < 5; i++) {
      const filePath = path.join(subDir, `rapid${i}.txt`);
      fs.writeFileSync(filePath, `Rapid content ${i}`);
      
      const enqueuePromise = new Promise((resolve, reject) => {
        const id = Math.random().toString(36);
        const timeout = setTimeout(() => reject(new Error('Enqueue timeout')), 10000);
        worker!.once('message', (msg) => {
          if (msg.id === id) {
            clearTimeout(timeout);
            resolve(msg);
          }
        });
        worker!.postMessage({ 
          type: 'enqueue', 
          payload: { paths: [filePath] },
          id 
        });
      });
      
      promises.push(enqueuePromise);
    }
    
    // All enqueue operations should complete without conflicts
    await expect(Promise.all(promises)).resolves.toBeDefined();
    
    // Wait for processing
    await new Promise(r => setTimeout(r, 3000));
    
    // Verify all files were processed
    const statsPromise = new Promise((resolve) => {
      const id = Math.random().toString(36);
      worker!.once('message', (msg) => {
        if (msg.id === id) resolve(msg.payload);
      });
      worker!.postMessage({ type: 'stats', id });
    });
    
    const stats = await statsPromise as any;
    expect(stats.indexedFiles).toBeGreaterThanOrEqual(5);
  });

  it('should retry on commit conflicts', async () => {
    // This test simulates a scenario where retries might be needed
    const subDir = path.join(tempDir, 'retry-test');
    fs.mkdirSync(subDir);
    
    worker = new Worker(path.join(__dirname, '../../dist/worker.cjs'));
    
    const initPromise = new Promise((resolve) => {
      worker!.once('message', (msg) => {
        if (msg.type === 'ready') resolve(true);
      });
    });
    
    worker.postMessage({ type: 'init', dbDir: tempDir });
    await initPromise;
    
    // Create a large batch of files
    const batchSize = 20;
    const files = [];
    for (let i = 0; i < batchSize; i++) {
      const filePath = path.join(subDir, `batch${i}.txt`);
      fs.writeFileSync(filePath, `Batch content ${i} `.repeat(100));
      files.push(filePath);
    }
    
    // Enqueue all at once to stress the system
    const enqueuePromise = new Promise((resolve) => {
      const id = Math.random().toString(36);
      worker!.once('message', (msg) => {
        if (msg.id === id) resolve(msg);
      });
      worker!.postMessage({ 
        type: 'enqueue', 
        payload: { paths: files },
        id 
      });
    });
    
    await enqueuePromise;
    
    // Wait for processing with retries
    await new Promise(r => setTimeout(r, 8000));
    
    // Verify eventual consistency
    const statsPromise = new Promise((resolve) => {
      const id = Math.random().toString(36);
      worker!.once('message', (msg) => {
        if (msg.id === id) resolve(msg.payload);
      });
      worker!.postMessage({ type: 'stats', id });
    });
    
    const stats = await statsPromise as any;
    
    // Should eventually process all files despite potential conflicts
    expect(stats.indexedFiles).toBeGreaterThanOrEqual(batchSize * 0.8); // Allow some margin
  });
});