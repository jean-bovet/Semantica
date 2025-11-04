# Testing Strategy

**Version:** 1.0
**Last Updated:** 2025-01-XX
**Status:** Active

---

## Overview

Semantica uses a **hybrid testing strategy** that balances speed and confidence:

- **Mocked Tests**: Fast unit tests using mocks (~7 seconds for 543 tests)
- **Real Database Tests**: Integration tests using actual LanceDB (~1.6 seconds overhead for 12 tests)

This approach provides both rapid feedback during development and high confidence in production behavior.

---

## Testing Philosophy

### Key Principles

1. **Speed for Development**: Fast feedback loop with mocked tests
2. **Confidence for Critical Paths**: Real database tests for schema validation, query behavior, and edge cases
3. **Validation in Mocks**: Mocks should enforce the same constraints as real systems
4. **Minimize Duplication**: Use production code in tests, avoid test-only implementations

### Why Hybrid?

**Pure Mocked Approach:**
- ✅ Fast execution (~7 seconds)
- ❌ Can miss schema validation errors
- ❌ May not catch database-specific bugs
- ❌ Risk of mock drift from real behavior

**Pure Real Database Approach:**
- ✅ High confidence in production behavior
- ✅ Catches schema and query errors
- ❌ Slower execution (setup/teardown overhead)
- ❌ More complex test infrastructure

**Hybrid Approach (Current):**
- ✅ Fast feedback with mocked tests
- ✅ Confidence with real database tests for critical paths
- ✅ Mocks validate required fields (catches common errors)
- ✅ Best of both worlds

---

## When to Use Each Approach

### Use Mocked Tests When:

- Testing business logic that doesn't depend on database specifics
- Validating function parameters and return values
- Testing error handling and edge cases
- Running tests frequently during development
- Testing isolated units (parsers, utilities, helpers)

**Example Use Cases:**
- Parser version comparison logic
- File hash calculation
- Retry timeout logic
- Configuration validation

### Use Real Database Tests When:

- Validating database schema compliance (required fields, types)
- Testing complex queries (filters, joins, aggregations)
- Verifying database-specific behavior (LanceDB query builder)
- Testing critical paths that must not fail in production
- Regression testing for bugs caused by database constraints

**Example Use Cases:**
- File status record insertion (schema validation)
- Query filtering and column selection
- Parser upgrade detection with real queries
- Migration logic with actual database state

---

## Testing Patterns

### Pattern 1: Mocked Unit Tests

**File**: `tests/unit/reindex-service.spec.ts`

```typescript
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ReindexService, FileStatus, QueryBuilder, FileStatusRepository } from '../../src/main/services/ReindexService';

describe('ReindexService (Mocked)', () => {
  let mockRepo: FileStatusRepository;
  let service: ReindexService;

  beforeEach(() => {
    const createQueryBuilder = (): QueryBuilder => {
      let filteredFiles = files;

      return {
        filter: (condition: string) => {
          // Simulate database filtering
          if (condition.includes('status = "indexed"')) {
            filteredFiles = files.filter(f => f.status === 'indexed');
          }
          return builder;
        },
        select: (columns: string[]) => builder,
        toArray: async () => filteredFiles
      };
    };

    mockRepo = {
      query: vi.fn(() => createQueryBuilder()),
      delete: vi.fn(),
      add: vi.fn((records: FileStatus[]) => {
        // IMPORTANT: Validate required fields like LanceDB does
        for (const record of records) {
          const requiredFields = ['path', 'status', 'error_message', 'last_modified', 'indexed_at', 'file_hash', 'last_retry'];
          for (const field of requiredFields) {
            if (record[field as keyof FileStatus] === undefined || record[field as keyof FileStatus] === null) {
              throw new Error(`Missing or null field: ${field}`);
            }
          }
        }
        return Promise.resolve();
      })
    };

    service = new ReindexService(mockRepo, { log: vi.fn(), error: vi.fn() });
  });

  it('should detect parser upgrades for outdated files', async () => {
    const result = await service.checkForParserUpgrades();
    expect(result.filesToReindex).toContain('/test/old.pdf');
  });
});
```

**Key Points:**
- Mock validates required fields (catches schema errors early)
- Fast execution (no disk I/O)
- Simulates database behavior (filtering, queries)
- Uses production code (ReindexService)

