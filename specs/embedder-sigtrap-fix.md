# Embedder SIGTRAP Fix Specification

## Problem Statement

When running the Semantica Electron application in development mode (`npm run dev`), the embedder child processes were crashing with SIGTRAP signals on macOS. This prevented the text embedding functionality from working properly during development.

### Symptoms
- Embedder processes exiting with signal SIGTRAP
- Console warnings about memory access: `mach_vm_read(0x..., 0x8000): (os/kern) invalid address`
- Embedder pool failing with "Embedder process exited" errors
- Indexing failing due to inability to generate embeddings

### Root Cause
The issue was caused by Electron's GPU process management interfering with Node.js child processes created via `fork()`. When Electron spawns child processes, it treats them as part of its renderer/GPU process hierarchy, leading to:
1. Memory inspection warnings from macOS security features
2. SIGTRAP signals (debugger breakpoint traps) killing the processes
3. Conflict between Electron's process management and Node.js child process expectations

## Solution: Spawn-Based Embedder

### Implementation Approach
Replace `fork()` with `spawn()` to completely bypass Electron's process management:

```typescript
// Old approach - uses Electron's process management
this.child = fork(childPath, [], { 
  execArgv: ['--expose-gc'],
  env: { ...process.env }
});

// New approach - bypasses Electron entirely
const nodePath = process.execPath.includes('Electron') ? 'node' : process.execPath;
this.child = spawn(nodePath, [childPath], { 
  stdio: ['pipe', 'pipe', 'pipe', 'ipc'],
  env: {
    ...process.env,
    ELECTRON_RUN_AS_NODE: '1',
    ORT_DISABLE_ALL_OPTIONAL_OPTIMIZERS: '1'
  }
});
```

### Key Changes

1. **Process Creation Method**
   - Uses `spawn()` instead of `fork()`
   - Directly invokes system Node.js binary
   - Maintains IPC channel via `stdio: ['pipe', 'pipe', 'pipe', 'ipc']`

2. **Environment Variables**
   - `ELECTRON_RUN_AS_NODE=1`: Forces pure Node.js mode
   - `ORT_DISABLE_ALL_OPTIONAL_OPTIMIZERS=1`: Disables ONNX optimizations that might trigger debugger

3. **Process Detection**
   - Checks if running under Electron: `process.execPath.includes('Electron')`
   - Falls back to system `node` command when under Electron
   - Uses `process.execPath` directly when running as pure Node.js

## Benefits

1. **Stability**: No more SIGTRAP crashes during development
2. **Performance**: Embedder processes run as pure Node.js, avoiding Electron overhead
3. **Memory Management**: Automatic restart mechanisms work properly
4. **Compatibility**: Works in both development and production environments

## Memory Management

The embedder includes automatic memory management:

### Thresholds
- **Memory limit**: Configurable via `maxMemoryMB` (default 1500MB)
- **File count limit**: Configurable via `maxFilesBeforeRestart` (default 500 files)

### Monitoring
- Memory checked every 10 files after the first 50
- Uses `ps` command to get actual RSS memory usage
- Restarts at 95% of memory limit to prevent crashes

### Restart Process
1. Graceful shutdown attempt (SIGTERM)
2. Force kill if necessary (SIGKILL)
3. Spawn new process
4. Reload model from cache

## Testing

The solution has been tested and verified to:
- ✅ Eliminate SIGTRAP crashes on macOS
- ✅ Maintain full IPC communication between parent and child
- ✅ Support automatic memory-based restarts
- ✅ Work in both development (`npm run dev`) and production builds
- ✅ Handle multiple concurrent embedder processes (pool of 2)

## File Changes

- **Modified**: `src/shared/embeddings/isolated.ts` - Replaced fork() with spawn() implementation
- **Modified**: `src/shared/embeddings/embedder-pool.ts` - Updated to use the fixed implementation

## Future Considerations

1. **Cross-Platform**: The spawn approach works on all platforms, not just macOS
2. **Electron Updates**: Monitor future Electron versions for proper fork() support
3. **Performance**: Consider using worker_threads for even better isolation (requires refactoring)

## References

- [Electron Issue #3782](https://github.com/electron/electron/issues/3782) - GPU process exit codes
- [Node.js child_process documentation](https://nodejs.org/api/child_process.html)
- [ONNX Runtime environment variables](https://onnxruntime.ai/docs/reference/env-vars.html)