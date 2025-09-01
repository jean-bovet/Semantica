/**
 * ConcurrentQueue - Manages parallel processing of files with configurable concurrency
 * 
 * This class handles the core logic for processing multiple files concurrently,
 * with memory-based throttling and proper queue management.
 */

export interface QueueOptions {
  maxConcurrent?: number;
  memoryThresholdMB?: number;
  throttledConcurrent?: number;
  onProgress?: (queued: number, processing: number) => void;
  onMemoryThrottle?: (newLimit: number, memoryMB: number) => void;
}

export interface ProcessingStats {
  queued: number;
  processing: number;
  completed: number;
  failed: number;
}

export class ConcurrentQueue {
  private queue: string[] = [];
  private processing = new Set<string>();
  private completed = new Set<string>();
  private failed = new Set<string>();
  private paused = false;
  private maxConcurrent: number;
  private memoryThresholdMB: number;
  private throttledConcurrent: number;
  private lastMaxConcurrent: number;
  private options: QueueOptions;

  constructor(options: QueueOptions = {}) {
    this.options = options;
    this.maxConcurrent = options.maxConcurrent || 5;
    this.memoryThresholdMB = options.memoryThresholdMB || 800;
    this.throttledConcurrent = options.throttledConcurrent || 2;
    this.lastMaxConcurrent = -1; // Initialize to -1 to trigger initial callback
  }

  /**
   * Add files to the processing queue
   */
  add(files: string | string[]): void {
    const filesToAdd = Array.isArray(files) ? files : [files];
    this.queue.push(...filesToAdd);
  }

  /**
   * Remove a file from the queue (if not yet processing)
   */
  remove(filePath: string): boolean {
    const idx = this.queue.indexOf(filePath);
    if (idx !== -1) {
      this.queue.splice(idx, 1);
      return true;
    }
    return false;
  }

  /**
   * Pause processing (current files will complete)
   */
  pause(): void {
    this.paused = true;
  }

  /**
   * Resume processing
   */
  resume(): void {
    this.paused = false;
  }

  /**
   * Get current processing statistics
   */
  getStats(): ProcessingStats {
    return {
      queued: this.queue.length,
      processing: this.processing.size,
      completed: this.completed.size,
      failed: this.failed.size
    };
  }

  /**
   * Check if a file is currently being processed
   */
  isProcessing(filePath: string): boolean {
    return this.processing.has(filePath);
  }

  /**
   * Get list of currently processing files
   */
  getProcessingFiles(): string[] {
    return Array.from(this.processing);
  }

  /**
   * Main processing loop - processes files concurrently up to the limit
   * 
   * @param handler - Async function to process each file
   * @param getMemoryMB - Optional function to get current memory usage
   */
  async process(
    handler: (filePath: string) => Promise<void>,
    getMemoryMB?: () => number
  ): Promise<void> {
    const activePromises = new Map<string, Promise<void>>();

    while (this.queue.length > 0 || this.processing.size > 0) {
      // Check if paused
      if (this.paused) {
        await new Promise(r => setTimeout(r, 100));
        continue;
      }

      // Adjust concurrency based on memory if provided
      if (getMemoryMB) {
        const memoryMB = getMemoryMB();
        const newMaxConcurrent = memoryMB > this.memoryThresholdMB 
          ? this.throttledConcurrent 
          : this.maxConcurrent;

        if (this.lastMaxConcurrent === -1 || newMaxConcurrent !== this.lastMaxConcurrent) {
          this.options.onMemoryThrottle?.(newMaxConcurrent, memoryMB);
          this.lastMaxConcurrent = newMaxConcurrent;
        }
      }

      const currentMaxConcurrent = this.lastMaxConcurrent === -1 ? this.maxConcurrent : this.lastMaxConcurrent;

      // Start new jobs up to limit
      while (this.processing.size < currentMaxConcurrent && this.queue.length > 0) {
        const filePath = this.queue.shift()!;

        // Skip if already processing (prevents duplicates being processed simultaneously)
        // But we'll still process it after the current one completes
        if (this.processing.has(filePath)) {
          this.queue.push(filePath); // Re-add to end of queue
          break; // Break inner loop to avoid infinite loop, will retry on next iteration
        }

        this.processing.add(filePath);

        // Start processing WITHOUT awaiting (enables parallel processing)
        const promise = handler(filePath)
          .then(() => {
            this.completed.add(filePath);
          })
          .catch((error) => {
            this.failed.add(filePath);
            console.error(`Failed to process ${filePath}:`, error);
          })
          .finally(() => {
            this.processing.delete(filePath);
            activePromises.delete(filePath);
            this.options.onProgress?.(this.queue.length, this.processing.size);
          });

        activePromises.set(filePath, promise);
      }

      // Report progress
      this.options.onProgress?.(this.queue.length, this.processing.size);

      // Wait a bit before checking again
      await new Promise(r => setTimeout(r, 100));
    }

    // Wait for all active processing to complete
    await Promise.all(activePromises.values());
  }

  /**
   * Clear all queues and stats
   */
  clear(): void {
    this.queue = [];
    this.processing.clear();
    this.completed.clear();
    this.failed.clear();
  }

  /**
   * Get the current concurrency limit (may be throttled)
   */
  getCurrentMaxConcurrent(): number {
    return this.lastMaxConcurrent;
  }
}