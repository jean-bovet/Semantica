export interface StartupSensors {
  waitForWorker(): Promise<void>;
  waitForModel(): Promise<void>;
  waitForFiles(): Promise<void>;
  waitForStats(): Promise<any>;
}

export interface StartupActions {
  showWindow(): void;
  notifyFilesLoaded(): void;
  notifyReady(): void;
  notifyError(error: StartupError): void;
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
  
  constructor(
    private sensors: StartupSensors,
    private actions: StartupActions,
    private options = { workerTimeout: 10000 }
  ) {}
  
  async coordinate(): Promise<void> {
    // Show window immediately
    this.actions.showWindow();
    
    try {
      // Wait for worker with timeout
      await this.withTimeout(
        this.sensors.waitForWorker(),
        this.options.workerTimeout,
        'Worker initialization timeout'
      );
      
      // Load model and files in parallel
      const [modelResult, filesResult] = await Promise.allSettled([
        this.sensors.waitForModel(),
        this.sensors.waitForFiles()
      ]);
      
      if (modelResult.status === 'rejected') {
        throw new StartupError('model-failed', modelResult.reason);
      }
      
      if (filesResult.status === 'rejected') {
        throw new StartupError('files-failed', filesResult.reason);
      }
      
      // Compute stats before notifying
      await this.sensors.waitForStats();
      
      // All ready - notify renderer
      this.actions.notifyFilesLoaded();
      this.actions.notifyReady();
      
    } catch (error) {
      this.actions.notifyError(error as StartupError);
      throw error;
    }
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
  }
}
