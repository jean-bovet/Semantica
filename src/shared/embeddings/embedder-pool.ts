import { IsolatedEmbedder } from './isolated';
import { LoadBalancer } from '../utils/LoadBalancer';
import { HealthManager } from './HealthManager';
import { EmbedderFactory } from './EmbedderFactory';

/**
 * Dependencies that can be injected for testing
 */
export interface EmbedderPoolDependencies {
  loadBalancer?: LoadBalancer<IsolatedEmbedder>;
  healthManager?: HealthManager<IsolatedEmbedder>;
  factory?: EmbedderFactory;
}

export interface EmbedderPoolConfig {
  modelName?: string;
  poolSize?: number;
  maxFilesBeforeRestart?: number;
  maxMemoryMB?: number;
  onEmbedderRestart?: (embedderIndex: number) => void;

  // Load balancing options
  loadBalancingStrategy?: 'round-robin' | 'least-loaded' | 'random';

  // Health management options
  healthCheckInterval?: number;
  maxConsecutiveErrors?: number;
  restartDelay?: number;
  maxRestarts?: number;

  // Factory options
  factoryConfig?: any;

  // Dependency injection
  dependencies?: EmbedderPoolDependencies;
}

/**
 * Manages a pool of embedder processes for parallel embedding generation.
 * Uses LoadBalancer for request distribution and HealthManager for monitoring.
 */
export class EmbedderPool {
  private embedders = new Map<string, IsolatedEmbedder>();
  private loadBalancer: LoadBalancer<IsolatedEmbedder>;
  private healthManager: HealthManager<IsolatedEmbedder>;
  private factory: EmbedderFactory;
  private config: Required<Omit<EmbedderPoolConfig, 'dependencies'>>;
  private initPromise: Promise<void> | null = null;

  constructor(config: EmbedderPoolConfig = {}) {
    this.config = {
      modelName: config.modelName || 'Xenova/multilingual-e5-small',
      poolSize: config.poolSize || 2,
      maxFilesBeforeRestart: config.maxFilesBeforeRestart || 5000,
      maxMemoryMB: config.maxMemoryMB || 1500,
      loadBalancingStrategy: config.loadBalancingStrategy || 'round-robin',
      healthCheckInterval: config.healthCheckInterval || 30000,
      maxConsecutiveErrors: config.maxConsecutiveErrors || 3,
      restartDelay: config.restartDelay || 2000,
      maxRestarts: config.maxRestarts || 5,
      onEmbedderRestart: config.onEmbedderRestart || (() => {}),
      factoryConfig: config.factoryConfig || {} as any
    };

    // Initialize factory with dependency injection
    this.factory = config.dependencies?.factory || new EmbedderFactory({
      modelName: this.config.modelName,
      maxFilesBeforeRestart: this.config.maxFilesBeforeRestart,
      maxMemoryMB: this.config.maxMemoryMB,
      ...this.config.factoryConfig
    });

    // Initialize load balancer with dependency injection
    this.loadBalancer = config.dependencies?.loadBalancer || new LoadBalancer<IsolatedEmbedder>({
      strategy: this.config.loadBalancingStrategy,
      healthChecker: async (embedder) => {
        const stats = embedder.getStats();
        return stats.isReady;
      },
      retryAttempts: 3,
      retryDelay: 100
    });

    // Initialize health manager with dependency injection
    this.healthManager = config.dependencies?.healthManager || new HealthManager<IsolatedEmbedder>({
      checkInterval: this.config.healthCheckInterval,
      maxConsecutiveErrors: this.config.maxConsecutiveErrors,
      restartDelay: this.config.restartDelay,
      maxRestarts: this.config.maxRestarts,
      healthChecker: async (embedder, id) => {
        try {
          const stats = embedder.getStats();
          return stats.isReady;
        } catch {
          return false;
        }
      },
      restartHandler: async (embedder, id) => {
        console.log(`[EmbedderPool] Restarting embedder ${id}`);
        this.config.onEmbedderRestart(parseInt(id, 10));
        await embedder.restart();
      }
    });

    // Set up health manager event handlers
    this.setupHealthManagerEvents();
  }

