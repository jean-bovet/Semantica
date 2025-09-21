# Performance Architecture

*Previous: [08-startup-flow.md](./08-startup-flow.md)*

---

## Overview

This document describes the performance optimizations implemented in Semantica, focusing on the EmbedderPool architecture, CPU-aware concurrency, and profiling systems that resulted in a 2x throughput improvement.

## Performance Bottleneck Analysis

### Initial Profiling Results

Using the built-in PerformanceProfiler, we identified the following bottlenecks:

| Operation | Time (ms) | Percentage |
|-----------|-----------|------------|
| Embedding Generation | 2838 | 94.5% |
| File Parsing | 127 | 4.2% |
| Database Operations | 36 | 1.2% |
| Other | 3 | 0.1% |

**Key Finding**: Embedding generation was consuming 94.5% of processing time, making it the primary optimization target.

## EmbedderPool Architecture

### Design Principles

The EmbedderPool addresses the embedding bottleneck through:

1. **Process-Level Parallelism**: Multiple embedder processes running concurrently
2. **Round-Robin Distribution**: Even work distribution across processes
3. **Automatic Recovery**: Self-healing from crashes and memory issues
4. **Memory Isolation**: Each process has independent memory space

### Implementation

```typescript
class EmbedderPool {
  private embedders: IsolatedEmbedder[] = [];
  private currentIndex = 0;
  private restartingEmbedders = new Set<number>();
  private restartMutex = new Map<number, Promise<void>>();
  
  constructor(config: EmbedderPoolConfig) {
    // Default configuration
    this.config = {
      poolSize: 2,                    // 2 parallel processes
      maxMemoryMB: 300,               // 300MB per process
      maxFilesBeforeRestart: 5000,    // Restart after 5000 files
      modelName: 'Xenova/multilingual-e5-small'
    };
  }
  
  async embed(texts: string[], isQuery: boolean): Promise<number[][]> {
    // Round-robin selection
    const embedder = this.getNextEmbedder();
    
    // With retry logic and auto-recovery
    return embedder.embed(texts, isQuery);
  }
}
```

### Memory Management

Each embedder process has sophisticated memory management:

```typescript
class IsolatedEmbedder {
  // Memory monitoring
  private async getChildMemoryUsage(): Promise<{ rss: number }> {
    const result = execSync(`ps -o rss= -p ${this.child.pid}`);
    return { rss: result / 1024 }; // Convert to MB
  }
  
  // Proactive restart logic
  async shouldRestart(): Promise<boolean> {
    const childMem = await this.getChildMemoryUsage();
    return childMem.rss > this.maxMemoryMB || 
           this.filesSinceSpawn > this.maxFilesBeforeRestart;
  }
  
  // Memory checks during processing
  if (this.filesSinceSpawn > 50 && this.filesSinceSpawn % 10 === 0) {
    const childMem = await this.getChildMemoryUsage();
    if (childMem.rss > this.maxMemoryMB * 0.95) {  // 95% threshold
      await this.restart();
    }
  }
}
```

## CPU-Aware Concurrency

### Dynamic Scaling

The system adapts file processing concurrency based on CPU cores:

```typescript
export function getConcurrency(): number {
  const override = process.env.CPU_CONCURRENCY_OVERRIDE;
  if (override) {
    return parseInt(override, 10);
  }
  
  const cpuCount = os.cpus().length;
  
  // Use all cores minus 1, minimum 4
  const concurrency = Math.max(4, cpuCount - 1);
  
  return concurrency;
}

export function getThrottledConcurrency(): number {
  const normal = getConcurrency();
  
  // When throttled, use 1/4 of normal, minimum 2
  return Math.max(2, Math.floor(normal / 4));
}
```

### Memory-Based Throttling

The worker automatically reduces concurrency under memory pressure:

```typescript
// Check memory pressure
const memUsage = process.memoryUsage();
const rssMB = memUsage.rss / 1024 / 1024;

if (rssMB > 800) {  // 800MB threshold
  const throttled = getThrottledConcurrency();
  processingLimit = throttled;
  console.log(`[WORKER] Memory pressure detected (${rssMB.toFixed(0)}MB), throttling to ${throttled} concurrent files`);
}
```

