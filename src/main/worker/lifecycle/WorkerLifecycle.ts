import * as fs from 'node:fs';
import * as path from 'node:path';
import * as lancedb from '@lancedb/lancedb';
import { logger } from '../../../shared/utils/logger';
import { WorkerStartup } from '../WorkerStartup';
import { ConfigManager } from '../config';
import { StatsCache } from '../cache/StatsCache';
import { ReindexService } from '../../services/ReindexService';
import { EmbeddingQueue } from '../../core/embedding/EmbeddingQueue';
import type { PythonSidecarEmbedder } from '../embeddings/PythonSidecarEmbedder';
import type { PythonSidecarService } from '../PythonSidecarService';
import { initializeFileStatusTable } from '../../core/indexing/fileStatusManager';
import { migrateIndexedFilesToStatus } from '../migrateFileStatus';
import { migrateDatabaseIfNeeded, writeDatabaseVersion } from '../database/migration';
import { getFileHash } from '../utils/fileUtils';
import { getStats, type FolderStats, type DatabaseStats } from '../search';
import { setupProfiling } from '../profiling-integration';
import { createStageMessage, type StartupStage } from '../../../shared/types/startup';
import { createBatchProcessor, type WriteQueueState } from '../batch/processor';
import { WorkerState, isValidTransition, canHandleMessage as checkCanHandleMessage } from './states';

/**
 * Callback for emitting stage progress events
 */
export type StageProgressEmitter = (stage: StartupStage, message?: string, progress?: number) => void;

/**
 * Worker lifecycle dependencies
 */
export interface WorkerLifecycleDeps {
  /** Callback to emit stage progress */
  emitStageProgress: StageProgressEmitter;
  /** Write queue state for batch processor */
  writeQueueState: WriteQueueState;
  /** Map of file hashes (shared with worker) */
  fileHashes: Map<string, string>;
  /** Map of folder stats (shared with worker) */
  folderStats: Map<string, FolderStats>;
  /** Function to start watching folders */
  startWatching: (folders: string[], excludePatterns: string[]) => Promise<void>;
}

/**
 * Worker lifecycle state machine
 *
 * Orchestrates the entire worker initialization sequence:
 * 1. Start Python sidecar
 * 2. Initialize database
 * 3. Load existing files
 * 4. Create embedding queue
 * 5. Scan folders
 * 6. Emit ready signal
 */
export class WorkerLifecycle {
  private state: WorkerState = WorkerState.UNINITIALIZED;

  // Core services
  private workerStartup: WorkerStartup | null = null;
  private configManager: ConfigManager | null = null;
  private statsCache: StatsCache;
  private reindexService: ReindexService | null = null;

  // Database handles
  private db: any = null;
  private tbl: any = null;
  private fileStatusTable: any = null;

  // Embedding services
  private sidecarEmbedder: PythonSidecarEmbedder | null = null;
  private sidecarService: PythonSidecarService | null = null;
  private embeddingQueue: EmbeddingQueue | null = null;

  // Dependencies
  private deps: WorkerLifecycleDeps;

  constructor(deps: WorkerLifecycleDeps) {
    this.deps = deps;
    this.statsCache = new StatsCache();
  }

  /**
   * Initialize the worker with full startup sequence
   */
  async initialize(dbDir: string, userDataPath: string): Promise<boolean> {
    try {
      // Phase 1: Start Python sidecar
      await this.initializeSidecar();

      // Phase 2: Initialize database
      await this.initializeDatabase(dbDir, userDataPath);

      // Phase 3: Create embedding queue
      await this.initializeEmbeddingQueue();

      // Phase 4: Start folder watching
      await this.startFolderWatching();

      // Phase 5: Setup profiling
      setupProfiling();

      // Phase 6: Ready!
      this.transition(WorkerState.READY);
      this.deps.emitStageProgress('ready', 'Ready');
      logger.log('WORKER', 'Worker ready');

      return true;
    } catch (error) {
      logger.error('WORKER-LIFECYCLE', 'Initialization failed:', error);
      this.transition(WorkerState.ERROR);
      return false;
    }
  }

  /**
   * Phase 1: Initialize Python sidecar
   */
  private async initializeSidecar(): Promise<void> {
    this.transition(WorkerState.STARTING_SIDECAR);

    this.workerStartup = new WorkerStartup();
    this.sidecarEmbedder = await this.workerStartup.initialize(undefined);

    if (!this.sidecarEmbedder) {
      throw new Error('Failed to initialize Python sidecar embedder');
    }

    this.sidecarService = this.workerStartup.getSidecarService();
    this.transition(WorkerState.SIDECAR_READY);

    logger.log('WORKER-LIFECYCLE', 'Python sidecar initialized');
  }

