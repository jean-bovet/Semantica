/**
 * Worker lifecycle states
 */
export enum WorkerState {
  UNINITIALIZED = 'uninitialized',
  STARTING_SIDECAR = 'starting_sidecar',
  SIDECAR_READY = 'sidecar_ready',
  INITIALIZING_DB = 'initializing_db',
  DB_READY = 'db_ready',
  LOADING_FILES = 'loading_files',
  SCANNING_FOLDERS = 'scanning_folders',
  READY = 'ready',
  ERROR = 'error'
}

/**
 * Valid state transitions
 */
export const VALID_TRANSITIONS: Record<WorkerState, WorkerState[]> = {
  [WorkerState.UNINITIALIZED]: [WorkerState.STARTING_SIDECAR],
  [WorkerState.STARTING_SIDECAR]: [WorkerState.SIDECAR_READY, WorkerState.ERROR],
  [WorkerState.SIDECAR_READY]: [WorkerState.INITIALIZING_DB, WorkerState.ERROR],
  [WorkerState.INITIALIZING_DB]: [WorkerState.DB_READY, WorkerState.ERROR],
  [WorkerState.DB_READY]: [WorkerState.LOADING_FILES, WorkerState.ERROR],
  [WorkerState.LOADING_FILES]: [WorkerState.SCANNING_FOLDERS, WorkerState.ERROR],
  [WorkerState.SCANNING_FOLDERS]: [WorkerState.READY, WorkerState.ERROR],
  [WorkerState.READY]: [WorkerState.ERROR],
  [WorkerState.ERROR]: []
};

/**
 * Check if a state transition is valid
 */
export function isValidTransition(from: WorkerState, to: WorkerState): boolean {
  return VALID_TRANSITIONS[from]?.includes(to) ?? false;
}

/**
 * Message types that can be handled before worker is fully ready
 */
export const ALLOWED_BEFORE_READY = new Set([
  'init',
  'checkModel',
  'diagnostics:getLogs'
]);

/**
 * Check if a message can be handled in the current state
 */
export function canHandleMessage(state: WorkerState, messageType: string): boolean {
  if (state === WorkerState.READY) {
    return true;
  }
  return ALLOWED_BEFORE_READY.has(messageType);
}
