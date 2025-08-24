/**
 * TinyEmbedder - A fast, deterministic embedder for testing
 * 
 * This class provides instant embeddings without loading any ML models.
 * It generates deterministic vectors based on text hashing, preserving
 * some semantic properties for testing purposes.
 */
export class TinyEmbedder {
  private readonly dim = 8; // Tiny 8-dimensional embeddings for speed
  
  /**
   * Generate embeddings for an array of texts
   */
  async embed(texts: string[]): Promise<number[][]> {
    // Fast, deterministic embeddings based on text hash
    return texts.map(text => {
      const hash = this.hashCode(text);
      const vector = new Array(this.dim);
      
      for (let i = 0; i < this.dim; i++) {
        // Deterministic but varied values based on hash and dimension
        // This creates different patterns for different texts
        vector[i] = Math.sin(hash * (i + 1)) * 0.5 + 0.5;
      }
      
      return this.normalize(vector);
    });
  }
  
  /**
   * Generate a hash code for a string (Java-style)
   */
  private hashCode(str: string): number {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      hash = ((hash << 5) - hash) + str.charCodeAt(i);
      hash = hash & hash; // Convert to 32bit integer
    }
    return hash;
  }
  
  /**
   * Normalize a vector to unit length
   */
  private normalize(vector: number[]): number[] {
    const magnitude = Math.sqrt(vector.reduce((sum, val) => sum + val * val, 0));
    if (magnitude === 0) return vector;
    return vector.map(val => val / magnitude);
  }
  
  /**
   * Calculate cosine similarity between two vectors (for testing)
   */
  static cosineSimilarity(a: number[], b: number[]): number {
    if (a.length !== b.length) {
      throw new Error('Vectors must have the same dimension');
    }
    return a.reduce((sum, val, i) => sum + val * b[i], 0);
  }
}

/**
 * Create a mock embedder that returns 384-dimensional vectors
 * (matching the real model's output dimension)
 */
export class MockEmbedder384 {
  private tinyEmbedder = new TinyEmbedder();
  
  async embed(texts: string[]): Promise<number[][]> {
    // Get tiny embeddings first
    const tinyVectors = await this.tinyEmbedder.embed(texts);
    
    // Expand to 384 dimensions by repeating pattern
    return tinyVectors.map(tinyVec => {
      const fullVector = new Array(384);
      for (let i = 0; i < 384; i++) {
        // Repeat the pattern from tiny vector with slight variation
        fullVector[i] = tinyVec[i % 8] * (1 + Math.sin(i) * 0.1);
      }
      return this.normalize(fullVector);
    });
  }
  
  private normalize(vector: number[]): number[] {
    const magnitude = Math.sqrt(vector.reduce((sum, val) => sum + val * val, 0));
    if (magnitude === 0) return vector;
    return vector.map(val => val / magnitude);
  }
}