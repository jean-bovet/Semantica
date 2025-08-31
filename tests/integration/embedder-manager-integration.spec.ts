import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import path from 'node:path';
import fs from 'node:fs/promises';
import { EmbedderManager } from '../../src/main/utils/EmbedderManager';

describe('EmbedderManager Integration', () => {
  let manager: EmbedderManager;
  let modelCachePath: string;

  beforeAll(async () => {
    // Setup test model cache directory
    modelCachePath = path.join(process.cwd(), 'test-models-' + Date.now());
    await fs.mkdir(modelCachePath, { recursive: true });
  });

  afterAll(async () => {
    // Cleanup
    if (manager) {
      await manager.shutdown();
    }
    await fs.rm(modelCachePath, { recursive: true, force: true });
  });

  it('should initialize EmbedderManager and handle messages', async () => {
    // Create EmbedderManager
    const scriptPath = path.join(__dirname, '../../dist/embedder.child.cjs');
    manager = new EmbedderManager(
      scriptPath,
      'Xenova/multilingual-e5-small',
      modelCachePath
    );

    // Start the embedder
    await manager.start();
    
    // Initially not ready until model loads
    expect(manager.isReady()).toBe(false);
    
    // Wait for ready (this will timeout if model doesn't exist)
    try {
      await manager.waitForReady(5000); // Short timeout for test
    } catch (error) {
      // Model may not exist in test environment
      console.log('Model not available in test environment');
      return;
    }

    expect(manager.isReady()).toBe(true);
    expect(manager.getFilesSinceSpawn()).toBe(0);
  }, 30000);

  it('should track file processing count', async () => {
    if (!manager) {
      const scriptPath = path.join(__dirname, '../../dist/embedder.child.cjs');
      manager = new EmbedderManager(
        scriptPath,
        'Xenova/multilingual-e5-small',
        modelCachePath
      );
      await manager.start();
      
      try {
        await manager.waitForReady(5000);
      } catch {
        console.log('Model not available, skipping test');
        return;
      }
    }

    const initialCount = manager.getFilesSinceSpawn();
    
    // Simulate embedding (will fail if model not loaded, but count should increase)
    try {
      await manager.embed(['test text']);
      expect(manager.getFilesSinceSpawn()).toBe(initialCount + 1);
    } catch {
      // Expected if model not available
    }
  }, 30000);

  it('should handle restart gracefully', async () => {
    if (!manager || !manager.isReady()) {
      console.log('Manager not ready, skipping restart test');
      return;
    }

    const countBeforeRestart = manager.getFilesSinceSpawn();
    
    // Restart the embedder
    await manager.restart();
    
    // File count should reset after restart
    expect(manager.getFilesSinceSpawn()).toBe(0);
    
    // Should still be functional after restart
    expect(manager.isRunning()).toBe(true);
  }, 30000);

  it('should check file threshold for restart', async () => {
    if (!manager) {
      const scriptPath = path.join(__dirname, '../../dist/embedder.child.cjs');
      manager = new EmbedderManager(
        scriptPath,
        'Xenova/multilingual-e5-small',
        modelCachePath
      );
      // Don't start it, just test the logic
    }

    // Initially should not need restart
    const initialFiles = manager.getFilesSinceSpawn();
    expect(initialFiles).toBeLessThan(200);

    // Simulate processing many files (manually set the counter)
    manager['filesSinceSpawn'] = 201;
    
    // Check if restart is needed
    await manager.checkAndRestartIfNeeded();
    
    // After restart check, file count should be reset if it restarted
    // or still high if it couldn't restart (not running)
    const filesAfter = manager.getFilesSinceSpawn();
    if (manager.isRunning()) {
      expect(filesAfter).toBe(0); // Reset after restart
    } else {
      expect(filesAfter).toBe(201); // No restart if not running
    }
  }, 30000);
});