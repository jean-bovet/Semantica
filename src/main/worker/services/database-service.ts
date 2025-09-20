/**
 * DatabaseService - Handles all database operations
 *
 * This service encapsulates all LanceDB operations, making them
 * easily testable and maintainable.
 */

import * as lancedb from '@lancedb/lancedb';
import type { IDatabaseService } from '../types/interfaces';
import type { FileStatus } from '../fileStatusManager';
import { initializeFileStatusTable, updateFileStatus as updateFileStatusFunc } from '../fileStatusManager';
import { logger } from '../../../shared/utils/logger';

export class DatabaseService implements IDatabaseService {
  private db: any = null;
  private chunksTable: any = null;
  private fileStatusTable: any = null;

  async connect(dbDir: string): Promise<void> {
    logger.log('DATABASE', 'Connecting to database...');
    const startTime = Date.now();

    try {
      this.db = await lancedb.connect(dbDir);

      // Initialize chunks table
      this.chunksTable = await this.db.openTable('chunks').catch(async () => {
        // Create table with initial schema
        const initialData = [{
          id: 'init',
          path: '',
          mtime: 0,
          page: 0,
          offset: 0,
          text: '',
          vector: new Array(384).fill(0),
          type: 'init',
          title: ''
        }];

        const table = await this.db.createTable('chunks', initialData, {
          mode: 'create'
        });

        // Delete the initialization record
        try {
          await table.delete('id = "init"');
        } catch (e: any) {
          logger.log('DATABASE', 'Could not delete init record (may not exist):', e?.message || e);
        }

        return table;
      });

      // Initialize file status table
      try {
        this.fileStatusTable = await initializeFileStatusTable(this.db);
      } catch (e) {
        logger.error('DATABASE', 'Failed to initialize file status table:', e);
        this.fileStatusTable = null;
      }

      const elapsed = Date.now() - startTime;
      logger.log('DATABASE', `Database connected in ${elapsed}ms`);
    } catch (error) {
      logger.error('DATABASE', 'Failed to connect to database:', error);
      throw error;
    }
  }

  async disconnect(): Promise<void> {
    // LanceDB doesn't have explicit disconnect, but we can clean up references
    this.db = null;
    this.chunksTable = null;
    this.fileStatusTable = null;
    logger.log('DATABASE', 'Database disconnected');
  }

  getChunksTable(): any {
    if (!this.chunksTable) {
      throw new Error('Database not connected');
    }
    return this.chunksTable;
  }

  getFileStatusTable(): any {
    return this.fileStatusTable; // Can be null
  }

  async queryFiles(limit: number = 100000): Promise<{ path: string }[]> {
    if (!this.chunksTable) {
      throw new Error('Database not connected');
    }

    try {
      const allRows = await this.chunksTable.query()
        .select(['path'])
        .limit(limit)
        .toArray();
      return allRows;
    } catch (error) {
      logger.error('DATABASE', 'Failed to query files:', error);
      return [];
    }
  }

  async updateFileStatus(
    filePath: string,
    status: 'indexed' | 'failed' | 'error' | 'queued' | 'outdated',
    errorMessage: string = '',
    chunkCount: number = 0,
    parserVersion: number = 0
  ): Promise<void> {
    if (!this.fileStatusTable) {
      logger.warn('DATABASE', 'File status table not available');
      return;
    }

    await updateFileStatusFunc(
      this.fileStatusTable,
      filePath,
      status,
      errorMessage,
      chunkCount,
      parserVersion
    );
  }

  async searchChunks(query: string, k: number = 10): Promise<any[]> {
    if (!this.chunksTable) {
      throw new Error('Database not connected');
    }

    // This is a placeholder - actual implementation would use vector search
    // The real implementation is in the worker where embeddings are available
    logger.log('DATABASE', `Searching for: ${query} (k=${k})`);
    return [];
  }

  async getStats(): Promise<{
    totalChunks: number;
    indexedFiles: number;
    folderStats: any[];
  }> {
    if (!this.chunksTable) {
      return { totalChunks: 0, indexedFiles: 0, folderStats: [] };
    }

    try {
      const allChunks = await this.chunksTable.query()
        .select(['path'])
        .toArray();

      const uniquePaths = new Set(allChunks.map((c: any) => c.path));

      return {
        totalChunks: allChunks.length,
        indexedFiles: uniquePaths.size,
        folderStats: [] // Would need folder tracking to implement this
      };
    } catch (error) {
      logger.error('DATABASE', 'Failed to get stats:', error);
      return { totalChunks: 0, indexedFiles: 0, folderStats: [] };
    }
  }

  // Additional helper methods
  async addChunks(chunks: any[]): Promise<void> {
    if (!this.chunksTable) {
      throw new Error('Database not connected');
    }

    if (chunks.length === 0) {
      return;
    }

    try {
      await this.chunksTable.add(chunks);
      logger.log('DATABASE', `Added ${chunks.length} chunks to database`);
    } catch (error) {
      logger.error('DATABASE', 'Failed to add chunks:', error);
      throw error;
    }
  }

  async deleteChunksForFile(filePath: string): Promise<void> {
    if (!this.chunksTable) {
      throw new Error('Database not connected');
    }

    try {
      await this.chunksTable.delete(`path = "${filePath}"`);
      logger.log('DATABASE', `Deleted chunks for file: ${filePath}`);
    } catch (error) {
      logger.error('DATABASE', 'Failed to delete chunks:', error);
    }
  }

  async loadFileStatusCache(): Promise<Map<string, FileStatus>> {
    if (!this.fileStatusTable) {
      return new Map();
    }

    try {
      const records = await this.fileStatusTable.query().toArray();
      const cache = new Map<string, FileStatus>(
        records.map((r: any) => [r.path, r])
      );
      logger.log('DATABASE', `Loaded ${cache.size} file status records into cache`);
      return cache;
    } catch (error) {
      logger.error('DATABASE', 'Failed to load file status cache:', error);
      return new Map();
    }
  }
}