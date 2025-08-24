import { parentPort } from 'node:worker_threads';
import * as lancedb from '@lancedb/lancedb';

// Monitor memory usage
let fileCount = 0;
// Memory monitoring and governor
setInterval(async () => {
  const usage = process.memoryUsage();
  const rssMB = Math.round(usage.rss / 1024 / 1024);
  const heapMB = Math.round(usage.heapUsed / 1024 / 1024);
  const heapTotalMB = Math.round(usage.heapTotal / 1024 / 1024);
  const extMB = Math.round(usage.external / 1024 / 1024);
  
  console.log(`Memory: RSS=${rssMB}MB, Heap=${heapMB}MB/${heapTotalMB}MB, External=${extMB}MB, Files processed: ${fileCount}`);
  
  // Check if embedder needs restart
  const restarted = await checkEmbedderMemory();
  if (restarted) {
    console.log('Embedder process restarted due to memory limits');
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
import { embed, checkEmbedderMemory, shutdownEmbedder } from '../embeddings/isolated';
import crypto from 'node:crypto';
import chokidar from 'chokidar';
import fs from 'node:fs';
import path from 'node:path';
import { ConfigManager } from './config';

let db: any = null;
let tbl: any = null;
let fileStatusTable: any = null; // Table to track file status
let paused = false;
const fileChunkCounts = new Map<string, number>(); // Track chunk counts per file
let watcher: any = null;
let configManager: ConfigManager | null = null;
const queue: string[] = [];
const processing = new Set<string>();
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

async function initDB(dir: string) {
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
      // Check if table exists by trying to open it
      const tables = await db.tableNames();
      if (tables.includes('file_status')) {
        fileStatusTable = await db.openTable('file_status');
      } else {
        // Create new table with dummy data (LanceDB requirement)
        const dummyData = [{
          path: '__init__',
          status: 'init',
          error_message: '',
          chunk_count: 0,
          last_modified: new Date().toISOString(),
          indexed_at: new Date().toISOString(),
          file_hash: ''
        }];
        
        fileStatusTable = await db.createTable('file_status', dummyData);
        
        // Try to clean up the dummy record (may fail but that's OK)
        try {
          await fileStatusTable.delete('path = "__init__"');
        } catch (e) {
          // Ignore - some versions of LanceDB don't support delete
        }
      }
    } catch (e) {
      console.log('File status tracking not available (optional feature)');
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
    
    // Schedule auto-start after initialization completes
    setTimeout(async () => {
      const config = await configManager!.getConfig();
      const savedFolders = config.watchedFolders || [];
      if (savedFolders.length > 0) {
        console.log('Auto-starting watch on saved folders:', savedFolders);
        startWatching(savedFolders, config.settings?.excludePatterns || ['node_modules', '.git', '*.tmp', '.DS_Store']);
        
        // Initialize indexed counts for each folder
        setTimeout(() => {
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
        }, 500);
      }
    }, 1000);
  } catch (error) {
    console.error('Failed to initialize database:', error);
    throw error;
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

async function updateFileStatus(filePath: string, status: string, error?: string, chunkCount?: number) {
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
      file_hash: fileHashes.get(filePath) || ''
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
    // Silently fail - status tracking is optional
    if (e?.message?.includes('not found')) {
      fileStatusTable = null; // Disable if table issues
    }
  }
}

async function handleFile(filePath: string) {
  try {
    fileCount++; // Track files processed
    
    if (!fs.existsSync(filePath)) {
      await deleteByPath(filePath);
      fileHashes.delete(filePath);
      await updateFileStatus(filePath, 'deleted');
      return;
    }
    
    const currentHash = getFileHash(filePath);
    const previousHash = fileHashes.get(filePath);
    
    if (previousHash === currentHash) {
      return;
    }
    
    const stat = fs.statSync(filePath);
    const mtime = stat.mtimeMs;
    const ext = path.extname(filePath).slice(1).toLowerCase();
    
    // Check if this file type is enabled
    const fileTypes = configManager?.getSettings().fileTypes || {};
    const isTypeEnabled = fileTypes[ext as keyof typeof fileTypes] ?? false;
    
    if (!isTypeEnabled) {
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
        await updateFileStatus(filePath, 'failed', `PDF: ${errorMsg}`);
        console.warn(`PDF parsing failed for ${filePath}: ${errorMsg}`);
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
      await updateFileStatus(filePath, 'failed', 'No text content extracted');
      console.warn(`No text extracted from ${filePath}`);
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
    await updateFileStatus(filePath, 'indexed', undefined, totalChunks);
    
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
    console.error(`Failed to handle file ${filePath}:`, error);
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
    
    return results.map((r: any) => ({
      id: r.id,
      path: r.path,
      page: r.page,
      offset: r.offset,
      text: r.text,
      score: r._distance !== undefined ? Math.max(0, 1 - (r._distance / 2)) : 1,
      title: r.title
    }));
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
    
    // Clear file hashes to force re-indexing
    fileHashes.clear();
    
    // Reset folder stats
    for (const [folder, stats] of folderStats) {
      stats.indexed = 0;
    }
    
    // Restart the watcher to trigger re-indexing of all files
    console.log('Restarting file watcher to re-index all files...');
    await startWatching(watchedFolders, configManager?.getSettings()?.excludePatterns);
    
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

async function startWatching(roots: string[], excludePatterns?: string[]) {
  if (watcher) {
    await watcher.close();
  }
  
  // Initialize folder stats (don't clear existing indexed counts)
  roots.forEach((root: string) => {
    if (!folderStats.has(root)) {
      folderStats.set(root, { total: 0, indexed: 0 });
    }
  });
  
  watcher = chokidar.watch(roots, {
    ignored: excludePatterns || [],
    ignoreInitial: false,
    persistent: true,
    awaitWriteFinish: {
      stabilityThreshold: 1000,
      pollInterval: 100
    },
    // Use polling in test environment to avoid fsevents issues
    usePolling: process.env.NODE_ENV === 'test',
    interval: 100
  });
  
  watcher.on('add', (p: string) => {
    // Update total file count
    for (const [folder, stats] of folderStats) {
      if (p.startsWith(folder)) {
        stats.total++;
        break;
      }
    }
    
    // Only queue supported file types that aren't already indexed
    const ext = path.extname(p).slice(1).toLowerCase();
    const supported = ['pdf', 'txt', 'md', 'docx', 'rtf', 'doc'].includes(ext);
    
    if (supported && !queue.includes(p) && !fileHashes.has(p)) {
      queue.push(p);
    }
  });
  
  watcher.on('change', (p: string) => {
    const ext = path.extname(p).slice(1).toLowerCase();
    const supported = ['pdf', 'txt', 'md', 'docx', 'rtf', 'doc'].includes(ext);
    
    if (supported && !queue.includes(p)) {
      queue.push(p);
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
    
    const idx = queue.indexOf(p);
    if (idx !== -1) queue.splice(idx, 1);
  });
}

async function processQueue() {
  while (true) {
    if (paused || queue.length === 0) {
      await new Promise(r => setTimeout(r, 100));
      continue;
    }
    
    const filePath = queue.shift()!;
    
    if (processing.has(filePath)) continue;
    
    processing.add(filePath);
    
    try {
      await handleFile(filePath);
      
      parentPort!.postMessage({
        type: 'progress',
        payload: {
          queued: queue.length,
          processing: processing.size - 1,
          done: fileHashes.size,
          errors: 0
        }
      });
    } catch (error) {
      console.error(`Error processing ${filePath}:`, error);
    } finally {
      processing.delete(filePath);
    }
    
    await new Promise(r => setTimeout(r, 10));
  }
}

parentPort!.on('message', async (msg: any) => {
  try {
    switch (msg.type) {
      case 'init':
        await initDB(msg.dbDir);
        parentPort!.postMessage({ type: 'ready' });
        processQueue();
        break;
        
      case 'watchStart':
        const { roots, options } = msg.payload;
        
        // Save folders to config
        configManager?.setWatchedFolders(roots);
        
        // Start watching
        await startWatching(roots, options?.exclude);
        
        if (msg.id) {
          parentPort!.postMessage({ id: msg.id, payload: { success: true } });
        }
        break;
        
      case 'enqueue':
        const { paths } = msg.payload;
        for (const p of paths) {
          if (!queue.includes(p)) queue.push(p);
        }
        if (msg.id) {
          parentPort!.postMessage({ id: msg.id, payload: { success: true } });
        }
        break;
        
      case 'pause':
        paused = true;
        if (msg.id) {
          parentPort!.postMessage({ id: msg.id, payload: { success: true } });
        }
        break;
        
      case 'resume':
        paused = false;
        if (msg.id) {
          parentPort!.postMessage({ id: msg.id, payload: { success: true } });
        }
        break;
        
      case 'progress':
        const progress = {
          queued: queue.length,
          processing: processing.size,
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
              const allStatuses = await fileStatusTable.toArray();
              for (const record of allStatuses) {
                if (record.path.toLowerCase().includes(searchQuery)) {
                  // Check if currently in queue
                  const queuePosition = queue.indexOf(record.path);
                  const isProcessing = processing.has(record.path);
                  
                  let status = record.status;
                  if (queuePosition >= 0 || isProcessing) {
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
          for (let i = 0; i < queue.length && results.length < 30; i++) {
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
        break;
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