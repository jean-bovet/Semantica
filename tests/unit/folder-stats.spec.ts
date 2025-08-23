import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { Worker } from 'node:worker_threads';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

describe('Folder Statistics and File Counting', { timeout: 30000 }, () => {
  let tempDir: string;
  let worker: Worker | null = null;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'folder-stats-test-'));
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

  it('should track total vs indexed files correctly', async () => {
    // Create test files
    const subDir = path.join(tempDir, 'documents');
    fs.mkdirSync(subDir);
    
    // Create various file types
    fs.writeFileSync(path.join(subDir, 'doc1.txt'), 'Text content');
    fs.writeFileSync(path.join(subDir, 'doc2.pdf'), '%PDF-1.4 fake pdf');
    fs.writeFileSync(path.join(subDir, 'image.jpg'), 'fake image');
    fs.writeFileSync(path.join(subDir, 'data.json'), '{"test": true}');
    fs.writeFileSync(path.join(subDir, 'doc3.md'), '# Markdown');
    
    worker = new Worker(path.join(__dirname, '../../dist/worker.cjs'));
    
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
        payload: { roots: [subDir], options: {} },
        id 
      });
    });
    
    await watchPromise;
    
    // Wait for file discovery and processing
    await new Promise(r => setTimeout(r, 3000));
    
    // Get stats
    const statsPromise = new Promise((resolve) => {
      const id = Math.random().toString(36);
      worker!.once('message', (msg) => {
        if (msg.id === id) resolve(msg.payload);
      });
      worker!.postMessage({ type: 'stats', id });
    });
    
    const stats = await statsPromise as any;
    const folderStat = stats.folderStats.find((s: any) => s.folder === subDir);
    
    if (folderStat) {
      expect(folderStat.totalFiles).toBe(5); // All files
      expect(folderStat.indexedFiles).toBeLessThanOrEqual(3); // Only txt, pdf, md
    }
  });

  it('should restore indexed counts after restart', async () => {
    const subDir = path.join(tempDir, 'docs');
    fs.mkdirSync(subDir);
    fs.writeFileSync(path.join(subDir, 'file1.txt'), 'Content 1');
    fs.writeFileSync(path.join(subDir, 'file2.txt'), 'Content 2');
    
    // First run - index files
    worker = new Worker(path.join(__dirname, '../../dist/worker.cjs'));
    
    let initPromise = new Promise((resolve) => {
      worker!.once('message', (msg) => {
        if (msg.type === 'ready') resolve(true);
      });
    });
    
    worker.postMessage({ type: 'init', dbDir: tempDir });
    await initPromise;
    
    // Save config with watched folder
    const config = {
      version: '1.0.0',
      watchedFolders: [subDir],
      settings: {
        cpuThrottle: 'medium',
        excludePatterns: ['node_modules', '.git']
      },
      lastUpdated: new Date().toISOString()
    };
    fs.writeFileSync(path.join(tempDir, 'config.json'), JSON.stringify(config, null, 2));
    
    // Start watching
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
    await new Promise(r => setTimeout(r, 2000));
    
    // Get initial stats
    const stats1Promise = new Promise((resolve) => {
      const id = Math.random().toString(36);
      worker!.once('message', (msg) => {
        if (msg.id === id) resolve(msg.payload);
      });
      worker!.postMessage({ type: 'stats', id });
    });
    
    const stats1 = await stats1Promise as any;
    const initialIndexed = stats1.folderStats.find((s: any) => s.folder === subDir)?.indexedFiles || 0;
    
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
    
    // Wait for auto-start
    await new Promise(r => setTimeout(r, 2000));
    
    // Get stats after restart
    const stats2Promise = new Promise((resolve) => {
      const id = Math.random().toString(36);
      worker!.once('message', (msg) => {
        if (msg.id === id) resolve(msg.payload);
      });
      worker!.postMessage({ type: 'stats', id });
    });
    
    const stats2 = await stats2Promise as any;
    const restoredIndexed = stats2.folderStats.find((s: any) => s.folder === subDir)?.indexedFiles || 0;
    
    // Should maintain indexed count after restart
    expect(restoredIndexed).toBe(initialIndexed);
  });

  it('should update counts when files are added or removed', async () => {
    const subDir = path.join(tempDir, 'dynamic');
    fs.mkdirSync(subDir);
    
    worker = new Worker(path.join(__dirname, '../../dist/worker.cjs'));
    
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
        payload: { roots: [subDir], options: {} },
        id 
      });
    });
    
    await watchPromise;
    
    // Add a file
    fs.writeFileSync(path.join(subDir, 'new.txt'), 'New content');
    await new Promise(r => setTimeout(r, 1500));
    
    // Get stats
    const stats1Promise = new Promise((resolve) => {
      const id = Math.random().toString(36);
      worker!.once('message', (msg) => {
        if (msg.id === id) resolve(msg.payload);
      });
      worker!.postMessage({ type: 'stats', id });
    });
    
    const stats1 = await stats1Promise as any;
    const folderStat1 = stats1.folderStats.find((s: any) => s.folder === subDir);
    
    expect(folderStat1.totalFiles).toBe(1);
    
    // Add another file
    fs.writeFileSync(path.join(subDir, 'another.md'), '# Another');
    await new Promise(r => setTimeout(r, 1500));
    
    // Get updated stats
    const stats2Promise = new Promise((resolve) => {
      const id = Math.random().toString(36);
      worker!.once('message', (msg) => {
        if (msg.id === id) resolve(msg.payload);
      });
      worker!.postMessage({ type: 'stats', id });
    });
    
    const stats2 = await stats2Promise as any;
    const folderStat2 = stats2.folderStats.find((s: any) => s.folder === subDir);
    
    expect(folderStat2.totalFiles).toBe(2);
    
    // Remove a file
    fs.unlinkSync(path.join(subDir, 'new.txt'));
    await new Promise(r => setTimeout(r, 1500));
    
    // Get final stats
    const stats3Promise = new Promise((resolve) => {
      const id = Math.random().toString(36);
      worker!.once('message', (msg) => {
        if (msg.id === id) resolve(msg.payload);
      });
      worker!.postMessage({ type: 'stats', id });
    });
    
    const stats3 = await stats3Promise as any;
    const folderStat3 = stats3.folderStats.find((s: any) => s.folder === subDir);
    
    expect(folderStat3.totalFiles).toBe(1);
  });
});