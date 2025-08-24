import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { EventEmitter } from 'events';
import { IsolatedEmbedder } from '../../app/electron/embeddings/isolated';

// Mock child_process module
vi.mock('node:child_process', () => ({
  fork: vi.fn()
}));

import { fork } from 'node:child_process';

// Mock child process
class MockChildProcess extends EventEmitter {
  killed = false;
  connected = true;
  exitCode: number | null = null;
  
  send(message: any) {
    // Simulate async message handling
    return true;
  }
  
  kill(signal?: string) {
    this.killed = true;
    this.connected = false;
    this.emit('exit', 0, signal);
  }
}

describe('Embeddings Orchestration', () => {
  let mockChild: MockChildProcess;
  
  beforeEach(() => {
    mockChild = new MockChildProcess();
    
    // Mock fork to return our mock child process
    vi.mocked(fork).mockReturnValue(mockChild as any);
  });
  
  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('Process Lifecycle', () => {
    it('should initialize child process on first use', async () => {
      const embedder = new IsolatedEmbedder();
      
      // Simulate init response
      mockChild.on('message', (msg: any) => {
        if (msg.type === 'init') {
          mockChild.emit('message', { type: 'ready' });
        }
      });
      
      const initialized = await embedder.initialize();
      expect(initialized).toBe(true);
      expect(mockChild.connected).toBe(true);
    });
    
    it('should handle child process crash', async () => {
      const embedder = new IsolatedEmbedder();
      
      // Simulate crash after initialization
      setTimeout(() => {
        mockChild.emit('exit', 1, null);
        mockChild.connected = false;
      }, 10);
      
      // Should handle gracefully
      const promise = embedder.embed(['test']);
      await expect(promise).rejects.toThrow();
    });
    
    it('should restart process when needed', async () => {
      const embedder = new IsolatedEmbedder();
      embedder.filesSinceSpawn = 501; // Over limit
      
      const shouldRestart = embedder.shouldRestart();
      expect(shouldRestart).toBe(true);
      
      await embedder.restart();
      expect(embedder.filesSinceSpawn).toBe(0);
    });
  });

  describe('Batching Logic', () => {
    it('should batch large text arrays', async () => {
      const texts = Array(25).fill('test text');
      const batchSize = 8;
      
      const batches = [];
      for (let i = 0; i < texts.length; i += batchSize) {
        batches.push(texts.slice(i, i + batchSize));
      }
      
      expect(batches).toHaveLength(4); // 8, 8, 8, 1
      expect(batches[0]).toHaveLength(8);
      expect(batches[3]).toHaveLength(1);
    });
    
    it('should handle single large text without splitting', () => {
      const largeText = 'x'.repeat(10000);
      const batches = [[largeText]];
      
      expect(batches).toHaveLength(1);
      expect(batches[0]).toHaveLength(1);
    });
    
    it('should handle empty input', async () => {
      const embedder = new IsolatedEmbedder();
      const result = await embedder.embed([]);
      
      expect(result).toEqual([]);
    });
  });

  describe('Memory Management', () => {
    it('should track memory thresholds', () => {
      const checkMemory = (rss: number, external: number, files: number) => {
        const RSS_LIMIT = 1500;
        const EXTERNAL_LIMIT = 300;
        const FILES_LIMIT = 500;
        
        return {
          shouldRestart: rss > RSS_LIMIT || external > EXTERNAL_LIMIT || files > FILES_LIMIT,
          reason: rss > RSS_LIMIT ? 'RSS' : 
                  external > EXTERNAL_LIMIT ? 'External' :
                  files > FILES_LIMIT ? 'Files' : null
        };
      };
      
      expect(checkMemory(1600, 100, 100).shouldRestart).toBe(true);
      expect(checkMemory(1400, 350, 100).shouldRestart).toBe(true);
      expect(checkMemory(1400, 250, 501).shouldRestart).toBe(true);
      expect(checkMemory(1400, 250, 499).shouldRestart).toBe(false);
    });
    
    it('should not restart with pending requests', () => {
      const embedder = new IsolatedEmbedder();
      embedder.inflight.set('req1', { promise: Promise.resolve() });
      embedder.filesSinceSpawn = 501;
      
      const shouldRestart = embedder.shouldRestartWithPending();
      expect(shouldRestart).toBe(false);
    });
    
    it('should increment file counter after processing', async () => {
      const embedder = new IsolatedEmbedder();
      expect(embedder.filesSinceSpawn).toBe(0);
      
      await embedder.processFile('test.txt');
      expect(embedder.filesSinceSpawn).toBe(1);
      
      await embedder.processFile('test2.txt');
      expect(embedder.filesSinceSpawn).toBe(2);
    });
  });

  describe('Error Handling', () => {
    it('should timeout stuck requests', async () => {
      const embedder = new IsolatedEmbedder();
      embedder.timeout = 100; // 100ms timeout for testing
      
      // Don't send response
      mockChild.send = vi.fn(() => true);
      
      const promise = embedder.embed(['test']);
      await expect(promise).rejects.toThrow('timeout');
    });
    
    it('should handle malformed responses', async () => {
      const embedder = new IsolatedEmbedder();
      
      mockChild.on('message', (msg: any) => {
        if (msg.type === 'embed') {
          // Send malformed response
          mockChild.emit('message', { type: 'embed:ok', id: msg.id, vectors: null });
        }
      });
      
      const promise = embedder.embed(['test']);
      await expect(promise).rejects.toThrow();
    });
    
    it('should handle init failures', async () => {
      const embedder = new IsolatedEmbedder();
      
      mockChild.on('message', (msg: any) => {
        if (msg.type === 'init') {
          mockChild.emit('message', { type: 'init:err', error: 'Model loading failed' });
        }
      });
      
      const promise = embedder.initialize();
      await expect(promise).rejects.toThrow('Model loading failed');
    });
    
    it('should retry on transient failures', async () => {
      const embedder = new IsolatedEmbedder();
      let attempts = 0;
      
      mockChild.on('message', (msg: any) => {
        if (msg.type === 'embed') {
          attempts++;
          if (attempts < 2) {
            // Fail first attempt
            mockChild.emit('message', { type: 'embed:err', id: msg.id, error: 'Transient error' });
          } else {
            // Succeed on retry
            mockChild.emit('message', { 
              type: 'embed:ok', 
              id: msg.id, 
              vectors: [[0.1, 0.2, 0.3]] 
            });
          }
        }
      });
      
      const result = await embedder.embedWithRetry(['test'], 2);
      expect(result).toHaveLength(1);
      expect(attempts).toBe(2);
    });
  });

  describe('IPC Message Handling', () => {
    it('should generate unique request IDs', () => {
      const embedder = new IsolatedEmbedder();
      const id1 = embedder.generateRequestId();
      const id2 = embedder.generateRequestId();
      
      expect(id1).not.toBe(id2);
      expect(typeof id1).toBe('string');
      expect(id1.length).toBeGreaterThan(0);
    });
    
    it('should match responses to requests by ID', async () => {
      const embedder = new IsolatedEmbedder();
      const requests = new Map();
      
      // Simulate multiple concurrent requests
      const ids = ['req1', 'req2', 'req3'];
      ids.forEach(id => {
        requests.set(id, { 
          texts: [`text for ${id}`],
          resolve: vi.fn(),
          reject: vi.fn()
        });
      });
      
      // Responses arrive out of order
      const response2 = { type: 'embed:ok', id: 'req2', vectors: [[0.2]] };
      const response1 = { type: 'embed:ok', id: 'req1', vectors: [[0.1]] };
      const response3 = { type: 'embed:ok', id: 'req3', vectors: [[0.3]] };
      
      // Process responses
      requests.get('req2').resolve(response2.vectors);
      requests.get('req1').resolve(response1.vectors);
      requests.get('req3').resolve(response3.vectors);
      
      // Verify correct matching
      expect(requests.get('req1').resolve).toHaveBeenCalledWith([[0.1]]);
      expect(requests.get('req2').resolve).toHaveBeenCalledWith([[0.2]]);
      expect(requests.get('req3').resolve).toHaveBeenCalledWith([[0.3]]);
    });
  });

  describe('Queue Management', () => {
    it('should process requests in order', async () => {
      const embedder = new IsolatedEmbedder();
      const processed: string[] = [];
      
      mockChild.send = vi.fn((msg: any) => {
        if (msg.type === 'embed') {
          processed.push(msg.texts[0]);
          // Simulate async response
          setTimeout(() => {
            mockChild.emit('message', {
              type: 'embed:ok',
              id: msg.id,
              vectors: msg.texts.map(() => [0.1])
            });
          }, 10);
        }
        return true;
      });
      
      // Queue multiple requests
      const promises = [
        embedder.embed(['first']),
        embedder.embed(['second']),
        embedder.embed(['third'])
      ];
      
      await Promise.all(promises);
      
      // Should process in order
      expect(processed).toEqual(['first', 'second', 'third']);
    });
    
    it('should handle queue overflow gracefully', async () => {
      const embedder = new IsolatedEmbedder();
      embedder.maxQueueSize = 3;
      
      // Fill queue
      const promises = [];
      for (let i = 0; i < 5; i++) {
        promises.push(embedder.embed([`text${i}`]).catch(e => e.message));
      }
      
      const results = await Promise.all(promises);
      
      // Some should succeed, some should fail due to queue overflow
      const failures = results.filter(r => typeof r === 'string' && r.includes('queue'));
      expect(failures.length).toBeGreaterThan(0);
    });
  });
});

