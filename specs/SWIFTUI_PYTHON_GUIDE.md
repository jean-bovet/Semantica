# SwiftUI + Python Integration Guide

## Current Implementation Status

This guide documents the **actual implemented solution** using a CLI-based integration between SwiftUI and Python with JSON communication.

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

### 3. JSON Communication Protocol

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
{"status": "indexing_directory", "path": "/path"}
{"status": "documents_found", "count": 10}
{"status": "chunks_added", "added": 50, "total": 1999}
```

## Implementation Details

### Swift Side

1. **Process Lifecycle**
   - Launch Python process on app start
   - Keep process running for entire app session
   - Terminate gracefully on app quit

2. **JSON Streaming Parser**
   ```swift
   // Parse multiple JSON objects from stdout
   let lines = string.components(separatedBy: "\n").filter { !$0.isEmpty }
   for line in lines {
       if let response = try? JSONDecoder().decode(CLIResponse.self, from: lineData) {
           // Found the actual response
           return response
       } else if json["status"] != nil {
           // Status message - log it
           statusMessages.append(line)
       }
   }
   ```

3. **Error Handling**
   - Timeout after 10 seconds
   - Graceful handling of process termination
   - JSON parsing errors logged to console

### Python Side

1. **JSON Mode**
   - All status messages printed to stdout as JSON
   - Immediate flushing for real-time updates
   - Clean separation of status vs response

2. **Lazy Initialization**
   ```python
   def get_search_engine(ctx, json_mode=False):
       if ctx.obj.get('search_engine') is None or \
          (json_mode and not getattr(ctx.obj.get('search_engine'), 'json_mode', False)):
           # Create search engine with appropriate settings
           ctx.obj['search_engine'] = DocumentSearchEngine(json_mode=json_mode)
       return ctx.obj['search_engine']
   ```

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
- Document indexing from folders
- Semantic search with natural language
- PDF, DOCX, TXT, MD file support
- Real-time progress updates
- Automatic dependency installation
- JSON streaming for status messages
- Error handling and recovery

### Known Limitations
- App sandbox disabled (security implications)
- First run requires internet for dependencies
- Bundle size increases with Python packages
- No incremental indexing yet

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