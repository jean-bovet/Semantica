# Architecture Recommendations for Semantica

## Executive Summary

### Application Overview
**Semantica** is an Electron-based desktop application for macOS that provides offline semantic search capabilities for local documents. Users can index their local files (PDFs, Word docs, text files, spreadsheets) and search them using natural language queries. The app uses vector embeddings (ML) to understand semantic meaning, enabling searches like "find all documents about quarterly revenue" even if the documents don't contain those exact words.

### Current Architecture
```
Electron Main Process (UI + Orchestration)
├── Worker Thread (File parsing, chunking, database operations)
│   └── Handles: PDF, DOCX, TXT, MD, CSV, XLSX parsing
└── Embedder Child Process (ML model for vector generation)
    └── Model: Xenova/multilingual-e5-small (113MB, 384-dim vectors)
```

### Key Challenges
1. **Memory Leak**: Worker thread grows ~10MB per PDF file, reaching 1GB+ after 100 files
2. **Serial Bottleneck**: Embeddings processed one chunk at a time (slow)
3. **No Recovery**: Worker thread never restarts, accumulates memory until crash
4. **IPC Overhead**: Each text chunk requires separate IPC round-trip

## Problem Analysis

### Current File Processing Flow
1. **Worker thread** reads and parses file (PDF → text)
2. **Worker thread** chunks text (512 chars, 50 char overlap)
3. For each chunk **serially**:
   - Send chunk to embedder process via IPC
   - Wait for embedding response
   - Store in database
4. Memory grows, never released
5. After ~100 files, app crashes from memory exhaustion

### Measured Performance Issues
- **Memory Growth**: ~10MB RSS per PDF file in worker thread
- **Embedding Speed**: 100ms per chunk × 25 chunks = 2.5 seconds per file
- **Concurrency Waste**: 5 files processed in parallel, but embeddings are serial
- **IPC Overhead**: ~10-30ms per round trip × thousands of chunks

## Recommendations

### Immediate Actions (1-2 days)

#### 1. Implement Worker Thread Restart ✅ (In Progress)
```typescript
// Already implemented in this session
class WorkerManager extends RestartableProcess {
  thresholds: {
    maxMemoryMB: 800,     // Restart at 800MB
    maxFileCount: 100,    // Restart after 100 files  
    maxLifetimeMs: 3600000 // Restart after 1 hour
  }
}
```
**Impact**: Prevents memory crashes, enables unlimited file processing

#### 2. Add Embedding Batching
```typescript
// Change from:
for (const chunk of chunks) {
  const embedding = await embedder.embed(chunk); // Serial
}

// To:
const embeddings = await embedder.embedBatch(chunks); // Parallel
```
**Impact**: 10-25x faster embedding generation

### Short-term Improvements (1 week)

#### 3. Implement Embedder Pool
```typescript
class EmbedderPool {
  private embedders: EmbedderProcess[] = [];
  
  constructor() {
    const count = Math.min(os.cpus().length / 2, 4);
    for (let i = 0; i < count; i++) {
      this.embedders.push(new EmbedderProcess());
    }
  }
  
  async embedBatch(texts: string[]): Promise<number[][]> {
    // Distribute across pool
  }
}
```
**Impact**: True parallel embedding processing, 2-4x throughput

#### 4. Optimize Chunk Size
- Current: 512 chars with 50 overlap
- Recommended: 1024 chars with 100 overlap
- Reduces chunks by 50%, maintains context

**Impact**: 50% fewer embeddings needed, 2x faster

### Medium-term Improvements (2-4 weeks)

#### 5. Isolate PDF Parser
```typescript
class PDFParserProcess extends RestartableProcess {
  async parse(filePath: string): Promise<string> {
    // Run pdf-parse in isolated process
    // Auto-restart on memory threshold
  }
}
```
**Impact**: Isolates memory leak, prevents worker contamination

#### 6. Implement Smart Routing
```typescript
// Route based on file type
if (isLightFile(ext)) {  // TXT, MD, CSV
  processInWorker();      // Fast path, no process overhead
} else {                  // PDF, DOCX
  processInIsolation();   // Slow path, isolated
}
```
**Impact**: Faster processing for simple files

