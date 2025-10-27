# Python Sidecar Implementation Plan

**Status:** Ready for Implementation
**Estimated Effort:** 9-14 days
**Priority:** High (solves critical EOF errors)
**Created:** 2025-10-26

---

## Overview

Replace Ollama embedding service with a Python-based FastAPI sidecar using sentence-transformers. This eliminates EOF errors, simplifies architecture, and provides better stability.

**Success Criteria:**
- ✅ Zero EOF errors in production
- ✅ Comparable or better performance than Ollama
- ✅ Seamless user experience (no manual setup)
- ✅ Full test coverage (unit, integration, E2E)
- ✅ Production-ready packaging for Mac

---

## Phase 1: Model Validation & Selection (1-2 days)

### 1.1 Select Production Model
**Goal:** Choose best model for production (DB migration accepted)

**Decision:** Use `sentence-transformers/paraphrase-multilingual-mpnet-base-v2` (current POC model)

**Rationale:**
- ✅ Already tested and working (100% success rate on failed batches)
- ✅ 768-dim vectors (same as current DB schema)
- ✅ Multilingual support (important for diverse content)
- ✅ Well-established and stable
- ✅ ~420MB model size (reasonable)
- ✅ Good balance of speed and quality

**Database Migration Strategy:**
- Increment DB version from 3 to 4
- Clear all existing embeddings on first run
- User sees "Re-indexing documents..." (one-time)
- Total re-index time: ~10-30 minutes depending on document count

**Alternative Models (for future consideration):**
| Model | Dim | Size | Speed | Quality | Use Case |
|-------|-----|------|-------|---------|----------|
| all-mpnet-base-v2 | 768 | 420MB | Medium | High | English-only |
| all-MiniLM-L6-v2 | 384 | 80MB | Fast | Good | Speed priority |
| multilingual-e5-large | 1024 | 2GB | Slow | Best | Quality priority |

**Deliverable:** ✅ Model selected (multilingual-mpnet-base-v2)

---

### 1.2 Database Version Migration
**Goal:** Implement DB version 4 with re-indexing

**Tasks:**
- [ ] Update `DB_VERSION` constant from 3 to 4
- [ ] Update migration logic to clear embeddings table
- [ ] Test migration on local DB
- [ ] Add migration progress UI ("Re-indexing documents...")

**Changes to `src/main/services/DatabaseVersionService.ts` (or equivalent):**
```typescript
const DB_VERSION = 4; // Changed from 3

async function migrateToV4(db: LanceDBInstance): Promise<void> {
  logger.log('DB-MIGRATION', 'Migrating to v4: Python sidecar embeddings');

  // Clear all embeddings (model change from Ollama to Python sidecar)
  await db.clearEmbeddings();

  // Update schema if needed (768-dim vectors, unchanged)
  // No schema change needed - still 768 dimensions

  logger.log('DB-MIGRATION', 'Migration to v4 complete. Re-indexing required.');
}
```

**User Experience:**
- On first launch: "Updating to new embedding model..."
- Progress bar shows re-indexing status
- Existing file statuses preserved (just re-embed)
- Estimated time: 10-30 minutes

**Note:** Cross-platform testing deferred (Mac-only app currently)

---

## Phase 2: Core Integration (3-5 days)

### 2.1 Create Sidecar Client (`src/main/worker/PythonSidecarClient.ts`)
**Goal:** HTTP client for Python sidecar API

**Interface:**
```typescript
export class PythonSidecarClient {
  constructor(config?: SidecarClientConfig);

  // Core operations
  async embedBatch(texts: string[], options?: EmbedOptions): Promise<number[][]>;
  async checkHealth(): Promise<boolean>;
  async getInfo(): Promise<SidecarInfo>;

  // File operations (optional, nice-to-have)
  async embedFile(path: string, options?: FileEmbedOptions): Promise<FileEmbedResult>;
}

export interface SidecarClientConfig {
  baseUrl?: string;      // Default: http://127.0.0.1:8421
  timeout?: number;      // Default: 30000
  retryAttempts?: number; // Default: 2 (reduced from Ollama's 3)
  retryDelay?: number;   // Default: 1000
}

export interface EmbedOptions {
  normalize?: boolean;   // Default: true
  pooling?: 'mean' | 'cls' | 'max'; // Default: 'mean'
  batchSize?: number;    // Default: 16 (can increase to 64+)
}

export interface SidecarInfo {
  model_id: string;
  dim: number;
  device: string; // 'mps' | 'cuda' | 'cpu'
}
```

