import { parentPort } from 'node:worker_threads';
import * as lancedb from '@lancedb/lancedb';
import { PARSER_VERSIONS, getParserVersion } from './parserVersions';
import { ReindexService } from '../services/ReindexService';
import { ConcurrentQueue } from './ConcurrentQueue';
import { 
  initializeFileStatusTable, 
  loadFileStatusCache, 
  scanForChanges, 
  updateFileStatus as updateFileStatusInTable,
  getFileHash as getFileHashFromManager,
  isFileSupported,
  getFileExtension
} from './fileStatusManager';
import { migrateIndexedFilesToStatus, cleanupOrphanedStatuses } from './migrateFileStatus';
import { ReindexOrchestrator } from './ReindexOrchestrator';
import { FileScanner } from './fileScanner';
import type { FileInfo, FileStats, ScanConfig as FileScannerConfig } from './fileScanner';

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
setInterval(async () => {
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
    console.log(`Memory: RSS=${rssMB}MB, Heap=${heapMB}MB/${heapTotalMB}MB, External=${extMB}MB, Files processed: ${fileCount}`);
    lastMemoryLog = { rssMB, heapMB, heapTotalMB, extMB, fileCount };
  }
  
  // Log queue status if there are files
  const stats = fileQueue.getStats();
  if (stats.queued > 0 || stats.processing > 0) {
    const processingFiles = fileQueue.getProcessingFiles().map(p => path.basename(p)).join(', ');
    const maxConcurrent = fileQueue.getCurrentMaxConcurrent();
    console.log(`[QUEUE STATUS] 📊 Queued: ${stats.queued}, Processing: ${stats.processing}/${maxConcurrent}${processingFiles ? ` (${processingFiles})` : ''}`);
  }
  
  // Check if embedder needs restart
  const restarted = await checkEmbedderMemory();
  if (restarted) {
    console.log('[MEMORY] ♾️ Embedder process restarted due to memory limits');
  }
}, 2000);

// PDF parsing is optional - will handle it if available
let parsePdf: any = null;
try {
  parsePdf = require('../parsers/pdf').parsePdf;
} catch (e) {
  console.log('PDF parsing not available');
}
import { parseText } from '../parsers/text';
import { parseDocx } from '../parsers/docx';
import { parseRtf } from '../parsers/rtf';
import { parseDoc } from '../parsers/doc';
import { chunkText } from '../pipeline/chunker';
// Use isolated embedder for better memory management
import { embed, checkEmbedderMemory, shutdownEmbedder } from '../../shared/embeddings/isolated';
import crypto from 'node:crypto';
import chokidar from 'chokidar';
import fs from 'node:fs';
import path from 'node:path';
import { ConfigManager } from './config';
import { downloadModelSequentially, checkModelExists as checkModelExistsNew } from './modelDownloader';
import { scanDirectories, type ScanOptions } from './directoryScanner';

let db: any = null;
let tbl: any = null;
let fileStatusTable: any = null; // Table to track file status
let modelReady: boolean | null = null; // Track if model is ready (null = not yet checked)
let paused = false;
const fileChunkCounts = new Map<string, number>(); // Track chunk counts per file
let reindexService: ReindexService; // Service for managing re-indexing logic
let watcher: any = null;
let configManager: ConfigManager | null = null;
const fileQueue = new ConcurrentQueue({
  maxConcurrent: 5,
  memoryThresholdMB: 800,
  throttledConcurrent: 2,
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
    console.log(`[MEMORY] ⚠️ Adjusting concurrency: ${newLimit} (RSS: ${Math.round(memoryMB)}MB)`);
  }
});
const fileHashes = new Map<string, string>();
let isWriting = false;
const writeQueue: Array<() => Promise<void>> = [];
interface FolderStats {
  total: number;
  indexed: number;
}
const folderStats = new Map<string, FolderStats>();

interface QueuedFile {
  path: string;
  priority: number;
}

// Helper function to check if model exists (use new implementation)
function checkModelExists(userDataPath: string): boolean {
  return checkModelExistsNew(userDataPath);
}

