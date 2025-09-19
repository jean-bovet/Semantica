# Unit Test Updates for Producer-Consumer Architecture

## Overview
The new EmbeddingQueue introduces a fundamental change to how files are processed. We need comprehensive tests that verify the producer-consumer pattern works correctly **with real components, not mocks**.

## Test Categories Needed

### 1. New Tests Required

#### A. EmbeddingQueue Unit Tests (`tests/unit/embedding-queue.spec.ts`)
**Real component testing - no mocks of EmbeddingQueue itself**

**Core Queue Operations:**
- Add chunks from multiple files simultaneously
- FIFO processing order maintained across files
- File completion tracking with promises
- Queue capacity limits and backpressure signaling
- Progress callbacks for file tracking

**Producer-Consumer Coordination:**
- Multiple files adding chunks while consumer processes batches
- Batch size enforcement (32 chunks)
- Concurrent batch processing (up to 2 embedders)
- File completion only when all chunks processed
- Queue draining behavior

**Error Handling & Recovery:**
- Failed embeddings with retry logic
- Batch processor errors don't block queue
- File tracker cleanup after completion
- Queue restart after embedder failures

#### B. Producer-Consumer Integration Tests (`tests/integration/producer-consumer.spec.ts`)
**Full integration - real EmbedderPool + EmbeddingQueue + real files**

**Multi-File Processing:**
- 5-7 PDF files processed concurrently
- Verify no timeouts occur (key requirement!)
- Measure actual throughput vs old approach
- Memory usage remains bounded
- All files complete successfully

**Backpressure Scenarios:**
- Queue fills up (>1000 chunks) triggers file processing slowdown
- ConcurrentQueue reduces concurrency appropriately
- System recovers when queue drains
- No deadlocks under pressure

**Large File Handling:**
- Single large PDF (1000+ chunks) doesn't block smaller files
- Queue processes chunks from multiple files fairly
- Database writes occur in correct order
- Progress reporting works across files

### 2. Existing Tests to Update

#### A. ConcurrentQueue Tests (`tests/unit/concurrent-queue.spec.ts`)
**Add new test cases:**
- `shouldApplyBackpressure` callback integration
- Backpressure reduces concurrency to 50%
- Recovery when backpressure released
- Interaction with memory throttling

#### B. EmbedderPool Tests (`tests/unit/embedder-pool.spec.ts`)
**Real embedder integration tests:**
- Remove mocks for critical path tests
- Test actual round-robin distribution under load
- Verify availability tracking works correctly
- Error recovery with real embedder processes

#### C. Worker Integration Tests (`tests/integration/worker-initialization.spec.ts`)
**Update to test new flow:**
- Worker initializes EmbeddingQueue correctly
- handleFile uses queue instead of direct embedding
- Progress messages reflect queue processing
- File completion events fire correctly

### 3. Performance & Stress Tests

#### A. Timeout Prevention Tests (`tests/integration/timeout-prevention.spec.ts`)
**Key requirement - verify no more timeouts:**
- Process 10 large PDFs simultaneously
- Monitor for any 60-second timeouts
- Verify embedder utilization stays high
- Measure total processing time vs old approach

**Test with problematic files:**
- Use actual PDFs that previously caused timeouts
- Verify they now process successfully
- Compare processing times

#### B. Memory Pressure Tests (`tests/integration/memory-pressure.spec.ts`)
- Queue growth under heavy load
- Backpressure prevents OOM
- Memory usage patterns remain stable
- GC behavior with large queues

### 4. Regression Tests

#### A. Pipeline Integration (`tests/integration/pipeline.spec.ts`)
**Update existing tests:**
- End-to-end flow now uses EmbeddingQueue
- Database writes still work correctly
- Search results identical to before
- Chunk ordering preserved

#### B. Database Operations (`tests/integration/database-operations.spec.ts`)
**Verify batch processor:**
- Batch processor writes correct database rows
- File metadata (mtime, path, etc.) preserved
- Vector data integrity maintained
- Concurrent writes don't cause conflicts

## Implementation Strategy

### Phase 1: Core EmbeddingQueue Tests
- Focus on queue mechanics and producer-consumer coordination
- Use real EmbedderPool but with test configuration
- Verify basic functionality before integration tests

### Phase 2: Integration Tests
- Test full worker flow with multiple files
- Measure performance improvements
- Verify timeout elimination

### Phase 3: Stress & Edge Cases
- Large file scenarios
- Memory pressure testing
- Error recovery verification

### Phase 4: Update Existing Tests
- Modify tests that assume old direct embedding approach
- Ensure no regressions in existing functionality

## Test Configuration

**Real Components Used:**
- Actual EmbedderPool with 2 processes
- Real EmbeddingQueue implementation
- Actual PDF parsers and chunking
- Real LanceDB operations

**Test Data:**
- Small PDFs (1-10 chunks) for basic tests
- Medium PDFs (50-100 chunks) for backpressure
- Large PDFs (500+ chunks) for stress testing
- Mix of file types for regression testing

**Success Criteria:**
- Zero embedding timeouts under normal load
- Queue depth stays within bounds
- All files complete successfully
- Performance equal or better than before
- Memory usage remains stable
- No deadlocks or hangs

**Estimated Time:**
- Phase 1: 2-3 hours
- Phase 2: 2-3 hours
- Phase 3: 1-2 hours
- Phase 4: 1-2 hours
- **Total: 6-10 hours**

## Test Implementation Details

### EmbeddingQueue Test Structure

```typescript
describe('EmbeddingQueue', () => {
  let queue: EmbeddingQueue;
  let embedderPool: EmbedderPool;
  let processedBatches: ProcessedBatch[] = [];

  beforeEach(async () => {
    // Real EmbedderPool with small config for testing
    embedderPool = new EmbedderPool({
      poolSize: 2,
      maxFilesBeforeRestart: 100,
      maxMemoryMB: 200
    });
    await embedderPool.initialize();

    // Real EmbeddingQueue
    queue = new EmbeddingQueue({
      maxQueueSize: 100,
      batchSize: 8, // Smaller for testing
      backpressureThreshold: 50
    });

    queue.initialize(embedderPool, async (batch) => {
      processedBatches.push(batch);
    });
  });

  afterEach(async () => {
    await embedderPool.dispose();
    queue.clear();
    processedBatches = [];
  });
});
```

### Integration Test Structure

```typescript
describe('Producer-Consumer Integration', () => {
  let worker: Worker;
  let testFiles: string[] = [];

  beforeEach(() => {
    // Create test PDFs of various sizes
    testFiles = createTestPDFs([
      { name: 'small.pdf', chunks: 5 },
      { name: 'medium.pdf', chunks: 50 },
      { name: 'large.pdf', chunks: 200 }
    ]);
  });

  it('should process multiple files without timeouts', async () => {
    const startTime = Date.now();
    const timeouts = [];

    // Monitor for timeout messages
    worker.on('message', (msg) => {
      if (msg.type === 'error' && msg.message?.includes('timeout')) {
        timeouts.push(msg);
      }
    });

    // Process all files
    await processFiles(testFiles);

    expect(timeouts).toHaveLength(0);
    expect(Date.now() - startTime).toBeLessThan(300000); // 5 minutes max
  });
});
```

This comprehensive testing approach ensures the producer-consumer architecture works correctly under all scenarios while maintaining system stability and performance.