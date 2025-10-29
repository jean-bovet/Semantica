import type { IEmbedder } from '../../worker/embeddings/IEmbedder';
import { logger } from '../../../shared/utils/logger';

export interface QueuedChunk {
  text: string;
  metadata: {
    filePath: string;
    offset: number;
    page?: number;
    fileIndex: number;
    chunkIndex: number;
  };
  retryCount?: number;
}

export interface FileTracker {
  filePath: string;
  totalChunks: number;
  processedChunks: number;
  startTime: number;
  errors: Error[];
  completionPromise?: {
    resolve: () => void;
    reject: (error: Error) => void;
  };
}

export interface EmbeddingQueueConfig {
  maxQueueSize?: number;
  batchSize?: number;
  maxTokensPerBatch?: number;
  backpressureThreshold?: number;
  onProgress?: (filePath: string, processed: number, total: number) => void;
  onFileComplete?: (filePath: string) => void;
  onBatchProcessed?: (count: number) => void;
}

export interface ProcessedBatch {
  chunks: QueuedChunk[];
  vectors: number[][];
}

export type BatchProcessor = (batch: ProcessedBatch) => Promise<void>;

/**
 * Manages a queue of text chunks awaiting embedding generation.
 * Implements producer-consumer pattern with backpressure control.
 */
export class EmbeddingQueue {
  private queue: QueuedChunk[] = [];
  private maxQueueSize: number;
  private batchSize: number;
  private maxTokensPerBatch: number;
  private backpressureThreshold: number;
  private isProcessing = false;
  private fileTrackers = new Map<string, FileTracker>();
  private embedder: IEmbedder | null = null;
  private onProgress?: (filePath: string, processed: number, total: number) => void;
  private onFileComplete?: (filePath: string) => void;
  private onBatchProcessed?: (count: number) => void;
  private processingBatches = 0;
  private maxConcurrentBatches = 2; // Match embedder pool size
  private batchProcessor?: BatchProcessor;
  private maxRetries = 3; // Maximum retry attempts per batch

  // Batch tracking for restart recovery
  private activeBatches = new Map<string, { chunks: QueuedChunk[], embedderIndex: number }>();
  private nextBatchId = 0;

  constructor(config: EmbeddingQueueConfig = {}) {
    this.maxQueueSize = config.maxQueueSize || 2000;
    this.batchSize = config.batchSize || 32;
    this.maxTokensPerBatch = config.maxTokensPerBatch || 7000; // Safe limit with ~1K buffer
    this.backpressureThreshold = config.backpressureThreshold || 1000;
    this.onProgress = config.onProgress;
    this.onFileComplete = config.onFileComplete;
    this.onBatchProcessed = config.onBatchProcessed;
  }

  /**
   * Initialize the queue with an embedder
   */
  initialize(
    embedder: IEmbedder,
    batchProcessor?: BatchProcessor,
    maxConcurrentBatches = 1
  ) {
    this.embedder = embedder;
    this.maxConcurrentBatches = maxConcurrentBatches;
    this.batchProcessor = batchProcessor;
  }

  /**
   * Add chunks from a file to the queue
   */
  async addChunks(
    chunks: Array<{ text: string; offset: number; page?: number }>,
    filePath: string,
    fileIndex: number
  ): Promise<void> {
    // Check if we're at capacity
    if (this.queue.length + chunks.length > this.maxQueueSize) {
      // Wait for queue to drain
      await this.waitForCapacity(chunks.length);
    }

    // Initialize file tracker if new file
    if (!this.fileTrackers.has(filePath)) {
      this.fileTrackers.set(filePath, {
        filePath,
        totalChunks: chunks.length,
        processedChunks: 0,
        startTime: Date.now(),
        errors: []
      });
    } else {
      // Update total if adding more chunks to existing file
      const tracker = this.fileTrackers.get(filePath)!;
      tracker.totalChunks += chunks.length;
    }

    // Add chunks to queue with metadata
    chunks.forEach((chunk, index) => {
      this.queue.push({
        text: chunk.text,
        metadata: {
          filePath,
          offset: chunk.offset,
          page: chunk.page,
          fileIndex,
          chunkIndex: index
        }
      });
    });

    // Start processing if not already running
    if (!this.isProcessing) {
      this.startProcessing();
    }
  }

  /**
   * Wait for queue to have capacity for new chunks
   */
  private async waitForCapacity(needed: number): Promise<void> {
    while (this.queue.length + needed > this.maxQueueSize) {
      await new Promise(resolve => setTimeout(resolve, 100));
    }
  }

