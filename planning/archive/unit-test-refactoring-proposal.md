# Unit Test Refactoring Proposal

## Executive Summary

After reviewing all 18 unit test files in `/tests/unit/`, we found that **56% of tests have issues with over-mocking**, where they test mock behavior instead of real code implementation. This document proposes specific solutions for each problematic test file.

## Current State Analysis

### Test Classification

| Category | Count | Percentage | Status |
|----------|-------|------------|--------|
| **Good Tests** (testing real code) | 8 | 44% | ✅ Keep as-is |
| **Highly Problematic** (mostly mocks) | 7 | 39% | 🔴 Need refactoring |
| **Moderately Problematic** (partial mocks) | 3 | 17% | 🟡 Need improvement |

### Good Tests (No Changes Needed)
These tests properly test real implementation with minimal/appropriate mocking:
- ✅ `bundle-exclusion.spec.ts` - Tests real ConfigManager
- ✅ `chunker.spec.ts` - Tests real text chunking algorithms
- ✅ `concurrent-queue.spec.ts` - Tests real concurrent processing
- ✅ `fast-unit-tests.spec.ts` - Tests real pure functions
- ✅ `file-types.spec.ts` - Tests real file type detection
- ✅ `memory-management.spec.ts` - Tests real memory calculations
- ✅ `parsers.spec.ts` - Tests real parsers with actual files
- ✅ `status-helpers.spec.ts` - Tests real UI helper functions

## Refactoring Proposals

### 1. `app-initialization.spec.ts`
**Current Problem:** Mocks ALL Electron modules (app, BrowserWindow, ipcMain, Worker)
**What it tests:** Only verifies mock functions are called in order
**Proposed Solution:** **MOVE TO INTEGRATION TESTS**

**Rationale:** 
- App initialization inherently involves Electron runtime
- Cannot be meaningfully tested without real Electron environment
- Integration test can use spectron or playwright for real Electron testing

**Action Items:**
1. Move to `/tests/integration/app-initialization.spec.ts`
2. Use Electron testing framework for real app startup
3. Keep only pure business logic tests (if any) in unit tests

---

### 2. `file-status-manager.spec.ts`
**Current Problem:** Mocks entire `node:fs` module
**What it tests:** Logic flow with fake filesystem
**Proposed Solution:** **HYBRID APPROACH**

**Rationale:**
- Core logic can be tested with in-memory data structures
- File I/O should be in integration tests

**Action Items:**
1. **Extract pure functions** for status management logic:
   ```typescript
   // New pure functions to extract:
   - validateFileStatus(status: FileStatus): boolean
   - mergeFileStatuses(existing: FileStatus, new: FileStatus): FileStatus
   - shouldUpdateStatus(existing: FileStatus, file: FileInfo): boolean
   ```
2. **Create unit tests** for pure functions without mocks
3. **Move I/O tests** to integration: `/tests/integration/file-status-io.spec.ts`
4. Use temporary directories for real file operations in integration tests

---

### 3. `file-status-migration.spec.ts`
**Current Problem:** Mocks fs operations and getFileHash
**What it tests:** Migration logic with fake filesystem
**Proposed Solution:** **REFACTOR CORE + INTEGRATION**

**Rationale:**
- Migration logic can be separated from I/O
- Real file operations belong in integration tests

**Action Items:**
1. **Extract migration logic** as pure functions:
   ```typescript
   // Extract these as pure functions:
   - planMigration(indexed: FileInfo[], statuses: FileStatus[]): MigrationPlan
   - validateMigration(plan: MigrationPlan): ValidationResult
   - generateMigrationBatches(files: FileInfo[], batchSize: number): FileInfo[][]
   ```
2. **Unit test** pure migration logic with data structures
3. **Integration test** for actual file migration with real files

---

### 4. `model-downloader.spec.ts`
**Current Problem:** Mocks fs, https, and worker_threads entirely
**What it tests:** Download flow with fake HTTP and file operations
**Proposed Solution:** **EXTRACT LOGIC + INTEGRATION**

**Rationale:**
- Download orchestration logic can be tested separately
- Real network/file operations need integration testing

**Action Items:**
1. **Extract download orchestration logic**:
   ```typescript
   // Pure functions to extract:
   - calculateDownloadOrder(files: ModelFile[]): ModelFile[]
   - validateDownloadedFile(file: ModelFile, content: Buffer): boolean
   - createDownloadPlan(missing: string[], baseUrl: string): DownloadPlan
   ```
2. **Create mock HTTP server** for integration tests (using msw or similar)
3. **Move to integration** for real download testing
4. Keep retry logic and state management in unit tests

---

### 5. `parser-version-tracking.spec.ts`
**Current Problem:** Mocks fs for all file operations
**What it tests:** Version tracking logic with fake files
**Proposed Solution:** **PURE FUNCTIONS EXTRACTION**

**Rationale:**
- Version comparison is pure logic
- File checks can use test fixtures

