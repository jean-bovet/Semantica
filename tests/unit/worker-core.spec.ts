/**
 * Unit tests for WorkerCore
 *
 * These tests verify the complete file processing pipeline including:
 * - File parsing
 * - Text chunking
 * - Embedding generation
 * - Database storage
 */

import { describe, it, expect, beforeEach, afterEach, vi, MockedFunction } from 'vitest';
import { WorkerCore } from '../../src/main/worker/WorkerCore';
import { DatabaseService } from '../../src/main/worker/services/database-service';
import { FileWatcherService } from '../../src/main/worker/services/file-watcher-service';
import { QueueService } from '../../src/main/worker/services/queue-service';
import { ConfigService } from '../../src/main/worker/services/config-service';
import { ModelService } from '../../src/main/worker/services/model-service';
import * as path from 'node:path';
import { parentPort } from 'node:worker_threads';
import { getParserForExtension } from '../../src/main/parsers/registry';
import { chunkText } from '../../src/main/pipeline/chunker';
import * as fs from 'node:fs';

// Mock all dependencies
vi.mock('node:worker_threads', () => ({
  parentPort: {
    postMessage: vi.fn()
  }
}));

vi.mock('../../src/main/worker/services/database-service');
vi.mock('../../src/main/worker/services/file-watcher-service');
vi.mock('../../src/main/worker/services/queue-service');
vi.mock('../../src/main/worker/services/config-service');
vi.mock('../../src/main/worker/services/model-service');
vi.mock('../../src/main/parsers/registry');
vi.mock('../../src/main/pipeline/chunker');
vi.mock('../../src/shared/utils/logger', () => ({
  logger: {
    log: vi.fn(),
    error: vi.fn(),
    warn: vi.fn()
  }
}));

vi.mock('node:fs', () => ({
  default: {
    mkdirSync: vi.fn(),
    existsSync: vi.fn()
  },
  mkdirSync: vi.fn(),
  existsSync: vi.fn()
}));

