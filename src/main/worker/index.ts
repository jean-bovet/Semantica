import { parentPort } from 'node:worker_threads';
import * as lancedb from '@lancedb/lancedb';
import { getParserVersion } from './parserVersions';
import { ReindexService } from '../services/ReindexService';
import { ConcurrentQueue } from '../core/embedding/ConcurrentQueue';
import {
  initializeFileStatusTable
} from '../core/indexing/fileStatusManager';
import { migrateIndexedFilesToStatus } from './migrateFileStatus';
import { ReindexOrchestrator } from '../core/reindex/ReindexOrchestrator';
import { FileScanner } from '../core/indexing/fileScanner';
import type { ScanConfig as FileScannerConfig } from '../core/indexing/fileScanner';
import { FolderRemovalManager } from '../core/reindex/FolderRemovalManager';
import { calculateOptimalConcurrency, getConcurrencyMessage } from './cpuConcurrency';
import { setupProfiling, profileHandleFile, recordEvent, profiler } from './profiling-integration';
import { PipelineStatusFormatter } from '../services/PipelineService';
import { logger } from '../../shared/utils/logger';
import {
  type StartupStage,
  createStageMessage
} from '../../shared/types/startup';
import { shouldRestartEmbedder, bytesToMB } from '../utils/embedder-health';

// Extracted modules
import { getFileHash, isInsideBundle } from './utils/fileUtils';
import { WorkerLifecycle } from './lifecycle/WorkerLifecycle';
import {
  checkDatabaseVersion,
  migrateDatabaseIfNeeded,
  writeDatabaseVersion,
  DB_VERSION,
  DB_VERSION_FILE
} from './database/migration';
import {
  mergeRows,
  processWriteQueue,
  deleteByPath,
  maybeCreateIndex,
  createWriteQueueState,
  type WriteQueueState
} from './database/operations';
import { updateFileStatus } from './fileStatus';
import { processBatchToRows, createBatchProcessor } from './batch/processor';
import { search, getStats, type FolderStats, type DatabaseStats } from './search';
import { performGracefulShutdown } from './shutdown/orchestrator';

// Load mock setup if in test mode with mocks enabled
// This must happen before any other code that might use fetch
if (process.env.E2E_MOCK_DOWNLOADS === 'true') {
  // Use require for synchronous loading to ensure mocks are ready before any fetch calls
  try {
    const { setupModelDownloadMocks } = require('../../../tests/mocks/setupModelMocks');
    setupModelDownloadMocks();
  } catch (err) {
    logger.error('WORKER', 'Failed to load mock setup:', err);
  }
}

// Create folder removal manager instance
const folderRemovalManager = new FolderRemovalManager();

// Helper to emit startup stage progress
function emitStageProgress(stage: StartupStage, message?: string, progress?: number) {
  // Use type-safe message builder for consistency
  const stageMessage = createStageMessage(stage, message, progress);
  parentPort?.postMessage(stageMessage);
  logger.log('STARTUP', `Stage: ${stage}${message ? ` - ${message}` : ''}${progress !== undefined ? ` (${progress}%)` : ''}`);
}

// Monitor memory usage
let fileCount = 0;
// Track previous memory values to avoid redundant logging
let lastMemoryLog = {
  rssMB: 0,
  heapMB: 0,
  heapTotalMB: 0,
  extMB: 0,
  fileCount: 0
};

// Memory monitoring and governor
let memoryMonitorInterval: NodeJS.Timeout | null = null;
memoryMonitorInterval = setInterval(async () => {
  const usage = process.memoryUsage();
  const rssMB = Math.round(usage.rss / 1024 / 1024);
  const heapMB = Math.round(usage.heapUsed / 1024 / 1024);
  const heapTotalMB = Math.round(usage.heapTotal / 1024 / 1024);
  const extMB = Math.round(usage.external / 1024 / 1024);
  
  // Only log if there's a significant change (>10MB RSS, >5MB Heap, or file count changed)
  const rssChanged = Math.abs(rssMB - lastMemoryLog.rssMB) > 10;
  const heapChanged = Math.abs(heapMB - lastMemoryLog.heapMB) > 5;
  const filesChanged = fileCount !== lastMemoryLog.fileCount;
  
  if (rssChanged || heapChanged || filesChanged) {
    logger.log('MEMORY', `RSS=${rssMB}MB, Heap=${heapMB}MB/${heapTotalMB}MB, External=${extMB}MB, Files processed: ${fileCount}`);
    lastMemoryLog = { rssMB, heapMB, heapTotalMB, extMB, fileCount };
  }
  
  // Log enhanced pipeline status (always show when there's activity)
  const fileStats = fileQueue.getStats();
  const hasActivity = fileStats.queued > 0 || fileStats.processing > 0 || fileStats.completed > 0;

  if (hasActivity) {
    const embeddingStats = embeddingQueue ? embeddingQueue.getStats() : {
      queueDepth: 0,
      processingBatches: 0,
      isProcessing: false,
      trackedFiles: 0,
      backpressureActive: false
    };

    // Python sidecar embedder stats (simplified - no pool management needed)
    const embedderStats = sidecarEmbedder ? [{
      id: 'sidecar-0',
      filesProcessed: sidecarEmbedder.getStats().filesSinceSpawn,
      memoryUsage: 0, // Sidecar manages its own memory
      isHealthy: sidecarEmbedder.getStats().isReady,
      loadCount: 0, // Not applicable for sidecar
      restartCount: 0 // Sidecar doesn't restart like old embedders
    }] : [];
    const processingFiles = fileQueue.getProcessingFiles();
    const fileTrackers = embeddingQueue ? embeddingQueue.getFileTrackers() : new Map();
    const maxConcurrent = fileQueue.getCurrentMaxConcurrent();

    const pipelineStatus = PipelineStatusFormatter.formatPipelineStatus({
      fileStats,
      embeddingStats,
      embedderStats,
      processingFiles,
      fileTrackers,
      maxConcurrent,
      optimalConcurrent: concurrencySettings.optimal
    });

    // Send to main process for logging and Electron dev console
    // The main process will handle logging with proper category filtering
    parentPort?.postMessage({
      type: 'pipeline:status',
      payload: pipelineStatus
    });
  }

  // Python sidecar manages its own memory and lifecycle
}, 2000);

