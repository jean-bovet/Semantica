import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as lancedb from '@lancedb/lancedb';
import * as os from 'os';
import * as path from 'path';
import * as fs from 'fs';

describe('Database Operations', () => {
  let db: any;
  let table: any;
  let tempDir: string;
  
  beforeEach(async () => {
    // Create temporary directory for database
    tempDir = path.join(os.tmpdir(), `test-db-${Date.now()}`);
    fs.mkdirSync(tempDir, { recursive: true });
    
    // Connect to database
    db = await lancedb.connect(tempDir);
    
    // Create test table with schema
    const initialData = [
      { 
        id: 'seed1',
        text: 'initial content for testing',
        vector: new Array(384).fill(0.1),
        path: '/test.txt',
        page: 0,
        offset: 0,
        hash: 'abc123'
      }
    ];
    
    table = await db.createTable('chunks', initialData);
  });
  
  afterEach(async () => {
    // Clean up
    if (fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  describe('Chunk Storage', () => {
    it('should insert chunks with metadata', async () => {
      const chunks = [
        {
          id: 'chunk1',
          text: 'First chunk text content',
          vector: new Array(384).fill(0.2),
          path: '/doc.pdf',
          page: 1,
          offset: 0,
          hash: 'def456'
        },
        {
          id: 'chunk2',
          text: 'Second chunk text content',
          vector: new Array(384).fill(0.3),
          path: '/doc.pdf',
          page: 1,
          offset: 500,
          hash: 'ghi789'
        }
      ];
      
      await table.add(chunks);
      const count = await table.countRows();
      expect(count).toBe(3); // 1 seed + 2 new
    });

    it('should handle batch inserts', async () => {
      const batchSize = 100;
      const chunks = Array.from({ length: batchSize }, (_, i) => ({
        id: `batch-${i}`,
        text: `Batch chunk ${i}`,
        vector: new Array(384).fill(0.1 + i * 0.001),
        path: `/batch/doc${Math.floor(i / 10)}.txt`,
        page: i % 10,
        offset: i * 100,
        hash: `hash${i}`
      }));
      
      await table.add(chunks);
      const count = await table.countRows();
      expect(count).toBe(batchSize + 1); // batch + seed
    });

    it('should store and retrieve chunk metadata correctly', async () => {
      const chunk = {
        id: 'metadata-test',
        text: 'Test chunk with full metadata',
        vector: new Array(384).fill(0.5),
        path: '/path/to/document.pdf',
        page: 42,
        offset: 1337,
        hash: 'xyz987'
      };
      
      await table.add([chunk]);
      
      // Query back the chunk
      const results = await table
        .query()
        .where(`id = 'metadata-test'`)
        .limit(1)
        .toArray();
      
      expect(results).toHaveLength(1);
      expect(results[0].text).toBe(chunk.text);
      expect(results[0].path).toBe(chunk.path);
      expect(results[0].page).toBe(chunk.page);
      expect(results[0].offset).toBe(chunk.offset);
      expect(results[0].hash).toBe(chunk.hash);
    });
  });

  describe('Vector Search', () => {
    beforeEach(async () => {
      // Add test data for search tests
      const testDocs = [
        {
          id: 'ml-doc',
          text: 'Machine learning and artificial intelligence',
          vector: new Array(384).fill(0).map((_, i) => Math.sin(i * 0.1)),
          path: '/ml.pdf',
          page: 0,
          offset: 0,
          hash: 'ml1'
        },
        {
          id: 'cooking-doc',
          text: 'Cooking recipes and kitchen tips',
          vector: new Array(384).fill(0).map((_, i) => Math.cos(i * 0.1)),
          path: '/recipes.txt',
          page: 0,
          offset: 0,
          hash: 'cook1'
        },
        {
          id: 'ml-doc2',
          text: 'Deep learning neural networks',
          vector: new Array(384).fill(0).map((_, i) => Math.sin(i * 0.1 + 0.1)),
          path: '/ml2.pdf',
          page: 0,
          offset: 0,
          hash: 'ml2'
        }
      ];
      
      await table.add(testDocs);
    });

    it('should find similar chunks by vector', async () => {
      // Search with vector similar to ML documents
      const queryVector = new Array(384).fill(0).map((_, i) => Math.sin(i * 0.1 + 0.05));
      
      const results = await table
        .vectorSearch(queryVector)
        .limit(3)
        .toArray();
      
      expect(results.length).toBeGreaterThan(0);
      expect(results.length).toBeLessThanOrEqual(3);
      
      // ML documents should be ranked higher (smaller distance)
      const mlDocs = results.filter((r: any) => r.id.includes('ml'));
      expect(mlDocs.length).toBeGreaterThan(0);
    });

    it('should limit search results correctly', async () => {
      const queryVector = new Array(384).fill(0.5);
      
      const results2 = await table
        .vectorSearch(queryVector)
        .limit(2)
        .toArray();
      
      const results5 = await table
        .vectorSearch(queryVector)
        .limit(5)
        .toArray();
      
      expect(results2).toHaveLength(2);
      expect(results5.length).toBeLessThanOrEqual(5);
      expect(results5.length).toBeGreaterThanOrEqual(results2.length);
    });

    it('should filter search results by path', async () => {
      const queryVector = new Array(384).fill(0.3);
      
      const results = await table
        .vectorSearch(queryVector)
        .where("path LIKE '%.pdf'")
        .limit(10)
        .toArray();
      
      results.forEach((r: any) => {
        expect(r.path).toMatch(/\.pdf$/);
      });
    });

    it('should return distance scores', async () => {
      const queryVector = new Array(384).fill(0.4);
      
      const results = await table
        .vectorSearch(queryVector)
        .limit(3)
        .toArray();
      
      results.forEach((r: any) => {
        expect(r).toHaveProperty('_distance');
        expect(typeof r._distance).toBe('number');
        expect(r._distance).toBeGreaterThanOrEqual(0);
      });
      
      // Results should be ordered by distance (ascending)
      for (let i = 1; i < results.length; i++) {
        expect(results[i]._distance).toBeGreaterThanOrEqual(results[i-1]._distance);
      }
    });
  });

  describe('Cleanup Operations', () => {
    it('should delete chunks by path', async () => {
      // Add chunks for a specific file
      const filePath = '/to-delete.txt';
      const chunks = Array.from({ length: 5 }, (_, i) => ({
        id: `delete-${i}`,
        text: `Content ${i}`,
        vector: new Array(384).fill(0.1),
        path: filePath,
        page: i,
        offset: i * 100,
        hash: `del${i}`
      }));
      
      await table.add(chunks);
      
      // Verify they were added
      const before = await table
        .query()
        .where(`path = '${filePath}'`)
        .toArray();
      expect(before).toHaveLength(5);
      
      // Delete by path
      await table.delete(`path = '${filePath}'`);
      
      // Verify deletion
      const after = await table
        .query()
        .where(`path = '${filePath}'`)
        .toArray();
      expect(after).toHaveLength(0);
      
      // Other documents should remain
      const remaining = await table.countRows();
      expect(remaining).toBeGreaterThan(0);
    });

    it('should handle re-indexing (delete and add)', async () => {
      const filePath = '/reindex.md';
      
      // Add original chunks
      const oldChunks = [
        {
          id: 'old1',
          text: 'Old content version 1',
          vector: new Array(384).fill(0.1),
          path: filePath,
          hash: 'old1'
        },
        {
          id: 'old2',
          text: 'Old content version 2',
          vector: new Array(384).fill(0.2),
          path: filePath,
          hash: 'old2'
        }
      ];
      
      await table.add(oldChunks);
      
      // Simulate re-indexing: delete old, add new
      await table.delete(`path = '${filePath}'`);
      
      const newChunks = [
        {
          id: 'new1',
          text: 'Updated content version 1',
          vector: new Array(384).fill(0.3),
          path: filePath,
          hash: 'new1'
        },
        {
          id: 'new2',
          text: 'Updated content version 2',
          vector: new Array(384).fill(0.4),
          path: filePath,
          hash: 'new2'
        },
        {
          id: 'new3',
          text: 'Additional new content',
          vector: new Array(384).fill(0.5),
          path: filePath,
          hash: 'new3'
        }
      ];
      
      await table.add(newChunks);
      
      // Verify the update
      const results = await table
        .query()
        .where(`path = '${filePath}'`)
        .toArray();
      
      expect(results).toHaveLength(3);
      expect(results.every((r: any) => r.id.startsWith('new'))).toBe(true);
      expect(results.every((r: any) => r.text.includes('Updated') || r.text.includes('Additional'))).toBe(true);
    });

    it('should handle partial deletion with complex filters', async () => {
      // Add varied test data
      const chunks = [
        { id: 'keep1', text: 'Keep this', vector: new Array(384).fill(0.1), path: '/keep.txt', page: 1 },
        { id: 'del1', text: 'Delete this', vector: new Array(384).fill(0.2), path: '/delete.txt', page: 1 },
        { id: 'keep2', text: 'Keep this too', vector: new Array(384).fill(0.3), path: '/keep.txt', page: 2 },
        { id: 'del2', text: 'Delete this too', vector: new Array(384).fill(0.4), path: '/delete.txt', page: 2 },
      ];
      
      await table.add(chunks);
      
      // Delete only specific pages from specific path
      await table.delete(`path = '/delete.txt' AND page = 1`);
      
      const remaining = await table.toArray();
      const deletePath = remaining.filter((r: any) => r.path === '/delete.txt');
      const keepPath = remaining.filter((r: any) => r.path === '/keep.txt');
      
      // Should have deleted only page 1 of delete.txt
      expect(deletePath).toHaveLength(1);
      expect(deletePath[0].page).toBe(2);
      
      // Should have kept all of keep.txt
      expect(keepPath).toHaveLength(2);
    });
  });

  describe('Query Building', () => {
    it('should handle empty database gracefully', async () => {
      // Create empty table
      const emptyDb = await lancedb.connect(tempDir);
      const emptyTable = await emptyDb.createTable('empty', [
        { id: 'dummy', text: 'dummy', vector: new Array(384).fill(0) }
      ]);
      await emptyTable.delete("id = 'dummy'");
      
      const count = await emptyTable.countRows();
      expect(count).toBe(0);
      
      // Search should return empty results, not error
      const results = await emptyTable
        .vectorSearch(new Array(384).fill(0.5))
        .limit(10)
        .toArray();
      
      expect(results).toHaveLength(0);
    });

    it('should handle special characters in queries', async () => {
      const specialChunks = [
        {
          id: 'special1',
          text: "Text with 'quotes' and \"double quotes\"",
          vector: new Array(384).fill(0.1),
          path: "/path/with spaces/and'quotes.txt",
          hash: 'spec1'
        }
      ];
      
      await table.add(specialChunks);
      
      // Should handle the special characters
      const results = await table
        .query()
        .where("id = 'special1'")
        .toArray();
      
      expect(results).toHaveLength(1);
      expect(results[0].text).toContain('quotes');
    });
  });

  describe('Performance Characteristics', () => {
    it('should handle large result sets efficiently', async () => {
      // Add many chunks
      const manyChunks = Array.from({ length: 500 }, (_, i) => ({
        id: `perf-${i}`,
        text: `Performance test chunk ${i}`,
        vector: new Array(384).fill(0).map((_, j) => Math.sin((i + j) * 0.01)),
        path: `/perf/doc${i}.txt`,
        page: 0,
        offset: 0,
        hash: `perf${i}`
      }));
      
      await table.add(manyChunks);
      
      const startTime = Date.now();
      const results = await table
        .vectorSearch(new Array(384).fill(0.5))
        .limit(100)
        .toArray();
      const endTime = Date.now();
      
      expect(results).toHaveLength(100);
      expect(endTime - startTime).toBeLessThan(1000); // Should complete within 1 second
    });
  });
});