import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import path from 'node:path';
import fs from 'node:fs/promises';
import { WorkerManager } from '../../src/main/utils/WorkerManager';

describe('WorkerManager Integration', () => {
  let manager: WorkerManager;
  let dbDir: string;
  let userDataPath: string;

  beforeAll(async () => {
    // Setup test directories
    userDataPath = path.join(process.cwd(), 'test-data-' + Date.now());
    dbDir = path.join(userDataPath, 'data');
    await fs.mkdir(dbDir, { recursive: true });
  });

  afterAll(async () => {
    // Cleanup
    if (manager) {
      await manager.shutdown();
    }
    await fs.rm(userDataPath, { recursive: true, force: true });
  });

  it('should initialize WorkerManager and send messages', async () => {
    // Create WorkerManager
    manager = new WorkerManager(
      path.join(__dirname, '../../dist/worker.cjs'),
      { dbDir, userDataPath }
    );

    // Start the worker
    await manager.start();
    expect(manager.isReady()).toBe(false); // Not ready until it sends ready signal

    // Send a message to get progress
    const progress = await manager.sendMessage({ type: 'progress' });
    expect(progress).toBeDefined();
    // Check for progress structure - it has queue info
    expect(progress).toHaveProperty('queued');
    expect(progress).toHaveProperty('processing');
    expect(progress).toHaveProperty('completed');

    // Now should be ready
    expect(manager.isReady()).toBe(true);
  }, 30000);

  it('should handle restart gracefully', async () => {
    if (!manager) {
      manager = new WorkerManager(
        path.join(__dirname, '../../dist/worker.cjs'),
        { dbDir, userDataPath }
      );
      await manager.start();
    }

    // Get initial state
    const initialProgress = await manager.sendMessage({ type: 'progress' });
    expect(initialProgress).toBeDefined();

    // Restart the worker
    await manager.restart();

    // Should still be able to send messages after restart
    const afterRestartProgress = await manager.sendMessage({ type: 'progress' });
    expect(afterRestartProgress).toBeDefined();
    expect(manager.isReady()).toBe(true);
  }, 30000);

  it('should track memory usage', async () => {
    if (!manager) {
      manager = new WorkerManager(
        path.join(__dirname, '../../dist/worker.cjs'),
        { dbDir, userDataPath }
      );
      await manager.start();
    }

    // Get memory usage
    const memoryUsage = await manager['getMemoryUsage']();
    expect(memoryUsage).toBeGreaterThan(0);
    expect(memoryUsage).toBeLessThan(2 * 1024 * 1024 * 1024); // Less than 2GB
  }, 30000);
});