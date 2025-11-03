# Technical Implementation Details

*Previous: [02-architecture.md](./02-architecture.md) | Next: [04-operations.md](./04-operations.md)*

---

## Memory Management

### Python Sidecar Architecture

The application uses a Python FastAPI sidecar for embeddings, providing complete process isolation and stable memory usage.

**Benefits:**
- **Stable Memory**: Python process manages its own memory independently
- **No Memory Leaks**: sentence-transformers library handles memory correctly
- **Process Isolation**: Embeddings run in separate Python process on port 8421
- **Typical Usage**: 400-600MB for embedding service, 1500MB limit for worker thread

**Recent Optimizations (August 2025):**
- **Intelligent Memory Logging**: Worker thread memory usage only logs when values change significantly (>10MB RSS, >5MB Heap, or file count changes), reducing console spam
- **Threshold-based Reporting**: Prevents redundant memory status messages during stable operation

> **Historical Note**: The application previously used Transformers.js/ONNX with child process isolation to manage memory leaks. For the complete evolution of the memory management solution, see [specs/archive/memory-solution.md](./archive/memory-solution.md) and [specs/python-sidecar-cleanup.md](./python-sidecar-cleanup.md).

## CPU-Aware Concurrency

### Overview
The indexing system automatically scales concurrent file processing based on available CPU cores, providing optimal performance across different hardware configurations.

### Implementation
Located in `src/main/worker/cpuConcurrency.ts`:

```typescript
export function calculateOptimalConcurrency(cpuCount?: number): {
  cpuCount: number;
  optimal: number;
  throttled: number;
}
```

### Concurrency Formula
- **Normal Operation**: `max(4, cores - 1)` - Uses all cores minus 1 for system responsiveness
- **Memory Throttled**: `max(2, floor(cores / 4))` - Reduces to 1/4 of cores when memory pressure detected
- **Minimum Thresholds**: Never below 4 concurrent (normal) or 2 concurrent (throttled)

### Performance Scaling

| CPU Cores | Normal Concurrency | Throttled | Improvement vs Fixed 5 |
|-----------|-------------------|-----------|------------------------|
| 4 cores   | 4 files          | 2 files   | -20%                   |
| 6 cores   | 5 files          | 2 files   | 0%                     |
| 8 cores   | 7 files          | 2 files   | +40%                   |
| 10 cores  | 9 files          | 2 files   | +80%                   |
| 12 cores  | 11 files         | 3 files   | +120%                  |
| 16 cores  | 15 files         | 4 files   | +200%                  |
| 32 cores  | 31 files         | 8 files   | +520%                  |

### Benefits
- **Zero Configuration**: Automatically detects and adapts to hardware
- **Scalable Performance**: Better utilization on powerful machines
- **System Responsiveness**: Reserves CPU headroom for other tasks
- **Dynamic Throttling**: Adjusts based on memory pressure

### Testing
Comprehensive unit tests in `tests/unit/cpu-concurrency.spec.ts` verify:
- Minimum threshold enforcement
- Scaling calculations for various core counts
- Throttling logic
- Edge cases (1-3 cores)

## Parser System

### File Parser Implementation

Each parser is responsible for extracting text content from specific file formats:

#### PDF Parser (v1)
- **Library**: pdf-parse
- **Limitations**: Text-based PDFs only, no OCR
- **Error Handling**: Detects scanned PDFs, marks as failed
```typescript
// src/main/parsers/pdf.ts
export async function parsePdf(filePath: string): Promise<string> {
  const dataBuffer = await fs.readFile(filePath);
  const data = await pdfParse(dataBuffer);
  if (!data.text || data.text.trim().length === 0) {
    throw new Error('PDF contains no extractable text');
  }
  return data.text;
}
```

#### DOC Parser (v2)
- **Version 1**: Failed RTF parsing attempt
- **Version 2**: Proper binary support with word-extractor
```typescript
// src/main/parsers/doc.ts
import WordExtractor from 'word-extractor';
const extractor = new WordExtractor();
export async function parseDoc(filePath: string): Promise<string> {
  const extracted = await extractor.extract(filePath);
  return extracted.getBody();
}
```

