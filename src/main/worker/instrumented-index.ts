/**
 * Instrumented version of worker/index.ts handleFile function
 * 
 * This file shows how to add performance profiling to the existing worker.
 * To use: Replace the handleFile function in index.ts with this instrumented version.
 */

import { profiler } from './PerformanceProfiler';

// Add this import at the top of index.ts:
// import { profiler } from './PerformanceProfiler';

// Replace the existing handleFile function with this instrumented version:
async function handleFileInstrumented(filePath: string) {
  try {
    fileCount++; // Track files processed
    
    // Start file profiling
    const stat = fs.statSync(filePath);
    const ext = path.extname(filePath).slice(1).toLowerCase();
    profiler.startFile(filePath, stat.size, ext);
    
    console.log(`[INDEXING] Starting: ${filePath}`);
    
    if (!fs.existsSync(filePath)) {
      await deleteByPath(filePath);
      fileHashes.delete(filePath);
      await updateFileStatus(filePath, 'deleted');
      profiler.endFile(filePath, true);
      return;
    }
    
    // Check if file is inside a bundle and bundle exclusion is enabled
    if (isInsideBundle(filePath)) {
      profiler.endFile(filePath, true);
      return;
    }
    
    // PROFILE: Hash checking
    const currentHash = await profiler.timeFileOperationAsync(filePath, 'hashCheck', async () => {
      return getFileHash(filePath);
    });
    
    const previousHash = fileHashes.get(filePath);
    const mtime = stat.mtimeMs;
    const parserVersion = getParserVersion(ext);
    
    // Check if file needs reindexing
    let needsReindex = false;
    if (fileStatusTable) {
      needsReindex = await profiler.timeFileOperationAsync(filePath, 'statusCheck', async () => {
        try {
          const fileStatus = await fileStatusTable.query()
            .filter(`path = "${filePath}"`)
            .limit(1)
            .toArray();
          if (fileStatus.length > 0 && fileStatus[0].parser_version !== parserVersion) {
            console.log(`[INDEXING] 🔄 Parser version changed for ${path.basename(filePath)}`);
            return true;
          }
        } catch (e) {
          // Ignore errors
        }
        return false;
      });
    }
    
    if (!needsReindex && previousHash === currentHash) {
      console.log(`[INDEXING] ⏭️ Skipped: ${path.basename(filePath)} - Already up-to-date`);
      profiler.endFile(filePath, true);
      return;
    }
    
    // Find parser for this file extension
    const parserEntry = getParserForExtension(ext);
    if (!parserEntry) {
      console.log(`[INDEXING] ⏭️ Skipped: ${path.basename(filePath)} - No parser for .${ext}`);
      profiler.endFile(filePath, false, `No parser for .${ext}`);
      return;
    }
    
    const [parserKey, parserDef] = parserEntry;
    
    // Check if this file type is enabled
    const fileTypes = configManager?.getSettings().fileTypes || {};
    const isTypeEnabled = fileTypes[parserKey as keyof typeof fileTypes] ?? false;
    
    if (!isTypeEnabled) {
      console.log(`[INDEXING] ⏭️ Skipped: ${path.basename(filePath)} - File type disabled`);
      profiler.endFile(filePath, false, 'File type disabled');
      return;
    }
    
    let chunks: Array<{ text: string; offset: number; page?: number }> = [];
    
    // PROFILE: Parsing
    const parseResult = await profiler.timeFileOperationAsync(filePath, 'parsing', async () => {
      // Special handling for PDF
      if (ext === 'pdf' && parsePdf) {
        try {
          const pages = await parsePdf(filePath);
          const allChunks = [];
          for (const pg of pages) {
            const pageChunks = chunkText(pg.text, 500, 60);
            allChunks.push(...pageChunks.map(c => ({ ...c, page: pg.page })));
          }
          return allChunks;
        } catch (pdfError: any) {
          throw pdfError;
        }
      } else {
        // Dynamic parser loading for all other file types
        try {
          const parserModule = await parserDef.parser();
          const text = await parserModule(filePath);
          
          // PROFILE: Chunking separately
          return profiler.timeFileOperation(filePath, 'chunking', () => {
            const chunkSize = parserDef.chunkSize || 500;
            const chunkOverlap = parserDef.chunkOverlap || 60;
            return chunkText(text, chunkSize, chunkOverlap);
          });
        } catch (parseError: any) {
          throw parseError;
        }
      }
    });
    
    chunks = parseResult;
    
    if (chunks.length === 0) {
      await updateFileStatus(filePath, 'failed', 'No text content extracted', 0, parserVersion);
      console.warn(`[INDEXING] ⚠️ Failed: ${path.basename(filePath)} - No text content extracted`);
      profiler.endFile(filePath, false, 'No text content extracted');
      return;
    }
    
    // Record chunk metrics
    const avgChunkSize = chunks.reduce((sum, c) => sum + c.text.length, 0) / chunks.length;
    profiler.recordChunks(filePath, chunks.length, avgChunkSize);
    
    // PROFILE: Embedding and database writes
    await profiler.timeFileOperationAsync(filePath, 'embedding', async () => {
      const batchSize = 8;
      let totalBatches = 0;
      
      for (let i = 0; i < chunks.length; i += batchSize) {
        const batch = chunks.slice(i, i + batchSize);
        const texts = batch.map(c => c.text);
        
        // Track embedding batch
        profiler.recordEmbeddingBatch(filePath);
        totalBatches++;
        
        // Get embeddings
        const vectors = await embed(texts, false);
        
        // Prepare rows
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
        
        // PROFILE: Database write
        await profiler.timeFileOperationAsync(filePath, 'dbWrite', async () => {
          // Track write queue depth
          profiler.recordDBWrite(rows.length, writeQueue.length);
          await mergeRows(rows);
        });
        
        // Clear batch data and yield
        batch.length = 0;
        texts.length = 0;
        vectors.length = 0;
        rows.length = 0;
        
        await new Promise(r => setImmediate(r));
        if (global.gc) global.gc();
      }
      
      return totalBatches;
    });
    
    fileHashes.set(filePath, currentHash);
    
    // Update file status
    await updateFileStatus(filePath, 'indexed', undefined, chunks.length, parserVersion);
    console.log(`[INDEXING] ✅ Success: ${path.basename(filePath)} - ${chunks.length} chunks created`);
    
    // End file profiling
    profiler.endFile(filePath, true);
    
    // Clear references
    chunks = null as any;
    
    await maybeCreateIndex();
    
    if (global.gc) {
      global.gc();
    }
  } catch (error: any) {
    console.error(`[INDEXING] ❌ Error: ${path.basename(filePath)} -`, error.message || error);
    await updateFileStatus(filePath, 'error', error.message || String(error));
    profiler.endFile(filePath, false, error.message || String(error));
  }
}