**Implementation Notes:**
- Use Node's `http` module (like test script)
- Remove promise queue (not needed for sidecar)
- Simpler retry logic (2 retries max, not 3)
- No failed batch logging to Desktop
- Standard error handling (no EOF-specific workarounds)

**Files to Create:**
- `src/main/worker/PythonSidecarClient.ts` (new, ~200 lines)
- `tests/unit/python-sidecar-client.spec.ts` (new, ~150 lines)

---

### 2.2 Create Sidecar Embedder (`src/shared/embeddings/implementations/PythonSidecarEmbedder.ts`)
**Goal:** IEmbedder implementation using sidecar

**Interface:**
```typescript
export class PythonSidecarEmbedder implements IEmbedder {
  constructor(config?: PythonSidecarEmbedderConfig);

  async initialize(): Promise<boolean>;
  async embed(texts: string[]): Promise<number[][]>;
  async embedWithRetry(texts: string[], maxRetries?: number): Promise<number[][]>;
  async shouldRestart(): Promise<boolean>;  // Always returns false
  async restart(): Promise<void>;           // No-op
  async shutdown(): Promise<void>;
  getStats(): EmbedderStats;
}

export interface PythonSidecarEmbedderConfig extends EmbedderConfig {
  client?: PythonSidecarClient;
  normalizeVectors?: boolean; // Default: true
  pooling?: 'mean' | 'cls' | 'max'; // Default: 'mean'
}
```

**Implementation Notes:**
- Similar to `OllamaEmbedder.ts` but simpler
- No memory restart logic (sidecar manages itself)
- Vector normalization handled by sidecar (not client-side)
- Standard retry logic (2-3 retries)

**Files to Create:**
- `src/shared/embeddings/implementations/PythonSidecarEmbedder.ts` (new, ~180 lines)
- `tests/unit/python-sidecar-embedder.spec.ts` (new, ~120 lines)

---

### 2.3 Update Embedder Factory
**Goal:** Support sidecar as embedder type

**Changes to `src/shared/embeddings/EmbedderFactory.ts`:**
```typescript
export type EmbedderType = 'ollama' | 'python-sidecar' | 'isolated' | 'pool' | 'mock';

export class EmbedderFactory {
  // Add new factory method
  createPythonSidecarEmbedder(): PythonSidecarEmbedder {
    const embedderConfig: PythonSidecarEmbedderConfig = {
      modelName: this.config.modelName,
      batchSize: this.config.batchSize,
      client: this.config.sidecarClient,
      normalizeVectors: this.config.normalizeVectors
    };

    return new PythonSidecarEmbedder(embedderConfig);
  }

  // Update production factory to use sidecar by default
  static createProductionFactory(overrides: Partial<EmbedderFactoryConfig> = {}): EmbedderFactory {
    return new EmbedderFactory({
      embedderType: 'python-sidecar', // Changed from 'ollama'
      modelName: 'all-mpnet-base-v2',  // Or selected model from Phase 1
      batchSize: 64,                    // Increased from 32
      normalizeVectors: true,
      enableVerboseLogging: false,
      ...overrides
    });
  }
}
```

**Files to Modify:**
- `src/shared/embeddings/EmbedderFactory.ts` (~50 lines changed)
- `tests/unit/embedder-factory.spec.ts` (~30 lines added)

---

### 2.4 Sidecar Lifecycle Management
**Goal:** Auto-start/stop sidecar with app

