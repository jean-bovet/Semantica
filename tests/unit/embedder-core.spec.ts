import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { EmbedderCore } from '../../src/shared/embeddings/EmbedderCore';
import { IModelLoader } from '../../src/shared/embeddings/interfaces/IModelLoader';
import { IPipeline } from '../../src/shared/embeddings/interfaces/IPipeline';
import { EmbeddingProcessor } from '../../src/shared/embeddings/EmbeddingProcessor';
import { SerialQueue } from '../../src/shared/utils/SerialQueue';

describe('EmbedderCore', () => {
  let core: EmbedderCore;
  let mockModelLoader: IModelLoader;
  let mockPipeline: IPipeline;
  let processor: EmbeddingProcessor;
  let queue: SerialQueue;

  beforeEach(() => {
    // Create mock pipeline - it should return vectors matching input text count
    mockPipeline = {
      process: vi.fn().mockImplementation(async (texts: string[]) => {
        // Return vectors matching the number of input texts
        const dimension = 384;
        const vectorCount = texts.length;
        const data = new Float32Array(vectorCount * dimension).fill(0.1);
        return {
          data,
          dims: [vectorCount, dimension],
          dispose: vi.fn()
        };
      })
    };

    // Create mock model loader
    mockModelLoader = {
      loadModel: vi.fn().mockResolvedValue(mockPipeline),
      checkModelExists: vi.fn().mockReturnValue(true),
      getModelInfo: vi.fn().mockReturnValue({
        exists: true,
        path: '/path/to/model',
        size: 112 * 1024 * 1024 // 112 MB
      })
    };

    // Use real processor and queue for integration
    processor = new EmbeddingProcessor();
    queue = new SerialQueue();

    // Create core with mocked loader and real processor/queue
    core = new EmbedderCore(mockModelLoader, processor, queue);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('initialization', () => {
    it('should initialize with a model', async () => {
      await core.initialize('test-model');

      expect(mockModelLoader.loadModel).toHaveBeenCalledWith('test-model');
      expect(core.isInitialized()).toBe(true);
      expect(core.getModelName()).toBe('test-model');
    });

    it('should not re-initialize with the same model', async () => {
      await core.initialize('test-model');
      await core.initialize('test-model');

      expect(mockModelLoader.loadModel).toHaveBeenCalledTimes(1);
    });

    it('should re-initialize with a different model', async () => {
      await core.initialize('model-1');
      await core.initialize('model-2');

      expect(mockModelLoader.loadModel).toHaveBeenCalledTimes(2);
      expect(mockModelLoader.loadModel).toHaveBeenCalledWith('model-1');
      expect(mockModelLoader.loadModel).toHaveBeenCalledWith('model-2');
      expect(core.getModelName()).toBe('model-2');
    });

    it('should handle initialization failure', async () => {
      mockModelLoader.loadModel = vi.fn().mockRejectedValue(new Error('Load failed'));

      await expect(core.initialize('bad-model')).rejects.toThrow('Load failed');
      expect(core.isInitialized()).toBe(false);
    });
  });

  describe('embedding', () => {
    beforeEach(async () => {
      await core.initialize('test-model');
    });

    it('should embed document texts', async () => {
      const texts = ['test text 1', 'test text 2'];
      const vectors = await core.embed(texts, false);

      expect(mockPipeline.process).toHaveBeenCalledWith(
        ['passage: test text 1', 'passage: test text 2'],
        { pooling: 'mean', normalize: true }
      );
      expect(vectors).toHaveLength(2);
      expect(vectors[0]).toHaveLength(384);
    });

    it('should embed query texts', async () => {
      const texts = ['search query'];
      const vectors = await core.embed(texts, true);

      expect(mockPipeline.process).toHaveBeenCalledWith(
        ['query: search query'],
        { pooling: 'mean', normalize: true }
      );
      expect(vectors).toHaveLength(1);
      expect(vectors[0]).toHaveLength(384);
    });

    it('should throw error if not initialized', async () => {
      const uninitializedCore = new EmbedderCore(mockModelLoader, processor, queue);

      await expect(uninitializedCore.embed(['test'])).rejects.toThrow('EmbedderCore not initialized');
    });

    it('should handle embedding errors gracefully', async () => {
      mockPipeline.process = vi.fn().mockRejectedValue(new Error('Pipeline error'));

      await expect(core.embed(['test'])).rejects.toThrow('Pipeline error');
    });

    it('should cleanup transformer output after processing', async () => {
      const disposeFn = vi.fn();
      mockPipeline.process = vi.fn().mockResolvedValue({
        data: new Float32Array(384).fill(0.1),
        dims: [1, 384],
        dispose: disposeFn
      });

      await core.embed(['test']);

      expect(disposeFn).toHaveBeenCalled();
    });

    it('should validate output vectors', async () => {
      // Return mismatched data - says 384 dims but provides 383
      mockPipeline.process = vi.fn().mockResolvedValue({
        data: new Float32Array(383).fill(0.1), // Wrong size for claimed dimensions
        dims: [1, 384], // Claims 384 but only has 383
        dispose: vi.fn()
      });

      await expect(core.embed(['test'])).rejects.toThrow();
    });

    it('should process multiple texts in serial', async () => {
      const texts1 = ['text 1'];
      const texts2 = ['text 2'];

      // Start both embeddings concurrently
      const promise1 = core.embed(texts1);
      const promise2 = core.embed(texts2);

      const [result1, result2] = await Promise.all([promise1, promise2]);

      // Both should succeed
      expect(result1).toHaveLength(1);
      expect(result2).toHaveLength(1);

      // Pipeline should have been called twice
      expect(mockPipeline.process).toHaveBeenCalledTimes(2);
    });
  });

  describe('model checking', () => {
    it('should check if model exists', async () => {
      const exists = await core.checkModel('test-model');

      expect(mockModelLoader.checkModelExists).toHaveBeenCalledWith('test-model');
      expect(exists).toBe(true);
    });

    it('should use default model name if not specified', async () => {
      const exists = await core.checkModel();

      expect(mockModelLoader.checkModelExists).toHaveBeenCalledWith('Xenova/multilingual-e5-small');
    });

    it('should get model info', async () => {
      const info = await core.getModelInfo('test-model');

      expect(mockModelLoader.getModelInfo).toHaveBeenCalledWith('test-model');
      expect(info.exists).toBe(true);
      expect(info.size).toBe(112 * 1024 * 1024);
    });
  });

  describe('shutdown', () => {
    it('should cleanup resources on shutdown', async () => {
      await core.initialize('test-model');
      expect(core.isInitialized()).toBe(true);

      core.shutdown();

      expect(core.isInitialized()).toBe(false);
      expect(core.getModelName()).toBe(null);
    });

    it('should shutdown queue', () => {
      const shutdownSpy = vi.spyOn(queue, 'shutdown');

      core.shutdown();

      expect(shutdownSpy).toHaveBeenCalled();
    });
  });

  describe('statistics', () => {
    it('should return core statistics', async () => {
      await core.initialize('test-model');

      const stats = core.getStats();

      expect(stats).toEqual({
        initialized: true,
        modelName: 'test-model',
        queueStatus: expect.objectContaining({
          isShutdown: false
        })
      });
    });

    it('should return uninitialized stats', () => {
      const stats = core.getStats();

      expect(stats).toEqual({
        initialized: false,
        modelName: null,
        queueStatus: expect.objectContaining({
          isShutdown: false
        })
      });
    });
  });

  describe('error handling', () => {
    it('should handle pipeline processing errors', async () => {
      await core.initialize('test-model');

      mockPipeline.process = vi.fn().mockRejectedValue(new Error('GPU out of memory'));

      await expect(core.embed(['test'])).rejects.toThrow('GPU out of memory');
    });

    it('should handle invalid transformer output', async () => {
      await core.initialize('test-model');

      mockPipeline.process = vi.fn().mockResolvedValue({
        // Missing data
        dims: [1, 384]
      });

      await expect(core.embed(['test'])).rejects.toThrow();
    });

    it('should cleanup even on error', async () => {
      await core.initialize('test-model');

      const disposeFn = vi.fn();
      mockPipeline.process = vi.fn().mockImplementation(async () => {
        const output = {
          data: new Float32Array(383).fill(0.1), // Wrong size to trigger error
          dims: [1, 383],
          dispose: disposeFn
        };
        return output;
      });

      try {
        await core.embed(['test']);
      } catch {
        // Expected to throw
      }

      // Dispose should still have been called
      expect(disposeFn).toHaveBeenCalled();
    });
  });
});