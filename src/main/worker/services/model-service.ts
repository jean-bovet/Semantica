/**
 * ModelService - Manages ML model operations
 *
 * This service handles model checking, downloading, and embedding
 * operations using the EmbedderPool.
 */

import * as path from 'node:path';
import * as fs from 'node:fs';
import type { IModelService } from '../types/interfaces';
import { EmbedderPool } from '../../../shared/embeddings/embedder-pool';
// Model checking utilities
async function checkModelExists(userDataPath: string): Promise<boolean> {
  const modelPath = path.join(userDataPath, 'models', 'Xenova', 'multilingual-e5-small', 'config.json');
  return fs.existsSync(modelPath);
}
import { logger } from '../../../shared/utils/logger';

export class ModelService implements IModelService {
  private embedderPool: EmbedderPool | null = null;
  private modelReady = false;
  private userDataPath = '';

  async initialize(userDataPath: string): Promise<void> {
    this.userDataPath = userDataPath;
    logger.log('MODEL', 'Initializing model service...');

    // Initialize embedder pool
    this.embedderPool = new EmbedderPool({
      modelName: 'Xenova/multilingual-e5-small',
      poolSize: 4,
      maxFilesBeforeRestart: 5000,
      maxMemoryMB: 1500
    });

    // Initialize the pool
    await this.embedderPool.initialize();
    logger.log('MODEL', 'Embedder pool started');
  }

  async checkModel(): Promise<boolean> {
    logger.log('MODEL', 'Checking for model...');
    
    try {
      const exists = await checkModelExists(this.userDataPath);
      this.modelReady = exists;
      
      if (exists) {
        logger.log('MODEL', 'Model found');
      } else {
        logger.log('MODEL', 'Model not found');
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
        this.modelReady = true;
        logger.log('MODEL', 'Model download completed');
        return;
      }
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
    
    throw new Error('Model download timeout');
  }

  async embed(texts: string[], isQuery: boolean = false): Promise<number[][]> {
    if (!this.embedderPool) {
      throw new Error('Embedder pool not initialized');
    }

    if (!this.modelReady) {
      throw new Error('Model not ready');
    }

    try {
      const embeddings = await this.embedderPool.embed(texts, isQuery);
      return embeddings;
    } catch (error) {
      logger.error('MODEL', 'Embedding error:', error);
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
    this.modelReady = false;
  }

  isReady(): boolean {
    return this.modelReady && this.embedderPool !== null;
  }

  getModelPath(): string {
    return path.join(this.userDataPath, 'models', 'Xenova', 'multilingual-e5-small');
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