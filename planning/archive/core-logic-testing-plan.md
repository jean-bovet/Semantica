# Core Business Logic Testing Plan

## Executive Summary
A pragmatic approach to testing the critical business logic currently at 0% coverage. This plan balances real implementations with strategic mocking to achieve fast, maintainable tests that catch real issues.

## Testing Philosophy

### Core Principles
1. **Test OUR code, not libraries** - Focus on our integration and error handling
2. **Real when fast (<50ms)** - Use real dependencies when they're quick
3. **Mock when slow (>50ms)** - Mock models, network, heavy I/O
4. **Small fixtures** - Tiny test files checked into git
5. **Error paths matter** - Test failures, not just success cases

### The Balance
- **Real**: Parsers, LanceDB, chunking
- **Mock**: Embedding model, child processes, file watching
- **Hybrid**: Integration tests with selective mocking

---

## 1. Document Parsers Testing

### Strategy
Use **real parsers** with **tiny fixture files** to test actual parsing without complexity.

### What We Test
✅ **Our Logic:**
- Correct parser selection based on file extension
- Text extraction and normalization
- Error handling for corrupt/missing files
- Empty file handling
- Multi-page document handling (PDF)

❌ **What We Skip:**
- Library internals (PDF.js, Mammoth)
- Complex formatting edge cases
- Large file performance

### Implementation

```typescript
// tests/unit/parsers.spec.ts

describe('Document Parsers', () => {
  describe('PDF Parser', () => {
    it('should extract text from simple PDF', async () => {
      const text = await parsePdf('fixtures/simple.pdf');
      expect(text).toContain('This is a test PDF');
      expect(text.length).toBeGreaterThan(0);
    });

    it('should handle corrupt PDF gracefully', async () => {
      const text = await parsePdf('fixtures/corrupt.pdf');
      expect(text).toBe(''); // Returns empty, doesn't crash
    });

    it('should extract page information', async () => {
      const pages = await parsePdfWithPages('fixtures/multipage.pdf');
      expect(pages).toHaveLength(3);
      expect(pages[0].page).toBe(1);
      expect(pages[0].text).toContain('Page 1 content');
    });
  });

  describe('DOCX Parser', () => {
    it('should extract text from Word document', async () => {
      const text = await parseDocx('fixtures/simple.docx');
      expect(text).toContain('This is a Word document');
    });

    it('should handle tables in DOCX', async () => {
      const text = await parseDocx('fixtures/with-table.docx');
      expect(text).toContain('Cell 1');
      expect(text).toContain('Cell 2');
    });
  });

  describe('RTF Parser', () => {
    it('should extract text from RTF', async () => {
      const text = await parseRtf('fixtures/simple.rtf');
      expect(text).toContain('Rich text content');
    });
  });

  describe('Text Parser', () => {
    it('should read UTF-8 text files', async () => {
      const text = await parseText('fixtures/utf8.txt');
      expect(text).toContain('Hello 世界');
    });

    it('should handle large text files', async () => {
      const text = await parseText('fixtures/large.txt'); // 10KB
      expect(text.length).toBeGreaterThan(10000);
    });
  });
});
```

### Fixtures Required
```
tests/fixtures/
├── simple.pdf (1 page, ~2KB)
├── multipage.pdf (3 pages, ~5KB)
├── corrupt.pdf (invalid PDF, ~1KB)
├── simple.docx (~2KB)
├── with-table.docx (~3KB)
├── simple.rtf (~1KB)
├── utf8.txt (~1KB)
└── large.txt (~10KB)

Total: ~25KB of test files
```

### Effort: 4 hours
- 2 hours: Create minimal fixture files
- 1 hour: Write parser tests
- 1 hour: Handle edge cases

---

## 2. Database Operations Testing

### Strategy
Use **real LanceDB** with **in-memory tables** for fast, accurate testing.

### What We Test
✅ **Our Logic:**
- Table creation and schema
- Chunk insertion with metadata
- Vector similarity search
- Duplicate detection
- Old chunk cleanup
- Query building
- Result transformation

