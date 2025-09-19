import { EventEmitter } from 'node:events';
import { EmbedderState } from '../utils/ProcessStateMachine';

/**
 * Memory usage information
 */
export interface MemoryInfo {
  rss: number; // MB
  heapUsed: number; // MB
  external: number; // MB
  percentage: number; // Percentage of max memory
}

/**
 * Performance metrics for embedding operations
 */
export interface PerformanceMetrics {
  operationId: string;
  texts: number;
  duration: number; // milliseconds
  vectorsGenerated: number;
  errorRate: number;
  throughput: number; // texts per second
}

/**
 * Health check result
 */
export interface HealthCheckResult {
  isHealthy: boolean;
  checks: {
    memory: boolean;
    process: boolean;
    connectivity: boolean;
    performance: boolean;
  };
  warnings: string[];
  errors: string[];
  timestamp: number;
}

/**
 * Restart information
 */
export interface RestartInfo {
  reason: string;
  trigger: 'manual' | 'memory' | 'error' | 'file_limit' | 'health_check';
  previousUptime: number;
  filesSinceLastRestart: number;
  restartCount: number;
}

/**
 * Error context with detailed information
 */
export interface ErrorContext {
  operation: string;
  phase: 'initialization' | 'embedding' | 'communication' | 'shutdown';
  error: Error;
  state: EmbedderState;
  retryable: boolean;
  metadata?: Record<string, any>;
}

/**
 * Events emitted by the embedder system
 */
export interface EmbedderEvents {
  // Lifecycle events
  'embedder:initialized': (embedderId: string) => void;
  'embedder:ready': (embedderId: string) => void;
  'embedder:shutdown': (embedderId: string) => void;
  'embedder:restarted': (embedderId: string, restartInfo: RestartInfo) => void;

  // State change events
  'state:changed': (embedderId: string, from: EmbedderState, to: EmbedderState, reason?: string) => void;
  'state:error': (embedderId: string, errorContext: ErrorContext) => void;

  // Performance events
  'performance:metrics': (embedderId: string, metrics: PerformanceMetrics) => void;
  'performance:slow_operation': (embedderId: string, operation: string, duration: number) => void;
  'performance:throughput': (embedderId: string, rate: number, period: string) => void;

  // Memory events
  'memory:usage': (embedderId: string, memoryInfo: MemoryInfo) => void;
  'memory:warning': (embedderId: string, memoryInfo: MemoryInfo, threshold: number) => void;
  'memory:critical': (embedderId: string, memoryInfo: MemoryInfo, maxMemory: number) => void;

  // Health events
  'health:check': (embedderId: string, result: HealthCheckResult) => void;
  'health:degraded': (embedderId: string, issues: string[]) => void;
  'health:recovered': (embedderId: string) => void;

  // Operation events
  'operation:started': (embedderId: string, operationId: string, type: string) => void;
  'operation:completed': (embedderId: string, operationId: string, duration: number) => void;
  'operation:failed': (embedderId: string, operationId: string, error: Error) => void;
  'operation:retrying': (embedderId: string, operationId: string, attempt: number, maxAttempts: number) => void;

  // Communication events
  'ipc:message_sent': (embedderId: string, messageType: string, messageId?: string) => void;
  'ipc:message_received': (embedderId: string, messageType: string, messageId?: string) => void;
  'ipc:message_timeout': (embedderId: string, messageId: string, timeout: number) => void;
  'ipc:connection_lost': (embedderId: string, reason: string) => void;
  'ipc:connection_restored': (embedderId: string) => void;

  // Configuration events
  'config:validated': (embedderId: string, config: any) => void;
  'config:invalid': (embedderId: string, errors: string[]) => void;
  'config:changed': (embedderId: string, changes: Record<string, any>) => void;

  // Resource events
  'resource:model_loaded': (embedderId: string, modelPath: string, size: number) => void;
  'resource:model_missing': (embedderId: string, modelPath: string) => void;
  'resource:cache_cleared': (embedderId: string, reason: string) => void;

  // Debug events
  'debug:process_spawn': (embedderId: string, pid: number, command: string) => void;
  'debug:process_exit': (embedderId: string, code: number | null, signal: string | null) => void;
  'debug:memory_snapshot': (embedderId: string, snapshot: any) => void;
  'debug:state_transition': (embedderId: string, transition: any) => void;
}

/**
 * Enhanced event emitter for embedder system with typed events,
 * structured logging, and advanced monitoring capabilities.
 */