**Action Items:**
1. **Already has good separation** - enhance it:
   ```typescript
   // These are already pure, just remove fs mocks:
   - compareVersions(current: number, required: number): boolean
   - shouldReindexBasedOnVersion(fileVersion: number, parserVersion: number): boolean
   ```
2. **Use test fixtures** instead of mocking fs
3. Create actual test files with known versions

---

### 6. `reindex-service.spec.ts`
**Current Problem:** Mocks fs and parserVersions
**What it tests:** ReindexService with fake filesystem
**Proposed Solution:** **PURE LOGIC + TEST FIXTURES**

**Rationale:**
- Reindex decision logic is algorithmic
- Can use real files for hash calculation

**Action Items:**
1. **Extract decision logic**:
   ```typescript
   // Pure functions:
   - compareFileStates(current: FileState, previous: FileState): ReindexDecision
   - prioritizeReindexQueue(files: FileInfo[]): FileInfo[]
   ```
2. **Use temporary files** for hash calculation tests
3. Test with real file fixtures, not mocks

---

### 7. `startup-scan-behavior.spec.ts`
**Current Problem:** Mocks fs.statSync and shouldReindex
**What it tests:** Scan behavior with fake file stats
**Proposed Solution:** **TEST FIXTURES**

**Rationale:**
- Scan logic can work with real test directories
- File stats should be real for accurate testing

**Action Items:**
1. **Create test directory structure** in `/tests/fixtures/scan-test/`
2. **Use real files** with known properties
3. **Remove fs mocks** entirely
4. Test actual scanning behavior on real directory trees

---

### 8. `embeddings-adapter.spec.ts`
**Current Problem:** Uses mock embedding implementation
**What it tests:** Adapter interface with fake embeddings
**Proposed Solution:** **KEEP WITH IMPROVEMENTS**

**Rationale:**
- Testing adapter pattern is valid
- But should also test with real embedder in integration

**Action Items:**
1. **Keep current unit tests** for adapter interface
2. **Add integration test** with real embedder
3. **Document** that this tests the adapter pattern, not embeddings

---

### 9. `embeddings-orchestration.spec.ts`
**Current Problem:** Uses TestEmbedder instead of real embedder
**What it tests:** Orchestration with fake embedder
**Proposed Solution:** **DUAL APPROACH**

**Rationale:**
- Orchestration logic is valuable to test
- Real embedder tests belong in integration

**Action Items:**
1. **Keep orchestration tests** with TestEmbedder for:
   - Batching logic
   - Error handling
   - Retry mechanisms
2. **Add integration tests** for real embedding generation
3. **Clearly label** unit tests as "orchestration logic only"

---

### 10. `search.spec.ts`
**Current Problem:** Uses MockVectorSearch class
**What it tests:** Search interface with fake implementation
**Proposed Solution:** **MOVE TO INTEGRATION**

**Rationale:**
- Vector search inherently requires database
- Cannot meaningfully test without real vectors

**Action Items:**
1. **Move entirely to integration tests**
2. Use real LanceDB with test data
3. Create fixtures with known search results
4. Test actual vector similarity, not mocked behavior

---

## Implementation Priority

### Phase 1: Quick Wins (1-2 days)
1. **Move pure integration tests** (app-initialization, search)
2. **Add test fixtures** for parser-version-tracking, startup-scan-behavior
3. **Document test purposes** in embeddings tests

### Phase 2: Logic Extraction (3-4 days)
1. **Extract pure functions** from file-status-manager
2. **Refactor model-downloader** orchestration logic
3. **Extract migration logic** from file-status-migration

### Phase 3: Integration Tests (2-3 days)
1. **Create integration test suite** for moved tests
2. **Set up test infrastructure** (temp directories, mock servers)
3. **Write comprehensive integration tests**

## Success Metrics

After refactoring:
- **Unit tests** should have <10% mock usage
- **Unit tests** should run in <5 seconds total
- **Integration tests** should cover all I/O operations
- **Code coverage** should remain >85%
- **No test** should use `vi.fn()` to verify mock calls

## Benefits

1. **Increased Confidence:** Tests verify real behavior, not mock interactions
2. **Better Debugging:** Failures indicate real problems, not mock setup issues
3. **Cleaner Code:** Pure functions are easier to understand and maintain
4. **Faster Development:** Less time writing complex mock setups
5. **Real Edge Cases:** Discover actual filesystem/network edge cases

## Risks and Mitigations

| Risk | Mitigation |
|------|------------|
| Integration tests slower | Run in parallel, use CI for full suite |
| Flaky network tests | Use mock servers (msw) for predictable behavior |
| File system dependencies | Use temp directories, clean up properly |
| Increased complexity | Clear separation between unit and integration |

## Conclusion

This refactoring will transform our test suite from one that primarily validates mock behavior to one that truly tests our application's functionality. While it requires initial investment, the long-term benefits in reliability and maintainability far outweigh the costs.

The proposed approach maintains fast unit tests for business logic while properly testing I/O operations in integration tests, giving us the best of both worlds: fast feedback during development and comprehensive validation of real behavior.