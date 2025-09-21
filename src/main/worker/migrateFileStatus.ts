import * as fs from 'node:fs';
import * as path from 'node:path';
import { getFileHash } from '../core/indexing/fileStatusManager';
import { logger } from '../../shared/utils/logger';

/**
 * Migrate existing indexed files to file status table
 * This handles files that were indexed before the file status table was introduced
 */
export async function migrateIndexedFilesToStatus(
  documentsTable: any,
  fileStatusTable: any,
  fileHashes: Map<string, string>
): Promise<number> {
  if (!fileStatusTable || !documentsTable) {
    logger.log('DATABASE', 'Cannot migrate: tables not available');
    return 0;
  }
  
  logger.log('DATABASE', 'Migrating indexed files to file status table...');
  
  try {
    // Get all existing file status records to avoid duplicates
    const existingStatuses = await fileStatusTable.query().toArray();
    const statusPaths = new Set(existingStatuses.map((s: any) => s.path));
    logger.log('DATABASE', `Found ${statusPaths.size} existing file status records`);
    
    // Get all unique paths from the documents table
    const allDocs = await documentsTable.query()
      .select(['path'])
      .limit(100000)
      .toArray();
    
    const uniquePaths = new Set<string>();
    allDocs.forEach((doc: any) => {
      if (doc.path && !statusPaths.has(doc.path)) {
        uniquePaths.add(doc.path);
      }
    });
    
    logger.log('DATABASE', `Found ${uniquePaths.size} indexed files without status records`);
    
    // Create status records for indexed files
    const recordsToAdd: any[] = [];
    let skippedCount = 0;
    
    for (const filePath of uniquePaths) {
      try {
        // Check if file still exists
        if (!fs.existsSync(filePath)) {
          skippedCount++;
          continue;
        }
        
        const stats = fs.statSync(filePath);
        const ext = path.extname(filePath).slice(1).toLowerCase();
        
        // Determine parser version based on file type
        // Default to 1 for files indexed before versioning
        let parserVersion = 1;
        if (ext === 'doc') {
          // .doc files indexed before v2 would have failed
          // If they're in the index, they were probably parsed as text
          parserVersion = 1;
        }
        
        const record = {
          path: filePath,
          status: 'indexed',
          error_message: '',
          chunk_count: 1, // We don't know exact count, but at least 1
          last_modified: new Date(stats.mtimeMs).toISOString(),
          indexed_at: new Date(stats.mtimeMs).toISOString(), // Use mtime as approximation
          file_hash: fileHashes.get(filePath) || getFileHash(filePath),
          parser_version: parserVersion,
          last_retry: ''
        };
        
        recordsToAdd.push(record);
        
        // Add in batches to avoid memory issues
        if (recordsToAdd.length >= 100) {
          await fileStatusTable.add(recordsToAdd);
          logger.log('DATABASE', `Added ${recordsToAdd.length} file status records`);
          recordsToAdd.length = 0;
        }
      } catch (e) {
        logger.log('DATABASE', `Could not create status for ${filePath}:`, e);
        skippedCount++;
      }
    }
    
    // Add remaining records
    if (recordsToAdd.length > 0) {
      await fileStatusTable.add(recordsToAdd);
      logger.log('DATABASE', `Added final ${recordsToAdd.length} file status records`);
    }
    
    const totalMigrated = uniquePaths.size - skippedCount;
    logger.log('DATABASE', `Migration complete: ${totalMigrated} records created, ${skippedCount} skipped`);
    
    return totalMigrated;
  } catch (error) {
    logger.error('DATABASE', 'Error during file status migration:', error);
    return 0;
  }
}

/**
 * Clean up orphaned status records for files that no longer exist
 */
export async function cleanupOrphanedStatuses(fileStatusTable: any): Promise<number> {
  if (!fileStatusTable) {
    return 0;
  }
  
  try {
    const allStatuses = await fileStatusTable.query().toArray();
    let deletedCount = 0;
    
    for (const status of allStatuses) {
      if (!fs.existsSync(status.path)) {
        try {
          await fileStatusTable.delete(`path = "${status.path}"`);
          deletedCount++;
        } catch (_e) {
          // Ignore deletion errors
        }
      }
    }
    
    if (deletedCount > 0) {
      logger.log('DATABASE', `Cleaned up ${deletedCount} orphaned file status records`);
    }
    
    return deletedCount;
  } catch (error) {
    logger.error('DATABASE', 'Error cleaning up orphaned statuses:', error);
    return 0;
  }
}