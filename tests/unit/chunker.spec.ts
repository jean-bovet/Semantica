import { describe, it, expect } from 'vitest';
import { chunkText } from '../../app/electron/pipeline/chunker';

describe('chunkText', () => {
  it('should handle empty text', () => {
    const chunks = chunkText('');
    expect(chunks).toEqual([]);
  });
  
  it('should handle single sentence', () => {
    const text = 'This is a single sentence.';
    const chunks = chunkText(text, 500, 60);
    expect(chunks).toHaveLength(1);
    expect(chunks[0].text).toBe(text);
    expect(chunks[0].offset).toBe(0);
  });
  
  it('should respect target token size', () => {
    const text = 'First sentence. '.repeat(100);
    const chunks = chunkText(text, 100, 20);
    
    expect(chunks.length).toBeGreaterThan(1);
    
    for (const chunk of chunks) {
      const estimatedTokens = Math.ceil(chunk.text.length / 4);
      expect(estimatedTokens).toBeLessThanOrEqual(150);
    }
  });
  
  it('should maintain overlap between chunks', () => {
    const sentences = [];
    for (let i = 0; i < 20; i++) {
      sentences.push(`Sentence ${i}.`);
    }
    const text = sentences.join(' ');
    
    const chunks = chunkText(text, 50, 20);
    
    for (let i = 1; i < chunks.length; i++) {
      const prevChunk = chunks[i - 1].text;
      const currChunk = chunks[i].text;
      
      const prevWords = prevChunk.split(' ').slice(-5);
      const currWords = currChunk.split(' ').slice(0, 5);
      
      const hasOverlap = prevWords.some(word => currWords.includes(word));
      expect(hasOverlap || chunks.length === 2).toBe(true);
    }
  });
  
  it('should handle unicode text', () => {
    const text = '你好世界。こんにちは世界。Hello world. مرحبا بالعالم.';
    const chunks = chunkText(text, 50, 10);
    
    expect(chunks.length).toBeGreaterThan(0);
    expect(chunks[0].text.length).toBeGreaterThan(0);
  });
  
  it('should have monotonically increasing offsets', () => {
    const text = 'First sentence. Second sentence. Third sentence. Fourth sentence. Fifth sentence.';
    const chunks = chunkText(text, 30, 10);
    
    for (let i = 1; i < chunks.length; i++) {
      expect(chunks[i].offset).toBeGreaterThan(chunks[i - 1].offset);
    }
  });
});