// Helper function to download model (use new sequential downloader)
async function downloadModel(userDataPath: string): Promise<void> {
  console.log('[WORKER] Starting sequential model download...');
  
  try {
    // Use the new sequential downloader
    await downloadModelSequentially(userDataPath);
    
    // Now that files are downloaded, we still need to initialize transformers.js
    // with the correct paths so the embedder child process can use them
    const transformers = await import('@xenova/transformers');
  
    // Set the model cache path for transformers.js
    const modelCachePath = path.join(userDataPath, 'models');
    transformers.env.localModelPath = modelCachePath;
    transformers.env.cacheDir = modelCachePath;
    transformers.env.allowRemoteModels = false; // Disable remote downloads since we already have the files
    
    console.log('[WORKER] Model cache path configured:', modelCachePath);
    console.log('[WORKER] Model files downloaded successfully');
  } catch (err) {
    console.error('[WORKER] Model download failed:', err);
    throw err;
  }
}

async function initDB(dir: string, userDataPath: string) {
  try {
    // Initialize config manager
    configManager = new ConfigManager(dir);
    
    db = await lancedb.connect(dir);
    
    tbl = await db.openTable('chunks').catch(async () => {
      // Create table with initial schema
      const initialData = [{
        id: 'init',
        path: '',
        mtime: 0,
        page: 0,
        offset: 0,
        text: '',
        vector: new Array(384).fill(0),
        type: 'init',
        title: ''
      }];
      
      const table = await db.createTable('chunks', initialData, {
        mode: 'create'
      });
      
      // Delete the initialization record
      try {
        await table.delete('id = "init"');
      } catch (e: any) {
        console.log('Could not delete init record (may not exist):', e?.message || e);
      }
      
      return table;
    });
    
    console.log('Database initialized');
    
    // Initialize file status table (optional - won't fail if it doesn't work)
    try {
      fileStatusTable = await initializeFileStatusTable(db);
    } catch (e) {
      console.error('Failed to initialize file status table:', e);
      fileStatusTable = null;
    }
    
    // Load existing indexed files to prevent re-indexing
    try {
      // Get all unique file paths from the index
      const allRows = await tbl.query()
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
      
      uniquePaths.forEach(filePath => {
        try {
          if (fs.existsSync(filePath)) {
            const hash = getFileHash(filePath);
            fileHashes.set(filePath, hash);
          }
        } catch (e) {
          // File might have been deleted
        }
      });
      
      console.log(`Loaded ${fileHashes.size} existing indexed files`);
    } catch (e) {
      console.log('No existing files in index');
    }
    
    // Initialize ReindexService with the file status table
    reindexService = new ReindexService(fileStatusTable, console);
    
    // Migrate existing indexed files to file status table (one-time migration)
    if (fileStatusTable) {
      const migrated = await migrateIndexedFilesToStatus(tbl, fileStatusTable, fileHashes);
      if (migrated > 0) {
        console.log(`Created ${migrated} missing file status records`);
      }
    }
    
    // Defer heavy reindexing work to after ready signal
    setTimeout(async () => {
      try {
        // Migrate existing files to include parser versions
        await reindexService.migrateExistingFiles();
        
        // Check for parser upgrades and queue files for re-indexing
        const reindexResult = await reindexService.checkForParserUpgrades();
        fileQueue.add(reindexResult.filesToReindex);
        
        // Notify parent if there were upgrades
        if (Object.keys(reindexResult.upgradeSummary).length > 0 && parentPort) {
          parentPort.postMessage({
            type: 'parser-upgrade',
            payload: reindexResult.upgradeSummary
          });
        }
      } catch (err) {
        console.error('Error during reindex check:', err);
      }
    }, 100); // Small delay to ensure ready message is sent first
    
    // Do auto-start synchronously during init to avoid UI flash
    const config = await configManager!.getConfig();
    const savedFolders = config.watchedFolders || [];
    if (savedFolders.length > 0) {
      console.log('Auto-starting watch on saved folders:', savedFolders);
      await startWatching(savedFolders, config.settings?.excludePatterns || ['node_modules', '.git', '*.tmp', '.DS_Store']);
      
      // Initialize indexed counts for each folder
      for (const folder of savedFolders) {
        const stats = folderStats.get(folder);
        if (stats) {
          let indexedInFolder = 0;
          for (const [path] of fileHashes) {
            if (path.startsWith(folder)) {
              indexedInFolder++;
            }
          }
          stats.indexed = indexedInFolder;
        }
      }
    }
    
    console.log('Worker ready');
  } catch (error) {
    console.error('Failed to initialize database:', error);
    throw error;
  }
}

