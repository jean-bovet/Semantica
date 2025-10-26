# Technical Implementation Details

*Previous: [02-architecture.md](./02-architecture.md) | Next: [04-operations.md](./04-operations.md)*

---

## Memory Management

### Recent Optimizations (August 2025)
- **Intelligent Memory Logging**: Memory usage now only logs when values change significantly (>10MB RSS, >5MB Heap, or file count changes), reducing console spam
- **Threshold-based Reporting**: Prevents redundant memory status messages during stable operation

## Memory Management

### Problem Background
The application initially experienced severe memory leaks (1.2GB+ after 20 files) due to the transformers.js library not properly releasing tensors and native memory buffers.

### Solution: Process Isolation

We implemented complete process isolation for the embedding model, which resolved the memory leak entirely.

#### Key Components

**1. Embedder Child Process**
A separate Node.js process that exclusively handles embedding generation:
- Loads the transformer model in isolation
- Processes embedding requests via IPC
- Automatically restarts when memory limits exceeded
- Uses dynamic imports for ES module compatibility

**2. Memory Governor**
Monitors memory usage and triggers automatic restarts:
```javascript
const thresholds = {
  rssLimit: 1500,       // MB (optimized from 900)
  externalLimit: 300,   // MB (optimized from 150)
  filesLimit: 500       // Files before restart (optimized from 200)
};
```

**3. Optimizations Applied**
- Reduced batch size from 32 to 8 items
- Added explicit tensor disposal
- Immediate array cleanup after processing
- Yield to event loop between batches
- Force garbage collection when available
- **CPU-aware parallel processing**: Scales with CPU cores (cores - 1, minimum 4)
- **Memory-based throttling**: Reduces to 1/4 of cores if RSS > 800MB

### Memory Performance Results

| Metric | Before | After | Improvement |
|--------|--------|-------|-------------|
| Memory after 20 files | 1,200MB | 273MB | 77% reduction |
| Memory growth rate | 50MB/file | ~0MB/file | Eliminated |
| Crash frequency | Every 20-30 files | Never | 100% stable |
| Log frequency | Every 2 seconds | On significant change | 90% reduction |
| Max files indexed | ~30 | Unlimited | ∞ |

### Real-time Monitoring
Memory logging shows stable operation:
```
Memory: RSS=273MB, Heap=17MB/31MB, External=5MB, Files processed: 100
Memory: RSS=274MB, Heap=18MB/32MB, External=5MB, Files processed: 200
Memory: RSS=273MB, Heap=17MB/31MB, External=5MB, Files processed: 300
```

> **Historical Note**: For the complete evolution of our memory management solution, including the initial problems and iterative improvements, see [specs/archive/memory-solution.md](./archive/memory-solution.md).

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
Chunks are processed through the EmbeddingQueue with dynamic token-based batching:

```typescript
// Dynamic batching based on token count (prevents Ollama EOF errors)
const embeddingQueue = new EmbeddingQueue({
  maxQueueSize: 2000,
  batchSize: 32,              // Maximum chunks per batch
  maxTokensPerBatch: 8000,    // Ollama limit: ~8-10K tokens per request
  backpressureThreshold: 1000
});

// Queue automatically calculates optimal batch size:
// - Small chunks (50 words): batches of ~60 chunks
// - Large chunks (500 words): batches of ~12 chunks
// - Always stays within Ollama's token limits

await embeddingQueue.addChunks(chunks, filePath, fileIndex);
```

**Token Estimation**: Uses heuristic of 1 token ≈ 4 characters to calculate batch sizes dynamically. This prevents HTTP 500 EOF errors when processing documents with large chunks while maximizing throughput for small chunks.

See `src/main/core/embedding/EmbeddingQueue.ts` for implementation details.

## Database Implementation

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
    embedding: [0.1, 0.2, ...], // 384-dimensional vector
    metadata: {
      file_type: 'pdf',
      modified_at: '2025-08-24T00:00:00Z'
    }
  }
]);
```

### File Status Tracking
Separate table for file indexing status:

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

### Search Implementation
Vector similarity search with result aggregation:

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
```javascript
// build.config.js
const files = [
  { input: 'src/main/main.ts', output: 'dist/main.cjs' },
  { input: 'src/main/preload.ts', output: 'dist/preload.cjs' },
  { input: 'src/main/worker/index.ts', output: 'dist/worker.cjs' },
  { input: 'src/main/worker/embedder.child.ts', output: 'dist/embedder.child.cjs' }
];

// Each file built with esbuild
await esbuild.build({
  entryPoints: [input],
  bundle: true,
  platform: 'node',
  target: 'node18',
  format: 'cjs',
  outfile: output,
  external: ['electron', '@xenova/transformers']
});
```

### ES Module Compatibility
Dynamic imports for ES-only modules:
```typescript
// Handles ERR_REQUIRE_ESM error
let transformers: any;
async function loadTransformers() {
  transformers = await import('@xenova/transformers');
}
```

## Configuration & Tuning

### Memory Parameters
```typescript
const MEMORY_CONFIG = {
  // Worker process limits
  WORKER_RSS_LIMIT: 1500,        // MB
  WORKER_THROTTLE_RSS: 800,      // MB - reduce parallelism

  // Embedder process limits
  EMBEDDER_RSS_LIMIT: 900,        // MB
  EMBEDDER_EXTERNAL_LIMIT: 300,   // MB
  EMBEDDER_FILES_LIMIT: 500,      // Files before restart

  // Processing parameters
  MAX_CONCURRENT_FILES: 5,
  EMBEDDING_BATCH_SIZE: 32,       // Maximum chunks per batch
  MAX_TOKENS_PER_BATCH: 8000,     // Ollama request limit (dynamic batching)
  CHUNK_SIZE: 500,                // characters
  CHUNK_OVERLAP: 60                // characters
};
```

**Note**: `EMBEDDING_BATCH_SIZE` is now a maximum limit. Actual batch size is calculated dynamically based on `MAX_TOKENS_PER_BATCH` to prevent Ollama EOF errors. Small chunks may batch up to 60, while large chunks may only batch 12.

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