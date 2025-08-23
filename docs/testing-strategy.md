# Testing Strategy and Performance Optimization

## Overview
The offline search application uses a multi-threaded architecture with ML models, database operations, and file system watching. This creates inherent challenges for test performance. This document outlines our testing strategy to balance speed and coverage.

## Test Performance Analysis

### Root Causes of Slow Tests
1. **Worker Thread Overhead** (~200-300ms per test)
   - New Node.js Worker thread creation
   - Full application code loading
   - LanceDB connection initialization

2. **Embedding Model Loading** (~300-500ms)
   - Transformers.js ONNX model loading
   - ~30MB model weights from disk

3. **File System Operations** (~100-200ms)
   - Chokidar watcher initialization
   - Polling setup overhead

4. **Database Operations** (~100-200ms)
   - Table and index creation
   - Persistence I/O

## Test Categories

### 1. Fast Unit Tests (~50ms each)
**Purpose**: Rapid feedback during development
**Scope**: Pure functions, no I/O or external dependencies
**Coverage**:
- Text chunking algorithms
- Score calculations
- Configuration management
- Path operations
- File type detection

**Location**: `tests/unit/fast-unit-tests.spec.ts`

### 2. Shared Worker Tests (~400ms total)
**Purpose**: Integration testing with reduced overhead
**Scope**: Multiple tests sharing single worker instance
**Coverage**:
- Basic worker operations
- Configuration persistence
- Search functionality
- Stats tracking

**Location**: `tests/unit/shared-worker.spec.ts`

### 3. Full Integration Tests (~600-2600ms each)
**Purpose**: Comprehensive system validation
**Scope**: Complete worker lifecycle per test
**Coverage**:
- File indexing
- Concurrent operations
- Error recovery
- Restart behavior

**Location**: `tests/unit/worker-*.spec.ts`

## Recommended Test Scripts

Add to `package.json`:

```json
{
  "scripts": {
    "test": "NODE_ENV=test vitest --run",
    "test:watch": "NODE_ENV=test vitest",
    "test:fast": "NODE_ENV=test vitest --run tests/unit/fast-unit-tests.spec.ts tests/unit/shared-worker.spec.ts",
    "test:integration": "NODE_ENV=test vitest --run tests/unit/worker-*.spec.ts tests/integration/*.spec.ts",
    "test:unit": "NODE_ENV=test vitest --run tests/unit/*.spec.ts",
    "test:ci": "NODE_ENV=test vitest --run --reporter=dot",
    "test:coverage": "NODE_ENV=test vitest --run --coverage"
  }
}
```

## Testing Best Practices

### 1. Use Event-Based Synchronization
```typescript
// ❌ Bad - Arbitrary timeout
await new Promise(resolve => setTimeout(resolve, 2000));

// ✅ Good - Wait for specific condition
await worker.waitForIndexing(expectedFileCount);
await worker.waitForProgress(p => p.processing === 0);
```

### 2. Share Workers When Possible
```typescript
// ❌ Bad - New worker per test
beforeEach(async () => {
  worker = new TestWorker();
  await worker.init(tempDir);
});

// ✅ Good - Shared worker for suite
beforeAll(async () => {
  worker = new TestWorker();
  await worker.init(tempDir);
});
```

### 3. Separate Fast and Slow Tests
```typescript
// Fast tests - no external dependencies
describe('Fast Unit Tests', () => {
  it('should calculate score', () => {
    expect(calculateScore(0)).toBe(1);
  });
});

// Slow tests - full integration
describe('Integration Tests', () => {
  it('should index files', async () => {
    await worker.init(tempDir);
    // ...
  });
});
```

### 4. Mock Heavy Dependencies
```typescript
// For non-ML tests, mock the embedding model
vi.mock('../../app/electron/embeddings/local', () => ({
  embed: vi.fn().mockResolvedValue([[0.1, 0.2, 0.3]])
}));
```

## CI/CD Pipeline Recommendations

### 1. Parallel Execution
```yaml
test:
  parallel:
    - name: Fast Tests
      script: npm run test:fast
      timeout: 2m
    - name: Integration Tests  
      script: npm run test:integration
      timeout: 10m
```

### 2. Fail Fast Strategy
- Run fast tests first
- Only run integration tests if fast tests pass
- Cache node_modules and model files

### 3. Test Selection
- PR checks: Run fast tests + changed file tests
- Main branch: Run all tests
- Release: Full test suite with coverage

## Performance Targets

| Test Type | Target Time | Maximum Time |
|-----------|-------------|--------------|
| Fast unit test | <100ms | 200ms |
| Shared worker suite | <500ms | 1s |
| Single integration test | <1s | 3s |
| Full test suite | <30s | 60s |

## Future Improvements

### 1. Model Caching
- Cache loaded embedding model across tests
- Share model weights in memory
- Implement model warm-up in test setup

### 2. In-Memory Database
- Use LanceDB in-memory mode for logic tests
- Persist only for integration tests
- Implement database snapshots

### 3. Parallel Test Execution
- Run independent test files in parallel
- Use Vitest's thread pool
- Separate by resource usage

### 4. Test Data Management
- Pre-generate test documents
- Create fixture snapshots
- Implement deterministic test data

## Monitoring Test Performance

### 1. Track Metrics
```typescript
// Add to test reporter
afterEach((context) => {
  console.log(`Test: ${context.task.name}`);
  console.log(`Duration: ${context.task.result?.duration}ms`);
});
```

### 2. Set Performance Budgets
```typescript
it('should complete within budget', async () => {
  const start = Date.now();
  await someOperation();
  expect(Date.now() - start).toBeLessThan(1000);
});
```

### 3. Regular Performance Audits
- Weekly review of slowest tests
- Identify optimization opportunities
- Track performance trends

## Troubleshooting Slow Tests

### Common Issues and Solutions

1. **fsevents crashes**
   - Solution: Use `NODE_ENV=test` to enable polling

2. **Model loading timeout**
   - Solution: Increase timeout or mock model

3. **Database conflicts**
   - Solution: Use unique temp directories

4. **File watcher delays**
   - Solution: Use event-based waiting, not timeouts

5. **Memory leaks**
   - Solution: Ensure proper cleanup in afterEach/afterAll

## Conclusion

The testing strategy balances comprehensive coverage with developer productivity. Fast unit tests provide rapid feedback during development, while integration tests ensure system reliability. By following these guidelines, we maintain test suite performance while ensuring quality.

### Key Metrics
- **Fast feedback loop**: <1s for unit tests
- **Comprehensive coverage**: >80% code coverage
- **Reliable CI/CD**: <5 min total pipeline time
- **Developer experience**: Clear test categories and purposes