import { logger } from '../../../shared/utils/logger';

/**
 * Write queue state for managing concurrent database writes
 */
export interface WriteQueueState {
  isWriting: boolean;
  writeQueue: Array<() => Promise<void>>;
}

/**
 * Create a new write queue state object
 */
export function createWriteQueueState(): WriteQueueState {
  return {
    isWriting: false,
    writeQueue: []
  };
}

/**
 * Merge rows into the database table using the mergeInsert operation.
 * Queues the write to avoid concurrent write conflicts.
 *
 * @param tbl - LanceDB table instance
 * @param rows - Array of rows to merge
 * @param state - Write queue state object
 */
export async function mergeRows(tbl: any, rows: any[], state: WriteQueueState): Promise<void> {
  if (rows.length === 0) return;

  // Queue the write operation to avoid concurrent writes
  return new Promise<void>((resolve, reject) => {
    const writeOp = async () => {
      try {
        await tbl.mergeInsert('id')
          .whenMatchedUpdateAll()
          .whenNotMatchedInsertAll()
          .execute(rows);
        resolve();
      } catch (error) {
        logger.error('DATABASE', 'Failed to merge rows:', error);
        // Retry once on conflict
        if ((error as any)?.message?.includes('Commit conflict')) {
          try {
            await new Promise(r => setTimeout(r, 100));
            await tbl.mergeInsert('id')
              .whenMatchedUpdateAll()
              .whenNotMatchedInsertAll()
              .execute(rows);
            resolve();
          } catch (retryError) {
            logger.error('DATABASE', 'Retry failed:', retryError);
            reject(retryError);
          }
        } else {
          reject(error);
        }
      }
    };

    state.writeQueue.push(writeOp);
    processWriteQueue(state);
  });
}

/**
 * Process queued write operations sequentially
 *
 * @param state - Write queue state object
 */
export async function processWriteQueue(state: WriteQueueState): Promise<void> {
  if (state.isWriting || state.writeQueue.length === 0) return;

  state.isWriting = true;
  while (state.writeQueue.length > 0) {
    const writeOp = state.writeQueue.shift()!;
    await writeOp();
  }
  state.isWriting = false;
}

/**
 * Delete all chunks for a given file path from the database
 *
 * @param tbl - LanceDB table instance
 * @param filePath - Path to the file whose chunks should be deleted
 */
export async function deleteByPath(tbl: any, filePath: string): Promise<void> {
  try {
    if (!filePath || !tbl) {
      return;
    }

    const escaped = filePath.replace(/"/g, '\\"');
    const query = `path = "${escaped}"`;
    await tbl.delete(query);
  } catch (error) {
    logger.error('DATABASE', 'Failed to delete by path:', filePath, error);
  }
}

/**
 * Create or update an index on the vector column when the table gets large
 *
 * @param tbl - LanceDB table instance
 */
export async function maybeCreateIndex(tbl: any): Promise<void> {
  try {
    const count = await tbl.countRows();
    if (count > 50000) {
      await tbl.createIndex('vector').catch(() => {});
    }
  } catch (error) {
    logger.error('DATABASE', 'Failed to create index:', error);
  }
}