#### DOCX Parser (v1)
- **Library**: mammoth
- **Features**: Extracts text with structure preservation
```typescript
// src/main/parsers/docx.ts
export async function parseDocx(filePath: string): Promise<string> {
  const result = await mammoth.extractRawText({ path: filePath });
  return result.value;
}
```

#### Text/Markdown Parser (v3)
- **Version 1**: Basic UTF-8 only support
- **Version 2**: Initial multi-encoding attempt
- **Version 3**: Full multi-encoding support with automatic detection
- **Libraries**: chardet (detection), iconv-lite (conversion)
- **Supported Encodings**: UTF-8, UTF-16LE/BE, ISO-8859-x, Windows-125x, Mac Roman, ASCII
```typescript
// src/main/utils/encoding-detector.ts
export function detectEncoding(buffer: Buffer): string | null {
  // 1. Check for UTF-16 BOMs
  // 2. Heuristic detection for UTF-16 without BOM
  // 3. Use chardet for other encodings
  // 4. Special handling for Mac Roman
  return encoding;
}

// src/main/parsers/text.ts
export async function parseText(filePath: string): Promise<string> {
  const buffer = await fs.readFile(filePath);
  const encoding = detectEncoding(buffer);
  const content = decodeBuffer(buffer, encoding);
  // Strip markdown if .md file
  return processContent(content);
}
```

### Parser Version Tracking

#### Version Registry
Parser versions are defined as a single source of truth in each parser file and imported centrally:

```typescript
// Each parser exports its version
// src/main/parsers/text.ts
export const PARSER_VERSION = 3; // Multi-encoding support

// src/main/parsers/doc.ts  
export const PARSER_VERSION = 2; // Binary .doc support

// Central registry imports from parsers
// src/main/worker/parserVersions.ts
import { PARSER_VERSION as PDF_VERSION } from '../parsers/pdf';
import { PARSER_VERSION as DOC_VERSION } from '../parsers/doc';
import { PARSER_VERSION as TEXT_VERSION } from '../parsers/text';

export const PARSER_VERSIONS: Record<string, number> = {
  pdf: PDF_VERSION,   // Version 1: Initial pdf-parse
  doc: DOC_VERSION,   // Version 2: Binary .doc support
  docx: DOCX_VERSION, // Version 1: Mammoth implementation
  txt: TEXT_VERSION,  // Version 3: Multi-encoding support
  md: TEXT_VERSION,   // Version 3: Uses text parser
  rtf: RTF_VERSION    // Version 1: Basic RTF stripping
};
```

#### Automatic Re-indexing Logic
```typescript
export function shouldReindex(filePath: string, fileRecord?: FileStatus): boolean {
  const ext = path.extname(filePath).slice(1).toLowerCase();
  const currentVersion = PARSER_VERSIONS[ext];
  
  // No record = never indexed
  if (!fileRecord) return true;
  
  // File modified since last index
  const currentHash = getFileHash(filePath);
  if (fileRecord.file_hash !== currentHash) return true;
  
  // Parser upgraded
  if (!fileRecord.parser_version || fileRecord.parser_version < currentVersion) {
    console.log(`Parser upgraded for ${ext}: v${fileRecord.parser_version} -> v${currentVersion}`);
    return true;
  }
  
  // Failed files retry (24-hour window)
  if (fileRecord.status === 'failed' || fileRecord.status === 'error') {
    const lastRetry = fileRecord.last_retry ? new Date(fileRecord.last_retry) : new Date(0);
    const hoursSinceRetry = (Date.now() - lastRetry.getTime()) / (1000 * 60 * 60);
    if (hoursSinceRetry > 24) return true;
  }
  
  return false;
}
```

