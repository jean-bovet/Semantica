# Identifying Semantica Processes in Activity Monitor

## Process Architecture Overview

When Semantica is running, you'll see multiple processes in Activity Monitor:

```
Semantica (Main Process)
├── Semantica Helper (Renderer Process)
├── Semantica Helper (GPU Process)  
├── node (Worker Thread - same PID as Main)
└── node (Embedder Child Process - different PID)
```

## How to Identify Each Process

### 1. Main Electron Processes

| Process Name | Description | Memory Usage | How to Identify |
|-------------|-------------|--------------|-----------------|
| **Semantica** | Main Electron process | ~100-200MB | The parent process with the app name |
| **Semantica Helper (Renderer)** | Renderer process for UI | ~50-150MB | Child of main, handles React UI |
| **Semantica Helper (GPU)** | GPU acceleration | ~20-50MB | Child of main, handles graphics |
| **Semantica Helper** | Additional helper processes | Variable | May see multiple for extensions |

### 2. Node.js Processes

| Process Name | Description | Memory Usage | How to Identify |
|-------------|-------------|--------------|-----------------|
| **node** (Worker Thread) | File processing worker | 400-550MB+ | **Same PID** as Semantica main process |
| **node** (Embedder Process) | ML embeddings generation | 200-300MB | **Different PID**, child of main process |

## Quick Identification Tips

### Method 1: Check Process Hierarchy
1. In Activity Monitor, click View → All Processes, Hierarchically
2. Look for the Semantica process tree
3. The embedder will appear as a child `node` process
4. The worker thread won't appear separately (same PID as main)

### Method 2: Check Memory Usage
- **Embedder Process**: Consistently around 200-300MB (includes 113MB ML model)
- **Worker Thread**: Part of main process memory (400-550MB+ total)
- **Main Process Total**: Sum of all components (often 800MB-1GB+)

### Method 3: Check CPU Usage During Indexing
- **Embedder Process**: High CPU when generating embeddings
- **Worker Thread**: High CPU when parsing files (PDF, DOCX, etc.)

### Method 4: Use Terminal Commands

```bash
# Show all Semantica-related processes
ps aux | grep -i semantica

# Show process tree with PIDs
pstree -p $(pgrep -i semantica | head -1)

# Show node processes with parent PIDs
ps aux | grep node | grep -v grep
```

## Understanding Process Relationships

### Worker Thread (NOT a separate process)
- Shares memory space with main process
- Same PID as Semantica main process
- Memory counted in main process RSS
- Created with: `new Worker()`

### Embedder Child Process (IS a separate process)
- Isolated memory space
- Different PID from main process
- Own memory accounting
- Created with: `fork()`
- Auto-restarts when memory > 1500MB or 500 files processed

## Memory Breakdown Example

If Activity Monitor shows:
```
Semantica           - 850MB (RSS)
├── (includes worker thread memory)
└── node (embedder) - 250MB (RSS)

Total App Memory = 850MB + 250MB = ~1.1GB
```

Note: The 850MB includes BOTH the main process AND worker thread memory.

## Debugging Memory Issues

### To Monitor Worker Thread Memory
Since it shares the main process memory:
1. Check Semantica main process memory
2. Look for growth during file indexing
3. Logs show: `[WORKER Memory] RSS=427MB, Heap=108MB...`

### To Monitor Embedder Process Memory
Since it's a separate process:
1. Find the child `node` process under Semantica
2. Watch its independent memory usage
3. Logs show: `[EMBEDDER Memory] RSS=250MB, Heap=45MB...`

## Adding Process Titles for Easier Identification

To make processes easier to identify, we could add process titles:

```typescript
// In embedder.child.ts
process.title = 'Semantica-Embedder';

// In worker/index.ts (though won't show separately)
process.title = 'Semantica-Worker';
```

However, note that:
- macOS Activity Monitor may not always show custom titles
- Worker threads don't appear as separate processes
- The embedder child process title might show in `ps` commands

## Summary

- **Multiple "Semantica" processes**: Normal Electron multi-process architecture
- **"node" process with different PID**: The embedder child process
- **No separate worker process visible**: Worker thread shares main process
- **High memory usage**: Sum of all processes, worker thread leak contributes to main