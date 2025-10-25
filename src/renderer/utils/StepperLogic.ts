/**
 * StepperLogic - Pure functions for startup stepper UI
 *
 * This module contains testable pure functions for managing the multi-step
 * startup progress indicator. All functions are side-effect free and easily testable.
 */

export type StartupStage = 'checking' | 'downloading' | 'initializing' | 'ready' | 'error';
export type StepStatus = 'completed' | 'active' | 'pending' | 'error';

export interface StepDefinition {
  id: string;
  label: string;
  stage: StartupStage;
}

/**
 * Ordered list of startup steps
 */
export const STARTUP_STEPS: StepDefinition[] = [
  { id: 'checking', label: 'Checking Ollama', stage: 'checking' },
  { id: 'downloading', label: 'Downloading Model', stage: 'downloading' },
  { id: 'initializing', label: 'Initializing Embedder', stage: 'initializing' },
  { id: 'ready', label: 'Ready', stage: 'ready' },
];

/**
 * Get the index of a stage in the startup sequence
 */
export function getStageIndex(stage: StartupStage): number {
  if (stage === 'error') return -1;
  return STARTUP_STEPS.findIndex(step => step.stage === stage);
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
    case 'checking':
      return 'Verifying Ollama installation...';
    case 'downloading':
      return 'Downloading embedding model...';
    case 'initializing':
      return 'Initializing embedder...';
    case 'ready':
      return 'Ready to index files';
    case 'error':
      return 'Initialization failed';
    default:
      return 'Initializing...';
  }
}
