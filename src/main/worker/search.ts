import { logger } from '../../shared/utils/logger';
import type { PythonSidecarEmbedder } from './embeddings/PythonSidecarEmbedder';

/**
 * Folder statistics interface
 */
export interface FolderStats {
  total: number;
  indexed: number;
}

/**
 * Search result interface
 */
export interface SearchResult {
  id: string;
  path: string;
  page: number;
  offset: number;
  text: string;
  score: number;
  title: string;
}

/**
 * Database statistics interface
 */
export interface DatabaseStats {
  totalChunks: number;
  indexedFiles: number;
  folderStats: Array<{
    folder: string;
    totalFiles: number;
    indexedFiles: number;
  }>;
}

/**
 * Perform semantic search on the vector database
 *
 * @param tbl - LanceDB table instance
 * @param sidecarEmbedder - Embedder for query vectorization
 * @param query - Search query string
 * @param k - Number of results to return (default: 10)
 * @returns Array of search results
 */
export async function search(
  tbl: any,
  sidecarEmbedder: PythonSidecarEmbedder,
  query: string,
  k: number = 10
): Promise<SearchResult[]> {
  try {
    // Use sidecar embedder for query embedding
    const vectors = await sidecarEmbedder.embed([query]);
    const qvec = vectors[0];
    const results = await tbl.search(qvec)
      .limit(k)
      .toArray();

    const mappedResults = results.map((r: any) => {
      return {
        id: r.id,
        path: r.path,
        page: r.page || 0,
        offset: r.offset || 0,
        text: r.text || '',
        // For cosine metric: _distance is cosine distance (1 - cosine_similarity)
        // Convert to similarity: similarity = 1 - distance
        score: r._distance !== undefined ? Math.max(0, 1 - r._distance) : 1,
        title: r.title || ''
      };
    });

    return mappedResults;
  } catch (error) {
    logger.error('DATABASE', 'Search failed:', error);
    return [];
  }
}

/**
 * Get database statistics including chunk count and folder-level stats
 *
 * @param tbl - LanceDB table instance
 * @param fileHashes - Map of file paths to hashes (fallback if fileStatusTable unavailable)
 * @param folderStats - Map of folder paths to their statistics (fallback if fileStatusTable unavailable)
 * @param fileStatusTable - Optional file status table for fast stats lookup
 * @returns Database statistics object
 */
export async function getStats(
  tbl: any,
  fileHashes: Map<string, string>,
  folderStats: Map<string, FolderStats>,
  fileStatusTable?: any | null
): Promise<DatabaseStats> {
  try {
    const count = await tbl.countRows();

    // Fast path: Use file status table if available
    if (fileStatusTable) {
      try {
        // Query all indexed files from file status table
        // Fixed: Use correct LanceDB filter syntax with quotes around string value
        const indexedRecords = await fileStatusTable.query()
          .filter(`status = "indexed"`)
          .toArray();

        // Calculate folder stats from indexed files
        const watchedFolders = Array.from(folderStats.keys());

        // Handle empty folderStats gracefully (StatusBar may load before startWatching)
        if (watchedFolders.length === 0) {
          return {
            totalChunks: count,
            indexedFiles: indexedRecords.length,
            folderStats: []
          };
        }

        const folderCounts = new Map<string, { total: number; indexed: number }>();

        // Initialize counts for all watched folders
        for (const folder of watchedFolders) {
          folderCounts.set(folder, {
            total: folderStats.get(folder)?.total || 0,
            indexed: 0
          });
        }

        // Count indexed files per folder
        for (const record of indexedRecords) {
          for (const folder of watchedFolders) {
            if (record.path.startsWith(folder)) {
              const stats = folderCounts.get(folder)!;
              stats.indexed++;
              break; // File belongs to only one folder
            }
          }
        }
        return {
          totalChunks: count,
          indexedFiles: indexedRecords.length,
          folderStats: Array.from(folderCounts.entries()).map(([folder, stats]) => ({
            folder,
            totalFiles: stats.total,
            indexedFiles: stats.indexed
          }))
        };
      } catch (e) {
        // Log the error for debugging before falling back
        logger.warn('DATABASE', 'Fast path failed, falling back to slow path:', e);
      }
    }

    // Slow path: Use fileHashes and folderStats (original implementation)
    return {
      totalChunks: count,
      indexedFiles: fileHashes.size,
      folderStats: Array.from(folderStats.entries()).map(([folder, stats]) => ({
        folder,
        totalFiles: stats.total,
        indexedFiles: stats.indexed
      }))
    };
  } catch (error) {
    logger.error('DATABASE', 'Failed to get stats:', error);
    return {
      totalChunks: 0,
      indexedFiles: 0,
      folderStats: []
    };
  }
}
