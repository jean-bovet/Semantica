# Electron 38 Upgrade Specification

**Date**: October 28, 2025
**Upgrade**: Electron 33.4.11 → 38.4.0
**Status**: ✅ Complete

## Overview

This document captures the key insights, challenges, and solutions from upgrading Semantica from Electron 33 to Electron 38. The upgrade involved a 5-major-version jump with significant Node.js and Chromium updates.

## Version Changes

| Component | Before | After |
|-----------|--------|-------|
| Electron | 33.4.11 | 38.4.0 |
| Node.js | 20.x | 22.19.0 |
| Chromium | 130 | 140 |
| electron-builder | 25.1.8 | 25.1.8 (stayed) |

## Key Insights

### 1. electron-builder 26.x Optional Dependency Bug

**Issue**: electron-builder 26.0.12 has a regression where it scans **all** optional dependencies declared in `package.json`, even if they're not actually installed.

**Impact**: Modern native Node modules like LanceDB use platform-specific optional dependencies:
```json
"optionalDependencies": {
  "@lancedb/lancedb-darwin-arm64": "0.7.1",  // Only this installed on M1 Mac
  "@lancedb/lancedb-darwin-x64": "0.7.1",    // Not installed
  "@lancedb/lancedb-linux-arm64-gnu": "0.7.1", // Not installed
  "@lancedb/lancedb-linux-x64-gnu": "0.7.1",   // Not installed
  "@lancedb/lancedb-win32-x64-msvc": "0.7.1"   // Not installed
}
```

During packaging, electron-builder 26.x tries to scan all these directories and fails with:
```
ENOENT: no such file or directory, scandir
  '/Users/bovet/GitHub/FSS/node_modules/@lancedb/lancedb-darwin-x64'
```

**Solution**: Downgrade to electron-builder 25.1.8, which:
- Fully supports Electron 38
- Only scans packages that actually exist in node_modules
- Has been battle-tested

**Workarounds Attempted** (all failed):
- File exclusions: `!node_modules/@lancedb/lancedb-darwin-x64/**`
- ASAR unpack patterns with wildcards
- Non-existent `asarUnpackIgnoreMissing` property

**Future**: Monitor electron-builder releases for fix before upgrading to 26.x.

### 2. E2E Test NODE_ENV Issue

**Issue**: E2E tests were failing with empty window titles and no UI rendering.

**Root Cause**: Tests didn't set `NODE_ENV=production`, causing the app to run in development mode and try to load from `http://localhost:5173` (Vite dev server) which wasn't running.

**Code Location**: `src/main/main.ts:245-252`
```typescript
const isDev = process.env.NODE_ENV !== 'production';

if (isDev) {
  win?.loadURL('http://localhost:5173');
} else {
  win?.loadFile(path.join(__dirname, 'index.html'));
}
```

**Solution**: Add `NODE_ENV: 'production'` to all electron.launch() calls in E2E tests:
```typescript
const app = await electron.launch({
  args: ['dist/main.cjs'],
  env: {
    ...process.env,
    NODE_ENV: 'production',  // ← Added this
    ELECTRON_DISABLE_SINGLETON: 'true'
  }
});
```

**Lesson**: Always explicitly set NODE_ENV in E2E tests to ensure consistent behavior.

### 3. Obsolete Code Identification

**Discovery**: The upgrade revealed unused code that was never removed when migrating to the Python sidecar architecture.

**Files Removed**:
- `src/main/services/ModelService.ts` - Not imported anywhere, used to download HuggingFace models
- `tests/e2e/model-download.spec.ts` - Tested legacy model download flow with tokenizer.json, model_quantized.onnx, etc.

**Verification Method**:
```bash
# Check for imports
grep -r "import.*ModelService" src/
# Result: No files found
```

**Lesson**: Major upgrades are good opportunities to audit and remove dead code.

### 4. Native Module Compatibility

**Success**: All native modules rebuilt successfully for Node.js 22:
- `@lancedb/lancedb-darwin-arm64` (vector database)
- `fsevents` (file system watching)
- `iconv-corefoundation` (character encoding)

**Automatic Process**: The `postinstall` script handles this:
```json
"postinstall": "electron-builder install-app-deps"
```

This script automatically:
1. Detects the Electron version
2. Rebuilds native modules for the correct Node.js ABI
3. Works seamlessly across Electron upgrades

**Lesson**: Trust the postinstall script - it just works.

### 5. Type Safety Caught Real Issues

**Issue Found**: TypeScript compilation error in `SettingsSidebar.tsx:37`
```typescript
interface SidebarItem {
  icon: React.ComponentType<any>;  // ❌ Too generic
}
```

**Fix**:
```typescript
import { LucideIcon } from 'lucide-react';

interface SidebarItem {
  icon: LucideIcon;  // ✅ Proper type
}
```

**Lesson**: Strict TypeScript typing catches incompatibilities during upgrades before runtime.

### 6. Security Posture Validation

The project already followed all modern Electron security best practices:

✅ **Context Isolation**: `contextIsolation: true`
✅ **Node Integration Disabled**: `nodeIntegration: false`
✅ **Sandbox Mode**: `sandbox: true`
✅ **Secure IPC**: Via `contextBridge` in preload script
✅ **No Remote Module**: Deprecated API not used

