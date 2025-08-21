# SwiftUI + Python Integration Guide

## Current Implementation Status ✅

This guide documents the **fully implemented solution** using an async CLI-based integration between SwiftUI and Python with JSON communication. The system supports concurrent search during indexing, real-time progress updates, and incremental indexing.

### Recent Fixes

#### Progress Bar Updates (2025-08-21)

**Issue**: Progress bar wasn't updating during indexing despite receiving status messages.

**Root Cause**: The Swift code was incorrectly accepting ANY JSON response with a `success` field as the final response, including status messages like `{"status": "initialized", "success": true}`. This caused indexing to return immediately with 0 documents.

**Solution**: Modified `PythonCLIBridge.swift` to only accept responses where the `action` field matches the sent command. For example, when sending `{"action": "index"}`, only responses with `"action": "index"` are treated as final responses. Status messages without matching actions are now properly processed as progress updates.

**Files Changed**: 
- `PythonCLIBridge.swift`: Added `expectedAction` tracking and action matching in both `sendCommandAndWait` and `sendCommandAndWaitWithProgress` methods

#### Python Process Cleanup (2025-08-21)

**Issue**: Python processes remained running after app termination, becoming orphaned processes. The indexing process in particular would run at 100% CPU and require force quit.

**Root Cause**: 
1. The app's cleanup code was async and didn't guarantee process termination before the app quit
2. The indexing process was CPU-bound in a tight loop, not responding to SIGTERM signals
3. Python's ThreadPoolExecutor threads don't check for termination signals while executing

**Solution**: Implemented a comprehensive three-pronged approach:

1. **Swift Side - Force Kill Mechanism**: 
   - Added `AppDelegate` with `applicationWillTerminate` to handle app termination
   - Created static `forceStop()` method that:
     - First sends SIGTERM for graceful shutdown
     - Waits 100ms for voluntary termination
     - Then sends SIGKILL to force terminate unresponsive processes
   - Track all active processes in a static array for cleanup

2. **Python Side - Signal Handling**:
   - Added signal handlers for SIGTERM and SIGINT
   - Set `should_exit` flag when signals received
   - Force shutdown ThreadPoolExecutor with `wait=False`
   - Added `atexit` cleanup handler
   - Parent process monitoring as backup (checks if parent died every 2 seconds)

3. **Cooperative Cancellation in Tight Loops**:
   - Added `should_stop_callback` to DocumentProcessor and SearchEngine classes
   - The indexing loop (`as_completed` in `process_directory_incremental`) now:
     - Checks `should_exit` flag on each iteration
     - Cancels remaining futures when stop is requested
     - Exits cleanly with status message
   - CLI sets the callback: `self.search_engine.should_stop_callback = lambda: self.should_exit`

**Implementation Details**:

```swift
// PythonCLIBridge.swift - Force kill after grace period
static func forceStop() {
    for process in activeProcesses {
        if process.isRunning {
            let pid = process.processIdentifier
            process.terminate()  // SIGTERM
            usleep(100_000)     // Wait 100ms
            if process.isRunning {
                kill(pid, SIGKILL)  // Force kill
            }
        }
    }
}
```

```python
# document_processor.py - Cooperative cancellation in loop
for future in as_completed(future_to_file):
    # Check if we should stop
    if self.should_stop_callback and self.should_stop_callback():
        # Cancel all remaining futures
        for f in future_to_file:
            f.cancel()
        print(json.dumps({"status": "indexing_cancelled"}), flush=True)
        break
```

**Files Changed**:
- `FinderSemanticSearchApp.swift`: Added AppDelegate with termination handler
- `PythonCLIBridge.swift`: Added force kill with SIGKILL fallback
- `cli.py`: Added signal handlers, atexit cleanup, and parent monitoring
- `document_processor.py`: Added should_stop_callback and cancellation checks in loop
- `search.py`: Added should_stop_callback propagation to document processor

**Benefits**:
- Clean termination when possible (cooperative cancellation)
- Guaranteed termination even for CPU-bound processes (SIGKILL)
- No orphaned processes even during intensive indexing operations
- Responsive to shutdown requests even in tight loops

## Architecture Overview

```
SwiftUI App (Swift/Objective-C)
    ↓
PythonCLIBridge (Process Management)
    ↓
cli_standalone.py (Bootstrap & Dependency Management)
    ↓
cli.py (Main CLI with JSON Mode)
    ↓
Search Engine (Python Core Logic)
```

## Key Components

### 1. PythonCLIBridge.swift

