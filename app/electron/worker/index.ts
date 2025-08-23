import { parentPort } from 'node:worker_threads';
import * as lancedb from '@lancedb/lancedb';
import { parsePdf } from '../parsers/pdf';
import { parseText } from '../parsers/text';
import { chunkText } from '../pipeline/chunker';
import { embed } from '../embeddings/local';
import crypto from 'node:crypto';
import chokidar from 'chokidar';
import fs from 'node:fs';
import path from 'node:path';

let db: any = null;
let tbl: any = null;
let paused = false;
let watcher: any = null;
const queue: string[] = [];
const processing = new Set<string>();
const fileHashes = new Map<string, string>();

interface QueuedFile {
  path: string;
  priority: number;
}

async function initDB(dir: string) {
  try {
    db = await lancedb.connect(dir);
    
    tbl = await db.openTable('chunks').catch(async () => {
      return db.createTable('chunks', [], {
        mode: 'create'
      });
    });
    
    console.log('Database initialized');
  } catch (error) {
    console.error('Failed to initialize database:', error);
    throw error;
  }
}

async function mergeRows(rows: any[]) {
  if (rows.length === 0) return;
  
  try {
    await tbl.mergeInsert('id')
      .whenMatchedUpdateAll()
      .whenNotMatchedInsertAll()
      .execute(rows);
  } catch (error) {
    console.error('Failed to merge rows:', error);
  }
}

async function deleteByPath(filePath: string) {
  try {
    const escaped = filePath.replace(/'/g, "''");
    await tbl.delete(`path = '${escaped}'`);
  } catch (error) {
    console.error('Failed to delete by path:', error);
  }
}

function getFileHash(filePath: string): string {
  const stat = fs.statSync(filePath);
  return `${stat.size}-${stat.mtimeMs}`;
}

async function handleFile(filePath: string) {
  try {
    if (!fs.existsSync(filePath)) {
      await deleteByPath(filePath);
      fileHashes.delete(filePath);
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
    
    let chunks: Array<{ text: string; offset: number; page?: number }> = [];
    
    if (ext === 'pdf') {
      const pages = await parsePdf(filePath);
      for (const pg of pages) {
        const pageChunks = chunkText(pg.text, 500, 60);
        chunks.push(...pageChunks.map(c => ({ ...c, page: pg.page })));
      }
    } else if (ext === 'txt' || ext === 'md') {
      const text = await parseText(filePath);
      chunks = chunkText(text, 500, 60);
    } else {
      return;
    }
    
    if (chunks.length === 0) return;
    
    const batchSize = 32;
    for (let i = 0; i < chunks.length; i += batchSize) {
      const batch = chunks.slice(i, i + batchSize);
      const texts = batch.map(c => c.text);
      const vectors = await embed(texts);
      
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
    }
    
    fileHashes.set(filePath, currentHash);
    
    await maybeCreateIndex();
  } catch (error) {
    console.error(`Failed to handle file ${filePath}:`, error);
  }
}

async function search(query: string, k = 10) {
  try {
    const [qvec] = await embed([query]);
    const results = await tbl.search(qvec)
      .limit(k)
      .toArray();
    
    return results.map((r: any) => ({
      id: r.id,
      path: r.path,
      page: r.page,
      offset: r.offset,
      text: r.text,
      score: r._distance ? 1 - r._distance : 0,
      title: r.title
    }));
  } catch (error) {
    console.error('Search failed:', error);
    return [];
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
      indexedFiles: fileHashes.size
    };
  } catch (error) {
    return {
      totalChunks: 0,
      indexedFiles: 0
    };
  }
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
        
        if (watcher) {
          await watcher.close();
        }
        
        watcher = chokidar.watch(roots, {
          ignored: options?.exclude || [],
          ignoreInitial: false,
          persistent: true,
          awaitWriteFinish: {
            stabilityThreshold: 1000,
            pollInterval: 100
          }
        });
        
        watcher.on('add', (p: string) => {
          if (!queue.includes(p)) queue.push(p);
        });
        
        watcher.on('change', (p: string) => {
          if (!queue.includes(p)) queue.push(p);
        });
        
        watcher.on('unlink', async (p: string) => {
          await deleteByPath(p);
          fileHashes.delete(p);
          
          const idx = queue.indexOf(p);
          if (idx !== -1) queue.splice(idx, 1);
        });
        
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
    }
  } catch (error) {
    console.error('Worker message error:', error);
    if (msg.id) {
      parentPort!.postMessage({ id: msg.id, error: error.message });
    }
  }
});