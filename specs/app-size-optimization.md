# App Size Optimization Guide

## Current Size Analysis
**Total App Size**: 814MB (far too large for distribution)

### Breakdown
- **node_modules**: 576MB (71% of total)
  - @xenova/transformers: 266MB
    - Cached models: 135MB (should not be included!)
    - node_modules: 74MB
    - dist: 39MB
  - onnxruntime-node: 118MB (needed)
  - onnxruntime-web: 51MB (NOT needed for Electron)
  - @lancedb: 48MB (needed)
  - sharp: 24MB (needed by transformers)
  - pdf-parse: 14MB (includes test PDFs!)
  - Various parser dependencies: ~30MB
- **Electron Framework**: ~236MB
- **Application code**: 2.1MB

## Issues Identified

### 1. Cached ML Models in node_modules (135MB)
The @xenova/transformers package has downloaded models into its `.cache` folder:
- multilingual-e5-small: 113MB
- all-MiniLM-L6-v2: 22MB

These should NOT be distributed with the app - they should be downloaded on first run.

### 2. Unnecessary Dependencies (51MB+)
- **onnxruntime-web**: Not needed for Electron apps (51MB)
- **pdf-parse test files**: Includes sample PDFs in node_modules

### 3. ASAR Disabled (No Compression)
Due to native module issues, ASAR is disabled, meaning no compression.

### 4. Including All of node_modules
Currently including everything with `node_modules/**/*`

## Optimization Solutions

### Immediate Fixes (Save ~200MB)

1. **Exclude cached models from build**:
```json
{
  "build": {
    "files": [
      "dist/**/*",
      "node_modules/**/*",
      "!node_modules/@xenova/transformers/.cache/**",
      "!node_modules/**/test/**",
      "!node_modules/**/*.md",
      "!node_modules/**/*.ts",
      "!node_modules/**/.github/**",
      "!**/*.map"
    ]
  }
}
```

2. **Remove onnxruntime-web** (if not needed):
```bash
npm uninstall onnxruntime-web
```

3. **Use production install for building**:
```bash
npm ci --omit=dev
npm run dist
```

### Advanced Optimizations (Save ~300MB more)

1. **Bundle dependencies with webpack/esbuild**:
   - Bundle non-native dependencies into single file
   - Keep only native modules in node_modules
   - This would allow re-enabling ASAR

2. **Externalize models completely**:
   - Download models to user's app data on first run
   - Store in `~/Library/Application Support/offline-mac-search/models/`
   - Show progress during first-time setup

3. **Use electron-builder's two-package structure**:
   - Separate app dependencies from build dependencies
   - Use app/package.json for runtime deps only

4. **Prune unnecessary files more aggressively**:
```json
{
  "build": {
    "files": [
      "dist/**/*",
      "!node_modules/**/README.md",
      "!node_modules/**/CHANGELOG.md",
      "!node_modules/**/LICENSE*",
      "!node_modules/**/*.d.ts",
      "!node_modules/**/*.flow",
      "!node_modules/**/docs/**",
      "!node_modules/**/example/**",
      "!node_modules/**/examples/**",
      "!node_modules/**/__tests__/**"
    ]
  }
}
```

## Target Size
With optimizations: **~300-400MB** (from 814MB)
- Electron: 236MB (unavoidable)
- Essential native modules: ~100MB
- Application code: 2MB
- Runtime dependencies: ~50-100MB

## Implementation Priority

### Phase 1: Quick Wins (1 hour)
1. Exclude .cache folder from build ✅
2. Remove onnxruntime-web if unused ✅
3. Add file exclusion patterns ✅
**Expected reduction**: 200MB

### Phase 2: Model Management (2-3 hours)
1. Implement model downloader
2. Move models to app data directory
3. Add first-run experience
**Expected reduction**: 135MB

### Phase 3: Build Optimization (4-6 hours)
1. Implement two-package.json structure
2. Bundle non-native dependencies
3. Re-enable ASAR compression
**Expected reduction**: 100-150MB

## Notes
- The 814MB size is unacceptable for distribution
- Most users expect apps under 200MB, ideally under 100MB
- Current size would take 2+ minutes to download on average connection
- App Store might reject apps over 500MB without good reason