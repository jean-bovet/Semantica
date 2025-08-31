import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { MemoryMonitor } from '../../src/shared/utils/memoryMonitor';

describe('MemoryMonitor', () => {
  let monitor: MemoryMonitor;
  let consoleLogSpy: any;
  let processMemoryUsageSpy: any;
  
  beforeEach(() => {
    // Mock console.log
    consoleLogSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    
    // Mock process.memoryUsage
    processMemoryUsageSpy = vi.spyOn(process, 'memoryUsage');
  });
  
  afterEach(() => {
    // Clean up
    if (monitor) {
      monitor.stop();
    }
    vi.clearAllMocks();
    vi.restoreAllMocks();
  });
  
  describe('initialization', () => {
    it('should initialize with default options', () => {
      monitor = new MemoryMonitor();
      expect(monitor.getCounter()).toBe(0);
    });
    
    it('should initialize with custom options', () => {
      monitor = new MemoryMonitor({
        logPrefix: 'TEST',
        counterName: 'Tests run',
        rssThreshold: 20,
        heapThreshold: 10
      });
      expect(monitor.getCounter()).toBe(0);
    });
  });
  
  describe('counter management', () => {
    beforeEach(() => {
      monitor = new MemoryMonitor();
    });
    
    it('should increment counter by 1 by default', () => {
      monitor.increment();
      expect(monitor.getCounter()).toBe(1);
    });
    
    it('should increment counter by custom amount', () => {
      monitor.increment(5);
      expect(monitor.getCounter()).toBe(5);
      monitor.increment(3);
      expect(monitor.getCounter()).toBe(8);
    });
    
    it('should reset counter to zero', () => {
      monitor.increment(10);
      monitor.resetCounter();
      expect(monitor.getCounter()).toBe(0);
    });
  });
  
  describe('memory statistics', () => {
    beforeEach(() => {
      monitor = new MemoryMonitor();
    });
    
    it('should return memory stats', () => {
      processMemoryUsageSpy.mockReturnValue({
        rss: 100 * 1024 * 1024,      // 100MB
        heapUsed: 50 * 1024 * 1024,  // 50MB
        heapTotal: 80 * 1024 * 1024, // 80MB
        external: 10 * 1024 * 1024,  // 10MB
        arrayBuffers: 5 * 1024 * 1024 // 5MB
      });
      
      const stats = monitor.getStats();
      expect(stats.rssMB).toBe(100);
      expect(stats.heapMB).toBe(50);
      expect(stats.heapTotalMB).toBe(80);
      expect(stats.externalMB).toBe(10);
      expect(stats.arrayBuffersMB).toBeUndefined(); // Not tracking by default
    });
    
    it('should track array buffers when enabled', () => {
      monitor = new MemoryMonitor({ trackArrayBuffers: true });
      
      processMemoryUsageSpy.mockReturnValue({
        rss: 100 * 1024 * 1024,
        heapUsed: 50 * 1024 * 1024,
        heapTotal: 80 * 1024 * 1024,
        external: 10 * 1024 * 1024,
        arrayBuffers: 5 * 1024 * 1024
      });
      
      const stats = monitor.getStats();
      expect(stats.arrayBuffersMB).toBe(5);
    });
  });
  
  describe('memory logging', () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });
    
    afterEach(() => {
      vi.useRealTimers();
    });
    
    it('should log initial state when started', () => {
      processMemoryUsageSpy.mockReturnValue({
        rss: 100 * 1024 * 1024,
        heapUsed: 50 * 1024 * 1024,
        heapTotal: 80 * 1024 * 1024,
        external: 10 * 1024 * 1024,
        arrayBuffers: 5 * 1024 * 1024
      });
      
      monitor = new MemoryMonitor({ logPrefix: 'TEST' });
      monitor.start();
      
      expect(consoleLogSpy).toHaveBeenCalledWith(
        '[TEST] RSS=100MB, Heap=50MB/80MB, External=10MB, Operations: 0'
      );
    });
    
    it('should log when RSS changes beyond threshold', () => {
      processMemoryUsageSpy.mockReturnValue({
        rss: 100 * 1024 * 1024,
        heapUsed: 50 * 1024 * 1024,
        heapTotal: 80 * 1024 * 1024,
        external: 10 * 1024 * 1024,
        arrayBuffers: 5 * 1024 * 1024
      });
      
      monitor = new MemoryMonitor({ 
        logPrefix: 'TEST',
        rssThreshold: 10 
      });
      monitor.start();
      consoleLogSpy.mockClear();
      
      // Change RSS by more than threshold
      processMemoryUsageSpy.mockReturnValue({
        rss: 111 * 1024 * 1024, // +11MB
        heapUsed: 50 * 1024 * 1024,
        heapTotal: 80 * 1024 * 1024,
        external: 10 * 1024 * 1024,
        arrayBuffers: 5 * 1024 * 1024
      });
      
      vi.advanceTimersByTime(2000);
      
      expect(consoleLogSpy).toHaveBeenCalledWith(
        '[TEST] RSS=111MB, Heap=50MB/80MB, External=10MB, Operations: 0'
      );
    });
    
    it('should not log when changes are below threshold', () => {
      processMemoryUsageSpy.mockReturnValue({
        rss: 100 * 1024 * 1024,
        heapUsed: 50 * 1024 * 1024,
        heapTotal: 80 * 1024 * 1024,
        external: 10 * 1024 * 1024,
        arrayBuffers: 5 * 1024 * 1024
      });
      
      monitor = new MemoryMonitor({ 
        logPrefix: 'TEST',
        rssThreshold: 10 
      });
      monitor.start();
      consoleLogSpy.mockClear();
      
      // Change RSS by less than threshold
      processMemoryUsageSpy.mockReturnValue({
        rss: 105 * 1024 * 1024, // +5MB (below 10MB threshold)
        heapUsed: 52 * 1024 * 1024, // +2MB (below 5MB threshold)
        heapTotal: 80 * 1024 * 1024,
        external: 10 * 1024 * 1024,
        arrayBuffers: 5 * 1024 * 1024
      });
      
      vi.advanceTimersByTime(2000);
      
      expect(consoleLogSpy).not.toHaveBeenCalled();
    });
    
    it('should log when counter changes', () => {
      processMemoryUsageSpy.mockReturnValue({
        rss: 100 * 1024 * 1024,
        heapUsed: 50 * 1024 * 1024,
        heapTotal: 80 * 1024 * 1024,
        external: 10 * 1024 * 1024,
        arrayBuffers: 5 * 1024 * 1024
      });
      
      monitor = new MemoryMonitor({ 
        logPrefix: 'TEST',
        counterName: 'Files' 
      });
      monitor.start();
      consoleLogSpy.mockClear();
      
      monitor.increment(5);
      vi.advanceTimersByTime(2000);
      
      expect(consoleLogSpy).toHaveBeenCalledWith(
        '[TEST] RSS=100MB, Heap=50MB/80MB, External=10MB, Files: 5'
      );
    });
    
    it('should include array buffers when tracking enabled', () => {
      processMemoryUsageSpy.mockReturnValue({
        rss: 100 * 1024 * 1024,
        heapUsed: 50 * 1024 * 1024,
        heapTotal: 80 * 1024 * 1024,
        external: 10 * 1024 * 1024,
        arrayBuffers: 5 * 1024 * 1024
      });
      
      monitor = new MemoryMonitor({ 
        logPrefix: 'TEST',
        trackArrayBuffers: true 
      });
      monitor.start();
      
      expect(consoleLogSpy).toHaveBeenCalledWith(
        '[TEST] RSS=100MB, Heap=50MB/80MB, External=10MB, ArrayBuffers=5MB, Operations: 0'
      );
    });
  });
  
  describe('memory threshold detection', () => {
    beforeEach(() => {
      monitor = new MemoryMonitor();
    });
    
    it('should detect high memory', () => {
      processMemoryUsageSpy.mockReturnValue({
        rss: 800 * 1024 * 1024, // 800MB
        heapUsed: 50 * 1024 * 1024,
        heapTotal: 80 * 1024 * 1024,
        external: 10 * 1024 * 1024,
        arrayBuffers: 5 * 1024 * 1024
      });
      
      expect(monitor.isMemoryHigh(600)).toBe(true);
      expect(monitor.isMemoryHigh(900)).toBe(false);
    });
  });
  
  describe('growth rate calculation', () => {
    beforeEach(() => {
      monitor = new MemoryMonitor();
    });
    
    it('should return 0 when no operations', () => {
      expect(monitor.getGrowthRate()).toBe(0);
    });
    
    it('should calculate growth rate correctly', () => {
      // Initial state: 100MB
      processMemoryUsageSpy.mockReturnValue({
        rss: 100 * 1024 * 1024,
        heapUsed: 50 * 1024 * 1024,
        heapTotal: 80 * 1024 * 1024,
        external: 10 * 1024 * 1024,
        arrayBuffers: 5 * 1024 * 1024
      });
      
      monitor.forceLog(); // Establish baseline
      
      // After 10 operations: 150MB
      processMemoryUsageSpy.mockReturnValue({
        rss: 150 * 1024 * 1024,
        heapUsed: 70 * 1024 * 1024,
        heapTotal: 100 * 1024 * 1024,
        external: 15 * 1024 * 1024,
        arrayBuffers: 8 * 1024 * 1024
      });
      
      monitor.increment(10);
      
      // Growth: 50MB over 10 operations = 5MB per operation
      expect(monitor.getGrowthRate()).toBe(5);
    });
  });
  
  describe('lifecycle management', () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });
    
    afterEach(() => {
      vi.useRealTimers();
    });
    
    it('should start and stop monitoring', () => {
      processMemoryUsageSpy.mockReturnValue({
        rss: 100 * 1024 * 1024,
        heapUsed: 50 * 1024 * 1024,
        heapTotal: 80 * 1024 * 1024,
        external: 10 * 1024 * 1024,
        arrayBuffers: 5 * 1024 * 1024
      });
      
      monitor = new MemoryMonitor({ logPrefix: 'TEST' });
      monitor.start();
      
      expect(consoleLogSpy).toHaveBeenCalledTimes(1); // Initial log
      
      vi.advanceTimersByTime(2000);
      // No change, no additional log
      expect(consoleLogSpy).toHaveBeenCalledTimes(1);
      
      monitor.stop();
      monitor.increment(); // Change counter
      vi.advanceTimersByTime(2000);
      
      // Should not log after stopping
      expect(consoleLogSpy).toHaveBeenCalledTimes(1);
    });
    
    it('should not start multiple times', () => {
      processMemoryUsageSpy.mockReturnValue({
        rss: 100 * 1024 * 1024,
        heapUsed: 50 * 1024 * 1024,
        heapTotal: 80 * 1024 * 1024,
        external: 10 * 1024 * 1024,
        arrayBuffers: 5 * 1024 * 1024
      });
      
      monitor = new MemoryMonitor({ logPrefix: 'TEST' });
      monitor.start();
      monitor.start(); // Second start should be ignored
      
      expect(consoleLogSpy).toHaveBeenCalledTimes(1); // Only one initial log
    });
  });
  
  describe('force logging', () => {
    it('should force log regardless of thresholds', () => {
      processMemoryUsageSpy.mockReturnValue({
        rss: 100 * 1024 * 1024,
        heapUsed: 50 * 1024 * 1024,
        heapTotal: 80 * 1024 * 1024,
        external: 10 * 1024 * 1024,
        arrayBuffers: 5 * 1024 * 1024
      });
      
      monitor = new MemoryMonitor({ logPrefix: 'TEST' });
      monitor.forceLog();
      
      expect(consoleLogSpy).toHaveBeenCalledWith(
        '[TEST] RSS=100MB, Heap=50MB/80MB, External=10MB, Operations: 0'
      );
      
      consoleLogSpy.mockClear();
      
      // No change in memory
      monitor.forceLog();
      
      // Should still log
      expect(consoleLogSpy).toHaveBeenCalledWith(
        '[TEST] RSS=100MB, Heap=50MB/80MB, External=10MB, Operations: 0'
      );
    });
  });
});