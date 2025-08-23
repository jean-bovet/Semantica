import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { Worker } from 'node:worker_threads';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

describe('Simple Worker Tests', { timeout: 20000 }, () => {
  let tempDir: string;
  let worker: Worker | null = null;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'simple-worker-test-'));
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

  it('should initialize worker successfully', async () => {
    worker = new Worker(path.join(__dirname, '../../dist/worker.cjs'));
    
    const initPromise = new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('Init timeout')), 5000);
      worker!.once('message', (msg) => {
        if (msg.type === 'ready') {
          clearTimeout(timeout);
          resolve(true);
        }
      });
    });

    worker.postMessage({ type: 'init', dbDir: tempDir });
    await expect(initPromise).resolves.toBe(true);
  });

  it('should return stats', async () => {
    worker = new Worker(path.join(__dirname, '../../dist/worker.cjs'));
    
    // Initialize
    const initPromise = new Promise((resolve) => {
      worker!.once('message', (msg) => {
        if (msg.type === 'ready') resolve(true);
      });
    });
    
    worker.postMessage({ type: 'init', dbDir: tempDir });
    await initPromise;
    
    // Get stats
    const statsPromise = new Promise((resolve, reject) => {
      const id = Math.random().toString(36);
      const timeout = setTimeout(() => reject(new Error('Stats timeout')), 5000);
      worker!.once('message', (msg) => {
        if (msg.id === id) {
          clearTimeout(timeout);
          resolve(msg.payload);
        }
      });
      worker!.postMessage({ type: 'stats', id });
    });
    
    const stats = await statsPromise as any;
    expect(stats).toBeDefined();
    expect(stats.totalChunks).toBeDefined();
    expect(stats.indexedFiles).toBeDefined();
  });

  it('should handle text file indexing', async () => {
    const testFile = path.join(tempDir, 'test.txt');
    fs.writeFileSync(testFile, 'Test content for indexing');
    
    worker = new Worker(path.join(__dirname, '../../dist/worker.cjs'));
    
    // Initialize
    const initPromise = new Promise((resolve) => {
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
    
    // Wait for indexing
    await new Promise(r => setTimeout(r, 3000));
    
    // Check stats
    const statsPromise = new Promise((resolve) => {
      const id = Math.random().toString(36);
      worker!.once('message', (msg) => {
        if (msg.id === id) resolve(msg.payload);
      });
      worker!.postMessage({ type: 'stats', id });
    });
    
    const stats = await statsPromise as any;
    expect(stats.indexedFiles).toBeGreaterThan(0);
  });

  it('should persist config', async () => {
    worker = new Worker(path.join(__dirname, '../../dist/worker.cjs'));
    
    // Initialize
    const initPromise = new Promise((resolve) => {
      worker!.once('message', (msg) => {
        if (msg.type === 'ready') resolve(true);
      });
    });
    
    worker.postMessage({ type: 'init', dbDir: tempDir });
    await initPromise;
    
    // Set watched folders
    const folders = ['/test/folder1', '/test/folder2'];
    const watchPromise = new Promise((resolve) => {
      const id = Math.random().toString(36);
      worker!.once('message', (msg) => {
        if (msg.id === id) resolve(msg);
      });
      worker!.postMessage({ 
        type: 'watchStart', 
        payload: { roots: folders, options: {} },
        id 
      });
    });
    
    await watchPromise;
    
    // Check config file was created
    const configPath = path.join(tempDir, 'config.json');
    expect(fs.existsSync(configPath)).toBe(true);
    
    const config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
    expect(config.watchedFolders).toEqual(folders);
  });

  it('should handle search queries', async () => {
    worker = new Worker(path.join(__dirname, '../../dist/worker.cjs'));
    
    // Initialize
    const initPromise = new Promise((resolve) => {
      worker!.once('message', (msg) => {
        if (msg.type === 'ready') resolve(true);
      });
    });
    
    worker.postMessage({ type: 'init', dbDir: tempDir });
    await initPromise;
    
    // Perform search
    const searchPromise = new Promise((resolve) => {
      const id = Math.random().toString(36);
      worker!.once('message', (msg) => {
        if (msg.id === id) resolve(msg.payload);
      });
      worker!.postMessage({ 
        type: 'search', 
        payload: { q: 'test query', k: 10 },
        id 
      });
    });
    
    const results = await searchPromise;
    expect(results).toBeDefined();
    expect(Array.isArray(results)).toBe(true);
  });
});