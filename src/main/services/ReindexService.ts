import * as path from 'node:path';
import * as fs from 'node:fs';
import * as crypto from 'node:crypto';
import { PARSER_VERSIONS, getParserVersion } from '../worker/parserVersions';

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

export interface QueryBuilder {
  filter(condition: string): QueryBuilder;
  select(columns: string[]): QueryBuilder;
  toArray(): Promise<FileStatus[]>;
}

export interface FileStatusRepository {
  query(): QueryBuilder;
  delete(condition: string): Promise<void>;
  add(records: FileStatus[]): Promise<void>;
}

export interface ReindexResult {
  filesToReindex: string[];
  upgradeSummary: Record<string, number>;
}

export class ReindexService {
  private readonly retryIntervalHours = 24;

  constructor(
    private fileStatusRepo?: FileStatusRepository,
    private logger: { log: (msg: string) => void; error: (msg: string, error?: any) => void } = console
  ) {}

  /**
   * Calculate file hash based on path, size, and modification time
   */
  getFileHash(filePath: string): string {
    try {
      const stats = fs.statSync(filePath);
      const content = `${filePath}:${stats.size}:${stats.mtimeMs}`;
      return crypto.createHash('md5').update(content).digest('hex');
    } catch (_e) {
      return '';
    }
  }

  /**
   * Determine if a file should be re-indexed
   */
  shouldReindex(filePath: string, fileRecord?: FileStatus): boolean {
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
    const currentHash = this.getFileHash(filePath);
    if (fileRecord.file_hash !== currentHash) {
      return true;
    }
    
    // Parser upgraded
    if (!fileRecord.parser_version || fileRecord.parser_version < currentVersion) {
      this.logger.log(`Parser upgraded for ${ext}: v${fileRecord.parser_version} -> v${currentVersion}`);
      return true;
    }
    
    // Failed files with newer parser available
    if (fileRecord.status === 'failed' || fileRecord.status === 'error') {
      // Retry failed files once per day max
      const lastRetry = fileRecord.last_retry ? new Date(fileRecord.last_retry) : new Date(0);
      const hoursSinceRetry = (Date.now() - lastRetry.getTime()) / (1000 * 60 * 60);
      if (hoursSinceRetry > this.retryIntervalHours) {
        return true;
      }
    }
    
    return false;
  }

