/**
 * Performance Profiler for FSS/Semantica
 * 
 * Measures and reports performance metrics for all pipeline stages
 * to identify actual bottlenecks in the indexing process.
 */

import * as fs from 'fs';
import * as path from 'path';
import { performance } from 'perf_hooks';

interface TimingEntry {
  operation: string;
  startTime: number;
  endTime?: number;
  duration?: number;
  metadata?: Record<string, any>;
}

interface MemorySnapshot {
  timestamp: number;
  rss: number;
  heapUsed: number;
  heapTotal: number;
  external: number;
  operation?: string;
}

interface FileMetrics {
  filePath: string;
  fileSize: number;
  extension: string;
  timings: {
    total?: number;
    hashCheck?: number;
    parsing?: number;
    chunking?: number;
    embedding?: number;
    dbWrite?: number;
    embedderRestarts?: number;
  };
  chunks: {
    count: number;
    avgSize: number;
  };
  embeddingBatches: number;
  errors?: string[];
}

interface AggregateMetrics {
  totalFiles: number;
  successfulFiles: number;
  failedFiles: number;
  totalDuration: number;
  averageFileTime: number;
  
  // Breakdown by operation
  operations: {
    [key: string]: {
      count: number;
      totalTime: number;
      avgTime: number;
      minTime: number;
      maxTime: number;
      percentOfTotal: number;
    };
  };
  
  // File type analysis
  fileTypes: {
    [ext: string]: {
      count: number;
      avgTime: number;
      totalSize: number;
      avgSize: number;
    };
  };
  
  // Bottleneck analysis
  bottlenecks: {
    operation: string;
    impact: number; // percentage of total time
    recommendation: string;
  }[];
  
  // Concurrency metrics
  concurrency: {
    avgConcurrent: number;
    maxConcurrent: number;
    throttleEvents: number;
    throttleDuration: number;
  };
  
  // Memory metrics
  memory: {
    peakRSS: number;
    avgRSS: number;
    embedderRestarts: number;
    gcPauses: number;
  };
  
  // Database metrics
  database: {
    totalWrites: number;
    avgBatchSize: number;
    writeQueueDepth: number[];
    conflicts: number;
  };
}

export class PerformanceProfiler {
  private enabled: boolean = false;
  public fileMetrics: Map<string, FileMetrics> = new Map();  // Made public for direct access
  private timings: Map<string, TimingEntry> = new Map();
  private memorySnapshots: MemorySnapshot[] = [];
  private concurrentOps: Set<string> = new Set();
  private maxConcurrent: number = 0;
  private throttleEvents: number = 0;
  private throttleStartTime: number | null = null;
  private throttleTotalDuration: number = 0;
  private embedderRestarts: number = 0;
  private dbWriteQueue: number[] = [];
  private dbConflicts: number = 0;
  private gcPauses: number = 0;
  private startTime: number = Date.now();
  
  constructor(enabled: boolean = true) {
    this.enabled = enabled;
    if (enabled) {
      this.setupGCMonitoring();
      this.startMemoryMonitoring();
    }
  }
  
  private setupGCMonitoring(): void {
    if (global.gc) {
      const originalGC = global.gc;
      global.gc = (async () => {
        const start = performance.now();
        await originalGC();
        const duration = performance.now() - start;
        if (duration > 10) { // Only count significant GC pauses
          this.gcPauses++;
        }
      }) as any;
    }
  }
  
  private startMemoryMonitoring(): void {
    setInterval(() => {
      if (!this.enabled) return;
      
      const usage = process.memoryUsage();
      this.memorySnapshots.push({
        timestamp: Date.now(),
        rss: usage.rss,
        heapUsed: usage.heapUsed,
        heapTotal: usage.heapTotal,
        external: usage.external
      });
      
      // Keep only last 1000 snapshots
      if (this.memorySnapshots.length > 1000) {
        this.memorySnapshots.shift();
      }
    }, 1000);
  }
  
  // Start timing an operation
  startOperation(operationId: string, metadata?: Record<string, any>): void {
    if (!this.enabled) return;
    
    this.timings.set(operationId, {
      operation: operationId,
      startTime: performance.now(),
      metadata
    });
    
    // Track concurrent operations
    this.concurrentOps.add(operationId);
    this.maxConcurrent = Math.max(this.maxConcurrent, this.concurrentOps.size);
  }
  
