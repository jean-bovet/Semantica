import { describe, it, expect } from 'vitest';
import { PipelineStatusFormatter } from '../../src/main/services/PipelineService';

describe('PipelineStatusFormatter', () => {
  describe('createProgressBar', () => {
    // Access the private method via bracket notation for testing
    const createProgressBar = (PipelineStatusFormatter as any).createProgressBar.bind(PipelineStatusFormatter);

    it('should create correct progress bar for valid percentages', () => {
      expect(createProgressBar(0, 10)).toBe('░░░░░░░░░░');
      expect(createProgressBar(50, 10)).toBe('█████░░░░░');
      expect(createProgressBar(100, 10)).toBe('██████████');
    });

    it('should handle negative percentages', () => {
      expect(createProgressBar(-10, 20)).toBe('░░░░░░░░░░░░░░░░░░░░');
      expect(createProgressBar(-100, 10)).toBe('░░░░░░░░░░');
      expect(createProgressBar(-1, 10)).toBe('░░░░░░░░░░');
    });

    it('should handle percentages over 100', () => {
      expect(createProgressBar(110, 20)).toBe('████████████████████');
      expect(createProgressBar(200, 10)).toBe('██████████');
      expect(createProgressBar(101, 10)).toBe('██████████');
    });

    it('should handle NaN values', () => {
      expect(createProgressBar(NaN, 20)).toBe('░░░░░░░░░░░░░░░░░░░░');
      expect(createProgressBar(Number('invalid'), 10)).toBe('░░░░░░░░░░');
    });

    it('should handle undefined/null as 0', () => {
      expect(createProgressBar(undefined as any, 20)).toBe('░░░░░░░░░░░░░░░░░░░░');
      expect(createProgressBar(null as any, 10)).toBe('░░░░░░░░░░');
    });

    it('should handle Infinity', () => {
      expect(createProgressBar(Infinity, 20)).toBe('████████████████████');
      expect(createProgressBar(-Infinity, 10)).toBe('░░░░░░░░░░');
    });

    it('should handle fractional percentages correctly', () => {
      expect(createProgressBar(33.3, 10)).toBe('███░░░░░░░');
      expect(createProgressBar(66.7, 10)).toBe('██████░░░░');
      expect(createProgressBar(99.9, 10)).toBe('█████████░');
    });

    it('should never throw an error', () => {
      // Test with various problematic inputs
      const testCases = [
        -1000,
        1000,
        NaN,
        Infinity,
        -Infinity,
        undefined,
        null,
        0,
        50,
        100,
        0.1,
        99.99
      ];

      testCases.forEach(value => {
        expect(() => createProgressBar(value as any, 20)).not.toThrow();
      });
    });

    it('should always return string of correct length', () => {
      const width = 15;
      const testCases = [-50, 0, 25, 50, 75, 100, 150, NaN, Infinity];

      testCases.forEach(percentage => {
        const result = createProgressBar(percentage, width);
        expect(result).toHaveLength(width);
        expect(typeof result).toBe('string');
      });
    });
  });
});