import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as path from 'node:path';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as lancedb from '@lancedb/lancedb';
import { ReindexService, FileStatus } from '../../src/main/services/ReindexService';

/**
 * Real LanceDB Tests for ReindexService
 *
 * These tests use actual LanceDB with temporary directories to verify:
 * 1. Complete FileStatus records are accepted by real database
 * 2. Incomplete records are rejected (catches bugs like the one we just fixed)
 * 3. Query filtering and column selection work correctly
 * 4. Parser upgrade detection works with real database
 *
 * This complements the mocked unit tests by providing confidence that
 * the code works with the actual database implementation.
 */
describe('ReindexService with Real LanceDB', () => {
  let tempDir: string;
  let db: any;
  let fileStatusTable: any;
  let service: ReindexService;

  beforeEach(async () => {
    // Create temporary directory for test database
    tempDir = path.join(os.tmpdir(), `reindex-test-db-${Date.now()}`);
    fs.mkdirSync(tempDir, { recursive: true });

    // Connect to LanceDB
    db = await lancedb.connect(tempDir);

    // Initialize file_status table with proper schema
    const dummyData: FileStatus[] = [{
      path: '__init__',
      status: 'init',
      error_message: '',
      chunk_count: 0,
      last_modified: new Date().toISOString(),
      indexed_at: new Date().toISOString(),
      file_hash: '',
      parser_version: 0,
      last_retry: ''
    }];

    fileStatusTable = await db.createTable('file_status', dummyData);

    // Clean up dummy record
    try {
      await fileStatusTable.delete('path = "__init__"');
    } catch (_e) {
      // Ignore - some versions don't support delete
    }

    // Create service instance
    service = new ReindexService(fileStatusTable, {
      log: () => {}, // Silent for tests
      error: () => {}
    });
  });

  afterEach(async () => {
    // Clean up temporary directory
    if (fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  describe('Complete Records - Bug Fix Validation', () => {
    it('should accept complete FileStatus records', async () => {
      // This tests the fix we just made - ensuring all fields are present
      const completeRecord: FileStatus = {
        path: '/test/file.pdf',
        status: 'outdated',
        parser_version: 1,
        chunk_count: 0,
        error_message: 'Parser upgraded to v3',
        last_modified: '',
        indexed_at: '',
        file_hash: '',
        last_retry: ''
      };

      // Should not throw
      await fileStatusTable.add([completeRecord]);

      // Verify it was added
      const results = await fileStatusTable.query().toArray();
      expect(results).toHaveLength(1);
      expect(results[0].path).toBe('/test/file.pdf');
      expect(results[0].status).toBe('outdated');
    });

    it('should reject incomplete records (missing fields)', async () => {
      // This simulates the bug before our fix
      const incompleteRecord = {
        path: '/test/file.pdf',
        status: 'outdated',
        parser_version: 1
        // Missing: chunk_count, error_message, last_modified, indexed_at, file_hash, last_retry
      };

      // LanceDB should reject this with a validation error
      await expect(async () => {
        await fileStatusTable.add([incompleteRecord]);
      }).rejects.toThrow();
    });

    it('should accept empty strings for string fields', async () => {
      // LanceDB accepts empty strings (which is what we use)
      const recordWithEmptyStrings: FileStatus = {
        path: '/test/file.pdf',
        status: 'outdated',
        parser_version: 1,
        chunk_count: 0,
        error_message: '', // Empty string is valid
        last_modified: '',
        indexed_at: '',
        file_hash: '',
        last_retry: ''
      };

      // Should not throw
      await fileStatusTable.add([recordWithEmptyStrings]);

      const results = await fileStatusTable.query().toArray();
      expect(results.length).toBeGreaterThan(0);
    });
  });

  describe('Query Filtering and Column Selection', () => {
    beforeEach(async () => {
      // Add test data
      const testData: FileStatus[] = [
        {
          path: '/test/indexed1.pdf',
          status: 'indexed',
          parser_version: 2,
          chunk_count: 10,
          error_message: '',
          last_modified: new Date().toISOString(),
          indexed_at: new Date().toISOString(),
          file_hash: 'hash1',
          last_retry: ''
        },
        {
          path: '/test/indexed2.doc',
          status: 'indexed',
          parser_version: 1,
          chunk_count: 5,
          error_message: '',
          last_modified: new Date().toISOString(),
          indexed_at: new Date().toISOString(),
          file_hash: 'hash2',
          last_retry: ''
        },
        {
          path: '/test/failed.txt',
          status: 'failed',
          parser_version: 1,
          chunk_count: 0,
          error_message: 'Parse error',
          last_modified: new Date().toISOString(),
          indexed_at: new Date().toISOString(),
          file_hash: 'hash3',
          last_retry: new Date().toISOString()
        }
      ];

      await fileStatusTable.add(testData);
    });

    it('should filter by status = "indexed"', async () => {
      const results = await fileStatusTable.query()
        .filter('status = "indexed"')
        .toArray();

      expect(results).toHaveLength(2);
      expect(results.every((r: FileStatus) => r.status === 'indexed')).toBe(true);
    });

    it('should filter by status = "failed" OR status = "error"', async () => {
      const results = await fileStatusTable.query()
        .filter('status = "failed" OR status = "error"')
        .toArray();

      expect(results).toHaveLength(1);
      expect(results[0].status).toBe('failed');
    });

    it('should select specific columns', async () => {
      const results = await fileStatusTable.query()
        .select(['path', 'parser_version'])
        .toArray();

      expect(results).toHaveLength(3);
      // Results should have path and parser_version
      expect(results[0].path).toBeDefined();
      expect(results[0].parser_version).toBeDefined();
      // Note: LanceDB may still include other fields, but these are guaranteed
    });

    it('should chain filter and select', async () => {
      const results = await fileStatusTable.query()
        .filter('status = "indexed"')
        .select(['path', 'parser_version'])
        .toArray();

      expect(results).toHaveLength(2);
      expect(results.every((r: FileStatus) => r.path && r.parser_version !== undefined)).toBe(true);
    });
  });

  describe('Parser Upgrade Detection with Real Database', () => {
    it('should detect files needing parser upgrades', async () => {
      // Add files with old parser versions
      const testData: FileStatus[] = [
        {
          path: '/test/old1.pdf',
          status: 'indexed',
          parser_version: 1, // Old version
          chunk_count: 10,
          error_message: '',
          last_modified: new Date().toISOString(),
          indexed_at: new Date().toISOString(),
          file_hash: 'hash1',
          last_retry: ''
        },
        {
          path: '/test/old2.pdf',
          status: 'indexed',
          parser_version: 2, // Old version
          chunk_count: 5,
          error_message: '',
          last_modified: new Date().toISOString(),
          indexed_at: new Date().toISOString(),
          file_hash: 'hash2',
          last_retry: ''
        },
        {
          path: '/test/current.pdf',
          status: 'indexed',
          parser_version: 3, // Current version
          chunk_count: 8,
          error_message: '',
          last_modified: new Date().toISOString(),
          indexed_at: new Date().toISOString(),
          file_hash: 'hash3',
          last_retry: ''
        }
      ];

      await fileStatusTable.add(testData);

      // Run parser upgrade check
      const result = await service.checkForParserUpgrades();

      // Should detect 2 PDF files needing upgrade (v1 and v2 -> v3)
      expect(result.filesToReindex).toHaveLength(2);
      expect(result.filesToReindex).toContain('/test/old1.pdf');
      expect(result.filesToReindex).toContain('/test/old2.pdf');
      expect(result.filesToReindex).not.toContain('/test/current.pdf');
      expect(result.upgradeSummary.pdf).toBe(2);
    });

    it('should update database with complete records during upgrade', async () => {
      // Add file with old parser version
      const oldFile: FileStatus = {
        path: '/test/upgrade.doc',
        status: 'indexed',
        parser_version: 1,
        chunk_count: 10,
        error_message: '',
        last_modified: new Date().toISOString(),
        indexed_at: new Date().toISOString(),
        file_hash: 'hash1',
        last_retry: ''
      };

      await fileStatusTable.add([oldFile]);

      // Run upgrade check
      await service.checkForParserUpgrades();

      // Verify the status was updated with complete record
      const results = await fileStatusTable.query()
        .filter('path = "/test/upgrade.doc"')
        .toArray();

      expect(results).toHaveLength(1);
      expect(results[0].status).toBe('outdated');
      expect(results[0].error_message).toContain('Parser upgraded');
      // Verify all fields are present (not undefined/null)
      expect(results[0].path).toBeDefined();
      expect(results[0].chunk_count).toBeDefined();
      expect(results[0].last_modified).toBeDefined();
      expect(results[0].indexed_at).toBeDefined();
      expect(results[0].file_hash).toBeDefined();
      expect(results[0].last_retry).toBeDefined();
    });
  });

  describe('Migration Logic with Real Database', () => {
    it('should skip files that have parser_version (even if 0)', async () => {
      // In modern databases, all files have parser_version field (schema requirement)
      // Migration only worked on truly old databases before the field existed
      const fileWithZero: FileStatus = {
        path: '/test/modern.txt',
        status: 'indexed',
        parser_version: 0, // Has the field, even though it's 0
        chunk_count: 5,
        error_message: '',
        last_modified: new Date().toISOString(),
        indexed_at: new Date().toISOString(),
        file_hash: 'hash1',
        last_retry: ''
      };

      await fileStatusTable.add([fileWithZero]);

      // Run migration
      const count = await service.migrateExistingFiles();

      // Should not migrate because parser_version field exists (even though it's 0)
      // The migration was a one-time thing for truly old databases
      expect(count).toBe(0);

      // File should still have parser_version 0
      const results = await fileStatusTable.query()
        .filter('path = "/test/modern.txt"')
        .toArray();

      expect(results).toHaveLength(1);
      expect(results[0].parser_version).toBe(0);
    });

    it('should not migrate files that already have parser_version', async () => {
      // Add file with parser_version
      const currentFile: FileStatus = {
        path: '/test/current.pdf',
        status: 'indexed',
        parser_version: 3,
        chunk_count: 10,
        error_message: '',
        last_modified: new Date().toISOString(),
        indexed_at: new Date().toISOString(),
        file_hash: 'hash1',
        last_retry: ''
      };

      await fileStatusTable.add([currentFile]);

      // Run migration
      const count = await service.migrateExistingFiles();

      // Should not migrate
      expect(count).toBe(0);
    });
  });

  describe('Failed File Retry Logic', () => {
    it('should queue failed .doc files for retry', async () => {
      // Add failed .doc files with old parser
      const failedDocs: FileStatus[] = [
        {
          path: '/test/failed1.doc',
          status: 'failed',
          parser_version: 1,
          chunk_count: 0,
          error_message: 'Failed to parse as RTF',
          last_modified: new Date().toISOString(),
          indexed_at: new Date().toISOString(),
          file_hash: 'hash1',
          last_retry: ''
        },
        {
          path: '/test/failed2.doc',
          status: 'error',
          parser_version: 1,
          chunk_count: 0,
          error_message: 'Unknown error',
          last_modified: new Date().toISOString(),
          indexed_at: new Date().toISOString(),
          file_hash: 'hash2',
          last_retry: ''
        }
      ];

      await fileStatusTable.add(failedDocs);

      // Run upgrade check (includes failed file retry logic)
      const result = await service.checkForParserUpgrades();

      // Should queue failed .doc files
      const docRetries = result.filesToReindex.filter(f => f.endsWith('.doc'));
      expect(docRetries.length).toBeGreaterThanOrEqual(2);
    });
  });
});