  /**
   * Estimate the number of tokens in a text string
   * Uses heuristic: 1 token ≈ 2.5 characters
   * Conservative estimate to account for multilingual text, URLs, and special characters
   */
  private estimateTokens(text: string): number {
    return Math.ceil(text.length / 2.5);
  }

  /**
   * Calculate dynamic batch size based on token limits
   * Prevents EOF errors by ensuring batches don't exceed Ollama's token limit
   */
  private calculateBatchSize(): number {
    let batchSize = 0;
    let totalTokens = 0;
    let totalChars = 0;
    const maxBatchSize = Math.min(this.batchSize, this.queue.length);

    // Log batch building process for debugging
    logger.log('EMBEDDING-QUEUE', `📊 Building batch (limit: ${this.maxTokensPerBatch} tokens):`);

    for (let i = 0; i < maxBatchSize; i++) {
      const chunkText = this.queue[i].text;
      const chunkChars = chunkText.length;
      const chunkTokens = this.estimateTokens(chunkText);

      // Stop if adding this chunk would exceed the limit
      if (totalTokens + chunkTokens > this.maxTokensPerBatch && batchSize > 0) {
        logger.log('EMBEDDING-QUEUE', `   ⛔ Stopping: adding chunk ${i+1} (${chunkChars} chars, ~${chunkTokens} tokens) would exceed limit`);
        logger.log('EMBEDDING-QUEUE', `   Would be: ${totalTokens + chunkTokens} tokens > ${this.maxTokensPerBatch} limit`);
        break;
      }

      totalTokens += chunkTokens;
      totalChars += chunkChars;
      batchSize++;

      // Log each chunk added (show first 5, then summarize)
      if (i < 5 || i === maxBatchSize - 1) {
        logger.log('EMBEDDING-QUEUE', `   ✓ Chunk ${i+1}: ${chunkChars} chars (~${chunkTokens} tokens) | Running: ${totalChars} chars, ~${totalTokens} tokens`);
      } else if (i === 5) {
        logger.log('EMBEDDING-QUEUE', `   ... (showing only first 5 and last chunks)`);
      }

      // Safety check: if even a single chunk exceeds limit, take it anyway
      // (we need to process it, even if it might fail)
      if (batchSize === 1 && totalTokens > this.maxTokensPerBatch) {
        logger.log('EMBEDDING-QUEUE', `⚠️  Single chunk exceeds token limit: ${totalTokens} tokens (${totalChars} chars) - limit: ${this.maxTokensPerBatch}`);
        logger.log('EMBEDDING-QUEUE', `   This chunk may cause EOF errors but will attempt anyway`);
        break;
      }
    }

    // Log batch creation summary
    logger.log('EMBEDDING-QUEUE', `✅ Created batch: ${batchSize} chunks, ${totalChars} chars, ~${totalTokens} tokens (limit: ${this.maxTokensPerBatch})`);

    return Math.max(1, batchSize); // Always take at least 1 chunk
  }

  /**
   * Start the consumer loop
   */
  private async startProcessing() {
    if (this.isProcessing || !this.embedder) {
      return;
    }

    this.isProcessing = true;

    try {
      await this.processBatches();
    } finally {
      this.isProcessing = false;
    }
  }

  /**
   * Process batches from the queue
   */
  private async processBatches() {
    while (this.queue.length > 0) {
      // Wait if we're at max concurrent batches
      while (this.processingBatches >= this.maxConcurrentBatches) {
        await new Promise(resolve => setTimeout(resolve, 50));
      }

      // Calculate dynamic batch size based on token limits
      const batchSize = this.calculateBatchSize();

      // Check if we should wait for more chunks
      if (this.queue.length < this.batchSize && this.hasMoreChunkscoming()) {
        // Wait for more chunks to arrive for a full batch
        await new Promise(resolve => setTimeout(resolve, 100));
        continue;
      }

      // Pull a batch from the queue
      const batch = this.queue.splice(0, batchSize);

      // Process this batch sequentially (await to prevent overlapping requests to Ollama)
      await this.processOneBatch(batch);
    }
  }

