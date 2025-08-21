# Finder Semantic Search (FSS) - Claude Context

## Project Overview
A macOS application with semantic document search capabilities using AI-powered embeddings. The project combines:
1. **Python Backend** (COMPLETED): Document processing and search engine with FAISS
2. **SwiftUI Frontend** (COMPLETED): Native macOS app with clean interface
3. **CLI Integration** (COMPLETED): JSON-based communication between Swift and Python

## Repository Structure

```
/Users/bovet/GitHub/FSS/
├── CLAUDE.md                    # This file - project context for Claude
├── README.md                    # Main project documentation
│
├── FinderSemanticSearch/        # 🖥️ SWIFTUI MACOS APP
│   ├── FinderSemanticSearch.xcodeproj
│   ├── FinderSemanticSearch/
│   │   ├── Services/
│   │   │   └── PythonCLIBridge.swift  # Python process management
│   │   ├── Views/
│   │   │   ├── ContentView.swift      # Main app view
│   │   │   ├── SearchView.swift       # Search interface
│   │   │   └── IndexingView.swift     # Folder indexing UI
│   │   ├── ViewModels/
│   │   │   └── SearchViewModel.swift  # Business logic
│   │   └── Models/
│   └── INTEGRATION_PLAN.md     # Completed integration documentation
│
├── specs/                       # 📋 SPECIFICATIONS & PLANNING
│   ├── local-document-search-plan.md   # Original implementation plan
│   ├── SWIFTUI_PYTHON_GUIDE.md        # Current integration guide
│   └── ML_DOWNLOAD_STRATEGY.md        # Model bundling strategies
│
└── local-doc-search/           # 🐍 PYTHON SEARCH ENGINE
    ├── cli.py                  # Main CLI with JSON mode
    ├── cli_standalone.py       # Bootstrap script for auto-dependencies
    ├── config.yaml             # Configuration file
    ├── requirements.txt        # Python dependencies
    │
    ├── src/                   # Core search engine
    │   ├── document_processor.py  # Document parsing (PDF, Word, Text)
    │   ├── embeddings.py          # Embedding generation
    │   ├── indexer.py             # FAISS index management
    │   └── search.py              # Search engine logic
    │
    └── data/                  # Runtime data (git-ignored)
        ├── index/            # FAISS index files
        └── embeddings_cache/ # Cached embeddings
```

## Current Status

### ✅ Completed Features
- **Python Search Engine**: Full document processing and semantic search
- **SwiftUI macOS App**: Native interface with modern design
- **CLI Integration**: JSON-based communication protocol
- **Auto-Dependencies**: Bootstrap script installs packages automatically
- **JSON Streaming**: Real-time progress updates during indexing
- **Document Support**: PDF, DOCX, TXT, MD files
- **Semantic Search**: FAISS + Sentence Transformers
- **App Sandbox**: Disabled to allow subprocess execution
- **Hidden Directory Filtering**: Skips directories starting with "." during indexing
- **Deterministic Progress Bar**: Shows actual file count and progress during indexing
- **Two-Phase Progress Reporting**: Tracks both file processing and embedding generation
- **Dynamic UI**: Drop zone hides during indexing to prevent concurrent operations

### 🔧 Implementation Details
- **Python Bridge**: `PythonCLIBridge.swift` manages subprocess
- **Bootstrap**: `cli_standalone.py` creates venv at `~/Library/Application Support/`
- **JSON Protocol**: Commands (index, search, stats, exit) and streaming responses
- **Build Script**: Copies Python files to app bundle during build
- **No User Setup**: Works out-of-box with system Python 3.9+

## Key Files to Know

### Implementation Files
- `local-doc-search/cli.py` - Entry point, all CLI commands
- `local-doc-search/src/search.py` - Main search engine class
- `local-doc-search/src/document_processor.py` - Handles all document parsing
- `local-doc-search/src/embeddings.py` - ML model integration

### Documentation Files
- `specs/local-document-search-plan.md` - Original detailed plan
- `specs/SWIFTUI_PYTHON_GUIDE.md` - Native app implementation guide
- `specs/ML_DOWNLOAD_STRATEGY.md` - Model distribution analysis
- `local-doc-search/SECURITY_ANALYSIS.md` - Security/privacy guarantees

### Configuration
- `local-doc-search/config.yaml` - User configuration
- `local-doc-search/requirements.txt` - Python dependencies
- `local-doc-search/.gitignore` - Excludes data/, venv/, caches

## Quick Commands

### Setup & Installation
```bash
cd local-doc-search
./setup.sh                           # One-click setup
source venv/bin/activate            # Activate environment
```

### Using the CLI
```bash
python cli.py index --folder ~/Documents    # Index documents
python cli.py search "machine learning"     # Search
python cli.py interactive                   # Interactive mode
python cli.py stats                        # View statistics
python cli.py --help                       # All commands
```

### Development & Testing

#### SwiftUI App
```bash
# Build and run in Xcode
open FinderSemanticSearch/FinderSemanticSearch.xcodeproj
# Press ⌘R to run
```

