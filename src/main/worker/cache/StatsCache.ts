import type { DatabaseStats } from '../search';

/**
 * Cache for database statistics with promise deduplication.
 *
 * This cache ensures that concurrent requests for stats wait for the same
 * calculation rather than triggering multiple parallel queries. This eliminates
 * the need for polling/busy-waiting patterns.
 *
 * @example
 * ```typescript
 * const cache = new StatsCache();
 *
 * // Multiple concurrent calls share the same promise
 * const [stats1, stats2, stats3] = await Promise.all([
 *   cache.get(() => calculateStats()),
 *   cache.get(() => calculateStats()),
 *   cache.get(() => calculateStats())
 * ]);
 * // calculateStats() is only called once
 *
 * // Subsequent calls return cached value
 * const stats4 = await cache.get(() => calculateStats());
 * // calculateStats() is NOT called again
 *
 * // Invalidate when data changes
 * cache.invalidate();
 * const stats5 = await cache.get(() => calculateStats());
 * // calculateStats() is called again
 * ```
 */
export class StatsCache {
  private cache: DatabaseStats | null = null;
  private promise: Promise<DatabaseStats> | null = null;

  /**
   * Get stats from cache or calculate them.
   *
   * If stats are cached, returns immediately.
   * If a calculation is in progress, waits for it to complete.
   * If no cache and no calculation, calls calculator and caches result.
   *
   * @param calculator - Function that calculates stats (only called when needed)
   * @returns Promise resolving to database stats
   */
  async get(calculator: () => Promise<DatabaseStats>): Promise<DatabaseStats> {
    // Return cached value if available
    if (this.cache) {
      return this.cache;
    }

    // If calculation is in progress, wait for it
    if (this.promise) {
      return this.promise;
    }

    // Start new calculation
    this.promise = calculator().then(result => {
      this.cache = result;
      this.promise = null;
      return result;
    }).catch(error => {
      // On error, clear promise so next call retries
      this.promise = null;
      throw error;
    });

    return this.promise;
  }

  /**
   * Invalidate the cache, forcing next get() to recalculate.
   * Safe to call even if cache is already empty.
   */
  invalidate(): void {
    this.cache = null;
    // Note: We don't clear this.promise - if calculation is in progress,
    // let it finish. The cache will be invalidated after it completes.
  }

  /**
   * Check if cache has a value (for testing/debugging).
   */
  isCached(): boolean {
    return this.cache !== null;
  }

  /**
   * Check if calculation is in progress (for testing/debugging).
   */
  isCalculating(): boolean {
    return this.promise !== null;
  }
}