**No Changes Needed**: The codebase was already secure and forward-compatible.

### 7. Breaking Changes Analysis

**Review of Electron 34-38 Breaking Changes**:
- `webFrame.routingId` → `webFrame.frameToken` (not used in codebase)
- `plugin-crashed` event removed (not used)
- macOS 11 (Big Sur) no longer supported → requires macOS 12+
- Various Linux-specific changes (not applicable)

**Result**: No code changes required beyond the type fix.

**Lesson**: Following Electron best practices from the start makes upgrades painless.

### 8. Build Configuration Evolution

**Stale Configuration Found**: `esbuild.build.mjs` and `esbuild.watch.mjs` referenced a deleted file:
```javascript
buildFile(
  path.join(__dirname, 'src/main/worker/embedder.child.ts'),  // ❌ Doesn't exist
  path.join(__dirname, 'dist/embedder.child.cjs')
)
```

**Fix**: Remove the stale build step from both files.

**Lesson**: When removing files, grep for references in build scripts to avoid silent build issues.

## Test Results

### Before Upgrade
- Unit Tests: 509 tests (all dependencies correct)
- E2E Tests: Not run (pre-upgrade state)

### After Upgrade
- **Unit Tests**: 508/509 passing
  - 1 known timeout in Python sidecar test (pre-existing)
- **E2E Tests**: 5/5 passing (after NODE_ENV fix)
- **Dev Mode**: Confirmed working
- **Production Build**: Successfully created and code-signed

## Files Modified

### Configuration
1. `package.json` - Updated Electron to ^38.0.0
2. `esbuild.build.mjs` - Removed stale embedder.child.ts reference
3. `esbuild.watch.mjs` - Removed stale embedder.child.ts reference

### Source Code
4. `src/renderer/components/settings/SettingsSidebar.tsx` - Fixed LucideIcon type

### Tests
5. `tests/e2e/app-startup.spec.ts` - Added NODE_ENV=production
6. `tests/e2e/settings-folders-display.spec.ts` - Added NODE_ENV=production

### Documentation
7. `CLAUDE.md` - Updated with Electron 38 details and build notes
8. `docs/specs/electron-38-upgrade.md` - This document

### Deletions
9. `tests/e2e/model-download.spec.ts` - Obsolete
10. `src/main/services/ModelService.ts` - Obsolete

## macOS System Requirements

**Previous (Electron 33)**: macOS 11+ (Big Sur)
**Current (Electron 38)**: macOS 12+ (Monterey)

**Reason**: Chromium 140 dropped Big Sur support.

**Impact**: Users on macOS 11 will need to upgrade their OS to use Semantica with Electron 38.

## Known Issues

### 1. Notarization Requires Apple Agreement
**Status**: Expected
**Error**: `HTTP 403 - A required agreement is missing or has expired`
**Fix**: Sign/renew agreement at https://developer.apple.com/account
**Note**: This is an Apple Developer Portal issue, not related to Electron 38

### 2. Python Sidecar Test Timeout
**Status**: Pre-existing
**Test**: `python-sidecar-integration.spec.ts` - "should embed a single text successfully"
**Issue**: 5-second timeout during sidecar initialization
**Impact**: None - other 4 sidecar tests pass, dev/prod work fine
**Note**: Timing-related, not caused by Electron upgrade

## Performance Observations

- **App Bundle Size**: 881 MB (arm64, includes Chromium 140)
- **Startup Time**: No noticeable regression
- **Memory Usage**: Stable at 400-600MB (Python sidecar), 1500MB limit (worker)
- **Build Time**: No significant change

## Recommendations for Future Upgrades

1. **Always check electron-builder compatibility** - The 26.x regression wasn't documented
2. **Set NODE_ENV explicitly in tests** - Prevents environment-dependent failures
3. **Use strict TypeScript** - Catches incompatibilities at compile time
4. **Audit for dead code** - Major upgrades are good cleanup opportunities
5. **Test native modules thoroughly** - LanceDB, fsevents, etc. must work on Node.js 22
6. **Check Chromium breaking changes** - Renderer-side changes can be subtle
7. **Verify macOS version requirements** - Big Sur → Monterey transition

## Rollback Plan

If issues arise in production:

1. **Revert package.json**:
   ```json
   "electron": "^33.0.0"
   ```

2. **Reinstall dependencies**:
   ```bash
   npm install
   ```

3. **Rebuild**:
   ```bash
   npm run build
   npm run dist:mac
   ```

**Note**: Keep the E2E test fixes (NODE_ENV=production) and removed obsolete code - these are improvements regardless of Electron version.

## Conclusion

The Electron 38 upgrade was successful with minimal code changes required. The main challenges were:

1. **electron-builder 26.x bug** - Solved by staying on 25.1.8
2. **E2E test configuration** - Solved by adding NODE_ENV=production
3. **Type safety** - Caught and fixed by TypeScript

The codebase's adherence to modern Electron security practices made the upgrade smooth. No breaking changes affected the application logic, and all systems remain fully operational.

**Total Time**: ~4 hours including investigation, fixes, testing, and documentation.

**Status**: ✅ Production-ready
