import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import {
  extractBundleExtensions,
  isBundle,
  shouldExclude,
  isSupportedFile,
  scanDirectory,
  scanDirectories,
  type ScanOptions
} from '../../src/main/worker/directoryScanner';

// Mock fs module
vi.mock('node:fs');

describe('Directory Scanner', () => {
  let mockFs: any;

  beforeEach(() => {
    mockFs = vi.mocked(fs);
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('extractBundleExtensions', () => {
    it('should extract extensions from glob patterns', () => {
      const patterns = [
        '**/*.app/**',
        '**/*.framework/**',
        '**/*.bundle/**',
        '**/*.xcodeproj/**'
      ];
      
      const extensions = extractBundleExtensions(patterns);
      
      expect(extensions).toEqual(['.app', '.framework', '.bundle', '.xcodeproj']);
    });

    it('should filter out invalid patterns', () => {
      const patterns = [
        '**/*.app/**',
        'node_modules',
        '.git',
        '**/*.framework/**',
        'invalid-pattern'
      ];
      
      const extensions = extractBundleExtensions(patterns);
      
      expect(extensions).toEqual(['.app', '.framework']);
    });

    it('should handle empty array', () => {
      expect(extractBundleExtensions([])).toEqual([]);
    });
  });

  describe('isBundle', () => {
    it('should identify bundle directories', () => {
      const extensions = ['.app', '.framework', '.bundle'];
      
      expect(isBundle('MyApp.app', extensions)).toBe(true);
      expect(isBundle('SDL.framework', extensions)).toBe(true);
      expect(isBundle('Plugin.bundle', extensions)).toBe(true);
    });

    it('should not identify non-bundle directories', () => {
      const extensions = ['.app', '.framework', '.bundle'];
      
      expect(isBundle('Documents', extensions)).toBe(false);
      expect(isBundle('myapp.txt', extensions)).toBe(false);
      expect(isBundle('app.config', extensions)).toBe(false);
    });

    it('should handle edge cases', () => {
      const extensions = ['.app', '.framework'];
      
      // Directory that contains .app but doesn't end with it
      expect(isBundle('my.app.backup', extensions)).toBe(false);
      expect(isBundle('.app', extensions)).toBe(true);
    });
  });

  describe('shouldExclude', () => {
    it('should identify paths to exclude', () => {
      const patterns = ['node_modules', '.git', '.tmp', '.DS_Store'];
      
      expect(shouldExclude('/project/node_modules/package', patterns)).toBe(true);
      expect(shouldExclude('/project/.git/config', patterns)).toBe(true);
      expect(shouldExclude('/project/file.tmp', patterns)).toBe(true);
      expect(shouldExclude('/project/.DS_Store', patterns)).toBe(true);
    });

    it('should not exclude paths that dont match patterns', () => {
      const patterns = ['node_modules', '.git'];
      
      expect(shouldExclude('/project/src/index.ts', patterns)).toBe(false);
      expect(shouldExclude('/project/README.md', patterns)).toBe(false);
    });
  });

  describe('isSupportedFile', () => {
    it('should identify supported file types', () => {
      const extensions = ['pdf', 'txt', 'md', 'docx'];
      
      expect(isSupportedFile('document.pdf', extensions)).toBe(true);
      expect(isSupportedFile('notes.txt', extensions)).toBe(true);
      expect(isSupportedFile('README.md', extensions)).toBe(true);
      expect(isSupportedFile('report.docx', extensions)).toBe(true);
    });

    it('should reject unsupported file types', () => {
      const extensions = ['pdf', 'txt', 'md'];
      
      expect(isSupportedFile('image.png', extensions)).toBe(false);
      expect(isSupportedFile('video.mp4', extensions)).toBe(false);
      expect(isSupportedFile('archive.zip', extensions)).toBe(false);
    });

    it('should be case insensitive', () => {
      const extensions = ['pdf', 'txt'];
      
      expect(isSupportedFile('Document.PDF', extensions)).toBe(true);
      expect(isSupportedFile('Notes.TXT', extensions)).toBe(true);
    });
  });

  describe('scanDirectory', () => {
    it('should skip bundle directories when excludeBundles is true', () => {
      // Mock file system structure
      const mockStructure: Record<string, any> = {
        '/test': ['Documents', 'Applications'],
        '/test/Documents': ['file1.pdf', 'file2.txt'],
        '/test/Applications': ['MyApp.app', 'standalone.pdf'],
        '/test/Applications/MyApp.app': ['Contents'],
        '/test/Applications/MyApp.app/Contents': ['Resources'],
        '/test/Applications/MyApp.app/Contents/Resources': ['data.txt', 'config.xml']
      };

      mockFs.existsSync.mockReturnValue(true);
      mockFs.readdirSync.mockImplementation((dir: string) => {
        const contents = mockStructure[dir] || [];
        return contents.map((name: string) => ({
          name,
          isDirectory: () => {
            const fullPath = path.join(dir, name);
            return mockStructure[fullPath] !== undefined;
          },
          isFile: () => {
            const fullPath = path.join(dir, name);
            return mockStructure[fullPath] === undefined;
          }
        }));
      });

      const options: ScanOptions = {
        excludeBundles: true,
        bundlePatterns: ['**/*.app/**', '**/*.framework/**'],
        excludePatterns: [],
        supportedExtensions: ['pdf', 'txt', 'xml']
      };

      const result = scanDirectory('/test', options);

      // Should find files outside bundles
      expect(result.files).toContain('/test/Documents/file1.pdf');
      expect(result.files).toContain('/test/Documents/file2.txt');
      expect(result.files).toContain('/test/Applications/standalone.pdf');

      // Should NOT find files inside bundles
      expect(result.files).not.toContain('/test/Applications/MyApp.app/Contents/Resources/data.txt');
      expect(result.files).not.toContain('/test/Applications/MyApp.app/Contents/Resources/config.xml');

      // Should record skipped bundles
      expect(result.skippedBundles).toContain('/test/Applications/MyApp.app');
    });

    it('should scan inside bundles when excludeBundles is false', () => {
      const mockStructure: Record<string, any> = {
        '/test': ['MyApp.app'],
        '/test/MyApp.app': ['Contents'],
        '/test/MyApp.app/Contents': ['data.txt', 'config.xml']
      };

      mockFs.existsSync.mockReturnValue(true);
      mockFs.readdirSync.mockImplementation((dir: string) => {
        const contents = mockStructure[dir] || [];
        return contents.map((name: string) => ({
          name,
          isDirectory: () => {
            const fullPath = path.join(dir, name);
            return mockStructure[fullPath] !== undefined;
          },
          isFile: () => {
            const fullPath = path.join(dir, name);
            return mockStructure[fullPath] === undefined;
          }
        }));
      });

      const options: ScanOptions = {
        excludeBundles: false, // Disabled
        bundlePatterns: ['**/*.app/**'],
        excludePatterns: [],
        supportedExtensions: ['txt', 'xml']
      };

      const result = scanDirectory('/test', options);

      // Should find files inside bundles when exclusion is disabled
      expect(result.files).toContain('/test/MyApp.app/Contents/data.txt');
      expect(result.files).toContain('/test/MyApp.app/Contents/config.xml');
      expect(result.skippedBundles).toHaveLength(0);
    });

    it('should respect exclude patterns', () => {
      const mockStructure: Record<string, any> = {
        '/test': ['src', 'node_modules', '.git'],
        '/test/src': ['index.ts', 'app.ts'],
        '/test/node_modules': ['package1'],
        '/test/node_modules/package1': ['index.js'],
        '/test/.git': ['config']
      };

      mockFs.existsSync.mockReturnValue(true);
      mockFs.readdirSync.mockImplementation((dir: string) => {
        const contents = mockStructure[dir] || [];
        return contents.map((name: string) => ({
          name,
          isDirectory: () => {
            const fullPath = path.join(dir, name);
            return mockStructure[fullPath] !== undefined;
          },
          isFile: () => {
            const fullPath = path.join(dir, name);
            return mockStructure[fullPath] === undefined;
          }
        }));
      });

      const options: ScanOptions = {
        excludeBundles: false,
        bundlePatterns: [],
        excludePatterns: ['node_modules', '.git'],
        supportedExtensions: ['ts', 'js']
      };

      const result = scanDirectory('/test', options);

      // Should find files in src
      expect(result.files).toContain('/test/src/index.ts');
      expect(result.files).toContain('/test/src/app.ts');

      // Should NOT find files in excluded directories
      expect(result.files).not.toContain('/test/node_modules/package1/index.js');
      expect(result.files).not.toContain('/test/.git/config');
    });

    it('should only include supported file extensions', () => {
      const mockStructure: Record<string, any> = {
        '/test': ['file1.pdf', 'file2.txt', 'image.png', 'video.mp4']
      };

      mockFs.existsSync.mockReturnValue(true);
      mockFs.readdirSync.mockImplementation((dir: string) => {
        const contents = mockStructure[dir] || [];
        return contents.map((name: string) => ({
          name,
          isDirectory: () => false,
          isFile: () => true
        }));
      });

      const options: ScanOptions = {
        excludeBundles: false,
        bundlePatterns: [],
        excludePatterns: [],
        supportedExtensions: ['pdf', 'txt']
      };

      const result = scanDirectory('/test', options);

      expect(result.files).toContain('/test/file1.pdf');
      expect(result.files).toContain('/test/file2.txt');
      expect(result.files).not.toContain('/test/image.png');
      expect(result.files).not.toContain('/test/video.mp4');
    });

    it('should handle the exact iTrain.app scenario', () => {
      // Recreate the exact structure from the user's log
      const mockStructure: Record<string, any> = {
        '/Users/bovet/Documents': ['Family'],
        '/Users/bovet/Documents/Family': ['Jean'],
        '/Users/bovet/Documents/Family/Jean': ['Model Train'],
        '/Users/bovet/Documents/Family/Jean/Model Train': ['Software'],
        '/Users/bovet/Documents/Family/Jean/Model Train/Software': ['iTrain', 'manual.pdf'],
        '/Users/bovet/Documents/Family/Jean/Model Train/Software/iTrain': ['iTrain.app', 'readme.txt'],
        '/Users/bovet/Documents/Family/Jean/Model Train/Software/iTrain/iTrain.app': ['Contents'],
        '/Users/bovet/Documents/Family/Jean/Model Train/Software/iTrain/iTrain.app/Contents': ['Resources'],
        '/Users/bovet/Documents/Family/Jean/Model Train/Software/iTrain/iTrain.app/Contents/Resources': ['legal'],
        '/Users/bovet/Documents/Family/Jean/Model Train/Software/iTrain/iTrain.app/Contents/Resources/legal': ['java.xml'],
        '/Users/bovet/Documents/Family/Jean/Model Train/Software/iTrain/iTrain.app/Contents/Resources/legal/java.xml': ['bcel.md']
      };

      mockFs.existsSync.mockReturnValue(true);
      mockFs.readdirSync.mockImplementation((dir: string) => {
        const contents = mockStructure[dir] || [];
        return contents.map((name: string) => ({
          name,
          isDirectory: () => {
            const fullPath = path.join(dir, name);
            return mockStructure[fullPath] !== undefined;
          },
          isFile: () => {
            const fullPath = path.join(dir, name);
            return mockStructure[fullPath] === undefined;
          }
        }));
      });

      const options: ScanOptions = {
        excludeBundles: true,
        bundlePatterns: [
          '**/*.app/**',
          '**/*.framework/**',
          '**/*.bundle/**'
        ],
        excludePatterns: [],
        supportedExtensions: ['pdf', 'txt', 'md']
      };

      const result = scanDirectory('/Users/bovet/Documents', options);

      // Should find files outside the .app bundle
      expect(result.files).toContain('/Users/bovet/Documents/Family/Jean/Model Train/Software/manual.pdf');
      expect(result.files).toContain('/Users/bovet/Documents/Family/Jean/Model Train/Software/iTrain/readme.txt');

      // Should NOT find the file inside iTrain.app
      const bcelPath = '/Users/bovet/Documents/Family/Jean/Model Train/Software/iTrain/iTrain.app/Contents/Resources/legal/java.xml/bcel.md';
      expect(result.files).not.toContain(bcelPath);

      // Should have skipped the iTrain.app bundle
      expect(result.skippedBundles).toContain('/Users/bovet/Documents/Family/Jean/Model Train/Software/iTrain/iTrain.app');
    });

    it('should handle permission errors gracefully', () => {
      mockFs.existsSync.mockReturnValue(true);
      mockFs.readdirSync.mockImplementation(() => {
        const error: any = new Error('Permission denied');
        error.code = 'EACCES';
        throw error;
      });

      const options: ScanOptions = {
        excludeBundles: false,
        bundlePatterns: [],
        excludePatterns: [],
        supportedExtensions: ['txt']
      };

      // Should not throw, just return empty results
      const result = scanDirectory('/test', options);
      expect(result.files).toEqual([]);
      expect(result.skippedBundles).toEqual([]);
    });
  });

  describe('scanDirectories', () => {
    it('should combine results from multiple roots', () => {
      const mockStructure: Record<string, any> = {
        '/root1': ['file1.txt'],
        '/root2': ['file2.pdf'],
        '/root3': ['MyApp.app'],
        '/root3/MyApp.app': ['Contents']
      };

      mockFs.existsSync.mockReturnValue(true);
      mockFs.readdirSync.mockImplementation((dir: string) => {
        const contents = mockStructure[dir] || [];
        return contents.map((name: string) => ({
          name,
          isDirectory: () => {
            const fullPath = path.join(dir, name);
            return mockStructure[fullPath] !== undefined;
          },
          isFile: () => {
            const fullPath = path.join(dir, name);
            return mockStructure[fullPath] === undefined;
          }
        }));
      });

      const options: ScanOptions = {
        excludeBundles: true,
        bundlePatterns: ['**/*.app/**'],
        excludePatterns: [],
        supportedExtensions: ['txt', 'pdf']
      };

      const result = scanDirectories(['/root1', '/root2', '/root3'], options);

      expect(result.files).toContain('/root1/file1.txt');
      expect(result.files).toContain('/root2/file2.pdf');
      expect(result.skippedBundles).toContain('/root3/MyApp.app');
    });
  });
});