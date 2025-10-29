# Performance Architecture (LEGACY - EmbedderPool)

> **⚠️ LEGACY DOCUMENTATION**: This document describes the performance architecture for the obsolete Transformers.js/ONNX and Ollama embedding systems (v1.0.0-v1.0.3). The current implementation uses a Python FastAPI sidecar with sentence-transformers, which has simpler performance characteristics. For current performance documentation, see:
> - [python-sidecar-performance-guide.md](../../guides/python-sidecar-performance-guide.md) - Current performance tuning
> - [python-sidecar-performance-results.md](../../analysis/python-sidecar-performance-results.md) - Current benchmarks

---

## Overview

This document consolidates all performance optimizations implemented for the legacy EmbedderPool architecture, focusing on the ONNX/Ollama embedding systems, CPU-aware concurrency, memory management, and profiling systems that achieved a 4x throughput improvement.

## Performance Evolution

### Initial State (v1.0.0)
- **Throughput**: 0.5 files/second
- **Stability**: Frequent crashes after ~50 files
- **Memory**: Uncontrolled growth leading to OOM errors
- **Architecture**: Single embedder in main worker thread

### Current State (v1.0.3)
- **Throughput**: 8-10 files/second
- **Stability**: Processes 10,000+ files without crashes
- **Memory**: Controlled with automatic recycling
- **Architecture**: Multi-process pool with load balancing

## Performance Bottleneck Analysis

### Profiling Results (2025-08-31)

Using the built-in PerformanceProfiler (`src/main/core/embedding/PerformanceProfiler.ts`), we identified:

| Operation | Time (ms) | Percentage | Impact |
|-----------|-----------|------------|--------|
| Embedding Generation | 2838 | 94.5% | Critical bottleneck |
| File Parsing | 127 | 4.2% | Minimal |
| Database Operations | 36 | 1.2% | Minimal |
| Chunking | 3 | 0.1% | Negligible |

**Key Finding**: Embedding generation consumed 94.5% of processing time, making it the primary optimization target.

## Solution Architecture

### 1. EmbedderPool System

Located in `src/shared/embeddings/embedder-pool.ts`, the pool manages multiple isolated embedder processes:

```typescript
class EmbedderPool {
  private pool: IsolatedEmbedder[] = [];
  private currentIndex = 0;
  private maxPoolSize: number;

  async initialize(config: PoolConfig) {
    // Create pool based on CPU cores
    this.maxPoolSize = Math.min(config.maxPoolSize || 2, os.cpus().length - 1);

    for (let i = 0; i < this.maxPoolSize; i++) {
      const embedder = new IsolatedEmbedder({
        modelPath: config.modelPath,
        id: `embedder-${i}`
      });
      await embedder.initialize();
      this.pool.push(embedder);
    }
  }

  // Round-robin load balancing
  getNextEmbedder(): IsolatedEmbedder {
    const embedder = this.pool[this.currentIndex];
    this.currentIndex = (this.currentIndex + 1) % this.pool.length;
    return embedder;
  }
}
```

### 2. Memory Management

Each embedder process (`src/shared/embeddings/isolated.ts`) implements strict memory controls:

```typescript
class IsolatedEmbedder {
  private filesProcessed = 0;
  private memoryThreshold = 300 * 1024 * 1024; // 300MB

  async checkHealth(): Promise<boolean> {
    // Auto-restart after processing threshold
    if (this.filesProcessed >= 200) {
      await this.restart();
      return true;
    }

    // Check memory usage
    const memUsage = await this.getMemoryUsage();
    if (memUsage > this.memoryThreshold) {
      await this.restart();
      return true;
    }

    return true;
  }
}
```

### 3. CPU-Aware Concurrency

The system dynamically adjusts concurrency based on CPU availability (`src/main/worker/cpuConcurrency.ts`):

```typescript
export function calculateOptimalConcurrency(): number {
  const cpuCount = os.cpus().length;

  if (cpuCount <= 2) return 1;      // Low-end: Conservative
  if (cpuCount <= 4) return 2;      // Mid-range: Moderate
  if (cpuCount <= 8) return 3;      // High-end: Balanced
  return Math.min(4, cpuCount - 4); // Server: Aggressive but safe
}
```

### 4. Batch Processing Optimization

The EmbeddingQueue (`src/main/core/embedding/EmbeddingQueue.ts`) implements efficient batching:

```typescript
class EmbeddingQueue {
  private batchSize = 32;  // Increased from 8
  private parallelBatches = 2;  // Process 2 batches concurrently

  async processBatch(chunks: Chunk[]): Promise<void> {
    // Split into optimal batch sizes
    const batches = this.splitIntoBatches(chunks, this.batchSize);

    // Process batches in parallel
    const promises = batches.slice(0, this.parallelBatches)
      .map(batch => this.embedBatch(batch));

    await Promise.all(promises);
  }
}
```

### 5. Dynamic Token-Based Batching (2025-10-25)

**Problem**: Ollama's internal buffer has a ~8-10K token limit per request. Fixed batch sizes (32 chunks) caused HTTP 500 EOF errors when processing documents with large chunks (GitHub issue ollama/ollama#6094).

**Solution**: The EmbeddingQueue now dynamically calculates batch size based on total token count:

