# FinderSemanticSearch - Python CLI Integration Plan

## Decision: CLI Integration with Long-Running Interactive Process (Approach A)

After review, we're proceeding with **Approach A: Long-Running Interactive Process** which keeps the Python CLI running in interactive mode and communicates via JSON through stdin/stdout.

## Overview
Use the existing Python CLI tool (`cli.py`) from local-doc-search as a subprocess managed by the SwiftUI app. This approach treats Python as a command-line tool rather than an embedded library or server.

## Architecture: CLI-Based Integration

### How It Works
1. SwiftUI app launches Python CLI as a subprocess using `Process`/`NSTask`
2. Communicates via stdin/stdout using JSON
3. Keeps Python process running for the session (interactive mode)
4. Or launches separate processes for each operation

## Selected Implementation: Long-Running Interactive Process

### How It Works
Keep Python CLI running in interactive mode, send commands via stdin

```swift
class PythonCLIBridge: ObservableObject {
    private var process: Process?
    private var inputPipe: Pipe?
    private var outputPipe: Pipe?
    
    func start() {
        process = Process()
        process.executableURL = URL(fileURLWithPath: "/usr/bin/python3")
        process.arguments = ["cli.py", "interactive", "--json-mode"]
        
        inputPipe = Pipe()
        outputPipe = Pipe()
        
        process.standardInput = inputPipe
        process.standardOutput = outputPipe
        process.standardError = outputPipe
        
        process.launch()
    }
    
    func sendCommand(_ command: [String: Any]) async throws -> [String: Any] {
        let jsonData = try JSONSerialization.data(withJSONObject: command)
        inputPipe?.fileHandleForWriting.write(jsonData)
        inputPipe?.fileHandleForWriting.write("\n".data(using: .utf8)!)
        
        // Read response
        let responseData = outputPipe?.fileHandleForReading.availableData
        return try JSONSerialization.jsonObject(with: responseData!) as! [String: Any]
    }
}
```

## Code Organization Strategy

### Development Structure
The Python CLI code remains in its original location for development:
```
/Users/bovet/GitHub/FSS/
├── local-doc-search/           # Original Python CLI location
│   ├── cli.py                  # Main CLI - will be modified in place
│   ├── src/                    # Search engine modules
│   │   ├── search.py
│   │   ├── document_processor.py
│   │   ├── embeddings.py
│   │   └── indexer.py
│   └── config.yaml
└── FinderSemanticSearch/        # SwiftUI app
    ├── FinderSemanticSearch.xcodeproj
    └── Scripts/
        └── copy_python_cli.sh  # Build script to copy CLI
```

### Build-Time Copy Process
At build time, we copy the Python CLI into the app bundle:

1. **Xcode Build Phase Script** (`copy_python_cli.sh`):
```bash
#!/bin/bash
# Run as Xcode Build Phase: Build Phases > New Run Script Phase

SOURCE_DIR="${PROJECT_DIR}/../../local-doc-search"
DEST_DIR="${BUILT_PRODUCTS_DIR}/${CONTENTS_FOLDER_PATH}/Resources/python_cli"

# Create destination directory
mkdir -p "$DEST_DIR"

# Copy Python CLI and source files
cp "$SOURCE_DIR/cli.py" "$DEST_DIR/"
cp -r "$SOURCE_DIR/src" "$DEST_DIR/"
cp "$SOURCE_DIR/config.yaml" "$DEST_DIR/"
cp "$SOURCE_DIR/requirements.txt" "$DEST_DIR/"

echo "Python CLI copied to app bundle"
```

2. **Development Workflow**:
   - Modify `cli.py` in `/Users/bovet/GitHub/FSS/local-doc-search/`
   - Test changes using command line
   - Build SwiftUI app - script automatically copies latest version
   - No need to maintain two copies of the code

3. **Runtime Structure** (inside app bundle):
```
FinderSemanticSearch.app/
└── Contents/
    ├── MacOS/
    │   └── FinderSemanticSearch
    └── Resources/
        └── python_cli/
            ├── cli.py          # Copied at build time
            ├── src/            # Copied at build time
            └── config.yaml     # Copied at build time
```

### Benefits of This Approach
- **Single Source of Truth**: CLI code maintained in one place
- **Easy Testing**: Can test CLI changes independently before building app
- **Version Control**: Original CLI remains in its own directory with its git history
- **Clean Separation**: SwiftUI app and Python CLI remain independent projects
- **Automatic Updates**: Every app build gets the latest CLI version

### Approach B: Individual Command Executions (Not Selected)
For reference only - launching Python for each operation