import { getParserForExtension, getEnabledExtensions } from '../parsers/registry';
import { chunkText } from '../pipeline/chunker';

// PDF parsing is optional - will handle it if available
let parsePdf: any = null;
try {
  parsePdf = require('../parsers/pdf').parsePdf;
} catch (_e) {
  logger.log('STARTUP', 'PDF parsing not available');
}
// Use Python sidecar embedder for better reliability
import { PythonSidecarEmbedder } from './embeddings/PythonSidecarEmbedder';
import { PythonSidecarService } from './PythonSidecarService';
import { EmbeddingQueue } from '../core/embedding/EmbeddingQueue';
import { WorkerStartup } from './WorkerStartup'; // New state machine
import crypto from 'node:crypto';
import chokidar from 'chokidar';
import fs from 'node:fs';
import path from 'node:path';
import { ConfigManager } from './config';
import { scanDirectories, type ScanOptions } from '../core/indexing/directoryScanner';

let db: any = null;
// Worker lifecycle state machine
let lifecycle: WorkerLifecycle | null = null;

// Legacy module-level variables (for runtime, not initialization)
let modelReady: boolean | null = null; // Track if model is ready (null = not yet checked)
let paused = false;
let watcher: any = null;

// References to lifecycle services (populated after initialization)
let tbl: any = null;
let fileStatusTable: any = null;
let configManager: ConfigManager | null = null;
let sidecarEmbedder: PythonSidecarEmbedder | null = null;
let sidecarService: PythonSidecarService | null = null;
let embeddingQueue: EmbeddingQueue | null = null;
let reindexService: ReindexService | null = null;

// CPU-aware concurrency settings
const concurrencySettings = calculateOptimalConcurrency();
logger.log('PERFORMANCE', getConcurrencyMessage(concurrencySettings));

const fileQueue = new ConcurrentQueue({
  maxConcurrent: concurrencySettings.optimal,
  memoryThresholdMB: 800,
  throttledConcurrent: concurrencySettings.throttled,
  onProgress: (queued, processing) => {
    // Report progress to main process
    parentPort?.postMessage({
      type: 'progress',
      payload: {
        queued,
        processing,
        done: fileHashes.size,
        errors: 0
      }
    });
  },
  onMemoryThrottle: (newLimit, memoryMB) => {
    recordEvent(newLimit < concurrencySettings.optimal ? 'throttleStart' : 'throttleEnd'); // Track throttling
    logger.log('MEMORY', `Adjusting concurrency: ${newLimit} (RSS: ${Math.round(memoryMB)}MB)`);
  },
  shouldApplyBackpressure: () => {
    // Apply backpressure when embedding queue is getting full
    return embeddingQueue ? embeddingQueue.shouldApplyBackpressure() : false;
  }
});
const fileHashes = new Map<string, string>();
const writeQueueState = createWriteQueueState();
const folderStats = new Map<string, FolderStats>();

// Track if we've sent the files:loaded message
declare global {
  var filesLoadedSent: boolean | undefined;
}

// Database version is now imported from ./database/migration
// initDB function removed - now handled by WorkerLifecycle

// Health check for embedder pool
let healthCheckInterval: NodeJS.Timeout | null = null;

function startEmbedderHealthCheck() {
  // Ollama manages its own health, so no periodic health checks needed
  // (Legacy health check code for EmbedderPool removed)
}

