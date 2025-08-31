import path from 'node:path';
import { IEmbedder, EmbedderConfig } from './IEmbedder';
import { EmbedderManager } from '../../main/utils/EmbedderManager';

/**
 * IsolatedEmbedder using production-ready EmbedderManager
 * Provides automatic memory management and restart capabilities
 */
export class IsolatedEmbedder implements IEmbedder {
  private manager: EmbedderManager;
  private modelName: string;
  private initPromise: Promise<void> | null = null;

  constructor(modelName = 'Xenova/multilingual-e5-small', config?: EmbedderConfig) {
    this.modelName = modelName;
    
    // Get paths for embedder script and model cache
    const childPath = process.env.NODE_ENV === 'production' && process.resourcesPath
      ? path.join(process.resourcesPath, 'app.asar', 'dist', 'embedder.child.cjs')
      : path.join(__dirname, 'embedder.child.cjs');
    
    const userDataPath = process.env.USER_DATA_PATH || path.join(require('os').homedir(), '.offline-search');
    const modelCachePath = path.join(userDataPath, 'models');
    
    // Create EmbedderManager with production settings
    this.manager = new EmbedderManager(childPath, modelName, modelCachePath);
    
    // Note: EmbedderManager has fixed thresholds for production reliability
    // config parameters are accepted for compatibility but not applied
  }
  
  public async initialize(): Promise<boolean> {
    // Start the embedder manager
    await this.manager.start();
    await this.manager.waitForReady();
    return true;
  }

  async embed(texts: string[], isQuery = false): Promise<number[][]> {
    // Use manager's embed method which handles retries and restarts
    const vectors = await this.manager.embed(texts.map(text => 
      isQuery ? `query: ${text}` : `passage: ${text}`
    ));
    
    // Convert Float32Array[] to number[][]
    return vectors.map(vec => Array.from(vec));
  }

  /**
   * Embed text with retry logic (now handled by EmbedderManager)
   */
  async embedWithRetry(texts: string[], maxRetries = 3): Promise<number[][]> {
    // EmbedderManager already handles retries internally
    return this.embed(texts);
  }

  /**
   * Check if the embedder should restart
   */
  shouldRestart(): boolean {
    // Delegate to manager's internal logic
    const fileCount = this.manager.getFilesSinceSpawn();
    return fileCount >= 200; // Manager handles this internally
  }

  /**
   * Restart the embedder
   */
  async restart(): Promise<void> {
    await this.manager.restart();
  }

  /**
   * Get embedder statistics
   */
  getStats() {
    const filesSinceSpawn = this.manager.getFilesSinceSpawn();
    const isReady = this.manager.isReady();
    const memoryUsage = process.memoryUsage();
    
    return {
      filesSinceSpawn,
      isReady,
      memoryUsage: {
        rss: Math.round(memoryUsage.rss / 1024 / 1024),
        heapUsed: Math.round(memoryUsage.heapUsed / 1024 / 1024),
        external: Math.round(memoryUsage.external / 1024 / 1024)
      }
    };
  }

  async checkMemoryAndRestart(): Promise<boolean> {
    // Manager checks both memory and file count internally
    await this.manager.checkAndRestartIfNeeded();
    return false; // Manager handles restart internally
  }

  async shutdown(): Promise<void> {
    await this.manager.shutdown();
  }

  // Expose filesSinceSpawn for compatibility
  get filesSinceSpawn(): number {
    return this.manager.getFilesSinceSpawn();
  }
}

// Singleton instance - ensure only one exists globally
let embedder: IsolatedEmbedder | null = null;
let embedderInitializing = false;
let embedderInitPromise: Promise<void> | null = null;

export async function embed(texts: string[], isQuery = false): Promise<number[][]> {
  // If embedder doesn't exist and not already initializing, create it
  if (!embedder && !embedderInitializing) {
    embedderInitializing = true;
    // Use production settings with EmbedderManager
    embedder = new IsolatedEmbedder('Xenova/multilingual-e5-small', {
      maxFilesBeforeRestart: 200,  // EmbedderManager default
      maxMemoryMB: 300  // External memory threshold
    });
    embedderInitPromise = embedder.initialize().then(() => {
      embedderInitializing = false;
      embedderInitPromise = null;
    }).catch((err) => {
      embedderInitializing = false;
      embedderInitPromise = null;
      embedder = null;
      throw err;
    });
  }
  
  // Wait for initialization if in progress
  if (embedderInitPromise) {
    await embedderInitPromise;
  }
  
  // If still no embedder after waiting, try once more
  if (!embedder) {
    embedder = new IsolatedEmbedder('Xenova/multilingual-e5-small', {
      maxFilesBeforeRestart: 200,
      maxMemoryMB: 300
    });
    await embedder.initialize();
  }
  
  return embedder.embed(texts, isQuery);
}

export async function checkEmbedderMemory(): Promise<boolean> {
  if (embedder) {
    return embedder.checkMemoryAndRestart();
  }
  return false;
}

export async function shutdownEmbedder(): Promise<void> {
  if (embedder) {
    await embedder.shutdown();
    embedder = null;
  }
}