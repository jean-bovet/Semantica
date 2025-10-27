# Python Sidecar Performance Guide

**Quick Reference for Developers**

---

## TL;DR - Production Settings

```typescript
// Recommended production configuration
const PRODUCTION_CONFIG = {
  batchSize: 32,              // Optimal balance of throughput and latency
  threads: 1,                 // DO NOT use multiple threads (no benefit)
  timeout: 30000,             // 30 seconds
  retries: 2,                 // Reduced from Ollama's 3
  normalizeVectors: true,     // Required for cosine similarity
};
```

**Expected Performance:**
- **Throughput:** 55-65 texts/sec
- **Latency:** 500-600ms per batch (32 texts)
- **Reliability:** 100% (vs Ollama's 98-99%)

---

## Quick Performance Reference

### Throughput by Configuration

| Text Size | Batch Size | Throughput | Latency (p95) | Use Case |
|-----------|------------|------------|---------------|----------|
| 500 chars | 64 | 93 texts/sec | 721ms | Fast batch processing |
| 1000 chars | 64 | 64 texts/sec | 1030ms | **Recommended default** |
| 2000 chars | 32 | 62 texts/sec | 531ms | Balanced performance |
| 5000 chars | 32 | 55 texts/sec | 586ms | Large documents |
| 10000 chars | 32 | 57 texts/sec | 569ms | Very large chunks |

### Rule of Thumb

- **Small texts (<1000 chars):** Use batch size 64
- **Medium texts (1000-3000 chars):** Use batch size 32
- **Large texts (>3000 chars):** Use batch size 32
- **Always:** Use single thread (threads=1)

---

## Concurrency Warning ⚠️

**DO NOT use concurrent requests.** Testing shows:

| Threads | Speedup | Efficiency | Verdict |
|---------|---------|------------|---------|
| 1 | 1.00x | 100% | ✅ Optimal |
| 2 | 0.99x | 49% | ❌ Slower |
| 3 | 0.95x | 32% | ❌ Much slower |
| 5 | 0.92x | 18% | ❌ Significantly slower |

**Reason:** Python GIL (Global Interpreter Lock) prevents true parallelism.

**Recommendation:** Process batches serially with larger batch sizes instead of concurrent requests.

---

## Performance Tuning

### Scenario 1: Maximum Throughput (Batch Indexing)

```typescript
{
  batchSize: 64,              // Maximum batching
  textSizeLimit: 1000,        // Smaller chunks
  timeout: 60000,             // 60s for large batches
}
```

**Expected:** 90+ texts/sec for small documents

### Scenario 2: Low Latency (Interactive)

```typescript
{
  batchSize: 10,              // Smaller batches
  textSizeLimit: 1000,        // Fast processing
  timeout: 5000,              // 5s for quick fail
}
```

**Expected:** 200ms per batch (10 texts), 60 texts/sec

### Scenario 3: Large Documents

```typescript
{
  batchSize: 32,              // Balance memory and speed
  textSizeLimit: 10000,       // Support large chunks
  timeout: 60000,             // Higher timeout
}
```

**Expected:** 55-60 texts/sec, ~600ms per batch

---

## Comparison: Ollama vs Python Sidecar

| Aspect | Ollama | Python Sidecar | Winner |
|--------|---------|----------------|---------|
| **Throughput** | 40-60 texts/sec | 55-93 texts/sec | Sidecar (+30%) |
| **Reliability** | 98-99% | 100% | Sidecar |
| **Concurrent Requests** | Crashes | Handles (but slow) | Sidecar |
| **Setup** | Manual install | Bundled | Sidecar |
| **Debugging** | Cryptic C++ errors | Python stack traces | Sidecar |
| **Timeout** | 300s needed | 30s sufficient | Sidecar |
| **Retry Logic** | 3 retries required | 2 retries sufficient | Sidecar |

**Verdict:** Python sidecar is superior in every metric.

---

## Running Performance Tests

### Quick Test (2-3 minutes)

```bash
node scripts/test-python-sidecar.js --perf --quick
```

**Output:** Basic throughput and latency for common configurations

### Full Benchmark (10-15 minutes)

```bash
node scripts/test-python-sidecar.js --perf \
  --export-csv=results.csv \
  --export-json=results.json
```

**Output:** Comprehensive test suite with 45 configurations

### Custom Test

```bash
node scripts/test-python-sidecar.js --perf \
  --max-threads=3 \
  --max-size=5000 \
  --quick
```

**Options:**
- `--quick` - Faster test (5 iterations instead of 10)
- `--max-threads=N` - Test up to N concurrent threads
- `--max-size=N` - Test up to N character text size
- `--export-csv=FILE` - Export to CSV
- `--export-json=FILE` - Export to JSON

---

## Interpreting Results

### Key Metrics

**Throughput (texts/sec):**
- Higher is better
- Typical range: 50-100 texts/sec
- Affected by text size and batch size

**Latency (ms):**
- Lower is better for single texts
- Batch latency acceptable up to 1000ms
- Use p95 (not average) for production planning

**Success Rate:**
- Should be 100%
- Anything <100% indicates problems

**Scaling Efficiency:**
- Expected: ~20-40% with concurrent requests
- Don't use concurrency for Python sidecar

### Red Flags

⚠️ **Concerning Results:**
- Success rate < 100%
- Throughput < 30 texts/sec
- Latency p95 > 2000ms
- Scaling efficiency > 50% (indicates measurement error)

✅ **Good Results:**
- Success rate = 100%
- Throughput 50-100 texts/sec
- Latency p95 < 1000ms
- Consistent performance across iterations

---

## Troubleshooting

### Low Throughput (<30 texts/sec)

**Possible Causes:**
1. CPU device instead of MPS/GPU
2. Model not loaded into memory
3. Insufficient warm-up
4. Network latency (check localhost)

**Solutions:**
- Check `/info` endpoint for device type
- Run warm-up requests
- Verify sidecar on localhost

### High Latency (p95 > 2000ms)

**Possible Causes:**
1. Batch size too large
2. Text size too large
3. Concurrent requests (contention)
4. System resource constraints

**Solutions:**
- Reduce batch size to 32
- Limit text chunks to 5000 chars
- Use single thread
- Check system CPU/memory usage

### Failures (success rate < 100%)

**Possible Causes:**
1. Timeout too short
2. Concurrent requests overwhelming sidecar
3. Memory exhaustion
4. Network errors

**Solutions:**
- Increase timeout to 60s
- Use single thread
- Reduce batch size
- Check sidecar logs

---

## Expected Performance by Workload

### Indexing 1,000 Documents (avg 2000 chars)

- **Configuration:** 32 batch size, 1 thread
- **Throughput:** ~62 texts/sec
- **Time:** ~16 seconds
- **Reliability:** 100%

### Indexing 10,000 Documents

- **Time:** ~160 seconds (~2.7 minutes)
- **No failures** (vs Ollama: 100-200 failures requiring retry)
- **Consistent performance** throughout

### Indexing 100,000 Documents

- **Time:** ~27 minutes
- **Memory stable** (no restarts needed)
- **100% completion rate**

### Real-time Embedding (single text)

- **Latency:** 25-35ms
- **Throughput:** 30-40 texts/sec
- **Suitable for:** Interactive search, real-time features

---

## Memory Usage

| Configuration | Sidecar Memory | Total Memory | Notes |
|---------------|----------------|--------------|-------|
| Idle | ~400MB | ~400MB | Model loaded |
| Small batches (10) | ~450MB | ~450MB | Minimal overhead |
| Large batches (64) | ~500MB | ~500MB | Still acceptable |
| Peak usage | ~600MB | ~600MB | Stable over time |

**Compared to Ollama:**
- Ollama: 500MB-1GB (external process)
- Python sidecar: 400-600MB (integrated)
- **Winner:** Python sidecar (20-40% less memory)

---

## Production Checklist

Before deploying Python sidecar:

- [ ] Performance tested with realistic data
- [ ] Batch size configured (recommended: 32)
- [ ] Timeout set to 30s (increased for large batches)
- [ ] Retry logic configured (2 retries)
- [ ] Single-threaded processing enforced
- [ ] Health monitoring in place
- [ ] Error logging configured
- [ ] Memory limits set (~800MB max)
- [ ] Startup time acceptable (<10s)
- [ ] Shutdown cleanup implemented

---

## Future Optimization

If higher throughput needed (>100 texts/sec):

1. **Multi-Process Architecture**
   - Spawn 4-5 sidecar processes
   - Load balancer distributes requests
   - Potential: 4-5x throughput improvement

2. **Model Quantization**
   - Use INT8 quantization
   - Reduce size: 420MB → 105MB
   - Potential: 2x speedup

3. **Smaller Model**
   - Switch to MiniLM (384-dim, 80MB)
   - Potential: 2-3x speedup
   - Trade-off: Lower quality

4. **Caching**
   - Cache embeddings for duplicate texts
   - Reduce redundant computation
   - Best for: Repeated content

---

## References

- **Full Performance Report:** `docs/analysis/python-sidecar-performance-results.md`
- **Implementation Plan:** `planning/python-sidecar-implementation-plan.md`
- **Evaluation Results:** `docs/analysis/python-sidecar-evaluation.md`
- **Test Script:** `scripts/test-python-sidecar.js`

---

**Last Updated:** 2025-10-26
**Status:** Production Ready
**Recommendation:** Deploy immediately to replace Ollama