❌ **What We Skip:**
- LanceDB internals
- Disk I/O performance
- Index optimization timing

### Implementation

```typescript
// tests/unit/database-operations.spec.ts

import * as lancedb from '@lancedb/lancedb';

describe('Database Operations', () => {
  let db: any;
  let table: any;
  
  beforeEach(async () => {
    // In-memory database - no disk I/O
    db = await lancedb.connect(':memory:');
    
    // Create test table with schema
    table = await db.createTable('chunks', [
      { 
        id: 'seed1',
        text: 'initial content',
        vector: new Array(384).fill(0.1),
        path: '/test.txt',
        page: 0,
        offset: 0
      }
    ]);
  });

  describe('Chunk Storage', () => {
    it('should insert chunks with metadata', async () => {
      const chunks = [
        {
          id: 'chunk1',
          text: 'First chunk text',
          vector: new Array(384).fill(0.2),
          path: '/doc.pdf',
          page: 1,
          offset: 0
        },
        {
          id: 'chunk2',
          text: 'Second chunk text',
          vector: new Array(384).fill(0.3),
          path: '/doc.pdf',
          page: 1,
          offset: 500
        }
      ];
      
      await table.add(chunks);
      const count = await table.countRows();
      expect(count).toBe(3); // 1 seed + 2 new
    });

    it('should prevent duplicate chunks', async () => {
      const chunk = {
        id: 'unique-id',
        text: 'Some text',
        vector: new Array(384).fill(0.1),
        path: '/doc.txt'
      };
      
      await table.add([chunk]);
      await table.add([chunk]); // Try to add again
      
      const results = await table.search()
        .where("id = 'unique-id'")
        .execute();
      
      expect(results).toHaveLength(1); // Only one instance
    });
  });

  describe('Vector Search', () => {
    it('should find similar chunks', async () => {
      // Add test data
      await table.add([
        {
          id: 'similar',
          text: 'Machine learning is fascinating',
          vector: new Array(384).fill(0.5),
          path: '/ml.pdf'
        },
        {
          id: 'different',
          text: 'Cooking recipes for dinner',
          vector: new Array(384).fill(0.9),
          path: '/recipes.txt'
        }
      ]);
      
      // Search with similar vector
      const queryVector = new Array(384).fill(0.48);
      const results = await table
        .search(queryVector)
        .limit(2)
        .execute();
      
      expect(results[0].id).toBe('similar');
      expect(results[0]._distance).toBeLessThan(0.5);
    });

    it('should group results by file', async () => {
      // Add chunks from same file
      await table.add([
        {
          id: 'doc1-chunk1',
          text: 'Chapter 1',
          vector: new Array(384).fill(0.3),
          path: '/book.pdf',
          page: 1
        },
        {
          id: 'doc1-chunk2',
          text: 'Chapter 2',
          vector: new Array(384).fill(0.31),
          path: '/book.pdf',
          page: 5
        }
      ]);
      
      const results = await table
        .search(new Array(384).fill(0.3))
        .where("path = '/book.pdf'")
        .execute();
      
      expect(results).toHaveLength(2);
      expect(results[0].path).toBe(results[1].path);
    });
  });

  describe('Cleanup Operations', () => {
    it('should remove old chunks on re-index', async () => {
      // Add original chunks
      await table.add([
        { id: 'old1', text: 'Old content', vector: new Array(384).fill(0.1), path: '/doc.txt' }
      ]);
      
      // Delete old and add new
      await table.delete("path = '/doc.txt'");
      await table.add([
        { id: 'new1', text: 'New content', vector: new Array(384).fill(0.2), path: '/doc.txt' }
      ]);
      
      const results = await table.search()
        .where("path = '/doc.txt'")
        .execute();
      
      expect(results).toHaveLength(1);
      expect(results[0].id).toBe('new1');
    });
  });
});
```

