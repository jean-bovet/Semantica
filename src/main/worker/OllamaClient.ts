/**
 * OllamaClient - HTTP client for Ollama API
 *
 * Provides methods to interact with a local Ollama server for embeddings.
 * Ollama runs as a separate service (http://127.0.0.1:11434) providing
 * isolation from the Electron process and efficient memory management.
 */

import { logger } from '../../shared/utils/logger';

export interface OllamaEmbedRequest {
  model: string;
  input: string[];
}

export interface OllamaEmbedResponse {
  embeddings: number[][];
  model: string;
}

export interface OllamaModel {
  name: string;
  size: number;
  digest: string;
  modified_at: string;
}

export interface OllamaListResponse {
  models: OllamaModel[];
}

export interface OllamaPullProgress {
  status: string;
  digest?: string;
  total?: number;
  completed?: number;
}

export interface DownloadProgress {
  file: string;
  progress: number;  // 0-100
  loaded: number;    // bytes
  total: number;     // bytes
  status: string;
}

export interface OllamaClientConfig {
  baseUrl?: string;
  timeout?: number;
  retryAttempts?: number;
  retryDelay?: number;
}

export class OllamaClientError extends Error {
  constructor(
    message: string,
    public readonly code?: string,
    public readonly statusCode?: number
  ) {
    super(message);
    this.name = 'OllamaClientError';
  }
}

/**
 * Client for interacting with Ollama HTTP API
 */
export class OllamaClient {
  private readonly baseUrl: string;
  private readonly timeout: number;
  private readonly retryAttempts: number;
  private readonly retryDelay: number;

  constructor(config: OllamaClientConfig = {}) {
    this.baseUrl = config.baseUrl || 'http://127.0.0.1:11434';
    this.timeout = config.timeout || 300000; // 5 minutes default for embeddings
    this.retryAttempts = config.retryAttempts || 3;
    this.retryDelay = config.retryDelay || 1000;
  }

