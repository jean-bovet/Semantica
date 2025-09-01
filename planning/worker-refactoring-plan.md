# Worker Refactoring Plan

## Overview
The `src/main/worker/index.ts` file has grown to 1543 lines and handles multiple responsibilities. This plan outlines a refactoring strategy to break it down into smaller, testable, and maintainable components.

## Current Issues
- **File too large**: 1543 lines in a single file
- **Mixed responsibilities**: Database, file processing, queue management, watching, etc.
- **Hard to test**: Tightly coupled components make unit testing difficult
- **Difficult to maintain**: Finding specific functionality requires scrolling through large file

## Proposed Module Structure

```
src/main/worker/
├── index.ts                 (Main worker entry - thin orchestration layer ~200 lines)
├── database/
│   ├── DatabaseManager.ts   (LanceDB operations, table management)
│   ├── FileStatusManager.ts (File status tracking)
│   └── SearchService.ts     (Search functionality)
├── processing/
│   ├── FileProcessor.ts     (File parsing and chunking)
│   ├── ChunkingService.ts   (Text chunking logic)
│   └── EmbeddingService.ts  (Embedding generation wrapper)
├── queue/
│   ├── FileQueue.ts         (Already exists)
│   └── QueueProcessor.ts    (Queue processing logic)
├── scanning/
│   ├── FileScanner.ts       (Scan directories for files)
│   ├── FileWatcher.ts       (File system watching)
│   └── ReindexService.ts    (Already exists)
├── services/
│   ├── ModelManager.ts      (Model download/initialization)
│   └── WorkerMessageHandler.ts (Handle parent port messages)
└── utils/
    ├── FileHasher.ts        (File hash calculations)
    └── MemoryMonitor.ts     (Memory management utilities)
```

## Component Specifications

### 1. DatabaseManager (~200 lines)
**Responsibilities:**
- Initialize and manage LanceDB connection
- Create and manage vector table
- Handle database operations (merge, delete, optimize)

**Key Methods:**
```typescript
class DatabaseManager {
  private db: any;
  private tbl: any;
  
  async initialize(dbDir: string): Promise<void>
  async createTable(): Promise<void>
  async mergeRows(rows: any[]): Promise<void>
  async deleteByPath(path: string): Promise<void>
  async search(query: string, k: number): Promise<any[]>
  async getStats(): Promise<DbStats>
  async optimize(): Promise<void>
  async close(): Promise<void>
}
```

### 2. FileStatusManager (~150 lines)
**Responsibilities:**
- Track file indexing status
- Manage file status cache
- Handle status updates and queries

**Key Methods:**
```typescript
class FileStatusManager {
  private statusTable: any;
  private cache: Map<string, FileStatus>;
  
  async initialize(db: any): Promise<void>
  async updateStatus(path: string, status: string, error?: string): Promise<void>
  async getStatus(path: string): Promise<FileStatus>
  async getFailedFiles(): Promise<string[]>
  async loadCache(): Promise<void>
  async clearCache(): void
}
```

### 3. FileProcessor (~300 lines)
**Responsibilities:**
- Parse files using appropriate parser
- Create text chunks
- Generate embeddings
- Save to database

**Key Methods:**
```typescript
class FileProcessor {
  constructor(
    private chunkingService: ChunkingService,
    private embeddingService: EmbeddingService,
    private databaseManager: DatabaseManager,
    private fileStatusManager: FileStatusManager
  ) {}
  
  async processFile(filePath: string): Promise<void>
  private async parseFile(filePath: string): Promise<string>
  private async createChunks(text: string): Promise<Chunk[]>
  private async generateEmbeddings(chunks: Chunk[]): Promise<number[][]>
  private async saveToDatabase(filePath: string, chunks: Chunk[], vectors: number[][]): Promise<void>
}
```

### 4. ChunkingService (~100 lines)
**Responsibilities:**
- Split text into chunks
- Handle overlap between chunks
- Clean and normalize text

