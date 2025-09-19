import { EventEmitter } from 'node:events';

/**
 * Possible states for an embedder process
 */
export enum EmbedderState {
  Uninitialized = 'uninitialized',
  Spawning = 'spawning',
  Ready = 'ready',
  Error = 'error',
  Restarting = 'restarting',
  ShuttingDown = 'shutting_down',
  Shutdown = 'shutdown'
}

/**
 * Valid state transitions for the embedder process
 */
export const STATE_TRANSITIONS: Record<EmbedderState, EmbedderState[]> = {
  [EmbedderState.Uninitialized]: [EmbedderState.Spawning, EmbedderState.ShuttingDown],
  [EmbedderState.Spawning]: [EmbedderState.Ready, EmbedderState.Error, EmbedderState.ShuttingDown],
  [EmbedderState.Ready]: [EmbedderState.Error, EmbedderState.Restarting, EmbedderState.ShuttingDown],
  [EmbedderState.Error]: [EmbedderState.Restarting, EmbedderState.ShuttingDown],
  [EmbedderState.Restarting]: [EmbedderState.Spawning, EmbedderState.Error, EmbedderState.ShuttingDown],
  [EmbedderState.ShuttingDown]: [EmbedderState.Shutdown],
  [EmbedderState.Shutdown]: [] // Terminal state
};

/**
 * Context information for state transitions
 */
export interface StateTransitionContext {
  reason?: string;
  error?: Error;
  metadata?: Record<string, any>;
  timestamp: number;
}

/**
 * Events emitted by the state machine
 */
export interface StateMachineEvents {
  stateChange: (from: EmbedderState, to: EmbedderState, context: StateTransitionContext) => void;
  invalidTransition: (from: EmbedderState, to: EmbedderState, reason: string) => void;
  error: (error: Error) => void;
}

/**
 * State machine for managing embedder process lifecycle with proper validation
 * and event emission for debugging and monitoring.
 */
export class ProcessStateMachine extends EventEmitter {
  private currentState: EmbedderState = EmbedderState.Uninitialized;
  private stateHistory: Array<{ state: EmbedderState; timestamp: number; context?: StateTransitionContext }> = [];
  private readonly maxHistorySize: number;

  constructor(options: { maxHistorySize?: number; enableLogging?: boolean } = {}) {
    super();
    this.maxHistorySize = options.maxHistorySize || 100;

    // Add state transition to history
    this.stateHistory.push({
      state: this.currentState,
      timestamp: Date.now()
    });

    // Optional logging for debugging
    if (options.enableLogging) {
      this.enableDebugLogging();
    }
  }

  /**
   * Get the current state
   */
  getState(): EmbedderState {
    return this.currentState;
  }

  /**
   * Check if the process is in a specific state
   */
  isState(state: EmbedderState): boolean {
    return this.currentState === state;
  }

  /**
   * Check if the process is in any of the specified states
   */
  isAnyState(...states: EmbedderState[]): boolean {
    return states.includes(this.currentState);
  }

  /**
   * Check if the process is ready for operations
   */
  isReady(): boolean {
    return this.currentState === EmbedderState.Ready;
  }

  /**
   * Check if the process is in an error state
   */
  isErrorState(): boolean {
    return this.currentState === EmbedderState.Error;
  }

  /**
   * Check if the process is shutting down or shutdown
   */
  isShuttingDown(): boolean {
    return this.isAnyState(EmbedderState.ShuttingDown, EmbedderState.Shutdown);
  }

  /**
   * Check if the process can accept new operations
   */
  canAcceptOperations(): boolean {
    return this.currentState === EmbedderState.Ready;
  }

  /**
   * Attempt to transition to a new state with validation
   */
  transition(newState: EmbedderState, context: Partial<StateTransitionContext> = {}): boolean {
    const from = this.currentState;

    // Check if transition is valid
    if (!this.isValidTransition(from, newState)) {
      const reason = `Invalid transition from ${from} to ${newState}`;
      this.emit('invalidTransition', from, newState, reason);
      return false;
    }

    // Perform the transition
    const fullContext: StateTransitionContext = {
      timestamp: Date.now(),
      ...context
    };

    const previousState = this.currentState;
    this.currentState = newState;

    // Add to history
    this.addToHistory(newState, fullContext);

    // Emit state change event
    this.emit('stateChange', previousState, newState, fullContext);

    return true;
  }

  /**
   * Force a state transition without validation (use with caution)
   */
  forceTransition(newState: EmbedderState, context: Partial<StateTransitionContext> = {}): void {
    const from = this.currentState;
    const fullContext: StateTransitionContext = {
      timestamp: Date.now(),
      reason: 'Forced transition',
      ...context
    };

    this.currentState = newState;
    this.addToHistory(newState, fullContext);
    this.emit('stateChange', from, newState, fullContext);
  }

