import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ModelPathResolver } from '../../src/shared/embeddings/ModelPathResolver';
import path from 'node:path';
import fs from 'node:fs';

// Mock fs module
vi.mock('node:fs', () => ({
  default: {
    existsSync: vi.fn(),
    statSync: vi.fn(),
    mkdirSync: vi.fn()
  },
  existsSync: vi.fn(),
  statSync: vi.fn(),
  mkdirSync: vi.fn()
}));

// Mock os module
vi.mock('node:os', () => ({
  homedir: vi.fn(() => '/home/user')
}));

describe('ModelPathResolver', () => {
  let resolver: ModelPathResolver;

  beforeEach(() => {
    vi.clearAllMocks();
    resolver = new ModelPathResolver();
  });

  describe('constructor', () => {
    it('should use default model name', () => {
      const defaultResolver = new ModelPathResolver();
      const resolved = defaultResolver.resolve();
      expect(resolved.modelFilePath).toContain('multilingual-e5-small');
    });

    it('should use custom model name', () => {
      const customResolver = new ModelPathResolver('custom/model');
      const resolved = customResolver.resolve();
      expect(resolved.modelFilePath).toContain('custom');
      expect(resolved.modelFilePath).toContain('model');
    });

    it('should accept configuration', () => {
      const configuredResolver = new ModelPathResolver('test-model', {
        transformersCache: '/custom/cache'
      });
      const resolved = configuredResolver.resolve();
      expect(resolved.localModelPath).toBe('/custom/cache');
    });
  });

  describe('path resolution', () => {
    it('should use TRANSFORMERS_CACHE when provided', () => {
      const resolver = new ModelPathResolver('test-model', {
        transformersCache: '/custom/transformers/cache'
      });

      const resolved = resolver.resolve();

      expect(resolved.localModelPath).toBe('/custom/transformers/cache');
      expect(resolved.cacheDir).toBe('/custom/transformers/cache');
      expect(resolved.allowRemoteModels).toBe(true);
    });

    it('should use production paths when in production', () => {
      const resolver = new ModelPathResolver('test-model', {
        nodeEnv: 'production',
        resourcesPath: '/app/resources'
      });

      const resolved = resolver.resolve();

      expect(resolved.localModelPath).toBe('/app/resources/models');
      expect(resolved.cacheDir).toBe('/app/resources/models');
      expect(resolved.allowRemoteModels).toBe(false);
    });

    it('should use development paths when not in production', () => {
      const resolver = new ModelPathResolver('test-model', {
        nodeEnv: 'development'
      });

      const resolved = resolver.resolve();

      expect(resolved.localModelPath).toContain('node_modules/@xenova/transformers/.cache');
      expect(resolved.allowRemoteModels).toBe(false);
    });

    it('should fall back to user data directory', () => {
      const resolver = new ModelPathResolver('test-model', {
        nodeEnv: 'production'
        // No resourcesPath provided
      });

      const resolved = resolver.resolve();

      expect(resolved.localModelPath).toBe('/home/user/.offline-search/models');
      expect(resolved.allowRemoteModels).toBe(true);
    });
  });

  describe('model file path generation', () => {
    it('should generate correct model file path', () => {
      const resolver = new ModelPathResolver('Xenova/multilingual-e5-small');
      const resolved = resolver.resolve();

      expect(resolved.modelFilePath).toContain('Xenova');
      expect(resolved.modelFilePath).toContain('multilingual-e5-small');
      expect(resolved.modelFilePath).toContain('onnx');
      expect(resolved.modelFilePath).toContain('model_quantized.onnx');
    });

    it('should handle model names with forward slashes', () => {
      const resolver = new ModelPathResolver('organization/model-name');
      const resolved = resolver.resolve();

      const expectedPath = path.join('organization', 'model-name', 'onnx', 'model_quantized.onnx');
      expect(resolved.modelFilePath).toContain(expectedPath);
    });
  });

  describe('model existence checking', () => {
    it('should return true when model exists', () => {
      vi.mocked(fs.default.existsSync).mockReturnValue(true);

      const resolved = resolver.resolve();
      expect(resolved.exists).toBe(true);
    });

    it('should return false when model does not exist', () => {
      vi.mocked(fs.default.existsSync).mockReturnValue(false);

      const resolved = resolver.resolve();
      expect(resolved.exists).toBe(false);
    });

    it('should handle fs errors gracefully', () => {
      vi.mocked(fs.default.existsSync).mockImplementation(() => {
        throw new Error('Permission denied');
      });

      const resolved = resolver.resolve();
      expect(resolved.exists).toBe(false);
    });
  });

  describe('getModelInfo', () => {
    it('should return model info when file exists', () => {
      vi.mocked(fs.default.existsSync).mockReturnValue(true);
      vi.mocked(fs.default.statSync).mockReturnValue({
        size: 1024 * 1024 * 100 // 100MB
      } as any);

      const info = resolver.getModelInfo();

      expect(info.exists).toBe(true);
      expect(info.size).toBe(1024 * 1024 * 100);
      expect(info.path).toContain('model_quantized.onnx');
    });

    it('should return info without size when file does not exist', () => {
      vi.mocked(fs.default.existsSync).mockReturnValue(false);

      const info = resolver.getModelInfo();

      expect(info.exists).toBe(false);
      expect(info.size).toBeUndefined();
      expect(info.path).toContain('model_quantized.onnx');
    });

    it('should handle stat errors gracefully', () => {
      vi.mocked(fs.default.existsSync).mockReturnValue(true);
      vi.mocked(fs.default.statSync).mockImplementation(() => {
        throw new Error('Stat failed');
      });

      const info = resolver.getModelInfo();

      expect(info.exists).toBe(false);
    });
  });

  describe('ensureModelDirectory', () => {
    it('should create model directory', () => {
      const mockMkdir = vi.mocked(fs.default.mkdirSync);

      const dirPath = resolver.ensureModelDirectory();

      expect(mockMkdir).toHaveBeenCalledWith(
        expect.any(String),
        { recursive: true }
      );
      expect(dirPath).toBeTruthy();
    });

    it('should handle mkdir errors', () => {
      vi.mocked(fs.default.mkdirSync).mockImplementation(() => {
        throw new Error('Permission denied');
      });

      expect(() => resolver.ensureModelDirectory()).toThrow('Failed to create model directory');
    });
  });

  describe('getTransformersEnv', () => {
    it('should return environment variables', () => {
      const resolver = new ModelPathResolver('test-model', {
        transformersCache: '/custom/cache'
      });

      const env = resolver.getTransformersEnv();

      expect(env.TRANSFORMERS_CACHE).toBe('/custom/cache');
      expect(env.XDG_CACHE_HOME).toBe('/custom/cache');
    });
  });

  describe('edge cases', () => {
    it('should handle undefined process.resourcesPath', () => {
      const resolver = new ModelPathResolver('test-model', {
        nodeEnv: 'production',
        resourcesPath: undefined
      });

      const resolved = resolver.resolve();

      // Should fall back to user data directory
      expect(resolved.localModelPath).toBe('/home/user/.offline-search/models');
    });

    it('should handle empty model name', () => {
      const resolver = new ModelPathResolver('');
      const resolved = resolver.resolve();

      expect(resolved.modelFilePath).toBeTruthy();
    });

    it('should handle special characters in model name', () => {
      const resolver = new ModelPathResolver('model@v1.0_test');
      const resolved = resolver.resolve();

      expect(resolved.modelFilePath).toContain('model@v1.0_test');
    });
  });
});