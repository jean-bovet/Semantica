/**
 * Core embedder business logic, fully testable without external dependencies.
 * This class contains the essential embedding logic separated from IPC concerns.
 */

import { IModelLoader } from './interfaces/IModelLoader';
import { IPipeline, TransformerOutput } from './interfaces/IPipeline';
import { EmbeddingProcessor } from './EmbeddingProcessor';
import { SerialQueue } from '../utils/SerialQueue';

export interface EmbedderCoreConfig {
  defaultDimension?: number;
  modelName?: string;
}

/**
 * Core embedder functionality without IPC or process management concerns.
 * This class is fully unit-testable with mock dependencies.
 */
export class EmbedderCore {
  private pipeline: IPipeline | null = null;
  private initialized = false;
  private modelName: string | null = null;

  constructor(
    private modelLoader: IModelLoader,
    private processor: EmbeddingProcessor,
    private queue: SerialQueue,
    private config: EmbedderCoreConfig = {}
  ) {}

  /**
   * Initialize the embedder with a specific model
   * @param modelName - Name of the model to load
   */
  async initialize(modelName: string): Promise<void> {
    if (this.initialized && this.modelName === modelName) {
      return; // Already initialized with the same model
    }

    console.log(`[EmbedderCore] Initializing with model: ${modelName}`);

    // Load the model through abstraction
    this.pipeline = await this.modelLoader.loadModel(modelName);
    this.modelName = modelName;
    this.initialized = true;

    console.log(`[EmbedderCore] Successfully initialized with model: ${modelName}`);
  }

  /**
   * Generate embeddings for the given texts
   * @param texts - Array of texts to embed
   * @param isQuery - Whether these are query texts (true) or document texts (false)
   * @returns Array of embedding vectors
   */
  async embed(texts: string[], isQuery: boolean = false): Promise<number[][]> {
    if (!this.initialized || !this.pipeline) {
      throw new Error('EmbedderCore not initialized. Call initialize() first.');
    }

    return this.queue.add(async () => {
      let output: TransformerOutput | null = null;

      try {
        // Add appropriate prefixes for E5 model
        const prefixedTexts = this.processor.addPrefixes(texts, isQuery);

        // Process through the pipeline
        output = await this.pipeline!.process(prefixedTexts, {
          pooling: 'mean',
          normalize: true
        });

        // Convert to vectors and validate
        const { vectors } = this.processor.processEmbedding(texts, output, isQuery);

        // Validate the output
        const validation = this.processor.validateVectors(vectors);
        if (!validation.isValid) {
          throw new Error(`Invalid embedding output: ${validation.issues.join(', ')}`);
        }

        return vectors;
      } catch (error: any) {
        console.error('[EmbedderCore] Embedding failed:', error);
        throw error;
      } finally {
        // Always cleanup transformer output to prevent memory leaks
        if (output) {
          this.processor.cleanup(output);
        }

        // Force garbage collection if available
        if (global.gc) {
          global.gc();
        }
      }
    });
  }

  /**
   * Check if a model exists locally
   * @param modelName - Name of the model to check
   * @returns true if model exists, false otherwise
   */
  async checkModel(modelName?: string): Promise<boolean> {
    const nameToCheck = modelName || this.config.modelName || 'Xenova/multilingual-e5-small';
    return this.modelLoader.checkModelExists(nameToCheck);
  }

  /**
   * Get information about a model
   * @param modelName - Name of the model
   * @returns Model information including existence, path, and size
   */
  async getModelInfo(modelName?: string) {
    const nameToCheck = modelName || this.modelName || this.config.modelName || 'Xenova/multilingual-e5-small';
    return this.modelLoader.getModelInfo(nameToCheck);
  }

  /**
   * Check if the core is initialized and ready
   * @returns true if initialized, false otherwise
   */
  isInitialized(): boolean {
    return this.initialized && this.pipeline !== null;
  }

  /**
   * Get the currently loaded model name
   * @returns Model name or null if not initialized
   */
  getModelName(): string | null {
    return this.modelName;
  }

  /**
   * Shutdown the embedder core and cleanup resources
   */
  shutdown(): void {
    console.log('[EmbedderCore] Shutting down');

    this.queue.shutdown();
    this.initialized = false;
    this.pipeline = null;
    this.modelName = null;

    // Force garbage collection if available
    if (global.gc) {
      global.gc();
    }
  }

  /**
   * Get statistics about the embedder core
   * @returns Statistics object
   */
  getStats() {
    return {
      initialized: this.initialized,
      modelName: this.modelName,
      queueStatus: this.queue.getStatus()
    };
  }
}