// Original handleFile function (renamed for profiling wrapper)
async function handleFileOriginal(filePath: string) {
  try {
    fileCount++; // Track files processed
    logger.log('INDEXING', `Starting: ${filePath}`);
    
    try {
      await fs.promises.access(filePath);
    } catch (_e) {
      // File doesn't exist
      await deleteByPath(tbl, filePath);
      fileHashes.delete(filePath);
      await updateFileStatus(fileStatusTable, filePath, 'deleted', fileHashes);
      lifecycle?.getStatsCache().invalidate(); // Cache needs recalculation after file deletion
      return;
    }

    // Check if file is inside a bundle and bundle exclusion is enabled
    if (isInsideBundle(filePath, configManager)) {
      // Log only once per unique bundle path
      const bundlePatterns = configManager?.getSettings().bundlePatterns || [];
      const extensions = bundlePatterns
        .map(p => p.match(/\*\.([^/]+)/)?.[1])
        .filter(Boolean)
        .join('|');
      
      if (extensions) {
        const regex = new RegExp(`(.*\\.(${extensions}))`, 'i');
        const bundleMatch = filePath.match(regex);
        if (bundleMatch) {
          const bundlePath = bundleMatch[1];
          if (!fileHashes.has(bundlePath + '_logged')) {
            logger.log('INDEXING', `📦 Skipping bundle: ${bundlePath}`);
            fileHashes.set(bundlePath + '_logged', 'logged');
          }
        }
      }
      return;
    }
    
    const currentHash = await getFileHash(filePath);
    const previousHash = fileHashes.get(filePath);
    await fs.promises.stat(filePath);
    const ext = path.extname(filePath).slice(1).toLowerCase();
    const parserVersion = getParserVersion(ext);
    
    // Check if file needs reindexing due to parser version change
    let needsReindex = false;
    if (fileStatusTable) {
      try {
        const fileStatus = await fileStatusTable.query()
          .filter(`path = "${filePath}"`)
          .limit(1)
          .toArray();
        if (fileStatus.length > 0 && fileStatus[0].parser_version !== parserVersion) {
          needsReindex = true;
          logger.log('INDEXING', `🔄 Parser version changed for ${path.basename(filePath)}: v${fileStatus[0].parser_version} -> v${parserVersion}`);
        }
      } catch (_e) {
        // Ignore errors in checking file status
      }
    }
    
    if (!needsReindex && previousHash === currentHash) {
      logger.log('INDEXING', `⏭️ Skipped: ${path.basename(filePath)} - Already up-to-date`);
      return;
    }
    
    // Find parser for this file extension
    const parserEntry = getParserForExtension(ext);
    if (!parserEntry) {
      logger.log('INDEXING', `⏭️ Skipped: ${path.basename(filePath)} - No parser for .${ext}`);
      return;
    }
    
    const [parserKey, parserDef] = parserEntry;
    
    // Check if this file type is enabled
    const fileTypes = configManager?.getSettings().fileTypes || {};
    const isTypeEnabled = fileTypes[parserKey as keyof typeof fileTypes] ?? false;
    
    if (!isTypeEnabled) {
      logger.log('INDEXING', `⏭️ Skipped: ${path.basename(filePath)} - File type disabled`);
      return;
    }
    
    let chunks: Array<{ text: string; offset: number; page?: number }> = [];
    
    // Special handling for PDF (backward compatibility)
    if (ext === 'pdf' && parsePdf) {
      try {
        // Get OCR setting from config
        const enableOCR = configManager?.getSettings().enableOCR ?? false;
        const sidecarClient = sidecarService?.getClient();

        // Time PDF parsing
        const startParse = Date.now();
        const pages = await parsePdf(filePath, {
          enableOCR,
          sidecarClient
        });
        if (profiler.isEnabled()) {
          const metrics = profiler.fileMetrics.get(filePath);
          if (metrics) {
            metrics.timings.parsing = Date.now() - startParse;
          }
        }
        
        // Time chunking
        const startChunk = Date.now();
        for (const pg of pages) {
          const pageChunks = chunkText(pg.text, 500, 60);
          chunks.push(...pageChunks.map(c => ({ ...c, page: pg.page })));
        }
        if (profiler.isEnabled()) {
          const metrics = profiler.fileMetrics.get(filePath);
          if (metrics) {
            metrics.timings.chunking = Date.now() - startChunk;
          }
        }
      } catch (pdfError: any) {
        const errorMsg = pdfError.message || 'Unknown PDF parsing error';
        await updateFileStatus(fileStatusTable, filePath, 'failed', fileHashes, `PDF: ${errorMsg}`, 0, parserVersion);
        logger.warn('INDEXING', `Failed: ${path.basename(filePath)} - PDF: ${errorMsg}`);
        return;
      }
    } else {
      // Dynamic parser loading for all other file types
      try {
        const parserModule = await parserDef.parser();
        
        // Time text parsing
        const startParse = Date.now();
        const text = await parserModule(filePath);
        if (profiler.isEnabled()) {
          const metrics = profiler.fileMetrics.get(filePath);
          if (metrics) {
            metrics.timings.parsing = Date.now() - startParse;
          }
        }
        
        // Time chunking
        const startChunk = Date.now();
        const chunkSize = parserDef.chunkSize || 500;
        const chunkOverlap = parserDef.chunkOverlap || 60;
        chunks = chunkText(text, chunkSize, chunkOverlap);
        if (profiler.isEnabled()) {
          const metrics = profiler.fileMetrics.get(filePath);
          if (metrics) {
            metrics.timings.chunking = Date.now() - startChunk;
          }
        }
      } catch (parseError: any) {
        const errorMsg = parseError.message || `Unknown ${parserDef.label} parsing error`;
        await updateFileStatus(fileStatusTable, filePath, 'failed', fileHashes, errorMsg, 0, parserVersion);
        logger.warn('INDEXING', `Failed: ${path.basename(filePath)} - ${errorMsg}`);
        return;
      }
    }
    
    if (chunks.length === 0) {
      // Mark file as failed if no chunks were extracted
      await updateFileStatus(fileStatusTable, filePath, 'failed', fileHashes, 'No text content extracted', 0, parserVersion);
      logger.warn('INDEXING', `Failed: ${path.basename(filePath)} - No text content extracted`);
      return;
    }
    
    // Record chunks for profiling
    if (profiler.isEnabled()) {
      const avgChunkSize = chunks.reduce((sum, c) => sum + c.text.length, 0) / chunks.length;
      profiler.recordChunks(filePath, chunks.length, avgChunkSize);
    }
    
    // Use the embedding queue for processing
    if (!embeddingQueue) {
      throw new Error('Embedding queue not initialized');
    }

    // Get a unique file index for tracking
    const fileIndex = fileCount++;

    // Add chunks to the queue
    await embeddingQueue.addChunks(chunks, filePath, fileIndex);

    // File metadata is handled in the batch processor callback

    // Wait for all chunks from this file to be processed
    await embeddingQueue.waitForCompletion(filePath);

    // For profiling compatibility
    let totalEmbedTime = 0;
    let totalDbTime = 0;
    
    // Record operation timings for profiling
    if (profiler.isEnabled()) {
      const metrics = profiler.fileMetrics.get(filePath);
      if (metrics) {
        metrics.timings.embedding = totalEmbedTime;
        metrics.timings.dbWrite = totalDbTime;
      }
    }
    
    fileHashes.set(filePath, currentHash);

    // Update file status as successfully indexed
    const totalChunks = chunks.length;
    await updateFileStatus(fileStatusTable, filePath, 'indexed', fileHashes, undefined, totalChunks, parserVersion);
    lifecycle?.getStatsCache().invalidate(); // Cache needs recalculation after new file indexed
    logger.log('INDEXING', `✅ Success: ${path.basename(filePath)} - ${totalChunks} chunks created`);
    
    // Clear references to help garbage collection
    chunks = null as any;
    
    // Update indexed count for the folder based on unique files
    for (const [folder, stats] of folderStats) {
      if (filePath.startsWith(folder)) {
        // Count unique indexed files in this folder
        let indexedInFolder = 0;
        for (const [path] of fileHashes) {
          if (path.startsWith(folder)) {
            indexedInFolder++;
          }
        }
        stats.indexed = indexedInFolder;
        break;
      }
    }
    
    await maybeCreateIndex(tbl);

    // Force garbage collection if available
    if (global.gc) {
      global.gc();
    }
  } catch (error: any) {
    logger.error('INDEXING', `❌ Error: ${path.basename(filePath)} -`, error.message || error);
    // Track the error in the database
    await updateFileStatus(fileStatusTable, filePath, 'error', fileHashes, error.message || String(error));
  } finally {
    // Clean up the file tracker now that all processing is complete
    // This ensures the file doesn't show as PARSING after embedding is done
    if (embeddingQueue) {
      embeddingQueue.cleanupFileTracker(filePath);
    }
  }
}

