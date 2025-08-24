/**
 * Integration test for startup logic and file re-indexing behavior
 * 
 * Test scenarios:
 * 1. Fresh start - Empty folder, index files
 * 2. Restart with no changes - Should not re-index
 * 3. Add new file - Should index only new file
 * 4. Modify existing file - Should re-index modified file
 * 5. Parser upgrade - Should re-index affected files
 * 
 * Test structure:
 * - Create isolated test environment
 * - Use real worker thread with test database
 * - Control file timestamps for deterministic testing
 * - Verify indexing behavior through database queries
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { Worker } from 'node:worker_threads';
import { connect } from '@lancedb/lancedb';

interface TestEnvironment {
  testDir: string;
  dbDir: string;
  docsDir: string;
  worker: Worker | null;
  db: any;
}

describe('Startup and Re-indexing Integration Tests', () => {
  let env: TestEnvironment;
  
  beforeEach(async () => {
    // Create isolated test directories
    const testId = `test-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const baseDir = path.join(os.tmpdir(), 'fss-tests', testId);
    
    env = {
      testDir: baseDir,
      dbDir: path.join(baseDir, 'db'),
      docsDir: path.join(baseDir, 'docs'),
      worker: null,
      db: null
    };
    
    // Create directories
    fs.mkdirSync(env.docsDir, { recursive: true });
    fs.mkdirSync(env.dbDir, { recursive: true });
  });
  
  afterEach(async () => {
    // Clean up
    await stopWorker(env);
    
    // Remove test directories
    if (env.testDir && fs.existsSync(env.testDir)) {
      fs.rmSync(env.testDir, { recursive: true, force: true });
    }
  });
  
  /**
   * Test 1: Fresh start with empty folder
   */
  it('should index all files on fresh start', async () => {
    // Create test files
    createTestFile(env.docsDir, 'doc1.txt', 'Hello World');
    createTestFile(env.docsDir, 'doc2.md', '# Markdown Test');
    createTestFile(env.docsDir, 'doc3.pdf', 'PDF content placeholder');
    
    // Start worker and wait for indexing
    const stats = await startWorkerAndIndex(env);
    
    // Verify all files were indexed
    expect(stats.filesProcessed).toBe(3);
    expect(stats.newFiles).toBe(3);
    expect(stats.modifiedFiles).toBe(0);
    expect(stats.skippedFiles).toBe(0);
    
    // Verify database contains indexed documents
    const docs = await queryIndexedDocuments(env);
    expect(docs.length).toBeGreaterThan(0);
    expect(docs.some(d => d.path.includes('doc1.txt'))).toBe(true);
    expect(docs.some(d => d.path.includes('doc2.md'))).toBe(true);
    
    // Verify file status table
    const fileStatuses = await queryFileStatuses(env);
    expect(fileStatuses.length).toBe(3);
    expect(fileStatuses.every(f => f.status === 'indexed')).toBe(true);
  });
  
  /**
   * Test 2: Restart with no changes
   */
  it('should not re-index files on restart with no changes', async () => {
    // Create and index files
    createTestFile(env.docsDir, 'doc1.txt', 'Hello World');
    createTestFile(env.docsDir, 'doc2.md', '# Markdown Test');
    
    const stats1 = await startWorkerAndIndex(env);
    expect(stats1.filesProcessed).toBe(2);
    
    // Stop worker
    await stopWorker(env);
    
    // Restart worker - should not re-index
    const stats2 = await startWorkerAndIndex(env);
    
    expect(stats2.filesProcessed).toBe(0);
    expect(stats2.newFiles).toBe(0);
    expect(stats2.modifiedFiles).toBe(0);
    expect(stats2.skippedFiles).toBe(2);
    expect(stats2.hashCalculations).toBe(0); // No hash checks needed
  });
  
  /**
   * Test 3: Add new file
   */
  it('should index only new files on restart', async () => {
    // Create and index initial files
    createTestFile(env.docsDir, 'doc1.txt', 'Hello World');
    
    const stats1 = await startWorkerAndIndex(env);
    expect(stats1.filesProcessed).toBe(1);
    
    await stopWorker(env);
    
    // Add new file
    createTestFile(env.docsDir, 'doc2.md', '# New Document');
    
    // Restart - should index only new file
    const stats2 = await startWorkerAndIndex(env);
    
    expect(stats2.filesProcessed).toBe(1);
    expect(stats2.newFiles).toBe(1);
    expect(stats2.modifiedFiles).toBe(0);
    expect(stats2.skippedFiles).toBe(1);
  });
  
  /**
   * Test 4: Modify existing file
   */
  it('should re-index modified files', async () => {
    // Create and index file
    const filePath = path.join(env.docsDir, 'doc1.txt');
    fs.writeFileSync(filePath, 'Original content');
    
    const stats1 = await startWorkerAndIndex(env);
    expect(stats1.filesProcessed).toBe(1);
    
    await stopWorker(env);
    
    // Wait a bit to ensure timestamp difference
    await new Promise(resolve => setTimeout(resolve, 100));
    
    // Modify file
    fs.writeFileSync(filePath, 'Modified content');
    
    // Restart - should re-index modified file
    const stats2 = await startWorkerAndIndex(env);
    
    expect(stats2.filesProcessed).toBe(1);
    expect(stats2.newFiles).toBe(0);
    expect(stats2.modifiedFiles).toBe(1);
    expect(stats2.hashCalculations).toBe(1); // Should check hash
    
    // Verify content was updated
    const docs = await queryIndexedDocuments(env);
    const doc = docs.find(d => d.path === filePath);
    expect(doc?.text).toContain('Modified content');
  });
  
  /**
   * Test 5: Parser version upgrade simulation
   */
  it('should re-index files when parser version changes', async () => {
    // Create and index files with "old" parser
    createTestFile(env.docsDir, 'doc1.doc', 'Word document');
    
    const stats1 = await startWorkerAndIndex(env, { parserVersion: 1 });
    expect(stats1.filesProcessed).toBe(1);
    
    await stopWorker(env);
    
    // Restart with "new" parser version
    const stats2 = await startWorkerAndIndex(env, { parserVersion: 2 });
    
    expect(stats2.filesProcessed).toBe(1);
    expect(stats2.parserUpgrades).toEqual({ doc: 1 });
    
    // Verify parser version was updated
    const fileStatuses = await queryFileStatuses(env);
    const docStatus = fileStatuses.find(f => f.path.includes('doc1.doc'));
    expect(docStatus?.parser_version).toBe(2);
  });
  
  /**
   * Test 6: Failed file retry logic
   */
  it('should retry failed files after cooldown period', async () => {
    // Create a file that will fail parsing
    createTestFile(env.docsDir, 'corrupt.pdf', 'Invalid PDF data');
    
    const stats1 = await startWorkerAndIndex(env);
    expect(stats1.failedFiles).toBe(1);
    
    // Verify file marked as failed
    let fileStatuses = await queryFileStatuses(env);
    let pdfStatus = fileStatuses.find(f => f.path.includes('corrupt.pdf'));
    expect(pdfStatus?.status).toBe('failed');
    
    await stopWorker(env);
    
    // Simulate time passing (update last_retry to be old)
    await updateLastRetryTime(env, 'corrupt.pdf', -25 * 60 * 60 * 1000); // 25 hours ago
    
    // Restart - should retry failed file
    const stats2 = await startWorkerAndIndex(env);
    
    expect(stats2.retriedFiles).toBe(1);
  });
});

