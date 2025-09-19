import { IsolatedEmbedder } from './isolated';
import { EmbedderConfig } from './IEmbedder';
import { ModelPathResolver } from './ModelPathResolver';
import { ProcessMemoryMonitor } from '../utils/ProcessMemoryMonitor';

/**
 * Configuration for creating embedders
 */
export interface EmbedderFactoryConfig extends EmbedderConfig {
  // Process management
  childScriptPath?: string;
  nodeArgs?: string[];
  spawnTimeout?: number;
  maxRestarts?: number;
  restartDelay?: number;

  // Environment
  userDataPath?: string;
  transformersCache?: string;
  nodeEnv?: string;

  // Memory monitoring
  memoryCheckInterval?: number;
  memoryWarningThreshold?: number;

  // Logging
  enableVerboseLogging?: boolean;
  logPrefix?: string;
}

/**
 * Types of embedders that can be created
 */
export type EmbedderType = 'isolated' | 'pool' | 'mock';

/**
 * Factory for creating configured embedder instances with consistent settings
 */
export class EmbedderFactory {
  private readonly config: EmbedderFactoryConfig;
  private readonly pathResolver: ModelPathResolver;
  private readonly memoryMonitor: ProcessMemoryMonitor;

  constructor(config: EmbedderFactoryConfig = {}) {
    this.config = {
      // Default embedder config
      modelName: 'Xenova/multilingual-e5-small',
      maxFilesBeforeRestart: 5000,
      maxMemoryMB: 1500,
      batchSize: 32,

      // Default factory config
      spawnTimeout: 60000,
      maxRestarts: 5,
      restartDelay: 2000,
      memoryCheckInterval: 10000,
      memoryWarningThreshold: 85,
      enableVerboseLogging: false,
      logPrefix: '[EMBEDDER-FACTORY]',

      // Environment defaults
      nodeEnv: process.env.NODE_ENV,
      transformersCache: process.env.TRANSFORMERS_CACHE,

      ...config
    };

    // Initialize path resolver with factory config
    this.pathResolver = new ModelPathResolver(this.config.modelName, {
      transformersCache: this.config.transformersCache,
      userDataPath: this.config.userDataPath,
      nodeEnv: this.config.nodeEnv
    });

    // Initialize memory monitor
    this.memoryMonitor = ProcessMemoryMonitor.forEmbedder(this.config.maxMemoryMB!);
  }

  /**
   * Create an isolated embedder instance
   */
  createIsolatedEmbedder(): IsolatedEmbedder {
    const embedderConfig: EmbedderConfig = {
      modelName: this.config.modelName,
      maxFilesBeforeRestart: this.config.maxFilesBeforeRestart,
      maxMemoryMB: this.config.maxMemoryMB,
      batchSize: this.config.batchSize
    };

    const embedder = new IsolatedEmbedder(this.config.modelName!, embedderConfig);

    // Apply factory-specific configuration if we were to refactor IsolatedEmbedder
    // For now, we're maintaining compatibility with the existing interface

    if (this.config.enableVerboseLogging) {
      this.log('Created isolated embedder instance');
    }

    return embedder;
  }

  /**
   * Create multiple isolated embedder instances
   */
  createEmbedderPool(poolSize: number): IsolatedEmbedder[] {
    if (poolSize <= 0) {
      throw new Error('Pool size must be greater than 0');
    }

    const embedders: IsolatedEmbedder[] = [];

    for (let i = 0; i < poolSize; i++) {
      const embedder = this.createIsolatedEmbedder();
      embedders.push(embedder);
    }

    if (this.config.enableVerboseLogging) {
      this.log(`Created embedder pool with ${poolSize} instances`);
    }

    return embedders;
  }

  /**
   * Create a mock embedder for testing
   */
  createMockEmbedder(): MockEmbedder {
    return new MockEmbedder(this.config);
  }

  /**
   * Get the configured model information
   */
  getModelInfo() {
    return this.pathResolver.getModelInfo();
  }

  /**
   * Get the resolved model paths
   */
  getModelPaths() {
    return this.pathResolver.resolve();
  }

  /**
   * Get the memory monitor instance
   */
  getMemoryMonitor(): ProcessMemoryMonitor {
    return this.memoryMonitor;
  }

  /**
   * Get the factory configuration
   */
  getConfig(): Readonly<EmbedderFactoryConfig> {
    return { ...this.config };
  }

  /**
   * Validate the factory configuration and environment
   */
  async validateConfig(): Promise<{
    isValid: boolean;
    issues: string[];
    modelInfo: ReturnType<ModelPathResolver['getModelInfo']>;
  }> {
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

    // Check model existence
    const modelInfo = this.getModelInfo();
    if (!modelInfo.exists) {
      issues.push(`Model not found at: ${modelInfo.path}`);
    }

    // Check environment variables
    const paths = this.getModelPaths();
    if (!paths.allowRemoteModels && !modelInfo.exists) {
      issues.push('Remote models disabled but local model not found');
    }

    return {
      isValid: issues.length === 0,
      issues,
      modelInfo
    };
  }

  /**
   * Create embedder with validation
   */
  async createValidatedEmbedder(): Promise<IsolatedEmbedder> {
    const validation = await this.validateConfig();

    if (!validation.isValid) {
      throw new Error(`Invalid embedder configuration: ${validation.issues.join(', ')}`);
    }

    return this.createIsolatedEmbedder();
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
  private config: EmbedderFactoryConfig;
  private isInitialized = false;

  constructor(config: EmbedderFactoryConfig) {
    this.config = config;
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

    // Return mock vectors with consistent dimensions
    const dimension = 384;
    return texts.map(() => {
      return Array.from({ length: dimension }, () => Math.random() - 0.5);
    });
  }

  async embedWithRetry(texts: string[], maxRetries = 3): Promise<number[][]> {
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
 * Create a factory optimized for production use
 */
export function createProductionFactory(overrides: Partial<EmbedderFactoryConfig> = {}): EmbedderFactory {
  return new EmbedderFactory({
    maxMemoryMB: 1500,
    maxFilesBeforeRestart: 5000,
    memoryCheckInterval: 30000,
    enableVerboseLogging: false,
    ...overrides
  });
}