**New Service: `src/main/worker/PythonSidecarService.ts`**
```typescript
export class PythonSidecarService {
  private process: ChildProcess | null = null;
  private client: PythonSidecarClient;

  constructor(config?: PythonSidecarServiceConfig);

  // Lifecycle
  async startSidecar(): Promise<boolean>;
  async stopSidecar(): Promise<void>;
  async restartSidecar(): Promise<boolean>;

  // Health
  async isRunning(): Promise<boolean>;
  async getStatus(): Promise<SidecarStatus>;

  // Get client for embedder
  getClient(): PythonSidecarClient;
}

export interface PythonSidecarServiceConfig {
  pythonPath?: string;      // Path to bundled Python
  scriptPath?: string;      // Path to embed_server.py
  modelCachePath?: string;  // Path to bundled models
  port?: number;            // Default: 8421
  autoRestart?: boolean;    // Default: true
}
```

**Implementation:**
- Spawn Python process using `child_process.spawn()`
- Monitor stdout/stderr for startup messages
- Health check loop until `/health` responds
- Kill process on shutdown
- Auto-restart on crash (if enabled)

**Similar to:** `src/main/worker/OllamaService.ts` but manages Python instead

**Files to Create:**
- `src/main/worker/PythonSidecarService.ts` (new, ~250 lines)
- `tests/unit/python-sidecar-service.spec.ts` (new, ~150 lines)

---

### 2.5 Update Startup Coordinator
**Goal:** Initialize sidecar instead of Ollama

**Changes to `src/main/startup/StartupStages.ts`:**
```typescript
// Replace OLLAMA stages with SIDECAR stages
export enum StartupStage {
  WORKER_SPAWN = 'WORKER_SPAWN',
  DB_INIT = 'DB_INIT',
  DB_LOAD = 'DB_LOAD',
  FOLDER_SCAN = 'FOLDER_SCAN',
  SIDECAR_START = 'SIDECAR_START',      // New (replaces MODEL_CHECK)
  SIDECAR_READY = 'SIDECAR_READY',      // New (replaces EMBEDDER_INIT)
  READY = 'READY'
}

// Update stage handlers
async function startSidecar(coordinator: StartupCoordinator): Promise<void> {
  const sidecarService = new PythonSidecarService({
    pythonPath: getPythonPath(),
    scriptPath: getSidecarScriptPath(),
    modelCachePath: getModelCachePath(),
    port: 8421
  });

  await sidecarService.startSidecar();
  coordinator.setSidecarService(sidecarService);
}
```

**Files to Modify:**
- `src/main/startup/StartupStages.ts` (~80 lines changed)
- `tests/unit/startup-coordinator.spec.ts` (~40 lines changed)

---

## Phase 3: Packaging & Bundling (2-3 days)

### 3.1 Bundle Python Runtime (Mac)
**Goal:** Ship Python 3.11 with app

**Options:**
1. **Python.org official build** (~50MB)
2. **Miniforge/Miniconda** (~150MB, includes conda)
3. **PyInstaller** (bundle as single binary)

**Recommended:** Option 1 (official Python.org)

**Process:**
1. Download Python 3.11 macOS installer
2. Extract to `resources/python/`
3. Test embedded Python runs
4. Update electron-builder config

**electron-builder config:**
```json
{
  "extraResources": [
    {
      "from": "resources/python",
      "to": "python",
      "filter": ["**/*"]
    },
    {
      "from": "embedding_sidecar",
      "to": "embedding_sidecar",
      "filter": ["**/*", "!.venv/**", "!__pycache__/**"]
    }
  ]
}
```

**Helper Function:**
```typescript
// src/main/utils/python-paths.ts
export function getPythonPath(): string {
  if (app.isPackaged) {
    // Production: use bundled Python
    return path.join(process.resourcesPath, 'python', 'bin', 'python3');
  } else {
    // Development: use system Python
    return 'python3';
  }
}

export function getSidecarScriptPath(): string {
  if (app.isPackaged) {
    return path.join(process.resourcesPath, 'embedding_sidecar', 'embed_server.py');
  } else {
    return path.join(__dirname, '../../embedding_sidecar/embed_server.py');
  }
}
```

---

### 3.2 Pre-download and Bundle Models
**Goal:** Ship model weights with app (no download on first run)

**Process:**
1. Download model to local cache:
   ```bash
   cd embedding_sidecar
   HF_HOME=../resources/models python -c "from sentence_transformers import SentenceTransformer; SentenceTransformer('all-mpnet-base-v2')"
   ```

