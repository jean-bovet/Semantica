import { describe, test, expect, beforeEach, afterEach } from 'vitest';
import { DatabaseService } from '../../../src/main/worker/services/database-service';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';

/**
 * DatabaseService Unit Tests
 * 
 * Testing with REAL LanceDB - NO MOCKING
 * Uses temporary directories for complete isolation
 */

describe('DatabaseService', () => {
  let service: DatabaseService;
  let tempDir: string;

  beforeEach(async () => {
    // Create a unique temp directory for each test
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'db-test-'));
    service = new DatabaseService();
  });

  afterEach(async () => {
    // Clean up
    await service.disconnect();
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  describe('Connection Management', () => {
    test('should connect to database', async () => {
      await expect(service.connect(tempDir)).resolves.not.toThrow();
      
      // Verify tables are accessible
      expect(() => service.getChunksTable()).not.toThrow();
    });

    test('should throw when accessing tables before connection', () => {
      expect(() => service.getChunksTable()).toThrow('Database not connected');
    });

    test('should disconnect cleanly', async () => {
      await service.connect(tempDir);
      await expect(service.disconnect()).resolves.not.toThrow();
      
      // After disconnect, should throw
      expect(() => service.getChunksTable()).toThrow('Database not connected');
    });

    test('should handle multiple connect/disconnect cycles', async () => {
      // First cycle
      await service.connect(tempDir);
      await service.disconnect();
      
      // Second cycle - should work
      await service.connect(tempDir);
      expect(() => service.getChunksTable()).not.toThrow();
      await service.disconnect();
    });
  });

  describe('Chunks Operations', () => {
    beforeEach(async () => {
      await service.connect(tempDir);
    });

    test('should add and retrieve chunks', async () => {
      const chunks = [
        {
          id: 'chunk1',
          path: '/test/file1.txt',
          text: 'Hello world',
          vector: new Array(384).fill(0.1),
          mtime: Date.now(),
          page: 0,
          offset: 0,
          type: 'text',
          title: 'Test'
        },
        {
          id: 'chunk2',
          path: '/test/file2.txt',
          text: 'Goodbye world',
          vector: new Array(384).fill(0.2),
          mtime: Date.now(),
          page: 0,
          offset: 100,
          type: 'text',
          title: 'Test 2'
        }
      ];

      await service.addChunks(chunks);
      
      const files = await service.queryFiles();
      expect(files).toHaveLength(2);
      expect(files.map(f => f.path)).toContain('/test/file1.txt');
      expect(files.map(f => f.path)).toContain('/test/file2.txt');
    });

    test('should handle empty chunks array', async () => {
      await expect(service.addChunks([])).resolves.not.toThrow();
      
      const files = await service.queryFiles();
      expect(files).toHaveLength(0);
    });

    test('should delete chunks for specific file', async () => {
      const chunks = [
        {
          id: 'chunk1',
          path: '/test/file1.txt',
          text: 'Keep this',
          vector: new Array(384).fill(0.1),
          mtime: Date.now(),
          page: 0,
          offset: 0,
          type: 'text',
          title: 'Keep'
        },
        {
          id: 'chunk2',
          path: '/test/file2.txt',
          text: 'Delete this',
          vector: new Array(384).fill(0.2),
          mtime: Date.now(),
          page: 0,
          offset: 0,
          type: 'text',
          title: 'Delete'
        }
      ];

      await service.addChunks(chunks);
      await service.deleteChunksForFile('/test/file2.txt');
      
      const files = await service.queryFiles();
      expect(files).toHaveLength(1);
      expect(files[0].path).toBe('/test/file1.txt');
    });

    test('should handle query with limit', async () => {
      // Add many chunks
      const chunks = Array.from({ length: 10 }, (_, i) => ({
        id: `chunk${i}`,
        path: `/test/file${i}.txt`,
        text: `Content ${i}`,
        vector: new Array(384).fill(i / 100),
        mtime: Date.now(),
        page: 0,
        offset: i * 100,
        type: 'text',
        title: `Title ${i}`
      }));

      await service.addChunks(chunks);
      
      const files = await service.queryFiles(5);
      expect(files.length).toBeLessThanOrEqual(5);
    });
  });

  describe('File Status Operations', () => {
    beforeEach(async () => {
      await service.connect(tempDir);
    });

    test('should update file status', async () => {
      await service.updateFileStatus(
        '/test/file.txt',
        'indexed',
        '',
        10,
        1
      );

      // Verify by loading cache
      const cache = await service.loadFileStatusCache();
      expect(cache.has('/test/file.txt')).toBe(true);
      
      const status = cache.get('/test/file.txt');
      expect(status?.status).toBe('indexed');
      expect(status?.chunk_count).toBe(10);
    });

    test('should handle multiple status updates', async () => {
      const filePath = '/test/file.txt';
      
      // First update - queued
      await service.updateFileStatus(filePath, 'queued');
      
      // Second update - processing (error)
      await service.updateFileStatus(filePath, 'error', 'Parse failed');
      
      // Third update - successful
      await service.updateFileStatus(filePath, 'indexed', '', 5, 2);
      
      const cache = await service.loadFileStatusCache();
      const status = cache.get(filePath);
      
      expect(status?.status).toBe('indexed');
      expect(status?.error_message).toBe('');
      expect(status?.chunk_count).toBe(5);
    });

    test('should load empty cache when no status records exist', async () => {
      const cache = await service.loadFileStatusCache();
      expect(cache.size).toBe(0);
    });

    test('should handle file status when table is not available', async () => {
      // Create service without file status table
      const service2 = new DatabaseService();
      await service2.connect(tempDir);
      
      // Force file status table to null (simulating unavailable table)
      (service2 as any).fileStatusTable = null;
      
      // Should not throw, just warn
      await expect(
        service2.updateFileStatus('/test.txt', 'indexed')
      ).resolves.not.toThrow();
    });
  });

  describe('Statistics', () => {
    beforeEach(async () => {
      await service.connect(tempDir);
    });

    test('should return empty stats for empty database', async () => {
      const stats = await service.getStats();
      
      expect(stats).toEqual({
        totalChunks: 0,
        indexedFiles: 0,
        folderStats: []
      });
    });

    test('should calculate correct stats', async () => {
      const chunks = [
        // File 1 - 2 chunks
        {
          id: 'chunk1',
          path: '/test/file1.txt',
          text: 'Part 1',
          vector: new Array(384).fill(0.1),
          mtime: Date.now(),
          page: 0,
          offset: 0,
          type: 'text',
          title: 'Test'
        },
        {
          id: 'chunk2',
          path: '/test/file1.txt',
          text: 'Part 2',
          vector: new Array(384).fill(0.1),
          mtime: Date.now(),
          page: 0,
          offset: 1000,
          type: 'text',
          title: 'Test'
        },
        // File 2 - 1 chunk
        {
          id: 'chunk3',
          path: '/test/file2.txt',
          text: 'Single chunk',
          vector: new Array(384).fill(0.2),
          mtime: Date.now(),
          page: 0,
          offset: 0,
          type: 'text',
          title: 'Test 2'
        }
      ];

      await service.addChunks(chunks);
      
      const stats = await service.getStats();
      
      expect(stats.totalChunks).toBe(3);
      expect(stats.indexedFiles).toBe(2);
    });

    test('should handle stats query errors gracefully', async () => {
      // Disconnect to cause error
      await service.disconnect();
      
      const stats = await service.getStats();
      
      expect(stats).toEqual({
        totalChunks: 0,
        indexedFiles: 0,
        folderStats: []
      });
    });
  });

  describe('Search Operations', () => {
    beforeEach(async () => {
      await service.connect(tempDir);
    });

    test('should return empty array for searches (placeholder)', async () => {
      const results = await service.searchChunks('test query', 10);
      expect(results).toEqual([]);
    });
  });

  describe('Error Handling', () => {
    test('should handle connection to non-existent directory', async () => {
      const nonExistentDir = path.join(tempDir, 'does-not-exist');
      // LanceDB will create the directory, so this should succeed
      await expect(service.connect(nonExistentDir)).resolves.not.toThrow();
    });

    test('should handle database operations after disconnect', async () => {
      await service.connect(tempDir);
      await service.disconnect();
      
      // All operations should throw after disconnect
      expect(() => service.getChunksTable()).toThrow();
      await expect(service.queryFiles()).rejects.toThrow();
    });

    test('should handle invalid chunk data gracefully', async () => {
      await service.connect(tempDir);
      
      const invalidChunks = [
        {
          // Missing required fields
          id: 'bad-chunk',
          text: 'Missing vector and path'
        } as any
      ];
      
      // Should throw or handle error
      await expect(service.addChunks(invalidChunks)).rejects.toThrow();
    });
  });

  describe('Performance', () => {
    beforeEach(async () => {
      await service.connect(tempDir);
    });

    test('should handle large batch operations efficiently', async () => {
      const largeChunkSet = Array.from({ length: 100 }, (_, i) => ({
        id: `chunk${i}`,
        path: `/test/file${Math.floor(i / 10)}.txt`,
        text: `Content ${i}`,
        vector: new Array(384).fill(Math.random()),
        mtime: Date.now(),
        page: Math.floor(i / 10),
        offset: (i % 10) * 1000,
        type: 'text',
        title: `Title ${i}`
      }));

      const startTime = Date.now();
      await service.addChunks(largeChunkSet);
      const duration = Date.now() - startTime;
      
      // Should complete within reasonable time (2 seconds for 100 chunks)
      expect(duration).toBeLessThan(2000);
      
      // Verify all chunks were added
      const stats = await service.getStats();
      expect(stats.totalChunks).toBe(100);
      expect(stats.indexedFiles).toBe(10); // 100 chunks / 10 per file
    });
  });
});

/**
 * This test suite demonstrates:
 * 
 * 1. REAL DATABASE - Uses actual LanceDB with temp directories
 * 2. NO MOCKING - All database operations are real
 * 3. ISOLATION - Each test gets its own database directory
 * 4. COMPREHENSIVE - Tests all DatabaseService methods
 * 5. FAST - Despite using real I/O, tests complete quickly
 * 6. ERROR HANDLING - Tests error conditions with real failures
 * 
 * The tests prove that real implementation testing is practical and effective.
 */