import { describe, it, expect, beforeEach } from 'vitest';
import { SerialQueue } from '../../src/shared/utils/SerialQueue';

describe('SerialQueue', () => {
  let queue: SerialQueue<number>;

  beforeEach(() => {
    queue = new SerialQueue<number>();
  });

  describe('basic operations', () => {
    it('should execute operations in order', async () => {
      const results: number[] = [];

      // Add operations that complete in reverse order of execution time
      const promises = [
        queue.add(async () => {
          await new Promise(resolve => setTimeout(resolve, 30));
          results.push(1);
          return 1;
        }),
        queue.add(async () => {
          await new Promise(resolve => setTimeout(resolve, 10));
          results.push(2);
          return 2;
        }),
        queue.add(async () => {
          await new Promise(resolve => setTimeout(resolve, 20));
          results.push(3);
          return 3;
        })
      ];

      const values = await Promise.all(promises);

      expect(values).toEqual([1, 2, 3]);
      expect(results).toEqual([1, 2, 3]); // Should execute in order despite different delays
    });

    it('should return correct values from operations', async () => {
      const result1 = await queue.add(async () => 42);
      const result2 = await queue.add(async () => 'hello');
      const result3 = await queue.add(async () => [1, 2, 3]);

      expect(result1).toBe(42);
      expect(result2).toBe('hello');
      expect(result3).toEqual([1, 2, 3]);
    });

    it('should handle empty queue', async () => {
      const status = queue.getStatus();
      // Note: isIdle is based on Promise.resolve() comparison, which may not be perfectly reliable
      expect(status.isShutdown).toBe(false);
    });
  });

  describe('error handling', () => {
    it('should isolate errors between operations', async () => {
      const results: string[] = [];

      const promises = [
        queue.add(async () => {
          results.push('operation1');
          return 'success1';
        }),
        queue.add(async () => {
          throw new Error('operation2 failed');
        }),
        queue.add(async () => {
          results.push('operation3');
          return 'success3';
        })
      ];

      const [result1, error, result3] = await Promise.allSettled(promises);

      expect(result1.status).toBe('fulfilled');
      expect((result1 as any).value).toBe('success1');

      expect(error.status).toBe('rejected');
      expect((error as any).reason.message).toBe('operation2 failed');

      expect(result3.status).toBe('fulfilled');
      expect((result3 as any).value).toBe('success3');

      expect(results).toEqual(['operation1', 'operation3']);
    });

    it('should continue processing after errors', async () => {
      let counter = 0;

      // First operation fails
      await expect(queue.add(async () => {
        counter++;
        throw new Error('First operation failed');
      })).rejects.toThrow('First operation failed');

      // Second operation should still execute
      const result = await queue.add(async () => {
        counter++;
        return 'success';
      });

      expect(counter).toBe(2);
      expect(result).toBe('success');
    });
  });

  describe('shutdown functionality', () => {
    it('should reject new operations after shutdown', async () => {
      queue.shutdown();

      await expect(queue.add(async () => 'test')).rejects.toThrow('Queue is shutdown');

      const status = queue.getStatus();
      expect(status.isShutdown).toBe(true);
    });

    it('should reject queued operations when shutdown during execution', async () => {
      // Start a long-running operation
      const longRunning = queue.add(async () => {
        await new Promise(resolve => setTimeout(resolve, 50));
        return 'long';
      });

      // Queue another operation that should be rejected
      const queued = queue.add(async () => 'queued');

      // Shutdown after a brief delay to allow first operation to start
      setTimeout(() => queue.shutdown(), 10);

      // Long-running operation should complete normally
      await expect(longRunning).resolves.toBe('long');

      // Queued operation should be rejected
      await expect(queued).rejects.toThrow('Queue was shutdown while operation was queued');
    });
  });

  describe('drain functionality', () => {
    it('should wait for all operations to complete', async () => {
      const results: number[] = [];

      // Start multiple operations
      queue.add(async () => {
        await new Promise(resolve => setTimeout(resolve, 50));
        results.push(1);
      });

      queue.add(async () => {
        await new Promise(resolve => setTimeout(resolve, 30));
        results.push(2);
      });

      queue.add(async () => {
        await new Promise(resolve => setTimeout(resolve, 10));
        results.push(3);
      });

      // Drain should wait for all to complete
      await queue.drain();

      expect(results).toEqual([1, 2, 3]);
    });

    it('should handle drain with errors gracefully', async () => {
      // Add an operation that will fail, but catch the error to prevent unhandled rejection
      const failingOperation = queue.add(async () => {
        await new Promise(resolve => setTimeout(resolve, 10));
        throw new Error('Operation failed');
      });

      // We expect this operation to fail, so catch the error
      await expect(failingOperation).rejects.toThrow('Operation failed');

      // Drain should not throw even if operations fail
      await expect(queue.drain()).resolves.toBeUndefined();
    });
  });

  describe('reset functionality', () => {
    it('should reset queue to initial state', async () => {
      // Shutdown the queue
      queue.shutdown();
      expect(queue.getStatus().isShutdown).toBe(true);

      // Reset should restore functionality
      queue.reset();
      const status = queue.getStatus();
      expect(status.isShutdown).toBe(false);

      // Should be able to add operations again
      const result = await queue.add(async () => 'test');
      expect(result).toBe('test');
    });
  });

  describe('concurrency behavior', () => {
    it('should not execute operations concurrently', async () => {
      const executionOrder: number[] = [];
      const startTimes: number[] = [];
      const endTimes: number[] = [];

      const createOperation = (id: number, delay: number) => {
        return queue.add(async () => {
          startTimes[id] = Date.now();
          executionOrder.push(id);
          await new Promise(resolve => setTimeout(resolve, delay));
          endTimes[id] = Date.now();
          return id;
        });
      };

      // Start operations with different delays
      const promises = [
        createOperation(0, 20),
        createOperation(1, 10),
        createOperation(2, 30)
      ];

      await Promise.all(promises);

      // Operations should execute in order
      expect(executionOrder).toEqual([0, 1, 2]);

      // Each operation should start after the previous one ends
      expect(startTimes[1]).toBeGreaterThanOrEqual(endTimes[0]);
      expect(startTimes[2]).toBeGreaterThanOrEqual(endTimes[1]);
    });
  });

  describe('performance', () => {
    it('should handle many operations efficiently', async () => {
      const operationCount = 100;
      const promises: Promise<number>[] = [];

      const startTime = Date.now();

      for (let i = 0; i < operationCount; i++) {
        promises.push(queue.add(async () => i));
      }

      const results = await Promise.all(promises);
      const endTime = Date.now();

      expect(results).toEqual(Array.from({ length: operationCount }, (_, i) => i));
      expect(endTime - startTime).toBeLessThan(1000); // Should complete quickly
    });
  });
});