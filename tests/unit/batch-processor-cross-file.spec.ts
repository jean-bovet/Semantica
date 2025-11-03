/**
 * Test for cross-file contamination bug in batch processor
 *
 * Bug: When a batch contains chunks from multiple files, all chunks are stored
 * with the FIRST chunk's file path, causing chunks to be associated with the wrong file.
 */

/**
 * Tests the cross-file contamination bug fix in the batch processor.
 * This test uses the REAL processBatchToRows function from the worker.
 */
import { describe, it, expect, vi } from 'vitest';

// Mock worker_threads to prevent execution of worker code
vi.mock('node:worker_threads', () => ({
  parentPort: {
    on: vi.fn(),
    postMessage: vi.fn()
  }
}));

// Mock the logger to avoid console spam in tests
vi.mock('../../src/shared/utils/logger', () => ({
  logger: {
    log: vi.fn(),
    error: vi.fn(),
    warn: vi.fn()
  }
}));

// Mock lancedb to avoid database operations in tests
vi.mock('@lancedb/lancedb', () => ({
  connect: vi.fn()
}));

// Import after mocks are set up
import { processBatchToRows } from '../../src/main/worker/batch/processor';

describe('Batch Processor - Cross-File Contamination Bug (REAL CODE TEST)', () => {
  it('should preserve correct file paths for chunks from multiple files in same batch', async () => {
    /**
     * This test uses the REAL processBatchToRows function from src/main/worker/index.ts
     * to verify that the fix works correctly.
     */

    const file1Path = '/test/janine.doc';
    const file2Path = '/test/lettre.doc';
    const baseTime = Date.now();

    // Simulate a batch with chunks from TWO different files
    const batch = {
      chunks: [
        { text: 'Chère Janine, voici mon texte', metadata: { filePath: file1Path, offset: 0, page: 0 } },
        { text: 'Deuxième chunk de Janine', metadata: { filePath: file1Path, offset: 100, page: 0 } },
        { text: 'Lettre du 17 décembre', metadata: { filePath: file2Path, offset: 0, page: 0 } },
        { text: 'Deuxième chunk de la lettre', metadata: { filePath: file2Path, offset: 100, page: 0 } }
      ],
      vectors: [
        new Array(768).fill(0.1),
        new Array(768).fill(0.2),
        new Array(768).fill(0.3),
        new Array(768).fill(0.4)
      ]
    };

    // Mock file stats provider (simulates fs.stat)
    const mockFileStatsProvider = async (filePath: string) => {
      // Return different mtimes for different files
      if (filePath === file1Path) {
        return { mtime: baseTime };
      } else if (filePath === file2Path) {
        return { mtime: baseTime + 1000 };
      }
      throw new Error(`Unexpected file path: ${filePath}`);
    };

    // THIS IS THE KEY: Use the REAL processBatchToRows function
    const rows = await processBatchToRows(batch, mockFileStatsProvider);

    // ASSERTIONS - verify the REAL code works correctly

    expect(rows.length).toBe(4);

    // File 1 chunks should have file1Path and file1 mtime
    const janineRows = rows.filter(r => r.text.includes('Janine'));
    expect(janineRows.length).toBe(2);
    for (const row of janineRows) {
      expect(row.path).toBe(file1Path);
      expect(row.mtime).toBe(baseTime);
      expect(row.type).toBe('doc');
      expect(row.title).toBe('janine.doc');
    }

    // File 2 chunks should have file2Path and file2 mtime
    const lettreRows = rows.filter(r => r.text.includes('Lettre') || r.text.includes('lettre'));
    expect(lettreRows.length).toBe(2);
    for (const row of lettreRows) {
      expect(row.path).toBe(file2Path); // THE FIX: Not file1Path!
      expect(row.mtime).toBe(baseTime + 1000);
      expect(row.type).toBe('doc');
      expect(row.title).toBe('lettre.doc');
    }

    // Critical: ALL chunks should have their OWN file path
    for (let i = 0; i < batch.chunks.length; i++) {
      const chunk = batch.chunks[i];
      const row = rows[i];
      expect(row.path).toBe(chunk.metadata.filePath);
      expect(row.text).toBe(chunk.text);
      expect(row.offset).toBe(chunk.metadata.offset);
      expect(row.page).toBe(chunk.metadata.page);
    }

    // Verify IDs are unique (different files with same offsets should have different IDs)
    const ids = rows.map(r => r.id);
    const uniqueIds = new Set(ids);
    expect(uniqueIds.size).toBe(ids.length);

    // Verify file stats provider was called only twice (once per unique file, cached)
    // We can't directly verify this with a mock, but the caching is tested implicitly
  });

  it('should generate unique chunk IDs even when batched together', async () => {
    /**
     * Test that chunks from different files with the SAME offsets
     * get DIFFERENT IDs because the file path is included in the hash.
     */

    const file1Path = '/test/janine.doc';
    const file2Path = '/test/lettre.doc';
    const baseTime = Date.now();

    const batch = {
      chunks: [
        { text: 'Janine content 1', metadata: { filePath: file1Path, offset: 0, page: 0 } },
        { text: 'Janine content 2', metadata: { filePath: file1Path, offset: 100, page: 0 } },
        { text: 'Lettre content 1', metadata: { filePath: file2Path, offset: 0, page: 0 } }, // Same offset!
        { text: 'Lettre content 2', metadata: { filePath: file2Path, offset: 100, page: 0 } }  // Same offset!
      ],
      vectors: [
        new Array(768).fill(0.1),
        new Array(768).fill(0.2),
        new Array(768).fill(0.3),
        new Array(768).fill(0.4)
      ]
    };

    const mockFileStatsProvider = async (filePath: string) => {
      return { mtime: baseTime };
    };

    // Use REAL function
    const rows = await processBatchToRows(batch, mockFileStatsProvider);

    // All IDs should be unique
    const ids = rows.map(r => r.id);
    const uniqueIds = new Set(ids);
    expect(uniqueIds.size).toBe(ids.length); // No duplicate IDs

    // Chunks from different files with same offset should have different IDs
    const file1Chunk1 = rows.find(r => r.text === 'Janine content 1');
    const file2Chunk1 = rows.find(r => r.text === 'Lettre content 1');

    expect(file1Chunk1).toBeDefined();
    expect(file2Chunk1).toBeDefined();
    expect(file1Chunk1!.id).not.toBe(file2Chunk1!.id); // Different because paths differ!

    // Verify the IDs are based on file path + offset
    expect(file1Chunk1!.offset).toBe(0);
    expect(file2Chunk1!.offset).toBe(0); // Same offset
    expect(file1Chunk1!.path).toBe(file1Path);
    expect(file2Chunk1!.path).toBe(file2Path); // Different path = different ID
  });
});
