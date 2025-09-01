# Performance Architecture

## Overview
This document describes the performance optimizations implemented in Semantica's embedding generation system, focusing on the embedder pool architecture and memory management strategies.

## Performance Bottleneck Analysis

### Initial Findings (2025-08-31)
Performance profiling revealed that embedding generation consumed **94.5%** of processing time:

| Operation | Time % | Avg Duration | Impact |
|-----------|--------|--------------|--------|
| Embedding | 94.5% | 3.48s | Critical bottleneck |
| DB Write | 5.0% | 184ms | Minimal |
| Parsing | 0.5% | 15ms | Negligible |
| Chunking | 0.0% | 1ms | Negligible |

**Initial Performance**: 2 files/second with frequent crashes

## Solution: Embedder Process Pool

### Architecture
```
Worker Thread
    ├── EmbedderPool (manages distribution)
    │   ├── IsolatedEmbedder #1 (child process)
    │   │   └── Transformer.js model
    │   └── IsolatedEmbedder #2 (child process)
    │       └── Transformer.js model
    └── Round-robin work distribution
```

### Key Components

#### 1. EmbedderPool (`src/shared/embeddings/embedder-pool.ts`)
- Manages multiple embedder processes
- Distributes work using round-robin scheduling
- Handles automatic recovery from crashes
- Mutex-protected restart operations

#### 2. IsolatedEmbedder (`src/shared/embeddings/isolated.ts`)
- Runs transformer model in isolated child process
- Monitors own memory usage via `ps` command
- Implements proactive restart before memory limits
- Handles graceful shutdown and cleanup

### Configuration
```typescript
{
  poolSize: 2,               // Number of parallel processes
  maxFilesBeforeRestart: 200, // Restart after N files
  maxMemoryMB: 1000,          // Restart at 1GB RSS
  embeddingBatchSize: 32      // Chunks per embedding call
}
```

## Memory Management Strategy

### Problem
Transformer.js models accumulate memory over time due to tensor allocations not being properly freed. Running in Electron child processes causes additional complications with Chromium's memory management.

### Solution

#### 1. Process-Level Memory Monitoring
```typescript
// Direct memory measurement of child process
const { execSync } = require('child_process');
const result = execSync(`ps -o rss=,vsz= -p ${this.child.pid}`);
const [rss, vsz] = result.split(/\s+/).map(Number);
```

#### 2. Proactive Restarts
- Monitor child process RSS memory
- Restart at 95% of limit (950MB of 1GB)
- Only check after 50 files, then every 10 files
- Prevents crashes by restarting before memory exhaustion

#### 3. Graceful Degradation
- Retry logic with automatic recovery
- Maximum 3 retry attempts per batch
- Automatic embedder restart on failure
- Files marked as failed after all retries exhausted

## Performance Results

### Improvements Achieved (2025-09-01)
1. **Stability**: Reduced crashes from every 0-3 files to every 15-20 files
2. **Throughput**: 2x improvement with parallel processing
3. **Memory**: Predictable memory usage with proactive management
4. **Recovery**: Automatic recovery from crashes without data loss

### Current Performance Metrics
- **Files per second**: 4-6 (with pool) vs 2 (single embedder)
- **Files between crashes**: 15-20 vs 0-3
- **Memory usage**: Stable at ~1GB per embedder process
- **Success rate**: >95% of files indexed successfully

## Technical Challenges and Solutions

### 1. Memory Pressure False Positives
**Problem**: macOS `vm.page_free_count` gave misleading low memory warnings

**Solution**: Disabled system memory pressure detection, rely on process-specific metrics

### 2. Spawn Deadlocks
**Problem**: "Already spawning" state could block indefinitely

**Solution**: 30-second timeout with forced reset if spawn doesn't complete

### 3. EPIPE Errors
**Problem**: Sending messages to dead child processes caused crashes

**Solution**: Check `child.connected` before sending, mark embedder as not ready on EPIPE

### 4. Chromium Memory Warnings
**Problem**: Electron's Chromium runtime conflicts with transformer.js memory
```
[WARNING:process_memory_mac.cc(94)] mach_vm_read(0x16f298000, 0x8000): (os/kern) invalid address
```

**Solution**: Accept occasional crashes as inherent limitation, handle gracefully with retry logic

## Configuration Tuning

### Development Environment
```typescript
{
  poolSize: 2,
  maxFilesBeforeRestart: 200,
  maxMemoryMB: 1000,
  embeddingBatchSize: 32
}
```

### Production Recommendations
```typescript
{
  poolSize: 3,                // More parallelism on powerful machines
  maxFilesBeforeRestart: 500,  // Less frequent restarts
  maxMemoryMB: 1500,           // Higher limit for stability
  embeddingBatchSize: 32      // Optimal for model
}
```

### Memory-Constrained Systems
```typescript
{
  poolSize: 1,                // Single process
  maxFilesBeforeRestart: 100,  // Frequent restarts
  maxMemoryMB: 500,            // Lower memory limit
  embeddingBatchSize: 16      // Smaller batches
}
```

## Future Optimizations

### 1. Embedding Cache (High Impact)
- LRU cache for frequently seen text patterns
- Estimated 20-30% performance improvement for code repositories
- ~100MB memory overhead for cache

### 2. Alternative Models (Medium Impact)
- Evaluate smaller, faster models for specific use cases
- Trade-off between speed and search quality
- Potential 5-10x speedup with specialized models

### 3. GPU Acceleration (High Impact, High Complexity)
- WebGPU support in transformer.js
- Potential 10-50x speedup
- Requires significant architecture changes

## Monitoring and Debugging

### Key Metrics to Track
```typescript
// Embedder pool statistics
getStats(): {
  filesProcessed: number;
  memoryUsage: number;
  needsRestart: boolean;
}

// Health check monitoring
checkHealth(): Promise<void>
```

### Debug Environment Variables
```bash
PROFILE=true npm run dev  # Enable performance profiling
```

### Log Locations
- Application logs: `~/Library/Logs/Semantica/`
- Performance reports: `~/fss-performance-*.json`

## Conclusion

The embedder pool architecture successfully addresses the performance bottleneck of embedding generation while providing stability through proactive memory management. The system is production-ready with acceptable performance characteristics, processing files at 4-6 files/second with >95% success rate.

The remaining occasional crashes are inherent to running transformer models in Electron's Chromium-based environment but are handled gracefully through retry logic and automatic recovery mechanisms.