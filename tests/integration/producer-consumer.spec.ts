import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import * as crypto from 'crypto';
import * as lancedb from '@lancedb/lancedb';
import { EmbeddingQueue } from '../../src/main/core/embedding/EmbeddingQueue';
import { EmbedderPool } from '../../src/shared/embeddings/embedder-pool';
import { ConcurrentQueue } from '../../src/main/core/embedding/ConcurrentQueue';
import { chunkText } from '../../src/main/pipeline/chunker';
import { parseText } from '../../src/main/parsers/text';

// Helper to create test files of various sizes
function createTestFile(size: 'small' | 'medium' | 'large'): string {
  const content = {
    small: 'This is a small test file. It contains just a few sentences to test basic functionality.',
    medium: Array.from({ length: 50 }, (_, i) =>
      `This is paragraph ${i + 1}. It contains multiple sentences to create a medium-sized document. ` +
      `The content is designed to generate approximately 50-100 chunks when processed. ` +
      `Each paragraph has enough text to be meaningful for embedding generation.`
    ).join('\n\n'),
    large: Array.from({ length: 200 }, (_, i) =>
      `This is a large document paragraph ${i + 1}. ` +
      `It contains extensive content designed to create many chunks. ` +
      `The purpose is to test system behavior under load when processing large files. ` +
      `Each paragraph is substantial enough to generate meaningful embeddings. ` +
      `The total document should create several hundred chunks for processing. ` +
      `This tests the queue's ability to handle large files without blocking smaller ones.`
    ).join('\n\n')
  };

  const tempDir = os.tmpdir();
  const fileName = `test-${size}-${Date.now()}-${Math.random().toString(36).slice(2)}.txt`;
  const filePath = path.join(tempDir, fileName);

  fs.writeFileSync(filePath, content[size]);
  return filePath;
}

