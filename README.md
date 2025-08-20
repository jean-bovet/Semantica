# FSS - Finder Semantic Search

A macOS application that provides semantic search capabilities for local documents using AI-powered embeddings.

## Overview

Finder Semantic Search (FSS) is a native macOS application built with SwiftUI that allows users to:
- Index documents from selected folders (PDF, Word, Text, Markdown)
- Search documents using natural language queries
- Get semantically relevant results based on AI embeddings
- Works completely offline with local processing

## Architecture

The application uses a hybrid architecture:
- **Frontend**: Native SwiftUI app for macOS
- **Backend**: Python CLI for document processing and search
- **Communication**: JSON-based protocol via stdin/stdout

### Key Components

1. **SwiftUI App** (`/FinderSemanticSearch`)
   - Native macOS interface
   - Manages Python process lifecycle
   - Handles user interactions

2. **Python CLI** (`/local-doc-search`)
   - Document processing and chunking
   - Embedding generation using Sentence Transformers
   - FAISS-based vector search
   - Self-contained with automatic dependency management

3. **Integration Layer**
   - `PythonCLIBridge.swift`: Manages Python process and JSON communication
   - `cli_standalone.py`: Bootstrap script for dependency management
   - JSON streaming support for real-time status updates

## Features

### Current Implementation
- ✅ Document indexing from folders
- ✅ Semantic search with natural language queries
- ✅ Support for PDF, DOCX, TXT, and MD files
- ✅ Real-time indexing progress updates with deterministic progress bar
- ✅ Self-contained Python environment (no user installation required)
- ✅ JSON streaming for status messages
- ✅ Automatic dependency installation on first run
- ✅ Hidden directory filtering (skips directories starting with ".")
- ✅ Drag-and-drop zone that hides during indexing
- ✅ Progress reporting for both file processing and embedding generation phases

### Technical Highlights
- **App Sandbox**: Disabled for subprocess execution
- **Python Integration**: Uses system Python with virtual environment
- **Embedding Model**: sentence-transformers/all-MiniLM-L6-v2
- **Vector Store**: FAISS with L2 distance metric
- **Communication**: Bidirectional JSON over pipes with status streaming

## Installation

1. Clone the repository
2. Open `FinderSemanticSearch.xcodeproj` in Xcode
3. Build and run the application

The app will automatically:
- Create a Python virtual environment on first run
- Install required dependencies
- Set up the search index

## Usage

1. **Index Documents**: Click "Index Folder" and select a directory
2. **Search**: Enter a natural language query in the search box
3. **View Results**: Documents are ranked by semantic similarity

## Development

### Project Structure
```
FSS/
├── FinderSemanticSearch/     # SwiftUI macOS app
│   ├── Views/               # UI components
│   ├── ViewModels/          # Business logic
│   └── Services/            # Python bridge
├── local-doc-search/        # Python search engine
│   ├── cli.py              # Main CLI interface
│   ├── cli_standalone.py   # Bootstrap script
│   └── src/                # Core search logic
└── specs/                   # Documentation
```

### Key Design Decisions
- **CLI Integration**: Chosen for simplicity and process isolation
- **JSON Protocol**: Enables clean separation between Swift and Python
- **Status Streaming**: Multiple JSON objects on stdout for real-time updates
- **Virtual Environment**: Ensures consistent dependencies without conflicts

## Requirements

- macOS 12.0 or later
- Xcode 14.0 or later
- System Python 3.9+ (included with macOS)

## License

MIT