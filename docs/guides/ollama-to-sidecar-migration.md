# Ollama to Python Sidecar Migration Guide

**Migration Date:** 2025-10-27
**Status:** Complete

---

## Why We Migrated

### Ollama Issues
- 1-2% failure rate (EOF errors, segmentation faults)
- Concurrent requests caused crashes
- Required manual installation
- Complex workarounds needed (promise queues, retries)

### Python Sidecar Benefits
- 100% reliability (zero failures in testing)
- Auto-starts with app (no manual setup)
- Simpler codebase (~205 lines removed)
- Better error messages (Python vs C++)

---

## What Changed

### For Users
**Nothing.** Migration is seamless:
- One-time re-indexing on first launch (10-30 min)
- No Ollama installation required
- No configuration changes needed

### For Developers

#### Architecture
- **Before:** Ollama HTTP server (external process)
- **After:** Python FastAPI sidecar (child process)

#### Model
- **Before:** nomic-embed-text via Ollama (768-dim)
- **After:** paraphrase-multilingual-mpnet-base-v2 via sentence-transformers (768-dim)

#### Communication
- **Before:** HTTP to localhost:11434
- **After:** HTTP to localhost:8421

#### Database
- **Before:** DB version 3
- **After:** DB version 4 (auto-migrates, clears embeddings)

---

## Code Changes

### New Classes

```typescript
// Client
PythonSidecarClient      // HTTP client (replaces OllamaClient)
PythonSidecarEmbedder    // IEmbedder impl (replaces OllamaEmbedder)
PythonSidecarService     // Lifecycle manager (replaces OllamaService)
```

### Files Added
- `src/main/worker/PythonSidecarClient.ts`
- `src/main/worker/PythonSidecarService.ts`
- `src/shared/embeddings/implementations/PythonSidecarEmbedder.ts`
- `embedding_sidecar/embed_server.py`
- `embedding_sidecar/requirements.txt`

### Files Deprecated
Moved to legacy (kept for reference):
- `src/main/worker/OllamaClient.ts`
- `src/main/worker/OllamaService.ts`
- `src/shared/embeddings/implementations/OllamaEmbedder.ts`

### EmbedderFactory

```typescript
// Before
embedderType: 'ollama'

// After
embedderType: 'python-sidecar'
```

---

## Removed Workarounds

### 1. Promise Queue (35 lines)
**Reason:** Prevented concurrent Ollama crashes
**Status:** Removed (sidecar handles concurrency)

### 2. Failed Batch Logging (50 lines)
**Reason:** Debugged Ollama EOF errors
**Status:** Removed (no more EOF errors)

### 3. Complex Retry Logic (20 lines)
**Reason:** Handled frequent Ollama failures
**Status:** Simplified (2 retries vs 3)

### 4. Health Checks (100 lines)
**Reason:** Detected Ollama availability
**Status:** Simplified (single startup check)

**Total removed:** ~205 lines

---

## Configuration Changes

| Setting | Ollama | Python Sidecar | Reason |
|---------|--------|----------------|--------|
| Timeout | 300s | 30s | Faster responses |
| Retries | 3 | 2 | Fewer failures |
| Batch size | 32 | 32-64 | More stable |
| Port | 11434 | 8421 | Avoid conflicts |

---

## Testing

### Unit Tests
- `tests/unit/python-sidecar-embedder.spec.ts` (34 tests)
- `tests/unit/database-version-migration.spec.ts` (updated for v4)

### Integration Tests
- `tests/unit/python-sidecar-integration.spec.ts` (uses real sidecar)

### E2E Tests
- Updated for sidecar startup flow

**Coverage:** >85% maintained

---

## Rollback Plan

If issues arise:

### Quick Rollback (5 minutes)
```typescript
// src/shared/embeddings/EmbedderFactory.ts
embedderType: 'ollama' // Revert to Ollama
```

### Requirements
- Ollama must be installed and running
- DB version will downgrade (embeddings lost)
- Manual user setup required

**Recommendation:** Keep Ollama code for 1-2 releases before removal.

---

## Performance Comparison

| Metric | Ollama | Python Sidecar |
|--------|---------|----------------|
| Reliability | 98-99% | 100% |
| Throughput | 40-60 texts/sec | 55-93 texts/sec |
| Memory | 500MB-1GB | 400-600MB |
| Setup time | 10-20 min | 0 min |
| EOF errors | 1-2% | 0% |

---

## Troubleshooting

### Sidecar won't start
```bash
# Check Python
python3 --version  # Should be 3.10+

# Check dependencies
cd embedding_sidecar
pip install -r requirements.txt

# Test standalone
python embed_server.py --port 8421
```

### Port conflicts
Change port in config:
```typescript
const service = new PythonSidecarService({ port: 8422 });
```

### Slow performance
- Ensure batch size: 32-64
- Check device: CPU vs MPS vs CUDA
- Monitor with LOG_CATEGORIES=SIDECAR-CLIENT

---

## References

- Implementation plan: `planning/python-sidecar-implementation-plan.md`
- Performance results: `docs/analysis/python-sidecar-performance-results.md`
- API reference: `docs/specs/python-sidecar.md`