#### Startup Upgrade Check
The system automatically detects and queues files for re-indexing when parsers are upgraded:
```typescript
async function checkForParserUpgrades() {
  for (const [ext, currentVersion] of Object.entries(PARSER_VERSIONS)) {
    const outdatedFiles = await findOutdatedFiles(ext, currentVersion);
    if (outdatedFiles.length > 0) {
      // Queue for re-indexing with high priority
      for (const file of outdatedFiles) {
        await updateFileStatus(file.path, 'outdated');
        queue.unshift(file.path); // Add to front of queue
      }
    }
  }
}
```

## Text Processing Pipeline

### Chunking Strategy
Documents are split into manageable chunks for embedding:

```typescript
// src/main/pipeline/chunker.ts
export function chunkText(text: string): Chunk[] {
  const chunks: Chunk[] = [];
  const chunkSize = 500;  // characters
  const overlap = 60;     // characters
  
  for (let i = 0; i < text.length; i += chunkSize - overlap) {
    chunks.push({
      text: text.slice(i, i + chunkSize),
      start: i,
      end: Math.min(i + chunkSize, text.length)
    });
  }
  
  return chunks;
}
```

### Embedding Generation
Chunks are processed through the EmbeddingQueue with efficient batching:

```typescript
const embeddingQueue = new EmbeddingQueue({
  maxQueueSize: 2000,
  batchSize: 32,              // Chunks per batch
  backpressureThreshold: 1000
});

await embeddingQueue.addChunks(chunks, filePath, fileIndex);
```

**Batching Strategy**: The queue processes chunks in batches to maximize throughput. Embeddings are generated via HTTP POST to the Python sidecar (`http://127.0.0.1:8421/embed`), which handles the sentence-transformers model.

See `src/main/core/embedding/EmbeddingQueue.ts` for implementation details.

## Database Implementation

### Database Version Management
Database schema is versioned to handle migrations and model changes:

```typescript
// src/main/worker/database/migration.ts
const DB_VERSION = 5; // Current version

// Version history:
// Version 1: 384-dimensional vectors (Xenova multilingual-e5-small)
// Version 2: 1024-dimensional vectors (Ollama bge-m3 - deprecated)
// Version 3: 768-dimensional vectors (Ollama nomic-embed-text)
// Version 4: 768-dimensional vectors (Python sidecar - production)
// Version 5: Fixed cross-file contamination bug in batch processing
```

Version is tracked in `.db-version` file in the database directory. When a version mismatch is detected, `migrateDatabaseIfNeeded()` deletes all `.lance` tables and forces re-indexing.

### LanceDB Configuration
Vector database for semantic search:

```typescript
// src/main/worker/index.ts
const db = await lancedb.connect(dbPath);

// Chunks table schema
const chunksTable = await db.createTable('chunks', [
  {
    id: 'chunk_0',
    file_path: '/path/to/file',
    chunk_index: 0,
    text: 'chunk content',
    embedding: [0.1, 0.2, ...], // 768-dimensional vector (current)
    metadata: {
      file_type: 'pdf',
      modified_at: '2025-08-24T00:00:00Z'
    }
  }
]);
```

### File Status Tracking
Separate table for file indexing status (managed by `worker/fileStatus.ts`):

```typescript
interface FileStatus {
  path: string;
  status: 'indexed' | 'failed' | 'error' | 'queued' | 'outdated';
  parser_version: number;
  chunk_count: number;
  error_message: string;
  last_modified: string;
  indexed_at: string;
  file_hash: string;
  last_retry: string; // Empty string for LanceDB compatibility
}
```

File status operations are centralized in `src/main/worker/fileStatus.ts` with the `updateFileStatus()` function.

### Search Implementation
Vector similarity search with result aggregation (implemented in `worker/search.ts`):

```typescript
async function search(query: string, limit = 100): Promise<SearchResult[]> {
  // Generate query embedding
  const queryEmbedding = await embedder.embed([query]);
  
  // Vector search
  const results = await chunksTable
    .search(queryEmbedding[0])
    .limit(limit)
    .toArray();
  
  // Aggregate by file
  const fileResults = new Map<string, SearchResult>();
  for (const result of results) {
    const existing = fileResults.get(result.file_path);
    if (!existing || result._distance < existing.score) {
      fileResults.set(result.file_path, {
        path: result.file_path,
        score: result._distance,
        snippet: result.text,
        metadata: result.metadata
      });
    }
  }
  
  return Array.from(fileResults.values());
}
```