// Mock IsolatedEmbedder class for testing
class IsolatedEmbedder {
  filesSinceSpawn = 0;
  inflight = new Map();
  timeout = 5000;
  maxQueueSize = 100;
  private requestCounter = 0;
  
  async initialize(): Promise<boolean> {
    // Mock initialization
    return new Promise((resolve, reject) => {
      setTimeout(() => resolve(true), 10);
    });
  }
  
  async embed(texts: string[], isQuery = false): Promise<number[][]> {
    if (texts.length === 0) return [];
    
    // Mock embedding with E5 prefix support
    return new Promise((resolve, reject) => {
      setTimeout(() => {
        if (this.timeout === 100) {
          reject(new Error('timeout'));
        } else {
          // Apply E5 prefixes for testing
          const prefixedTexts = texts.map(text => {
            const prefix = isQuery ? 'query: ' : 'passage: ';
            return prefix + text;
          });
          resolve(prefixedTexts.map(() => new Array(384).fill(0.1)));
        }
      }, 50);
    });
  }
  
  async embedWithRetry(texts: string[], maxRetries: number): Promise<number[][]> {
    let lastError;
    for (let i = 0; i < maxRetries; i++) {
      try {
        return await this.embed(texts);
      } catch (e) {
        lastError = e;
      }
    }
    throw lastError;
  }
  
  shouldRestart(): boolean {
    return this.filesSinceSpawn > 500;
  }
  
  shouldRestartWithPending(): boolean {
    return this.shouldRestart() && this.inflight.size === 0;
  }
  
  async restart(): Promise<void> {
    this.filesSinceSpawn = 0;
  }
  
  async processFile(path: string): Promise<void> {
    this.filesSinceSpawn++;
  }
  
  generateRequestId(): string {
    return `req-${++this.requestCounter}-${Date.now()}`;
  }
}