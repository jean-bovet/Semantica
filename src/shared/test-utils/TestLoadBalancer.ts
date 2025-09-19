import type { LoadBalanceResult, ResourceInfo } from '../utils/LoadBalancer';

/**
 * Test implementation of LoadBalancer for predictable test behavior.
 * Always cycles through provided resources in order.
 */
export class TestLoadBalancer<T> {
  private resources = new Map<string | number, ResourceInfo<T>>();
  private currentIndex = 0;

  constructor(_config?: any) {
    // Test implementation ignores config for simplicity
  }

  /**
   * Add a resource to the load balancer
   */
  addResource(id: string | number, resource: T): void {
    this.resources.set(id, {
      resource,
      id,
      isHealthy: true, // Test resources are always healthy
      loadCount: 0,
      lastUsed: Date.now(),
      totalRequests: 0,
      errorCount: 0
    });
  }

  /**
   * Remove a resource from the load balancer
   */
  removeResource(id: string | number): boolean {
    return this.resources.delete(id);
  }

  /**
   * Get next resource using simple round-robin
   */
  async getNext(): Promise<LoadBalanceResult<T>> {
    const resourceArray = Array.from(this.resources.values());

    if (resourceArray.length === 0) {
      return {
        resource: null,
        resourceId: null,
        attempt: 0,
        totalHealthy: 0
      };
    }

    // Simple round-robin selection
    const selectedResource = resourceArray[this.currentIndex % resourceArray.length];
    this.currentIndex = (this.currentIndex + 1) % resourceArray.length;

    // Update stats
    selectedResource.loadCount++;
    selectedResource.totalRequests++;
    selectedResource.lastUsed = Date.now();

    return {
      resource: selectedResource.resource,
      resourceId: selectedResource.id,
      attempt: 1,
      totalHealthy: resourceArray.length
    };
  }

  /**
   * Mark a request as successful
   */
  markSuccess(id: string | number): void {
    const resource = this.resources.get(id);
    if (resource) {
      resource.loadCount = Math.max(0, resource.loadCount - 1);
    }
  }

  /**
   * Mark a request as failed
   */
  markFailure(id: string | number): void {
    const resource = this.resources.get(id);
    if (resource) {
      resource.errorCount++;
      resource.loadCount = Math.max(0, resource.loadCount - 1);
    }
  }

  /**
   * Mark resource health status
   */
  markHealth(id: string | number, isHealthy: boolean): void {
    const resource = this.resources.get(id);
    if (resource) {
      resource.isHealthy = isHealthy;
    }
  }

  /**
   * Get statistics for all resources
   */
  getStats(): Array<{
    id: string | number;
    isHealthy: boolean;
    loadCount: number;
    totalRequests: number;
    errorCount: number;
    lastUsed: number;
  }> {
    return Array.from(this.resources.values()).map(resource => ({
      id: resource.id,
      isHealthy: resource.isHealthy,
      loadCount: resource.loadCount,
      totalRequests: resource.totalRequests,
      errorCount: resource.errorCount,
      lastUsed: resource.lastUsed
    }));
  }

  /**
   * Get all resource IDs
   */
  getResourceIds(): Array<string | number> {
    return Array.from(this.resources.keys());
  }

  /**
   * Get total resource count
   */
  getResourceCount(): number {
    return this.resources.size;
  }

  /**
   * Get count of healthy resources
   */
  async getHealthyCount(): Promise<number> {
    return Array.from(this.resources.values()).filter(r => r.isHealthy).length;
  }

  /**
   * Check health of all resources (no-op in test)
   */
  async checkAllHealth(): Promise<void> {
    // Test implementation does nothing - all resources stay healthy
  }

  /**
   * Clear all resources
   */
  clear(): void {
    this.resources.clear();
    this.currentIndex = 0;
  }
}