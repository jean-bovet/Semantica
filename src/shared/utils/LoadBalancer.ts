/**
 * Configuration for load balancing
 */
export interface LoadBalancerConfig<T> {
  strategy?: 'round-robin' | 'least-loaded' | 'random';
  healthChecker?: (resource: T) => Promise<boolean> | boolean;
  retryAttempts?: number;
  retryDelay?: number;
}

/**
 * Information about a managed resource
 */
export interface ResourceInfo<T> {
  resource: T;
  id: string | number;
  isHealthy: boolean;
  loadCount: number;
  lastUsed: number;
  totalRequests: number;
  errorCount: number;
}

/**
 * Result of a load balancing operation
 */
export interface LoadBalanceResult<T> {
  resource: T | null;
  resourceId: string | number | null;
  attempt: number;
  totalHealthy: number;
}

/**
 * Generic load balancer that distributes requests across multiple resources
 * with support for different strategies, health checking, and automatic retry.
 */
export class LoadBalancer<T> {
  private resources: Map<string | number, ResourceInfo<T>> = new Map();
  private currentIndex = 0;
  private config: Required<LoadBalancerConfig<T>>;

  constructor(config: LoadBalancerConfig<T> = {}) {
    this.config = {
      strategy: 'round-robin',
      healthChecker: () => true,
      retryAttempts: 3,
      retryDelay: 100,
      ...config
    };
  }

  /**
   * Add a resource to the load balancer pool
   */
  addResource(id: string | number, resource: T): void {
    this.resources.set(id, {
      resource,
      id,
      isHealthy: true,
      loadCount: 0,
      lastUsed: 0,
      totalRequests: 0,
      errorCount: 0
    });
  }

  /**
   * Remove a resource from the pool
   */
  removeResource(id: string | number): boolean {
    return this.resources.delete(id);
  }

  /**
   * Get the next available resource using the configured strategy
   */
  async getNext(): Promise<LoadBalanceResult<T>> {
    const healthyResources = await this.getHealthyResources();

    if (healthyResources.length === 0) {
      return {
        resource: null,
        resourceId: null,
        attempt: 0,
        totalHealthy: 0
      };
    }

    let selectedResource: ResourceInfo<T> | null = null;
    let attempt = 0;

    // Try to get a resource with retry logic
    while (attempt < this.config.retryAttempts && !selectedResource) {
      attempt++;

      const candidate = this.selectByStrategy(healthyResources);
      if (candidate) {
        // Check if resource is still healthy
        const isHealthy = await this.checkResourceHealth(candidate);
        if (isHealthy) {
          selectedResource = candidate;
          this.updateResourceUsage(candidate.id);
        } else {
          // Mark as unhealthy and try again
          this.markUnhealthy(candidate.id);
          healthyResources.splice(healthyResources.indexOf(candidate), 1);
        }
      }

      if (!selectedResource && attempt < this.config.retryAttempts) {
        await new Promise(resolve => setTimeout(resolve, this.config.retryDelay));
      }
    }

    return {
      resource: selectedResource?.resource || null,
      resourceId: selectedResource?.id || null,
      attempt,
      totalHealthy: healthyResources.length
    };
  }

  /**
   * Mark a resource as having completed successfully
   */
  markSuccess(id: string | number): void {
    const resource = this.resources.get(id);
    if (resource) {
      resource.loadCount = Math.max(0, resource.loadCount - 1);
      resource.isHealthy = true;
    }
  }

  /**
   * Mark a resource as having failed
   */
  markFailure(id: string | number): void {
    const resource = this.resources.get(id);
    if (resource) {
      resource.errorCount++;
      resource.loadCount = Math.max(0, resource.loadCount - 1);

      // Mark unhealthy if error rate is too high
      const errorRate = resource.errorCount / Math.max(resource.totalRequests, 1);
      if (errorRate > 0.5 && resource.totalRequests > 5) {
        resource.isHealthy = false;
      }
    }
  }

