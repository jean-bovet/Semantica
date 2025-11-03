import fs from 'node:fs';
import path from 'node:path';
import { logger } from '../../../shared/utils/logger';

// Database version management
// Version 1: 384-dimensional vectors (old Xenova multilingual-e5-small model)
// Version 2: 1024-dimensional vectors (Ollama bge-m3 model - buggy, deprecated)
// Version 3: 768-dimensional vectors (Ollama nomic-embed-text - stable)
// Version 4: 768-dimensional vectors (Python sidecar paraphrase-multilingual-mpnet-base-v2 - production)
// Version 5: Fix cross-file contamination bug in batch processor (chunks from different files were stored with wrong file path)
export const DB_VERSION = 5;
export const DB_VERSION_FILE = '.db-version';

/**
 * Check if database version matches current version
 * @param dir Database directory
 * @returns true if migration needed, false if version is current
 */
export async function checkDatabaseVersion(dir: string): Promise<boolean> {
  const versionFile = path.join(dir, DB_VERSION_FILE);
  try {
    const content = await fs.promises.readFile(versionFile, 'utf-8');
    const existingVersion = parseInt(content.trim(), 10);

    if (isNaN(existingVersion)) {
      logger.log('DATABASE', 'Version file contains invalid data');
      return true; // Corrupted = needs migration
    }

    return existingVersion !== DB_VERSION;
  } catch {
    // File doesn't exist or can't be read
    return true;
  }
}

/**
 * Migrate database if version doesn't match
 * @param dir Database directory
 * @returns true if migration was performed, false if not needed
 */
export async function migrateDatabaseIfNeeded(dir: string): Promise<boolean> {
  const needsMigration = await checkDatabaseVersion(dir);

  if (!needsMigration) {
    logger.log('DATABASE', `Database version ${DB_VERSION} is current, no migration needed`);
    return false;
  }

  logger.log('DATABASE', `⚠️  Database version mismatch detected`);
  logger.log('DATABASE', `🔄 Migrating to database version ${DB_VERSION}...`);

  try {
    // Ensure directory exists
    await fs.promises.mkdir(dir, { recursive: true });

    // Delete all .lance directories (chunks.lance, file_status.lance, etc.)
    const entries = await fs.promises.readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.name.endsWith('.lance')) {
        const fullPath = path.join(dir, entry.name);
        logger.log('DATABASE', `Deleting old database: ${entry.name}`);
        await fs.promises.rm(fullPath, { recursive: true, force: true });
      }
    }

    // Delete old version file
    const versionFile = path.join(dir, DB_VERSION_FILE);
    await fs.promises.rm(versionFile, { force: true });

    logger.log('DATABASE', '✅ Database migration complete. All files will be re-indexed.');
    return true;
  } catch (error) {
    logger.error('DATABASE', 'Failed to migrate database:', error);
    throw error;
  }
}

/**
 * Write current database version to file
 * @param dir Database directory
 */
export async function writeDatabaseVersion(dir: string): Promise<void> {
  const versionFile = path.join(dir, DB_VERSION_FILE);
  await fs.promises.writeFile(versionFile, String(DB_VERSION), 'utf-8');
  logger.log('DATABASE', `Database version ${DB_VERSION} written`);
}
