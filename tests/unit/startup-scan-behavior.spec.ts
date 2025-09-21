import { describe, it, expect, beforeEach, vi } from 'vitest';
import * as fs from 'node:fs';
import { scanForChanges } from '../../src/main/core/indexing/fileStatusManager';
import { shouldReindex } from '../../src/main/core/reindex/reindexManager';

// Mock modules
vi.mock('node:fs');
vi.mock('../../src/main/core/reindex/reindexManager', () => ({
  shouldReindex: vi.fn()
}));

describe('Startup Scan Behavior', () => {
  const supportedExtensions = ['txt', 'pdf', 'docx', 'md'];
  
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(shouldReindex).mockReturnValue(false);
  });

  describe('scanForChanges - Core Problem Tests', () => {
    it('should NOT treat indexed files as new when status records exist', async () => {
      const files = [
        '/docs/file1.txt',
        '/docs/file2.pdf',
        '/docs/file3.md'
      ];
      
      // All files have status records showing they're indexed
      const fileStatusCache = new Map([
        ['/docs/file1.txt', {
          path: '/docs/file1.txt',
          status: 'indexed',
          indexed_at: new Date().toISOString(),
          file_hash: 'hash1',
          parser_version: 1,
          chunk_count: 5,
          error_message: '',
          last_modified: new Date().toISOString(),
          last_retry: ''
        }],
        ['/docs/file2.pdf', {
          path: '/docs/file2.pdf',
          status: 'indexed',
          indexed_at: new Date().toISOString(),
          file_hash: 'hash2',
          parser_version: 1,
          chunk_count: 10,
          error_message: '',
          last_modified: new Date().toISOString(),
          last_retry: ''
        }],
        ['/docs/file3.md', {
          path: '/docs/file3.md',
          status: 'indexed',
          indexed_at: new Date().toISOString(),
          file_hash: 'hash3',
          parser_version: 1,
          chunk_count: 3,
          error_message: '',
          last_modified: new Date().toISOString(),
          last_retry: ''
        }]
      ]);
      
      // Files haven't been modified
      vi.mocked(fs.statSync).mockReturnValue({
        mtimeMs: Date.now() - 1000000, // Old modification time
        size: 1024
      } as any);
      
      const result = await scanForChanges(files, fileStatusCache, supportedExtensions);
      
      // CRITICAL: No files should be marked as new!
      expect(result.newFiles).toHaveLength(0);
      expect(result.modifiedFiles).toHaveLength(0);
      expect(result.skippedFiles).toHaveLength(3);
      expect(result.hashCalculations).toBe(0);
    });

    it('should only mark files without status records as new', async () => {
      const files = [
        '/docs/existing.txt',  // Has status record
        '/docs/new.pdf'        // No status record
      ];
      
      const fileStatusCache = new Map([
        ['/docs/existing.txt', {
          path: '/docs/existing.txt',
          status: 'indexed',
          indexed_at: new Date().toISOString(),
          file_hash: 'hash1',
          parser_version: 1,
          chunk_count: 5,
          error_message: '',
          last_modified: new Date().toISOString(),
          last_retry: ''
        }]
        // Note: /docs/new.pdf is NOT in the cache
      ]);
      
      vi.mocked(fs.statSync).mockReturnValue({
        mtimeMs: Date.now() - 1000000,
        size: 1024
      } as any);
      
      const result = await scanForChanges(files, fileStatusCache, supportedExtensions);
      
      expect(result.newFiles).toEqual(['/docs/new.pdf']);
      expect(result.modifiedFiles).toHaveLength(0);
      expect(result.skippedFiles).toEqual(['/docs/existing.txt']);
    });

    it('should handle empty file status cache correctly', async () => {
      const files = ['/docs/file1.txt', '/docs/file2.pdf'];
      
      // Empty cache - simulates fresh install or corrupted status table
      const fileStatusCache = new Map();
      
      const result = await scanForChanges(files, fileStatusCache, supportedExtensions);
      
      // All files should be new when cache is empty
      expect(result.newFiles).toEqual(files);
      expect(result.modifiedFiles).toHaveLength(0);
      expect(result.skippedFiles).toHaveLength(0);
    });

    it('should skip files with failed/error status', async () => {
      const files = [
        '/docs/good.txt',
        '/docs/failed.pdf',
        '/docs/error.docx'
      ];
      
      const fileStatusCache = new Map([
        ['/docs/good.txt', {
          path: '/docs/good.txt',
          status: 'indexed',
          indexed_at: new Date().toISOString(),
          file_hash: 'hash1',
          parser_version: 1,
          chunk_count: 5,
          error_message: '',
          last_modified: new Date().toISOString(),
          last_retry: ''
        }],
        ['/docs/failed.pdf', {
          path: '/docs/failed.pdf',
          status: 'failed',
          indexed_at: new Date().toISOString(),
          file_hash: 'hash2',
          parser_version: 1,
          chunk_count: 0,
          error_message: 'Parse error',
          last_modified: new Date().toISOString(),
          last_retry: new Date().toISOString()
        }],
        ['/docs/error.docx', {
          path: '/docs/error.docx',
          status: 'error',
          indexed_at: new Date().toISOString(),
          file_hash: 'hash3',
          parser_version: 1,
          chunk_count: 0,
          error_message: 'Read error',
          last_modified: new Date().toISOString(),
          last_retry: new Date().toISOString()
        }]
      ]);
      
      vi.mocked(fs.statSync).mockReturnValue({
        mtimeMs: Date.now() - 1000000,
        size: 1024
      } as any);
      
      const result = await scanForChanges(files, fileStatusCache, supportedExtensions);
      
      expect(result.newFiles).toHaveLength(0);
      expect(result.modifiedFiles).toHaveLength(0);
      expect(result.skippedFiles).toHaveLength(3); // All skipped
    });
  });

  describe('Integration Scenario - Reproducing the Bug', () => {
    it('should handle 1616 files with only 46 status records correctly', async () => {
      // Simulate the exact scenario from the logs:
      // - 1616 total files in directory
      // - Only 46 have status records (mostly failed)
      // - 1570 should be treated as new (1616 - 46)
      
      const totalFiles = 1616;
      const statusRecordCount = 46;
      
      // Generate file list
      const files = Array.from({ length: totalFiles }, (_, i) => 
        `/docs/file${i}.${i % 3 === 0 ? 'txt' : i % 3 === 1 ? 'pdf' : 'md'}`
      );
      
      // Create status cache with only 46 records (mix of failed and indexed)
      const fileStatusCache = new Map();
      for (let i = 0; i < statusRecordCount; i++) {
        const status = i < 30 ? 'failed' : 'indexed';
        fileStatusCache.set(files[i], {
          path: files[i],
          status,
          indexed_at: new Date().toISOString(),
          file_hash: `hash${i}`,
          parser_version: 1,
          chunk_count: status === 'indexed' ? 5 : 0,
          error_message: status === 'failed' ? 'Parse error' : '',
          last_modified: new Date().toISOString(),
          last_retry: status === 'failed' ? new Date().toISOString() : ''
        });
      }
      
      vi.mocked(fs.statSync).mockReturnValue({
        mtimeMs: Date.now() - 1000000,
        size: 1024
      } as any);
      
      const result = await scanForChanges(files, fileStatusCache, supportedExtensions);
      
      // The bug: All 1570 files without status records are marked as new
      expect(result.newFiles).toHaveLength(1570); // 1616 - 46
      expect(result.skippedFiles).toHaveLength(46);
      
      // This is the problem we need to fix!
      // These files are already indexed but missing status records
    });
  });

  describe('Solution Validation', () => {
    it('should work correctly after migration adds missing status records', async () => {
      // After migration, all 1616 files should have status records
      const files = Array.from({ length: 1616 }, (_, i) => 
        `/docs/file${i}.${i % 3 === 0 ? 'txt' : i % 3 === 1 ? 'pdf' : 'md'}`
      );
      
      // All files now have status records
      const fileStatusCache = new Map();
      files.forEach((file, i) => {
        fileStatusCache.set(file, {
          path: file,
          status: 'indexed',
          indexed_at: new Date().toISOString(),
          file_hash: `hash${i}`,
          parser_version: 1,
          chunk_count: 5,
          error_message: '',
          last_modified: new Date().toISOString(),
          last_retry: ''
        });
      });
      
      vi.mocked(fs.statSync).mockReturnValue({
        mtimeMs: Date.now() - 1000000,
        size: 1024
      } as any);
      
      const result = await scanForChanges(files, fileStatusCache, supportedExtensions);
      
      // After migration: No files should be marked as new!
      expect(result.newFiles).toHaveLength(0);
      expect(result.modifiedFiles).toHaveLength(0);
      expect(result.skippedFiles).toHaveLength(1616);
      expect(result.hashCalculations).toBe(0);
    });
  });
});