```swift
class PythonCLIBridge {
    func indexFolder(_ path: String) async throws -> IndexResult {
        let output = try await runCommand(["index", "--folder", path, "--json"])
        return try JSONDecoder().decode(IndexResult.self, from: output)
    }
    
    func search(_ query: String) async throws -> [SearchResult] {
        let output = try await runCommand(["search", query, "--json", "--limit", "20"])
        return try JSONDecoder().decode([SearchResult].self, from: output)
    }
    
    private func runCommand(_ args: [String]) async throws -> Data {
        let process = Process()
        process.executableURL = URL(fileURLWithPath: pythonPath)
        process.arguments = ["cli.py"] + args
        
        let pipe = Pipe()
        process.standardOutput = pipe
        
        try process.run()
        process.waitUntilExit()
        
        return pipe.fileHandleForReading.readDataToEndOfFile()
    }
}
```

## Required CLI Modifications

### 1. Add JSON Output Mode to cli.py
```python
@click.option('--json', is_flag=True, help='Output in JSON format')
def search(query, top_k, json):
    """Search for documents"""
    results = engine.search(query, top_k)
    
    if json:
        output = {
            'success': True,
            'results': [
                {
                    'file': r['file'],
                    'score': r['score'],
                    'preview': r['preview'],
                    'page': r.get('page')
                }
                for r in results
            ]
        }
        click.echo(json.dumps(output))
    else:
        # Original human-readable output
```

### 2. Add Interactive JSON Mode
```python
@cli.command()
@click.option('--json-mode', is_flag=True, help='Interactive JSON I/O mode')
def interactive(json_mode):
    """Interactive search mode"""
    if json_mode:
        while True:
            try:
                line = input()
                command = json.loads(line)
                
                if command['action'] == 'search':
                    results = engine.search(command['query'], command.get('limit', 10))
                    print(json.dumps({'success': True, 'results': results}))
                    
                elif command['action'] == 'index':
                    engine.index_documents(command['path'])
                    print(json.dumps({'success': True}))
                    
                elif command['action'] == 'exit':
                    break
                    
            except Exception as e:
                print(json.dumps({'success': False, 'error': str(e)}))
```

## Pros and Cons

### Advantages ✅
1. **Simple Implementation**: Uses existing CLI tool with minimal changes
2. **No Dependencies**: No need for FastAPI, Flask, or PythonKit
3. **Proven CLI Tool**: The CLI already works reliably
4. **Easy Debugging**: Can test CLI independently
5. **Resource Efficient**: No server overhead
6. **State Management**: Interactive mode keeps index in memory

### Considerations
1. **Complex I/O**: Managing pipes and JSON parsing (mitigated by clean JSON protocol)
2. **Error Handling**: Need to parse both stdout and stderr (handled by bridge layer)
3. **Process Management**: Must handle crashes, restarts (SwiftUI app monitors and restarts)
4. **Limited Concurrency**: Single process handles all operations (acceptable for single-user app)

## Comparison Table

| Aspect | CLI Integration | Local Server | PythonKit |
|--------|----------------|--------------|-----------|
| Complexity | Medium | Low | High |
| Performance | Good* | Best | Best |
| Reliability | Good | Excellent | Poor |
| Debugging | Good | Excellent | Poor |
| Distribution | Easy | Easy | Hard |
| State Management | Good* | Excellent | Excellent |

*With interactive mode

## SwiftUI Interface Components

### Views Structure (from previous plan)
```
ContentView
├── SearchView (main search interface)
│   ├── SearchBar
│   └── ResultsList
├── IndexingView (folder selection)
│   ├── FolderDropZone
│   └── IndexingProgress
└── SettingsView
    ├── ModelSelection
    └── IndexSettings
```

### Key UI Features
- **Search Bar**: Real-time search with debouncing
- **Results List**: Ranked results with file previews
- **Folder Indexing**: Drag-and-drop or browse for folders
- **Status Display**: Document count, index status
- **Settings**: Model selection (Sentence Transformers vs Ollama), chunk size configuration
- **Keyboard Shortcuts**: ⌘K for quick search
- **Dark Mode Support**: Native macOS appearance

## Implementation Plan

### Phase 1: Modify CLI Tool (30 min)
1. Add `--json` flag to all commands
2. Create JSON output formatters
3. Implement interactive JSON mode
4. Test with command line

### Phase 2: Swift CLI Bridge (30 min)
1. Create `PythonCLIBridge` class
2. Implement process management
3. Add JSON communication layer
4. Handle errors and timeouts

### Phase 3: SwiftUI Integration (45 min)
1. Create search interface
2. Add folder indexing view
3. Display results
4. Show progress/status

### Phase 4: Bundling (15 min)
1. Bundle Python with virtual environment
2. Or use PyInstaller for single executable
3. Include in app Resources folder

## Sample Implementation

