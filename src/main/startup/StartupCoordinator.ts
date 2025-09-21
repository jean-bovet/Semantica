import { StartupStage, type StageProgress, getStageTimeout } from './StartupStages';

export interface StartupSensors {
  waitForWorker(): Promise<void>;
  waitForModel(): Promise<void>;
  waitForFiles(): Promise<void>;
  waitForStats(): Promise<any>;
  onStageProgress(callback: (progress: StageProgress) => void): void;
  offStageProgress(callback: (progress: StageProgress) => void): void;
}

export interface StartupActions {
  showWindow(): void;
  notifyFilesLoaded(): void;
  notifyReady(): void;
  notifyError(error: StartupError): void;
  notifyStageProgress(progress: StageProgress): void;
}

export class StartupError extends Error {
  constructor(public type: string, public originalError?: any) {
    super(`Startup failed: ${type}`);
    this.name = 'StartupError';
  }
}

export class StartupCoordinator {
  private disposed = false;
  private timeouts: NodeJS.Timeout[] = [];
  private currentStage: StartupStage | null = null;
  private lastStageTime: number = Date.now();
  private stageTimeout: NodeJS.Timeout | null = null;
  private stageProgressHandler: ((progress: StageProgress) => void) | null = null;

  constructor(
    private sensors: StartupSensors,
    private actions: StartupActions,
    private options = { workerTimeout: 10000 }
  ) {}
  
  async coordinate(): Promise<void> {
    // Show window immediately
    this.actions.showWindow();

    // Set up stage progress monitoring
    this.stageProgressHandler = (progress: StageProgress) => {
      this.handleStageProgress(progress);
    };
    this.sensors.onStageProgress(this.stageProgressHandler);

    try {
      // Start stage monitoring
      this.startStageMonitoring();

      // Wait for worker with stage-based timeout
      await this.waitForStage(StartupStage.READY);

      // Compute stats before notifying
      await this.sensors.waitForStats();

      // All ready - notify renderer
      this.actions.notifyFilesLoaded();
      this.actions.notifyReady();

    } catch (error) {
      this.actions.notifyError(error as StartupError);
      throw error;
    } finally {
      this.stopStageMonitoring();
    }
  }

  private handleStageProgress(progress: StageProgress): void {
    this.currentStage = progress.stage;
    this.lastStageTime = Date.now();

    // Forward progress to renderer
    this.actions.notifyStageProgress(progress);

    // Reset stage timeout
    if (this.stageTimeout) {
      clearTimeout(this.stageTimeout);
    }

    // Don't set timeout for READY stage
    if (progress.stage !== StartupStage.READY) {
      const timeout = getStageTimeout(progress.stage);
      this.stageTimeout = setTimeout(() => {
        if (!this.disposed) {
          const error = new StartupError(
            'stage-timeout',
            `Stage ${progress.stage} timed out after ${timeout}ms`
          );
          this.actions.notifyError(error);
        }
      }, timeout);
    }
  }

  private startStageMonitoring(): void {
    // Initial timeout for first stage
    const initialTimeout = getStageTimeout(StartupStage.WORKER_SPAWN);
    this.stageTimeout = setTimeout(() => {
      if (!this.disposed && !this.currentStage) {
        const error = new StartupError(
          'stage-timeout',
          `Worker spawn timed out after ${initialTimeout}ms`
        );
        this.actions.notifyError(error);
      }
    }, initialTimeout);
  }

  private stopStageMonitoring(): void {
    if (this.stageTimeout) {
      clearTimeout(this.stageTimeout);
      this.stageTimeout = null;
    }
    if (this.stageProgressHandler) {
      this.sensors.offStageProgress(this.stageProgressHandler);
      this.stageProgressHandler = null;
    }
  }

  private async waitForStage(targetStage: StartupStage): Promise<void> {
    return new Promise((resolve, reject) => {
      const checkStage = () => {
        if (this.currentStage === targetStage) {
          resolve();
        } else if (this.disposed) {
          reject(new StartupError('disposed', 'Coordinator was disposed'));
        } else {
          setTimeout(checkStage, 100);
        }
      };
      checkStage();
    });
  }
  
  private async withTimeout<T>(
    promise: Promise<T>,
    timeout: number,
    message: string
  ): Promise<T> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        if (!this.disposed) {
          reject(new StartupError('timeout', message));
        }
      }, timeout);
      
      this.timeouts.push(timer);
      
      promise
        .then(result => {
          clearTimeout(timer);
          const index = this.timeouts.indexOf(timer);
          if (index > -1) this.timeouts.splice(index, 1);
          resolve(result);
        })
        .catch(error => {
          clearTimeout(timer);
          const index = this.timeouts.indexOf(timer);
          if (index > -1) this.timeouts.splice(index, 1);
          reject(error);
        });
    });
  }
  
  dispose(): void {
    this.disposed = true;
    this.timeouts.forEach(t => clearTimeout(t));
    this.timeouts = [];
    this.stopStageMonitoring();
  }
}
