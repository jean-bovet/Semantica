import { describe, it, expect, vi } from 'vitest';
import { waitForQueueToDrain } from '../../src/main/worker/shutdown/queueDrainer';

describe('waitForQueueToDrain', () => {
  it('should return true when queue is already empty', async () => {
    const result = await waitForQueueToDrain({
      queueName: 'test_queue',
      getStats: () => ({ queueDepth: 0 }),
      isQueueEmpty: (stats) => stats.queueDepth === 0,
      timeoutMs: 1000,
      pollIntervalMs: 10
    });

    expect(result).toBe(true);
  });

  it('should return true when queue drains before timeout', async () => {
    let queueSize = 5;

    const result = await waitForQueueToDrain({
      queueName: 'test_queue',
      getStats: () => ({ queueDepth: queueSize }),
      isQueueEmpty: (stats) => stats.queueDepth === 0,
      timeoutMs: 1000,
      pollIntervalMs: 10,
      onProgress: () => {
        // Simulate queue draining gradually
        if (queueSize > 0) queueSize--;
      }
    });

    expect(result).toBe(true);
    expect(queueSize).toBe(0);
  });

  it('should return false when queue does not drain before timeout', async () => {
    const result = await waitForQueueToDrain({
      queueName: 'stuck_queue',
      getStats: () => ({ queueDepth: 10 }),
      isQueueEmpty: (stats) => stats.queueDepth === 0,
      timeoutMs: 100,
      pollIntervalMs: 10
    });

    expect(result).toBe(false);
  });

  it('should call onProgress callback during wait', async () => {
    const progressCalls: any[] = [];
    let queueSize = 3;

    await waitForQueueToDrain({
      queueName: 'test_queue',
      getStats: () => ({ queueDepth: queueSize }),
      isQueueEmpty: (stats) => stats.queueDepth === 0,
      timeoutMs: 1000,
      pollIntervalMs: 10,
      onProgress: (stats, elapsed) => {
        progressCalls.push({ stats: { ...stats }, elapsed });
        if (queueSize > 0) queueSize--;
      }
    });

    expect(progressCalls.length).toBeGreaterThan(0);
    // Should receive decreasing queue sizes
    expect(progressCalls[0].stats.queueDepth).toBeGreaterThan(0);
    // Last call will have queueDepth >= 1 (when it becomes 0, loop exits before onProgress)
    expect(progressCalls[progressCalls.length - 1].stats.queueDepth).toBeGreaterThanOrEqual(1);
  });

  it('should track elapsed time in progress callback', async () => {
    const progressCalls: any[] = [];
    let queueSize = 2;

    await waitForQueueToDrain({
      queueName: 'test_queue',
      getStats: () => ({ queueDepth: queueSize }),
      isQueueEmpty: (stats) => stats.queueDepth === 0,
      timeoutMs: 1000,
      pollIntervalMs: 50,
      onProgress: (stats, elapsed) => {
        progressCalls.push({ elapsed });
        if (queueSize > 0) queueSize--;
      }
    });

    // Elapsed time should increase
    expect(progressCalls.length).toBeGreaterThanOrEqual(2);
    expect(progressCalls[1].elapsed).toBeGreaterThan(progressCalls[0].elapsed);
  });

  it('should work with complex queue stats (write queue)', async () => {
    let writeQueueLength = 5;
    let isWriting = true;

    const result = await waitForQueueToDrain({
      queueName: 'write_queue',
      getStats: () => ({ length: writeQueueLength, isWriting }),
      isQueueEmpty: (stats) => (stats.length ?? 0) === 0 && !stats.isWriting,
      timeoutMs: 1000,
      pollIntervalMs: 10,
      onProgress: () => {
        // Simulate write queue processing
        if (writeQueueLength > 0) {
          writeQueueLength--;
        } else {
          isWriting = false;
        }
      }
    });

    expect(result).toBe(true);
    expect(writeQueueLength).toBe(0);
    expect(isWriting).toBe(false);
  });

  it('should work with complex queue stats (embedding queue)', async () => {
    let queueDepth = 10;
    let processingBatches = 2;

    const result = await waitForQueueToDrain({
      queueName: 'embedding_queue',
      getStats: () => ({ queueDepth, processingBatches }),
      isQueueEmpty: (stats) =>
        (stats.queueDepth ?? 0) === 0 && (stats.processingBatches ?? 0) === 0,
      timeoutMs: 1000,
      pollIntervalMs: 10,
      onProgress: () => {
        // Simulate embedding queue processing
        if (queueDepth > 0) {
          queueDepth--;
        } else if (processingBatches > 0) {
          processingBatches--;
        }
      }
    });

    expect(result).toBe(true);
    expect(queueDepth).toBe(0);
    expect(processingBatches).toBe(0);
  });

  it('should handle no timeout (infinite wait until drain)', async () => {
    let queueSize = 3;

    const result = await waitForQueueToDrain({
      queueName: 'patient_queue',
      getStats: () => ({ queueDepth: queueSize }),
      isQueueEmpty: (stats) => stats.queueDepth === 0,
      // No timeout specified - should default to Infinity
      pollIntervalMs: 10,
      onProgress: () => {
        if (queueSize > 0) queueSize--;
      }
    });

    expect(result).toBe(true);
    expect(queueSize).toBe(0);
  });

  it('should not call onProgress if not provided', async () => {
    let queueSize = 2;

    // Should not throw even without onProgress callback
    const result = await waitForQueueToDrain({
      queueName: 'silent_queue',
      getStats: () => {
        if (queueSize > 0) queueSize--;
        return { queueDepth: queueSize };
      },
      isQueueEmpty: (stats) => stats.queueDepth === 0,
      timeoutMs: 1000,
      pollIntervalMs: 10
      // No onProgress callback
    });

    expect(result).toBe(true);
  });

  it('should use custom poll interval', async () => {
    const startTime = Date.now();
    let queueSize = 1;

    await waitForQueueToDrain({
      queueName: 'test_queue',
      getStats: () => ({ queueDepth: queueSize }),
      isQueueEmpty: (stats) => stats.queueDepth === 0,
      timeoutMs: 1000,
      pollIntervalMs: 100, // Custom interval
      onProgress: () => {
        queueSize = 0; // Drain immediately on first poll
      }
    });

    const elapsed = Date.now() - startTime;
    // Should take at least one poll interval
    expect(elapsed).toBeGreaterThanOrEqual(90); // Allow some margin
  });
});
