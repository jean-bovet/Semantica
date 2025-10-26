import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';

// Mock worker_threads to prevent execution of worker code
vi.mock('node:worker_threads', () => ({
  parentPort: {
    on: vi.fn(),
    postMessage: vi.fn()
  }
}));

// Mock the logger to avoid console spam in tests
vi.mock('../../src/shared/utils/logger', () => ({
  logger: {
    log: vi.fn(),
    error: vi.fn(),
    warn: vi.fn()
  }
}));

// Mock lancedb to avoid database operations in tests
vi.mock('@lancedb/lancedb', () => ({
  connect: vi.fn()
}));

// Import after mocks are set up
import { checkDatabaseVersion, migrateDatabaseIfNeeded, writeDatabaseVersion } from '../../src/main/worker/index';

describe('Database Version Migration', () => {
  let testDir: string;
  const DB_VERSION = 2; // Current version (1024-dim vectors)

  beforeEach(async () => {
    // Create a temporary test directory
    testDir = path.join(require('os').tmpdir(), `test-db-${Date.now()}`);
    await fs.mkdir(testDir, { recursive: true });
  });

  afterEach(async () => {
    // Clean up test directory
    try {
      await fs.rm(testDir, { recursive: true, force: true });
    } catch (e) {
      // Ignore cleanup errors
    }
  });

  describe('checkDatabaseVersion', () => {
    it('should detect missing version file and return true (needs migration)', async () => {
      // No version file exists yet
      const needsMigration = await checkDatabaseVersion(testDir);

      expect(needsMigration).toBe(true);
    });

    it('should detect old version (v1) and return true (needs migration)', async () => {
      // Write old version
      const versionFile = path.join(testDir, '.db-version');
      await fs.writeFile(versionFile, '1', 'utf-8');

      const needsMigration = await checkDatabaseVersion(testDir);

      expect(needsMigration).toBe(true);
    });

    it('should accept current version (v2) and return false (no migration)', async () => {
      // Write current version
      const versionFile = path.join(testDir, '.db-version');
      await fs.writeFile(versionFile, String(DB_VERSION), 'utf-8');

      const needsMigration = await checkDatabaseVersion(testDir);

      expect(needsMigration).toBe(false);
    });

    it('should handle corrupted version file and return true (needs migration)', async () => {
      // Write invalid data
      const versionFile = path.join(testDir, '.db-version');
      await fs.writeFile(versionFile, 'not-a-number', 'utf-8');

      const needsMigration = await checkDatabaseVersion(testDir);

      expect(needsMigration).toBe(true);
    });

    it('should handle empty version file and return true (needs migration)', async () => {
      // Write empty file
      const versionFile = path.join(testDir, '.db-version');
      await fs.writeFile(versionFile, '', 'utf-8');

      const needsMigration = await checkDatabaseVersion(testDir);

      expect(needsMigration).toBe(true);
    });

    it('should handle version file with whitespace correctly', async () => {
      // Write version with whitespace
      const versionFile = path.join(testDir, '.db-version');
      await fs.writeFile(versionFile, `  ${DB_VERSION}  \n`, 'utf-8');

      const needsMigration = await checkDatabaseVersion(testDir);

      expect(needsMigration).toBe(false);
    });
  });

  describe('migrateDatabaseIfNeeded', () => {
    it('should skip migration when version is current', async () => {
      // Write current version
      const versionFile = path.join(testDir, '.db-version');
      await fs.writeFile(versionFile, String(DB_VERSION), 'utf-8');

      const migrated = await migrateDatabaseIfNeeded(testDir);

      expect(migrated).toBe(false);
      // Version file should still exist
      const exists = await fs.access(versionFile).then(() => true).catch(() => false);
      expect(exists).toBe(true);
    });

    it('should delete all .lance directories during migration', async () => {
      // Create some mock .lance directories
      const chunksDir = path.join(testDir, 'chunks.lance');
      const statusDir = path.join(testDir, 'file_status.lance');
      const randomFile = path.join(testDir, 'random.txt');

      await fs.mkdir(chunksDir, { recursive: true });
      await fs.mkdir(statusDir, { recursive: true });
      await fs.writeFile(randomFile, 'test', 'utf-8');

      // Write old version to trigger migration
      const versionFile = path.join(testDir, '.db-version');
      await fs.writeFile(versionFile, '1', 'utf-8');

      const migrated = await migrateDatabaseIfNeeded(testDir);

      expect(migrated).toBe(true);

      // .lance directories should be deleted
      const chunksExists = await fs.access(chunksDir).then(() => true).catch(() => false);
      const statusExists = await fs.access(statusDir).then(() => true).catch(() => false);
      expect(chunksExists).toBe(false);
      expect(statusExists).toBe(false);

      // Non-.lance file should still exist
      const randomExists = await fs.access(randomFile).then(() => true).catch(() => false);
      expect(randomExists).toBe(true);
    });

    it('should delete old version file during migration', async () => {
      // Write old version
      const versionFile = path.join(testDir, '.db-version');
      await fs.writeFile(versionFile, '1', 'utf-8');

      const migrated = await migrateDatabaseIfNeeded(testDir);

      expect(migrated).toBe(true);

      // Old version file should be deleted
      const exists = await fs.access(versionFile).then(() => true).catch(() => false);
      expect(exists).toBe(false);
    });

    it('should handle missing version file (first run)', async () => {
      // No version file exists
      const migrated = await migrateDatabaseIfNeeded(testDir);

      expect(migrated).toBe(true);
      // Should not throw error, should complete successfully
    });

    it('should handle migration when database directory does not exist', async () => {
      // Use non-existent directory
      const nonExistentDir = path.join(testDir, 'non-existent');

      const migrated = await migrateDatabaseIfNeeded(nonExistentDir);

      expect(migrated).toBe(true);
      // Directory should be created
      const exists = await fs.access(nonExistentDir).then(() => true).catch(() => false);
      expect(exists).toBe(true);
    });

    it('should handle .lance directories with nested content', async () => {
      // Create .lance directory with nested files
      const chunksDir = path.join(testDir, 'chunks.lance');
      const nestedDir = path.join(chunksDir, 'nested');
      const nestedFile = path.join(nestedDir, 'data.bin');

      await fs.mkdir(nestedDir, { recursive: true });
      await fs.writeFile(nestedFile, 'data', 'utf-8');

      // Write old version to trigger migration
      const versionFile = path.join(testDir, '.db-version');
      await fs.writeFile(versionFile, '1', 'utf-8');

      const migrated = await migrateDatabaseIfNeeded(testDir);

      expect(migrated).toBe(true);

      // Entire directory tree should be deleted
      const chunksExists = await fs.access(chunksDir).then(() => true).catch(() => false);
      expect(chunksExists).toBe(false);
    });
  });

  describe('writeDatabaseVersion', () => {
    it('should write current version to file', async () => {
      await writeDatabaseVersion(testDir);

      const versionFile = path.join(testDir, '.db-version');
      const content = await fs.readFile(versionFile, 'utf-8');

      expect(content).toBe(String(DB_VERSION));
    });

    it('should overwrite existing version file', async () => {
      const versionFile = path.join(testDir, '.db-version');

      // Write old version
      await fs.writeFile(versionFile, '1', 'utf-8');

      // Write current version
      await writeDatabaseVersion(testDir);

      const content = await fs.readFile(versionFile, 'utf-8');
      expect(content).toBe(String(DB_VERSION));
    });

    it('should create version file even if directory has no other files', async () => {
      // Empty directory
      await writeDatabaseVersion(testDir);

      const versionFile = path.join(testDir, '.db-version');
      const exists = await fs.access(versionFile).then(() => true).catch(() => false);

      expect(exists).toBe(true);
    });
  });

  describe('Full migration workflow', () => {
    it('should complete full migration cycle from v1 to v2', async () => {
      // Setup: Create old database structure
      const chunksDir = path.join(testDir, 'chunks.lance');
      const statusDir = path.join(testDir, 'file_status.lance');
      await fs.mkdir(chunksDir, { recursive: true });
      await fs.mkdir(statusDir, { recursive: true });

      const versionFile = path.join(testDir, '.db-version');
      await fs.writeFile(versionFile, '1', 'utf-8');

      // Step 1: Detect migration needed
      const needsMigration = await checkDatabaseVersion(testDir);
      expect(needsMigration).toBe(true);

      // Step 2: Perform migration
      const migrated = await migrateDatabaseIfNeeded(testDir);
      expect(migrated).toBe(true);

      // Step 3: Write new version
      await writeDatabaseVersion(testDir);

      // Verify: Old structures gone, new version written
      const chunksExists = await fs.access(chunksDir).then(() => true).catch(() => false);
      const statusExists = await fs.access(statusDir).then(() => true).catch(() => false);
      expect(chunksExists).toBe(false);
      expect(statusExists).toBe(false);

      const newVersion = await fs.readFile(versionFile, 'utf-8');
      expect(newVersion).toBe(String(DB_VERSION));

      // Step 4: Verify no migration needed now
      const stillNeedsMigration = await checkDatabaseVersion(testDir);
      expect(stillNeedsMigration).toBe(false);
    });

    it('should handle first-time setup (no existing database)', async () => {
      // Fresh directory with no database

      // Step 1: Check version (should need migration)
      const needsMigration = await checkDatabaseVersion(testDir);
      expect(needsMigration).toBe(true);

      // Step 2: Migrate (should create directory structure)
      const migrated = await migrateDatabaseIfNeeded(testDir);
      expect(migrated).toBe(true);

      // Step 3: Write version
      await writeDatabaseVersion(testDir);

      // Verify: Version file exists with correct version
      const versionFile = path.join(testDir, '.db-version');
      const content = await fs.readFile(versionFile, 'utf-8');
      expect(content).toBe(String(DB_VERSION));

      // Verify: No further migration needed
      const stillNeedsMigration = await checkDatabaseVersion(testDir);
      expect(stillNeedsMigration).toBe(false);
    });
  });
});
