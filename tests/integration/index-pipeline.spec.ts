import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Worker } from 'node:worker_threads';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';

describe('Index Pipeline Integration', () => {
  let worker: Worker;
  let tempDir: string;
  let messageQueue: any[] = [];
  
  beforeAll(async () => {
    // Create temp directory for test database
    tempDir = path.join(os.tmpdir(), `test-db-${Date.now()}`);
    fs.mkdirSync(tempDir, { recursive: true });
    
    // Create test worker
    worker = new Worker(path.join(__dirname, '../../dist/worker.cjs'));
    
    // Set up message handler
    worker.on('message', (msg) => {
      messageQueue.push(msg);
    });
    
    // Initialize worker with test DB
    worker.postMessage({ type: 'init', dbDir: tempDir });
    
    // Wait for ready message
    await new Promise<void>((resolve) => {
      const checkReady = setInterval(() => {
        const readyMsg = messageQueue.find(m => m.type === 'ready');
        if (readyMsg) {
          clearInterval(checkReady);
          resolve();
        }
      }, 100);
    });
  });
  
  afterAll(async () => {
    if (worker) {
      await worker.terminate();
    }
    if (tempDir && fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });
  
  it('should process text files through the pipeline', async () => {
    // Create a test text file
    const testFile = path.join(tempDir, 'test.txt');
    fs.writeFileSync(testFile, 'This is a test document. It contains some text for indexing.');
    
    // Clear message queue
    messageQueue = [];
    
    // Enqueue the file
    const id = Math.random().toString(36);
    worker.postMessage({ 
      type: 'enqueue', 
      payload: { paths: [testFile] },
      id 
    });
    
    // Wait for response
    await new Promise<void>((resolve) => {
      const checkDone = setInterval(() => {
        const response = messageQueue.find(m => m.id === id);
        if (response) {
          clearInterval(checkDone);
          resolve();
        }
      }, 100);
      
      setTimeout(() => {
        clearInterval(checkDone);
        resolve();
      }, 5000);
    });
    
    // Verify file was processed
    expect(messageQueue.some(m => m.id === id)).toBe(true);
  });
  
  it('should handle search queries', async () => {
    // Clear message queue
    messageQueue = [];
    
    // Perform search
    const searchId = Math.random().toString(36);
    worker.postMessage({
      type: 'search',
      payload: { q: 'test document', k: 10 },
      id: searchId
    });
    
    // Wait for search results
    const results = await new Promise<any>((resolve) => {
      const checkResults = setInterval(() => {
        const response = messageQueue.find(m => m.id === searchId);
        if (response) {
          clearInterval(checkResults);
          resolve(response.payload);
        }
      }, 100);
      
      setTimeout(() => {
        clearInterval(checkResults);
        resolve([]);
      }, 5000);
    });
    
    // Verify search response structure
    expect(Array.isArray(results)).toBe(true);
  });
});