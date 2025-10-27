# System Architecture

*Previous: [01-overview.md](./01-overview.md) | Next: [03-implementation.md](./03-implementation.md)*

---

## System Overview

Semantica uses a multi-process architecture with memory isolation to ensure stable operation during large-scale document indexing. The UI follows a search-first philosophy where search functionality takes center stage, with settings and configuration accessible via modal overlays to maximize search result visibility.

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
        └── Python Sidecar (HTTP)
            └── FastAPI + sentence-transformers
```

## Core Components

### 1. Main Process (`src/main/main.ts`)
- Manages application lifecycle
- Creates and controls BrowserWindow
- Handles IPC communication between renderer and worker
- Implements crash reporting
- Enforces single instance with lock mechanism
- Build output: `dist/main.cjs`

#### Initialization Sequence (Critical)
The main process follows a strict initialization order to prevent IPC errors:

1. **Single Instance Lock** (`requestSingleInstanceLock()`)
   - Ensures only one instance runs at a time
   - Prevents database conflicts and resource duplication
   - Focuses existing window when second instance is attempted

2. **App Ready** (`app.whenReady()`)
   - Wait for Electron to be fully initialized
   - Create BrowserWindow

3. **Staged Worker Initialization (via StartupCoordinator)**
   - Uses staged initialization with individual timeouts per stage
   - Prevents single long operation from causing timeout
   - Stages progress sequentially with progress reporting:
     - `WORKER_SPAWN`: Worker thread created
     - `DB_INIT`: Database connection and config initialization
     - `DB_LOAD`: Loading existing indexed files (with progress %)
     - `FOLDER_SCAN`: Scanning configured folders
     - `SIDECAR_START`: Starting Python embedding sidecar
     - `SIDECAR_READY`: Sidecar health check passed
     - `READY`: All systems operational
   - **CRITICAL**: `app:ready` event sent only after ALL stages complete
   - UI shows loading spinner until `app:ready` received

4. **IPC Handler Registration**
   - Register all `ipcMain.handle()` handlers
   - Must be done BEFORE loading window content
   - Prevents "No handler registered" errors

5. **Load Window Content**
   - Load URL (development) or HTML file (production)
   - This happens LAST to ensure all handlers are ready

**Important**: Never load the window content before registering IPC handlers. The renderer process may attempt to call handlers immediately upon load, causing errors if handlers aren't registered yet.

### 2. Worker Thread (`src/main/worker/index.ts`)
- Entry point for the worker thread
- Coordinates between core business logic and services
- Manages lifecycle and initialization
- Build output: `dist/worker.cjs`

#### Core Business Logic (`src/main/core/`)
Organized by domain:
- **`indexing/`**: File scanning, status management, directory traversal
  - `FileScanner.ts`: Manages file processing pipeline
  - `fileStatusManager.ts`: Tracks file indexing status
  - `directoryScanner.ts`: Traverses directories for files
- **`embedding/`**: Embedding generation and queue management
  - `EmbeddingQueue.ts`: Manages embedding work queue
  - `ConcurrentQueue.ts`: Handles concurrent processing
  - `PerformanceProfiler.ts`: Profiles performance metrics
- **`reindex/`**: Re-indexing and folder management
  - `reindexManager.ts`: Determines when files need re-indexing
  - `ReindexOrchestrator.ts`: Coordinates re-indexing operations
  - `FolderRemovalManager.ts`: Handles folder removal from index

#### Application Services (`src/main/services/`)
- `ModelService.ts`: Handles model downloads sequentially
- `PipelineService.ts`: Formats pipeline status for monitoring
- `ReindexService.ts`: High-level re-indexing operations

### 3. Python Embedding Sidecar (`embedding_sidecar/embed_server.py`)
- **Isolated Python process for reliability**
- FastAPI HTTP server on port 8421
- sentence-transformers model (paraphrase-multilingual-mpnet-base-v2)
- Automatic startup and lifecycle management
- 100% reliability (no EOF errors or segfaults)

### 4. Startup System (`src/main/startup/`)
- `StartupCoordinator.ts`: Manages staged initialization
- `StartupStages.ts`: Defines startup stages and progress
- `telemetry.ts`: Collects startup metrics
- Key features:
  - Each stage gets its own timeout window
  - Progress events forwarded to UI
  - Telemetry for monitoring startup performance
  - Graceful error handling with specific stage failure info
  - Ensures `app:ready` only sent when truly ready

### 5. Renderer Process (`src/renderer/`)
- React-based user interface with search-first design
- Full-screen search view for maximum result visibility
- Real-time search with debouncing
- Settings accessible via modal overlay
- Status bar with real-time indexing statistics
- File type toggles and configuration in modal

#### UI Components Architecture

**SearchView** (`components/SearchView.tsx`)
- Main search interface with flexbox column layout
- Fixed header with search input
- Scrollable results area with native macOS elastic scrolling
- Manages panel open/close state and width

**ResultsList** (`components/ResultsList.tsx`)
- Flat list design replacing card-based layout
- Condensed rows showing: filename, score, action buttons
- Click handling for row selection
- Optimized button styling to prevent browser defaults

**DetailPanel** (`components/DetailPanel.tsx`)
- Slide-in panel from right (20-80% adjustable width)
- Resizable via drag handle on left edge
- Shows all matches for selected file
- Keyword highlighting in match context
- No overlay - results remain interactive

**Layout Strategy**
- Flexbox column: Header → Content → Status Bar
- Content area uses `flex: 1` with `min-height: 0` for proper overflow
- Panel adjusts results margin dynamically
- All components use `flex-shrink: 0` to maintain sizes

## Memory Management Strategy

### Python Sidecar Architecture
The application uses a Python-based embedding service for reliability and simplicity:

```
PythonSidecarService
  └── Python Process (FastAPI)
      ├── sentence-transformers model
      ├── Auto-managed memory (400-600MB stable)
      ├── HTTP API on port 8421
      └── Auto-restart on crash (optional)
