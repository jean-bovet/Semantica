/**
 * Profiling Integration for Worker
 * 
 * This module provides a minimal integration to add profiling
 * to the existing worker without modifying the core code.
 * 
 * To use:
 * 1. Import this at the top of worker/index.ts
 * 2. Call setupProfiling() after initialization
 * 3. Use the wrapped functions for profiling
 */

import { PerformanceProfiler } from '../core/embedding/PerformanceProfiler';
import { logger } from '../../shared/utils/logger';

// Create profiler instance - only enabled if PROFILE env var is set
export const profiler = new PerformanceProfiler(process.env.PROFILE === 'true');

// Log profiling status
if (profiler.isEnabled()) {
  logger.log('PROFILING', '🔬 Performance profiling is ENABLED');
  logger.log('PROFILING', '🔬 Report will be generated on shutdown');
} else {
  logger.log('PROFILING', 'Performance profiling is DISABLED');
  logger.log('PROFILING', 'To enable: PROFILE=true npm run dev');
}

/**
 * Setup automatic report generation on shutdown
 */
export function setupProfiling() {
  if (!profiler.isEnabled()) return;

  // Note: Shutdown handlers are now in the main worker index.ts
  // to ensure they run in the correct order
  
  // Handle parent port messages for worker threads
  const { parentPort } = require('worker_threads');
  if (parentPort) {
    parentPort.on('message', async (msg: any) => {
      if (msg.type === 'generateReport') {
        await profiler.saveReport(msg.outputPath);
        parentPort.postMessage({ 
          type: 'reportGenerated',
          path: msg.outputPath 
        });
      }
    });
  }
}

/**
 * Wrapper for handleFile that adds profiling
 * Use this to replace the existing handleFile function
 */
export function profileHandleFile(originalHandleFile: Function) {
  return async function(filePath: string) {
    if (!profiler.isEnabled()) {
      return originalHandleFile(filePath);
    }

    const fs = require('fs');
    const path = require('path');
    
    try {
      // Start file profiling
      const stat = fs.statSync(filePath);
      const ext = path.extname(filePath).slice(1).toLowerCase();
      profiler.startFile(filePath, stat.size, ext);
      
      // Call original function
      await originalHandleFile(filePath);
      
      // Mark as successful
      profiler.endFile(filePath, true);
    } catch (error: any) {
      // Mark as failed
      profiler.endFile(filePath, false, error.message);
      throw error;
    }
  };
}

/**
 * Simple timing wrapper for async operations
 */
export async function timeOperation<T>(
  name: string,
  operation: () => Promise<T>
): Promise<T> {
  if (!profiler.isEnabled()) {
    return operation();
  }

  profiler.startOperation(name);
  try {
    const result = await operation();
    profiler.endOperation(name);
    return result;
  } catch (error) {
    profiler.endOperation(name);
    throw error;
  }
}

/**
 * Record important events
 */
export function recordEvent(event: string, metadata?: any) {
  if (!profiler.isEnabled()) return;

  switch (event) {
    case 'embedderRestart':
      profiler.recordEmbedderRestart();
      break;
    case 'throttleStart':
      profiler.recordThrottleStart();
      break;
    case 'throttleEnd':
      profiler.recordThrottleEnd();
      break;
    case 'dbConflict':
      profiler.recordDBConflict();
      break;
    case 'dbWrite':
      if (metadata?.batchSize && metadata?.queueDepth) {
        profiler.recordDBWrite(metadata.batchSize, metadata.queueDepth);
      }
      break;
  }
}

// Export for use in other modules
export default {
  profiler,
  setupProfiling,
  profileHandleFile,
  timeOperation,
  recordEvent
};