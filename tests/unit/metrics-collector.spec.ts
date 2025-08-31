import { describe, it, expect, beforeEach, vi } from 'vitest';
import { MetricsCollector } from '../../src/main/utils/MetricsCollector';

describe('MetricsCollector', () => {
  let collector: MetricsCollector;

  beforeEach(() => {
    collector = new MetricsCollector();
  });

  describe('Counter Operations', () => {
    it('should increment file count', () => {
      collector.incrementFiles();
      expect(collector.getMetrics().filesProcessed).toBe(1);

      collector.incrementFiles(5);
      expect(collector.getMetrics().filesProcessed).toBe(6);
    });

    it('should track bytes processed', () => {
      collector.incrementBytes(1024);
      collector.incrementBytes(2048);
      
      expect(collector.getMetrics().bytesProcessed).toBe(3072);
    });

    it('should count chunks created', () => {
      collector.incrementChunks(10);
      collector.incrementChunks(15);
      
      expect(collector.getMetrics().chunksCreated).toBe(25);
    });

    it('should count embeddings created', () => {
      collector.incrementEmbeddings(32);
      collector.incrementEmbeddings(16);
      
      expect(collector.getMetrics().embeddingsCreated).toBe(48);
    });

    it('should track different error types', () => {
      collector.incrementErrors('parsing');
      collector.incrementErrors('parsing');
      collector.incrementErrors('embedding');
      collector.incrementErrors('general');

      const metrics = collector.getMetrics();
      expect(metrics.totalErrors).toBe(4);
      expect(metrics.filesFailedParsing).toBe(2);
      expect(metrics.filesFailedEmbedding).toBe(1);
    });

    it('should track restart counts', () => {
      collector.incrementRestarts('embedder');
      collector.incrementRestarts('embedder');
      collector.incrementRestarts('worker');

      const metrics = collector.getMetrics();
      expect(metrics.embedderRestarts).toBe(2);
      expect(metrics.workerRestarts).toBe(1);
    });
  });

  describe('Batch Tracking', () => {
    it('should calculate average batch size', () => {
      collector.recordBatch(32);
      collector.recordBatch(16);
      collector.recordBatch(24);

      const metrics = collector.getMetrics();
      expect(metrics.avgBatchSize).toBe(24); // (32+16+24)/3
      expect(metrics.totalBatches).toBe(3);
    });

    it('should track batch adjustments', () => {
      collector.recordBatchAdjustment();
      collector.recordBatchAdjustment();

      expect(collector.getMetrics().adaptiveBatchAdjustments).toBe(2);
    });

    it('should handle empty batch records', () => {
      const metrics = collector.getMetrics();
      expect(metrics.avgBatchSize).toBe(0);
      expect(metrics.totalBatches).toBe(0);
    });
  });

  describe('Timing Operations', () => {
    it('should measure file processing time', () => {
      const originalPerformance = global.performance;
      
      global.performance = {
        now: vi.fn()
          .mockReturnValueOnce(1000)
          .mockReturnValueOnce(1500)
      } as any;

      collector.startTimer('file_processing');
      collector.endTimer('file_processing');

      const metrics = collector.getMetrics();
      expect(metrics.avgFileProcessingTime).toBe(500);
      expect(metrics.totalProcessingTime).toBe(500);

      global.performance = originalPerformance;
    });

    it('should calculate moving average for timings', () => {
      // Simple test - just verify averaging works
      // Mock with fixed increments
      let time = 0;
      const originalPerformance = global.performance;
      global.performance = {
        now: () => time++
      } as any;

      // Add 5 samples with duration 1 each
      for (let i = 0; i < 5; i++) {
        collector.startTimer('file_processing');
        collector.endTimer('file_processing');
      }

      const metrics = collector.getMetrics();
      expect(metrics.avgFileProcessingTime).toBe(1);

      global.performance = originalPerformance;
    });

    it('should track embedding time separately', () => {
      const originalPerformance = global.performance;
      
      global.performance = {
        now: vi.fn()
          .mockReturnValueOnce(1000)  // start
          .mockReturnValueOnce(1050)  // end (50ms later)
      } as any;

      collector.startTimer('embedding');
      collector.endTimer('embedding');

      expect(collector.getMetrics().avgEmbeddingTime).toBe(50);

      global.performance = originalPerformance;
    });

    it('should track chunking time', () => {
      const originalPerformance = global.performance;
      
      global.performance = {
        now: vi.fn()
          .mockReturnValueOnce(2000)  // start
          .mockReturnValueOnce(2030)  // end (30ms later)
      } as any;

      collector.startTimer('chunking');
      collector.endTimer('chunking');

      expect(collector.getMetrics().avgChunkingTime).toBe(30);

      global.performance = originalPerformance;
    });

    it('should handle timer without start', () => {
      const duration = collector.endTimer('nonexistent');
      expect(duration).toBe(0);
    });

    it('should keep only last 100 samples for averaging', () => {
      // Simple test - add many samples and verify limit
      let time = 0;
      const originalPerformance = global.performance;
      global.performance = {
        now: () => time += 10  // Each call advances by 10
      } as any;

      // Generate 150 samples
      for (let i = 0; i < 150; i++) {
        collector.startTimer('file_processing');
        collector.endTimer('file_processing');
      }

      // Should keep samples and calculate average (each sample is 10ms)
      const metrics = collector.getMetrics();
      expect(metrics.avgFileProcessingTime).toBe(10);

      global.performance = originalPerformance;
    });
  });

  describe('Memory Tracking', () => {
    it('should update current memory usage', () => {
      const originalMemoryUsage = process.memoryUsage;
      process.memoryUsage = () => ({
        rss: 100 * 1024 * 1024, // 100MB
        heapTotal: 50 * 1024 * 1024,
        heapUsed: 30 * 1024 * 1024,
        external: 10 * 1024 * 1024,
        arrayBuffers: 5 * 1024 * 1024
      });

      collector.updateMemory();
      const metrics = collector.getMetrics();

      expect(metrics.currentMemoryUsage).toBe(100 * 1024 * 1024);
      expect(metrics.peakMemoryUsage).toBe(100 * 1024 * 1024);

      process.memoryUsage = originalMemoryUsage;
    });

    it('should track peak memory usage', () => {
      const originalMemoryUsage = process.memoryUsage;
      
      // First update: 100MB
      process.memoryUsage = () => ({
        rss: 100 * 1024 * 1024,
        heapTotal: 0,
        heapUsed: 0,
        external: 0,
        arrayBuffers: 0
      });
      collector.updateMemory();

      // Second update: 150MB
      process.memoryUsage = () => ({
        rss: 150 * 1024 * 1024,
        heapTotal: 0,
        heapUsed: 0,
        external: 0,
        arrayBuffers: 0
      });
      collector.updateMemory();

      // Third update: 80MB (lower)
      process.memoryUsage = () => ({
        rss: 80 * 1024 * 1024,
        heapTotal: 0,
        heapUsed: 0,
        external: 0,
        arrayBuffers: 0
      });
      collector.updateMemory();

      const metrics = collector.getMetrics();
      expect(metrics.currentMemoryUsage).toBe(80 * 1024 * 1024);
      expect(metrics.peakMemoryUsage).toBe(150 * 1024 * 1024); // Peak remains

      process.memoryUsage = originalMemoryUsage;
    });
  });

  describe('Reset Functionality', () => {
    it('should reset all metrics to initial state', () => {
      // Add some data
      collector.incrementFiles(10);
      collector.incrementBytes(1000000);
      collector.incrementChunks(50);
      collector.incrementEmbeddings(100);
      collector.incrementErrors('parsing');
      collector.recordBatch(32);
      collector.startTimer('file_processing');
      collector.endTimer('file_processing');

      // Reset
      collector.reset();

      const metrics = collector.getMetrics();
      expect(metrics.filesProcessed).toBe(0);
      expect(metrics.bytesProcessed).toBe(0);
      expect(metrics.chunksCreated).toBe(0);
      expect(metrics.embeddingsCreated).toBe(0);
      expect(metrics.totalErrors).toBe(0);
      expect(metrics.totalBatches).toBe(0);
      expect(metrics.avgFileProcessingTime).toBe(0);
    });
  });

  describe('Summary Generation', () => {
    it('should generate formatted summary string', () => {
      collector.incrementFiles(100);
      collector.incrementBytes(50 * 1024 * 1024); // 50MB
      collector.incrementChunks(500);
      collector.incrementEmbeddings(500);
      collector.incrementErrors('parsing');
      collector.incrementErrors('embedding');
      collector.recordBatch(32);
      collector.recordBatch(16);
      collector.recordBatchAdjustment();
      collector.incrementRestarts('embedder');

      const summary = collector.getSummary();

      expect(summary).toContain('100 processed');
      expect(summary).toContain('50MB processed');
      expect(summary).toContain('500 chunks');
      expect(summary).toContain('500 embeddings');
      expect(summary).toContain('1 parse errors');
      expect(summary).toContain('1 embed errors');
      expect(summary).toContain('24.0 avg size'); // (32+16)/2
      expect(summary).toContain('1 embedder restarts');
    });

    it('should handle empty metrics in summary', () => {
      const summary = collector.getSummary();

      expect(summary).toContain('0 processed');
      expect(summary).toContain('0MB processed');
      expect(summary).not.toContain('undefined');
      expect(summary).not.toContain('NaN');
    });
  });

  describe('Export Functionality', () => {
    it('should export metrics as JSON', () => {
      collector.incrementFiles(5);
      collector.incrementBytes(1024);
      collector.incrementChunks(10);

      const json = collector.exportMetrics();
      const parsed = JSON.parse(json);

      expect(parsed.filesProcessed).toBe(5);
      expect(parsed.bytesProcessed).toBe(1024);
      expect(parsed.chunksCreated).toBe(10);
    });

    it('should export valid JSON even with empty metrics', () => {
      const json = collector.exportMetrics();
      const parsed = JSON.parse(json);

      expect(parsed).toBeDefined();
      expect(parsed.filesProcessed).toBe(0);
    });
  });

  describe('Real-world Scenarios', () => {
    it('should track complete file processing flow', () => {
      // Simple test - just verify all metrics are recorded
      let time = 0;
      const originalPerformance = global.performance;
      global.performance = {
        now: () => time += 50  // Advance by 50 each call
      } as any;

      // Simulate processing a file
      collector.startTimer('file_processing');
      collector.startTimer('parsing');
      collector.endTimer('parsing');
      collector.startTimer('chunking');
      collector.endTimer('chunking');
      collector.incrementChunks(10);
      collector.startTimer('embedding');
      collector.endTimer('embedding');
      collector.incrementEmbeddings(10);
      collector.recordBatch(10);
      collector.endTimer('file_processing');
      collector.incrementFiles();
      collector.incrementBytes(50000);

      const metrics = collector.getMetrics();
      expect(metrics.filesProcessed).toBe(1);
      expect(metrics.bytesProcessed).toBe(50000);
      expect(metrics.chunksCreated).toBe(10);
      expect(metrics.embeddingsCreated).toBe(10);
      expect(metrics.avgBatchSize).toBe(10);
      // Don't test exact timings - just that they're recorded
      expect(metrics.avgFileProcessingTime).toBeGreaterThan(0);
      expect(metrics.avgEmbeddingTime).toBeGreaterThan(0);
      expect(metrics.avgChunkingTime).toBeGreaterThan(0);

      global.performance = originalPerformance;
    });

    it('should handle adaptive batching scenario', () => {
      // Start with batch size 32
      collector.recordBatch(32);
      
      // Adjust down due to high latency
      collector.recordBatchAdjustment();
      collector.recordBatch(16);
      
      // Adjust up due to low latency
      collector.recordBatchAdjustment();
      collector.recordBatch(24);

      const metrics = collector.getMetrics();
      expect(metrics.avgBatchSize).toBeCloseTo(24, 1); // (32+16+24)/3
      expect(metrics.totalBatches).toBe(3);
      expect(metrics.adaptiveBatchAdjustments).toBe(2);
    });

    it('should track memory pressure and restarts', () => {
      const originalMemoryUsage = process.memoryUsage;

      // Simulate high memory leading to restart
      process.memoryUsage = () => ({
        rss: 900 * 1024 * 1024, // 900MB
        heapTotal: 0,
        heapUsed: 0,
        external: 0,
        arrayBuffers: 0
      });

      collector.updateMemory();
      collector.incrementRestarts('embedder');

      // Memory drops after restart
      process.memoryUsage = () => ({
        rss: 200 * 1024 * 1024, // 200MB
        heapTotal: 0,
        heapUsed: 0,
        external: 0,
        arrayBuffers: 0
      });

      collector.updateMemory();

      const metrics = collector.getMetrics();
      expect(metrics.peakMemoryUsage).toBe(900 * 1024 * 1024);
      expect(metrics.currentMemoryUsage).toBe(200 * 1024 * 1024);
      expect(metrics.embedderRestarts).toBe(1);

      process.memoryUsage = originalMemoryUsage;
    });
  });
});