// Wrap handleFile with profiling
const handleFile = profileHandleFile(handleFileOriginal);

async function reindexAll() {
  logger.log('REINDEX', 'Starting full re-index with multilingual E5 model...');
  
  try {
    // Get all watched folders
    const watchedFolders = configManager?.getWatchedFolders() || [];
    if (watchedFolders.length === 0) {
      logger.log('REINDEX', 'No folders to re-index');
      return;
    }
    
    // Clear the entire index
    if (tbl) {
      try {
        // Delete all existing chunks
        await tbl.delete('1=1'); // Delete all rows
        logger.log('REINDEX', 'Cleared existing index');
      } catch (e) {
        logger.error('REINDEX', 'Error clearing index:', e);
      }
    }
    
    // Clear file status table if available
    if (fileStatusTable) {
      try {
        // Delete all file status records
        await fileStatusTable.delete('1=1');
        logger.log('FILE-STATUS', 'Cleared file status records');
      } catch (e) {
        logger.error('FILE-STATUS', 'Error clearing file status:', e);
      }
    }
    
    // Clear file hashes to force re-indexing
    fileHashes.clear();
    
    // Reset folder stats
    for (const [_folder, stats] of folderStats) {
      stats.indexed = 0;
    }
    
    // Pass a flag to force re-indexing of all files
    logger.log('REINDEX', 'Restarting file watcher to re-index all files...');
    await startWatching(watchedFolders, configManager?.getEffectiveExcludePatterns(), true);
    
    logger.log('REINDEX', 'Re-indexing started - files will be processed through normal queue');

  } catch (error) {
    logger.error('REINDEX', 'Re-index failed:', error);
    throw error;
  }
}

async function cleanupRemovedFolders(removedFolders: string[]) {
  if (!tbl || removedFolders.length === 0) return;
  
  try {
    // Remove files from in-memory cache
    const removedCount = folderRemovalManager.removeFilesFromCache(fileHashes, removedFolders);
    logger.log('CLEANUP', `Removed ${removedCount} files from cache`);
    
    // Get all paths from database once
    const allRecords = await tbl.query().select(['path']).toArray();
    const allPaths = allRecords.map((r: any) => r.path);
    
    // Identify which database paths need to be deleted
    const pathsToDelete = folderRemovalManager.filterPathsInFolders(allPaths, removedFolders);
    logger.log('CLEANUP', `Found ${pathsToDelete.length} files to delete from database`);
    
    // Delete from vector database
    for (const path of pathsToDelete) {
      await deleteByPath(tbl, path);
    }
    
    // Delete from file status table
    if (fileStatusTable) {
      for (const path of pathsToDelete) {
        try {
          await fileStatusTable.delete(`path = "${path}"`);
        } catch (_e) {
          // Ignore individual deletion errors
        }
      }
    }
    
    logger.log('CLEANUP', `Completed cleanup for ${removedFolders.length} folder(s)`);
  } catch (error) {
    logger.error('CLEANUP', 'Error during folder cleanup:', error);
  }
}

