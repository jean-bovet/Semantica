import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { mergeRows, type WriteQueueState } from '../database/operations';

// Re-export WriteQueueState for external consumers
export type { WriteQueueState };

/**
 * Pure function that processes a batch of embedded chunks into database rows.
 *
 * IMPORTANT: Each chunk in a batch can be from a DIFFERENT file, so we must use
 * each chunk's OWN metadata.filePath, not assume all chunks are from the same file.
 *
 * This is a pure function for testability - it doesn't have side effects.
 *
 * @param batch - Batch containing chunks and their corresponding vectors
 * @param fileStatsProvider - Function to get file stats (mtime) for a given path
 * @returns Array of database rows ready to be inserted
 */
export async function processBatchToRows(
  batch: { chunks: any[], vectors: number[][] },
  fileStatsProvider: (filePath: string) => Promise<{ mtime: number }>
): Promise<any[]> {
  // Cache file stats to avoid redundant stat calls for chunks from the same file
  const fileStatsCache = new Map<string, { mtime: number }>();

  // Create database rows - each chunk uses its OWN file path
  const rows = await Promise.all(batch.chunks.map(async (chunk: any, idx: number) => {
    // Use THIS chunk's file path, not the first chunk's path
    const chunkFilePath = chunk.metadata.filePath;
    const fileExt = path.extname(chunkFilePath).slice(1).toLowerCase();

    // Get or cache file stats for this file
    let fileStats = fileStatsCache.get(chunkFilePath);
    if (!fileStats) {
      fileStats = await fileStatsProvider(chunkFilePath);
      fileStatsCache.set(chunkFilePath, fileStats);
    }

    // Generate unique ID using THIS chunk's file path
    const id = crypto.createHash('sha1')
      .update(`${chunkFilePath}:${chunk.metadata.page || 0}:${chunk.metadata.offset}`)
      .digest('hex');

    return {
      id,
      path: chunkFilePath, // Each chunk gets its OWN file path
      mtime: fileStats.mtime,
      page: chunk.metadata.page || 0,
      offset: chunk.metadata.offset,
      text: chunk.text,
      vector: batch.vectors[idx],
      type: fileExt,
      title: path.basename(chunkFilePath)
    };
  }));

  return rows;
}

/**
 * Creates the batch processor callback for the embedding queue.
 * This wraps the pure processBatchToRows function with database write logic.
 *
 * @param tbl - LanceDB table instance
 * @param writeQueueState - Write queue state for managing concurrent writes
 * @returns Batch processor function
 */
export function createBatchProcessor(tbl: any, writeQueueState: WriteQueueState) {
  return async (batch: any) => {
    // File stats provider that reads from filesystem
    const fileStatsProvider = async (filePath: string) => {
      const stat = await fs.promises.stat(filePath);
      return { mtime: stat.mtimeMs };
    };

    // Process batch to rows using pure function
    const rows = await processBatchToRows(batch, fileStatsProvider);

    // Write to database
    await mergeRows(tbl, rows, writeQueueState);
  };
}
