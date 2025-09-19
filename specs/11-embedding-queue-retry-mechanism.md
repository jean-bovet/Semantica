# EmbeddingQueue Retry Mechanism

*Previous: [10-release-process.md](./10-release-process.md) | Next: [README.md](./README.md)*

---

## Table of Contents

1. [Introduction](#introduction)
2. [Technical Specification](#technical-specification)
3. [Failure Scenarios](#failure-scenarios)
4. [Retry Flow & State Management](#retry-flow--state-management)
5. [Graceful Failure Handling](#graceful-failure-handling)
6. [Integration Points](#integration-points)
7. [Testing & Validation](#testing--validation)
8. [Monitoring & Observability](#monitoring--observability)
9. [Configuration & Tuning](#configuration--tuning)
10. [Future Enhancements](#future-enhancements)

---

## Introduction

### Purpose

The EmbeddingQueue retry mechanism is a **fault tolerance system** designed to handle transient failures during the embedding generation process within Semantica's producer-consumer architecture. It ensures robust operation when temporary errors occur, preventing system hangs and guaranteeing file processing completion.

### Context

This mechanism was implemented as part of the solution to PDF processing deadlocks, where 7 files processing concurrently would overwhelm 2 embedder processes, causing 60-second timeouts and infinite retry loops. The retry system provides bounded, intelligent failure recovery.

### Key Benefits

- **Resilience**: Handles transient failures gracefully without system interruption
- **Bounded Behavior**: Prevents infinite loops with configurable retry limits
- **Progress Guarantee**: Ensures files always complete, even with some failed chunks
- **Resource Management**: Prevents memory leaks from stuck batches

---

## Technical Specification

### Core Components

#### 1. Retry Tracking Interface

```typescript
export interface QueuedChunk {
  text: string;
  metadata: {
    filePath: string;
    offset: number;
    page?: number;
    fileIndex: number;
    chunkIndex: number;
  };
  retryCount?: number; // Tracks retry attempts per chunk
}
```

#### 2. Configuration Parameters

```typescript
private maxRetries = 3; // Maximum retry attempts per batch
```

**Default Values:**
- **Maximum Retries**: 3 attempts (initial + 3 retries = 4 total attempts)
- **Retry Strategy**: Immediate retry (no backoff delay)
- **Queue Position**: Failed batches re-queued at front for priority processing

#### 3. Retry Logic Implementation

**Error Detection:**
```typescript
try {
  // Generate embeddings
  const vectors = await this.embedderPool!.embed(texts, false);

  // Process batch (write to database)
  await this.batchProcessor({ chunks: batch, vectors });
} catch (error) {
  // Trigger retry mechanism
}
```

**Retry Decision Logic:**
```typescript
const currentRetryCount = batch[0]?.retryCount || 0;
if (currentRetryCount < this.maxRetries) {
  // Increment retry count and re-queue
  batch.forEach(chunk => {
    chunk.retryCount = currentRetryCount + 1;
  });
  this.queue.unshift(...batch); // Front of queue for immediate retry
} else {
  // Max retries exceeded - graceful failure
}
```

---

## Failure Scenarios

### 1. Embedder Process Failures

**Scenario**: Embedder child process crashes or becomes unresponsive
- **Cause**: Memory exhaustion, model corruption, OS resource limits
- **Detection**: Promise rejection from `embedderPool.embed()`
- **Recovery**: Retry triggers embedder process restart via EmbedderPool

### 2. Memory Pressure

**Scenario**: Insufficient memory for embedding generation
- **Cause**: System memory exhaustion, concurrent processing overload
- **Detection**: Out-of-memory errors during tensor operations
- **Recovery**: Retry after memory is freed by other processes

### 3. Database Write Failures

**Scenario**: Batch processor (database writer) fails
- **Cause**: Database connectivity issues, disk space, write conflicts
- **Detection**: Promise rejection from `batchProcessor()`
- **Recovery**: Retry with same embedding vectors (no regeneration needed)

### 4. Network/Resource Issues

**Scenario**: Temporary resource unavailability
- **Cause**: File system locks, network interruptions, service restarts
- **Detection**: Various error types from underlying services
- **Recovery**: Retry often succeeds as resources become available

### 5. Transient Errors

**Scenario**: Random, temporary failures that resolve themselves
- **Cause**: Race conditions, timing issues, temporary locks
- **Detection**: Unexpected errors during normal operation
- **Recovery**: Retry attempts usually succeed on subsequent tries

---

## Retry Flow & State Management

### Step-by-Step Retry Process

#### 1. Initial Processing Attempt

```typescript
// Normal batch processing flow
const texts = batch.map(chunk => chunk.text);
const vectors = await this.embedderPool!.embed(texts, false);
await this.batchProcessor({ chunks: batch, vectors });
```

#### 2. Error Detection & Analysis

```typescript
} catch (error) {
  console.error('[EmbeddingQueue] Batch processing failed:', error);

  // Track errors for affected files
  const affectedFiles = new Set(batch.map(c => c.metadata.filePath));
  for (const filePath of affectedFiles) {
    const tracker = this.fileTrackers.get(filePath);
    if (tracker) {
      tracker.errors.push(error as Error);
    }
  }
```

#### 3. Retry Count Evaluation

```typescript
const currentRetryCount = batch[0]?.retryCount || 0;
if (currentRetryCount < this.maxRetries) {
  // Proceed with retry
} else {
  // Handle max retries exceeded
}
```

#### 4. Retry State Update

```typescript
// Increment retry count for all chunks in batch
batch.forEach(chunk => {
  chunk.retryCount = currentRetryCount + 1;
});
```

#### 5. Queue Management

```typescript
// Re-queue at front for immediate retry
this.queue.unshift(...batch);
```

### Queue Position Strategy

**Front Insertion**: Failed batches are inserted at the front of the queue to ensure:
- **Immediate Retry**: No delay waiting for other batches
- **Resource Availability**: Retry while resources may still be available
- **Failure Isolation**: Quick determination if failure is persistent

---

## Graceful Failure Handling

### Max Retries Exceeded

When a batch fails more than `maxRetries` attempts:

#### 1. Failure Logging

```typescript
console.error(`[EmbeddingQueue] Max retries (${this.maxRetries}) exceeded for batch, dropping chunks`);
```

#### 2. Progress Tracking Update

```typescript
// Count failed chunks toward file completion
const failedChunks = batch.filter(c => c.metadata.filePath === filePath).length;
tracker.processedChunks += failedChunks; // Mark as "processed" (failed)
```

#### 3. File Completion Check

```typescript
// Check if file is complete (including failed chunks)
if (tracker.processedChunks >= tracker.totalChunks) {
  if (this.onFileComplete) {
    this.onFileComplete(filePath);
  }

  // Resolve completion promise
  if (tracker.completionPromise) {
    tracker.completionPromise.resolve();
    delete tracker.completionPromise;
  }
}
```

#### 4. Resource Cleanup

```typescript
// Clean up tracker after delay
setTimeout(() => {
  this.fileTrackers.delete(filePath);
}, 5000);
```

### Progress Guarantees

**Key Principle**: Files always complete, even with failed chunks

- **Partial Success**: If some chunks in a file succeed, the file still completes
- **Total Failure**: If all chunks fail, the file still completes (with error tracking)
- **User Experience**: Progress bars reach 100% regardless of individual failures
- **Error Visibility**: Failures are logged but don't block overall progress

---

## Integration Points

### EmbedderPool Integration

**Automatic Recovery**: When embedder processes crash, the EmbedderPool automatically restarts them, making retries often successful.

```typescript
// EmbedderPool handles process management
const vectors = await this.embedderPool!.embed(texts, false);
// Retry succeeds after embedder restart
```

### BatchProcessor Error Handling

**Database Independence**: Retries work with any BatchProcessor implementation (LanceDB, SQLite, etc.)

```typescript
// BatchProcessor interface allows flexible implementations
await this.batchProcessor({ chunks: batch, vectors });
```

### FileTracker State Management

**Error Accumulation**: Each retry adds errors to the file tracker for debugging.

```typescript
tracker.errors.push(error as Error);
// Maintains complete error history per file
```

### Progress Reporting

**Retry Transparency**: Progress callbacks continue during retries without confusion.

```typescript
if (this.onProgress) {
  this.onProgress(filePath, tracker.processedChunks, tracker.totalChunks);
}
```

---

## Testing & Validation

### Unit Test Scenarios

#### 1. Batch Processor Error Simulation

```typescript
it('should handle batch processor errors gracefully', async () => {
  const failingQueue = new EmbeddingQueue({ maxQueueSize: 100, batchSize: 8 });

  let processorCallCount = 0;
  failingQueue.initialize(embedderPool, async () => {
    processorCallCount++;
    throw new Error('Batch processor error');
  });

  const chunks = [{ text: 'Test chunk', offset: 0 }];
  await failingQueue.addChunks(chunks, '/test/file1.txt', 1);

  // Verify retry attempts (should be 4: initial + 3 retries)
  expect(processorCallCount).toBe(4);
});
```

#### 2. Retry Count Tracking

```typescript
it('should increment retry count on each attempt', async () => {
  // Test verifies retryCount increments: 0 → 1 → 2 → 3
});
```

#### 3. Graceful Failure After Max Retries

```typescript
it('should complete file processing after max retries exceeded', async () => {
  // Test verifies file completion despite all chunks failing
});
```

### Error Injection Testing

**Controlled Failures**: Tests inject specific errors to validate retry behavior:
- Network timeouts
- Memory allocation failures
- Database connection errors
- Process crashes

### Performance Impact Assessment

**Retry Overhead**: Minimal performance impact due to:
- **Bounded Attempts**: Maximum 4 attempts per batch
- **Front Queue Position**: No delay for retries
- **State Sharing**: Retry count piggybacked on existing chunk metadata

---

## Monitoring & Observability

### Logging Levels

#### Error Level
```
[EmbeddingQueue] Batch processing failed: Error details
```

#### Warning Level
```
[EmbeddingQueue] Max retries (3) exceeded for batch, dropping chunks
```

### Error Tracking per File

**FileTracker Integration**: Each file accumulates all errors encountered during processing.

```typescript
interface FileTracker {
  errors: Error[]; // Complete error history
  // ... other fields
}
```

### Metrics for Monitoring

**Recommended Metrics**:
- **Retry Rate**: Percentage of batches requiring retries
- **Success Rate**: Percentage of retries that succeed
- **Max Retries Hit**: Frequency of hitting retry limits
- **Error Categories**: Classification of error types causing retries

### Debug Information

**Development Logging**: Detailed retry progression for troubleshooting:
```
Retry attempt 1/3 for batch with 32 chunks
Retry attempt 2/3 for batch with 32 chunks
Retry attempt 3/3 for batch with 32 chunks
Max retries exceeded, dropping batch
```

---

## Configuration & Tuning

### Current Configuration

```typescript
private maxRetries = 3; // Hardcoded constant
```

### Tuning Considerations

#### Retry Limit Selection

**Conservative Default**: 3 retries balances resilience with performance:
- **Too Low (0-1)**: Insufficient resilience against transient failures
- **Optimal (2-4)**: Good balance of recovery vs. performance
- **Too High (5+)**: Excessive delay for persistent failures

#### Memory Pressure Impact

**Resource Awareness**: Higher retry counts may exacerbate memory pressure:
- **Embedder Restarts**: Retries often trigger beneficial process restarts
- **Queue Buildup**: Failed batches at front may delay new work
- **Memory Recovery**: Time between retries allows garbage collection

### Production Recommendations

1. **Monitor Retry Rates**: Alert if >10% of batches require retries
2. **Track Error Patterns**: Identify systemic issues vs. transient failures
3. **Capacity Planning**: Size embedder pool to handle retry overhead
4. **Memory Limits**: Ensure sufficient headroom for retry processing

---

## Future Enhancements

### 1. Exponential Backoff

**Current**: Immediate retry (no delay)
**Enhancement**: Progressive delays between retry attempts

```typescript
// Proposed implementation
const backoffDelay = Math.min(1000 * Math.pow(2, retryCount), 30000);
await new Promise(resolve => setTimeout(resolve, backoffDelay));
```

**Benefits**:
- Reduces resource contention during high-failure periods
- Allows time for external issues to resolve
- More respectful of system resources

### 2. Retry Reason Classification

**Current**: Generic error handling for all failure types
**Enhancement**: Different retry strategies based on error classification

```typescript
// Proposed error categories
enum FailureType {
  EMBEDDER_CRASH,    // Always retry
  MEMORY_PRESSURE,   // Retry with backoff
  DATABASE_ERROR,    // Retry immediately
  TIMEOUT,           // Retry with longer timeout
  PERMANENT_ERROR    // Don't retry
}
```

### 3. Dynamic Retry Limits

**Current**: Fixed `maxRetries = 3` for all scenarios
**Enhancement**: Adaptive retry limits based on error type and system state

```typescript
// Proposed adaptive logic
getRetryLimit(errorType: FailureType, systemLoad: number): number {
  if (errorType === FailureType.PERMANENT_ERROR) return 0;
  if (systemLoad > 0.8) return 1; // Reduce retries under high load
  return 3; // Default
}
```

### 4. Advanced Failure Pattern Detection

**Current**: Individual batch retry decisions
**Enhancement**: Pattern recognition across multiple failures

- **Circuit Breaker**: Stop retrying if failure rate exceeds threshold
- **Bulk Failure Detection**: Identify system-wide issues vs. isolated failures
- **Adaptive Processing**: Reduce batch sizes during high-failure periods

### 5. Configurable Retry Policies

**Current**: Hardcoded retry behavior
**Enhancement**: User-configurable retry strategies

```typescript
interface RetryPolicy {
  maxRetries: number;
  backoffStrategy: 'immediate' | 'linear' | 'exponential';
  retryableErrors: string[]; // Error types that should trigger retries
  maxRetryDelay: number;
}
```

---

## Related Documentation

- [02-architecture.md](./02-architecture.md) - Producer-consumer architecture overview
- [03-implementation.md](./03-implementation.md) - Memory management and EmbedderPool details
- [04-operations.md](./04-operations.md) - Troubleshooting and monitoring guidance
- [09-performance-architecture.md](./09-performance-architecture.md) - Performance optimization context

---

*This specification documents the EmbeddingQueue retry mechanism as implemented in Semantica v1.0.3. For implementation details, see `src/main/worker/EmbeddingQueue.ts`.*