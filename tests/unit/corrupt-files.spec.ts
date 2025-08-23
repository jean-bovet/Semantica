import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { Worker } from 'node:worker_threads';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

describe('Corrupt File Handling', { timeout: 30000 }, () => {
  let tempDir: string;
  let worker: Worker | null = null;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'corrupt-files-test-'));
  });

  afterEach(async () => {
    if (worker) {
      await worker.terminate();
      worker = null;
    }
    if (fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it('should handle various corrupt PDF formats gracefully', async () => {
    const subDir = path.join(tempDir, 'pdfs');
    fs.mkdirSync(subDir);
    
    // Create various corrupt PDFs
    const corruptPdfs = [
      { name: 'empty.pdf', content: '' },
      { name: 'invalid.pdf', content: 'This is not a PDF' },
      { name: 'truncated.pdf', content: '%PDF-1.4\n1 0 obj\n<<incomplete' },
      { name: 'bad-xref.pdf', content: '%PDF-1.4\nxref\n0 1\ninvalid entry' },
      { name: 'binary-garbage.pdf', content: Buffer.from([0xFF, 0xFE, 0x00, 0x01, 0x02, 0x03]).toString() }
    ];
    
    corruptPdfs.forEach(pdf => {
      fs.writeFileSync(path.join(subDir, pdf.name), pdf.content);
    });
    
    // Also add a valid file to ensure processing continues
    fs.writeFileSync(path.join(subDir, 'valid.txt'), 'Valid text content');
    
    worker = new Worker(path.join(__dirname, '../../dist/worker.cjs'));
    
    const initPromise = new Promise((resolve) => {
      worker!.once('message', (msg) => {
        if (msg.type === 'ready') resolve(true);
      });
    });
    
    worker.postMessage({ type: 'init', dbDir: tempDir });
    await initPromise;
    
    // Start watching
    const watchPromise = new Promise((resolve) => {
      const id = Math.random().toString(36);
      worker!.once('message', (msg) => {
        if (msg.id === id) resolve(msg);
      });
      worker!.postMessage({ 
        type: 'watchStart', 
        payload: { roots: [subDir], options: {} },
        id 
      });
    });
    
    await watchPromise;
    
    // Wait for processing
    await new Promise(r => setTimeout(r, 3000));
    
    // Worker should still be running
    const progressPromise = new Promise((resolve) => {
      const id = Math.random().toString(36);
      worker!.once('message', (msg) => {
        if (msg.id === id) resolve(msg.payload);
      });
      worker!.postMessage({ type: 'progress', id });
    });
    
    const progress = await progressPromise as any;
    expect(progress).toBeDefined();
    
    // Valid file should be indexed
    const statsPromise = new Promise((resolve) => {
      const id = Math.random().toString(36);
      worker!.once('message', (msg) => {
        if (msg.id === id) resolve(msg.payload);
      });
      worker!.postMessage({ type: 'stats', id });
    });
    
    const stats = await statsPromise as any;
    expect(stats.indexedFiles).toBeGreaterThanOrEqual(1); // At least the valid.txt
  });

  it('should handle corrupt DOCX files', async () => {
    const subDir = path.join(tempDir, 'docs');
    fs.mkdirSync(subDir);
    
    // Create corrupt DOCX files
    fs.writeFileSync(path.join(subDir, 'corrupt.docx'), 'Not a valid DOCX');
    fs.writeFileSync(path.join(subDir, 'empty.docx'), '');
    
    // Add a valid file
    fs.writeFileSync(path.join(subDir, 'valid.md'), '# Valid Markdown');
    
    worker = new Worker(path.join(__dirname, '../../dist/worker.cjs'));
    
    const initPromise = new Promise((resolve) => {
      worker!.once('message', (msg) => {
        if (msg.type === 'ready') resolve(true);
      });
    });
    
    worker.postMessage({ type: 'init', dbDir: tempDir });
    await initPromise;
    
    // Process files
    const files = fs.readdirSync(subDir).map(f => path.join(subDir, f));
    const enqueuePromise = new Promise((resolve) => {
      const id = Math.random().toString(36);
      worker!.once('message', (msg) => {
        if (msg.id === id) resolve(msg);
      });
      worker!.postMessage({ 
        type: 'enqueue', 
        payload: { paths: files },
        id 
      });
    });
    
    await enqueuePromise;
    await new Promise(r => setTimeout(r, 2000));
    
    // Worker should continue working
    const statsPromise = new Promise((resolve) => {
      const id = Math.random().toString(36);
      worker!.once('message', (msg) => {
        if (msg.id === id) resolve(msg.payload);
      });
      worker!.postMessage({ type: 'stats', id });
    });
    
    const stats = await statsPromise as any;
    expect(stats.indexedFiles).toBeGreaterThanOrEqual(1); // At least valid.md
  });

  it('should handle file system errors gracefully', async () => {
    worker = new Worker(path.join(__dirname, '../../dist/worker.cjs'));
    
    const initPromise = new Promise((resolve) => {
      worker!.once('message', (msg) => {
        if (msg.type === 'ready') resolve(true);
      });
    });
    
    worker.postMessage({ type: 'init', dbDir: tempDir });
    await initPromise;
    
    // Try to process non-existent files
    const nonExistentFiles = [
      '/does/not/exist/file1.txt',
      '/invalid/path/file2.pdf',
      path.join(tempDir, 'deleted.txt')
    ];
    
    const enqueuePromise = new Promise((resolve) => {
      const id = Math.random().toString(36);
      worker!.once('message', (msg) => {
        if (msg.id === id) resolve(msg);
      });
      worker!.postMessage({ 
        type: 'enqueue', 
        payload: { paths: nonExistentFiles },
        id 
      });
    });
    
    await enqueuePromise;
    await new Promise(r => setTimeout(r, 1000));
    
    // Worker should still be responsive
    const progressPromise = new Promise((resolve) => {
      const id = Math.random().toString(36);
      worker!.once('message', (msg) => {
        if (msg.id === id) resolve(msg.payload);
      });
      worker!.postMessage({ type: 'progress', id });
    });
    
    const progress = await progressPromise as any;
    expect(progress).toBeDefined();
    expect(progress.errors).toBeDefined();
  });

  it('should handle mixed valid and corrupt files in batch', async () => {
    const subDir = path.join(tempDir, 'mixed');
    fs.mkdirSync(subDir);
    
    // Create a mix of valid and corrupt files
    fs.writeFileSync(path.join(subDir, 'good1.txt'), 'Valid content 1');
    fs.writeFileSync(path.join(subDir, 'bad1.pdf'), 'Invalid PDF');
    fs.writeFileSync(path.join(subDir, 'good2.md'), '# Valid markdown');
    fs.writeFileSync(path.join(subDir, 'bad2.docx'), Buffer.from([0xFF, 0xFE]));
    fs.writeFileSync(path.join(subDir, 'good3.txt'), 'Valid content 3');
    
    worker = new Worker(path.join(__dirname, '../../dist/worker.cjs'));
    
    const initPromise = new Promise((resolve) => {
      worker!.once('message', (msg) => {
        if (msg.type === 'ready') resolve(true);
      });
    });
    
    worker.postMessage({ type: 'init', dbDir: tempDir });
    await initPromise;
    
    // Start watching
    const watchPromise = new Promise((resolve) => {
      const id = Math.random().toString(36);
      worker!.once('message', (msg) => {
        if (msg.id === id) resolve(msg);
      });
      worker!.postMessage({ 
        type: 'watchStart', 
        payload: { roots: [subDir], options: {} },
        id 
      });
    });
    
    await watchPromise;
    await new Promise(r => setTimeout(r, 3000));
    
    // Get final stats
    const statsPromise = new Promise((resolve) => {
      const id = Math.random().toString(36);
      worker!.once('message', (msg) => {
        if (msg.id === id) resolve(msg.payload);
      });
      worker!.postMessage({ type: 'stats', id });
    });
    
    const stats = await statsPromise as any;
    
    // Should index only the valid files (3 out of 5)
    expect(stats.indexedFiles).toBe(3);
    
    const folderStat = stats.folderStats.find((s: any) => s.folder === subDir);
    expect(folderStat.totalFiles).toBe(5);
    expect(folderStat.indexedFiles).toBe(3);
  });
});