Manages the Python subprocess and handles bidirectional communication:

```swift
class PythonCLIBridge: ObservableObject {
    private var process: Process?
    private var inputPipe: Pipe?
    private var outputPipe: Pipe?
    
    func start() async throws {
        // Launch cli_standalone.py with system Python
        process?.executableURL = URL(fileURLWithPath: "/usr/bin/python3")
        process?.arguments = [standaloneCliPath, "interactive", "--json-mode"]
    }
    
    func sendCommandAndWait(_ command: [String: Any]) async throws -> CLIResponse {
        // Send JSON command and parse multiple JSON objects in response
        // Handles both status messages and actual responses
    }
}
```

### 2. cli_standalone.py

Bootstrap script that ensures dependencies are installed:

```python
def ensure_dependencies():
    venv_dir = get_app_venv_dir()  # ~/Library/Application Support/FinderSemanticSearch/venv
    
    if not venv_dir.exists():
        # Create virtual environment
        subprocess.run([sys.executable, "-m", "venv", str(venv_dir)])
    
    if not marker_file.exists():
        # Install dependencies
        packages = ["faiss-cpu", "sentence-transformers", "PyPDF2", ...]
        for package in packages:
            pip_path.install(package)
```

#### Data Storage Locations

The application stores its data in the macOS Application Support directory:

- **Virtual Environment**: `~/Library/Application Support/FinderSemanticSearch/venv/`
- **Search Index**: `~/Library/Application Support/FinderSemanticSearch/data/index/`
  - `faiss.index` - Main FAISS vector index
  - `metadata.json` - Index metadata  
  - `chunks.pkl` - Document chunks
  - `metadata.db` - SQLite database for incremental indexing
- **Embeddings Cache**: `~/Library/Application Support/FinderSemanticSearch/data/embeddings_cache/`
  - Cached embeddings to avoid recomputation

### 3. Async CLI Implementation (cli.py)

The CLI uses Python's AsyncIO for concurrent operations, allowing searches while indexing:

```python
class AsyncSearchCLI:
    def __init__(self):
        self.search_engine = None
        self.indexing_task = None
        self.executor = ThreadPoolExecutor(max_workers=2)  # For CPU-bound tasks
        
    async def handle_index(self, folder: str) -> Dict[str, Any]:
        """Handle indexing request - waits for completion"""
        result = await self._index_folder_async(folder)
        # Return result after indexing completes
        return {"success": True, "action": "index", ...}
        
    async def _index_folder_async(self, folder: str):
        """Run blocking operation in thread pool"""
        result = await loop.run_in_executor(
            self.executor,
            self._perform_indexing,
            folder
        )
        return result
```

### 4. JSON Communication Protocol

#### Request Format
```json
{
    "action": "index|search|stats|clear|exit",
    "folder": "/path/to/folder",  // for index
    "query": "search terms",       // for search
    "limit": 20                    // for search
}
```

#### Response Format
```json
{
    "success": true,
    "action": "index|search|stats",
    "results": [...],              // for search
    "total_documents": 100,        // for index
    "total_chunks": 1000,          // for index
    "stats": {...},                // for stats
    "error": "error message"       // on failure
}
```

#### Status Messages (JSON Streaming)
```json
{"status": "loading_index"}
{"status": "index_loaded", "chunks": 1949, "documents": 144}
{"status": "indexing_started", "folder": "/path"}
{"status": "checking_changes", "path": "/path"}
{"status": "documents_found", "count": 10}
{"status": "processing_file", "current": 1, "total": 100, "file": "doc.pdf"}
{"status": "generating_embeddings", "current": 1, "total": 5, "file": "Batch 1/5"}
{"status": "chunks_added", "added": 50, "total": 1999}
```

## Implementation Details

### Swift Side

1. **Process Lifecycle**
   - Launch Python process on app start
   - Keep process running for entire app session
   - Terminate gracefully on app quit

2. **JSON Streaming Parser with Progress Handling**
   ```swift
   // Parse multiple JSON objects from stdout
   let lines = string.components(separatedBy: "\n").filter { !$0.isEmpty }
   for line in lines {
       if let response = try? JSONDecoder().decode(CLIResponse.self, from: lineData) {
           // Found the actual response
           continuation.resume(returning: response)
           return
       } else if json["status"] != nil {
           // Handle progress updates
           switch status {
           case "processing_file":
               progressHandler?(current, total, file)
           case "documents_found":
               progressHandler?(0, count, "Starting...")
           }
       }
   }
   ```