### Why Real LanceDB?
- **Fast**: In-memory operations <10ms
- **Accurate**: Tests real vector math
- **Simple**: No mocking complexity
- **Reliable**: Catches actual query errors

### Effort: 3 hours
- 1 hour: Setup in-memory database
- 1 hour: Write CRUD operations tests
- 1 hour: Write search and cleanup tests

---

## 3. Embeddings Orchestration Testing

### Strategy
**Mock the child process** but **test the coordination logic**.

### What We Test
✅ **Our Orchestration:**
- Text batching (splitting large arrays)
- Process lifecycle management
- Memory threshold monitoring
- IPC message handling
- Error recovery and retries
- Queue management
- Process restart logic

❌ **What We Mock:**
- Transformers.js model loading
- Actual vector generation
- Child process internals

### Implementation

```typescript
// tests/unit/embeddings-orchestration.spec.ts

describe('Embeddings Orchestration', () => {
  let mockChild: any;
  let originalFork: any;
  
  beforeEach(() => {
    mockChild = {
      send: vi.fn(),
      on: vi.fn(),
      once: vi.fn(),
      kill: vi.fn(),
      killed: false,
      connected: true
    };
    
    // Mock child_process.fork
    originalFork = (await import('child_process')).fork;
    (await import('child_process')).fork = vi.fn(() => mockChild);
  });

  afterEach(() => {
    (await import('child_process')).fork = originalFork;
  });

  describe('Batching', () => {
    it('should batch large text arrays', async () => {
      const embedder = new IsolatedEmbedder();
      const texts = Array(25).fill('test text');
      
      // Mock responses for each batch
      let batchCount = 0;
      mockChild.send.mockImplementation((msg) => {
        if (msg.type === 'embed') {
          batchCount++;
          // Simulate response
          setTimeout(() => {
            mockChild.on.mock.calls
              .find(([event]) => event === 'message')?.[1]({
                type: 'result',
                id: msg.id,
                vectors: Array(msg.texts.length).fill(new Array(384).fill(0.1))
              });
          }, 10);
        }
      });
      
      await embedder.embed(texts);
      
      // Should send 4 batches (8, 8, 8, 1)
      expect(batchCount).toBe(4);
    });

    it('should handle single large text', async () => {
      const embedder = new IsolatedEmbedder();
      const largeText = 'x'.repeat(10000); // Very long text
      
      await embedder.embed([largeText]);
      
      expect(mockChild.send).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'embed',
          texts: [largeText]
        })
      );
    });
  });

  describe('Memory Management', () => {
    it('should restart when memory exceeds threshold', async () => {
      const embedder = new IsolatedEmbedder();
      
      // Simulate high memory
      (embedder as any).filesSinceSpawn = 501; // Over 500 limit
      
      const shouldRestart = await embedder.checkMemoryAndRestart();
      
      expect(shouldRestart).toBe(true);
      expect(mockChild.kill).toHaveBeenCalled();
    });

    it('should not restart with pending requests', async () => {
      const embedder = new IsolatedEmbedder();
      
      // Add inflight request
      (embedder as any).inflight.set('req1', {});
      (embedder as any).filesSinceSpawn = 501;
      
      const shouldRestart = await embedder.checkMemoryAndRestart();
      
      expect(shouldRestart).toBe(false);
      expect(mockChild.kill).not.toHaveBeenCalled();
    });
  });

  describe('Error Handling', () => {
    it('should handle child process crash', async () => {
      const embedder = new IsolatedEmbedder();
      
      // Simulate crash
      mockChild.on.mockImplementation((event, handler) => {
        if (event === 'exit') {
          setTimeout(() => handler(1), 10);
        }
      });
      
      // Should reject pending requests
      const promise = embedder.embed(['test']);
      
      await expect(promise).rejects.toThrow();
    });

    it('should timeout stuck requests', async () => {
      const embedder = new IsolatedEmbedder();
      
      // Don't send response
      mockChild.send.mockImplementation(() => {});
      
      const promise = embedder.embed(['test']);
      
      await expect(promise).rejects.toThrow('Embedding timeout');
    });
  });
});
```

