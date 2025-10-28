# Build Optimization

> **⚠️ LEGACY DOCUMENT**: This document describes build optimizations for the old Transformers.js/ONNX architecture. The current implementation uses a Python sidecar with sentence-transformers. Kept for historical reference.

*Previous: [05-api-reference.md](./05-api-reference.md) | Next: [07-signing-distribution.md](./07-signing-distribution.md)*

---

## Executive Summary

Successfully reduced app size from **814MB to 607MB** (25% reduction) while maintaining full functionality. The distributed DMG is **192MB** (compressed). Fixed critical search functionality issues after optimization.

## Optimizations Completed

### ✅ Phase 1: Build Configuration
- **ASAR compression enabled** with maximum compression
- **Aggressive file exclusions** (removed tests, docs, cached models)
- **Native modules unpacked** for compatibility

### ✅ Phase 2: Single Package Architecture
```
/
  package.json          # All dependencies (dev + runtime)
  src/                  # Source code
    main/              # Main process code
    renderer/          # UI code
    shared/            # Shared modules
  dist/                # Built application code
```

**Benefits:**
- Single source of truth for dependencies
- Electron-builder v5+ handles dependency filtering
- Clean source/build separation
- No app/ folder mixing source and build artifacts

### ✅ Phase 3: JavaScript Bundling
- Bundled all parsers into `worker.cjs` (27KB)
- Tree-shaking enabled
- Removed parser dependencies from runtime

### ✅ Phase 4: Model Externalization
- Models download to `~/Library/Application Support/Semantica/models/`
- Not bundled with app (saves 135MB)
- Downloads on first search

### ✅ Phase 5: Search Functionality Fix

After optimization, search was broken due to embedder initialization failures. Fixed three critical issues:

1. **Worker thread Electron access**
   - Removed `require('electron')` from worker context
   - Used environment variables instead

2. **ASAR path resolution**
   ```typescript
   const childPath = process.env.NODE_ENV === 'production' 
     ? path.join(process.resourcesPath!, 'app.asar', 'dist', 'embedder.child.cjs')
     : path.join(__dirname, 'embedder.child.cjs');
   ```

3. **Cache directory configuration**
   ```typescript
   // embedder.child.ts - Critical fix
   transformers.env.localModelPath = process.env.TRANSFORMERS_CACHE;
   transformers.env.cacheDir = process.env.TRANSFORMERS_CACHE;  // Must set both!
   transformers.env.allowRemoteModels = true;
   ```

## Current Architecture

### Package Structure
```
dist-app/mac-arm64/Semantica.app/
├── Contents/
│   ├── Frameworks/              # 236MB - Electron
│   ├── Resources/
│   │   ├── app.asar            # 107MB - Compressed app code
│   │   └── app.asar.unpacked/  # 266MB - Native modules
│   │       └── node_modules/
│   │           ├── onnxruntime-node/  # 236MB
│   │           ├── @lancedb/          # 20MB
│   │           └── sharp/             # 10MB
```

### Model Download Flow
1. User performs first search
2. Embedder child process spawns
3. Transformers.js checks for models in cache
4. If missing, downloads from Hugging Face:
   - `config.json` (configuration)
   - `tokenizer.json` (17MB)
   - `onnx/model_quantized.onnx` (~50-100MB)
5. Models cached for future use

## Size Breakdown

| Component | Size | Notes |
|-----------|------|-------|
| Electron Framework | 236MB | Cannot reduce |
| ASAR (compressed) | 107MB | Application code |
| onnxruntime-node | 236MB | ML inference engine |
| @lancedb | 20MB | Vector database |
| sharp | 10MB | Image processing |
| **Total** | **607MB** | 25% reduction |
| **DMG (distributed)** | **192MB** | Compressed for download |

## Remaining Work

### 🔴 Critical: Model Download Progress

**Problem:** First search appears to hang while downloading models (~100MB)

**Solution Required:**
1. **Add download progress to UI**
   ```typescript
   // In embedder.child.ts
   transformers.env.progressCallback = (progress) => {
     process.send?.({ 
       type: 'download:progress', 
       percent: progress.progress,
       loaded: progress.loaded,
       total: progress.total
     });
   };
   ```

2. **Forward progress to renderer**
   ```typescript
   // In main.ts
   worker.on('message', (msg) => {
     if (msg.type === 'download:progress') {
       mainWindow.webContents.send('model:download:progress', msg);
     }
   });
   ```

3. **Show progress in UI**
   ```tsx
   // In React component
   {isDownloading && (
     <div className="model-download-progress">
       <p>Downloading AI model for first-time use...</p>
       <progress value={progress} max={100} />
       <p>{Math.round(progress)}% - {formatBytes(loaded)} / {formatBytes(total)}</p>
     </div>
   )}
   ```

### Optional Improvements

1. **Remove onnxruntime-web** (67MB unused)
   - Use patch-package to remove after install
   - Or fork @xenova/transformers

2. **Pre-package models** in resources/
   - Avoid first-run download
   - Increases app size but improves UX

3. **Implement retry logic** for failed downloads
   - Network interruptions
   - Timeout handling

## Testing Checklist

- [x] App launches correctly
- [x] Search functionality works
- [x] Embedder initializes properly
- [x] Models download to correct location
- [x] File parsers work
- [x] Memory management functions
- [ ] Model download progress shown to user
- [ ] Download retry on failure

## Commands

```bash
# Development
npm run dev

# Build for production
npm run build
npm run dist

# Check sizes
du -sh dist-app/mac-arm64/Offline\ Search.app  # Should be ~607MB
du -sh dist-app/*.dmg                           # Should be ~192MB
```

## Key Lessons Learned

1. **ASAR vs Unpacked**: Native modules must be unpacked, but this can cause duplication if not configured correctly
2. **Worker Context**: Workers can't access Electron APIs - use environment variables
3. **Cache Directories**: Read-only ASAR means external caches are essential
4. **Model Management**: Large ML models should be downloaded on-demand, not bundled
5. **Two-Package Structure**: Critical for separating dev and runtime dependencies

## Conclusion

Successfully optimized app size by 25% (207MB reduction) while fixing all functionality issues. The main remaining task is implementing model download progress UI to improve first-run user experience. The 607MB installed size is still large but acceptable given the ML components. The 192MB DMG is excellent for distribution.