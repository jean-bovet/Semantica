# Re-indexing Testing Refactor Plan

## Overview

This document outlines the plan to refactor the re-indexing functionality in the worker to make it testable, maintainable, and more reliable.

## Current Challenges

### 1. Tight Coupling
The worker functions are tightly coupled with:
- File system operations (`fs`)
- Database operations (`lancedb`)
- Worker thread communication (`parentPort`)
- Global state (`fileHashes`, `folderStats`, `fileQueue`)
- External services (embedder, parsers)

### 2. Side Effects
Functions like `reindexAll()` and `startWatching()` have multiple side effects making them hard to test in isolation.

### 3. Async Complexity
Multiple async operations happening in parallel with complex state management.

## Proposed Architecture

### Core Principles
1. **Separation of Concerns**: Separate business logic from I/O operations
2. **Dependency Injection**: Make dependencies explicit and replaceable
3. **Pure Functions**: Extract logic into pure, testable functions
4. **State Management**: Centralize state in manageable classes

## Implementation Phases

### Phase 1: Extract Core Logic (High Priority)

#### 1.1 ReindexOrchestrator Class
Create a class that contains the pure business logic for re-indexing decisions.

**Location**: `app/electron/worker/ReindexOrchestrator.ts`

```typescript
export interface ReindexDependencies {
  database: DatabaseInterface;
  fileStatusTable: FileStatusTableInterface;
  fileSystem: FileSystemInterface;
  configManager: ConfigManagerInterface;
  queue: QueueInterface;
}

export class ReindexOrchestrator {
  constructor(private deps: ReindexDependencies) {}
  
  // Pure logic for determining what needs re-indexing
  determineFilesToReindex(
    allFiles: string[],
    fileStatusCache: Map<string, FileStatus>,
    forceReindex: boolean
  ): {
    toIndex: string[];
    reasons: Map<string, string>;
  }
  
  // Calculate reindex statistics
  calculateReindexStats(
    files: string[],
    cache: Map<string, FileStatus>
  ): ReindexStats
  
  // Orchestration logic without I/O
  async planReindex(
    watchedFolders: string[],
    options: ReindexOptions
  ): Promise<ReindexPlan>
}
```

#### 1.2 FileScanner Class
Extract file scanning and categorization logic.

**Location**: `app/electron/worker/FileScanner.ts`

```typescript
export class FileScanner {
  // Pure function to determine if file should be indexed
  shouldIndexFile(
    filePath: string,
    fileRecord: FileStatus | null,
    forceReindex: boolean,
    fileStats?: FileStats
  ): { shouldIndex: boolean; reason: IndexReason }
  
  // Pure function to categorize files
  categorizeFiles(
    files: FileInfo[],
    statusCache: Map<string, FileStatus>,
    options: CategorizeOptions
  ): {
    new: string[];
    modified: string[];
    failed: string[];
    skipped: string[];
    outdated: string[];
  }
  
  // Filter files by type and bundle status
  filterSupportedFiles(
    paths: string[],
    config: ScanConfig
  ): string[]
}
```

#### 1.3 Unit Tests for Core Logic
Create comprehensive unit tests for the pure functions.

**Location**: `tests/unit/reindex-orchestrator.spec.ts`

```typescript
describe('ReindexOrchestrator', () => {
  describe('determineFilesToReindex', () => {
    it('should queue all files when forceReindex is true')
    it('should skip indexed files when forceReindex is false')
    it('should queue modified files based on hash')
    it('should queue files with outdated parser versions')
    it('should handle empty file lists')
  })
  
  describe('calculateReindexStats', () => {
    it('should count new files correctly')
    it('should identify modified files')
    it('should track skipped files')
  })
})
```

**Location**: `tests/unit/file-scanner.spec.ts`

```typescript
describe('FileScanner', () => {
  describe('shouldIndexFile', () => {
    it('should index new files')
    it('should skip already indexed files')
    it('should index modified files')
    it('should respect forceReindex flag')
    it('should skip files in bundles when configured')
  })
  
  describe('categorizeFiles', () => {
    it('should separate files by status')
    it('should handle empty cache')
    it('should identify parser upgrade candidates')
  })
})
```

### Phase 2: Create Testable Interfaces (Medium Priority)

