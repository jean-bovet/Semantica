# API Reference

*Previous: [04-operations.md](./04-operations.md)*

---

## IPC API

The application uses Electron's IPC (Inter-Process Communication) for secure communication between the renderer and main/worker processes.

### Preload API

The preload script exposes a secure API to the renderer process via `window.api`:

```typescript
interface WindowAPI {
  dialog: DialogAPI;
  indexer: IndexerAPI;
  search: SearchAPI;
  db: DatabaseAPI;
  settings: SettingsAPI;
  model: ModelAPI;
  system: SystemAPI;
  on: (channel: string, callback: Function) => void;
  off: (channel: string, callback: Function) => void;
}
```

### Dialog API

User interaction dialogs:

```typescript
interface DialogAPI {
  // Select folders for indexing
  selectFolders(): Promise<string[]>;
  
  // Show confirmation dialog
  confirm(title: string, message: string): Promise<boolean>;
  
  // Show error dialog
  error(title: string, message: string): Promise<void>;
}
```

### Indexer API

Controls the indexing process:

```typescript
interface IndexerAPI {
  // Start watching and indexing folders
  watchStart(roots: string[], options?: IndexOptions): Promise<void>;
  
  // Queue specific files for indexing
  enqueue(paths: string[]): Promise<void>;
  
  // Pause indexing
  pause(): Promise<void>;
  
  // Resume indexing
  resume(): Promise<void>;
  
  // Get current progress
  progress(): Promise<{
    queued: number;
    processing: number;
    done: number;
    errors: number;
    paused: boolean;
    initialized: boolean;
  }>;
  
  // Subscribe to progress updates
  onProgress(callback: (progress: Progress) => void): () => void;
  
  // Get currently watched folders
  getWatchedFolders(): Promise<string[]>;
  
  // Re-index all documents
  reindexAll(): Promise<void>;
  
  // Search for files by name/path
  searchFiles(query: string): Promise<FileSearchResult[]>;
}

interface FileSearchResult {
  path: string;
  name: string;
  type: string;
  size: number;
  modified: string;
  indexed: boolean;
}
```

### Search API

Handles semantic search queries:

```typescript
interface SearchAPI {
  // Semantic search with vector embeddings
  query(q: string, k?: number): Promise<SearchResult[]>;
}

interface SearchResult {
  path: string;
  text: string;
  score: number;
  page?: number;
  title?: string;
  type: string;
}
```

### Database API

Database statistics and management:

```typescript
interface DatabaseAPI {
  // Get database statistics
  stats(): Promise<{
    totalChunks: number;
    indexedFiles: number;
    folderStats: Array<{
      folder: string;
      totalFiles: number;
      indexedFiles: number;
    }>;
  }>;
}
```

### Settings API

Application settings management:

```typescript
interface SettingsAPI {
  // Get current settings
  get(): Promise<AppSettings>;
  
  // Update settings
  update(settings: Partial<AppSettings>): Promise<void>;
}

interface AppSettings {
  fileTypes: {
    pdf: boolean;
    txt: boolean;
    md: boolean;
    docx: boolean;
    doc: boolean;
    rtf: boolean;
    csv: boolean;
    tsv: boolean;
    xlsx: boolean;
    xls: boolean;
    xlsm: boolean;
  };
  excludePatterns?: string[];
  maxFileSize?: number; // MB
  embeddingConfig?: {
    poolSize?: number;
    maxMemoryMB?: number;
    maxFilesBeforeRestart?: number;
  };
}
```

### Model API

ML model management:

```typescript
interface ModelAPI {
  // Check if model exists
  check(): Promise<{ exists: boolean }>;
  
  // Download model files
  download(): Promise<void>;
}
```

### System API

System-level operations:

```typescript
interface SystemAPI {
  // Open path in Finder/Explorer
  openPath(path: string): Promise<void>;
  
  // Open file preview
  openPreview(path: string, page?: number): Promise<void>;
  
  // Get application data path
  getDataPath(): Promise<string>;
}
```

## Worker Thread Messages

Communication protocol between main process and worker thread:

### Message Types

