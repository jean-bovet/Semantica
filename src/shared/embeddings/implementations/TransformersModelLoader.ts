/**
 * Concrete implementation of IModelLoader for transformers.js library.
 * This handles the actual loading of transformer models.
 */

import { IModelLoader, ModelInfo } from '../interfaces/IModelLoader';
import { IPipeline, PipelineOptions, TransformerOutput } from '../interfaces/IPipeline';
import { ModelPathResolver } from '../ModelPathResolver';

/**
 * Wrapper for transformers.js pipeline to conform to IPipeline interface
 */
class TransformersPipeline implements IPipeline {
  constructor(private pipeline: any) {}

  async process(texts: string[], options: PipelineOptions): Promise<TransformerOutput> {
    const result = await this.pipeline(texts, options);
    return result;
  }
}

/**
 * Model loader implementation for transformers.js
 */
export class TransformersModelLoader implements IModelLoader {
  private transformers: any = null;
  private pathResolver: ModelPathResolver;
  private loadedPipelines: Map<string, IPipeline> = new Map();

  constructor(pathResolver?: ModelPathResolver) {
    this.pathResolver = pathResolver || new ModelPathResolver();
  }

  /**
   * Load a model and return a pipeline for processing
   */
  async loadModel(name: string): Promise<IPipeline> {
    // Check if we already have this model loaded
    if (this.loadedPipelines.has(name)) {
      console.log(`[TransformersModelLoader] Using cached pipeline for ${name}`);
      return this.loadedPipelines.get(name)!;
    }

    console.log(`[TransformersModelLoader] Loading model: ${name}`);
    await this.initTransformers();

    try {
      const startTime = Date.now();

      // Create the pipeline
      const pipeline = await this.transformers.pipeline(
        'feature-extraction',
        name,
        { quantized: true }
      );

      const loadTime = Date.now() - startTime;
      console.log(`[TransformersModelLoader] Pipeline created in ${loadTime}ms`);

      // Wrap in our interface
      const wrappedPipeline = new TransformersPipeline(pipeline);

      // Cache for future use
      this.loadedPipelines.set(name, wrappedPipeline);

      return wrappedPipeline;
    } catch (error: any) {
      console.error(`[TransformersModelLoader] Failed to load model ${name}:`, error);
      throw new Error(`Failed to load model ${name}: ${error.message}`);
    }
  }

  /**
   * Check if a model exists locally
   */
  checkModelExists(name: string): boolean {
    const modelInfo = this.pathResolver.getModelInfo(name);
    return modelInfo.exists;
  }

  /**
   * Get information about a model
   */
  getModelInfo(name: string): ModelInfo {
    const info = this.pathResolver.getModelInfo();

    return {
      exists: info.exists,
      path: info.path,
      size: info.size,
      error: info.error
    };
  }

  /**
   * Initialize the transformers library
   */
  private async initTransformers(): Promise<void> {
    if (this.transformers) {
      return; // Already initialized
    }

    console.log('[TransformersModelLoader] Initializing transformers.js');

    try {
      // Dynamic import for ES module
      this.transformers = await import('@xenova/transformers');

      // Configure paths using our resolver
      const resolved = this.pathResolver.resolve();

      this.transformers.env.localModelPath = resolved.localModelPath;
      this.transformers.env.cacheDir = resolved.cacheDir;
      this.transformers.env.allowRemoteModels = resolved.allowRemoteModels;

      console.log('[TransformersModelLoader] Transformers initialized with:');
      console.log('  - Cache path:', this.transformers.env.localModelPath);
      console.log('  - Allow remote:', this.transformers.env.allowRemoteModels);
    } catch (error: any) {
      console.error('[TransformersModelLoader] Failed to initialize transformers:', error);
      throw new Error(`Failed to initialize transformers: ${error.message}`);
    }
  }

  /**
   * Clear cached pipelines to free memory
   */
  clearCache(): void {
    this.loadedPipelines.clear();

    // Force garbage collection if available
    if (global.gc) {
      global.gc();
    }
  }

  /**
   * Get list of loaded models
   */
  getLoadedModels(): string[] {
    return Array.from(this.loadedPipelines.keys());
  }
}