import { describe, it, expect } from 'vitest';
import {
  STARTUP_STEPS,
  getStageIndex,
  getStepStatus,
  hasAnyCompletedSteps,
  allStepsCompleted,
  getStageMessage,
  type StartupStage,
} from '../../src/renderer/utils/StepperLogic';

describe('StepperLogic - Pure Functions', () => {
  describe('STARTUP_STEPS', () => {
    it('should have 4 steps in correct order', () => {
      expect(STARTUP_STEPS).toHaveLength(4);
      expect(STARTUP_STEPS[0].id).toBe('checking');
      expect(STARTUP_STEPS[1].id).toBe('downloading');
      expect(STARTUP_STEPS[2].id).toBe('initializing');
      expect(STARTUP_STEPS[3].id).toBe('ready');
    });

    it('should have descriptive labels', () => {
      expect(STARTUP_STEPS[0].label).toBe('Checking Ollama');
      expect(STARTUP_STEPS[1].label).toBe('Downloading Model');
      expect(STARTUP_STEPS[2].label).toBe('Initializing Embedder');
      expect(STARTUP_STEPS[3].label).toBe('Ready');
    });

    it('should map ids to stages correctly', () => {
      expect(STARTUP_STEPS[0].stage).toBe('checking');
      expect(STARTUP_STEPS[1].stage).toBe('downloading');
      expect(STARTUP_STEPS[2].stage).toBe('initializing');
      expect(STARTUP_STEPS[3].stage).toBe('ready');
    });
  });

  describe('getStageIndex', () => {
    it('should return correct index for each stage', () => {
      expect(getStageIndex('checking')).toBe(0);
      expect(getStageIndex('downloading')).toBe(1);
      expect(getStageIndex('initializing')).toBe(2);
      expect(getStageIndex('ready')).toBe(3);
    });

    it('should return -1 for error stage', () => {
      expect(getStageIndex('error')).toBe(-1);
    });
  });

  describe('getStepStatus', () => {
    describe('Normal flow (no errors)', () => {
      it('should mark first step as active when checking', () => {
        expect(getStepStatus('checking', 0, false)).toBe('active');
        expect(getStepStatus('checking', 1, false)).toBe('pending');
        expect(getStepStatus('checking', 2, false)).toBe('pending');
        expect(getStepStatus('checking', 3, false)).toBe('pending');
      });

      it('should mark previous steps as completed when downloading', () => {
        expect(getStepStatus('downloading', 0, false)).toBe('completed');
        expect(getStepStatus('downloading', 1, false)).toBe('active');
        expect(getStepStatus('downloading', 2, false)).toBe('pending');
        expect(getStepStatus('downloading', 3, false)).toBe('pending');
      });

      it('should mark previous steps as completed when initializing', () => {
        expect(getStepStatus('initializing', 0, false)).toBe('completed');
        expect(getStepStatus('initializing', 1, false)).toBe('completed');
        expect(getStepStatus('initializing', 2, false)).toBe('active');
        expect(getStepStatus('initializing', 3, false)).toBe('pending');
      });

      it('should mark all steps as completed when ready', () => {
        expect(getStepStatus('ready', 0, false)).toBe('completed');
        expect(getStepStatus('ready', 1, false)).toBe('completed');
        expect(getStepStatus('ready', 2, false)).toBe('completed');
        expect(getStepStatus('ready', 3, false)).toBe('completed');
      });
    });

    describe('Error states', () => {
      it('should mark current step as error when hasError=true', () => {
        // Error during checking (step 0)
        expect(getStepStatus('checking', 0, true)).toBe('error');
        expect(getStepStatus('checking', 1, true)).toBe('pending');
        expect(getStepStatus('checking', 2, true)).toBe('pending');
        expect(getStepStatus('checking', 3, true)).toBe('pending');
      });

      it('should mark previous steps as completed when error occurs', () => {
        // Error during downloading (step 1) - step 0 should be completed
        expect(getStepStatus('downloading', 0, true)).toBe('completed');
        expect(getStepStatus('downloading', 1, true)).toBe('error');
        expect(getStepStatus('downloading', 2, true)).toBe('pending');
        expect(getStepStatus('downloading', 3, true)).toBe('pending');
      });

      it('should handle error in initializing step', () => {
        expect(getStepStatus('initializing', 0, true)).toBe('completed');
        expect(getStepStatus('initializing', 1, true)).toBe('completed');
        expect(getStepStatus('initializing', 2, true)).toBe('error');
        expect(getStepStatus('initializing', 3, true)).toBe('pending');
      });

      it('should handle generic error stage', () => {
        // When stage is 'error' (no specific step), all should be pending
        expect(getStepStatus('error', 0, true)).toBe('pending');
        expect(getStepStatus('error', 1, true)).toBe('pending');
        expect(getStepStatus('error', 2, true)).toBe('pending');
        expect(getStepStatus('error', 3, true)).toBe('pending');
      });
    });

    describe('Edge cases', () => {
      it('should handle invalid step indices gracefully', () => {
        expect(getStepStatus('checking', -1, false)).toBe('completed');
        expect(getStepStatus('checking', 999, false)).toBe('pending');
      });

      it('should treat hasError as false by default', () => {
        // Test default parameter
        expect(getStepStatus('checking', 0)).toBe('active');
        expect(getStepStatus('downloading', 0)).toBe('completed');
      });
    });
  });

  describe('hasAnyCompletedSteps', () => {
    it('should return false when on first step', () => {
      expect(hasAnyCompletedSteps('checking', false)).toBe(false);
    });

    it('should return true when past first step', () => {
      expect(hasAnyCompletedSteps('downloading', false)).toBe(true);
      expect(hasAnyCompletedSteps('initializing', false)).toBe(true);
      expect(hasAnyCompletedSteps('ready', false)).toBe(true);
    });

    it('should return false when error occurs', () => {
      expect(hasAnyCompletedSteps('checking', true)).toBe(false);
      expect(hasAnyCompletedSteps('downloading', true)).toBe(false);
      expect(hasAnyCompletedSteps('initializing', true)).toBe(false);
    });

    it('should return false for error stage', () => {
      expect(hasAnyCompletedSteps('error', false)).toBe(false);
      expect(hasAnyCompletedSteps('error', true)).toBe(false);
    });
  });

  describe('allStepsCompleted', () => {
    it('should return true only when stage is ready', () => {
      expect(allStepsCompleted('ready')).toBe(true);
    });

    it('should return false for all other stages', () => {
      expect(allStepsCompleted('checking')).toBe(false);
      expect(allStepsCompleted('downloading')).toBe(false);
      expect(allStepsCompleted('initializing')).toBe(false);
      expect(allStepsCompleted('error')).toBe(false);
    });
  });

  describe('getStageMessage', () => {
    it('should return custom message when provided', () => {
      expect(getStageMessage('checking', 'Custom message')).toBe('Custom message');
      expect(getStageMessage('downloading', 'Another message')).toBe('Another message');
    });

    it('should return default messages for each stage', () => {
      expect(getStageMessage('checking')).toBe('Verifying Ollama installation...');
      expect(getStageMessage('downloading')).toBe('Downloading embedding model...');
      expect(getStageMessage('initializing')).toBe('Initializing embedder...');
      expect(getStageMessage('ready')).toBe('Ready to index files');
      expect(getStageMessage('error')).toBe('Initialization failed');
    });

    it('should handle undefined stage gracefully', () => {
      expect(getStageMessage('unknown' as StartupStage)).toBe('Initializing...');
    });
  });

  describe('Integration Scenarios', () => {
    it('should progress through all steps correctly', () => {
      const stages: StartupStage[] = ['checking', 'downloading', 'initializing', 'ready'];

      stages.forEach((stage, stageIdx) => {
        STARTUP_STEPS.forEach((_, stepIdx) => {
          const status = getStepStatus(stage, stepIdx, false);

          if (stepIdx < stageIdx) {
            expect(status).toBe('completed');
          } else if (stepIdx === stageIdx) {
            expect(status).toBe(stage === 'ready' ? 'completed' : 'active');
          } else {
            expect(status).toBe('pending');
          }
        });
      });
    });

    it('should handle error at each step correctly', () => {
      const stages: StartupStage[] = ['checking', 'downloading', 'initializing'];

      stages.forEach((stage, stageIdx) => {
        STARTUP_STEPS.forEach((_, stepIdx) => {
          const status = getStepStatus(stage, stepIdx, true);

          if (stepIdx < stageIdx) {
            expect(status).toBe('completed');
          } else if (stepIdx === stageIdx) {
            expect(status).toBe('error');
          } else {
            expect(status).toBe('pending');
          }
        });
      });
    });

    it('should simulate Ollama not found error', () => {
      // Error occurs at checking stage (step 0)
      const stage: StartupStage = 'checking';
      const hasError = true;

      expect(getStepStatus(stage, 0, hasError)).toBe('error');
      expect(getStepStatus(stage, 1, hasError)).toBe('pending');
      expect(getStepStatus(stage, 2, hasError)).toBe('pending');
      expect(getStepStatus(stage, 3, hasError)).toBe('pending');

      expect(hasAnyCompletedSteps(stage, hasError)).toBe(false);
      expect(allStepsCompleted(stage)).toBe(false);
    });

    it('should simulate successful download completion', () => {
      // Download completed, moving to initializing
      const stage: StartupStage = 'initializing';

      expect(getStepStatus(stage, 0, false)).toBe('completed'); // Checking ✓
      expect(getStepStatus(stage, 1, false)).toBe('completed'); // Downloading ✓
      expect(getStepStatus(stage, 2, false)).toBe('active');    // Initializing ⟳
      expect(getStepStatus(stage, 3, false)).toBe('pending');   // Ready ○

      expect(hasAnyCompletedSteps(stage, false)).toBe(true);
      expect(allStepsCompleted(stage)).toBe(false);
    });
  });
});
