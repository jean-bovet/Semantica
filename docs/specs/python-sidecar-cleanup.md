# Python Sidecar Architecture Cleanup

**Date**: October 28, 2025
**Status**: ✅ Complete

## Overview

This document captures the cleanup performed to remove obsolete code, configuration, and documentation related to the old Transformers.js/ONNX architecture after migrating to the Python sidecar approach.

## Motivation

During the Electron 38 upgrade, we identified that `ModelService.ts` was unused and could be removed. This prompted a comprehensive audit to find all obsolete code related to the legacy embedding architecture. The cleanup removes confusion for future developers and reduces maintenance burden.

## Files Deleted

### Source Code
- `src/main/services/ModelService.ts` - Handled HuggingFace model downloads (already removed during Electron upgrade)
- `scripts/download-model.js` - Downloaded Transformers.js models for testing
- `tests/mocks/setupModelMocks.ts` - Mocked HuggingFace downloads for E2E tests (unused)
- `tests/e2e/model-download.spec.ts` - Tested legacy model download flow (already removed during Electron upgrade)

### Empty Directories
- `resources/models/` - Empty directory for ONNX model storage

## Files Archived

Moved to appropriate archive directories with LEGACY markers:

### Scripts
- `scripts/ab-embed-benchmark.ts` → `scripts/archive/`
  - Memory leak testing for @xenova/transformers
  - Kept for historical reference on testing methodology

### Documentation
- `docs/specs/06-build-optimization.md` → `docs/specs/archive/`
  - Build size optimizations for Transformers.js/ONNX
  - Historical record of optimization techniques

### Planning Documents
- `planning/embedding-performance-optimization.md` → `planning/archive/`
  - Plan to optimize Transformers.js performance
  - Shows decision path that led to Python sidecar migration

## Files Modified

### Build Configuration

**esbuild.build.mjs**
- Removed: `'onnxruntime-node'` from external dependencies
- Removed: `'@xenova/transformers'` from external dependencies

**esbuild.watch.mjs**
- Removed: `'onnxruntime-node'` from external dependencies
- Removed: `'@xenova/transformers'` from external dependencies

**package.json**
- Removed: `extraResources` section (lines 136-143)
  - Was copying `resources/models/` directory to app bundle
  - No longer needed as Python sidecar manages models independently

### Documentation Updates

**README.md** (Line 200)
- Changed: `[Transformers.js](https://github.com/xenova/transformers.js) for local embeddings`
- To: `[sentence-transformers](https://www.sbert.net/) for local embeddings`

**docs/specs/02-architecture.md** (Line 98)
- Removed: `ModelService.ts: Handles model downloads sequentially`

**docs/specs/12-folder-structure.md**
- Removed: ModelService description (lines 135-138)
- Removed: `worker/modelDownloader.ts` → `services/ModelService.ts` from refactoring table

**docs/specs/04-operations.md** (Line 16)
- Added: Legacy note for model download section
  > **Note**: This section describes the legacy Transformers.js architecture. The current implementation uses a Python sidecar with sentence-transformers that manages model downloads independently.

**docs/specs/07-signing-distribution.md** (Line 205)
- Changed: "ONNX runtime, transformers.js"
- To: "LanceDB, Python sidecar"

## Dependencies Clean

### Verified No Obsolete Packages
Confirmed that `package.json` does NOT contain:
- ✅ `@xenova/transformers`
- ✅ `onnxruntime-node`
- ✅ Any other ONNX-related packages

All ML dependencies are now handled externally by the Python sidecar.

## Architecture: Before vs After

### Before (Transformers.js/ONNX)
```
Electron Worker
└── ModelService
    └── Downloads from HuggingFace
        ├── config.json
        ├── tokenizer_config.json
        ├── tokenizer.json
        ├── special_tokens_map.json
        └── model_quantized.onnx (~113MB)
    └── @xenova/transformers pipeline
        └── onnxruntime-node (WASM or Native)
```

### After (Python Sidecar)
```
Electron Worker
└── PythonSidecarService (HTTP client)
    └── Python FastAPI Server (port 8421)
        └── sentence-transformers
            └── Manages models in ~/.cache/huggingface/
```

## Benefits of Cleanup

1. **Reduced Confusion**: No obsolete code paths for future developers
2. **Smaller Codebase**: Fewer files to maintain and understand
3. **Clear Architecture**: Single source of truth for embedding approach
4. **Faster Builds**: Removed unnecessary external dependencies from esbuild config
5. **Accurate Documentation**: All docs reflect current Python sidecar architecture

## Verification

### Test Results After Cleanup

**Unit Tests**: ✅ All 509 tests passing
```bash
npm test
# Test Files  33 passed (33)
#      Tests  509 passed (509)
```

**E2E Tests**: ✅ All 5 tests passing
```bash
E2E_MOCK_DOWNLOADS=true E2E_MOCK_DELAYS=true npm run test:e2e
# 5 passed (29.7s)
```

**Build**: ✅ No errors
- All source code compiles successfully
- No broken imports or references
- Build configuration is clean

## Files Kept (Correctly)

These files remain because they document the historical context:

### Archive Documentation
- `docs/specs/archive/complete-specification-v2.md` - Original design
- `docs/specs/archive/memory-solution.md` - ONNX memory solutions
- `docs/specs/archive/transformers-memory-leak-analysis.md` - Detailed investigation
- All files in `docs/specs/archive/embedder/` - Legacy implementations

These provide valuable historical context on why the Python sidecar approach was chosen.

## Migration Path Reference

For anyone looking to understand the migration:

1. **Problem**: Transformers.js had memory leaks with ONNX runtime
   - See: `docs/specs/archive/transformers-memory-leak-analysis.md`

2. **Solution Attempts**: Various optimizations tried
   - See: `planning/archive/embedding-performance-optimization.md`
   - See: `scripts/archive/ab-embed-benchmark.ts` for testing methodology

3. **Final Solution**: Python sidecar with sentence-transformers
   - See: `docs/specs/python-sidecar.md`
   - Achieved: Stable memory, better performance, isolation

## Summary

Successfully removed all obsolete Transformers.js/ONNX code while preserving historical documentation. The codebase now has a single, clean embedding architecture (Python sidecar) with no confusing legacy paths.

**Files Changed**: 10 files
**Files Deleted**: 5 files
**Files Archived**: 3 files
**Test Status**: ✅ All passing (509 unit + 5 E2E)
**Build Status**: ✅ Clean

The cleanup is production-ready and fully verified.
