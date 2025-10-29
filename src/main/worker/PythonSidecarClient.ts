/**
 * PythonSidecarClient - HTTP client for Python embedding sidecar
 *
 * Provides methods to interact with the local Python FastAPI server for embeddings.
 * The sidecar runs as a separate process (http://127.0.0.1:8421) providing
 * process isolation and efficient embedding generation.
 *
 * IMPORTANT: Uses serial request queue - based on performance testing showing
 * that concurrent requests provide no benefit (Python GIL limitation) and can
 * reduce throughput by up to 45%. Single-threaded processing is optimal.
 */

import * as http from 'http';
import { logger } from '../../shared/utils/logger';

export interface SidecarEmbedRequest {
  texts: string[];
  normalize?: boolean;
}

export interface SidecarEmbedResponse {
  vectors: number[][];  // Python sidecar returns 'vectors', not 'embeddings'
}

export interface SidecarHealthResponse {
  status: string;
  model: string;
  dim: number;
  device: string;
}

export interface SidecarInfoResponse {
  model_id: string;
  dim: number;
  device: string;
  version: string;
}

export interface PythonSidecarClientConfig {
  baseUrl?: string;
  port?: number;
  timeout?: number;
  retryAttempts?: number;
  retryDelay?: number;
}

export class PythonSidecarClientError extends Error {
  constructor(
    message: string,
    public readonly code?: string,
    public readonly statusCode?: number
  ) {
    super(message);
    this.name = 'PythonSidecarClientError';
  }
}

/**
 * Client for interacting with Python embedding sidecar HTTP API
 */
export class PythonSidecarClient {
  private readonly baseUrl: string;
  private readonly port: number;
  private readonly timeout: number;
  private readonly retryAttempts: number;
  private readonly retryDelay: number;

  // Serial request queue for optimal performance (no concurrent requests)
  // Performance testing shows concurrent requests provide no benefit due to Python GIL
  private requestQueue: Promise<any> = Promise.resolve();

  constructor(config: PythonSidecarClientConfig = {}) {
    this.port = config.port || 8421;
    this.baseUrl = config.baseUrl || `http://127.0.0.1:${this.port}`;
    this.timeout = config.timeout || 30000; // 30s (reduced from Ollama's 300s)
    this.retryAttempts = config.retryAttempts || 2; // Reduced from Ollama's 3
    this.retryDelay = config.retryDelay || 1000;
  }

  /**
   * Generate embeddings for a batch of texts (serialized through request queue)
   * @param texts Array of strings to embed
   * @param normalize Whether to L2 normalize vectors (default: true)
   * @returns Array of embedding vectors
   */
  async embedBatch(
    texts: string[],
    normalize: boolean = true
  ): Promise<number[][]> {
    if (texts.length === 0) {
      return [];
    }

    // Serialize all embedding requests through a promise chain
    // This is OPTIMAL based on performance testing (not a workaround)
    return this.requestQueue = this.requestQueue
      .then(() => this.embedBatchInternal(texts, normalize))
      .catch(err => {
        // Reset queue on error to prevent indefinite blocking
        this.requestQueue = Promise.resolve();
        throw err;
      });
  }