// Add instrumentation to the isolated embedder
// In src/shared/embeddings/isolated.ts, add:

export async function embedWithProfiling(texts: string[], isQuery = false): Promise<number[][]> {
  const opId = `embed:${texts.length}texts`;
  profiler.startOperation(opId, { textCount: texts.length, isQuery });
  
  try {
    // Track if embedder needs restart
    if (embedder && embedder.shouldRestart()) {
      profiler.recordEmbedderRestart();
    }
    
    const result = await embed(texts, isQuery);
    profiler.endOperation(opId);
    return result;
  } catch (error) {
    profiler.endOperation(opId);
    throw error;
  }
}

// Add instrumentation to ConcurrentQueue
// In the process method, add:

async processWithProfiling(
  handler: (filePath: string) => Promise<void>,
  getMemoryMB?: () => number
): Promise<void> {
  // ... existing code ...
  
  // When throttling occurs:
  if (newMaxConcurrent !== this.lastMaxConcurrent) {
    if (newMaxConcurrent < this.maxConcurrent) {
      profiler.recordThrottleStart();
    } else {
      profiler.recordThrottleEnd();
    }
    this.options.onMemoryThrottle?.(newMaxConcurrent, memoryMB);
    this.lastMaxConcurrent = newMaxConcurrent;
  }
  
  // ... rest of the method
}

// Add command to generate report
// In the worker message handler, add:

if (msg.type === 'generatePerformanceReport') {
  await profiler.saveReport(msg.outputPath);
  parentPort?.postMessage({ 
    type: 'performanceReportGenerated',
    path: msg.outputPath 
  });
}