  // End timing an operation
  endOperation(operationId: string): number {
    if (!this.enabled) return 0;
    
    const entry = this.timings.get(operationId);
    if (!entry) return 0;
    
    entry.endTime = performance.now();
    entry.duration = entry.endTime - entry.startTime;
    
    this.concurrentOps.delete(operationId);
    
    return entry.duration;
  }
  
  // Start tracking a file
  startFile(filePath: string, fileSize: number, extension: string): void {
    if (!this.enabled) return;
    
    const fileId = `file:${filePath}`;
    this.startOperation(fileId, { filePath, fileSize, extension });
    
    this.fileMetrics.set(filePath, {
      filePath,
      fileSize,
      extension,
      timings: {},
      chunks: { count: 0, avgSize: 0 },
      embeddingBatches: 0
    });
  }
  
  // End tracking a file
  endFile(filePath: string, success: boolean = true, error?: string): void {
    if (!this.enabled) return;
    
    const fileId = `file:${filePath}`;
    const duration = this.endOperation(fileId);
    
    const metrics = this.fileMetrics.get(filePath);
    if (metrics) {
      metrics.timings.total = duration;
      if (!success && error) {
        metrics.errors = [error];
      }
    }
  }
  
  // Track specific operations within a file
  timeFileOperation(filePath: string, operation: string, fn: () => any): any {
    if (!this.enabled) return fn();
    
    const opId = `${filePath}:${operation}`;
    this.startOperation(opId);
    
    try {
      const result = fn();
      const duration = this.endOperation(opId);
      
      const metrics = this.fileMetrics.get(filePath);
      if (metrics) {
        (metrics.timings as any)[operation] = duration;
      }
      
      return result;
    } catch (error) {
      this.endOperation(opId);
      throw error;
    }
  }
  
  // Track async operations
  async timeFileOperationAsync<T>(
    filePath: string, 
    operation: string, 
    fn: () => Promise<T>
  ): Promise<T> {
    if (!this.enabled) return fn();
    
    const opId = `${filePath}:${operation}`;
    this.startOperation(opId);
    
    try {
      const result = await fn();
      const duration = this.endOperation(opId);
      
      const metrics = this.fileMetrics.get(filePath);
      if (metrics) {
        (metrics.timings as any)[operation] = duration;
      }
      
      return result;
    } catch (error) {
      this.endOperation(opId);
      throw error;
    }
  }
  
  // Track chunk processing
  recordChunks(filePath: string, chunkCount: number, avgSize: number): void {
    if (!this.enabled) return;
    
    const metrics = this.fileMetrics.get(filePath);
    if (metrics) {
      metrics.chunks = { count: chunkCount, avgSize };
    }
  }
  
  // Track embedding batches
  recordEmbeddingBatch(filePath: string): void {
    if (!this.enabled) return;
    
    const metrics = this.fileMetrics.get(filePath);
    if (metrics) {
      metrics.embeddingBatches++;
    }
  }
  
  // Track embedder restarts
  recordEmbedderRestart(): void {
    if (!this.enabled) return;
    this.embedderRestarts++;
  }
  
  // Track throttling
  recordThrottleStart(): void {
    if (!this.enabled) return;
    
    this.throttleEvents++;
    this.throttleStartTime = Date.now();
  }
  
  recordThrottleEnd(): void {
    if (!this.enabled) return;
    
    if (this.throttleStartTime) {
      this.throttleTotalDuration += Date.now() - this.throttleStartTime;
      this.throttleStartTime = null;
    }
  }
  
  // Track database operations
  recordDBWrite(batchSize: number, queueDepth: number): void {
    if (!this.enabled) return;
    
    this.dbWriteQueue.push(queueDepth);
  }
  
  recordDBConflict(): void {
    if (!this.enabled) return;
    this.dbConflicts++;
  }
  