#### 2.1 Database Abstraction

```typescript
interface DatabaseOperations {
  clearChunks(): Promise<void>;
  clearFileStatus(): Promise<void>;
  loadFileStatusCache(): Promise<Map<string, FileStatus>>;
  updateFileStatus(path: string, status: FileStatus): Promise<void>;
  deleteByPath(path: string): Promise<void>;
}

// Implementations:
class RealDatabase implements DatabaseOperations {
  // Uses actual LanceDB
}

class MockDatabase implements DatabaseOperations {
  // In-memory implementation for testing
}
```

#### 2.2 File System Abstraction

```typescript
interface FileSystemOperations {
  scanDirectory(path: string, options: ScanOptions): Promise<string[]>;
  getFileStats(path: string): Promise<FileStats>;
  fileExists(path: string): Promise<boolean>;
  getFileHash(path: string): string;
}

class RealFileSystem implements FileSystemOperations {
  // Uses Node.js fs module
}

class MockFileSystem implements FileSystemOperations {
  // In-memory file system for testing
}
```

#### 2.3 Integration Tests

**Location**: `tests/integration/reindex-flow.spec.ts`

```typescript
describe('Reindex Flow Integration', () => {
  let mockDb: MockDatabase;
  let mockFs: MockFileSystem;
  let orchestrator: ReindexOrchestrator;
  
  it('should clear database and queue all files on full reindex')
  it('should handle database clear failure gracefully')
  it('should report progress during reindex')
  it('should handle concurrent reindex requests')
})
```

### Phase 3: Dependency Injection (Low Priority)

#### 3.1 Worker Core Refactor

```typescript
class WorkerCore {
  private orchestrator: ReindexOrchestrator;
  private scanner: FileScanner;
  private state: WorkerState;
  
  constructor(
    private db: DatabaseOperations,
    private fs: FileSystemOperations,
    private queue: QueueInterface,
    private config: ConfigManagerInterface
  ) {
    this.orchestrator = new ReindexOrchestrator({ db, fs, queue, config });
    this.scanner = new FileScanner();
    this.state = new WorkerState();
  }
  
  async reindexAll(options: ReindexOptions = {}): Promise<void> {
    const plan = await this.orchestrator.planReindex(
      this.config.getWatchedFolders(),
      options
    );
    
    await this.executePlan(plan);
  }
  
  private async executePlan(plan: ReindexPlan): Promise<void> {
    // Execute the plan with proper error handling
  }
}
```

#### 3.2 State Management

```typescript
class WorkerState {
  private fileHashes = new Map<string, string>();
  private folderStats = new Map<string, FolderStats>();
  private processingFiles = new Set<string>();
  
  clearForReindex(): void {
    this.fileHashes.clear();
    this.folderStats.forEach(stats => stats.indexed = 0);
  }
  
  updateFileHash(path: string, hash: string): void {
    this.fileHashes.set(path, hash);
  }
  
  getSnapshot(): StateSnapshot {
    return {
      totalFiles: this.fileHashes.size,
      folderStats: Array.from(this.folderStats.entries()),
      processingCount: this.processingFiles.size
    };
  }
}
```

#### 3.3 End-to-End Tests

**Location**: `tests/e2e/reindex.spec.ts`

```typescript
describe('Reindex E2E', () => {
  let tempDir: string;
  let worker: Worker;
  
  beforeEach(async () => {
    tempDir = await createTempDirectory();
    await createTestFiles(tempDir, [
      'doc1.pdf',
      'doc2.txt',
      'nested/doc3.md'
    ]);
    worker = await createRealWorker(tempDir);
  });
  
  it('should reindex all files in watched folders')
  it('should handle file changes during reindex')
  it('should recover from embedder crash during reindex')
})
```

## Testing Scenarios

### Unit Test Coverage

1. **ReindexOrchestrator**
   - Force reindex flag behavior
   - File categorization logic
   - Stats calculation
   - Plan generation

2. **FileScanner**
   - File type filtering
   - Bundle detection
   - Modification detection
   - Parser version checking

### Integration Test Coverage

1. **Normal Reindex Flow**
   - Database cleared
   - Cache reloaded
   - All files queued
   - Progress reported

2. **Error Scenarios**
   - Database clear fails
   - File scanning fails
   - Queue overflow
   - Invalid file paths