// Helper Functions

function createTestFile(dir: string, filename: string, content: string): string {
  const filePath = path.join(dir, filename);
  fs.writeFileSync(filePath, content);
  return filePath;
}

async function startWorkerAndIndex(
  env: TestEnvironment, 
  options: { parserVersion?: number } = {}
): Promise<IndexingStats> {
  return new Promise((resolve, reject) => {
    // Create worker
    env.worker = new Worker(
      path.join(__dirname, '../../dist/worker.cjs'),
      {
        workerData: {
          testMode: true,
          parserVersionOverride: options.parserVersion
        }
      }
    );
    
    let stats: IndexingStats = {
      filesProcessed: 0,
      newFiles: 0,
      modifiedFiles: 0,
      skippedFiles: 0,
      failedFiles: 0,
      retriedFiles: 0,
      hashCalculations: 0,
      parserUpgrades: {}
    };
    
    env.worker.on('message', (msg) => {
      if (msg.type === 'ready') {
        // Worker initialized, start watching
        env.worker!.postMessage({
          type: 'watchStart',
          payload: {
            roots: [env.docsDir],
            options: {
              excludePatterns: ['node_modules', '.git']
            }
          }
        });
      } else if (msg.type === 'scan-complete') {
        // Scan completed, collect stats
        stats = msg.stats;
      } else if (msg.type === 'indexing-complete') {
        // All files processed
        resolve(stats);
      }
    });
    
    env.worker.on('error', reject);
    
    // Initialize worker with test database
    env.worker.postMessage({
      type: 'init',
      dbDir: env.dbDir
    });
    
    // Set timeout
    setTimeout(() => {
      reject(new Error('Worker timeout'));
    }, 30000);
  });
}

async function stopWorker(env: TestEnvironment): Promise<void> {
  if (env.worker) {
    env.worker.postMessage({ type: 'shutdown' });
    await new Promise(resolve => setTimeout(resolve, 500));
    await env.worker.terminate();
    env.worker = null;
  }
  
  if (env.db) {
    // Close database connection
    env.db = null;
  }
}

async function queryIndexedDocuments(env: TestEnvironment): Promise<any[]> {
  if (!env.db) {
    env.db = await connect(env.dbDir);
  }
  
  const table = await env.db.openTable('documents');
  return table.query().select(['path', 'text']).limit(1000).toArray();
}

async function queryFileStatuses(env: TestEnvironment): Promise<any[]> {
  if (!env.db) {
    env.db = await connect(env.dbDir);
  }
  
  const table = await env.db.openTable('file_status');
  return table.query().toArray();
}

async function updateLastRetryTime(
  env: TestEnvironment, 
  filename: string, 
  offsetMs: number
): Promise<void> {
  if (!env.db) {
    env.db = await connect(env.dbDir);
  }
  
  const table = await env.db.openTable('file_status');
  const records = await table.query().toArray();
  const record = records.find(r => r.path.includes(filename));
  
  if (record) {
    const newTime = new Date(Date.now() + offsetMs).toISOString();
    await table.delete(`path = "${record.path}"`);
    await table.add([{ ...record, last_retry: newTime }]);
  }
}

interface IndexingStats {
  filesProcessed: number;
  newFiles: number;
  modifiedFiles: number;
  skippedFiles: number;
  failedFiles: number;
  retriedFiles: number;
  hashCalculations: number;
  parserUpgrades: Record<string, number>;
}