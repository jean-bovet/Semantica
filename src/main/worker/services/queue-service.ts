/**
 * QueueService - Manages the file indexing queue
 *
 * This service handles queuing files for indexing, processing them
 * in batches, and tracking statistics.
 */

import type { IQueueService } from '../types/interfaces';
import { logger } from '../../../shared/utils/logger';

interface QueuedFile {
  path: string;
  addedAt: number;
  attempts: number;
}

export class QueueService implements IQueueService {
  private queue: QueuedFile[] = [];
  private processing = new Set<string>();
  private done = new Set<string>();
  private errors = new Map<string, string>();
  private paused = false;
  private eventHandlers = new Map<string, Set<(...args: any[]) => void>>();
  private processCallback: ((file: string) => Promise<void>) | null = null;

  constructor() {
    // Initialize event handler maps
    this.eventHandlers.set('processed', new Set());
    this.eventHandlers.set('error', new Set());
    this.eventHandlers.set('empty', new Set());
  }

  setProcessCallback(callback: (file: string) => Promise<void>): void {
    this.processCallback = callback;
  }

  add(files: string[]): void {
    const added: string[] = [];
    const skipped: string[] = [];

    for (const file of files) {
      // Skip if already processing or done
      if (this.processing.has(file) || this.done.has(file)) {
        skipped.push(file);
        continue;
      }

      // Skip if already in queue
      if (this.queue.some(q => q.path === file)) {
        skipped.push(file);
        continue;
      }

      this.queue.push({
        path: file,
        addedAt: Date.now(),
        attempts: 0
      });
      added.push(file);
    }

    if (added.length > 0) {
      logger.log('QUEUE', `Added ${added.length} files to queue (${skipped.length} skipped)`);
    }
  }

  async process(): Promise<void> {
    if (this.paused) {
      return;
    }

    // Process up to 5 files concurrently
    const maxConcurrent = 5;
    const promises: Promise<void>[] = [];

    while (this.queue.length > 0 && this.processing.size < maxConcurrent && !this.paused) {
      const item = this.queue.shift();
      if (!item) break;

      // Skip if already processing
      if (this.processing.has(item.path)) {
        continue;
      }

      this.processing.add(item.path);
      item.attempts++;

      const promise = this.processFile(item).finally(() => {
        this.processing.delete(item.path);
      });

      promises.push(promise);
    }

    // Wait for all current processing to complete
    if (promises.length > 0) {
      await Promise.all(promises);
    }

    // Check if queue is empty
    if (this.queue.length === 0 && this.processing.size === 0) {
      this.emit('empty');
    }
  }

  private async processFile(item: QueuedFile): Promise<void> {
    if (!this.processCallback) {
      logger.error('QUEUE', 'No process callback set');
      return;
    }

    try {
      await this.processCallback(item.path);
      this.done.add(item.path);
      this.emit('processed', item.path);
      logger.log('QUEUE', `Processed: ${item.path}`);
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      this.errors.set(item.path, errorMsg);
      this.emit('error', item.path, errorMsg);
      logger.error('QUEUE', `Failed to process ${item.path}:`, errorMsg);

      // Retry logic (up to 3 attempts)
      if (item.attempts < 3) {
        // Re-add to queue for retry
        setTimeout(() => {
          this.queue.push(item);
          logger.log('QUEUE', `Retrying ${item.path} (attempt ${item.attempts + 1})`);
        }, 5000); // Wait 5 seconds before retry
      }
    }
  }

  pause(): void {
    this.paused = true;
    logger.log('QUEUE', 'Queue paused');
  }

  resume(): void {
    this.paused = false;
    logger.log('QUEUE', 'Queue resumed');
    // Start processing again
    this.process().catch(err => {
      logger.error('QUEUE', 'Error resuming queue:', err);
    });
  }

  clear(): void {
    this.queue = [];
    this.processing.clear();
    this.done.clear();
    this.errors.clear();
    logger.log('QUEUE', 'Queue cleared');
  }

  isProcessing(file: string): boolean {
    return this.processing.has(file) || this.queue.some(q => q.path === file);
  }

  getStats(): {
    queued: number;
    processing: number;
    done: number;
    errors: number;
  } {
    return {
      queued: this.queue.length,
      processing: this.processing.size,
      done: this.done.size,
      errors: this.errors.size
    };
  }

  on(event: 'processed' | 'error' | 'empty', handler: (...args: any[]) => void): void {
    const handlers = this.eventHandlers.get(event);
    if (handlers) {
      handlers.add(handler);
    }
  }

  off(event: 'processed' | 'error' | 'empty', handler: (...args: any[]) => void): void {
    const handlers = this.eventHandlers.get(event);
    if (handlers) {
      handlers.delete(handler);
    }
  }

  private emit(event: string, ...args: any[]): void {
    const handlers = this.eventHandlers.get(event);
    if (handlers) {
      handlers.forEach(handler => handler(...args));
    }
  }

  // Helper methods for queue management
  getQueuedFiles(): string[] {
    return this.queue.map(q => q.path);
  }

  getProcessingFiles(): string[] {
    return Array.from(this.processing);
  }

  getErrorFiles(): Map<string, string> {
    return new Map(this.errors);
  }

  removeFromQueue(file: string): boolean {
    const index = this.queue.findIndex(q => q.path === file);
    if (index >= 0) {
      this.queue.splice(index, 1);
      logger.log('QUEUE', `Removed ${file} from queue`);
      return true;
    }
    return false;
  }

  isPaused(): boolean {
    return this.paused;
  }
}