import * as path from 'node:path';
import type { FileTracker } from '../core/embedding/EmbeddingQueue';

export interface FileQueueStats {
  queued: number;
  processing: number;
  completed: number;
  failed: number;
}

export interface EmbeddingQueueStats {
  queueDepth: number;
  processingBatches: number;
  isProcessing: boolean;
  trackedFiles: number;
  backpressureActive: boolean;
}

export interface EmbedderStats {
  id: string;
  filesProcessed: number;
  memoryUsage: number;
  isHealthy: boolean;
  loadCount: number;
  restartCount: number;
}

export interface PipelineData {
  fileStats: FileQueueStats;
  embeddingStats: EmbeddingQueueStats;
  embedderStats: EmbedderStats[];
  processingFiles: string[];
  fileTrackers: Map<string, FileTracker>;
  maxConcurrent: number;
  optimalConcurrent: number;
}

/**
 * Formats pipeline status information in a table format
 */
export class PipelineStatusFormatter {

  /**
   * Format complete pipeline status as a table
   */
  static formatPipelineStatus(data: PipelineData): string {
    const lines: string[] = [];

    // Add a newline first to prevent logger indentation
    lines.push('');

    // Build the table
    lines.push(this.formatTableHeader());
    lines.push(this.formatTableSeparator());

    // Add rows for each slot - always show optimal number of slots
    const slotsToShow = data.optimalConcurrent || data.maxConcurrent;
    for (let i = 0; i < slotsToShow; i++) {
      lines.push(this.formatSlotRow(i, data));
    }

    lines.push(this.formatTableFooter());
    lines.push(this.formatPipelineStats(data));

    return lines.join('\n');
  }

  /**
   * Format the table header
   */
  private static formatTableHeader(): string {
    return '┌─────────────────────────┬────────────┬────────────┬─────────┬──────────┬─────────────────────────────────────────────┐';
  }

  /**
   * Format the column headers
   */
  private static formatTableSeparator(): string {
    return '│ File Slot               │ Status     │ Progress   │ Chunks  │ Embedder │ File Path                                   │\n' +
           '├─────────────────────────┼────────────┼────────────┼─────────┼──────────┼─────────────────────────────────────────────┤';
  }

  /**
   * Format a single slot row
   */
  private static formatSlotRow(slotIndex: number, data: PipelineData): string {
    const { processingFiles, fileTrackers, maxConcurrent } = data;

    // Check if this slot is disabled due to throttling
    if (slotIndex >= maxConcurrent) {
      return this.formatDisabledRow(slotIndex);
    }

    // Check if this slot has an active file
    if (slotIndex < processingFiles.length) {
      const filePath = processingFiles[slotIndex];
      const tracker = fileTrackers.get(filePath);

      if (tracker && tracker.totalChunks > 0) {
        // File is being embedded
        return this.formatEmbeddingRow(slotIndex, filePath, tracker, data);
      } else {
        // File is being parsed
        return this.formatParsingRow(slotIndex, filePath);
      }
    } else {
      // Slot is idle - show queued info for the first idle slot if there are queued files
      const remainingQueued = data.fileStats.queued - processingFiles.length;
      if (slotIndex === processingFiles.length && remainingQueued > 0) {
        return this.formatQueuedRow(slotIndex, remainingQueued);
      } else {
        return this.formatEmptyRow(slotIndex);
      }
    }
  }

  /**
   * Format a row for a file being embedded
   */
  private static formatEmbeddingRow(slotIndex: number, filePath: string, tracker: FileTracker, data: PipelineData): string {
    const progress = Math.round((tracker.processedChunks / tracker.totalChunks) * 100);
    const progressBar = this.createProgressBar(progress, 20);
    // Always show as EMBEDDING - completed files should be removed from processingFiles
    const status = 'EMBEDDING';
    const embedder = this.findEmbedderForFile(filePath, data);
    const fileName = this.formatFileName(filePath, 45);
    const chunksStr = `${tracker.processedChunks}/${tracker.totalChunks}`;

    return `│ [${slotIndex}] ${progressBar}│ ${this.padRight(status, 10)} │ ${this.padLeft(progress + '%', 10)} │ ${this.padRight(chunksStr, 7)} │ ${this.padCenter(embedder, 8)} │ ${this.padRight(fileName, 45)}│`;
  }

  /**
   * Format a row for a file being parsed
   */
  private static formatParsingRow(slotIndex: number, filePath: string): string {
    const progressBar = this.createProgressBar(0, 20);
    const fileName = this.formatFileName(filePath, 45);

    return `│ [${slotIndex}] ${progressBar}│ PARSING    │ 0%         │ -       │ -        │ ${this.padRight(fileName, 45)}│`;
  }

  /**
   * Format a row showing queued files
   */
  private static formatQueuedRow(slotIndex: number, queueCount: number): string {
    const progressBar = '░░░░░░░░░░░░░░░░░░░░';
    const queueMsg = `(${queueCount.toLocaleString()} files waiting)`;

    return `│ [${slotIndex}] ${progressBar}│ QUEUED     │ -          │ -       │ -        │ ${this.padRight(queueMsg, 45)}│`;
  }

  /**
   * Format an empty row
   */
  private static formatEmptyRow(slotIndex: number): string {
    const progressBar = '░░░░░░░░░░░░░░░░░░░░';

    return `│ [${slotIndex}] ${progressBar}│ QUEUED     │ -          │ -       │ -        │ ${this.padRight('', 45)}│`;
  }