export class EmbedderEventEmitter extends EventEmitter {
  private metrics = new Map<string, any>();
  private eventCounts = new Map<string, number>();
  private lastEmitTimes = new Map<string, number>();
  private readonly enableDebug: boolean;
  private readonly enableMetrics: boolean;

  constructor(options: {
    enableDebug?: boolean;
    enableMetrics?: boolean;
    maxListeners?: number;
  } = {}) {
    super();

    this.enableDebug = options.enableDebug ?? process.env.NODE_ENV !== 'production';
    this.enableMetrics = options.enableMetrics ?? true;

    if (options.maxListeners) {
      this.setMaxListeners(options.maxListeners);
    }

    // Set up metrics collection if enabled
    if (this.enableMetrics) {
      this.setupMetricsCollection();
    }

    // Set up debug logging if enabled
    if (this.enableDebug) {
      this.setupDebugLogging();
    }
  }

  /**
   * Emit an event with automatic metrics collection and debugging
   */
  emit<K extends keyof EmbedderEvents>(event: K, ...args: Parameters<EmbedderEvents[K]>): boolean {
    // Update metrics
    if (this.enableMetrics) {
      this.updateEventMetrics(event as string);
    }

    // Log debug information
    if (this.enableDebug) {
      this.logEventDebug(event as string, args);
    }

    return super.emit(event, ...args);
  }

  /**
   * Convenience methods for common events
   */
  emitStateChanged(embedderId: string, from: EmbedderState, to: EmbedderState, reason?: string): void {
    this.emit('state:changed', embedderId, from, to, reason);
  }

  emitError(embedderId: string, errorContext: ErrorContext): void {
    this.emit('state:error', embedderId, errorContext);
  }

  emitMemoryWarning(embedderId: string, memoryInfo: MemoryInfo, threshold: number): void {
    this.emit('memory:warning', embedderId, memoryInfo, threshold);
  }

  emitPerformanceMetrics(embedderId: string, metrics: PerformanceMetrics): void {
    this.emit('performance:metrics', embedderId, metrics);
  }

  emitHealthCheck(embedderId: string, result: HealthCheckResult): void {
    this.emit('health:check', embedderId, result);
  }

  emitOperationStarted(embedderId: string, operationId: string, type: string): void {
    this.emit('operation:started', embedderId, operationId, type);
  }

  emitOperationCompleted(embedderId: string, operationId: string, duration: number): void {
    this.emit('operation:completed', embedderId, operationId, duration);
  }

  emitRestart(embedderId: string, restartInfo: RestartInfo): void {
    this.emit('embedder:restarted', embedderId, restartInfo);
  }

  /**
   * Get event metrics and statistics
   */
  getEventMetrics(): {
    totalEvents: number;
    eventCounts: Record<string, number>;
    eventRates: Record<string, number>; // events per minute
    lastActivity: Record<string, number>;
  } {
    const now = Date.now();
    const eventCounts: Record<string, number> = {};
    const eventRates: Record<string, number> = {};
    const lastActivity: Record<string, number> = {};

    let totalEvents = 0;

    for (const [event, count] of this.eventCounts) {
      eventCounts[event] = count;
      totalEvents += count;

      const lastTime = this.lastEmitTimes.get(event) || now;
      lastActivity[event] = now - lastTime;

      // Calculate rough events per minute based on last activity
      const timeSinceFirst = now - (this.metrics.get(`${event}_first_time`) || now);
      if (timeSinceFirst > 0) {
        eventRates[event] = (count * 60000) / timeSinceFirst;
      } else {
        eventRates[event] = 0;
      }
    }

    return {
      totalEvents,
      eventCounts,
      eventRates,
      lastActivity
    };
  }

  /**
   * Get specific event statistics
   */
  getEventStats(eventName: string): {
    count: number;
    firstOccurrence: number | null;
    lastOccurrence: number | null;
    rate: number; // per minute
  } {
    const count = this.eventCounts.get(eventName) || 0;
    const firstTime = this.metrics.get(`${eventName}_first_time`) || null;
    const lastTime = this.lastEmitTimes.get(eventName) || null;

    let rate = 0;
    if (firstTime && lastTime && firstTime !== lastTime) {
      const duration = lastTime - firstTime;
      rate = (count * 60000) / duration;
    }

    return {
      count,
      firstOccurrence: firstTime,
      lastOccurrence: lastTime,
      rate
    };
  }

  /**
   * Clear all metrics and reset counters
   */
  clearMetrics(): void {
    this.eventCounts.clear();
    this.lastEmitTimes.clear();
    this.metrics.clear();
  }

  /**
   * Set up automatic metrics collection
   */
  private setupMetricsCollection(): void {
    // This could be extended to include more sophisticated metrics
    // like event correlation, timing analysis, etc.
  }

