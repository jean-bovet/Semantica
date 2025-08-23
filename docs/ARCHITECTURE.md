# Architecture Documentation

## System Overview

The Offline Mac Search application uses a multi-process architecture with memory isolation to ensure stable operation during large-scale document indexing.

## Architecture Diagram

```
Main Process (Electron)
    ├── BrowserWindow
    │   └── Renderer Process (React UI)
    │       ├── Search Interface
    │       ├── Settings Panel
    │       └── Results Display
    │
    └── Worker Thread
        ├── File Watching (Chokidar)
        ├── Document Parsing
        ├── LanceDB Operations
        └── Embedder Child Process (Isolated)
            └── Transformers.js (Memory-isolated)
```

## Core Components

### 1. Main Process (`app/electron/main.ts`)
- Manages application lifecycle
- Creates and controls BrowserWindow
- Handles IPC communication between renderer and worker
- Implements crash reporting
- File path: `dist/main.cjs`

### 2. Worker Thread (`app/electron/worker/index.ts`)
- Owns the LanceDB instance
- Manages file watching and indexing queue
- Handles search queries
- Monitors memory usage
- Spawns and manages embedder child process
- File path: `dist/worker.cjs`

### 3. Embedder Child Process (`app/electron/worker/embedder.child.ts`)
- **Isolated process for memory safety**
- Loads and runs the transformer model
- Processes text embeddings
- Automatically restarts when memory thresholds exceeded
- File path: `dist/embedder.child.cjs`

### 4. Renderer Process (`app/renderer/`)
- React-based user interface
- Real-time search with debouncing
- Settings management
- File type toggles

## Memory Management Strategy

### Process Isolation
The embedding model runs in a completely separate child process to prevent memory leaks from affecting the main application:

```typescript
class IsolatedEmbedder {
  // Thresholds for automatic restart
  shouldRestart = 
    rssMB > 900 ||        // RSS memory limit
    extMB > 150 ||        // External memory limit
    filesSinceSpawn > 200; // File count limit
}
```

### Memory Monitoring
Real-time memory tracking with automatic recovery:
- RSS (Resident Set Size) monitoring
- Heap usage tracking
- External memory (native buffers) monitoring
- Automatic child process restart when thresholds exceeded

## Data Flow

### Indexing Pipeline

The indexing system uses a carefully orchestrated mix of parallel and sequential processing:

#### File Discovery (Parallel)
- **Chokidar** watches multiple folders simultaneously
- Files are discovered in parallel and immediately queued
- All discovered files go into a central queue array

#### File Processing (Parallel with Limits)
Files are processed with **controlled parallelism** for optimal performance:
1. **Concurrent Processing**: Up to 5 files processed simultaneously
2. **Memory-Based Throttling**: Reduces parallelism if RSS > 800MB
3. **Per-File Pipeline**:
   - **Hash Check**: Skip if file hasn't changed since last index
   - **Content Extraction**: Parse PDF/TXT/MD/DOCX/RTF files
   - **Text Chunking**: Split into 500-char chunks with 60-char overlap
   - **Embedding Generation** (Batched):
     - Process chunks in batches of 8
     - Each batch sent to isolated child process
     - Wait for embeddings before next batch
   - **Vector Storage**: Store each batch in LanceDB with metadata
4. **Memory Monitoring**: Continuous checks with automatic throttling
5. **Status Updates**: Real-time progress (queued/processing/done)

#### Memory Management
- Child process auto-restarts after:
  - 500 files processed
  - RSS memory > 1500MB (1.5GB)
  - External memory > 300MB
- Restart is transparent - queue continues processing

### Search Pipeline
1. **Query Input**: User types in search box
2. **Debouncing**: 300ms delay to reduce queries
3. **Query Embedding**: Generate vector for search term
4. **Vector Search**: Find similar chunks in LanceDB
5. **Result Aggregation**: Group by file and score
6. **UI Update**: Display results with snippets

## File Storage

### Database Location
```
~/Library/Application Support/offline-mac-search/
├── data/
│   ├── chunks.lance/      # Vector database
│   └── config.json        # User configuration
└── Crashpad/              # Crash dumps
```

### Configuration Schema
```json
{
  "version": "1.0.0",
  "watchedFolders": ["..."],
  "settings": {
    "fileTypes": {
      "pdf": false,  // Disabled by default
      "txt": true,
      "md": true,
      "docx": true,
      "rtf": true,
      "doc": true
    },
    "excludePatterns": ["node_modules", ".git"]
  }
}
```

## Build System

### Development Build
- Vite for React with HMR
- esbuild for Electron files with watch mode
- Concurrent execution with proper sequencing

### Production Build
- TypeScript compilation
- Bundle optimization with esbuild
- Electron Builder for DMG creation

### Build Outputs
```
dist/
├── main.cjs           # Main process bundle
├── preload.cjs        # Preload script
├── worker.cjs         # Worker thread bundle
└── embedder.child.cjs # Embedder child process
```

## Security Features

### Process Isolation
- Context isolation enabled
- Node integration disabled in renderer
- Sandbox mode for renderer process
- Separate child process for embeddings

### Privacy
- No network requests during operation
- All processing happens locally
- Models stored offline
- No telemetry or analytics

## Performance Optimizations

### Batch Processing
- Process embeddings in batches of 8
- Yield to event loop between batches
- Immediate garbage collection after processing

### Memory Limits
- Worker restart at 1500MB RSS
- Embedder restart at 300MB external
- File-based restart after 500 documents

### Index Optimization
- Create ANN index when idle
- Debounced search queries
- Chunked text processing

## Error Handling

### Crash Recovery
- Electron crash reporter enabled
- Worker auto-restart on crash
- Embedder child process auto-restart
- Graceful degradation for unsupported files

### Logging
- Memory usage every 2 seconds
- File processing progress
- Error details with stack traces
- Crash dumps to Crashpad directory