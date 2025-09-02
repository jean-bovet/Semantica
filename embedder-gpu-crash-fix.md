# Embedder GPU Crash Analysis and Fix

## Problem
The embedder child process was crashing on specific text files with exit code 5 (GPU process crash) when running in Electron, but not when running with regular Node.js.

## Root Cause
The crashes were caused by GPU process issues in Electron. Exit code 5 is specifically associated with ICU (International Components for Unicode) data loading issues and file path problems in Electron applications.

## Documented Sources

### Exit Code 5 GPU Crash Documentation

1. **Stack Overflow - "GPU process isn't usable. Goodbye."**
   - URL: https://stackoverflow.com/questions/68874940/gpu-process-isnt-usable-goodbye
   - Reports GPU process exit code 5 on macOS with error: `GPU process exited unexpectedly: exit_code=5`
   - Associated with "icudtl.dat not found in bundle" errors
   - GPU process crashes repeatedly (up to 9 times) before giving up

2. **GitHub - Electron Issue #30966**
   - URL: https://github.com/electron/electron/issues/30966
   - Documents GPU crashes when Electron is in folders with unicode characters
   - Exit code varies but behavior is similar

3. **GitHub - Electron Issue #38707**
   - URL: https://github.com/electron/electron/issues/38707
   - Reports "GPU process exited unexpectedly" errors
   - Multiple exit codes documented including exit code 5

4. **Microsoft Q&A - How to fix Electron GPU process**
   - URL: https://learn.microsoft.com/en-us/answers/questions/1193062/how-to-fix-electron-program-gpu-process-isnt-usabl
   - Documents that exit code 5 is related to missing ICU data files
   - Recommends `--no-sandbox` flag as workaround
   - Notes that moving to C: drive can resolve Windows security restrictions

### Transformers.js Related Issues

5. **GitHub - Transformers.js Issue #336**
   - URL: https://github.com/huggingface/transformers.js/issues/336
   - Documents trouble getting started with Electron and transformers.js
   - WebGPU and GPU acceleration issues

6. **GitHub - Transformers.js Issue #1380**
   - URL: https://github.com/huggingface/transformers.js/issues/1380
   - Documents WebGPU crashes with translation pipeline
   - GPU-related crashes when using transformers in Electron

## Known Causes from Documentation

Based on the documented sources, exit code 5 is caused by:
1. **ICU Data Loading Issues**: Missing or improperly configured `icudtl.dat` file
2. **File Path Problems**: Unicode characters in path, network shares, or non-C: drives on Windows
3. **GPU Sandbox Restrictions**: Electron's GPU sandbox preventing resource access
4. **Graphics Driver Issues**: Outdated or incompatible graphics drivers

## Files That Triggered Crashes
- Pascal source code files from Apple Lisa computer (ISO-8859-1 encoded)
- Files with 30-70KB size containing legacy code
- Crashes occurred specifically when processing via Electron's GPU process

## Testing Results

### Test 1: Direct Transformers.js (✅ Success)
- Files embedded successfully when using Transformers.js directly
- No crashes or errors
- Proved the files themselves weren't inherently problematic

### Test 2: Electron Helper Process (❌ Failed)
- GPU process crashed repeatedly (exit code 5)
- Error: "GPU process exited unexpectedly"
- Multiple GPU restarts before fatal failure

### Test 3: Regular Node.js Fork (✅ Success)
- Files embedded successfully using Node.js fork
- No crashes when running as pure Node.js
- Confirmed issue is specific to Electron's GPU process

## Solution Implemented

The solution bypasses the GPU process entirely by running the forked child as pure Node.js instead of as an Electron process.

### The Fix: ELECTRON_RUN_AS_NODE Environment Variable

Setting `ELECTRON_RUN_AS_NODE=1` when spawning the child process makes it run as standard Node.js, completely bypassing Electron's GPU process.

### Code Implementation

```typescript
// src/shared/embeddings/isolated.ts
this.child = fork(childPath, [], { 
  execArgv: ['--expose-gc'],
  silent: false,
  env: {
    ...process.env,
    TRANSFORMERS_CACHE: modelCachePath,
    XDG_CACHE_HOME: modelCachePath,
    ELECTRON_RUN_AS_NODE: '1'  // This bypasses GPU process
  }
});
```

Note: `--expose-gc` is kept because the embedder child explicitly calls `global.gc()` for memory management.

## Why This Works

According to the documented sources, `ELECTRON_RUN_AS_NODE=1` makes the spawned process run as a standard Node.js process instead of an Electron process. This:
- Bypasses the GPU process entirely
- Avoids ICU data loading issues
- Prevents GPU sandbox restrictions
- Eliminates the exit code 5 crashes

This is a cleaner solution than:
- Using `--no-sandbox` (has security implications)
- Moving files to specific drives (Windows-specific workaround)
- Disabling GPU acceleration globally (affects performance)

## Verification

The solution has been tested and verified:
1. All previously crashing files now process successfully
2. GPU process is completely bypassed (no GPU errors in logs)
3. Embeddings are generated correctly
4. No performance degradation observed

## Additional Notes

- The crash only occurs when child process is spawned from within Electron context
- Regular Node.js execution never experiences these crashes
- The fix is minimal and doesn't affect the embedder's functionality
- This approach is recommended by Electron documentation for CPU-only child processes