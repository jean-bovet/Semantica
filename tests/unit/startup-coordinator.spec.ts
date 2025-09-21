import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { StartupCoordinator, StartupSensors, StartupActions, StartupError } from '../../src/main/startup/StartupCoordinator';
import { StartupStage, type StageProgress } from '../../src/main/startup/StartupStages';

describe('StartupCoordinator', () => {
  let sensors: StartupSensors;
  let actions: StartupActions;
  let coordinator: StartupCoordinator;
  let stageProgressCallbacks: Set<(progress: StageProgress) => void>;

  beforeEach(() => {
    vi.useFakeTimers();
    stageProgressCallbacks = new Set();

    sensors = {
      waitForWorker: vi.fn().mockResolvedValue(undefined),
      waitForModel: vi.fn().mockResolvedValue(undefined),
      waitForFiles: vi.fn().mockResolvedValue(undefined),
      waitForStats: vi.fn().mockResolvedValue({ totalChunks: 100, indexedFiles: 50 }),
      onStageProgress: vi.fn((callback) => {
        stageProgressCallbacks.add(callback);
      }),
      offStageProgress: vi.fn((callback) => {
        stageProgressCallbacks.delete(callback);
      })
    };

    actions = {
      showWindow: vi.fn(),
      notifyFilesLoaded: vi.fn(),
      notifyReady: vi.fn(),
      notifyError: vi.fn(),
      notifyStageProgress: vi.fn()
    };

    coordinator = new StartupCoordinator(sensors, actions);
  });

  afterEach(() => {
    coordinator.dispose();
    vi.clearAllTimers();
    vi.useRealTimers();
  });

  const emitStageProgress = (stage: StartupStage, message?: string, progress?: number) => {
    const stageProgress: StageProgress = {
      stage,
      message: message || `Stage ${stage}`,
      progress
    };
    stageProgressCallbacks.forEach(callback => callback(stageProgress));
  };

  it('should show window immediately without waiting', async () => {
    const promise = coordinator.coordinate();

    // Window should show before any async operations complete
    expect(actions.showWindow).toHaveBeenCalled();

    // Emit ready stage to complete
    emitStageProgress(StartupStage.READY);

    await promise;
  });

  it('should monitor stage progress and complete when READY', async () => {
    const promise = coordinator.coordinate();

    // Should register stage progress listener
    expect(sensors.onStageProgress).toHaveBeenCalled();

    // Emit stages in sequence
    emitStageProgress(StartupStage.WORKER_SPAWN);
    await vi.advanceTimersByTimeAsync(100);

    emitStageProgress(StartupStage.DB_INIT);
    await vi.advanceTimersByTimeAsync(100);

    emitStageProgress(StartupStage.DB_LOAD, 'Loading files', 50);
    await vi.advanceTimersByTimeAsync(100);

    emitStageProgress(StartupStage.READY);

    await promise;

    expect(actions.notifyFilesLoaded).toHaveBeenCalled();
    expect(actions.notifyReady).toHaveBeenCalled();
  });

  it('should forward stage progress to actions', async () => {
    const promise = coordinator.coordinate();

    emitStageProgress(StartupStage.DB_INIT, 'Initializing database');

    expect(actions.notifyStageProgress).toHaveBeenCalledWith({
      stage: StartupStage.DB_INIT,
      message: 'Initializing database',
      progress: undefined
    });

    emitStageProgress(StartupStage.READY);
    await promise;
  });

  it('should handle stage timeout gracefully', async () => {
    const promise = coordinator.coordinate();

    // Start a stage but don't progress
    emitStageProgress(StartupStage.WORKER_SPAWN);

    // Advance timer to trigger timeout (5 seconds for WORKER_SPAWN)
    await vi.advanceTimersByTimeAsync(5001);

    // Should notify error about timeout
    expect(actions.notifyError).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'stage-timeout'
      })
    );

    // Complete to allow test to finish
    emitStageProgress(StartupStage.READY);
    await promise;
  });

  it('should reset timeout when stage progresses', async () => {
    const promise = coordinator.coordinate();

    // Start a stage
    emitStageProgress(StartupStage.DB_LOAD, 'Loading', 0);

    // Advance timer but not to timeout
    await vi.advanceTimersByTimeAsync(14000);

    // Progress the stage (resets timeout)
    emitStageProgress(StartupStage.DB_LOAD, 'Loading', 50);

    // Advance timer again
    await vi.advanceTimersByTimeAsync(14000);

    // Should not have timed out
    expect(actions.notifyError).not.toHaveBeenCalled();

    // Complete
    emitStageProgress(StartupStage.READY);
    await promise;
  });

  it('should handle model download stage', async () => {
    const promise = coordinator.coordinate();

    emitStageProgress(StartupStage.MODEL_DOWNLOAD, 'Downloading model', 0);
    await vi.advanceTimersByTimeAsync(100);

    emitStageProgress(StartupStage.MODEL_DOWNLOAD, 'Downloading model', 50);
    await vi.advanceTimersByTimeAsync(100);

    emitStageProgress(StartupStage.MODEL_DOWNLOAD, 'Downloading model', 100);
    await vi.advanceTimersByTimeAsync(100);

    emitStageProgress(StartupStage.READY);
    await promise;

    expect(actions.notifyReady).toHaveBeenCalled();
  });

  it('should clean up timeouts on dispose', async () => {
    const promise = coordinator.coordinate();

    // Start a stage
    emitStageProgress(StartupStage.WORKER_SPAWN);

    // Dispose before timeout
    coordinator.dispose();

    // Advance time past timeout
    await vi.advanceTimersByTimeAsync(10000);

    // Should not notify error after disposal
    expect(actions.notifyError).not.toHaveBeenCalled();

    // Complete (although disposed, promise should handle gracefully)
    emitStageProgress(StartupStage.READY);

    // Promise should reject due to disposal
    await expect(promise).rejects.toThrow('disposed');
  });

  it('should unregister stage listener on cleanup', async () => {
    const promise = coordinator.coordinate();

    emitStageProgress(StartupStage.READY);
    await promise;

    // Should have unregistered the listener
    expect(sensors.offStageProgress).toHaveBeenCalled();
  });

  it('should handle initial timeout if no stage progress', async () => {
    coordinator.coordinate().catch(() => {}); // Ignore the rejection

    // Don't emit any stage progress
    // Advance timer to trigger initial timeout (5 seconds for WORKER_SPAWN)
    await vi.advanceTimersByTimeAsync(5001);

    // Should notify error about timeout
    expect(actions.notifyError).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'stage-timeout'
      })
    );
  });

  it('should allow custom timeout configuration', async () => {
    // Create coordinator with custom timeout (though stages have their own timeouts now)
    coordinator = new StartupCoordinator(sensors, actions, { workerTimeout: 1000 });

    const promise = coordinator.coordinate();

    // Complete normally
    emitStageProgress(StartupStage.READY);
    await promise;

    expect(actions.notifyReady).toHaveBeenCalled();
  });

  it('should handle rapid sequential calls', async () => {
    // First call
    let promise1 = coordinator.coordinate();
    emitStageProgress(StartupStage.READY);
    await promise1;
    expect(actions.notifyReady).toHaveBeenCalledTimes(1);

    // Cleanup and recreate coordinator for second call
    coordinator.dispose();
    coordinator = new StartupCoordinator(sensors, actions);

    // Second call should work independently
    let promise2 = coordinator.coordinate();
    emitStageProgress(StartupStage.READY);
    await promise2;
    expect(actions.notifyReady).toHaveBeenCalledTimes(2);
  });
});