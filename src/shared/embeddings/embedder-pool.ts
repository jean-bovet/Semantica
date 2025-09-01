import { IsolatedEmbedder } from './isolated';

export interface EmbedderPoolConfig {
  modelName?: string;
  poolSize?: number;
  maxFilesBeforeRestart?: number;
  maxMemoryMB?: number;
}

/**
 * Manages a pool of embedder processes for parallel embedding generation.
 * Distributes work across multiple processes using round-robin scheduling.
 */
export class EmbedderPool {
  private embedders: IsolatedEmbedder[] = [];
  private currentIndex = 0;
  private modelName: string;
  private config: EmbedderPoolConfig;
  private initPromise: Promise<void> | null = null;
  
  constructor(config: EmbedderPoolConfig = {}) {
    this.modelName = config.modelName || 'Xenova/multilingual-e5-small';
    this.config = {
      poolSize: config.poolSize || 2,
      maxFilesBeforeRestart: config.maxFilesBeforeRestart || 5000,
      maxMemoryMB: config.maxMemoryMB || 300,
      ...config
    };
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
    const poolSize = this.config.poolSize!;
    console.log(`[EmbedderPool] Initializing pool with ${poolSize} embedder processes`);
    
    // Create embedder instances
    for (let i = 0; i < poolSize; i++) {
      const embedder = new IsolatedEmbedder(this.modelName, {
        maxFilesBeforeRestart: this.config.maxFilesBeforeRestart!,
        maxMemoryMB: this.config.maxMemoryMB!
      });
      this.embedders.push(embedder);
    }
    
    // Initialize all embedders in parallel
    const initPromises = this.embedders.map((embedder, index) => {
      console.log(`[EmbedderPool] Initializing embedder ${index + 1}/${poolSize}`);
      return embedder.initialize();
    });
    
    await Promise.all(initPromises);
    console.log(`[EmbedderPool] All ${poolSize} embedders initialized successfully`);
  }
  
  /**
   * Get the next embedder in round-robin fashion
   */
  private getNextEmbedder(): IsolatedEmbedder {
    if (this.embedders.length === 0) {
      throw new Error('EmbedderPool not initialized. Call initialize() first.');
    }
    
    const embedder = this.embedders[this.currentIndex];
    this.currentIndex = (this.currentIndex + 1) % this.embedders.length;
    return embedder;
  }
  
  /**
   * Generate embeddings for texts, automatically distributing to next available embedder
   */
  async embed(texts: string[], isQuery: boolean = false): Promise<number[][]> {
    if (!this.initPromise) {
      await this.initialize();
    }
    
    const embedder = this.getNextEmbedder();
    return embedder.embed(texts, isQuery);
  }
  
  /**
   * Generate embeddings using a specific embedder index (for testing or specific distribution)
   */
  async embedWithIndex(texts: string[], index: number, isQuery: boolean = false): Promise<number[][]> {
    if (!this.initPromise) {
      await this.initialize();
    }
    
    if (index < 0 || index >= this.embedders.length) {
      throw new Error(`Invalid embedder index: ${index}. Pool size is ${this.embedders.length}`);
    }
    
    return this.embedders[index].embed(texts, isQuery);
  }
  
  /**
   * Get statistics for all embedders in the pool
   */
  getStats(): Array<{
    index: number;
    filesProcessed: number;
    memoryUsage: number;
    needsRestart: boolean;
  }> {
    const stats = [];
    for (let i = 0; i < this.embedders.length; i++) {
      const embedder = this.embedders[i];
      const stat = embedder.getStats();
      stats.push({
        index: i,
        filesProcessed: stat.filesSinceSpawn,
        memoryUsage: stat.memoryUsage.rss * 1024 * 1024, // Convert MB back to bytes
        needsRestart: false // We handle restarts via the restart() method
      });
    }
    return stats;
  }
  
  /**
   * Restart a specific embedder or all embedders
   */
  async restart(index?: number): Promise<void> {
    if (index !== undefined) {
      if (index < 0 || index >= this.embedders.length) {
        throw new Error(`Invalid embedder index: ${index}`);
      }
      console.log(`[EmbedderPool] Restarting embedder ${index}`);
      await this.embedders[index].restart();
    } else {
      console.log(`[EmbedderPool] Restarting all embedders`);
      await Promise.all(this.embedders.map(e => e.restart()));
    }
  }
  
  /**
   * Dispose of all embedder processes
   */
  async dispose(): Promise<void> {
    console.log(`[EmbedderPool] Disposing ${this.embedders.length} embedder processes`);
    await Promise.all(this.embedders.map(e => e.shutdown()));
    this.embedders = [];
    this.currentIndex = 0;
    this.initPromise = null;
  }
  
  /**
   * Get the current pool size
   */
  getPoolSize(): number {
    return this.embedders.length;
  }
  
  /**
   * Check if pool is initialized
   */
  isInitialized(): boolean {
    return this.embedders.length > 0 && this.initPromise !== null;
  }
}

// Singleton instance management
let embedderPool: EmbedderPool | null = null;

/**
 * Get or create the global embedder pool instance
 */
export function getEmbedderPool(config?: EmbedderPoolConfig): EmbedderPool {
  if (!embedderPool) {
    embedderPool = new EmbedderPool(config);
  }
  return embedderPool;
}

/**
 * Dispose of the global embedder pool
 */
export async function disposeEmbedderPool(): Promise<void> {
  if (embedderPool) {
    await embedderPool.dispose();
    embedderPool = null;
  }
}