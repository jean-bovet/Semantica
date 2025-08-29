/**
 * ReindexOrchestrator - Pure business logic for re-indexing operations
 * 
 * This class contains the core logic for determining which files need to be
 * re-indexed, without any I/O operations or side effects.
 */

export interface FileStatus {
  path: string;
  status: 'indexed' | 'failed' | 'error' | 'queued' | 'outdated';
  parser_version?: number;
  chunk_count?: number;
  error_message?: string;
  last_modified?: string;
  indexed_at?: string;
  file_hash?: string;
  last_retry?: string;
}

export interface FileInfo {
  path: string;
  hash?: string;
  mtime?: Date;
  size?: number;
}

export interface ReindexStats {
  totalFiles: number;
  newFiles: number;
  modifiedFiles: number;
  failedFiles: number;
  skippedFiles: number;
  outdatedFiles: number;
}

export interface ReindexPlan {
  filesToIndex: string[];
  filesToRemove: string[];
  stats: ReindexStats;
  reasons: Map<string, string>;
}

export interface ReindexOptions {
  force?: boolean;
  includeFailedFiles?: boolean;
  retryIntervalHours?: number;
}

export type IndexReason = 
  | 'force-reindex'
  | 'new-file'
  | 'modified'
  | 'parser-upgraded'
  | 'retry-failed'
  | 'outdated'
  | 'no-status';

export class ReindexOrchestrator {
  /**
   * Determines which files should be re-indexed based on their current status
   * and the provided options.
   */
  determineFilesToReindex(
    allFiles: string[],
    fileStatusCache: Map<string, FileStatus>,
    forceReindex: boolean
  ): {
    toIndex: string[];
    reasons: Map<string, IndexReason>;
  } {
    const toIndex: string[] = [];
    const reasons = new Map<string, IndexReason>();

    for (const filePath of allFiles) {
      if (forceReindex) {
        toIndex.push(filePath);
        reasons.set(filePath, 'force-reindex');
        continue;
      }

      const fileRecord = fileStatusCache.get(filePath);
      
      if (!fileRecord) {
        // New file - not in database
        toIndex.push(filePath);
        reasons.set(filePath, 'new-file');
      } else if (fileRecord.status === 'outdated') {
        // File marked as outdated (e.g., parser upgraded)
        toIndex.push(filePath);
        reasons.set(filePath, 'outdated');
      } else if (fileRecord.status === 'failed' || fileRecord.status === 'error') {
        // Failed files can be retried
        if (this.shouldRetryFailedFile(fileRecord)) {
          toIndex.push(filePath);
          reasons.set(filePath, 'retry-failed');
        }
      }
      // Note: Modified file detection requires file system access,
      // so it's handled in the FileScanner class
    }

    return { toIndex, reasons };
  }

  /**
   * Calculates statistics for a re-indexing operation
   */
  calculateReindexStats(
    files: string[],
    cache: Map<string, FileStatus>,
    reasons: Map<string, IndexReason>
  ): ReindexStats {
    const stats: ReindexStats = {
      totalFiles: files.length,
      newFiles: 0,
      modifiedFiles: 0,
      failedFiles: 0,
      skippedFiles: 0,
      outdatedFiles: 0
    };

    for (const file of files) {
      const reason = reasons.get(file);
      const status = cache.get(file);

      if (reason === 'new-file' || !status) {
        stats.newFiles++;
      } else if (reason === 'modified') {
        stats.modifiedFiles++;
      } else if (reason === 'outdated' || reason === 'parser-upgraded') {
        stats.outdatedFiles++;
      } else if (reason === 'retry-failed') {
        stats.failedFiles++;
      } else if (!reason) {
        stats.skippedFiles++;
      }
    }

    return stats;
  }

  /**
   * Creates a complete plan for re-indexing operations
   */
  planReindex(
    watchedFolders: string[],
    allFiles: string[],
    fileStatusCache: Map<string, FileStatus>,
    options: ReindexOptions = {}
  ): ReindexPlan {
    const { toIndex, reasons } = this.determineFilesToReindex(
      allFiles,
      fileStatusCache,
      options.force || false
    );

    // Find files that are in the cache but not in the file list (deleted files)
    const filesToRemove: string[] = [];
    for (const [path, status] of fileStatusCache.entries()) {
      // Check if file is in a watched folder
      const inWatchedFolder = watchedFolders.some(folder => path.startsWith(folder));
      if (inWatchedFolder && !allFiles.includes(path)) {
        filesToRemove.push(path);
      }
    }

    const stats = this.calculateReindexStats(allFiles, fileStatusCache, reasons);

    return {
      filesToIndex: toIndex,
      filesToRemove,
      stats,
      reasons
    };
  }

  /**
   * Determines if a failed file should be retried based on the last retry time
   */
  private shouldRetryFailedFile(
    fileRecord: FileStatus,
    retryIntervalHours: number = 24
  ): boolean {
    if (!fileRecord.last_retry) {
      return true; // Never retried
    }

    const lastRetry = new Date(fileRecord.last_retry);
    const hoursSinceRetry = (Date.now() - lastRetry.getTime()) / (1000 * 60 * 60);
    
    return hoursSinceRetry > retryIntervalHours;
  }

  /**
   * Groups files by their index reason for reporting
   */
  groupFilesByReason(
    reasons: Map<string, IndexReason>
  ): Map<IndexReason, string[]> {
    const grouped = new Map<IndexReason, string[]>();

    for (const [path, reason] of reasons.entries()) {
      if (!grouped.has(reason)) {
        grouped.set(reason, []);
      }
      grouped.get(reason)!.push(path);
    }

    return grouped;
  }

  /**
   * Validates that a reindex plan is safe to execute
   */
  validatePlan(plan: ReindexPlan): {
    valid: boolean;
    warnings: string[];
    errors: string[];
  } {
    const warnings: string[] = [];
    const errors: string[] = [];

    // Check for potentially large operations
    if (plan.filesToIndex.length > 10000) {
      warnings.push(`Large reindex operation: ${plan.filesToIndex.length} files`);
    }

    // Check for high number of deletions
    if (plan.filesToRemove.length > 100) {
      warnings.push(`Many files to remove: ${plan.filesToRemove.length} files`);
    }

    // Check for duplicate files in the plan
    const uniqueFiles = new Set(plan.filesToIndex);
    if (uniqueFiles.size !== plan.filesToIndex.length) {
      errors.push('Duplicate files detected in reindex plan');
    }

    // Validate stats consistency
    const expectedTotal = plan.stats.newFiles + plan.stats.modifiedFiles + 
                         plan.stats.failedFiles + plan.stats.skippedFiles + 
                         plan.stats.outdatedFiles;
    if (expectedTotal !== plan.stats.totalFiles) {
      warnings.push('Stats totals do not match total file count');
    }

    return {
      valid: errors.length === 0,
      warnings,
      errors
    };
  }
}