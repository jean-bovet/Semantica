import { describe, it, expect } from 'vitest';
import {
  createStageMessage,
  createErrorMessage,
  createDownloadProgressMessage,
  isValidStage,
  getStageIndex,
  isStartupStageMessage,
  isStartupErrorMessage,
  STARTUP_STAGE_ORDER,
  type StartupStage,
  type StartupErrorCode
} from '../../src/shared/types/startup';

describe('Startup Message Format', () => {
  describe('createStageMessage', () => {
    it('should create valid stage message with all fields', () => {
      const msg = createStageMessage('checking', 'Verifying Ollama...', 50);

      expect(msg).toEqual({
        channel: 'startup:stage',
        stage: 'checking',
        message: 'Verifying Ollama...',
        progress: 50,
      });
    });

    it('should create message with optional fields omitted', () => {
      const msg = createStageMessage('ready');

      expect(msg).toEqual({
        channel: 'startup:stage',
        stage: 'ready',
        message: undefined,
        progress: undefined,
      });
    });

    it('should create message for all valid stages', () => {
      STARTUP_STAGE_ORDER.forEach((stage) => {
        const msg = createStageMessage(stage);
        expect(msg.channel).toBe('startup:stage');
        expect(msg.stage).toBe(stage);
      });
    });
  });

  describe('createErrorMessage', () => {
    it('should create valid error message with all fields', () => {
      const msg = createErrorMessage(
        'OLLAMA_NOT_FOUND',
        'Ollama is not installed',
        { path: '/usr/local/bin/ollama' }
      );

      expect(msg).toEqual({
        channel: 'startup:error',
        code: 'OLLAMA_NOT_FOUND',
        message: 'Ollama is not installed',
        details: { path: '/usr/local/bin/ollama' },
      });
    });

    it('should create message without optional details', () => {
      const msg = createErrorMessage('STARTUP_TIMEOUT', 'Startup took too long');

      expect(msg).toEqual({
        channel: 'startup:error',
        code: 'STARTUP_TIMEOUT',
        message: 'Startup took too long',
        details: undefined,
      });
    });

    it('should create message for all error codes', () => {
      const errorCodes: StartupErrorCode[] = [
        'OLLAMA_NOT_FOUND',
        'OLLAMA_START_FAILED',
        'MODEL_DOWNLOAD_FAILED',
        'EMBEDDER_INIT_FAILED',
        'STARTUP_TIMEOUT',
      ];

      errorCodes.forEach((code) => {
        const msg = createErrorMessage(code, 'Test message');
        expect(msg.channel).toBe('startup:error');
        expect(msg.code).toBe(code);
      });
    });
  });

  describe('createDownloadProgressMessage', () => {
    it('should create valid download progress message', () => {
      const msg = createDownloadProgressMessage(
        'model-layer-1.bin',
        45,
        450000,
        1000000
      );

      expect(msg).toEqual({
        channel: 'model:download:progress',
        file: 'model-layer-1.bin',
        progress: 45,
        loaded: 450000,
        total: 1000000,
      });
    });

    it('should handle zero progress', () => {
      const msg = createDownloadProgressMessage('model.bin', 0, 0, 1000);

      expect(msg.progress).toBe(0);
      expect(msg.loaded).toBe(0);
      expect(msg.total).toBe(1000);
    });

    it('should handle 100% completion', () => {
      const msg = createDownloadProgressMessage('model.bin', 100, 1000, 1000);

      expect(msg.progress).toBe(100);
      expect(msg.loaded).toBe(1000);
      expect(msg.total).toBe(1000);
    });
  });

  describe('isValidStage', () => {
    it('should return true for all stages in STARTUP_STAGE_ORDER', () => {
      STARTUP_STAGE_ORDER.forEach((stage) => {
        expect(isValidStage(stage)).toBe(true);
      });
    });

    it('should return true for error stage', () => {
      expect(isValidStage('error')).toBe(true);
    });

    it('should return false for invalid stages', () => {
      expect(isValidStage('invalid')).toBe(false);
      expect(isValidStage('unknown')).toBe(false);
      expect(isValidStage('')).toBe(false);
      expect(isValidStage('CHECKING')).toBe(false); // case sensitive
    });
  });

  describe('getStageIndex', () => {
    it('should return correct indices for all stages', () => {
      expect(getStageIndex('worker_spawn')).toBe(0);
      expect(getStageIndex('db_init')).toBe(1);
      expect(getStageIndex('db_load')).toBe(2);
      expect(getStageIndex('folder_scan')).toBe(3);
      expect(getStageIndex('checking')).toBe(4);
      expect(getStageIndex('downloading')).toBe(5);
      expect(getStageIndex('initializing')).toBe(6);
      expect(getStageIndex('ready')).toBe(7);
    });

    it('should return -1 for error stage', () => {
      expect(getStageIndex('error')).toBe(-1);
    });

    it('should return -1 for unknown stage', () => {
      expect(getStageIndex('unknown' as StartupStage)).toBe(-1);
    });
  });

  describe('isStartupStageMessage', () => {
    it('should validate correct stage messages', () => {
      const validMsg = createStageMessage('checking', 'Test');
      expect(isStartupStageMessage(validMsg)).toBe(true);
    });

    it('should accept minimal valid message', () => {
      const minimalMsg = {
        channel: 'startup:stage',
        stage: 'ready',
      };
      expect(isStartupStageMessage(minimalMsg)).toBe(true);
    });

    it('should reject messages with invalid channel', () => {
      const invalidMsg = {
        channel: 'wrong:channel',
        stage: 'checking',
      };
      expect(isStartupStageMessage(invalidMsg)).toBe(false);
    });

    it('should reject messages with invalid stage', () => {
      const invalidMsg = {
        channel: 'startup:stage',
        stage: 'invalid_stage',
      };
      expect(isStartupStageMessage(invalidMsg)).toBe(false);
    });

    it('should reject messages with missing required fields', () => {
      expect(isStartupStageMessage({ channel: 'startup:stage' })).toBe(false);
      expect(isStartupStageMessage({ stage: 'checking' })).toBe(false);
    });

    it('should reject null and undefined', () => {
      expect(isStartupStageMessage(null)).toBe(false);
      expect(isStartupStageMessage(undefined)).toBe(false);
    });

    it('should reject non-object types', () => {
      expect(isStartupStageMessage('string')).toBe(false);
      expect(isStartupStageMessage(123)).toBe(false);
      expect(isStartupStageMessage(true)).toBe(false);
      expect(isStartupStageMessage([])).toBe(false);
    });
  });

  describe('isStartupErrorMessage', () => {
    it('should validate correct error messages', () => {
      const validMsg = createErrorMessage('OLLAMA_NOT_FOUND', 'Test error');
      expect(isStartupErrorMessage(validMsg)).toBe(true);
    });

    it('should accept minimal valid message', () => {
      const minimalMsg = {
        channel: 'startup:error',
        code: 'STARTUP_TIMEOUT',
        message: 'Timeout',
      };
      expect(isStartupErrorMessage(minimalMsg)).toBe(true);
    });

    it('should reject messages with invalid channel', () => {
      const invalidMsg = {
        channel: 'wrong:channel',
        code: 'OLLAMA_NOT_FOUND',
        message: 'Error',
      };
      expect(isStartupErrorMessage(invalidMsg)).toBe(false);
    });

    it('should reject messages with missing required fields', () => {
      expect(isStartupErrorMessage({
        channel: 'startup:error',
        code: 'OLLAMA_NOT_FOUND',
      })).toBe(false);

      expect(isStartupErrorMessage({
        channel: 'startup:error',
        message: 'Error',
      })).toBe(false);
    });

    it('should reject messages with wrong field types', () => {
      expect(isStartupErrorMessage({
        channel: 'startup:error',
        code: 123, // should be string
        message: 'Error',
      })).toBe(false);

      expect(isStartupErrorMessage({
        channel: 'startup:error',
        code: 'ERROR',
        message: 123, // should be string
      })).toBe(false);
    });

    it('should reject null and undefined', () => {
      expect(isStartupErrorMessage(null)).toBe(false);
      expect(isStartupErrorMessage(undefined)).toBe(false);
    });

    it('should reject non-object types', () => {
      expect(isStartupErrorMessage('string')).toBe(false);
      expect(isStartupErrorMessage(123)).toBe(false);
      expect(isStartupErrorMessage(true)).toBe(false);
      expect(isStartupErrorMessage([])).toBe(false);
    });
  });

  describe('Message consistency', () => {
    it('should create messages that pass validation', () => {
      // Stage messages
      STARTUP_STAGE_ORDER.forEach((stage) => {
        const msg = createStageMessage(stage, 'Test');
        expect(isStartupStageMessage(msg)).toBe(true);
      });

      // Error messages
      const errorCodes: StartupErrorCode[] = [
        'OLLAMA_NOT_FOUND',
        'OLLAMA_START_FAILED',
        'MODEL_DOWNLOAD_FAILED',
        'EMBEDDER_INIT_FAILED',
        'STARTUP_TIMEOUT',
      ];

      errorCodes.forEach((code) => {
        const msg = createErrorMessage(code, 'Test error');
        expect(isStartupErrorMessage(msg)).toBe(true);
      });
    });

    it('should have consistent channel values', () => {
      const stageMsg = createStageMessage('checking');
      const errorMsg = createErrorMessage('STARTUP_TIMEOUT', 'Error');
      const progressMsg = createDownloadProgressMessage('file', 50, 500, 1000);

      expect(stageMsg.channel).toBe('startup:stage');
      expect(errorMsg.channel).toBe('startup:error');
      expect(progressMsg.channel).toBe('model:download:progress');

      // Ensure channels are distinct
      expect(stageMsg.channel).not.toBe(errorMsg.channel);
      expect(stageMsg.channel).not.toBe(progressMsg.channel);
      expect(errorMsg.channel).not.toBe(progressMsg.channel);
    });
  });

  describe('STARTUP_STAGE_ORDER', () => {
    it('should have correct number of stages', () => {
      // 8 stages: worker_spawn, db_init, db_load, folder_scan, checking, downloading, initializing, ready
      expect(STARTUP_STAGE_ORDER).toHaveLength(8);
    });

    it('should be in correct order', () => {
      expect(STARTUP_STAGE_ORDER[0]).toBe('worker_spawn');
      expect(STARTUP_STAGE_ORDER[1]).toBe('db_init');
      expect(STARTUP_STAGE_ORDER[2]).toBe('db_load');
      expect(STARTUP_STAGE_ORDER[3]).toBe('folder_scan');
      expect(STARTUP_STAGE_ORDER[4]).toBe('checking');
      expect(STARTUP_STAGE_ORDER[5]).toBe('downloading');
      expect(STARTUP_STAGE_ORDER[6]).toBe('initializing');
      expect(STARTUP_STAGE_ORDER[7]).toBe('ready');
    });

    it('should not include error stage', () => {
      expect(STARTUP_STAGE_ORDER.includes('error' as any)).toBe(false);
    });

    it('should be readonly', () => {
      // TypeScript enforces readonly at compile time
      // This test just verifies the type is correct at runtime
      expect(Array.isArray(STARTUP_STAGE_ORDER)).toBe(true);
    });
  });
});
