import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { Worker } from 'node:worker_threads';
import { ChildProcess } from 'node:child_process';
import { RestartableProcess, RestartableConfig, ProcessState } from '../../src/main/utils/RestartableProcess';

// Test implementation of RestartableProcess
class TestRestartableProcess extends RestartableProcess {
  public mockProcess: any;
  public mockState: ProcessState = { testData: 'initial' };
  public spawnCalled = 0;
  public getStateCalled = 0;
  public restoreStateCalled = 0;
  public restoreStateData: ProcessState | null = null;

  protected spawn(): Worker | ChildProcess {
    this.spawnCalled++;
    this.mockProcess = {
      postMessage: vi.fn(),
      send: vi.fn(),
      terminate: vi.fn().mockResolvedValue(undefined),
      kill: vi.fn(),
      killed: false,
      connected: true,
      on: vi.fn()
    };
    return this.mockProcess as any;
  }

  protected setupHandlers(process: Worker | ChildProcess): void {
    // Mock handler setup
  }

  protected async getState(): Promise<ProcessState> {
    this.getStateCalled++;
    return this.mockState;
  }

  protected async restoreState(state: ProcessState): Promise<void> {
    this.restoreStateCalled++;
    this.restoreStateData = state;
  }

  // Expose protected methods for testing
  public async testCheckMemoryAndRestart(): Promise<void> {
    await this.checkMemoryAndRestart();
  }

  public async testGetMemoryUsage(): Promise<number> {
    return this.getMemoryUsage();
  }

  public setMockMemoryUsage(usage: number): void {
    // Override getMemoryUsage for testing
    this.getMemoryUsage = async () => usage;
  }
}

