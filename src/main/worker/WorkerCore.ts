/**
 * WorkerCore - Main coordinator for worker services
 *
 * This class integrates all worker services and handles messages
 * from the main process.
 */

import { parentPort } from 'node:worker_threads';
import * as fs from 'node:fs';
import * as path from 'node:path';
import type { IWorkerCore } from './types/interfaces';
import { DatabaseService } from './services/database-service';
import { FileWatcherService } from './services/file-watcher-service';
import { QueueService } from './services/queue-service';
import { ConfigService } from './services/config-service';
import { ModelService } from './services/model-service';
import { logger } from '../../shared/utils/logger';
import { FileScanner } from './fileScanner';
import { ReindexOrchestrator } from './ReindexOrchestrator';
import { PipelineStatusFormatter } from './PipelineStatusFormatter';
import type { FileStatus } from './fileStatusManager';
import { migrateIndexedFilesToStatus } from './migrateFileStatus';

export class WorkerCore implements IWorkerCore {
  private db: DatabaseService;
  private watcher: FileWatcherService;
  private queue: QueueService;
  private config: ConfigService;
  private model: ModelService;
  private fileStatusCache: Map<string, FileStatus> = new Map();
  private scanner: FileScanner | null = null;
  private reindexOrchestrator: ReindexOrchestrator | null = null;
  private statusInterval: NodeJS.Timeout | null = null;
  private status = {
    ready: false,
    modelReady: false,
    filesLoaded: false
  };

  constructor() {
    this.db = new DatabaseService();
    this.watcher = new FileWatcherService();
    this.queue = new QueueService();
    this.config = new ConfigService();
    this.model = new ModelService();

    // Set up queue processor
    this.queue.setProcessCallback(this.indexFile.bind(this));

    // Set up watcher event handlers
    this.watcher.on('add', (filePath) => this.handleFileAdd(filePath));
    this.watcher.on('change', (filePath) => this.handleFileChange(filePath));
    this.watcher.on('unlink', (filePath) => this.handleFileUnlink(filePath));

    // Set up queue event handlers
    this.queue.on('processed', () => this.sendProgress());
    this.queue.on('error', () => this.sendProgress());
  }

  async initialize(dbDir: string, userDataPath: string): Promise<void> {
    logger.log('WORKER', 'Starting worker initialization...');
    const startTime = Date.now();

    try {
      // Fast initialization - get ready ASAP
      await this.initializeFast(dbDir, userDataPath);
      
      // Signal ready
      this.status.ready = true;
      this.sendMessage('ready', {});

      // Start pipeline status reporting
      this.startPipelineStatusReporting();

      const elapsed = Date.now() - startTime;
      logger.log('WORKER', `Worker ready in ${elapsed}ms`);

      // Continue with slow initialization in background
      this.initializeSlow(userDataPath).catch(err => {
        logger.error('WORKER', 'Background initialization error:', err);
      });
    } catch (error) {
      logger.error('WORKER', 'Initialization error:', error);
      throw error;
    }
  }

  async initializeFast(dbDir: string, userDataPath: string): Promise<void> {
    // Create necessary directories
    fs.mkdirSync(dbDir, { recursive: true });
    fs.mkdirSync(path.join(userDataPath, 'models'), { recursive: true });

    // Load config
    this.config.load(dbDir);

    // Connect to database
    await this.db.connect(dbDir);

    // Initialize scanner and orchestrator
    this.scanner = new FileScanner();
    this.reindexOrchestrator = new ReindexOrchestrator();

    // Initialize model service (but don't wait for model check)
    this.model.initialize(userDataPath).catch(err => {
      logger.error('WORKER', 'Model initialization error:', err);
    });
  }

  async initializeSlow(_userDataPath: string): Promise<void> {
    logger.log('WORKER', 'Starting background initialization...');
    const startTime = Date.now();

    try {
      // Load file status cache
      this.fileStatusCache = await this.db.loadFileStatusCache();
      logger.log('WORKER', `Loaded ${this.fileStatusCache.size} file status records`);

      // Check for model
      const modelExists = await this.model.checkModel();
      this.status.modelReady = modelExists;
      this.sendMessage('model:ready', { ready: modelExists });

      // Start file watcher with cache
      const watchedFolders = this.config.getWatchedFolders();
      if (watchedFolders.length > 0) {
        const excludePatterns = this.config.getEffectiveExcludePatterns();
        await this.watcher.start(watchedFolders, excludePatterns, this.fileStatusCache);
      }

      // Migrate existing files if needed
      if (this.db.getFileStatusTable()) {
        const migrated = await migrateIndexedFilesToStatus(
          this.db.getChunksTable(),
          this.db.getFileStatusTable(),
          new Map()
        );
        if (migrated > 0) {
          logger.log('WORKER', `Migrated ${migrated} files to status table`);
        }
      }

      this.status.filesLoaded = true;
      this.sendMessage('files:loaded', {});

      const elapsed = Date.now() - startTime;
      logger.log('WORKER', `Background initialization completed in ${elapsed}ms`);
    } catch (error) {
      logger.error('WORKER', 'Background initialization error:', error);
    }
  }

