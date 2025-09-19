import nodePath from 'node:path';
import nodeFs from 'node:fs';
import { homedir } from 'node:os';

/**
 * Dependencies that can be injected for testing
 */
export interface ModelPathDependencies {
  fs?: {
    existsSync: (path: string) => boolean;
    statSync: (path: string) => { size: number };
    mkdirSync: (path: string, options?: { recursive?: boolean }) => void;
  };
  path?: {
    join: (...paths: string[]) => string;
    dirname: (path: string) => string;
    sep: string;
  };
  os?: {
    homedir: () => string;
  };
}

/**
 * Configuration for model path resolution
 */
export interface ModelPathConfig {
  modelName?: string;
  transformersCache?: string;
  userDataPath?: string;
  nodeEnv?: string;
  resourcesPath?: string;
  dependencies?: ModelPathDependencies;
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
  private readonly fs: ModelPathDependencies['fs'];
  private readonly path: ModelPathDependencies['path'];
  private readonly os: ModelPathDependencies['os'];

  constructor(modelName = 'Xenova/multilingual-e5-small', config: ModelPathConfig = {}) {
    this.modelName = modelName;
    this.config = {
      nodeEnv: process.env.NODE_ENV,
      transformersCache: process.env.TRANSFORMERS_CACHE,
      resourcesPath: process.resourcesPath,
      ...config
    };

    // Set up dependencies with defaults
    this.fs = config.dependencies?.fs || {
      existsSync: nodeFs.existsSync,
      statSync: nodeFs.statSync,
      mkdirSync: nodeFs.mkdirSync
    };

    this.path = config.dependencies?.path || {
      join: nodePath.join,
      dirname: nodePath.dirname,
      sep: nodePath.sep
    };

    this.os = config.dependencies?.os || {
      homedir: homedir
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
      const modelsPath = this.path!.join(this.config.resourcesPath, 'models');
      return {
        localModelPath: modelsPath,
        cacheDir: modelsPath,
        allowRemoteModels: false
      };
    }

    // Development environment
    if (this.config.nodeEnv !== 'production') {
      const devCachePath = this.path!.join(__dirname, '../../../node_modules/@xenova/transformers/.cache');
      return {
        localModelPath: devCachePath,
        cacheDir: devCachePath,
        allowRemoteModels: false
      };
    }

    // Fallback to user data directory
    const userDataPath = this.config.userDataPath ||
      this.path!.join(this.os!.homedir(), '.offline-search');
    const modelsPath = this.path!.join(userDataPath, 'models');

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
    const modelDir = this.modelName.replace('/', this.path!.sep);
    return this.path!.join(basePath, modelDir, 'onnx', 'model_quantized.onnx');
  }

  /**
   * Check if the model file exists at the given path
   */
  private checkModelExists(modelFilePath: string): boolean {
    try {
      return this.fs!.existsSync(modelFilePath);
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
      const stats = this.fs!.statSync(resolved.modelFilePath);
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
    const modelDir = this.path!.dirname(resolved.modelFilePath);

    try {
      this.fs!.mkdirSync(modelDir, { recursive: true });
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