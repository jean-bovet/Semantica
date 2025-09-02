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
- 8GB RAM recommended
- ~500MB disk space for models and index

### Development

```bash
# Clone the repository
git clone https://github.com/yourusername/semantica.git
cd semantica

# Install dependencies
npm install

# Start development server
npm run dev
```

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
        └── Embedder Child Process (Isolated)
            └── Transformers.js
```

**Key Design Decisions:**
- Worker thread owns the database for thread safety
- Embeddings run in isolated child process to prevent memory leaks
- Automatic process restart when memory thresholds exceeded
- Process isolation allows unlimited file indexing

For detailed architecture documentation, see [specs/02-architecture.md](specs/02-architecture.md).

## 💾 Memory Management

The application implements sophisticated memory management through process isolation:

- **Stable Memory Usage**: ~270MB even after indexing thousands of files
- **Automatic Recovery**: Child process restarts when thresholds exceeded
- **Configurable Limits**: Tune memory limits based on your system

For details on the memory solution, see [specs/archive/memory-solution.md](specs/archive/memory-solution.md).

## 🧪 Testing

✅ **All tests passing** - 81 tests across 10 files  
⏱️ **Fast execution** - Complete suite runs in ~3.3 seconds  
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
- **Transformers.js**: Local, quantized embeddings (no cloud API)
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

### High Memory Usage
- Check Settings → File Types and disable PDF if needed
- Reduce the number of watched folders
- The app automatically manages memory through process restarts

### Indexing Not Working
- Verify folders are added in Settings
- Check that file types are enabled
- Look for errors in DevTools console (Cmd+Option+I)

### Search Not Finding Results
- Wait for initial indexing to complete
- Check the indexed file count in Settings
- Try simpler search terms

## 📦 Project Structure

```
Semantica/
├── app/
│   ├── electron/          # Main process & worker
│   │   ├── main.ts
│   │   ├── preload.ts
│   │   └── worker/
│   │       ├── index.ts
│   │       └── embedder.child.ts
│   └── renderer/          # React UI
│       ├── App.tsx
│       └── components/
├── dist/                  # Build outputs
├── docs/                  # Documentation
│   ├── build-instructions.md
│   └── release-checklist.md
├── scripts/               # Utility scripts
│   ├── ab-embed-benchmark.ts
│   └── db-ingest-benchmark.ts
├── specs/                 # Specifications
└── tests/                 # Test files
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

- [Transformers.js](https://github.com/xenova/transformers.js) for local embeddings
- [LanceDB](https://lancedb.com) for vector database
- [Electron](https://electronjs.org) for desktop framework
- The open-source community for invaluable tools and libraries