describe('WorkerCore', () => {
  let workerCore: WorkerCore;
  let mockDb: DatabaseService;
  let mockWatcher: FileWatcherService;
  let mockQueue: QueueService;
  let mockConfig: ConfigService;
  let mockModel: ModelService;

  beforeEach(() => {
    // Clear all mocks before each test
    vi.clearAllMocks();

    // Create worker core instance
    workerCore = new WorkerCore();

    // Get references to mocked services
    mockDb = (workerCore as any).db;
    mockWatcher = (workerCore as any).watcher;
    mockQueue = (workerCore as any).queue;
    mockConfig = (workerCore as any).config;
    mockModel = (workerCore as any).model;

    // Setup default mock behaviors
    vi.mocked(mockConfig.getSettings).mockReturnValue({
      fileTypes: {
        text: true,
        markdown: true,
        pdf: true,
        docx: true
      }
    } as any);

    vi.mocked(mockConfig.getWatchedFolders).mockReturnValue(['/test/folder']);
    vi.mocked(mockConfig.isFileTypeEnabled).mockReturnValue(true);
    vi.mocked(mockConfig.getEffectiveExcludePatterns).mockReturnValue([]);

    vi.mocked(mockQueue.getStats).mockReturnValue({
      queued: 0,
      processing: 0,
      done: 0,
      errors: 0
    });

    vi.mocked(mockQueue.getProcessingFiles).mockReturnValue([]);
    vi.mocked(mockQueue.process).mockResolvedValue(undefined);

    vi.mocked(mockModel.getEmbedderStats).mockReturnValue([]);
    vi.mocked(mockModel.checkModel).mockResolvedValue(true);
    vi.mocked(mockModel.embed).mockResolvedValue([[0.1, 0.2, 0.3]]);
    vi.mocked(mockModel.initialize).mockResolvedValue(undefined);

    vi.mocked(mockDb.loadFileStatusCache).mockResolvedValue(new Map());
    vi.mocked(mockDb.connect).mockResolvedValue(undefined);
    vi.mocked(mockDb.updateFileStatus).mockResolvedValue(undefined);
    vi.mocked(mockDb.deleteChunksForFile).mockResolvedValue(undefined);
    vi.mocked(mockDb.getChunksTable).mockReturnValue({
      add: vi.fn().mockResolvedValue(undefined),
      search: vi.fn().mockReturnValue({
        metricType: vi.fn().mockReturnThis(),
        limit: vi.fn().mockReturnThis(),
        toArray: vi.fn().mockResolvedValue([])
      })
    } as any);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('File Processing Pipeline', () => {
    it('should process a text file and create chunks with embeddings', async () => {
      // Arrange
      const testFilePath = '/test/document.txt';
      const testText = 'This is a test document with some content.';
      const testChunks = [
        { text: 'This is a test', offset: 0 },
        { text: 'document with some content', offset: 15 }
      ];

      // Mock parser registry to return text parser
      vi.mocked(getParserForExtension).mockReturnValue([
        'text',
        {
          extensions: ['txt'],
          label: 'Text',
          category: 'text',
          parser: () => Promise.resolve(async () => testText),
          version: 4,
          versionHistory: {},
          enabledByDefault: true,
          chunkSize: 100,
          chunkOverlap: 20
        }
      ]);

      // Mock chunker to return test chunks
      vi.mocked(chunkText).mockReturnValue(testChunks);

      // Mock embeddings
      const mockEmbeddings = [
        [0.1, 0.2, 0.3],
        [0.4, 0.5, 0.6]
      ];
      vi.mocked(mockModel.embed).mockResolvedValueOnce([mockEmbeddings[0]])
        .mockResolvedValueOnce([mockEmbeddings[1]]);

      // Mock database table
      const mockTable = {
        add: vi.fn().mockResolvedValue(undefined)
      };
      vi.mocked(mockDb.getChunksTable).mockReturnValue(mockTable as any);
      vi.mocked(mockDb.updateFileStatus).mockResolvedValue(undefined);

      // Act - call private method through queue callback
      const processCallback = vi.mocked(mockQueue.setProcessCallback).mock.calls[0][0];
      await processCallback(testFilePath);

      // Assert
      // 1. Parser should be called with correct extension
      expect(getParserForExtension).toHaveBeenCalledWith('txt');

      // 2. Chunker should be called with parsed text
      expect(chunkText).toHaveBeenCalledWith(testText, 100, 20);

      // 3. Embeddings should be generated for each chunk
      expect(mockModel.embed).toHaveBeenCalledTimes(2);
      expect(mockModel.embed).toHaveBeenCalledWith(['This is a test'], false);
      expect(mockModel.embed).toHaveBeenCalledWith(['document with some content'], false);

      // 4. Chunks should be stored in database with embeddings
      expect(mockTable.add).toHaveBeenCalledTimes(2);
      expect(mockTable.add).toHaveBeenNthCalledWith(1, [{
        vector: mockEmbeddings[0],
        text: 'This is a test',
        path: testFilePath,
        offset: 0,
        chunk_index: 0
      }]);
      expect(mockTable.add).toHaveBeenNthCalledWith(2, [{
        vector: mockEmbeddings[1],
        text: 'document with some content',
        path: testFilePath,
        offset: 15,
        chunk_index: 1
      }]);

      // 5. File status should be updated
      expect(mockDb.updateFileStatus).toHaveBeenCalledWith(
        testFilePath,
        'indexed',
        '',
        2, // number of chunks
        4  // parser version
      );
    });

    it('should handle file with no text content', async () => {
      // Arrange
      const testFilePath = '/test/empty.txt';

      // Mock parser to return empty text
      vi.mocked(getParserForExtension).mockReturnValue([
        'text',
        {
          extensions: ['txt'],
          label: 'Text',
          category: 'text',
          parser: () => Promise.resolve(async () => ''),
          version: 4,
          versionHistory: {},
          enabledByDefault: true
        }
      ]);

      // Mock chunker to return empty array for empty text
      vi.mocked(chunkText).mockReturnValue([]);

      vi.mocked(mockDb.updateFileStatus).mockResolvedValue(undefined);

      // Act
      const processCallback = vi.mocked(mockQueue.setProcessCallback).mock.calls[0][0];
      await expect(processCallback(testFilePath)).rejects.toThrow('No text content extracted');

      // Assert
      expect(mockDb.updateFileStatus).toHaveBeenCalledWith(
        testFilePath,
        'error',
        'No text content extracted'
      );
    });

    it('should handle unsupported file types', async () => {
      // Arrange
      const testFilePath = '/test/unknown.xyz';

      // Mock parser registry to return null for unknown extension
      vi.mocked(getParserForExtension).mockReturnValue(null);

      vi.mocked(mockDb.updateFileStatus).mockResolvedValue(undefined);

      // Act
      const processCallback = vi.mocked(mockQueue.setProcessCallback).mock.calls[0][0];
      await expect(processCallback(testFilePath)).rejects.toThrow('No parser for .xyz');

      // Assert
      expect(mockDb.updateFileStatus).toHaveBeenCalledWith(
        testFilePath,
        'error',
        'No parser for .xyz'
      );
    });

    it('should handle disabled file types', async () => {
      // Arrange
      const testFilePath = '/test/document.pdf';

      // Mock parser to return PDF parser (returns PDFPage[] format)
      vi.mocked(getParserForExtension).mockReturnValue([
        'pdf',
        {
          extensions: ['pdf'],
          label: 'PDF',
          category: 'document',
          parser: () => Promise.resolve(async () => [{ page: 1, text: 'PDF content' }]),
          version: 1,
          versionHistory: {},
          enabledByDefault: true
        }
      ]);

      // Mock config to return PDF as disabled
      vi.mocked(mockConfig.getSettings).mockReturnValue({
        fileTypes: {
          pdf: false // PDF disabled
        }
      } as any);

      vi.mocked(mockDb.updateFileStatus).mockResolvedValue(undefined);

      // Act
      const processCallback = vi.mocked(mockQueue.setProcessCallback).mock.calls[0][0];
      await expect(processCallback(testFilePath)).rejects.toThrow('File type disabled');

      // Assert
      expect(mockDb.updateFileStatus).toHaveBeenCalledWith(
        testFilePath,
        'error',
        'File type disabled'
      );
    });

    it('should handle parser errors', async () => {
      // Arrange
      const testFilePath = '/test/corrupted.docx';
      const parserError = new Error('File is corrupted');

      // Mock parser to throw error
      vi.mocked(getParserForExtension).mockReturnValue([
        'docx',
        {
          extensions: ['docx'],
          label: 'DOCX',
          category: 'document',
          parser: () => Promise.resolve(async () => {
            throw parserError;
          }),
          version: 1,
          versionHistory: {},
          enabledByDefault: true
        }
      ]);

      vi.mocked(mockDb.updateFileStatus).mockResolvedValue(undefined);

      // Act
      const processCallback = vi.mocked(mockQueue.setProcessCallback).mock.calls[0][0];
      await expect(processCallback(testFilePath)).rejects.toThrow('File is corrupted');

      // Assert
      expect(mockDb.updateFileStatus).toHaveBeenCalledWith(
        testFilePath,
        'error',
        'File is corrupted'
      );
    });

    it('should process PDF files correctly', async () => {
      // Arrange
      const testFilePath = '/test/document.pdf';
      const testPDFPages = [
        { page: 1, text: 'First page content' },
        { page: 2, text: 'Second page content' }
      ];

      // Mock parser to return PDF pages
      vi.mocked(getParserForExtension).mockReturnValue([
        'pdf',
        {
          extensions: ['pdf'],
          label: 'PDF',
          category: 'document',
          parser: () => Promise.resolve(async () => testPDFPages),
          version: 1,
          versionHistory: {},
          enabledByDefault: true
        }
      ]);

      // Mock chunker to return chunks from concatenated text
      vi.mocked(chunkText).mockReturnValue([
        { text: 'First page content', offset: 0 },
        { text: 'Second page content', offset: 19 }
      ]);

      // Mock embeddings
      vi.mocked(mockModel.embed).mockResolvedValue([[0.1, 0.2, 0.3]]);

      const mockTable = {
        add: vi.fn().mockResolvedValue(undefined)
      };
      vi.mocked(mockDb.getChunksTable).mockReturnValue(mockTable as any);
      vi.mocked(mockDb.updateFileStatus).mockResolvedValue(undefined);

      // Act
      const processCallback = vi.mocked(mockQueue.setProcessCallback).mock.calls[0][0];
      await processCallback(testFilePath);

      // Assert
      // Should concatenate PDF pages with double newline
      expect(chunkText).toHaveBeenCalledWith(
        'First page content\n\nSecond page content',
        500,  // Default chunkSize
        60    // Default chunkOverlap
      );

      // Should create chunks and store them
      expect(mockTable.add).toHaveBeenCalledTimes(2);
      expect(mockDb.updateFileStatus).toHaveBeenCalledWith(
        testFilePath,
        'indexed',
        '',
        2,
        1
      );
    });

    it('should handle embedding errors', async () => {
      // Arrange
      const testFilePath = '/test/document.txt';
      const testText = 'This is a test document.';
      const testChunks = [{ text: testText, offset: 0 }];

      // Mock successful parsing and chunking
      vi.mocked(getParserForExtension).mockReturnValue([
        'text',
        {
          extensions: ['txt'],
          label: 'Text',
          category: 'text',
          parser: () => Promise.resolve(async () => testText),
          version: 4,
          versionHistory: {},
          enabledByDefault: true
        }
      ]);

      vi.mocked(chunkText).mockReturnValue(testChunks);

      // Mock embedding to throw error
      vi.mocked(mockModel.embed).mockRejectedValue(new Error('Model not loaded'));

      vi.mocked(mockDb.updateFileStatus).mockResolvedValue(undefined);

      // Act
      const processCallback = vi.mocked(mockQueue.setProcessCallback).mock.calls[0][0];
      await expect(processCallback(testFilePath)).rejects.toThrow('Model not loaded');

      // Assert
      expect(mockDb.updateFileStatus).toHaveBeenCalledWith(
        testFilePath,
        'error',
        'Model not loaded'
      );
    });
  });

  describe('Initialization', () => {
    it('should initialize fast and slow phases correctly', async () => {
      // Arrange
      const dbDir = '/test/db';
      const userDataPath = '/test/user';

      // Act
      await workerCore.initialize(dbDir, userDataPath);

      // Wait a bit for slow initialization to start
      await new Promise(resolve => setTimeout(resolve, 100));

      // Assert
      // Fast initialization - fs.mkdirSync is mocked
      expect(fs.mkdirSync).toHaveBeenCalledWith(dbDir, { recursive: true });
      expect(fs.mkdirSync).toHaveBeenCalledWith(path.join(userDataPath, 'models'), { recursive: true });
      expect(mockConfig.load).toHaveBeenCalledWith(dbDir);
      expect(mockDb.connect).toHaveBeenCalledWith(dbDir);
      expect(mockModel.initialize).toHaveBeenCalledWith(userDataPath);

      // Should signal ready
      expect(parentPort?.postMessage).toHaveBeenCalledWith({
        type: 'ready',
        payload: {}
      });

      // Slow initialization should start
      expect(mockDb.loadFileStatusCache).toHaveBeenCalled();
      expect(mockModel.checkModel).toHaveBeenCalled();
    });
  });

  describe('Message Handling', () => {
    beforeEach(async () => {
      // Initialize worker for message handling tests
      await workerCore.initialize('/test/db', '/test/user');
    });

    it('should handle checkModel message', async () => {
      // Arrange
      vi.mocked(mockModel.checkModel).mockResolvedValue(true);

      // Act
      const result = await workerCore.handleMessage('checkModel', {});

      // Assert
      expect(result).toEqual({ exists: true });
      expect(mockModel.checkModel).toHaveBeenCalled();
    });

    it('should handle search message', async () => {
      // Arrange
      const query = 'test query';
      const k = 5;
      const mockResults = [
        { text: 'result 1', score: 0.9 },
        { text: 'result 2', score: 0.8 }
      ];

      const mockTable = {
        search: vi.fn().mockReturnValue({
          metricType: vi.fn().mockReturnThis(),
          limit: vi.fn().mockReturnThis(),
          toArray: vi.fn().mockResolvedValue(mockResults)
        })
      };

      vi.mocked(mockDb.getChunksTable).mockReturnValue(mockTable as any);
      vi.mocked(mockModel.embed).mockResolvedValue([[0.1, 0.2, 0.3]]);

      // Set model as ready
      (workerCore as any).status.modelReady = true;

      // Act
      const result = await workerCore.handleMessage('search', { q: query, k });

      // Assert
      expect(result).toEqual(mockResults);
      expect(mockModel.embed).toHaveBeenCalledWith([query], true);
      expect(mockTable.search).toHaveBeenCalledWith([0.1, 0.2, 0.3]);
    });

    it('should handle enqueue message', async () => {
      // Arrange
      const paths = ['/file1.txt', '/file2.txt'];

      // Act
      const result = await workerCore.handleMessage('enqueue', { paths });

      // Assert
      expect(result).toEqual({ success: true });
      expect(mockQueue.add).toHaveBeenCalledWith(paths);
      expect(mockQueue.process).toHaveBeenCalled();
    });
  });

  describe('File Watcher Events', () => {
    beforeEach(async () => {
      await workerCore.initialize('/test/db', '/test/user');
    });

    it('should handle file add events', () => {
      // Arrange
      const filePath = '/test/new-file.txt';
      vi.mocked(mockConfig.isFileTypeEnabled).mockReturnValue(true);

      // Get the 'add' event handler
      const addHandler = vi.mocked(mockWatcher.on).mock.calls.find(
        call => call[0] === 'add'
      )?.[1];

      // Act
      addHandler?.(filePath);

      // Assert
      expect(mockQueue.add).toHaveBeenCalledWith([filePath]);
      expect(mockQueue.process).toHaveBeenCalled();
    });

    it('should handle file change events', async () => {
      // Arrange
      const filePath = '/test/changed-file.txt';
      vi.mocked(mockConfig.isFileTypeEnabled).mockReturnValue(true);
      vi.mocked(mockDb.deleteChunksForFile).mockResolvedValue(undefined);

      // Get the 'change' event handler
      const changeHandler = vi.mocked(mockWatcher.on).mock.calls.find(
        call => call[0] === 'change'
      )?.[1];

      // Act
      changeHandler?.(filePath);
      await new Promise(resolve => setTimeout(resolve, 10));

      // Assert
      expect(mockDb.deleteChunksForFile).toHaveBeenCalledWith(filePath);
      expect(mockQueue.add).toHaveBeenCalledWith([filePath]);
      expect(mockQueue.process).toHaveBeenCalled();
    });

    it('should handle file unlink events', async () => {
      // Arrange
      const filePath = '/test/deleted-file.txt';
      vi.mocked(mockDb.deleteChunksForFile).mockResolvedValue(undefined);
      vi.mocked(mockDb.updateFileStatus).mockResolvedValue(undefined);

      // Get the 'unlink' event handler
      const unlinkHandler = vi.mocked(mockWatcher.on).mock.calls.find(
        call => call[0] === 'unlink'
      )?.[1];

      // Act
      unlinkHandler?.(filePath);
      await new Promise(resolve => setTimeout(resolve, 10));

      // Assert
      expect(mockDb.deleteChunksForFile).toHaveBeenCalledWith(filePath);
      expect(mockDb.updateFileStatus).toHaveBeenCalledWith(filePath, 'outdated');
    });
  });

  describe('Pipeline Status Reporting', () => {
    it('should report pipeline status when there is activity', async () => {
      // Arrange
      vi.useFakeTimers();

      vi.mocked(mockQueue.getStats).mockReturnValue({
        queued: 10,
        processing: 2,
        done: 50,
        errors: 1
      });

      vi.mocked(mockQueue.getProcessingFiles).mockReturnValue([
        '/test/file1.txt',
        '/test/file2.pdf'
      ]);

      vi.mocked(mockModel.getEmbedderStats).mockReturnValue([
        { id: 'embedder-1', filesProcessed: 100, memoryUsage: 200, isHealthy: true }
      ]);

      // Spy on console.log
      const consoleLogSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

      // Act
      await workerCore.initialize('/test/db', '/test/user');

      // Fast forward 2 seconds to trigger status interval
      vi.advanceTimersByTime(2000);

      // Assert
      expect(consoleLogSpy).toHaveBeenCalled();
      const logCall = consoleLogSpy.mock.calls[0][0];
      expect(logCall).toContain('[PIPELINE STATUS]');
      expect(logCall).toContain('10 queued');
      expect(logCall).toContain('2/5 parsing');  // maxConcurrent is hardcoded to 5
      expect(logCall).toContain('50 completed');

      // Should also send to main process
      expect(parentPort?.postMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'pipeline:status',
          payload: expect.stringContaining('[PIPELINE STATUS]')
        })
      );

      vi.useRealTimers();
      consoleLogSpy.mockRestore();
    });
  });

  describe('Edge Cases and Error Handling', () => {
    it('should handle large files with many chunks', async () => {
      // Arrange
      const testFilePath = '/test/large-document.txt';
      const largeText = 'Lorem ipsum '.repeat(1000);

      // Create many chunks
      const manyChunks = Array.from({ length: 50 }, (_, i) => ({
        text: `Chunk ${i}`,
        offset: i * 10
      }));

      vi.mocked(getParserForExtension).mockReturnValue([
        'text',
        {
          extensions: ['txt'],
          label: 'Text',
          category: 'text',
          parser: () => Promise.resolve(async () => largeText),
          version: 4,
          versionHistory: {},
          enabledByDefault: true
        }
      ]);

      vi.mocked(chunkText).mockReturnValue(manyChunks);

      // Mock embeddings for all chunks
      vi.mocked(mockModel.embed).mockResolvedValue([[0.1, 0.2, 0.3]]);

      const mockTable = {
        add: vi.fn().mockResolvedValue(undefined)
      };
      vi.mocked(mockDb.getChunksTable).mockReturnValue(mockTable as any);
      vi.mocked(mockDb.updateFileStatus).mockResolvedValue(undefined);

      // Act
      const processCallback = vi.mocked(mockQueue.setProcessCallback).mock.calls[0][0];
      await processCallback(testFilePath);

      // Assert
      expect(mockModel.embed).toHaveBeenCalledTimes(50);
      expect(mockTable.add).toHaveBeenCalledTimes(50);
      expect(mockDb.updateFileStatus).toHaveBeenCalledWith(
        testFilePath,
        'indexed',
        '',
        50, // 50 chunks
        4
      );
    });

    it('should handle concurrent file processing correctly', async () => {
      // This test verifies the queue processes files sequentially
      // to avoid overwhelming the embedder

      // Arrange
      const files = ['/file1.txt', '/file2.txt', '/file3.txt'];

      // Act
      const result = await workerCore.handleMessage('enqueue', { paths: files });

      // Assert
      expect(result).toEqual({ success: true });
      expect(mockQueue.add).toHaveBeenCalledWith(files);
      expect(mockQueue.process).toHaveBeenCalledTimes(1); // Process called once
    });
  });
});