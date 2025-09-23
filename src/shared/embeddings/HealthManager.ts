import { EventEmitter } from 'node:events';

/**
 * Health status of a managed resource
 */
export interface HealthStatus {
  isHealthy: boolean;
  lastCheck: number;
  errorCount: number;
  consecutiveErrors: number;
  uptime: number;
  lastError?: Error;
}

/**
 * Configuration for health management
 */
export interface HealthManagerConfig<T> {
  checkInterval?: number;
  unhealthyThreshold?: number;
  maxConsecutiveErrors?: number;
  restartDelay?: number;
  maxRestarts?: number;
  healthChecker?: (resource: T, id: string) => Promise<boolean>;
  restartHandler?: (resource: T, id: string) => Promise<void>;
}

/**
 * Events emitted by HealthManager
 */
export interface HealthManagerEvents {
  unhealthy: (id: string, status: HealthStatus) => void;
  healthy: (id: string, status: HealthStatus) => void;
  restart: (id: string, attempt: number) => void;
  restartFailed: (id: string, error: Error) => void;
  maxRestartsExceeded: (id: string) => void;
}

/**
 * Information about a managed resource
 */
export interface ManagedResource<T> {
  resource: T;
  status: HealthStatus;
  restartCount: number;
  isRestarting: boolean;
  startTime: number;
}

/**
 * Health manager that monitors resource health and handles automatic restarts
 */
export class HealthManager<T> extends EventEmitter {
  private resources = new Map<string, ManagedResource<T>>();
  private config: Required<HealthManagerConfig<T>>;
  private checkTimer: NodeJS.Timeout | null = null;
  private isRunning = false;

  constructor(config: HealthManagerConfig<T> = {}) {
    super();

    this.config = {
      checkInterval: 30000, // 30 seconds
      unhealthyThreshold: 3,
      maxConsecutiveErrors: 5,
      restartDelay: 2000,
      maxRestarts: 3,
      healthChecker: async () => true,
      restartHandler: async () => {},
      ...config
    };
  }

  /**
   * Add a resource to be managed
   */
  addResource(id: string, resource: T): void {
    this.resources.set(id, {
      resource,
      status: {
        isHealthy: true,
        lastCheck: Date.now(),
        errorCount: 0,
        consecutiveErrors: 0,
        uptime: 0
      },
      restartCount: 0,
      isRestarting: false,
      startTime: Date.now()
    });
  }

  /**
   * Remove a resource from management
   */
  removeResource(id: string): boolean {
    return this.resources.delete(id);
  }

  /**
   * Get health status of a specific resource
   */
  getHealth(id: string): HealthStatus | null {
    const managed = this.resources.get(id);
    if (!managed) return null;

    return {
      ...managed.status,
      uptime: Date.now() - managed.startTime
    };
  }

  /**
   * Get health status of all resources
   */
  getAllHealth(): Map<string, HealthStatus> {
    const healthMap = new Map<string, HealthStatus>();

    for (const [id, managed] of this.resources) {
      healthMap.set(id, {
        ...managed.status,
        uptime: Date.now() - managed.startTime
      });
    }

    return healthMap;
  }

  /**
   * Manually mark a resource as healthy or unhealthy
   */
  setHealth(id: string, isHealthy: boolean, error?: Error): void {
    const managed = this.resources.get(id);
    if (!managed) return;

    const wasHealthy = managed.status.isHealthy;
    managed.status.isHealthy = isHealthy;
    managed.status.lastCheck = Date.now();

    if (!isHealthy) {
      managed.status.errorCount++;
      managed.status.consecutiveErrors++;
      if (error) {
        managed.status.lastError = error;
      }

      // Emit unhealthy event if status changed or consecutive errors exceeded
      if (wasHealthy || managed.status.consecutiveErrors >= this.config.unhealthyThreshold) {
        this.emit('unhealthy', id, managed.status);

        // Auto-restart if configured and not already restarting
        if (!managed.isRestarting &&
            managed.status.consecutiveErrors >= this.config.maxConsecutiveErrors &&
            managed.restartCount < this.config.maxRestarts) {
          this.scheduleRestart(id);
        }
      }
    } else {
      managed.status.consecutiveErrors = 0;

      // Emit healthy event if status changed
      if (!wasHealthy) {
        this.emit('healthy', id, managed.status);
      }
    }
  }