async function startWatching(roots: string[], excludePatterns?: string[], forceReindex: boolean = false) {
  if (watcher) {
    await watcher.close();
  }
  
  // Use FolderRemovalManager to handle folder cleanup
  const removedFolders = folderRemovalManager.updateFolderStats(folderStats, roots);
  
  // If folders were removed, delete their files from the database
  if (removedFolders.length > 0) {
    logger.log('CLEANUP', `Removing files from ${removedFolders.length} folder(s): ${removedFolders.join(', ')}`);
    await cleanupRemovedFolders(removedFolders);
  }
  
  // Get effective exclude patterns (including bundle patterns if enabled)
  const effectivePatterns = configManager?.getEffectiveExcludePatterns() || excludePatterns || [];
  
  logger.log('WATCHER', `Starting to watch ${roots.length} folder(s): ${roots.join(', ')}`);
  watcher = chokidar.watch(roots, {
    ignored: effectivePatterns,
    ignoreInitial: true,  // Don't re-scan all files on startup
    persistent: true,
    awaitWriteFinish: {
      stabilityThreshold: 1000,
      pollInterval: 100
    },
    // Use polling in test environment to avoid fsevents issues
    usePolling: process.env.NODE_ENV === 'test',
    interval: 100
  });
  
  // Cache file status records to avoid repeated queries
  let fileStatusCache: Map<string, any> | null = null;
  if (fileStatusTable) {
    try {
      const records = await fileStatusTable.query().toArray();
      fileStatusCache = new Map(records.map((r: any) => [r.path, r]));
      logger.log('FILE-STATUS', `Loaded ${fileStatusCache.size} file status records into cache`);
    } catch (e) {
      logger.error('FILE-STATUS', 'Could not cache file status records:', e);
      fileStatusCache = new Map();
    }
  } else {
    logger.log('FILE-STATUS', 'File status table not available for caching');
    fileStatusCache = new Map();
  }
  
  // After watcher is set up, scan for new and modified files using our new classes
  await (async () => {
    if (forceReindex) {
      logger.log('WATCHER', 'Force re-indexing enabled - all files will be queued');
    } else {
      logger.log('WATCHER', 'Scanning for new and modified files...');
    }
    logger.log('FILE-STATUS', 'File status cache size:', fileStatusCache?.size || 0);
    logger.log('QUEUE', 'Queue already has:', fileQueue.getStats().queued, 'files');
    
    // Get enabled extensions from registry based on config
    const fileTypes = configManager?.getSettings().fileTypes || {};
    const supportedExtensions = getEnabledExtensions(fileTypes);
    
    // Use the extracted scanning function
    const scanOptions: ScanOptions = {
      excludeBundles: configManager?.getSettings().excludeBundles ?? true,
      bundlePatterns: configManager?.getSettings().bundlePatterns || [],
      excludePatterns: effectivePatterns.filter(p => typeof p === 'string') as string[],
      supportedExtensions
    };
    
    const scanResult = scanDirectories(roots, scanOptions);
    
    // Initialize our new classes
    const orchestrator = new ReindexOrchestrator();
    const scanner = new FileScanner();
    
    // Filter supported files using FileScanner
    const fileScannerConfig: FileScannerConfig = {
      skipBundles: configManager?.getSettings().excludeBundles ?? true,
      bundlePatterns: configManager?.getSettings().bundlePatterns || [],
      supportedExtensions
    };
    
    const supportedFiles = scanner.filterSupportedFiles(scanResult.files, fileScannerConfig);
    
    // Update folder stats for total files count
    for (const fullPath of supportedFiles) {
      for (const [folder, stats] of folderStats) {
        if (fullPath.startsWith(folder)) {
          stats.total++;
          break;
        }
      }
    }
    
    // Use ReindexOrchestrator to determine which files to index
    const { toIndex, reasons } = orchestrator.determineFilesToReindex(
      supportedFiles.filter(f => !fileQueue.isProcessing(f)), // Exclude files already in queue
      fileStatusCache || new Map(),
      forceReindex
    );
    
    // For modified files, we need to check actual file changes
    const filesToIndex: string[] = [];
    let hashChecks = 0;
    
    for (const filePath of toIndex) {
      const reason = reasons.get(filePath);
      
      // For non-force reindex, check modified files more carefully
      if (!forceReindex && reason === 'new-file') {
        // Check if it's actually modified rather than new
        const fileRecord = fileStatusCache?.get(filePath);
        if (fileRecord && fileRecord.status === 'indexed') {
          try {
            const stats = fs.statSync(filePath);
            const fileModTime = stats.mtime.getTime();
            const indexedTime = new Date(fileRecord.indexed_at).getTime();
            
            // Only calculate hash if file was modified after indexing
            if (fileModTime > indexedTime) {
              hashChecks++;
              const currentHash = await getFileHash(filePath);
              if (currentHash !== fileRecord.file_hash) {
                filesToIndex.push(filePath);
                reasons.set(filePath, 'modified' as any);
              }
            }
          } catch (e) {
            // File might have been deleted or become inaccessible
            console.debug('Error checking file:', filePath, e);
            filesToIndex.push(filePath); // Queue it anyway as new
          }
        } else {
          filesToIndex.push(filePath);
        }
      } else {
        filesToIndex.push(filePath);
      }
    }
    
    // Calculate statistics using the orchestrator
    const stats = orchestrator.calculateReindexStats(supportedFiles, fileStatusCache || new Map(), reasons);
    
    logger.log('WATCHER', 'Scan results:');
    logger.log('WATCHER', `  - New files: ${stats.newFiles}`);
    logger.log('WATCHER', `  - Modified files: ${stats.modifiedFiles}`);
    logger.log('WATCHER', `  - Skipped files: ${stats.skippedFiles}`);
    logger.log('WATCHER', `  - Failed files to retry: ${stats.failedFiles}`);
    logger.log('WATCHER', `  - Outdated files: ${stats.outdatedFiles}`);
    logger.log('WATCHER', `  - Hash calculations performed: ${hashChecks}`);
    
    if (filesToIndex.length > 0) {
      logger.log('QUEUE', `Adding ${filesToIndex.length} files to queue`);
      fileQueue.add(filesToIndex);
      // Start processing if not already active
      processQueue();
    } else {
      logger.log('WATCHER', 'No new or modified files found');
    }
    logger.log('QUEUE', 'Total queue size after scan:', fileQueue.getStats().queued);
    
    // Initialize indexed counts for each folder after scan
    for (const [folder, stats] of folderStats) {
      let indexedInFolder = 0;
      for (const [path] of fileHashes) {
        if (path.startsWith(folder)) {
          indexedInFolder++;
        }
      }
      stats.indexed = indexedInFolder;
    }
    
    // Notify that database initialization and folder scanning is complete
    // This is sent only once during initial startup, not on subsequent folder changes
    if (!global.filesLoadedSent) {
      parentPort!.postMessage({ type: 'files:loaded' });
      global.filesLoadedSent = true;
    }
  })(); // Execute immediately, not after delay

  watcher.on('add', async (p: string) => {
    // Update total file count
    for (const [folder, stats] of folderStats) {
      if (p.startsWith(folder)) {
        stats.total++;
        break;
      }
    }
    
    // Only queue supported file types
    const ext = path.extname(p).slice(1).toLowerCase();
    const supported = ['pdf', 'txt', 'md', 'docx', 'rtf', 'doc'].includes(ext);
    
    if (supported && !fileQueue.isProcessing(p)) {
      // Check file status from cache or assume it's new
      const fileRecord = fileStatusCache?.get(p) || null;
      
      // Use shouldReindex to determine if file needs processing
      if (reindexService.shouldReindex(p, fileRecord)) {
        fileQueue.add(p);
        logger.log('QUEUE', `📥 Added: ${path.basename(p)} (Queue size: ${fileQueue.getStats().queued})`);
        // Start processing if not already active
        processQueue();
      }
    }
  });
  
  watcher.on('change', (p: string) => {
    const ext = path.extname(p).slice(1).toLowerCase();
    const supported = ['pdf', 'txt', 'md', 'docx', 'rtf', 'doc'].includes(ext);
    
    if (supported && !fileQueue.isProcessing(p)) {
      fileQueue.add(p);
      logger.log('QUEUE', `📥 Added: ${path.basename(p)} (Queue size: ${fileQueue.getStats().queued})`);
      // Start processing if not already active
      processQueue();
    }
  });
  
  watcher.on('unlink', async (p: string) => {
    // Update folder stats
    for (const [folder, stats] of folderStats) {
      if (p.startsWith(folder)) {
        stats.total = Math.max(0, stats.total - 1);
        if (fileHashes.has(p)) {
          stats.indexed = Math.max(0, stats.indexed - 1);
        }
        break;
      }
    }

    await deleteByPath(tbl, p);
    fileHashes.delete(p);

    fileQueue.remove(p);
  });
}

