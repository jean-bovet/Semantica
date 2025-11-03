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
        score: r._distance !== undefined ? Math.max(0, 1 - (r._distance / 2)) : 1,
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
 * @param fileHashes - Map of file paths to hashes
 * @param folderStats - Map of folder paths to their statistics
 * @returns Database statistics object
 */
export async function getStats(
  tbl: any,
  fileHashes: Map<string, string>,
  folderStats: Map<string, FolderStats>
): Promise<DatabaseStats> {
  try {
    const count = await tbl.countRows();
    return {
      totalChunks: count,
      indexedFiles: fileHashes.size,
      folderStats: Array.from(folderStats.entries()).map(([folder, stats]) => ({
        folder,
        totalFiles: stats.total,
        indexedFiles: stats.indexed
      }))
    };
  } catch (_error) {
    return {
      totalChunks: 0,
      indexedFiles: 0,
      folderStats: []
    };
  }
}
