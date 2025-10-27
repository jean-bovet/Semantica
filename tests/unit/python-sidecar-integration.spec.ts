/**
 * Integration test for Python Sidecar with EmbeddingQueue
 * Uses the REAL Python sidecar (not mocked) to reproduce and fix the embedding error
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { PythonSidecarService } from '../../src/main/worker/PythonSidecarService';
import { PythonSidecarClient } from '../../src/main/worker/PythonSidecarClient';
import { PythonSidecarEmbedder } from '../../src/shared/embeddings/implementations/PythonSidecarEmbedder';
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

    // Initialize with the EXACT same batch processor as worker/index.ts
    embeddingQueue.initialize(sidecarEmbedder, async (batch: any) => {
      console.log('Batch processor called with:', {
        hasChunks: !!batch.chunks,
        chunksLength: batch.chunks?.length,
        hasVectors: !!batch.vectors,
        vectorsType: typeof batch.vectors,
        vectorsIsArray: Array.isArray(batch.vectors),
        vectorsLength: batch.vectors?.length,
        batchKeys: Object.keys(batch)
      });

      try {
        // Extract file metadata from the first chunk
        const filePath = batch.chunks[0].metadata.filePath;

        console.log('Creating database rows...');
        console.log('batch.vectors:', batch.vectors);
        console.log('batch.vectors[0]:', batch.vectors?.[0]);

        // Create database rows (this is where the error happens in the app)
        const rows = batch.chunks.map((chunk: any, idx: number) => {
          console.log(`Processing chunk ${idx}:`, {
            chunkText: chunk.text.substring(0, 50),
            vectorExists: !!batch.vectors[idx],
            vectorIsArray: Array.isArray(batch.vectors[idx]),
            vectorLength: batch.vectors[idx]?.length
          });

          return {
            id: `test-${idx}`,
            path: filePath,
            text: chunk.text,
            vector: batch.vectors[idx], // This is where "Cannot read properties of undefined (reading '0')" happens
            offset: chunk.metadata.offset
          };
        });

        console.log('Batch processed successfully, rows:', rows.length);
        processedBatches.push({ chunks: batch.chunks, rows });
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
