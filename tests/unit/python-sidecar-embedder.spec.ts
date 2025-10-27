/**
 * Unit tests for PythonSidecarEmbedder
 * Tests IEmbedder interface implementation, initialization, embedding, retry logic
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { PythonSidecarEmbedder } from '../../src/shared/embeddings/implementations/PythonSidecarEmbedder';
import { PythonSidecarClient, PythonSidecarClientError } from '../../src/main/worker/PythonSidecarClient';
import type { SidecarInfoResponse } from '../../src/main/worker/PythonSidecarClient';

// Mock logger to avoid console spam in tests
vi.mock('../../src/shared/utils/logger', () => ({
  logger: {
    log: vi.fn(),
    error: vi.fn(),
    warn: vi.fn()
  }
}));

describe('PythonSidecarEmbedder', () => {
  let embedder: PythonSidecarEmbedder;
  let mockClient: any;

  beforeEach(() => {
    // Create mock client
    mockClient = {
      checkHealth: vi.fn(),
      getInfo: vi.fn(),
      embedBatch: vi.fn(),
      getBaseUrl: vi.fn(() => 'http://127.0.0.1:8421'),
      getTimeout: vi.fn(() => 30000)
    };
  });

  describe('Constructor', () => {
    it('should create embedder with default config', () => {
      embedder = new PythonSidecarEmbedder();
      expect(embedder.getModelName()).toBe('paraphrase-multilingual-mpnet-base-v2');
      expect(embedder.getBatchSize()).toBe(32);
    });

    it('should accept custom model name', () => {
      embedder = new PythonSidecarEmbedder({ modelName: 'custom-model' });
      expect(embedder.getModelName()).toBe('custom-model');
    });

    it('should accept custom batch size', () => {
      embedder = new PythonSidecarEmbedder({ batchSize: 64 });
      expect(embedder.getBatchSize()).toBe(64);
    });

    it('should accept custom client', () => {
      const customClient = new PythonSidecarClient({ port: 9000 });
      embedder = new PythonSidecarEmbedder({ client: customClient });
      expect(embedder.getClient()).toBe(customClient);
    });

    it('should default normalizeVectors to true', () => {
      embedder = new PythonSidecarEmbedder({ client: mockClient });
      const stats = embedder.getStats();
      expect(stats.isReady).toBe(false); // Not initialized yet
    });

    it('should accept normalizeVectors false', () => {
      embedder = new PythonSidecarEmbedder({
        client: mockClient,
        normalizeVectors: false
      });
      // Will be tested in embed() calls
      expect(embedder).toBeDefined();
    });
  });

  describe('initialize', () => {
    beforeEach(() => {
      embedder = new PythonSidecarEmbedder({ client: mockClient });
    });

    it('should initialize successfully when sidecar is healthy', async () => {
      mockClient.checkHealth.mockResolvedValue(true);
      mockClient.getInfo.mockResolvedValue({
        model_id: 'paraphrase-multilingual-mpnet-base-v2',
        dim: 768,
        device: 'cpu',
        version: '1.0.0'
      } as SidecarInfoResponse);

      const result = await embedder.initialize();

      expect(result).toBe(true);
      expect(mockClient.checkHealth).toHaveBeenCalled();
      expect(mockClient.getInfo).toHaveBeenCalled();
      expect(embedder.getStats().isReady).toBe(true);
    });

    it('should fail initialization when sidecar is not running', async () => {
      mockClient.checkHealth.mockResolvedValue(false);

      const result = await embedder.initialize();

      expect(result).toBe(false);
      expect(mockClient.checkHealth).toHaveBeenCalled();
      expect(embedder.getStats().isReady).toBe(false);
    });

    it('should succeed even if getInfo fails (backward compatibility)', async () => {
      mockClient.checkHealth.mockResolvedValue(true);
      mockClient.getInfo.mockRejectedValue(new Error('Info endpoint not available'));

      const result = await embedder.initialize();

      expect(result).toBe(true); // Health check passed, so we continue
      expect(embedder.getStats().isReady).toBe(true);
    });

    it('should handle errors during initialization', async () => {
      mockClient.checkHealth.mockRejectedValue(new Error('Connection refused'));

      const result = await embedder.initialize();

      expect(result).toBe(false);
      expect(embedder.getStats().isReady).toBe(false);
    });
  });

  describe('embed', () => {
    beforeEach(async () => {
      embedder = new PythonSidecarEmbedder({ client: mockClient });
      mockClient.checkHealth.mockResolvedValue(true);
      mockClient.getInfo.mockResolvedValue({
        model_id: 'test-model',
        dim: 768,
        device: 'cpu',
        version: '1.0.0'
      });
      await embedder.initialize();
    });

    it('should embed texts successfully', async () => {
      const mockVectors = [[0.1, 0.2, 0.3], [0.4, 0.5, 0.6]];
      mockClient.embedBatch.mockResolvedValue(mockVectors);

      const result = await embedder.embed(['text1', 'text2']);

      expect(result).toEqual(mockVectors);
      expect(mockClient.embedBatch).toHaveBeenCalledWith(
        ['text1', 'text2'],
        true // normalizeVectors default
      );
    });

    it('should pass normalizeVectors parameter correctly', async () => {
      const noNormalizeEmbedder = new PythonSidecarEmbedder({
        client: mockClient,
        normalizeVectors: false
      });
      await noNormalizeEmbedder.initialize();

      mockClient.embedBatch.mockResolvedValue([[0.1, 0.2]]);

      await noNormalizeEmbedder.embed(['text']);

      expect(mockClient.embedBatch).toHaveBeenCalledWith(['text'], false);
    });

    it('should return empty array for empty input', async () => {
      const result = await embedder.embed([]);

      expect(result).toEqual([]);
      expect(mockClient.embedBatch).not.toHaveBeenCalled();
    });

    it('should throw if not initialized', async () => {
      const uninitializedEmbedder = new PythonSidecarEmbedder({ client: mockClient });

      await expect(uninitializedEmbedder.embed(['test']))
        .rejects
        .toThrow('PythonSidecarEmbedder not initialized');
    });

    it('should increment files processed counter', async () => {
      mockClient.embedBatch.mockResolvedValue([[0.1, 0.2]]);

      expect(embedder.getStats().filesSinceSpawn).toBe(0);

      await embedder.embed(['text1']);
      expect(embedder.getStats().filesSinceSpawn).toBe(1);

      await embedder.embed(['text2']);
      expect(embedder.getStats().filesSinceSpawn).toBe(2);
    });

    it('should convert PythonSidecarClientError to standard Error', async () => {
      mockClient.embedBatch.mockRejectedValue(
        new PythonSidecarClientError('Network timeout', 'TIMEOUT')
      );

      await expect(embedder.embed(['test']))
        .rejects
        .toThrow('Sidecar embedding failed: Network timeout');
    });

    it('should propagate non-client errors', async () => {
      const customError = new Error('Custom error');
      mockClient.embedBatch.mockRejectedValue(customError);

      await expect(embedder.embed(['test'])).rejects.toThrow(customError);
    });
  });

  describe('embedWithRetry', () => {
    beforeEach(async () => {
      embedder = new PythonSidecarEmbedder({ client: mockClient });
      mockClient.checkHealth.mockResolvedValue(true);
      mockClient.getInfo.mockResolvedValue({
        model_id: 'test-model',
        dim: 768,
        device: 'cpu',
        version: '1.0.0'
      });
      await embedder.initialize();
    });

    it('should succeed on first attempt', async () => {
      const mockVectors = [[0.1, 0.2]];
      mockClient.embedBatch.mockResolvedValue(mockVectors);

      const result = await embedder.embedWithRetry(['text']);

      expect(result).toEqual(mockVectors);
      expect(mockClient.embedBatch).toHaveBeenCalledTimes(1);
    });

    it('should retry on failure and eventually succeed', async () => {
      const mockVectors = [[0.1, 0.2]];
      mockClient.embedBatch
        .mockRejectedValueOnce(new Error('Temporary failure'))
        .mockResolvedValue(mockVectors);

      const result = await embedder.embedWithRetry(['text'], 2);

      expect(result).toEqual(mockVectors);
      expect(mockClient.embedBatch).toHaveBeenCalledTimes(2);
    });

    it('should throw after exhausting retries', async () => {
      mockClient.embedBatch.mockRejectedValue(new Error('Persistent failure'));

      await expect(embedder.embedWithRetry(['text'], 2))
        .rejects
        .toThrow('Persistent failure');

      expect(mockClient.embedBatch).toHaveBeenCalledTimes(3); // 1 initial + 2 retries
    });

    it('should use default maxRetries of 2', async () => {
      mockClient.embedBatch.mockRejectedValue(new Error('Failure'));

      await expect(embedder.embedWithRetry(['text'])).rejects.toThrow();

      expect(mockClient.embedBatch).toHaveBeenCalledTimes(3); // 1 + 2 default retries
    });

    it('should respect custom maxRetries', async () => {
      mockClient.embedBatch.mockRejectedValue(new Error('Failure'));

      await expect(embedder.embedWithRetry(['text'], 0)).rejects.toThrow();

      expect(mockClient.embedBatch).toHaveBeenCalledTimes(1); // No retries
    });
  });

  describe('shouldRestart', () => {
    beforeEach(() => {
      embedder = new PythonSidecarEmbedder({ client: mockClient });
    });

    it('should always return false (sidecar manages itself)', async () => {
      const result = await embedder.shouldRestart();
      expect(result).toBe(false);
    });
  });

  describe('restart', () => {
    beforeEach(async () => {
      embedder = new PythonSidecarEmbedder({ client: mockClient });
      mockClient.checkHealth.mockResolvedValue(true);
      mockClient.getInfo.mockResolvedValue({
        model_id: 'test-model',
        dim: 768,
        device: 'cpu',
        version: '1.0.0'
      });
      await embedder.initialize();

      // Process some files
      mockClient.embedBatch.mockResolvedValue([[0.1, 0.2]]);
      await embedder.embed(['text1']);
      await embedder.embed(['text2']);
    });

    it('should reset stats and reinitialize', async () => {
      expect(embedder.getStats().filesSinceSpawn).toBe(2);
      expect(embedder.getStats().isReady).toBe(true);

      await embedder.restart();

      expect(embedder.getStats().filesSinceSpawn).toBe(0);
      expect(embedder.getStats().isReady).toBe(true);
      expect(mockClient.checkHealth).toHaveBeenCalledTimes(2); // Initial + after restart
    });

    it('should handle restart when not initialized', async () => {
      const uninitializedEmbedder = new PythonSidecarEmbedder({ client: mockClient });
      mockClient.checkHealth.mockResolvedValue(true);

      await uninitializedEmbedder.restart();

      expect(uninitializedEmbedder.getStats().isReady).toBe(true);
    });
  });

  describe('shutdown', () => {
    beforeEach(async () => {
      embedder = new PythonSidecarEmbedder({ client: mockClient });
      mockClient.checkHealth.mockResolvedValue(true);
      mockClient.getInfo.mockResolvedValue({
        model_id: 'test-model',
        dim: 768,
        device: 'cpu',
        version: '1.0.0'
      });
      await embedder.initialize();

      // Process some files
      mockClient.embedBatch.mockResolvedValue([[0.1, 0.2]]);
      await embedder.embed(['text']);
    });

    it('should reset state and stats', async () => {
      expect(embedder.getStats().isReady).toBe(true);
      expect(embedder.getStats().filesSinceSpawn).toBe(1);

      await embedder.shutdown();

      expect(embedder.getStats().isReady).toBe(false);
      expect(embedder.getStats().filesSinceSpawn).toBe(0);
    });

    it('should prevent embedding after shutdown', async () => {
      await embedder.shutdown();

      await expect(embedder.embed(['test']))
        .rejects
        .toThrow('not initialized');
    });
  });

  describe('getStats', () => {
    beforeEach(async () => {
      embedder = new PythonSidecarEmbedder({ client: mockClient });
      mockClient.checkHealth.mockResolvedValue(true);
      mockClient.getInfo.mockResolvedValue({
        model_id: 'test-model',
        dim: 768,
        device: 'cpu',
        version: '1.0.0'
      });
    });

    it('should return correct stats before initialization', () => {
      const stats = embedder.getStats();

      expect(stats.filesSinceSpawn).toBe(0);
      expect(stats.isReady).toBe(false);
      expect(stats.memoryUsage).toBeUndefined();
    });

    it('should return correct stats after initialization', async () => {
      await embedder.initialize();
      const stats = embedder.getStats();

      expect(stats.filesSinceSpawn).toBe(0);
      expect(stats.isReady).toBe(true);
      expect(stats.memoryUsage).toBeUndefined(); // Sidecar manages its own memory
    });

    it('should track files processed', async () => {
      await embedder.initialize();
      mockClient.embedBatch.mockResolvedValue([[0.1, 0.2]]);

      await embedder.embed(['text1']);
      expect(embedder.getStats().filesSinceSpawn).toBe(1);

      await embedder.embed(['text2']);
      expect(embedder.getStats().filesSinceSpawn).toBe(2);

      await embedder.embed(['text3']);
      expect(embedder.getStats().filesSinceSpawn).toBe(3);
    });
  });

  describe('Getter Methods', () => {
    it('should return model name', () => {
      embedder = new PythonSidecarEmbedder({
        client: mockClient,
        modelName: 'custom-model'
      });
      expect(embedder.getModelName()).toBe('custom-model');
    });

    it('should return batch size', () => {
      embedder = new PythonSidecarEmbedder({
        client: mockClient,
        batchSize: 64
      });
      expect(embedder.getBatchSize()).toBe(64);
    });

    it('should return client instance', () => {
      embedder = new PythonSidecarEmbedder({ client: mockClient });
      expect(embedder.getClient()).toBe(mockClient);
    });
  });

  describe('Integration with Client', () => {
    it('should handle concurrent embed calls (serialized by client)', async () => {
      embedder = new PythonSidecarEmbedder({ client: mockClient });
      mockClient.checkHealth.mockResolvedValue(true);
      mockClient.getInfo.mockResolvedValue({
        model_id: 'test-model',
        dim: 768,
        device: 'cpu',
        version: '1.0.0'
      });
      await embedder.initialize();

      mockClient.embedBatch
        .mockResolvedValueOnce([[0.1, 0.2]])
        .mockResolvedValueOnce([[0.3, 0.4]])
        .mockResolvedValueOnce([[0.5, 0.6]]);

      // Fire off multiple requests
      const [result1, result2, result3] = await Promise.all([
        embedder.embed(['text1']),
        embedder.embed(['text2']),
        embedder.embed(['text3'])
      ]);

      expect(result1).toEqual([[0.1, 0.2]]);
      expect(result2).toEqual([[0.3, 0.4]]);
      expect(result3).toEqual([[0.5, 0.6]]);
      expect(embedder.getStats().filesSinceSpawn).toBe(3);
    });
  });
});
