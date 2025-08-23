# Offline Mac Search App

A privacy-first, offline semantic search application for macOS that indexes your documents locally and provides fast, intelligent search capabilities—all without sending any data off your device.

## Features

- 🔒 **100% Offline**: All processing happens on your Mac. No data leaves your device.
- 🚀 **Fast Semantic Search**: Uses local embeddings and vector search for intelligent results
- 📁 **Multi-format Support**: Indexes PDF, TXT, and Markdown files
- 🔄 **Real-time Indexing**: Watches folders and automatically indexes new/changed files
- ⚡ **Native Performance**: Built with Electron and optimized for macOS
- 🎯 **Smart Chunking**: Intelligent text segmentation for better search results

## Quick Start

### Development

```bash
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

# Create DMG for distribution
npm run dist
```

## Architecture

The app uses a worker-owned database pattern:
- **Main Process**: Manages windows and IPC communication
- **Worker Thread**: Owns the LanceDB instance, handles all indexing and search
- **Renderer**: React-based UI with instant search

## Technology Stack

- **Electron**: Cross-platform desktop framework
- **TypeScript**: Type-safe development
- **React**: UI components
- **LanceDB**: Vector database for semantic search
- **Transformers.js**: Local, quantized embeddings (no cloud API)
- **PDF.js**: PDF text extraction
- **Vite**: Fast dev server with HMR

## Privacy & Security

- ✅ No network requests during indexing or search
- ✅ All models run locally on CPU
- ✅ Data stored in `~/Library/Application Support/`
- ✅ Hardened runtime and notarization ready
- ✅ Respects macOS privacy (no Full Disk Access required)

## Testing

```bash
# Run tests in watch mode
npm test

# Run tests once (CI mode)
npm run test:ci

# Generate coverage report
npm run coverage
```

## System Requirements

- macOS 13.0 or later
- 8GB RAM recommended
- ~500MB disk space for models and index

## License

MIT