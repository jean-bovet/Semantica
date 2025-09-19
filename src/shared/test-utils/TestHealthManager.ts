import { EventEmitter } from 'node:events';
import type { HealthStatus } from '../embeddings/HealthManager';

/**
 * Test implementation of HealthManager for predictable test behavior.
 * Always reports resources as healthy and provides minimal functionality.
 */
export class TestHealthManager<T> extends EventEmitter {
  private resources = new Map<string, { resource: T; status: HealthStatus }>();

  constructor(_config?: any) {
    super();
    // Test implementation ignores config for simplicity
  }

  /**
   * Add a resource to health monitoring
   */
  addResource(id: string, resource: T): void {
    this.resources.set(id, {
      resource,
      status: {
        isHealthy: true, // Test resources are always healthy
        lastCheck: Date.now(),
        errorCount: 0,
        consecutiveErrors: 0,
        uptime: Date.now()
      }
    });
  }

  /**
   * Remove a resource from health monitoring
   */
  removeResource(id: string): boolean {
    return this.resources.delete(id);
  }

  /**
   * Get health status for a specific resource
   */
  getHealth(id: string): HealthStatus | null {
    const resource = this.resources.get(id);
    return resource ? resource.status : null;
  }

  /**
   * Get health status for all resources
   */
  getAllHealth(): Map<string, HealthStatus> {
    const healthMap = new Map<string, HealthStatus>();
    for (const [id, { status }] of this.resources) {
      healthMap.set(id, status);
    }
    return healthMap;
  }

  /**
   * Set health status for a resource
   */
  setHealth(id: string, isHealthy: boolean, error?: Error): void {
    const resource = this.resources.get(id);
    if (resource) {
      resource.status.isHealthy = isHealthy;
      resource.status.lastCheck = Date.now();
      if (error) {
        resource.status.lastError = error;
        resource.status.errorCount++;
        resource.status.consecutiveErrors++;
      } else {
        resource.status.consecutiveErrors = 0;
      }
    }
  }

  /**
   * Start health monitoring (no-op in test)
   */
  start(): void {
    // Test implementation does nothing
  }

  /**
   * Stop health monitoring (no-op in test)
   */
  stop(): void {
    // Test implementation does nothing
  }

  /**
   * Check health of all resources (no-op in test)
   */
  async checkAllHealth(): Promise<void> {
    // Test implementation does nothing - all resources stay healthy
  }

  /**
   * Check health of a specific resource
   */
  async checkResourceHealth(id: string): Promise<boolean> {
    const resource = this.resources.get(id);
    return resource ? resource.status.isHealthy : false;
  }

  /**
   * Restart a resource (no-op in test)
   */
  async restartResource(id: string): Promise<boolean> {
    // Test implementation does nothing, just returns success
    return this.resources.has(id);
  }

  /**
   * Get statistics for all resources
   */
  getStats(): Array<{
    id: string;
    isHealthy: boolean;
    lastCheck: number;
    errorCount: number;
    consecutiveErrors: number;
    restartCount: number;
  }> {
    return Array.from(this.resources.entries()).map(([id, { status }]) => ({
      id,
      isHealthy: status.isHealthy,
      lastCheck: status.lastCheck,
      errorCount: status.errorCount,
      consecutiveErrors: status.consecutiveErrors,
      restartCount: 0 // Test implementation doesn't track restarts
    }));
  }

  /**
   * Get IDs of unhealthy resources
   */
  getUnhealthyResources(): string[] {
    return Array.from(this.resources.entries())
      .filter(([, { status }]) => !status.isHealthy)
      .map(([id]) => id);
  }

  /**
   * Get IDs of healthy resources
   */
  getHealthyResources(): string[] {
    return Array.from(this.resources.entries())
      .filter(([, { status }]) => status.isHealthy)
      .map(([id]) => id);
  }

  /**
   * Clear all resources
   */
  clear(): void {
    this.resources.clear();
    this.removeAllListeners();
  }
}