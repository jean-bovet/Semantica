# Producer-Consumer Architecture for Embeddings

## Problem Statement
The current system experiences deadlocks when processing multiple PDF files concurrently. With 7 files processing in parallel but only 2 embedder processes available, the embedders become overwhelmed with requests, leading to 60-second timeouts and infinite retry loops.

## Root Cause Analysis

### Current Architecture Issues:
1. **Concurrency Mismatch**: 7 concurrent file processors vs 2 embedder processes
2. **No Backpressure**: File queue doesn't consider embedder capacity
3. **Resource Contention**: Multiple files compete for limited embedder resources
4. **Cascade Failures**: Timeouts trigger retries, worsening the overload

### Current Flow:
```
7 Files → 7 Independent Pipelines → 2 Embedders (OVERWHELMED!)
```

Each file independently:
- Parses PDF content
- Chunks text into ~500 token pieces
- Sends batches of 32 chunks to embedders
- No coordination between files

## Proposed Solution: Producer-Consumer Queue

### Architecture Overview:
```
PRODUCERS (Parallel)      →    QUEUE    →    CONSUMERS (Serial)
7 File Processors              Central        2 Embedders
(Parse & Chunk)               Buffer         (Process Batches)
```

### Key Components:

#### 1. EmbeddingQueue (New)
Central queue that buffers chunks between producers and consumers:
- FIFO ordering maintains file sequence
- Configurable max size prevents memory issues
- Tracks per-file completion
- Provides backpressure signals

#### 2. Producers (Modified)
File processors that:
- Parse files in parallel (CPU-bound work)
- Create text chunks with metadata
- Add chunks to queue (non-blocking)
- Wait for completion signal

#### 3. Consumers (Modified)
Embedder pool that:
- Pulls batches from queue when available
- Processes embeddings serially
- Writes results to database
- Signals file completion

## Implementation Plan

### Phase 1: Create the Embedding Queue System
**New File:** `src/main/worker/EmbeddingQueue.ts`

```typescript
interface QueuedChunk {
  text: string;
  metadata: {
    filePath: string;
    offset: number;
    page?: number;
    fileIndex: number;
  }
}

class EmbeddingQueue {
  private queue: QueuedChunk[] = [];
  private maxQueueSize = 2000;
  private batchSize = 32;
  private isProcessing = false;
  private fileTrackers = new Map<string, FileTracker>();

  async addChunks(chunks: Chunk[], filePath: string, fileIndex: number) {
    // Add chunks to queue with metadata
    // Check queue size limits
    // Start processing if not already running
  }

  async processBatches() {
    while (queue.length >= batchSize) {
      // Get available embedder
      const embedder = await embedderPool.waitForAvailable();

      // Pull batch from queue
      const batch = queue.splice(0, batchSize);

      // Process asynchronously
      this.processOneBatch(batch, embedder);
    }
  }

  async waitForCompletion(filePath: string): Promise<void> {
    // Block until all chunks from file are processed
  }
}
```

### Phase 2: Modify File Processing Pipeline
**File:** `src/main/worker/index.ts`

Replace direct embedding calls with queue operations:

```typescript
async function handleFile(filePath: string) {
  // Parse and chunk as before
  const chunks = await parseAndChunk(filePath);

  // Add to queue instead of direct processing
  await embeddingQueue.addChunks(chunks, filePath, fileIndex);

  // Wait for this file's chunks to complete
  await embeddingQueue.waitForCompletion(filePath);

  // Update file status in database
  await markFileComplete(filePath);
}
```

### Phase 3: Update Embedder Pool
**File:** `src/shared/embeddings/embedder-pool.ts`

Add availability tracking:

```typescript
class EmbedderPool {
  private busyEmbedders = new Set<number>();

  async waitForAvailable(): Promise<IsolatedEmbedder> {
    while (busyEmbedders.size === embedders.length) {
      await sleep(100);
    }
    const embedder = getNextAvailable();
    busyEmbedders.add(embedder.index);
    return embedder;
  }

  markAvailable(embedder: IsolatedEmbedder) {
    busyEmbedders.delete(embedder.index);
  }
}
```

