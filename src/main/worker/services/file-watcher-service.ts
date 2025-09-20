/**
 * FileWatcherService - Manages file system watching and scanning
 *
 * This service handles all file watching operations using Chokidar,
 * including initial scanning and change detection.
 */

import * as chokidar from 'chokidar';
import * as fs from 'node:fs';
import * as path from 'node:path';
import type { IFileWatcherService } from '../types/interfaces';
import type { FileStatus } from '../fileStatusManager';
import { logger } from '../../../shared/utils/logger';
// File path utilities
function shouldSkipPath(filePath: string, excludePatterns: string[]): boolean {
  // Check if path should be excluded based on patterns
  const normalizedPath = filePath.replace(/\\/g, '/');

  for (const pattern of excludePatterns) {
    // Simple pattern matching (could be enhanced with minimatch)
    if (pattern.includes('**')) {
      const regex = pattern
        .replace(/\*\*/g, '.*')
        .replace(/\*/g, '[^/]*')
        .replace(/\?/g, '.');
      if (new RegExp(regex).test(normalizedPath)) {
        return true;
      }
    } else if (normalizedPath.includes(pattern)) {
      return true;
    }
  }

  return false;
}

export class FileWatcherService implements IFileWatcherService {
  private watcher: chokidar.FSWatcher | null = null;
  private watcherReady = false;
  private eventHandlers = new Map<string, Set<(path: string) => void>>();

  constructor() {
    // Initialize event handler maps
    this.eventHandlers.set('add', new Set());
    this.eventHandlers.set('change', new Set());
    this.eventHandlers.set('unlink', new Set());
  }

  async start(
    roots: string[],
    excludePatterns: string[] = [],
    _fileStatusCache?: Map<string, FileStatus>
  ): Promise<void> {
    logger.log('WATCHER', 'Starting file watcher...');
    const startTime = Date.now();

    // Stop existing watcher if any
    await this.stop();

    // Filter out non-existent roots
    const validRoots = roots.filter(root => {
      const exists = fs.existsSync(root);
      if (!exists) {
        logger.warn('WATCHER', `Root does not exist: ${root}`);
      }
      return exists;
    });

    if (validRoots.length === 0) {
      logger.warn('WATCHER', 'No valid roots to watch');
      return;
    }

    this.watcher = chokidar.watch(validRoots, {
      ignoreInitial: true,
      persistent: true,
      ignorePermissionErrors: true,
      awaitWriteFinish: {
        stabilityThreshold: 2000,
        pollInterval: 100
      },
      ignored: (filePath: string) => {
        return shouldSkipPath(filePath, excludePatterns);
      }
    });

    // Set up event handlers
    this.watcher.on('add', (filePath: string) => {
      this.emit('add', filePath);
    });

    this.watcher.on('change', (filePath: string) => {
      this.emit('change', filePath);
    });

    this.watcher.on('unlink', (filePath: string) => {
      this.emit('unlink', filePath);
    });

    this.watcher.on('ready', () => {
      this.watcherReady = true;
      const elapsed = Date.now() - startTime;
      logger.log('WATCHER', `File watcher ready in ${elapsed}ms`);
    });

    this.watcher.on('error', (error) => {
      logger.error('WATCHER', 'Watcher error:', error);
    });
  }

  async stop(): Promise<void> {
    if (this.watcher) {
      await this.watcher.close();
      this.watcher = null;
      this.watcherReady = false;
      logger.log('WATCHER', 'File watcher stopped');
    }
  }

  async scanForChanges(): Promise<{
    newFiles: string[];
    modifiedFiles: string[];
    skippedFiles: string[]
  }> {
    logger.log('WATCHER', 'Scanning for file changes...');
    const startTime = Date.now();

    const newFiles: string[] = [];
    const modifiedFiles: string[] = [];
    const skippedFiles: string[] = [];

    // This would need access to the file status cache and scanner
    // For now, return empty results - the actual implementation
    // will be coordinated by the WorkerCore

    const elapsed = Date.now() - startTime;
    logger.log('WATCHER', `Scan completed in ${elapsed}ms`);
    logger.log('WATCHER', `Found: ${newFiles.length} new, ${modifiedFiles.length} modified, ${skippedFiles.length} skipped`);

    return { newFiles, modifiedFiles, skippedFiles };
  }

  on(event: 'add' | 'change' | 'unlink', handler: (path: string) => void): void {
    const handlers = this.eventHandlers.get(event);
    if (handlers) {
      handlers.add(handler);
    }
  }

  off(event: 'add' | 'change' | 'unlink', handler: (path: string) => void): void {
    const handlers = this.eventHandlers.get(event);
    if (handlers) {
      handlers.delete(handler);
    }
  }

  private emit(event: string, filePath: string): void {
    const handlers = this.eventHandlers.get(event);
    if (handlers) {
      handlers.forEach(handler => handler(filePath));
    }
  }

  isReady(): boolean {
    return this.watcherReady;
  }

  getWatchedPaths(): string[] {
    if (!this.watcher) {
      return [];
    }
    const watched = this.watcher.getWatched();
    const paths: string[] = [];
    for (const [dir, files] of Object.entries(watched)) {
      paths.push(dir);
      files.forEach(file => {
        paths.push(path.join(dir, file));
      });
    }
    return paths;
  }
}