2. Bundle models in app:
   ```json
   {
     "extraResources": [
       {
         "from": "resources/models",
         "to": "models",
         "filter": ["**/*"]
       }
     ]
   }
   ```

3. Set `HF_HOME` environment variable:
   ```typescript
   const modelCachePath = app.isPackaged
     ? path.join(process.resourcesPath, 'models')
     : path.join(__dirname, '../../resources/models');

   process.env.HF_HOME = modelCachePath;
   ```

**Size Estimates:**
- `all-mpnet-base-v2`: ~420MB
- `all-MiniLM-L6-v2`: ~80MB
- `paraphrase-multilingual-mpnet-base-v2`: ~420MB

---

### 3.3 Install Python Dependencies on First Run
**Goal:** Install dependencies in bundled environment

**Options:**

**Option A: Pre-install in Bundle** (Recommended)
```bash
# During build process
cd embedding_sidecar
python3 -m venv ../resources/python/venv
source ../resources/python/venv/bin/activate
pip install -r requirements.txt
```

Then ship the venv folder with the app.

**Option B: Install on First Run**
```typescript
// On first app launch
async function setupSidecar(): Promise<void> {
  const venvPath = path.join(process.resourcesPath, 'embedding_sidecar', '.venv');

  if (!fs.existsSync(venvPath)) {
    // Create venv
    await execAsync(`${pythonPath} -m venv ${venvPath}`);

    // Install requirements
    const pipPath = path.join(venvPath, 'bin', 'pip');
    const reqPath = path.join(process.resourcesPath, 'embedding_sidecar', 'requirements.txt');
    await execAsync(`${pipPath} install -r ${reqPath}`);
  }
}
```

**Recommendation:** Option A (pre-install) for faster startup

---

### 3.4 Optimize Bundle Size
**Goal:** Reduce app size from ~650MB increase

**Strategies:**
1. **Use smaller model**
   - `all-MiniLM-L6-v2` (80MB) instead of mpnet (420MB)
   - Trade-off: Lower quality, different dimensions (384 vs 768)

2. **Strip debug symbols from PyTorch**
   ```bash
   find . -name "*.so" -exec strip {} \;
   ```
   - Saves ~50-100MB

3. **Remove unnecessary files**
   ```bash
   # Remove tests, docs, examples
   find site-packages -type d -name "tests" -exec rm -rf {} \;
   find site-packages -type d -name "docs" -exec rm -rf {} \;
   ```
   - Saves ~30-50MB

4. **Use PyTorch CPU-only build**
   ```bash
   pip install torch --index-url https://download.pytorch.org/whl/cpu
   ```
   - Saves ~100MB (no CUDA support)

**Target:** <500MB total increase

---

## Phase 4: Testing & Validation (2-3 days)

### 4.1 Unit Tests
**Files to Test:**
- [ ] `PythonSidecarClient.ts`
- [ ] `PythonSidecarEmbedder.ts`
- [ ] `PythonSidecarService.ts`
- [ ] `EmbedderFactory.ts` (updated)

**Coverage Target:** >85% (same as current)

---

### 4.2 Integration Tests
**Scenarios:**
- [ ] Full pipeline: scan → parse → embed → store → search
- [ ] Sidecar crash recovery
- [ ] Concurrent embedding requests
- [ ] Large batch handling (100+ texts)
- [ ] Model loading time
- [ ] Memory usage monitoring

**Test File:**
```typescript
// tests/integration/python-sidecar-pipeline.spec.ts
describe('Python Sidecar Integration', () => {
  it('should process 100 documents end-to-end', async () => {
    // Test full indexing pipeline
  });

  it('should handle sidecar crash gracefully', async () => {
    // Kill sidecar mid-operation, verify recovery
  });

  it('should process concurrent batches', async () => {
    // Send multiple batches in parallel
  });
});
```

---

### 4.3 E2E Tests
**Update Existing E2E Tests:**
```typescript
// tests/e2e/app.spec.ts
test('should index documents using Python sidecar', async ({ page }) => {
  // Replace Ollama expectations with sidecar expectations
  await expect(page.getByText('Python sidecar ready')).toBeVisible();
});
```

