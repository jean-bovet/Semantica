import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { EmbeddingQueue, ProcessedBatch } from '../../src/main/core/embedding/EmbeddingQueue';
import type { IEmbedder } from '../../src/shared/embeddings/IEmbedder';

describe('EmbeddingQueue - Dynamic Token-Based Batching', () => {
  let queue: EmbeddingQueue;
  let mockEmbedder: IEmbedder;
  let processedBatches: ProcessedBatch[] = [];

  beforeEach(async () => {
    vi.clearAllMocks();
    processedBatches = [];

    // Create a mock embedder
    mockEmbedder = {
      initialize: vi.fn().mockResolvedValue(true),
      embed: vi.fn().mockImplementation(async (texts: string[]) => {
        await new Promise(r => setTimeout(r, 10));
        return texts.map(() => new Array(1024).fill(0.1));
      }),
      shouldRestart: vi.fn().mockResolvedValue(false),
      restart: vi.fn().mockResolvedValue(undefined),
      shutdown: vi.fn().mockResolvedValue(undefined),
      getStats: vi.fn().mockReturnValue({
        filesSinceSpawn: 0,
        isReady: true
      }),
      getBatchSize: vi.fn().mockReturnValue(32)
    } as unknown as IEmbedder;

    await mockEmbedder.initialize();
  });

  afterEach(() => {
    queue?.clear();
  });

  it('should batch many small chunks up to token limit', async () => {
    // Create queue with default token limit (7000)
    queue = new EmbeddingQueue({
      maxQueueSize: 200,
      batchSize: 100,
      maxTokensPerBatch: 7000
    });

    queue.initialize(mockEmbedder, async (batch) => {
      processedBatches.push(batch);
    });

    // Small chunks (50 chars each ≈ 12.5 tokens each)
    // 7000 / 12.5 ≈ 560 chunks could fit, but batchSize limits to 100
    const smallChunks = Array.from({ length: 60 }, (_, i) => ({
      text: 'Small chunk text here that is about 50 characters.',
      offset: i * 100
    }));

    await queue.addChunks(smallChunks, '/test/small-file.txt', 1);
    await queue.waitForCompletion('/test/small-file.txt');

    // Should have processed all chunks
    expect(processedBatches.length).toBeGreaterThan(0);
    const totalProcessed = processedBatches.reduce((sum, b) => sum + b.chunks.length, 0);
    expect(totalProcessed).toBe(60);
  });

  it('should batch few large chunks to stay under limit', async () => {
    queue = new EmbeddingQueue({
      maxQueueSize: 200,
      batchSize: 32,
      maxTokensPerBatch: 7000
    });

    queue.initialize(mockEmbedder, async (batch) => {
      processedBatches.push(batch);
    });

    // Large chunks (2000 chars each ≈ 500 tokens each)
    // 7000 / 500 = 14 chunks max per batch
    const largeText = 'A'.repeat(2000);
    const largeChunks = Array.from({ length: 30 }, (_, i) => ({
      text: largeText,
      offset: i * 2000
    }));

    await queue.addChunks(largeChunks, '/test/large-file.txt', 1);
    await queue.waitForCompletion('/test/large-file.txt');

    // Check that batch sizes are reasonable (not exceeding token limit)
    for (const batch of processedBatches) {
      const estimatedTokens = batch.chunks.reduce((sum, chunk) =>
        sum + Math.ceil(chunk.text.length / 4), 0
      );
      // Should be under or close to 7000 tokens
      expect(estimatedTokens).toBeLessThanOrEqual(7100); // Small margin for rounding
    }

    // Should have processed all chunks
    const totalProcessed = processedBatches.reduce((sum, b) => sum + b.chunks.length, 0);
    expect(totalProcessed).toBe(30);
  });

  it('should handle single huge chunk exceeding limit', async () => {
    queue = new EmbeddingQueue({
      maxQueueSize: 200,
      batchSize: 32,
      maxTokensPerBatch: 7000
    });

    queue.initialize(mockEmbedder, async (batch) => {
      processedBatches.push(batch);
    });

    // Huge chunk (40000 chars ≈ 10000 tokens - exceeds limit!)
    const hugeText = 'B'.repeat(40000);
    const hugeChunk = [{ text: hugeText, offset: 0 }];

    await queue.addChunks(hugeChunk, '/test/huge-file.txt', 1);
    await queue.waitForCompletion('/test/huge-file.txt');

    // Should still process it (with warning in logs)
    expect(processedBatches).toHaveLength(1);
    expect(processedBatches[0].chunks).toHaveLength(1);
  });

  it('should handle mixed chunk sizes intelligently', async () => {
    queue = new EmbeddingQueue({
      maxQueueSize: 200,
      batchSize: 32,
      maxTokensPerBatch: 7000
    });

    queue.initialize(mockEmbedder, async (batch) => {
      processedBatches.push(batch);
    });

    // Mix of small (200 chars ≈ 50 tokens) and large (2000 chars ≈ 500 tokens) chunks
    const mixedChunks = [
      { text: 'C'.repeat(200), offset: 0 },     // ~50 tokens
      { text: 'D'.repeat(2000), offset: 200 },  // ~500 tokens
      { text: 'E'.repeat(200), offset: 2200 },  // ~50 tokens
      { text: 'F'.repeat(2000), offset: 2400 }, // ~500 tokens
      { text: 'G'.repeat(200), offset: 4400 },  // ~50 tokens
    ];

    await queue.addChunks(mixedChunks, '/test/mixed-file.txt', 1);
    await queue.waitForCompletion('/test/mixed-file.txt');

    // Should have processed all chunks
    const totalProcessed = processedBatches.reduce((sum, b) => sum + b.chunks.length, 0);
    expect(totalProcessed).toBe(5);

    // Each batch should respect token limits
    for (const batch of processedBatches) {
      const estimatedTokens = batch.chunks.reduce((sum, chunk) =>
        sum + Math.ceil(chunk.text.length / 4), 0
      );
      expect(estimatedTokens).toBeLessThanOrEqual(7100);
    }
  });

  it('should never exceed maxTokensPerBatch (except single chunk)', async () => {
    queue = new EmbeddingQueue({
      maxQueueSize: 300,
      batchSize: 50,
      maxTokensPerBatch: 5000 // Lower limit for testing
    });

    queue.initialize(mockEmbedder, async (batch) => {
      processedBatches.push(batch);
    });

    // Create chunks that would exceed limit if batched naively
    const chunks = Array.from({ length: 100 }, (_, i) => ({
      text: 'H'.repeat(800), // ~200 tokens each
      offset: i * 800
    }));

    await queue.addChunks(chunks, '/test/token-limit.txt', 1);
    await queue.waitForCompletion('/test/token-limit.txt');

    // Check all batches respect the limit
    for (const batch of processedBatches) {
      const estimatedTokens = batch.chunks.reduce((sum, chunk) =>
        sum + Math.ceil(chunk.text.length / 4), 0
      );

      // Should be under 5000 tokens (with small margin)
      // 5000 / 200 = 25 chunks max per batch
      expect(batch.chunks.length).toBeLessThanOrEqual(25);
      expect(estimatedTokens).toBeLessThanOrEqual(5100);
    }

    // Should have processed all chunks
    const totalProcessed = processedBatches.reduce((sum, b) => sum + b.chunks.length, 0);
    expect(totalProcessed).toBe(100);
  });

  it('should maintain backward compatibility with batchSize config', async () => {
    queue = new EmbeddingQueue({
      maxQueueSize: 200,
      batchSize: 10, // Small batch size limit
      maxTokensPerBatch: 10000 // High token limit
    });

    queue.initialize(mockEmbedder, async (batch) => {
      processedBatches.push(batch);
    });

    // Small chunks that fit many in token budget
    const chunks = Array.from({ length: 50 }, (_, i) => ({
      text: 'I'.repeat(100), // ~25 tokens each
      offset: i * 100
    }));

    await queue.addChunks(chunks, '/test/batch-size-limit.txt', 1);
    await queue.waitForCompletion('/test/batch-size-limit.txt');

    // Each batch should be limited by batchSize (10), not token limit
    for (const batch of processedBatches) {
      expect(batch.chunks.length).toBeLessThanOrEqual(10);
    }

    // Should have processed all chunks
    const totalProcessed = processedBatches.reduce((sum, b) => sum + b.chunks.length, 0);
    expect(totalProcessed).toBe(50);
  });

  it('should adapt to custom maxTokensPerBatch values', async () => {
    queue = new EmbeddingQueue({
      maxQueueSize: 200,
      batchSize: 50,
      maxTokensPerBatch: 3000 // Custom lower limit
    });

    queue.initialize(mockEmbedder, async (batch) => {
      processedBatches.push(batch);
    });

    const chunks = Array.from({ length: 40 }, (_, i) => ({
      text: 'J'.repeat(600), // ~150 tokens each
      offset: i * 600
    }));

    await queue.addChunks(chunks, '/test/custom-limit.txt', 1);
    await queue.waitForCompletion('/test/custom-limit.txt');

    // Check batches respect the custom limit (3000 tokens)
    // 3000 / 150 = 20 chunks max per batch
    for (const batch of processedBatches) {
      expect(batch.chunks.length).toBeLessThanOrEqual(20);

      const estimatedTokens = batch.chunks.reduce((sum, chunk) =>
        sum + Math.ceil(chunk.text.length / 4), 0
      );
      expect(estimatedTokens).toBeLessThanOrEqual(3100);
    }

    const totalProcessed = processedBatches.reduce((sum, b) => sum + b.chunks.length, 0);
    expect(totalProcessed).toBe(40);
  });

  it('should use default maxTokensPerBatch of 7000 when not specified', async () => {
    queue = new EmbeddingQueue({
      maxQueueSize: 200,
      batchSize: 50
      // maxTokensPerBatch not specified - should default to 7000
    });

    queue.initialize(mockEmbedder, async (batch) => {
      processedBatches.push(batch);
    });

    // Create chunks that would hit the 7000 token limit
    const chunks = Array.from({ length: 40 }, (_, i) => ({
      text: 'K'.repeat(1200), // ~300 tokens each
      offset: i * 1200
    }));

    await queue.addChunks(chunks, '/test/default-limit.txt', 1);
    await queue.waitForCompletion('/test/default-limit.txt');

    // Should respect default 7000 token limit
    // 7000 / 300 = ~23 chunks max per batch
    for (const batch of processedBatches) {
      const estimatedTokens = batch.chunks.reduce((sum, chunk) =>
        sum + Math.ceil(chunk.text.length / 4), 0
      );
      expect(estimatedTokens).toBeLessThanOrEqual(7100);
    }

    const totalProcessed = processedBatches.reduce((sum, b) => sum + b.chunks.length, 0);
    expect(totalProcessed).toBe(40);
  });

  it('should handle empty chunks gracefully', async () => {
    queue = new EmbeddingQueue({
      maxQueueSize: 200,
      batchSize: 32,
      maxTokensPerBatch: 7000
    });

    queue.initialize(mockEmbedder, async (batch) => {
      processedBatches.push(batch);
    });

    const chunks = [
      { text: '', offset: 0 },
      { text: 'L'.repeat(100), offset: 1 },
      { text: '', offset: 101 }
    ];

    await queue.addChunks(chunks, '/test/empty-chunks.txt', 1);
    await queue.waitForCompletion('/test/empty-chunks.txt');

    // Should process all chunks including empty ones
    const totalProcessed = processedBatches.reduce((sum, b) => sum + b.chunks.length, 0);
    expect(totalProcessed).toBe(3);
  });

  it('should handle queue with single small chunk', async () => {
    queue = new EmbeddingQueue({
      maxQueueSize: 200,
      batchSize: 32,
      maxTokensPerBatch: 7000
    });

    queue.initialize(mockEmbedder, async (batch) => {
      processedBatches.push(batch);
    });

    const singleChunk = [{ text: 'M'.repeat(50), offset: 0 }];

    await queue.addChunks(singleChunk, '/test/single-chunk.txt', 1);
    await queue.waitForCompletion('/test/single-chunk.txt');

    // Should process the single chunk
    expect(processedBatches).toHaveLength(1);
    expect(processedBatches[0].chunks).toHaveLength(1);
  });
});