// Separate function to check and download model after worker is ready
async function initializeModel(userDataPath: string) {
  // Check and download model if needed (ONCE at startup)
  console.log('[WORKER] Checking for ML model...');
  modelReady = checkModelExists(userDataPath);
  
  if (!modelReady) {
    console.log('[WORKER] Model not found, downloading...');
    try {
      await downloadModel(userDataPath);
      modelReady = true;
      console.log('[WORKER] Model download complete');
      
      // Send download complete notification
      if (parentPort) {
        parentPort.postMessage({ type: 'model:download:complete' });
      }
    } catch (error) {
      console.error('[WORKER] Failed to download model:', error);
      modelReady = false;
    }
  } else {
    console.log('[WORKER] Model found, skipping download');
  }
  
  // Send model ready status
  if (parentPort) {
    parentPort.postMessage({
      type: 'model:ready',
      payload: { ready: modelReady }
    });
  }
}

async function mergeRows(rows: any[]) {
  if (rows.length === 0) return;
  
  // Queue the write operation to avoid concurrent writes
  return new Promise<void>((resolve, reject) => {
    const writeOp = async () => {
      try {
        await tbl.mergeInsert('id')
          .whenMatchedUpdateAll()
          .whenNotMatchedInsertAll()
          .execute(rows);
        resolve();
      } catch (error) {
        console.error('Failed to merge rows:', error);
        // Retry once on conflict
        if ((error as any)?.message?.includes('Commit conflict')) {
          try {
            await new Promise(r => setTimeout(r, 100));
            await tbl.mergeInsert('id')
              .whenMatchedUpdateAll()
              .whenNotMatchedInsertAll()
              .execute(rows);
            resolve();
          } catch (retryError) {
            console.error('Retry failed:', retryError);
            reject(retryError);
          }
        } else {
          reject(error);
        }
      }
    };
    
    writeQueue.push(writeOp);
    processWriteQueue();
  });
}

async function processWriteQueue() {
  if (isWriting || writeQueue.length === 0) return;
  
  isWriting = true;
  while (writeQueue.length > 0) {
    const writeOp = writeQueue.shift()!;
    await writeOp();
  }
  isWriting = false;
}