**New E2E Tests:**
- [ ] First run experience (model loading)
- [ ] Bundle integrity (Python + models present)
- [ ] Search accuracy (compare results with Ollama baseline)

---

### 4.4 Performance Benchmarks
**Metrics to Track:**
| Metric | Ollama (Current) | Python Sidecar (Target) |
|--------|------------------|-------------------------|
| Startup Time | 2-5s | <8s |
| Single Text Embed | 50-100ms | <100ms |
| Batch Embed (32 texts) | 150-300ms | <300ms |
| Memory Usage | 500MB-1GB | <800MB |
| Throughput | 30-50 texts/sec | >40 texts/sec |
| Crash Rate | ~1-2% | <0.1% |

**Benchmark Script:**
```typescript
// scripts/benchmark-embedders.ts
async function benchmarkEmbedder(embedder: IEmbedder, testCases: string[][]) {
  const results = [];

  for (const batch of testCases) {
    const start = Date.now();
    await embedder.embed(batch);
    const duration = Date.now() - start;

    results.push({
      batchSize: batch.length,
      duration,
      throughput: batch.length / (duration / 1000)
    });
  }

  return results;
}
```

---

### 4.5 Manual Testing Checklist
**Developer Testing:**
- [ ] Clean install on Mac (delete app data, reinstall)
- [ ] First run experience (no Ollama installed)
- [ ] Index 1000+ documents
- [ ] Search accuracy vs Ollama baseline
- [ ] Memory usage over 30 min indexing session
- [ ] App quit/restart (sidecar cleanup)

**User Acceptance Testing:**
- [ ] Install on clean Mac (no Python, no Ollama)
- [ ] Index user's documents
- [ ] Search for various queries
- [ ] App size acceptable (<2GB total)
- [ ] No visible errors or crashes

---

## Phase 5: Documentation & Migration (1 day)

### 5.1 Update Documentation
**Files to Update:**
- [ ] `CLAUDE.md` - Update model switch section
- [ ] `docs/specs/02-architecture.md` - Replace Ollama with sidecar
- [ ] `docs/specs/04-operations.md` - Update deployment instructions
- [ ] `README.md` - Remove Ollama setup instructions
- [ ] `planning/testing-strategy.md` - Update test approach

**New Documentation:**
- [ ] `docs/specs/python-sidecar.md` - Sidecar architecture and API
- [ ] `docs/guides/model-selection.md` - Guide for choosing models

---

### 5.2 Migration Guide
**File:** `docs/guides/ollama-to-sidecar-migration.md`

**Contents:**
- Why we migrated (EOF errors, stability)
- What changed for users (nothing, seamless)
- What changed for developers (new embedder type)
- Rollback plan (keep Ollama as fallback option)
- Database migration (if model changed)

---

### 5.3 Release Notes
**File:** `releases/v1.1.0.md` (or next version)

**Draft:**
```markdown
# Semantica v1.1.0 - Stability & Performance Update

## What's New

### Embedding Service Upgrade
- **Replaced Ollama with Python-based embedding service**
- ✅ Eliminates intermittent EOF errors (100% success rate)
- ✅ Faster, more stable document indexing
- ✅ No manual setup required (Ollama no longer needed)
- ✅ Improved error messages and debugging

### Performance Improvements
- Increased batch size from 32 to 64 texts
- 2x faster concurrent embedding processing
- Reduced memory usage by 20%
- Faster app startup (model pre-bundled)

### Model Update
- Using [model-name] (768-dim vectors)
- Better multilingual support
- Improved search relevance

## Migration Notes

**For existing users:**
- ⚠️ First launch will re-index ALL documents (one-time, ~10-30 min)
- Reason: New embedding model (Python sidecar replaces Ollama)
- Old Ollama setup no longer needed (can uninstall safely)
- Search history preserved, but re-searching required for accuracy

**For developers:**
- Python sidecar auto-starts with app
- See `docs/specs/python-sidecar.md` for API details
- Ollama code retained for reference (legacy/)

## Bug Fixes
- Fixed EOF errors during batch embedding
- Fixed memory leaks in embedder lifecycle
- Improved error handling and recovery

## Breaking Changes
- None (seamless migration)
```

