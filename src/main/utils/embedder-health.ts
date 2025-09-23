/**
 * Utility functions for embedder health management
 */

/**
 * Determines if an embedder should be restarted based on memory and file count thresholds
 *
 * @param filesProcessed - Number of files processed by the embedder
 * @param memoryUsageBytes - Memory usage in bytes
 * @param maxFiles - Maximum files before restart (default: 200)
 * @param maxMemoryMB - Maximum memory in MB before restart (default: 1500)
 * @returns true if the embedder should be restarted
 */
export function shouldRestartEmbedder(
  filesProcessed: number,
  memoryUsageBytes: number,
  maxFiles: number = 200,
  maxMemoryMB: number = 1500
): boolean {
  // Convert bytes to MB for comparison
  const memoryMB = Math.round(memoryUsageBytes / (1024 * 1024));

  // Only restart if we've actually processed some files (avoid restart loop at startup)
  return filesProcessed > 0 && (
    filesProcessed > maxFiles ||
    memoryMB > maxMemoryMB
  );
}

/**
 * Converts bytes to megabytes
 *
 * @param bytes - Memory in bytes
 * @returns Memory in MB (rounded)
 */
export function bytesToMB(bytes: number): number {
  return Math.round(bytes / (1024 * 1024));
}