```typescript
type WorkerMessage = 
  | { type: 'init', dbDir: string, userDataPath: string }
  | { type: 'watchStart', payload: { roots: string[], options?: any } }
  | { type: 'search', payload: { q: string, k: number } }
  | { type: 'pause' }
  | { type: 'resume' }
  | { type: 'progress' }
  | { type: 'stats' }
  | { type: 'checkModel' }
  | { type: 'downloadModel' }
  | { type: 'reindexAll' }
  | { type: 'searchFiles', payload: { query: string } };

type WorkerResponse =
  | { type: 'ready' }
  | { type: 'progress', payload: ProgressData }
  | { type: 'model:ready', payload: { ready: boolean } }
  | { type: 'model:download:progress', payload: { progress: number, file: string } }
  | { type: 'model:download:complete' }
  | { type: 'error', payload: { message: string } }
  | { type: 'parser-upgrade', payload: Record<string, string> };
```

### Progress Updates

```typescript
interface ProgressData {
  queued: number;
  processing: number;
  done: number;
  errors: number;
  paused: boolean;
  initialized: boolean;
  memoryUsage?: {
    rss: number;
    heapUsed: number;
    external: number;
  };
}
```

## Database Schemas

### LanceDB Tables

#### Chunks Table

Stores document chunks with embeddings:

```typescript
interface ChunkRecord {
  id: string;              // Unique chunk ID (hash-based)
  path: string;            // Absolute file path
  mtime: number;           // File modification timestamp
  page: number;            // Page number (0-based)
  offset: number;          // Character offset in file
  text: string;            // Chunk content
  vector: number[];        // 384-dimensional embedding
  type: string;            // File type/extension
  title: string;           // Document title or filename
}
```

#### File Status Table

Tracks indexing status:

```typescript
interface FileStatus {
  path: string;            // Absolute file path
  status: 'indexed' | 'failed' | 'error' | 'queued' | 'outdated';
  parser_version: number;  // Parser version used
  chunk_count: number;     // Number of chunks created
  error_message: string;   // Error details if failed
  last_modified: string;   // File modification time
  indexed_at: string;      // When indexed
  file_hash: string;       // MD5 hash (path:size:mtime)
  last_retry: string;      // Last retry attempt (empty string if none)
}
```

## Configuration Files

### Application Config

Location: `~/Library/Application Support/Semantica/data/config.json`

```json
{
  "version": "1.0.0",
  "watchedFolders": [
    "/Users/username/Documents",
    "/Users/username/Desktop"
  ],
  "settings": {
    "fileTypes": {
      "pdf": true,
      "txt": true,
      "md": true,
      "docx": true,
      "doc": true,
      "rtf": true,
      "csv": true,
      "tsv": true,
      "xlsx": true,
      "xls": true,
      "xlsm": true
    },
    "excludePatterns": [
      "node_modules",
      ".git",
      "*.app",
      "dist",
      "build",
      ".DS_Store",
      "*.photoslibrary",
      "*.dmg",
      "*.pkg"
    ]
  }
}
```

### Parser Registry

Location: `src/main/parsers/registry.ts`

The parser registry centralizes all parser definitions with versions:

```typescript
interface ParserDefinition {
  extensions: string[];
  parser: (filePath: string) => Promise<string>;
  version: number;
  versionHistory: Record<number, string>;
}

// Current parser versions
const PARSER_VERSIONS = {
  pdf: 1,     // pdf-parse
  doc: 2,     // word-extractor v2
  docx: 1,    // mammoth
  txt: 4,     // Multi-encoding support
  md: 4,      // Multi-encoding support
  rtf: 1,     // Custom RTF stripper
  csv: 1,     // csv-parse with encoding detection
  tsv: 1,     // csv-parse with tab delimiter
  xlsx: 1,    // ExcelJS
  xls: 1,     // ExcelJS
  xlsm: 1     // ExcelJS
};
```

## Embedder Architecture

### Python Sidecar

The application uses a Python FastAPI sidecar for embedding generation:

```typescript
interface PythonSidecarConfig {
  modelName: string;               // Default: 'paraphrase-multilingual-mpnet-base-v2'
  port: number;                    // Default: 8421
  batchSize: number;               // Default: 32
  normalizeVectors: boolean;       // Default: true
}

class PythonSidecarEmbedder {
  // Initialize and start Python sidecar
  async initialize(): Promise<void>;

  // Generate embeddings via HTTP POST
  async embed(texts: string[], isQuery?: boolean): Promise<number[][]>;

  // Health check
  async health(): Promise<{ status: string; model: string }>;

  // Clean shutdown
  async dispose(): Promise<void>;
}
```

**HTTP Endpoints:**
- `POST http://127.0.0.1:8421/embed` - Generate embeddings
- `GET http://127.0.0.1:8421/health` - Health check
- `GET http://127.0.0.1:8421/info` - Model information