async function deleteByPath(filePath: string) {
  try {
    if (!filePath || !tbl) {
      return;
    }
    
    const escaped = filePath.replace(/"/g, '\\"');
    const query = `path = "${escaped}"`;
    await tbl.delete(query);
  } catch (error) {
    console.error('Failed to delete by path:', filePath, error);
  }
}

function getFileHash(filePath: string): string {
  const stat = fs.statSync(filePath);
  return `${stat.size}-${stat.mtimeMs}`;
}

function isInsideBundle(filePath: string): boolean {
  // Check if file is inside a macOS bundle based on config patterns
  if (!configManager?.getSettings().excludeBundles) {
    return false;
  }
  
  const bundlePatterns = configManager.getSettings().bundlePatterns || [];
  
  // Extract bundle extensions from patterns (e.g., "**/*.app/**" -> ".app")
  const bundleExtensions = bundlePatterns
    .map(pattern => {
      const match = pattern.match(/\*\.([^/]+)/);
      return match ? `.${match[1]}` : null;
    })
    .filter(Boolean) as string[];
  
  const pathComponents = filePath.split(path.sep);
  for (const component of pathComponents) {
    for (const ext of bundleExtensions) {
      if (component.endsWith(ext)) {
        return true;
      }
    }
  }
  return false;
}

async function updateFileStatus(filePath: string, status: string, error?: string, chunkCount?: number, parserVersion?: number) {
  if (!fileStatusTable) return; // Skip if table not available
  
  try {
    let stats: any = { mtime: new Date() };
    try {
      stats = fs.statSync(filePath);
    } catch (e) {
      // File might not exist (e.g., deleted status)
    }
    
    const record = {
      path: filePath,
      status: status,
      error_message: error || '',
      chunk_count: chunkCount || 0,
      last_modified: stats.mtime.toISOString(),
      indexed_at: new Date().toISOString(),
      file_hash: fileHashes.get(filePath) || '',
      parser_version: parserVersion || 0,
      last_retry: status === 'failed' || status === 'error' ? new Date().toISOString() : null
    };
    
    // Try to delete existing record (ignore errors)
    try {
      await fileStatusTable.delete(`path = "${filePath}"`);
    } catch (e) {
      // Ignore delete errors
    }
    
    // Insert new record
    await fileStatusTable.add([record]);
  } catch (e: any) {
    // Log error but don't disable the table - it might be a temporary issue
    console.debug('Error updating file status (non-critical):', e?.message || e);
  }
}

async function handleFile(filePath: string) {
  try {
    fileCount++; // Track files processed
    console.log(`[INDEXING] Starting: ${filePath}`);
    
    if (!fs.existsSync(filePath)) {
      await deleteByPath(filePath);
      fileHashes.delete(filePath);
      await updateFileStatus(filePath, 'deleted');
      return;
    }
    
    // Check if file is inside a bundle and bundle exclusion is enabled
    if (isInsideBundle(filePath)) {
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
            console.log(`[INDEXING] 📦 Skipping bundle: ${bundlePath}`);
            fileHashes.set(bundlePath + '_logged', 'logged');
          }
        }
      }
      return;
    }
    
    const currentHash = getFileHash(filePath);
    const previousHash = fileHashes.get(filePath);
    const stat = fs.statSync(filePath);
    const mtime = stat.mtimeMs;
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
          console.log(`[INDEXING] 🔄 Parser version changed for ${path.basename(filePath)}: v${fileStatus[0].parser_version} -> v${parserVersion}`);
        }
      } catch (e) {
        // Ignore errors in checking file status
      }
    }
    
    if (!needsReindex && previousHash === currentHash) {
      console.log(`[INDEXING] ⏭️ Skipped: ${path.basename(filePath)} - Already up-to-date`);
      return;
    }
    
    // Check if this file type is enabled
    const fileTypes = configManager?.getSettings().fileTypes || {};
    const isTypeEnabled = fileTypes[ext as keyof typeof fileTypes] ?? false;
    
    if (!isTypeEnabled) {
      console.log(`[INDEXING] ⏭️ Skipped: ${path.basename(filePath)} - File type disabled`);
      return; // Skip this file type
    }
    
    let chunks: Array<{ text: string; offset: number; page?: number }> = [];
    
    if (ext === 'pdf' && parsePdf) {
      try {
        const pages = await parsePdf(filePath);
        for (const pg of pages) {
          const pageChunks = chunkText(pg.text, 500, 60);
          chunks.push(...pageChunks.map(c => ({ ...c, page: pg.page })));
        }
      } catch (pdfError: any) {
        // Track specific PDF error
        const errorMsg = pdfError.message || 'Unknown PDF parsing error';
        await updateFileStatus(filePath, 'failed', `PDF: ${errorMsg}`, 0, parserVersion);
        console.warn(`[INDEXING] ⚠️ Failed: ${path.basename(filePath)} - PDF: ${errorMsg}`);
        return;
      }
    } else if (ext === 'txt' || ext === 'md') {
      const text = await parseText(filePath);
      chunks = chunkText(text, 500, 60);
    } else if (ext === 'docx') {
      const text = await parseDocx(filePath);
      chunks = chunkText(text, 500, 60);
    } else if (ext === 'rtf') {
      const text = await parseRtf(filePath);
      chunks = chunkText(text, 500, 60);
    } else if (ext === 'doc') {
      // Use proper .doc parser for old Word files
      const text = await parseDoc(filePath);
      chunks = chunkText(text, 500, 60);
    } else {
      return;
    }
    
    if (chunks.length === 0) {
      // Mark file as failed if no chunks were extracted
      await updateFileStatus(filePath, 'failed', 'No text content extracted', 0, parserVersion);
      console.warn(`[INDEXING] ⚠️ Failed: ${path.basename(filePath)} - No text content extracted`);
      return;
    }
    
    const batchSize = 8; // Small batches to minimize memory usage
    for (let i = 0; i < chunks.length; i += batchSize) {
      const batch = chunks.slice(i, i + batchSize);
      const texts = batch.map(c => c.text);
      const vectors = await embed(texts, false); // false = document chunks (use passage: prefix)
      
      const rows = batch.map((c, idx) => {
        const id = crypto.createHash('sha1')
          .update(`${filePath}:${c.page || 0}:${c.offset}`)
          .digest('hex');
        
        return {
          id,
          path: filePath,
          mtime,
          page: c.page || 0,
          offset: c.offset,
          text: c.text,
          vector: vectors[idx],
          type: ext,
          title: path.basename(filePath)
        };
      });
      
      await mergeRows(rows);
      
      // Clear batch data immediately and yield
      batch.length = 0;
      texts.length = 0;
      vectors.length = 0;
      rows.length = 0;
      
      // Yield to event loop
      await new Promise(r => setImmediate(r));
      if (global.gc) global.gc();
    }
    
    fileHashes.set(filePath, currentHash);
    
    // Update file status as successfully indexed
    const totalChunks = chunks.length;
    await updateFileStatus(filePath, 'indexed', undefined, totalChunks, parserVersion);
    console.log(`[INDEXING] ✅ Success: ${path.basename(filePath)} - ${totalChunks} chunks created`);
    
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
    
    await maybeCreateIndex();
    
    // Force garbage collection if available
    if (global.gc) {
      global.gc();
    }
  } catch (error: any) {
    console.error(`[INDEXING] ❌ Error: ${path.basename(filePath)} -`, error.message || error);
    // Track the error in the database
    await updateFileStatus(filePath, 'error', error.message || String(error));
  }
}