  /**
   * Internal implementation of embedBatch (executed serially via queue)
   */
  private async embedBatchInternal(
    texts: string[],
    normalize: boolean = true
  ): Promise<number[][]> {
    // Calculate metrics for logging
    const totalChars = texts.reduce((sum, t) => sum + t.length, 0);
    const estimatedTokens = Math.ceil(totalChars / 2.5);
    const textLengths = texts.map(t => t.length);

    // Create payload
    const payload: SidecarEmbedRequest = {
      texts,
      normalize
    };
    const payloadJson = JSON.stringify(payload);
    const payloadBytes = new TextEncoder().encode(payloadJson).length;

    // Log request details
    logger.log('SIDECAR-CLIENT', `📤 Embedding request: ${texts.length} texts, ${totalChars} chars total, ~${estimatedTokens} est. tokens`);
    logger.log('SIDECAR-CLIENT', `   Text lengths: [${textLengths.slice(0, 10).join(', ')}${textLengths.length > 10 ? '...' : ''}]`);
    logger.log('SIDECAR-CLIENT', `   JSON payload: ${payloadBytes} bytes (${(payloadBytes/1024).toFixed(2)} KB)`);

    // Log average and max chunk sizes
    const avgLength = Math.round(totalChars / texts.length);
    const maxLength = Math.max(...textLengths);
    logger.log('SIDECAR-CLIENT', `   Avg chunk: ${avgLength} chars, Max chunk: ${maxLength} chars`);

    const startTime = Date.now();

    try {
      const response = await this.fetchWithRetry<SidecarEmbedResponse>(
        '/embed',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: payloadJson,
        }
      );

      const duration = Date.now() - startTime;
      const textsPerSec = texts.length / (duration / 1000);

      logger.log('SIDECAR-CLIENT', `✅ Embedding complete: ${texts.length} texts in ${duration}ms (${textsPerSec.toFixed(1)} texts/sec)`);

      return response.vectors;  // Python sidecar returns 'vectors', not 'embeddings'
    } catch (error) {
      const duration = Date.now() - startTime;
      logger.log('SIDECAR-CLIENT', `❌ Embedding failed after ${duration}ms: ${error}`);
      throw error;
    }
  }

  /**
   * Check if the sidecar server is healthy and ready
   */
  async checkHealth(): Promise<boolean> {
    try {
      const response = await this.fetch<SidecarHealthResponse>('/health', {
        method: 'GET',
      });
      return response.status === 'ok';
    } catch (error) {
      logger.log('SIDECAR-CLIENT', `Health check failed: ${error}`);
      return false;
    }
  }

  /**
   * Get information about the sidecar server and model
   */
  async getInfo(): Promise<SidecarInfoResponse> {
    return this.fetch<SidecarInfoResponse>('/info', {
      method: 'GET',
    });
  }

  /**
   * Fetch with retry logic
   */
  private async fetchWithRetry<T>(
    path: string,
    options: http.RequestOptions & { body?: string }
  ): Promise<T> {
    let lastError: Error | null = null;

    for (let attempt = 0; attempt <= this.retryAttempts; attempt++) {
      try {
        return await this.fetch<T>(path, options);
      } catch (error) {
        lastError = error as Error;

        // Don't retry on client errors (4xx)
        if (error instanceof PythonSidecarClientError && error.statusCode && error.statusCode >= 400 && error.statusCode < 500) {
          throw error;
        }

        // If not the last attempt, wait and retry
        if (attempt < this.retryAttempts) {
          logger.log('SIDECAR-CLIENT', `Request failed (attempt ${attempt + 1}/${this.retryAttempts + 1}): ${error}`);
          logger.log('SIDECAR-CLIENT', `Retrying in ${this.retryDelay}ms...`);
          await this.sleep(this.retryDelay);
        }
      }
    }

    throw lastError;
  }

  /**
   * Make HTTP request to sidecar server
   */
  private fetch<T>(
    path: string,
    options: http.RequestOptions & { body?: string }
  ): Promise<T> {
    return new Promise((resolve, reject) => {
      const url = new URL(path, this.baseUrl);

      const requestOptions: http.RequestOptions = {
        hostname: url.hostname,
        port: url.port || this.port,
        path: url.pathname,
        method: options.method || 'GET',
        headers: options.headers || {},
        timeout: this.timeout,
      };

      const req = http.request(requestOptions, (res) => {
        let data = '';

        res.on('data', (chunk) => {
          data += chunk;
        });

        res.on('end', () => {
          if (res.statusCode && res.statusCode >= 200 && res.statusCode < 300) {
            try {
              const parsed = JSON.parse(data);
              resolve(parsed);
            } catch (error) {
              reject(new PythonSidecarClientError(
                `Failed to parse response: ${error}`,
                'PARSE_ERROR'
              ));
            }
          } else {
            reject(new PythonSidecarClientError(
              `Request failed with status ${res.statusCode}: ${data}`,
              'HTTP_ERROR',
              res.statusCode
            ));
          }
        });
      });

      req.on('error', (error) => {
        reject(new PythonSidecarClientError(
          `Request failed: ${error.message}`,
          'NETWORK_ERROR'
        ));
      });

      req.on('timeout', () => {
        req.destroy();
        reject(new PythonSidecarClientError(
          `Request timed out after ${this.timeout}ms`,
          'TIMEOUT'
        ));
      });

      if (options.body) {
        req.write(options.body);
      }

      req.end();
    });
  }

  /**
   * Sleep for specified milliseconds
   */
  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Get the base URL of the sidecar server
   */
  getBaseUrl(): string {
    return this.baseUrl;
  }

  /**
   * Get the configured timeout
   */
  getTimeout(): number {
    return this.timeout;
  }
}
