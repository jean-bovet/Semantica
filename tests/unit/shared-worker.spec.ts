import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { TestWorker } from '../helpers/worker-test-utils';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

describe('Shared Worker Tests - Fast Suite', () => {
  let tempDir: string;
  let worker: TestWorker;

  beforeAll(async () => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'shared-worker-test-'));
    worker = new TestWorker();
    await worker.init(tempDir);
  });

  afterAll(async () => {
    await worker.terminate();
    if (fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it('should get initial empty stats', async () => {
    const stats = await worker.getStats();
    expect(stats.totalChunks).toBe(0);
    expect(stats.indexedFiles).toBe(0);
  });

  it('should handle search on empty index', async () => {
    const results = await worker.search('test');
    expect(Array.isArray(results)).toBe(true);
    expect(results.length).toBe(0);
  });

  it('should track progress', async () => {
    const progress = await worker.getProgress();
    expect(progress).toBeDefined();
    expect(progress.queued).toBe(0);
    expect(progress.processing).toBe(0);
  });

  it('should set and get watched folders', async () => {
    const folders = ['/shared/test1', '/shared/test2'];
    await worker.watchStart(folders);
    
    const watched = await worker.getWatchedFolders();
    expect(watched).toEqual(folders);
  });

  it('should update watched folders', async () => {
    const newFolders = ['/shared/new1'];
    await worker.watchStart(newFolders);
    
    const watched = await worker.getWatchedFolders();
    expect(watched).toEqual(newFolders);
  });

  it('should persist config changes', async () => {
    const configPath = path.join(tempDir, 'config.json');
    expect(fs.existsSync(configPath)).toBe(true);
    
    const config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
    expect(config.watchedFolders).toEqual(['/shared/new1']);
  });
});