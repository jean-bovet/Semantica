import { IsolatedEmbedder } from './isolated';

export interface EmbedderPoolConfig {
  modelName?: string;
  poolSize?: number;
  maxFilesBeforeRestart?: number;
  maxMemoryMB?: number;
  onEmbedderRestart?: (embedderIndex: number) => void;
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
  private restartingEmbedders = new Set<number>();  // Track which embedders are restarting
  private restartMutex = new Map<number, Promise<void>>();  // Prevent concurrent restarts
  
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
    // Create embedder instances
    for (let i = 0; i < poolSize; i++) {
      const embedder = new IsolatedEmbedder(this.modelName, {
        maxFilesBeforeRestart: this.config.maxFilesBeforeRestart!,
        maxMemoryMB: this.config.maxMemoryMB!
      });
      this.embedders.push(embedder);
    }
    
    // Initialize all embedders in parallel
    const initPromises = this.embedders.map((embedder) => {
      return embedder.initialize();
    });
    
    await Promise.all(initPromises);
    console.log(`[EmbedderPool] Initialized ${poolSize} embedder processes`);
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
   * Includes retry logic with automatic recovery on embedder failure
   */
  async embed(texts: string[], isQuery: boolean = false): Promise<number[][]> {
    if (!this.initPromise) {
      await this.initialize();
    }

    let lastError: Error | null = null;
    const maxRetries = 3;

    for (let attempt = 0; attempt < maxRetries; attempt++) {
      try {
        const beforeIndex = this.currentIndex;
        const embedder = this.getNextEmbedder();
        console.log(`[EmbedderPool] Attempting embedding with embedder ${beforeIndex}, ${texts.length} texts`);
        const result = await embedder.embed(texts, isQuery);
        console.log(`[EmbedderPool] Embedding successful with embedder ${beforeIndex}`);
        return result;
      } catch (error: any) {
        lastError = error;
        console.error(`[EmbedderPool] Embedding attempt ${attempt + 1} failed:`, error.message);
        
        // If embedder process died, try to recover
        if (error.message?.includes('Embedder process exited') || 
            error.message?.includes('Child process is not ready')) {
          
          // Find and restart the failed embedder
          for (let i = 0; i < this.embedders.length; i++) {
            try {
              const stats = this.embedders[i].getStats();
              if (!stats.isReady && !this.restartingEmbedders.has(i)) {
                await this.restart(i);  // Use mutex-protected restart
              }
            } catch (_error) {
              // Embedder might be in a bad state, try to restart it
              if (!this.restartingEmbedders.has(i)) {
                await this.restart(i);
              }
            }
          }
          
          // Wait a bit before retry
          await new Promise(r => setTimeout(r, 1000));
        }
      }
    }
    
    throw new Error(`Failed to generate embeddings after ${maxRetries} attempts: ${lastError?.message}`);
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
   * Restart a specific embedder or all embedders with mutex protection
   */
  async restart(index?: number): Promise<void> {
    if (index !== undefined) {
      if (index < 0 || index >= this.embedders.length) {
        throw new Error(`Invalid embedder index: ${index}`);
      }

      // Check if already restarting
      if (this.restartMutex.has(index)) {
        return this.restartMutex.get(index);
      }

      // Create restart promise with mutex
      const restartPromise = (async () => {
        try {
          this.restartingEmbedders.add(index);

          // Notify callback before restart so queue can prepare
          if (this.config.onEmbedderRestart) {
            this.config.onEmbedderRestart(index);
          }

          await this.embedders[index].restart();
        } catch (error) {
          console.error(`[EmbedderPool] Failed to restart embedder ${index}:`, error);
          throw error;
        } finally {
          this.restartingEmbedders.delete(index);
          this.restartMutex.delete(index);
        }
      })();

      this.restartMutex.set(index, restartPromise);
      return restartPromise;
    } else {
      await Promise.all(this.embedders.map((_, i) => this.restart(i)));
    }
  }
  
  /**
   * Dispose of all embedder processes
   */
  async dispose(): Promise<void> {
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
  
  /**
   * Check health of all embedders and restart unhealthy ones
   */
  async checkHealth(): Promise<void> {
    for (let i = 0; i < this.embedders.length; i++) {
      try {
        const stats = this.embedders[i].getStats();
        if (!stats.isReady && !this.restartingEmbedders.has(i)) {
          console.log(`[EmbedderPool] Embedder ${i} is not ready, restarting...`);
          await this.restart(i);
        }
      } catch (error) {
        console.error(`[EmbedderPool] Error checking health of embedder ${i}:`, error);
        try {
          await this.restart(i);
        } catch (restartError) {
          console.error(`[EmbedderPool] Failed to restart embedder ${i}:`, restartError);
          // Replace with new instance as last resort
          const newEmbedder = new IsolatedEmbedder(this.modelName, {
            maxFilesBeforeRestart: this.config.maxFilesBeforeRestart!,
            maxMemoryMB: this.config.maxMemoryMB!
          });
          this.embedders[i] = newEmbedder;
          try {
            await newEmbedder.initialize();
          } catch (initError) {
            console.error(`[EmbedderPool] Failed to initialize replacement embedder ${i}:`, initError);
          }
        }
      }
    }
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