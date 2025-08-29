import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { IEmbedder } from '../../src/shared/embeddings/IEmbedder';
import { TestEmbedder, createTestEmbedder } from '../../src/shared/embeddings/TestEmbedder';

describe('Embeddings Orchestration', () => {
  let embedder: TestEmbedder;
  
  beforeEach(() => {
    embedder = new TestEmbedder();
  });
  
  afterEach(() => {
    embedder.reset();
  });

  describe('Initialization', () => {
    it('should initialize successfully', async () => {
      const result = await embedder.initialize();
      
      expect(result).toBe(true);
      expect(embedder.getStats().isReady).toBe(true);
    });
    
    it('should track initialization calls', async () => {
      await embedder.initialize();
      await embedder.initialize(); // Second call
      
      const counts = embedder.getCallCounts();
      expect(counts.initialize).toBe(2);
    });
  });
  
  describe('Embedding', () => {
    beforeEach(async () => {
      await embedder.initialize();
    });
    
    it('should embed text successfully', async () => {
      const texts = ['Hello world', 'Test text'];
      const vectors = await embedder.embed(texts);
      
      expect(vectors).toHaveLength(2);
      expect(vectors[0]).toHaveLength(384);
      expect(embedder.getStats().filesSinceSpawn).toBe(1);
    });
    
    it('should throw when not initialized', async () => {
      const uninitializedEmbedder = new TestEmbedder();
      
      await expect(uninitializedEmbedder.embed(['test'])).rejects.toThrow('not initialized');
    });
    
    it('should handle embedding failures', async () => {
      embedder.setShouldFail(true);
      
      await expect(embedder.embed(['test'])).rejects.toThrow('Test embedding failure');
      expect(embedder.getCallCounts().failures).toBe(1);
    });
  });
  
  describe('Retry Logic', () => {
    beforeEach(async () => {
      await embedder.initialize();
    });
    
    it('should retry on failures', async () => {
      embedder.setShouldFail(true);
      
      // Will fail twice then succeed
      const vectors = await embedder.embedWithRetry(['test'], 3);
      
      expect(vectors).toHaveLength(1);
      expect(embedder.getCallCounts().failures).toBe(2); // Failed twice, succeeded on third
    });
    
    it('should throw after max retries', async () => {
      const failingEmbedder = createTestEmbedder({ shouldFail: true });
      await failingEmbedder.initialize();
      
      // Never stop failing
      failingEmbedder.setShouldFail(true);
      
      await expect(failingEmbedder.embedWithRetry(['test'], 2)).rejects.toThrow();
    });
  });
  
  describe('Memory Management', () => {
    it('should detect when restart is needed', () => {
      embedder.setShouldRestart(true);
      
      expect(embedder.shouldRestart()).toBe(true);
    });
    
    it('should restart when needed', async () => {
      await embedder.initialize();
      embedder.setShouldRestart(true);
      
      await embedder.restart();
      
      const counts = embedder.getCallCounts();
      expect(counts.restart).toBe(1);
      expect(counts.shutdown).toBe(1);
      expect(counts.initialize).toBe(2); // Initial + restart
      expect(embedder.getStats().filesSinceSpawn).toBe(0);
    });
    
    it('should track memory usage', () => {
      embedder.setMemoryUsage({ rss: 500, heapUsed: 200, external: 50 });
      
      const stats = embedder.getStats();
      expect(stats.memoryUsage?.rss).toBe(500);
      expect(stats.memoryUsage?.heapUsed).toBe(200);
      expect(stats.memoryUsage?.external).toBe(50);
    });
  });

});