### Pattern 2: Real Database Tests

**File**: `tests/unit/reindex-service-with-db.spec.ts`

```typescript
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as path from 'node:path';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as lancedb from '@lancedb/lancedb';
import { ReindexService, FileStatus } from '../../src/main/services/ReindexService';

describe('ReindexService with Real LanceDB', () => {
  let tempDir: string;
  let db: any;
  let fileStatusTable: any;
  let service: ReindexService;

  beforeEach(async () => {
    // Create temporary directory for test database
    tempDir = path.join(os.tmpdir(), `reindex-test-db-${Date.now()}`);
    fs.mkdirSync(tempDir, { recursive: true });

    // Connect to LanceDB
    db = await lancedb.connect(tempDir);

    // Initialize file_status table with proper schema
    const dummyData: FileStatus[] = [{
      path: '__init__',
      status: 'init',
      error_message: '',
      chunk_count: 0,
      last_modified: new Date().toISOString(),
      indexed_at: new Date().toISOString(),
      file_hash: '',
      parser_version: 0,
      last_retry: ''
    }];

    fileStatusTable = await db.createTable('file_status', dummyData);

    // Clean up dummy record
    try {
      await fileStatusTable.delete('path = "__init__"');
    } catch (_e) {
      // Ignore - some versions don't support delete
    }

    // Create service instance
    service = new ReindexService(fileStatusTable, {
      log: () => {},
      error: () => {}
    });
  });

  afterEach(async () => {
    // Clean up temporary directory
    if (fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it('should accept complete FileStatus records', async () => {
    const completeRecord: FileStatus = {
      path: '/test/file.pdf',
      status: 'outdated',
      parser_version: 1,
      chunk_count: 0,
      error_message: 'Parser upgraded to v3',
      last_modified: '',
      indexed_at: '',
      file_hash: '',
      last_retry: ''
    };

    // Should not throw
    await fileStatusTable.add([completeRecord]);

    // Verify it was added
    const results = await fileStatusTable.query().toArray();
    expect(results).toHaveLength(1);
    expect(results[0].path).toBe('/test/file.pdf');
  });

  it('should reject incomplete records (missing fields)', async () => {
    const incompleteRecord = {
      path: '/test/file.pdf',
      status: 'outdated',
      parser_version: 1
      // Missing: chunk_count, error_message, etc.
    };

    // LanceDB should reject this with a validation error
    await expect(async () => {
      await fileStatusTable.add([incompleteRecord]);
    }).rejects.toThrow();
  });
});
```

**Key Points:**
- Uses actual LanceDB (temporary directory)
- Tests real schema validation
- Verifies query filtering and column selection
- Catches database-specific errors
- Cleanup with temp directory deletion

---

## Best Practices

### 1. Validate in Mocks

**Problem**: Mocks that accept any data can miss schema errors.

**Solution**: Implement field validation in mocks to match database behavior.

```typescript
// ❌ BAD: Mock accepts any data
add: vi.fn(() => Promise.resolve())

// ✅ GOOD: Mock validates required fields
add: vi.fn((records: FileStatus[]) => {
  for (const record of records) {
    const requiredFields = ['path', 'status', 'error_message', 'last_modified', 'indexed_at', 'file_hash', 'last_retry'];
    for (const field of requiredFields) {
      if (record[field as keyof FileStatus] === undefined || record[field as keyof FileStatus] === null) {
        throw new Error(`Missing or null field: ${field}`);
      }
    }
  }
  return Promise.resolve();
})
```

### 2. Use Production Code in Tests

**Problem**: Test-only implementations can diverge from production code.

**Solution**: Use actual service classes in tests with mocked dependencies.

```typescript
// ❌ BAD: Duplicate logic in test file
function shouldReindexForTest(file: string, record?: FileStatus): boolean {
  // Test-only implementation
}

// ✅ GOOD: Use production service
import { ReindexService } from '../../src/main/services/ReindexService';

const service = new ReindexService(mockRepo, { log: vi.fn(), error: vi.fn() });
const result = service.shouldReindex(file, record);
```

### 3. Temporary Directories for Real DB Tests

**Pattern**: Use temp directories with timestamps to avoid conflicts.

