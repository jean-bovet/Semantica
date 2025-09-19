import * as path from 'node:path';
import type { FileTracker } from './EmbeddingQueue';

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
  index: number;
  filesProcessed: number;
  memoryUsage: number;
  needsRestart: boolean;
}

export interface PipelineData {
  fileStats: FileQueueStats;
  embeddingStats: EmbeddingQueueStats;
  embedderStats: EmbedderStats[];
  processingFiles: string[];
  fileTrackers: Map<string, FileTracker>;
  maxConcurrent: number;
}

/**
 * Formats pipeline status information for enhanced queue logging visualization
 */
export class PipelineStatusFormatter {

  /**
   * Format complete pipeline status as multi-line output
   */
  static formatPipelineStatus(data: PipelineData): string {
    const lines = [
      '[ELEC] [PIPELINE STATUS] 📊'
    ];

    // Add file processing status line
    lines.push(this.formatFileStatus(data));

    // Add chunk processing status line
    lines.push(this.formatChunkStatus(data));

    // Add embedder status line (if embedders exist)
    if (data.embedderStats.length > 0) {
      lines.push(this.formatEmbedderStatus(data));
    }

    // Add processing files line (if any files are being processed)
    if (data.processingFiles.length > 0) {
      lines.push(this.formatProcessingFiles(data));
    }

    return lines.join('\n');
  }

  /**
   * Format file pipeline: queued → processing → completed status
   */
  private static formatFileStatus(data: PipelineData): string {
    const { fileStats, maxConcurrent } = data;

    let status = `  Files: ${fileStats.queued} queued → ${fileStats.processing}/${maxConcurrent} parsing`;

    if (fileStats.completed > 0) {
      status += ` → ${fileStats.completed} completed ✅`;
    }

    if (fileStats.failed > 0) {
      status += ` ${fileStats.failed} failed ❌`;
    }

    return status;
  }

  /**
   * Format chunk/embedding pipeline status
   */
  private static formatChunkStatus(data: PipelineData): string {
    const { embeddingStats } = data;

    let status = `  Chunks: ${embeddingStats.queueDepth} queued`;

    if (embeddingStats.backpressureActive) {
      status += ' ⚠️';
    }

    status += ` → ${embeddingStats.processingBatches} batches processing`;

    // Calculate total embedded chunks from all completed files
    let totalEmbedded = 0;
    for (const tracker of data.fileTrackers.values()) {
      totalEmbedded += tracker.processedChunks;
    }

    if (totalEmbedded > 0) {
      status += ` → ${totalEmbedded.toLocaleString()} embedded`;
    }

    return status;
  }

  /**
   * Format embedder utilization status
   */
  private static formatEmbedderStatus(data: PipelineData): string {
    const { embedderStats, fileTrackers } = data;

    const embedderParts: string[] = [];

    for (const embedder of embedderStats) {
      // Find which file this embedder might be working on (heuristic)
      const workingFile = this.guessEmbedderWorkingFile(embedder, fileTrackers);

      if (workingFile) {
        const tracker = fileTrackers.get(workingFile);
        const progress = tracker ? `[${tracker.processedChunks}/${tracker.totalChunks}]` : '';
        const shortName = this.shortenFileName(workingFile);
        embedderParts.push(`E${embedder.index}:${shortName}${progress}`);
      } else {
        embedderParts.push(`E${embedder.index}:idle`);
      }
    }

    // Add memory usage summary
    const totalMemoryMB = embedderStats.reduce((sum, stat) => sum + Math.round(stat.memoryUsage / (1024 * 1024)), 0);
    const memoryInfo = `(${totalMemoryMB}MB)`;

    return `  Embedders: ${embedderParts.join(' ')} ${memoryInfo}`;
  }

  /**
   * Format currently processing files with chunk progress
   */
  private static formatProcessingFiles(data: PipelineData): string {
    const { processingFiles, fileTrackers } = data;

    const fileParts: string[] = [];
    const maxFiles = 3; // Limit display to 3 files to keep output manageable

    for (let i = 0; i < Math.min(processingFiles.length, maxFiles); i++) {
      const filePath = processingFiles[i];
      const tracker = fileTrackers.get(filePath);
      const shortName = this.shortenFileName(filePath);

      if (tracker && tracker.totalChunks > 0) {
        const progress = `[${tracker.processedChunks}/${tracker.totalChunks}]`;
        fileParts.push(`${shortName}${progress}`);
      } else {
        fileParts.push(`${shortName}[parsing...]`);
      }
    }

    let result = `  Processing: ${fileParts.join(', ')}`;

    if (processingFiles.length > maxFiles) {
      result += `... (+${processingFiles.length - maxFiles} more)`;
    }

    return result;
  }

  /**
   * Heuristic to guess which file an embedder might be working on
   * Based on round-robin pattern and recent activity
   */
  private static guessEmbedderWorkingFile(_embedder: EmbedderStats, fileTrackers: Map<string, FileTracker>): string | null {
    // Simple heuristic: return the file with the most recent activity
    // that has chunks being processed
    let mostRecentFile: string | null = null;
    let mostRecentTime = 0;

    for (const [filePath, tracker] of fileTrackers.entries()) {
      if (tracker.processedChunks < tracker.totalChunks && tracker.processedChunks > 0) {
        if (tracker.startTime > mostRecentTime) {
          mostRecentTime = tracker.startTime;
          mostRecentFile = filePath;
        }
      }
    }

    return mostRecentFile;
  }

  /**
   * Shorten file names for display while keeping them recognizable
   */
  private static shortenFileName(filePath: string): string {
    const fileName = path.basename(filePath);
    const name = path.parse(fileName).name;

    // If name is short enough, return as-is
    if (name.length <= 12) {
      return name;
    }

    // For longer names, keep first 8 chars + last 4 chars
    return `${name.substring(0, 8)}…${name.substring(name.length - 3)}`;
  }

}