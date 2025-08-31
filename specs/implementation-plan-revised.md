# Revised Implementation Plan - Semantica

Based on engineering review feedback. Biasing for **fast + simple** over elaborate systems.

## Updated Priority Order (80/20 wins first)

### Week 1: Core Fixes
1. **✅ Worker Restart** (in progress)
   - Already implemented RestartableProcess base
   - Finish state persistence for in-flight files
   - Per-component thresholds (parser vs embedder)

2. **🔥 Batch Embeddings + Bulk DB** (HIGHEST IMPACT)
   ```typescript
   // Before: Serial, N round-trips
   for (const chunk of chunks) {
     const embedding = await embedder.embed(chunk);
     await db.add({ text: chunk, embedding });
   }
   
   // After: Single batch, bulk insert
   const embeddings = await embedder.embedBatch(chunks);  // One IPC call
   await db.transaction(async () => {
     await db.addBatch(chunks.map((chunk, i) => ({
       text: chunk,
       embedding: new Float32Array(embeddings[i])  // Binary, not array
     })));
   });
   ```
   - Start with batch size 16-32, auto-tune based on latency
   - Return Float32Array buffers to avoid GC pressure
   - Single transaction for all chunks

3. **🎯 Smart Chunking**
   ```typescript
   // Simple sentence-aware splitter
   function smartChunk(text: string, targetSize = 1000): string[] {
     const sentences = text.split(/(?<=[.!?])\s+/);
     const chunks = [];
     let current = '';
     
     for (const sentence of sentences) {
       if (current.length + sentence.length > targetSize && current) {
         chunks.push(current.trim());
         current = sentence;
       } else {
         current += ' ' + sentence;
       }
     }
     if (current) chunks.push(current.trim());
     return chunks;
   }
   ```
   - Target 1000-1200 chars per chunk
   - Split on sentence boundaries
   - 50% fewer embeddings needed

### Week 1-2: Measurement & Optimization

4. **📈 Add Metrics**
   ```typescript
   class MetricsCollector {
     private timings: number[] = [];
     
     recordTiming(ms: number) {
       this.timings.push(ms);
       if (this.timings.length > 100) this.timings.shift();
     }
     
     get p95() {
       const sorted = [...this.timings].sort((a, b) => a - b);
       return sorted[Math.floor(sorted.length * 0.95)];
     }
     
     get throughput() {
       return this.timings.length / (sum(this.timings) / 1000);  // per second
     }
   }
   ```
   - p95 latency per stage (parse, chunk, embed, store)
   - RSS growth rate
   - Batches/second throughput

5. **🧪 Profile & Fix Actual Leak**
   ```bash
   # Take heap snapshots
   node --inspect-brk --expose-gc worker.js
   # Chrome DevTools → Memory → Heap Snapshot
   # Compare before/after 10 PDFs
   ```
   - If PDF parser → isolate it
   - If not → fix the real culprit

### Week 2: Conditional Improvements (based on metrics)

6. **IF memory still grows:** Isolate PDF Parser
   ```typescript
   class PDFParserProcess extends RestartableProcess {
     async parse(filePath: string): Promise<string> {
       // Isolated, auto-restarts at 200MB
     }
   }
   ```

7. **IF CPU saturated:** Small Embedder Pool
   ```typescript
   const poolSize = Math.min(os.cpus().length / 2, 3);  // Cap at 3
   ```
   - Only if batching alone doesn't saturate the model
   - Keep batching inside each worker

## Quick Wins Not in Original Plan

### A. Zero-Copy IPC (worker_threads)
```typescript
// Transfer ownership instead of copying
const buffer = new ArrayBuffer(embeddings.byteLength);
const view = new Float32Array(buffer);
view.set(embeddings);

parentPort.postMessage(
  { type: 'embeddings', buffer },
  [buffer]  // Transfer list - zero copy!
);
```

### B. Database Optimizations
```typescript
// LanceDB/SQLite optimizations
await db.exec('PRAGMA journal_mode = WAL');
await db.exec('PRAGMA synchronous = NORMAL');
await db.exec('BEGIN TRANSACTION');
// ... bulk inserts ...
await db.exec('COMMIT');
```

### C. Simple Backpressure
```typescript
import pLimit from 'p-limit';
const limit = pLimit(3);  // Max 3 concurrent files

const promises = files.map(file => 
  limit(() => processFile(file))
);
```

### D. Auto-tuned Batching
```typescript
class AdaptiveBatcher {
  private batchSize = 16;
  private lastLatency = 0;
  
  async embedBatch(texts: string[]) {
    const start = Date.now();
    const result = await this.embed(texts.slice(0, this.batchSize));
    const latency = Date.now() - start;
    
    // Auto-tune
    if (latency < 100 && this.batchSize < 64) {
      this.batchSize = Math.min(64, this.batchSize * 1.5);
    } else if (latency > 500 && this.batchSize > 8) {
      this.batchSize = Math.max(8, this.batchSize * 0.7);
    }
    
    return result;
  }
}
```

## What We're NOT Doing (yet)

❌ **Job Queue** - Overkill for single-machine offline app
❌ **Full Streaming** - Complex, wait until we hit real limits
❌ **Embedder Pool** - Measure after batching first
❌ **Multi-machine** - Not needed for desktop app
❌ **WebGPU** - Future optimization, not now

## Success Criteria

### After Week 1
- ✅ No crashes after 1000+ files
- ✅ <0.5 seconds per file (from 2.5s)
- ✅ Memory stable under 800MB

### After Week 2
- ✅ 10,000+ files without intervention
- ✅ p95 latency <200ms per file
- ✅ Memory growth <1MB per file

## Testing Strategy

```typescript
// Integration test
describe('Memory stability', () => {
  it('processes 100 PDFs without exceeding 800MB', async () => {
    const monitor = new MemoryMonitor();
    
    for (let i = 0; i < 100; i++) {
      await processFile(`test-pdf-${i}.pdf`);
      
      const stats = monitor.getStats();
      expect(stats.rss).toBeLessThan(800 * 1024 * 1024);
    }
  });
});

// Performance test
describe('Batching performance', () => {
  it('achieves >20 chunks/second throughput', async () => {
    const chunks = Array(100).fill('sample text...');
    const start = Date.now();
    
    await embedder.embedBatch(chunks);
    
    const throughput = 100 / ((Date.now() - start) / 1000);
    expect(throughput).toBeGreaterThan(20);
  });
});
```

## Final Sequence

1. ✅ **Keep worker restart** (insurance)
2. 🔥 **Implement embedBatch + bulk DB + WAL** (biggest win)
3. 🎯 **Smart chunking** (halve the work)
4. 📈 **Add metrics** (measure everything)
5. 🧪 **Profile leak** → isolate if needed
6. 🧮 **Pool only if CPU bound** after batching
7. 📦 **Defer complex systems** until proven necessary

This approach delivers 80-90% of gains with minimal complexity increase.