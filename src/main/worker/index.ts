/**
 * Worker Thread Entry Point
 *
 * This file serves as the entry point for the worker thread.
 * It delegates all operations to the WorkerCore coordinator.
 */

import { parentPort } from 'node:worker_threads';
import { WorkerCore } from './WorkerCore';
import { logger } from '../../shared/utils/logger';

// Load mock setup if in test mode with mocks enabled
if (process.env.E2E_MOCK_DOWNLOADS === 'true') {
  try {
    const { setupModelDownloadMocks } = require('./test-mocks/setupModelMocks');
    setupModelDownloadMocks();
    logger.log('WORKER', 'Mock downloads enabled');
  } catch (err) {
    logger.error('WORKER', 'Failed to load mock setup:', err);
  }
}

// Create the worker core instance
const workerCore = new WorkerCore();

// Memory monitoring
const memoryMonitor = setInterval(() => {
  const usage = process.memoryUsage();
  const rssMB = Math.round(usage.rss / 1024 / 1024);
  const heapMB = Math.round(usage.heapUsed / 1024 / 1024);

  // Log only significant changes
  if (rssMB > 1400) {
    logger.warn('MEMORY', `High memory usage - RSS: ${rssMB}MB, Heap: ${heapMB}MB`);
  }

  // Restart if memory is too high
  if (rssMB > 1500) {
    logger.error('MEMORY', `Memory limit exceeded - RSS: ${rssMB}MB. Worker will restart.`);
    process.exit(1);
  }
}, 10000);

// Handle messages from main process
if (parentPort) {
  parentPort.on('message', async (msg) => {
    const { type, payload, id } = msg;

    try {
      if (type === 'init') {
        // Initialize the worker
        await workerCore.initialize(payload.dbDir, payload.userDataPath);
      } else if (type === 'shutdown') {
        // Clean shutdown
        clearInterval(memoryMonitor);
        await workerCore.shutdown();
        process.exit(0);
      } else {
        // Handle all other messages
        const result = await workerCore.handleMessage(type, payload);

        // Send response back to main process
        if (id) {
          parentPort!.postMessage({ id, payload: result });
        }
      }
    } catch (error) {
      logger.error('WORKER', `Error handling message ${type}:`, error);

      // Send error response
      if (id) {
        parentPort!.postMessage({
          id,
          payload: {
            error: error instanceof Error ? error.message : String(error)
          }
        });
      }
    }
  });
} else {
  logger.error('WORKER', 'No parent port available - worker not started correctly');
  process.exit(1);
}

// Handle uncaught errors
process.on('uncaughtException', (error) => {
  logger.error('WORKER', 'Uncaught exception:', error);
  process.exit(1);
});

process.on('unhandledRejection', (reason, promise) => {
  logger.error('WORKER', 'Unhandled rejection at:', promise, 'reason:', reason);
  process.exit(1);
});

logger.log('WORKER', 'Worker thread started');