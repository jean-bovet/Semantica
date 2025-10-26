/**
 * OllamaEmbedder - Embedder implementation using Ollama HTTP API
 *
 * This is a drop-in replacement for the old IsolatedEmbedder and EmbedderCore.
 * It calls the Ollama HTTP API directly from the worker thread - no child processes needed.
 * Ollama server provides process isolation and memory management.
 */

import { IEmbedder, EmbedderConfig } from '../IEmbedder';
import { OllamaClient, OllamaClientError } from '../../../main/worker/OllamaClient';
import { logger } from '../../utils/logger';

// Helper to log with category
const log = (message: string, ...args: any[]) => logger.log('OLLAMA-EMBEDDER', message, ...args);

export interface OllamaEmbedderConfig extends EmbedderConfig {
  client?: OllamaClient;
  keepAlive?: string; // How long to keep model loaded (e.g., '2m', '5m')
  normalizeVectors?: boolean; // L2 normalize vectors for cosine similarity
}

/**
 * Embedder implementation using Ollama HTTP API
 */
export class OllamaEmbedder implements IEmbedder {
  private client: OllamaClient;
  private modelName: string;
  private keepAlive: string;
  private normalizeVectors: boolean;
  private batchSize: number;

  // Stats tracking
  private filesProcessed: number = 0;
  private isInitialized: boolean = false;

  constructor(config: OllamaEmbedderConfig = {}) {
    this.client = config.client || new OllamaClient();
    this.modelName = config.modelName || 'nomic-embed-text';
    this.keepAlive = config.keepAlive || '2m';
    this.normalizeVectors = config.normalizeVectors !== false; // Default true
    this.batchSize = config.batchSize || 32;
  }

  /**
   * Initialize the embedder
   * Checks if Ollama is running and model is available
   */
  async initialize(): Promise<boolean> {
    try {
      log(`Initializing OllamaEmbedder with model: ${this.modelName}`);

      // Check if Ollama is running
      const isRunning = await this.client.checkHealth();
      if (!isRunning) {
        log('Ollama server is not running');
        return false;
      }

      // Check if model is available
      const hasModel = await this.client.hasModel(this.modelName);
      if (!hasModel) {
        log(`Model ${this.modelName} is not available`);
        return false;
      }

      this.isInitialized = true;
      log('OllamaEmbedder initialized successfully');
      return true;
    } catch (error) {
      log('Failed to initialize OllamaEmbedder:', error);
      this.isInitialized = false;
      return false;
    }
  }

  /**
   * Embed texts into vector representations
   * Automatically handles L2 normalization for cosine similarity
   */
  async embed(texts: string[]): Promise<number[][]> {
    if (!this.isInitialized) {
      throw new Error('OllamaEmbedder not initialized. Call initialize() first.');
    }

    if (texts.length === 0) {
      return [];
    }

    try {
      // Call Ollama API
      const embeddings = await this.client.embedBatch(
        texts,
        this.modelName,
        this.keepAlive
      );

      // Normalize vectors if enabled (critical for cosine similarity)
      if (this.normalizeVectors) {
        return embeddings.map((vec) => this.normalizeVector(vec));
      }

      return embeddings;
    } catch (error) {
      if (error instanceof OllamaClientError) {
        log(`Embedding failed (${error.code}):`, error.message);
      } else {
        log('Embedding failed:', error);
      }
      throw error;
    }
  }

  /**
   * Embed with retry logic
   * The OllamaClient already has retry logic, but this provides an additional layer
   */
  async embedWithRetry(texts: string[], maxRetries: number = 3): Promise<number[][]> {
    let lastError: Error | null = null;

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        const result = await this.embed(texts);

        // Track successful embedding batch
        this.filesProcessed++;

        return result;
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));
        log(`Embed attempt ${attempt}/${maxRetries} failed:`, lastError.message);

        if (attempt < maxRetries) {
          // Exponential backoff
          const delay = Math.min(1000 * Math.pow(2, attempt - 1), 10000);
          await this.sleep(delay);
        }
      }
    }

    throw lastError || new Error('Embedding failed after all retries');
  }

  /**
   * Check if embedder should restart
   * Since Ollama runs externally, we don't need to restart
   */
  async shouldRestart(): Promise<boolean> {
    // Ollama manages its own memory and process lifecycle
    // We don't need to restart the embedder
    return false;
  }

  /**
   * Restart the embedder
   * For Ollama, this is a no-op since it's an external service
   */
  async restart(): Promise<void> {
    log('Restart called, but OllamaEmbedder does not need restarts');
    // Reset stats
    this.filesProcessed = 0;
  }

  /**
   * Shutdown and cleanup
   */
  async shutdown(): Promise<void> {
    log('Shutting down OllamaEmbedder');
    this.isInitialized = false;
    this.filesProcessed = 0;
  }

  /**
   * Get embedder statistics
   */
  getStats(): {
    filesSinceSpawn: number;
    isReady: boolean;
    memoryUsage?: { rss: number; heapUsed: number; external: number };
  } {
    return {
      filesSinceSpawn: this.filesProcessed,
      isReady: this.isInitialized,
      // Ollama runs externally, so we don't track its memory here
      memoryUsage: undefined,
    };
  }

  /**
   * L2 normalize a vector (required for cosine similarity)
   * Converts vector to unit length
   */
  private normalizeVector(vector: number[]): number[] {
    const magnitude = Math.sqrt(vector.reduce((sum, val) => sum + val * val, 0));

    if (magnitude === 0) {
      // Return zero vector if magnitude is zero (avoid division by zero)
      return vector;
    }

    return vector.map((val) => val / magnitude);
  }

  /**
   * Sleep for specified milliseconds
   */
  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  /**
   * Get the model name being used
   */
  getModelName(): string {
    return this.modelName;
  }

  /**
   * Get batch size
   */
  getBatchSize(): number {
    return this.batchSize;
  }
}
