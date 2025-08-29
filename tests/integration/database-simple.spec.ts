import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as lancedb from '@lancedb/lancedb';
import * as os from 'os';
import * as path from 'path';
import * as fs from 'fs';

describe('Database Operations - Simplified', () => {
  let db: any;
  let table: any;
  let tempDir: string;
  
  beforeEach(async () => {
    // Create temporary directory for database
    tempDir = path.join(os.tmpdir(), `test-db-${Date.now()}`);
    fs.mkdirSync(tempDir, { recursive: true });
    
    // Connect to database
    db = await lancedb.connect(tempDir);
    
    // Create test table with proper Float32Array vectors
    const initialData = [
      { 
        id: 'seed1',
        text: 'initial content for testing',
        vector: Array.from(new Array(384).fill(0.1)),
        path: '/test.txt'
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

  describe('Basic Operations', () => {
    it('should insert and count chunks', async () => {
      const chunks = [
        {
          id: 'chunk1',
          text: 'First chunk text content',
          vector: Array.from(new Array(384).fill(0.2)),
          path: '/doc.pdf'
        }
      ];
      
      await table.add(chunks);
      const count = await table.countRows();
      expect(count).toBe(2); // 1 seed + 1 new
    });

    it('should perform vector search', async () => {
      // Add test data
      const chunks = [
        {
          id: 'doc1',
          text: 'Machine learning content',
          vector: Array.from(new Array(384).fill(0.3)),
          path: '/ml.pdf'
        },
        {
          id: 'doc2',
          text: 'Cooking recipes',
          vector: Array.from(new Array(384).fill(0.7)),
          path: '/food.txt'
        }
      ];
      
      await table.add(chunks);
      
      // Search with vector closer to doc1
      const queryVector = Array.from(new Array(384).fill(0.35));
      const results = await table
        .search(queryVector)
        .limit(2)
        .toArray();
      
      expect(results.length).toBeGreaterThan(0);
      expect(results.length).toBeLessThanOrEqual(2);
    });

    it('should delete chunks', async () => {
      // Add chunk
      await table.add([
        {
          id: 'to-delete',
          text: 'Delete me',
          vector: Array.from(new Array(384).fill(0.5)),
          path: '/delete.txt'
        }
      ]);
      
      // Verify it was added
      const before = await table.countRows();
      expect(before).toBe(2);
      
      // Delete by path
      await table.delete("path = '/delete.txt'");
      
      // Verify deletion
      const after = await table.countRows();
      expect(after).toBe(1);
    });
  });

  describe('Search Features', () => {
    it('should return distance scores', async () => {
      const queryVector = Array.from(new Array(384).fill(0.15));
      
      const results = await table
        .search(queryVector)
        .limit(1)
        .toArray();
      
      if (results.length > 0) {
        expect(results[0]).toHaveProperty('_distance');
        expect(typeof results[0]._distance).toBe('number');
      }
    });

    it('should handle empty search results', async () => {
      // Search with a very different vector
      const queryVector = Array.from(new Array(384).fill(0.99));
      
      const results = await table
        .search(queryVector)
        .limit(10)
        .toArray();
      
      // Should still return results (nearest neighbors)
      expect(Array.isArray(results)).toBe(true);
    });
  });

  describe('Data Integrity', () => {
    it('should preserve text content', async () => {
      const testText = 'This is a test document with special chars: éñ×÷';
      await table.add([
        {
          id: 'text-test',
          text: testText,
          vector: Array.from(new Array(384).fill(0.6)),
          path: '/special.txt'
        }
      ]);
      
      const results = await table
        .query()
        .where("id = 'text-test'")
        .limit(1)
        .toArray();
      
      expect(results).toHaveLength(1);
      expect(results[0].text).toBe(testText);
    });

    it('should handle batch operations', async () => {
      const batchSize = 10;
      const chunks = Array.from({ length: batchSize }, (_, i) => ({
        id: `batch-${i}`,
        text: `Batch chunk ${i}`,
        vector: Array.from(new Array(384).fill(0.1 + i * 0.01)),
        path: `/batch/doc${i}.txt`
      }));
      
      await table.add(chunks);
      const count = await table.countRows();
      expect(count).toBe(batchSize + 1); // batch + seed
    });
  });
});