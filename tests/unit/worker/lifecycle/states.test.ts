import { describe, it, expect } from 'vitest';
import {
  WorkerState,
  VALID_TRANSITIONS,
  isValidTransition,
  canHandleMessage,
  ALLOWED_BEFORE_READY
} from '../../../../src/main/worker/lifecycle/states';

describe('WorkerLifecycle States', () => {
  describe('isValidTransition()', () => {
    it('should allow UNINITIALIZED → STARTING_SIDECAR', () => {
      expect(isValidTransition(WorkerState.UNINITIALIZED, WorkerState.STARTING_SIDECAR)).toBe(true);
    });

    it('should allow STARTING_SIDECAR → SIDECAR_READY', () => {
      expect(isValidTransition(WorkerState.STARTING_SIDECAR, WorkerState.SIDECAR_READY)).toBe(true);
    });

    it('should allow SIDECAR_READY → INITIALIZING_DB', () => {
      expect(isValidTransition(WorkerState.SIDECAR_READY, WorkerState.INITIALIZING_DB)).toBe(true);
    });

    it('should allow INITIALIZING_DB → DB_READY', () => {
      expect(isValidTransition(WorkerState.INITIALIZING_DB, WorkerState.DB_READY)).toBe(true);
    });

    it('should allow DB_READY → LOADING_FILES', () => {
      expect(isValidTransition(WorkerState.DB_READY, WorkerState.LOADING_FILES)).toBe(true);
    });

    it('should allow LOADING_FILES → SCANNING_FOLDERS', () => {
      expect(isValidTransition(WorkerState.LOADING_FILES, WorkerState.SCANNING_FOLDERS)).toBe(true);
    });

    it('should allow SCANNING_FOLDERS → READY', () => {
      expect(isValidTransition(WorkerState.SCANNING_FOLDERS, WorkerState.READY)).toBe(true);
    });

    it('should allow any state → ERROR', () => {
      expect(isValidTransition(WorkerState.UNINITIALIZED, WorkerState.ERROR)).toBe(false);
      expect(isValidTransition(WorkerState.STARTING_SIDECAR, WorkerState.ERROR)).toBe(true);
      expect(isValidTransition(WorkerState.SIDECAR_READY, WorkerState.ERROR)).toBe(true);
      expect(isValidTransition(WorkerState.INITIALIZING_DB, WorkerState.ERROR)).toBe(true);
      expect(isValidTransition(WorkerState.DB_READY, WorkerState.ERROR)).toBe(true);
      expect(isValidTransition(WorkerState.LOADING_FILES, WorkerState.ERROR)).toBe(true);
      expect(isValidTransition(WorkerState.SCANNING_FOLDERS, WorkerState.ERROR)).toBe(true);
      expect(isValidTransition(WorkerState.READY, WorkerState.ERROR)).toBe(true);
    });

    it('should disallow ERROR → any state', () => {
      expect(isValidTransition(WorkerState.ERROR, WorkerState.UNINITIALIZED)).toBe(false);
      expect(isValidTransition(WorkerState.ERROR, WorkerState.STARTING_SIDECAR)).toBe(false);
      expect(isValidTransition(WorkerState.ERROR, WorkerState.READY)).toBe(false);
    });

    it('should disallow skipping states', () => {
      // Can't skip from UNINITIALIZED directly to SIDECAR_READY
      expect(isValidTransition(WorkerState.UNINITIALIZED, WorkerState.SIDECAR_READY)).toBe(false);

      // Can't skip from STARTING_SIDECAR directly to INITIALIZING_DB
      expect(isValidTransition(WorkerState.STARTING_SIDECAR, WorkerState.INITIALIZING_DB)).toBe(false);

      // Can't skip from SIDECAR_READY directly to DB_READY
      expect(isValidTransition(WorkerState.SIDECAR_READY, WorkerState.DB_READY)).toBe(false);

      // Can't go backwards
      expect(isValidTransition(WorkerState.DB_READY, WorkerState.INITIALIZING_DB)).toBe(false);
      expect(isValidTransition(WorkerState.READY, WorkerState.UNINITIALIZED)).toBe(false);
    });

    it('should disallow staying in the same state', () => {
      expect(isValidTransition(WorkerState.UNINITIALIZED, WorkerState.UNINITIALIZED)).toBe(false);
      expect(isValidTransition(WorkerState.READY, WorkerState.READY)).toBe(false);
    });
  });

  describe('VALID_TRANSITIONS', () => {
    it('should define transitions for all states', () => {
      const allStates = Object.values(WorkerState);

      for (const state of allStates) {
        expect(VALID_TRANSITIONS).toHaveProperty(state);
      }
    });

    it('should have ERROR state with no outgoing transitions', () => {
      expect(VALID_TRANSITIONS[WorkerState.ERROR]).toEqual([]);
    });

    it('should have UNINITIALIZED with only one outgoing transition', () => {
      expect(VALID_TRANSITIONS[WorkerState.UNINITIALIZED]).toEqual([WorkerState.STARTING_SIDECAR]);
    });

    it('should have READY with only ERROR transition', () => {
      expect(VALID_TRANSITIONS[WorkerState.READY]).toEqual([WorkerState.ERROR]);
    });
  });

  describe('canHandleMessage()', () => {
    describe('when READY', () => {
      it('should allow all message types', () => {
        expect(canHandleMessage(WorkerState.READY, 'search')).toBe(true);
        expect(canHandleMessage(WorkerState.READY, 'stats')).toBe(true);
        expect(canHandleMessage(WorkerState.READY, 'addFile')).toBe(true);
        expect(canHandleMessage(WorkerState.READY, 'init')).toBe(true);
        expect(canHandleMessage(WorkerState.READY, 'checkModel')).toBe(true);
        expect(canHandleMessage(WorkerState.READY, 'diagnostics:getLogs')).toBe(true);
        expect(canHandleMessage(WorkerState.READY, 'unknownMessage')).toBe(true);
      });
    });

    describe('when not READY', () => {
      const notReadyStates = [
        WorkerState.UNINITIALIZED,
        WorkerState.STARTING_SIDECAR,
        WorkerState.SIDECAR_READY,
        WorkerState.INITIALIZING_DB,
        WorkerState.DB_READY,
        WorkerState.LOADING_FILES,
        WorkerState.SCANNING_FOLDERS,
        WorkerState.ERROR
      ];

      it('should allow whitelisted messages', () => {
        for (const state of notReadyStates) {
          expect(canHandleMessage(state, 'init')).toBe(true);
          expect(canHandleMessage(state, 'checkModel')).toBe(true);
          expect(canHandleMessage(state, 'diagnostics:getLogs')).toBe(true);
        }
      });

      it('should disallow non-whitelisted messages', () => {
        for (const state of notReadyStates) {
          expect(canHandleMessage(state, 'search')).toBe(false);
          expect(canHandleMessage(state, 'stats')).toBe(false);
          expect(canHandleMessage(state, 'addFile')).toBe(false);
          expect(canHandleMessage(state, 'removeFile')).toBe(false);
          expect(canHandleMessage(state, 'startWatching')).toBe(false);
          expect(canHandleMessage(state, 'unknownMessage')).toBe(false);
        }
      });
    });
  });

  describe('ALLOWED_BEFORE_READY', () => {
    it('should contain expected whitelisted messages', () => {
      expect(ALLOWED_BEFORE_READY.has('init')).toBe(true);
      expect(ALLOWED_BEFORE_READY.has('checkModel')).toBe(true);
      expect(ALLOWED_BEFORE_READY.has('diagnostics:getLogs')).toBe(true);
    });

    it('should not contain operational messages', () => {
      expect(ALLOWED_BEFORE_READY.has('search')).toBe(false);
      expect(ALLOWED_BEFORE_READY.has('stats')).toBe(false);
      expect(ALLOWED_BEFORE_READY.has('addFile')).toBe(false);
      expect(ALLOWED_BEFORE_READY.has('startWatching')).toBe(false);
    });
  });

  describe('State flow validation', () => {
    it('should have a valid initialization sequence', () => {
      const sequence = [
        WorkerState.UNINITIALIZED,
        WorkerState.STARTING_SIDECAR,
        WorkerState.SIDECAR_READY,
        WorkerState.INITIALIZING_DB,
        WorkerState.DB_READY,
        WorkerState.LOADING_FILES,
        WorkerState.SCANNING_FOLDERS,
        WorkerState.READY
      ];

      for (let i = 0; i < sequence.length - 1; i++) {
        const from = sequence[i];
        const to = sequence[i + 1];
        expect(isValidTransition(from, to)).toBe(true);
      }
    });

    it('should allow error transition at any point in sequence', () => {
      const sequence = [
        WorkerState.STARTING_SIDECAR,
        WorkerState.SIDECAR_READY,
        WorkerState.INITIALIZING_DB,
        WorkerState.DB_READY,
        WorkerState.LOADING_FILES,
        WorkerState.SCANNING_FOLDERS,
        WorkerState.READY
      ];

      for (const state of sequence) {
        expect(isValidTransition(state, WorkerState.ERROR)).toBe(true);
      }
    });
  });
});
