import { describe, it, expect } from 'vitest';
import { shouldRestartEmbedder, bytesToMB } from '../../src/main/utils/embedder-health';

describe('Embedder Restart Logic', () => {

  describe('Memory Threshold', () => {
    it('should restart when memory exceeds 1500MB', () => {
      const memoryBytes = 1600 * 1024 * 1024; // 1600MB in bytes
      const result = shouldRestartEmbedder(10, memoryBytes);
      expect(result).toBe(true);
    });

    it('should not restart when memory is below 1500MB', () => {
      const memoryBytes = 1400 * 1024 * 1024; // 1400MB in bytes
      const result = shouldRestartEmbedder(10, memoryBytes);
      expect(result).toBe(false);
    });

    it('should not restart when memory is exactly 1500MB', () => {
      const memoryBytes = 1500 * 1024 * 1024; // 1500MB in bytes
      const result = shouldRestartEmbedder(10, memoryBytes);
      expect(result).toBe(false);
    });

    it('should handle small memory values correctly', () => {
      const memoryBytes = 100 * 1024 * 1024; // 100MB in bytes
      const result = shouldRestartEmbedder(10, memoryBytes);
      expect(result).toBe(false);
    });

    it('should handle very large memory values correctly', () => {
      const memoryBytes = 5000 * 1024 * 1024; // 5GB in bytes
      const result = shouldRestartEmbedder(10, memoryBytes);
      expect(result).toBe(true);
    });
  });

  describe('File Count Threshold', () => {
    it('should restart when file count exceeds 200', () => {
      const memoryBytes = 500 * 1024 * 1024; // 500MB (below threshold)
      const result = shouldRestartEmbedder(201, memoryBytes);
      expect(result).toBe(true);
    });

    it('should not restart when file count is below 200', () => {
      const memoryBytes = 500 * 1024 * 1024; // 500MB (below threshold)
      const result = shouldRestartEmbedder(199, memoryBytes);
      expect(result).toBe(false);
    });

    it('should not restart when file count is exactly 200', () => {
      const memoryBytes = 500 * 1024 * 1024; // 500MB (below threshold)
      const result = shouldRestartEmbedder(200, memoryBytes);
      expect(result).toBe(false);
    });
  });

  describe('Startup Protection', () => {
    it('should never restart when filesProcessed is 0', () => {
      // Even with high memory
      const highMemory = 3000 * 1024 * 1024; // 3GB
      expect(shouldRestartEmbedder(0, highMemory)).toBe(false);

      // Even if both thresholds would be exceeded
      expect(shouldRestartEmbedder(0, highMemory, 0, 0)).toBe(false);
    });

    it('should restart when filesProcessed is 1 and thresholds exceeded', () => {
      const highMemory = 2000 * 1024 * 1024; // 2GB
      expect(shouldRestartEmbedder(1, highMemory)).toBe(true);
    });
  });

  describe('Combined Conditions', () => {
    it('should restart when either condition is met', () => {
      // High memory, low files
      expect(shouldRestartEmbedder(10, 2000 * 1024 * 1024)).toBe(true);

      // Low memory, high files
      expect(shouldRestartEmbedder(250, 500 * 1024 * 1024)).toBe(true);

      // Both high
      expect(shouldRestartEmbedder(250, 2000 * 1024 * 1024)).toBe(true);
    });

    it('should not restart when both conditions are below threshold', () => {
      expect(shouldRestartEmbedder(100, 1000 * 1024 * 1024)).toBe(false);
    });
  });

  describe('Memory Conversion', () => {
    it('should correctly convert bytes to MB using bytesToMB', () => {
      // Test exact conversions using the actual function
      expect(bytesToMB(1048576)).toBe(1); // 1MB
      expect(bytesToMB(1073741824)).toBe(1024); // 1GB
      expect(bytesToMB(1610612736)).toBe(1536); // 1.5GB
      expect(bytesToMB(0)).toBe(0); // 0 bytes
    });

    it('should round memory values correctly', () => {
      // 1500.4MB should round to 1500MB (not trigger restart)
      const memory1 = 1500.4 * 1024 * 1024;
      expect(shouldRestartEmbedder(10, memory1)).toBe(false);

      // 1500.5MB should round to 1501MB (trigger restart)
      const memory2 = 1500.5 * 1024 * 1024;
      expect(shouldRestartEmbedder(10, memory2)).toBe(true);
    });

    it('should handle bytesToMB edge cases', () => {
      expect(bytesToMB(524288)).toBe(1); // 0.5MB rounds to 1MB
      expect(bytesToMB(524287)).toBe(0); // Just under 0.5MB rounds to 0MB
      expect(bytesToMB(-1000)).toBe(-0); // Negative values result in -0 due to Math.round
      expect(bytesToMB(NaN)).toBe(NaN); // NaN propagates
    });
  });

  describe('Edge Cases', () => {
    it('should handle zero memory', () => {
      expect(shouldRestartEmbedder(10, 0)).toBe(false);
    });

    it('should handle negative values gracefully', () => {
      expect(shouldRestartEmbedder(-1, 1000 * 1024 * 1024)).toBe(false);
      expect(shouldRestartEmbedder(10, -1000)).toBe(false);
    });

    it('should handle NaN values', () => {
      expect(shouldRestartEmbedder(NaN, 1000 * 1024 * 1024)).toBe(false);
      expect(shouldRestartEmbedder(10, NaN)).toBe(false);
    });

    it('should handle Infinity', () => {
      expect(shouldRestartEmbedder(Infinity, 1000 * 1024 * 1024)).toBe(true);
      expect(shouldRestartEmbedder(10, Infinity)).toBe(true);
    });
  });
});