  /**
   * Start periodic health checking
   */
  start(): void {
    if (this.isRunning) return;

    this.isRunning = true;
    this.scheduleNextCheck();
  }

  /**
   * Stop periodic health checking
   */
  stop(): void {
    this.isRunning = false;

    if (this.checkTimer) {
      clearTimeout(this.checkTimer);
      this.checkTimer = null;
    }
  }

  /**
   * Perform immediate health check on all resources
   */
  async checkAllHealth(): Promise<void> {
    const checks = Array.from(this.resources.keys()).map(id => this.checkResourceHealth(id));
    await Promise.all(checks);
  }

  /**
   * Perform immediate health check on a specific resource
   */
  async checkResourceHealth(id: string): Promise<boolean> {
    const managed = this.resources.get(id);
    if (!managed || managed.isRestarting) {
      return false;
    }

    try {
      const isHealthy = await this.config.healthChecker(managed.resource, id);
      this.setHealth(id, isHealthy);
      return isHealthy;
    } catch (error: any) {
      this.setHealth(id, false, error);
      return false;
    }
  }

  /**
   * Force restart a specific resource
   */
  async restartResource(id: string): Promise<boolean> {
    const managed = this.resources.get(id);
    if (!managed || managed.isRestarting) {
      return false;
    }

    return this.performRestart(id);
  }

  /**
   * Get statistics for all managed resources
   */
  getStats(): Array<{
    id: string;
    isHealthy: boolean;
    errorCount: number;
    consecutiveErrors: number;
    restartCount: number;
    isRestarting: boolean;
    uptime: number;
  }> {
    return Array.from(this.resources.entries()).map(([id, managed]) => ({
      id,
      isHealthy: managed.status.isHealthy,
      errorCount: managed.status.errorCount,
      consecutiveErrors: managed.status.consecutiveErrors,
      restartCount: managed.restartCount,
      isRestarting: managed.isRestarting,
      uptime: Date.now() - managed.startTime
    }));
  }

  /**
   * Get list of unhealthy resources
   */
  getUnhealthyResources(): string[] {
    return Array.from(this.resources.entries())
      .filter(([_, managed]) => !managed.status.isHealthy)
      .map(([id]) => id);
  }

  /**
   * Get list of healthy resources
   */
  getHealthyResources(): string[] {
    return Array.from(this.resources.entries())
      .filter(([_, managed]) => managed.status.isHealthy && !managed.isRestarting)
      .map(([id]) => id);
  }

  /**
   * Clear all managed resources
   */
  clear(): void {
    this.stop();
    this.resources.clear();
  }

  /**
   * Schedule next health check
   */
  private scheduleNextCheck(): void {
    if (!this.isRunning) return;

    this.checkTimer = setTimeout(async () => {
      if (this.isRunning) {
        await this.checkAllHealth();
        this.scheduleNextCheck();
      }
    }, this.config.checkInterval);
  }

  /**
   * Schedule a restart for a resource
   */
  private scheduleRestart(id: string): void {
    setTimeout(() => {
      this.performRestart(id);
    }, this.config.restartDelay);
  }

  /**
   * Perform restart of a resource
   */
  private async performRestart(id: string): Promise<boolean> {
    const managed = this.resources.get(id);
    if (!managed || managed.isRestarting) {
      return false;
    }

    // Check if we've exceeded max restarts
    if (managed.restartCount >= this.config.maxRestarts) {
      this.emit('maxRestartsExceeded', id);
      return false;
    }

    managed.isRestarting = true;
    managed.restartCount++;

    try {
      this.emit('restart', id, managed.restartCount);

      // Call the restart handler
      await this.config.restartHandler(managed.resource, id);

      // Reset health status after successful restart
      managed.status.isHealthy = true;
      managed.status.consecutiveErrors = 0;
      managed.status.lastCheck = Date.now();
      managed.startTime = Date.now(); // Reset uptime
      managed.isRestarting = false;

      return true;
    } catch (error: any) {
      managed.isRestarting = false;
      this.emit('restartFailed', id, error);
      this.setHealth(id, false, error);
      return false;
    }
  }
}

// TypeScript event emitter typing
export interface HealthManager<_T> {
  on<K extends keyof HealthManagerEvents>(event: K, listener: HealthManagerEvents[K]): this;
  emit<K extends keyof HealthManagerEvents>(event: K, ...args: Parameters<HealthManagerEvents[K]>): boolean;
}