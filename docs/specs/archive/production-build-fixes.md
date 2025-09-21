# Production Build Fixes

## Issue Summary
After building the production app with `npm run dist`, the application had multiple issues preventing it from working:
1. Search bar was not visible
2. Search queries resulted in timeout errors
3. Embedder failed to initialize

## Root Causes and Solutions

### 1. NODE_ENV Not Set to Production
**Problem**: The app was trying to load `http://localhost:5173/` (development server) instead of the production HTML file.

**Root Cause**: The esbuild configuration wasn't setting `NODE_ENV` to 'production', causing the app to use development paths.

**Solution**: Added environment variable definition to `esbuild.build.js`:
```javascript
define: {
  'process.env.NODE_ENV': '"production"'
}
```

### 2. Incorrect HTML File Path
**Problem**: The app tried to load `file:///Applications/Offline%20Search.app/Contents/Resources/app.asar/index.html` but got ERR_FILE_NOT_FOUND.

**Root Cause**: The production code was looking for `../index.html` relative to `main.cjs`, but the HTML file was in the same directory.

**Solution**: Fixed path in `app/electron/main.ts`:
```typescript
// Changed from:
win.loadFile(path.join(__dirname, '../index.html'));
// To:
win.loadFile(path.join(__dirname, 'index.html'));
```

### 3. Native Module Dependencies Not Found
**Problem**: Embedder initialization failed with "Error: Cannot find module 'color-name'".

**Root Cause**: The `sharp` module (used by transformers) couldn't find its transitive dependencies. This is a known issue with electron-builder when packaging native modules with complex dependency trees.

**Solutions Attempted**:
1. **Added node_modules to build files** - Ensured dependencies were included
2. **Tried various asarUnpack patterns** - Attempted to unpack native modules from ASAR
3. **Added explicit dependency** - Installed `color-name` as a direct dependency
4. **Disabled ASAR packaging** - Final working solution

**Final Solution**: 
- Added `color-name` to package.json dependencies: `"color-name": "^2.0.0"`
- Disabled ASAR packaging in package.json: `"asar": false`

## Configuration Changes

### package.json
```json
{
  "dependencies": {
    // ... other dependencies
    "color-name": "^2.0.0"  // Added to resolve module resolution issue
  },
  "build": {
    // ... other build config
    "files": [
      "dist/**/*",
      "node_modules/**/*",  // Include all node_modules
      "!**/*.map"
    ],
    "asar": false  // Disabled to avoid native module issues
  }
}
```

### esbuild.build.js
```javascript
async function buildFile(entry, outfile) {
  await build({
    // ... other config
    define: {
      'process.env.NODE_ENV': '"production"'  // Added for production detection
    }
  });
}
```

## Trade-offs and Considerations

### ASAR Packaging Disabled
While disabling ASAR is not the ideal solution (as noted by electron-builder warnings), it was necessary due to:
- Complex dependency resolution issues with sharp and its transitive dependencies
- The `color-name` module being required by `color-convert`, which is required by `color`, which is required by `sharp`
- electron-builder's asarUnpack patterns not properly handling nested dependencies

**Impact**:
- ✅ App works correctly with all features
- ⚠️ Slightly larger app size (files not compressed)
- ⚠️ Source code more easily accessible (though already minified)

**Future Improvements**:
- Consider migrating to Electron Forge with @electron-forge/plugin-auto-unpack-natives
- Investigate alternative embedding libraries that don't depend on sharp
- Consider bundling sharp's dependencies differently

## Testing Checklist
After building with `npm run dist`:
1. ✅ App launches without errors
2. ✅ Search bar is visible
3. ✅ Worker initializes successfully
4. ✅ Embedder initializes without module errors
5. ✅ Search queries return results without timeout
6. ✅ File indexing works correctly

## Build Commands
```bash
# Development
npm run dev

# Production build
npm run build  # Compiles TypeScript and bundles
npm run dist   # Creates distribution package

# Install from DMG
open dist-app/Offline\ Search-*.dmg
# Copy app to Applications folder
```

## Known Issues
- Some .doc files fail to parse (unrelated to build issues)
- ASAR packaging disabled (performance/security trade-off)

## Date
2025-08-25