  /**
   * Process a single batch of chunks
   */
  private async processOneBatch(batch: QueuedChunk[]): Promise<void> {
    this.processingBatches++;

    // Generate unique batch ID for tracking
    const batchId = `batch_${this.nextBatchId++}`;

    try {
      // Track the batch before starting processing
      // We don't know which embedder yet, so use -1
      this.activeBatches.set(batchId, { chunks: batch, embedderIndex: -1 });

      // Extract texts for embedding
      const texts = batch.map(chunk => chunk.text);

      // Log text samples for debugging EOF errors
      if (texts.length > 0) {
        const firstText = texts[0];
        const lastText = texts[texts.length - 1];

        // Show first 100 chars of first text
        const firstPreview = firstText.substring(0, 100).replace(/\n/g, ' ');
        logger.log('EMBEDDING-QUEUE', `   📝 First chunk preview: "${firstPreview}${firstText.length > 100 ? '...' : ''}"`);

        // Show last 100 chars of last text (if different from first)
        if (texts.length > 1) {
          const lastPreview = lastText.substring(Math.max(0, lastText.length - 100)).replace(/\n/g, ' ');
          logger.log('EMBEDDING-QUEUE', `   📝 Last chunk preview: "...${lastPreview}"`);
        }

        // Check for potential encoding issues
        const totalNonAscii = texts.reduce((count, text) => {
          return count + (text.match(/[^\x00-\x7F]/g) || []).length;
        }, 0);
        if (totalNonAscii > 0) {
          const totalChars = texts.reduce((sum, t) => sum + t.length, 0);
          const pctNonAscii = ((totalNonAscii / totalChars) * 100).toFixed(1);
          logger.log('EMBEDDING-QUEUE', `   ⚠️  Batch contains ${totalNonAscii} non-ASCII characters (${pctNonAscii}% of total)`);
        }
      }

      // Generate embeddings
      logger.log('EMBEDDING-QUEUE', `Batch ${batchId}: Starting embedding for ${texts.length} texts`);
      const vectors = await this.embedder!.embed(texts);
      logger.log('EMBEDDING-QUEUE', `Batch ${batchId}: Embedding completed successfully`);

      // Batch completed successfully - remove from tracking
      this.activeBatches.delete(batchId);

      // Group by file for progress tracking
      const fileGroups = new Map<string, QueuedChunk[]>();
      batch.forEach(chunk => {
        const filePath = chunk.metadata.filePath;
        if (!fileGroups.has(filePath)) {
          fileGroups.set(filePath, []);
        }
        fileGroups.get(filePath)!.push(chunk);
      });

      // Update progress for each file
      for (const [filePath, chunks] of fileGroups.entries()) {
        const tracker = this.fileTrackers.get(filePath);
        if (tracker) {
          tracker.processedChunks += chunks.length;

          // Report progress
          if (this.onProgress) {
            this.onProgress(filePath, tracker.processedChunks, tracker.totalChunks);
          }

          // Check if file is complete
          if (tracker.processedChunks >= tracker.totalChunks) {
            if (this.onFileComplete) {
              this.onFileComplete(filePath);
            }

            // Resolve completion promise if waiting
            if (tracker.completionPromise) {
              tracker.completionPromise.resolve();
              delete tracker.completionPromise;
            }

            // Don't delete tracker here - will be cleaned up explicitly when file processing completes
          }
        }
      }

      // Process the batch with vectors (write to database)
      if (this.batchProcessor) {
        await this.batchProcessor({ chunks: batch, vectors });
      }

      // Report batch completion
      if (this.onBatchProcessed) {
        this.onBatchProcessed(batch.length);
      }

    } catch (error) {
      logger.error('EMBEDDING-QUEUE', 'Batch processing failed:', error);

      // Note: Batch capture now happens in OllamaClient.ts on first error occurrence
      // This ensures we capture the batch data even if retries succeed

      // Remove from active tracking since it failed
      this.activeBatches.delete(batchId);

      // Track errors for affected files
      const affectedFiles = new Set(batch.map(c => c.metadata.filePath));
      for (const filePath of affectedFiles) {
        const tracker = this.fileTrackers.get(filePath);
        if (tracker) {
          tracker.errors.push(error as Error);
        }
      }

      // Check retry count and decide whether to retry
      const currentRetryCount = batch[0]?.retryCount || 0;
      if (currentRetryCount < this.maxRetries) {
        // Increment retry count for all chunks in the batch
        batch.forEach(chunk => {
          chunk.retryCount = currentRetryCount + 1;
        });

        // Re-queue the batch for retry (at the front)
        this.queue.unshift(...batch);
      } else {
        // Max retries exceeded, mark chunks as failed
        logger.error('EMBEDDING-QUEUE', `Max retries (${this.maxRetries}) exceeded for batch, dropping chunks`);

        // Update file trackers to reflect failed chunks
        for (const filePath of affectedFiles) {
          const tracker = this.fileTrackers.get(filePath);
          if (tracker) {
            const failedChunks = batch.filter(c => c.metadata.filePath === filePath).length;
            tracker.processedChunks += failedChunks; // Count as processed (failed)

            // Check if file is complete (including failed chunks)
            if (tracker.processedChunks >= tracker.totalChunks) {
              if (this.onFileComplete) {
                this.onFileComplete(filePath);
              }

              // Resolve completion promise if waiting
              if (tracker.completionPromise) {
                tracker.completionPromise.resolve();
                delete tracker.completionPromise;
              }

              // Don't delete tracker here - will be cleaned up explicitly when file processing completes
            }
          }
        }
      }

    } finally {
      this.processingBatches--;

      // Continue processing if there are more chunks
      if (this.queue.length > 0 && !this.isProcessing) {
        this.startProcessing();
      }
    }
  }