  /**
   * Check all indexed files for parser upgrades and queue them for re-indexing
   */
  async checkForParserUpgrades(): Promise<ReindexResult> {
    const result: ReindexResult = {
      filesToReindex: [],
      upgradeSummary: {}
    };

    if (!this.fileStatusRepo) {
      this.logger.log('File status repository not available, skipping parser upgrade check');
      return result;
    }

    this.logger.log('Checking for parser upgrades...');
    const startTime = Date.now();

    try {
      // OPTIMIZED: Only fetch indexed files with minimal columns (60-70% memory reduction)
      const indexedFiles = await this.fileStatusRepo.query()
        .filter('status = "indexed"')
        .select(['path', 'parser_version'])
        .toArray();

      this.logger.log(`Loaded ${indexedFiles.length} indexed files in ${Date.now() - startTime}ms`);

      // Group files by extension for efficient processing
      const filesByExt = new Map<string, FileStatus[]>();
      for (const file of indexedFiles) {
        const ext = path.extname(file.path).slice(1).toLowerCase();
        if (!filesByExt.has(ext)) {
          filesByExt.set(ext, []);
        }
        filesByExt.get(ext)!.push(file);
      }

      this.logger.log(`Files grouped by extension: ${Array.from(filesByExt.keys()).join(', ')}`);

      // Check each extension for outdated files
      for (const [ext, currentVersion] of Object.entries(PARSER_VERSIONS)) {
        const filesForExt = filesByExt.get(ext) || [];

        if (filesForExt.length === 0) {
          continue; // No files of this type
        }

        // Find outdated files (filtered in-memory, but dataset is already minimal)
        const outdatedFiles = filesForExt.filter((f: FileStatus) =>
          !f.parser_version || f.parser_version < currentVersion
        );
        
        if (outdatedFiles.length > 0) {
          result.upgradeSummary[ext] = outdatedFiles.length;
          
          // Queue for re-indexing with high priority
          for (const file of outdatedFiles) {
            // Update status to show it needs update
            try {
              await this.fileStatusRepo.delete(`path = "${file.path}"`);
              // Build complete record - file only has path & parser_version due to .select()
              await this.fileStatusRepo.add([{
                path: file.path,
                status: 'outdated',
                parser_version: file.parser_version || 0,
                chunk_count: 0,  // Will be updated after re-indexing
                error_message: `Parser upgraded to v${currentVersion}`,
                last_modified: '',
                indexed_at: '',
                file_hash: '',
                last_retry: ''
              }]);
            } catch (e) {
              this.logger.error(`Failed to update status for ${file.path}:`, e);
            }

            // Add to reindex list
            result.filesToReindex.push(file.path);
          }
        }
      }
      
      // Also check for failed .doc files if we're now at version 2
      if (getParserVersion('doc') === 2) {
        // OPTIMIZED: Fetch only failed/error files for .doc extension
        const failedFiles = await this.fileStatusRepo.query()
          .filter('status = "failed" OR status = "error"')
          .select(['path', 'parser_version', 'status'])
          .toArray();

        const failedDocs = failedFiles.filter((f: FileStatus) => {
          const fileExt = path.extname(f.path).slice(1).toLowerCase();
          return fileExt === 'doc' && (!f.parser_version || f.parser_version < 2);
        });
        
        if (failedDocs.length > 0) {
          this.logger.log(`Found ${failedDocs.length} failed .doc files to retry with new parser`);
          result.upgradeSummary['doc_retries'] = failedDocs.length;
          
          for (const file of failedDocs) {
            // Update status and queue for retry
            try {
              await this.fileStatusRepo.delete(`path = "${file.path}"`);
              // Build complete record - file only has path, parser_version, status due to .select()
              await this.fileStatusRepo.add([{
                path: file.path,
                status: 'queued',
                parser_version: file.parser_version || 0,
                chunk_count: 0,  // Will be updated after re-indexing
                error_message: 'Retrying with improved .doc parser',
                last_modified: '',
                indexed_at: '',
                file_hash: '',
                last_retry: ''
              }]);
            } catch (e) {
              this.logger.error(`Failed to update status for ${file.path}:`, e);
            }
            
            result.filesToReindex.push(file.path);
          }
        }
      }
      
      const totalTime = Date.now() - startTime;

      if (Object.keys(result.upgradeSummary).length > 0) {
        this.logger.log(`🎯 Parser upgrades detected in ${totalTime}ms:`);
        this.logger.log(JSON.stringify(result.upgradeSummary, null, 2));
      } else {
        this.logger.log(`✅ All files are using the latest parser versions (checked ${indexedFiles.length} files in ${totalTime}ms)`);
      }
    } catch (error) {
      this.logger.error('Error checking for parser upgrades:', error);
    }

    return result;
  }

  /**
   * Migrate existing files to include parser versions
   */
  async migrateExistingFiles(): Promise<number> {
    if (!this.fileStatusRepo) {
      return 0;
    }

    this.logger.log('Migrating existing files to include parser versions...');
    const startTime = Date.now();

    try {
      // OPTIMIZED: Fetch all files but with minimal columns
      // Note: We need to fetch all files (not just indexed) for migration
      // But we minimize I/O by selecting only needed fields
      const allFiles = await this.fileStatusRepo.query()
        .select(['path', 'status', 'parser_version'])
        .toArray();

      this.logger.log(`Loaded ${allFiles.length} files for migration check in ${Date.now() - startTime}ms`);
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
          await this.fileStatusRepo.delete(`path = "${file.path}"`);
          // Build complete record - file only has path, status, parser_version due to .select()
          await this.fileStatusRepo.add([{
            path: file.path,
            status: file.status,
            parser_version: initialVersion,
            chunk_count: 0,  // Will be updated if file is re-indexed
            error_message: '',
            last_modified: '',
            indexed_at: '',
            file_hash: '',
            last_retry: file.status === 'failed' ? new Date().toISOString() : ''
          }]);
          migratedCount++;
        } catch (e) {
          this.logger.error(`Failed to migrate ${file.path}:`, e);
        }
      }
      
      const totalTime = Date.now() - startTime;

      if (migratedCount > 0) {
        this.logger.log(`✅ Migrated ${migratedCount} files to include parser versions in ${totalTime}ms`);
      } else {
        this.logger.log(`✅ No migration needed - all ${allFiles.length} files already have parser versions (checked in ${totalTime}ms)`);
      }

      return migratedCount;
    } catch (error) {
      this.logger.error('Error migrating existing files:', error);
      return 0;
    }
  }
}

/**
 * Standalone helper function for shouldReindex logic
 * Creates a temporary service instance for backwards compatibility
 */
export function shouldReindex(filePath: string, fileRecord?: FileStatus): boolean {
  const service = new ReindexService(undefined, { log: () => {}, error: () => {} });
  return service.shouldReindex(filePath, fileRecord);
}