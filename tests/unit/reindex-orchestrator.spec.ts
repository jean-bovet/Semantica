import { describe, it, expect, beforeEach } from 'vitest';
import { ReindexOrchestrator } from '../../src/main/worker/ReindexOrchestrator';
import type { FileStatus, ReindexOptions } from '../../src/main/worker/ReindexOrchestrator';

describe('ReindexOrchestrator', () => {
  let orchestrator: ReindexOrchestrator;

  beforeEach(() => {
    orchestrator = new ReindexOrchestrator();
  });

  describe('determineFilesToReindex', () => {
    it('should queue all files when forceReindex is true', () => {
      const files = ['file1.txt', 'file2.pdf', 'file3.md'];
      const cache = new Map<string, FileStatus>([
        ['file1.txt', { 
          path: 'file1.txt',
          status: 'indexed', 
          file_hash: 'abc123',
          indexed_at: '2024-01-01T00:00:00Z'
        }],
        ['file2.pdf', { 
          path: 'file2.pdf',
          status: 'failed', 
          file_hash: 'def456',
          error_message: 'Parse error'
        }]
      ]);
      
      const result = orchestrator.determineFilesToReindex(files, cache, true);
      
      expect(result.toIndex).toEqual(files);
      expect(result.reasons.get('file1.txt')).toBe('force-reindex');
      expect(result.reasons.get('file2.pdf')).toBe('force-reindex');
      expect(result.reasons.get('file3.md')).toBe('force-reindex');
    });

    it('should skip indexed files when forceReindex is false', () => {
      const files = ['file1.txt', 'file2.pdf'];
      const cache = new Map<string, FileStatus>([
        ['file1.txt', { 
          path: 'file1.txt',
          status: 'indexed',
          indexed_at: '2024-01-01T00:00:00Z'
        }],
        ['file2.pdf', { 
          path: 'file2.pdf',
          status: 'indexed',
          indexed_at: '2024-01-01T00:00:00Z'
        }]
      ]);
      
      const result = orchestrator.determineFilesToReindex(files, cache, false);
      
      expect(result.toIndex).toEqual([]);
      expect(result.reasons.size).toBe(0);
    });

    it('should queue new files not in cache', () => {
      const files = ['file1.txt', 'file2.pdf', 'file3.md'];
      const cache = new Map<string, FileStatus>([
        ['file1.txt', { 
          path: 'file1.txt',
          status: 'indexed',
          indexed_at: '2024-01-01T00:00:00Z'
        }]
      ]);
      
      const result = orchestrator.determineFilesToReindex(files, cache, false);
      
      expect(result.toIndex).toContain('file2.pdf');
      expect(result.toIndex).toContain('file3.md');
      expect(result.toIndex).not.toContain('file1.txt');
      expect(result.reasons.get('file2.pdf')).toBe('new-file');
      expect(result.reasons.get('file3.md')).toBe('new-file');
    });

    it('should queue files with outdated parser versions', () => {
      const files = ['file1.txt', 'file2.pdf'];
      const cache = new Map<string, FileStatus>([
        ['file1.txt', { 
          path: 'file1.txt',
          status: 'outdated',
          parser_version: 1
        }],
        ['file2.pdf', { 
          path: 'file2.pdf',
          status: 'indexed',
          parser_version: 2
        }]
      ]);
      
      const result = orchestrator.determineFilesToReindex(files, cache, false);
      
      expect(result.toIndex).toContain('file1.txt');
      expect(result.toIndex).not.toContain('file2.pdf');
      expect(result.reasons.get('file1.txt')).toBe('outdated');
    });

    it('should handle empty file lists', () => {
      const files: string[] = [];
      const cache = new Map<string, FileStatus>();
      
      const result = orchestrator.determineFilesToReindex(files, cache, false);
      
      expect(result.toIndex).toEqual([]);
      expect(result.reasons.size).toBe(0);
    });

    it('should retry failed files that have not been retried', () => {
      const files = ['file1.txt', 'file2.pdf'];
      const cache = new Map<string, FileStatus>([
        ['file1.txt', { 
          path: 'file1.txt',
          status: 'failed',
          error_message: 'Parse error',
          // No last_retry, should be retried
        }],
        ['file2.pdf', { 
          path: 'file2.pdf',
          status: 'error',
          error_message: 'Unknown error',
          last_retry: new Date(Date.now() - 25 * 60 * 60 * 1000).toISOString() // 25 hours ago
        }]
      ]);
      
      const result = orchestrator.determineFilesToReindex(files, cache, false);
      
      expect(result.toIndex).toContain('file1.txt');
      expect(result.toIndex).toContain('file2.pdf');
      expect(result.reasons.get('file1.txt')).toBe('retry-failed');
      expect(result.reasons.get('file2.pdf')).toBe('retry-failed');
    });

    it('should not retry failed files that were recently retried', () => {
      const files = ['file1.txt'];
      const cache = new Map<string, FileStatus>([
        ['file1.txt', { 
          path: 'file1.txt',
          status: 'failed',
          error_message: 'Parse error',
          last_retry: new Date(Date.now() - 1 * 60 * 60 * 1000).toISOString() // 1 hour ago
        }]
      ]);
      
      const result = orchestrator.determineFilesToReindex(files, cache, false);
      
      expect(result.toIndex).not.toContain('file1.txt');
      expect(result.reasons.size).toBe(0);
    });
  });

  describe('calculateReindexStats', () => {
    it('should count new files correctly', () => {
      const files = ['file1.txt', 'file2.pdf', 'file3.md'];
      const cache = new Map<string, FileStatus>();
      const reasons = new Map([
        ['file1.txt', 'new-file' as const],
        ['file2.pdf', 'new-file' as const],
        ['file3.md', 'new-file' as const]
      ]);
      
      const stats = orchestrator.calculateReindexStats(files, cache, reasons);
      
      expect(stats.newFiles).toBe(3);
      expect(stats.modifiedFiles).toBe(0);
      expect(stats.failedFiles).toBe(0);
      expect(stats.outdatedFiles).toBe(0);
      expect(stats.skippedFiles).toBe(0);
      expect(stats.totalFiles).toBe(3);
    });

    it('should identify modified files', () => {
      const files = ['file1.txt', 'file2.pdf'];
      const cache = new Map<string, FileStatus>([
        ['file1.txt', { path: 'file1.txt', status: 'indexed' }],
        ['file2.pdf', { path: 'file2.pdf', status: 'indexed' }]
      ]);
      const reasons = new Map([
        ['file1.txt', 'modified' as const],
        ['file2.pdf', 'modified' as const]
      ]);
      
      const stats = orchestrator.calculateReindexStats(files, cache, reasons);
      
      expect(stats.modifiedFiles).toBe(2);
      expect(stats.newFiles).toBe(0);
    });

    it('should track skipped files', () => {
      const files = ['file1.txt', 'file2.pdf', 'file3.md'];
      const cache = new Map<string, FileStatus>([
        ['file1.txt', { path: 'file1.txt', status: 'indexed' }],
        ['file2.pdf', { path: 'file2.pdf', status: 'indexed' }]
      ]);
      const reasons = new Map([
        ['file3.md', 'new-file' as const]
      ]);
      
      const stats = orchestrator.calculateReindexStats(files, cache, reasons);
      
      expect(stats.skippedFiles).toBe(2);
      expect(stats.newFiles).toBe(1);
      expect(stats.totalFiles).toBe(3);
    });

    it('should count outdated and parser-upgraded files', () => {
      const files = ['file1.txt', 'file2.pdf', 'file3.md'];
      const cache = new Map<string, FileStatus>([
        ['file1.txt', { path: 'file1.txt', status: 'outdated' }],
        ['file2.pdf', { path: 'file2.pdf', status: 'indexed', parser_version: 1 }],
        ['file3.md', { path: 'file3.md', status: 'indexed', parser_version: 1 }]
      ]);
      const reasons = new Map([
        ['file1.txt', 'outdated' as const],
        ['file2.pdf', 'parser-upgraded' as const],
        ['file3.md', 'parser-upgraded' as const]
      ]);
      
      const stats = orchestrator.calculateReindexStats(files, cache, reasons);
      
      expect(stats.outdatedFiles).toBe(3);
      expect(stats.newFiles).toBe(0);
      expect(stats.modifiedFiles).toBe(0);
    });

    it('should count retry-failed files', () => {
      const files = ['file1.txt', 'file2.pdf'];
      const cache = new Map<string, FileStatus>([
        ['file1.txt', { path: 'file1.txt', status: 'failed' }],
        ['file2.pdf', { path: 'file2.pdf', status: 'error' }]
      ]);
      const reasons = new Map([
        ['file1.txt', 'retry-failed' as const],
        ['file2.pdf', 'retry-failed' as const]
      ]);
      
      const stats = orchestrator.calculateReindexStats(files, cache, reasons);
      
      expect(stats.failedFiles).toBe(2);
      expect(stats.totalFiles).toBe(2);
    });
  });

  describe('planReindex', () => {
    it('should create a complete reindex plan', () => {
      const watchedFolders = ['/test/folder'];
      const allFiles = ['file1.txt', 'file2.pdf', 'file3.md'];
      const cache = new Map<string, FileStatus>([
        ['file1.txt', { path: 'file1.txt', status: 'indexed' }],
        ['file2.pdf', { path: 'file2.pdf', status: 'failed' }]
      ]);
      const options: ReindexOptions = { force: false };
      
      const plan = orchestrator.planReindex(watchedFolders, allFiles, cache, options);
      
      expect(plan.filesToIndex).toContain('file3.md'); // new file
      expect(plan.filesToIndex).toContain('file2.pdf'); // failed file to retry
      expect(plan.filesToIndex).not.toContain('file1.txt'); // already indexed
      expect(plan.stats.totalFiles).toBe(3);
      expect(plan.stats.newFiles).toBe(1);
      expect(plan.stats.failedFiles).toBe(1);
      expect(plan.stats.skippedFiles).toBe(1);
    });

    it('should identify files to remove (deleted from filesystem)', () => {
      const watchedFolders = ['/test/folder'];
      const allFiles = ['/test/folder/file1.txt'];
      const cache = new Map<string, FileStatus>([
        ['/test/folder/file1.txt', { path: '/test/folder/file1.txt', status: 'indexed' }],
        ['/test/folder/file2.pdf', { path: '/test/folder/file2.pdf', status: 'indexed' }], // No longer exists
        ['/test/folder/file3.md', { path: '/test/folder/file3.md', status: 'indexed' }] // No longer exists
      ]);
      
      const plan = orchestrator.planReindex(watchedFolders, allFiles, cache, {});
      
      expect(plan.filesToRemove).toContain('/test/folder/file2.pdf');
      expect(plan.filesToRemove).toContain('/test/folder/file3.md');
      expect(plan.filesToRemove).not.toContain('/test/folder/file1.txt');
    });

    it('should not remove files outside watched folders', () => {
      const watchedFolders = ['/test/folder'];
      const allFiles = [];
      const cache = new Map<string, FileStatus>([
        ['/other/folder/file1.txt', { path: '/other/folder/file1.txt', status: 'indexed' }],
        ['/test/folder/file2.pdf', { path: '/test/folder/file2.pdf', status: 'indexed' }]
      ]);
      
      const plan = orchestrator.planReindex(watchedFolders, allFiles, cache, {});
      
      expect(plan.filesToRemove).not.toContain('/other/folder/file1.txt');
      expect(plan.filesToRemove).toContain('/test/folder/file2.pdf');
    });

    it('should handle force reindex option', () => {
      const watchedFolders = ['/test/folder'];
      const allFiles = ['file1.txt', 'file2.pdf'];
      const cache = new Map<string, FileStatus>([
        ['file1.txt', { path: 'file1.txt', status: 'indexed' }],
        ['file2.pdf', { path: 'file2.pdf', status: 'indexed' }]
      ]);
      const options: ReindexOptions = { force: true };
      
      const plan = orchestrator.planReindex(watchedFolders, allFiles, cache, options);
      
      expect(plan.filesToIndex).toEqual(allFiles);
      expect(plan.reasons.get('file1.txt')).toBe('force-reindex');
      expect(plan.reasons.get('file2.pdf')).toBe('force-reindex');
    });
  });

  describe('groupFilesByReason', () => {
    it('should group files by their index reason', () => {
      const reasons = new Map([
        ['file1.txt', 'new-file' as const],
        ['file2.pdf', 'new-file' as const],
        ['file3.md', 'modified' as const],
        ['file4.doc', 'modified' as const],
        ['file5.rtf', 'retry-failed' as const]
      ]);
      
      const grouped = orchestrator.groupFilesByReason(reasons);
      
      expect(grouped.get('new-file')).toEqual(['file1.txt', 'file2.pdf']);
      expect(grouped.get('modified')).toEqual(['file3.md', 'file4.doc']);
      expect(grouped.get('retry-failed')).toEqual(['file5.rtf']);
    });

    it('should handle empty reasons map', () => {
      const reasons = new Map();
      
      const grouped = orchestrator.groupFilesByReason(reasons);
      
      expect(grouped.size).toBe(0);
    });
  });

  describe('validatePlan', () => {
    it('should validate a normal plan', () => {
      const plan = {
        filesToIndex: ['file1.txt', 'file2.pdf'],
        filesToRemove: ['file3.md'],
        stats: {
          totalFiles: 3,
          newFiles: 1,
          modifiedFiles: 1,
          failedFiles: 0,
          skippedFiles: 1,
          outdatedFiles: 0
        },
        reasons: new Map()
      };
      
      const validation = orchestrator.validatePlan(plan);
      
      expect(validation.valid).toBe(true);
      expect(validation.errors).toHaveLength(0);
      expect(validation.warnings).toHaveLength(0);
    });

    it('should warn about large reindex operations', () => {
      const plan = {
        filesToIndex: Array.from({ length: 10001 }, (_, i) => `file${i}.txt`),
        filesToRemove: [],
        stats: {
          totalFiles: 10001,
          newFiles: 10001,
          modifiedFiles: 0,
          failedFiles: 0,
          skippedFiles: 0,
          outdatedFiles: 0
        },
        reasons: new Map()
      };
      
      const validation = orchestrator.validatePlan(plan);
      
      expect(validation.valid).toBe(true);
      expect(validation.warnings).toContain('Large reindex operation: 10001 files');
    });

    it('should warn about many files to remove', () => {
      const plan = {
        filesToIndex: [],
        filesToRemove: Array.from({ length: 101 }, (_, i) => `file${i}.txt`),
        stats: {
          totalFiles: 0,
          newFiles: 0,
          modifiedFiles: 0,
          failedFiles: 0,
          skippedFiles: 0,
          outdatedFiles: 0
        },
        reasons: new Map()
      };
      
      const validation = orchestrator.validatePlan(plan);
      
      expect(validation.valid).toBe(true);
      expect(validation.warnings).toContain('Many files to remove: 101 files');
    });

    it('should error on duplicate files in plan', () => {
      const plan = {
        filesToIndex: ['file1.txt', 'file2.pdf', 'file1.txt'], // duplicate
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
      
      const validation = orchestrator.validatePlan(plan);
      
      expect(validation.valid).toBe(false);
      expect(validation.errors).toContain('Duplicate files detected in reindex plan');
    });

    it('should warn about inconsistent stats', () => {
      const plan = {
        filesToIndex: ['file1.txt', 'file2.pdf'],
        filesToRemove: [],
        stats: {
          totalFiles: 10, // Doesn't match sum of categories
          newFiles: 1,
          modifiedFiles: 1,
          failedFiles: 0,
          skippedFiles: 0,
          outdatedFiles: 0
        },
        reasons: new Map()
      };
      
      const validation = orchestrator.validatePlan(plan);
      
      expect(validation.warnings).toContain('Stats totals do not match total file count');
    });
  });
});