import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { Worker } from 'node:worker_threads';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

describe('Worker Config Integration', () => {
  let tempDir: string;
  let worker: Worker;

  beforeEach(() => {
    // Create a temporary directory for testing
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'worker-config-test-'));
  });

  afterEach(async () => {
    // Terminate worker if running
    if (worker) {
      await worker.terminate();
    }
    
    // Clean up temporary directory
    if (fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it('should auto-start watching saved folders on init', async () => {
    // Pre-create config with watched folders
    const configPath = path.join(tempDir, 'config.json');
    const config = {
      version: '1.0.0',
      watchedFolders: [tempDir],
      settings: {
        cpuThrottle: 'medium',
        excludePatterns: ['node_modules', '.git']
      },
      lastUpdated: new Date().toISOString()
    };
    fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
    
    // Create a test file to watch
    const testFile = path.join(tempDir, 'test.txt');
    fs.writeFileSync(testFile, 'test content');
    
    // Create worker
    worker = new Worker(path.join(__dirname, '../dist/worker.cjs'));
    
    // Send init message
    const initPromise = new Promise((resolve) => {
      worker.once('message', (msg) => {
        if (msg.type === 'ready') {
          resolve(true);
        }
      });
    });
    
    worker.postMessage({ type: 'init', dbDir: tempDir });
    
    const ready = await initPromise;
    expect(ready).toBe(true);
    
    // Check that folders are being watched
    const foldersPromise = new Promise((resolve) => {
      const id = Math.random().toString(36);
      worker.once('message', (msg) => {
        if (msg.id === id) {
          resolve(msg.payload);
        }
      });
      worker.postMessage({ type: 'getWatchedFolders', id });
    });
    
    const watchedFolders = await foldersPromise;
    expect(watchedFolders).toEqual([tempDir]);
  });

  it('should persist folders when watchStart is called', async () => {
    // Create worker
    worker = new Worker(path.join(__dirname, '../dist/worker.cjs'));
    
    // Initialize
    const initPromise = new Promise((resolve) => {
      worker.once('message', (msg) => {
        if (msg.type === 'ready') {
          resolve(true);
        }
      });
    });
    
    worker.postMessage({ type: 'init', dbDir: tempDir });
    await initPromise;
    
    // Start watching folders
    const folders = ['/test/folder1', '/test/folder2'];
    const watchPromise = new Promise((resolve) => {
      const id = Math.random().toString(36);
      worker.once('message', (msg) => {
        if (msg.id === id) {
          resolve(msg.payload);
        }
      });
      worker.postMessage({ 
        type: 'watchStart', 
        payload: { roots: folders, options: {} },
        id 
      });
    });
    
    await watchPromise;
    
    // Verify config was written
    const configPath = path.join(tempDir, 'config.json');
    expect(fs.existsSync(configPath)).toBe(true);
    
    const savedConfig = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
    expect(savedConfig.watchedFolders).toEqual(folders);
  });

  it('should return empty array when no folders are watched', async () => {
    // Create worker
    worker = new Worker(path.join(__dirname, '../dist/worker.cjs'));
    
    // Initialize
    const initPromise = new Promise((resolve) => {
      worker.once('message', (msg) => {
        if (msg.type === 'ready') {
          resolve(true);
        }
      });
    });
    
    worker.postMessage({ type: 'init', dbDir: tempDir });
    await initPromise;
    
    // Get watched folders
    const foldersPromise = new Promise((resolve) => {
      const id = Math.random().toString(36);
      worker.once('message', (msg) => {
        if (msg.id === id) {
          resolve(msg.payload);
        }
      });
      worker.postMessage({ type: 'getWatchedFolders', id });
    });
    
    const watchedFolders = await foldersPromise;
    expect(watchedFolders).toEqual([]);
  });
});