  /**
   * Set up health manager event handlers
   */
  private setupHealthManagerEvents(): void {
    this.healthManager.on('restart', (id, attempt) => {
      console.log(`[EmbedderPool] Health manager restarting embedder ${id}, attempt ${attempt}`);
      this.loadBalancer.markHealth(id, false);
    });

    this.healthManager.on('healthy', (id) => {
      console.log(`[EmbedderPool] Embedder ${id} is now healthy`);
      this.loadBalancer.markHealth(id, true);
    });

    this.healthManager.on('unhealthy', (id) => {
      console.log(`[EmbedderPool] Embedder ${id} is unhealthy`);
      this.loadBalancer.markHealth(id, false);
    });

    this.healthManager.on('maxRestartsExceeded', (id) => {
      console.error(`[EmbedderPool] Embedder ${id} exceeded max restarts, removing from pool`);
      this.removeEmbedder(id);
    });
  }

  /**
   * Initialize all embedder processes in the pool
   */
  async initialize(): Promise<void> {
    if (this.initPromise) {
      return this.initPromise;
    }

    this.initPromise = this._initialize();
    return this.initPromise;
  }

  private async _initialize(): Promise<void> {
    const poolSize = this.config.poolSize;

    // Create embedder instances using factory
    for (let i = 0; i < poolSize; i++) {
      const embedder = this.factory.createIsolatedEmbedder();
      const embedderId = i.toString();

      this.embedders.set(embedderId, embedder);
      this.loadBalancer.addResource(embedderId, embedder);
      this.healthManager.addResource(embedderId, embedder);
    }

    // Initialize all embedders in parallel
    const initPromises = Array.from(this.embedders.values()).map(embedder =>
      embedder.initialize()
    );

    await Promise.all(initPromises);

    // Start health monitoring
    this.healthManager.start();

    console.log(`[EmbedderPool] Initialized ${poolSize} embedder processes`);
  }
  
  /**
   * Generate embeddings for texts using load balancer with automatic failover
   */
  async embed(texts: string[], isQuery: boolean = false): Promise<number[][]> {
    if (!this.initPromise) {
      await this.initialize();
    }

    const result = await this.loadBalancer.getNext();

    if (!result.resource) {
      throw new Error('No healthy embedders available in pool');
    }

    try {
      console.log(`[EmbedderPool] Using embedder ${result.resourceId} for ${texts.length} texts`);

      const vectors = await result.resource.embed(texts, isQuery);

      // Mark success for load balancer
      this.loadBalancer.markSuccess(result.resourceId!);

      console.log(`[EmbedderPool] Embedding successful with embedder ${result.resourceId}`);
      return vectors;
    } catch (error: any) {
      console.error(`[EmbedderPool] Embedding failed with embedder ${result.resourceId}:`, error.message);

      // Mark failure for both load balancer and health manager
      this.loadBalancer.markFailure(result.resourceId!);
      this.healthManager.setHealth(result.resourceId!.toString(), false, error);

      throw error;
    }
  }
  
  /**
   * Generate embeddings using a specific embedder ID (for testing or specific distribution)
   */
  async embedWithId(texts: string[], embedderId: string, isQuery: boolean = false): Promise<number[][]> {
    if (!this.initPromise) {
      await this.initialize();
    }

    const embedder = this.embedders.get(embedderId);
    if (!embedder) {
      throw new Error(`Invalid embedder ID: ${embedderId}. Available IDs: ${Array.from(this.embedders.keys()).join(', ')}`);
    }

    return embedder.embed(texts, isQuery);
  }
  
  /**
   * Get statistics for all embedders in the pool
   */
  getStats(): Array<{
    id: string;
    filesProcessed: number;
    memoryUsage: number;
    isHealthy: boolean;
    loadCount: number;
    restartCount: number;
  }> {
    const stats = [];
    const loadBalancerStats = this.loadBalancer.getStats();
    const healthManagerStats = this.healthManager.getStats();

    for (const [id, embedder] of this.embedders) {
      const embedderStat = embedder.getStats();
      const loadStat = loadBalancerStats.find(s => s.id === id);
      const healthStat = healthManagerStats.find(s => s.id === id);

      stats.push({
        id,
        filesProcessed: embedderStat.filesSinceSpawn,
        memoryUsage: embedderStat.memoryUsage?.rss || 0,
        isHealthy: healthStat?.isHealthy || false,
        loadCount: loadStat?.loadCount || 0,
        restartCount: healthStat?.restartCount || 0
      });
    }

    return stats;
  }
  
  /**
   * Restart a specific embedder by ID
   */
  async restartEmbedder(embedderId: string): Promise<void> {
    const embedder = this.embedders.get(embedderId);
    if (!embedder) {
      throw new Error(`Invalid embedder ID: ${embedderId}`);
    }

    // Use health manager to handle restart
    await this.healthManager.restartResource(embedderId);
  }