  /**
   * Phase 2: Initialize database
   */
  private async initializeDatabase(dir: string, userDataPath: string): Promise<void> {
    this.transition(WorkerState.INITIALIZING_DB);

    this.deps.emitStageProgress('db_init', 'Checking database version');

    // Check database version and migrate if needed
    const migrated = await migrateDatabaseIfNeeded(dir);
    if (migrated) {
      // Clear fileHashes to force re-indexing after migration
      this.deps.fileHashes.clear();
    }

    this.deps.emitStageProgress('db_init', 'Initializing config manager');
    this.configManager = new ConfigManager(dir);

    this.deps.emitStageProgress('db_init', 'Connecting to database');
    this.db = await lancedb.connect(dir);

    // nomic-embed-text model uses 768-dimensional vectors
    const EXPECTED_VECTOR_DIMENSION = 768;

    this.tbl = await this.db.openTable('chunks').catch(async () => {
      // Create table with initial schema
      const initialData = [{
        id: 'init',
        path: '',
        mtime: 0,
        page: 0,
        offset: 0,
        text: '',
        vector: new Array(EXPECTED_VECTOR_DIMENSION).fill(0),
        type: 'init',
        title: ''
      }];

      const table = await this.db.createTable('chunks', initialData, {
        mode: 'create'
      });

      // Delete the initialization record
      try {
        await table.delete('id = "init"');
      } catch (e: any) {
        logger.log('DATABASE', 'Could not delete init record (may not exist):', e?.message || e);
      }

      return table;
    });

    logger.log('DATABASE', 'Database initialized');

    // Write database version marker
    await writeDatabaseVersion(dir);

    this.deps.emitStageProgress('db_init', 'Creating file status table');
    try {
      this.fileStatusTable = await initializeFileStatusTable(this.db);
    } catch (e) {
      logger.error('FILE-STATUS', 'Failed to initialize file status table:', e);
      this.fileStatusTable = null;
    }

    this.transition(WorkerState.DB_READY);

    // Initialize folderStats early from config
    const configForFolders = await this.configManager!.getConfig();
    const foldersToWatch = configForFolders.watchedFolders || [];
    for (const folder of foldersToWatch) {
      this.deps.folderStats.set(folder, { total: 0, indexed: 0 });
    }
    logger.log('WATCHER', `Pre-initialized folderStats for ${foldersToWatch.length} folders`);

    // Pre-calculate and cache stats
    this.deps.emitStageProgress('db_load', 'Calculating stats...');
    try {
      const stats = await this.statsCache.get(() =>
        getStats(this.tbl, this.deps.fileHashes, this.deps.folderStats, this.fileStatusTable)
      );
      logger.log('DATABASE', `Stats pre-calculated: ${stats.indexedFiles} files, ${stats.folderStats.length} folders`);
    } catch (error) {
      logger.error('DATABASE', 'Failed to pre-calculate stats:', error);
    }

    // Load existing indexed files
    await this.loadExistingFiles();

    // Initialize ReindexService
    this.reindexService = new ReindexService(this.fileStatusTable, {
      log: (msg: string) => logger.log('REINDEX', msg),
      error: (msg: string, error?: any) => logger.error('REINDEX', msg, error)
    });

    // Migrate existing indexed files to file status table
    if (this.fileStatusTable) {
      const migrated = await migrateIndexedFilesToStatus(this.tbl, this.fileStatusTable, this.deps.fileHashes);
      if (migrated > 0) {
        logger.log('FILE-STATUS', `Created ${migrated} missing file status records`);
      }
    }

    logger.log('WORKER-LIFECYCLE', 'Database initialized');
  }

  /**
   * Load existing indexed files from database
   */
  private async loadExistingFiles(): Promise<void> {
    this.transition(WorkerState.LOADING_FILES);
    this.deps.emitStageProgress('db_load', 'Loading existing indexed files');

    try {
      // Get all unique file paths from the index
      const allRows = await this.tbl.query()
        .select(['path'])
        .limit(100000)
        .toArray();

      // Build fileHashes map from existing index
      const uniquePaths = new Set<string>();
      allRows.forEach((row: any) => {
        if (row.path) {
          uniquePaths.add(row.path);
        }
      });

      let processed = 0;
      const total = uniquePaths.size;
      for (const filePath of uniquePaths) {
        try {
          await fs.promises.access(filePath);
          const hash = await getFileHash(filePath);
          this.deps.fileHashes.set(filePath, hash);
        } catch (_e) {
          // File doesn't exist, skip
        }
        processed++;
        // Report progress every 100 files or at the end
        if (processed % 100 === 0 || processed === total) {
          const progress = Math.round((processed / total) * 100);
          this.deps.emitStageProgress('db_load', `Loaded ${processed}/${total} files`, progress);
        }
      }

      logger.log('DATABASE', `Loaded ${this.deps.fileHashes.size} existing indexed files`);
    } catch (_e) {
      logger.log('DATABASE', 'No existing files in index');
    }
  }