## File Watching & Indexing

### Chokidar Integration
Monitors file system changes:

```typescript
// src/main/worker/fileScanner.ts
const watcher = chokidar.watch(watchedFolders, {
  ignored: /(^|[\/\\])\../, // Hidden files
  persistent: true,
  ignoreInitial: false,
  awaitWriteFinish: {
    stabilityThreshold: 2000,
    pollInterval: 100
  }
});

watcher
  .on('add', path => queueFile(path))
  .on('change', path => queueFile(path))
  .on('unlink', path => removeFromIndex(path));
```

### Queue Management
Parallel processing with limits:

```typescript
class IndexingQueue {
  private queue: string[] = [];
  private processing = new Set<string>();
  private maxConcurrent = 5;
  
  async processQueue() {
    while (this.queue.length > 0 || this.processing.size > 0) {
      // Throttle if memory is high
      if (process.memoryUsage().rss > 800 * 1024 * 1024) {
        this.maxConcurrent = 2;
      } else {
        this.maxConcurrent = 5;
      }
      
      // Start new jobs up to limit
      while (this.processing.size < this.maxConcurrent && this.queue.length > 0) {
        const file = this.queue.shift()!;
        this.processing.add(file);
        this.processFile(file).finally(() => {
          this.processing.delete(file);
        });
      }
      
      await new Promise(resolve => setTimeout(resolve, 100));
    }
  }
}
```

## Build Configuration

### Electron Build Setup
The application uses esbuild for bundling the main, preload, and worker processes:

```javascript
// esbuild.build.mjs
const files = [
  'src/main/main.ts' → 'dist/main.cjs',
  'src/main/preload.ts' → 'dist/preload.cjs',
  'src/main/worker/index.ts' → 'dist/worker.cjs'
];

await esbuild.build({
  entryPoints: [input],
  bundle: true,
  platform: 'node',
  target: 'node18',
  format: 'cjs',
  outfile: output,
  external: [
    'electron',
    '@lancedb/lancedb',
    'apache-arrow',
    'sharp',
    'fsevents',
    'chokidar',
    'pdf-parse',
    'mammoth',
    'word-extractor'
  ]
});
```

**Note**: ML/embedding dependencies are handled by the external Python sidecar, not bundled in the Electron app.

## Configuration & Tuning

### Memory Parameters
```typescript
const MEMORY_CONFIG = {
  // Worker process limits
  WORKER_RSS_LIMIT: 1500,        // MB
  WORKER_THROTTLE_RSS: 800,      // MB - reduce parallelism

  // Processing parameters
  MAX_CONCURRENT_FILES: 5,        // CPU-aware (see cpuConcurrency.ts)
  EMBEDDING_BATCH_SIZE: 32,       // Chunks per batch
  CHUNK_SIZE: 500,                // characters
  CHUNK_OVERLAP: 60               // characters
};
```

**Python Sidecar Memory**: The Python embedding service manages its own memory independently (~400-600MB stable usage). No manual restart or memory management required from the Electron app.

### File Type Configuration
```json
{
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
    "dist"
  ]
}
```

## Testing Strategy

### Unit Tests
- Parser tests with sample documents
- Chunking algorithm tests
- Version detection logic tests
- Encoding detection tests (30+ test cases)

### Integration Tests
- End-to-end indexing flow
- Memory leak detection
- Parser upgrade scenarios
- Model download flow with mocks

### E2E Tests
- Application startup and initialization
- Model download progress indicators
- Search functionality
- Settings configuration
- **Sequential execution**: Tests run one at a time to avoid race conditions
- **Mock configuration**: E2E_MOCK_DOWNLOADS and E2E_MOCK_DELAYS for controlled testing

### Performance Tests
- Large file handling
- Concurrent indexing limits
- Memory stability over time

---

*Next: [04-operations.md](./04-operations.md) - Operations Guide*