let isProcessingActive = false;

async function processQueue() {
  logger.log('PROCESS-QUEUE', `Called - isProcessingActive: ${isProcessingActive}, modelReady: ${modelReady}`);

  // Prevent multiple instances running
  if (isProcessingActive) {
    logger.log('PROCESS-QUEUE', 'Already processing, skipping');
    return;
  }

  // Wait for model to be ready
  if (!modelReady) {
    logger.log('PROCESS-QUEUE', 'Model not ready, skipping');
    return;
  }

  const queueStats = fileQueue.getStats();
  logger.log('PROCESS-QUEUE', `Starting - Queue: ${queueStats.queued} files, Processing: ${queueStats.processing}`);

  isProcessingActive = true;

  try {
    // Process the queue - this will continue until all files are processed
    await fileQueue.process(
      async (filePath) => {
        const maxConcurrent = fileQueue.getCurrentMaxConcurrent();
        logger.log('INDEXING', `🔄 Processing: ${path.basename(filePath)} (${fileQueue.getProcessingFiles().length}/${maxConcurrent} concurrent)`);

        try {
          await handleFile(filePath);
        } finally {
          logger.log('INDEXING', `✨ Completed: ${path.basename(filePath)} (${fileQueue.getProcessingFiles().length}/${maxConcurrent} still processing)`);
        }
      },
      () => process.memoryUsage().rss / 1024 / 1024 // Memory getter
    );
    logger.log('PROCESS-QUEUE', 'Completed processing all files');
  } finally {
    isProcessingActive = false;
    logger.log('PROCESS-QUEUE', 'Processing flag reset');
  }
}