  /**
   * Format an empty active row (shouldn't happen)
   */
  private static formatEmptyActiveRow(slotIndex: number): string {
    const progressBar = '░░░░░░░░░░░░░░░░░░░░';

    return `│ [${slotIndex}] ${progressBar}│ ACTIVE     │ -          │ -       │ -        │ ${this.padRight('(processing)', 45)}│`;
  }

  /**
   * Format a disabled row (slot unavailable due to throttling)
   */
  private static formatDisabledRow(slotIndex: number): string {
    const progressBar = '××××××××××××××××××××';

    return `│ [${slotIndex}] ${progressBar}│ THROTTLED  │ -          │ -       │ -        │ ${this.padRight('(memory limit)', 45)}│`;
  }

  /**
   * Format the table footer
   */
  private static formatTableFooter(): string {
    return '└─────────────────────────┴────────────┴────────────┴─────────┴──────────┴─────────────────────────────────────────────┘';
  }

  /**
   * Format the pipeline statistics line
   */
  private static formatPipelineStats(data: PipelineData): string {
    const { fileStats, embeddingStats, embedderStats } = data;

    const parts: string[] = [];

    // Total files
    parts.push(`Pipeline: ${fileStats.queued.toLocaleString()} total`);

    // Processing status
    if (fileStats.processing > 0) {
      parts.push(`${fileStats.processing}/${data.maxConcurrent} active`);
    }

    // Completed files
    if (fileStats.completed > 0) {
      parts.push(`${fileStats.completed} done`);
    }

    // Failed files
    if (fileStats.failed > 0) {
      parts.push(`${fileStats.failed} failed`);
    }

    // Chunks
    const totalEmbedded = this.calculateTotalEmbedded(data.fileTrackers);
    parts.push(`${embeddingStats.queueDepth} chunks queued`);
    if (totalEmbedded > 0) {
      parts.push(`${totalEmbedded} embedded`);
    }

    // Embedders
    if (embedderStats.length > 0) {
      const totalMemoryMB = embedderStats.reduce((sum, stat) => sum + Math.round(stat.memoryUsage / (1024 * 1024)), 0);
      parts.push(`${embedderStats.length} embedders @ ${totalMemoryMB}MB`);
    }

    // Backpressure
    if (embeddingStats.backpressureActive) {
      parts.push('Backpressure: ON');
    }

    // Memory usage (if we can get it from process)
    const memUsage = process.memoryUsage();
    const rssMB = Math.round(memUsage.rss / (1024 * 1024));
    parts.push(`Memory: ${rssMB}/1500MB`);

    return parts.join(' │ ');
  }

  /**
   * Create a visual progress bar
   */
  private static createProgressBar(percentage: number, width: number): string {
    // Ensure percentage is within valid bounds
    const safePercentage = Math.max(0, Math.min(100, percentage || 0));

    const filled = Math.floor((safePercentage / 100) * width);
    const empty = Math.max(0, width - filled); // Ensure non-negative

    if (safePercentage >= 100) {
      return '█'.repeat(width);
    } else if (safePercentage <= 0) {
      return '░'.repeat(width);
    } else {
      return '█'.repeat(filled) + '░'.repeat(empty);
    }
  }

  /**
   * Find which embedder is processing a file
   */
  private static findEmbedderForFile(filePath: string, data: PipelineData): string {
    // This is a heuristic - in reality we'd need to track which embedder has which file
    // For now, distribute files round-robin style
    const processingIndex = data.processingFiles.indexOf(filePath);
    if (processingIndex >= 0 && data.embedderStats.length > 0) {
      const embedderIndex = processingIndex % data.embedderStats.length;
      return `E${embedderIndex}`;
    }
    return '-';
  }

  /**
   * Format a file name to fit in the column
   */
  private static formatFileName(filePath: string, maxWidth: number): string {
    const fileName = path.basename(filePath);

    if (fileName.length <= maxWidth) {
      return fileName;
    }

    // Truncate with ellipsis
    const extension = path.extname(fileName);
    const nameWithoutExt = path.basename(fileName, extension);
    const maxNameLength = maxWidth - extension.length - 3; // 3 for '...'

    if (maxNameLength > 0) {
      return nameWithoutExt.substring(0, maxNameLength) + '...' + extension;
    }

    return fileName.substring(0, maxWidth - 3) + '...';
  }

  /**
   * Calculate total embedded chunks
   */
  private static calculateTotalEmbedded(fileTrackers: Map<string, FileTracker>): number {
    let total = 0;
    for (const tracker of fileTrackers.values()) {
      if (tracker.processedChunks === tracker.totalChunks && tracker.totalChunks > 0) {
        total += tracker.processedChunks;
      }
    }
    return total;
  }

  /**
   * Pad string to the right
   */
  private static padRight(str: string, width: number): string {
    return str.padEnd(width, ' ');
  }

  /**
   * Pad string to the left
   */
  private static padLeft(str: string, width: number): string {
    return str.padStart(width, ' ');
  }

  /**
   * Center string in width
   */
  private static padCenter(str: string, width: number): string {
    const padding = Math.max(0, width - str.length);
    const leftPad = Math.floor(padding / 2);
    const rightPad = padding - leftPad;
    return ' '.repeat(leftPad) + str + ' '.repeat(rightPad);
  }
}