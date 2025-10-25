/**
 * Type-safe IPC protocol for worker startup sequence
 */

export type StartupStage =
  | 'checking'      // Checking Ollama installation/health
  | 'downloading'   // Downloading model
  | 'initializing'  // Initializing embedder
  | 'ready'         // Ready to process files
  | 'error';        // Error occurred

export type ErrorCode =
  | 'OLLAMA_NOT_FOUND'       // Ollama not installed
  | 'OLLAMA_START_FAILED'    // Failed to start Ollama server
  | 'MODEL_DOWNLOAD_FAILED'  // Failed to download model
  | 'EMBEDDER_INIT_FAILED'   // Failed to initialize embedder
  | 'STARTUP_TIMEOUT';       // Startup exceeded timeout

export interface StartupStageMessage {
  channel: 'startup:stage';
  stage: StartupStage;
  message?: string;
  progress?: number; // 0-100 for downloading stage
}

export interface StartupErrorMessage {
  channel: 'startup:error';
  code: ErrorCode;
  message: string;
  details?: any;
}

export interface StartupRetryMessage {
  channel: 'startup:retry';
}

export interface DiagnosticsLogsRequest {
  channel: 'diagnostics:getLogs';
}

export interface DiagnosticsLogsResponse {
  channel: 'diagnostics:logs';
  logs: Array<{
    timestamp: number;
    category: string;
    message: string;
  }>;
}

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
  | DiagnosticsLogsResponse
  | DownloadProgressMessage;

/**
 * All messages that can be sent from main to worker
 */
export type MainToWorkerMessage =
  | StartupRetryMessage
  | DiagnosticsLogsRequest;
