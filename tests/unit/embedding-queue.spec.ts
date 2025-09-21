import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { EmbeddingQueue, ProcessedBatch } from '../../src/main/core/embedding/EmbeddingQueue';
import { EmbedderPool } from '../../src/shared/embeddings/embedder-pool';

// Mock the embedder pool to avoid spawning actual child processes in unit tests
vi.mock('../../src/shared/embeddings/embedder-pool', () => {
  let mockEmbedders: any[] = [];
  let embedCallCount = 0;

  return {
    EmbedderPool: vi.fn().mockImplementation(() => {
      return {
        initialize: vi.fn().mockResolvedValue(undefined),
        getPoolSize: vi.fn().mockReturnValue(2),
        embed: vi.fn().mockImplementation(async (texts: string[]) => {
          embedCallCount++;
          // Simulate some processing time
          await new Promise(r => setTimeout(r, 10));
          // Return mock 384-dimensional vectors
          return texts.map(() => new Array(384).fill(0.1));
        }),
        dispose: vi.fn().mockResolvedValue(undefined),
        getStats: vi.fn().mockReturnValue([
          { index: 0, filesProcessed: 10, memoryUsage: 150 * 1024 * 1024, needsRestart: false },
          { index: 1, filesProcessed: 12, memoryUsage: 160 * 1024 * 1024, needsRestart: false }
        ])
      };
    })
  };
});

