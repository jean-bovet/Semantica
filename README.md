[![CI](https://github.com/jean-bovet/Semantica/actions/workflows/ci.yml/badge.svg)](https://github.com/jean-bovet/Semantica/actions/workflows/ci.yml)

# Semantica

A privacy-first, offline semantic search application for macOS that indexes your documents locally and provides fast, intelligent search capabilities—all without sending any data off your device.

## ✨ Features

- 🔒 **100% Offline**: All processing happens on your Mac. No data leaves your device.
- 🚀 **Fast Semantic Search**: Uses local embeddings and vector search for intelligent results
- 📁 **Multi-format Support**: Indexes PDF, TXT, Markdown, DOCX, RTF, DOC, XLSX, XLS, CSV files
- 🔄 **Real-time Indexing**: Watches folders and automatically indexes new/changed files
- ⚡ **Native Performance**: CPU-aware concurrency scales with your hardware (4-31 files in parallel)
- 🎯 **Smart Chunking**: Intelligent text segmentation for better search results
- 💾 **Memory Safe**: Process isolation prevents memory leaks during large-scale indexing

## 🚀 Quick Start

### Prerequisites
- macOS 13.0 or later
- Node.js 18+ and npm
- **Python 3.9 or later** (for embedding service)
- 8GB RAM recommended
- ~3GB disk space for Python dependencies, models, and index

### Development

```bash
# Clone the repository
git clone https://github.com/jean-bovet/Semantica.git
cd Semantica

# Install Node dependencies
npm install

# Install Python dependencies (required for embeddings)
python3 -m pip install -r embedding_sidecar/requirements.txt

# Start development server
npm run dev
```

**Note:** The app uses your system Python installation. For detailed Python setup instructions and troubleshooting, see [docs/guides/python-setup.md](docs/guides/python-setup.md).

This will:
- Start Vite dev server for the UI (with HMR)
- Watch and rebuild Electron files with esbuild
- Auto-restart Electron when backend code changes

### Production Build

```bash
# Build for production
npm run build

# Create DMG for distribution (macOS)
npm run dist
```

## 🏗️ Architecture

The app uses a multi-process architecture with memory isolation:

```
Main Process (Electron)
    ├── Renderer (React UI)
    └── Worker Thread
        ├── File Watching
        ├── Document Parsing
        ├── LanceDB Operations
        └── Python Sidecar (HTTP API)
            └── FastAPI + sentence-transformers
```

**Key Design Decisions:**
- Worker thread owns the database for thread safety
- Embeddings run in Python sidecar process (HTTP API) for stability
- Process isolation prevents memory leaks during indexing
- Python-based embeddings provide better performance and compatibility

For detailed architecture documentation, see [docs/specs/02-architecture.md](docs/specs/02-architecture.md).

## 💾 Memory Management

The application implements sophisticated memory management through process isolation:

- **Stable Memory Usage**: ~270MB even after indexing thousands of files
- **Automatic Recovery**: Child process restarts when thresholds exceeded
- **Configurable Limits**: Tune memory limits based on your system

For details on the memory solution, see [docs/specs/archive/memory-solution.md](docs/specs/archive/memory-solution.md).

## 🧪 Testing

✅ **Comprehensive test suite** - 510 tests across 33 files
⏱️ **Fast execution** - Unit tests complete in ~3 seconds
📊 **85%+ coverage** - Core functionality well tested

```bash
# Run all tests
npm test

# Run with watch mode during development
npm run test:watch

# Run specific test file
npm run test:fast
```

See [planning/testing-strategy.md](planning/testing-strategy.md) for detailed test coverage, strategy, and maintenance guidelines.

## 📚 Technology Stack

- **Electron**: Cross-platform desktop framework
- **TypeScript**: Type-safe development
- **React**: UI components with Vite for fast HMR
- **LanceDB**: Vector database for semantic search
- **Python FastAPI**: HTTP API for embedding service
- **sentence-transformers**: Local embeddings (no cloud API)
- **PyTorch**: Machine learning framework
- **Chokidar**: File system watching
- **esbuild**: Fast bundling for Electron files

## 🔧 Configuration

Settings are stored in `~/Library/Application Support/Semantica/data/config.json`:

```json
{
  "watchedFolders": ["/path/to/documents"],
  "settings": {
    "fileTypes": {
      "pdf": true,
      "txt": true,
      "md": true,
      "docx": true,
      "rtf": true,
      "doc": true
    },
    "excludePatterns": ["node_modules", ".git", "*.tmp", ".DS_Store"]
  }
}
```

## 🔐 Privacy & Security

- ✅ **No Network Requests**: All processing happens locally
- ✅ **Local Models**: Embeddings generated on-device
- ✅ **Secure Storage**: Data in Application Support directory
- ✅ **Process Isolation**: Sandboxed renderer process
- ✅ **No Telemetry**: No usage data collected

## 🛠️ Troubleshooting

### Python Dependency Issues
- **Error:** "Required Python dependencies are not installed"
- **Solution:** Follow the Python setup steps in [docs/guides/python-setup.md](docs/guides/python-setup.md)
- Quick fix:
  ```bash
  python3 -m pip install -r embedding_sidecar/requirements.txt
  ```

### High Memory Usage
- Check Settings → File Types and disable PDF if needed
- Reduce the number of watched folders
- The app automatically manages memory through process restarts

### Indexing Not Working
- Verify folders are added in Settings
- Check that file types are enabled
- Look for errors in DevTools console (Cmd+Option+I)
- Ensure Python dependencies are installed (see above)

### Search Not Finding Results
- Wait for initial indexing to complete
- Check the indexed file count in Settings
- Try simpler search terms

## 📦 Project Structure

```
Semantica/
├── src/
│   ├── main/              # Main process
│   │   ├── main.ts
│   │   ├── preload.ts
│   │   ├── worker/        # Worker thread
│   │   ├── core/          # Core business logic
│   │   ├── services/      # Application services
│   │   └── parsers/       # File format parsers
│   ├── renderer/          # React UI
│   │   ├── App.tsx
│   │   └── components/
│   ├── shared/            # Shared types and utilities
│   └── ipc/               # IPC definitions
├── embedding_sidecar/     # Python FastAPI service
│   ├── main.py
│   └── requirements.txt
├── dist/                  # Build outputs
├── docs/                  # Documentation
│   ├── specs/             # System specifications
│   └── guides/            # How-to guides
├── tests/                 # Test files
│   ├── unit/              # Unit tests
│   └── e2e/               # E2E tests
└── planning/              # Future plans
```

## 🤝 Contributing

Contributions are welcome! Please:
1. Fork the repository
2. Create a feature branch
3. Write tests for new functionality
4. Ensure all tests pass
5. Submit a pull request

## 📝 License

MIT License - see LICENSE file for details.

## 🙏 Acknowledgments

- [sentence-transformers](https://www.sbert.net/) for local embeddings
- [LanceDB](https://lancedb.com) for vector database
- [Electron](https://electronjs.org) for desktop framework
- The open-source community for invaluable tools and libraries
