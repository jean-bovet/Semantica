# Worker Thread Memory Leak Issue

## Process Architecture

```
┌─────────────────────────────────────────────────────────────────────────┐
│                     ELECTRON MAIN PROCESS (PID: 1234)                   │
│                           Memory: ~100-200MB                            │
│  ┌────────────────────────────────────────────────────────────────┐    │
│  │  • Electron UI (BrowserWindow)                                 │    │
│  │  • IPC Communication Hub                                       │    │
│  │  • App Lifecycle Management                                    │    │
│  └────────────────────────────────────────────────────────────────┘    │
│                                   │                                     │
│                          Spawns Worker Thread                           │
│                                   ▼                                     │
│  ╔════════════════════════════════════════════════════════════════╗    │
│  ║          WORKER THREAD (Same PID: 1234, Thread ID: 2)          ║    │
│  ║                      Memory: 400-550MB+                        ║    │
│  ║  ┌────────────────────────────────────────────────────────┐   ║    │
│  ║  │  • File Processing & Queuing                           │   ║    │
│  ║  │  • PDF/DOCX/Text Parsing (MEMORY LEAK HERE!)          │   ║    │
│  ║  │  • LanceDB Operations                                  │   ║    │
│  ║  │  • Logs: "Memory: RSS=427MB, Heap=108MB..."          │   ║    │
│  ║  └────────────────────────────────────────────────────────┘   ║    │
│  ║                              │                                 ║    │
│  ║                     Spawns Child Process                       ║    │
│  ║                              ▼                                 ║    │
│  ╚════════════════════════════════════════════════════════════════╝    │
└─────────────────────────────────────────────────────────────────────────┘
                                   │
                          Fork (Separate Process)
                                   ▼
┌─────────────────────────────────────────────────────────────────────────┐
│            EMBEDDER CHILD PROCESS (Separate PID: 5678)                  │
│                        Memory: 200-300MB                                │
│  ┌────────────────────────────────────────────────────────────────┐    │
│  │  • Transformers.js Model (~113MB)                              │    │
│  │  • Embedding Generation                                        │    │
│  │  • Auto-restarts at 1500MB RSS or 500 files                  │    │
│  │  • Logs: "[EMBEDDER Memory] RSS=250MB..."                    │    │
│  └────────────────────────────────────────────────────────────────┘    │
└─────────────────────────────────────────────────────────────────────────┘

TOTAL MEMORY USAGE = Main (200MB) + Worker (550MB) + Embedder (300MB) = ~1GB
```

## Memory Reporting Breakdown

| Process/Thread | Log Pattern | Example | What's Included |
|----------------|-------------|---------|-----------------|
| **Main Process** | (No regular logs) | - | Electron UI, window management |
| **Worker Thread** | `Memory: RSS=...` | `Memory: RSS=427MB, Heap=108MB/112MB, External=8MB, Files processed: 16` | File parsing, DB ops, queues |
| **Embedder Process** | `[EMBEDDER Memory]` | `[EMBEDDER Memory] RSS=250MB, Heap=45MB/65MB, External=5MB, Embeddings created: 128` | ML model, tensors |

## Issue Summary
The worker thread experiences significant memory growth during file indexing, growing from ~400MB to 550MB+ after processing just 15 PDF files. This is approximately 10MB of memory leak per file processed.

## Current State (December 2025)

### Memory Monitoring Implementation
We've implemented a unified `MemoryMonitor` utility class that provides consistent memory tracking across both the worker thread and embedder process:

```typescript
// src/shared/utils/memoryMonitor.ts
export class MemoryMonitor {
  constructor(options: {
    logPrefix?: string;        // e.g., "WORKER Memory" or "EMBEDDER Memory"
    counterName?: string;       // e.g., "Files processed" or "Embeddings created"
    logInterval?: number;       // How often to log (default: 30000ms)
    trackArrayBuffers?: boolean; // Track ArrayBuffer allocations
  })
  
  start(): void                 // Start periodic logging
  stop(): void                  // Stop logging
  increment(count = 1): void    // Increment counter
  getStats(): MemoryStats       // Get current memory stats
  isMemoryHigh(rssLimitMB): boolean  // Check if memory exceeds limit
  getGrowthRate(): number       // Calculate MB/item growth rate
}
```

### How Thread Memory Measurement Works

**Important Concept**: Worker threads in Node.js share the same process memory space as the main thread, but they have their own V8 isolate (JavaScript execution context). This is different from child processes which have completely separate memory spaces.

```
Process Memory Space (Shared)
├── Main Thread V8 Isolate
│   ├── Heap Memory (JavaScript objects)
│   └── External Memory (Buffers, etc.)
├── Worker Thread V8 Isolate  
│   ├── Heap Memory (separate from main)
│   └── External Memory (separate from main)
└── Shared Memory (process-level resources)
    ├── Code Segment (shared)
    ├── Native Libraries (shared)
    └── OS Resources (file handles, etc.)
```

