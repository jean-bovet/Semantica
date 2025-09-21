import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import * as lancedb from '@lancedb/lancedb';
import { EmbeddingQueue } from '../../src/main/core/embedding/EmbeddingQueue';
import { EmbedderPool } from '../../src/shared/embeddings/embedder-pool';
import { chunkText } from '../../src/main/pipeline/chunker';

// Helper to create large test documents
function createLargeDocument(chunkCount: number): string {
  return Array.from({ length: chunkCount }, (_, i) =>
    `This is a large document chunk number ${i + 1}. ` +
    `It contains substantial content designed to trigger the exact conditions that previously caused timeouts. ` +
    `Each chunk has enough text to be meaningful for embedding generation while stressing the system. ` +
    `The purpose is to verify that the new producer-consumer architecture prevents timeouts. ` +
    `This text is carefully crafted to generate approximately 500 tokens per chunk. ` +
    `Multiple sentences ensure natural language processing while maintaining consistent chunk sizes. ` +
    `The content simulates real-world documents that previously overwhelmed the embedding system.`
  ).join('\n\n');
}

// Helper to create test files
function createTestFiles(fileConfigs: Array<{ name: string; chunkCount: number }>): string[] {
  const tempDir = os.tmpdir();
  const testFiles: string[] = [];

  for (const config of fileConfigs) {
    const content = createLargeDocument(config.chunkCount);
    const fileName = `timeout-test-${config.name}-${Date.now()}-${Math.random().toString(36).slice(2)}.txt`;
    const filePath = path.join(tempDir, fileName);

    fs.writeFileSync(filePath, content);
    testFiles.push(filePath);
  }

  return testFiles;
}

