/**
 * Interface for ML pipeline operations.
 * Abstracts the actual embedding generation process.
 */

export interface PipelineOptions {
  pooling?: 'mean' | 'max' | 'cls';
  normalize?: boolean;
}

/**
 * Output from the pipeline processing
 */
export interface TransformerOutput {
  data: Float32Array | number[];
  dims: number[];
  dispose?: () => void;
}

/**
 * Abstraction for ML pipeline that generates embeddings
 */
export interface IPipeline {
  /**
   * Process texts through the pipeline to generate embeddings
   * @param texts - Array of text strings to process
   * @param options - Processing options (pooling, normalization, etc.)
   * @returns Promise resolving to transformer output
   */
  process(texts: string[], options: PipelineOptions): Promise<TransformerOutput>;
}