  async handleMessage(type: string, payload: any): Promise<any> {
    logger.log('WORKER', `Handling message: ${type}`);

    switch (type) {
      case 'checkModel':
        const exists = await this.model.checkModel();
        return { exists };

      case 'downloadModel':
        await this.model.downloadModel();
        this.status.modelReady = true;
        return { success: true };

      case 'watchStart':
        const { roots, options } = payload;
        this.config.setWatchedFolders(roots);
        if (options?.settings) {
          this.config.updateSettings(options.settings);
        }
        const excludePatterns = this.config.getEffectiveExcludePatterns();
        await this.watcher.start(roots, excludePatterns, this.fileStatusCache);
        return { success: true };

      case 'enqueue':
        this.queue.add(payload.paths);
        this.queue.process().catch(err => {
          logger.error('WORKER', 'Queue processing error:', err);
        });
        return { success: true };

      case 'pause':
        this.queue.pause();
        return { success: true };

      case 'resume':
        this.queue.resume();
        return { success: true };

      case 'progress':
        return this.queue.getStats();

      case 'search':
        return await this.search(payload.q, payload.k);

      case 'stats':
        const watchedFolders = this.config.getWatchedFolders();
        return await this.db.getStats(watchedFolders);

      case 'getWatchedFolders':
        return this.config.getWatchedFolders();

      case 'getSettings':
        return this.config.getSettings();

      case 'updateSettings':
        this.config.updateSettings(payload);
        return { success: true };

      case 'reindexAll':
        return await this.reindexAll();

      case 'searchFiles':
        return await this.searchFiles(payload);

      default:
        logger.warn('WORKER', `Unknown message type: ${type}`);
        return { error: `Unknown message type: ${type}` };
    }
  }

  async shutdown(): Promise<void> {
    logger.log('WORKER', 'Shutting down...');

    // Stop status reporting
    if (this.statusInterval) {
      clearInterval(this.statusInterval);
      this.statusInterval = null;
    }

    // Stop services
    this.queue.clear();
    await this.watcher.stop();
    await this.model.shutdown();
    await this.db.disconnect();

    logger.log('WORKER', 'Shutdown complete');
  }

  getStatus(): {
    ready: boolean;
    modelReady: boolean;
    filesLoaded: boolean;
  } {
    return { ...this.status };
  }

  // Private helper methods
  private async indexFile(filePath: string): Promise<void> {
    try {
      // Process the file (simplified version - would need full implementation)
      const result = await this.processFileInternal(filePath);

      if (!result.success) {
        throw new Error(result.error || 'Unknown error');
      }

      // Update file status
      await this.db.updateFileStatus(
        filePath,
        'indexed',
        '',
        result.chunks?.length || 0,
        result.parserVersion || 0
      );
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      await this.db.updateFileStatus(filePath, 'error', errorMsg);
      throw error;
    }
  }

  private handleFileAdd(filePath: string): void {
    if (!this.config.isFileTypeEnabled(path.extname(filePath))) {
      return;
    }
    this.queue.add([filePath]);
    this.queue.process().catch(err => {
      logger.error('WORKER', 'Queue processing error:', err);
    });
  }

  private handleFileChange(filePath: string): void {
    if (!this.config.isFileTypeEnabled(path.extname(filePath))) {
      return;
    }
    // Delete old chunks and re-index
    this.db.deleteChunksForFile(filePath).then(() => {
      this.queue.add([filePath]);
      this.queue.process().catch(err => {
        logger.error('WORKER', 'Queue processing error:', err);
      });
    });
  }

  private handleFileUnlink(filePath: string): void {
    // Delete chunks for deleted file
    this.db.deleteChunksForFile(filePath).catch(err => {
      logger.error('WORKER', 'Error deleting chunks:', err);
    });
    // Update file status
    this.db.updateFileStatus(filePath, 'outdated').catch(err => {
      logger.error('WORKER', 'Error updating file status:', err);
    });
  }

