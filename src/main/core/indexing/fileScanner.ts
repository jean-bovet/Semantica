/**
 * FileScanner - Pure business logic for file scanning and categorization
 * 
 * This class contains the core logic for determining which files should be
 * indexed and categorizing them based on their status, without any I/O operations.
 */

export interface FileStats {
  mtime: Date;
  size: number;
  hash?: string;
}

export interface FileInfo {
  path: string;
  stats?: FileStats;
}

export interface ScanConfig {
  skipBundles: boolean;
  bundlePatterns: string[];
  supportedExtensions: string[];
  maxFileSize?: number;
}

export interface CategorizeOptions {
  checkModified: boolean;
  checkParserVersion: boolean;
  currentParserVersion?: number;
  retryFailed: boolean;
  retryIntervalHours?: number;
}

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

export type IndexReason = 
  | 'new-file'
  | 'modified'
  | 'parser-upgraded'
  | 'retry-failed'
  | 'force-reindex'
  | 'outdated';

export interface CategorizedFiles {
  new: string[];
  modified: string[];
  failed: string[];
  skipped: string[];
  outdated: string[];
}

export class FileScanner {
  /**
   * Determines if a file should be indexed based on its current status
   * and configuration options.
   */
  shouldIndexFile(
    _filePath: string,
    fileRecord: FileStatus | null,
    forceReindex: boolean,
    fileStats?: FileStats,
    options?: CategorizeOptions
  ): { shouldIndex: boolean; reason?: IndexReason } {
    // Force reindex overrides all other checks
    if (forceReindex) {
      return { shouldIndex: true, reason: 'force-reindex' };
    }

    // New file - not in database
    if (!fileRecord) {
      return { shouldIndex: true, reason: 'new-file' };
    }

    // File marked as outdated (e.g., parser upgraded)
    if (fileRecord.status === 'outdated') {
      return { shouldIndex: true, reason: 'outdated' };
    }

    // Check parser version if option is enabled
    if (options?.checkParserVersion && options.currentParserVersion) {
      if (!fileRecord.parser_version || 
          fileRecord.parser_version < options.currentParserVersion) {
        return { shouldIndex: true, reason: 'parser-upgraded' };
      }
    }

    // Check if file has been modified
    if (options?.checkModified && fileStats) {
      if (this.isFileModified(fileRecord, fileStats)) {
        return { shouldIndex: true, reason: 'modified' };
      }
    }

    // Check if failed file should be retried
    if (options?.retryFailed && 
        (fileRecord.status === 'failed' || fileRecord.status === 'error')) {
      if (this.shouldRetryFailedFile(fileRecord, options.retryIntervalHours)) {
        return { shouldIndex: true, reason: 'retry-failed' };
      }
    }

    // File is up to date, skip it
    return { shouldIndex: false };
  }

  /**
   * Categorizes files based on their status and configuration
   */
  categorizeFiles(
    files: FileInfo[],
    statusCache: Map<string, FileStatus>,
    options: CategorizeOptions
  ): CategorizedFiles {
    const categorized: CategorizedFiles = {
      new: [],
      modified: [],
      failed: [],
      skipped: [],
      outdated: []
    };

    for (const file of files) {
      const fileRecord = statusCache.get(file.path) || null;
      const { shouldIndex, reason } = this.shouldIndexFile(
        file.path,
        fileRecord,
        false,
        file.stats,
        options
      );

      if (!shouldIndex) {
        categorized.skipped.push(file.path);
        continue;
      }

      switch (reason) {
        case 'new-file':
          categorized.new.push(file.path);
          break;
        case 'modified':
          categorized.modified.push(file.path);
          break;
        case 'retry-failed':
          categorized.failed.push(file.path);
          break;
        case 'outdated':
        case 'parser-upgraded':
          categorized.outdated.push(file.path);
          break;
      }
    }

    return categorized;
  }

  /**
   * Filters files by supported extensions and bundle status
   */
  filterSupportedFiles(
    paths: string[],
    config: ScanConfig
  ): string[] {
    return paths.filter(path => {
      // Check if file is in a bundle (if bundle exclusion is enabled)
      if (config.skipBundles && this.isInsideBundle(path, config.bundlePatterns)) {
        return false;
      }

      // Check if file has a supported extension
      if (!this.hasSupportedExtension(path, config.supportedExtensions)) {
        return false;
      }

      return true;
    });
  }

