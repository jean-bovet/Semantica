import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ReindexOrchestrator } from '../../src/main/worker/ReindexOrchestrator';
import { FileScanner } from '../../src/main/worker/FileScanner';
import type { FileStatus } from '../../src/main/worker/ReindexOrchestrator';

describe('Reindex Integration', () => {
  let orchestrator: ReindexOrchestrator;
  let scanner: FileScanner;

  beforeEach(() => {
    orchestrator = new ReindexOrchestrator();
    scanner = new FileScanner();
  });

  describe('Complete reindex flow', () => {
    it('should correctly identify files to reindex in a typical scenario', () => {
      // Setup: Mix of new, indexed, modified, and failed files
      const allFiles = [
        '/docs/new-file.txt',
        '/docs/indexed-file.pdf',
        '/docs/modified-file.md',
        '/docs/failed-file.doc',
        '/docs/outdated-file.rtf'
      ];

      const fileStatusCache = new Map<string, FileStatus>([
        ['/docs/indexed-file.pdf', {
          path: '/docs/indexed-file.pdf',
          status: 'indexed',
          file_hash: 'abc123',
          indexed_at: '2024-01-01T00:00:00Z',
          parser_version: 2
        }],
        ['/docs/modified-file.md', {
          path: '/docs/modified-file.md',
          status: 'indexed',
          file_hash: 'old-hash',
          indexed_at: '2024-01-01T00:00:00Z',
          last_modified: '2023-12-31T00:00:00Z'
        }],
        ['/docs/failed-file.doc', {
          path: '/docs/failed-file.doc',
          status: 'failed',
          error_message: 'Parse error'
        }],
        ['/docs/outdated-file.rtf', {
          path: '/docs/outdated-file.rtf',
          status: 'outdated',
          parser_version: 1
        }]
      ]);

      // Test: Determine files to reindex
      const { toIndex, reasons } = orchestrator.determineFilesToReindex(
        allFiles,
        fileStatusCache,
        false
      );

      // Verify: Should queue new, failed (for retry), and outdated files
      expect(toIndex).toContain('/docs/new-file.txt');
      expect(toIndex).toContain('/docs/failed-file.doc');
      expect(toIndex).toContain('/docs/outdated-file.rtf');
      expect(toIndex).not.toContain('/docs/indexed-file.pdf');

      // Verify reasons
      expect(reasons.get('/docs/new-file.txt')).toBe('new-file');
      expect(reasons.get('/docs/failed-file.doc')).toBe('retry-failed');
      expect(reasons.get('/docs/outdated-file.rtf')).toBe('outdated');
    });

    it('should handle force reindex correctly', () => {
      const allFiles = [
        '/docs/file1.txt',
        '/docs/file2.pdf',
        '/docs/file3.md'
      ];

      const fileStatusCache = new Map<string, FileStatus>([
        ['/docs/file1.txt', {
          path: '/docs/file1.txt',
          status: 'indexed',
          indexed_at: '2024-01-01T00:00:00Z'
        }],
        ['/docs/file2.pdf', {
          path: '/docs/file2.pdf',
          status: 'indexed',
          indexed_at: '2024-01-01T00:00:00Z'
        }]
      ]);

      // Test: Force reindex should queue all files
      const { toIndex, reasons } = orchestrator.determineFilesToReindex(
        allFiles,
        fileStatusCache,
        true // forceReindex
      );

      // Verify: All files should be queued
      expect(toIndex).toHaveLength(3);
      expect(toIndex).toContain('/docs/file1.txt');
      expect(toIndex).toContain('/docs/file2.pdf');
      expect(toIndex).toContain('/docs/file3.md');

      // All should have force-reindex reason
      expect(reasons.get('/docs/file1.txt')).toBe('force-reindex');
      expect(reasons.get('/docs/file2.pdf')).toBe('force-reindex');
      expect(reasons.get('/docs/file3.md')).toBe('force-reindex');
    });

    it('should filter files correctly with FileScanner', () => {
      const files = [
        '/Users/test/Documents/report.pdf',
        '/Users/test/Documents/notes.txt',
        '/Applications/MyApp.app/Contents/Info.plist',
        '/System/Library/Frameworks/Python.framework/lib/python.py',
        '/Users/test/code.js',
        '/Users/test/image.png'
      ];

      const config = {
        skipBundles: true,
        bundlePatterns: ['**/*.app/**', '**/*.framework/**'],
        supportedExtensions: ['pdf', 'txt', 'md', 'doc', 'docx', 'rtf']
      };

      // Test: Filter files
      const supportedFiles = scanner.filterSupportedFiles(files, config);

      // Verify: Should only include supported files outside bundles
      expect(supportedFiles).toHaveLength(2);
      expect(supportedFiles).toContain('/Users/test/Documents/report.pdf');
      expect(supportedFiles).toContain('/Users/test/Documents/notes.txt');
      expect(supportedFiles).not.toContain('/Applications/MyApp.app/Contents/Info.plist');
      expect(supportedFiles).not.toContain('/System/Library/Frameworks/Python.framework/lib/python.py');
      expect(supportedFiles).not.toContain('/Users/test/code.js');
      expect(supportedFiles).not.toContain('/Users/test/image.png');
    });

    it('should create a complete reindex plan', () => {
      const watchedFolders = ['/Users/test/Documents'];
      const allFiles = [
        '/Users/test/Documents/new.txt',
        '/Users/test/Documents/existing.pdf'
      ];

      const fileStatusCache = new Map<string, FileStatus>([
        // Existing file
        ['/Users/test/Documents/existing.pdf', {
          path: '/Users/test/Documents/existing.pdf',
          status: 'indexed',
          indexed_at: '2024-01-01T00:00:00Z'
        }],
        // File that no longer exists (should be removed)
        ['/Users/test/Documents/deleted.doc', {
          path: '/Users/test/Documents/deleted.doc',
          status: 'indexed',
          indexed_at: '2024-01-01T00:00:00Z'
        }]
      ]);

      // Test: Create reindex plan
      const plan = orchestrator.planReindex(
        watchedFolders,
        allFiles,
        fileStatusCache,
        { force: false }
      );

      // Verify plan
      expect(plan.filesToIndex).toContain('/Users/test/Documents/new.txt');
      expect(plan.filesToIndex).not.toContain('/Users/test/Documents/existing.pdf');
      expect(plan.filesToRemove).toContain('/Users/test/Documents/deleted.doc');
      
      // Verify stats
      expect(plan.stats.totalFiles).toBe(2);
      expect(plan.stats.newFiles).toBe(1);
      expect(plan.stats.skippedFiles).toBe(1);
    });

    it('should validate reindex plans', () => {
      // Test: Valid plan
      const validPlan = {
        filesToIndex: ['/file1.txt', '/file2.pdf'],
        filesToRemove: ['/old.doc'],
        stats: {
          totalFiles: 3,
          newFiles: 2,
          modifiedFiles: 0,
          failedFiles: 0,
          skippedFiles: 1,
          outdatedFiles: 0
        },
        reasons: new Map()
      };

      const validResult = orchestrator.validatePlan(validPlan);
      expect(validResult.valid).toBe(true);
      expect(validResult.errors).toHaveLength(0);

      // Test: Plan with duplicates
      const invalidPlan = {
        filesToIndex: ['/file1.txt', '/file2.pdf', '/file1.txt'],
        filesToRemove: [],
        stats: {
          totalFiles: 3,
          newFiles: 3,
          modifiedFiles: 0,
          failedFiles: 0,
          skippedFiles: 0,
          outdatedFiles: 0
        },
        reasons: new Map()
      };

      const invalidResult = orchestrator.validatePlan(invalidPlan);
      expect(invalidResult.valid).toBe(false);
      expect(invalidResult.errors).toContain('Duplicate files detected in reindex plan');
    });

    it('should handle file categorization with scanner', () => {
      const files = [
        { path: '/new.txt' },
        { path: '/indexed.pdf' },
        { path: '/failed.doc' }
      ];

      const cache = new Map<string, FileStatus>([
        ['/indexed.pdf', {
          path: '/indexed.pdf',
          status: 'indexed',
          indexed_at: '2024-01-01T00:00:00Z'
        }],
        ['/failed.doc', {
          path: '/failed.doc',
          status: 'failed',
          error_message: 'Parse error'
        }]
      ]);

      const options = {
        checkModified: false,
        checkParserVersion: false,
        retryFailed: true,
        retryIntervalHours: 24
      };

      // Test: Categorize files
      const categorized = scanner.categorizeFiles(files, cache, options);

      // Verify categorization
      expect(categorized.new).toContain('/new.txt');
      expect(categorized.skipped).toContain('/indexed.pdf');
      expect(categorized.failed).toContain('/failed.doc');
      expect(categorized.modified).toHaveLength(0);
      expect(categorized.outdated).toHaveLength(0);
    });
  });

  describe('Edge cases', () => {
    it('should handle empty file lists', () => {
      const { toIndex, reasons } = orchestrator.determineFilesToReindex(
        [],
        new Map(),
        false
      );

      expect(toIndex).toHaveLength(0);
      expect(reasons.size).toBe(0);
    });

    it('should handle files with no extensions', () => {
      const files = ['/Makefile', '/README', '/.gitignore'];
      const config = {
        skipBundles: false,
        bundlePatterns: [],
        supportedExtensions: [] // Empty means all files
      };

      const result = scanner.filterSupportedFiles(files, config);
      expect(result).toEqual(files);
    });

    it('should validate file paths', () => {
      const watchedFolders = ['/Users/test/Documents'];

      // Valid paths
      expect(scanner.isValidPath('/Users/test/Documents/file.txt', watchedFolders)).toBe(true);
      expect(scanner.isValidPath('/Users/test/Documents/subfolder/file.pdf', watchedFolders)).toBe(true);

      // Invalid paths
      expect(scanner.isValidPath('relative/path.txt', watchedFolders)).toBe(false);
      expect(scanner.isValidPath('/etc/passwd', watchedFolders)).toBe(false);
      expect(scanner.isValidPath('/Users/test/Documents/../../../etc/passwd', watchedFolders)).toBe(false);
    });
  });
});