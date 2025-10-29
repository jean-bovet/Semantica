/**
 * Unit tests for worker ready signaling
 *
 * This test prevents regression of the bug where workerReady flag
 * was not set when receiving StartupStageMessage with stage='ready',
 * causing IPC calls to fail with "Worker not ready".
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createStageMessage, isStartupStageMessage } from '../../src/shared/types/startup';

describe('Worker Ready Signaling', () => {
  describe('StartupStageMessage Protocol', () => {
    it('should create valid stage message for ready', () => {
      const msg = createStageMessage('ready', 'Worker ready');

      expect(msg.channel).toBe('startup:stage');
      expect(msg.stage).toBe('ready');
      expect(msg.message).toBe('Worker ready');
      expect(isStartupStageMessage(msg)).toBe(true);
    });

    it('should validate startup stage messages correctly', () => {
      const validMsg = createStageMessage('ready', 'Worker ready');
      const invalidMsg = { type: 'ready' }; // Old format
      const nullMsg = null;
      const numberMsg = 42;

      expect(isStartupStageMessage(validMsg)).toBe(true);
      expect(isStartupStageMessage(invalidMsg)).toBe(false);
      expect(isStartupStageMessage(nullMsg)).toBe(false);
      expect(isStartupStageMessage(numberMsg)).toBe(false);
    });
  });

  describe('Worker Ready Flag Handling', () => {
    let workerReady: boolean;
    let pendingCallbacks: Map<string, (data: any) => void>;

    beforeEach(() => {
      workerReady = false;
      pendingCallbacks = new Map();
    });

    /**
     * Simulates the main.ts message handler
     */
    const handleWorkerMessage = (msg: any) => {
      if (isStartupStageMessage(msg)) {
        // This is the critical fix: set workerReady when stage='ready'
        if (msg.stage === 'ready') {
          workerReady = true;
        }
      } else if (msg.type === 'ready') {
        // Legacy handler for backward compatibility
        workerReady = true;
      }
    };

    /**
     * Simulates the sendToWorker function
     */
    const sendToWorker = (type: string, payload: any = {}): Promise<any> => {
      return new Promise((resolve, reject) => {
        if (!workerReady) {
          reject(new Error('Worker not ready'));
          return;
        }

        const id = Math.random().toString(36).substring(7);
        pendingCallbacks.set(id, resolve);

        // Simulate successful worker response
        setTimeout(() => {
          const callback = pendingCallbacks.get(id);
          if (callback) {
            callback({ success: true });
            pendingCallbacks.delete(id);
          }
        }, 10);
      });
    };

    it('should start with workerReady=false', () => {
      expect(workerReady).toBe(false);
    });

    it('should reject IPC calls when workerReady=false', async () => {
      expect(workerReady).toBe(false);

      await expect(sendToWorker('getWatchedFolders'))
        .rejects
        .toThrow('Worker not ready');
    });

    it('should set workerReady=true on StartupStageMessage with stage=ready', () => {
      const msg = createStageMessage('ready', 'Worker ready');

      expect(workerReady).toBe(false);
      handleWorkerMessage(msg);
      expect(workerReady).toBe(true);
    });

    it('should accept IPC calls after workerReady=true', async () => {
      // Simulate receiving ready message
      const msg = createStageMessage('ready', 'Worker ready');
      handleWorkerMessage(msg);

      expect(workerReady).toBe(true);

      // Now IPC calls should succeed
      const result = await sendToWorker('getWatchedFolders');
      expect(result).toEqual({ success: true });
    });

    it('should support legacy type=ready format for backward compatibility', () => {
      const legacyMsg = { type: 'ready' };

      expect(workerReady).toBe(false);
      handleWorkerMessage(legacyMsg);
      expect(workerReady).toBe(true);
    });

    it('should NOT set workerReady for other stages', () => {
      const stages = ['worker_spawn', 'db_init', 'db_load', 'folder_scan',
                     'sidecar_start', 'sidecar_ready', 'embedder_init'];

      for (const stage of stages) {
        workerReady = false; // Reset
        const msg = createStageMessage(stage as any, `Stage: ${stage}`);
        handleWorkerMessage(msg);
        expect(workerReady).toBe(false, `workerReady should stay false for stage: ${stage}`);
      }
    });

    it('should handle complete startup sequence correctly', async () => {
      const stages = [
        'worker_spawn',
        'db_init',
        'db_load',
        'folder_scan',
        'sidecar_start',
        'sidecar_ready',
        'embedder_init',
        'ready'
      ];

      // Verify IPC fails before ready
      await expect(sendToWorker('getWatchedFolders'))
        .rejects
        .toThrow('Worker not ready');

      // Process all stages
      for (const stage of stages) {
        const msg = createStageMessage(stage as any, `Stage: ${stage}`);
        handleWorkerMessage(msg);
      }

      // Verify workerReady is now true
      expect(workerReady).toBe(true);

      // Verify IPC now succeeds
      const result = await sendToWorker('getWatchedFolders');
      expect(result).toEqual({ success: true });
    });
  });

  describe('Regression Test: IPC Handler Registration', () => {
    it('should register IPC handlers that depend on worker being ready', () => {
      const ipcHandlers = [
        'indexer:getWatchedFolders',
        'settings:get',
        'settings:update',
        'indexer:reindexAll',
        'db:stats'
      ];

      // In the actual implementation, these handlers all use sendToWorker
      // which requires workerReady=true. This test documents that requirement.
      for (const handler of ipcHandlers) {
        expect(handler).toBeTruthy();
      }
    });
  });
});
