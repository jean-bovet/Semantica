import { describe, it, expect, beforeEach } from 'vitest';
import { FileScanner } from '../../src/main/core/indexing/fileScanner';
import type { FileStatus, FileStats, CategorizeOptions, ScanConfig } from '../../src/main/core/indexing/fileScanner';

describe('FileScanner', () => {
  let scanner: FileScanner;

  beforeEach(() => {
    scanner = new FileScanner();
  });

  describe('shouldIndexFile', () => {
    it('should index new files', () => {
      const result = scanner.shouldIndexFile(
        '/path/to/file.txt',
        null,
        false
      );
      
      expect(result.shouldIndex).toBe(true);
      expect(result.reason).toBe('new-file');
    });

    it('should skip already indexed files', () => {
      const fileRecord: FileStatus = {
        path: '/path/to/file.txt',
        status: 'indexed',
        indexed_at: '2024-01-01T00:00:00Z'
      };
      
      const result = scanner.shouldIndexFile(
        '/path/to/file.txt',
        fileRecord,
        false
      );
      
      expect(result.shouldIndex).toBe(false);
      expect(result.reason).toBeUndefined();
    });

    it('should index modified files', () => {
      const fileRecord: FileStatus = {
        path: '/path/to/file.txt',
        status: 'indexed',
        file_hash: 'old-hash',
        indexed_at: '2024-01-01T00:00:00Z'
      };
      
      const fileStats: FileStats = {
        hash: 'new-hash',
        mtime: new Date('2024-01-02'),
        size: 1024
      };
      
      const options: CategorizeOptions = {
        checkModified: true,
        checkParserVersion: false,
        retryFailed: false
      };
      
      const result = scanner.shouldIndexFile(
        '/path/to/file.txt',
        fileRecord,
        false,
        fileStats,
        options
      );
      
      expect(result.shouldIndex).toBe(true);
      expect(result.reason).toBe('modified');
    });

    it('should respect forceReindex flag', () => {
      const fileRecord: FileStatus = {
        path: '/path/to/file.txt',
        status: 'indexed',
        indexed_at: '2024-01-01T00:00:00Z'
      };
      
      const result = scanner.shouldIndexFile(
        '/path/to/file.txt',
        fileRecord,
        true // forceReindex
      );
      
      expect(result.shouldIndex).toBe(true);
      expect(result.reason).toBe('force-reindex');
    });

    it('should index files with outdated status', () => {
      const fileRecord: FileStatus = {
        path: '/path/to/file.txt',
        status: 'outdated',
        parser_version: 1
      };
      
      const result = scanner.shouldIndexFile(
        '/path/to/file.txt',
        fileRecord,
        false
      );
      
      expect(result.shouldIndex).toBe(true);
      expect(result.reason).toBe('outdated');
    });

    it('should index files with outdated parser version', () => {
      const fileRecord: FileStatus = {
        path: '/path/to/file.txt',
        status: 'indexed',
        parser_version: 1
      };
      
      const options: CategorizeOptions = {
        checkModified: false,
        checkParserVersion: true,
        currentParserVersion: 2,
        retryFailed: false
      };
      
      const result = scanner.shouldIndexFile(
        '/path/to/file.txt',
        fileRecord,
        false,
        undefined,
        options
      );
      
      expect(result.shouldIndex).toBe(true);
      expect(result.reason).toBe('parser-upgraded');
    });

    it('should retry failed files when appropriate', () => {
      const fileRecord: FileStatus = {
        path: '/path/to/file.txt',
        status: 'failed',
        error_message: 'Parse error',
        last_retry: new Date(Date.now() - 25 * 60 * 60 * 1000).toISOString() // 25 hours ago
      };
      
      const options: CategorizeOptions = {
        checkModified: false,
        checkParserVersion: false,
        retryFailed: true,
        retryIntervalHours: 24
      };
      
      const result = scanner.shouldIndexFile(
        '/path/to/file.txt',
        fileRecord,
        false,
        undefined,
        options
      );
      
      expect(result.shouldIndex).toBe(true);
      expect(result.reason).toBe('retry-failed');
    });

    it('should not retry recently failed files', () => {
      const fileRecord: FileStatus = {
        path: '/path/to/file.txt',
        status: 'failed',
        error_message: 'Parse error',
        last_retry: new Date(Date.now() - 1 * 60 * 60 * 1000).toISOString() // 1 hour ago
      };
      
      const options: CategorizeOptions = {
        checkModified: false,
        checkParserVersion: false,
        retryFailed: true,
        retryIntervalHours: 24
      };
      
      const result = scanner.shouldIndexFile(
        '/path/to/file.txt',
        fileRecord,
        false,
        undefined,
        options
      );
      
      expect(result.shouldIndex).toBe(false);
    });
  });

  describe('categorizeFiles', () => {
    it('should separate files by status', () => {
      const files = [
        { path: '/new.txt' },
        { path: '/indexed.pdf' },
        { path: '/failed.doc' },
        { path: '/modified.md', stats: { hash: 'new-hash', mtime: new Date(), size: 100 } }
      ];
      
      const cache = new Map<string, FileStatus>([
        ['/indexed.pdf', { path: '/indexed.pdf', status: 'indexed' }],
        ['/failed.doc', { path: '/failed.doc', status: 'failed' }],
        ['/modified.md', { path: '/modified.md', status: 'indexed', file_hash: 'old-hash' }]
      ]);
      
      const options: CategorizeOptions = {
        checkModified: true,
        checkParserVersion: false,
        retryFailed: true,
        retryIntervalHours: 24
      };
      
      const result = scanner.categorizeFiles(files, cache, options);
      
      expect(result.new).toContain('/new.txt');
      expect(result.skipped).toContain('/indexed.pdf');
      expect(result.failed).toContain('/failed.doc');
      expect(result.modified).toContain('/modified.md');
    });

    it('should handle empty cache', () => {
      const files = [
        { path: '/file1.txt' },
        { path: '/file2.pdf' },
        { path: '/file3.md' }
      ];
      
      const cache = new Map<string, FileStatus>();
      
      const options: CategorizeOptions = {
        checkModified: false,
        checkParserVersion: false,
        retryFailed: false
      };
      
      const result = scanner.categorizeFiles(files, cache, options);
      
      expect(result.new).toHaveLength(3);
      expect(result.new).toContain('/file1.txt');
      expect(result.new).toContain('/file2.pdf');
      expect(result.new).toContain('/file3.md');
      expect(result.skipped).toHaveLength(0);
    });

    it('should identify parser upgrade candidates', () => {
      const files = [
        { path: '/old-parser.txt' },
        { path: '/current-parser.pdf' }
      ];
      
      const cache = new Map<string, FileStatus>([
        ['/old-parser.txt', { path: '/old-parser.txt', status: 'indexed', parser_version: 1 }],
        ['/current-parser.pdf', { path: '/current-parser.pdf', status: 'indexed', parser_version: 2 }]
      ]);
      
      const options: CategorizeOptions = {
        checkModified: false,
        checkParserVersion: true,
        currentParserVersion: 2,
        retryFailed: false
      };
      
      const result = scanner.categorizeFiles(files, cache, options);
      
      expect(result.outdated).toContain('/old-parser.txt');
      expect(result.skipped).toContain('/current-parser.pdf');
    });
  });

  describe('filterSupportedFiles', () => {
    it('should filter by supported extensions', () => {
      const paths = [
        '/file.txt',
        '/document.pdf',
        '/image.png',
        '/code.js',
        '/data.json'
      ];
      
      const config: ScanConfig = {
        skipBundles: false,
        bundlePatterns: [],
        supportedExtensions: ['txt', 'pdf', 'md']
      };
      
      const result = scanner.filterSupportedFiles(paths, config);
      
      expect(result).toContain('/file.txt');
      expect(result).toContain('/document.pdf');
      expect(result).not.toContain('/image.png');
      expect(result).not.toContain('/code.js');
      expect(result).not.toContain('/data.json');
    });

    it('should handle extensions with dots', () => {
      const paths = ['/file.txt', '/document.pdf'];
      
      const config: ScanConfig = {
        skipBundles: false,
        bundlePatterns: [],
        supportedExtensions: ['.txt', '.pdf'] // With dots
      };
      
      const result = scanner.filterSupportedFiles(paths, config);
      
      expect(result).toContain('/file.txt');
      expect(result).toContain('/document.pdf');
    });

    it('should skip files in bundles when configured', () => {
      const paths = [
        '/Applications/MyApp.app/Contents/MacOS/binary',
        '/Applications/MyApp.app/Contents/Resources/data.txt',
        '/Documents/regular.txt',
        '/Library/Frameworks/SDL.framework/Headers/SDL.h'
      ];
      
      const config: ScanConfig = {
        skipBundles: true,
        bundlePatterns: ['**/*.app/**', '**/*.framework/**'],
        supportedExtensions: ['txt', 'h']
      };
      
      const result = scanner.filterSupportedFiles(paths, config);
      
      expect(result).not.toContain('/Applications/MyApp.app/Contents/Resources/data.txt');
      expect(result).not.toContain('/Library/Frameworks/SDL.framework/Headers/SDL.h');
      expect(result).toContain('/Documents/regular.txt');
    });

    it('should allow all files when no extension filter', () => {
      const paths = ['/file.txt', '/document.pdf', '/image.png'];
      
      const config: ScanConfig = {
        skipBundles: false,
        bundlePatterns: [],
        supportedExtensions: [] // Empty means all extensions
      };
      
      const result = scanner.filterSupportedFiles(paths, config);
      
      expect(result).toEqual(paths);
    });
  });

  describe('isValidPath', () => {
    it('should validate absolute paths in watched folders', () => {
      const watchedFolders = ['/Users/test/Documents', '/Users/test/Desktop'];
      
      expect(scanner.isValidPath('/Users/test/Documents/file.txt', watchedFolders)).toBe(true);
      expect(scanner.isValidPath('/Users/test/Desktop/file.pdf', watchedFolders)).toBe(true);
    });

    it('should reject relative paths', () => {
      const watchedFolders = ['/Users/test/Documents'];
      
      expect(scanner.isValidPath('file.txt', watchedFolders)).toBe(false);
      expect(scanner.isValidPath('./file.txt', watchedFolders)).toBe(false);
      expect(scanner.isValidPath('../file.txt', watchedFolders)).toBe(false);
    });

    it('should reject paths outside watched folders', () => {
      const watchedFolders = ['/Users/test/Documents'];
      
      expect(scanner.isValidPath('/Users/other/file.txt', watchedFolders)).toBe(false);
      expect(scanner.isValidPath('/tmp/file.txt', watchedFolders)).toBe(false);
    });

    it('should reject paths with dangerous patterns', () => {
      const watchedFolders = ['/Users/test/Documents'];
      
      expect(scanner.isValidPath('/Users/test/Documents/../../../etc/passwd', watchedFolders)).toBe(false);
      expect(scanner.isValidPath('/Users/test/Documents/./file.txt', watchedFolders)).toBe(false);
      expect(scanner.isValidPath('/Users/test/Documents//file.txt', watchedFolders)).toBe(false);
    });
  });

  describe('groupFilesByDirectory', () => {
    it('should group files by parent directory', () => {
      const files = [
        '/Users/test/Documents/file1.txt',
        '/Users/test/Documents/file2.pdf',
        '/Users/test/Desktop/file3.md',
        '/Users/test/Desktop/file4.doc',
        '/Users/test/Downloads/file5.rtf'
      ];
      
      const grouped = scanner.groupFilesByDirectory(files);
      
      expect(grouped.get('/Users/test/Documents')).toEqual([
        '/Users/test/Documents/file1.txt',
        '/Users/test/Documents/file2.pdf'
      ]);
      expect(grouped.get('/Users/test/Desktop')).toEqual([
        '/Users/test/Desktop/file3.md',
        '/Users/test/Desktop/file4.doc'
      ]);
      expect(grouped.get('/Users/test/Downloads')).toEqual([
        '/Users/test/Downloads/file5.rtf'
      ]);
    });

    it('should handle root directory files', () => {
      const files = ['/file.txt', '/another.pdf'];
      
      const grouped = scanner.groupFilesByDirectory(files);
      
      expect(grouped.get('/')).toEqual(['/file.txt', '/another.pdf']);
    });
  });

  describe('calculateScanStats', () => {
    it('should calculate correct statistics', () => {
      const categorized = {
        new: ['file1.txt', 'file2.pdf'],
        modified: ['file3.md'],
        failed: ['file4.doc'],
        skipped: ['file5.rtf', 'file6.txt'],
        outdated: ['file7.pdf']
      };
      
      const stats = scanner.calculateScanStats(categorized);
      
      expect(stats.total).toBe(7);
      expect(stats.new).toBe(2);
      expect(stats.modified).toBe(1);
      expect(stats.failed).toBe(1);
      expect(stats.skipped).toBe(2);
      expect(stats.outdated).toBe(1);
      expect(stats.toProcess).toBe(5); // new + modified + failed + outdated
    });

    it('should handle empty categories', () => {
      const categorized = {
        new: [],
        modified: [],
        failed: [],
        skipped: [],
        outdated: []
      };
      
      const stats = scanner.calculateScanStats(categorized);
      
      expect(stats.total).toBe(0);
      expect(stats.toProcess).toBe(0);
      expect(stats.new).toBe(0);
      expect(stats.modified).toBe(0);
      expect(stats.failed).toBe(0);
      expect(stats.skipped).toBe(0);
      expect(stats.outdated).toBe(0);
    });
  });

  describe('bundle detection', () => {
    it('should detect files inside .app bundles', () => {
      const config: ScanConfig = {
        skipBundles: true,
        bundlePatterns: ['**/*.app/**'],
        supportedExtensions: []
      };
      
      const paths = [
        '/Applications/SDL-X (x86-64).app/Contents/MacOS/SDL',
        '/Users/test/MyApp.app/Contents/Resources/data.txt',
        '/Applications/Xcode.app/Contents/Developer/file.txt',
        '/Users/test/regular.txt'
      ];
      
      const result = scanner.filterSupportedFiles(paths, config);
      
      expect(result).not.toContain('/Applications/SDL-X (x86-64).app/Contents/MacOS/SDL');
      expect(result).not.toContain('/Users/test/MyApp.app/Contents/Resources/data.txt');
      expect(result).not.toContain('/Applications/Xcode.app/Contents/Developer/file.txt');
      expect(result).toContain('/Users/test/regular.txt');
    });

    it('should detect files inside .framework bundles', () => {
      const config: ScanConfig = {
        skipBundles: true,
        bundlePatterns: ['**/*.framework/**'],
        supportedExtensions: []
      };
      
      const paths = [
        '/System/Library/Frameworks/Python.framework/Versions/3.9/lib/python3.9',
        '/Library/Frameworks/SDL2.framework/Headers/SDL.h',
        '/Users/test/regular.txt'
      ];
      
      const result = scanner.filterSupportedFiles(paths, config);
      
      expect(result).not.toContain('/System/Library/Frameworks/Python.framework/Versions/3.9/lib/python3.9');
      expect(result).not.toContain('/Library/Frameworks/SDL2.framework/Headers/SDL.h');
      expect(result).toContain('/Users/test/regular.txt');
    });

    it('should handle edge cases in bundle detection', () => {
      const config: ScanConfig = {
        skipBundles: true,
        bundlePatterns: ['**/*.app/**'],
        supportedExtensions: []
      };
      
      const paths = [
        '/Users/test/myapp.application.txt', // Not a bundle
        '/Users/test/not.app.really/file.txt', // Not a valid bundle name
        '/Users/test/MyApp.app/file.txt', // Valid bundle
      ];
      
      const result = scanner.filterSupportedFiles(paths, config);
      
      expect(result).toContain('/Users/test/myapp.application.txt');
      expect(result).toContain('/Users/test/not.app.really/file.txt');
      expect(result).not.toContain('/Users/test/MyApp.app/file.txt');
    });
  });
});