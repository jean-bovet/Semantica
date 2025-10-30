/**
 * Shared types for startup sequence
 *
 * This is the SINGLE SOURCE OF TRUTH for all startup-related types.
 * All other files must import from here to ensure type consistency.
 */

/**
 * Startup stages in execution order
 *
 * These stages represent the complete application initialization sequence:
 * 1. worker_spawn - Worker thread starts
 * 2. sidecar_start - Start Python sidecar server (checks deps first)
 * 3. downloading - Download embedding model (first run only)
 * 4. sidecar_ready - Wait for sidecar to load model
 * 5. embedder_init - Initialize embedder
 * 6. db_init - Database initialization
 * 7. db_load - Load existing indexed files
 * 8. folder_scan - Scan watched folders for changes
 * 9. ready - Application ready to use
 */
export type StartupStage =
  | 'worker_spawn'
  | 'db_init'
  | 'db_load'
  | 'folder_scan'
  | 'sidecar_start'
  | 'downloading'      // Model download (first run only)
  | 'sidecar_ready'
  | 'embedder_init'
  | 'ready'
  | 'error';

/**
 * Ordered list of startup stages (excluding 'error')
 * Used for progress calculation and UI display
 */
export const STARTUP_STAGE_ORDER: readonly StartupStage[] = [
  'worker_spawn',
  'sidecar_start',
  'downloading',
  'sidecar_ready',
  'embedder_init',
  'db_init',
  'db_load',
  'folder_scan',
  'ready',
] as const;

/**
 * Error codes for startup failures
 */
export type StartupErrorCode =
  | 'PYTHON_NOT_FOUND'       // Python interpreter not found in PATH
  | 'PYTHON_DEPS_MISSING'    // Required Python dependencies not installed
  | 'PYTHON_VERSION_INCOMPATIBLE' // Python version incompatible (requires 3.9+)
  | 'SIDECAR_START_FAILED'   // Failed to start Python sidecar
  | 'SIDECAR_NOT_HEALTHY'    // Python sidecar not healthy
  | 'OLLAMA_NOT_FOUND'       // Ollama not installed (legacy)
  | 'OLLAMA_START_FAILED'    // Failed to start Ollama server (legacy)
  | 'MODEL_DOWNLOAD_FAILED'  // Failed to download model
  | 'EMBEDDER_INIT_FAILED'   // Failed to initialize embedder
  | 'STARTUP_TIMEOUT';       // Startup exceeded timeout

/**
 * Message sent when startup stage changes
 */
export interface StartupStageMessage {
  channel: 'startup:stage';
  stage: StartupStage;
  message?: string;
  progress?: number; // 0-100 for stages with measurable progress
}

/**
 * Message sent when startup error occurs
 */
export interface StartupErrorMessage {
  channel: 'startup:error';
  code: StartupErrorCode;
  message: string;
  details?: unknown;
}

/**
 * Message sent to retry startup after error
 */
export interface StartupRetryMessage {
  channel: 'startup:retry';
}

/**
 * Message sent during model download with progress
 */
export interface DownloadProgressMessage {
  channel: 'model:download:progress';
  file: string;
  progress: number;  // 0-100
  loaded: number;    // bytes
  total: number;     // bytes
}

/**
 * All messages that can be sent from worker to main
 */
export type WorkerToMainMessage =
  | StartupStageMessage
  | StartupErrorMessage
  | DownloadProgressMessage;

/**
 * All messages that can be sent from main to worker
 */
export type MainToWorkerMessage =
  | StartupRetryMessage;

/**
 * Type-safe helper to create startup stage message
 *
 * @example
 * const msg = createStageMessage('checking', 'Checking Ollama...', 0);
 * parentPort.postMessage(msg);
 */
export function createStageMessage(
  stage: StartupStage,
  message?: string,
  progress?: number
): StartupStageMessage {
  return {
    channel: 'startup:stage',
    stage,
    message,
    progress,
  };
}

/**
 * Type-safe helper to create error message
 *
 * @example
 * const msg = createErrorMessage('OLLAMA_NOT_FOUND', 'Ollama is not installed');
 * parentPort.postMessage(msg);
 */
export function createErrorMessage(
  code: StartupErrorCode,
  message: string,
  details?: unknown
): StartupErrorMessage {
  return {
    channel: 'startup:error',
    code,
    message,
    details,
  };
}

/**
 * Type-safe helper to create download progress message
 */
export function createDownloadProgressMessage(
  file: string,
  progress: number,
  loaded: number,
  total: number
): DownloadProgressMessage {
  return {
    channel: 'model:download:progress',
    file,
    progress,
    loaded,
    total,
  };
}

/**
 * Check if a stage is a valid startup stage
 */
export function isValidStage(stage: string): stage is StartupStage {
  return (STARTUP_STAGE_ORDER as readonly string[]).includes(stage) || stage === 'error';
}

/**
 * Get the index of a stage in the startup sequence
 * Returns -1 for 'error' or unknown stages
 */
export function getStageIndex(stage: StartupStage): number {
  if (stage === 'error') return -1;
  return STARTUP_STAGE_ORDER.indexOf(stage);
}

/**
 * Validate that a message has the correct startup:stage format
 */
export function isStartupStageMessage(msg: unknown): msg is StartupStageMessage {
  if (typeof msg !== 'object' || msg === null) return false;
  const m = msg as Record<string, unknown>;
  return (
    m.channel === 'startup:stage' &&
    typeof m.stage === 'string' &&
    isValidStage(m.stage)
  );
}

/**
 * Validate that a message has the correct startup:error format
 */
export function isStartupErrorMessage(msg: unknown): msg is StartupErrorMessage {
  if (typeof msg !== 'object' || msg === null) return false;
  const m = msg as Record<string, unknown>;
  return (
    m.channel === 'startup:error' &&
    typeof m.code === 'string' &&
    typeof m.message === 'string'
  );
}
