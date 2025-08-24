import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import * as lancedb from '@lancedb/lancedb';
import { chunkText } from '../../app/electron/pipeline/chunker';
import { parseText } from '../../app/electron/parsers/text';
import { MockEmbedder384 } from '../fixtures/tiny-embedder';

const fixturesDir = path.join(__dirname, '../fixtures');

describe('Document Pipeline Integration', () => {
  let db: any;
  let tempDir: string;
  let embedder: MockEmbedder384;
  
  beforeEach(async () => {
    // Set up test database
    tempDir = path.join(os.tmpdir(), `pipeline-test-${Date.now()}`);
    fs.mkdirSync(tempDir, { recursive: true });
    db = await lancedb.connect(tempDir);
    
    // Set up mock embedder
    embedder = new MockEmbedder384();
  });
  
  afterEach(async () => {
    // Clean up
    if (fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it('should process document end-to-end', async () => {
    // 1. Real parser
    const filePath = path.join(fixturesDir, 'simple.txt');
    const text = await parseText(filePath);
    expect(text).toContain('simple test file');
    expect(text.length).toBeGreaterThan(0);
    
    // 2. Real chunker
    const chunks = chunkText(text, 500, 60);
    expect(chunks).toHaveLength(1); // Small file should be 1 chunk
    expect(chunks[0].text).toContain('simple test file');
    expect(chunks[0].offset).toBe(0);
    
    // 3. Mock embeddings (deterministic)
    const vectors = await embedder.embed(chunks.map(c => c.text));
    expect(vectors).toHaveLength(chunks.length);
    expect(vectors[0]).toHaveLength(384);
    
    // Verify normalization
    const magnitude = Math.sqrt(
      vectors[0].reduce((sum, val) => sum + val * val, 0)
    );
    expect(magnitude).toBeCloseTo(1.0, 5);
    
    // 4. Real database operations
    const tableData = chunks.map((chunk, i) => ({
      id: `chunk${i}`,
      text: chunk.text,
      vector: vectors[i],
      path: filePath,
      offset: chunk.offset,
      page: 0,
      hash: `hash${i}`
    }));
    
    const table = await db.createTable('chunks', tableData);
    expect(await table.countRows()).toBe(chunks.length);
    
    // 5. Real search
    const queryText = 'test file';
    const [queryVector] = await embedder.embed([queryText]);
    
    const results = await table
      .vectorSearch(queryVector)
      .limit(5)
      .toArray();
    
    expect(results).toHaveLength(Math.min(5, chunks.length));
    expect(results[0]).toHaveProperty('text');
    expect(results[0]).toHaveProperty('_distance');
    expect(results[0].text).toContain('test file');
  });

  it('should handle multi-chunk documents', async () => {
    // Use larger file that will create multiple chunks
    const filePath = path.join(fixturesDir, 'large.txt');
    const text = await parseText(filePath);
    
    // Chunk with smaller size to ensure multiple chunks
    const chunks = chunkText(text, 500, 60);
    expect(chunks.length).toBeGreaterThan(1);
    
    // Verify chunk properties
    chunks.forEach((chunk, i) => {
      expect(chunk.text.length).toBeLessThanOrEqual(560); // 500 + 60 overlap
      expect(chunk.offset).toBeGreaterThanOrEqual(0);
      if (i > 0) {
        // Chunks should have proper offset progression
        expect(chunk.offset).toBeGreaterThan(chunks[i-1].offset);
      }
    });
    
    // Embed all chunks
    const vectors = await embedder.embed(chunks.map(c => c.text));
    expect(vectors).toHaveLength(chunks.length);
    
    // Store in database
    const tableData = chunks.map((chunk, i) => ({
      id: `chunk${i}`,
      text: chunk.text,
      vector: vectors[i],
      path: filePath,
      offset: chunk.offset,
      page: Math.floor(i / 10), // Simulate pages
      hash: `hash${i}`
    }));
    
    const table = await db.createTable('chunks', tableData);
    
    // Search for specific content
    const searches = [
      'machine learning',
      'blockchain technology',
      'quantum computing'
    ];
    
    for (const searchTerm of searches) {
      const [queryVector] = await embedder.embed([searchTerm]);
      const results = await table
        .vectorSearch(queryVector)
        .limit(3)
        .toArray();
      
      expect(results.length).toBeGreaterThan(0);
      
      // At least one result should contain relevant text
      const hasRelevant = results.some((r: any) => 
        r.text.toLowerCase().includes(searchTerm.split(' ')[0].toLowerCase())
      );
      expect(hasRelevant).toBe(true);
    }
  });

  it('should maintain document metadata through pipeline', async () => {
    const filePath = path.join(fixturesDir, 'simple.txt');
    const text = await parseText(filePath);
    const chunks = chunkText(text, 200, 30);
    const vectors = await embedder.embed(chunks.map(c => c.text));
    
    // Add comprehensive metadata
    const metadata = {
      filePath,
      fileSize: fs.statSync(filePath).size,
      modifiedTime: fs.statSync(filePath).mtime.toISOString(),
      encoding: 'utf-8',
      mimeType: 'text/plain'
    };
    
    const tableData = chunks.map((chunk, i) => ({
      id: `chunk${i}`,
      text: chunk.text,
      vector: vectors[i],
      path: metadata.filePath,
      offset: chunk.offset,
      page: 0,
      hash: `${metadata.modifiedTime}-${i}`,
      fileSize: metadata.fileSize,
      mimeType: metadata.mimeType
    }));
    
    const table = await db.createTable('chunks', tableData);
    
    // Verify metadata is preserved
    const stored = await table.toArray();
    stored.forEach((row: any) => {
      expect(row.path).toBe(filePath);
      expect(row.fileSize).toBe(metadata.fileSize);
      expect(row.mimeType).toBe(metadata.mimeType);
      expect(row.hash).toContain(metadata.modifiedTime);
    });
  });

  it('should handle re-indexing workflow', async () => {
    const filePath = path.join(fixturesDir, 'simple.txt');
    
    // Initial indexing
    const text1 = await parseText(filePath);
    const chunks1 = chunkText(text1, 300, 50);
    const vectors1 = await embedder.embed(chunks1.map(c => c.text));
    
    const tableData1 = chunks1.map((chunk, i) => ({
      id: `v1-chunk${i}`,
      text: chunk.text,
      vector: vectors1[i],
      path: filePath,
      offset: chunk.offset,
      hash: 'v1-hash'
    }));
    
    const table = await db.createTable('chunks', tableData1);
    const initialCount = await table.countRows();
    
    // Simulate file change and re-indexing
    // Delete old chunks
    await table.delete(`path = '${filePath}'`);
    
    // Re-index with different chunking parameters
    const chunks2 = chunkText(text1, 200, 40); // Different chunk size
    const vectors2 = await embedder.embed(chunks2.map(c => c.text));
    
    const tableData2 = chunks2.map((chunk, i) => ({
      id: `v2-chunk${i}`,
      text: chunk.text,
      vector: vectors2[i],
      path: filePath,
      offset: chunk.offset,
      hash: 'v2-hash'
    }));
    
    await table.add(tableData2);
    
    // Verify re-indexing
    const results = await table
      .filter(`path = '${filePath}'`)
      .toArray();
    
    expect(results.every((r: any) => r.id.startsWith('v2-'))).toBe(true);
    expect(results.every((r: any) => r.hash === 'v2-hash')).toBe(true);
    
    // Chunk count might be different due to different chunk size
    expect(results.length).toBe(chunks2.length);
  });

  it('should handle errors gracefully in pipeline', async () => {
    // Test with non-existent file
    const missingFile = path.join(fixturesDir, 'non-existent.txt');
    const text = await parseText(missingFile);
    expect(text).toBe('');
    
    // Empty text should produce no chunks
    const chunks = chunkText(text, 500, 60);
    expect(chunks).toHaveLength(0);
    
    // Empty chunks should produce empty vectors
    const vectors = await embedder.embed(chunks.map(c => c.text));
    expect(vectors).toHaveLength(0);
    
    // Can still create table with no data
    const table = await db.createTable('empty_chunks', [
      { id: 'dummy', text: 'dummy', vector: new Array(384).fill(0) }
    ]);
    await table.delete("id = 'dummy'");
    
    const count = await table.countRows();
    expect(count).toBe(0);
  });

  describe('Search Quality', () => {
    beforeEach(async () => {
      // Set up a corpus with known semantic relationships
      const documents = [
        { id: 'ai1', text: 'Artificial intelligence and machine learning are transforming technology' },
        { id: 'ai2', text: 'Deep learning neural networks power modern AI systems' },
        { id: 'cooking1', text: 'Italian pasta recipes with tomato sauce and fresh basil' },
        { id: 'cooking2', text: 'Baking bread requires flour, water, yeast and patience' },
        { id: 'finance1', text: 'Stock market investments carry risks and potential rewards' },
        { id: 'finance2', text: 'Cryptocurrency blockchain technology enables decentralized finance' }
      ];
      
      const vectors = await embedder.embed(documents.map(d => d.text));
      
      const tableData = documents.map((doc, i) => ({
        ...doc,
        vector: vectors[i],
        path: `/corpus/${doc.id}.txt`
      }));
      
      const table = await db.createTable('corpus', tableData);
    });
    
    it('should rank semantically similar documents higher', async () => {
      const table = await db.openTable('corpus');
      
      // Search for AI-related content
      const [aiQuery] = await embedder.embed(['neural networks artificial intelligence']);
      const aiResults = await table
        .vectorSearch(aiQuery)
        .limit(3)
        .toArray();
      
      // Top results should be AI documents
      expect(aiResults[0].id).toMatch(/^ai/);
      expect(aiResults[1].id).toMatch(/^ai/);
      
      // Search for cooking-related content
      const [cookQuery] = await embedder.embed(['recipes cooking food']);
      const cookResults = await table
        .vectorSearch(cookQuery)
        .limit(3)
        .toArray();
      
      // Top results should be cooking documents
      expect(cookResults[0].id).toMatch(/^cooking/);
    });
  });
});