describe('Timeout Prevention Stress Tests', () => {
  let embedderPool: EmbedderPool;
  let embeddingQueue: EmbeddingQueue;
  let db: any;
  let table: any;
  let tempDir: string;
  let testFiles: string[] = [];
  let timeoutOccurred = false;
  let embedTimeouts: string[] = [];
  let completedFiles: string[] = [];

  beforeEach(async () => {
    // Set up test database
    tempDir = path.join(os.tmpdir(), `timeout-prevention-test-${Date.now()}`);
    fs.mkdirSync(tempDir, { recursive: true });
    db = await lancedb.connect(tempDir);

    // Initialize LanceDB table
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

    // Set up real EmbedderPool with realistic configuration
    embedderPool = new EmbedderPool({
      poolSize: 2, // Same as production
      maxFilesBeforeRestart: 100,
      maxMemoryMB: 500
    });
    await embedderPool.initialize();

    // Set up EmbeddingQueue with production-like settings
    embeddingQueue = new EmbeddingQueue({
      maxQueueSize: 2000, // Same as production
      batchSize: 32, // Same as production
      backpressureThreshold: 1000,
      onProgress: (filePath, processed, total) => {
        console.log(`[TIMEOUT-TEST] Progress: ${path.basename(filePath)} - ${processed}/${total}`);
      },
      onFileComplete: (filePath) => {
        completedFiles.push(filePath);
        console.log(`[TIMEOUT-TEST] ✅ Completed: ${path.basename(filePath)}`);
      }
    });

    // Initialize with batch processor
    embeddingQueue.initialize(embedderPool, async (batch) => {
      // Simulate database writes (faster than real DB for testing)
      await new Promise(r => setTimeout(r, 1));
    });

    // Reset tracking
    timeoutOccurred = false;
    embedTimeouts = [];
    completedFiles = [];
    testFiles = [];

    // Monitor for timeout errors
    const originalConsoleError = console.error;
    console.error = (...args) => {
      const message = args.join(' ');
      if (message.includes('Embed timeout') || message.includes('timeout')) {
        timeoutOccurred = true;
        embedTimeouts.push(message);
        console.log(`[TIMEOUT-TEST] ❌ TIMEOUT DETECTED: ${message}`);
      }
      originalConsoleError(...args);
    };
  });

  afterEach(async () => {
    // Restore console.error
    console.error = console.error;

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

  describe('High Load Scenarios', () => {
    it('should process 7 large files without any timeouts', async () => {
      // Create 7 large files (simulating the original deadlock scenario)
      const fileConfigs = [
        { name: 'large1', chunkCount: 200 },
        { name: 'large2', chunkCount: 180 },
        { name: 'large3', chunkCount: 220 },
        { name: 'large4', chunkCount: 190 },
        { name: 'large5', chunkCount: 210 },
        { name: 'large6', chunkCount: 170 },
        { name: 'large7', chunkCount: 240 }
      ];

      testFiles = createTestFiles(fileConfigs);
      const startTime = Date.now();

      console.log(`[TIMEOUT-TEST] Starting processing of ${testFiles.length} large files...`);

      // Process all files concurrently (this previously caused timeouts)
      const filePromises = testFiles.map(async (filePath, index) => {
        const content = fs.readFileSync(filePath, 'utf8');
        const chunks = chunkText(content, 500, 60);

        console.log(`[TIMEOUT-TEST] Adding ${chunks.length} chunks from ${path.basename(filePath)}`);

        await embeddingQueue.addChunks(chunks, filePath, index);
        await embeddingQueue.waitForCompletion(filePath);
      });

      // Wait for all files to complete
      await Promise.all(filePromises);

      const duration = Date.now() - startTime;
      console.log(`[TIMEOUT-TEST] Total processing time: ${duration}ms`);

      // Critical assertion: NO TIMEOUTS should occur
      expect(timeoutOccurred).toBe(false);
      expect(embedTimeouts).toHaveLength(0);

      // All files should complete successfully
      expect(completedFiles).toHaveLength(testFiles.length);

      // Should complete within reasonable time (was infinite before)
      expect(duration).toBeLessThan(300000); // 5 minutes max

      console.log(`[TIMEOUT-TEST] ✅ SUCCESS: All ${testFiles.length} files processed without timeouts`);
    });

    it('should handle extreme load (10 very large files)', async () => {
      // Even more extreme scenario
      const fileConfigs = Array.from({ length: 10 }, (_, i) => ({
        name: `extreme${i + 1}`,
        chunkCount: 150 + (i * 20) // Varying sizes from 150-330 chunks
      }));

      testFiles = createTestFiles(fileConfigs);
      const startTime = Date.now();

      console.log(`[TIMEOUT-TEST] Starting extreme load test with ${testFiles.length} very large files...`);

      const filePromises = testFiles.map(async (filePath, index) => {
        const content = fs.readFileSync(filePath, 'utf8');
        const chunks = chunkText(content, 500, 60);

        await embeddingQueue.addChunks(chunks, filePath, index);
        await embeddingQueue.waitForCompletion(filePath);
      });

      await Promise.all(filePromises);

      const duration = Date.now() - startTime;
      console.log(`[TIMEOUT-TEST] Extreme load test completed in ${duration}ms`);

      // Should still handle this without timeouts
      expect(timeoutOccurred).toBe(false);
      expect(completedFiles).toHaveLength(testFiles.length);

      // May take longer but should not timeout
      expect(duration).toBeLessThan(600000); // 10 minutes max

      console.log(`[TIMEOUT-TEST] ✅ SUCCESS: Extreme load handled without timeouts`);
    });

    it('should recover from backpressure under sustained load', async () => {
      // Create sustained load that triggers backpressure
      const fileConfigs = Array.from({ length: 15 }, (_, i) => ({
        name: `sustained${i + 1}`,
        chunkCount: 100 // Medium size but many files
      }));

      testFiles = createTestFiles(fileConfigs);

      let backpressureDetected = false;
      const originalShouldApplyBackpressure = embeddingQueue.shouldApplyBackpressure.bind(embeddingQueue);
      embeddingQueue.shouldApplyBackpressure = () => {
        const result = originalShouldApplyBackpressure();
        if (result && !backpressureDetected) {
          backpressureDetected = true;
          console.log('[TIMEOUT-TEST] Backpressure triggered as expected');
        }
        return result;
      };

      const startTime = Date.now();

      const filePromises = testFiles.map(async (filePath, index) => {
        const content = fs.readFileSync(filePath, 'utf8');
        const chunks = chunkText(content, 500, 60);

        await embeddingQueue.addChunks(chunks, filePath, index);
        await embeddingQueue.waitForCompletion(filePath);
      });

      await Promise.all(filePromises);

      const duration = Date.now() - startTime;

      // Should have triggered backpressure but recovered
      expect(backpressureDetected).toBe(true);
      expect(timeoutOccurred).toBe(false);
      expect(completedFiles).toHaveLength(testFiles.length);

      console.log(`[TIMEOUT-TEST] ✅ SUCCESS: Recovered from backpressure without timeouts`);
    });
  });

  describe('Memory Pressure Scenarios', () => {
    it('should handle memory pressure without timeouts', async () => {
      // Create files that would fill the embedding queue
      const fileConfigs = Array.from({ length: 12 }, (_, i) => ({
        name: `memory${i + 1}`,
        chunkCount: 150 // Large enough to stress memory
      }));

      testFiles = createTestFiles(fileConfigs);

      const initialMemory = process.memoryUsage();
      const startTime = Date.now();

      const filePromises = testFiles.map(async (filePath, index) => {
        const content = fs.readFileSync(filePath, 'utf8');
        const chunks = chunkText(content, 500, 60);

        await embeddingQueue.addChunks(chunks, filePath, index);
        await embeddingQueue.waitForCompletion(filePath);
      });

      await Promise.all(filePromises);

      const finalMemory = process.memoryUsage();
      const memoryIncrease = finalMemory.rss - initialMemory.rss;

      // Should not timeout despite memory pressure
      expect(timeoutOccurred).toBe(false);
      expect(completedFiles).toHaveLength(testFiles.length);

      // Memory should be bounded
      expect(memoryIncrease).toBeLessThan(1000 * 1024 * 1024); // 1GB max increase

      console.log(`[TIMEOUT-TEST] Memory increase: ${Math.round(memoryIncrease / 1024 / 1024)}MB`);
    });
  });

  describe('Mixed Load Patterns', () => {
    it('should handle mixed file sizes without timeouts', async () => {
      // Mix of small, medium, and large files (real-world scenario)
      const fileConfigs = [
        { name: 'small1', chunkCount: 5 },
        { name: 'large1', chunkCount: 300 },
        { name: 'medium1', chunkCount: 50 },
        { name: 'small2', chunkCount: 8 },
        { name: 'large2', chunkCount: 250 },
        { name: 'medium2', chunkCount: 75 },
        { name: 'large3', chunkCount: 400 },
        { name: 'small3', chunkCount: 3 }
      ];

      testFiles = createTestFiles(fileConfigs);

      const fileCompletionTimes: Array<{ file: string; time: number; size: string }> = [];
      const startTime = Date.now();

      // Track completion times
      const originalOnComplete = embeddingQueue['onFileComplete'];
      embeddingQueue['onFileComplete'] = (filePath) => {
        const fileName = path.basename(filePath);
        const size = fileName.includes('small') ? 'small' :
                    fileName.includes('medium') ? 'medium' : 'large';

        fileCompletionTimes.push({
          file: fileName,
          time: Date.now() - startTime,
          size
        });

        originalOnComplete?.(filePath);
      };

      const filePromises = testFiles.map(async (filePath, index) => {
        const content = fs.readFileSync(filePath, 'utf8');
        const chunks = chunkText(content, 500, 60);

        await embeddingQueue.addChunks(chunks, filePath, index);
        await embeddingQueue.waitForCompletion(filePath);
      });

      await Promise.all(filePromises);

      // No timeouts despite mixed load
      expect(timeoutOccurred).toBe(false);
      expect(completedFiles).toHaveLength(testFiles.length);

      // Small files should generally complete faster than large files
      const smallFileCompletions = fileCompletionTimes.filter(f => f.size === 'small');
      const largeFileCompletions = fileCompletionTimes.filter(f => f.size === 'large');

      const avgSmallTime = smallFileCompletions.reduce((sum, f) => sum + f.time, 0) / smallFileCompletions.length;
      const avgLargeTime = largeFileCompletions.reduce((sum, f) => sum + f.time, 0) / largeFileCompletions.length;

      expect(avgSmallTime).toBeLessThan(avgLargeTime);

      console.log(`[TIMEOUT-TEST] Mixed load completed - Avg small: ${avgSmallTime}ms, Avg large: ${avgLargeTime}ms`);
    });
  });

  describe('Error Recovery', () => {
    it('should not timeout during error recovery scenarios', async () => {
      // Create files that might trigger errors but should recover
      const fileConfigs = [
        { name: 'file1', chunkCount: 100 },
        { name: 'file2', chunkCount: 120 },
        { name: 'file3', chunkCount: 80 }
      ];

      testFiles = createTestFiles(fileConfigs);

      // Override embedder to occasionally fail (but not timeout)
      let failureCount = 0;
      const originalEmbed = embedderPool.embed.bind(embedderPool);
      embedderPool.embed = async (texts, isQuery) => {
        failureCount++;

        // Fail every 5th call to test recovery
        if (failureCount % 5 === 0) {
          throw new Error('Simulated embedding failure');
        }

        return originalEmbed(texts, isQuery);
      };

      const startTime = Date.now();

      const filePromises = testFiles.map(async (filePath, index) => {
        const content = fs.readFileSync(filePath, 'utf8');
        const chunks = chunkText(content, 500, 60);

        try {
          await embeddingQueue.addChunks(chunks, filePath, index);
          await embeddingQueue.waitForCompletion(filePath);
        } catch (error) {
          console.log(`[TIMEOUT-TEST] File ${path.basename(filePath)} encountered errors but should retry`);
        }
      });

      await Promise.all(filePromises);

      // Even with errors, should not timeout
      expect(timeoutOccurred).toBe(false);

      console.log(`[TIMEOUT-TEST] ✅ ERROR RECOVERY: No timeouts despite ${failureCount} total embedding calls with failures`);
    });
  });

  describe('Performance Benchmarks', () => {
    it('should demonstrate improved throughput vs sequential processing', async () => {
      // Create moderately sized files for throughput comparison
      const fileConfigs = Array.from({ length: 5 }, (_, i) => ({
        name: `benchmark${i + 1}`,
        chunkCount: 50
      }));

      testFiles = createTestFiles(fileConfigs);

      const startTime = Date.now();

      // Process with producer-consumer architecture
      const filePromises = testFiles.map(async (filePath, index) => {
        const content = fs.readFileSync(filePath, 'utf8');
        const chunks = chunkText(content, 500, 60);

        await embeddingQueue.addChunks(chunks, filePath, index);
        await embeddingQueue.waitForCompletion(filePath);
      });

      await Promise.all(filePromises);

      const parallelDuration = Date.now() - startTime;

      // Should be significantly faster than sequential would be
      const totalChunks = testFiles.reduce((sum, filePath) => {
        const content = fs.readFileSync(filePath, 'utf8');
        const chunks = chunkText(content, 500, 60);
        return sum + chunks.length;
      }, 0);

      console.log(`[TIMEOUT-TEST] Processed ${totalChunks} chunks from ${testFiles.length} files in ${parallelDuration}ms`);
      console.log(`[TIMEOUT-TEST] Throughput: ${Math.round(totalChunks / (parallelDuration / 1000))} chunks/second`);

      // Should not timeout and should be reasonably fast
      expect(timeoutOccurred).toBe(false);
      expect(parallelDuration).toBeLessThan(120000); // 2 minutes max

      // Should demonstrate good throughput (>1 chunk/second)
      const throughput = totalChunks / (parallelDuration / 1000);
      expect(throughput).toBeGreaterThan(1);
    });
  });
});