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
    it('should have 9 steps in correct order', () => {
      expect(STARTUP_STEPS).toHaveLength(9);
      expect(STARTUP_STEPS[0].id).toBe('worker_spawn');
      expect(STARTUP_STEPS[1].id).toBe('db_init');
      expect(STARTUP_STEPS[2].id).toBe('db_load');
      expect(STARTUP_STEPS[3].id).toBe('folder_scan');
      expect(STARTUP_STEPS[4].id).toBe('sidecar_start');
      expect(STARTUP_STEPS[5].id).toBe('downloading');
      expect(STARTUP_STEPS[6].id).toBe('sidecar_ready');
      expect(STARTUP_STEPS[7].id).toBe('embedder_init');
      expect(STARTUP_STEPS[8].id).toBe('ready');
    });

    it('should have descriptive labels', () => {
      expect(STARTUP_STEPS[0].label).toBe('Starting Worker');
      expect(STARTUP_STEPS[1].label).toBe('Initializing Database');
      expect(STARTUP_STEPS[2].label).toBe('Loading Files');
      expect(STARTUP_STEPS[3].label).toBe('Scanning Folders');
      expect(STARTUP_STEPS[4].label).toBe('Starting Python Sidecar');
      expect(STARTUP_STEPS[5].label).toBe('Downloading Model');
      expect(STARTUP_STEPS[6].label).toBe('Loading Model');
      expect(STARTUP_STEPS[7].label).toBe('Initializing Embedder');
      expect(STARTUP_STEPS[8].label).toBe('Ready');
    });

    it('should map ids to stages correctly', () => {
      expect(STARTUP_STEPS[0].stage).toBe('worker_spawn');
      expect(STARTUP_STEPS[1].stage).toBe('db_init');
      expect(STARTUP_STEPS[2].stage).toBe('db_load');
      expect(STARTUP_STEPS[3].stage).toBe('folder_scan');
      expect(STARTUP_STEPS[4].stage).toBe('sidecar_start');
      expect(STARTUP_STEPS[5].stage).toBe('downloading');
      expect(STARTUP_STEPS[6].stage).toBe('sidecar_ready');
      expect(STARTUP_STEPS[7].stage).toBe('embedder_init');
      expect(STARTUP_STEPS[8].stage).toBe('ready');
    });
  });

  describe('getStageIndex', () => {
    it('should return correct index for each stage', () => {
      expect(getStageIndex('worker_spawn')).toBe(0);
      expect(getStageIndex('db_init')).toBe(1);
      expect(getStageIndex('db_load')).toBe(2);
      expect(getStageIndex('folder_scan')).toBe(3);
      expect(getStageIndex('sidecar_start')).toBe(4);
      expect(getStageIndex('downloading')).toBe(5);
      expect(getStageIndex('sidecar_ready')).toBe(6);
      expect(getStageIndex('embedder_init')).toBe(7);
      expect(getStageIndex('ready')).toBe(8);
    });

    it('should return -1 for error stage', () => {
      expect(getStageIndex('error')).toBe(-1);
    });
  });

  describe('getStepStatus', () => {
    describe('Normal flow (no errors)', () => {
      it('should mark first step as active when worker_spawn', () => {
        expect(getStepStatus('worker_spawn', 0, false)).toBe('active');
        expect(getStepStatus('worker_spawn', 1, false)).toBe('pending');
        expect(getStepStatus('worker_spawn', 2, false)).toBe('pending');
        expect(getStepStatus('worker_spawn', 3, false)).toBe('pending');
      });

      it('should mark previous steps as completed when sidecar_start', () => {
        expect(getStepStatus('sidecar_start', 0, false)).toBe('completed');
        expect(getStepStatus('sidecar_start', 1, false)).toBe('completed');
        expect(getStepStatus('sidecar_start', 2, false)).toBe('completed');
        expect(getStepStatus('sidecar_start', 3, false)).toBe('completed');
        expect(getStepStatus('sidecar_start', 4, false)).toBe('active');
        expect(getStepStatus('sidecar_start', 5, false)).toBe('pending');
        expect(getStepStatus('sidecar_start', 6, false)).toBe('pending');
        expect(getStepStatus('sidecar_start', 7, false)).toBe('pending');
        expect(getStepStatus('sidecar_start', 8, false)).toBe('pending');
      });

      it('should mark previous steps as completed when downloading', () => {
        expect(getStepStatus('downloading', 0, false)).toBe('completed');
        expect(getStepStatus('downloading', 1, false)).toBe('completed');
        expect(getStepStatus('downloading', 2, false)).toBe('completed');
        expect(getStepStatus('downloading', 3, false)).toBe('completed');
        expect(getStepStatus('downloading', 4, false)).toBe('completed');
        expect(getStepStatus('downloading', 5, false)).toBe('active');
        expect(getStepStatus('downloading', 6, false)).toBe('pending');
        expect(getStepStatus('downloading', 7, false)).toBe('pending');
        expect(getStepStatus('downloading', 8, false)).toBe('pending');
      });

      it('should mark previous steps as completed when embedder_init', () => {
        expect(getStepStatus('embedder_init', 0, false)).toBe('completed');
        expect(getStepStatus('embedder_init', 1, false)).toBe('completed');
        expect(getStepStatus('embedder_init', 2, false)).toBe('completed');
        expect(getStepStatus('embedder_init', 3, false)).toBe('completed');
        expect(getStepStatus('embedder_init', 4, false)).toBe('completed');
        expect(getStepStatus('embedder_init', 5, false)).toBe('completed');
        expect(getStepStatus('embedder_init', 6, false)).toBe('completed');
        expect(getStepStatus('embedder_init', 7, false)).toBe('active');
        expect(getStepStatus('embedder_init', 8, false)).toBe('pending');
      });

      it('should mark all steps as completed when ready', () => {
        expect(getStepStatus('ready', 0, false)).toBe('completed');
        expect(getStepStatus('ready', 1, false)).toBe('completed');
        expect(getStepStatus('ready', 2, false)).toBe('completed');
        expect(getStepStatus('ready', 3, false)).toBe('completed');
        expect(getStepStatus('ready', 4, false)).toBe('completed');
        expect(getStepStatus('ready', 5, false)).toBe('completed');
        expect(getStepStatus('ready', 6, false)).toBe('completed');
        expect(getStepStatus('ready', 7, false)).toBe('completed');
        expect(getStepStatus('ready', 8, false)).toBe('completed');
      });
    });

    describe('Error states', () => {
      it('should mark current step as error when hasError=true', () => {
        // Error during sidecar_start (step 4)
        expect(getStepStatus('sidecar_start', 0, true)).toBe('completed');
        expect(getStepStatus('sidecar_start', 1, true)).toBe('completed');
        expect(getStepStatus('sidecar_start', 2, true)).toBe('completed');
        expect(getStepStatus('sidecar_start', 3, true)).toBe('completed');
        expect(getStepStatus('sidecar_start', 4, true)).toBe('error');
        expect(getStepStatus('sidecar_start', 5, true)).toBe('pending');
        expect(getStepStatus('sidecar_start', 6, true)).toBe('pending');
        expect(getStepStatus('sidecar_start', 7, true)).toBe('pending');
        expect(getStepStatus('sidecar_start', 8, true)).toBe('pending');
      });

      it('should mark previous steps as completed when error occurs', () => {
        // Error during downloading (step 5) - previous steps should be completed
        expect(getStepStatus('downloading', 0, true)).toBe('completed');
        expect(getStepStatus('downloading', 1, true)).toBe('completed');
        expect(getStepStatus('downloading', 2, true)).toBe('completed');
        expect(getStepStatus('downloading', 3, true)).toBe('completed');
        expect(getStepStatus('downloading', 4, true)).toBe('completed');
        expect(getStepStatus('downloading', 5, true)).toBe('error');
        expect(getStepStatus('downloading', 6, true)).toBe('pending');
        expect(getStepStatus('downloading', 7, true)).toBe('pending');
        expect(getStepStatus('downloading', 8, true)).toBe('pending');
      });

      it('should handle error in embedder_init step', () => {
        expect(getStepStatus('embedder_init', 0, true)).toBe('completed');
        expect(getStepStatus('embedder_init', 1, true)).toBe('completed');
        expect(getStepStatus('embedder_init', 2, true)).toBe('completed');
        expect(getStepStatus('embedder_init', 3, true)).toBe('completed');
        expect(getStepStatus('embedder_init', 4, true)).toBe('completed');
        expect(getStepStatus('embedder_init', 5, true)).toBe('completed');
        expect(getStepStatus('embedder_init', 6, true)).toBe('completed');
        expect(getStepStatus('embedder_init', 7, true)).toBe('error');
        expect(getStepStatus('embedder_init', 8, true)).toBe('pending');
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
        expect(getStepStatus('sidecar_start', -1, false)).toBe('completed');
        expect(getStepStatus('sidecar_start', 999, false)).toBe('pending');
      });

      it('should treat hasError as false by default', () => {
        // Test default parameter
        expect(getStepStatus('sidecar_start', 4)).toBe('active');
        expect(getStepStatus('downloading', 5)).toBe('active');
        expect(getStepStatus('downloading', 0)).toBe('completed');
      });
    });
  });

  describe('hasAnyCompletedSteps', () => {
    it('should return false when on first step', () => {
      expect(hasAnyCompletedSteps('worker_spawn', false)).toBe(false);
    });

    it('should return true when past first step', () => {
      expect(hasAnyCompletedSteps('downloading', false)).toBe(true);
      expect(hasAnyCompletedSteps('embedder_init', false)).toBe(true);
      expect(hasAnyCompletedSteps('ready', false)).toBe(true);
    });

    it('should return false when error occurs', () => {
      expect(hasAnyCompletedSteps('sidecar_start', true)).toBe(false);
      expect(hasAnyCompletedSteps('downloading', true)).toBe(false);
      expect(hasAnyCompletedSteps('embedder_init', true)).toBe(false);
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
      expect(allStepsCompleted('sidecar_start')).toBe(false);
      expect(allStepsCompleted('downloading')).toBe(false);
      expect(allStepsCompleted('embedder_init')).toBe(false);
      expect(allStepsCompleted('error')).toBe(false);
    });
  });

  describe('getStageMessage', () => {
    it('should return custom message when provided', () => {
      expect(getStageMessage('sidecar_start', 'Custom message')).toBe('Custom message');
      expect(getStageMessage('downloading', 'Another message')).toBe('Another message');
    });

    it('should return default messages for each stage', () => {
      expect(getStageMessage('sidecar_start')).toBe('Starting Python sidecar server...');
      expect(getStageMessage('downloading')).toBe('Downloading embedding model...');
      expect(getStageMessage('embedder_init')).toBe('Initializing embedder...');
      expect(getStageMessage('ready')).toBe('Ready to index files');
      expect(getStageMessage('error')).toBe('Initialization failed');
    });

    it('should handle undefined stage gracefully', () => {
      expect(getStageMessage('unknown' as StartupStage)).toBe('Initializing...');
    });
  });

  describe('Integration Scenarios', () => {
    it('should progress through all steps correctly', () => {
      const stages: StartupStage[] = ['worker_spawn', 'db_init', 'db_load', 'folder_scan', 'sidecar_start', 'downloading', 'sidecar_ready', 'embedder_init', 'ready'];

      stages.forEach((stage) => {
        const stageIdx = getStageIndex(stage);

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
      const stages: StartupStage[] = ['worker_spawn', 'db_init', 'db_load', 'folder_scan', 'sidecar_start', 'downloading', 'sidecar_ready', 'embedder_init'];

      stages.forEach((stage) => {
        const stageIdx = getStageIndex(stage);

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

    it('should simulate sidecar start error', () => {
      // Error occurs at sidecar_start stage (step 4)
      const stage: StartupStage = 'sidecar_start';
      const hasError = true;

      expect(getStepStatus(stage, 0, hasError)).toBe('completed');
      expect(getStepStatus(stage, 1, hasError)).toBe('completed');
      expect(getStepStatus(stage, 2, hasError)).toBe('completed');
      expect(getStepStatus(stage, 3, hasError)).toBe('completed');
      expect(getStepStatus(stage, 4, hasError)).toBe('error');
      expect(getStepStatus(stage, 5, hasError)).toBe('pending');
      expect(getStepStatus(stage, 6, hasError)).toBe('pending');
      expect(getStepStatus(stage, 7, hasError)).toBe('pending');
      expect(getStepStatus(stage, 8, hasError)).toBe('pending');

      expect(hasAnyCompletedSteps(stage, hasError)).toBe(false);
      expect(allStepsCompleted(stage)).toBe(false);
    });

    it('should simulate successful download completion', () => {
      // Download completed, moving to embedder_init
      const stage: StartupStage = 'embedder_init';

      expect(getStepStatus(stage, 0, false)).toBe('completed'); // worker_spawn ✓
      expect(getStepStatus(stage, 1, false)).toBe('completed'); // db_init ✓
      expect(getStepStatus(stage, 2, false)).toBe('completed'); // db_load ✓
      expect(getStepStatus(stage, 3, false)).toBe('completed'); // folder_scan ✓
      expect(getStepStatus(stage, 4, false)).toBe('completed'); // sidecar_start ✓
      expect(getStepStatus(stage, 5, false)).toBe('completed'); // downloading ✓
      expect(getStepStatus(stage, 6, false)).toBe('completed'); // sidecar_ready ✓
      expect(getStepStatus(stage, 7, false)).toBe('active');    // embedder_init ⟳
      expect(getStepStatus(stage, 8, false)).toBe('pending');   // ready ○

      expect(hasAnyCompletedSteps(stage, false)).toBe(true);
      expect(allStepsCompleted(stage)).toBe(false);
    });
  });
});