3. **Error Handling**
   - Timeout after 10 seconds
   - Graceful handling of process termination
   - JSON parsing errors logged to console

### Python Side

1. **Critical Output Flushing** ⚠️
   ```python
   # CRITICAL: Must flush stdout before sending final response
   async def process_command(line):
       result = await self.process_command(line)
       if result:
           sys.stdout.flush()  # Flush progress messages
           sys.stderr.flush()  # Flush any stderr output
           print(json.dumps(result), flush=True)
           sys.stdout.flush()  # Ensure response is sent
   
   def _perform_indexing(folder):
       self.search_engine.index_directory_incremental(folder)
       sys.stdout.flush()  # Flush all progress messages
       stats = self.search_engine.indexer.get_statistics()
       return {"documents": stats.get("total_documents", 0), ...}
   ```

2. **Async Architecture**
   - AsyncIO event loop for concurrent operations
   - ThreadPoolExecutor for CPU-bound tasks (FAISS operations)
   - Allows search queries during indexing
   - Progress messages streamed in real-time

3. **Tuple Unpacking for Results**
   ```python
   # Search returns List[Tuple[DocumentChunk, float]]
   for chunk, score in results:
       formatted_results.append({
           'file_path': chunk.metadata.get('file_path', ''),
           'file_name': chunk.metadata.get('file_name', 'Unknown'),
           'score': float(score),
           'preview': chunk.content[:200],
           'page_number': chunk.metadata.get('page_number')
       })
   ```

## Key Design Decisions

### 1. CLI Integration (vs Server)
- **Pros**: Simple, no port management, process isolation
- **Cons**: Slightly higher latency per command
- **Decision**: CLI chosen for simplicity and reliability

### 2. JSON Streaming (vs Single Response)
- **Pros**: Real-time progress updates, better UX
- **Cons**: More complex parsing
- **Decision**: Streaming for better user feedback

### 3. System Python + Virtual Environment
- **Pros**: No bundling Python, automatic dependency management
- **Cons**: First-run installation delay
- **Decision**: Best balance of simplicity and user experience

### 4. App Sandbox Disabled
- **Reason**: Required for subprocess execution
- **Alternative**: Could use XPC services (more complex)
- **Decision**: Disable sandbox for MVP, revisit for App Store

## Issues Encountered and Solutions

### Issue 1: Mixed JSON Output
**Problem**: Status messages mixed with responses on stdout
**Solution**: Parse each line separately, identify response by "success" field

### Issue 2: Tuple vs Dictionary Confusion
**Problem**: CLI expected dictionaries but search returns tuples
**Solution**: Properly unpack tuples: `for chunk, score in results:`

### Issue 3: Process Not Starting
**Problem**: Python CLI not found in app bundle
**Solution**: Copy Python files during build phase with build script

### Issue 4: First Run Delays
**Problem**: Installing dependencies takes time
**Solution**: Show progress messages to stderr, captured by Swift

### Issue 5: Sandbox Restrictions
**Problem**: Can't execute subprocesses with sandbox enabled
**Solution**: Disable app sandbox in entitlements

### Issue 6: Progress Bar Not Updating ⭐
**Problem**: Indexing completes with 0 documents, progress messages appear after response
**Solution**: Critical fixes:
1. Return result from `_index_folder_async` to `handle_index`
2. Flush stdout BEFORE sending final response
3. Flush stdout AFTER indexing completes in `_perform_indexing`
4. Create future explicitly before awaiting in async functions

### Issue 7: Import Path Errors
**Problem**: `ModuleNotFoundError: No module named 'document_processor'`
**Solution**: Add src directory to Python path in cli.py:
```python
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), 'src'))
```

## Build Configuration

### Build Script (Copy Python CLI)
```bash
#!/bin/bash
SOURCE_DIR="${PROJECT_DIR}/../local-doc-search"
DEST_DIR="${BUILT_PRODUCTS_DIR}/${CONTENTS_FOLDER_PATH}/Resources/python_cli"

mkdir -p "$DEST_DIR"
cp -r "$SOURCE_DIR"/* "$DEST_DIR/"
```

### Entitlements
```xml
<key>com.apple.security.app-sandbox</key>
<false/>
```

## Testing

### Unit Tests
- Test JSON parsing with various inputs
- Test error handling scenarios
- Mock Python process for UI testing

### Integration Tests
```bash
# Test CLI directly
python cli_standalone.py interactive --json-mode
{"action": "stats"}
{"action": "index", "folder": "/test/path"}
{"action": "search", "query": "test query"}
```