  /**
   * Check if a transition from current state to target state is valid
   */
  isValidTransition(from: EmbedderState, to: EmbedderState): boolean {
    const allowedTransitions = STATE_TRANSITIONS[from] || [];
    return allowedTransitions.includes(to);
  }

  /**
   * Get all valid transitions from the current state
   */
  getValidTransitions(): EmbedderState[] {
    return STATE_TRANSITIONS[this.currentState] || [];
  }

  /**
   * Get the state history (most recent first)
   */
  getHistory(): Array<{ state: EmbedderState; timestamp: number; context?: StateTransitionContext }> {
    return [...this.stateHistory].reverse();
  }

  /**
   * Get the time spent in the current state
   */
  getTimeInCurrentState(): number {
    if (this.stateHistory.length === 0) {
      return 0;
    }

    const currentStateEntry = this.stateHistory[this.stateHistory.length - 1];
    return Date.now() - currentStateEntry.timestamp;
  }

  /**
   * Get statistics about state transitions
   */
  getStatistics(): {
    currentState: EmbedderState;
    timeInCurrentState: number;
    totalTransitions: number;
    errorCount: number;
    restartCount: number;
    stateDurations: Record<EmbedderState, number>;
  } {
    const errorCount = this.stateHistory.filter(entry => entry.state === EmbedderState.Error).length;
    const restartCount = this.stateHistory.filter(entry => entry.state === EmbedderState.Restarting).length;

    // Calculate time spent in each state
    const stateDurations: Record<EmbedderState, number> = {} as any;
    Object.values(EmbedderState).forEach(state => {
      stateDurations[state] = 0;
    });

    for (let i = 0; i < this.stateHistory.length - 1; i++) {
      const current = this.stateHistory[i];
      const next = this.stateHistory[i + 1];
      const duration = next.timestamp - current.timestamp;
      stateDurations[current.state] += duration;
    }

    // Add current state duration
    if (this.stateHistory.length > 0) {
      const currentEntry = this.stateHistory[this.stateHistory.length - 1];
      stateDurations[currentEntry.state] += Date.now() - currentEntry.timestamp;
    }

    return {
      currentState: this.currentState,
      timeInCurrentState: this.getTimeInCurrentState(),
      totalTransitions: this.stateHistory.length - 1, // Subtract initial state
      errorCount,
      restartCount,
      stateDurations
    };
  }

  /**
   * Reset the state machine to uninitialized
   */
  reset(context: Partial<StateTransitionContext> = {}): void {
    this.forceTransition(EmbedderState.Uninitialized, {
      reason: 'State machine reset',
      ...context
    });
  }

  /**
   * Add an entry to the state history
   */
  private addToHistory(state: EmbedderState, context: StateTransitionContext): void {
    this.stateHistory.push({
      state,
      timestamp: context.timestamp,
      context
    });

    // Trim history if it exceeds max size
    if (this.stateHistory.length > this.maxHistorySize) {
      this.stateHistory = this.stateHistory.slice(-this.maxHistorySize);
    }
  }

  /**
   * Enable debug logging for all state transitions
   */
  private enableDebugLogging(): void {
    this.on('stateChange', (from, to, context) => {
      const reason = context.reason ? ` (${context.reason})` : '';
      console.log(`[StateMachine] ${from} → ${to}${reason}`);
    });

    this.on('invalidTransition', (from, to, reason) => {
      console.warn(`[StateMachine] Invalid transition: ${from} → ${to} (${reason})`);
    });

    this.on('error', (error) => {
      console.error(`[StateMachine] Error:`, error);
    });
  }
}

// TypeScript event emitter typing
export interface ProcessStateMachine {
  on<K extends keyof StateMachineEvents>(event: K, listener: StateMachineEvents[K]): this;
  emit<K extends keyof StateMachineEvents>(event: K, ...args: Parameters<StateMachineEvents[K]>): boolean;
}

/**
 * Helper functions for common state machine operations
 */
export const StateMachineHelpers = {
  /**
   * Create a state machine with logging enabled for development
   */
  createWithLogging(): ProcessStateMachine {
    return new ProcessStateMachine({ enableLogging: true });
  },

  /**
   * Create a state machine optimized for production
   */
  createForProduction(): ProcessStateMachine {
    return new ProcessStateMachine({
      enableLogging: false,
      maxHistorySize: 50
    });
  },

  /**
   * Create a state machine for testing with minimal history
   */
  createForTesting(): ProcessStateMachine {
    return new ProcessStateMachine({
      enableLogging: false,
      maxHistorySize: 10
    });
  }
};