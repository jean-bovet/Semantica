import path from 'node:path';
import fs from 'node:fs';

/**
 * Configuration for model path resolution
 */
export interface ModelPathConfig {
  modelName?: string;
  transformersCache?: string;
  userDataPath?: string;
  nodeEnv?: string;
  resourcesPath?: string;
}

/**
 * Resolved model paths for different environments
 */
export interface ResolvedModelPaths {
  localModelPath: string;
  cacheDir: string;
  allowRemoteModels: boolean;
  modelFilePath: string;
  exists: boolean;
}

/**
 * Utility class for resolving model paths across different environments
 * (development, production, testing) with proper fallbacks and validation.
 */
export class ModelPathResolver {
  private readonly modelName: string;
  private readonly config: ModelPathConfig;

  constructor(modelName = 'Xenova/multilingual-e5-small', config: ModelPathConfig = {}) {
    this.modelName = modelName;
    this.config = {
      nodeEnv: process.env.NODE_ENV,
      transformersCache: process.env.TRANSFORMERS_CACHE,
      resourcesPath: process.resourcesPath,
      ...config
    };
  }

  /**
   * Resolve model paths based on current environment
   */
  resolve(): ResolvedModelPaths {
    const paths = this.getBasePaths();
    const modelFilePath = this.getModelFilePath(paths.localModelPath);

    return {
      ...paths,
      modelFilePath,
      exists: this.checkModelExists(modelFilePath)
    };
  }

  /**
   * Get base paths for model storage
   */
  private getBasePaths(): Omit<ResolvedModelPaths, 'modelFilePath' | 'exists'> {
    // Use explicit cache path if provided
    if (this.config.transformersCache) {
      return {
        localModelPath: this.config.transformersCache,
        cacheDir: this.config.transformersCache,
        allowRemoteModels: true
      };
    }

    // Production environment with ASAR packaging
    if (this.config.nodeEnv === 'production' && this.config.resourcesPath) {
      const modelsPath = path.join(this.config.resourcesPath, 'models');
      return {
        localModelPath: modelsPath,
        cacheDir: modelsPath,
        allowRemoteModels: false
      };
    }

    // Development environment
    if (this.config.nodeEnv !== 'production') {
      const devCachePath = path.join(__dirname, '../../../node_modules/@xenova/transformers/.cache');
      return {
        localModelPath: devCachePath,
        cacheDir: devCachePath,
        allowRemoteModels: false
      };
    }

    // Fallback to user data directory
    const userDataPath = this.config.userDataPath ||
      path.join(require('os').homedir(), '.offline-search');
    const modelsPath = path.join(userDataPath, 'models');

    return {
      localModelPath: modelsPath,
      cacheDir: modelsPath,
      allowRemoteModels: true
    };
  }

  /**
   * Get the full path to the model file
   */
  private getModelFilePath(basePath: string): string {
    const modelDir = this.modelName.replace('/', path.sep);
    return path.join(basePath, modelDir, 'onnx', 'model_quantized.onnx');
  }

  /**
   * Check if the model file exists at the given path
   */
  private checkModelExists(modelFilePath: string): boolean {
    try {
      return fs.existsSync(modelFilePath);
    } catch {
      return false;
    }
  }

  /**
   * Get model information including size if it exists
   */
  getModelInfo(): { exists: boolean; size?: number; path: string } {
    const resolved = this.resolve();

    if (!resolved.exists) {
      return { exists: false, path: resolved.modelFilePath };
    }

    try {
      const stats = fs.statSync(resolved.modelFilePath);
      return {
        exists: true,
        size: stats.size,
        path: resolved.modelFilePath
      };
    } catch {
      return { exists: false, path: resolved.modelFilePath };
    }
  }

  /**
   * Create the model directory if it doesn't exist
   */
  ensureModelDirectory(): string {
    const resolved = this.resolve();
    const modelDir = path.dirname(resolved.modelFilePath);

    try {
      fs.mkdirSync(modelDir, { recursive: true });
      return modelDir;
    } catch (error) {
      throw new Error(`Failed to create model directory ${modelDir}: ${error}`);
    }
  }

  /**
   * Get environment variables needed for transformers.js
   */
  getTransformersEnv(): Record<string, string> {
    const resolved = this.resolve();

    return {
      TRANSFORMERS_CACHE: resolved.cacheDir,
      XDG_CACHE_HOME: resolved.cacheDir
    };
  }
}