async function search(query: string, k = 10) {
  try {
    const [qvec] = await embed([query], true); // true = search query (use query: prefix)
    const results = await tbl.search(qvec)
      .limit(k)
      .toArray();
    
    const mappedResults = results.map((r: any) => {
      return {
        id: r.id,
        path: r.path,
        page: r.page || 0,
        offset: r.offset || 0,
        text: r.text || '',
        score: r._distance !== undefined ? Math.max(0, 1 - (r._distance / 2)) : 1,
        title: r.title || ''
      };
    });
    
    return mappedResults;
  } catch (error) {
    console.error('Search failed:', error);
    return [];
  }
}

async function reindexAll() {
  console.log('Starting full re-index with multilingual E5 model...');
  
  try {
    // Get all watched folders
    const watchedFolders = configManager?.getWatchedFolders() || [];
    if (watchedFolders.length === 0) {
      console.log('No folders to re-index');
      return;
    }
    
    // Clear the entire index
    if (tbl) {
      try {
        // Delete all existing chunks
        await tbl.delete('1=1'); // Delete all rows
        console.log('Cleared existing index');
      } catch (e) {
        console.error('Error clearing index:', e);
      }
    }
    
    // Clear file status table if available
    if (fileStatusTable) {
      try {
        // Delete all file status records
        await fileStatusTable.delete('1=1');
        console.log('Cleared file status records');
      } catch (e) {
        console.error('Error clearing file status:', e);
      }
    }
    
    // Clear file hashes to force re-indexing
    fileHashes.clear();
    
    // Reset folder stats
    for (const [folder, stats] of folderStats) {
      stats.indexed = 0;
    }
    
    // Pass a flag to force re-indexing of all files
    console.log('Restarting file watcher to re-index all files...');
    await startWatching(watchedFolders, configManager?.getEffectiveExcludePatterns(), true);
    
    console.log('Re-indexing started - files will be processed through normal queue');
    
  } catch (error) {
    console.error('Re-index failed:', error);
    throw error;
  }
}

async function maybeCreateIndex() {
  try {
    const count = await tbl.countRows();
    if (count > 50000) {
      await tbl.createIndex('vector').catch(() => {});
    }
  } catch (error) {
    console.error('Failed to create index:', error);
  }
}