  /**
   * Set up debug logging for all events
   */
  private setupDebugLogging(): void {
    // Log all events in debug mode
    const originalEmit = this.emit.bind(this);

    // We can't easily override emit due to typing, so we'll handle debug in updateEventMetrics
  }

  /**
   * Update event metrics when an event is emitted
   */
  private updateEventMetrics(eventName: string): void {
    const now = Date.now();

    // Update count
    const currentCount = this.eventCounts.get(eventName) || 0;
    this.eventCounts.set(eventName, currentCount + 1);

    // Update last emit time
    this.lastEmitTimes.set(eventName, now);

    // Record first occurrence
    if (!this.metrics.has(`${eventName}_first_time`)) {
      this.metrics.set(`${eventName}_first_time`, now);
    }
  }

  /**
   * Log debug information for events
   */
  private logEventDebug(eventName: string, args: any[]): void {
    if (this.enableDebug) {
      const embedderId = args[0];
      const additionalInfo = args.slice(1);

      console.log(`[EMBEDDER-EVENT] ${eventName} | ${embedderId}`,
        additionalInfo.length > 0 ? additionalInfo : '');
    }
  }
}

// TypeScript event emitter typing
export interface EmbedderEventEmitter {
  on<K extends keyof EmbedderEvents>(event: K, listener: EmbedderEvents[K]): this;
  emit<K extends keyof EmbedderEvents>(event: K, ...args: Parameters<EmbedderEvents[K]>): boolean;
  once<K extends keyof EmbedderEvents>(event: K, listener: EmbedderEvents[K]): this;
  off<K extends keyof EmbedderEvents>(event: K, listener: EmbedderEvents[K]): this;
}

/**
 * Global event emitter instance for the embedder system
 */
export const globalEmbedderEvents = new EmbedderEventEmitter({
  enableDebug: process.env.NODE_ENV !== 'production',
  enableMetrics: true,
  maxListeners: 50
});

/**
 * Create a scoped event emitter for a specific embedder instance
 */
export function createEmbedderEventEmitter(embedderId: string): {
  emitter: EmbedderEventEmitter;
  emit: <K extends keyof EmbedderEvents>(event: K, ...args: Omit<Parameters<EmbedderEvents[K]>, 0>) => boolean;
} {
  const emitter = new EmbedderEventEmitter();

  // Create a scoped emit function that automatically includes the embedder ID
  const scopedEmit = <K extends keyof EmbedderEvents>(
    event: K,
    ...args: any[]
  ): boolean => {
    return emitter.emit(event, embedderId, ...args);
  };

  return {
    emitter,
    emit: scopedEmit as any
  };
}

/**
 * Helper functions for creating common event data structures
 */
export const EmbedderEventHelpers = {
  /**
   * Create performance metrics object
   */
  createPerformanceMetrics(
    operationId: string,
    texts: number,
    duration: number,
    vectorsGenerated: number,
    errorRate = 0
  ): PerformanceMetrics {
    return {
      operationId,
      texts,
      duration,
      vectorsGenerated,
      errorRate,
      throughput: texts / (duration / 1000) // texts per second
    };
  },

  /**
   * Create memory info object
   */
  createMemoryInfo(rss: number, heapUsed: number, external: number, maxMemory: number): MemoryInfo {
    return {
      rss,
      heapUsed,
      external,
      percentage: (rss / maxMemory) * 100
    };
  },

  /**
   * Create error context object
   */
  createErrorContext(
    operation: string,
    phase: ErrorContext['phase'],
    error: Error,
    state: EmbedderState,
    retryable = false,
    metadata?: Record<string, any>
  ): ErrorContext {
    return {
      operation,
      phase,
      error,
      state,
      retryable,
      metadata
    };
  },

  /**
   * Create restart info object
   */
  createRestartInfo(
    reason: string,
    trigger: RestartInfo['trigger'],
    previousUptime: number,
    filesSinceLastRestart: number,
    restartCount: number
  ): RestartInfo {
    return {
      reason,
      trigger,
      previousUptime,
      filesSinceLastRestart,
      restartCount
    };
  },

  /**
   * Create health check result object
   */
  createHealthCheckResult(
    checks: HealthCheckResult['checks'],
    warnings: string[] = [],
    errors: string[] = []
  ): HealthCheckResult {
    const isHealthy = Object.values(checks).every(check => check) && errors.length === 0;

    return {
      isHealthy,
      checks,
      warnings,
      errors,
      timestamp: Date.now()
    };
  }
};