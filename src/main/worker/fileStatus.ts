import fs from 'node:fs';

/**
 * Update the file status record in the file_status table.
 * This tracks whether a file was successfully indexed, failed, or encountered errors.
 *
 * @param fileStatusTable - LanceDB file status table instance
 * @param filePath - Path to the file
 * @param status - Status: 'indexed', 'failed', 'error', 'deleted'
 * @param fileHashes - Map of file paths to their hashes
 * @param error - Optional error message
 * @param chunkCount - Optional number of chunks created
 * @param parserVersion - Optional parser version used
 */
export async function updateFileStatus(
  fileStatusTable: any | null,
  filePath: string,
  status: string,
  fileHashes: Map<string, string>,
  error?: string,
  chunkCount?: number,
  parserVersion?: number
): Promise<void> {
  if (!fileStatusTable) return; // Skip if table not available

  try {
    let stats: any = { mtime: new Date() };
    try {
      stats = await fs.promises.stat(filePath);
    } catch (_e) {
      // File might not exist (e.g., deleted status)
    }

    const record = {
      path: filePath,
      status: status,
      error_message: error || '',
      chunk_count: chunkCount || 0,
      last_modified: stats.mtime.toISOString(),
      indexed_at: new Date().toISOString(),
      file_hash: fileHashes.get(filePath) || '',
      parser_version: parserVersion || 0,
      last_retry: status === 'failed' || status === 'error' ? new Date().toISOString() : null
    };

    // Try to delete existing record (ignore errors)
    try {
      await fileStatusTable.delete(`path = "${filePath}"`);
    } catch (_e) {
      // Ignore delete errors
    }

    // Insert new record
    await fileStatusTable.add([record]);
  } catch (e: any) {
    // Log error but don't disable the table - it might be a temporary issue
    console.debug('Error updating file status (non-critical):', e?.message || e);
  }
}