### Phase 4: Implement Backpressure Control
**File:** `src/main/worker/ConcurrentQueue.ts`

Check embedding queue before scheduling files:

```typescript
class ConcurrentQueue {
  private canScheduleNext(): boolean {
    // Don't schedule new files if embedding queue is full
    if (embeddingQueue.getDepth() > 1000) {
      return false;
    }
    return this.processing.size < this.maxConcurrent;
  }
}
```

### Phase 5: Add Progress Tracking
Track progress per file for UI updates:

```typescript
interface FileTracker {
  totalChunks: number;
  processedChunks: number;
  startTime: number;
  errors: Error[];

  getProgress(): number {
    return processedChunks / totalChunks;
  }
}
```

### Phase 6: Error Recovery
Handle various failure scenarios:

1. **Parsing Failure**: Skip file, continue processing queue
2. **Embedding Timeout**: Retry with exponential backoff
3. **Embedder Crash**: Restart embedder, resume from queue
4. **Persistent Failures**: Move to dead letter queue

## Configuration Updates

```typescript
{
  // Queue settings
  embeddingQueueSize: 2000,        // Max chunks buffered
  queueBackpressureThreshold: 1000, // Slow producers at this level

  // Processing settings
  embeddingBatchSize: 32,          // Chunks per embedding call
  maxConcurrentFiles: 7,            // Parallel file processors
  embedderPoolSize: 2,              // Number of embedder processes

  // Timeouts
  embedderTimeout: 120000,          // Increase from 60s to 120s
  fileProcessingTimeout: 300000,    // 5 min max per file
}
```

## Benefits

1. **Prevents Timeouts**: Embedders process at sustainable rate
2. **Better Resource Usage**: CPU and embedder work overlaps efficiently
3. **Memory Bounded**: Queue size limits prevent OOM
4. **Simpler Debugging**: Single queue to monitor vs multiple pipelines
5. **Fair Processing**: Files complete in submission order
6. **Graceful Degradation**: System remains stable under load

## Performance Expectations

### Current System:
- 7 files × ~200 chunks = ~1400 concurrent embedding requests
- 2 embedders overwhelmed → timeouts → retries → deadlock
- Throughput: 0 (system stuck)

### New System:
- Queue depth: max 2000 chunks buffered
- Embedder utilization: ~100% (always have work)
- No timeouts (sustainable processing rate)
- Throughput: 2 embedders × 32 chunks/batch × N batches/min

## Migration Strategy

1. Implement queue system alongside existing code
2. Add feature flag to toggle between approaches
3. Test with problematic PDF sets
4. Monitor metrics (timeouts, throughput, memory)
5. Remove old code path after validation

## Success Metrics

- **Zero timeouts** during normal operation
- **100% embedder utilization** (no idle time)
- **Predictable memory usage** (queue bounded)
- **Linear scaling** with number of embedders
- **Stable throughput** regardless of file sizes

## Timeline

- Phase 1-2: 1 hour (core queue implementation)
- Phase 3-4: 45 minutes (integration and backpressure)
- Phase 5-6: 45 minutes (monitoring and error handling)
- Testing: 30 minutes
- **Total: ~3 hours**

## Risks and Mitigations

| Risk | Impact | Mitigation |
|------|--------|------------|
| Queue grows unbounded | OOM crash | Hard limit + backpressure |
| Large file blocks queue | Other files delayed | Round-robin or priority queue |
| Complex progress tracking | Poor UX | Per-file trackers with clear state |
| Embedder crashes lose work | Reprocessing needed | Checkpoint queue state |

## Future Enhancements

1. **Priority Queue**: Process smaller files first
2. **Persistent Queue**: Survive process restarts
3. **Dynamic Scaling**: Adjust embedder pool size based on load
4. **Smart Batching**: Group similar-length texts for efficiency
5. **Circuit Breaker**: Temporarily skip problematic files

## Conclusion

This producer-consumer architecture solves the fundamental mismatch between file processing concurrency and embedder capacity. By introducing a central queue with proper backpressure, we ensure embedders operate at a sustainable rate while maintaining high CPU utilization for parsing. The result is a more stable, predictable, and performant system.