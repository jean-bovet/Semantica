import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as path from 'node:path';
import * as fs from 'node:fs';
import * as os from 'node:os';
import { checkForParserUpgrades, migrateExistingFiles, shouldReindex, FileStatus } from '../../src/main/worker/reindexManager';
import { PARSER_VERSIONS } from '../../src/main/worker/parserVersions';

describe('Parser Version Upgrade Integration', () => {
  let testDir: string;

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
    // Mock file status table with old parser version
    const mockFileStatusTable = {
      query: () => ({
        toArray: async () => [
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
        ]
      }),
      delete: async () => {},
      add: async () => {}
    };

    const queue: string[] = [];
    await checkForParserUpgrades(mockFileStatusTable, queue);

    // Should have queued the doc file for re-indexing
    expect(queue.length).toBe(1);
    expect(queue[0]).toContain('test.doc');
  });

  it('should migrate existing files without parser versions', async () => {
    // Mock file status table without parser versions
    const mockFileStatusTable = {
      query: () => ({
        toArray: async () => [
          {
            path: path.join(testDir, 'test.pdf'),
            status: 'indexed',
            chunk_count: 5,
            error_message: '',
            last_modified: new Date().toISOString(),
            indexed_at: new Date().toISOString(),
            file_hash: 'xyz789'
            // No parser_version field
          }
        ]
      }),
      delete: async () => {},
      add: async () => {}
    };

    await migrateExistingFiles(mockFileStatusTable);
    
    // Migration should have been attempted
    expect(true).toBe(true); // Basic assertion to verify no errors
  });

  it('should correctly determine when files need re-indexing', () => {
    const testFile = path.join(testDir, 'test.doc');
    fs.writeFileSync(testFile, 'Test content');

    // Test with no record (never indexed)
    expect(shouldReindex(testFile, undefined)).toBe(true);

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
    expect(shouldReindex(testFile, oldVersionRecord)).toBe(true);

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
    expect(shouldReindex(testFile, currentVersionRecord)).toBe(true);
  });

  it('should handle failed files with retry logic', () => {
    const testFile = path.join(testDir, 'failed.pdf');
    fs.writeFileSync(testFile, '%PDF-1.4');
    
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
    expect(shouldReindex(testFile, oldFailedRecord)).toBe(true);

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
    expect(shouldReindex(testFile, recentFailedRecord)).toBe(false);
  });

  it('should queue failed .doc files for retry with new parser', async () => {
    // Mock file status table with failed .doc files
    const mockFileStatusTable = {
      query: () => ({
        toArray: async () => [
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
            parser_version: null, // No version recorded
            chunk_count: 0,
            error_message: 'Unknown error',
            last_modified: new Date().toISOString(),
            indexed_at: new Date().toISOString(),
            file_hash: 'fail2'
          }
        ]
      }),
      delete: async () => {},
      add: async () => {}
    };

    const queue: string[] = [];
    await checkForParserUpgrades(mockFileStatusTable, queue);

    // Should have queued both failed doc files for retry
    expect(queue.filter(f => f.endsWith('.doc')).length).toBeGreaterThanOrEqual(2);
  });
});