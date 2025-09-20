/**
 * Service Interfaces for Worker Components
 *
 * These interfaces define the contracts for each service,
 * making them easily testable and replaceable.
 */

import type { FileStatus } from '../fileStatusManager';
import type { AppConfig } from '../config';

// Database Service
export interface IDatabaseService {
  connect(dbDir: string): Promise<void>;
  disconnect(): Promise<void>;
  getChunksTable(): any;
  getFileStatusTable(): any;
  queryFiles(limit?: number): Promise<{ path: string }[]>;
  updateFileStatus(
    filePath: string,
    status: 'indexed' | 'failed' | 'error' | 'queued' | 'outdated',
    errorMessage?: string,
    chunkCount?: number,
    parserVersion?: number
  ): Promise<void>;
  searchChunks(query: string, k: number): Promise<any[]>;
  getStats(watchedFolders?: string[]): Promise<{
    totalChunks: number;
    indexedFiles: number;
    folderStats: any[];
  }>;
}

// File Watcher Service
export interface IFileWatcherService {
  start(
    roots: string[],
    excludePatterns?: string[],
    fileStatusCache?: Map<string, FileStatus>
  ): Promise<void>;
  stop(): Promise<void>;
  on(event: 'add' | 'change' | 'unlink', handler: (path: string) => void): void;
  off(event: 'add' | 'change' | 'unlink', handler: (path: string) => void): void;
  scanForChanges(): Promise<{
    newFiles: string[];
    modifiedFiles: string[];
    skippedFiles: string[];
  }>;
}

// Queue Service
export interface IQueueService {
  add(files: string[]): void;
  process(): Promise<void>;
  pause(): void;
  resume(): void;
  clear(): void;
  isProcessing(file: string): boolean;
  getStats(): {
    queued: number;
    processing: number;
    done: number;
    errors: number;
  };
  on(event: 'processed' | 'error' | 'empty', handler: (...args: any[]) => void): void;
  off(event: 'processed' | 'error' | 'empty', handler: (...args: any[]) => void): void;
}

// File Indexer
export interface IFileIndexer {
  indexFile(filePath: string): Promise<{
    success: boolean;
    chunks?: any[];
    error?: string;
  }>;
  parseFile(filePath: string, extension: string): Promise<string>;
  createChunks(text: string, filePath: string, metadata?: any): any[];
}

// Model Service
export interface IModelService {
  initialize(userDataPath: string): Promise<void>;
  checkModel(): Promise<boolean>;
  downloadModel(): Promise<void>;
  embed(texts: string[], isQuery?: boolean): Promise<number[][]>;
  getEmbedderStats(): {
    filesProcessed: number;
    memoryUsage: number;
    isHealthy: boolean;
  }[];
  restartEmbedders(): Promise<void>;
  shutdown(): Promise<void>;
}

// Message Broker
export interface IMessageBroker {
  sendMessage(type: string, payload?: any): void;
  sendResponse(id: string, payload: any): void;
  on(type: string, handler: (msg: any) => Promise<any>): void;
  off(type: string, handler: (msg: any) => Promise<any>): void;
}

// Config Service
export interface IConfigService {
  load(dbDir: string): void;
  getConfig(): AppConfig;
  getSettings(): AppConfig['settings'];
  updateSettings(settings: Partial<AppConfig['settings']>): void;
  getWatchedFolders(): string[];
  setWatchedFolders(folders: string[]): void;
  getEffectiveExcludePatterns(): string[];
}

// Worker Core - Main Coordinator
export interface IWorkerCore {
  initialize(dbDir: string, userDataPath: string): Promise<void>;
  initializeFast(dbDir: string, userDataPath: string): Promise<void>;
  initializeSlow(userDataPath: string): Promise<void>;
  handleMessage(type: string, payload: any): Promise<any>;
  shutdown(): Promise<void>;
  getStatus(): {
    ready: boolean;
    modelReady: boolean;
    filesLoaded: boolean;
  };
}