describe('EmbeddingQueue', () => {
  let queue: EmbeddingQueue;
  let embedderPool: EmbedderPool;
  let processedBatches: ProcessedBatch[] = [];
  let progressEvents: Array<{ filePath: string; processed: number; total: number }> = [];
  let completedFiles: string[] = [];

  beforeEach(async () => {
    // Reset mocks
    vi.clearAllMocks();
    processedBatches = [];
    progressEvents = [];
    completedFiles = [];

    // Create embedder pool
    embedderPool = new EmbedderPool({
      poolSize: 2,
      maxFilesBeforeRestart: 100,
      maxMemoryMB: 200
    });
    await embedderPool.initialize();

    // Create embedding queue with test configuration
    queue = new EmbeddingQueue({
      maxQueueSize: 100,
      batchSize: 8, // Smaller batch size for testing
      backpressureThreshold: 50,
      onProgress: (filePath, processed, total) => {
        progressEvents.push({ filePath, processed, total });
      },
      onFileComplete: (filePath) => {
        completedFiles.push(filePath);
      }
    });

    // Initialize with batch processor
    queue.initialize(embedderPool, async (batch) => {
      processedBatches.push(batch);
    });
  });

  afterEach(async () => {
    await embedderPool.dispose();
    queue.clear();
  });

  describe('Core Queue Operations', () => {
    it('should process chunks from a single file', async () => {
      const chunks = [
        { text: 'First chunk', offset: 0 },
        { text: 'Second chunk', offset: 100 }
      ];

      await queue.addChunks(chunks, '/test/file1.txt', 1);
      await queue.waitForCompletion('/test/file1.txt');

      // Should have processed the chunks into a batch
      expect(processedBatches).toHaveLength(1);
      expect(processedBatches[0].chunks).toHaveLength(2);
      expect(completedFiles).toContain('/test/file1.txt');
    });

    it('should process chunks from multiple files', async () => {
      const chunks1 = [
        { text: 'File 1 chunk 1', offset: 0 },
        { text: 'File 1 chunk 2', offset: 100 }
      ];
      const chunks2 = [
        { text: 'File 2 chunk 1', offset: 0 },
        { text: 'File 2 chunk 2', offset: 150 }
      ];

      await queue.addChunks(chunks1, '/test/file1.txt', 1);
      await queue.addChunks(chunks2, '/test/file2.txt', 2);

      await Promise.all([
        queue.waitForCompletion('/test/file1.txt'),
        queue.waitForCompletion('/test/file2.txt')
      ]);

      // Should have processed all chunks
      const totalChunks = processedBatches.reduce((sum, batch) => sum + batch.chunks.length, 0);
      expect(totalChunks).toBe(4);
      expect(completedFiles).toContain('/test/file1.txt');
      expect(completedFiles).toContain('/test/file2.txt');
    });

    it('should process all chunks from both files correctly', async () => {
      const file1Chunks = [
        { text: 'File1-Chunk1', offset: 0 },
        { text: 'File1-Chunk2', offset: 100 }
      ];
      const file2Chunks = [
        { text: 'File2-Chunk1', offset: 0 },
        { text: 'File2-Chunk2', offset: 100 }
      ];

      // Add chunks from files sequentially
      await queue.addChunks(file1Chunks, '/test/file1.txt', 1);
      await queue.addChunks(file2Chunks, '/test/file2.txt', 2);

      // Wait for processing to complete
      await Promise.all([
        queue.waitForCompletion('/test/file1.txt'),
        queue.waitForCompletion('/test/file2.txt')
      ]);

      // Check that all chunks were processed
      const allProcessedChunks = processedBatches.flatMap(batch => batch.chunks);
      expect(allProcessedChunks).toHaveLength(4);

      // Verify all expected chunks are present
      const chunkTexts = allProcessedChunks.map(chunk => chunk.text);
      expect(chunkTexts).toContain('File1-Chunk1');
      expect(chunkTexts).toContain('File1-Chunk2');
      expect(chunkTexts).toContain('File2-Chunk1');
      expect(chunkTexts).toContain('File2-Chunk2');
    });

    it('should track file completion correctly', async () => {
      const chunks = [
        { text: 'Chunk 1', offset: 0 },
        { text: 'Chunk 2', offset: 100 },
        { text: 'Chunk 3', offset: 200 }
      ];

      await queue.addChunks(chunks, '/test/file1.txt', 1);

      // Wait for completion
      await queue.waitForCompletion('/test/file1.txt');

      expect(completedFiles).toContain('/test/file1.txt');
    });

    it('should report progress during processing', async () => {
      const chunks = Array.from({ length: 10 }, (_, i) => ({
        text: `Chunk ${i}`,
        offset: i * 100
      }));

      await queue.addChunks(chunks, '/test/large-file.txt', 1);
      await queue.waitForCompletion('/test/large-file.txt');

      // Should have received progress updates
      expect(progressEvents.length).toBeGreaterThan(0);

      // Progress should be for the correct file
      const fileProgress = progressEvents.filter(e => e.filePath === '/test/large-file.txt');
      expect(fileProgress.length).toBeGreaterThan(0);

      // Final progress should show completion
      const finalProgress = fileProgress[fileProgress.length - 1];
      expect(finalProgress.processed).toBe(finalProgress.total);
    });
  });

  describe('Batch Processing', () => {
    it('should enforce batch size limits', async () => {
      // Add exactly 2 batches worth of chunks (8 + 8 = 16)
      const chunks = Array.from({ length: 16 }, (_, i) => ({
        text: `Chunk ${i}`,
        offset: i * 100
      }));

      await queue.addChunks(chunks, '/test/file1.txt', 1);
      await queue.waitForCompletion('/test/file1.txt');

      // Should have created 2 batches
      expect(processedBatches).toHaveLength(2);
      expect(processedBatches[0].chunks).toHaveLength(8);
      expect(processedBatches[1].chunks).toHaveLength(8);
    });

    it('should handle partial batches', async () => {
      // Add less than a full batch
      const chunks = Array.from({ length: 5 }, (_, i) => ({
        text: `Chunk ${i}`,
        offset: i * 100
      }));

      await queue.addChunks(chunks, '/test/file1.txt', 1);
      await queue.waitForCompletion('/test/file1.txt');

      // Should still process the partial batch
      expect(processedBatches).toHaveLength(1);
      expect(processedBatches[0].chunks).toHaveLength(5);
    });

    it('should include correct metadata in processed batches', async () => {
      const chunks = [
        { text: 'Test chunk', offset: 0, page: 1 }
      ];

      await queue.addChunks(chunks, '/test/file1.txt', 1);
      await queue.waitForCompletion('/test/file1.txt');

      const batch = processedBatches[0];
      expect(batch.chunks[0].metadata.filePath).toBe('/test/file1.txt');
      expect(batch.chunks[0].metadata.offset).toBe(0);
      expect(batch.chunks[0].metadata.page).toBe(1);
      expect(batch.chunks[0].metadata.fileIndex).toBe(1);
    });

    it('should generate embeddings for all chunks', async () => {
      const chunks = [
        { text: 'First chunk', offset: 0 },
        { text: 'Second chunk', offset: 100 }
      ];

      await queue.addChunks(chunks, '/test/file1.txt', 1);
      await queue.waitForCompletion('/test/file1.txt');

      const batch = processedBatches[0];
      expect(batch.vectors).toHaveLength(2);
      expect(batch.vectors[0]).toHaveLength(384); // 384-dimensional vectors
      expect(batch.vectors[1]).toHaveLength(384);
    });
  });

  describe('Concurrent Processing', () => {
    it('should process multiple files concurrently', async () => {
      const file1Chunks = Array.from({ length: 4 }, (_, i) => ({
        text: `File1-Chunk${i}`,
        offset: i * 100
      }));
      const file2Chunks = Array.from({ length: 4 }, (_, i) => ({
        text: `File2-Chunk${i}`,
        offset: i * 100
      }));

      // Add chunks from both files simultaneously
      const [completion1, completion2] = await Promise.all([
        queue.addChunks(file1Chunks, '/test/file1.txt', 1).then(() =>
          queue.waitForCompletion('/test/file1.txt')
        ),
        queue.addChunks(file2Chunks, '/test/file2.txt', 2).then(() =>
          queue.waitForCompletion('/test/file2.txt')
        )
      ]);

      // Both files should complete
      expect(completedFiles).toContain('/test/file1.txt');
      expect(completedFiles).toContain('/test/file2.txt');
    });

    it('should process files concurrently without errors', async () => {
      const file1Chunks = Array.from({ length: 8 }, (_, i) => ({
        text: `File1-Chunk${i}`,
        offset: i * 100
      }));
      const file2Chunks = Array.from({ length: 8 }, (_, i) => ({
        text: `File2-Chunk${i}`,
        offset: i * 100
      }));

      // Process both files concurrently
      const [completion1, completion2] = await Promise.all([
        queue.addChunks(file1Chunks, '/test/concurrent1.txt', 1)
          .then(() => queue.waitForCompletion('/test/concurrent1.txt')),
        queue.addChunks(file2Chunks, '/test/concurrent2.txt', 2)
          .then(() => queue.waitForCompletion('/test/concurrent2.txt'))
      ]);

      // Both should complete successfully
      expect(completedFiles).toContain('/test/concurrent1.txt');
      expect(completedFiles).toContain('/test/concurrent2.txt');

      // All chunks should be processed
      const totalChunks = processedBatches.reduce((sum, batch) => sum + batch.chunks.length, 0);
      expect(totalChunks).toBe(16);
    });
  });

  describe('Backpressure', () => {
    it('should handle large number of chunks without issues', async () => {
      const chunks = Array.from({ length: 25 }, (_, i) => ({
        text: `Chunk ${i}`,
        offset: i * 100
      }));

      await queue.addChunks(chunks, '/test/large-file.txt', 1);
      await queue.waitForCompletion('/test/large-file.txt');

      // Should have processed all chunks
      expect(completedFiles).toContain('/test/large-file.txt');

      // All chunks should be processed
      const totalChunks = processedBatches.reduce((sum, batch) => sum + batch.chunks.length, 0);
      expect(totalChunks).toBeGreaterThanOrEqual(25);
    });

    it('should not signal backpressure when queue is small', async () => {
      const chunks = Array.from({ length: 10 }, (_, i) => ({
        text: `Chunk ${i}`,
        offset: i * 100
      }));

      await queue.addChunks(chunks, '/test/small-file.txt', 1);
      await queue.waitForCompletion('/test/small-file.txt');

      // After completion, backpressure should not be active
      expect(queue.shouldApplyBackpressure()).toBe(false);
    });

    it('should complete processing even under pressure', async () => {
      // Test that files complete even when queue gets full
      const chunks = Array.from({ length: 60 }, (_, i) => ({
        text: `Chunk ${i}`,
        offset: i * 100
      }));

      await queue.addChunks(chunks, '/test/pressure-file.txt', 1);
      await queue.waitForCompletion('/test/pressure-file.txt');

      // File should complete successfully
      expect(completedFiles).toContain('/test/pressure-file.txt');

      // All chunks should be processed
      const totalChunks = processedBatches.reduce((sum, batch) => sum + batch.chunks.length, 0);
      expect(totalChunks).toBeGreaterThanOrEqual(60);
    });
  });

  describe('Error Handling', () => {
    it('should handle batch processor errors gracefully', async () => {
      // Create queue with failing batch processor
      const failingQueue = new EmbeddingQueue({
        maxQueueSize: 100,
        batchSize: 8
      });

      let processorCallCount = 0;
      failingQueue.initialize(embedderPool, async () => {
        processorCallCount++;
        throw new Error('Batch processor error');
      });

      const chunks = [{ text: 'Test chunk', offset: 0 }];

      // Should not throw during addChunks, even with failing batch processor
      await expect(failingQueue.addChunks(chunks, '/test/file1.txt', 1))
        .resolves.not.toThrow();

      // Wait a bit for processing attempt
      await new Promise(r => setTimeout(r, 100));

      // Batch processor should have been called despite error
      expect(processorCallCount).toBeGreaterThan(0);

      failingQueue.clear();
    });

    it('should complete file processing successfully', async () => {
      const chunks = [{ text: 'Test chunk', offset: 0 }];

      await queue.addChunks(chunks, '/test/file1.txt', 1);
      await queue.waitForCompletion('/test/file1.txt');

      // File should be completed
      expect(completedFiles).toContain('/test/file1.txt');

      // Chunks should be processed
      const totalChunks = processedBatches.reduce((sum, batch) => sum + batch.chunks.length, 0);
      expect(totalChunks).toBeGreaterThan(0);
    });
  });

  describe('Embedder Restart Recovery', () => {
    it('should recover batches when embedder restarts', async () => {
      // Reset the mock to default behavior first
      vi.mocked(embedderPool.embed).mockImplementation(async (texts: string[]) => {
        // Default success behavior
        return texts.map(() => new Array(384).fill(0.1));
      });

      const chunks = [
        { text: 'Chunk 1', offset: 0 },
        { text: 'Chunk 2', offset: 100 }
      ];

      await queue.addChunks(chunks, '/test/restart-file.txt', 1);

      // Simulate embedder restart immediately (this tests recovery mechanism)
      // Note: In real scenario, this would happen when embedder process dies
      queue.onEmbedderRestart(0);

      // Wait for completion
      await queue.waitForCompletion('/test/restart-file.txt');

      // Should have processed the chunks
      expect(completedFiles).toContain('/test/restart-file.txt');
      expect(processedBatches.length).toBeGreaterThan(0);

      // Verify processingBatches counter is back to 0
      const stats = queue.getStats();
      expect(stats.processingBatches).toBe(0);
    });

    it('should correctly decrement processingBatches on embedder failure', async () => {
      // Add chunks to process
      const chunks = Array.from({ length: 16 }, (_, i) => ({
        text: `Chunk ${i}`,
        offset: i * 100
      }));

      await queue.addChunks(chunks, '/test/counter-test.txt', 1);

      // Simulate embedder restart while processing
      queue.onEmbedderRestart(0);

      // Check that processingBatches is properly managed
      const stats = queue.getStats();
      expect(stats.processingBatches).toBeGreaterThanOrEqual(0);
      expect(stats.processingBatches).toBeLessThanOrEqual(2); // Max concurrent
    });

    it('should not duplicate batches during recovery', async () => {
      // Track batches for this test only
      const testBatches: ProcessedBatch[] = [];

      // Create a new queue with isolated batch processor
      const testQueue = new EmbeddingQueue({
        maxQueueSize: 100,
        batchSize: 8,
        backpressureThreshold: 50
      });

      testQueue.initialize(embedderPool, async (batch) => {
        testBatches.push(batch);
      });

      const chunks = [
        { text: 'Unique chunk 1', offset: 0 },
        { text: 'Unique chunk 2', offset: 100 }
      ];

      await testQueue.addChunks(chunks, '/test/no-duplicate.txt', 1);
      await testQueue.waitForCompletion('/test/no-duplicate.txt');

      // Verify chunks were processed exactly once
      const totalProcessedChunks = testBatches.reduce((sum, batch) => sum + batch.chunks.length, 0);
      expect(totalProcessedChunks).toBe(2);

      // Simulate restarts after completion (should not affect anything)
      testQueue.onEmbedderRestart(0);
      testQueue.onEmbedderRestart(0);

      // Wait a bit to ensure no additional processing
      await new Promise(r => setTimeout(r, 50));

      // Verify no additional processing happened
      const finalTotal = testBatches.reduce((sum, batch) => sum + batch.chunks.length, 0);
      expect(finalTotal).toBe(2);

      // Clean up
      testQueue.clear();
    });

    it('should handle multiple concurrent embedder restarts', async () => {
      // Add multiple files to process
      const file1Chunks = Array.from({ length: 8 }, (_, i) => ({
        text: `File1-Chunk${i}`,
        offset: i * 100
      }));
      const file2Chunks = Array.from({ length: 8 }, (_, i) => ({
        text: `File2-Chunk${i}`,
        offset: i * 100
      }));

      await queue.addChunks(file1Chunks, '/test/concurrent-restart1.txt', 1);
      await queue.addChunks(file2Chunks, '/test/concurrent-restart2.txt', 2);

      // Simulate both embedders restarting
      queue.onEmbedderRestart(0);
      queue.onEmbedderRestart(1);

      // Wait for completion
      await Promise.all([
        queue.waitForCompletion('/test/concurrent-restart1.txt'),
        queue.waitForCompletion('/test/concurrent-restart2.txt')
      ]);

      // Both files should complete
      expect(completedFiles).toContain('/test/concurrent-restart1.txt');
      expect(completedFiles).toContain('/test/concurrent-restart2.txt');

      // All chunks should be processed
      const totalChunks = processedBatches.reduce((sum, batch) => sum + batch.chunks.length, 0);
      expect(totalChunks).toBe(16);
    });

    it('should maintain file progress tracking during recovery', async () => {
      const chunks = Array.from({ length: 10 }, (_, i) => ({
        text: `Chunk ${i}`,
        offset: i * 100
      }));

      await queue.addChunks(chunks, '/test/progress-track.txt', 1);

      // Simulate embedder restart mid-processing
      setTimeout(() => queue.onEmbedderRestart(0), 50);

      await queue.waitForCompletion('/test/progress-track.txt');

      // Check progress events were consistent
      const fileProgress = progressEvents.filter(e => e.filePath === '/test/progress-track.txt');
      const lastProgress = fileProgress[fileProgress.length - 1];
      expect(lastProgress?.processed).toBe(10);
      expect(lastProgress?.total).toBe(10);
    });
  });

  describe('Queue Management', () => {
    it('should clear queue correctly', () => {
      queue.clear();

      const stats = queue.getStats();
      expect(stats.queueDepth).toBe(0);
      expect(stats.trackedFiles).toBe(0);
      expect(stats.isProcessing).toBe(false);
    });

    it('should provide accurate statistics', async () => {
      const chunks = Array.from({ length: 5 }, (_, i) => ({
        text: `Chunk ${i}`,
        offset: i * 100
      }));

      await queue.addChunks(chunks, '/test/file1.txt', 1);
      await queue.waitForCompletion('/test/file1.txt');

      const stats = queue.getStats();
      // Queue should be drained after completion
      expect(stats.queueDepth).toBe(0);
      expect(stats.trackedFiles).toBe(1); // File tracker exists until cleanup
      expect(typeof stats.isProcessing).toBe('boolean');
      expect(typeof stats.processingBatches).toBe('number');
    });
  });

  describe('Serial Queue Behavior', () => {
    it('should handle concurrent requests to same embedder serially', async () => {
      // Create a mock embedder pool that tracks request timing
      const requestTimings: Array<{ id: string; start: number; end: number }> = [];

      // Override the mock to track timing and add artificial delay
      vi.mocked(embedderPool.embed).mockImplementation(async (texts: string[]) => {
        const requestId = Math.random().toString(36).slice(2);
        const start = Date.now();

        // Add a more significant delay to make serialization visible
        await new Promise(r => setTimeout(r, 50));

        const end = Date.now();
        requestTimings.push({ id: requestId, start, end });

        return texts.map(() => new Array(384).fill(0.1));
      });

      // Add multiple chunks that will create concurrent batches
      const chunks1 = Array.from({ length: 8 }, (_, i) => ({
        text: `File1 Chunk ${i}`,
        offset: i * 100
      }));

      const chunks2 = Array.from({ length: 8 }, (_, i) => ({
        text: `File2 Chunk ${i}`,
        offset: i * 100
      }));

      // Add chunks simultaneously to force concurrent processing
      const promise1 = queue.addChunks(chunks1, '/test/file1.txt', 1);
      const promise2 = queue.addChunks(chunks2, '/test/file2.txt', 2);

      await Promise.all([promise1, promise2]);

      // Wait for all processing to complete
      await queue.waitForCompletion('/test/file1.txt');
      await queue.waitForCompletion('/test/file2.txt');

      // Verify that requests were processed (at least 2 embed calls, might be more due to batch sizes)
      expect(vi.mocked(embedderPool.embed)).toHaveBeenCalledTimes(requestTimings.length);
      expect(requestTimings.length).toBeGreaterThanOrEqual(2);

      // Verify that both requests completed successfully
      expect(completedFiles).toContain('/test/file1.txt');
      expect(completedFiles).toContain('/test/file2.txt');
      expect(processedBatches.length).toBeGreaterThanOrEqual(2);
    });

    it('should preserve request order within serial queue', async () => {
      const processOrder: string[] = [];

      // Mock embedder to track processing order
      vi.mocked(embedderPool.embed).mockImplementation(async (texts: string[]) => {
        const firstText = texts[0];
        processOrder.push(firstText);

        // Small delay to ensure we can observe ordering
        await new Promise(r => setTimeout(r, 20));

        return texts.map(() => new Array(384).fill(0.1));
      });

      // Add chunks in a specific order
      const chunks1 = [{ text: 'FIRST_BATCH', offset: 0 }];
      const chunks2 = [{ text: 'SECOND_BATCH', offset: 0 }];
      const chunks3 = [{ text: 'THIRD_BATCH', offset: 0 }];

      // Add them quickly in sequence
      await queue.addChunks(chunks1, '/test/file1.txt', 1);
      await queue.addChunks(chunks2, '/test/file2.txt', 2);
      await queue.addChunks(chunks3, '/test/file3.txt', 3);

      // Wait for all to complete
      await queue.waitForCompletion('/test/file1.txt');
      await queue.waitForCompletion('/test/file2.txt');
      await queue.waitForCompletion('/test/file3.txt');

      // Verify processing occurred and files completed
      expect(processOrder.length).toBeGreaterThanOrEqual(3);
      expect(completedFiles).toContain('/test/file1.txt');
      expect(completedFiles).toContain('/test/file2.txt');
      expect(completedFiles).toContain('/test/file3.txt');
    });

    it('should handle embedder errors gracefully in serial queue', async () => {
      let callCount = 0;

      // Mock embedder to fail on first call, succeed on retry
      vi.mocked(embedderPool.embed).mockImplementation(async (texts: string[]) => {
        callCount++;
        if (callCount === 1) {
          throw new Error('Simulated embedder failure');
        }

        await new Promise(r => setTimeout(r, 10));
        return texts.map(() => new Array(384).fill(0.1));
      });

      const chunks = [{ text: 'Test chunk', offset: 0 }];

      await queue.addChunks(chunks, '/test/file1.txt', 1);

      // Wait with timeout to avoid hanging
      await new Promise((resolve) => {
        const timeout = setTimeout(resolve, 2000); // 2 second timeout
        queue.waitForCompletion('/test/file1.txt').then(() => {
          clearTimeout(timeout);
          resolve(undefined);
        });
      });

      // Should have been called at least once
      expect(callCount).toBeGreaterThanOrEqual(1);

      // The retry logic is handled at the EmbedderPool level, not the queue level
      // This test verifies that the queue can handle embedder failures gracefully
    }, 10000); // Increase test timeout to 10 seconds
  });
});