```typescript
beforeEach(async () => {
  tempDir = path.join(os.tmpdir(), `test-db-${Date.now()}`);
  fs.mkdirSync(tempDir, { recursive: true });
  db = await lancedb.connect(tempDir);
});

afterEach(async () => {
  if (fs.existsSync(tempDir)) {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});
```

### 4. Initialize Schema Properly

**Pattern**: Create dummy record to establish schema, then delete it.

```typescript
// Initialize table with proper schema
const dummyData: FileStatus[] = [{
  path: '__init__',
  status: 'init',
  error_message: '',
  chunk_count: 0,
  last_modified: new Date().toISOString(),
  indexed_at: new Date().toISOString(),
  file_hash: '',
  parser_version: 0,
  last_retry: ''
}];

fileStatusTable = await db.createTable('file_status', dummyData);

// Clean up dummy record
try {
  await fileStatusTable.delete('path = "__init__"');
} catch (_e) {
  // Ignore - some versions don't support delete
}
```

### 5. Test Critical Paths with Real Database

**Critical Paths to Test:**
- Schema validation (required fields, types)
- Query filtering (`filter()`, `select()`)
- Parser upgrade detection
- Migration logic
- Batch operations

**Example Test Cases:**
- ✅ Complete records accepted
- ✅ Incomplete records rejected
- ✅ Query filtering works correctly
- ✅ Column selection returns expected fields
- ✅ Upgrade detection finds outdated files

---

## Performance Considerations

### Test Execution Times

**Mocked Tests** (543 tests):
- Execution: ~7 seconds
- No disk I/O
- No database setup/teardown
- Fast feedback loop

**Real Database Tests** (12 tests):
- Setup overhead: ~0.8 seconds (temp dir + LanceDB connection)
- Execution: ~0.5 seconds
- Cleanup: ~0.3 seconds
- **Total overhead**: ~1.6 seconds

**Hybrid Approach** (555 total tests):
- Mocked: 543 tests in 7 seconds
- Real DB: 12 tests in 1.6 seconds
- **Total**: ~8.6 seconds (acceptable for CI/CD)

### When to Add Real Database Tests

Add real database tests when:
1. **Bug Found in Production**: Schema validation, query errors
2. **Critical Path Added**: New database operations
3. **Database Upgrade**: LanceDB version changes, schema changes
4. **Migration Logic**: Database version migrations

**Cost/Benefit Analysis:**
- Adding 10 real DB tests: +1-2 seconds overhead
- Benefit: Catches schema errors that would fail in production
- Decision: Worth it for critical paths

---

## Case Study: Incomplete Record Bug

### The Bug

**Symptom**: Production showed LanceDB errors: "Need at least 4 bytes in buffers[0]"

**Root Cause**: Code used `.select()` to fetch only 2-3 fields, then spread with `...file`, resulting in incomplete records:

```typescript
// ❌ BAD: Incomplete record
const files = await repo.query()
  .select(['path', 'parser_version'])
  .toArray();

for (const file of outdatedFiles) {
  await repo.add([{
    ...file,  // Only has path and parser_version
    status: 'outdated'
  }]);
}
```

**Why Mocks Didn't Catch It**: Mock accepted any data without validation.

### The Fix

**Step 1**: Fix production code to build complete records:

```typescript
// ✅ GOOD: Complete record
for (const file of outdatedFiles) {
  await repo.add([{
    path: file.path,
    status: 'outdated',
    parser_version: file.parser_version || 0,
    chunk_count: 0,
    error_message: `Parser upgraded to v${currentVersion}`,
    last_modified: '',
    indexed_at: '',
    file_hash: '',
    last_retry: ''
  }]);
}
```

**Step 2**: Add validation to mocks:

```typescript
add: vi.fn((records: FileStatus[]) => {
  for (const record of records) {
    const requiredFields = ['path', 'status', 'error_message', 'last_modified', 'indexed_at', 'file_hash', 'last_retry'];
    for (const field of requiredFields) {
      if (record[field as keyof FileStatus] === undefined || record[field as keyof FileStatus] === null) {
        throw new Error(`Missing or null field: ${field}`);
      }
    }
  }
})
```

**Step 3**: Add real database tests:

```typescript
it('should accept complete FileStatus records', async () => {
  const completeRecord: FileStatus = {
    path: '/test/file.pdf',
    status: 'outdated',
    parser_version: 1,
    chunk_count: 0,
    error_message: 'Parser upgraded to v3',
    last_modified: '',
    indexed_at: '',
    file_hash: '',
    last_retry: ''
  };

  // Should not throw
  await fileStatusTable.add([completeRecord]);
});

it('should reject incomplete records (missing fields)', async () => {
  const incompleteRecord = {
    path: '/test/file.pdf',
    status: 'outdated',
    parser_version: 1
  };

  // Should throw validation error
  await expect(async () => {
    await fileStatusTable.add([incompleteRecord]);
  }).rejects.toThrow();
});
```

### Lessons Learned

1. **Mocks must validate**: Add field validation to mocks to catch common errors
2. **Real DB for critical paths**: Schema validation is critical, test with real database
3. **Complete records**: Always construct complete FileStatus records (never spread partial data)
4. **Use production code**: Avoid test-only implementations that can diverge

---

## Test Organization

### Directory Structure

```
tests/
├── unit/                           # Fast mocked unit tests
│   ├── reindex-service.spec.ts     # Mocked ReindexService tests (543 tests)
│   ├── parser-version-tracking.spec.ts
│   └── ...
├── unit/                           # Real database unit tests
│   └── reindex-service-with-db.spec.ts  # Real LanceDB tests (12 tests)
├── integration/                    # Integration tests
│   ├── parser-upgrade.spec.ts      # Parser upgrade with mock repo
│   └── ...
└── e2e/                            # End-to-end tests
    ├── startup.spec.ts
    └── ...
```

### Naming Conventions

- `*.spec.ts`: Standard unit/integration tests
- `*-with-db.spec.ts`: Real database tests (temporary directories)
- `*.e2e.spec.ts`: End-to-end tests (full application)

### Test Categories

**Unit Tests (Mocked)**:
- Business logic validation
- Function parameter/return value testing
- Error handling
- Edge cases

**Unit Tests (Real Database)**:
- Schema validation
- Query behavior
- Database constraints
- Critical path regression tests

**Integration Tests**:
- Multi-component interactions
- Service layer integration
- Parser version upgrades
- Migration logic

**E2E Tests**:
- Full application flow
- Startup sequence
- User interactions
- UI components

---

## Running Tests

### Command Reference

```bash
# All unit tests (mocked + real DB)
npm test

# Unit tests only (mocked)
npm run test:unit

# Integration tests
npm run test:integration

# E2E tests
npm run test:e2e

# All tests (unit + integration + e2e)
npm run test:all

# Watch mode for development
npm run test:watch

# Coverage report
npm run test:coverage
```

### CI/CD Considerations

**Recommended Test Strategy for CI:**
1. Run mocked unit tests first (fast feedback)
2. Run real database tests (critical path validation)
3. Run integration tests (service layer)
4. Run E2E tests last (slowest, most comprehensive)

**Parallel Execution:**
- Mocked tests: Can run in parallel (no shared state)
- Real DB tests: Can run in parallel (unique temp directories)
- E2E tests: Should run sequentially (shared application state)

---

## Future Improvements

### Potential Enhancements

1. **Performance Benchmarks**: Add benchmark tests for critical operations
2. **Property-Based Testing**: Use fast-check for edge case generation
3. **Database Migration Tests**: More comprehensive migration testing with real DB
4. **Snapshot Testing**: For query results and data transformations
5. **Load Testing**: Stress test with large datasets (10K+ files)

### Out of Scope

- Full database mocking library (too complex, maintenance burden)
- In-memory LanceDB mode (not supported by LanceDB)
- Test data generators (manually crafted test data is clearer)

---

## References

- **Hybrid Testing Example**: `tests/unit/reindex-service-with-db.spec.ts`
- **Mocked Testing Example**: `tests/unit/reindex-service.spec.ts`
- **Integration Testing Example**: `tests/integration/parser-upgrade.spec.ts`
- **LanceDB Documentation**: https://lancedb.github.io/lancedb/
- **Vitest Documentation**: https://vitest.dev/

---

## Changelog

| Version | Date | Changes |
|---------|------|---------|
| 1.0 | 2025-01-XX | Initial testing strategy documentation |