When we call `process.memoryUsage()` from within a worker thread:
- **RSS (Resident Set Size)**: Reports the ENTIRE process memory, including all threads
- **Heap Used/Total**: Reports only the worker thread's V8 heap
- **External**: Reports only the worker thread's external allocations
- **ArrayBuffers**: Reports only the worker thread's ArrayBuffer allocations

This means:
1. RSS from worker thread = RSS from main thread (same process!)
2. Heap measurements are thread-specific (separate V8 isolates)
3. Multiple threads don't multiply RSS (it's cumulative for the process)

### Observed Behavior
From production logs with new monitoring:
```
[WORKER Memory] RSS=396MB, Heap=78MB/95MB, External=8MB, Files processed: 7
[WORKER Memory] RSS=517MB, Heap=140MB/145MB, External=12MB, Files processed: 10
[WORKER Memory] RSS=557MB, Heap=150MB/155MB, External=15MB, Files processed: 15
[WORKER Memory] RSS=472MB, Heap=109MB/115MB, External=9MB, Files processed: 16 (GC occurred)

[EMBEDDER Memory] RSS=250MB, Heap=45MB/65MB, External=5MB, ArrayBuffers=2MB, Embeddings created: 128
[EMBEDDER Memory] RSS=287MB, Heap=52MB/70MB, External=8MB, ArrayBuffers=4MB, Embeddings created: 256
```

**Growth Rate**: ~10MB RSS per file, ~4MB Heap per file in worker thread

### Root Causes

#### 1. PDF Parser Memory Retention
The `pdf-parse` library retains parsed PDF data in memory:
- Large PDFs with many pages accumulate data
- Parser warnings indicate complex PDFs: "Warning: Indexing all PDF objects"
- No explicit cleanup after parsing

#### 2. Unbounded Data Structures
Several Maps grow without limits:
```typescript
const fileHashes = new Map<string, string>();        // Grows with every file
const fileChunkCounts = new Map<string, number>();   // Never cleared
const folderStats = new Map<string, FolderStats>();  // Accumulates stats
let fileStatusCache = new Map<string, any>();        // Caches all file statuses
```

#### 3. No Worker Restart Mechanism
Unlike the embedder child process which has:
- Memory limits (1500MB RSS)
- Automatic restart after thresholds
- Clean memory slate after restart

The worker thread has:
- No memory limits
- No restart mechanism
- Runs until application quits

## Impact

### Current Limitations
- **Memory exhaustion**: After ~100-200 files, system may run out of memory
- **Performance degradation**: GC pressure increases as memory grows
- **User experience**: App becomes sluggish, may crash

### Comparison with Embedder
| Component | Memory Management | Restart Trigger | Memory After Restart |
|-----------|------------------|-----------------|---------------------|
| Embedder Process | ✅ Has limits | 1500MB RSS or 500 files | Clean (200MB) |
| Worker Thread | ❌ No limits | Never | N/A |

## Proposed Solutions

### Solution 1: Implement Worker Thread Restart (Recommended)
Similar to embedder process isolation:

```typescript
class WorkerManager {
  private worker: Worker;
  private filesProcessed = 0;
  private readonly MAX_FILES = 100;      // Restart after 100 files
  private readonly MAX_MEMORY_MB = 800;  // Restart if RSS > 800MB
  
  async checkAndRestart(): Promise<boolean> {
    const usage = process.memoryUsage();
    const rssMB = usage.rss / 1024 / 1024;
    
    if (rssMB > this.MAX_MEMORY_MB || this.filesProcessed > this.MAX_FILES) {
      await this.restart();
      return true;
    }
    return false;
  }
  
  private async restart() {
    // Save state
    const state = await this.saveWorkerState();
    
    // Terminate old worker
    await this.worker.terminate();
    
    // Create new worker
    this.worker = new Worker('./worker.js');
    
    // Restore state
    await this.restoreWorkerState(state);
    
    this.filesProcessed = 0;
  }
}
```

**Pros**: Clean memory slate, proven approach (works for embedder)
**Cons**: Complex state management, brief processing pause

### Solution 2: Aggressive Memory Cleanup
Clean up after each file:

```typescript
async function handleFile(filePath: string) {
  try {
    // Process file...
    
  } finally {
    // Aggressive cleanup
    if (global.gc) global.gc();
    
    // Clear large objects
    if (fileChunkCounts.size > 1000) {
      // Keep only recent 1000 entries
      const entries = Array.from(fileChunkCounts.entries());
      fileChunkCounts.clear();
      entries.slice(-1000).forEach(([k, v]) => fileChunkCounts.set(k, v));
    }
    
    // Clear parser caches
    delete require.cache[require.resolve('../parsers/pdf')];
  }
}
```

**Pros**: No restart needed, simpler implementation
**Cons**: May not fully solve the issue, pdf-parse may still leak

### Solution 3: Move PDF Parsing to Child Process
Isolate PDF parsing like embeddings:

```typescript
class PDFParserProcess {
  private child: ChildProcess;
  
  async parse(filePath: string): Promise<string> {
    return new Promise((resolve, reject) => {
      const child = fork('./pdf-parser-child.js');
      
      child.on('message', (msg) => {
        if (msg.type === 'result') resolve(msg.text);
        if (msg.type === 'error') reject(msg.error);
      });
      
      child.send({ type: 'parse', filePath });
      
      // Kill after timeout
      setTimeout(() => child.kill(), 30000);
    });
  }
}
```