### Performance Considerations
- Index operations can be long-running
- Use async/await to prevent UI blocking
- Stream status updates for progress indication

## Current State Summary

### What Works ✅
- Document indexing from folders with progress bar
- Semantic search with natural language
- Concurrent search during indexing (async implementation)
- PDF, DOCX, TXT, MD file support
- Real-time progress updates during file processing
- Automatic dependency installation
- JSON streaming for status messages
- Error handling and recovery
- Incremental indexing (only process changed files)

### Known Limitations
- App sandbox disabled (security implications)
- First run requires internet for dependencies
- Bundle size increases with Python packages
- Large folders (40K+ files) may take significant time to index

## Recent Improvements

### Resumable Indexing (2025-08-21)

**Issue**: Index was lost if app quit during indexing, requiring complete re-indexing on restart.

**Root Cause**: 
- Index was only saved at the END of indexing (`save_index()` called once)
- Metadata database existed but had 0 entries until indexing completed
- If app quit during indexing, all progress was lost
- On restart, empty metadata meant all files appeared "new"

**Solution**: Implemented batch-based progressive saving:
1. Process files in batches of 100 (configurable)
2. After each batch:
   - Generate embeddings for batch
   - Add chunks to FAISS index
   - Update metadata database (with commit)
   - Save index to disk (`faiss.index`, `chunks.pkl`, `metadata.json`)
3. Progress is now preserved even if interrupted

**Implementation Details**:
```python
# search.py - New batch processing
def index_directory_incremental(self, directory_path: str, batch_size: int = 64, save_every: int = 100):
    for idx, file_path in enumerate(files_to_process):
        chunks = self.document_processor.process_file(str(file_path))
        batch_chunks.extend(chunks)
        
        # Save batch when we reach save_every files
        if len(files_in_batch) >= save_every:
            embeddings = self.embedding_generator.generate_embeddings(chunk_texts)
            self.indexer.add_documents(batch_chunks, embeddings)
            self.metadata_store.update_file(...)  # Commits immediately
            self.indexer.save_index()  # Saves to disk
```

**Benefits**:
- Indexing progress preserved across app restarts
- Can resume from last saved batch
- No data loss on unexpected termination
- Status messages show batch progress

### Progress Bar Consistency Fix (2025-08-21)

**Issue**: Progress bar was jumping between file processing progress and embedding generation progress (e.g., "1000/5000" → "2/2" → "1001/5000").

**Root Cause**: During batch saving (every 100 files), the embedding generator was outputting its own progress messages for embedding batches, conflicting with file processing progress.

**Solution**: Added `show_progress` parameter to suppress embedding progress during batch processing:
```python
# embeddings.py
def generate_embeddings(..., show_progress: bool = True):
    # Only show progress if show_progress=True
    if self.json_mode and show_progress:
        print(json.dumps({"status": "generating_embeddings", ...}))

# search.py - During batch processing
embeddings = self.embedding_generator.generate_embeddings(
    chunk_texts, 
    batch_size=batch_size,
    show_progress=False  # Suppress to avoid confusion
)
```

**Benefits**:
- Clean, consistent progress bar showing only file processing
- No confusing jumps between different progress metrics
- Better user experience during indexing

## Future Improvements

1. **App Store Compliance**
   - Investigate XPC services for sandboxing
   - Or bundle Python framework with py2app

2. **Performance**
   - ~~Incremental indexing~~ ✅ Implemented
   - Background indexing
   - Caching layer

3. **Features**
   - File watching for auto-reindex
   - Search history
   - Export results
   - Similar document finding

## Troubleshooting

### Debug Output
Enable verbose logging in Xcode console to see:
- Python process stdout/stderr
- JSON communication
- Status messages

### Common Commands
```bash
# Clean Python environment
rm -rf ~/Library/Application\ Support/FinderSemanticSearch/venv

# Test Python CLI manually
cd /path/to/app/Contents/Resources/python_cli
/usr/bin/python3 cli_standalone.py interactive --json-mode

# Check dependencies
~/Library/Application\ Support/FinderSemanticSearch/venv/bin/pip list
```

### Logs Location
- Xcode Console: Real-time debugging
- Console.app: System logs
- stderr: Status messages from Python

## Deployment Considerations

### For Development
1. Build in Xcode
2. Run directly from Xcode
3. Python files copied automatically

### For Distribution
1. Archive in Xcode
2. Sign with Developer ID
3. Notarize for Gatekeeper
4. Create DMG for distribution

Note: Current implementation requires disabling app sandbox, which may affect App Store submission.