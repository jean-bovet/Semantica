import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { StartupCoordinator, StartupSensors, StartupActions, StartupError } from '../../src/main/startup/StartupCoordinator';

describe('StartupCoordinator', () => {
  let sensors: StartupSensors;
  let actions: StartupActions;
  let coordinator: StartupCoordinator;
  
  beforeEach(() => {
    vi.useFakeTimers();
    sensors = {
      waitForWorker: vi.fn().mockResolvedValue(undefined),
      waitForModel: vi.fn().mockResolvedValue(undefined),
      waitForFiles: vi.fn().mockResolvedValue(undefined),
      waitForStats: vi.fn().mockResolvedValue({ totalChunks: 100, indexedFiles: 50 })
    };
    actions = {
      showWindow: vi.fn(),
      notifyFilesLoaded: vi.fn(),
      notifyReady: vi.fn(),
      notifyError: vi.fn()
    };
    coordinator = new StartupCoordinator(sensors, actions);
  });
  
  afterEach(() => {
    coordinator.dispose();
    vi.clearAllTimers();
    vi.useRealTimers();
  });
  
  it('should show window immediately without waiting', async () => {
    const promise = coordinator.coordinate();
    
    // Window should show before any async operations complete
    expect(actions.showWindow).toHaveBeenCalled();
    
    // Wait for worker should be called but not yet resolved
    expect(sensors.waitForWorker).toHaveBeenCalled();
    
    await promise;
  });
  
  it('should wait for both model AND files before notifying ready', async () => {
    // Delay model loading
    sensors.waitForModel = vi.fn().mockImplementation(
      () => new Promise(resolve => setTimeout(resolve, 1000))
    );
    
    const promise = coordinator.coordinate();
    
    // Ready should not be called yet
    expect(actions.notifyReady).not.toHaveBeenCalled();
    
    // Advance time for model
    await vi.advanceTimersByTimeAsync(1000);
    
    // Ready should only be called after both complete
    await promise;
    expect(actions.notifyReady).toHaveBeenCalledTimes(1);
  });
  
  it('should handle worker timeout gracefully', async () => {
    sensors.waitForWorker = vi.fn().mockImplementation(
      () => new Promise(() => {}) // Never resolves
    );
    
    const promise = coordinator.coordinate();
    
    // Advance timer to trigger timeout
    vi.advanceTimersByTime(10001);
    
    // Wait for the promise to reject
    await expect(promise).rejects.toThrow('Startup failed: timeout');
    expect(actions.notifyError).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'timeout' })
    );
  });
  
  it('should compute stats before sending files:loaded', async () => {
    const callOrder: string[] = [];
    
    sensors.waitForStats = vi.fn().mockImplementation(async () => {
      callOrder.push('waitForStats');
      return { totalChunks: 100, indexedFiles: 50 };
    });
    
    actions.notifyFilesLoaded = vi.fn().mockImplementation(() => {
      callOrder.push('notifyFilesLoaded');
    });
    
    await coordinator.coordinate();
    
    // Verify call order
    expect(callOrder).toEqual(['waitForStats', 'notifyFilesLoaded']);
  });
  
  it('should handle files loading before model', async () => {
    // Files resolve immediately, model takes time
    sensors.waitForModel = vi.fn().mockImplementation(
      () => new Promise(resolve => setTimeout(resolve, 2000))
    );
    
    const promise = coordinator.coordinate();
    await vi.advanceTimersByTimeAsync(2000);
    await promise;
    
    expect(actions.notifyReady).toHaveBeenCalled();
  });
  
  it('should propagate model loading errors', async () => {
    const error = new Error('Model download failed');
    sensors.waitForModel = vi.fn().mockRejectedValue(error);
    
    await expect(coordinator.coordinate()).rejects.toThrow('Startup failed: model-failed');
    expect(actions.notifyError).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'model-failed' })
    );
  });
  
  it('should propagate files loading errors', async () => {
    const error = new Error('Database corrupted');
    sensors.waitForFiles = vi.fn().mockRejectedValue(error);
    
    await expect(coordinator.coordinate()).rejects.toThrow('Startup failed: files-failed');
    expect(actions.notifyError).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'files-failed' })
    );
  });
  
  it('should handle both model and files failing', async () => {
    sensors.waitForModel = vi.fn().mockRejectedValue(new Error('Model error'));
    sensors.waitForFiles = vi.fn().mockRejectedValue(new Error('Files error'));
    
    await expect(coordinator.coordinate()).rejects.toThrow('Startup failed: model-failed');
    expect(actions.notifyError).toHaveBeenCalled();
  });
  
  it('should wait for worker before proceeding to model/files', async () => {
    const callOrder: string[] = [];
    
    sensors.waitForWorker = vi.fn().mockImplementation(async () => {
      await new Promise(resolve => setTimeout(resolve, 500));
      callOrder.push('worker');
    });
    
    sensors.waitForModel = vi.fn().mockImplementation(async () => {
      callOrder.push('model');
    });
    
    sensors.waitForFiles = vi.fn().mockImplementation(async () => {
      callOrder.push('files');
    });
    
    const promise = coordinator.coordinate();
    
    // Model and files should not be called yet
    expect(callOrder).toEqual([]);
    
    await vi.advanceTimersByTimeAsync(500);
    await promise;
    
    // Worker should complete before model/files start
    expect(callOrder[0]).toBe('worker');
    expect(callOrder).toContain('model');
    expect(callOrder).toContain('files');
  });
  
  it('should clean up timeouts on dispose', async () => {
    // Start coordination with delayed worker
    sensors.waitForWorker = vi.fn().mockImplementation(
      () => new Promise(resolve => setTimeout(resolve, 5000))
    );
    
    const promise = coordinator.coordinate();
    
    // Dispose before completion
    coordinator.dispose();
    
    // Advance time to complete the worker
    await vi.advanceTimersByTimeAsync(5000);
    
    // Promise should complete normally
    await promise;
  });
  
  it('should handle rapid sequential calls', async () => {
    // First call
    await coordinator.coordinate();
    expect(actions.notifyReady).toHaveBeenCalledTimes(1);
    
    // Second call should work independently
    await coordinator.coordinate();
    expect(actions.notifyReady).toHaveBeenCalledTimes(2);
  });
  
  it('should allow custom timeout configuration', async () => {
    coordinator = new StartupCoordinator(sensors, actions, { workerTimeout: 5000 });
    
    sensors.waitForWorker = vi.fn().mockImplementation(
      () => new Promise(() => {}) // Never resolves
    );
    
    const promise = coordinator.coordinate().catch(err => err);
    
    // Should not timeout at 4999ms
    await vi.advanceTimersByTimeAsync(4999);
    
    // Should timeout at 5001ms
    await vi.advanceTimersByTimeAsync(2);
    const result = await promise;
    expect(result).toBeInstanceOf(Error);
    expect(result.message).toBe('Startup failed: timeout');
  });
});
