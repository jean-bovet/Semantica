import { describe, it, expect, vi } from 'vitest';
import { StatsCache } from '../../../../src/main/worker/cache/StatsCache';
import type { DatabaseStats } from '../../../../src/main/worker/search';

describe('StatsCache', () => {
  const mockStats: DatabaseStats = {
    totalChunks: 100,
    indexedFiles: 50,
    folderStats: [
      { folder: '/test', totalFiles: 10, indexedFiles: 5 }
    ]
  };

  describe('get()', () => {
    it('should call calculator on first request', async () => {
      const cache = new StatsCache();
      const calculator = vi.fn().mockResolvedValue(mockStats);

      const result = await cache.get(calculator);

      expect(calculator).toHaveBeenCalledTimes(1);
      expect(result).toEqual(mockStats);
    });

    it('should return cached value on subsequent requests', async () => {
      const cache = new StatsCache();
      const calculator = vi.fn().mockResolvedValue(mockStats);

      const result1 = await cache.get(calculator);
      const result2 = await cache.get(calculator);
      const result3 = await cache.get(calculator);

      expect(calculator).toHaveBeenCalledTimes(1);
      expect(result1).toBe(result2);
      expect(result2).toBe(result3);
    });

    it('should deduplicate concurrent requests', async () => {
      const cache = new StatsCache();
      const calculator = vi.fn().mockResolvedValue(mockStats);

      // Make 5 concurrent requests
      const results = await Promise.all([
        cache.get(calculator),
        cache.get(calculator),
        cache.get(calculator),
        cache.get(calculator),
        cache.get(calculator)
      ]);

      // Calculator should only be called once
      expect(calculator).toHaveBeenCalledTimes(1);

      // All results should be the same
      results.forEach(result => {
        expect(result).toBe(results[0]);
      });
    });

    it('should wait for in-progress calculation', async () => {
      const cache = new StatsCache();
      let resolveCalculator: (value: DatabaseStats) => void;
      const calculatorPromise = new Promise<DatabaseStats>(resolve => {
        resolveCalculator = resolve;
      });
      const calculator = vi.fn().mockReturnValue(calculatorPromise);

      // Start first request (doesn't complete yet)
      const request1Promise = cache.get(calculator);
      expect(calculator).toHaveBeenCalledTimes(1);

      // Start second request while first is in progress
      const request2Promise = cache.get(calculator);

      // Calculator should still only be called once
      expect(calculator).toHaveBeenCalledTimes(1);

      // Complete the calculation
      resolveCalculator!(mockStats);

      // Both requests should resolve to same value
      const [result1, result2] = await Promise.all([request1Promise, request2Promise]);
      expect(result1).toBe(mockStats);
      expect(result2).toBe(mockStats);
    });

    it('should retry calculation after error', async () => {
      const cache = new StatsCache();
      const error = new Error('Calculation failed');
      const calculator = vi.fn()
        .mockRejectedValueOnce(error)  // First call fails
        .mockResolvedValueOnce(mockStats);  // Second call succeeds

      // First call should throw
      await expect(cache.get(calculator)).rejects.toThrow('Calculation failed');
      expect(calculator).toHaveBeenCalledTimes(1);

      // Second call should retry and succeed
      const result = await cache.get(calculator);
      expect(calculator).toHaveBeenCalledTimes(2);
      expect(result).toEqual(mockStats);
    });

    it('should not deduplicate if first calculation fails', async () => {
      const cache = new StatsCache();
      const error = new Error('Calculation failed');
      const calculator = vi.fn().mockRejectedValue(error);

      // Make concurrent requests that both fail
      const results = await Promise.allSettled([
        cache.get(calculator),
        cache.get(calculator)
      ]);

      // Both should fail
      expect(results[0].status).toBe('rejected');
      expect(results[1].status).toBe('rejected');

      // Calculator should only be called once (deduplication still works)
      expect(calculator).toHaveBeenCalledTimes(1);
    });
  });

  describe('invalidate()', () => {
    it('should clear cache and force recalculation', async () => {
      const cache = new StatsCache();
      const calculator = vi.fn()
        .mockResolvedValueOnce(mockStats)
        .mockResolvedValueOnce({ ...mockStats, totalChunks: 200 });

      // First request
      const result1 = await cache.get(calculator);
      expect(result1.totalChunks).toBe(100);
      expect(calculator).toHaveBeenCalledTimes(1);

      // Invalidate cache
      cache.invalidate();

      // Second request should recalculate
      const result2 = await cache.get(calculator);
      expect(result2.totalChunks).toBe(200);
      expect(calculator).toHaveBeenCalledTimes(2);
    });

    it('should be safe to call when cache is empty', () => {
      const cache = new StatsCache();

      // Should not throw
      expect(() => cache.invalidate()).not.toThrow();

      // Multiple calls should also be safe
      cache.invalidate();
      cache.invalidate();
    });

    it('should not cancel in-progress calculation', async () => {
      const cache = new StatsCache();
      let resolveCalculator: (value: DatabaseStats) => void;
      const calculatorPromise = new Promise<DatabaseStats>(resolve => {
        resolveCalculator = resolve;
      });
      const calculator = vi.fn().mockReturnValue(calculatorPromise);

      // Start calculation
      const requestPromise = cache.get(calculator);

      // Invalidate while calculation is in progress
      cache.invalidate();

      // Complete calculation
      resolveCalculator!(mockStats);

      // Request should still complete successfully
      const result = await requestPromise;
      expect(result).toBe(mockStats);
    });
  });

  describe('isCached()', () => {
    it('should return false when cache is empty', () => {
      const cache = new StatsCache();
      expect(cache.isCached()).toBe(false);
    });

    it('should return true after successful calculation', async () => {
      const cache = new StatsCache();
      const calculator = vi.fn().mockResolvedValue(mockStats);

      expect(cache.isCached()).toBe(false);

      await cache.get(calculator);

      expect(cache.isCached()).toBe(true);
    });

    it('should return false after invalidation', async () => {
      const cache = new StatsCache();
      const calculator = vi.fn().mockResolvedValue(mockStats);

      await cache.get(calculator);
      expect(cache.isCached()).toBe(true);

      cache.invalidate();
      expect(cache.isCached()).toBe(false);
    });

    it('should return false if calculation fails', async () => {
      const cache = new StatsCache();
      const calculator = vi.fn().mockRejectedValue(new Error('Failed'));

      await expect(cache.get(calculator)).rejects.toThrow();

      expect(cache.isCached()).toBe(false);
    });
  });

  describe('isCalculating()', () => {
    it('should return false when no calculation is in progress', () => {
      const cache = new StatsCache();
      expect(cache.isCalculating()).toBe(false);
    });

    it('should return true during calculation', async () => {
      const cache = new StatsCache();
      let resolveCalculator: (value: DatabaseStats) => void;
      const calculatorPromise = new Promise<DatabaseStats>(resolve => {
        resolveCalculator = resolve;
      });
      const calculator = vi.fn().mockReturnValue(calculatorPromise);

      const requestPromise = cache.get(calculator);

      // Should be calculating
      expect(cache.isCalculating()).toBe(true);

      // Complete calculation
      resolveCalculator!(mockStats);
      await requestPromise;

      // Should no longer be calculating
      expect(cache.isCalculating()).toBe(false);
    });

    it('should return false after calculation completes', async () => {
      const cache = new StatsCache();
      const calculator = vi.fn().mockResolvedValue(mockStats);

      expect(cache.isCalculating()).toBe(false);

      await cache.get(calculator);

      expect(cache.isCalculating()).toBe(false);
    });

    it('should return false after calculation fails', async () => {
      const cache = new StatsCache();
      const calculator = vi.fn().mockRejectedValue(new Error('Failed'));

      await expect(cache.get(calculator)).rejects.toThrow();

      expect(cache.isCalculating()).toBe(false);
    });
  });

  describe('edge cases', () => {
    it('should handle rapid invalidation', async () => {
      const cache = new StatsCache();
      const calculator = vi.fn().mockResolvedValue(mockStats);

      await cache.get(calculator);
      cache.invalidate();
      cache.invalidate();
      cache.invalidate();

      await cache.get(calculator);

      expect(calculator).toHaveBeenCalledTimes(2);
    });

    it('should handle calculator that returns different values', async () => {
      const cache = new StatsCache();
      let count = 0;
      const calculator = vi.fn().mockImplementation(async () => {
        count++;
        return { ...mockStats, totalChunks: count };
      });

      const result1 = await cache.get(calculator);
      expect(result1.totalChunks).toBe(1);

      const result2 = await cache.get(calculator);
      expect(result2.totalChunks).toBe(1); // Cached value

      cache.invalidate();

      const result3 = await cache.get(calculator);
      expect(result3.totalChunks).toBe(2); // New calculation

      expect(calculator).toHaveBeenCalledTimes(2);
    });
  });
});
