/**
 * StepperLogic - Pure functions for startup stepper UI
 *
 * This module contains testable pure functions for managing the multi-step
 * startup progress indicator. All functions are side-effect free and easily testable.
 */

import {
  type StartupStage,
  STARTUP_STAGE_ORDER,
  getStageIndex as getSharedStageIndex
} from '../../shared/types/startup';

export type { StartupStage };
export type StepStatus = 'completed' | 'active' | 'pending' | 'error';

export interface StepDefinition {
  id: string;
  label: string;
  stage: StartupStage;
}

/**
 * Ordered list of startup steps
 * Note: 'downloading' stage may be skipped if model is already downloaded
 */
export const STARTUP_STEPS: StepDefinition[] = [
  { id: 'worker_spawn', label: 'Starting Worker', stage: 'worker_spawn' },
  { id: 'db_init', label: 'Initializing Database', stage: 'db_init' },
  { id: 'db_load', label: 'Loading Files', stage: 'db_load' },
  { id: 'folder_scan', label: 'Scanning Folders', stage: 'folder_scan' },
  { id: 'sidecar_start', label: 'Starting Python Sidecar', stage: 'sidecar_start' },
  { id: 'downloading', label: 'Downloading Model', stage: 'downloading' },
  { id: 'sidecar_ready', label: 'Loading Model', stage: 'sidecar_ready' },
  { id: 'embedder_init', label: 'Initializing Embedder', stage: 'embedder_init' },
  { id: 'ready', label: 'Ready', stage: 'ready' },
];

/**
 * Get the index of a stage in the startup sequence
 * Uses shared implementation for consistency
 */
export function getStageIndex(stage: StartupStage): number {
  return getSharedStageIndex(stage);
}

/**
 * Determine the status of a step based on the current stage
 *
 * @param currentStage - The current startup stage
 * @param stepIndex - The index of the step to check (0-based)
 * @param hasError - Whether an error has occurred
 * @returns The status of the step
 */
export function getStepStatus(
  currentStage: StartupStage,
  stepIndex: number,
  hasError: boolean = false
): StepStatus {
  if (hasError) {
    const currentIndex = getStageIndex(currentStage);
    if (stepIndex === currentIndex) return 'error';
    if (stepIndex < currentIndex) return 'completed';
    return 'pending';
  }

  const currentIndex = getStageIndex(currentStage);

  if (currentIndex === -1) {
    // Error state with no specific stage
    return 'pending';
  }

  if (stepIndex < currentIndex) {
    return 'completed';
  } else if (stepIndex === currentIndex) {
    return currentStage === 'ready' ? 'completed' : 'active';
  } else {
    return 'pending';
  }
}

/**
 * Check if any step in the sequence has completed
 */
export function hasAnyCompletedSteps(currentStage: StartupStage, hasError: boolean): boolean {
  const currentIndex = getStageIndex(currentStage);
  return !hasError && currentIndex > 0;
}

/**
 * Check if all steps are completed
 */
export function allStepsCompleted(currentStage: StartupStage): boolean {
  return currentStage === 'ready';
}

/**
 * Get a human-readable status message for a stage
 */
export function getStageMessage(stage: StartupStage, customMessage?: string): string {
  if (customMessage) return customMessage;

  switch (stage) {
    case 'worker_spawn':
      return 'Starting worker process...';
    case 'db_init':
      return 'Initializing database...';
    case 'db_load':
      return 'Loading indexed files...';
    case 'folder_scan':
      return 'Scanning folders...';
    case 'sidecar_start':
      return 'Starting Python sidecar server...';
    case 'downloading':
      return 'Downloading embedding model...';
    case 'sidecar_ready':
      return 'Loading embedding model...';
    case 'embedder_init':
      return 'Initializing embedder...';
    case 'ready':
      return 'Ready to index files';
    case 'error':
      return 'Initialization failed';
    default:
      return 'Initializing...';
  }
}
