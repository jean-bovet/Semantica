/**
 * Interface for model loading operations.
 * Abstracts the underlying ML framework (transformers.js, ONNX, etc.)
 */

import { IPipeline } from './IPipeline';

export interface ModelInfo {
  exists: boolean;
  path?: string;
  size?: number;
  error?: string;
}

/**
 * Abstraction for loading and managing ML models
 */
export interface IModelLoader {
  /**
   * Load a model by name and return a pipeline for processing
   * @param name - Model name/identifier (e.g., 'Xenova/multilingual-e5-small')
   * @returns Promise resolving to a pipeline instance
   */
  loadModel(name: string): Promise<IPipeline>;

  /**
   * Check if a model exists locally
   * @param name - Model name/identifier
   * @returns true if model exists, false otherwise
   */
  checkModelExists(name: string): boolean;

  /**
   * Get detailed information about a model
   * @param name - Model name/identifier
   * @returns Model information including path and size
   */
  getModelInfo(name: string): ModelInfo;
}