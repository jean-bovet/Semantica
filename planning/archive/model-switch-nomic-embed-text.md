# Model Switch: bge-m3 → nomic-embed-text

**Date**: 2025-10-26
**Status**: ✅ **IMPLEMENTED**

## Problem

The `bge-m3` embedding model was causing intermittent EOF errors due to an upstream bug in Ollama/llama.cpp:

```
fault   0x199cceb1c
llama_init_from_model: model default pooling_type is [2], but [-1] was specified
HTTP 500: EOF
```

- Segmentation faults in llama runner
- Connection closures during embedding requests
- Model constantly reloading (ports changing)
- Request serialization didn't fix it (proved it's not our code)

## Solution

Switched to `nomic-embed-text` embedding model:
- **More stable** in Ollama
- **No pooling_type bugs**
- **768 dimensions** (vs 1024 for bge-m3)
- **Proven track record** for production use

## Changes Made

### 1. Model Name Changes

**Files modified:**
- `src/main/worker/WorkerStartup.ts:43`
- `src/shared/embeddings/EmbedderFactory.ts:54, 370`
- `src/shared/embeddings/implementations/OllamaEmbedder.ts:38`
- `src/main/worker/OllamaService.ts:40`
- `src/main/worker/OllamaClient.ts:88, 94, 117, 186`

**Change:**
```typescript
// Before
const MODEL_NAME = 'bge-m3';

// After
const MODEL_NAME = 'nomic-embed-text';
```

### 2. Vector Dimensions

**File**: `src/main/worker/index.ts`

**Changes:**
```typescript
// Database version
// Before: DB_VERSION = 2 (1024-dim)
// After:  DB_VERSION = 3 (768-dim)

// Vector dimension constant
// Before: EXPECTED_VECTOR_DIMENSION = 1024
// After:  EXPECTED_VECTOR_DIMENSION = 768
```

### 3. Documentation

**Files updated:**
- `CLAUDE.md` - Updated tech stack and recent updates
- Added this planning document

## Database Migration

The existing database version system will automatically handle migration:

1. On startup, checks `.db-version` file
2. Sees version 2 (old) vs version 3 (current)
3. Deletes all `.lance` directories
4. Clears `fileHashes` table
5. Writes new version marker
6. User re-indexes with new model

**No manual intervention required!**

## Model Comparison

| Feature | bge-m3 | nomic-embed-text |
|---------|--------|------------------|
| Dimensions | 1024 | 768 |
| Stability | Buggy (segfaults) | Stable |
| Multilingual | Yes | Yes |
| Size | ~670MB | ~274MB |
| Context | 8192 tokens | 8192 tokens |
| Status | Deprecated | **Active** |

## Testing

### Before Running

```bash
# Check current Ollama models
ollama list

# If bge-m3 is installed, you can remove it (optional)
ollama rm bge-m3

# nomic-embed-text will be auto-downloaded on first run
```

### Expected Behavior

1. **First startup:**
   - Database migration detected
   - Old embeddings cleared
   - nomic-embed-text model downloaded (if not present)
   - Model loads successfully

2. **During indexing:**
   - ✅ No EOF errors
   - ✅ No segmentation faults
   - ✅ Stable Ollama runner (port doesn't change)
   - ✅ Successful embedding requests
   - ✅ No batch capture files on Desktop

3. **Ollama logs** (`tail -f ~/.ollama/logs/server.log`):
   - ✅ No `fault 0x199cceb1c` messages
   - ✅ No `pooling_type` warnings
   - ✅ No "aborting... client closing connection"
   - ✅ Successful 200 responses

### Verification

```bash
# Run with logging
LOG_CATEGORIES=EMBEDDING-QUEUE,OLLAMA-CLIENT npm run dev

# Watch for:
# - Model download progress
# - Database migration message
# - Successful embedding requests
# - No EOF errors
```

## Performance Impact

**Expected:** Minimal to none

- Vector dimensions: 768 vs 1024 (25% smaller)
- Model size: 274MB vs 670MB (60% smaller)
- Computation: Faster due to smaller matrices
- Quality: Comparable (both are top-tier multilingual models)

**Net result:** Likely a small performance **improvement**

## Rollback Plan

If issues arise (unlikely), rollback is simple:

1. Change `DB_VERSION` back to 2
2. Change `EXPECTED_VECTOR_DIMENSION` back to 1024
3. Change all `nomic-embed-text` back to `bge-m3`
4. Restart app (triggers migration back)

## Known Issues

None expected! But monitor for:
- Embedding quality differences (subjective)
- Search result changes (different model = different vectors)

If quality is noticeably worse, we can try `mxbai-embed-large` (1024-dim, also stable).

## References

- Investigation: `planning/eof-debugging-logging-added.md`
- Ollama model page: https://ollama.com/library/nomic-embed-text
- GitHub Issues: #6094, #5781, #9499 (bge-m3 bugs)

---

**Status**: Ready to test
**Risk**: Low (proven stable model)
**Impact**: High (fixes critical EOF errors)
