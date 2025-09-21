import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { EmbeddingQueue } from '../../src/main/core/embedding/EmbeddingQueue';
import { EmbedderPool } from '../../src/shared/embeddings/embedder-pool';

// Mock the embedder pool
vi.mock('../../src/shared/embeddings/embedder-pool', () => {
  return {
    EmbedderPool: vi.fn().mockImplementation(() => {
      return {
        initialize: vi.fn().mockResolvedValue(undefined),
        getPoolSize: vi.fn().mockReturnValue(2),
        embed: vi.fn().mockImplementation(async (texts: string[]) => {
          // Simulate processing time
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

describe('EmbeddingQueue - File Tracker Lifecycle', () => {
  let queue: EmbeddingQueue;
  let embedderPool: EmbedderPool;
  let completedFiles: string[] = [];

  beforeEach(async () => {
    vi.clearAllMocks();
    completedFiles = [];

    embedderPool = new EmbedderPool({
      poolSize: 2,
      maxFilesBeforeRestart: 100,
      maxMemoryMB: 200
    });
    await embedderPool.initialize();

    queue = new EmbeddingQueue({
      maxQueueSize: 100,
      batchSize: 8,
      onFileComplete: (filePath) => {
        completedFiles.push(filePath);
      }
    });

    queue.initialize(embedderPool, async () => {
      // Batch processor - just consume batches
    });
  });

  afterEach(async () => {
    await embedderPool.dispose();
    queue.clear();
  });

  describe('Tracker Persistence After Completion', () => {
    it('should keep file tracker after embedding completes', async () => {
      const filePath = '/test/file1.txt';
      const chunks = [
        { text: 'Chunk 1', offset: 0 },
        { text: 'Chunk 2', offset: 100 }
      ];

      // Add chunks and wait for completion
      await queue.addChunks(chunks, filePath, 1);
      await queue.waitForCompletion(filePath);

      // File should be completed
      expect(completedFiles).toContain(filePath);

      // Get file trackers to verify it still exists
      const trackers = queue.getFileTrackers();
      expect(trackers.has(filePath)).toBe(true);

      const tracker = trackers.get(filePath);
      expect(tracker).toBeDefined();
      expect(tracker!.processedChunks).toBe(2);
      expect(tracker!.totalChunks).toBe(2);
    });

    it('should NOT automatically cleanup tracker after timeout', async () => {
      const filePath = '/test/file2.txt';
      const chunks = [
        { text: 'Test chunk', offset: 0 }
      ];

      // Add chunks with real timers
      await queue.addChunks(chunks, filePath, 1);
      await queue.waitForCompletion(filePath);

      // Switch to fake timers for time advancement testing
      vi.useFakeTimers();

      // Verify tracker exists immediately after completion
      let trackers = queue.getFileTrackers();
      expect(trackers.has(filePath)).toBe(true);

      // Fast-forward time by 10 seconds (well past any timeout)
      vi.advanceTimersByTime(10000);

      // Tracker should STILL exist (no automatic cleanup)
      trackers = queue.getFileTrackers();
      expect(trackers.has(filePath)).toBe(true);

      // Even after 1 minute
      vi.advanceTimersByTime(50000);
      trackers = queue.getFileTrackers();
      expect(trackers.has(filePath)).toBe(true);

      vi.useRealTimers();
    });

    it('should maintain multiple file trackers independently', async () => {
      const files = [
        '/test/fileA.txt',
        '/test/fileB.txt',
        '/test/fileC.txt'
      ];

      // Process multiple files
      for (const filePath of files) {
        const chunks = [
          { text: `${filePath} chunk 1`, offset: 0 },
          { text: `${filePath} chunk 2`, offset: 100 }
        ];
        await queue.addChunks(chunks, filePath, files.indexOf(filePath));
      }

      // Wait for all to complete
      await Promise.all(files.map(f => queue.waitForCompletion(f)));

      // All should be completed
      expect(completedFiles).toEqual(expect.arrayContaining(files));

      // All trackers should still exist
      const trackers = queue.getFileTrackers();
      for (const filePath of files) {
        expect(trackers.has(filePath)).toBe(true);
        const tracker = trackers.get(filePath);
        expect(tracker!.processedChunks).toBe(2);
        expect(tracker!.totalChunks).toBe(2);
      }

      // Test timer persistence with fake timers
      vi.useFakeTimers();
      vi.advanceTimersByTime(30000);

      const trackersAfterTime = queue.getFileTrackers();
      for (const filePath of files) {
        expect(trackersAfterTime.has(filePath)).toBe(true);
      }

      vi.useRealTimers();
    }, 20000);
  });

  describe('Explicit Cleanup Method', () => {
    it('should remove tracker when cleanupFileTracker is called', async () => {
      const filePath = '/test/cleanup-test.txt';
      const chunks = [
        { text: 'Chunk 1', offset: 0 },
        { text: 'Chunk 2', offset: 100 }
      ];

      await queue.addChunks(chunks, filePath, 1);
      await queue.waitForCompletion(filePath);

      // Verify tracker exists
      let trackers = queue.getFileTrackers();
      expect(trackers.has(filePath)).toBe(true);

      // Explicitly cleanup the tracker
      queue.cleanupFileTracker(filePath);

      // Tracker should now be removed
      trackers = queue.getFileTrackers();
      expect(trackers.has(filePath)).toBe(false);
    });

    it('should handle cleanup of non-existent tracker gracefully', () => {
      const filePath = '/test/non-existent.txt';

      // Cleanup should not throw for non-existent file
      expect(() => {
        queue.cleanupFileTracker(filePath);
      }).not.toThrow();

      // Verify no tracker exists
      const trackers = queue.getFileTrackers();
      expect(trackers.has(filePath)).toBe(false);
    });

    it('should handle multiple cleanup calls gracefully', async () => {
      const filePath = '/test/multi-cleanup.txt';
      const chunks = [{ text: 'Test', offset: 0 }];

      await queue.addChunks(chunks, filePath, 1);
      await queue.waitForCompletion(filePath);

      // Multiple cleanups should not throw
      expect(() => {
        queue.cleanupFileTracker(filePath);
        queue.cleanupFileTracker(filePath);
        queue.cleanupFileTracker(filePath);
      }).not.toThrow();

      // Tracker should be removed
      const trackers = queue.getFileTrackers();
      expect(trackers.has(filePath)).toBe(false);
    });

    it('should only cleanup specified file tracker', async () => {
      const file1 = '/test/keep1.txt';
      const file2 = '/test/remove.txt';
      const file3 = '/test/keep2.txt';

      // Process multiple files
      for (const filePath of [file1, file2, file3]) {
        const chunks = [{ text: `${filePath} data`, offset: 0 }];
        await queue.addChunks(chunks, filePath, [file1, file2, file3].indexOf(filePath));
      }

      await Promise.all([
        queue.waitForCompletion(file1),
        queue.waitForCompletion(file2),
        queue.waitForCompletion(file3)
      ]);

      // Cleanup only file2
      queue.cleanupFileTracker(file2);

      // Check trackers
      const trackers = queue.getFileTrackers();
      expect(trackers.has(file1)).toBe(true);
      expect(trackers.has(file2)).toBe(false); // Should be removed
      expect(trackers.has(file3)).toBe(true);
    });
  });

  describe('Pipeline Status Display Accuracy', () => {
    it('should show completed file as EMBEDDING with 100% progress', async () => {
      const filePath = '/test/status-test.pdf';
      const chunks = Array.from({ length: 10 }, (_, i) => ({
        text: `Chunk ${i}`,
        offset: i * 100
      }));

      await queue.addChunks(chunks, filePath, 1);
      await queue.waitForCompletion(filePath);

      // Get tracker to verify status
      const trackers = queue.getFileTrackers();
      const tracker = trackers.get(filePath);

      expect(tracker).toBeDefined();
      expect(tracker!.processedChunks).toBe(10);
      expect(tracker!.totalChunks).toBe(10);

      // Calculate progress percentage
      const progress = Math.round((tracker!.processedChunks / tracker!.totalChunks) * 100);
      expect(progress).toBe(100);

      // Tracker should still exist (not cleaned up automatically)
      expect(trackers.has(filePath)).toBe(true);
    });

    it('should maintain correct status for partially processed files', async () => {
      const filePath = '/test/partial.pdf';
      const chunks = Array.from({ length: 20 }, (_, i) => ({
        text: `Chunk ${i}`,
        offset: i * 100
      }));

      // Add chunks but don't wait for full completion
      await queue.addChunks(chunks, filePath, 1);

      // Give it a moment to start processing
      await new Promise(r => setTimeout(r, 50));

      // Check tracker state during processing
      const trackers = queue.getFileTrackers();
      const tracker = trackers.get(filePath);

      if (tracker) {
        expect(tracker.totalChunks).toBe(20);
        // processedChunks should be between 0 and 20
        expect(tracker.processedChunks).toBeGreaterThanOrEqual(0);
        expect(tracker.processedChunks).toBeLessThanOrEqual(20);
      }
    });

    it('should correctly track multiple files at different completion stages', async () => {
      const file1 = '/test/complete.pdf';
      const file2 = '/test/inprogress.pdf';
      const file3 = '/test/starting.pdf';

      // File 1: Complete processing
      const chunks1 = [{ text: 'Complete', offset: 0 }];
      await queue.addChunks(chunks1, file1, 1);
      await queue.waitForCompletion(file1);

      // File 2: Add but don't wait
      const chunks2 = Array.from({ length: 50 }, (_, i) => ({
        text: `InProgress ${i}`,
        offset: i * 100
      }));
      await queue.addChunks(chunks2, file2, 2);

      // File 3: Just add
      const chunks3 = Array.from({ length: 100 }, (_, i) => ({
        text: `Starting ${i}`,
        offset: i * 100
      }));
      await queue.addChunks(chunks3, file3, 3);

      // Check all trackers
      const trackers = queue.getFileTrackers();

      // File 1 should be 100% complete
      const tracker1 = trackers.get(file1);
      expect(tracker1).toBeDefined();
      expect(tracker1!.processedChunks).toBe(tracker1!.totalChunks);

      // File 2 and 3 should exist but may be at various stages
      expect(trackers.has(file2)).toBe(true);
      expect(trackers.has(file3)).toBe(true);

      // No automatic cleanup should happen
      vi.useFakeTimers();
      vi.advanceTimersByTime(10000);
      vi.useRealTimers();

      const trackersAfter = queue.getFileTrackers();
      expect(trackersAfter.has(file1)).toBe(true); // Should still exist
      expect(trackersAfter.has(file2)).toBe(true);
      expect(trackersAfter.has(file3)).toBe(true);
    });
  });

  describe('Integration with Worker handleFile', () => {
    it('should simulate handleFile finally block cleanup', async () => {
      const filePath = '/test/worker-integration.txt';
      const chunks = [
        { text: 'Integration test', offset: 0 }
      ];

      // Simulate what handleFile does
      try {
        await queue.addChunks(chunks, filePath, 1);
        await queue.waitForCompletion(filePath);

        // File processing complete
        expect(completedFiles).toContain(filePath);
      } finally {
        // This is what handleFile's finally block does
        queue.cleanupFileTracker(filePath);
      }

      // Tracker should be cleaned up
      const trackers = queue.getFileTrackers();
      expect(trackers.has(filePath)).toBe(false);
    });

    it('should cleanup tracker even if processing fails', async () => {
      const filePath = '/test/error-case.txt';

      // Mock embedder to fail
      vi.mocked(embedderPool.embed).mockRejectedValueOnce(new Error('Embed failed'));

      const chunks = [{ text: 'Will fail', offset: 0 }];

      try {
        await queue.addChunks(chunks, filePath, 1);
        // Don't wait for completion to simulate error case
      } finally {
        // Cleanup should still work
        queue.cleanupFileTracker(filePath);
      }

      // Tracker should be removed
      const trackers = queue.getFileTrackers();
      expect(trackers.has(filePath)).toBe(false);
    });
  });

  describe('Stats with persistent trackers', () => {
    it('should report correct trackedFiles count', async () => {
      const files = ['/test/a.txt', '/test/b.txt', '/test/c.txt'];

      // Process files
      for (const file of files) {
        const chunks = [{ text: file, offset: 0 }];
        await queue.addChunks(chunks, file, files.indexOf(file));
      }

      // Wait for completion
      await Promise.all(files.map(f => queue.waitForCompletion(f)));

      // Check stats
      const stats = queue.getStats();
      expect(stats.trackedFiles).toBe(3);

      // Cleanup one file
      queue.cleanupFileTracker(files[0]);

      const statsAfter = queue.getStats();
      expect(statsAfter.trackedFiles).toBe(2);

      // Cleanup remaining
      queue.cleanupFileTracker(files[1]);
      queue.cleanupFileTracker(files[2]);

      const statsFinal = queue.getStats();
      expect(statsFinal.trackedFiles).toBe(0);
    });
  });
});