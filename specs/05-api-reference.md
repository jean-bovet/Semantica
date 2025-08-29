# API Reference

*Previous: [04-operations.md](./04-operations.md)*

---

## IPC API

The application uses Electron's IPC (Inter-Process Communication) for secure communication between the renderer and main/worker processes.

### Preload API

The preload script exposes a secure API to the renderer process via `window.api`:

```typescript
interface WindowAPI {
  indexer: IndexerAPI;
  search: SearchAPI;
  db: DatabaseAPI;
  config: ConfigAPI;
  system: SystemAPI;
}
```

### Indexer API

Controls the indexing process:

```typescript
interface IndexerAPI {
  // Start indexing selected folders
  start(folders: string[]): Promise<void>;
  
  // Pause indexing
  pause(): Promise<void>;
  
  // Resume indexing
  resume(): Promise<void>;
  
  // Get current progress
  progress(): Promise<{
    queued: number;
    processing: number;
    completed: number;
    failed: number;
    totalFiles: number;
  }>;
  
  // Re-index specific folders
  reindex(folders: string[]): Promise<void>;
  
  // Get file status
  getFileStatus(path: string): Promise<FileStatus>;
}
```

### Search API

Handles search queries:

```typescript
interface SearchAPI {
  // Semantic search
  query(text: string, options?: SearchOptions): Promise<SearchResult[]>;
  
  // File name/path search
  searchFiles(query: string): Promise<FileSearchResult[]>;
  
  // Clear search cache
  clearCache(): Promise<void>;
}

interface SearchOptions {
  limit?: number;        // Max results (default: 100)
  threshold?: number;    // Similarity threshold (0-1)
  fileTypes?: string[];  // Filter by file types
}

interface SearchResult {
  path: string;
  score: number;
  snippet: string;
  metadata: {
    fileType: string;
    modifiedAt: string;
    chunkIndex: number;
  };
}
```

### Database API

Database management operations:

```typescript
interface DatabaseAPI {
  // Get database statistics
  stats(): Promise<{
    chunks: number;
    files: number;
    size: string;
    lastIndexed: string;
  }>;
  
  // Clear entire database
  clear(): Promise<void>;
  
  // Export database
  export(path: string): Promise<void>;
  
  // Import database
  import(path: string): Promise<void>;
  
  // Optimize indexes
  optimize(): Promise<void>;
}
```

### Config API

Application configuration:

```typescript
interface ConfigAPI {
  // Get current configuration
  get(): Promise<AppConfig>;
  
  // Update configuration
  set(config: Partial<AppConfig>): Promise<void>;
  
  // Reset to defaults
  reset(): Promise<void>;
}

interface AppConfig {
  version: string;
  watchedFolders: string[];
  settings: {
    fileTypes: {
      pdf: boolean;
      txt: boolean;
      md: boolean;
      docx: boolean;
      doc: boolean;
      rtf: boolean;
    };
    excludePatterns: string[];
    indexHiddenFiles: boolean;
    maxFileSize: number; // MB
  };
}
```

### System API

System-level operations:

```typescript
interface SystemAPI {
  // Open file in Finder
  showInFinder(path: string): Promise<void>;
  
  // Open file with default app
  openFile(path: string): Promise<void>;
  
  // Get app version
  version(): Promise<string>;
  
  // Get memory usage
  memoryUsage(): Promise<{
    rss: number;
    heap: number;
    external: number;
  }>;
  
  // Restart worker
  restartWorker(): Promise<void>;
}
```

## Worker Thread Messages

Communication protocol between main process and worker thread:

### Message Types

```typescript
type WorkerMessage = 
  | { type: 'init', payload: { dbPath: string } }
  | { type: 'index', payload: { folders: string[] } }
  | { type: 'search', payload: { query: string, id: string } }
  | { type: 'pause' }
  | { type: 'resume' }
  | { type: 'stats' }
  | { type: 'clear' };

type WorkerResponse =
  | { type: 'ready' }
  | { type: 'progress', payload: ProgressData }
  | { type: 'search-result', payload: { id: string, results: any[] } }
  | { type: 'error', payload: { message: string } }
  | { type: 'stats', payload: StatsData };
```

### Progress Updates