  /**
   * Manually mark a resource as healthy or unhealthy
   */
  markHealth(id: string | number, isHealthy: boolean): void {
    const resource = this.resources.get(id);
    if (resource) {
      resource.isHealthy = isHealthy;
      if (isHealthy) {
        resource.errorCount = 0;
      }
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
    errorRate: number;
    lastUsed: number;
  }> {
    return Array.from(this.resources.values()).map(resource => ({
      id: resource.id,
      isHealthy: resource.isHealthy,
      loadCount: resource.loadCount,
      totalRequests: resource.totalRequests,
      errorCount: resource.errorCount,
      errorRate: resource.totalRequests > 0 ? resource.errorCount / resource.totalRequests : 0,
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
   * Get total number of resources
   */
  getResourceCount(): number {
    return this.resources.size;
  }

  /**
   * Get number of healthy resources
   */
  async getHealthyCount(): Promise<number> {
    const healthy = await this.getHealthyResources();
    return healthy.length;
  }

  /**
   * Check health of all resources
   */
  async checkAllHealth(): Promise<void> {
    const checkPromises = Array.from(this.resources.values()).map(async (resource) => {
      const isHealthy = await this.checkResourceHealth(resource);
      resource.isHealthy = isHealthy;
    });

    await Promise.all(checkPromises);
  }

  /**
   * Clear all resources
   */
  clear(): void {
    this.resources.clear();
    this.currentIndex = 0;
  }

  /**
   * Get healthy resources
   */
  private async getHealthyResources(): Promise<ResourceInfo<T>[]> {
    const allResources = Array.from(this.resources.values());
    const healthyResources: ResourceInfo<T>[] = [];

    for (const resource of allResources) {
      if (resource.isHealthy) {
        healthyResources.push(resource);
      }
    }

    return healthyResources;
  }

  /**
   * Select a resource based on the configured strategy
   */
  private selectByStrategy(resources: ResourceInfo<T>[]): ResourceInfo<T> | null {
    if (resources.length === 0) {
      return null;
    }

    switch (this.config.strategy) {
      case 'round-robin':
        return this.selectRoundRobin(resources);

      case 'least-loaded':
        return this.selectLeastLoaded(resources);

      case 'random':
        return this.selectRandom(resources);

      default:
        return this.selectRoundRobin(resources);
    }
  }

  /**
   * Round-robin selection
   */
  private selectRoundRobin(resources: ResourceInfo<T>[]): ResourceInfo<T> {
    const resource = resources[this.currentIndex % resources.length];
    this.currentIndex = (this.currentIndex + 1) % resources.length;
    return resource;
  }

  /**
   * Least-loaded selection (lowest current load count)
   */
  private selectLeastLoaded(resources: ResourceInfo<T>[]): ResourceInfo<T> {
    return resources.reduce((least, current) =>
      current.loadCount < least.loadCount ? current : least
    );
  }

  /**
   * Random selection
   */
  private selectRandom(resources: ResourceInfo<T>[]): ResourceInfo<T> {
    const randomIndex = Math.floor(Math.random() * resources.length);
    return resources[randomIndex];
  }

  /**
   * Check if a specific resource is healthy
   */
  private async checkResourceHealth(resource: ResourceInfo<T>): Promise<boolean> {
    try {
      return await this.config.healthChecker(resource.resource);
    } catch {
      return false;
    }
  }

  /**
   * Update resource usage statistics
   */
  private updateResourceUsage(id: string | number): void {
    const resource = this.resources.get(id);
    if (resource) {
      resource.loadCount++;
      resource.totalRequests++;
      resource.lastUsed = Date.now();
    }
  }

  /**
   * Mark a resource as unhealthy
   */
  private markUnhealthy(id: string | number): void {
    const resource = this.resources.get(id);
    if (resource) {
      resource.isHealthy = false;
    }
  }
}