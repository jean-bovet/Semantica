import * as fs from 'node:fs';
import * as path from 'node:path';
import * as crypto from 'node:crypto';
import { shouldReindex } from './reindexManager';

export interface FileStatus {
  path: string;
  status: 'indexed' | 'failed' | 'error' | 'queued' | 'outdated';
  parser_version: number;
  chunk_count: number;
  error_message: string;
  last_modified: string;
  indexed_at: string;
  file_hash: string;
  last_retry: string; // Empty string instead of null for LanceDB compatibility
}

export interface ScanResult {
  newFiles: string[];
  modifiedFiles: string[];
  skippedFiles: string[];
  hashCalculations: number;
}

/**
 * Initialize the file status table in LanceDB
 */
export async function initializeFileStatusTable(db: any): Promise<any> {
  const tables = await db.tableNames();
  
  if (tables.includes('file_status')) {
    const table = await db.openTable('file_status');
    // Verify it's a valid table by trying to query it
    try {
      await table.query().limit(1).toArray();
      console.log('Opened existing file_status table');
      return table;
    } catch (testError) {
      console.log('file_status table exists but is not valid, recreating...', testError);
      await db.dropTable('file_status');
      // Fall through to create new table
    }
  }
  
  // Create new table with dummy data (LanceDB requirement)
  // Note: LanceDB cannot infer types for all-null columns, so use empty string instead
  const dummyData = [{
    path: '__init__',
    status: 'init' as const,
    error_message: '',
    chunk_count: 0,
    last_modified: new Date().toISOString(),
    indexed_at: new Date().toISOString(),
    file_hash: '',
    parser_version: 0,
    last_retry: ''  // Use empty string instead of null for LanceDB compatibility
  }];
  
  const table = await db.createTable('file_status', dummyData);
  console.log('Created new file_status table');
  
  // Try to clean up the dummy record (may fail but that's OK)
  try {
    await table.delete('path = "__init__"');
  } catch (e) {
    // Ignore - some versions of LanceDB don't support delete
  }
  
  return table;
}

/**
 * Load file status records into a cache map
 */
export async function loadFileStatusCache(fileStatusTable: any): Promise<Map<string, FileStatus>> {
  if (!fileStatusTable) {
    return new Map();
  }
  
  try {
    const records = await fileStatusTable.query().toArray();
    const cache = new Map<string, FileStatus>(records.map((r: any) => [r.path, r]));
    console.log(`Loaded ${cache.size} file status records into cache`);
    return cache;
  } catch (e) {
    console.error('Could not cache file status records:', e);
    return new Map();
  }
}

/**
 * Calculate a file hash based on size and modification time
 */
export function getFileHash(filePath: string): string {
  try {
    const stats = fs.statSync(filePath);
    const content = `${filePath}:${stats.size}:${stats.mtimeMs}`;
    return crypto.createHash('md5').update(content).digest('hex');
  } catch (e) {
    return '';
  }
}

/**
 * Get the file extension, handling special cases
 */
export function getFileExtension(filePath: string): string {
  // Handle files starting with dot (like .gitignore)
  const basename = path.basename(filePath);
  if (basename.startsWith('.') && !basename.includes('.', 1)) {
    // File like .gitignore - treat the part after dot as extension
    return basename.slice(1).toLowerCase();
  }
  
  const ext = path.extname(filePath).slice(1).toLowerCase();
  // Handle dual extensions like .tar.gz
  if (ext === 'gz' || ext === 'bz2' || ext === 'xz') {
    const base = path.basename(filePath, '.' + ext);
    const subExt = path.extname(base).slice(1).toLowerCase();
    if (subExt) {
      return `${subExt}.${ext}`;
    }
  }
  return ext;
}

/**
 * Check if a file is supported based on extension
 */
export function isFileSupported(filePath: string, supportedExtensions: string[]): boolean {
  const ext = getFileExtension(filePath);
  return supportedExtensions.includes(ext);
}

/**
 * Scan files for changes using smart timestamp-based approach
 */
export async function scanForChanges(
  files: string[],
  fileStatusCache: Map<string, FileStatus>,
  supportedExtensions: string[],
  existingQueue: string[] = []
): Promise<ScanResult> {
  const result: ScanResult = {
    newFiles: [],
    modifiedFiles: [],
    skippedFiles: [],
    hashCalculations: 0
  };
  
  for (const filePath of files) {
    // Skip if already in queue
    if (existingQueue.includes(filePath)) {
      result.skippedFiles.push(filePath);
      continue;
    }
    
    // Skip unsupported files
    if (!isFileSupported(filePath, supportedExtensions)) {
      result.skippedFiles.push(filePath);
      continue;
    }
    
    const fileRecord = fileStatusCache.get(filePath);
    
    // New file - never seen before
    if (!fileRecord) {
      result.newFiles.push(filePath);
      continue;
    }
    
    // Use shouldReindex for complex logic (parser upgrades, retries, etc.)
    if (shouldReindex(filePath, fileRecord)) {
      result.modifiedFiles.push(filePath);
      continue;
    }
    
    // Smart timestamp check to avoid unnecessary hash calculations
    try {
      const stats = fs.statSync(filePath);
      const fileModTime = stats.mtimeMs;
      const indexedTime = new Date(fileRecord.indexed_at).getTime();
      
      // Only calculate hash if file was modified after indexing
      if (fileModTime > indexedTime) {
        result.hashCalculations++;
        const currentHash = getFileHash(filePath);
        if (currentHash !== fileRecord.file_hash) {
          result.modifiedFiles.push(filePath);
          continue;
        }
      }
    } catch (e) {
      // File might have been deleted or is inaccessible
      result.skippedFiles.push(filePath);
      continue;
    }
    
    // File is up-to-date
    result.skippedFiles.push(filePath);
  }
  
  return result;
}

/**
 * Update the status of a file in the database
 */
export async function updateFileStatus(
  fileStatusTable: any,
  filePath: string,
  status: 'indexed' | 'failed' | 'error' | 'queued' | 'outdated',
  errorMessage: string = '',
  chunkCount: number = 0,
  parserVersion: number = 0
): Promise<void> {
  if (!fileStatusTable) {
    return;
  }
  
  try {
    const stats = fs.statSync(filePath);
    const record: FileStatus = {
      path: filePath,
      status,
      error_message: errorMessage,
      chunk_count: chunkCount,
      last_modified: new Date(stats.mtimeMs).toISOString(),
      indexed_at: new Date().toISOString(),
      file_hash: getFileHash(filePath),
      parser_version: parserVersion,
      last_retry: status === 'failed' || status === 'error' ? new Date().toISOString() : ''
    };
    
    // Try to delete existing record first
    try {
      await fileStatusTable.delete(`path = "${filePath}"`);
    } catch (e) {
      // Ignore - record might not exist
    }
    
    // Add new record
    await fileStatusTable.add([record]);
  } catch (e) {
    console.error(`Failed to update file status for ${filePath}:`, e);
  }
}