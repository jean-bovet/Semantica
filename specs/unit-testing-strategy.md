# Unit Testing Strategy for Worker Services

## Philosophy: Real Testing Over Mocking

Our testing strategy prioritizes **real implementations** over mocks wherever possible. This approach provides:

1. **Higher Confidence**: Tests reflect actual behavior, not mocked assumptions
2. **Better Coverage**: Edge cases and integration points are naturally tested
3. **Maintainability**: No mock maintenance when implementations change
4. **Documentation**: Tests serve as working examples of service usage

## Testing Patterns by Service

### 1. DatabaseService Testing

**Strategy**: Use real LanceDB with temporary directories

```typescript
describe('DatabaseService', () => {
  let service: DatabaseService;
  let tempDir: string;

  beforeEach(async () => {
    // Create temp directory for each test
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'db-test-'));
    service = new DatabaseService();
    await service.connect(tempDir);
  });

  afterEach(async () => {
    await service.disconnect();
    await fs.rm(tempDir, { recursive: true });
  });

  test('should store and retrieve chunks', async () => {
    const chunks = [{ id: 'test', text: 'hello', vector: [0.1, 0.2] }];
    await service.addChunks(chunks);
    const results = await service.queryFiles();
    expect(results).toHaveLength(1);
  });
});
```

**No Mocking Required**: Real database operations with isolated data

### 2. FileWatcherService Testing

**Strategy**: Use real file system with temporary directories

```typescript
describe('FileWatcherService', () => {
  let service: FileWatcherService;
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'watcher-test-'));
    service = new FileWatcherService();
  });

  test('should detect file additions', async (done) => {
    service.on('add', (filePath) => {
      expect(filePath).toContain('test.txt');
      done();
    });

    await service.start([tempDir]);
    
    // Create file after watcher starts
    setTimeout(() => {
      fs.writeFileSync(path.join(tempDir, 'test.txt'), 'content');
    }, 100);
  });
});
```

**No Mocking Required**: Real file system events with controlled timing

### 3. QueueService Testing

**Strategy**: Pure in-memory operations with injected callbacks

```typescript
describe('QueueService', () => {
  let service: QueueService;
  let processedFiles: string[] = [];

  beforeEach(() => {
    service = new QueueService();
    processedFiles = [];
    
    // Inject test callback
    service.setProcessCallback(async (file) => {
      processedFiles.push(file);
      // Simulate processing time
      await new Promise(resolve => setTimeout(resolve, 10));
    });
  });

  test('should process files in order', async () => {
    service.add(['file1.txt', 'file2.txt', 'file3.txt']);
    await service.process();
    
    expect(processedFiles).toEqual(['file1.txt', 'file2.txt', 'file3.txt']);
  });

  test('should handle concurrent processing', async () => {
    service.add(Array.from({ length: 10 }, (_, i) => `file${i}.txt`));
    await service.process();
    
    expect(processedFiles).toHaveLength(10);
    expect(service.getStats().done).toBe(10);
  });
});
```

**No Mocking Required**: Pure logic with test callbacks

### 4. ConfigService Testing

**Strategy**: Real ConfigManager with temporary config files

```typescript
describe('ConfigService', () => {
  let service: ConfigService;
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'config-test-'));
    service = new ConfigService();
    service.load(tempDir);
  });

  test('should persist settings changes', () => {
    const newSettings = { embeddingBatchSize: 64 };
    service.updateSettings(newSettings);
    
    // Create new service to verify persistence
    const service2 = new ConfigService();
    service2.load(tempDir);
    
    expect(service2.getSettings().embeddingBatchSize).toBe(64);
  });
});
```

**No Mocking Required**: Real file I/O with isolated configs

### 5. ModelService Testing

**Strategy**: Lightweight fake embedder for unit tests, real model for integration

```typescript
// Fake embedder for deterministic testing
class FakeEmbedderPool {
  async initialize() {}
  async embed(texts: string[]) {
    // Return deterministic embeddings based on text length
    return texts.map(t => Array(384).fill(t.length / 100));
  }
  getStats() {
    return [{ filesProcessed: 10, memoryUsage: 100, state: 'ready' }];
  }
  async restartAll() {}
  async dispose() {}
}

describe('ModelService', () => {
  let service: ModelService;

  beforeEach(async () => {
    service = new ModelService();
    // Inject fake embedder for unit tests
    service['embedderPool'] = new FakeEmbedderPool();
    service['modelReady'] = true;
  });

  test('should generate embeddings', async () => {
    const embeddings = await service.embed(['hello', 'world']);
    expect(embeddings).toHaveLength(2);
    expect(embeddings[0]).toHaveLength(384);
  });
});
```

**Minimal Mocking**: Only the ML model is faked for speed

### 6. WorkerCore Integration Testing

**Strategy**: Use real services with test data