### Effort: 3 hours
- 1 hour: Mock child process setup
- 1 hour: Test batching and lifecycle
- 1 hour: Test error scenarios

---

## 4. Integration Pipeline Test

### Strategy
One **real end-to-end test** with selective mocking.

### Implementation

```typescript
// tests/integration/pipeline.spec.ts

describe('Document Pipeline Integration', () => {
  let db: any;
  
  beforeEach(async () => {
    db = await lancedb.connect(':memory:');
  });

  it('should process document end-to-end', async () => {
    // 1. Real parser
    const text = await parseText('fixtures/sample.txt');
    expect(text).toContain('sample content');
    
    // 2. Real chunker
    const chunks = chunkText(text, 500, 60);
    expect(chunks.length).toBeGreaterThan(0);
    
    // 3. Mock embeddings (deterministic)
    const vectors = chunks.map((c, i) => {
      // Deterministic vector based on text
      const seed = c.text.charCodeAt(0) / 255;
      return new Array(384).fill(seed);
    });
    
    // 4. Real database operations
    const table = await db.createTable('chunks', 
      chunks.map((c, i) => ({
        id: `chunk${i}`,
        text: c.text,
        vector: vectors[i],
        path: '/sample.txt',
        offset: c.offset
      }))
    );
    
    // 5. Real search
    const queryVector = new Array(384).fill(0.5);
    const results = await table
      .search(queryVector)
      .limit(5)
      .execute();
    
    expect(results).toHaveLength(Math.min(5, chunks.length));
    expect(results[0]).toHaveProperty('text');
    expect(results[0]).toHaveProperty('_distance');
  });

  it('should handle multi-format documents', async () => {
    const formats = ['pdf', 'docx', 'txt'];
    
    for (const format of formats) {
      const text = await parseDocument(`fixtures/sample.${format}`);
      const chunks = chunkText(text, 500, 60);
      
      expect(chunks.length).toBeGreaterThan(0);
      expect(chunks[0].text).toBeTruthy();
    }
  });
});
```

### Effort: 2 hours
- 1 hour: Setup integration environment
- 1 hour: Write pipeline tests

---

## Implementation Schedule

| Priority | Test Suite | Effort | Coverage Gain | When |
|----------|-----------|--------|---------------|------|
| 1 | Document Parsers | 4 hours | +20% | Day 1 AM |
| 2 | Database Operations | 3 hours | +15% | Day 1 PM |
| 3 | Embeddings Orchestration | 3 hours | +10% | Day 2 AM |
| 4 | Pipeline Integration | 2 hours | +15% | Day 2 PM |
| **Total** | **All Core Logic** | **12 hours** | **+60%** | **2 days** |

---

## Success Metrics

### Coverage Goals
- **Before**: 30-40% real coverage
- **After**: 70-80% real coverage
- **Critical paths**: 90% covered

### Performance Targets
- All unit tests <50ms each
- Integration tests <200ms each
- Full suite <5 seconds

### Quality Indicators
- Zero flaky tests
- All tests deterministic
- Easy to debug failures

---

## Maintenance Guidelines

### Adding New Tests
1. Prefer real implementations when fast
2. Mock at process boundaries, not functions
3. Keep fixtures minimal (<5KB)
4. Test error paths explicitly

### Debugging Failed Tests
1. Run in isolation first
2. Check fixture files exist
3. Verify mock setup
4. Look for async timing issues

### Fixture Management
```bash
# Fixture directory structure
tests/fixtures/
├── README.md (explains each file)
├── simple.pdf (1 page, hello world)
├── simple.docx (plain text)
├── simple.rtf (basic formatting)
├── simple.txt (UTF-8 text)
├── corrupt.pdf (invalid file)
├── multipage.pdf (3 pages)
├── with-table.docx (has table)
└── large.txt (10KB text)
```