For complete details, see [python-sidecar.md](./python-sidecar.md).

## Performance Profiling

### PerformanceProfiler

Built-in profiling for identifying bottlenecks:

```typescript
class PerformanceProfiler {
  // Enable/disable profiling
  setEnabled(enabled: boolean): void;
  
  // Start timing an operation
  startOperation(fileId: string, operation: string): void;
  
  // End timing an operation
  endOperation(fileId: string, operation: string): void;
  
  // Get profiling report
  generateReport(): {
    summary: {
      totalFiles: number;
      totalTime: number;
      avgTimePerFile: number;
      throughput: number;
    };
    bottlenecks: Array<{
      operation: string;
      avgTime: number;
      percentage: number;
    }>;
    memoryPressure: {
      embedderRestarts: number;
      throttleEvents: number;
    };
  };
}
```

## Environment Variables

Development and production environment variables:

```bash
# Enable profiling
PROFILING=true

# Custom paths
USER_DATA_PATH=/custom/path
DB_PATH=/custom/db/path

# Memory limits (MB)
WORKER_MAX_RSS=1500

# Concurrency
CPU_CONCURRENCY_OVERRIDE=8

# Python sidecar configuration
PYTHON_SIDECAR_PORT=8421
PYTHON_SIDECAR_MODEL=paraphrase-multilingual-mpnet-base-v2

# Debug logging
DEBUG=fss:*
LOG_CATEGORIES=STARTUP,WORKER,PIPELINE-STATUS
```

## Event System

### Application Events

```typescript
// Main process events
app.on('ready', createWindow);
app.on('window-all-closed', handleQuit);
app.on('activate', handleActivate);
app.on('second-instance', focusWindow);

// Window events
win.on('closed', cleanup);

// IPC events for model download
win.webContents.on('model:download:progress', handleProgress);
win.webContents.on('model:download:complete', handleComplete);
```

### Worker Events

```typescript
// File system events (Chokidar)
watcher.on('add', handleFileAdd);
watcher.on('change', handleFileChange);
watcher.on('unlink', handleFileRemove);
watcher.on('ready', handleWatcherReady);
watcher.on('error', handleWatchError);

// Python sidecar events
sidecar.on('started', handleSidecarStart);
sidecar.on('stopped', handleSidecarStop);
sidecar.on('error', handleSidecarError);
```

## Error Handling

### Error Categories

```typescript
enum ErrorCategory {
  // File errors
  FILE_NOT_FOUND = 'File not found',
  FILE_TOO_LARGE = 'File exceeds size limit',
  FILE_CORRUPTED = 'File is corrupted',
  FILE_ENCRYPTED = 'File is encrypted',
  
  // Parser errors
  PARSER_FAILED = 'Parser failed to extract text',
  NO_TEXT_CONTENT = 'No text content found',
  UNSUPPORTED_FORMAT = 'Unsupported file format',
  ENCODING_ERROR = 'Unable to detect file encoding',
  
  // Database errors
  DB_CONNECTION_FAILED = 'Database connection failed',
  DB_WRITE_FAILED = 'Database write failed',
  
  // Memory errors
  MEMORY_LIMIT_EXCEEDED = 'Memory limit exceeded',
  EMBEDDER_CRASHED = 'Embedder process crashed',
  
  // System errors
  PERMISSION_DENIED = 'Permission denied',
  DISK_FULL = 'Insufficient disk space'
}
```

## Performance Benchmarks

### Current Performance Metrics

| Operation | Target | Actual |
|-----------|--------|--------|
| File parsing (PDF) | <500ms | ~300ms |
| Embedding generation (32 chunks batch) | <400ms | ~350ms |
| Vector search (100k docs) | <100ms | ~50ms |
| Memory per embedder process | <300MB | ~250MB |
| Startup time | <3s | ~2s |
| Throughput (files/minute) | >60 | ~120 |

### Scalability Limits

| Resource | Soft Limit | Hard Limit |
|----------|-----------|------------|
| Indexed files | 100,000 | 1,000,000 |
| Database size | 10GB | 100GB |
| Concurrent embedders | 2 | CPU cores |
| Memory usage (worker) | 1.5GB | 2GB |
| File size | 50MB | 500MB |

---

*Previous: [04-operations.md](./04-operations.md) | Next: [06-build-optimization.md](./06-build-optimization.md)*