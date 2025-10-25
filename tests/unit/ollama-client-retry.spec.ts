import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { OllamaClient, OllamaClientError } from '../../src/main/worker/OllamaClient';

// Mock logger to prevent log output during tests
vi.mock('../../src/shared/utils/logger', () => ({
  logger: {
    log: vi.fn(),
    error: vi.fn(),
  },
}));

describe('OllamaClient - Retry Logic', () => {
  let client: OllamaClient;
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    // Create client with shorter timeout and delay for faster tests
    client = new OllamaClient({
      baseUrl: 'http://localhost:11434',
      timeout: 5000,
      retryAttempts: 3,
      retryDelay: 10, // 10ms instead of 1000ms for faster tests
    });

    // Mock global fetch
    fetchMock = vi.fn();
    global.fetch = fetchMock;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('HTTP 5xx Server Errors', () => {
    it('should retry on HTTP 500 errors', async () => {
      // First two attempts fail with 500, third succeeds
      fetchMock
        .mockResolvedValueOnce({
          ok: false,
          status: 500,
          text: async () => '{"error":"Internal server error"}',
        })
        .mockResolvedValueOnce({
          ok: false,
          status: 500,
          text: async () => '{"error":"Internal server error"}',
        })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ models: [] }),
        });

      const result = await client.listModels();

      expect(result).toEqual([]);
      expect(fetchMock).toHaveBeenCalledTimes(3);
    });

    it('should retry on HTTP 503 (Service Unavailable)', async () => {
      fetchMock
        .mockResolvedValueOnce({
          ok: false,
          status: 503,
          text: async () => '{"error":"Service unavailable"}',
        })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ models: [] }),
        });

      const result = await client.listModels();

      expect(result).toEqual([]);
      expect(fetchMock).toHaveBeenCalledTimes(2);
    });

    it('should throw after max retries on persistent 500 errors', async () => {
      fetchMock.mockResolvedValue({
        ok: false,
        status: 500,
        text: async () => '{"error":"Persistent server error"}',
      });

      await expect(client.listModels()).rejects.toThrow(OllamaClientError);
      expect(fetchMock).toHaveBeenCalledTimes(3); // Initial + 2 retries = 3
    });
  });

  describe('HTTP 4xx Client Errors', () => {
    it('should NOT retry on HTTP 404 (Not Found)', async () => {
      fetchMock.mockResolvedValue({
        ok: false,
        status: 404,
        text: async () => '{"error":"Not found"}',
      });

      await expect(client.listModels()).rejects.toThrow(OllamaClientError);
      expect(fetchMock).toHaveBeenCalledTimes(1); // No retries
    });

    it('should NOT retry on HTTP 400 (Bad Request)', async () => {
      fetchMock.mockResolvedValue({
        ok: false,
        status: 400,
        text: async () => '{"error":"Bad request"}',
      });

      await expect(client.listModels()).rejects.toThrow(OllamaClientError);
      expect(fetchMock).toHaveBeenCalledTimes(1); // No retries
    });

    it('should NOT retry on HTTP 401 (Unauthorized)', async () => {
      fetchMock.mockResolvedValue({
        ok: false,
        status: 401,
        text: async () => '{"error":"Unauthorized"}',
      });

      await expect(client.listModels()).rejects.toThrow(OllamaClientError);
      expect(fetchMock).toHaveBeenCalledTimes(1); // No retries
    });
  });

  describe('Network Errors', () => {
    it('should retry on ECONNREFUSED errors', async () => {
      fetchMock
        .mockRejectedValueOnce(new Error('connect ECONNREFUSED 127.0.0.1:11434'))
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ models: [] }),
        });

      const result = await client.listModels();

      expect(result).toEqual([]);
      expect(fetchMock).toHaveBeenCalledTimes(2);
    });

    it('should retry on ETIMEDOUT errors', async () => {
      fetchMock
        .mockRejectedValueOnce(new Error('request ETIMEDOUT'))
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ models: [] }),
        });

      const result = await client.listModels();

      expect(result).toEqual([]);
      expect(fetchMock).toHaveBeenCalledTimes(2);
    });

    it('should retry on EOF errors', async () => {
      fetchMock
        .mockRejectedValueOnce(new Error('read EOF'))
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ models: [] }),
        });

      const result = await client.listModels();

      expect(result).toEqual([]);
      expect(fetchMock).toHaveBeenCalledTimes(2);
    });

    it('should retry on fetch failed errors', async () => {
      fetchMock
        .mockRejectedValueOnce(new Error('fetch failed'))
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ models: [] }),
        });

      const result = await client.listModels();

      expect(result).toEqual([]);
      expect(fetchMock).toHaveBeenCalledTimes(2);
    });

    it('should throw after max retries on persistent network errors', async () => {
      fetchMock.mockRejectedValue(new Error('connect ECONNREFUSED 127.0.0.1:11434'));

      await expect(client.listModels()).rejects.toThrow('ECONNREFUSED');
      expect(fetchMock).toHaveBeenCalledTimes(3); // Initial + 2 retries = 3
    });
  });

  describe('Exponential Backoff', () => {
    it('should use exponential backoff between retries', async () => {
      const startTime = Date.now();

      fetchMock
        .mockResolvedValueOnce({
          ok: false,
          status: 500,
          text: async () => '{"error":"Server error"}',
        })
        .mockResolvedValueOnce({
          ok: false,
          status: 500,
          text: async () => '{"error":"Server error"}',
        })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ models: [] }),
        });

      await client.listModels();

      const elapsed = Date.now() - startTime;

      // With retryDelay=10ms:
      // First retry: 10ms * 2^0 = 10ms
      // Second retry: 10ms * 2^1 = 20ms
      // Total: ~30ms minimum
      expect(elapsed).toBeGreaterThanOrEqual(25);
      expect(fetchMock).toHaveBeenCalledTimes(3);
    });
  });

  describe('Success Cases', () => {
    it('should succeed on first attempt without retries', async () => {
      fetchMock.mockResolvedValue({
        ok: true,
        json: async () => ({ models: [{ name: 'bge-m3', size: 1000 }] }),
      });

      const result = await client.listModels();

      expect(result).toEqual([{ name: 'bge-m3', size: 1000 }]);
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });
  });

  describe('Real-world EOF Error', () => {
    it('should retry on Ollama EOF error (HTTP 500)', async () => {
      // Simulate the actual error from the user's logs
      fetchMock
        .mockResolvedValueOnce({
          ok: false,
          status: 500,
          text: async () => '{"error":"do embedding request: Post \\"http://127.0.0.1:60635/embedding\\": EOF"}',
        })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ embeddings: [[0.1, 0.2, 0.3]] }),
        });

      const result = await client.embedBatch(['test text']);

      expect(result).toEqual([[0.1, 0.2, 0.3]]);
      expect(fetchMock).toHaveBeenCalledTimes(2);
    });
  });
});
