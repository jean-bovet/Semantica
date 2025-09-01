import { describe, it, expect, beforeAll } from 'vitest';
import { embed, setEmbedImpl } from '../../src/shared/embeddings/local';
import { mockEmbed } from '../helpers/mock-embeddings';

describe('Embeddings Adapter', () => {
  beforeAll(() => {
    setEmbedImpl(async (texts: string[], isQuery?: boolean) => mockEmbed(texts, 384, isQuery));
  });
  
  it('should return vectors with correct shape', async () => {
    const texts = ['hello world', 'test text'];
    const vectors = await embed(texts);
    
    expect(vectors).toHaveLength(2);
    expect(vectors[0]).toHaveLength(384);
    expect(vectors[1]).toHaveLength(384);
  });
  
  it('should return normalized vectors', async () => {
    const texts = ['normalize this'];
    const vectors = await embed(texts);
    
    let norm = 0;
    for (const val of vectors[0]) {
      norm += val * val;
    }
    norm = Math.sqrt(norm);
    
    expect(norm).toBeCloseTo(1.0, 5);
  });
  
  it('should return deterministic vectors for same input', async () => {
    const text = 'deterministic test';
    const vectors1 = await embed([text]);
    const vectors2 = await embed([text]);
    
    expect(vectors1[0]).toEqual(vectors2[0]);
  });
  
  it('should return different vectors for different inputs', async () => {
    const vectors = await embed(['text one', 'text two']);
    
    expect(vectors[0]).not.toEqual(vectors[1]);
  });
  
  it('should handle empty array', async () => {
    const vectors = await embed([]);
    
    expect(vectors).toEqual([]);
  });
  
  it('should handle large batch', async () => {
    const texts = Array(100).fill(0).map((_, i) => `text ${i}`);
    const vectors = await embed(texts);
    
    expect(vectors).toHaveLength(100);
    expect(vectors.every(v => v.length === 384)).toBe(true);
  });
  
  it('should produce different vectors for query vs document prefixes', async () => {
    const text = 'semantic search';
    
    // Embed as document (passage: prefix)
    const docVectors = await embed([text], false);
    
    // Embed as query (query: prefix)
    const queryVectors = await embed([text], true);
    
    // Should be different due to different prefixes
    expect(docVectors[0]).not.toEqual(queryVectors[0]);
    
    // But should still be somewhat similar (same base text)
    const dotProduct = docVectors[0].reduce((sum, val, i) => sum + val * queryVectors[0][i], 0);
    // Prefixes make them quite different in the mock implementation
    expect(dotProduct).not.toBeCloseTo(1.0, 2);    // Not exactly the same
    expect(dotProduct).not.toBeCloseTo(0.0, 2);    // Not completely different
  });
});