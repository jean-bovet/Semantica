import type { WriteQueueState } from '../database/operations';

/**
 * Generic queue statistics that can represent any queue type
 */
export interface QueueStats {
  queueDepth?: number;
  processing?: number;
  processingBatches?: number;
  length?: number;
  isWriting?: boolean;
  [key: string]: any;
}

/**
 * Options for waiting for a queue to drain
 */
export interface WaitForQueueOptions {
  /** Name of the queue (for logging/debugging) */
  queueName: string;

  /** Function to get current queue statistics */
  getStats: () => QueueStats;

  /** Predicate to check if queue is empty */
  isQueueEmpty: (stats: QueueStats) => boolean;

  /** Maximum time to wait before timing out (ms), defaults to Infinity */
  timeoutMs?: number;

  /** Interval between polls (ms), defaults to 100 */
  pollIntervalMs?: number;

  /** Optional callback for progress updates */
  onProgress?: (stats: QueueStats, elapsedMs: number) => void;
}

/**
 * Dependencies required for graceful shutdown
 */
export interface ShutdownDependencies {
  /** File system watcher instance */
  watcher: any | null;

  /** File processing queue */
  fileQueue: { getStats: () => QueueStats };

  /** Embedding generation queue */
  embeddingQueue: { getStats: () => QueueStats } | null;

  /** Database write queue state */
  writeQueueState: WriteQueueState;

  /** Python sidecar embedder */
  sidecarEmbedder: { shutdown: () => Promise<void> } | null;

  /** Python sidecar service */
  sidecarService: { stopSidecar: () => Promise<void> } | null;

  /** LanceDB database instance */
  db: { close: () => Promise<void> } | null;

  /** Health check interval timer */
  healthCheckInterval: NodeJS.Timeout | null;

  /** Memory monitor interval timer */
  memoryMonitorInterval: NodeJS.Timeout | null;

  /** Flag indicating if file processing is active */
  isProcessingActive: boolean;

  /** Optional profiler for performance reporting */
  profiler?: {
    isEnabled: () => boolean;
    saveReport: () => Promise<void>;
  };
}

/**
 * Configuration options for graceful shutdown
 */
export interface ShutdownOptions {
  /** Timeout for embedding queue drain (ms), defaults to 30000 */
  embeddingQueueTimeoutMs?: number;

  /** Timeout for write queue drain (ms), defaults to 10000 */
  writeQueueTimeoutMs?: number;

  /** Poll interval for queue checks (ms), defaults to 100 */
  pollIntervalMs?: number;

  /** Whether to generate profiling report, defaults to false */
  enableProfiling?: boolean;

  /** Optional callback for progress updates */
  onProgress?: (step: string, details: any) => void;
}

/**
 * Result of a single shutdown step
 */
export interface ShutdownStepResult {
  /** Name of the shutdown step */
  step: string;

  /** Whether the step completed successfully */
  success: boolean;

  /** Whether the step timed out */
  timedOut?: boolean;

  /** Error message if step failed */
  error?: string;
}

/**
 * Complete result of graceful shutdown process
 */
export interface ShutdownResult {
  /** Overall success status (false if any critical step failed) */
  success: boolean;

  /** Results for each shutdown step */
  steps: ShutdownStepResult[];
}
