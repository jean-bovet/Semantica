import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { StartupCoordinator, StartupSensors, StartupActions } from '../../src/main/startup/StartupCoordinator';
import { StartupStage, type StageProgress } from '../../src/main/startup/StartupStages';

describe('StartupCoordinator', () => {
  let sensors: StartupSensors;
  let actions: StartupActions;
  let coordinator: StartupCoordinator;
  let stageProgressCallbacks: Set<(progress: StageProgress) => void>;

  beforeEach(() => {
    // Don't use fake timers - keep tests simple and synchronous
    stageProgressCallbacks = new Set();

    sensors = {
      waitForWorker: vi.fn().mockResolvedValue(undefined),
      waitForModel: vi.fn().mockResolvedValue(undefined),
      waitForFiles: vi.fn().mockResolvedValue(undefined),
      waitForStats: vi.fn().mockResolvedValue({ totalChunks: 100, indexedFiles: 50 }),
      onStageProgress: vi.fn((callback) => {
        stageProgressCallbacks.add(callback);
        // Immediately emit READY to avoid waiting
        setTimeout(() => {
          callback({ stage: StartupStage.READY, message: 'Ready' });
        }, 0);
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
  });

  it('should show window immediately', async () => {
    await coordinator.coordinate();

    // Window should be the first action
    expect(actions.showWindow).toHaveBeenCalled();
    expect(actions.showWindow).toHaveBeenCalledBefore(actions.notifyReady as any);
  });

  it('should register stage progress listener', async () => {
    await coordinator.coordinate();

    expect(sensors.onStageProgress).toHaveBeenCalled();
    expect(sensors.offStageProgress).toHaveBeenCalled();
  });

  it('should notify ready when stages complete', async () => {
    await coordinator.coordinate();

    expect(actions.notifyFilesLoaded).toHaveBeenCalled();
    expect(actions.notifyReady).toHaveBeenCalled();
  });

  it('should forward stage progress to actions', async () => {
    // Custom sensor that emits progress events
    sensors.onStageProgress = vi.fn((callback) => {
      stageProgressCallbacks.add(callback);
      // Emit various stages
      callback({ stage: StartupStage.WORKER_SPAWN, message: 'Spawning worker' });
      callback({ stage: StartupStage.DB_INIT, message: 'Initializing DB' });
      callback({ stage: StartupStage.READY, message: 'Ready' });
    });

    await coordinator.coordinate();

    expect(actions.notifyStageProgress).toHaveBeenCalledWith({
      stage: StartupStage.WORKER_SPAWN,
      message: 'Spawning worker'
    });
    expect(actions.notifyStageProgress).toHaveBeenCalledWith({
      stage: StartupStage.DB_INIT,
      message: 'Initializing DB'
    });
  });

  it('should handle disposal gracefully', () => {
    // Create and immediately dispose
    const testCoordinator = new StartupCoordinator(sensors, actions);
    testCoordinator.dispose();

    // Should not throw
    expect(() => testCoordinator.dispose()).not.toThrow();
  });

  it('should handle errors from coordinate', async () => {
    // Make the stage listener throw an error
    const error = new Error('Stage listener error');
    sensors.onStageProgress = vi.fn(() => {
      throw error;
    });

    await expect(coordinator.coordinate()).rejects.toThrow('Stage listener error');
  });

  it('should support custom configuration', () => {
    // Just verify it can be created with custom config
    const customCoordinator = new StartupCoordinator(
      sensors,
      actions,
      { workerTimeout: 20000 }
    );

    expect(customCoordinator).toBeDefined();
    customCoordinator.dispose();
  });

  it('should complete lifecycle in correct order', async () => {
    const callOrder: string[] = [];

    actions.showWindow = vi.fn(() => callOrder.push('showWindow'));
    actions.notifyFilesLoaded = vi.fn(() => callOrder.push('notifyFilesLoaded'));
    actions.notifyReady = vi.fn(() => callOrder.push('notifyReady'));

    await coordinator.coordinate();

    expect(callOrder).toEqual(['showWindow', 'notifyFilesLoaded', 'notifyReady']);
  });

  it('should handle progress with percentage', async () => {
    sensors.onStageProgress = vi.fn((callback) => {
      callback({
        stage: StartupStage.DB_LOAD,
        message: 'Loading database',
        progress: 50
      });
      callback({ stage: StartupStage.READY, message: 'Ready' });
    });

    await coordinator.coordinate();

    expect(actions.notifyStageProgress).toHaveBeenCalledWith({
      stage: StartupStage.DB_LOAD,
      message: 'Loading database',
      progress: 50
    });
  });

  it('should handle model download stage', async () => {
    sensors.onStageProgress = vi.fn((callback) => {
      callback({
        stage: StartupStage.MODEL_DOWNLOAD,
        message: 'Downloading model',
        progress: 0
      });
      callback({
        stage: StartupStage.MODEL_DOWNLOAD,
        message: 'Downloading model',
        progress: 100
      });
      callback({ stage: StartupStage.READY, message: 'Ready' });
    });

    await coordinator.coordinate();

    // 3 calls: 2 for MODEL_DOWNLOAD and 1 for READY
    expect(actions.notifyStageProgress).toHaveBeenCalledTimes(3);
  });

  it('should handle multiple stage transitions', async () => {
    const stages: StartupStage[] = [];

    sensors.onStageProgress = vi.fn((callback) => {
      // Simulate full startup sequence
      const sequence = [
        StartupStage.WORKER_SPAWN,
        StartupStage.DB_INIT,
        StartupStage.DB_LOAD,
        StartupStage.FOLDER_SCAN,
        StartupStage.MODEL_CHECK,
        StartupStage.EMBEDDER_INIT,
        StartupStage.READY
      ];

      sequence.forEach(stage => {
        callback({ stage, message: `Stage: ${stage}` });
      });
    });

    actions.notifyStageProgress = vi.fn((progress) => {
      stages.push(progress.stage);
    });

    await coordinator.coordinate();

    expect(stages).toContain(StartupStage.WORKER_SPAWN);
    expect(stages).toContain(StartupStage.DB_INIT);
    expect(stages).toContain(StartupStage.READY);
  });
});