  /**
   * Generate embeddings for a batch of texts
   * @param texts Array of strings to embed
   * @param model Model name (e.g., 'bge-m3')
   * @param keepAlive Time to keep model loaded (default: '2m')
   * @returns Array of embedding vectors
   */
  async embedBatch(
    texts: string[],
    model: string = 'bge-m3',
    keepAlive: string = '2m'
  ): Promise<number[][]> {
    if (texts.length === 0) {
      return [];
    }

    const response = await this.fetchWithRetry<OllamaEmbedResponse>(
      '/api/embed',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model,
          input: texts,
          keep_alive: keepAlive,
        }),
      }
    );

    if (!response.embeddings || !Array.isArray(response.embeddings)) {
      throw new OllamaClientError('Invalid response format: missing embeddings array');
    }

    return response.embeddings;
  }

  /**
   * List all available models in Ollama
   */
  async listModels(): Promise<OllamaModel[]> {
    const response = await this.fetchWithRetry<OllamaListResponse>('/api/tags', {
      method: 'GET',
    });

    return response.models || [];
  }

  /**
   * Check if a specific model is available
   */
  async hasModel(modelName: string): Promise<boolean> {
    try {
      const models = await this.listModels();
      return models.some((m) => m.name === modelName || m.name.startsWith(modelName + ':'));
    } catch (error) {
      return false;
    }
  }

  /**
   * Pull (download) a model from Ollama registry
   * @param model Model name (e.g., 'bge-m3')
   * @param onProgress Callback for download progress (compatible with existing UI)
   */
  async pullModel(
    model: string,
    onProgress?: (progress: DownloadProgress) => void
  ): Promise<void> {
    const response = await fetch(`${this.baseUrl}/api/pull`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: model, stream: true }),
      signal: AbortSignal.timeout(600000), // 10 minute timeout for downloads
    });

    if (!response.ok) {
      const errorText = await response.text().catch(() => 'Unknown error');
      throw new OllamaClientError(
        `Failed to pull model ${model}: ${errorText}`,
        'PULL_FAILED',
        response.status
      );
    }

    if (!response.body) {
      throw new OllamaClientError('No response body for pull request', 'NO_BODY');
    }

    // Process streaming response and convert to UI-compatible format
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let totalBytes = 0;
    let completedBytes = 0;
    let currentLayer = '';

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          if (line.trim()) {
            try {
              const ollamaProgress = JSON.parse(line) as OllamaPullProgress;

              // Track total and completed bytes from Ollama's progress
              if (ollamaProgress.total !== undefined) {
                totalBytes = ollamaProgress.total;
              }
              if (ollamaProgress.completed !== undefined) {
                completedBytes = ollamaProgress.completed;
              }

              // Track current layer being downloaded
              if (ollamaProgress.digest) {
                currentLayer = ollamaProgress.digest.substring(0, 12); // Short hash
              }

              // Convert to UI-compatible format
              const uiProgress: DownloadProgress = {
                file: currentLayer || model,
                progress: totalBytes > 0 ? Math.round((completedBytes / totalBytes) * 100) : 0,
                loaded: completedBytes,
                total: totalBytes,
                status: ollamaProgress.status
              };

              onProgress?.(uiProgress);
            } catch (e) {
              // Ignore JSON parse errors for partial lines
            }
          }
        }
      }
    } finally {
      reader.releaseLock();
    }
  }

  /**
   * Check if Ollama server is running and healthy
   */
  async checkHealth(): Promise<boolean> {
    try {
      const response = await fetch(`${this.baseUrl}/api/tags`, {
        method: 'GET',
        signal: AbortSignal.timeout(5000), // 5 second timeout
      });
      return response.ok;
    } catch (error) {
      return false;
    }
  }

  /**
   * Get Ollama version information
   */
  async getVersion(): Promise<string | null> {
    try {
      const response = await fetch(`${this.baseUrl}/api/version`, {
        method: 'GET',
        signal: AbortSignal.timeout(5000),
      });
      if (response.ok) {
        const data = await response.json();
        return data.version || null;
      }
      return null;
    } catch (error) {
      return null;
    }
  }

  /**
   * Fetch with exponential backoff retry logic
   */
  private async fetchWithRetry<T>(
    path: string,
    options: RequestInit,
    attempt: number = 1
  ): Promise<T> {
    try {
      const url = `${this.baseUrl}${path}`;
      const response = await fetch(url, {
        ...options,
        signal: AbortSignal.timeout(this.timeout),
      });

      if (!response.ok) {
        const errorText = await response.text().catch(() => 'Unknown error');
        throw new OllamaClientError(
          `HTTP ${response.status}: ${errorText}`,
          'HTTP_ERROR',
          response.status
        );
      }

      const data = await response.json();
      return data as T;
    } catch (error) {
      // Don't retry if max attempts reached or error is not retryable
      if (attempt >= this.retryAttempts || !this.isRetryableError(error)) {
        throw error;
      }

      // Log retry attempt
      logger.log('OLLAMA-CLIENT', `Retry attempt ${attempt}/${this.retryAttempts} after error:`, error);

      // Exponential backoff
      const delay = this.retryDelay * Math.pow(2, attempt - 1);
      await this.sleep(delay);

      return this.fetchWithRetry<T>(path, options, attempt + 1);
    }
  }

  /**
   * Determine if an error should be retried
   * Retries on:
   * - Server errors (HTTP 5xx) - transient issues like EOF, timeouts
   * - Network errors (connection refused, etc.)
   * Does not retry on:
   * - Client errors (HTTP 4xx) - bad request, not found, etc.
   */
  private isRetryableError(error: unknown): boolean {
    if (error instanceof OllamaClientError) {
      // Retry on server errors (500-599)
      if (error.statusCode && error.statusCode >= 500 && error.statusCode < 600) {
        return true;
      }
      // Don't retry on client errors (400-499)
      if (error.statusCode && error.statusCode >= 400 && error.statusCode < 500) {
        return false;
      }
    }

    // Retry on network errors (no status code)
    if (error instanceof Error) {
      const message = error.message.toLowerCase();
      // Common network error patterns
      if (message.includes('econnrefused') ||
          message.includes('econnreset') ||
          message.includes('etimedout') ||
          message.includes('eof') ||
          message.includes('fetch failed')) {
        return true;
      }
    }

    // Don't retry unknown errors
    return false;
  }

  /**
   * Sleep for specified milliseconds
   */
  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