describe('Producer-Consumer Integration', () => {
  let embedderPool: EmbedderPool;
  let embeddingQueue: EmbeddingQueue;
  let fileQueue: ConcurrentQueue;
  let db: any;
  let table: any;
  let tempDir: string;
  let testFiles: string[] = [];
  let processedFiles: string[] = [];
  let timeoutErrors: string[] = [];

  beforeEach(async () => {
    // Set up test database
    tempDir = path.join(os.tmpdir(), `producer-consumer-test-${Date.now()}`);
    fs.mkdirSync(tempDir, { recursive: true });
    db = await lancedb.connect(tempDir);

    // Initialize LanceDB table with dummy data
    const dummyData = [{
      id: 'dummy',
      path: '/dummy',
      text: 'dummy text',
      vector: new Array(384).fill(0.1),
      mtime: Date.now(),
      page: 0,
      offset: 0,
      type: 'txt',
      title: 'dummy'
    }];
    table = await db.createTable('documents', dummyData);

    // Set up real EmbedderPool (smaller config for testing)
    embedderPool = new EmbedderPool({
      poolSize: 2,
      maxFilesBeforeRestart: 50,
      maxMemoryMB: 300
    });
    await embedderPool.initialize();

    // Set up EmbeddingQueue with real batch processor
    embeddingQueue = new EmbeddingQueue({
      maxQueueSize: 200,
      batchSize: 16, // Reasonable batch size for testing
      backpressureThreshold: 100,
      onProgress: (filePath, processed, total) => {
        console.log(`[TEST] Progress: ${path.basename(filePath)} - ${processed}/${total}`);
      },
      onFileComplete: (filePath) => {
        processedFiles.push(filePath);
        console.log(`[TEST] Completed: ${path.basename(filePath)}`);
      }
    });

    // Initialize with real batch processor that writes to database
    embeddingQueue.initialize(embedderPool, async (batch) => {
      const rows = batch.chunks.map((chunk, idx) => {
        const id = crypto.createHash('sha1')
          .update(`${chunk.metadata.filePath}:${chunk.metadata.page || 0}:${chunk.metadata.offset}`)
          .digest('hex');

        return {
          id,
          path: chunk.metadata.filePath,
          mtime: Date.now(),
          page: chunk.metadata.page || 0,
          offset: chunk.metadata.offset,
          text: chunk.text,
          vector: batch.vectors[idx],
          type: path.extname(chunk.metadata.filePath).slice(1).toLowerCase() || 'txt',
          title: path.basename(chunk.metadata.filePath)
        };
      });

      // Merge rows into database
      for (const row of rows) {
        try {
          await table.add([row]);
        } catch (error) {
          console.error(`[TEST] Database write error:`, error);
        }
      }
    });

    // Set up file queue with backpressure
    fileQueue = new ConcurrentQueue({
      maxConcurrent: 5,
      memoryThresholdMB: 400,
      throttledConcurrent: 2,
      shouldApplyBackpressure: () => embeddingQueue.shouldApplyBackpressure()
    });

    // Reset tracking arrays
    processedFiles = [];
    timeoutErrors = [];
    testFiles = [];
  });

  afterEach(async () => {
    // Clean up
    await embedderPool.dispose();
    embeddingQueue.clear();

    // Remove test files
    for (const filePath of testFiles) {
      if (fs.existsSync(filePath)) {
        fs.unlinkSync(filePath);
      }
    }

    // Clean up temp directory
    if (fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  describe('Multi-File Processing', () => {
    it('should process multiple files concurrently without timeouts', async () => {
      // Create test files of different sizes
      const smallFile = createTestFile('small');
      const mediumFile1 = createTestFile('medium');
      const mediumFile2 = createTestFile('medium');
      const largeFile = createTestFile('large');

      testFiles = [smallFile, mediumFile1, mediumFile2, largeFile];

      const startTime = Date.now();
      let hasTimeout = false;

      // Monitor for timeouts (this is the key test!)
      const originalConsoleError = console.error;
      console.error = (...args) => {
        const message = args.join(' ');
        if (message.includes('timeout') || message.includes('Embed timeout')) {
          hasTimeout = true;
          timeoutErrors.push(message);
        }
        originalConsoleError(...args);
      };

      try {
        // Process files through the queue
        const fileProcessingPromises = testFiles.map(async (filePath, index) => {
          const text = await parseText(filePath);
          const chunks = chunkText(text, 500, 60);

          console.log(`[TEST] Adding ${chunks.length} chunks from ${path.basename(filePath)}`);

          await embeddingQueue.addChunks(chunks, filePath, index);
          await embeddingQueue.waitForCompletion(filePath);
        });

        // Wait for all files to complete
        await Promise.all(fileProcessingPromises);

        const duration = Date.now() - startTime;
        console.log(`[TEST] Total processing time: ${duration}ms`);

        // Verify no timeouts occurred
        expect(hasTimeout).toBe(false);
        expect(timeoutErrors).toHaveLength(0);

        // Verify all files completed
        expect(processedFiles).toHaveLength(testFiles.length);
        for (const filePath of testFiles) {
          expect(processedFiles).toContain(filePath);
        }

        // Verify reasonable processing time (should be much faster than sequential)
        expect(duration).toBeLessThan(120000); // 2 minutes max

        // Verify database contains data from all files
        const totalRows = await table.countRows();
        expect(totalRows).toBeGreaterThan(testFiles.length); // More than just dummy data

      } finally {
        console.error = originalConsoleError;
      }
    });

    it('should handle large files without blocking smaller ones', async () => {
      // Create one large file and several small files
      const largeFile = createTestFile('large');
      const smallFiles = [
        createTestFile('small'),
        createTestFile('small'),
        createTestFile('small')
      ];

      testFiles = [largeFile, ...smallFiles];

      const completionTimes: Array<{ file: string; time: number }> = [];
      const startTime = Date.now();

      // Track completion times
      const originalComplete = embeddingQueue['onFileComplete'];
      embeddingQueue['onFileComplete'] = (filePath) => {
        completionTimes.push({
          file: path.basename(filePath),
          time: Date.now() - startTime
        });
        originalComplete?.(filePath);
      };

      // Start processing all files
      const filePromises = testFiles.map(async (filePath, index) => {
        const text = await parseText(filePath);
        const chunks = chunkText(text, 500, 60);

        await embeddingQueue.addChunks(chunks, filePath, index);
        await embeddingQueue.waitForCompletion(filePath);
      });

      await Promise.all(filePromises);

      // Small files should complete before the large file
      const smallFileCompletions = completionTimes.filter(c => c.file.includes('small'));
      const largeFileCompletion = completionTimes.find(c => c.file.includes('large'));

      expect(smallFileCompletions).toHaveLength(3);
      expect(largeFileCompletion).toBeDefined();

      // At least one small file should complete before the large file
      const earliestSmallFile = Math.min(...smallFileCompletions.map(c => c.time));
      expect(earliestSmallFile).toBeLessThan(largeFileCompletion!.time);
    });

    it('should maintain queue ordering across files', async () => {
      const file1 = createTestFile('small');
      const file2 = createTestFile('small');

      testFiles = [file1, file2];

      const processedChunks: Array<{ filePath: string; text: string }> = [];

      // Override batch processor to track chunk order
      embeddingQueue.initialize(embedderPool, async (batch) => {
        for (const chunk of batch.chunks) {
          processedChunks.push({
            filePath: chunk.metadata.filePath,
            text: chunk.text
          });
        }
      });

      // Add chunks from files in specific order
      const text1 = await parseText(file1);
      const text2 = await parseText(file2);
      const chunks1 = chunkText(text1, 500, 60);
      const chunks2 = chunkText(text2, 500, 60);

      await embeddingQueue.addChunks(chunks1, file1, 1);
      await embeddingQueue.addChunks(chunks2, file2, 2);

      await Promise.all([
        embeddingQueue.waitForCompletion(file1),
        embeddingQueue.waitForCompletion(file2)
      ]);

      // Verify file 1 chunks come before file 2 chunks (FIFO)
      const file1Indices = processedChunks
        .map((chunk, index) => chunk.filePath === file1 ? index : -1)
        .filter(index => index !== -1);

      const file2Indices = processedChunks
        .map((chunk, index) => chunk.filePath === file2 ? index : -1)
        .filter(index => index !== -1);

      // First chunk from file1 should come before first chunk from file2
      expect(Math.min(...file1Indices)).toBeLessThan(Math.min(...file2Indices));
    });
  });

  describe('Backpressure Scenarios', () => {
    it('should apply backpressure when queue fills up', async () => {
      // Create multiple large files to fill the queue
      const largeFiles = [
        createTestFile('large'),
        createTestFile('large'),
        createTestFile('large')
      ];

      testFiles = largeFiles;

      let backpressureTriggered = false;
      const originalApplyBackpressure = embeddingQueue.shouldApplyBackpressure.bind(embeddingQueue);
      embeddingQueue.shouldApplyBackpressure = () => {
        const result = originalApplyBackpressure();
        if (result && !backpressureTriggered) {
          backpressureTriggered = true;
          console.log('[TEST] Backpressure triggered');
        }
        return result;
      };

      // Start processing files
      const filePromises = largeFiles.map(async (filePath, index) => {
        const text = await parseText(filePath);
        const chunks = chunkText(text, 500, 60);

        await embeddingQueue.addChunks(chunks, filePath, index);
        await embeddingQueue.waitForCompletion(filePath);
      });

      await Promise.all(filePromises);

      // Backpressure should have been triggered at some point
      expect(backpressureTriggered).toBe(true);
    });

    it('should recover from backpressure as queue drains', async () => {
      const largeFile = createTestFile('large');
      testFiles = [largeFile];

      // Fill queue to trigger backpressure
      const text = await parseText(largeFile);
      const chunks = chunkText(text, 500, 60);

      await embeddingQueue.addChunks(chunks, largeFile, 1);

      // Should trigger backpressure
      expect(embeddingQueue.shouldApplyBackpressure()).toBe(true);

      // Wait for processing to complete
      await embeddingQueue.waitForCompletion(largeFile);

      // Backpressure should be released
      expect(embeddingQueue.shouldApplyBackpressure()).toBe(false);
    });
  });

  describe('Performance Metrics', () => {
    it('should maintain high embedder utilization', async () => {
      const mediumFiles = [
        createTestFile('medium'),
        createTestFile('medium'),
        createTestFile('medium')
      ];

      testFiles = mediumFiles;

      const startTime = Date.now();

      // Process files
      const filePromises = mediumFiles.map(async (filePath, index) => {
        const text = await parseText(filePath);
        const chunks = chunkText(text, 500, 60);

        await embeddingQueue.addChunks(chunks, filePath, index);
        await embeddingQueue.waitForCompletion(filePath);
      });

      await Promise.all(filePromises);

      const duration = Date.now() - startTime;
      console.log(`[TEST] Processing duration: ${duration}ms`);

      // Should process efficiently (rough benchmark)
      expect(duration).toBeLessThan(60000); // 1 minute max for 3 medium files
    });

    it('should maintain bounded memory usage', async () => {
      const largeFile = createTestFile('large');
      testFiles = [largeFile];

      const initialMemory = process.memoryUsage();

      const text = await parseText(largeFile);
      const chunks = chunkText(text, 500, 60);

      await embeddingQueue.addChunks(chunks, largeFile, 1);
      await embeddingQueue.waitForCompletion(largeFile);

      const finalMemory = process.memoryUsage();
      const memoryIncrease = finalMemory.rss - initialMemory.rss;

      // Memory increase should be reasonable (less than 500MB)
      expect(memoryIncrease).toBeLessThan(500 * 1024 * 1024);

      console.log(`[TEST] Memory increase: ${Math.round(memoryIncrease / 1024 / 1024)}MB`);
    });
  });

  describe('Database Integration', () => {
    it('should write all chunks to database correctly', async () => {
      const testFile = createTestFile('medium');
      testFiles = [testFile];

      const text = await parseText(testFile);
      const chunks = chunkText(text, 500, 60);

      const initialRowCount = await table.countRows();

      await embeddingQueue.addChunks(chunks, testFile, 1);
      await embeddingQueue.waitForCompletion(testFile);

      const finalRowCount = await table.countRows();

      // Should have added all chunks to database
      expect(finalRowCount - initialRowCount).toBe(chunks.length);
    });

    it('should preserve chunk metadata in database', async () => {
      const testFile = createTestFile('small');
      testFiles = [testFile];

      const text = await parseText(testFile);
      const chunks = chunkText(text, 500, 60);

      await embeddingQueue.addChunks(chunks, testFile, 1);
      await embeddingQueue.waitForCompletion(testFile);

      // Query database for our file
      const results = await table
        .query()
        .filter(`path = "${testFile}"`)
        .toArray();

      expect(results).toHaveLength(chunks.length);

      // Check that metadata is preserved
      for (let i = 0; i < results.length; i++) {
        const dbRow = results[i];
        const originalChunk = chunks[i];

        expect(dbRow.path).toBe(testFile);
        expect(dbRow.text).toBe(originalChunk.text);
        expect(dbRow.offset).toBe(originalChunk.offset);
        expect(dbRow.vector).toHaveLength(384);
      }
    });
  });
});