  // Generate aggregate metrics
  generateReport(): AggregateMetrics {
    const totalDuration = Date.now() - this.startTime;
    const files = Array.from(this.fileMetrics.values());
    const successfulFiles = files.filter(f => !f.errors?.length);
    const failedFiles = files.filter(f => f.errors?.length);
    
    // Aggregate operation timings
    const operationTotals: Record<string, number[]> = {};
    
    for (const file of successfulFiles) {
      for (const [op, time] of Object.entries(file.timings)) {
        if (time && op !== 'total') {
          if (!operationTotals[op]) operationTotals[op] = [];
          operationTotals[op].push(time);
        }
      }
    }
    
    // Calculate operation statistics
    const operations: AggregateMetrics['operations'] = {};
    let totalOperationTime = 0;
    
    for (const [op, times] of Object.entries(operationTotals)) {
      const total = times.reduce((a, b) => a + b, 0);
      totalOperationTime += total;
      
      operations[op] = {
        count: times.length,
        totalTime: total,
        avgTime: total / times.length,
        minTime: Math.min(...times),
        maxTime: Math.max(...times),
        percentOfTotal: 0 // Will calculate after
      };
    }
    
    // Calculate percentages
    for (const op of Object.values(operations)) {
      op.percentOfTotal = (op.totalTime / totalOperationTime) * 100;
    }
    
    // File type analysis
    const fileTypes: AggregateMetrics['fileTypes'] = {};
    
    for (const file of files) {
      if (!fileTypes[file.extension]) {
        fileTypes[file.extension] = {
          count: 0,
          avgTime: 0,
          totalSize: 0,
          avgSize: 0
        };
      }
      
      const type = fileTypes[file.extension];
      type.count++;
      type.totalSize += file.fileSize;
      type.avgTime = ((type.avgTime * (type.count - 1)) + (file.timings.total || 0)) / type.count;
      type.avgSize = type.totalSize / type.count;
    }
    
    // Identify bottlenecks
    const bottlenecks: AggregateMetrics['bottlenecks'] = [];
    
    // Sort operations by total time
    const sortedOps = Object.entries(operations)
      .sort((a, b) => b[1].totalTime - a[1].totalTime);
    
    for (const [opName, opStats] of sortedOps.slice(0, 3)) {
      let recommendation = '';
      
      if (opName === 'embedding' && opStats.percentOfTotal > 40) {
        recommendation = 'Embedding is the bottleneck. Consider: 1) Increasing batch size, 2) Using GPU acceleration, 3) Caching common embeddings';
      } else if (opName === 'parsing' && opStats.percentOfTotal > 30) {
        recommendation = 'File parsing is slow. Consider: 1) Streaming parsers for large files, 2) Parallel parsing, 3) Caching parsed content';
      } else if (opName === 'dbWrite' && opStats.percentOfTotal > 20) {
        recommendation = 'Database writes are slow. Consider: 1) Larger batch sizes, 2) Async writes, 3) Write buffering';
      } else if (opName === 'hashCheck' && opStats.percentOfTotal > 10) {
        recommendation = 'Hash checking overhead. Consider: 1) In-memory hash cache, 2) Bloom filter for quick checks';
      }
      
      if (recommendation) {
        bottlenecks.push({
          operation: opName,
          impact: opStats.percentOfTotal,
          recommendation
        });
      }
    }
    
    // Memory metrics
    const memoryStats = {
      peakRSS: Math.max(...this.memorySnapshots.map(s => s.rss)),
      avgRSS: this.memorySnapshots.reduce((a, s) => a + s.rss, 0) / this.memorySnapshots.length,
      embedderRestarts: this.embedderRestarts,
      gcPauses: this.gcPauses
    };
    
    // Add bottleneck for excessive embedder restarts
    if (this.embedderRestarts > files.length / 100) {
      bottlenecks.push({
        operation: 'embedderRestart',
        impact: (this.embedderRestarts * 60000) / totalDuration * 100, // Assume 60s per restart
        recommendation: 'Frequent embedder restarts detected. Increase maxFilesBeforeRestart and maxMemoryMB thresholds'
      });
    }
    
    return {
      totalFiles: files.length,
      successfulFiles: successfulFiles.length,
      failedFiles: failedFiles.length,
      totalDuration,
      averageFileTime: totalDuration / files.length,
      operations,
      fileTypes,
      bottlenecks,
      concurrency: {
        avgConcurrent: this.concurrentOps.size,
        maxConcurrent: this.maxConcurrent,
        throttleEvents: this.throttleEvents,
        throttleDuration: this.throttleTotalDuration
      },
      memory: memoryStats,
      database: {
        totalWrites: this.dbWriteQueue.length,
        avgBatchSize: 8, // From code analysis
        writeQueueDepth: this.dbWriteQueue,
        conflicts: this.dbConflicts
      }
    };
  }
  
