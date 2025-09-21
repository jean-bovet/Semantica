import { EventEmitter } from 'node:events';
import { ModelServiceState, MODEL_SERVICE_STATE_TRANSITIONS, ModelServiceStateContext } from '../types/model-service-state';
import { logger } from '../../../shared/utils/logger';

/**
 * State machine for managing ModelService lifecycle
 */
export class ModelServiceStateMachine extends EventEmitter {
  private currentState: ModelServiceState = ModelServiceState.Uninitialized;
  private stateHistory: Array<{ state: ModelServiceState; timestamp: number; context?: ModelServiceStateContext }> = [];
  private readonly maxHistorySize: number;

  constructor(options: { maxHistorySize?: number; enableLogging?: boolean } = {}) {
    super();
    this.maxHistorySize = options.maxHistorySize || 100;

    // Add initial state to history
    this.stateHistory.push({
      state: this.currentState,
      timestamp: Date.now()
    });

    // Optional logging for debugging
    if (options.enableLogging) {
      this.on('stateChange', (from, to, context) => {
        logger.log('MODEL-STATE', `State transition: ${from} → ${to}${context.reason ? ` (${context.reason})` : ''}`);
      });
      this.on('invalidTransition', (from, to, reason) => {
        logger.warn('MODEL-STATE', `Invalid transition: ${from} → ${to} (${reason})`);
      });
    }
  }

  /**
   * Get the current state
   */
  getState(): ModelServiceState {
    return this.currentState;
  }

  /**
   * Check if the service is in a specific state
   */
  isState(state: ModelServiceState): boolean {
    return this.currentState === state;
  }

  /**
   * Check if the service is ready for operations
   */
  isReady(): boolean {
    return this.currentState === ModelServiceState.Ready;
  }

  /**
   * Check if the model is missing
   */
  isModelMissing(): boolean {
    return this.currentState === ModelServiceState.ModelMissing;
  }

  /**
   * Check if the service is in an error state
   */
  isError(): boolean {
    return this.currentState === ModelServiceState.Error;
  }

  /**
   * Check if the service can accept embedding operations
   */
  canAcceptOperations(): boolean {
    return this.currentState === ModelServiceState.Ready;
  }

  /**
   * Attempt to transition to a new state
   */
  transition(to: ModelServiceState, context: Partial<ModelServiceStateContext> = {}): boolean {
    const from = this.currentState;
    const validTransitions = MODEL_SERVICE_STATE_TRANSITIONS[from];

    // Check if transition is valid
    if (!validTransitions.includes(to)) {
      const reason = `No valid transition from ${from} to ${to}`;
      this.emit('invalidTransition', from, to, reason);
      return false;
    }

    // Perform the transition
    this.currentState = to;

    // Create context with timestamp
    const fullContext: ModelServiceStateContext = {
      ...context,
      timestamp: Date.now()
    };

    // Add to history
    this.stateHistory.push({
      state: to,
      timestamp: fullContext.timestamp,
      context: fullContext
    });

    // Trim history if needed
    if (this.stateHistory.length > this.maxHistorySize) {
      this.stateHistory = this.stateHistory.slice(-this.maxHistorySize);
    }

    // Emit the state change event
    this.emit('stateChange', from, to, fullContext);

    return true;
  }

  /**
   * Get the state history
   */
  getHistory(): Array<{ state: ModelServiceState; timestamp: number; context?: ModelServiceStateContext }> {
    return [...this.stateHistory];
  }

  /**
   * Get the last error from history
   */
  getLastError(): Error | undefined {
    for (let i = this.stateHistory.length - 1; i >= 0; i--) {
      const entry = this.stateHistory[i];
      if (entry.context?.error) {
        return entry.context.error;
      }
    }
    return undefined;
  }

  /**
   * Reset to initial state
   */
  reset(): void {
    // Directly set the state to Uninitialized since it's a reset operation
    const from = this.currentState;
    this.currentState = ModelServiceState.Uninitialized;

    const context: ModelServiceStateContext = {
      reason: 'Reset requested',
      timestamp: Date.now()
    };

    // Add to history
    this.stateHistory.push({
      state: ModelServiceState.Uninitialized,
      timestamp: context.timestamp,
      context
    });

    // Trim history if needed
    if (this.stateHistory.length > this.maxHistorySize) {
      this.stateHistory = this.stateHistory.slice(-this.maxHistorySize);
    }

    // Emit state change
    this.emit('stateChange', from, ModelServiceState.Uninitialized, context);
  }
}

// TypeScript event emitter typing
export interface ModelServiceStateMachine {
  on(event: 'stateChange', listener: (from: ModelServiceState, to: ModelServiceState, context: ModelServiceStateContext) => void): this;
  on(event: 'invalidTransition', listener: (from: ModelServiceState, to: ModelServiceState, reason: string) => void): this;
  emit(event: 'stateChange', from: ModelServiceState, to: ModelServiceState, context: ModelServiceStateContext): boolean;
  emit(event: 'invalidTransition', from: ModelServiceState, to: ModelServiceState, reason: string): boolean;
}