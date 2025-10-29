# Logging Migration Guide

## New Selective Logging System

We've implemented a category-based logging system to reduce log noise while keeping essential information visible.

### How It Works

1. **Logger Utility**: `/src/shared/utils/logger.ts`
   - Central logging utility with category filtering
   - Configurable via `LOG_CATEGORIES` environment variable
   - By default, only shows errors (silent mode)

2. **Log Categories**:
   ```
   Core Operations:
   - PIPELINE-STATUS - Progress indicator
   - ERROR (always on)

   File Operations:
   - INDEXING - File processing
   - QUEUE - Queue management
   - CLEANUP - File cleanup
   - WATCHER - File watching
   - FILE-STATUS - Status tracking
   - REINDEX - Parser upgrades
   - ENCODING - Text encoding

   Processing:
   - WORKER - Worker lifecycle
   - PROCESS-QUEUE - Queue processing
   - EMBEDDING - Embedding progress
   - EMBEDDING-QUEUE - Batch processing

   Embedder System:
   - EMBEDDER - Embedder startup
   - EMBEDDER-EVENT - Lifecycle events
   - EMBEDDER-POOL - Pool management
   - ISOLATED - Process isolation
   - IPC-ADAPTER - IPC messages
   - EMBEDDER-CORE - Core operations
   - MODEL-LOADER - Model loading
   - NODE-MESSENGER - Process messages

   Python Sidecar:
   - SIDECAR-SERVICE - Sidecar lifecycle management
   - SIDECAR-STDOUT - Python process stdout
   - SIDECAR-STDERR - Python process stderr
   - WORKER-STARTUP - Worker initialization

   System:
   - MEMORY - Memory monitoring
   - PERFORMANCE - Performance metrics
   - PROFILING - Performance profiling
   - STATE-MACHINE - State transitions
   - CHILD-OUT/ERR - Child process output

   Infrastructure:
   - DATABASE - Database operations
   - STARTUP - Application startup
   - MOCK - Test mocking
   - DEPRECATED - Deprecation warnings
   ```

### Configuration Examples

```bash
# Default (silent - only errors)
npm run dev

# Show progress
LOG_CATEGORIES=PIPELINE-STATUS npm run dev

# Debug file processing
LOG_CATEGORIES=WORKER,INDEXING,QUEUE npm run dev

# Debug embedder issues
LOG_CATEGORIES=EMBEDDER-*,MEMORY npm run dev

# Debug Python sidecar issues
LOG_CATEGORIES=SIDECAR-*,WORKER-STARTUP npm run dev

# Debug encoding issues
LOG_CATEGORIES=ENCODING,FILE-STATUS npm run dev

# Show everything
LOG_CATEGORIES=* npm run dev

# Mix wildcards and specific categories
LOG_CATEGORIES=EMBEDDER-*,WORKER,INDEXING npm run dev

# Exclude specific categories (use minus)
LOG_CATEGORIES=*,-CHILD-OUT,-CHILD-ERR npm run dev
```

## Migration Status

### ✅ Completed Files:
- `/src/shared/utils/logger.ts` - Created logger utility
- `/src/main/worker/index.ts` - Partially migrated (most critical logs)

### 🔄 Files To Migrate:

#### High Priority (lots of logs):
1. `/src/main/worker/EmbeddingQueue.ts` - [EmbeddingQueue] → EMBEDDING-QUEUE
2. `/src/shared/embeddings/isolated.ts` - [ISOLATED] → ISOLATED
3. `/src/shared/embeddings/embedder-pool.ts` - [EmbedderPool] → EMBEDDER-POOL
4. `/src/shared/embeddings/EmbedderIPCAdapter.ts` - [IPCAdapter] → IPC-ADAPTER
5. `/src/shared/embeddings/EmbedderCore.ts` - [EmbedderCore] → EMBEDDER-CORE

#### Medium Priority:
1. `/src/shared/embeddings/implementations/TransformersModelLoader.ts` - MODEL-LOADER
2. `/src/shared/embeddings/implementations/NodeProcessMessenger.ts` - NODE-MESSENGER
3. `/src/shared/utils/ProcessStateMachine.ts` - STATE-MACHINE
4. `/src/shared/utils/ChildProcessManager.ts` - CHILD-OUT/CHILD-ERR
5. `/src/main/worker/reindexManager.ts` - REINDEX
6. `/src/main/utils/encoding-detector.ts` - ENCODING

#### Low Priority:
1. `/src/main/main.ts` - Various categories
2. `/src/main/worker/fileStatusManager.ts` - FILE-STATUS
3. `/src/main/worker/config.ts` - Various categories
4. Test files in `/src/main/worker/test-mocks/` - MOCK

## Migration Instructions

### Step 1: Import Logger
```typescript
import { logger } from '../shared/utils/logger';
```

### Step 2: Replace Console Calls

**Before:**
```typescript
console.log('[WORKER] Starting initialization...');
console.error('[INDEXING] Failed:', error);
console.warn('[MEMORY] High usage');
```

**After:**
```typescript
logger.log('WORKER', 'Starting initialization...');
logger.error('INDEXING', 'Failed:', error);
logger.warn('MEMORY', 'High usage');
```

### Step 3: Handle Uncategorized Logs

For logs without categories, assign appropriate ones:
```typescript
// Before
console.log('Database initialized');

// After
logger.log('DATABASE', 'Database initialized');
```

### Special Cases

1. **Pipeline Status** - Leave as-is (always visible):
   ```typescript
   console.log(pipelineStatus); // Don't change
   ```

2. **Errors** - Always use logger.error():
   ```typescript
   logger.error('CATEGORY', 'Error message', error);
   ```

3. **Debug-only logs** - Can be removed or use specific category:
   ```typescript
   logger.log('WORKER', 'Debug info'); // Will only show if WORKER enabled
   ```

## Benefits

1. **Silent by default** - Only essential logs shown
2. **Developer control** - Enable specific categories as needed
3. **Production ready** - Clean logs in production
4. **Easy debugging** - Turn on relevant categories for troubleshooting
5. **Performance** - Less console I/O overhead

## Next Steps

1. Gradually migrate remaining files
2. Add new categories as needed
3. Document common debugging scenarios
4. Consider adding log levels (debug, info, warn, error)
5. Add log rotation for production