**Key Methods:**
```typescript
class ChunkingService {
  chunkText(text: string, options?: ChunkOptions): Chunk[]
  private cleanText(text: string): string
  private calculateOverlap(chunkSize: number): number
}
```

### 5. FileScanner (~200 lines)
**Responsibilities:**
- Scan directories for files
- Determine which files need processing
- Check file modifications

**Key Methods:**
```typescript
class FileScanner {
  constructor(
    private fileStatusManager: FileStatusManager,
    private reindexService: ReindexService,
    private configManager: ConfigManager
  ) {}
  
  async scanFolders(folders: string[]): Promise<ScanResult>
  private async findFiles(folder: string): Promise<string[]>
  private shouldProcessFile(path: string): Promise<boolean>
  private isFileModified(path: string, status: FileStatus): boolean
  private isInsideBundle(path: string): boolean
}
```

### 6. ModelManager (~150 lines)
**Responsibilities:**
- Check if ML model exists
- Download model if needed
- Initialize embedder pool
- Track model readiness

**Key Methods:**
```typescript
class ModelManager {
  private modelReady: boolean = false;
  private embedderPool: EmbedderPool | null = null;
  
  async checkModel(userDataPath: string): Promise<boolean>
  async downloadModel(userDataPath: string): Promise<void>
  async initialize(userDataPath: string, poolSize: number): Promise<void>
  getEmbedderPool(): EmbedderPool
  isReady(): boolean
}
```

### 7. WorkerMessageHandler (~200 lines)
**Responsibilities:**
- Handle messages from parent thread
- Route messages to appropriate services
- Send responses back to parent

**Key Methods:**
```typescript
class WorkerMessageHandler {
  constructor(
    private services: {
      database: DatabaseManager,
      scanner: FileScanner,
      queue: QueueProcessor,
      model: ModelManager,
      fileStatus: FileStatusManager,
      search: SearchService
    }
  ) {}
  
  async handleMessage(msg: any): Promise<void>
  private async handleInit(msg: any): Promise<void>
  private async handleSearch(msg: any): Promise<void>
  private async handleReindex(msg: any): Promise<void>
  private async handleWatch(msg: any): Promise<void>
  private async handlePause(msg: any): Promise<void>
  private async handleStop(msg: any): Promise<void>
}
```

### 8. QueueProcessor (~150 lines)
**Responsibilities:**
- Process file queue
- Manage concurrency
- Handle memory-based throttling

**Key Methods:**
```typescript
class QueueProcessor {
  constructor(
    private fileQueue: FileQueue,
    private fileProcessor: FileProcessor,
    private configManager: ConfigManager
  ) {}
  
  async start(): Promise<void>
  async stop(): Promise<void>
  async pause(): Promise<void>
  async resume(): Promise<void>
  private async processNextFile(): Promise<void>
  private getMaxConcurrency(): number
  private shouldThrottle(): boolean
}
```

### 9. SearchService (~100 lines)
**Responsibilities:**
- Handle search queries
- Generate query embeddings
- Format search results

**Key Methods:**
```typescript
class SearchService {
  constructor(
    private databaseManager: DatabaseManager,
    private modelManager: ModelManager
  ) {}
  
  async search(query: string, k: number): Promise<SearchResult[]>
  private async generateQueryEmbedding(query: string): Promise<number[]>
  private formatResults(results: any[]): SearchResult[]
}
```

## Benefits

### 1. Testability
- Each class has a single responsibility
- Dependencies can be easily mocked
- Unit tests can focus on specific functionality
- Integration tests can compose multiple components

### 2. Maintainability
- Clear separation of concerns
- Easier to locate specific functionality
- Reduced merge conflicts in team development
- Better code organization

### 3. Reusability
- Components can be reused in other contexts
- Clear interfaces between modules
- Potential for sharing code between main and renderer processes

