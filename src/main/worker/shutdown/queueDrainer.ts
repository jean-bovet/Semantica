import type { WaitForQueueOptions } from './types';

/**
 * Generic function that waits for a queue to drain.
 *
 * This is a pure async function that polls a queue until it's empty or times out.
 * Highly testable with configurable timeouts and progress callbacks.
 *
 * @param options - Configuration for waiting
 * @returns true if queue drained successfully, false if timeout occurred
 *
 * @example
 * ```typescript
 * const drained = await waitForQueueToDrain({
 *   queueName: 'embedding_queue',
 *   getStats: () => embeddingQueue.getStats(),
 *   isQueueEmpty: (stats) => stats.queueDepth === 0 && stats.processingBatches === 0,
 *   timeoutMs: 30000,
 *   onProgress: (stats, elapsed) => logger.log(`Queue depth: ${stats.queueDepth}`)
 * });
 * ```
 */
export async function waitForQueueToDrain(options: WaitForQueueOptions): Promise<boolean> {
  const {
    getStats,
    isQueueEmpty,
    timeoutMs = Infinity,
    pollIntervalMs = 100,
    onProgress
  } = options;

  const startTime = Date.now();

  while (true) {
    const stats = getStats();
    const elapsed = Date.now() - startTime;

    // Check if queue is empty
    if (isQueueEmpty(stats)) {
      return true; // Success - queue drained
    }

    // Check for timeout
    if (elapsed > timeoutMs) {
      return false; // Timeout - queue did not drain in time
    }

    // Call progress callback if provided
    if (onProgress) {
      onProgress(stats, elapsed);
    }

    // Wait before next poll
    await new Promise(resolve => setTimeout(resolve, pollIntervalMs));
  }
}
