/**
 * ModelService - Manages ML model operations
 *
 * This service handles model checking, downloading, and embedding
 * operations using the EmbedderPool with proper state management.
 */

import * as path from 'node:path';
import * as fs from 'node:fs';
import type { IModelService } from '../types/interfaces';
import { EmbedderPool } from '../../../shared/embeddings/embedder-pool';
import { ModelServiceStateMachine } from '../utils/ModelServiceStateMachine';
import { ModelServiceState } from '../types/model-service-state';
import { logger } from '../../../shared/utils/logger';

// Model checking utilities
function checkModelExistsSync(userDataPath: string): boolean {
  const modelPath = path.join(userDataPath, 'models', 'Xenova', 'multilingual-e5-small', 'config.json');
  return fs.existsSync(modelPath);
}

export class ModelService implements IModelService {
  private embedderPool: EmbedderPool | null = null;
  private userDataPath = '';
  private stateMachine: ModelServiceStateMachine;

  constructor() {
    this.stateMachine = new ModelServiceStateMachine({ enableLogging: true });
  }

  async initialize(userDataPath: string): Promise<void> {
    this.userDataPath = userDataPath;
    logger.log('MODEL', 'Initializing model service...');

    // Transition to checking state
    this.stateMachine.transition(ModelServiceState.Checking, { reason: 'Initialize called' });

    // Check if model exists (fast synchronous check)
    const modelExists = checkModelExistsSync(userDataPath);
    logger.log('MODEL', `Model check result: ${modelExists ? 'exists' : 'missing'}`);

    if (modelExists) {
      // Model exists, proceed to initialize pool
      await this.initializePool();
    } else {
      // Model missing, transition to ModelMissing state
      this.stateMachine.transition(ModelServiceState.ModelMissing, {
        reason: 'Model files not found',
        modelPath: path.join(userDataPath, 'models', 'Xenova', 'multilingual-e5-small')
      });
      logger.log('MODEL', 'Model not found, waiting for download');
    }
  }

  private async initializePool(): Promise<void> {
    // Transition to initializing pool state
    this.stateMachine.transition(ModelServiceState.InitializingPool, { reason: 'Starting embedder pool' });

    try {
      // Initialize embedder pool
      this.embedderPool = new EmbedderPool({
        modelName: 'Xenova/multilingual-e5-small',
        poolSize: 4,
        maxFilesBeforeRestart: 5000,
        maxMemoryMB: 1500
      });

      // Initialize the pool
      await this.embedderPool.initialize();
      logger.log('MODEL', 'Embedder pool started successfully');

      // Transition to ready state
      this.stateMachine.transition(ModelServiceState.Ready, { reason: 'Pool initialized' });
    } catch (error: any) {
      logger.error('MODEL', 'Failed to initialize embedder pool:', error);
      this.stateMachine.transition(ModelServiceState.Error, {
        reason: 'Pool initialization failed',
        error
      });
      throw error;
    }
  }

  async checkModel(): Promise<boolean> {
    logger.log('MODEL', 'Checking for model...');

    try {
      const exists = checkModelExistsSync(this.userDataPath);

      if (exists) {
        logger.log('MODEL', 'Model found');
        // If we're in ModelMissing state and model now exists, initialize pool
        if (this.stateMachine.isModelMissing()) {
          await this.initializePool();
        }
      } else {
        logger.log('MODEL', 'Model not found');
        if (!this.stateMachine.isModelMissing()) {
          this.stateMachine.transition(ModelServiceState.ModelMissing, {
            reason: 'Model check failed'
          });
        }
      }

      return exists;
    } catch (error) {
      logger.error('MODEL', 'Error checking model:', error);
      return false;
    }
  }

  async downloadModel(): Promise<void> {
    logger.log('MODEL', 'Starting model download...');

    // Model download would be handled by the renderer process
    // This just checks if it's completed
    const modelPath = path.join(this.userDataPath, 'models', 'Xenova', 'multilingual-e5-small');
    const configPath = path.join(modelPath, 'config.json');

    // Wait for model to be downloaded (with timeout)
    const maxWait = 300000; // 5 minutes
    const startTime = Date.now();

    while (Date.now() - startTime < maxWait) {
      if (fs.existsSync(configPath)) {
        logger.log('MODEL', 'Model download completed');
        // Initialize pool now that model is available
        await this.initializePool();
        return;
      }
      await new Promise(resolve => setTimeout(resolve, 1000));
    }

    throw new Error('Model download timeout');
  }

  async embed(texts: string[], isQuery: boolean = false): Promise<number[][]> {
    // Check state before attempting to embed
    const state = this.stateMachine.getState();

    switch (state) {
      case ModelServiceState.Ready:
        // Normal operation
        break;
      case ModelServiceState.ModelMissing:
        throw new Error('Model not downloaded. Please download the model first.');
      case ModelServiceState.Checking:
      case ModelServiceState.InitializingPool:
        throw new Error('Model service is initializing. Please try again in a moment.');
      case ModelServiceState.Error:
        const lastError = this.stateMachine.getLastError();
        throw new Error(`Model service is in error state: ${lastError?.message || 'Unknown error'}`);
      default:
        throw new Error(`Model service is not ready (state: ${state})`);
    }

    if (!this.embedderPool) {
      // This shouldn't happen if state machine is working correctly
      throw new Error('Embedder pool not initialized despite ready state');
    }

    try {
      const embeddings = await this.embedderPool.embed(texts, isQuery);
      return embeddings;
    } catch (error: any) {
      logger.error('MODEL', 'Embedding error:', error);
      // If embedding fails, transition to error state
      this.stateMachine.transition(ModelServiceState.Error, {
        reason: 'Embedding failed',
        error
      });
      throw error;
    }
  }

  getEmbedderStats(): {
    id: string;
    filesProcessed: number;
    memoryUsage: number;
    isHealthy: boolean;
  }[] {
    if (!this.embedderPool) {
      return [];
    }

    const stats = this.embedderPool.getStats();
    return stats.map((s: any) => ({
      id: s.id,
      filesProcessed: s.filesProcessed || 0,
      memoryUsage: s.memoryUsage || 0,
      isHealthy: s.isHealthy
    }));
  }

  async restartEmbedders(): Promise<void> {
    if (!this.embedderPool) {
      logger.warn('MODEL', 'Cannot restart: embedder pool not initialized');
      return;
    }

    logger.log('MODEL', 'Restarting embedders...');
    await this.embedderPool.restartAll();
    logger.log('MODEL', 'Embedders restarted');
  }

  async shutdown(): Promise<void> {
    if (this.embedderPool) {
      logger.log('MODEL', 'Shutting down embedder pool...');
      await this.embedderPool.dispose();
      this.embedderPool = null;
    }
    // Reset state machine to uninitialized
    this.stateMachine.reset();
  }

  isReady(): boolean {
    return this.stateMachine.isReady();
  }

  getModelPath(): string {
    return path.join(this.userDataPath, 'models', 'Xenova', 'multilingual-e5-small');
  }

  getState(): ModelServiceState {
    return this.stateMachine.getState();
  }

  async warmup(): Promise<void> {
    if (!this.isReady()) {
      logger.warn('MODEL', 'Cannot warmup: model not ready');
      return;
    }

    logger.log('MODEL', 'Warming up model...');
    try {
      // Do a test embedding to warm up the model
      await this.embed(['test'], false);
      logger.log('MODEL', 'Model warmed up');
    } catch (error) {
      logger.error('MODEL', 'Warmup failed:', error);
    }
  }
}