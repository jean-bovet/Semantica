/**
 * Shared memory monitoring utility for tracking process memory usage
 * Used by both worker thread and embedder child process
 */

export interface MemoryStats {
  rssMB: number;
  heapMB: number;
  heapTotalMB: number;
  externalMB: number;
  arrayBuffersMB?: number;
}

export interface MemoryMonitorOptions {
  /** Prefix for log messages */
  logPrefix?: string;
  /** RSS change threshold in MB to trigger logging */
  rssThreshold?: number;
  /** Heap change threshold in MB to trigger logging */
  heapThreshold?: number;
  /** Monitoring interval in milliseconds */
  intervalMs?: number;
  /** Custom counter name (e.g., "Files processed", "Embeddings created") */
  counterName?: string;
  /** Enable array buffers tracking */
  trackArrayBuffers?: boolean;
}

export class MemoryMonitor {
  private lastLog: MemoryStats & { counter: number } = {
    rssMB: 0,
    heapMB: 0,
    heapTotalMB: 0,
    externalMB: 0,
    arrayBuffersMB: 0,
    counter: 0
  };
  
  private interval: NodeJS.Timeout | null = null;
  private counter = 0;
  private readonly options: Required<MemoryMonitorOptions>;
  
  constructor(options: MemoryMonitorOptions = {}) {
    this.options = {
      logPrefix: 'Memory',
      rssThreshold: 10,
      heapThreshold: 5,
      intervalMs: 2000,
      counterName: 'Operations',
      trackArrayBuffers: false,
      ...options
    };
  }
  
  /**
   * Start monitoring memory usage
   */
  start(): void {
    if (this.interval) {
      return; // Already monitoring
    }
    
    this.interval = setInterval(() => {
      this.checkAndLog();
    }, this.options.intervalMs);
    
    // Log initial state
    this.forceLog();
  }
  
  /**
   * Stop monitoring memory usage
   */
  stop(): void {
    if (this.interval) {
      clearInterval(this.interval);
      this.interval = null;
    }
  }
  
  /**
   * Increment the counter (e.g., files processed, embeddings created)
   */
  increment(count = 1): void {
    this.counter += count;
  }
  
  /**
   * Get current counter value
   */
  getCounter(): number {
    return this.counter;
  }
  
  /**
   * Reset counter to zero
   */
  resetCounter(): void {
    this.counter = 0;
  }
  
  /**
   * Get current memory statistics
   */
  getStats(): MemoryStats {
    const usage = process.memoryUsage();
    return {
      rssMB: Math.round(usage.rss / 1024 / 1024),
      heapMB: Math.round(usage.heapUsed / 1024 / 1024),
      heapTotalMB: Math.round(usage.heapTotal / 1024 / 1024),
      externalMB: Math.round(usage.external / 1024 / 1024),
      ...(this.options.trackArrayBuffers && {
        arrayBuffersMB: Math.round(usage.arrayBuffers / 1024 / 1024)
      })
    };
  }
  
  /**
   * Check if memory has changed significantly and log if needed
   */
  private checkAndLog(): void {
    const stats = this.getStats();
    
    // Check if there's a significant change
    const rssChanged = Math.abs(stats.rssMB - this.lastLog.rssMB) >= this.options.rssThreshold;
    const heapChanged = Math.abs(stats.heapMB - this.lastLog.heapMB) >= this.options.heapThreshold;
    const counterChanged = this.counter !== this.lastLog.counter;
    
    if (rssChanged || heapChanged || counterChanged) {
      this.log(stats);
    }
  }
  
  /**
   * Force a log entry regardless of thresholds
   */
  forceLog(): void {
    const stats = this.getStats();
    this.log(stats);
  }
  
  /**
   * Log memory statistics
   */
  private log(stats: MemoryStats): void {
    let message = `[${this.options.logPrefix}] RSS=${stats.rssMB}MB, Heap=${stats.heapMB}MB/${stats.heapTotalMB}MB, External=${stats.externalMB}MB`;
    
    if (this.options.trackArrayBuffers && stats.arrayBuffersMB !== undefined) {
      message += `, ArrayBuffers=${stats.arrayBuffersMB}MB`;
    }
    
    message += `, ${this.options.counterName}: ${this.counter}`;
    
    console.log(message);
    
    // Update last log
    this.lastLog = {
      ...stats,
      counter: this.counter
    };
  }
  
  /**
   * Check if memory exceeds specified limits
   */
  isMemoryHigh(rssLimitMB: number): boolean {
    const stats = this.getStats();
    return stats.rssMB > rssLimitMB;
  }
  
  /**
   * Get memory growth rate (MB per operation)
   */
  getGrowthRate(): number {
    if (this.counter === 0) return 0;
    const stats = this.getStats();
    return (stats.rssMB - this.lastLog.rssMB) / this.counter;
  }
}