3. **Concurrent Operations**
   - Reindex while indexing
   - Multiple reindex requests
   - File changes during reindex

4. **State Consistency**
   - Cache matches database
   - Stats accurate after reindex
   - No orphaned data

### E2E Test Coverage

1. **Full System Test**
   - Real files
   - Real database
   - Real embedder
   - Progress tracking

2. **Performance Tests**
   - Large folder reindex
   - Memory usage during reindex
   - Concurrent file processing

## Implementation Timeline

### Week 1: High Priority
- [ ] Create ReindexOrchestrator class
- [ ] Create FileScanner class  
- [ ] Write unit tests for both classes
- [ ] Integrate into existing worker without breaking changes

### Week 2: Medium Priority
- [ ] Create database abstraction
- [ ] Create file system abstraction
- [ ] Write integration tests
- [ ] Refactor worker to use abstractions

### Week 3: Low Priority
- [ ] Full dependency injection
- [ ] State management class
- [ ] E2E test suite
- [ ] Performance benchmarks

## Success Metrics

1. **Test Coverage**
   - Unit test coverage > 90% for core logic
   - Integration test coverage > 80%
   - E2E tests for critical paths

2. **Code Quality**
   - Reduced cyclomatic complexity
   - Clear separation of concerns
   - No direct I/O in business logic

3. **Maintainability**
   - New features can be tested in isolation
   - Bugs can be reproduced in tests
   - Refactoring is safe with test coverage

## Benefits

1. **Testability**: Pure functions can be tested without mocks
2. **Maintainability**: Clear separation of concerns
3. **Debuggability**: Each component can be tested in isolation
4. **Flexibility**: Easy to swap implementations
5. **Documentation**: Tests serve as behavior documentation
6. **Confidence**: Changes can be made safely with test coverage

## Risks and Mitigations

| Risk | Impact | Mitigation |
|------|--------|------------|
| Breaking existing functionality | High | Incremental refactoring, maintain backward compatibility |
| Over-engineering | Medium | Start with high-priority items, evaluate benefit |
| Test maintenance overhead | Low | Focus on behavior, not implementation details |
| Performance regression | Low | Benchmark before and after changes |

## Next Steps

1. Review and approve this plan
2. Create ReindexOrchestrator class (High Priority)
3. Create FileScanner class (High Priority)
4. Write comprehensive unit tests
5. Integrate with minimal changes to existing code
6. Measure test coverage and code quality improvements

## Appendix: Example Test Cases

### Example 1: Force Reindex Test
```typescript
it('should queue all files when forceReindex is true', () => {
  const files = ['file1.txt', 'file2.pdf', 'file3.md'];
  const cache = new Map([
    ['file1.txt', { status: 'indexed', hash: 'abc123' }],
    ['file2.pdf', { status: 'failed', hash: 'def456' }]
  ]);
  
  const orchestrator = new ReindexOrchestrator();
  const result = orchestrator.determineFilesToReindex(files, cache, true);
  
  expect(result.toIndex).toEqual(files);
  expect(result.reasons.get('file1.txt')).toBe('force-reindex');
});
```

### Example 2: Modified File Detection Test
```typescript
it('should detect modified files based on hash', () => {
  const scanner = new FileScanner();
  const fileRecord = {
    status: 'indexed',
    file_hash: 'old-hash',
    indexed_at: '2024-01-01T00:00:00Z'
  };
  
  const result = scanner.shouldIndexFile(
    '/path/to/file.txt',
    fileRecord,
    false,
    { hash: 'new-hash', mtime: new Date('2024-01-02') }
  );
  
  expect(result.shouldIndex).toBe(true);
  expect(result.reason).toBe('modified');
});
```

### Example 3: Integration Test
```typescript
it('should execute full reindex plan', async () => {
  const { worker, mocks } = createTestWorker({
    files: ['/test/file1.txt', '/test/file2.pdf'],
    initialData: { fileStatus: [] }
  });
  
  await worker.reindexAll({ force: true });
  
  expect(mocks.db.clearedChunks).toBe(true);
  expect(mocks.db.clearedFileStatus).toBe(true);
  expect(mocks.queue.getQueuedFiles()).toHaveLength(2);
});
```