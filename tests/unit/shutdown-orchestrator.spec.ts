import { describe, it, expect, vi, beforeEach } from 'vitest';
import { performGracefulShutdown } from '../../src/main/worker/shutdown/orchestrator';
import type { ShutdownDependencies, ShutdownOptions } from '../../src/main/worker/shutdown/types';

describe('performGracefulShutdown', () => {
  let mockDeps: ShutdownDependencies;

  beforeEach(() => {
    // Create fresh mocks for each test
    mockDeps = {
      watcher: { close: vi.fn().mockResolvedValue(undefined) },
      fileQueue: { getStats: vi.fn().mockReturnValue({ processing: 0 }) },
      embeddingQueue: { getStats: vi.fn().mockReturnValue({ queueDepth: 0, processingBatches: 0 }) },
      writeQueueState: { writeQueue: [], isWriting: false },
      sidecarEmbedder: { shutdown: vi.fn().mockResolvedValue(undefined) },
      sidecarService: { stopSidecar: vi.fn().mockResolvedValue(undefined) },
      db: { close: vi.fn().mockResolvedValue(undefined) },
      healthCheckInterval: setInterval(() => {}, 1000) as NodeJS.Timeout,
      memoryMonitorInterval: setInterval(() => {}, 1000) as NodeJS.Timeout,
      isProcessingActive: false,
      profiler: {
        isEnabled: vi.fn().mockReturnValue(false),
        saveReport: vi.fn().mockResolvedValue(undefined)
      }
    };
  });

  it('should successfully complete all shutdown steps', async () => {
    const result = await performGracefulShutdown(mockDeps, {
      pollIntervalMs: 10,
      embeddingQueueTimeoutMs: 1000,
      writeQueueTimeoutMs: 1000
    });

    expect(result.success).toBe(true);
    expect(result.steps).toHaveLength(9); // All steps except profiling (not enabled)

    // Verify all critical steps succeeded
    const stepNames = result.steps.map(s => s.step);
    expect(stepNames).toContain('close_watcher');
    expect(stepNames).toContain('file_queue_drain');
    expect(stepNames).toContain('embedding_queue_drain');
    expect(stepNames).toContain('write_queue_drain');
    expect(stepNames).toContain('clear_health_check');
    expect(stepNames).toContain('clear_memory_monitor');
    expect(stepNames).toContain('sidecar_embedder_shutdown');
    expect(stepNames).toContain('sidecar_service_stop');
    expect(stepNames).toContain('database_close');

    // Verify all steps succeeded
    expect(result.steps.every(s => s.success)).toBe(true);

    // Verify shutdown methods were called
    expect(mockDeps.watcher!.close).toHaveBeenCalled();
    expect(mockDeps.sidecarEmbedder!.shutdown).toHaveBeenCalled();
    expect(mockDeps.sidecarService!.stopSidecar).toHaveBeenCalled();
    expect(mockDeps.db!.close).toHaveBeenCalled();
  });

  it('should handle watcher close error', async () => {
    mockDeps.watcher!.close = vi.fn().mockRejectedValue(new Error('Watcher error'));

    const result = await performGracefulShutdown(mockDeps, {
      pollIntervalMs: 10
    });

    expect(result.success).toBe(false);
    const watcherStep = result.steps.find(s => s.step === 'close_watcher');
    expect(watcherStep?.success).toBe(false);
    expect(watcherStep?.error).toBe('Watcher error');
  });

  it('should wait indefinitely for file queue (no timeout)', async () => {
    // File queue has no timeout - waits indefinitely until drained
    // Start with queue already empty to verify no-timeout behavior doesn't hang
    mockDeps.fileQueue.getStats = vi.fn().mockReturnValue({ processing: 0 });
    mockDeps.isProcessingActive = false;

    const result = await performGracefulShutdown(mockDeps, {
      pollIntervalMs: 10,
      embeddingQueueTimeoutMs: 100,
      writeQueueTimeoutMs: 100
    });

    expect(result.success).toBe(true);
    const fileQueueStep = result.steps.find(s => s.step === 'file_queue_drain');
    expect(fileQueueStep?.success).toBe(true);
    expect(fileQueueStep?.timedOut).toBe(false);
  });

  it('should handle file queue that eventually drains', async () => {
    let callCount = 0;

    // Mock getStats to drain after a few calls
    mockDeps.fileQueue.getStats = vi.fn().mockImplementation(() => {
      callCount++;
      // Drain after 3 calls
      return { processing: callCount < 3 ? 1 : 0 };
    });

    // Create a dependency object with getter for isProcessingActive
    const dynamicDeps = {
      ...mockDeps,
      get isProcessingActive() {
        // Active while processing > 0
        return callCount < 3;
      }
    };

    const result = await performGracefulShutdown(dynamicDeps as any, {
      pollIntervalMs: 10
    });

    expect(result.success).toBe(true);
    const fileQueueStep = result.steps.find(s => s.step === 'file_queue_drain');
    expect(fileQueueStep?.success).toBe(true);
  });

  it('should handle embedding queue drain timeout', async () => {
    // Embedding queue never drains
    mockDeps.embeddingQueue!.getStats = vi.fn().mockReturnValue({
      queueDepth: 10,
      processingBatches: 2
    });

    const result = await performGracefulShutdown(mockDeps, {
      pollIntervalMs: 10,
      embeddingQueueTimeoutMs: 100,
      writeQueueTimeoutMs: 1000
    });

    expect(result.success).toBe(false);
    const embeddingStep = result.steps.find(s => s.step === 'embedding_queue_drain');
    expect(embeddingStep?.success).toBe(false);
    expect(embeddingStep?.timedOut).toBe(true);

    // Should continue with other steps despite timeout
    const dbStep = result.steps.find(s => s.step === 'database_close');
    expect(dbStep?.success).toBe(true);
  });

  it('should handle write queue drain timeout', async () => {
    // Write queue never drains
    mockDeps.writeQueueState.writeQueue = [{ /* some item */ }] as any[];
    mockDeps.writeQueueState.isWriting = true;

    const result = await performGracefulShutdown(mockDeps, {
      pollIntervalMs: 10,
      embeddingQueueTimeoutMs: 1000,
      writeQueueTimeoutMs: 100
    });

    expect(result.success).toBe(false);
    const writeStep = result.steps.find(s => s.step === 'write_queue_drain');
    expect(writeStep?.success).toBe(false);
    expect(writeStep?.timedOut).toBe(true);

    // Should continue with other steps despite timeout
    const dbStep = result.steps.find(s => s.step === 'database_close');
    expect(dbStep?.success).toBe(true);
  });

  it('should generate profiling report when enabled', async () => {
    mockDeps.profiler!.isEnabled = vi.fn().mockReturnValue(true);

    const result = await performGracefulShutdown(mockDeps, {
      pollIntervalMs: 10,
      enableProfiling: true
    });

    expect(result.success).toBe(true);
    const profilingStep = result.steps.find(s => s.step === 'profiling_report');
    expect(profilingStep?.success).toBe(true);
    expect(mockDeps.profiler!.saveReport).toHaveBeenCalled();
  });

  it('should handle profiling report error as non-critical', async () => {
    mockDeps.profiler!.isEnabled = vi.fn().mockReturnValue(true);
    mockDeps.profiler!.saveReport = vi.fn().mockRejectedValue(new Error('Profiling error'));

    const result = await performGracefulShutdown(mockDeps, {
      pollIntervalMs: 10,
      enableProfiling: true
    });

    // Profiling error should not fail the shutdown
    expect(result.success).toBe(true);
    const profilingStep = result.steps.find(s => s.step === 'profiling_report');
    expect(profilingStep?.success).toBe(false);
    expect(profilingStep?.error).toBe('Profiling error');

    // Other steps should still succeed
    const dbStep = result.steps.find(s => s.step === 'database_close');
    expect(dbStep?.success).toBe(true);
  });

  it('should handle sidecar embedder shutdown error', async () => {
    mockDeps.sidecarEmbedder!.shutdown = vi.fn().mockRejectedValue(new Error('Embedder error'));

    const result = await performGracefulShutdown(mockDeps, {
      pollIntervalMs: 10
    });

    expect(result.success).toBe(false);
    const sidecarStep = result.steps.find(s => s.step === 'sidecar_embedder_shutdown');
    expect(sidecarStep?.success).toBe(false);
    expect(sidecarStep?.error).toBe('Embedder error');

    // Database should still close
    const dbStep = result.steps.find(s => s.step === 'database_close');
    expect(dbStep?.success).toBe(true);
  });

  it('should handle sidecar service stop error', async () => {
    mockDeps.sidecarService!.stopSidecar = vi.fn().mockRejectedValue(new Error('Service error'));

    const result = await performGracefulShutdown(mockDeps, {
      pollIntervalMs: 10
    });

    expect(result.success).toBe(false);
    const serviceStep = result.steps.find(s => s.step === 'sidecar_service_stop');
    expect(serviceStep?.success).toBe(false);
    expect(serviceStep?.error).toBe('Service error');
  });

  it('should handle database close error', async () => {
    mockDeps.db!.close = vi.fn().mockRejectedValue(new Error('Database error'));

    const result = await performGracefulShutdown(mockDeps, {
      pollIntervalMs: 10
    });

    expect(result.success).toBe(false);
    const dbStep = result.steps.find(s => s.step === 'database_close');
    expect(dbStep?.success).toBe(false);
    expect(dbStep?.error).toBe('Database error');
  });

  it('should handle missing optional dependencies', async () => {
    const minimalDeps: ShutdownDependencies = {
      watcher: null,
      fileQueue: { getStats: vi.fn().mockReturnValue({ processing: 0 }) },
      embeddingQueue: null,
      writeQueueState: { writeQueue: [], isWriting: false },
      sidecarEmbedder: null,
      sidecarService: null,
      db: null,
      healthCheckInterval: null,
      memoryMonitorInterval: null,
      isProcessingActive: false
    };

    const result = await performGracefulShutdown(minimalDeps, {
      pollIntervalMs: 10
    });

    expect(result.success).toBe(true);
    // Should only have file queue and write queue drain steps
    expect(result.steps.length).toBeGreaterThanOrEqual(2);
  });

  it('should call onProgress callback for each step', async () => {
    const progressCalls: Array<{ step: string; details: any }> = [];

    const result = await performGracefulShutdown(mockDeps, {
      pollIntervalMs: 10,
      onProgress: (step, details) => {
        progressCalls.push({ step, details });
      }
    });

    expect(result.success).toBe(true);
    expect(progressCalls.length).toBeGreaterThan(0);

    // Should have progress for various steps
    const stepNames = progressCalls.map(c => c.step);
    expect(stepNames).toContain('close_watcher');
    expect(stepNames).toContain('clear_memory_monitor');
  });

  it('should report progress for embedding queue wait', async () => {
    let queueDepth = 5;
    mockDeps.embeddingQueue!.getStats = vi.fn().mockImplementation(() => ({
      queueDepth,
      processingBatches: queueDepth > 0 ? 1 : 0
    }));

    const progressCalls: Array<{ step: string; details: any }> = [];

    const result = await performGracefulShutdown(mockDeps, {
      pollIntervalMs: 10,
      embeddingQueueTimeoutMs: 1000,
      onProgress: (step, details) => {
        progressCalls.push({ step, details });
        if (step === 'embedding_queue_wait' && queueDepth > 0) {
          queueDepth--;
        }
      }
    });

    expect(result.success).toBe(true);
    const embeddingProgressCalls = progressCalls.filter(c => c.step === 'embedding_queue_wait');
    expect(embeddingProgressCalls.length).toBeGreaterThan(0);
  });

  it('should report progress for write queue wait', async () => {
    const writeQueue = [1, 2, 3] as any[];
    mockDeps.writeQueueState.writeQueue = writeQueue;
    mockDeps.writeQueueState.isWriting = true;

    const progressCalls: Array<{ step: string; details: any }> = [];

    const result = await performGracefulShutdown(mockDeps, {
      pollIntervalMs: 10,
      writeQueueTimeoutMs: 1000,
      onProgress: (step, details) => {
        progressCalls.push({ step, details });
        if (step === 'write_queue_wait') {
          if (writeQueue.length > 0) {
            writeQueue.shift();
          } else {
            mockDeps.writeQueueState.isWriting = false;
          }
        }
      }
    });

    expect(result.success).toBe(true);
    const writeProgressCalls = progressCalls.filter(c => c.step === 'write_queue_wait');
    expect(writeProgressCalls.length).toBeGreaterThan(0);

    // Should report queue length in progress
    expect(writeProgressCalls[0].details).toHaveProperty('queueLength');
    expect(writeProgressCalls[0].details).toHaveProperty('isWriting');
  });

  it('should clear intervals even if other steps fail', async () => {
    mockDeps.db!.close = vi.fn().mockRejectedValue(new Error('DB error'));

    const result = await performGracefulShutdown(mockDeps, {
      pollIntervalMs: 10
    });

    expect(result.success).toBe(false);

    // Intervals should still be cleared
    const healthCheckStep = result.steps.find(s => s.step === 'clear_health_check');
    const memoryMonitorStep = result.steps.find(s => s.step === 'clear_memory_monitor');
    expect(healthCheckStep?.success).toBe(true);
    expect(memoryMonitorStep?.success).toBe(true);
  });

  it('should return detailed step results', async () => {
    const result = await performGracefulShutdown(mockDeps, {
      pollIntervalMs: 10
    });

    expect(result.success).toBe(true);
    expect(result.steps).toBeDefined();

    // Each step should have required fields
    result.steps.forEach(step => {
      expect(step).toHaveProperty('step');
      expect(step).toHaveProperty('success');
      expect(typeof step.step).toBe('string');
      expect(typeof step.success).toBe('boolean');
    });
  });

  it('should close database last after all queues drain', async () => {
    const callOrder: string[] = [];

    mockDeps.watcher!.close = vi.fn().mockImplementation(async () => {
      callOrder.push('watcher');
    });
    mockDeps.sidecarEmbedder!.shutdown = vi.fn().mockImplementation(async () => {
      callOrder.push('sidecar');
    });
    mockDeps.db!.close = vi.fn().mockImplementation(async () => {
      callOrder.push('database');
    });

    await performGracefulShutdown(mockDeps, {
      pollIntervalMs: 10
    });

    // Database should be closed last
    expect(callOrder.indexOf('database')).toBeGreaterThan(callOrder.indexOf('watcher'));
    expect(callOrder.indexOf('database')).toBeGreaterThan(callOrder.indexOf('sidecar'));
  });
});