  private async search(query: string, k: number): Promise<any[]> {
    if (!this.status.modelReady) {
      return [];
    }

    try {
      const queryEmbedding = await this.model.embed([query], true);
      const table = this.db.getChunksTable();
      const results = await table
        .search(queryEmbedding[0])
        .metricType('cosine')
        .limit(k)
        .toArray();
      return results;
    } catch (error) {
      logger.error('WORKER', 'Search error:', error);
      return [];
    }
  }

  private async searchFiles(query: string): Promise<{ path: string; name: string }[]> {
    const allFiles = await this.db.queryFiles(100000);
    const queryLower = query.toLowerCase();
    
    const matches = allFiles
      .filter(f => path.basename(f.path).toLowerCase().includes(queryLower))
      .slice(0, 20)
      .map(f => ({
        path: f.path,
        name: path.basename(f.path)
      }));
    
    return matches;
  }

  private async reindexAll(): Promise<any> {
    if (!this.reindexOrchestrator) {
      throw new Error('Reindex orchestrator not initialized');
    }

    const watchedFolders = this.config.getWatchedFolders();
    if (watchedFolders.length === 0) {
      return { message: 'No folders to reindex' };
    }

    // Clear existing data for watched folders
    // await this.reindexOrchestrator.clearFoldersData(watchedFolders);

    // Scan for all files
    if (this.scanner) {
      // Scan for files (simplified - would need full implementation)
      const filesToIndex: string[] = [];
      // In a real implementation, we would:
      // 1. Walk the directories
      // 2. Use FileScanner.filterSupportedFiles
      // 3. Use FileScanner.categorizeFiles
      logger.log('WORKER', `Found ${filesToIndex.length} files to reindex`);

      // Queue all files
      this.queue.add(filesToIndex);
      this.queue.process().catch(err => {
        logger.error('WORKER', 'Queue processing error:', err);
      });

      return {
        message: `Started reindexing ${filesToIndex.length} files`,
        count: filesToIndex.length
      };
    }

    return { error: 'Scanner not initialized' };
  }

  private sendMessage(type: string, payload: any): void {
    if (parentPort) {
      parentPort.postMessage({ type, payload });
    }
  }

  private sendProgress(): void {
    const stats = this.queue.getStats();
    this.sendMessage('progress', stats);
  }

  private startPipelineStatusReporting(): void {
    // Send pipeline status every 10 seconds when there's activity
    this.statusInterval = setInterval(() => {
      const fileStats = this.queue.getStats();
      const hasActivity = fileStats.queued > 0 || fileStats.processing > 0;

      if (hasActivity) {
        // Get embedding queue stats (simplified for now)
        const embeddingStats = {
          queueDepth: 0,
          processingBatches: 0,
          isProcessing: false,
          trackedFiles: 0,
          backpressureActive: false
        };

        // Get embedder stats from model service
        const embedderStats = this.model.getEmbedderStats();

        // Format pipeline status with correct stats format
        const pipelineStatus = PipelineStatusFormatter.formatPipelineStatus({
          fileStats: {
            queued: fileStats.queued,
            processing: fileStats.processing,
            completed: fileStats.done,
            failed: fileStats.errors
          },
          embeddingStats,
          embedderStats: embedderStats.map((s: any) => ({
            id: 'embedder-' + Math.random().toString(36).substr(2, 9),
            filesProcessed: s.filesProcessed,
            memoryUsage: s.memoryUsage,
            isHealthy: s.isHealthy,
            loadCount: 0,
            restartCount: 0
          })),
          processingFiles: [],
          fileTrackers: new Map(),
          maxConcurrent: 5
        });

        // Log to worker console (for terminal/logs)
        // Pipeline status is always visible (doesn't need category check)
        console.log(pipelineStatus);

        // Send to main process
        this.sendMessage('pipeline:status', pipelineStatus);
      }
    }, 10000);
  }

  // Simplified file processing (would need full implementation)
  private async processFileInternal(filePath: string): Promise<{ success: boolean; chunks?: any[]; error?: string; parserVersion?: number }> {
    try {
      // This is a simplified placeholder - actual implementation would:
      // 1. Read and parse the file based on extension
      // 2. Create text chunks
      // 3. Generate embeddings
      // 4. Store in database
      logger.log('WORKER', `Processing file: ${filePath}`);

      // For now, just return success
      return { success: true, chunks: [], parserVersion: 1 };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error)
      };
    }
  }
}