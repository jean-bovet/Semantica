import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as path from 'node:path';
import * as fs from 'node:fs';
import * as os from 'node:os';
import { ReindexService, FileStatus, QueryBuilder, FileStatusRepository } from '../../src/main/services/ReindexService';
import { PARSER_VERSIONS } from '../../src/main/worker/parserVersions';

describe('Parser Version Upgrade Integration', () => {
  let testDir: string;

  // Helper to create a mock file status repository with query builder support
  const createMockRepo = (files: FileStatus[]): FileStatusRepository => {
    const createQueryBuilder = (): QueryBuilder => {
      let filteredFiles = files;

      const builder: QueryBuilder = {
        filter: (condition: string) => {
          if (condition.includes('status = "indexed"')) {
            filteredFiles = files.filter(f => f.status === 'indexed');
          } else if (condition.includes('status = "failed" OR status = "error"')) {
            filteredFiles = files.filter(f => f.status === 'failed' || f.status === 'error');
          }
          return builder;
        },
        select: (columns: string[]) => {
          // Select doesn't filter, just returns builder for chaining
          return builder;
        },
        toArray: async () => filteredFiles
      };

      return builder;
    };

    return {
      query: () => createQueryBuilder(),
      delete: async () => {},
      add: async (records: FileStatus[]) => {
        // Validate required fields like LanceDB does
        for (const record of records) {
          if (!record.path || record.path === '') {
            throw new Error('Missing required field: path');
          }
          if (!record.status) {
            throw new Error('Missing required field: status');
          }
          // LanceDB requires all string fields to be present (not undefined/null)
          const requiredFields = ['path', 'status', 'error_message', 'last_modified', 'indexed_at', 'file_hash', 'last_retry'];
          for (const field of requiredFields) {
            if (record[field as keyof FileStatus] === undefined || record[field as keyof FileStatus] === null) {
              throw new Error(`Missing or null field: ${field}`);
            }
          }
        }
      }
    };
  };

  beforeEach(async () => {
    // Create temporary test directory
    testDir = path.join(os.tmpdir(), `parser-upgrade-test-${Date.now()}`);
    fs.mkdirSync(testDir, { recursive: true });
  });

  afterEach(async () => {
    // Clean up test directory
    if (fs.existsSync(testDir)) {
      fs.rmSync(testDir, { recursive: true, force: true });
    }
  });

  it('should detect when files need re-indexing due to parser upgrades', async () => {
    const files: FileStatus[] = [
      {
        path: path.join(testDir, 'test.doc'),
        status: 'indexed',
        parser_version: 1, // Old version
        chunk_count: 10,
        error_message: '',
        last_modified: new Date().toISOString(),
        indexed_at: new Date().toISOString(),
        file_hash: 'abc123'
      }
    ];

    const mockRepo = createMockRepo(files);
    const service = new ReindexService(mockRepo);
    const result = await service.checkForParserUpgrades();

    // Should have queued the doc file for re-indexing
    expect(result.filesToReindex.length).toBe(1);
    expect(result.filesToReindex[0]).toContain('test.doc');
  });

  it('should migrate existing files without parser versions', async () => {
    const files: FileStatus[] = [
      {
        path: path.join(testDir, 'test.pdf'),
        status: 'indexed',
        parser_version: undefined as any,
        chunk_count: 5,
        error_message: '',
        last_modified: new Date().toISOString(),
        indexed_at: new Date().toISOString(),
        file_hash: 'xyz789'
        // No parser_version field
      }
    ];

    const mockRepo = createMockRepo(files);
    const service = new ReindexService(mockRepo);
    const count = await service.migrateExistingFiles();

    // Should have migrated 1 file
    expect(count).toBe(1);
  });

  it('should correctly determine when files need re-indexing', () => {
    const testFile = path.join(testDir, 'test.doc');
    fs.writeFileSync(testFile, 'Test content');

    const service = new ReindexService(undefined);

    // Test with no record (never indexed)
    expect(service.shouldReindex(testFile, undefined)).toBe(true);

    // Test with old parser version
    const oldVersionRecord: FileStatus = {
      path: testFile,
      status: 'indexed',
      parser_version: 1,
      chunk_count: 10,
      error_message: '',
      last_modified: new Date().toISOString(),
      indexed_at: new Date().toISOString(),
      file_hash: 'old-hash'
    };
    expect(service.shouldReindex(testFile, oldVersionRecord)).toBe(true);

    // Test with current parser version but changed file
    const currentVersionRecord: FileStatus = {
      path: testFile,
      status: 'indexed',
      parser_version: PARSER_VERSIONS.doc,
      chunk_count: 10,
      error_message: '',
      last_modified: new Date().toISOString(),
      indexed_at: new Date().toISOString(),
      file_hash: 'different-hash'
    };
    expect(service.shouldReindex(testFile, currentVersionRecord)).toBe(true);
  });

  it('should handle failed files with retry logic', () => {
    const testFile = path.join(testDir, 'failed.pdf');
    fs.writeFileSync(testFile, '%PDF-1.4');

    const service = new ReindexService(undefined);

    // Calculate the actual file hash
    const stats = fs.statSync(testFile);
    const content = `${testFile}:${stats.size}:${stats.mtimeMs}`;
    const actualHash = require('crypto').createHash('md5').update(content).digest('hex');

    // Test failed file after 24 hours
    const dayAgo = new Date(Date.now() - 25 * 60 * 60 * 1000).toISOString();
    const oldFailedRecord: FileStatus = {
      path: testFile,
      status: 'failed',
      parser_version: 1,
      chunk_count: 0,
      error_message: 'Parse error',
      last_modified: new Date().toISOString(),
      indexed_at: new Date().toISOString(),
      file_hash: actualHash, // Use actual hash so file content hasn't changed
      last_retry: dayAgo
    };
    expect(service.shouldReindex(testFile, oldFailedRecord)).toBe(true);

    // Test failed file within 24 hours
    const hourAgo = new Date(Date.now() - 1 * 60 * 60 * 1000).toISOString();
    const recentFailedRecord: FileStatus = {
      path: testFile,
      status: 'failed',
      parser_version: 1,
      chunk_count: 0,
      error_message: 'Parse error',
      last_modified: new Date().toISOString(),
      indexed_at: new Date().toISOString(),
      file_hash: actualHash, // Use actual hash so file content hasn't changed
      last_retry: hourAgo
    };
    expect(service.shouldReindex(testFile, recentFailedRecord)).toBe(false);
  });

  it('should queue failed .doc files for retry with new parser', async () => {
    const files: FileStatus[] = [
      {
        path: path.join(testDir, 'failed1.doc'),
        status: 'failed',
        parser_version: 1, // Old parser that failed
        chunk_count: 0,
        error_message: 'Failed to parse as RTF',
        last_modified: new Date().toISOString(),
        indexed_at: new Date().toISOString(),
        file_hash: 'fail1'
      },
      {
        path: path.join(testDir, 'failed2.doc'),
        status: 'error',
        parser_version: null as any, // No version recorded
        chunk_count: 0,
        error_message: 'Unknown error',
        last_modified: new Date().toISOString(),
        indexed_at: new Date().toISOString(),
        file_hash: 'fail2'
      }
    ];

    const mockRepo = createMockRepo(files);
    const service = new ReindexService(mockRepo);
    const result = await service.checkForParserUpgrades();

    // Should have queued both failed doc files for retry
    expect(result.filesToReindex.filter(f => f.endsWith('.doc')).length).toBeGreaterThanOrEqual(2);
  });
});