```typescript
class EmbeddingQueue {
  private maxTokensPerBatch = 8000;  // Safe limit for Ollama

  private estimateTokens(text: string): number {
    return Math.ceil(text.length / 4);  // 1 token ≈ 4 characters
  }

  private calculateBatchSize(): number {
    let batchSize = 0;
    let totalTokens = 0;
    const maxBatchSize = Math.min(this.batchSize, this.queue.length);

    // Keep adding chunks while under token limit
    for (let i = 0; i < maxBatchSize; i++) {
      const chunkTokens = this.estimateTokens(this.queue[i].text);

      // Stop if adding this chunk would exceed the limit
      if (totalTokens + chunkTokens > this.maxTokensPerBatch && batchSize > 0) {
        break;
      }

      totalTokens += chunkTokens;
      batchSize++;
    }

    return Math.max(1, batchSize);  // Always process at least 1 chunk
  }
}
```

**Benefits**:
- **Eliminates EOF errors**: Stays within Ollama's token limits
- **Adaptive throughput**: Small chunks (50 words) → batch of ~60 chunks, Large chunks (500 words) → batch of ~12 chunks
- **Backward compatible**: Respects `embeddingBatchSize` config as maximum limit
- **Optimal performance**: Maximizes batch size without exceeding limits

**Configuration**:
```typescript
new EmbeddingQueue({
  batchSize: 32,              // Maximum chunks per batch
  maxTokensPerBatch: 8000,    // Token limit (Ollama constraint)
});
```

**Test Results** (from `tests/unit/embedding-queue-dynamic-batching.spec.ts`):
- ✅ 64 small chunks (50 words each) → Single batch with ~4,000 tokens
- ✅ 32 large chunks (500 words each) → Multiple batches of ~12 chunks each
- ✅ Single huge chunk (50,000 tokens) → Processes without error
- ✅ Mixed sizes → Intelligent batch boundaries

## Performance Monitoring

### Built-in Profiler

Enable profiling with environment variable:

```bash
PROFILE=true npm run dev
```

Generates detailed reports in `~/Library/Logs/Semantica/performance-{timestamp}.json`:

```json
{
  "summary": {
    "totalFiles": 1000,
    "totalTime": 125000,
    "avgTimePerFile": 125,
    "throughput": 8.0
  },
  "operations": {
    "embedding": { "total": 118125, "percentage": 94.5 },
    "parsing": { "total": 5250, "percentage": 4.2 },
    "database": { "total": 1500, "percentage": 1.2 }
  }
}
```

### Real-time Pipeline Status

Monitor performance in real-time with selective logging:

```bash
LOG_CATEGORIES=PIPELINE-STATUS,MEMORY npm run dev
```

Shows live statistics:
```
╭─────────────── Pipeline Status ───────────────╮
│ Files     │ ✓ 234  │ ⚡ 2    │ ⏳ 45  │ ✗ 0  │
│ Embedding │ ◉ 2/2 embedders │ 📦 89 queued    │
│ Memory    │ Worker: 156MB   │ Embedders: 245MB │
│ Speed     │ 8.3 files/sec   │ ETA: 5m 23s     │
╰────────────────────────────────────────────────╯
```

## Performance Tuning

### Configuration Options

Located in `src/main/worker/config.ts`:

```typescript
interface PerformanceConfig {
  // Embedding settings
  embeddingBatchSize: number;      // Default: 32
  parallelBatches: number;         // Default: 2
  maxEmbedderPoolSize: number;     // Default: CPU-based

  // Memory management
  embedderRestartThreshold: number; // Default: 200 files
  maxMemoryPerEmbedder: number;    // Default: 300MB

  // Queue management
  maxQueueSize: number;            // Default: 2000
  backpressureThreshold: number;   // Default: 1000
}
```

### Optimization Guidelines

1. **For High-Memory Systems (16GB+)**:
   - Increase `embeddingBatchSize` to 64
   - Set `parallelBatches` to 3
   - Increase `maxMemoryPerEmbedder` to 500MB

2. **For Many-Core Systems (8+ cores)**:
   - Set `maxEmbedderPoolSize` to 4
   - Enable aggressive concurrency
   - Increase queue sizes

3. **For Low-End Systems (4GB RAM)**:
   - Reduce `embeddingBatchSize` to 16
   - Set `parallelBatches` to 1
   - Lower `embedderRestartThreshold` to 100

## Results Summary

### Throughput Improvements

| Version | Architecture | Batch Size | Throughput | Improvement |
|---------|-------------|------------|------------|-------------|
| v1.0.0 | Single process | 8 | 0.5 files/sec | Baseline |
| v1.0.1 | Process pool (2) | 8 | 2 files/sec | 4x |
| v1.0.2 | Process pool (2) | 32 | 4 files/sec | 8x |
| v1.0.3 | Pool + parallel batches | 32 | 8-10 files/sec | 16-20x |

### Stability Improvements

- **Before**: Crashed after 50-100 files
- **After**: Successfully processes 10,000+ files
- **Memory**: Stable at ~500MB total (worker + embedders)
- **Recovery**: Automatic restart on memory threshold

## Future Optimizations

### Planned Improvements

1. **GPU Acceleration**:
   - Integrate ONNX Runtime GPU provider
   - Expected 5-10x additional speedup

2. **Incremental Indexing**:
   - Skip unchanged files based on hash
   - Reduce re-indexing time by 90%

3. **Distributed Processing**:
   - Support for network-based embedder nodes
   - Scale beyond single machine limits

### Research Areas

- WebAssembly embeddings for lighter memory footprint
- Quantized models (int8) for faster inference
- Streaming embeddings to reduce memory usage