```

**Key Benefits:**
- **Simple lifecycle**: Single Python process, no pooling needed
- **External memory management**: Python handles its own memory
- **No manual restarts**: Stable memory usage (<800MB)
- **Clear errors**: Python stack traces vs C++ crashes

### Memory Monitoring
Real-time memory tracking for the worker process:
- RSS (Resident Set Size) monitoring (1500MB limit)
- Heap usage tracking
- Memory-based throttling at 800MB
- Automatic concurrency adjustment

## Data Flow

### Indexing Pipeline

The indexing system uses a carefully orchestrated mix of parallel and sequential processing:

#### File Discovery (Parallel)
- **Chokidar** watches multiple folders simultaneously
- Files are discovered in parallel and immediately queued
- All discovered files go into a central queue array

#### File Processing (Parallel with Limits)
Files are processed with **controlled parallelism** for optimal performance:
1. **CPU-Aware Concurrency**: Automatically scales with system capabilities
   - Uses all CPU cores minus 1 (minimum 4 concurrent files)
   - Example: 8-core M2 = 7 concurrent, 10-core M1 Pro = 9 concurrent
2. **Memory-Based Throttling**: Reduces to 1/4 of cores if RSS > 800MB
3. **Per-File Pipeline**:
   - **Hash Check**: Skip if file hasn't changed since last index
   - **Content Extraction**: Parse PDF/TXT/MD/DOCX/RTF files
   - **Text Chunking**: Split into 500-char chunks with 60-char overlap
   - **Embedding Generation** (Batched):
     - Process chunks in batches of 32
     - Sent to Python sidecar via HTTP POST /embed
     - sentence-transformers generates 768-dim vectors
   - **Vector Storage**: Store each batch in LanceDB with metadata
4. **Memory Monitoring**: Continuous checks with automatic throttling
5. **Status Updates**: Real-time progress (queued/processing/done)

#### Memory Management
- **Worker Process**: Limited to 1500MB RSS
- **Python Sidecar**: Manages its own memory (~400-600MB stable)
  - No manual memory checks needed
  - Auto-restart on crash (optional)
  - External process isolation prevents worker memory impact
- **CPU-Aware Throttling**: Reduces concurrency at 800MB worker RSS
- Processing continues uninterrupted during any restarts

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
~/Library/Application Support/Semantica/
├── data/
│   ├── chunks.lance/      # Vector database
│   ├── file_status.lance/ # File indexing status tracking
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
      "pdf": true,
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

### File Status Tracking
The system maintains a database table to track the status of each file:
- **indexed**: Successfully parsed and indexed with chunk count
- **failed**: File was parsed but no content could be extracted
- **error**: An error occurred during parsing
- **queued**: File is waiting to be processed
- **processing**: File is currently being indexed
- **outdated**: Parser version upgraded, file needs re-indexing

#### Parser Version Tracking
The system tracks parser versions to automatically re-index files when parsers improve. When a parser is upgraded, files indexed with the older version are automatically queued for re-indexing. Failed files are retried periodically with newer parser versions.

For detailed parser implementations and version tracking, see [03-implementation.md](./03-implementation.md#parser-system).

### Known Limitations

#### Scanned PDFs
Many PDFs, especially those created by scanners (e.g., PaperStream Capture, Canon scanners), contain only images of text without actual text data. These PDFs will fail to index with the error "PDF contains no extractable text". 

**Identification**: These PDFs typically:
- Have very small or zero text content (only whitespace)
- Are created by scanner software
- Have large file sizes relative to page count
- Contain embedded images instead of text layers

**Current Behavior**: 
- Marked as "failed" in file status with error message
- Visible in file search with ⚠ warning icon
- Not searchable through semantic search

### Future Recommendations

#### 1. OCR Integration (High Priority)
Implement Optical Character Recognition for scanned documents:
- **Option A**: Integrate Tesseract.js for client-side OCR
  - Pros: No external dependencies, privacy-preserving
  - Cons: Slower processing, larger bundle size
- **Option B**: Use cloud OCR services (Google Vision, AWS Textract)
  - Pros: Fast, accurate, handles complex layouts
  - Cons: Requires internet, privacy concerns, costs
- **Option C**: Native macOS Vision framework integration
  - Pros: Fast, private, already on device
  - Cons: Platform-specific, requires native module

#### 2. Enhanced File Status Tracking
- Add "requires_ocr" status for scanned documents
- Implement retry queue for failed files
- Add user notification for files requiring manual intervention
- Track OCR processing separately from regular indexing

#### 3. File Format Detection Improvements
- Pre-check PDFs to determine if OCR is needed before attempting text extraction
- Detect encrypted or password-protected PDFs
- Better handling of corrupted files with specific error messages

#### 4. User Experience Enhancements
- Add bulk OCR processing option in settings
- Show preview of why files failed (e.g., "This PDF appears to be scanned")
- Provide actionable suggestions (e.g., "Run OCR on this file to make it searchable")
- Option to exclude certain folders from indexing if they contain mostly scanned documents

#### 5. Performance Optimizations for Large Archives
- Implement progressive indexing with priority queues
- Add file type statistics dashboard
- Memory usage optimization for processing many scanned documents
- Background OCR processing with lower CPU priority

## Build System

The application uses a two-package architecture with ASAR packaging for production. For detailed build configuration and optimization strategies, see [06-build-optimization.md](./06-build-optimization.md).

## Security Features

### Process Isolation
- Context isolation enabled
- Node integration disabled in renderer
- Sandbox mode for renderer process
- Separate child process for embeddings

### Single Instance Lock
Prevents multiple instances of the application from running simultaneously:

```typescript
const gotTheLock = app.requestSingleInstanceLock();
if (!gotTheLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    // Focus existing window when second instance is attempted
    if (win) {
      if (win.isMinimized()) win.restore();
      win.focus();
    }
  });
}
```

This ensures:
- Only one instance can access the database at a time
- Prevents file lock conflicts
- Avoids duplicate file watchers
- Eliminates confusion during development with file watchers

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