#### Python CLI Testing
```bash
cd local-doc-search

# Test with standalone script (auto-installs deps)
/usr/bin/python3 cli_standalone.py interactive --json-mode

# Send JSON commands
{"action": "index", "folder": "/path/to/docs"}
{"action": "search", "query": "test query", "limit": 10}
{"action": "stats"}
{"action": "exit"}
```

## Technical Stack

### Current (CLI)
- **Language**: Python 3.9+
- **ML Models**: Sentence Transformers, Ollama
- **Vector DB**: FAISS
- **Document Processing**: PyPDF2, python-docx
- **CLI**: Click + Rich
- **Dependencies**: ~20 packages, 300MB installed

### Current (macOS App)
- **UI**: SwiftUI (native macOS) ✅
- **Bridge**: Process/NSTask with JSON protocol ✅
- **Python**: Uses system Python 3.9+ ✅
- **Dependencies**: Auto-installed to `~/Library/Application Support/` ✅
- **App Size**: ~50MB (without Python packages)
- **Runtime Size**: ~500MB (with all dependencies)

## Important Decisions Made

1. **CLI Integration over PyObjC** - Simpler, more maintainable
2. **JSON Protocol** - Clean separation between Swift and Python
3. **Virtual Environment** - Isolated dependencies in Application Support
4. **Disabled App Sandbox** - Required for subprocess execution
5. **System Python** - No bundled Python, uses macOS built-in
6. **FAISS over ChromaDB** - Lighter, faster, sufficient
7. **Read-only design** - Never modifies user documents

## Known Issues & Limitations

1. **PDF Warnings** - Some complex PDFs show warnings (handled gracefully)
2. **Text Encoding** - Some files with special characters may fail (skipped)
3. **Bundle Size** - Full app will be 400-500MB with models
4. **Python 3.13** - Had compatibility issues, fixed with flexible requirements

## Known Issues & Solutions

1. **App Sandbox** - Disabled for subprocess (limits App Store distribution)
2. **First Run** - Takes 2-3 minutes to install dependencies
3. **JSON Mixing** - Fixed by redirecting status to stderr
4. **Tuple Unpacking** - Fixed in search results formatting

## Future Enhancements

### Priority 1 (Performance)
- [ ] Incremental indexing
- [ ] Background processing
- [ ] Multi-threaded indexing

### Priority 2 (Features)
- [ ] File watching for auto-update
- [ ] Search history
- [ ] Export results
- [ ] Document preview with Quick Look

### Priority 3 (Distribution)
- [ ] XPC services for App Store compliance
- [ ] Code signing and notarization
- [ ] Auto-update mechanism (Sparkle)

## Environment Details
- **Working Directory**: `/Users/bovet/GitHub/FSS/local-doc-search`
- **Platform**: macOS (Darwin)
- **Python**: 3.13 (with compatibility fixes)
- **Git Branch**: main

## Notes for Claude

### Working with the Project
- **App Testing**: Build and run in Xcode
- **CLI Testing**: Use `cli_standalone.py` for auto-dependencies
- **JSON Protocol**: All communication via stdin/stdout
- **Status Messages**: Sent to stderr to avoid JSON conflicts
- **Virtual Environment**: Created at `~/Library/Application Support/FinderSemanticSearch/venv/`

### Key Files to Modify
- **Swift Side**: `PythonCLIBridge.swift` for process management
- **Python Side**: `cli.py` for command handling
- **Bootstrap**: `cli_standalone.py` for dependency management

### Testing Commands
```bash
# Test CLI directly
cd /path/to/app.app/Contents/Resources/python_cli
/usr/bin/python3 cli_standalone.py interactive --json-mode

# Lint/typecheck commands to run
npm run lint      # If available
npm run typecheck # If available
ruff .            # Python linting
```

## Technical Details

### JSON Communication Protocol
**Commands (stdin):**
```json
{"action": "index", "folder": "/path"}
{"action": "search", "query": "text", "limit": 10}
{"action": "stats"}
{"action": "clear"}
{"action": "exit"}
```

**Responses (stdout):**
```json
{"success": true, "action": "index", "total_documents": 50}
{"success": true, "action": "search", "results": [...]}
```

**Status Messages (stdout - streamed during processing):**
```json
{"status": "installing", "message": "Installing dependencies..."}
{"status": "loading_index"}
{"status": "documents_found", "count": 10}
{"status": "processing_file", "current": 1, "total": 10, "file": "doc1.pdf"}
{"status": "generating_embeddings", "current": 1, "total": 5, "file": "Batch 1/5"}
```

### Performance Metrics
- **Indexing**: ~250 documents/minute (with 4 parallel workers)
- **Search**: <500ms response time
- **Memory**: ~200MB idle, ~500MB during indexing
- **App Size**: 50MB (+ 500MB dependencies on first run)
- **Speedup**: ~3-4x faster with multi-threading enabled
- Don't copy the Python code to the app bundle, let the xcodebuild process or the user do that via Xcode