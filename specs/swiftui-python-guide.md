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

**Issue**: Python processes remained running after app termination, becoming orphaned processes.

**Root Cause**: The app's cleanup code was async and didn't guarantee process termination before the app quit. The `stop()` method waited 0.5 seconds before terminating, allowing the app to quit before cleanup completed.

**Solution**: Implemented a two-pronged approach:
1. **Swift Side**: 
   - Added `AppDelegate` with `applicationWillTerminate` to handle app termination
   - Created static `forceStop()` method to immediately terminate all Python processes
   - Track all active processes in a static array for cleanup
2. **Python Side**:
   - Added parent process monitoring - checks every timeout if parent is still alive
   - Automatically exits if parent process dies (backup mechanism)

**Files Changed**:
- `FinderSemanticSearchApp.swift`: Added AppDelegate with termination handler
- `PythonCLIBridge.swift`: Added static process tracking and `forceStop()` method
- `cli.py`: Added parent process monitoring with `check_parent_alive()`

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

## Future Improvements

1. **App Store Compliance**
   - Investigate XPC services for sandboxing
   - Or bundle Python framework with py2app

2. **Performance**
   - Incremental indexing
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