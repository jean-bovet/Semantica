import { waitForQueueToDrain } from './queueDrainer';
import type { ShutdownDependencies, ShutdownOptions, ShutdownResult } from './types';

/**
 * Orchestrates graceful worker shutdown.
 *
 * This is a pure function that coordinates all shutdown steps:
 * 1. Stop accepting new work (close watcher)
 * 2. Wait for file queue to drain
 * 3. Wait for embedding queue to drain (with timeout)
 * 4. Wait for database write queue to drain (with timeout)
 * 5. Generate profiling report (if enabled)
 * 6. Clear monitoring intervals
 * 7. Shutdown Python sidecar
 * 8. Close database
 *
 * @param deps - All dependencies needed for shutdown
 * @param options - Configuration options for shutdown process
 * @returns Detailed result with success status and per-step results
 *
 * @example
 * ```typescript
 * const result = await performGracefulShutdown(
 *   {
 *     watcher,
 *     fileQueue,
 *     embeddingQueue,
 *     writeQueueState,
 *     // ... other dependencies
 *   },
 *   {
 *     embeddingQueueTimeoutMs: 30000,
 *     writeQueueTimeoutMs: 10000,
 *     onProgress: (step, details) => logger.log(step, details)
 *   }
 * );
 *
 * if (!result.success) {
 *   console.error('Shutdown completed with errors:', result.steps);
 * }
 * ```
 */
export async function performGracefulShutdown(
  deps: ShutdownDependencies,
  options: ShutdownOptions = {}
): Promise<ShutdownResult> {
  const {
    embeddingQueueTimeoutMs = 30000,
    writeQueueTimeoutMs = 10000,
    pollIntervalMs = 100,
    enableProfiling = false,
    onProgress
  } = options;

  const result: ShutdownResult = {
    success: true,
    steps: []
  };

  // STEP 1: Close file watcher to stop accepting new work
  if (deps.watcher) {
    try {
      await deps.watcher.close();
      result.steps.push({ step: 'close_watcher', success: true });
      onProgress?.('close_watcher', { success: true });
    } catch (error) {
      result.steps.push({
        step: 'close_watcher',
        success: false,
        error: error instanceof Error ? error.message : String(error)
      });
      result.success = false;
    }
  }

  // STEP 2: Wait for file queue to finish processing
  // No timeout - we want to process all files
  const fileQueueDrained = await waitForQueueToDrain({
    queueName: 'file_queue',
    getStats: () => ({
      processing: deps.fileQueue.getStats().processing,
      isProcessingActive: deps.isProcessingActive
    }),
    isQueueEmpty: (stats) =>
      !stats.isProcessingActive && (stats.processing ?? 0) === 0,
    pollIntervalMs,
    onProgress: (stats, elapsed) => {
      // Log progress every second
      if (elapsed % 1000 === 0 && stats.processing && stats.processing > 0) {
        onProgress?.('file_queue_wait', {
          processing: stats.processing,
          elapsed
        });
      }
    }
  });

  result.steps.push({
    step: 'file_queue_drain',
    success: fileQueueDrained,
    timedOut: !fileQueueDrained
  });

  // STEP 3: Wait for embedding queue to drain (with timeout)
  if (deps.embeddingQueue) {
    const embeddingQueueDrained = await waitForQueueToDrain({
      queueName: 'embedding_queue',
      getStats: () => deps.embeddingQueue!.getStats(),
      isQueueEmpty: (stats) =>
        (stats.queueDepth ?? 0) === 0 && (stats.processingBatches ?? 0) === 0,
      timeoutMs: embeddingQueueTimeoutMs,
      pollIntervalMs,
      onProgress: (stats, elapsed) =>
        onProgress?.('embedding_queue_wait', { stats, elapsed })
    });

    result.steps.push({
      step: 'embedding_queue_drain',
      success: embeddingQueueDrained,
      timedOut: !embeddingQueueDrained
    });

    if (!embeddingQueueDrained) {
      // Timeout is not a hard failure - we'll continue shutdown
      result.success = false;
    }
  }

  // STEP 4: Wait for database write queue to drain (with timeout)
  const writeQueueDrained = await waitForQueueToDrain({
    queueName: 'write_queue',
    getStats: () => ({
      length: deps.writeQueueState.writeQueue.length,
      isWriting: deps.writeQueueState.isWriting
    }),
    isQueueEmpty: (stats) => (stats.length ?? 0) === 0 && !stats.isWriting,
    timeoutMs: writeQueueTimeoutMs,
    pollIntervalMs,
    onProgress: (stats, elapsed) =>
      onProgress?.('write_queue_wait', {
        queueLength: stats.length,
        isWriting: stats.isWriting,
        elapsed
      })
  });

  result.steps.push({
    step: 'write_queue_drain',
    success: writeQueueDrained,
    timedOut: !writeQueueDrained
  });

  if (!writeQueueDrained) {
    // Timeout is not a hard failure - we'll continue shutdown
    result.success = false;
  }

  // STEP 5: Generate profiling report (if enabled)
  if (enableProfiling && deps.profiler?.isEnabled()) {
    try {
      await deps.profiler.saveReport();
      result.steps.push({ step: 'profiling_report', success: true });
      onProgress?.('profiling_report', { success: true });
    } catch (error) {
      result.steps.push({
        step: 'profiling_report',
        success: false,
        error: error instanceof Error ? error.message : String(error)
      });
      // Profiling failure is not critical
    }
  }

  // STEP 6: Clear monitoring intervals
  if (deps.healthCheckInterval) {
    clearInterval(deps.healthCheckInterval);
    result.steps.push({ step: 'clear_health_check', success: true });
  }

  if (deps.memoryMonitorInterval) {
    clearInterval(deps.memoryMonitorInterval);
    result.steps.push({ step: 'clear_memory_monitor', success: true });
    onProgress?.('clear_memory_monitor', { success: true });
  }

  // STEP 7: Shutdown Python sidecar
  if (deps.sidecarEmbedder) {
    try {
      await deps.sidecarEmbedder.shutdown();
      result.steps.push({ step: 'sidecar_embedder_shutdown', success: true });
      onProgress?.('sidecar_embedder_shutdown', { success: true });
    } catch (error) {
      result.steps.push({
        step: 'sidecar_embedder_shutdown',
        success: false,
        error: error instanceof Error ? error.message : String(error)
      });
      result.success = false;
    }
  }

  if (deps.sidecarService) {
    try {
      await deps.sidecarService.stopSidecar();
      result.steps.push({ step: 'sidecar_service_stop', success: true });
      onProgress?.('sidecar_service_stop', { success: true });
    } catch (error) {
      result.steps.push({
        step: 'sidecar_service_stop',
        success: false,
        error: error instanceof Error ? error.message : String(error)
      });
      result.success = false;
    }
  }

  // STEP 8: Close database
  // This should happen last after all writes are complete
  if (deps.db) {
    try {
      await deps.db.close();
      result.steps.push({ step: 'database_close', success: true });
      onProgress?.('database_close', { success: true });
    } catch (error) {
      result.steps.push({
        step: 'database_close',
        success: false,
        error: error instanceof Error ? error.message : String(error)
      });
      result.success = false;
    }
  }

  return result;
}