parentPort!.on('message', async (msg: any) => {
  try {
    switch (msg.type) {
      case 'init':
        emitStageProgress('worker_spawn', 'Worker started');
        // Set user data path for embedder to use for model cache, with fallback for tests
        const userDataPath = msg.userDataPath || path.join(require('os').tmpdir(), 'semantica-test');
        process.env.USER_DATA_PATH = userDataPath;

        // Also provide fallback for dbDir
        const dbDir = msg.dbDir || path.join(userDataPath, 'data');

        // Initialize worker using WorkerLifecycle state machine
        (async () => {
          try {
            // Create lifecycle with dependencies
            lifecycle = new WorkerLifecycle({
              emitStageProgress,
              writeQueueState,
              fileHashes,
              folderStats,
              startWatching
            });

            // Run full initialization sequence
            const success = await lifecycle.initialize(dbDir, userDataPath);

            if (!success) {
              logger.error('WORKER', 'Startup failed - lifecycle initialization failed');
              return;
            }

            // Populate module-level variables from lifecycle
            const { db: dbHandle, tbl: tblHandle, fileStatusTable: fileStatusTableHandle } = lifecycle.getDatabase();
            db = dbHandle;
            tbl = tblHandle;
            fileStatusTable = fileStatusTableHandle;
            configManager = lifecycle.getConfigManager();
            sidecarEmbedder = lifecycle.getEmbedder();
            sidecarService = lifecycle.getSidecarService();
            embeddingQueue = lifecycle.getEmbeddingQueue();
            reindexService = lifecycle.getReindexService();
            modelReady = true;

            // Defer heavy reindexing work to after ready signal
            setTimeout(async () => {
              try {
                if (!reindexService) return;

                // Migrate existing files to include parser versions
                await reindexService.migrateExistingFiles();

                // Check for parser upgrades and queue files for re-indexing
                const reindexResult = await reindexService.checkForParserUpgrades();
                fileQueue.add(reindexResult.filesToReindex);

                // Start processing if files were added
                if (reindexResult.filesToReindex.length > 0) {
                  processQueue();
                }

                // Notify parent if there were upgrades
                if (Object.keys(reindexResult.upgradeSummary).length > 0 && parentPort) {
                  parentPort.postMessage({
                    type: 'parser-upgrade',
                    payload: reindexResult.upgradeSummary
                  });
                }
              } catch (err) {
                logger.error('REINDEX', 'Error during reindex check:', err);
              }
            }, 100); // Small delay to ensure ready message is sent first

            // Notify that files are loaded (for StartupCoordinator)
            if (!global.filesLoadedSent && parentPort) {
              logger.log('WORKER', 'Sending files:loaded event');
              parentPort.postMessage({ type: 'files:loaded' });
              global.filesLoadedSent = true;
            }

            // Start processing any queued files
            processQueue();
          } catch (error) {
            logger.error('WORKER', 'Startup initialization failed:', error);
          }
        })();
        break;
        
      case 'checkModel':
        logger.log('WORKER', '========== RECEIVED checkModel REQUEST ==========');
        logger.log('WORKER', 'Current modelReady state:', modelReady);
        
        // Wait for model initialization to complete before responding
        // This ensures the UI gets the correct status
        const checkInterval = setInterval(() => {
          // Check if initialization is complete (modelReady will be set)
          if (modelReady !== null) {
            clearInterval(checkInterval);
            logger.log('WORKER', 'Responding to checkModel with exists:', modelReady);
            if (msg.id) {
              parentPort!.postMessage({ 
                id: msg.id,
                payload: { exists: modelReady }
              });
            }
          }
        }, 100);
        
        // Timeout after 10 seconds
        setTimeout(() => {
          clearInterval(checkInterval);
          if (msg.id && modelReady === null) {
            parentPort!.postMessage({ 
              id: msg.id,
              payload: { exists: false }
            });
          }
        }, 10000);
        break;
      
      case 'downloadModel':
        // Model download is handled during init, this is now a no-op
        // Just return success if model is ready
        if (msg.id) {
          parentPort!.postMessage({
            id: msg.id,
            payload: { success: modelReady }
          });
        }
        if (modelReady) {
          parentPort!.postMessage({ type: 'model:download:complete' });
        }
        break;

      case 'startup:retry':
        // Retry initialization after error
        logger.log('WORKER', 'Retrying startup sequence...');
        (async () => {
          try {
            workerStartup = new WorkerStartup();
            const settings = configManager?.getSettings();
            sidecarEmbedder = await workerStartup.initialize(settings);
            sidecarService = workerStartup.getSidecarService();

            if (!sidecarEmbedder) {
              logger.error('WORKER', 'Startup retry failed - no embedder created');
              return;
            }

            // Recreate embedding queue
            const batchSize = settings?.embeddingBatchSize ?? 32;
            embeddingQueue = new EmbeddingQueue({
              maxQueueSize: 2000,
              batchSize,
              maxTokensPerBatch: 7000, // Safe limit with ~1K buffer to prevent EOF errors
              backpressureThreshold: 1000
            });

            embeddingQueue.initialize(sidecarEmbedder, createBatchProcessor(tbl, writeQueueState));

            modelReady = true;
            logger.log('WORKER', 'Startup retry successful');
            processQueue();
          } catch (error) {
            logger.error('WORKER', 'Startup retry failed:', error);
          }
        })();
        break;

      case 'diagnostics:getLogs':
        // Return diagnostic logs from ring buffer
        if (workerStartup && msg.id) {
          const logs = workerStartup.getLogs();
          parentPort!.postMessage({
            channel: 'diagnostics:logs',
            id: msg.id,
            logs
          });
        }
        break;

      case 'watchStart':
        const { roots, options } = msg.payload;
        
        // Save folders to config
        configManager?.setWatchedFolders(roots);
        
        // Start watching - will use effective patterns from config manager
        await startWatching(roots, options?.exclude);
        
        if (msg.id) {
          parentPort!.postMessage({ id: msg.id, payload: { success: true } });
        }
        break;
        
      case 'enqueue':
        const { paths } = msg.payload;
        let filesAdded = 0;
        for (const p of paths) {
          if (!fileQueue.isProcessing(p)) {
            fileQueue.add(p);
            filesAdded++;
          }
        }

        // Start processing if files were added
        if (filesAdded > 0) {
          processQueue();
        }

        if (msg.id) {
          parentPort!.postMessage({ id: msg.id, payload: { success: true } });
        }
        break;
        
      case 'pause':
        paused = true;
        fileQueue.pause();
        if (msg.id) {
          parentPort!.postMessage({ id: msg.id, payload: { success: true } });
        }
        break;
        
      case 'resume':
        paused = false;
        fileQueue.resume();
        if (msg.id) {
          parentPort!.postMessage({ id: msg.id, payload: { success: true } });
        }
        break;
        
      case 'progress':
        const queueStats = fileQueue.getStats();
        const progress = {
          queued: queueStats.queued,
          processing: queueStats.processing,
          done: fileHashes.size,
          errors: 0,
          paused,
          initialized: true // Worker is initialized and ready
        };
        if (msg.id) {
          parentPort!.postMessage({ id: msg.id, payload: progress });
        }
        break;
        
      case 'search':
        const results = await search(tbl, sidecarEmbedder!, msg.payload.q, msg.payload.k);

        if (msg.id) {
          parentPort!.postMessage({ id: msg.id, payload: results });
        }
        break;

      case 'stats':
        // Use cached stats if available (pre-calculated during startup for instant response)
        // StatsCache automatically handles: waiting for in-progress calculations, deduplication, caching
        if (!lifecycle) {
          throw new Error('Worker not initialized');
        }
        const stats = await lifecycle.getStatsCache().get(() => getStats(tbl, fileHashes, folderStats, fileStatusTable));
        if (msg.id) {
          parentPort!.postMessage({ id: msg.id, payload: stats });
        }
        break;
        
      case 'getWatchedFolders':
        const watchedFolders = configManager?.getWatchedFolders() || [];
        logger.log('WORKER', `getWatchedFolders called - returning ${watchedFolders.length} folders:`, watchedFolders);
        if (msg.id) {
          parentPort!.postMessage({ id: msg.id, payload: watchedFolders });
        }
        break;
        
      case 'getSettings':
        if (msg.id) {
          parentPort!.postMessage({ id: msg.id, payload: configManager?.getSettings() || {} });
        }
        break;
        
      case 'updateSettings':
        if (configManager) {
          configManager.updateSettings(msg.payload);
          if (msg.id) {
            parentPort!.postMessage({ id: msg.id, payload: { success: true } });
          }
        }
        break;
      
      case 'reindexAll':
        // Start re-indexing
        reindexAll().then(() => {
          if (msg.id) {
            parentPort!.postMessage({ id: msg.id, payload: { success: true } });
          }
        }).catch(error => {
          logger.error('REINDEX', 'Re-index error:', error);
          if (msg.id) {
            parentPort!.postMessage({ id: msg.id, error: error.message });
          }
        });
        break;
      
      case 'searchFiles':
        try {
          const searchQuery = (typeof msg.payload === 'string' ? msg.payload : msg.payload?.query || '').toLowerCase();
          const results: any[] = [];
          
          // Quick search through file status table if available
          if (fileStatusTable) {
            try {
              const allStatuses = await fileStatusTable.query().toArray();
              for (const record of allStatuses) {
                if (record.path.toLowerCase().includes(searchQuery)) {
                  // Check if currently in queue
                  const queuePosition = -1; // We can't get exact position without public access to queue
                  const isCurrentlyProcessing = fileQueue.isProcessing(record.path);
                  
                  let status = record.status;
                  if (isCurrentlyProcessing) {
                    status = 'queued';
                  }
                  
                  results.push({
                    path: record.path,
                    status: status,
                    chunks: record.chunk_count || 0,
                    queuePosition: queuePosition >= 0 ? queuePosition + 1 : undefined,
                    error: record.error_message,
                    modified: record.last_modified
                  });
                  
                  if (results.length >= 30) break;
                }
              }
            } catch (e) {
              logger.error('FILE-STATUS', 'Error searching file status table:', e);
            }
          }
          
          // Also search queued files not yet in status table
          // Note: We can't iterate through the queue without public access
          // This functionality would need to be added to ConcurrentQueue class
          /*
          const queuedFiles = fileQueue.getStats().queued;
          for (let i = 0; i < queuedFiles && results.length < 30; i++) {
            const filePath = queue[i];
            if (filePath.toLowerCase().includes(searchQuery)) {
              if (!results.find(r => r.path === filePath)) {
                results.push({
                  path: filePath,
                  status: 'queued',
                  chunks: 0,
                  queuePosition: i + 1
                });
              }
            }
          }
          */
          
          // Send results
          if (msg.id) {
            parentPort!.postMessage({ id: msg.id, payload: results });
          }
        } catch (error) {
          logger.error('DATABASE', 'Search files error:', error);
          if (msg.id) {
            parentPort!.postMessage({ id: msg.id, payload: [] });
          }
        }
        break;
      
      case 'shutdown':
        // Clean shutdown requested - wait for all operations to complete
        logger.log('WORKER', 'Worker shutting down - initiating graceful shutdown...');

        // Use shutdown orchestrator for graceful shutdown
        const shutdownResult = await performGracefulShutdown(
          {
            watcher,
            fileQueue,
            embeddingQueue,
            writeQueueState,
            sidecarEmbedder,
            sidecarService,
            db,
            healthCheckInterval,
            memoryMonitorInterval,
            isProcessingActive,
            profiler: process.env.PROFILE === 'true' ? profiler : undefined
          },
          {
            embeddingQueueTimeoutMs: 30000,
            writeQueueTimeoutMs: 10000,
            enableProfiling: process.env.PROFILE === 'true',
            onProgress: (step, details) => {
              // Map shutdown steps to appropriate log messages
              switch (step) {
                case 'close_watcher':
                  logger.log('WORKER', 'File watcher closed - no new files will be added');
                  break;
                case 'file_queue_wait':
                  if (details.processing > 0) {
                    logger.log('WORKER', `Still waiting for ${details.processing} files to complete...`);
                  } else {
                    logger.log('WORKER', 'File queue completed');
                  }
                  break;
                case 'embedding_queue_wait':
                  logger.log('WORKER', 'Waiting for embedding queue to drain...');
                  break;
                case 'write_queue_wait':
                  logger.log('WORKER', 'Waiting for database writes to complete...');
                  break;
                case 'profiling_report':
                  logger.log('PROFILING', '🔬 Generating performance report...');
                  break;
                case 'clear_memory_monitor':
                  logger.log('WORKER', 'Memory monitoring stopped');
                  break;
                case 'sidecar_embedder_shutdown':
                  logger.log('WORKER', 'Shutting down sidecar embedder...');
                  break;
                case 'sidecar_service_stop':
                  logger.log('WORKER', 'Stopping Python sidecar service...');
                  break;
                case 'database_close':
                  logger.log('WORKER', 'Closing database...');
                  break;
              }
            }
          }
        );

        // Log any failed steps
        for (const step of shutdownResult.steps) {
          if (!step.success) {
            if (step.timedOut) {
              logger.warn('WORKER', `Shutdown step timed out: ${step.step}`);
            } else if (step.error) {
              logger.error('WORKER', `Shutdown step failed: ${step.step} - ${step.error}`);
            }
          }
        }

        // Log completion and exit
        if (shutdownResult.success) {
          logger.log('WORKER', 'Worker shutdown complete');
          process.exit(0);
        } else {
          logger.warn('WORKER', 'Worker shutdown completed with errors');
          process.exit(1);
        }
    }
  } catch (error: any) {
    logger.error('WORKER', 'Worker message error:', error);
    if (msg.id) {
      parentPort!.postMessage({ id: msg.id, error: error?.message || String(error) });
    }
  }
});

