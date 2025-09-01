import { describe, it, expect, beforeEach, vi } from 'vitest';
import * as fs from 'node:fs';
import { migrateIndexedFilesToStatus, cleanupOrphanedStatuses } from '../../src/main/worker/migrateFileStatus';
import { getFileHash } from '../../src/main/worker/fileStatusManager';

// Mock fs module
vi.mock('node:fs');
vi.mock('../../src/main/worker/fileStatusManager', () => ({
  getFileHash: vi.fn()
}));

describe('File Status Migration', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('migrateIndexedFilesToStatus', () => {
    it('should migrate all indexed files without existing status records', async () => {
      // Setup: Documents table has 3 files, status table has 1
      const mockDocuments = [
        { path: '/file1.txt' },
        { path: '/file2.pdf' },
        { path: '/file3.docx' }
      ];
      
      const existingStatuses = [
        { path: '/file1.txt', status: 'indexed' } // Already has status
      ];
      
      const mockDocumentsTable = {
        query: () => ({
          select: () => ({
            limit: () => ({
              toArray: vi.fn().mockResolvedValue(mockDocuments)
            })
          })
        })
      };
      
      const addedRecords: any[] = [];
      const mockStatusTable = {
        query: () => ({
          toArray: vi.fn().mockResolvedValue(existingStatuses)
        }),
        add: vi.fn().mockImplementation((records) => {
          addedRecords.push(...records);
          return Promise.resolve();
        })
      };
      
      const mockFileHashes = new Map([
        ['/file2.pdf', 'hash2'],
        ['/file3.docx', 'hash3']
      ]);
      
      // Mock file existence
      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(fs.statSync).mockReturnValue({
        mtimeMs: Date.now(),
        size: 1024
      } as any);
      vi.mocked(getFileHash).mockReturnValue('computed-hash');
      
      // Execute
      const migrated = await migrateIndexedFilesToStatus(
        mockDocumentsTable,
        mockStatusTable,
        mockFileHashes
      );
      
      // Assert
      expect(migrated).toBe(2); // Only file2 and file3 should be migrated
      expect(addedRecords).toHaveLength(2);
      expect(addedRecords[0].path).toBe('/file2.pdf');
      expect(addedRecords[0].status).toBe('indexed');
      expect(addedRecords[0].file_hash).toBe('hash2');
      expect(addedRecords[1].path).toBe('/file3.docx');
      expect(addedRecords[1].file_hash).toBe('hash3');
    });

    it('should skip files that no longer exist', async () => {
      const mockDocuments = [
        { path: '/exists.txt' },
        { path: '/deleted.txt' }
      ];
      
      const mockDocumentsTable = {
        query: () => ({
          select: () => ({
            limit: () => ({
              toArray: vi.fn().mockResolvedValue(mockDocuments)
            })
          })
        })
      };
      
      const addedRecords: any[] = [];
      const mockStatusTable = {
        query: () => ({
          toArray: vi.fn().mockResolvedValue([])
        }),
        add: vi.fn().mockImplementation((records) => {
          addedRecords.push(...records);
          return Promise.resolve();
        })
      };
      
      // Mock: first file exists, second doesn't
      vi.mocked(fs.existsSync).mockImplementation((path) => {
        return path === '/exists.txt';
      });
      vi.mocked(fs.statSync).mockReturnValue({
        mtimeMs: Date.now(),
        size: 1024
      } as any);
      
      // Execute
      const migrated = await migrateIndexedFilesToStatus(
        mockDocumentsTable,
        mockStatusTable,
        new Map()
      );
      
      // Assert
      expect(migrated).toBe(1);
      expect(addedRecords).toHaveLength(1);
      expect(addedRecords[0].path).toBe('/exists.txt');
    });

    it('should batch large migrations to avoid memory issues', async () => {
      // Create 250 mock documents
      const mockDocuments = Array.from({ length: 250 }, (_, i) => ({
        path: `/file${i}.txt`
      }));
      
      const mockDocumentsTable = {
        query: () => ({
          select: () => ({
            limit: () => ({
              toArray: vi.fn().mockResolvedValue(mockDocuments)
            })
          })
        })
      };
      
      let addCallCount = 0;
      const mockStatusTable = {
        query: () => ({
          toArray: vi.fn().mockResolvedValue([])
        }),
        add: vi.fn().mockImplementation(() => {
          addCallCount++;
          return Promise.resolve();
        })
      };
      
      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(fs.statSync).mockReturnValue({
        mtimeMs: Date.now(),
        size: 1024
      } as any);
      
      // Execute
      await migrateIndexedFilesToStatus(
        mockDocumentsTable,
        mockStatusTable,
        new Map()
      );
      
      // Assert: Should have been called 3 times (100 + 100 + 50)
      expect(addCallCount).toBe(3);
    });

    it('should handle missing tables gracefully', async () => {
      const result = await migrateIndexedFilesToStatus(null, null, new Map());
      expect(result).toBe(0);
      
      const result2 = await migrateIndexedFilesToStatus({} as any, null, new Map());
      expect(result2).toBe(0);
    });

    it('should use file hash from map when available', async () => {
      const mockDocuments = [{ path: '/file.txt' }];
      
      const mockDocumentsTable = {
        query: () => ({
          select: () => ({
            limit: () => ({
              toArray: vi.fn().mockResolvedValue(mockDocuments)
            })
          })
        })
      };
      
      const addedRecords: any[] = [];
      const mockStatusTable = {
        query: () => ({
          toArray: vi.fn().mockResolvedValue([])
        }),
        add: vi.fn().mockImplementation((records) => {
          addedRecords.push(...records);
          return Promise.resolve();
        })
      };
      
      const mockFileHashes = new Map([['/file.txt', 'cached-hash']]);
      
      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(fs.statSync).mockReturnValue({
        mtimeMs: Date.now(),
        size: 1024
      } as any);
      vi.mocked(getFileHash).mockReturnValue('computed-hash');
      
      await migrateIndexedFilesToStatus(
        mockDocumentsTable,
        mockStatusTable,
        mockFileHashes
      );
      
      // Should use cached hash, not computed
      expect(addedRecords[0].file_hash).toBe('cached-hash');
      expect(getFileHash).not.toHaveBeenCalled();
    });

    it('should compute hash when not in cache', async () => {
      const mockDocuments = [{ path: '/file.txt' }];
      
      const mockDocumentsTable = {
        query: () => ({
          select: () => ({
            limit: () => ({
              toArray: vi.fn().mockResolvedValue(mockDocuments)
            })
          })
        })
      };
      
      const addedRecords: any[] = [];
      const mockStatusTable = {
        query: () => ({
          toArray: vi.fn().mockResolvedValue([])
        }),
        add: vi.fn().mockImplementation((records) => {
          addedRecords.push(...records);
          return Promise.resolve();
        })
      };
      
      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(fs.statSync).mockReturnValue({
        mtimeMs: Date.now(),
        size: 1024
      } as any);
      vi.mocked(getFileHash).mockReturnValue('computed-hash');
      
      await migrateIndexedFilesToStatus(
        mockDocumentsTable,
        mockStatusTable,
        new Map() // Empty cache
      );
      
      expect(getFileHash).toHaveBeenCalledWith('/file.txt');
      expect(addedRecords[0].file_hash).toBe('computed-hash');
    });
  });

  describe('cleanupOrphanedStatuses', () => {
    it('should delete status records for non-existent files', async () => {
      const mockStatuses = [
        { path: '/exists.txt', status: 'indexed' },
        { path: '/deleted1.txt', status: 'indexed' },
        { path: '/deleted2.txt', status: 'failed' }
      ];
      
      const deletedPaths: string[] = [];
      const mockStatusTable = {
        query: () => ({
          toArray: vi.fn().mockResolvedValue(mockStatuses)
        }),
        delete: vi.fn().mockImplementation((query) => {
          // Extract path from query string
          const match = query.match(/path = "(.+)"/);
          if (match) {
            deletedPaths.push(match[1]);
          }
          return Promise.resolve();
        })
      };
      
      // Mock: only first file exists
      vi.mocked(fs.existsSync).mockImplementation((path) => {
        return path === '/exists.txt';
      });
      
      // Execute
      const deletedCount = await cleanupOrphanedStatuses(mockStatusTable);
      
      // Assert
      expect(deletedCount).toBe(2);
      expect(deletedPaths).toContain('/deleted1.txt');
      expect(deletedPaths).toContain('/deleted2.txt');
      expect(deletedPaths).not.toContain('/exists.txt');
    });

    it('should handle null table gracefully', async () => {
      const result = await cleanupOrphanedStatuses(null);
      expect(result).toBe(0);
    });

    it('should continue on deletion errors', async () => {
      const mockStatuses = [
        { path: '/deleted1.txt', status: 'indexed' },
        { path: '/deleted2.txt', status: 'indexed' }
      ];
      
      let deleteCallCount = 0;
      const mockStatusTable = {
        query: () => ({
          toArray: vi.fn().mockResolvedValue(mockStatuses)
        }),
        delete: vi.fn().mockImplementation(() => {
          deleteCallCount++;
          if (deleteCallCount === 1) {
            return Promise.reject(new Error('Delete failed'));
          }
          return Promise.resolve();
        })
      };
      
      vi.mocked(fs.existsSync).mockReturnValue(false);
      
      // Execute - should not throw
      const deletedCount = await cleanupOrphanedStatuses(mockStatusTable);
      
      // Assert - one deletion succeeded despite first failure
      expect(deletedCount).toBe(1);
      expect(deleteCallCount).toBe(2);
    });
  });
});