```typescript
interface ProgressData {
  phase: 'scanning' | 'indexing' | 'complete';
  current: number;
  total: number;
  file?: string;
  memoryUsage: {
    rss: number;
    heap: number;
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
  id: string;              // Unique chunk ID
  file_path: string;       // Absolute file path
  chunk_index: number;     // Position in document
  text: string;            // Chunk content
  embedding: number[];     // 384-dimensional vector
  metadata: {
    file_type: string;     // Extension
    modified_at: string;   // ISO timestamp
    file_size: number;     // Bytes
    parser_version: number;
  };
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
  file_hash: string;       // SHA-256 hash
  last_retry: string;      // Last retry attempt
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
      "rtf": true
    },
    "excludePatterns": [
      "node_modules",
      ".git",
      "*.app",
      "dist",
      "build",
      ".DS_Store"
    ],
    "indexHiddenFiles": false,
    "maxFileSize": 50,
    "chunkSize": 500,
    "chunkOverlap": 60,
    "embeddingBatchSize": 8
  },
  "ui": {
    "theme": "light",
    "searchDebounce": 300,
    "maxResults": 100
  }
}
```

### Parser Versions

Location: `src/main/worker/parserVersions.ts`

```typescript
export const PARSER_VERSIONS: Record<string, number> = {
  pdf: 1,    // pdf-parse
  doc: 2,    // word-extractor (v2)
  docx: 1,   // mammoth
  txt: 1,    // fs.readFile
  md: 1,     // fs.readFile
  rtf: 1     // custom stripper
};
```

## Environment Variables

Development environment variables:

```bash
# Enable debug logging
DEBUG=fss:*

# Force garbage collection (requires --expose-gc)
FORCE_GC=true

# Custom database path
DB_PATH=/custom/path/to/db

# Memory limits (MB)
WORKER_RSS_LIMIT=1500
EMBEDDER_RSS_LIMIT=900
EMBEDDER_EXTERNAL_LIMIT=300

# Processing limits
MAX_CONCURRENT_FILES=5
EMBEDDING_BATCH_SIZE=8
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
win.on('focus', updateTray);
win.on('blur', updateTray);
```

### Worker Events

```typescript
// File system events (Chokidar)
watcher.on('add', handleFileAdd);
watcher.on('change', handleFileChange);
watcher.on('unlink', handleFileRemove);
watcher.on('error', handleWatchError);

// Process events
embedder.on('message', handleEmbedderMessage);
embedder.on('error', handleEmbedderError);
embedder.on('exit', handleEmbedderExit);
```

## Error Codes

Standard error codes used throughout the application:

```typescript
enum ErrorCode {
  // File errors
  FILE_NOT_FOUND = 'E001',
  FILE_TOO_LARGE = 'E002',
  FILE_CORRUPTED = 'E003',
  FILE_ENCRYPTED = 'E004',
  
  // Parser errors
  PARSER_FAILED = 'E101',
  NO_TEXT_CONTENT = 'E102',
  UNSUPPORTED_FORMAT = 'E103',
  
  // Database errors
  DB_CONNECTION_FAILED = 'E201',
  DB_WRITE_FAILED = 'E202',
  DB_READ_FAILED = 'E203',
  
  // Memory errors
  MEMORY_LIMIT_EXCEEDED = 'E301',
  WORKER_CRASHED = 'E302',
  
  // System errors
  PERMISSION_DENIED = 'E401',
  DISK_FULL = 'E402'
}
```

## Testing Utilities

### Mock Data Generators

```typescript
// Generate test documents
function generateTestDoc(size: number): string;

// Generate test embeddings
function generateTestEmbedding(): number[];

// Generate file status
function generateFileStatus(status: string): FileStatus;
```

### Test Helpers

```typescript
// Wait for indexing to complete
async function waitForIndexing(timeout?: number): Promise<void>;

// Clear test database
async function clearTestDb(): Promise<void>;

// Create test files
async function createTestFiles(count: number): Promise<string[]>;
```

## Performance Benchmarks

### Target Metrics

| Operation | Target | Actual |
|-----------|--------|--------|
| File parsing (PDF) | <500ms | ~300ms |
| Embedding generation (8 chunks) | <200ms | ~150ms |
| Vector search (1000 docs) | <100ms | ~50ms |
| Memory per file | <10MB | ~5MB |
| Startup time | <3s | ~2s |

### Scalability Limits

| Resource | Soft Limit | Hard Limit |
|----------|-----------|------------|
| Indexed files | 100,000 | 1,000,000 |
| Database size | 10GB | 100GB |
| Concurrent searches | 10 | 100 |
| Memory usage | 1GB | 2GB |
| File size | 50MB | 500MB |

---

*Previous: [04-operations.md](./04-operations.md) | Next: [06-build-optimization.md](./06-build-optimization.md)*