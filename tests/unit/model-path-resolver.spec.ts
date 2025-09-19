import { describe, it, expect, beforeEach } from 'vitest';
import { ModelPathResolver } from '../../src/shared/embeddings/ModelPathResolver';
import { TestFileSystem } from '../../src/shared/test-utils/TestFileSystem';
import { TestOSUtils, TestPathUtils } from '../../src/shared/test-utils/TestOSUtils';
import path from 'node:path';

describe('ModelPathResolver', () => {
  let resolver: ModelPathResolver;
  let testFs: TestFileSystem;
  let testOs: TestOSUtils;
  let testPath: TestPathUtils;

  beforeEach(() => {
    testFs = new TestFileSystem();
    testOs = new TestOSUtils('/test/home/user');
    testPath = new TestPathUtils('/');

    resolver = new ModelPathResolver('Xenova/multilingual-e5-small', {
      dependencies: {
        fs: {
          existsSync: (path) => testFs.existsSync(path),
          statSync: (path) => testFs.statSync(path),
          mkdirSync: (path, options) => testFs.mkdirSync(path, options)
        },
        path: {
          join: (...paths) => testPath.join(...paths),
          dirname: (path) => testPath.dirname(path),
          sep: testPath.sep
        },
        os: {
          homedir: () => testOs.homedir()
        }
      }
    });
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
      const testResolver = new ModelPathResolver('test-model', {
        nodeEnv: 'production',
        // No resourcesPath provided
        dependencies: {
          fs: {
            existsSync: (path) => testFs.existsSync(path),
            statSync: (path) => testFs.statSync(path),
            mkdirSync: (path, options) => testFs.mkdirSync(path, options)
          },
          path: {
            join: (...paths) => testPath.join(...paths),
            dirname: (path) => testPath.dirname(path),
            sep: testPath.sep
          },
          os: {
            homedir: () => testOs.homedir()
          }
        }
      });

      const resolved = testResolver.resolve();

      expect(resolved.localModelPath).toBe('/test/home/user/.offline-search/models');
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
      const resolved = resolver.resolve();

      // Add the model file to the test file system
      testFs.addFile(resolved.modelFilePath, 'test model content');

      const resolvedAgain = resolver.resolve();
      expect(resolvedAgain.exists).toBe(true);
    });

    it('should return false when model does not exist', () => {
      const resolved = resolver.resolve();
      expect(resolved.exists).toBe(false);
    });

    it('should handle fs errors gracefully', () => {
      // Create a resolver with a broken fs implementation
      const brokenResolver = new ModelPathResolver('test-model', {
        dependencies: {
          fs: {
            existsSync: () => { throw new Error('Permission denied'); },
            statSync: (path) => testFs.statSync(path),
            mkdirSync: (path, options) => testFs.mkdirSync(path, options)
          },
          path: {
            join: (...paths) => testPath.join(...paths),
            dirname: (path) => testPath.dirname(path),
            sep: testPath.sep
          },
          os: {
            homedir: () => testOs.homedir()
          }
        }
      });

      const resolved = brokenResolver.resolve();
      expect(resolved.exists).toBe(false);
    });
  });

  describe('getModelInfo', () => {
    it('should return model info when file exists', () => {
      const resolved = resolver.resolve();
      const modelSize = 1024 * 1024 * 100; // 100MB

      // Add the model file with specific size
      testFs.addFileWithSize(resolved.modelFilePath, modelSize);

      const info = resolver.getModelInfo();

      expect(info.exists).toBe(true);
      expect(info.size).toBe(modelSize);
      expect(info.path).toContain('model_quantized.onnx');
    });

    it('should return info without size when file does not exist', () => {
      const info = resolver.getModelInfo();

      expect(info.exists).toBe(false);
      expect(info.size).toBeUndefined();
      expect(info.path).toContain('model_quantized.onnx');
    });

    it('should handle stat errors gracefully', () => {
      // Create a resolver with broken statSync but working existsSync
      const brokenStatResolver = new ModelPathResolver('test-model', {
        dependencies: {
          fs: {
            existsSync: (path) => testFs.existsSync(path),
            statSync: () => { throw new Error('Stat failed'); },
            mkdirSync: (path, options) => testFs.mkdirSync(path, options)
          },
          path: {
            join: (...paths) => testPath.join(...paths),
            dirname: (path) => testPath.dirname(path),
            sep: testPath.sep
          },
          os: {
            homedir: () => testOs.homedir()
          }
        }
      });

      const resolved = brokenStatResolver.resolve();
      testFs.addFile(resolved.modelFilePath, 'test content');

      const info = brokenStatResolver.getModelInfo();
      expect(info.exists).toBe(false);
    });
  });

  describe('ensureModelDirectory', () => {
    it('should create model directory', () => {
      const dirPath = resolver.ensureModelDirectory();
      expect(dirPath).toBeTruthy();
      expect(typeof dirPath).toBe('string');
    });

    it('should handle mkdir errors', () => {
      const brokenMkdirResolver = new ModelPathResolver('test-model', {
        dependencies: {
          fs: {
            existsSync: (path) => testFs.existsSync(path),
            statSync: (path) => testFs.statSync(path),
            mkdirSync: () => { throw new Error('Permission denied'); }
          },
          path: {
            join: (...paths) => testPath.join(...paths),
            dirname: (path) => testPath.dirname(path),
            sep: testPath.sep
          },
          os: {
            homedir: () => testOs.homedir()
          }
        }
      });

      expect(() => brokenMkdirResolver.ensureModelDirectory()).toThrow('Failed to create model directory');
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
      const testResolver = new ModelPathResolver('test-model', {
        nodeEnv: 'production',
        resourcesPath: undefined,
        dependencies: {
          fs: {
            existsSync: (path) => testFs.existsSync(path),
            statSync: (path) => testFs.statSync(path),
            mkdirSync: (path, options) => testFs.mkdirSync(path, options)
          },
          path: {
            join: (...paths) => testPath.join(...paths),
            dirname: (path) => testPath.dirname(path),
            sep: testPath.sep
          },
          os: {
            homedir: () => testOs.homedir()
          }
        }
      });

      const resolved = testResolver.resolve();

      // Should fall back to user data directory
      expect(resolved.localModelPath).toBe('/test/home/user/.offline-search/models');
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