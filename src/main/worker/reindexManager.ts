import * as path from 'node:path';
import * as fs from 'node:fs';
import * as crypto from 'node:crypto';
import { PARSER_VERSIONS, getParserVersion } from './parserVersions';
import { logger } from '../../shared/utils/logger';

export interface FileStatus {
  path: string;
  status: 'indexed' | 'failed' | 'error' | 'queued' | 'outdated';
  parser_version: number;
  chunk_count: number;
  error_message: string;
  last_modified: string;
  indexed_at: string;
  file_hash: string;
  last_retry?: string;
}

function getFileHash(filePath: string): string {
  try {
    const stats = fs.statSync(filePath);
    const content = `${filePath}:${stats.size}:${stats.mtimeMs}`;
    return crypto.createHash('md5').update(content).digest('hex');
  } catch (_e) {
    return '';
  }
}

export function shouldReindex(filePath: string, fileRecord?: FileStatus): boolean {
  const ext = path.extname(filePath).slice(1).toLowerCase();
  const currentVersion = getParserVersion(ext);
  
  if (!currentVersion) {
    return false; // Unsupported file type
  }
  
  // No record = never indexed
  if (!fileRecord) {
    return true;
  }
  
  // File modified since last index
  const currentHash = getFileHash(filePath);
  if (fileRecord.file_hash !== currentHash) {
    return true;
  }
  
  // Parser upgraded
  if (!fileRecord.parser_version || fileRecord.parser_version < currentVersion) {
    logger.log('REINDEX', `Parser upgraded for ${ext}: v${fileRecord.parser_version} -> v${currentVersion}`);
    return true;
  }
  
  // Failed files with newer parser available
  if (fileRecord.status === 'failed' || fileRecord.status === 'error') {
    // Retry failed files once per day max
    const lastRetry = fileRecord.last_retry ? new Date(fileRecord.last_retry) : new Date(0);
    const hoursSinceRetry = (Date.now() - lastRetry.getTime()) / (1000 * 60 * 60);
    if (hoursSinceRetry > 24) {
      return true;
    }
  }
  
  return false;
}

export async function checkForParserUpgrades(fileStatusTable: any, queue: string[], parentPort?: any): Promise<void> {
  if (!fileStatusTable) {
    logger.log('REINDEX', 'File status table not available, skipping parser upgrade check');
    return;
  }
  
  logger.log('REINDEX', 'Checking for parser upgrades...');
  logger.log('REINDEX', 'Initial queue size:', queue.length);
  
  const upgradeSummary: Record<string, number> = {};
  
  try {
    // Get all indexed files
    const allFiles = await fileStatusTable.query().toArray();
    
    for (const [ext, currentVersion] of Object.entries(PARSER_VERSIONS)) {
      // Find outdated files for this extension
      const outdatedFiles = allFiles.filter((f: FileStatus) => {
        const fileExt = path.extname(f.path).slice(1).toLowerCase();
        return fileExt === ext && 
               f.status === 'indexed' && 
               (!f.parser_version || f.parser_version < currentVersion);
      });
      
      if (outdatedFiles.length > 0) {
        upgradeSummary[ext] = outdatedFiles.length;
        
        // Queue for re-indexing with high priority (add to front)
        for (const file of outdatedFiles) {
          // Update status to show it needs update
          try {
            await fileStatusTable.delete(`path = "${file.path}"`);
            await fileStatusTable.add([{
              ...file,
              status: 'outdated',
              error_message: `Parser upgraded to v${currentVersion}`
            }]);
          } catch (e) {
            logger.error('REINDEX', `Failed to update status for ${file.path}:`, e);
          }
          
          // Add to front of queue for high priority
          queue.unshift(file.path);
        }
      }
    }
    
    // Also check for failed .doc files if we're now at version 2
    if (getParserVersion('doc') === 2) {
      const failedDocs = allFiles.filter((f: FileStatus) => {
        const fileExt = path.extname(f.path).slice(1).toLowerCase();
        return fileExt === 'doc' && 
               (f.status === 'failed' || f.status === 'error') &&
               (!f.parser_version || f.parser_version < 2);
      });
      
      if (failedDocs.length > 0) {
        logger.log('REINDEX', `Found ${failedDocs.length} failed .doc files to retry with new parser`);
        upgradeSummary['doc_retries'] = failedDocs.length;
        
        for (const file of failedDocs) {
          // Update status and queue for retry
          try {
            await fileStatusTable.delete(`path = "${file.path}"`);
            await fileStatusTable.add([{
              ...file,
              status: 'queued',
              error_message: 'Retrying with improved .doc parser'
            }]);
          } catch (e) {
            logger.error('REINDEX', `Failed to update status for ${file.path}:`, e);
          }
          
          queue.unshift(file.path);
        }
      }
    }
    
    if (Object.keys(upgradeSummary).length > 0) {
      logger.log('REINDEX', 'Parser upgrades detected:', upgradeSummary);
      logger.log('REINDEX', 'Queue size after parser upgrades:', queue.length);
      
      // Notify parent thread if available
      if (parentPort) {
        parentPort.postMessage({
          type: 'parser-upgrade',
          payload: upgradeSummary
        });
      }
    } else {
      logger.log('REINDEX', 'All files are using the latest parser versions');
      logger.log('REINDEX', 'Queue size after parser check:', queue.length);
    }
  } catch (error) {
    logger.error('REINDEX', 'Error checking for parser upgrades:', error);
  }
}

export async function migrateExistingFiles(fileStatusTable: any): Promise<void> {
  if (!fileStatusTable) {
    return;
  }
  
  logger.log('REINDEX', 'Migrating existing files to include parser versions...');
  
  try {
    const allFiles = await fileStatusTable.query().toArray();
    let migratedCount = 0;
    
    for (const file of allFiles) {
      // Skip if already has parser_version
      if (file.parser_version !== undefined && file.parser_version !== null) {
        continue;
      }
      
      const ext = path.extname(file.path).slice(1).toLowerCase();
      
      // Set initial version based on status
      let initialVersion = 1;
      
      // Special case for .doc files - if they were indexed successfully before word-extractor,
      // they were likely using version 1 (RTF attempt)
      if (ext === 'doc' && file.status === 'indexed') {
        initialVersion = 1; // They'll be upgraded to v2 on next startup
      }
      
      try {
        // Update the record with parser version
        await fileStatusTable.delete(`path = "${file.path}"`);
        await fileStatusTable.add([{
          ...file,
          parser_version: initialVersion,
          last_retry: file.status === 'failed' ? new Date().toISOString() : null
        }]);
        migratedCount++;
      } catch (e) {
        logger.error('REINDEX', `Failed to migrate ${file.path}:`, e);
      }
    }
    
    if (migratedCount > 0) {
      logger.log('REINDEX', `Migrated ${migratedCount} files to include parser versions`);
    }
  } catch (error) {
    logger.error('REINDEX', 'Error migrating existing files:', error);
  }
}