  /**
   * Check if more chunks are expected (files still being processed)
   */
  private hasMoreChunkscoming(): boolean {
    // This would need to be coordinated with the file processing queue
    // For now, return false to process partial batches
    return false;
  }

  /**
   * Wait for a specific file to complete processing
   */
  async waitForCompletion(filePath: string): Promise<void> {
    const tracker = this.fileTrackers.get(filePath);
    if (!tracker) {
      return; // File not in queue
    }

    // Check if already complete
    if (tracker.processedChunks >= tracker.totalChunks) {
      return;
    }

    // Create a promise to wait for completion
    return new Promise((resolve, reject) => {
      tracker.completionPromise = { resolve, reject };
    });
  }

  /**
   * Clean up file tracker after processing is complete
   * This should be called when the file is completely done processing
   */
  cleanupFileTracker(filePath: string): void {
    this.fileTrackers.delete(filePath);
  }

  /**
   * Get queue statistics
   */
  getStats() {
    return {
      queueDepth: this.queue.length,
      processingBatches: this.processingBatches,
      isProcessing: this.isProcessing,
      trackedFiles: this.fileTrackers.size,
      backpressureActive: this.queue.length > this.backpressureThreshold
    };
  }

  /**
   * Get file tracking information for pipeline visualization
   */
  getFileTrackers(): Map<string, FileTracker> {
    return new Map(this.fileTrackers);
  }

  /**
   * Check if backpressure should be applied
   */
  shouldApplyBackpressure(): boolean {
    return this.queue.length > this.backpressureThreshold;
  }

  /**
   * Get the current queue depth
   */
  getDepth(): number {
    return this.queue.length;
  }

  /**
   * Clear the queue and reset state
   */
  clear() {
    this.queue = [];
    this.fileTrackers.clear();
    this.isProcessing = false;
    this.processingBatches = 0;
    this.activeBatches.clear();
  }

  /**
   * Handle embedder restart - recover any in-flight batches
   */
  onEmbedderRestart(embedderIndex: number) {
    logger.log('EMBEDDING-QUEUE', `Handling embedder ${embedderIndex} restart, checking for lost batches...`);

    // Find all batches that were being processed
    // Since we don't track which specific embedder is handling each batch,
    // we'll recover ALL active batches when any embedder restarts
    // This is safer to avoid losing batches
    const lostBatches: string[] = [];
    for (const [batchId, batchInfo] of this.activeBatches.entries()) {
      // Recover all active batches (embedderIndex -1 means in processing)
      if (batchInfo.embedderIndex === -1 || batchInfo.embedderIndex === embedderIndex) {
        lostBatches.push(batchId);
      }
    }

    if (lostBatches.length > 0) {
      logger.log('EMBEDDING-QUEUE', `Found ${lostBatches.length} potentially lost batches, recovering...`);

      // Recover each lost batch
      for (const batchId of lostBatches) {
        const batchInfo = this.activeBatches.get(batchId);
        if (batchInfo) {
          logger.log('EMBEDDING-QUEUE', `Recovering batch ${batchId} with ${batchInfo.chunks.length} chunks`);

          // Re-queue the chunks at the front of the queue
          this.queue.unshift(...batchInfo.chunks);

          // Remove from active tracking
          this.activeBatches.delete(batchId);

          // CRITICAL: Decrement the processingBatches counter
          this.processingBatches--;
        }
      }

      logger.log('EMBEDDING-QUEUE', `Recovery complete. processingBatches now: ${this.processingBatches}`);

      // Restart processing if needed
      if (!this.isProcessing && this.queue.length > 0) {
        this.startProcessing();
      }
    }
  }

  /**
   * Get results for a batch (to be called after processing)
   * This would be extended to actually return the vectors
   */
  async getProcessedBatch(): Promise<ProcessedBatch | null> {
    // This is a placeholder - in the real implementation,
    // we'd store the processed batches with their vectors
    // and return them here for database writing
    return null;
  }
}