## Batch Processing Optimization

### Embedding Batch Size

Optimized batch size for transformer model efficiency:

```typescript
const EMBEDDING_BATCH_SIZE = 32;  // Increased from 8

// Process chunks in batches
for (let i = 0; i < chunks.length; i += EMBEDDING_BATCH_SIZE) {
  const batch = chunks.slice(i, i + EMBEDDING_BATCH_SIZE);
  const batchTexts = batch.map(c => c.text);
  
  // Single call to embedder for entire batch
  const vectors = await embedderPool.embed(batchTexts);
  
  // Parallel database writes
  await Promise.all(batch.map((chunk, j) => 
    saveChunk(chunk, vectors[j])
  ));
}
```

## Performance Profiling System

### PerformanceProfiler Class

Built-in profiling for continuous optimization:

```typescript
class PerformanceProfiler {
  private enabled = false;
  private fileMetrics = new Map<string, FileMetrics>();
  private operationTimings = new Map<string, number[]>();
  
  startOperation(fileId: string, operation: string): void {
    if (!this.enabled) return;
    
    const key = `${fileId}:${operation}`;
    this.startTimes.set(key, Date.now());
  }
  
  endOperation(fileId: string, operation: string): void {
    if (!this.enabled) return;
    
    const key = `${fileId}:${operation}`;
    const startTime = this.startTimes.get(key);
    if (startTime) {
      const duration = Date.now() - startTime;
      
      // Track per-operation timings
      if (!this.operationTimings.has(operation)) {
        this.operationTimings.set(operation, []);
      }
      this.operationTimings.get(operation)!.push(duration);
    }
  }
  
  generateReport(): PerformanceReport {
    // Calculate bottlenecks
    const totalTime = Array.from(this.operationTimings.values())
      .flat()
      .reduce((a, b) => a + b, 0);
    
    const bottlenecks = Array.from(this.operationTimings.entries())
      .map(([op, times]) => ({
        operation: op,
        avgTime: times.reduce((a, b) => a + b, 0) / times.length,
        percentage: (times.reduce((a, b) => a + b, 0) / totalTime) * 100
      }))
      .sort((a, b) => b.percentage - a.percentage);
    
    return {
      summary: {
        totalFiles: this.fileMetrics.size,
        totalTime,
        avgTimePerFile: totalTime / this.fileMetrics.size,
        throughput: (this.fileMetrics.size / totalTime) * 60000  // files/minute
      },
      bottlenecks
    };
  }
}
```

### Profiling Integration

Profiling is integrated throughout the processing pipeline:

```typescript
// In worker/index.ts
if (process.env.PROFILING === 'true') {
  profiler.setEnabled(true);
}

// Track each operation
profiler.startOperation(fileId, 'parsing');
const text = await parseFile(filePath);
profiler.endOperation(fileId, 'parsing');

profiler.startOperation(fileId, 'chunking');
const chunks = splitIntoChunks(text);
profiler.endOperation(fileId, 'chunking');

profiler.startOperation(fileId, 'embedding');
const vectors = await embedderPool.embed(chunkTexts);
profiler.endOperation(fileId, 'embedding');
```

## Performance Results

### Before Optimization

- **Throughput**: ~60 files/minute
- **Memory Usage**: ~270MB steady state, frequent spikes
- **Crash Frequency**: Every 0-3 files with certain documents
- **Bottleneck**: Single embedder process at 94.5% of time

### After Optimization

- **Throughput**: ~120 files/minute (2x improvement)
- **Memory Usage**: Worker 1.5GB, Embedders 300MB each (controlled)
- **Crash Frequency**: Reduced to every 15-20 files
- **Bottleneck**: Distributed across 2 embedder processes

### Benchmark Comparison

| Metric | Before | After | Improvement |
|--------|--------|-------|-------------|
| Files/minute | 60 | 120 | 2x |
| Embedding time per batch | 400ms | 200ms | 2x |
| Memory stability | Poor | Excellent | ✓ |
| Crash recovery | Manual | Automatic | ✓ |
| CPU utilization | 25% | 75% | 3x |