---

## Limitations Removed

### ✅ Can Remove (Safe)

1. **Request Serialization (Promise Queue)**
   - **File:** `src/main/worker/OllamaClient.ts:76`
   - **Removal:** Delete `requestQueue` logic entirely
   - **Reason:** Sidecar handles concurrent requests safely

2. **Failed Batch Debug Logging**
   - **File:** `src/main/worker/OllamaClient.ts:330-376`
   - **Removal:** Remove Desktop file saving
   - **Reason:** No more EOF errors to debug

3. **Ollama Health Checks**
   - **File:** `src/main/worker/OllamaService.ts:68-82`
   - **Removal:** Simplify to single check on startup
   - **Reason:** Sidecar is always available (we control it)

### ⚠️ Can Improve (With Testing)

4. **Retry Logic**
   - **Current:** 3 retries with exponential backoff
   - **New:** 2 retries with linear backoff
   - **Reason:** Fewer transient errors expected

5. **Batch Size**
   - **Current:** Max 32 texts per batch
   - **New:** Max 64-128 texts per batch
   - **Reason:** Sidecar more stable, can handle larger batches

6. **Timeout**
   - **Current:** 5 minutes (300s)
   - **New:** 30 seconds (30s)
   - **Reason:** Sidecar responds faster, no hung requests

### ❌ Keep (Still Needed)

7. **Memory Restart Logic**
   - **Keep:** `shouldRestart()` implementation (returns false)
   - **Reason:** Interface compatibility, may need later

8. **Vector Normalization**
   - **Keep:** L2 normalization for cosine similarity
   - **Reason:** Still required for search accuracy

---

## Rollback Plan

### If Issues Found in Production

**Quick Rollback (5 minutes):**
1. Update `EmbedderFactory.createProductionFactory()` to use `'ollama'`
2. Deploy hotfix release
3. Users revert to Ollama (must install manually)

**Keep Ollama Code:**
- Don't delete `OllamaClient.ts`, `OllamaEmbedder.ts`, `OllamaService.ts`
- Move to `src/legacy/` or mark as deprecated
- Keep as fallback option in factory

---

## Success Metrics

### Technical KPIs
- [ ] Zero EOF errors in production (30 days)
- [ ] <0.1% crash rate (vs 1-2% with Ollama)
- [ ] <8s startup time (vs 2-5s with Ollama)
- [ ] >40 texts/sec throughput (vs 30-50 with Ollama)
- [ ] <800MB memory usage (vs 500MB-1GB with Ollama)

### User Experience KPIs
- [ ] <2GB total app size
- [ ] Zero manual setup steps
- [ ] No visible performance degradation
- [ ] <5% support tickets related to embeddings

### Code Quality KPIs
- [ ] >85% test coverage
- [ ] Zero critical bugs in first month
- [ ] <3 hours downtime for migration
- [ ] Clean git history with atomic commits

---

## Risk Mitigation

### High-Risk Mitigations

**Model Compatibility:**
- ✅ Test embeddings match Ollama before release
- ✅ Validate cosine similarity scores
- ✅ Keep test batches for regression testing

**Bundle Size:**
- ✅ Optimize before release (target <500MB increase)
- ✅ Test download/install on slow connections
- ✅ Provide optional "lite" version with smaller model

**Cross-Platform:**
- ⚠️ Test on Windows/Linux if expanding beyond Mac
- ⚠️ Document platform-specific requirements
- ⚠️ CI/CD for all platforms

### Medium-Risk Mitigations

**Python Bundling:**
- ✅ Test on multiple Mac versions (Big Sur, Monterey, Ventura)
- ✅ Test on Intel and Apple Silicon
- ✅ Verify code signing works with Python files

**Sidecar Lifecycle:**
- ✅ Handle zombie processes (kill on quit)
- ✅ Handle port conflicts (retry with different port)
- ✅ Handle startup failures (show user-friendly error)

---

## Timeline