  // Save detailed report to file
  async saveReport(outputPath?: string): Promise<void> {
    if (!this.enabled) return;
    
    const report = this.generateReport();
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const fileName = outputPath || path.join(
      process.env.HOME || '.',
      `fss-performance-${timestamp}.json`
    );
    
    // Create human-readable summary
    const summary = this.formatSummary(report);
    
    const fullReport = {
      summary,
      metrics: report,
      fileDetails: Array.from(this.fileMetrics.values()),
      memorySnapshots: this.memorySnapshots.slice(-100) // Last 100 snapshots
    };
    
    fs.writeFileSync(fileName, JSON.stringify(fullReport, null, 2));
    console.log(`\n📊 Performance report saved to: ${fileName}`);
    console.log(summary);
  }
  
  private formatSummary(report: AggregateMetrics): string {
    const lines: string[] = [
      '\n========================================',
      '     PERFORMANCE ANALYSIS SUMMARY',
      '========================================',
      '',
      `📁 Files Processed: ${report.successfulFiles}/${report.totalFiles}`,
      `⏱️  Total Time: ${(report.totalDuration / 1000).toFixed(1)}s`,
      `⚡ Avg File Time: ${(report.averageFileTime / 1000).toFixed(2)}s`,
      `🔄 Max Concurrency: ${report.concurrency.maxConcurrent}`,
      '',
      '📊 Operation Breakdown:',
    ];
    
    // Sort operations by time
    const sortedOps = Object.entries(report.operations)
      .sort((a, b) => b[1].totalTime - a[1].totalTime);
    
    for (const [name, stats] of sortedOps) {
      const bar = '█'.repeat(Math.round(stats.percentOfTotal / 2));
      lines.push(`  ${name.padEnd(12)} ${bar} ${stats.percentOfTotal.toFixed(1)}% (${(stats.avgTime / 1000).toFixed(2)}s avg)`);
    }
    
    if (report.bottlenecks.length > 0) {
      lines.push('', '🚨 Identified Bottlenecks:');
      for (const bottleneck of report.bottlenecks) {
        lines.push(`  • ${bottleneck.operation} (${bottleneck.impact.toFixed(1)}% impact)`);
        lines.push(`    → ${bottleneck.recommendation}`);
      }
    }
    
    lines.push('', '💾 Memory Stats:');
    lines.push(`  Peak RSS: ${(report.memory.peakRSS / 1024 / 1024).toFixed(0)}MB`);
    lines.push(`  Avg RSS: ${(report.memory.avgRSS / 1024 / 1024).toFixed(0)}MB`);
    lines.push(`  Embedder Restarts: ${report.memory.embedderRestarts}`);
    
    if (report.concurrency.throttleEvents > 0) {
      lines.push('', '⚠️  Performance Issues:');
      lines.push(`  Throttle Events: ${report.concurrency.throttleEvents}`);
      lines.push(`  Throttle Duration: ${(report.concurrency.throttleDuration / 1000).toFixed(1)}s`);
    }
    
    lines.push('', '========================================');
    
    return lines.join('\n');
  }
  
  // Reset all metrics
  reset(): void {
    this.fileMetrics.clear();
    this.timings.clear();
    this.memorySnapshots = [];
    this.concurrentOps.clear();
    this.maxConcurrent = 0;
    this.throttleEvents = 0;
    this.throttleTotalDuration = 0;
    this.embedderRestarts = 0;
    this.dbWriteQueue = [];
    this.dbConflicts = 0;
    this.gcPauses = 0;
    this.startTime = Date.now();
  }
  
  // Enable/disable profiling
  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
  }
  
  isEnabled(): boolean {
    return this.enabled;
  }
}

// Singleton instance
export const profiler = new PerformanceProfiler(process.env.PROFILE === 'true');