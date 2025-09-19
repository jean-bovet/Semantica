/**
 * Configuration for embedding processing
 */
export interface EmbeddingProcessorConfig {
  defaultDimension?: number;
  prefixMapping?: {
    query: string;
    passage: string;
  };
}

/**
 * Raw output from transformer pipeline
 */
export interface TransformerOutput {
  data: Float32Array | number[];
  dims: number[];
  dispose?: () => void;
}

/**
 * Utility class for processing embedding inputs and outputs.
 * Handles text prefixing for E5 models and vector conversion.
 */
export class EmbeddingProcessor {
  private readonly config: EmbeddingProcessorConfig;

  constructor(config: EmbeddingProcessorConfig = {}) {
    this.config = {
      defaultDimension: 384,
      prefixMapping: {
        query: 'query: ',
        passage: 'passage: '
      },
      ...config
    };
  }

  /**
   * Add appropriate prefixes to texts based on their type.
   * E5 models require 'query: ' for search queries and 'passage: ' for documents.
   *
   * @param texts - Array of text strings to process
   * @param isQuery - Whether these are query texts (true) or document texts (false)
   * @returns Array of prefixed text strings
   */
  addPrefixes(texts: string[], isQuery = false): string[] {
    const prefix = isQuery
      ? this.config.prefixMapping!.query
      : this.config.prefixMapping!.passage;

    return texts.map(text => prefix + text);
  }

  /**
   * Convert transformer output to plain number arrays.
   * Copies data from Float32Array to avoid holding native buffers in parent process.
   *
   * @param output - Raw output from transformer pipeline
   * @returns Array of embedding vectors as plain number arrays
   */
  convertToVectors(output: TransformerOutput): number[][] {
    if (!output.data || !output.dims) {
      throw new Error('Invalid transformer output: missing data or dims');
    }

    const dimension = output.dims.at(-1) ?? this.config.defaultDimension!;
    const data = output.data;

    if (data.length === 0) {
      return [];
    }

    if (data.length % dimension !== 0) {
      throw new Error(
        `Data length ${data.length} is not divisible by dimension ${dimension}`
      );
    }

    const vectors: number[][] = [];

    // Process data in chunks of the embedding dimension
    for (let i = 0; i < data.length; i += dimension) {
      const vector = new Array(dimension);

      // Copy values to plain array
      for (let j = 0; j < dimension; j++) {
        vector[j] = data[i + j];
      }

      vectors.push(vector);
    }

    return vectors;
  }

  /**
   * Process texts and convert transformer output in one operation.
   *
   * @param texts - Input text strings
   * @param output - Transformer pipeline output
   * @param isQuery - Whether texts are queries or passages
   * @returns Processed embedding vectors
   */
  processEmbedding(
    texts: string[],
    output: TransformerOutput,
    isQuery = false
  ): { vectors: number[][]; processedTexts: string[] } {
    const processedTexts = this.addPrefixes(texts, isQuery);
    const vectors = this.convertToVectors(output);

    // Validate that we got the expected number of vectors
    if (vectors.length !== texts.length) {
      throw new Error(
        `Expected ${texts.length} vectors but got ${vectors.length}`
      );
    }

    return { vectors, processedTexts };
  }

  /**
   * Validate embedding vectors for consistency
   *
   * @param vectors - Array of embedding vectors to validate
   * @returns Validation result with any issues found
   */
  validateVectors(vectors: number[][]): {
    isValid: boolean;
    issues: string[];
    stats: {
      count: number;
      dimension: number | null;
      avgMagnitude: number | null;
    };
  } {
    const issues: string[] = [];

    if (vectors.length === 0) {
      return {
        isValid: false,
        issues: ['No vectors provided'],
        stats: { count: 0, dimension: null, avgMagnitude: null }
      };
    }

    const firstDimension = vectors[0]?.length;
    let totalMagnitude = 0;
    let validVectors = 0;

    for (let i = 0; i < vectors.length; i++) {
      const vector = vectors[i];

      if (!Array.isArray(vector)) {
        issues.push(`Vector ${i} is not an array`);
        continue;
      }

      if (vector.length !== firstDimension) {
        issues.push(`Vector ${i} has dimension ${vector.length}, expected ${firstDimension}`);
        continue;
      }

      // Check for invalid numbers
      const hasInvalidNumbers = vector.some(val =>
        typeof val !== 'number' || !isFinite(val)
      );

      if (hasInvalidNumbers) {
        issues.push(`Vector ${i} contains invalid numbers`);
        continue;
      }

      // Calculate magnitude for stats
      const magnitude = Math.sqrt(vector.reduce((sum, val) => sum + val * val, 0));
      totalMagnitude += magnitude;
      validVectors++;
    }

    return {
      isValid: issues.length === 0,
      issues,
      stats: {
        count: vectors.length,
        dimension: firstDimension,
        avgMagnitude: validVectors > 0 ? totalMagnitude / validVectors : null
      }
    };
  }

  /**
   * Cleanup transformer output resources
   *
   * @param output - Transformer output to cleanup
   */
  cleanup(output: TransformerOutput): void {
    try {
      if (output.dispose) {
        output.dispose();
      }
    } catch (error) {
      console.warn('Failed to dispose transformer output:', error);
    }
  }
}