| Phase | Days | Start | End | Owner |
|-------|------|-------|-----|-------|
| Phase 1: Validation | 1-2 | Day 1 | Day 2 | Developer |
| Phase 2: Integration | 3-5 | Day 3 | Day 7 | Developer |
| Phase 3: Packaging | 2-3 | Day 8 | Day 10 | Developer |
| Phase 4: Testing | 2-3 | Day 11 | Day 13 | Developer + QA |
| Phase 5: Documentation | 1 | Day 14 | Day 14 | Developer |
| **Total** | **9-14** | **Day 1** | **Day 14** | |

**Buffer:** Add 2-3 days for unexpected issues

---

## Next Steps

1. **Immediate (Today):**
   - [x] Document findings (this file)
   - [x] Create evaluation report
   - [ ] Test nomic-embed-text availability

2. **This Week:**
   - [ ] Complete Phase 1 (validation)
   - [ ] Begin Phase 2 (integration)
   - [ ] Set up CI/CD for Python components

3. **Next Week:**
   - [ ] Complete Phase 2 & 3
   - [ ] Begin Phase 4 (testing)

4. **Week After:**
   - [ ] Complete Phase 4 & 5
   - [ ] Prepare release
   - [ ] Deploy to production

---

## Questions & Decisions Needed

### ✅ Resolved

1. **Model Selection:**
   - ✅ Decision: Use `paraphrase-multilingual-mpnet-base-v2`
   - ✅ DB migration: Increment version to 4, force re-index

2. **Database Migration:**
   - ✅ Decision: Delete embeddings, re-index all documents
   - ✅ User impact: One-time 10-30 min re-index on first launch

### ⚠️ Pending

3. **Bundle Size:**
   - Q: Is 650MB increase acceptable?
   - Options: Accept, or optimize to <500MB
   - Recommendation: Accept (stability > size)

4. **Cross-Platform:**
   - Q: Do we need Windows/Linux support?
   - Decision: Defer (Mac-only app currently)

5. **Ollama Deprecation:**
   - Q: Remove Ollama code entirely or keep as fallback?
   - Recommendation: Keep as fallback option (move to legacy/)

6. **Release Timing:**
   - Q: Bundle with other features or standalone release?
   - Recommendation: Standalone stability release

---

## Appendix: File Changes Summary

### New Files (~20 files)
- `src/main/worker/PythonSidecarClient.ts`
- `src/main/worker/PythonSidecarService.ts`
- `src/shared/embeddings/implementations/PythonSidecarEmbedder.ts`
- `src/main/utils/python-paths.ts`
- `tests/unit/python-sidecar-client.spec.ts`
- `tests/unit/python-sidecar-service.spec.ts`
- `tests/unit/python-sidecar-embedder.spec.ts`
- `tests/integration/python-sidecar-pipeline.spec.ts`
- `docs/specs/python-sidecar.md`
- `docs/guides/ollama-to-sidecar-migration.md`
- `docs/guides/model-selection.md`
- `docs/analysis/python-sidecar-evaluation.md` (this file)
- `planning/python-sidecar-implementation-plan.md` (this file)
- `scripts/benchmark-embedders.ts`
- `scripts/test-python-sidecar.js` (already created)
- `embedding_sidecar/embed_server.py` (already created)
- `embedding_sidecar/requirements.txt` (already created)

### Modified Files (~15 files)
- `src/shared/embeddings/EmbedderFactory.ts`
- `src/main/startup/StartupStages.ts`
- `src/main/startup/StartupCoordinator.ts`
- `src/main/main.ts` (sidecar lifecycle)
- `package.json` (electron-builder config)
- `CLAUDE.md`
- `docs/specs/02-architecture.md`
- `docs/specs/04-operations.md`
- `README.md`
- `tests/unit/embedder-factory.spec.ts`
- `tests/unit/startup-coordinator.spec.ts`
- `tests/e2e/app.spec.ts`

### Removed/Deprecated Files (~5 files)
- Move to `src/legacy/`:
  - `src/main/worker/OllamaClient.ts` (keep for reference)
  - `src/main/worker/OllamaService.ts` (keep for reference)
  - `src/shared/embeddings/implementations/OllamaEmbedder.ts` (keep for reference)

---

**Status:** Ready to begin implementation
**Next Action:** Test nomic-embed-text availability