```typescript
describe('WorkerCore Integration', () => {
  let worker: WorkerCore;
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'worker-test-'));
    worker = new WorkerCore();
    
    // Initialize with real services
    await worker.initialize(tempDir, tempDir);
  });

  test('should handle full indexing flow', async () => {
    // Create test files
    const testFile = path.join(tempDir, 'test.txt');
    fs.writeFileSync(testFile, 'test content');

    // Start watching
    await worker.handleMessage('watchStart', {
      roots: [tempDir],
      options: { settings: {} }
    });

    // Queue file
    await worker.handleMessage('enqueue', {
      paths: [testFile]
    });

    // Wait for processing
    await new Promise(resolve => setTimeout(resolve, 100));

    // Verify stats
    const stats = await worker.handleMessage('progress', {});
    expect(stats.done).toBeGreaterThan(0);
  });
});
```

**No Mocking Required**: Full integration with real services

## Test Utilities

### TempDirectory Helper

```typescript
export class TempDirectory {
  private dir: string;

  async create(prefix: string): Promise<string> {
    this.dir = await fs.mkdtemp(path.join(os.tmpdir(), prefix));
    return this.dir;
  }

  async cleanup(): Promise<void> {
    if (this.dir) {
      await fs.rm(this.dir, { recursive: true, force: true });
    }
  }
}
```

### TestDatabase Helper

```typescript
export class TestDatabase {
  private service: DatabaseService;
  private tempDir: TempDirectory;

  async setup(): Promise<DatabaseService> {
    this.tempDir = new TempDirectory();
    const dir = await this.tempDir.create('test-db-');
    
    this.service = new DatabaseService();
    await this.service.connect(dir);
    
    return this.service;
  }

  async teardown(): Promise<void> {
    await this.service.disconnect();
    await this.tempDir.cleanup();
  }
}
```

### AsyncEventWaiter Helper

```typescript
export function waitForEvent<T>(
  emitter: { on: Function },
  event: string,
  timeout = 1000
): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`Event ${event} timeout`));
    }, timeout);

    emitter.on(event, (data: T) => {
      clearTimeout(timer);
      resolve(data);
    });
  });
}
```

## Testing Principles

### 1. Isolation Through Data, Not Mocks
- Each test uses its own temp directory
- Tests run in parallel without interference
- Real I/O with isolated data

### 2. Time Control Without Mocking
- Use `setTimeout` for controlled timing
- Use event listeners for async operations
- Use promises for synchronization

### 3. Dependency Injection for Flexibility
- Services accept dependencies through constructors
- Test-specific implementations can be injected
- Production code remains unchanged

### 4. Fast Feedback Loop
- Unit tests run in milliseconds (in-memory)
- Integration tests run in seconds (real I/O)
- Full system tests run in minutes (real model)

## Test Organization

```
tests/
├── unit/
│   ├── services/
│   │   ├── database-service.spec.ts
│   │   ├── file-watcher-service.spec.ts
│   │   ├── queue-service.spec.ts
│   │   ├── config-service.spec.ts
│   │   └── model-service.spec.ts
│   └── worker-core.spec.ts
├── integration/
│   ├── indexing-flow.spec.ts
│   ├── search-flow.spec.ts
│   └── reindex-flow.spec.ts
├── helpers/
│   ├── temp-directory.ts
│   ├── test-database.ts
│   └── async-helpers.ts
└── fixtures/
    ├── test-documents/
    └── test-configs/
```

## Running Tests

```bash
# All unit tests (fast)
npm run test:unit

# Integration tests (slower)
npm run test:integration

# Specific service
npm run test:unit -- database-service

# With coverage
npm run test:coverage

# Watch mode for development
npm run test:watch
```

## Performance Targets

| Test Type | Target Time | Actual Time |
|-----------|------------|-------------|
| Unit Test Suite | < 5 seconds | TBD |
| Integration Suite | < 30 seconds | TBD |
| Single Unit Test | < 50ms | TBD |
| Single Integration Test | < 2 seconds | TBD |

## Benefits of This Approach

1. **Confidence**: Tests exercise real code paths
2. **Stability**: No brittle mocks to maintain
3. **Speed**: Still fast through data isolation
4. **Debugging**: Easier to debug real implementations
5. **Documentation**: Tests show actual usage patterns
6. **Refactoring**: Tests remain valid during refactoring

## When to Use Mocks

Mocks are only used when absolutely necessary:

1. **External APIs**: Network calls to third-party services
2. **ML Models**: Heavy models that take minutes to load
3. **System Resources**: Hardware-specific operations
4. **Time-Sensitive**: Operations requiring specific timestamps

## Conclusion

By prioritizing real implementations over mocks, our test suite provides high confidence while remaining maintainable. The service-oriented architecture makes this approach practical by providing clear boundaries and dependency injection points.