  /**
   * Checks if a file has been modified since it was last indexed
   */
  private isFileModified(
    fileRecord: FileStatus,
    fileStats: FileStats
  ): boolean {
    // Check by hash if available
    if (fileStats.hash && fileRecord.file_hash) {
      return fileStats.hash !== fileRecord.file_hash;
    }

    // Fall back to modification time
    if (fileRecord.last_modified) {
      const lastModified = new Date(fileRecord.last_modified);
      return fileStats.mtime > lastModified;
    }

    // If we don't have comparison data, assume modified
    return true;
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
   * Checks if a file is inside a macOS bundle
   */
  private isInsideBundle(
    filePath: string,
    bundlePatterns: string[]
  ): boolean {
    // Extract bundle extensions from patterns
    const bundleExtensions = bundlePatterns
      .map(pattern => {
        const match = pattern.match(/\*\.([^/]+)/);
        return match ? `.${match[1]}` : null;
      })
      .filter(Boolean) as string[];
    
    // Check if any path component ends with a bundle extension
    const pathComponents = filePath.split('/');
    for (const component of pathComponents) {
      for (const ext of bundleExtensions) {
        if (component.endsWith(ext)) {
          return true;
        }
      }
    }
    
    return false;
  }

  /**
   * Checks if a file has a supported extension
   */
  private hasSupportedExtension(
    filePath: string,
    supportedExtensions: string[]
  ): boolean {
    if (supportedExtensions.length === 0) {
      return true; // No filter, all files supported
    }

    const fileExt = this.getFileExtension(filePath).toLowerCase();
    return supportedExtensions.some(ext => 
      ext.toLowerCase() === fileExt || 
      ext.toLowerCase() === `.${fileExt}`
    );
  }

  /**
   * Extracts the file extension from a path
   */
  private getFileExtension(filePath: string): string {
    const lastDot = filePath.lastIndexOf('.');
    const lastSlash = filePath.lastIndexOf('/');
    
    // No extension if dot comes before last slash or is the last character
    if (lastDot <= lastSlash || lastDot === filePath.length - 1) {
      return '';
    }
    
    return filePath.substring(lastDot + 1);
  }

  /**
   * Groups files by their parent directory for batch processing
   */
  groupFilesByDirectory(
    files: string[]
  ): Map<string, string[]> {
    const grouped = new Map<string, string[]>();
    
    for (const file of files) {
      const dir = this.getDirectory(file);
      if (!grouped.has(dir)) {
        grouped.set(dir, []);
      }
      grouped.get(dir)!.push(file);
    }
    
    return grouped;
  }

  /**
   * Gets the directory path from a file path
   */
  private getDirectory(filePath: string): string {
    const lastSlash = filePath.lastIndexOf('/');
    return lastSlash > 0 ? filePath.substring(0, lastSlash) : '/';
  }

  /**
   * Validates that a file path is safe to process
   */
  isValidPath(filePath: string, watchedFolders: string[]): boolean {
    // Check if path is absolute
    if (!filePath.startsWith('/')) {
      return false;
    }

    // Check if path is in a watched folder
    const inWatchedFolder = watchedFolders.some(folder => 
      filePath.startsWith(folder)
    );
    
    if (!inWatchedFolder) {
      return false;
    }

    // Check for dangerous path components
    const dangerousPatterns = ['../', '/./', '//'];
    for (const pattern of dangerousPatterns) {
      if (filePath.includes(pattern)) {
        return false;
      }
    }

    return true;
  }

  /**
   * Calculates statistics for a file scanning operation
   */
  calculateScanStats(
    categorized: CategorizedFiles
  ): {
    total: number;
    new: number;
    modified: number;
    failed: number;
    skipped: number;
    outdated: number;
    toProcess: number;
  } {
    const total = 
      categorized.new.length +
      categorized.modified.length +
      categorized.failed.length +
      categorized.skipped.length +
      categorized.outdated.length;

    const toProcess = 
      categorized.new.length +
      categorized.modified.length +
      categorized.failed.length +
      categorized.outdated.length;

    return {
      total,
      new: categorized.new.length,
      modified: categorized.modified.length,
      failed: categorized.failed.length,
      skipped: categorized.skipped.length,
      outdated: categorized.outdated.length,
      toProcess
    };
  }
}