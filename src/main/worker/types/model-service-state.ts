/**
 * State management for ModelService
 */

/**
 * Possible states for the ModelService
 */
export enum ModelServiceState {
  Uninitialized = 'uninitialized',
  Checking = 'checking',
  ModelMissing = 'model_missing',
  InitializingPool = 'initializing_pool',
  Ready = 'ready',
  Error = 'error'
}

/**
 * Valid state transitions for the ModelService
 */
export const MODEL_SERVICE_STATE_TRANSITIONS: Record<ModelServiceState, ModelServiceState[]> = {
  [ModelServiceState.Uninitialized]: [ModelServiceState.Checking],
  [ModelServiceState.Checking]: [ModelServiceState.ModelMissing, ModelServiceState.InitializingPool, ModelServiceState.Error],
  [ModelServiceState.ModelMissing]: [ModelServiceState.Checking, ModelServiceState.InitializingPool, ModelServiceState.Error],
  [ModelServiceState.InitializingPool]: [ModelServiceState.Ready, ModelServiceState.Error],
  [ModelServiceState.Ready]: [ModelServiceState.Error, ModelServiceState.InitializingPool], // Allow re-init for pool restart
  [ModelServiceState.Error]: [ModelServiceState.Checking] // Allow recovery
};

/**
 * Context information for model service state transitions
 */
export interface ModelServiceStateContext {
  reason?: string;
  error?: Error;
  modelPath?: string;
  timestamp: number;
}