import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { EmbeddingQueue, ProcessedBatch } from '../../src/main/worker/EmbeddingQueue';
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
    it('should add chunks from a single file', async () => {
      const chunks = [
        { text: 'First chunk', offset: 0 },
        { text: 'Second chunk', offset: 100 }
      ];

      await queue.addChunks(chunks, '/test/file1.txt', 1);

      const stats = queue.getStats();
      expect(stats.queueDepth).toBe(2);
    });

    it('should add chunks from multiple files', async () => {
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

      const stats = queue.getStats();
      expect(stats.queueDepth).toBe(4);
    });

    it('should maintain FIFO order across files', async () => {
      const file1Chunks = [
        { text: 'File1-Chunk1', offset: 0 },
        { text: 'File1-Chunk2', offset: 100 }
      ];
      const file2Chunks = [
        { text: 'File2-Chunk1', offset: 0 },
        { text: 'File2-Chunk2', offset: 100 }
      ];

      // Add chunks from alternating files
      await queue.addChunks(file1Chunks, '/test/file1.txt', 1);
      await queue.addChunks(file2Chunks, '/test/file2.txt', 2);

      // Wait for processing to complete
      await Promise.all([
        queue.waitForCompletion('/test/file1.txt'),
        queue.waitForCompletion('/test/file2.txt')
      ]);

      // Check that batches were processed
      expect(processedBatches.length).toBeGreaterThan(0);

      // Verify first batch contains chunks in FIFO order
      const firstBatch = processedBatches[0];
      expect(firstBatch.chunks[0].text).toBe('File1-Chunk1');
      expect(firstBatch.chunks[1].text).toBe('File1-Chunk2');
      expect(firstBatch.chunks[2].text).toBe('File2-Chunk1');
      expect(firstBatch.chunks[3].text).toBe('File2-Chunk2');
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

    it('should limit concurrent batch processing', async () => {
      const stats = queue.getStats();

      // Should not process more batches than embedder pool size
      expect(stats.processingBatches).toBeLessThanOrEqual(2);
    });
  });

  describe('Backpressure', () => {
    it('should signal backpressure when queue is full', async () => {
      // Add chunks up to backpressure threshold
      const chunks = Array.from({ length: 60 }, (_, i) => ({
        text: `Chunk ${i}`,
        offset: i * 100
      }));

      await queue.addChunks(chunks, '/test/large-file.txt', 1);

      // Should signal backpressure
      expect(queue.shouldApplyBackpressure()).toBe(true);
    });

    it('should not signal backpressure when queue is small', async () => {
      const chunks = Array.from({ length: 10 }, (_, i) => ({
        text: `Chunk ${i}`,
        offset: i * 100
      }));

      await queue.addChunks(chunks, '/test/small-file.txt', 1);

      // Should not signal backpressure
      expect(queue.shouldApplyBackpressure()).toBe(false);
    });

    it('should recover from backpressure as queue drains', async () => {
      // Fill queue to trigger backpressure
      const chunks = Array.from({ length: 60 }, (_, i) => ({
        text: `Chunk ${i}`,
        offset: i * 100
      }));

      await queue.addChunks(chunks, '/test/large-file.txt', 1);
      expect(queue.shouldApplyBackpressure()).toBe(true);

      // Wait for processing to drain the queue
      await queue.waitForCompletion('/test/large-file.txt');

      // Backpressure should be released
      expect(queue.shouldApplyBackpressure()).toBe(false);
    });
  });

  describe('Error Handling', () => {
    it('should handle batch processor errors gracefully', async () => {
      // Create queue with failing batch processor
      const failingQueue = new EmbeddingQueue({
        maxQueueSize: 100,
        batchSize: 8
      });

      failingQueue.initialize(embedderPool, async () => {
        throw new Error('Batch processor error');
      });

      const chunks = [{ text: 'Test chunk', offset: 0 }];

      // Should not throw, even with failing batch processor
      await expect(failingQueue.addChunks(chunks, '/test/file1.txt', 1))
        .resolves.not.toThrow();

      failingQueue.clear();
    });

    it('should clean up file trackers after completion', async () => {
      const chunks = [{ text: 'Test chunk', offset: 0 }];

      await queue.addChunks(chunks, '/test/file1.txt', 1);
      await queue.waitForCompletion('/test/file1.txt');

      // Wait for cleanup delay
      await new Promise(r => setTimeout(r, 5100));

      const stats = queue.getStats();
      expect(stats.trackedFiles).toBe(0);
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
});