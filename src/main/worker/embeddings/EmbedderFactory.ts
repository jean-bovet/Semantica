import { EmbedderConfig } from './IEmbedder';
import { PythonSidecarEmbedder, PythonSidecarEmbedderConfig } from './PythonSidecarEmbedder';
import { PythonSidecarClient } from '../PythonSidecarClient';

/**
 * Configuration for creating embedders
 */
export interface EmbedderFactoryConfig extends EmbedderConfig {
  // Python sidecar-specific configuration
  sidecarClient?: PythonSidecarClient;
  normalizeVectors?: boolean;

  // Logging
  enableVerboseLogging?: boolean;
  logPrefix?: string;
}

/**
 * Factory for creating Python sidecar embedder instances
 */
export class EmbedderFactory {
  private readonly config: EmbedderFactoryConfig;

  constructor(config: EmbedderFactoryConfig = {}) {
    this.config = {
      // Default embedder config - Python sidecar
      modelName: 'paraphrase-multilingual-mpnet-base-v2', // 768-dim multilingual model
      maxFilesBeforeRestart: 5000,
      maxMemoryMB: 1500,
      batchSize: 32,

      // Python sidecar defaults
      normalizeVectors: true,

      // Factory config
      enableVerboseLogging: false,
      logPrefix: '[EMBEDDER-FACTORY]',

      ...config
    };
  }

  /**
   * Create a Python sidecar embedder instance
   */
  createPythonSidecarEmbedder(): PythonSidecarEmbedder {
    const embedderConfig: PythonSidecarEmbedderConfig = {
      modelName: this.config.modelName,
      batchSize: this.config.batchSize,
      client: this.config.sidecarClient,
      normalizeVectors: this.config.normalizeVectors
    };

    const embedder = new PythonSidecarEmbedder(embedderConfig);

    if (this.config.enableVerboseLogging) {
      this.log(`Created Python sidecar embedder with model: ${this.config.modelName}`);
    }

    return embedder;
  }

  /**
   * Create a mock embedder for testing
   */
  createMockEmbedder(): MockEmbedder {
    return new MockEmbedder(this.config);
  }

  /**
   * Get the factory configuration
   */
  getConfig(): Readonly<EmbedderFactoryConfig> {
    return { ...this.config };
  }

  /**
   * Validate the factory configuration
   */
  validateConfig(): {
    isValid: boolean;
    issues: string[];
  } {
    const issues: string[] = [];

    // Check model configuration
    if (!this.config.modelName) {
      issues.push('Model name is required');
    }

    // Check memory limits
    if (this.config.maxMemoryMB! <= 0) {
      issues.push('maxMemoryMB must be greater than 0');
    }

    // Check batch size
    if (this.config.batchSize! <= 0) {
      issues.push('batchSize must be greater than 0');
    }

    // Check file restart threshold
    if (this.config.maxFilesBeforeRestart! <= 0) {
      issues.push('maxFilesBeforeRestart must be greater than 0');
    }

    return {
      isValid: issues.length === 0,
      issues
    };
  }

  /**
   * Create Python sidecar embedder with validation
   */
  async createValidatedPythonSidecarEmbedder(): Promise<PythonSidecarEmbedder> {
    const validation = this.validateConfig();

    if (!validation.isValid) {
      throw new Error(`Invalid Python sidecar embedder configuration: ${validation.issues.join(', ')}`);
    }

    return this.createPythonSidecarEmbedder();
  }

  /**
   * Log with factory prefix
   */
  private log(message: string): void {
    console.log(`${this.config.logPrefix} ${message}`);
  }
}

/**
 * Mock embedder for testing purposes
 */
export class MockEmbedder {
  private isInitialized = false;

  constructor(_config: EmbedderFactoryConfig) {
    // Mock embedder ignores config for simplicity
  }

  async initialize(): Promise<boolean> {
    // Simulate initialization delay
    await new Promise(resolve => setTimeout(resolve, 100));
    this.isInitialized = true;
    return true;
  }

  async embed(texts: string[]): Promise<number[][]> {
    if (!this.isInitialized) {
      throw new Error('Mock embedder not initialized');
    }

    // Return mock vectors with 768 dimensions (matching Python sidecar)
    const dimension = 768;
    return texts.map(() => {
      return Array.from({ length: dimension }, () => Math.random() - 0.5);
    });
  }

  async embedWithRetry(texts: string[]): Promise<number[][]> {
    return this.embed(texts);
  }

  async shouldRestart(): Promise<boolean> {
    return false;
  }

  async restart(): Promise<void> {
    this.isInitialized = false;
    await this.initialize();
  }

  async shutdown(): Promise<void> {
    this.isInitialized = false;
  }

  getStats() {
    return {
      filesSinceSpawn: 0,
      isReady: this.isInitialized,
      memoryUsage: {
        rss: 50,
        heapUsed: 30,
        external: 10
      }
    };
  }
}

/**
 * Default factory instance with standard configuration
 */
export const defaultEmbedderFactory = new EmbedderFactory();

/**
 * Create a factory for testing with mock embedders
 */
export function createTestFactory(overrides: Partial<EmbedderFactoryConfig> = {}): EmbedderFactory {
  return new EmbedderFactory({
    enableVerboseLogging: true,
    logPrefix: '[TEST-FACTORY]',
    maxMemoryMB: 100, // Lower memory limit for tests
    maxFilesBeforeRestart: 10, // Lower restart threshold for tests
    ...overrides
  });
}

/**
 * Create a factory optimized for production use with Python sidecar
 */
export function createProductionFactory(overrides: Partial<EmbedderFactoryConfig> = {}): EmbedderFactory {
  return new EmbedderFactory({
    modelName: 'paraphrase-multilingual-mpnet-base-v2',
    batchSize: 32,
    normalizeVectors: true,
    enableVerboseLogging: false,
    maxMemoryMB: 1500,
    maxFilesBeforeRestart: 5000,
    ...overrides
  });
}
