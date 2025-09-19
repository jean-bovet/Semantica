import { describe, it, expect, beforeEach } from 'vitest';
import { EmbeddingProcessor } from '../../src/shared/embeddings/EmbeddingProcessor';

describe('EmbeddingProcessor', () => {
  let processor: EmbeddingProcessor;

  beforeEach(() => {
    processor = new EmbeddingProcessor();
  });

  describe('constructor and configuration', () => {
    it('should use default configuration', () => {
      const defaultProcessor = new EmbeddingProcessor();
      const prefixed = defaultProcessor.addPrefixes(['test'], true);
      expect(prefixed[0]).toBe('query: test');
    });

    it('should accept custom configuration', () => {
      const customProcessor = new EmbeddingProcessor({
        defaultDimension: 512,
        prefixMapping: {
          query: 'Q: ',
          passage: 'P: '
        }
      });

      const prefixed = customProcessor.addPrefixes(['test'], true);
      expect(prefixed[0]).toBe('Q: test');
    });
  });

  describe('addPrefixes', () => {
    it('should add query prefix for query texts', () => {
      const texts = ['What is the capital?', 'How does it work?'];
      const prefixed = processor.addPrefixes(texts, true);

      expect(prefixed).toEqual([
        'query: What is the capital?',
        'query: How does it work?'
      ]);
    });

    it('should add passage prefix for document texts', () => {
      const texts = ['Paris is the capital of France.', 'It works by magic.'];
      const prefixed = processor.addPrefixes(texts, false);

      expect(prefixed).toEqual([
        'passage: Paris is the capital of France.',
        'passage: It works by magic.'
      ]);
    });

    it('should default to passage prefix when isQuery not specified', () => {
      const texts = ['Some document text'];
      const prefixed = processor.addPrefixes(texts);

      expect(prefixed).toEqual(['passage: Some document text']);
    });

    it('should handle empty array', () => {
      const prefixed = processor.addPrefixes([]);
      expect(prefixed).toEqual([]);
    });

    it('should handle empty strings', () => {
      const prefixed = processor.addPrefixes(['', 'text'], true);
      expect(prefixed).toEqual(['query: ', 'query: text']);
    });
  });

  describe('convertToVectors', () => {
    it('should convert Float32Array to number arrays', () => {
      const data = new Float32Array([1.0, 2.0, 3.0, 4.0, 5.0, 6.0]);
      const output = {
        data,
        dims: [2, 3] // 2 vectors of dimension 3
      };

      const vectors = processor.convertToVectors(output);

      expect(vectors).toEqual([
        [1.0, 2.0, 3.0],
        [4.0, 5.0, 6.0]
      ]);
    });

    it('should handle single vector', () => {
      const data = new Float32Array([0.1, 0.2, 0.3]);
      const output = {
        data,
        dims: [1, 3]
      };

      const vectors = processor.convertToVectors(output);

      expect(vectors).toEqual([[0.1, 0.2, 0.3]]);
    });

    it('should use default dimension when dims is missing last element', () => {
      const data = new Float32Array([1, 2, 3, 4]);
      const output = {
        data,
        dims: [] // Empty dims array
      };

      const vectors = processor.convertToVectors(output);

      // Should use default dimension of 384, but our data only has 4 elements
      // So it should create one partial vector
      expect(vectors.length).toBe(0); // 4 elements can't fill 384 dimensions
    });

    it('should handle regular number array', () => {
      const data = [1.5, 2.5, 3.5, 4.5];
      const output = {
        data,
        dims: [2, 2]
      };

      const vectors = processor.convertToVectors(output);

      expect(vectors).toEqual([
        [1.5, 2.5],
        [3.5, 4.5]
      ]);
    });

    it('should throw error for invalid output', () => {
      expect(() => {
        processor.convertToVectors({
          data: null as any,
          dims: [1, 3]
        });
      }).toThrow('Invalid transformer output: missing data or dims');

      expect(() => {
        processor.convertToVectors({
          data: [1, 2, 3],
          dims: null as any
        });
      }).toThrow('Invalid transformer output: missing data or dims');
    });

    it('should handle empty data', () => {
      const output = {
        data: new Float32Array([]),
        dims: [0, 3]
      };

      const vectors = processor.convertToVectors(output);
      expect(vectors).toEqual([]);
    });

    it('should throw error for mismatched data length', () => {
      const data = new Float32Array([1, 2, 3, 4, 5]); // 5 elements
      const output = {
        data,
        dims: [2, 3] // Expects 6 elements (2 vectors * 3 dimensions)
      };

      expect(() => {
        processor.convertToVectors(output);
      }).toThrow('Data length 5 is not divisible by dimension 3');
    });
  });

  describe('processEmbedding', () => {
    it('should process texts and convert output in one operation', () => {
      const texts = ['hello', 'world'];
      const output = {
        data: new Float32Array([1, 2, 3, 4, 5, 6]),
        dims: [2, 3]
      };

      const result = processor.processEmbedding(texts, output, true);

      expect(result.processedTexts).toEqual(['query: hello', 'query: world']);
      expect(result.vectors).toEqual([
        [1, 2, 3],
        [4, 5, 6]
      ]);
    });

    it('should validate vector count matches text count', () => {
      const texts = ['hello', 'world']; // 2 texts
      const output = {
        data: new Float32Array([1, 2, 3]), // Only 1 vector
        dims: [1, 3]
      };

      expect(() => {
        processor.processEmbedding(texts, output);
      }).toThrow('Expected 2 vectors but got 1');
    });
  });

  describe('validateVectors', () => {
    it('should validate correct vectors', () => {
      const vectors = [
        [1.0, 2.0, 3.0],
        [4.0, 5.0, 6.0]
      ];

      const validation = processor.validateVectors(vectors);

      expect(validation.isValid).toBe(true);
      expect(validation.issues).toEqual([]);
      expect(validation.stats.count).toBe(2);
      expect(validation.stats.dimension).toBe(3);
      expect(validation.stats.avgMagnitude).toBeGreaterThan(0);
    });

    it('should detect empty vectors array', () => {
      const validation = processor.validateVectors([]);

      expect(validation.isValid).toBe(false);
      expect(validation.issues).toContain('No vectors provided');
      expect(validation.stats.count).toBe(0);
      expect(validation.stats.dimension).toBe(null);
    });

    it('should detect inconsistent dimensions', () => {
      const vectors = [
        [1, 2, 3],    // 3 dimensions
        [4, 5, 6, 7]  // 4 dimensions
      ];

      const validation = processor.validateVectors(vectors);

      expect(validation.isValid).toBe(false);
      expect(validation.issues).toContain('Vector 1 has dimension 4, expected 3');
    });

    it('should detect non-array vectors', () => {
      const vectors = [
        [1, 2, 3],
        'not an array' as any
      ];

      const validation = processor.validateVectors(vectors);

      expect(validation.isValid).toBe(false);
      expect(validation.issues).toContain('Vector 1 is not an array');
    });

    it('should detect invalid numbers', () => {
      const vectors = [
        [1, 2, NaN],
        [4, Infinity, 6]
      ];

      const validation = processor.validateVectors(vectors);

      expect(validation.isValid).toBe(false);
      expect(validation.issues).toContain('Vector 0 contains invalid numbers');
      expect(validation.issues).toContain('Vector 1 contains invalid numbers');
    });

    it('should calculate average magnitude correctly', () => {
      const vectors = [
        [3, 4, 0], // magnitude = 5
        [0, 0, 0]  // magnitude = 0
      ];

      const validation = processor.validateVectors(vectors);

      expect(validation.isValid).toBe(true);
      expect(validation.stats.avgMagnitude).toBe(2.5); // (5 + 0) / 2
    });
  });

  describe('cleanup', () => {
    it('should call dispose method if available', () => {
      const mockDispose = vi.fn();
      const output = {
        data: new Float32Array([1, 2, 3]),
        dims: [1, 3],
        dispose: mockDispose
      };

      processor.cleanup(output);

      expect(mockDispose).toHaveBeenCalled();
    });

    it('should handle missing dispose method', () => {
      const output = {
        data: new Float32Array([1, 2, 3]),
        dims: [1, 3]
      };

      // Should not throw
      expect(() => processor.cleanup(output)).not.toThrow();
    });

    it('should handle dispose errors gracefully', () => {
      const mockDispose = vi.fn(() => {
        throw new Error('Dispose failed');
      });

      const output = {
        data: new Float32Array([1, 2, 3]),
        dims: [1, 3],
        dispose: mockDispose
      };

      // Should not throw even if dispose fails
      expect(() => processor.cleanup(output)).not.toThrow();
    });
  });

  describe('edge cases', () => {
    it('should handle very large dimensions', () => {
      const dimension = 1024;
      const data = new Float32Array(dimension * 2);
      for (let i = 0; i < data.length; i++) {
        data[i] = i;
      }

      const output = {
        data,
        dims: [2, dimension]
      };

      const vectors = processor.convertToVectors(output);

      expect(vectors).toHaveLength(2);
      expect(vectors[0]).toHaveLength(dimension);
      expect(vectors[1]).toHaveLength(dimension);
    });

    it('should handle single element vectors', () => {
      const output = {
        data: new Float32Array([42, 43]),
        dims: [2, 1]
      };

      const vectors = processor.convertToVectors(output);

      expect(vectors).toEqual([[42], [43]]);
    });

    it('should preserve floating point precision', () => {
      const output = {
        data: new Float32Array([0.123456789, 0.987654321]),
        dims: [1, 2]
      };

      const vectors = processor.convertToVectors(output);

      expect(vectors[0][0]).toBeCloseTo(0.123456789, 6);
      expect(vectors[0][1]).toBeCloseTo(0.987654321, 6);
    });
  });
});