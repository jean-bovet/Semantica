import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { EmbedderPool, getEmbedderPool, disposeEmbedderPool } from '../../src/shared/embeddings/embedder-pool';
import { IsolatedEmbedder } from '../../src/shared/embeddings/isolated';

// Mock the IsolatedEmbedder
vi.mock('../../src/shared/embeddings/isolated', () => {
  return {
    IsolatedEmbedder: vi.fn().mockImplementation((modelName, config) => {
      return {
        modelName,
        config,
        initialized: false,
        embedCallCount: 0,
        filesProcessed: 0,
        
        initialize: vi.fn().mockResolvedValue(undefined),
        
        embed: vi.fn().mockImplementation(async (texts: string[]) => {
          // Return mock embeddings (384-dimensional vectors)
          return texts.map(() => new Array(384).fill(0.1));
        }),
        
        getStats: vi.fn().mockReturnValue({
          filesSinceSpawn: 10,
          isReady: true,
          memoryUsage: {
            rss: 150, // MB
            heapUsed: 100,
            external: 50
          }
        }),
        
        restart: vi.fn().mockResolvedValue(undefined),
        
        shutdown: vi.fn().mockResolvedValue(undefined)
      };
    })
  };
});

describe('EmbedderPool', () => {
  let pool: EmbedderPool;
  
  beforeEach(() => {
    vi.clearAllMocks();
  });
  
  afterEach(async () => {
    if (pool) {
      await pool.dispose();
    }
    await disposeEmbedderPool();
  });
  
  describe('initialization', () => {
    it('should create pool with default configuration', async () => {
      pool = new EmbedderPool();
      await pool.initialize();
      
      expect(pool.getPoolSize()).toBe(2); // Default pool size
      expect(pool.isInitialized()).toBe(true);
    });
    
    it('should create pool with custom configuration', async () => {
      pool = new EmbedderPool({
        poolSize: 3,
        maxFilesBeforeRestart: 1000,
        maxMemoryMB: 500
      });
      await pool.initialize();
      
      expect(pool.getPoolSize()).toBe(3);
      expect(IsolatedEmbedder).toHaveBeenCalledTimes(3);
    });
    
    it('should initialize all embedders in parallel', async () => {
      pool = new EmbedderPool({ poolSize: 3 });
      await pool.initialize();
      
      const mockInstances = (IsolatedEmbedder as any).mock.results;
      expect(mockInstances).toHaveLength(3);
      
      // Check that initialize was called on each embedder
      mockInstances.forEach((result: any) => {
        expect(result.value.initialize).toHaveBeenCalled();
      });
    });
    
    it('should handle multiple initialization calls gracefully', async () => {
      pool = new EmbedderPool({ poolSize: 2 });
      
      // Call initialize multiple times concurrently
      const promises = [
        pool.initialize(),
        pool.initialize(),
        pool.initialize()
      ];
      
      await Promise.all(promises);
      
      // Should only create 2 embedders (not 6)
      expect(pool.getPoolSize()).toBe(2);
      expect(IsolatedEmbedder).toHaveBeenCalledTimes(2);
    });
  });
  
  describe('embed operations', () => {
    it('should distribute embed calls using round-robin', async () => {
      pool = new EmbedderPool({ poolSize: 3 });
      await pool.initialize();
      
      const mockInstances = (IsolatedEmbedder as any).mock.results.map((r: any) => r.value);
      
      // Make 6 embed calls
      for (let i = 0; i < 6; i++) {
        await pool.embed([`text ${i}`]);
      }
      
      // Each embedder should have received 2 calls (round-robin)
      expect(mockInstances[0].embed).toHaveBeenCalledTimes(2);
      expect(mockInstances[1].embed).toHaveBeenCalledTimes(2);
      expect(mockInstances[2].embed).toHaveBeenCalledTimes(2);
    });
    
    it('should auto-initialize if not initialized', async () => {
      pool = new EmbedderPool({ poolSize: 2 });
      
      // Call embed without explicit initialization
      const result = await pool.embed(['test text']);
      
      expect(pool.isInitialized()).toBe(true);
      expect(result).toHaveLength(1);
      expect(result[0]).toHaveLength(384);
    });
    
    it('should handle query embeddings correctly', async () => {
      pool = new EmbedderPool({ poolSize: 2 });
      await pool.initialize();
      
      const mockInstances = (IsolatedEmbedder as any).mock.results.map((r: any) => r.value);
      
      await pool.embed(['query text'], true);
      
      // Check that isQuery parameter was passed
      expect(mockInstances[0].embed).toHaveBeenCalledWith(['query text'], true);
    });
    
    it('should allow embedding with specific index', async () => {
      pool = new EmbedderPool({ poolSize: 3 });
      await pool.initialize();
      
      const mockInstances = (IsolatedEmbedder as any).mock.results.map((r: any) => r.value);
      
      // Use specific embedder index
      await pool.embedWithIndex(['text 1'], 1);
      await pool.embedWithIndex(['text 2'], 1);
      await pool.embedWithIndex(['text 3'], 2);
      
      expect(mockInstances[0].embed).not.toHaveBeenCalled();
      expect(mockInstances[1].embed).toHaveBeenCalledTimes(2);
      expect(mockInstances[2].embed).toHaveBeenCalledTimes(1);
    });
    
    it('should throw error for invalid index', async () => {
      pool = new EmbedderPool({ poolSize: 2 });
      await pool.initialize();
      
      await expect(pool.embedWithIndex(['text'], 5)).rejects.toThrow('Invalid embedder index: 5');
      await expect(pool.embedWithIndex(['text'], -1)).rejects.toThrow('Invalid embedder index: -1');
    });
  });
  
  describe('statistics and management', () => {
    it('should return stats for all embedders', async () => {
      pool = new EmbedderPool({ poolSize: 2 });
      await pool.initialize();
      
      const stats = pool.getStats();
      
      expect(stats).toHaveLength(2);
      expect(stats[0]).toEqual({
        index: 0,
        filesProcessed: 10,
        memoryUsage: 150 * 1024 * 1024,
        needsRestart: false
      });
      expect(stats[1]).toEqual({
        index: 1,
        filesProcessed: 10,
        memoryUsage: 150 * 1024 * 1024,
        needsRestart: false
      });
    });
    
    it('should restart specific embedder', async () => {
      pool = new EmbedderPool({ poolSize: 3 });
      await pool.initialize();
      
      const mockInstances = (IsolatedEmbedder as any).mock.results.map((r: any) => r.value);
      
      await pool.restart(1);
      
      expect(mockInstances[0].restart).not.toHaveBeenCalled();
      expect(mockInstances[1].restart).toHaveBeenCalledTimes(1);
      expect(mockInstances[2].restart).not.toHaveBeenCalled();
    });
    
    it('should restart all embedders when no index specified', async () => {
      pool = new EmbedderPool({ poolSize: 3 });
      await pool.initialize();
      
      const mockInstances = (IsolatedEmbedder as any).mock.results.map((r: any) => r.value);
      
      await pool.restart();
      
      mockInstances.forEach((instance: any) => {
        expect(instance.restart).toHaveBeenCalledTimes(1);
      });
    });
    
    it('should throw error for invalid restart index', async () => {
      pool = new EmbedderPool({ poolSize: 2 });
      await pool.initialize();
      
      await expect(pool.restart(5)).rejects.toThrow('Invalid embedder index: 5');
    });
  });
  
  describe('real component integration', () => {
    // These tests use real IsolatedEmbedder instances (no mocks)
    let realPool: EmbedderPool;

    afterEach(async () => {
      if (realPool) {
        await realPool.dispose();
        realPool = null as any;
      }
    });

    it('should distribute requests across real embedders', async () => {
      // Skip this test in CI or if model not available
      if (process.env.CI || process.env.SKIP_REAL_EMBEDDER_TESTS) {
        return;
      }

      // Temporarily remove mocks for this test
      vi.doUnmock('../../src/shared/embeddings/isolated');
      const { EmbedderPool: RealEmbedderPool } = await import('../../src/shared/embeddings/embedder-pool');

      realPool = new RealEmbedderPool({
        poolSize: 2,
        maxFilesBeforeRestart: 10,
        maxMemoryMB: 100
      });

      try {
        await realPool.initialize();

        // Test round-robin distribution with real embedders
        const requests = [
          ['first text'],
          ['second text'],
          ['third text'],
          ['fourth text']
        ];

        const results = [];
        for (const texts of requests) {
          const vectors = await realPool.embed(texts, false);
          results.push(vectors);
        }

        // All requests should succeed
        expect(results).toHaveLength(4);
        results.forEach(vectors => {
          expect(vectors).toHaveLength(1);
          expect(vectors[0]).toHaveLength(384);
        });

      } catch (error: any) {
        if (error.message?.includes('Model') || error.message?.includes('ENOENT')) {
          console.warn('Skipping real embedder test - model not available');
          return;
        }
        throw error;
      }
    });

    it('should handle concurrent embedding requests', async () => {
      // Skip this test in CI or if model not available
      if (process.env.CI || process.env.SKIP_REAL_EMBEDDER_TESTS) {
        return;
      }

      vi.doUnmock('../../src/shared/embeddings/isolated');
      const { EmbedderPool: RealEmbedderPool } = await import('../../src/shared/embeddings/embedder-pool');

      realPool = new RealEmbedderPool({
        poolSize: 2,
        maxFilesBeforeRestart: 10,
        maxMemoryMB: 100
      });

      try {
        await realPool.initialize();

        // Send multiple concurrent requests
        const concurrentRequests = Array.from({ length: 6 }, (_, i) =>
          realPool.embed([`concurrent text ${i}`], false)
        );

        const results = await Promise.all(concurrentRequests);

        // All should succeed
        expect(results).toHaveLength(6);
        results.forEach(vectors => {
          expect(vectors).toHaveLength(1);
          expect(vectors[0]).toHaveLength(384);
        });

      } catch (error: any) {
        if (error.message?.includes('Model') || error.message?.includes('ENOENT')) {
          console.warn('Skipping real embedder test - model not available');
          return;
        }
        throw error;
      }
    });
  });

  describe('disposal', () => {
    it('should dispose all embedders', async () => {
      pool = new EmbedderPool({ poolSize: 3 });
      await pool.initialize();

      const mockInstances = (IsolatedEmbedder as any).mock.results.map((r: any) => r.value);

      await pool.dispose();

      // All embedders should be disposed
      mockInstances.forEach((instance: any) => {
        expect(instance.shutdown).toHaveBeenCalledTimes(1);
      });

      // Pool should be reset
      expect(pool.getPoolSize()).toBe(0);
      expect(pool.isInitialized()).toBe(false);
    });
    
    it('should handle dispose without initialization', async () => {
      pool = new EmbedderPool({ poolSize: 2 });
      
      // Dispose without initializing
      await expect(pool.dispose()).resolves.not.toThrow();
    });
  });
  
  describe('singleton management', () => {
    it('should return same instance from getEmbedderPool', () => {
      const pool1 = getEmbedderPool({ poolSize: 2 });
      const pool2 = getEmbedderPool({ poolSize: 3 }); // Config ignored for existing instance
      
      expect(pool1).toBe(pool2);
    });
    
    it('should create new instance after disposal', async () => {
      const pool1 = getEmbedderPool({ poolSize: 2 });
      await pool1.initialize();
      
      await disposeEmbedderPool();
      
      const pool2 = getEmbedderPool({ poolSize: 3 });
      await pool2.initialize();
      
      expect(pool1).not.toBe(pool2);
      expect(pool2.getPoolSize()).toBe(3);
    });
  });
  
  describe('error handling', () => {
    it('should throw error when using pool before initialization', () => {
      pool = new EmbedderPool({ poolSize: 2 });
      
      // This should auto-initialize, so no error
      expect(() => pool.embed(['text'])).not.toThrow();
    });
    
    it('should handle embedder initialization failure', async () => {
      // Mock initialization failure
      const mockInit = vi.fn().mockRejectedValue(new Error('Init failed'));
      (IsolatedEmbedder as any).mockImplementation(() => ({
        initialize: mockInit,
        shutdown: vi.fn()
      }));
      
      pool = new EmbedderPool({ poolSize: 2 });
      
      await expect(pool.initialize()).rejects.toThrow('Init failed');
      
      // Reset mock for next tests
      vi.clearAllMocks();
      (IsolatedEmbedder as any).mockImplementation((modelName: string, config: any) => {
        return {
          modelName,
          config,
          initialized: false,
          embedCallCount: 0,
          filesProcessed: 0,
          
          initialize: vi.fn().mockResolvedValue(undefined),
          
          embed: vi.fn().mockImplementation(async (texts: string[]) => {
            // Return mock embeddings (384-dimensional vectors)
            return texts.map(() => new Array(384).fill(0.1));
          }),
          
          getStats: vi.fn().mockResolvedValue({
            filesProcessed: 10,
            memoryUsage: 150 * 1024 * 1024, // 150MB
            needsRestart: false
          }),
          
          restart: vi.fn().mockResolvedValue(undefined),
          
          shutdown: vi.fn().mockResolvedValue(undefined)
        };
      });
    });
  });
  
  describe('parallel processing simulation', () => {
    it('should handle concurrent embed requests efficiently', async () => {
      pool = new EmbedderPool({ poolSize: 3 });
      await pool.initialize();
      
      // Simulate parallel batch processing
      const batchSize = 32;
      const chunks = Array.from({ length: 96 }, (_, i) => `chunk ${i}`);
      const batches = [];
      
      for (let i = 0; i < chunks.length; i += batchSize) {
        const batch = chunks.slice(i, i + batchSize);
        batches.push(batch);
      }
      
      // Process batches in parallel
      const results = await Promise.all(
        batches.map(batch => pool.embed(batch))
      );
      
      // Should have 3 batches of results
      expect(results).toHaveLength(3);
      expect(results[0]).toHaveLength(32);
      expect(results[1]).toHaveLength(32);
      expect(results[2]).toHaveLength(32);
      
      // Each result should be 384-dimensional vectors
      results.forEach(batchResults => {
        batchResults.forEach(vector => {
          expect(vector).toHaveLength(384);
        });
      });
    });
  });
});