### Swift Side
```swift
@MainActor
class SearchViewModel: ObservableObject {
    private let cliBridge = PythonCLIBridge()
    @Published var searchResults: [SearchResult] = []
    @Published var isSearching = false
    
    func search(_ query: String) async {
        isSearching = true
        defer { isSearching = false }
        
        do {
            let command = ["action": "search", "query": query, "limit": 20]
            let response = try await cliBridge.sendCommand(command)
            
            if let results = response["results"] as? [[String: Any]] {
                self.searchResults = results.compactMap { dict in
                    SearchResult(from: dict)
                }
            }
        } catch {
            print("Search error: \(error)")
        }
    }
}
```

### Python Side (cli.py modifications)
```python
import json
import sys

def json_mode():
    """Handle JSON I/O mode for GUI integration"""
    engine = DocumentSearchEngine()
    
    for line in sys.stdin:
        try:
            command = json.loads(line.strip())
            action = command.get('action')
            
            if action == 'search':
                results = engine.search(
                    command['query'], 
                    command.get('limit', 10)
                )
                response = {
                    'success': True,
                    'results': [r.to_dict() for r in results]
                }
                
            elif action == 'index':
                count = engine.index_folder(command['path'])
                response = {
                    'success': True,
                    'documents_indexed': count
                }
                
            elif action == 'stats':
                stats = engine.get_statistics()
                response = {
                    'success': True,
                    'stats': stats
                }
                
            elif action == 'exit':
                break
                
            else:
                response = {
                    'success': False,
                    'error': f'Unknown action: {action}'
                }
                
        except Exception as e:
            response = {
                'success': False,
                'error': str(e)
            }
        
        print(json.dumps(response))
        sys.stdout.flush()  # Important for real-time communication
```

## Why This Approach Was Chosen

1. **Simplicity**: Reuses existing working CLI tool with minimal modifications
2. **Performance**: Keeps Python process running (no startup overhead)
3. **Reliability**: Avoids PythonKit issues we encountered
4. **Maintainability**: CLI and GUI remain separate, single source of truth
5. **Testing**: Can test CLI independently before integrating
6. **Development Speed**: Minimal changes required to existing code
7. **Code Organization**: CLI stays in original location, copied at build time

The CLI approach gives us 90% of the server benefits with less complexity. The Python process stays running in interactive mode, maintaining the search index in memory, while the SwiftUI app sends commands and receives JSON responses.

## Distribution Strategy

### Python Bundling with PyInstaller
```bash
# Create standalone Python executable including CLI
pyinstaller --onefile \
    --hidden-import=sentence_transformers \
    --hidden-import=faiss \
    --add-data "src:src" \
    --add-data "config.yaml:."\
    cli.py
```

### App Bundle Structure
```
FinderSemanticSearch.app/
└── Contents/
    ├── MacOS/
    │   └── FinderSemanticSearch
    ├── Resources/
    │   ├── python_cli (PyInstaller output)
    │   └── src/ (fallback if needed)
    └── Info.plist
```

### Entitlements Required
- `com.apple.security.files.user-selected.read-only` - For document access
- `com.apple.security.files.bookmarks.app-scope` - For remembering indexed folders
- `com.apple.security.app-sandbox` - With exceptions for user files

## Implementation Steps

### Step 1: Modify CLI in Original Location (30 min)
1. Navigate to `/Users/bovet/GitHub/FSS/local-doc-search/`
2. Add JSON mode to `cli.py`
3. Implement interactive JSON mode
4. Test with command line

### Step 2: Create Xcode Build Script (10 min)
1. Add `copy_python_cli.sh` to FinderSemanticSearch
2. Configure as Xcode Build Phase
3. Test build to verify copying works

### Step 3: Implement Swift CLI Bridge (30 min)
1. Create `PythonCLIBridge.swift`
2. Implement process management
3. Add JSON communication layer
4. Handle errors and timeouts

### Step 4: Build SwiftUI Interface (45 min)
1. Create SearchView with search bar
2. Implement ResultsList
3. Add IndexingView with drag-and-drop
4. Create SettingsView
5. Wire up to CLI bridge

### Step 5: Testing & Polish (20 min)
1. Test indexing various document types
2. Verify search functionality
3. Add loading states
4. Implement error messages

### Step 6: Distribution (15 min)
1. Create PyInstaller build of CLI (optional)
2. Or bundle Python runtime with virtualenv
3. Test on clean macOS system

## Next Steps

Ready to proceed with implementation:
1. First, I'll modify `cli.py` in its original location to add JSON mode
2. Create the Xcode build script to copy files at build time
3. Implement the Swift bridge and UI

This approach maintains a clean separation while ensuring we always use the latest CLI code.