  /**
   * Restart all embedders
   */
  async restartAll(): Promise<void> {
    const restartPromises = Array.from(this.embedders.keys()).map(id =>
      this.restartEmbedder(id)
    );

    await Promise.all(restartPromises);
  }

  /**
   * Remove an embedder from the pool
   */
  private removeEmbedder(embedderId: string): void {
    const embedder = this.embedders.get(embedderId);
    if (embedder) {
      // Shutdown the embedder
      embedder.shutdown().catch(error => {
        console.error(`[EmbedderPool] Error shutting down embedder ${embedderId}:`, error);
      });

      // Remove from all managers
      this.embedders.delete(embedderId);
      this.loadBalancer.removeResource(embedderId);
      this.healthManager.removeResource(embedderId);

      console.log(`[EmbedderPool] Removed embedder ${embedderId} from pool`);
    }
  }
  
  /**
   * Dispose of all embedder processes
   */
  async dispose(): Promise<void> {
    // Stop health monitoring
    this.healthManager.stop();

    // Shutdown all embedders
    const shutdownPromises = Array.from(this.embedders.values()).map(embedder =>
      embedder.shutdown()
    );

    await Promise.all(shutdownPromises);

    // Clear all collections
    this.embedders.clear();
    this.loadBalancer.clear();
    this.healthManager.clear();

    this.initPromise = null;
  }

  /**
   * Get the current pool size
   */
  getPoolSize(): number {
    return this.embedders.size;
  }

  /**
   * Get list of embedder IDs
   */
  getEmbedderIds(): string[] {
    return Array.from(this.embedders.keys());
  }

  /**
   * Check if pool is initialized
   */
  isInitialized(): boolean {
    return this.embedders.size > 0 && this.initPromise !== null;
  }

  /**
   * Check health of all embedders
   */
  async checkHealth(): Promise<void> {
    await this.healthManager.checkAllHealth();
  }

  /**
   * Get health status of all embedders
   */
  getHealthStatus(): Map<string, any> {
    return this.healthManager.getAllHealth();
  }

  /**
   * Get load balancer statistics
   */
  getLoadBalancerStats() {
    return this.loadBalancer.getStats();
  }
}

// Legacy singleton management - DEPRECATED: Use dependency injection instead
let legacyEmbedderPool: EmbedderPool | null = null;

/**
 * @deprecated Use dependency injection and create EmbedderPool instances directly
 * Get or create the global embedder pool instance
 */
export function getEmbedderPool(config?: EmbedderPoolConfig): EmbedderPool {
  console.warn('[DEPRECATED] getEmbedderPool() is deprecated. Create EmbedderPool instances directly with dependency injection.');

  if (!legacyEmbedderPool) {
    legacyEmbedderPool = new EmbedderPool(config);
  }
  return legacyEmbedderPool;
}

/**
 * @deprecated Use embedderPool.dispose() directly instead
 * Dispose of the global embedder pool
 */
export async function disposeEmbedderPool(): Promise<void> {
  console.warn('[DEPRECATED] disposeEmbedderPool() is deprecated. Use embedderPool.dispose() directly instead.');

  if (legacyEmbedderPool) {
    await legacyEmbedderPool.dispose();
    legacyEmbedderPool = null;
  }
}

/**
 * Create a new EmbedderPool instance with factory-based configuration
 * This is the recommended way to create embedder pools
 */
export function createEmbedderPool(config?: EmbedderPoolConfig): EmbedderPool {
  return new EmbedderPool(config);
}

/**
 * Create an embedder pool optimized for production use
 */
export function createProductionEmbedderPool(overrides?: Partial<EmbedderPoolConfig>): EmbedderPool {
  return new EmbedderPool({
    poolSize: 2,
    maxFilesBeforeRestart: 5000,
    maxMemoryMB: 1500,
    loadBalancingStrategy: 'round-robin',
    healthCheckInterval: 30000,
    maxConsecutiveErrors: 3,
    restartDelay: 2000,
    maxRestarts: 5,
    ...overrides
  });
}

/**
 * Create an embedder pool optimized for testing
 */
export function createTestEmbedderPool(overrides?: Partial<EmbedderPoolConfig>): EmbedderPool {
  return new EmbedderPool({
    poolSize: 1,
    maxFilesBeforeRestart: 10,
    maxMemoryMB: 100,
    loadBalancingStrategy: 'round-robin',
    healthCheckInterval: 5000,
    maxConsecutiveErrors: 2,
    restartDelay: 500,
    maxRestarts: 2,
    ...overrides
  });
}