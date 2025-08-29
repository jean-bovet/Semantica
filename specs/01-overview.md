# Semantica - Product Overview

## Executive Summary

Semantica is an Electron-based desktop application that provides offline semantic search capabilities for Mac users. It indexes local documents and enables natural language search using vector embeddings, with 100% on-device processing for complete privacy.

## Product Vision

**Goal**: Deliver a fast, private, semantic search experience for local documents without any data leaving the device.

**Target Users**: Mac users who need to search through large document collections (PDFs, Word docs, text files) using natural language queries rather than exact keyword matching.

**Key Differentiators**:
- 100% offline - no internet required, complete privacy
- Semantic understanding - finds conceptually related content
- Native Mac experience - integrates with Finder
- Zero configuration ML - embeddings work out of the box

## Core Features

### Search Capabilities
- **Semantic Search**: Natural language queries find conceptually related content
- **File Search**: Direct filename/path search with status indicators
- **Multi-lingual Support**: Xenova/multilingual-e5-small model
- **Real-time Results**: Instant search with 300ms debouncing
- **Search-First UI**: Full-screen search interface for maximum visibility

### Document Support
- **File Formats**: PDF, DOCX, DOC (v2), RTF, TXT, MD
- **Folder Selection**: Choose multiple folders to index
- **File Watching**: Automatic indexing of new/modified files
- **Exclusion Patterns**: Skip node_modules, .git, etc.

### Indexing Features
- **Incremental Indexing**: Only process new/changed files
- **Parser Versioning**: Auto re-index when parsers improve
- **Progress Tracking**: Real-time status in UI
- **Pause/Resume**: Control indexing process
- **Memory Safe**: Stable ~270MB memory usage

### User Experience
- **Modal Settings**: Clean overlay for configuration
- **Status Bar**: Live indexing statistics
- **File Actions**: Open in Finder, Open in Preview
- **Keyboard Shortcuts**: CMD+K for search, ESC to close

## Current Implementation Status

### Completed Features ✅
- Multi-process architecture with memory isolation
- All file parsers (PDF, DOCX, DOC v2, RTF, TXT, MD)
- Parser version tracking and auto-upgrade
- Semantic search with multilingual support
- File status database with persistence
- Search-first UI with modal settings
- Memory management (stable at ~270MB)
- Error recovery and retry logic
- File watching and incremental indexing

### Known Limitations ⚠️
- **Scanned PDFs**: No OCR support (require text layer)
- **Large Files**: >50MB may cause timeouts
- **Protected Files**: Cannot index encrypted documents
- **Binary Formats**: Need specific parsers for each type

### Future Enhancements 🚀
- **OCR Integration**: Process scanned documents
- **Cloud Storage**: Index Google Drive, Dropbox
- **Advanced Search**: Boolean operators, filters
- **Search History**: Recent queries and results
- **Export Results**: Save search results as reports

## Technical Specifications

### Performance Targets
- **Indexing Speed**: 5 files concurrently
- **Search Latency**: <100ms for vector search
- **Memory Usage**: ~270MB typical, 1.5GB max
- **Database Size**: ~1KB per document chunk

### Privacy & Security
- **100% Offline**: No network requests
- **Local Storage**: ~/Library/Application Support/
- **No Telemetry**: Zero tracking or analytics
- **Process Isolation**: Sandboxed renderer
- **Single Instance**: Prevents conflicts

### Platform Requirements
- **OS**: macOS 10.15+ (Catalina or later)
- **Memory**: 4GB RAM minimum
- **Storage**: 500MB for app + index space
- **Processor**: Intel or Apple Silicon

## Project Structure

```
Semantica/
├── app/
│   ├── electron/        # Main process, workers
│   └── renderer/        # React UI
├── specs/              # Documentation
│   ├── 01-overview.md          # This file
│   ├── 02-architecture.md      # System design
│   ├── 03-implementation.md    # Technical details
│   ├── 04-operations.md        # Operations guide
│   └── 05-api-reference.md     # API documentation
├── tests/              # Test suites
└── planning/           # Future features
```

## Success Metrics

### User Experience
- Search results in <100ms
- Zero crashes during normal use
- Intuitive UI requiring no manual

### Technical Quality
- Test coverage >85%
- Memory stable over days
- All file types parse correctly

### Adoption Indicators
- Daily active usage
- >1000 documents indexed
- Positive user feedback

## Getting Started

### For Users
1. Download Semantica.dmg from releases
2. Drag to Applications folder
3. Launch and select folders to index
4. Start searching with natural language

### For Developers
```bash
git clone https://github.com/[repo]/semantica.git
cd semantica
npm install
npm run dev
```

See [02-architecture.md](./02-architecture.md) for system design and [03-implementation.md](./03-implementation.md) for technical details.

## Release Status

**Current Version**: 1.0.0-beta
**Release Date**: 2025-08
**Stability**: Production-ready for local use
**Distribution**: Notarized DMG (not sandboxed)

## Support & Resources

- **Documentation**: This specs/ folder
- **Issues**: GitHub Issues for bug reports
- **Logs**: ~/Library/Logs/Semantica/
- **Support**: File search (🔍) for diagnostics

---

*Next: [02-architecture.md](./02-architecture.md) - System Architecture*