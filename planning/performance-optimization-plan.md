# Performance Optimization Plan

Based on performance profiling conducted on 2025-08-31

## Current Performance Metrics

### Measured Performance (37 files, 18.4 seconds)
- **Throughput**: 2 files/second
- **Average time per file**: 0.5 seconds
- **Bottleneck**: Embedding generation (94.5% of time)

### Operation Breakdown
| Operation | Time % | Avg Duration | Impact |
|-----------|--------|--------------|--------|
| Embedding | 94.5% | 3.48s | Critical bottleneck |
| DB Write | 5.0% | 184ms | Minimal |
| Parsing | 0.5% | 15ms | Negligible |
| Chunking | 0.0% | 1ms | Negligible |

## Understanding the Current Batch Size

### Current Implementation
```typescript
const batchSize = 8; // This is the CHUNK batch size, not embedding batch size
for (let i = 0; i < chunks.length; i += batchSize) {
  const batch = chunks.slice(i, i + batchSize);  // Take 8 chunks
  const texts = batch.map(c => c.text);          // Extract text from chunks
  const vectors = await embed(texts, false);      // Send ALL 8 texts to model at once
}
```

### Clarification: What "Batch Size" Means
- **`batchSize = 8`**: Number of text chunks processed together
- **What's sent to embedder**: All 8 chunk texts in a single array
- **Model processes**: All 8 texts in parallel internally
- **Returns**: Array of 8 embedding vectors

Example:
- File has 40 chunks
- Processed in 5 batches (40 ÷ 8 = 5)
- Each batch sends 8 texts to the model simultaneously
- Model returns 8 vectors per call

## Optimization Strategies

### 1. Increase Batch Size (High Priority)
**Current**: 8 chunks per batch
**Proposed**: 16-32 chunks per batch

**Implementation**:
```typescript
const batchSize = 32; // Increase from 8 to 32
```

**Benefits**:
- Reduce embedding API calls by 75%
- Better GPU utilization in the model
- Reduce overhead from model loading/unloading

**Risks**:
- Higher memory usage (32 vectors in memory)
- Potential timeout on very large batches

### 2. Parallel Batch Processing (High Priority)
**Current**: Sequential batch processing
**Proposed**: Process 2-3 batches concurrently

**Implementation**:
```typescript
const PARALLEL_BATCHES = 3;
const batchPromises = [];

for (let i = 0; i < chunks.length; i += batchSize * PARALLEL_BATCHES) {
  for (let j = 0; j < PARALLEL_BATCHES && (i + j * batchSize) < chunks.length; j++) {
    const batch = chunks.slice(i + j * batchSize, i + (j + 1) * batchSize);
    batchPromises.push(processEmbeddingBatch(batch));
  }
  await Promise.all(batchPromises);
  batchPromises.length = 0;
}
```

**Benefits**:
- 2-3x faster embedding processing
- Better CPU core utilization
- Overlapped I/O and computation

**Risks**:
- Higher memory usage
- Potential embedder process overload

### 3. Embedding Cache (Medium Priority)
**Current**: No caching
**Proposed**: LRU cache for common text patterns

**Implementation**:
```typescript
class EmbeddingCache {
  private cache = new LRU<string, number[]>({ 
    max: 1000,
    maxSize: 100 * 1024 * 1024, // 100MB
    sizeCalculation: (value) => value.length * 4
  });
  
  async getEmbedding(text: string): Promise<number[]> {
    const hash = crypto.createHash('md5').update(text).digest('hex');
    
    if (this.cache.has(hash)) {
      cacheHits++;
      return this.cache.get(hash);
    }
    
    const embedding = await generateEmbedding(text);
    this.cache.set(hash, embedding);
    return embedding;
  }
}
```

**Benefits**:
- Skip embedding for duplicate chunks
- Especially effective for code (lots of repetition)
- Could save 20-30% on typical codebases

**Risks**:
- Memory overhead for cache
- Cache invalidation complexity

### 4. Optimize Embedder Process (Medium Priority)
**Current**: Restart after 1000 files
**Proposed**: Increase to 5000, add preemptive restarts

**Implementation**:
```typescript
const embedder = new IsolatedEmbedder({
  maxFilesBeforeRestart: 5000,  // From 1000
  maxMemoryMB: 2000,             // From 1500
  preemptiveRestart: true        // Restart during idle
});

// Preemptive restart during idle
if (queue.length === 0 && embedder.fileCount > 3000) {
  await embedder.restart(); // Restart while idle
}
```

**Benefits**:
- Reduce restart overhead (60s per restart)
- No interruption during active processing

### 5. Alternative Embedding Models (Low Priority)
**Current**: Xenova/multilingual-e5-small
**Alternatives** to consider:

| Model | Size | Speed | Quality | Use Case |
|-------|------|-------|---------|----------|
| all-MiniLM-L6-v2 | 22MB | 10x faster | Good for English | English-only docs |
| sentence-transformers/paraphrase-MiniLM-L3-v2 | 17MB | 15x faster | Moderate | Speed priority |
| BAAI/bge-small-en | 33MB | 5x faster | Very good | English focus |

### 6. Smart Chunking (Low Priority)
**Current**: Fixed 500 char chunks with 60 char overlap
**Proposed**: Semantic chunking

**Benefits**:
- Fewer, more meaningful chunks
- Better search relevance
- Reduce total embeddings by 30-40%

## Implementation Plan

### Phase 1: Quick Wins (1 day)
1. ✅ Increase batch size to 32
2. ✅ Increase embedder restart threshold to 5000
3. ✅ Add batch size configuration to settings

### Phase 2: Parallel Processing (2-3 days)
1. Implement parallel batch processing
2. Add concurrency controls
3. Test memory impact

### Phase 3: Caching (1 week)
1. Implement embedding cache
2. Add cache metrics
3. Test cache hit rates

### Phase 4: Model Optimization (2 weeks)
1. Benchmark alternative models
2. Add model selection to settings
3. Implement model-specific optimizations

## Expected Results

### After Phase 1
- **30-40% faster** (1.4x speedup)
- 2.8 files/second
- 0.35s per file average

### After Phase 2
- **2-3x faster** overall
- 4-6 files/second
- 0.2s per file average

### After Phase 3
- **Additional 20-30% faster** on typical codebases
- 5-8 files/second
- 0.15s per file average

### After Phase 4 (with faster model)
- **5-10x faster** possible
- 10-20 files/second
- 0.05-0.1s per file average

## Monitoring & Validation

### Metrics to Track
1. Files per second
2. Average embedding time
3. Cache hit rate (after Phase 3)
4. Memory usage
5. Embedder restarts per 1000 files

### Testing Strategy
1. Use consistent test dataset (Lisa Source files)
2. Run with `PROFILE=true` for each change
3. Compare before/after metrics
4. Monitor memory and CPU usage

## Risk Mitigation

### Memory Concerns
- Monitor RSS memory usage
- Implement backpressure if > 1.5GB
- Reduce batch size dynamically if needed

### Quality Concerns
- Test search quality with each change
- A/B test different models
- Keep current model as fallback option

### Stability Concerns
- Implement gradual rollout
- Add feature flags for each optimization
- Monitor error rates

## Success Criteria

✅ Phase 1 Success: 30% reduction in indexing time
✅ Phase 2 Success: 2x improvement in throughput
✅ Phase 3 Success: 20% cache hit rate
✅ Phase 4 Success: 5x overall speedup with maintained quality

## Notes

- The embedding model is the fundamental bottleneck
- Database and parsing are already highly optimized
- Focus on embedding optimizations will yield best results
- Consider GPU acceleration for production deployments