**Pros**: Complete isolation of problematic parser
**Cons**: IPC overhead, more complex architecture

## Immediate Mitigation

### Quick Fix (5 minutes)
Add memory-based pause to prevent crashes:

```typescript
// In worker/index.ts memory monitor
if (rssMB > 600) {
  console.log('[MEMORY] ⚠️ High memory usage, pausing indexing...');
  fileQueue.pause();
  
  // Force GC and wait
  if (global.gc) global.gc();
  await new Promise(resolve => setTimeout(resolve, 5000));
  
  // Resume if memory decreased
  const newRssMB = process.memoryUsage().rss / 1024 / 1024;
  if (newRssMB < 500) {
    fileQueue.resume();
  }
}
```

### Medium-term Fix (1 day)
Implement worker restart mechanism similar to embedder:
1. Track files processed and memory usage
2. Save state before restart (queues, hashes, stats)
3. Restart worker when thresholds exceeded
4. Restore state and continue processing

## Recommendations

### Immediate Action
1. **Deploy quick fix** to prevent crashes (memory-based pause)
2. **Reduce concurrency** temporarily from 7 to 4 files
3. **Monitor** memory usage patterns with the quick fix

### Long-term Solution
1. **Implement worker restart mechanism** (Solution 1)
2. **Consider PDF parser isolation** for problematic files (Solution 3)
3. **Add memory telemetry** to track which file types leak most

## Testing Strategy

### Memory Monitor Tests
The `MemoryMonitor` class has comprehensive unit tests covering:
```typescript
describe('MemoryMonitor', () => {
  it('should track memory statistics accurately')
  it('should increment counter correctly')
  it('should calculate growth rate')
  it('should detect high memory conditions')
  it('should start and stop periodic logging')
  it('should track ArrayBuffers when enabled')
  it('should format memory values correctly')
});
```

### Memory Leak Tests
```typescript
describe('Worker Memory Management', () => {
  it('should not exceed 800MB after 100 files', async () => {
    const monitor = new MemoryMonitor({ counterName: 'Files' });
    
    // Index 100 test PDFs
    for (let i = 0; i < 100; i++) {
      await processFile(testPdfs[i]);
      monitor.increment();
      
      // Check memory after each file
      if (monitor.isMemoryHigh(800)) {
        throw new Error(`Memory exceeded 800MB at file ${i}`);
      }
    }
    
    // Assert final memory state
    const stats = monitor.getStats();
    expect(stats.rss).toBeLessThan(800 * 1024 * 1024);
  });
  
  it('should restart worker when memory threshold exceeded', async () => {
    // Force high memory usage
    // Verify restart occurs
    // Verify processing continues
  });
});
```

### Performance Impact Tests
- Measure indexing speed before/after fixes
- Verify no data loss during restarts
- Test with various file types and sizes
- Monitor memory growth rate per file type

## Success Metrics

| Metric | Current | Target |
|--------|---------|--------|
| Memory per file | ~10MB | <1MB |
| Max RSS before restart | Unlimited | 800MB |
| Files before restart | Unlimited | 100-200 |
| Memory after 1000 files | Out of memory | <800MB |

## Unified Memory Monitoring Approach

### Implementation Summary
We now have a unified approach to memory monitoring across the application:

1. **Shared Utility**: `MemoryMonitor` class in `src/shared/utils/memoryMonitor.ts`
2. **Worker Thread**: Uses monitor with "WORKER Memory" prefix, tracks files processed
3. **Embedder Process**: Uses monitor with "EMBEDDER Memory" prefix, tracks embeddings created
4. **Consistent Logging**: Both use same format for easy comparison

### Benefits
- **Code Reuse**: Single implementation for all memory monitoring needs
- **Consistent Metrics**: Same measurements across different components
- **Testability**: Unit tested utility with 100% coverage
- **Growth Tracking**: Automatic calculation of memory growth per item
- **High Memory Detection**: Built-in threshold checking

### Usage Example
```typescript
// In worker thread
const memoryMonitor = new MemoryMonitor({
  logPrefix: 'WORKER Memory',
  counterName: 'Files processed',
  logInterval: 30000
});
memoryMonitor.start();

// In embedder process  
const memoryMonitor = new MemoryMonitor({
  logPrefix: 'EMBEDDER Memory',
  counterName: 'Embeddings created',
  trackArrayBuffers: true
});
memoryMonitor.start();
```

## References
- [Transformers.js Memory Leak Analysis](./transformers-memory-leak-analysis.md)
- [Memory Solution (Embedder)](./archive/memory-solution.md)
- Worker thread implementation: `src/main/worker/index.ts`
- Embedder isolation: `src/shared/embeddings/isolated.ts`
- Memory monitor utility: `src/shared/utils/memoryMonitor.ts`
- Memory monitor tests: `tests/unit/memory-monitor.spec.ts`