### 4. Type Safety
- Better TypeScript interfaces
- Clearer contracts between modules
- Reduced use of `any` types

## Migration Strategy

### Phase 1: Extract Utilities (Low Risk)
**Timeline: 1 hour**
- Extract FileHasher utility
- Extract MemoryMonitor utility
- Extract ChunkingService
- Create unit tests for each

### Phase 2: Extract Services (Low Risk)
**Timeline: 1 hour**
- Extract ModelManager
- Extract SearchService
- Update imports and references
- Create unit tests

### Phase 3: Extract Database Layer (Medium Risk)
**Timeline: 2 hours**
- Extract DatabaseManager
- Extract FileStatusManager
- Ensure transaction handling is preserved
- Create integration tests

### Phase 4: Extract Processing Logic (Medium Risk)
**Timeline: 2 hours**
- Extract FileProcessor
- Extract EmbeddingService wrapper
- Extract QueueProcessor
- Maintain performance profiling hooks

### Phase 5: Extract Scanning/Watching (Medium Risk)
**Timeline: 1 hour**
- Extract FileScanner
- Integrate with existing FileWatcher
- Preserve file filtering logic

### Phase 6: Final Integration (Low Risk)
**Timeline: 1 hour**
- Create WorkerMessageHandler
- Refactor index.ts to orchestration layer
- Wire all components together
- Run full integration tests

**Total Estimated Time: 8 hours**

## Testing Strategy

### Unit Tests Structure
```
src/main/worker/__tests__/
├── database/
│   ├── DatabaseManager.spec.ts
│   ├── FileStatusManager.spec.ts
│   └── SearchService.spec.ts
├── processing/
│   ├── FileProcessor.spec.ts
│   ├── ChunkingService.spec.ts
│   └── EmbeddingService.spec.ts
├── scanning/
│   ├── FileScanner.spec.ts
│   └── FileWatcher.spec.ts
├── services/
│   ├── ModelManager.spec.ts
│   └── WorkerMessageHandler.spec.ts
├── queue/
│   └── QueueProcessor.spec.ts
└── utils/
    ├── FileHasher.spec.ts
    └── MemoryMonitor.spec.ts
```

### Testing Approach
1. **Unit Tests**: Test each component in isolation with mocked dependencies
2. **Integration Tests**: Test component interactions
3. **E2E Tests**: Test full worker functionality through message passing
4. **Performance Tests**: Ensure refactoring doesn't degrade performance

## Risk Assessment

### Low Risk Components
- Utilities (FileHasher, MemoryMonitor)
- ChunkingService
- SearchService

### Medium Risk Components
- DatabaseManager (transaction handling)
- FileProcessor (error handling)
- QueueProcessor (concurrency management)

### Mitigation Strategies
1. **Incremental refactoring**: One component at a time
2. **Comprehensive testing**: Write tests before refactoring
3. **Feature flags**: Ability to toggle between old and new implementation
4. **Performance monitoring**: Track metrics before and after
5. **Rollback plan**: Git branches for each phase

## Success Metrics

### Code Quality
- [ ] Reduced file size: No file > 400 lines
- [ ] Increased test coverage: > 85%
- [ ] Reduced cyclomatic complexity
- [ ] Better TypeScript typing

### Performance
- [ ] No degradation in indexing speed
- [ ] Memory usage remains stable
- [ ] Search performance unchanged

### Maintainability
- [ ] Faster feature development
- [ ] Easier debugging
- [ ] Clearer code documentation
- [ ] Reduced time to onboard new developers

## Next Steps

1. **Review and approve plan**
2. **Create feature branch**: `refactor/worker-modularization`
3. **Start with Phase 1**: Extract utilities
4. **Incremental PRs**: One phase per PR
5. **Monitor metrics**: Track performance and stability

## Notes

- The existing FileQueue and ReindexService can remain as-is
- Performance profiling should be preserved through dependency injection
- Configuration management should remain centralized
- Worker message protocol should not change (backward compatibility)