describe('RestartableProcess', () => {
  let process: TestRestartableProcess;

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(async () => {
    if (process) {
      await process.shutdown();
    }
  });

  describe('Lifecycle Management', () => {
    it('should spawn process on start', async () => {
      process = new TestRestartableProcess({
        type: 'worker',
        scriptPath: '/test/script.js'
      });

      await process.start();

      expect(process.spawnCalled).toBe(1);
      expect(process.isRunning()).toBe(true);
    });

    it('should not spawn multiple times if already running', async () => {
      process = new TestRestartableProcess({
        type: 'worker',
        scriptPath: '/test/script.js'
      });

      await process.start();
      await process.start(); // Second call

      expect(process.spawnCalled).toBe(1);
    });

    it('should properly shutdown process', async () => {
      process = new TestRestartableProcess({
        type: 'worker',
        scriptPath: '/test/script.js'
      });

      await process.start();
      expect(process.isRunning()).toBe(true);

      await process.shutdown();
      expect(process.isRunning()).toBe(false);
      expect(process.mockProcess.terminate).toHaveBeenCalled();
    });

    it('should handle shutdown when process is not running', async () => {
      process = new TestRestartableProcess({
        type: 'worker',
        scriptPath: '/test/script.js'
      });

      // Should not throw
      await expect(process.shutdown()).resolves.toBeUndefined();
    });
  });

  describe('State Management', () => {
    it('should save state before restart', async () => {
      process = new TestRestartableProcess({
        type: 'worker',
        scriptPath: '/test/script.js',
        restartDelay: 10
      });

      await process.start();
      process.mockState = { testData: 'modified' };

      await process.restart();

      expect(process.getStateCalled).toBe(1);
    });

    it('should restore state after restart', async () => {
      process = new TestRestartableProcess({
        type: 'worker',
        scriptPath: '/test/script.js',
        restartDelay: 10
      });

      await process.start();
      process.mockState = { testData: 'saved-state' };

      await process.restart();

      expect(process.restoreStateCalled).toBe(1);
      expect(process.restoreStateData).toEqual({ testData: 'saved-state' });
    });

    it('should clear state after successful restoration', async () => {
      process = new TestRestartableProcess({
        type: 'worker',
        scriptPath: '/test/script.js',
        restartDelay: 10
      });

      await process.start();
      await process.restart();
      
      // Start again without restart - should not restore state
      process.restoreStateCalled = 0;
      await process.shutdown();
      await process.start();

      expect(process.restoreStateCalled).toBe(0);
    });
  });

  describe('Memory Monitoring', () => {
    it('should restart when memory threshold exceeded', async () => {
      process = new TestRestartableProcess({
        type: 'worker',
        scriptPath: '/test/script.js',
        memoryThreshold: 100 * 1024 * 1024, // 100MB
        restartDelay: 10
      });

      await process.start();
      const initialSpawnCount = process.spawnCalled;

      // Set memory usage above threshold
      process.setMockMemoryUsage(150 * 1024 * 1024); // 150MB

      await process.testCheckMemoryAndRestart();

      expect(process.spawnCalled).toBe(initialSpawnCount + 1);
    });

    it('should not restart when memory is below threshold', async () => {
      process = new TestRestartableProcess({
        type: 'worker',
        scriptPath: '/test/script.js',
        memoryThreshold: 100 * 1024 * 1024, // 100MB
        restartDelay: 10
      });

      await process.start();
      const initialSpawnCount = process.spawnCalled;

      // Set memory usage below threshold
      process.setMockMemoryUsage(50 * 1024 * 1024); // 50MB

      await process.testCheckMemoryAndRestart();

      expect(process.spawnCalled).toBe(initialSpawnCount);
    });

    it('should not restart if already restarting', async () => {
      process = new TestRestartableProcess({
        type: 'worker',
        scriptPath: '/test/script.js',
        restartDelay: 100 // Longer delay
      });

      await process.start();

      // Start two restarts simultaneously
      const restart1 = process.restart();
      const restart2 = process.restart();

      await Promise.all([restart1, restart2]);

      // Should only spawn twice (initial + 1 restart)
      expect(process.spawnCalled).toBe(2);
    });
  });

  describe('Restart Limits', () => {
    it('should enforce max restart limit', async () => {
      process = new TestRestartableProcess({
        type: 'worker',
        scriptPath: '/test/script.js',
        maxRestarts: 2,
        restartDelay: 10
      });

      await process.start();

      // Perform restarts up to limit
      await process.restart();
      expect(process.spawnCalled).toBe(2);

      await process.restart();
      expect(process.spawnCalled).toBe(3);

      // Should not restart beyond limit
      await process.restart();
      expect(process.spawnCalled).toBe(3); // No additional spawn
    });

    it('should track restart count correctly', async () => {
      process = new TestRestartableProcess({
        type: 'worker',
        scriptPath: '/test/script.js',
        maxRestarts: 5,
        restartDelay: 10
      });

      await process.start();

      for (let i = 0; i < 3; i++) {
        await process.restart();
      }

      expect(process.spawnCalled).toBe(4); // Initial + 3 restarts
    });
  });

  describe('Message Handling', () => {
    it('should send messages to worker process', async () => {
      process = new TestRestartableProcess({
        type: 'worker',
        scriptPath: '/test/script.js'
      });

      await process.start();

      const message = { type: 'test', data: 'hello' };
      const promise = process.sendMessage(message);

      // Simulate response
      const callback = process['pendingCallbacks'].values().next().value;
      if (callback) callback({ result: 'success' });

      const result = await promise;
      expect(result).toEqual({ result: 'success' });
      expect(process.mockProcess.postMessage).toHaveBeenCalled();
    });

    it('should send messages to child process', async () => {
      process = new TestRestartableProcess({
        type: 'child',
        scriptPath: '/test/script.js'
      });

      await process.start();

      const message = { type: 'test', data: 'hello' };
      const promise = process.sendMessage(message);

      // Simulate response
      const callback = process['pendingCallbacks'].values().next().value;
      if (callback) callback({ result: 'success' });

      const result = await promise;
      expect(result).toEqual({ result: 'success' });
      expect(process.mockProcess.send).toHaveBeenCalled();
    });

    it('should handle message timeout', async () => {
      process = new TestRestartableProcess({
        type: 'worker',
        scriptPath: '/test/script.js'
      });

      await process.start();

      // Use fake timers before starting the operation
      vi.useFakeTimers();

      const message = { type: 'test', data: 'hello' };
      
      // Start the message send (which sets a timeout)
      const promise = process.sendMessage(message);

      // Fast-forward time to trigger timeout
      await vi.advanceTimersByTimeAsync(31000);

      // Expect the promise to reject
      await expect(promise).rejects.toThrow('Message timeout');

      vi.useRealTimers();
    });

    it('should reject messages when process not running', async () => {
      process = new TestRestartableProcess({
        type: 'worker',
        scriptPath: '/test/script.js'
      });

      // Don't start the process
      const message = { type: 'test', data: 'hello' };
      
      await expect(process.sendMessage(message)).rejects.toThrow('Process not running');
    });

    it('should clear pending callbacks on shutdown', async () => {
      process = new TestRestartableProcess({
        type: 'worker',
        scriptPath: '/test/script.js'
      });

      await process.start();

      // Add some pending callbacks
      process.sendMessage({ type: 'test1' });
      process.sendMessage({ type: 'test2' });

      expect(process['pendingCallbacks'].size).toBe(2);

      await process.shutdown();

      expect(process['pendingCallbacks'].size).toBe(0);
    });
  });

  describe('Error Handling', () => {
    it('should handle spawn errors gracefully', async () => {
      process = new TestRestartableProcess({
        type: 'worker',
        scriptPath: '/test/script.js',
        restartDelay: 10
      });

      // Override spawn to throw error on second call
      const originalSpawn = process.spawn.bind(process);
      let callCount = 0;
      process.spawn = () => {
        callCount++;
        if (callCount === 2) {
          throw new Error('Spawn failed');
        }
        return originalSpawn();
      };

      await process.start();
      
      // Restart should handle the error
      await process.restart();

      // Process should still be marked as not restarting
      expect(process['isRestarting']).toBe(false);
    });

    it('should handle state save errors during restart', async () => {
      process = new TestRestartableProcess({
        type: 'worker',
        scriptPath: '/test/script.js',
        restartDelay: 10
      });

      // Override getState to throw error
      process.getState = async () => {
        throw new Error('State save failed');
      };

      await process.start();

      // Should not throw, but handle error gracefully
      await expect(process.restart()).resolves.toBeUndefined();
    });
  });

  describe('Process Types', () => {
    it('should handle worker type correctly', async () => {
      process = new TestRestartableProcess({
        type: 'worker',
        scriptPath: '/test/script.js'
      });

      await process.start();
      await process.shutdown();

      expect(process.mockProcess.terminate).toHaveBeenCalled();
      expect(process.mockProcess.kill).not.toHaveBeenCalled();
    });

    it('should handle child type correctly', async () => {
      process = new TestRestartableProcess({
        type: 'child',
        scriptPath: '/test/script.js'
      });

      await process.start();
      await process.shutdown();

      expect(process.mockProcess.kill).toHaveBeenCalledWith('SIGTERM');
    });
  });
});