## Future Optimizations

### Potential Improvements

1. **Dynamic Pool Sizing**: Adjust pool size based on system resources
2. **GPU Acceleration**: Use Metal Performance Shaders on Apple Silicon
3. **Incremental Embeddings**: Cache and reuse unchanged chunk embeddings
4. **Compression**: Reduce vector storage size with quantization
5. **Streaming Processing**: Process files as streams to reduce memory

### Scaling Considerations

The current architecture can scale to:
- **Pool Size**: Up to CPU core count
- **Throughput**: Linear scaling with pool size
- **Memory**: ~300MB per embedder process
- **Files**: Tested with 100,000+ documents

## Configuration Tuning

### Environment Variables

```bash
# Increase pool size for more parallelism
EMBEDDER_POOL_SIZE=4

# Adjust memory limits
EMBEDDER_MAX_RSS=400

# Override CPU concurrency
CPU_CONCURRENCY_OVERRIDE=16

# Enable profiling
PROFILING=true
```

### Recommended Settings

| System | Pool Size | Memory Limit | Concurrency |
|--------|-----------|--------------|-------------|
| 8GB RAM, 4 cores | 2 | 250MB | 4 |
| 16GB RAM, 8 cores | 4 | 300MB | 7 |
| 32GB RAM, 10+ cores | 6 | 400MB | 9 |

## Monitoring and Debugging

### Health Checks

The system includes automatic health monitoring:

```typescript
// Periodic health check
setInterval(async () => {
  await embedderPool.checkHealth();
}, 30000);  // Every 30 seconds

// Health check implementation
async checkHealth(): Promise<void> {
  for (let i = 0; i < this.embedders.length; i++) {
    const stats = this.embedders[i].getStats();
    if (!stats.isReady) {
      await this.restart(i);
    }
  }
}
```

### Debug Logging

Enable detailed logging for troubleshooting:

```bash
DEBUG=fss:* npm run dev
```

### Performance Monitoring

Real-time performance metrics in the UI:
- Files queued/processing/done
- Memory usage (RSS, heap, external)
- Embedder pool status
- Throughput (files/minute)

## Pipeline Status Display

### Overview

The pipeline status formatter provides real-time visualization of file processing state, showing files moving through PARSING → EMBEDDING → completion stages.

### File Tracker Lifecycle

To ensure accurate status display, file trackers are maintained throughout the entire processing lifecycle:

```typescript
// In EmbeddingQueue.ts
class EmbeddingQueue {
  private fileTrackers = new Map<string, FileTracker>();

  // Trackers persist after embedding completion
  // No automatic cleanup - trackers remain until explicitly removed

  cleanupFileTracker(filePath: string): void {
    this.fileTrackers.delete(filePath);
  }
}

// In worker/index.ts handleFile()
try {
  // Process file...
  await embeddingQueue.waitForCompletion(filePath);
} finally {
  // Explicit cleanup only after ALL processing complete
  embeddingQueue.cleanupFileTracker(filePath);
}
```

### Status Display Logic

The PipelineStatusFormatter determines file status based on:
1. **PARSING**: File in processingFiles array but no tracker or totalChunks = 0
2. **EMBEDDING**: File has tracker with totalChunks > 0
3. **Progress**: Shows (processedChunks / totalChunks) * 100%

### Memory Indicator

The "Memory: XXX/1500MB" indicator shows:
- **Value**: RSS (Resident Set Size) of the entire Electron main process
- **Source**: `process.memoryUsage().rss` called from worker thread
- **Includes**: Both main thread and worker thread memory (they share the same process)
- **Limit**: 1500MB - the total memory limit for the Electron main process
- **Note**: Embedder processes are separate child processes with independent 300MB limits not included in this value

**Important**: Worker threads in Node.js run within the same process as the main thread, sharing the same memory space but with isolated V8 contexts. Therefore, `process.memoryUsage().rss` returns the total RSS of the entire process, not just the worker thread's memory.

---

*Previous: [08-startup-flow.md](./08-startup-flow.md) | Next: [10-future-roadmap.md](./10-future-roadmap.md)*