import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ModelServiceStateMachine } from '../../src/main/worker/utils/ModelServiceStateMachine';
import { ModelServiceState } from '../../src/main/worker/types/model-service-state';

describe('ModelServiceStateMachine', () => {
  let stateMachine: ModelServiceStateMachine;

  beforeEach(() => {
    stateMachine = new ModelServiceStateMachine({ enableLogging: false });
  });

  describe('Initial State', () => {
    it('should start in Uninitialized state', () => {
      expect(stateMachine.getState()).toBe(ModelServiceState.Uninitialized);
    });

    it('should have correct initial state in history', () => {
      const history = stateMachine.getHistory();
      expect(history).toHaveLength(1);
      expect(history[0].state).toBe(ModelServiceState.Uninitialized);
    });
  });

  describe('State Transitions', () => {
    it('should transition from Uninitialized to Checking', () => {
      const result = stateMachine.transition(ModelServiceState.Checking, { reason: 'Test' });
      expect(result).toBe(true);
      expect(stateMachine.getState()).toBe(ModelServiceState.Checking);
    });

    it('should transition from Checking to ModelMissing', () => {
      stateMachine.transition(ModelServiceState.Checking);
      const result = stateMachine.transition(ModelServiceState.ModelMissing, { reason: 'Model not found' });
      expect(result).toBe(true);
      expect(stateMachine.getState()).toBe(ModelServiceState.ModelMissing);
    });

    it('should transition from Checking to InitializingPool', () => {
      stateMachine.transition(ModelServiceState.Checking);
      const result = stateMachine.transition(ModelServiceState.InitializingPool);
      expect(result).toBe(true);
      expect(stateMachine.getState()).toBe(ModelServiceState.InitializingPool);
    });

    it('should transition from InitializingPool to Ready', () => {
      stateMachine.transition(ModelServiceState.Checking);
      stateMachine.transition(ModelServiceState.InitializingPool);
      const result = stateMachine.transition(ModelServiceState.Ready);
      expect(result).toBe(true);
      expect(stateMachine.getState()).toBe(ModelServiceState.Ready);
    });

    it('should transition from ModelMissing to InitializingPool after download', () => {
      stateMachine.transition(ModelServiceState.Checking);
      stateMachine.transition(ModelServiceState.ModelMissing);
      const result = stateMachine.transition(ModelServiceState.InitializingPool, { reason: 'Model downloaded' });
      expect(result).toBe(true);
      expect(stateMachine.getState()).toBe(ModelServiceState.InitializingPool);
    });

    it('should reject invalid transition from Uninitialized to Ready', () => {
      const result = stateMachine.transition(ModelServiceState.Ready);
      expect(result).toBe(false);
      expect(stateMachine.getState()).toBe(ModelServiceState.Uninitialized);
    });

    it('should reject invalid transition from ModelMissing to Ready', () => {
      stateMachine.transition(ModelServiceState.Checking);
      stateMachine.transition(ModelServiceState.ModelMissing);
      const result = stateMachine.transition(ModelServiceState.Ready);
      expect(result).toBe(false);
      expect(stateMachine.getState()).toBe(ModelServiceState.ModelMissing);
    });
  });

  describe('State Checks', () => {
    it('should correctly identify Ready state', () => {
      expect(stateMachine.isReady()).toBe(false);
      stateMachine.transition(ModelServiceState.Checking);
      expect(stateMachine.isReady()).toBe(false);
      stateMachine.transition(ModelServiceState.InitializingPool);
      expect(stateMachine.isReady()).toBe(false);
      stateMachine.transition(ModelServiceState.Ready);
      expect(stateMachine.isReady()).toBe(true);
    });

    it('should correctly identify ModelMissing state', () => {
      expect(stateMachine.isModelMissing()).toBe(false);
      stateMachine.transition(ModelServiceState.Checking);
      stateMachine.transition(ModelServiceState.ModelMissing);
      expect(stateMachine.isModelMissing()).toBe(true);
    });

    it('should correctly identify Error state', () => {
      expect(stateMachine.isError()).toBe(false);
      stateMachine.transition(ModelServiceState.Checking);
      stateMachine.transition(ModelServiceState.Error);
      expect(stateMachine.isError()).toBe(true);
    });

    it('should correctly check if operations can be accepted', () => {
      expect(stateMachine.canAcceptOperations()).toBe(false);
      stateMachine.transition(ModelServiceState.Checking);
      expect(stateMachine.canAcceptOperations()).toBe(false);
      stateMachine.transition(ModelServiceState.InitializingPool);
      expect(stateMachine.canAcceptOperations()).toBe(false);
      stateMachine.transition(ModelServiceState.Ready);
      expect(stateMachine.canAcceptOperations()).toBe(true);
    });
  });

  describe('Events', () => {
    it('should emit stateChange event on valid transition', () => {
      const stateChangeHandler = vi.fn();
      stateMachine.on('stateChange', stateChangeHandler);

      stateMachine.transition(ModelServiceState.Checking, { reason: 'Test transition' });

      expect(stateChangeHandler).toHaveBeenCalledWith(
        ModelServiceState.Uninitialized,
        ModelServiceState.Checking,
        expect.objectContaining({ reason: 'Test transition', timestamp: expect.any(Number) })
      );
    });

    it('should emit invalidTransition event on invalid transition', () => {
      const invalidHandler = vi.fn();
      stateMachine.on('invalidTransition', invalidHandler);

      stateMachine.transition(ModelServiceState.Ready);

      expect(invalidHandler).toHaveBeenCalledWith(
        ModelServiceState.Uninitialized,
        ModelServiceState.Ready,
        expect.stringContaining('No valid transition')
      );
    });
  });

  describe('History', () => {
    it('should maintain transition history', () => {
      stateMachine.transition(ModelServiceState.Checking);
      stateMachine.transition(ModelServiceState.InitializingPool);
      stateMachine.transition(ModelServiceState.Ready);

      const history = stateMachine.getHistory();
      expect(history).toHaveLength(4); // Initial + 3 transitions
      expect(history[0].state).toBe(ModelServiceState.Uninitialized);
      expect(history[1].state).toBe(ModelServiceState.Checking);
      expect(history[2].state).toBe(ModelServiceState.InitializingPool);
      expect(history[3].state).toBe(ModelServiceState.Ready);
    });

    it('should include context in history', () => {
      const error = new Error('Test error');
      stateMachine.transition(ModelServiceState.Checking);
      stateMachine.transition(ModelServiceState.Error, { reason: 'Failed', error });

      const history = stateMachine.getHistory();
      const errorEntry = history[history.length - 1];
      expect(errorEntry.context?.reason).toBe('Failed');
      expect(errorEntry.context?.error).toBe(error);
    });

    it('should respect max history size', () => {
      const smallStateMachine = new ModelServiceStateMachine({ maxHistorySize: 3 });

      smallStateMachine.transition(ModelServiceState.Checking);
      smallStateMachine.transition(ModelServiceState.InitializingPool);
      smallStateMachine.transition(ModelServiceState.Ready);
      smallStateMachine.transition(ModelServiceState.Error);

      const history = smallStateMachine.getHistory();
      expect(history).toHaveLength(3);
      expect(history[0].state).toBe(ModelServiceState.InitializingPool);
      expect(history[2].state).toBe(ModelServiceState.Error);
    });
  });

  describe('Error Handling', () => {
    it('should retrieve last error from history', () => {
      const error1 = new Error('First error');
      const error2 = new Error('Second error');

      stateMachine.transition(ModelServiceState.Checking);
      stateMachine.transition(ModelServiceState.Error, { error: error1 });
      stateMachine.transition(ModelServiceState.Checking);
      stateMachine.transition(ModelServiceState.Error, { error: error2 });

      const lastError = stateMachine.getLastError();
      expect(lastError).toBe(error2);
    });

    it('should return undefined if no error in history', () => {
      stateMachine.transition(ModelServiceState.Checking);
      stateMachine.transition(ModelServiceState.InitializingPool);

      const lastError = stateMachine.getLastError();
      expect(lastError).toBeUndefined();
    });
  });

  describe('Reset', () => {
    it('should reset to Uninitialized state', () => {
      stateMachine.transition(ModelServiceState.Checking);
      stateMachine.transition(ModelServiceState.InitializingPool);
      stateMachine.transition(ModelServiceState.Ready);

      stateMachine.reset();

      expect(stateMachine.getState()).toBe(ModelServiceState.Uninitialized);
      const history = stateMachine.getHistory();
      expect(history[history.length - 1].context?.reason).toBe('Reset requested');
    });
  });

  describe('Error Recovery', () => {
    it('should allow transition from Error back to Checking', () => {
      stateMachine.transition(ModelServiceState.Checking);
      stateMachine.transition(ModelServiceState.Error);

      const result = stateMachine.transition(ModelServiceState.Checking, { reason: 'Retry' });
      expect(result).toBe(true);
      expect(stateMachine.getState()).toBe(ModelServiceState.Checking);
    });
  });
});