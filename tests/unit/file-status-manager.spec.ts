import { describe, it, expect, beforeEach, vi } from 'vitest';
import * as fs from 'node:fs';
import {
  initializeFileStatusTable,
  loadFileStatusCache,
  getFileHash,
  getFileExtension,
  isFileSupported,
  scanForChanges,
  updateFileStatus,
  type FileStatus,
  type ScanResult
} from '../../src/main/core/indexing/fileStatusManager';

// Mock fs module
vi.mock('node:fs');

// Mock shouldReindex
vi.mock('../../src/main/services/ReindexService', () => ({
  shouldReindex: vi.fn()
}));

import { shouldReindex } from '../../src/main/services/ReindexService';

describe('FileStatusManager', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('initializeFileStatusTable', () => {
    it('should open existing valid table', async () => {
      const mockTable = {
        query: () => ({
          limit: () => ({
            toArray: vi.fn().mockResolvedValue([])
          })
        })
      };
      
      const mockDb = {
        tableNames: vi.fn().mockResolvedValue(['file_status']),
        openTable: vi.fn().mockResolvedValue(mockTable)
      };
      
      const result = await initializeFileStatusTable(mockDb);
      
      expect(mockDb.tableNames).toHaveBeenCalled();
      expect(mockDb.openTable).toHaveBeenCalledWith('file_status');
      expect(result).toBe(mockTable);
    });

    it('should recreate invalid table', async () => {
      const invalidTable = {
        query: () => ({
          limit: () => ({
            toArray: vi.fn().mockRejectedValue(new Error('Invalid table'))
          })
        })
      };
      
      const newTable = {
        delete: vi.fn()
      };
      
      const mockDb = {
        tableNames: vi.fn().mockResolvedValue(['file_status']),
        openTable: vi.fn().mockResolvedValue(invalidTable),
        dropTable: vi.fn().mockResolvedValue(undefined),
        createTable: vi.fn().mockResolvedValue(newTable)
      };
      
      const result = await initializeFileStatusTable(mockDb);
      
      expect(mockDb.dropTable).toHaveBeenCalledWith('file_status');
      expect(mockDb.createTable).toHaveBeenCalled();
      expect(result).toBe(newTable);
    });

    it('should create new table if not exists', async () => {
      const newTable = {
        delete: vi.fn()
      };
      
      const mockDb = {
        tableNames: vi.fn().mockResolvedValue([]),
        createTable: vi.fn().mockResolvedValue(newTable)
      };
      
      const result = await initializeFileStatusTable(mockDb);
      
      expect(mockDb.createTable).toHaveBeenCalledWith('file_status', expect.arrayContaining([
        expect.objectContaining({
          path: '__init__',
          status: 'init',
          last_retry: '' // Should use empty string, not null
        })
      ]));
      expect(result).toBe(newTable);
    });
  });

  describe('loadFileStatusCache', () => {
    it('should load records into cache map', async () => {
      const mockRecords = [
        { path: '/file1.txt', status: 'indexed' },
        { path: '/file2.pdf', status: 'failed' }
      ];
      
      const mockTable = {
        query: () => ({
          toArray: vi.fn().mockResolvedValue(mockRecords)
        })
      };
      
      const cache = await loadFileStatusCache(mockTable);
      
      expect(cache.size).toBe(2);
      expect(cache.get('/file1.txt')).toEqual(mockRecords[0]);
      expect(cache.get('/file2.pdf')).toEqual(mockRecords[1]);
    });

    it('should return empty map if table is null', async () => {
      const cache = await loadFileStatusCache(null);
      expect(cache.size).toBe(0);
    });

    it('should return empty map on error', async () => {
      const mockTable = {
        query: () => ({
          toArray: vi.fn().mockRejectedValue(new Error('Database error'))
        })
      };
      
      const cache = await loadFileStatusCache(mockTable);
      expect(cache.size).toBe(0);
    });
  });

  describe('getFileHash', () => {
    it('should calculate hash from file stats', () => {
      const mockStats = {
        size: 1024,
        mtimeMs: 1234567890
      };
      
      vi.mocked(fs.statSync).mockReturnValue(mockStats as any);
      
      const hash = getFileHash('/test.txt');
      
      expect(fs.statSync).toHaveBeenCalledWith('/test.txt');
      expect(hash).toMatch(/^[a-f0-9]{32}$/); // MD5 hash format
    });

    it('should return empty string on error', () => {
      vi.mocked(fs.statSync).mockImplementation(() => {
        throw new Error('File not found');
      });
      
      const hash = getFileHash('/nonexistent.txt');
      expect(hash).toBe('');
    });
  });

  describe('getFileExtension', () => {
    it('should extract simple extensions', () => {
      expect(getFileExtension('/path/to/file.txt')).toBe('txt');
      expect(getFileExtension('/path/to/file.PDF')).toBe('pdf');
      expect(getFileExtension('file.docx')).toBe('docx');
    });

    it('should handle files without extensions', () => {
      expect(getFileExtension('/path/to/README')).toBe('');
      expect(getFileExtension('Makefile')).toBe('');
    });

    it('should handle compound extensions', () => {
      expect(getFileExtension('/path/to/archive.tar.gz')).toBe('tar.gz');
      expect(getFileExtension('file.tar.bz2')).toBe('tar.bz2');
      expect(getFileExtension('data.json.gz')).toBe('json.gz');
    });

    it('should handle edge cases', () => {
      expect(getFileExtension('.gitignore')).toBe('gitignore');
      expect(getFileExtension('/path/.hidden.txt')).toBe('txt');
    });
  });

  describe('isFileSupported', () => {
    const supportedExtensions = ['txt', 'pdf', 'docx', 'md'];

    it('should identify supported files', () => {
      expect(isFileSupported('/file.txt', supportedExtensions)).toBe(true);
      expect(isFileSupported('/file.pdf', supportedExtensions)).toBe(true);
      expect(isFileSupported('/file.md', supportedExtensions)).toBe(true);
    });

    it('should identify unsupported files', () => {
      expect(isFileSupported('/file.exe', supportedExtensions)).toBe(false);
      expect(isFileSupported('/file.jpg', supportedExtensions)).toBe(false);
      expect(isFileSupported('/README', supportedExtensions)).toBe(false);
    });
  });

  describe('scanForChanges', () => {
    const supportedExtensions = ['txt', 'pdf', 'docx'];
    
    beforeEach(() => {
      vi.mocked(shouldReindex).mockReturnValue(false);
    });

    it('should identify new files', async () => {
      const files = ['/new1.txt', '/new2.pdf'];
      const cache = new Map<string, FileStatus>();
      
      const result = await scanForChanges(files, cache, supportedExtensions);
      
      expect(result.newFiles).toEqual(files);
      expect(result.modifiedFiles).toHaveLength(0);
      expect(result.hashCalculations).toBe(0);
    });

    it('should skip files already in queue', async () => {
      const files = ['/file1.txt', '/file2.pdf'];
      const cache = new Map<string, FileStatus>();
      const queue = ['/file1.txt'];
      
      const result = await scanForChanges(files, cache, supportedExtensions, queue);
      
      expect(result.newFiles).toEqual(['/file2.pdf']);
      expect(result.skippedFiles).toContain('/file1.txt');
    });

    it('should skip unsupported files', async () => {
      const files = ['/file.txt', '/file.exe', '/file.jpg'];
      const cache = new Map<string, FileStatus>();
      
      const result = await scanForChanges(files, cache, supportedExtensions);
      
      expect(result.newFiles).toEqual(['/file.txt']);
      expect(result.skippedFiles).toEqual(['/file.exe', '/file.jpg']);
    });

    it('should detect modified files via timestamp check', async () => {
      const fileRecord: FileStatus = {
        path: '/file.txt',
        status: 'indexed',
        indexed_at: new Date('2024-01-01').toISOString(),
        file_hash: 'oldhash',
        parser_version: 1,
        chunk_count: 5,
        error_message: '',
        last_modified: new Date('2024-01-01').toISOString(),
        last_retry: ''
      };
      
      const cache = new Map([
        ['/file.txt', fileRecord]
      ]);
      
      // File modified after indexing
      vi.mocked(fs.statSync).mockReturnValue({
        size: 2048,
        mtimeMs: new Date('2024-01-02').getTime()
      } as any);
      
      const result = await scanForChanges(['/file.txt'], cache, supportedExtensions);
      
      expect(result.modifiedFiles).toEqual(['/file.txt']);
      expect(result.hashCalculations).toBe(1);
    });

    it('should skip unchanged files', async () => {
      const fileRecord: FileStatus = {
        path: '/file.txt',
        status: 'indexed',
        indexed_at: new Date('2024-01-02').toISOString(),
        file_hash: 'hash123',
        parser_version: 1,
        chunk_count: 5,
        error_message: '',
        last_modified: new Date('2024-01-01').toISOString(),
        last_retry: ''
      };
      
      const cache = new Map([
        ['/file.txt', fileRecord]
      ]);
      
      // File not modified since indexing
      vi.mocked(fs.statSync).mockReturnValue({
        size: 1024,
        mtimeMs: new Date('2024-01-01').getTime()
      } as any);
      
      const result = await scanForChanges(['/file.txt'], cache, supportedExtensions);
      
      expect(result.modifiedFiles).toHaveLength(0);
      expect(result.skippedFiles).toEqual(['/file.txt']);
      expect(result.hashCalculations).toBe(0); // No hash calculation needed
    });

    it('should use shouldReindex for complex logic', async () => {
      const fileRecord: FileStatus = {
        path: '/file.txt',
        status: 'indexed',
        indexed_at: new Date('2024-01-01').toISOString(),
        file_hash: 'hash123',
        parser_version: 1,
        chunk_count: 5,
        error_message: '',
        last_modified: new Date('2024-01-01').toISOString(),
        last_retry: ''
      };
      
      const cache = new Map([
        ['/file.txt', fileRecord]
      ]);
      
      // shouldReindex returns true (e.g., parser upgrade)
      vi.mocked(shouldReindex).mockReturnValue(true);
      
      const result = await scanForChanges(['/file.txt'], cache, supportedExtensions);
      
      expect(shouldReindex).toHaveBeenCalledWith('/file.txt', fileRecord);
      expect(result.modifiedFiles).toEqual(['/file.txt']);
    });

    it('should handle file access errors gracefully', async () => {
      const fileRecord: FileStatus = {
        path: '/deleted.txt',
        status: 'indexed',
        indexed_at: new Date('2024-01-01').toISOString(),
        file_hash: 'hash123',
        parser_version: 1,
        chunk_count: 5,
        error_message: '',
        last_modified: new Date('2024-01-01').toISOString(),
        last_retry: ''
      };
      
      const cache = new Map([
        ['/deleted.txt', fileRecord]
      ]);
      
      vi.mocked(fs.statSync).mockImplementation(() => {
        throw new Error('File not found');
      });
      
      const result = await scanForChanges(['/deleted.txt'], cache, supportedExtensions);
      
      expect(result.skippedFiles).toEqual(['/deleted.txt']);
      expect(result.modifiedFiles).toHaveLength(0);
    });
  });

  describe('updateFileStatus', () => {
    it('should update file status in table', async () => {
      const mockTable = {
        delete: vi.fn().mockResolvedValue(undefined),
        add: vi.fn().mockResolvedValue(undefined)
      };
      
      vi.mocked(fs.statSync).mockReturnValue({
        size: 1024,
        mtimeMs: Date.now()
      } as any);
      
      await updateFileStatus(mockTable, '/file.txt', 'indexed', '', 10, 2);
      
      expect(mockTable.delete).toHaveBeenCalledWith('path = "/file.txt"');
      expect(mockTable.add).toHaveBeenCalledWith([
        expect.objectContaining({
          path: '/file.txt',
          status: 'indexed',
          chunk_count: 10,
          parser_version: 2,
          last_retry: ''
        })
      ]);
    });

    it('should set last_retry for failed status', async () => {
      const mockTable = {
        delete: vi.fn().mockResolvedValue(undefined),
        add: vi.fn().mockResolvedValue(undefined)
      };
      
      vi.mocked(fs.statSync).mockReturnValue({
        size: 1024,
        mtimeMs: Date.now()
      } as any);
      
      await updateFileStatus(mockTable, '/file.txt', 'failed', 'Parse error', 0, 1);
      
      expect(mockTable.add).toHaveBeenCalledWith([
        expect.objectContaining({
          status: 'failed',
          error_message: 'Parse error',
          last_retry: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T/)
        })
      ]);
    });

    it('should handle null table gracefully', async () => {
      await expect(
        updateFileStatus(null, '/file.txt', 'indexed', '', 10, 2)
      ).resolves.toBeUndefined();
    });
  });
});