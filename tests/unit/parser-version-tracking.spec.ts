import { describe, it, expect, vi, beforeEach } from 'vitest';
import { PARSER_VERSIONS, getParserVersion, VERSION_HISTORY, getVersionHistory } from '../../src/main/worker/parserVersions';
import { shouldReindex, FileStatus } from '../../src/main/worker/reindexManager';
import * as fs from 'node:fs';
import * as crypto from 'node:crypto';

// Mock fs module
vi.mock('node:fs', () => ({
  statSync: vi.fn(),
  existsSync: vi.fn()
}));

describe('Parser Version Tracking', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('parserVersions', () => {
    it('should define version numbers for all supported file types', () => {
      expect(PARSER_VERSIONS.pdf).toBe(1);
      expect(PARSER_VERSIONS.doc).toBe(2);
      expect(PARSER_VERSIONS.docx).toBe(1);
      expect(PARSER_VERSIONS.txt).toBe(3);
      expect(PARSER_VERSIONS.md).toBe(3);
      expect(PARSER_VERSIONS.rtf).toBe(1);
    });

    it('should have version history for all parsers', () => {
      expect(VERSION_HISTORY.pdf[1]).toBeDefined();
      expect(VERSION_HISTORY.doc[1]).toBeDefined();
      expect(VERSION_HISTORY.doc[2]).toBeDefined();
      expect(VERSION_HISTORY.docx[1]).toBeDefined();
    });

    it('should get parser version for any extension', () => {
      expect(getParserVersion('pdf')).toBe(1);
      expect(getParserVersion('PDF')).toBe(1);
      expect(getParserVersion('doc')).toBe(2);
      expect(getParserVersion('unknown')).toBe(0);
    });

    it('should get version history for parsers', () => {
      const docHistory = getVersionHistory('doc');
      expect(docHistory).toBeDefined();
      expect(docHistory![1]).toContain('RTF');
      expect(docHistory![2]).toContain('word-extractor');
    });
  });

  describe('shouldReindex', () => {
    const mockFileStats = {
      size: 1024,
      mtimeMs: Date.now()
    };

    beforeEach(() => {
      (fs.statSync as any).mockReturnValue(mockFileStats);
      (fs.existsSync as any).mockReturnValue(true);
    });

    it('should return true for files never indexed', () => {
      const result = shouldReindex('/test/file.pdf', undefined);
      expect(result).toBe(true);
    });

    it('should return false for unsupported file types', () => {
      const result = shouldReindex('/test/file.xyz', undefined);
      expect(result).toBe(false);
    });

    it('should return true when parser version is upgraded', () => {
      const fileRecord: FileStatus = {
        path: '/test/file.doc',
        status: 'indexed',
        parser_version: 1, // Old version
        chunk_count: 10,
        error_message: '',
        last_modified: new Date().toISOString(),
        indexed_at: new Date().toISOString(),
        file_hash: 'abc123'
      };

      const result = shouldReindex('/test/file.doc', fileRecord);
      expect(result).toBe(true); // Should reindex because doc parser is now v2
    });

    it('should return false when parser version is current', () => {
      const fileRecord: FileStatus = {
        path: '/test/file.doc',
        status: 'indexed',
        parser_version: 2, // Current version
        chunk_count: 10,
        error_message: '',
        last_modified: new Date().toISOString(),
        indexed_at: new Date().toISOString(),
        file_hash: generateFileHash('/test/file.doc', mockFileStats)
      };

      const result = shouldReindex('/test/file.doc', fileRecord);
      expect(result).toBe(false);
    });

    it('should return true when file hash changed', () => {
      const fileRecord: FileStatus = {
        path: '/test/file.pdf',
        status: 'indexed',
        parser_version: 1,
        chunk_count: 10,
        error_message: '',
        last_modified: new Date().toISOString(),
        indexed_at: new Date().toISOString(),
        file_hash: 'old-hash'
      };

      const result = shouldReindex('/test/file.pdf', fileRecord);
      expect(result).toBe(true); // Hash mismatch means file changed
    });

    it('should retry failed files after 24 hours', () => {
      const dayAgo = new Date(Date.now() - 25 * 60 * 60 * 1000).toISOString();
      const fileRecord: FileStatus = {
        path: '/test/file.pdf',
        status: 'failed',
        parser_version: 1,
        chunk_count: 0,
        error_message: 'Parse error',
        last_modified: new Date().toISOString(),
        indexed_at: new Date().toISOString(),
        file_hash: generateFileHash('/test/file.pdf', mockFileStats),
        last_retry: dayAgo
      };

      const result = shouldReindex('/test/file.pdf', fileRecord);
      expect(result).toBe(true);
    });

    it('should not retry failed files within 24 hours', () => {
      const hourAgo = new Date(Date.now() - 1 * 60 * 60 * 1000).toISOString();
      const fileRecord: FileStatus = {
        path: '/test/file.pdf',
        status: 'failed',
        parser_version: 1,
        chunk_count: 0,
        error_message: 'Parse error',
        last_modified: new Date().toISOString(),
        indexed_at: new Date().toISOString(),
        file_hash: generateFileHash('/test/file.pdf', mockFileStats),
        last_retry: hourAgo
      };

      const result = shouldReindex('/test/file.pdf', fileRecord);
      expect(result).toBe(false);
    });

    it('should handle files without parser_version field', () => {
      const fileRecord: FileStatus = {
        path: '/test/file.doc',
        status: 'indexed',
        parser_version: 0, // No version
        chunk_count: 10,
        error_message: '',
        last_modified: new Date().toISOString(),
        indexed_at: new Date().toISOString(),
        file_hash: 'abc123'
      };

      const result = shouldReindex('/test/file.doc', fileRecord);
      expect(result).toBe(true); // Should reindex to add version
    });
  });

  describe('Parser Version Constants', () => {
    it('should export PARSER_VERSION from each parser file', async () => {
      // Test that parser files export version constants
      const pdfParser = await import('../../src/main/parsers/pdf');
      const docParser = await import('../../src/main/parsers/doc');
      const docxParser = await import('../../src/main/parsers/docx');
      const textParser = await import('../../src/main/parsers/text');
      const rtfParser = await import('../../src/main/parsers/rtf');

      expect(pdfParser.PARSER_VERSION).toBe(1);
      expect(docParser.PARSER_VERSION).toBe(2);
      expect(docxParser.PARSER_VERSION).toBe(1);
      expect(textParser.PARSER_VERSION).toBe(3);
      expect(rtfParser.PARSER_VERSION).toBe(1);
    });
  });
});

// Helper function to generate file hash (mirrors the implementation)
function generateFileHash(filePath: string, stats: any): string {
  const content = `${filePath}:${stats.size}:${stats.mtimeMs}`;
  return crypto.createHash('md5').update(content).digest('hex');
}