// Add error handlers to prevent crashes
process.on('unhandledRejection', (reason, promise) => {
  logger.error('WORKER', 'Unhandled Rejection at:', promise, 'reason:', reason);
});

process.on('uncaughtException', (error) => {
  logger.error('WORKER', 'Uncaught Exception:', error);
  // Keep the worker alive
});

// Cleanup on exit
// Note: 'exit' event handlers CANNOT be async - Node.js will exit immediately
// Async cleanup (sidecar shutdown) is handled in the 'shutdown' message handler
// and in main process before-quit handler
process.on('exit', () => {
  if (healthCheckInterval) {
    clearInterval(healthCheckInterval);
  }
  // Cannot await async operations here - they will be ignored
});

process.on('SIGTERM', async () => {
  // Generate profiling report if enabled
  if (process.env.PROFILE === 'true') {
    const { profiler } = require('./profiling-integration');
    if (profiler.isEnabled()) {
      logger.log('PROFILING', '🔬 Generating performance report...');
      await profiler.saveReport();
    }
  }

  if (healthCheckInterval) {
    clearInterval(healthCheckInterval);
  }
  if (sidecarEmbedder) {
    await sidecarEmbedder.shutdown();
  }
  if (sidecarService) {
    await sidecarService.stopSidecar();
  }
  process.exit(0);
});