async function getStats() {
  try {
    const count = await tbl.countRows();
    return {
      totalChunks: count,
      indexedFiles: fileHashes.size,
      folderStats: Array.from(folderStats.entries()).map(([folder, stats]) => ({
        folder,
        totalFiles: stats.total,
        indexedFiles: stats.indexed
      }))
    };
  } catch (error) {
    return {
      totalChunks: 0,
      indexedFiles: 0,
      folderStats: []
    };
  }
}

async function startWatching(roots: string[], excludePatterns?: string[], forceReindex: boolean = false) {
  if (watcher) {
    await watcher.close();
  }
  
  // Initialize folder stats (don't clear existing indexed counts)
  roots.forEach((root: string) => {
    if (!folderStats.has(root)) {
      folderStats.set(root, { total: 0, indexed: 0 });
    }
  });
  
  // Get effective exclude patterns (including bundle patterns if enabled)
  const effectivePatterns = configManager?.getEffectiveExcludePatterns() || excludePatterns || [];
  
  console.log(`[WATCHER] 👀 Starting to watch ${roots.length} folder(s): ${roots.join(', ')}`);
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
      console.log(`Loaded ${fileStatusCache.size} file status records into cache`);
    } catch (e) {
      console.error('Could not cache file status records:', e);
      fileStatusCache = new Map();
    }
  } else {
    console.log('File status table not available for caching');
    fileStatusCache = new Map();
  }
  
  // After watcher is set up, scan for new and modified files using our new classes
  await (async () => {
    if (forceReindex) {
      console.log('🔄 Force re-indexing enabled - all files will be queued');
    } else {
      console.log('Scanning for new and modified files...');
    }
    console.log('File status cache size:', fileStatusCache?.size || 0);
    console.log('Queue already has:', fileQueue.getStats().queued, 'files');
    
    // Use the extracted scanning function
    const scanOptions: ScanOptions = {
      excludeBundles: configManager?.getSettings().excludeBundles ?? true,
      bundlePatterns: configManager?.getSettings().bundlePatterns || [],
      excludePatterns: effectivePatterns.filter(p => typeof p === 'string') as string[],
      supportedExtensions: ['pdf', 'txt', 'md', 'docx', 'rtf', 'doc']
    };
    
    const scanResult = scanDirectories(roots, scanOptions);
    
    // Initialize our new classes
    const orchestrator = new ReindexOrchestrator();
    const scanner = new FileScanner();
    
    // Filter supported files using FileScanner
    const fileScannerConfig: FileScannerConfig = {
      skipBundles: configManager?.getSettings().excludeBundles ?? true,
      bundlePatterns: configManager?.getSettings().bundlePatterns || [],
      supportedExtensions: ['pdf', 'txt', 'md', 'docx', 'rtf', 'doc']
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
              const currentHash = getFileHash(filePath);
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
    
    console.log('Scan results:');
    console.log(`  - New files: ${stats.newFiles}`);
    console.log(`  - Modified files: ${stats.modifiedFiles}`);
    console.log(`  - Skipped files: ${stats.skippedFiles}`);
    console.log(`  - Failed files to retry: ${stats.failedFiles}`);
    console.log(`  - Outdated files: ${stats.outdatedFiles}`);
    console.log(`  - Hash calculations performed: ${hashChecks}`);
    
    if (filesToIndex.length > 0) {
      console.log(`Adding ${filesToIndex.length} files to queue`);
      fileQueue.add(filesToIndex);
    } else {
      console.log('No new or modified files found');
    }
    console.log('Total queue size after scan:', fileQueue.getStats().queued);
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
        console.log(`[QUEUE] 📥 Added: ${path.basename(p)} (Queue size: ${fileQueue.getStats().queued})`);
      }
    }
  });
  
  watcher.on('change', (p: string) => {
    const ext = path.extname(p).slice(1).toLowerCase();
    const supported = ['pdf', 'txt', 'md', 'docx', 'rtf', 'doc'].includes(ext);
    
    if (supported && !fileQueue.isProcessing(p)) {
      fileQueue.add(p);
      console.log(`[QUEUE] 📥 Added: ${path.basename(p)} (Queue size: ${fileQueue.getStats().queued})`);
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
    
    await deleteByPath(p);
    fileHashes.delete(p);
    
    fileQueue.remove(p);
  });
}

