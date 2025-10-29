/**
 * Interface for text embedding services
 * Allows for different implementations (isolated process, test, cloud-based, etc.)
 */
export interface IEmbedder {
  /**
   * Initialize the embedder (load models, spawn processes, etc.)
   * @returns Promise that resolves when initialization is complete
   */
  initialize(): Promise<boolean>;

  /**
   * Embed text strings into vector representations
   * @param texts Array of text strings to embed
   * @returns Promise resolving to array of embedding vectors
   */
  embed(texts: string[]): Promise<number[][]>;

  /**
   * Embed text with retry logic
   * @param texts Array of text strings to embed
   * @param maxRetries Maximum number of retry attempts
   * @returns Promise resolving to array of embedding vectors
   */
  embedWithRetry(texts: string[], maxRetries?: number): Promise<number[][]>;

  /**
   * Check if the embedder should restart (e.g., due to memory usage)
   * @returns Promise resolving to boolean indicating if restart is needed
   */
  shouldRestart(): Promise<boolean>;

  /**
   * Restart the embedder (cleanup and reinitialize)
   * @returns Promise that resolves when restart is complete
   */
  restart(): Promise<void>;

  /**
   * Shutdown the embedder and cleanup resources
   * @returns Promise that resolves when shutdown is complete
   */
  shutdown(): Promise<void>;

  /**
   * Get current statistics about the embedder
   * @returns Object with embedder statistics
   */
  getStats(): {
    filesSinceSpawn: number;
    isReady: boolean;
    memoryUsage?: {
      rss: number;
      heapUsed: number;
      external: number;
    };
  };
}

/**
 * Configuration options for embedders
 */
export interface EmbedderConfig {
  modelName?: string;
  maxFilesBeforeRestart?: number;
  maxMemoryMB?: number;
  batchSize?: number;
}