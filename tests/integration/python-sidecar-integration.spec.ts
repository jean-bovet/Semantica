/**
 * Integration test for Python Sidecar with EmbeddingQueue
 * Uses the REAL Python sidecar (not mocked) to reproduce and fix the embedding error
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { PythonSidecarService } from '../../src/main/worker/PythonSidecarService';
import { PythonSidecarClient } from '../../src/main/worker/PythonSidecarClient';
import { PythonSidecarEmbedder } from '../../src/main/worker/embeddings/PythonSidecarEmbedder';
import { EmbeddingQueue } from '../../src/main/core/embedding/EmbeddingQueue';

describe('Python Sidecar Integration (Real Sidecar)', () => {
  let sidecarService: PythonSidecarService;
  let sidecarClient: PythonSidecarClient;
  let sidecarEmbedder: PythonSidecarEmbedder;
  let embeddingQueue: EmbeddingQueue;

  beforeAll(async () => {
    console.log('Starting Python sidecar for testing...');

    // Create sidecar client and service
    sidecarClient = new PythonSidecarClient({ port: 8421 });
    sidecarService = new PythonSidecarService({
      client: sidecarClient,
      port: 8421,
      autoRestart: false
    });

    // Start the sidecar
    const started = await sidecarService.startSidecar();
    expect(started).toBe(true);

    // Create embedder
    sidecarEmbedder = new PythonSidecarEmbedder({
      modelName: 'paraphrase-multilingual-mpnet-base-v2',
      batchSize: 32,
      client: sidecarClient,
      normalizeVectors: true
    });

    // Initialize embedder
    const initialized = await sidecarEmbedder.initialize();
    expect(initialized).toBe(true);

    console.log('Python sidecar initialized successfully');
  }, 60000); // 60s timeout for startup

  afterAll(async () => {
    console.log('Stopping Python sidecar...');
    if (sidecarEmbedder) {
      await sidecarEmbedder.shutdown();
    }
    if (sidecarService) {
      await sidecarService.stopSidecar();
    }
  });

  it('should embed a single text successfully', async () => {
    const texts = ['This is a test sentence for embedding.'];

    console.log('Calling embedder.embed()...');
    const vectors = await sidecarEmbedder.embed(texts);

    console.log('Received vectors:', {
      isArray: Array.isArray(vectors),
      length: vectors.length,
      firstVectorIsArray: Array.isArray(vectors[0]),
      firstVectorLength: vectors[0]?.length,
      type: typeof vectors
    });

    expect(vectors).toBeDefined();
    expect(Array.isArray(vectors)).toBe(true);
    expect(vectors.length).toBe(1);
    expect(Array.isArray(vectors[0])).toBe(true);
    expect(vectors[0].length).toBe(768); // multilingual-mpnet-base-v2 dimensions
  });

  it('should embed multiple texts successfully', async () => {
    const texts = [
      'First test sentence.',
      'Second test sentence.',
      'Third test sentence.'
    ];

    console.log('Calling embedder.embed() with multiple texts...');
    const vectors = await sidecarEmbedder.embed(texts);

    console.log('Received vectors:', {
      isArray: Array.isArray(vectors),
      length: vectors.length,
      firstVectorIsArray: Array.isArray(vectors[0]),
      firstVectorLength: vectors[0]?.length
    });

    expect(vectors).toBeDefined();
    expect(Array.isArray(vectors)).toBe(true);
    expect(vectors.length).toBe(3);
    vectors.forEach((vector, idx) => {
      expect(Array.isArray(vector)).toBe(true);
      expect(vector.length).toBe(768);
    });
  });

  it('should handle concurrent embedding requests', async () => {
    const texts = [
      'Concurrent request 1',
      'Concurrent request 2',
      'Concurrent request 3'
    ];

    console.log('Testing concurrent requests...');
    // Fire off multiple requests simultaneously
    const [result1, result2, result3] = await Promise.all([
      sidecarEmbedder.embed([texts[0]]),
      sidecarEmbedder.embed([texts[1]]),
      sidecarEmbedder.embed([texts[2]])
    ]);

    expect(result1).toBeDefined();
    expect(result2).toBeDefined();
    expect(result3).toBeDefined();
    expect(result1[0].length).toBe(768);
    expect(result2[0].length).toBe(768);
    expect(result3[0].length).toBe(768);
  });

  it('should handle large batches (50+ texts)', async () => {
    // Create 50 test texts
    const texts = Array.from({ length: 50 }, (_, i) => `Test text number ${i} with some content to embed.`);

    console.log('Embedding large batch of 50 texts...');
    const startTime = Date.now();
    const vectors = await sidecarEmbedder.embed(texts);
    const duration = Date.now() - startTime;

    console.log(`Large batch completed in ${duration}ms`);
    console.log(`Throughput: ${(texts.length / (duration / 1000)).toFixed(1)} texts/sec`);

    expect(vectors.length).toBe(50);
    vectors.forEach(vector => {
      expect(vector.length).toBe(768);
    });
  });

  it('should process chunks through EmbeddingQueue with batch processor', async () => {
    // This is the REAL test that reproduces the error from the app

    const processedBatches: any[] = [];
    let batchProcessorError: Error | null = null;

    // Create embedding queue with batch processor (like in worker/index.ts)
    embeddingQueue = new EmbeddingQueue({
      maxQueueSize: 100,
      batchSize: 2,
      maxTokensPerBatch: 7000,
      backpressureThreshold: 50
    });

    // Initialize with the REAL batch processor from production code
    // Import the pure function to use with custom file stats provider
    const { processBatchToRows } = await import('../../src/main/worker/batch/processor');

    // Create custom batch processor using the real processBatchToRows with mock file stats
    embeddingQueue.initialize(sidecarEmbedder, async (batch: any) => {
      try {
        // Mock file stats provider (test doesn't need real files)
        const mockFileStatsProvider = async (filePath: string) => {
          return { mtime: Date.now() };
        };

        // Use the REAL production code to process batch to rows
        const rows = await processBatchToRows(batch, mockFileStatsProvider);

        console.log('Mock table received rows:', rows.length);
        console.log('First row sample:', {
          hasVector: !!rows[0]?.vector,
          vectorIsArray: Array.isArray(rows[0]?.vector),
          vectorLength: rows[0]?.vector?.length
        });

        processedBatches.push({ chunks: rows.map(r => ({ text: r.text, offset: r.offset })), rows });
      } catch (error) {
        console.error('Batch processor error:', error);
        batchProcessorError = error as Error;
        throw error;
      }
    });

    // Add test chunks to the queue
    const testChunks = [
      { text: 'First chunk of text for testing.', offset: 0 },
      { text: 'Second chunk of text for testing.', offset: 100 }
    ];

    console.log('Adding chunks to queue...');
    await embeddingQueue.addChunks(testChunks, '/test/file.txt', 0);

    // Start processing
    console.log('Starting queue processing...');
    embeddingQueue.startProcessing();

    // Wait for processing to complete
    await new Promise(resolve => setTimeout(resolve, 5000));

    // Check results
    console.log('Processed batches:', processedBatches.length);
    if (batchProcessorError) {
      console.error('Batch processor failed with error:', batchProcessorError);
      throw batchProcessorError;
    }

    expect(batchProcessorError).toBeNull();
    expect(processedBatches.length).toBeGreaterThan(0);
    expect(processedBatches[0].rows).toHaveLength(2);
    expect(processedBatches[0].rows[0].vector).toBeDefined();
    expect(Array.isArray(processedBatches[0].rows[0].vector)).toBe(true);
    expect(processedBatches[0].rows[0].vector.length).toBe(768);
  }, 30000);
});