### Long-term Considerations (1-2 months)

#### 7. Job Queue Architecture
- Add persistent job queue (SQLite or Redis)
- Workers pull jobs instead of push
- Enable distributed processing
- Survive crashes without data loss

#### 8. Streaming Pipeline
- Stream large files instead of loading entirely
- Process chunks as they arrive
- Reduces memory footprint for large PDFs

## Architecture Decision Matrix

| Approach | Complexity | Memory Fix | Speed Gain | Risk |
|----------|------------|------------|------------|------|
| Worker Restart | Low | ✅ High | None | Low |
| Batch Embeddings | Low | ✅ Medium | ✅ 10x | Low |
| Embedder Pool | Medium | None | ✅ 2-4x | Medium |
| Isolate PDF Parser | Medium | ✅ High | None | Low |
| Job Queue | High | ✅ Medium | ✅ 2x | Medium |
| Streaming | High | ✅ High | ✅ 2x | High |

## Recommended Implementation Order

### Phase 1: Stabilization (This Week)
1. ✅ Complete Worker Restart implementation
2. ⬜ Add embedding batching
3. ⬜ Deploy and monitor

### Phase 2: Optimization (Next Week)
4. ⬜ Implement embedder pool
5. ⬜ Optimize chunk sizes
6. ⬜ Add performance metrics

### Phase 3: Isolation (Week 3-4)
7. ⬜ Isolate PDF parser
8. ⬜ Implement smart routing
9. ⬜ Add comprehensive testing

### Phase 4: Scale (Month 2)
10. ⬜ Evaluate job queue need
11. ⬜ Consider streaming for large files
12. ⬜ Add distributed processing (if needed)

## Success Metrics

### Memory Health
- **Current**: ~10MB leak per file, crash at ~100 files
- **Target**: <1MB growth per file, unlimited files
- **Measurement**: RSS growth rate via MemoryMonitor

### Processing Speed
- **Current**: ~2.5 seconds per file (25 chunks)
- **Target**: <0.5 seconds per file
- **Measurement**: Files indexed per minute

### Reliability
- **Current**: Crashes after 100-200 files
- **Target**: Process 10,000+ files without intervention
- **Measurement**: Uptime, restart count

## Risk Mitigation

### Risk 1: Restart Data Loss
- **Mitigation**: State preservation implemented
- **Fallback**: Persistent queue in SQLite

### Risk 2: IPC Complexity
- **Mitigation**: Keep current architecture, add batching only
- **Fallback**: Single process mode for small datasets

### Risk 3: Performance Regression
- **Mitigation**: A/B test with metrics
- **Fallback**: Feature flag for old behavior

## Code Examples

### Current (Problematic) Code
```typescript
// Serial, memory-leaking
for (const chunk of chunks) {
  const embedding = await embedder.embed(chunk);  // Waits
  await db.add({ text: chunk, embedding });       // Waits
}
// Memory never released, accumulates
```

### Recommended Code
```typescript
// Parallel, memory-managed
const embeddings = await embedder.embedBatch(chunks);  // One call
await db.addBatch(chunks.map((chunk, i) => ({
  text: chunk,
  embedding: embeddings[i]
})));
// Worker restarts at threshold, memory released
```

## Testing Strategy

1. **Unit Tests**: RestartableProcess, MemoryMonitor
2. **Integration Tests**: Worker restart with state preservation
3. **Load Tests**: 1000+ files without crash
4. **Memory Tests**: Verify restart at thresholds
5. **Performance Tests**: Measure embedding throughput

## Conclusion

The primary issues are:
1. **Memory leak** in PDF parsing (10MB/file)
2. **Serial embedding** bottleneck
3. **No restart capability** for worker

The recommended approach:
1. **Implement worker restart** (in progress) - fixes memory
2. **Add batch embeddings** - fixes speed
3. **Isolate problematic parsers** - prevents future issues

These changes will enable Semantica to:
- Process unlimited files without crashing
- Index files 10-25x faster
- Maintain stable memory usage
- Recover from failures automatically

The implementation is straightforward, low-risk, and can be done incrementally without breaking existing functionality.