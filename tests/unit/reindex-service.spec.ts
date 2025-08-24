import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { ReindexService, FileStatus, FileStatusRepository } from '../../app/electron/services/ReindexService';
import * as fs from 'node:fs';

// Mock fs module
vi.mock('node:fs', () => ({
  statSync: vi.fn()
}));

// Mock the parser versions
vi.mock('../../app/electron/worker/parserVersions', () => ({
  PARSER_VERSIONS: {
    pdf: 1,
    doc: 2,
    txt: 1,
    md: 1
  },
  getParserVersion: (ext: string) => {
    const versions: Record<string, number> = {
      pdf: 1,
      doc: 2,
      txt: 1,
      md: 1
    };
    return versions[ext] || 0;
  }
}));

describe('ReindexService', () => {
  let service: ReindexService;
  let mockRepo: FileStatusRepository;
  let mockLogger: { log: vi.Mock; error: vi.Mock };
  let mockFiles: FileStatus[];

  beforeEach(() => {
    mockFiles = [];
    mockRepo = {
      query: vi.fn(() => ({
        toArray: vi.fn(async () => mockFiles)
      })),
      delete: vi.fn(),
      add: vi.fn()
    };
    
    mockLogger = {
      log: vi.fn(),
      error: vi.fn()
    };
    
    service = new ReindexService(mockRepo, mockLogger);
    
    // Reset fs mock
    vi.mocked(fs.statSync).mockReset();
  });
  
  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('shouldReindex', () => {
    const testFile = '/test/file.txt';
    
    it('should return true for files never indexed', () => {
      expect(service.shouldReindex(testFile, undefined)).toBe(true);
    });
    
    it('should return false for unsupported file types', () => {
      expect(service.shouldReindex('/test/file.xyz', undefined)).toBe(false);
    });
    
    it('should return true for modified files', () => {
      // Mock fs.statSync to return consistent stats
      vi.mocked(fs.statSync).mockReturnValue({
        size: 1000,
        mtimeMs: Date.now()
      } as any);
      
      const oldRecord: FileStatus = {
        path: testFile,
        status: 'indexed',
        parser_version: 1,
        chunk_count: 10,
        error_message: '',
        last_modified: new Date().toISOString(),
        indexed_at: new Date().toISOString(),
        file_hash: 'old-hash-value'
      };
      
      expect(service.shouldReindex(testFile, oldRecord)).toBe(true);
    });
    
    it('should return true for files with upgraded parsers', () => {
      const docFile = '/test/file.doc';
      const oldRecord: FileStatus = {
        path: docFile,
        status: 'indexed',
        parser_version: 1, // Old version
        chunk_count: 10,
        error_message: '',
        last_modified: new Date().toISOString(),
        indexed_at: new Date().toISOString(),
        file_hash: service.getFileHash(docFile)
      };
      
      expect(service.shouldReindex(docFile, oldRecord)).toBe(true);
      expect(mockLogger.log).toHaveBeenCalledWith(expect.stringContaining('Parser upgraded'));
    });
    
    it('should return true for failed files after retry interval', () => {
      const failedRecord: FileStatus = {
        path: testFile,
        status: 'failed',
        parser_version: 1,
        chunk_count: 0,
        error_message: 'Parse error',
        last_modified: new Date().toISOString(),
        indexed_at: new Date().toISOString(),
        file_hash: service.getFileHash(testFile),
        last_retry: new Date(Date.now() - 25 * 60 * 60 * 1000).toISOString() // 25 hours ago
      };
      
      expect(service.shouldReindex(testFile, failedRecord)).toBe(true);
    });
    
    it('should return false for failed files within retry interval', () => {
      const failedRecord: FileStatus = {
        path: testFile,
        status: 'failed',
        parser_version: 1,
        chunk_count: 0,
        error_message: 'Parse error',
        last_modified: new Date().toISOString(),
        indexed_at: new Date().toISOString(),
        file_hash: service.getFileHash(testFile),
        last_retry: new Date(Date.now() - 10 * 60 * 60 * 1000).toISOString() // 10 hours ago
      };
      
      expect(service.shouldReindex(testFile, failedRecord)).toBe(false);
    });
  });

  describe('checkForParserUpgrades', () => {
    it('should identify files needing parser upgrades', async () => {
      mockFiles = [
        {
          path: '/test/old.doc',
          status: 'indexed',
          parser_version: 1, // Old version, should upgrade to 2
          chunk_count: 10,
          error_message: '',
          last_modified: new Date().toISOString(),
          indexed_at: new Date().toISOString(),
          file_hash: 'hash1'
        },
        {
          path: '/test/current.pdf',
          status: 'indexed',
          parser_version: 1, // Current version
          chunk_count: 5,
          error_message: '',
          last_modified: new Date().toISOString(),
          indexed_at: new Date().toISOString(),
          file_hash: 'hash2'
        }
      ];
      
      const result = await service.checkForParserUpgrades();
      
      expect(result.filesToReindex).toContain('/test/old.doc');
      expect(result.filesToReindex).not.toContain('/test/current.pdf');
      expect(result.upgradeSummary.doc).toBe(1);
      expect(mockRepo.delete).toHaveBeenCalledWith('path = "/test/old.doc"');
      expect(mockRepo.add).toHaveBeenCalled();
    });
    
    it('should retry failed .doc files with new parser', async () => {
      mockFiles = [
        {
          path: '/test/failed.doc',
          status: 'failed',
          parser_version: 1,
          chunk_count: 0,
          error_message: 'Old parser failed',
          last_modified: new Date().toISOString(),
          indexed_at: new Date().toISOString(),
          file_hash: 'hash3'
        }
      ];
      
      const result = await service.checkForParserUpgrades();
      
      expect(result.filesToReindex).toContain('/test/failed.doc');
      expect(result.upgradeSummary.doc_retries).toBe(1);
      expect(mockLogger.log).toHaveBeenCalledWith(expect.stringContaining('failed .doc files'));
    });
    
    it('should handle repository not available', async () => {
      const serviceNoRepo = new ReindexService(undefined, mockLogger);
      const result = await serviceNoRepo.checkForParserUpgrades();
      
      expect(result.filesToReindex).toEqual([]);
      expect(result.upgradeSummary).toEqual({});
      expect(mockLogger.log).toHaveBeenCalledWith(expect.stringContaining('not available'));
    });
  });

  describe('migrateExistingFiles', () => {
    it('should add parser versions to files without them', async () => {
      mockFiles = [
        {
          path: '/test/old1.txt',
          status: 'indexed',
          parser_version: undefined as any,
          chunk_count: 5,
          error_message: '',
          last_modified: new Date().toISOString(),
          indexed_at: new Date().toISOString(),
          file_hash: 'hash4'
        },
        {
          path: '/test/old2.pdf',
          status: 'indexed',
          parser_version: null as any,
          chunk_count: 10,
          error_message: '',
          last_modified: new Date().toISOString(),
          indexed_at: new Date().toISOString(),
          file_hash: 'hash5'
        },
        {
          path: '/test/already.md',
          status: 'indexed',
          parser_version: 1,
          chunk_count: 3,
          error_message: '',
          last_modified: new Date().toISOString(),
          indexed_at: new Date().toISOString(),
          file_hash: 'hash6'
        }
      ];
      
      const count = await service.migrateExistingFiles();
      
      expect(count).toBe(2);
      expect(mockRepo.delete).toHaveBeenCalledTimes(2);
      expect(mockRepo.add).toHaveBeenCalledTimes(2);
      expect(mockLogger.log).toHaveBeenCalledWith(expect.stringContaining('Migrated 2 files'));
    });
    
    it('should handle special case for .doc files', async () => {
      mockFiles = [
        {
          path: '/test/old.doc',
          status: 'indexed',
          parser_version: undefined as any,
          chunk_count: 5,
          error_message: '',
          last_modified: new Date().toISOString(),
          indexed_at: new Date().toISOString(),
          file_hash: 'hash7'
        }
      ];
      
      await service.migrateExistingFiles();
      
      // Should set to version 1 initially (will be upgraded on next check)
      expect(mockRepo.add).toHaveBeenCalledWith([
        expect.objectContaining({
          path: '/test/old.doc',
          parser_version: 1
        })
      ]);
    });
    
    it('should handle errors gracefully', async () => {
      mockFiles = [
        {
          path: '/test/error.txt',
          status: 'indexed',
          parser_version: undefined as any,
          chunk_count: 5,
          error_message: '',
          last_modified: new Date().toISOString(),
          indexed_at: new Date().toISOString(),
          file_hash: 'hash8'
        }
      ];
      
      // Make delete throw an error
      (mockRepo.delete as any).mockRejectedValue(new Error('DB error'));
      
      const count = await service.migrateExistingFiles();
      
      expect(count).toBe(0);
      expect(mockLogger.error).toHaveBeenCalledWith(
        expect.stringContaining('Failed to migrate'),
        expect.any(Error)
      );
    });
  });

  describe('getFileHash', () => {
    it('should calculate hash based on file stats', () => {
      vi.mocked(fs.statSync).mockReturnValue({
        size: 1234,
        mtimeMs: 1000000
      } as any);
      
      const hash = service.getFileHash('/test/file.txt');
      
      expect(hash).toBeTruthy();
      expect(hash).toHaveLength(32); // MD5 hash length
    });
    
    it('should return empty string on error', () => {
      vi.mocked(fs.statSync).mockImplementation(() => {
        throw new Error('File not found');
      });
      
      const hash = service.getFileHash('/non/existent.txt');
      
      expect(hash).toBe('');
    });
  });
});