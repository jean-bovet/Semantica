export interface ProgressState {
  queued: number;
  processing: number;
  done: number;
  errors: number;
  paused: boolean;
  initialized?: boolean;
}

/**
 * Get the appropriate status text based on the current progress state
 */
export function getStatusText(progress: ProgressState): string {
  if (!progress.initialized) {
    return '⏳ Initializing...';
  }
  
  if (progress.paused) {
    return '⏸ Paused';
  }
  
  const remaining = progress.queued + progress.processing;
  if (remaining > 0) {
    return `⚡ Indexing (${remaining} remaining)`;
  }
  
  return '✓ Ready';
}

/**
 * Determine if the indexer is actively processing files
 */
export function isIndexerActive(progress: ProgressState): boolean {
  return progress.queued > 0 || progress.processing > 0;
}

/**
 * Ensure the initialized flag has a boolean value
 */
export function normalizeProgress(progress: ProgressState): ProgressState & { initialized: boolean } {
  return {
    ...progress,
    initialized: progress.initialized ?? false
  };
}