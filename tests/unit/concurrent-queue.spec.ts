import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ConcurrentQueue } from '../../src/main/worker/ConcurrentQueue';

describe('ConcurrentQueue', () => {
  let queue: ConcurrentQueue;
  let processedFiles: string[] = [];
  let processingSnapshots: number[] = [];

  beforeEach(() => {
    queue = new ConcurrentQueue({
      maxConcurrent: 5,
      memoryThresholdMB: 800,
      throttledConcurrent: 2
    });
    processedFiles = [];
    processingSnapshots = [];
  });

  describe('Basic Queue Operations', () => {
    it('should add files to queue', () => {
      queue.add(['file1.txt', 'file2.txt']);
      expect(queue.getStats().queued).toBe(2);
    });

    it('should add single file to queue', () => {
      queue.add('file1.txt');
      expect(queue.getStats().queued).toBe(1);
    });

    it('should remove files from queue', () => {
      queue.add(['file1.txt', 'file2.txt', 'file3.txt']);
      const removed = queue.remove('file2.txt');
      expect(removed).toBe(true);
      expect(queue.getStats().queued).toBe(2);
    });

    it('should return false when removing non-existent file', () => {
      queue.add(['file1.txt']);
      const removed = queue.remove('file2.txt');
      expect(removed).toBe(false);
    });

    it('should clear all queues', () => {
      queue.add(['file1.txt', 'file2.txt']);
      queue.clear();
      expect(queue.getStats().queued).toBe(0);
      expect(queue.getStats().processing).toBe(0);
    });
  });

  describe('Concurrent Processing', () => {
    it('should process files concurrently up to max limit', async () => {
      const files = Array.from({ length: 10 }, (_, i) => `file${i}.txt`);
      queue.add(files);

      let maxProcessing = 0;
      const handler = async (file: string) => {
        const currentProcessing = queue.getStats().processing;
        maxProcessing = Math.max(maxProcessing, currentProcessing);
        await new Promise(r => setTimeout(r, 50));
        processedFiles.push(file);
      };

      const startTime = Date.now();
      await queue.process(handler);
      const duration = Date.now() - startTime;

      expect(processedFiles).toHaveLength(10);
      expect(maxProcessing).toBe(5);
      // Should be faster than sequential (10 * 50 = 500ms)
      expect(duration).toBeLessThan(300);
    });

    it('should never exceed max concurrent limit', async () => {
      const files = Array.from({ length: 20 }, (_, i) => `file${i}.txt`);
      queue.add(files);

      const processingCounts: number[] = [];
      const handler = async (file: string) => {
        processingCounts.push(queue.getStats().processing);
        await new Promise(r => setTimeout(r, 30));
        processedFiles.push(file);
      };

      await queue.process(handler);

      const maxProcessing = Math.max(...processingCounts);
      expect(maxProcessing).toBeLessThanOrEqual(5);
      expect(processedFiles).toHaveLength(20);
    });

    it('should process files in FIFO order', async () => {
      const files = ['first.txt', 'second.txt', 'third.txt'];
      queue.add(files);

      const startOrder: string[] = [];
      const handler = async (file: string) => {
        startOrder.push(file);
        await new Promise(r => setTimeout(r, 10));
      };

      await queue.process(handler);
      expect(startOrder).toEqual(files);
    });
  });

  describe('Memory-based Throttling', () => {
    it('should throttle when memory exceeds threshold', async () => {
      const files = Array.from({ length: 15 }, (_, i) => `file${i}.txt`);
      queue.add(files);

      let memoryMB = 500;
      let throttleTriggered = false;
      
      const queueWithCallback = new ConcurrentQueue({
        maxConcurrent: 5,
        memoryThresholdMB: 800,
        throttledConcurrent: 2,
        onMemoryThrottle: (newLimit, memory) => {
          // Only check when throttling occurs (newLimit = 2)
          if (newLimit === 2) {
            throttleTriggered = true;
            expect(memory).toBeGreaterThan(800);
          }
        }
      });
      
      queueWithCallback.add(files);

      const handler = async (file: string) => {
        // Simulate memory increase after 5 files
        if (processedFiles.length === 5) {
          memoryMB = 850;
        }
        await new Promise(r => setTimeout(r, 20));
        processedFiles.push(file);
      };

      await queueWithCallback.process(handler, () => memoryMB);
      
      expect(throttleTriggered).toBe(true);
      expect(processedFiles).toHaveLength(15);
    });

    it('should restore concurrency when memory drops', async () => {
      const files = Array.from({ length: 20 }, (_, i) => `file${i}.txt`);
      
      let memoryMB = 850; // Start high
      const concurrencyChanges: number[] = [];
      
      const queueWithCallback = new ConcurrentQueue({
        maxConcurrent: 5,
        memoryThresholdMB: 800,
        throttledConcurrent: 2,
        onMemoryThrottle: (newLimit) => {
          concurrencyChanges.push(newLimit);
        }
      });
      
      queueWithCallback.add(files);

      let filesStarted = 0;
      const handler = async (file: string) => {
        filesStarted++;
        // Drop memory after 5 files have started processing
        if (filesStarted === 5) {
          memoryMB = 500;
        }
        await new Promise(r => setTimeout(r, 30));
        processedFiles.push(file);
      };

      await queueWithCallback.process(handler, () => memoryMB);
      
      // Should see throttle to 2, then restore to 5
      expect(concurrencyChanges).toContain(2);
      expect(concurrencyChanges).toContain(5);
      expect(processedFiles).toHaveLength(20);
    });
  });

  describe('Pause and Resume', () => {
    it('should pause and resume processing', async () => {
      const files = Array.from({ length: 10 }, (_, i) => `file${i}.txt`);
      queue.add(files);

      let isPaused = false;
      const handler = async (file: string) => {
        if (processedFiles.length === 3 && !isPaused) {
          queue.pause();
          isPaused = true;
          // Resume after delay
          setTimeout(() => queue.resume(), 100);
        }
        await new Promise(r => setTimeout(r, 20));
        processedFiles.push(file);
      };

      const startTime = Date.now();
      await queue.process(handler);
      const duration = Date.now() - startTime;

      expect(processedFiles).toHaveLength(10);
      // Should take longer due to pause
      expect(duration).toBeGreaterThan(100);
    });
  });

  describe('Error Handling', () => {
    it('should continue processing after errors', async () => {
      const files = ['good1.txt', 'bad.txt', 'good2.txt'];
      queue.add(files);

      const handler = async (file: string) => {
        if (file === 'bad.txt') {
          throw new Error('Processing failed');
        }
        await new Promise(r => setTimeout(r, 10));
        processedFiles.push(file);
      };

      await queue.process(handler);

      expect(processedFiles).toEqual(['good1.txt', 'good2.txt']);
      const stats = queue.getStats();
      expect(stats.completed).toBe(2);
      expect(stats.failed).toBe(1);
    });

    it('should handle multiple concurrent errors', async () => {
      const files = Array.from({ length: 10 }, (_, i) => 
        i % 2 === 0 ? `good${i}.txt` : `bad${i}.txt`
      );
      queue.add(files);

      const handler = async (file: string) => {
        if (file.includes('bad')) {
          throw new Error(`Failed: ${file}`);
        }
        await new Promise(r => setTimeout(r, 20));
        processedFiles.push(file);
      };

      await queue.process(handler);

      expect(processedFiles).toHaveLength(5);
      const stats = queue.getStats();
      expect(stats.completed).toBe(5);
      expect(stats.failed).toBe(5);
    });
  });

  describe('Progress Callbacks', () => {
    it('should report progress during processing', async () => {
      const files = Array.from({ length: 5 }, (_, i) => `file${i}.txt`);
      const progressReports: Array<{queued: number, processing: number}> = [];

      const queueWithProgress = new ConcurrentQueue({
        maxConcurrent: 2,
        onProgress: (queued, processing) => {
          progressReports.push({ queued, processing });
        }
      });

      queueWithProgress.add(files);

      const handler = async (file: string) => {
        await new Promise(r => setTimeout(r, 30));
      };

      await queueWithProgress.process(handler);

      // Should have multiple progress reports
      expect(progressReports.length).toBeGreaterThan(0);
      
      // First report should show files queued
      const firstReport = progressReports[0];
      expect(firstReport.queued).toBeGreaterThan(0);
      
      // Last report should show no files left
      const lastReport = progressReports[progressReports.length - 1];
      expect(lastReport.queued).toBe(0);
      expect(lastReport.processing).toBe(0);
    });
  });

  describe('Performance', () => {
    it('should demonstrate speedup over sequential processing', async () => {
      const files = Array.from({ length: 20 }, (_, i) => `file${i}.txt`);
      const processTime = 30; // ms per file

      // Test concurrent
      const concurrentQueue = new ConcurrentQueue({ maxConcurrent: 5 });
      concurrentQueue.add([...files]);
      
      const concurrentStart = Date.now();
      await concurrentQueue.process(async () => {
        await new Promise(r => setTimeout(r, processTime));
      });
      const concurrentDuration = Date.now() - concurrentStart;

      // Test sequential
      const sequentialQueue = new ConcurrentQueue({ maxConcurrent: 1 });
      sequentialQueue.add([...files]);
      
      const sequentialStart = Date.now();
      await sequentialQueue.process(async () => {
        await new Promise(r => setTimeout(r, processTime));
      });
      const sequentialDuration = Date.now() - sequentialStart;

      const speedup = sequentialDuration / concurrentDuration;
      
      // Should be approximately 5x faster (allowing for overhead)
      expect(speedup).toBeGreaterThan(3);
      expect(speedup).toBeLessThanOrEqual(5.5);
      
      console.log(`Speedup: ${speedup.toFixed(2)}x (${sequentialDuration}ms → ${concurrentDuration}ms)`);
    });
  });

  describe('Edge Cases', () => {
    it('should handle empty queue', async () => {
      const handler = vi.fn();
      await queue.process(handler);
      expect(handler).not.toHaveBeenCalled();
    });

    it('should handle duplicate files in queue', async () => {
      queue.add(['file1.txt', 'file2.txt', 'file1.txt']);
      
      const handler = async (file: string) => {
        await new Promise(r => setTimeout(r, 10));
        processedFiles.push(file);
      };

      await queue.process(handler);
      
      // Should process all files including duplicates
      expect(processedFiles).toHaveLength(3);
      expect(processedFiles.filter(f => f === 'file1.txt')).toHaveLength(2);
    });

    it('should prevent processing same file simultaneously', async () => {
      // This tests that if somehow the same file is in queue twice,
      // it won't be processed simultaneously
      queue.add(['file1.txt', 'file1.txt', 'file2.txt']);
      
      const simultaneousFiles = new Set<string>();
      let collision = false;
      
      const handler = async (file: string) => {
        if (simultaneousFiles.has(file)) {
          collision = true;
        }
        simultaneousFiles.add(file);
        await new Promise(r => setTimeout(r, 20));
        simultaneousFiles.delete(file);
        processedFiles.push(file);
      };

      await queue.process(handler);
      
      expect(collision).toBe(false);
      expect(processedFiles).toHaveLength(3);
    });
  });
});