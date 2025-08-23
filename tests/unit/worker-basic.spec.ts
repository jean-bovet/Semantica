import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { TestWorker } from '../helpers/worker-test-utils';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

describe('Worker Basic Functionality', () => {
  let tempDir: string;
  let worker: TestWorker;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'worker-basic-test-'));
    worker = new TestWorker();
  });

  afterEach(async () => {
    await worker.terminate();
    if (fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it('should initialize successfully', async () => {
    await expect(worker.init(tempDir)).resolves.toBeUndefined();
  });

  it('should return initial stats', async () => {
    await worker.init(tempDir);
    const stats = await worker.getStats();
    
    expect(stats).toBeDefined();
    expect(stats.totalChunks).toBe(0);
    expect(stats.indexedFiles).toBe(0);
    expect(stats.folderStats).toEqual([]);
  });

  it('should persist watched folders', async () => {
    await worker.init(tempDir);
    
    const folders = ['/test/path1', '/test/path2'];
    await worker.watchStart(folders);
    
    // Check config file was created
    const configPath = path.join(tempDir, 'config.json');
    expect(fs.existsSync(configPath)).toBe(true);
    
    const config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
    expect(config.watchedFolders).toEqual(folders);
  });

  it('should return watched folders', async () => {
    await worker.init(tempDir);
    
    const folders = ['/test/folder1', '/test/folder2'];
    await worker.watchStart(folders);
    
    const watchedFolders = await worker.getWatchedFolders();
    expect(watchedFolders).toEqual(folders);
  });

  it('should handle search queries', async () => {
    await worker.init(tempDir);
    
    const results = await worker.search('test query');
    expect(Array.isArray(results)).toBe(true);
    expect(results.length).toBe(0); // No indexed content yet
  });

  it('should index a text file', async () => {
    await worker.init(tempDir);
    
    // Create a text file
    const testFile = path.join(tempDir, 'test.txt');
    fs.writeFileSync(testFile, 'This is test content for indexing.');
    
    // Start watching the directory
    await worker.watchStart([tempDir]);
    
    // Wait for the file to be indexed
    await worker.waitForIndexing(1);
    
    // Verify the file was indexed
    const stats = await worker.getStats();
    expect(stats.indexedFiles).toBe(1);
    expect(stats.totalChunks).toBeGreaterThan(0);
  });

  it('should track folder statistics', async () => {
    await worker.init(tempDir);
    
    // Create multiple files
    fs.writeFileSync(path.join(tempDir, 'file1.txt'), 'Content 1');
    fs.writeFileSync(path.join(tempDir, 'file2.md'), '# Markdown content');
    fs.writeFileSync(path.join(tempDir, 'file3.json'), '{"test": true}'); // Not indexed
    
    // Start watching
    await worker.watchStart([tempDir]);
    
    // Wait for indexing
    await worker.waitForIndexing(2);
    
    // Check stats
    const stats = await worker.getStats();
    expect(stats.indexedFiles).toBe(2);
    
    const folderStat = stats.folderStats.find((s: any) => s.folder === tempDir);
    expect(folderStat).toBeDefined();
    expect(folderStat.totalFiles).toBeGreaterThanOrEqual(3); // May include hidden files
    expect(folderStat.indexedFiles).toBe(2);
  });

  it('should handle file updates', { timeout: 10000 }, async () => {
    await worker.init(tempDir);
    
    const testFile = path.join(tempDir, 'update-test.txt');
    fs.writeFileSync(testFile, 'Initial content');
    
    await worker.watchStart([tempDir]);
    await worker.waitForIndexing(1);
    
    const stats1 = await worker.getStats();
    const chunks1 = stats1.totalChunks;
    
    // Update the file with more content
    fs.writeFileSync(testFile, 'Updated content with much more text to create additional chunks. '.repeat(20));
    
    // Trigger a change event by touching the file
    const newTime = Date.now() + 1000;
    fs.utimesSync(testFile, newTime / 1000, newTime / 1000);
    
    // Wait a bit for the file watcher to detect the change
    await new Promise(r => setTimeout(r, 1000));
    
    // Wait for processing to complete
    await worker.waitForProgress(p => p.processing === 0, 3000);
    
    const stats2 = await worker.getStats();
    expect(stats2.totalChunks).toBeGreaterThanOrEqual(chunks1); // Should re-index with same or more chunks
  });

  it('should not re-index on restart', async () => {
    await worker.init(tempDir);
    
    // Create and index a file
    const testFile = path.join(tempDir, 'persist-test.txt');
    fs.writeFileSync(testFile, 'Content to persist');
    
    await worker.watchStart([tempDir]);
    await worker.waitForIndexing(1);
    
    const stats1 = await worker.getStats();
    
    // Terminate and restart
    await worker.terminate();
    worker = new TestWorker();
    await worker.init(tempDir);
    
    // File should already be considered indexed
    const stats2 = await worker.getStats();
    expect(stats2.totalChunks).toBe(stats1.totalChunks);
  });
});