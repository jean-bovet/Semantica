import { describe, it, expect } from 'vitest';
import { calculateOptimalConcurrency, getConcurrencyMessage } from '../../src/main/worker/cpuConcurrency';

describe('CPU Concurrency Calculation', () => {
  describe('calculateOptimalConcurrency', () => {
    it('should return minimum values for low core counts', () => {
      // Test with 2 cores
      const result2 = calculateOptimalConcurrency(2);
      expect(result2.cpuCount).toBe(2);
      expect(result2.optimal).toBe(4); // Minimum of 4
      expect(result2.throttled).toBe(2); // Minimum of 2
      
      // Test with 4 cores
      const result4 = calculateOptimalConcurrency(4);
      expect(result4.cpuCount).toBe(4);
      expect(result4.optimal).toBe(4); // max(4, 4-1) = 4
      expect(result4.throttled).toBe(2); // max(2, floor(4/4)) = 2
    });
    
    it('should scale properly with typical core counts', () => {
      // Test with 8 cores (typical M1/M2)
      const result8 = calculateOptimalConcurrency(8);
      expect(result8.cpuCount).toBe(8);
      expect(result8.optimal).toBe(7); // 8 - 1 = 7
      expect(result8.throttled).toBe(2); // floor(8/4) = 2
      
      // Test with 10 cores (M1 Pro)
      const result10 = calculateOptimalConcurrency(10);
      expect(result10.cpuCount).toBe(10);
      expect(result10.optimal).toBe(9); // 10 - 1 = 9
      expect(result10.throttled).toBe(2); // floor(10/4) = 2
      
      // Test with 12 cores (M1 Max)
      const result12 = calculateOptimalConcurrency(12);
      expect(result12.cpuCount).toBe(12);
      expect(result12.optimal).toBe(11); // 12 - 1 = 11
      expect(result12.throttled).toBe(3); // floor(12/4) = 3
    });
    
    it('should handle high core counts', () => {
      // Test with 16 cores
      const result16 = calculateOptimalConcurrency(16);
      expect(result16.cpuCount).toBe(16);
      expect(result16.optimal).toBe(15); // 16 - 1 = 15
      expect(result16.throttled).toBe(4); // floor(16/4) = 4
      
      // Test with 32 cores (Mac Pro)
      const result32 = calculateOptimalConcurrency(32);
      expect(result32.cpuCount).toBe(32);
      expect(result32.optimal).toBe(31); // 32 - 1 = 31
      expect(result32.throttled).toBe(8); // floor(32/4) = 8
    });
    
    it('should use system CPU count when no parameter provided', () => {
      // This will use actual system CPU count
      const result = calculateOptimalConcurrency();
      expect(result.cpuCount).toBeGreaterThan(0);
      expect(result.optimal).toBeGreaterThanOrEqual(4);
      expect(result.throttled).toBeGreaterThanOrEqual(2);
    });
    
    it('should never go below minimum thresholds', () => {
      // Test with 1 core (edge case)
      const result1 = calculateOptimalConcurrency(1);
      expect(result1.optimal).toBe(4); // Minimum of 4
      expect(result1.throttled).toBe(2); // Minimum of 2
      
      // Test with 3 cores
      const result3 = calculateOptimalConcurrency(3);
      expect(result3.optimal).toBe(4); // max(4, 3-1) = 4
      expect(result3.throttled).toBe(2); // max(2, floor(3/4)) = 2
    });
    
    it('should calculate throttled as 1/4 of cores', () => {
      // Test various core counts for throttled calculation
      expect(calculateOptimalConcurrency(4).throttled).toBe(2); // max(2, floor(4/4)) = 2
      expect(calculateOptimalConcurrency(8).throttled).toBe(2); // floor(8/4) = 2
      expect(calculateOptimalConcurrency(12).throttled).toBe(3); // floor(12/4) = 3
      expect(calculateOptimalConcurrency(16).throttled).toBe(4); // floor(16/4) = 4
      expect(calculateOptimalConcurrency(20).throttled).toBe(5); // floor(20/4) = 5
    });
  });
  
  describe('getConcurrencyMessage', () => {
    it('should format message correctly', () => {
      const settings = {
        cpuCount: 8,
        optimal: 7,
        throttled: 2
      };
      
      const message = getConcurrencyMessage(settings);
      expect(message).toBe('CPU cores detected: 8, setting concurrency to 7 (throttled: 2)');
    });
    
    it('should handle different settings', () => {
      const settings = {
        cpuCount: 16,
        optimal: 15,
        throttled: 4
      };
      
      const message = getConcurrencyMessage(settings);
      expect(message).toBe('CPU cores detected: 16, setting concurrency to 15 (throttled: 4)');
    });
  });
  
  describe('Performance improvement calculations', () => {
    it('should calculate correct improvement over fixed 5 concurrent', () => {
      const fixed = 5;
      
      // 4 cores: 4 concurrent = -20% improvement
      const improvement4 = ((calculateOptimalConcurrency(4).optimal - fixed) / fixed) * 100;
      expect(improvement4).toBe(-20);
      
      // 6 cores: 5 concurrent = 0% improvement
      const improvement6 = ((calculateOptimalConcurrency(6).optimal - fixed) / fixed) * 100;
      expect(improvement6).toBe(0);
      
      // 8 cores: 7 concurrent = 40% improvement
      const improvement8 = ((calculateOptimalConcurrency(8).optimal - fixed) / fixed) * 100;
      expect(improvement8).toBe(40);
      
      // 10 cores: 9 concurrent = 80% improvement
      const improvement10 = ((calculateOptimalConcurrency(10).optimal - fixed) / fixed) * 100;
      expect(improvement10).toBe(80);
      
      // 12 cores: 11 concurrent = 120% improvement
      const improvement12 = ((calculateOptimalConcurrency(12).optimal - fixed) / fixed) * 100;
      expect(improvement12).toBe(120);
    });
  });
});