---

## Risk Mitigation

### Potential Issues
1. **Fixture bloat** → Keep files <5KB, review in PRs
2. **Mock complexity** → Mock at boundaries only
3. **Slow tests** → 50ms timeout per test
4. **Flaky tests** → No real I/O, no timing dependencies

### What We're NOT Testing
- Performance at scale
- Memory leaks over time
- Concurrent operations
- Network isolation

These require different test strategies (load tests, soak tests, etc.)

---

## Conclusion

This plan provides a pragmatic path to testing core business logic:
- **60% coverage gain** in 12 hours
- **Fast tests** (<50ms each)
- **Real components** where valuable
- **Strategic mocking** where necessary
- **Maintainable** test suite

The key is balance: test our code thoroughly while avoiding the complexity of testing third-party libraries or slow operations.

---

## Next Steps

1. Implement parser fixture tests first (highest ROI)
2. Add database mock tests
3. Consider embedding coordination tests if time permits
4. Add IPC validation tests for completeness

---

## Fast Testing Approach for Real Embeddings

### The Challenge

Testing real Transformers.js embeddings is slow because:
- Model loading takes 300-500ms (even quantized)
- Model files are ~25MB
- Each test suite reload causes model re-initialization
- Memory accumulates across test runs

### Fast Testing Strategies

#### Strategy 1: Tiny Test Model (Recommended)
Create a minimal model specifically for tests:

```typescript
// tests/fixtures/tiny-embedder.ts
class TinyEmbedder {
  private readonly dim = 8; // Tiny 8-dimensional embeddings
  
  async embed(texts: string[]): Promise<number[][]> {
    // Fast, deterministic embeddings based on text hash
    return texts.map(text => {
      const hash = this.hashCode(text);
      const vector = new Array(this.dim);
      for (let i = 0; i < this.dim; i++) {
        // Deterministic but varied values
        vector[i] = Math.sin(hash * (i + 1)) * 0.5 + 0.5;
      }
      return this.normalize(vector);
    });
  }
  
  private hashCode(str: string): number {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      hash = ((hash << 5) - hash) + str.charCodeAt(i);
      hash = hash & hash; // Convert to 32bit integer
    }
    return hash;
  }
  
  private normalize(vector: number[]): number[] {
    const magnitude = Math.sqrt(vector.reduce((sum, val) => sum + val * val, 0));
    return vector.map(val => val / magnitude);
  }
}
```

**Benefits:**
- Instant initialization (<1ms)
- Deterministic results for testing
- Preserves semantic similarity properties
- Tests the full pipeline without model overhead

#### Strategy 2: Cached Model Singleton
Load the real model once and reuse across all tests:

```typescript
// tests/helpers/embedding-cache.ts
let cachedPipe: any = null;

export async function getCachedEmbedder() {
  if (!cachedPipe) {
    const transformers = await import('@xenova/transformers');
    transformers.env.allowRemoteModels = false;
    transformers.env.localModelPath = './test-models';
    
    // Use the smallest available model
    cachedPipe = await transformers.pipeline(
      'feature-extraction',
      'Xenova/all-MiniLM-L6-v2',
      { quantized: true }
    );
  }
  return cachedPipe;
}

// In tests
beforeAll(async () => {
  const embedder = await getCachedEmbedder();
  // Model loaded once for entire test suite
});
```

**Benefits:**
- One-time 300ms penalty for entire test suite
- Tests real model behavior
- Catches actual model integration issues

**Drawbacks:**
- Memory stays allocated throughout tests
- Can't test model initialization errors
- Parallel test execution becomes complex

#### Strategy 3: Minimal Test Vectors
Test with tiny inputs to minimize processing time:

```typescript
describe('Embeddings - Fast Tests', () => {
  it('should generate normalized vectors', async () => {
    // Single word instead of paragraphs
    const vectors = await embed(['test']);
    
    expect(vectors).toHaveLength(1);
    expect(vectors[0]).toHaveLength(384);
    
    // Check normalization
    const magnitude = Math.sqrt(
      vectors[0].reduce((sum, val) => sum + val * val, 0)
    );
    expect(magnitude).toBeCloseTo(1.0, 5);
  });
  
  it('should preserve semantic similarity', async () => {
    // Minimal pairs for similarity testing
    const vectors = await embed(['cat', 'dog', 'car']);
    
    const cosineSim = (a: number[], b: number[]) => 
      a.reduce((sum, val, i) => sum + val * b[i], 0);
    
    const catDog = cosineSim(vectors[0], vectors[1]);
    const catCar = cosineSim(vectors[0], vectors[2]);
    
    // Animals should be more similar than animal-vehicle
    expect(catDog).toBeGreaterThan(catCar);
  });
});
```

**Benefits:**
- Reduces inference time
- Tests core properties without full documents
- Can run with real model

#### Strategy 4: Integration Test Subset
Create a separate test category for real embedding tests:

```json
// package.json
{
  "scripts": {
    "test:unit": "vitest run tests/unit",
    "test:embeddings": "vitest run tests/embeddings --pool=forks --poolOptions.forks.singleFork",
    "test:all": "npm run test:unit && npm run test:embeddings"
  }
}
```

```typescript
// tests/embeddings/real-embeddings.spec.ts
describe('Real Embeddings Integration', () => {
  let embedder: any;
  
  beforeAll(async () => {
    // One-time setup
    embedder = await initRealEmbedder();
  }, 30000); // Allow 30s for model download/init
  
  it('should handle batch processing', async () => {
    const texts = Array(10).fill('test text');
    const vectors = await embedder(texts);
    expect(vectors).toHaveLength(10);
  });
  
  // Only essential integration tests here
});
```

**Benefits:**
- Separates slow tests from fast unit tests
- Can run in CI separately
- Developers can skip during rapid iteration

### Recommended Approach

**For Development:**
1. Use **Strategy 1** (Tiny Test Model) for rapid TDD
2. Mock 95% of embedding calls
3. Test the coordination logic, not the ML model

**For CI/Pre-commit:**
1. Run fast unit tests with mocks
2. Run **Strategy 4** integration subset separately
3. Cache models in CI for consistency

### Implementation Plan

```typescript
// tests/unit/embeddings-coordination.spec.ts
import { TinyEmbedder } from '../fixtures/tiny-embedder';

describe('Embeddings Coordination', () => {
  let embedder: TinyEmbedder;
  
  beforeEach(() => {
    embedder = new TinyEmbedder();
    setEmbedImpl(embedder.embed.bind(embedder));
  });
  
  it('should batch texts efficiently', async () => {
    const texts = Array(100).fill('test');
    const results = await processInBatches(texts, 10);
    expect(results).toHaveLength(100);
  });
  
  it('should handle empty inputs', async () => {
    const results = await embed([]);
    expect(results).toEqual([]);
  });
  
  it('should normalize vectors', async () => {
    const [vector] = await embed(['test']);
    const magnitude = Math.sqrt(
      vector.reduce((sum, val) => sum + val * val, 0)
    );
    expect(magnitude).toBeCloseTo(1.0, 5);
  });
});
```

### Expected Outcomes

| Approach | Speed | Coverage | Reliability |
|----------|-------|----------|-------------|
| Tiny Model | <5ms per test | Logic only | High |
| Cached Real Model | 300ms once, then <50ms | Full | Medium |
| Minimal Vectors | <100ms per test | Partial | High |
| Integration Subset | 300-500ms per test | Full | High |

### Conclusion

For fast, reliable testing of embeddings:
1. **Mock 90%** of tests with TinyEmbedder
2. **Test coordination** logic thoroughly
3. **Reserve real model** for integration tests
4. **Run integration tests** separately in CI

This gives us:
- Sub-second unit test runs
- High confidence in coordination logic
- Verification of real model integration
- Fast developer feedback loop