  /**
   * Phase 3: Initialize embedding queue
   */
  private async initializeEmbeddingQueue(): Promise<void> {
    if (!this.sidecarEmbedder) {
      throw new Error('Cannot initialize embedding queue: sidecar embedder not ready');
    }

    if (!this.configManager) {
      throw new Error('Cannot initialize embedding queue: config manager not ready');
    }

    const settings = this.configManager.getSettings();
    const batchSize = settings?.embeddingBatchSize ?? 32;

    this.embeddingQueue = new EmbeddingQueue({
      maxQueueSize: 2000,
      batchSize,
      maxTokensPerBatch: 7000, // Safe limit with ~1K buffer to prevent EOF errors
      backpressureThreshold: 1000,
      onProgress: (filePath: string, processed: number, total: number) => {
        logger.log('EMBEDDING', `Progress: ${path.basename(filePath)} - ${processed}/${total} chunks`);
      },
      onFileComplete: (filePath: string) => {
        logger.log('EMBEDDING', `✅ Completed: ${path.basename(filePath)}`);
      }
    });

    // Initialize with batch processor using sidecar embedder
    this.embeddingQueue.initialize(
      this.sidecarEmbedder,
      createBatchProcessor(this.tbl, this.deps.writeQueueState)
    );

    logger.log('WORKER-LIFECYCLE', 'Embedding queue initialized');
  }

  /**
   * Phase 4: Start folder watching
   */
  private async startFolderWatching(): Promise<void> {
    this.transition(WorkerState.SCANNING_FOLDERS);

    if (!this.configManager) {
      throw new Error('Cannot start folder watching: config manager not ready');
    }

    const config = await this.configManager.getConfig();
    const savedFolders = config.watchedFolders || [];

    if (savedFolders.length > 0) {
      this.deps.emitStageProgress('folder_scan', `Scanning ${savedFolders.length} folder(s)`);
      logger.log('WATCHER', 'Auto-starting watch on saved folders:', savedFolders);
      await this.deps.startWatching(
        savedFolders,
        config.settings?.excludePatterns || ['node_modules', '.git', '*.tmp', '.DS_Store']
      );
    } else {
      logger.log('WATCHER', 'No saved folders to watch');
      this.deps.emitStageProgress('folder_scan', 'No folders to scan');
    }

    logger.log('WORKER-LIFECYCLE', 'Folder watching started');
  }

  /**
   * Transition to a new state with validation
   */
  private transition(newState: WorkerState): void {
    const oldState = this.state;

    // Validate transition
    if (!isValidTransition(oldState, newState)) {
      throw new Error(`Invalid state transition from ${oldState} to ${newState}`);
    }

    this.state = newState;
    logger.log('WORKER-LIFECYCLE', `State transition: ${oldState} → ${newState}`);
  }

  /**
   * Check if a message can be handled in the current state
   */
  canHandleMessage(messageType: string): boolean {
    return checkCanHandleMessage(this.state, messageType);
  }

  /**
   * Get current state
   */
  getState(): WorkerState {
    return this.state;
  }

  /**
   * Check if worker is ready
   */
  isReady(): boolean {
    return this.state === WorkerState.READY;
  }

  // Getters for exposed services
  getDatabase() {
    return {
      db: this.db,
      tbl: this.tbl,
      fileStatusTable: this.fileStatusTable
    };
  }

  getEmbedder(): PythonSidecarEmbedder | null {
    return this.sidecarEmbedder;
  }

  getEmbeddingQueue(): EmbeddingQueue | null {
    return this.embeddingQueue;
  }

  getConfigManager(): ConfigManager | null {
    return this.configManager;
  }

  getStatsCache(): StatsCache {
    return this.statsCache;
  }

  getSidecarService(): PythonSidecarService | null {
    return this.sidecarService;
  }

  getReindexService(): ReindexService | null {
    return this.reindexService;
  }
}