async function processQueue() {
  while (true) {
    // Wait for model to be ready
    if (!modelReady) {
      await new Promise(r => setTimeout(r, 100));
      continue;
    }
    
    // Process the queue
    await fileQueue.process(
      async (filePath) => {
        const maxConcurrent = fileQueue.getCurrentMaxConcurrent();
        console.log(`[INDEXING] 🔄 Processing: ${path.basename(filePath)} (${fileQueue.getProcessingFiles().length}/${maxConcurrent} concurrent)`);
        
        try {
          await handleFile(filePath);
        } finally {
          console.log(`[INDEXING] ✨ Completed: ${path.basename(filePath)} (${fileQueue.getProcessingFiles().length}/${maxConcurrent} still processing)`);
        }
      },
      () => process.memoryUsage().rss / 1024 / 1024 // Memory getter
    );
    
    // If paused, wait
    if (paused) {
      await new Promise(r => setTimeout(r, 100));
      continue;
    }
    
    // Wait before checking for new files
    await new Promise(r => setTimeout(r, 1000));
  }
}

parentPort!.on('message', async (msg: any) => {
  try {
    switch (msg.type) {
      case 'init':
        // Set user data path for embedder to use for model cache, with fallback for tests
        const userDataPath = msg.userDataPath || path.join(require('os').tmpdir(), 'semantica-test');
        process.env.USER_DATA_PATH = userDataPath;
        
        // Also provide fallback for dbDir
        const dbDir = msg.dbDir || path.join(userDataPath, 'data');
        await initDB(dbDir, userDataPath);
        parentPort!.postMessage({ type: 'ready' });
        
        // Initialize model in background after worker is ready
        initializeModel(userDataPath).then(() => {
          // Start processing queue only after model is ready
          if (modelReady) {
            processQueue();
          } else {
            console.error('[WORKER] Model not ready, cannot start processing');
          }
        });
        break;
        
      case 'checkModel':
        // Wait for model initialization to complete before responding
        // This ensures the UI gets the correct status
        const checkInterval = setInterval(() => {
          // Check if initialization is complete (modelReady will be set)
          if (modelReady !== null) {
            clearInterval(checkInterval);
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
        for (const p of paths) {
          if (!fileQueue.isProcessing(p)) fileQueue.add(p);
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
          paused
        };
        if (msg.id) {
          parentPort!.postMessage({ id: msg.id, payload: progress });
        }
        break;
        
      case 'search':
        const results = await search(msg.payload.q, msg.payload.k);
        
        if (msg.id) {
          parentPort!.postMessage({ id: msg.id, payload: results });
        }
        break;
        
      case 'stats':
        const stats = await getStats();
        if (msg.id) {
          parentPort!.postMessage({ id: msg.id, payload: stats });
        }
        break;
        
      case 'getWatchedFolders':
        if (msg.id) {
          parentPort!.postMessage({ id: msg.id, payload: configManager?.getWatchedFolders() || [] });
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
          console.error('Re-index error:', error);
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
              console.error('Error searching file status table:', e);
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
          console.error('Search files error:', error);
          if (msg.id) {
            parentPort!.postMessage({ id: msg.id, payload: [] });
          }
        }
        break;
      
      case 'shutdown':
        // Clean shutdown requested
        console.log('Worker shutting down...');
        await shutdownEmbedder();
        if (db) {
          await db.close();
        }
        process.exit(0);
    }
  } catch (error: any) {
    console.error('Worker message error:', error);
    if (msg.id) {
      parentPort!.postMessage({ id: msg.id, error: error?.message || String(error) });
    }
  }
});

// Add error handlers to prevent crashes
process.on('unhandledRejection', (reason, promise) => {
  console.error('Unhandled Rejection at:', promise, 'reason:', reason);
});

process.on('uncaughtException', (error) => {
  console.error('Uncaught Exception:', error);
  // Keep the worker alive
});

// Cleanup on exit
process.on('exit', async () => {
  await shutdownEmbedder();
});

process.on('SIGTERM', async () => {
  await shutdownEmbedder();
  process.exit(0);
});