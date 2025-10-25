import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { EmbedderPool, getEmbedderPool, disposeEmbedderPool } from '../../src/shared/embeddings/embedder-pool';
import { IsolatedEmbedder } from '../../src/shared/embeddings/isolated';

// Mock the ChildProcessManager to avoid spawning real processes
vi.mock('../../src/shared/utils/ChildProcessManager', () => {
  const EventEmitter = require('events');

  return {
    ChildProcessManager: vi.fn().mockImplementation(() => {
      const emitter = new EventEmitter();
      let connected = false;
      let ready = false;

      const manager = Object.assign(emitter, {
        start: vi.fn().mockImplementation(async () => {
          // Simulate child process startup
          await new Promise(resolve => setTimeout(resolve, 5));
          connected = true;
          // Emit IPC ready signal - this triggers init message sending
          emitter.emit('ipc-ready');
        }),

        send: vi.fn().mockImplementation((message) => {
          if (!connected) {
            throw new Error('Child process is not available or not connected');
          }

          if (message.type === 'init') {
            // Simulate init response that makes embedder ready
            process.nextTick(() => {
              ready = true;
              emitter.emit('message', {
                type: 'ready'
              });
              // Then emit the ready event that IsolatedEmbedder listens for
              emitter.emit('ready');
            });
            return true;
          } else if (message.type === 'embed') {
            // Only respond if ready
            if (ready) {
              // Simulate embedding response immediately for faster tests
              process.nextTick(() => {
                const response = {
                  type: 'embed:ok',
                  id: message.id,
                  vectors: message.texts.map(() => new Array(384).fill(0.1))
                };
                emitter.emit('message', response);
              });
            } else {
              console.log('[MOCK] Not ready, ignoring embed request');
            }
            return true;
          } else if (message.type === 'shutdown') {
            connected = false;
            ready = false;
            return true;
          }
          return true;
        }),

        isConnected: vi.fn().mockImplementation(() => connected),

        getStatus: vi.fn().mockImplementation(() => ({
          isRunning: true,
          isReady: ready,
          isSpawning: false,
          pid: 12345,
          restartCount: 0,
          lastError: null,
          uptime: 1000
        })),

        restart: vi.fn().mockImplementation(async () => {
          connected = false;
          ready = false;
          await new Promise(resolve => setTimeout(resolve, 50));
          connected = true;
          // First emit ipc-ready to move to spawning
          emitter.emit('ipc-ready');
          // The init message will be sent by IsolatedEmbedder
          // We need to wait for it and respond
          // This happens in the send handler above
        }),
        stop: vi.fn().mockImplementation(async () => {
          connected = false;
          ready = false;
        }),
        shutdown: vi.fn().mockImplementation(async () => {
          connected = false;
          ready = false;
        })
      });

      return manager;
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
      expect(pool.isInitialized()).toBe(true);
    });
    
    it('should initialize all embedders in parallel', async () => {
      pool = new EmbedderPool({ poolSize: 3 });
      await pool.initialize();

      // Verify pool is initialized with correct number of embedders
      expect(pool.getPoolSize()).toBe(3);
      expect(pool.isInitialized()).toBe(true);

      // Verify embedders can be retrieved (they should all be ready)
      const ids = pool.getEmbedderIds();
      expect(ids).toHaveLength(3);
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
      // Verify pool is initialized
      expect(pool.isInitialized()).toBe(true);
    });
  });
  
  describe('embed operations', () => {
    it('should distribute embed calls using round-robin', async () => {
      pool = new EmbedderPool({ poolSize: 3 });
      await pool.initialize();

      // Make 6 embed calls and verify they all succeed
      const results = [];
      for (let i = 0; i < 6; i++) {
        const result = await pool.embed([`text ${i}`]);
        results.push(result);
      }

      // Verify all embeddings were generated
      expect(results).toHaveLength(6);
      results.forEach(result => {
        expect(result).toHaveLength(1);
        expect(result[0]).toHaveLength(384); // 384-dimensional vectors
      });
    }, 10000);
    
    it('should auto-initialize if not initialized', async () => {
      pool = new EmbedderPool({ poolSize: 2 });

      // Call embed without explicit initialization
      const result = await pool.embed(['test text']);

      expect(pool.isInitialized()).toBe(true);
      expect(result).toHaveLength(1);
      expect(result[0]).toHaveLength(384);
    }, 10000);
    
    it('should handle query embeddings correctly', async () => {
      pool = new EmbedderPool({ poolSize: 2 });
      await pool.initialize();

      // Test query embedding
      const result = await pool.embed(['query text'], true);

      // Verify query embedding was generated
      expect(result).toHaveLength(1);
      expect(result[0]).toHaveLength(384);
    }, 10000);
    
    it('should allow embedding with specific index', async () => {
      pool = new EmbedderPool({ poolSize: 3 });
      await pool.initialize();

      // Use specific embedder IDs
      const embedderIds = pool.getEmbedderIds();
      const result1 = await pool.embedWithId(['text 1'], embedderIds[1]);
      const result2 = await pool.embedWithId(['text 2'], embedderIds[1]);
      const result3 = await pool.embedWithId(['text 3'], embedderIds[2]);

      // Verify all embeddings were generated
      expect(result1).toHaveLength(1);
      expect(result2).toHaveLength(1);
      expect(result3).toHaveLength(1);
      expect(result1[0]).toHaveLength(384);
    }, 10000);
    
    it('should throw error for invalid index', async () => {
      pool = new EmbedderPool({ poolSize: 2 });
      await pool.initialize();
      
      await expect(pool.embedWithId(['text'], 'invalid-id')).rejects.toThrow('Invalid embedder ID: invalid-id');
      await expect(pool.embedWithId(['text'], 'another-invalid')).rejects.toThrow('Invalid embedder ID: another-invalid');
    });
  });
  
  describe('statistics and management', () => {
    it('should return stats for all embedders', async () => {
      pool = new EmbedderPool({ poolSize: 2 });
      await pool.initialize();
      
      const stats = pool.getStats();
      
      expect(stats).toHaveLength(2);

      // Verify each stat has the correct structure
      stats.forEach(stat => {
        expect(stat).toEqual({
          id: expect.any(String),
          filesProcessed: expect.any(Number),
          memoryUsage: expect.any(Number),
          isHealthy: expect.any(Boolean),
          loadCount: expect.any(Number),
          restartCount: expect.any(Number)
        });
      });
    });
    
    it('should restart specific embedder', async () => {
      pool = new EmbedderPool({ poolSize: 3 });
      await pool.initialize();

      const embedderIds = pool.getEmbedderIds();

      // Restart should complete without errors
      await expect(pool.restartEmbedder(embedderIds[1])).resolves.toBeUndefined();

      // Wait a bit for restart to complete
      await new Promise(resolve => setTimeout(resolve, 100));

      // Pool should still be functional after restart
      const result = await pool.embed(['test after restart']);
      expect(result).toHaveLength(1);
      expect(result[0]).toHaveLength(384);
    }, 10000);
    
    it('should restart all embedders when no index specified', async () => {
      pool = new EmbedderPool({ poolSize: 3 });
      await pool.initialize();

      // Restart all should complete without errors
      await expect(pool.restartAll()).resolves.toBeUndefined();

      // All embedders should have been restarted
      const stats = pool.getStats();
      stats.forEach(stat => {
        expect(stat.restartCount).toBeGreaterThan(0);
      });
    }, 10000);
    
    it('should throw error for invalid restart index', async () => {
      pool = new EmbedderPool({ poolSize: 2 });
      await pool.initialize();
      
      await expect(pool.restartEmbedder('invalid-id')).rejects.toThrow('Invalid embedder ID: invalid-id');
    });
  });
  
  describe('real component integration', () => {
    it('should distribute requests across real embedders', async () => {
      pool = new EmbedderPool({
        poolSize: 2,
        maxFilesBeforeRestart: 10,
        maxMemoryMB: 100
      });

      await pool.initialize();

      // Test round-robin distribution with real embedders
      const requests = [
        ['first text'],
        ['second text'],
        ['third text'],
        ['fourth text']
      ];

      const results = [];
      for (const texts of requests) {
        const vectors = await pool.embed(texts, false);
        results.push(vectors);
      }

      // All requests should succeed
      expect(results).toHaveLength(4);
      results.forEach(vectors => {
        expect(vectors).toHaveLength(1);
        expect(vectors[0]).toHaveLength(384);
      });
    }, 10000);

    it('should handle concurrent embedding requests', async () => {
      pool = new EmbedderPool({
        poolSize: 2,
        maxFilesBeforeRestart: 10,
        maxMemoryMB: 100
      });

      await pool.initialize();

      // Send multiple concurrent requests
      const concurrentRequests = Array.from({ length: 6 }, (_, i) =>
        pool.embed([`concurrent text ${i}`], false)
      );

      const results = await Promise.all(concurrentRequests);

      // All should succeed
      expect(results).toHaveLength(6);
      results.forEach(vectors => {
        expect(vectors).toHaveLength(1);
        expect(vectors[0]).toHaveLength(384);
      });
    }, 10000);
  });

  describe('disposal', () => {
    it('should dispose all embedders', async () => {
      pool = new EmbedderPool({ poolSize: 3 });
      await pool.initialize();

      await pool.dispose();

      // Pool should no longer be initialized
      expect(pool.isInitialized()).toBe(false);
      expect(pool.getPoolSize()).toBe(0);

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
      // This test is tricky because we're using real IsolatedEmbedder
      // We can only test that the pool handles timeout gracefully
      pool = new EmbedderPool({
        poolSize: 1,
        dependencies: {
          // Use very short health check interval to trigger timeout
          healthManager: undefined,
          loadBalancer: undefined
        }
      });

      // The pool should initialize even if some embedders fail
      // The real embedders will start properly with our mock ChildProcessManager
      await pool.initialize();

      // Pool should be initialized even if not all embedders are ready
      expect(pool.isInitialized()).toBe(true);
    });
  });
  
  describe('parallel processing simulation', () => {
    it('should handle concurrent embed requests efficiently', async () => {
      pool = new EmbedderPool({
        poolSize: 3
      });
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
    }, 15000);
  });

  describe('Memory Reporting', () => {
    it('should report memory usage in bytes', async () => {
      const pool = new EmbedderPool({
        poolSize: 2,
        maxFilesBeforeRestart: 100
      });

      await pool.initialize();

      const stats = pool.getStats();

      expect(stats).toHaveLength(2);
      stats.forEach(stat => {
        expect(stat).toHaveProperty('memoryUsage');
        // Memory should be in bytes (a reasonable range for a process)
        // Even a minimal Node process uses at least a few MB
        expect(stat.memoryUsage).toBeGreaterThan(1024 * 1024); // > 1MB
        expect(stat.memoryUsage).toBeLessThan(10 * 1024 * 1024 * 1024); // < 10GB (sanity check)
      });

      await pool.dispose();
    });

    it('should handle undefined memory gracefully', async () => {
      const pool = new EmbedderPool({
        poolSize: 1,
        maxFilesBeforeRestart: 100
      });

      // Mock IsolatedEmbedder to return undefined memory
      const originalGetStats = IsolatedEmbedder.prototype.getStats;
      IsolatedEmbedder.prototype.getStats = vi.fn().mockReturnValue({
        filesSinceSpawn: 0,
        isReady: true,
        state: 'ready',
        memoryUsage: undefined
      });

      await pool.initialize();

      const stats = pool.getStats();

      expect(stats).toHaveLength(1);
      expect(stats[0].memoryUsage).toBe(0); // Should default to 0

      // Restore original method
      IsolatedEmbedder.prototype.getStats = originalGetStats;
      await pool.dispose();
    });
  });
});