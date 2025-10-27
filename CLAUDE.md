# CLAUDE.md - AI Assistant Context

This file provides important context and guidelines for AI assistants working on the Semantica project.

## Project Overview

Semantica is an Electron-based application that provides offline semantic search capabilities for Mac users. It indexes local documents and enables natural language search using vector embeddings.

## Key Technical Context

### Architecture
- **Multi-process design**: Main process and Worker thread
- **Python Sidecar**: FastAPI HTTP server for embeddings (process isolation, memory management)
- **Search-first UI**: Full-screen search with modal settings overlay
- See [architecture.md](./docs/specs/02-architecture.md) for complete details

### Technology Stack
- **Frontend**: React, TypeScript, Tailwind CSS
- **Backend**: Electron, Node.js Worker Threads
- **Database**: LanceDB for vector storage
- **ML Model**: Python sidecar with sentence-transformers (paraphrase-multilingual-mpnet-base-v2, 768-dim)
- **Embedding Service**: FastAPI HTTP server running locally on port 8421
- **File Parsers**: PDF, DOCX, DOC, RTF, TXT, MD, XLSX, XLS, CSV, TSV

## Important Guidelines

### Project Structure
The codebase follows a domain-driven organization:
```
src/main/
├── core/           # Core business logic
│   ├── indexing/   # File scanning and status management
│   ├── embedding/  # Embedding queue and processing
│   └── reindex/    # Re-indexing and folder management
├── services/       # Application services layer
├── worker/         # Worker thread entry point
├── parsers/        # File format parsers
├── startup/        # Application startup coordination
└── utils/          # Shared utilities
```

### Documentation Organization
Documentation is organized under `/docs/`:
- `/docs/specs/` - System specifications and architecture
- `/docs/guides/` - How-to guides and tutorials
- `/docs/analysis/` - Research and analysis documents
- `/planning/` - Future plans and proposals

### Code Conventions
1. **TypeScript**: Use strict typing, avoid `any`
2. **React**: Functional components with hooks
3. **File naming**: Components in PascalCase, utilities in camelCase
4. **Imports**: Absolute imports from `@/` for app code

### Testing Requirements
- Run tests with `npm test` before committing
- Maintain test coverage above 85%
- Test file parsers with real document samples
- See [testing strategy](./planning/testing-strategy.md) for details

### Memory Management
- Worker process limited to 1500MB RSS
- Python sidecar manages its own memory externally (no manual restarts needed)
- Stable memory usage: 400-600MB for embedding service
- See [memory-solution.md](./docs/specs/memory-solution.md) for legacy ONNX implementation

### Database Operations
- LanceDB requires initialization with dummy data
- File status tracked in separate table
- Avoid complex WHERE clauses (not yet implemented)
- See [troubleshooting.md](./docs/specs/troubleshooting.md) for common issues

## Common Tasks

### Re-indexing Documents
- Re-indexing uses the existing progress bar (not a separate one)
- Clears all indexes for selected folders
- Automatically starts indexing with current settings

### Adding File Parser Support
1. Create parser in `/src/main/parsers/`
2. Export async function returning text string
3. Register in `processFile()` function
4. Add file extension to UI settings
5. Update documentation

### Debugging Tips
- Check `~/Library/Logs/Semantica/` for logs
- Use `window.api.db.stats()` for database metrics
- Monitor memory with `window.api.indexer.progress()`
- File search available via status bar icon

## Known Limitations
- Scanned PDFs require OCR (not supported)
- Password-protected files cannot be indexed
- Large files (>50MB) may cause timeouts
- Binary formats need specific parsers

## Development Workflow

### Starting Development
```bash
npm install
npm run dev
```

### Selective Logging
The codebase uses a category-based logging system to reduce noise. Configure with `LOG_CATEGORIES`:

```bash
# Default (silent - only errors)
npm run dev

# Show progress
LOG_CATEGORIES=PIPELINE-STATUS npm run dev

# Debug file processing
LOG_CATEGORIES=WORKER,INDEXING,QUEUE npm run dev

# Debug embedder issues
LOG_CATEGORIES=EMBEDDER-*,MEMORY npm run dev

# Show all logs
LOG_CATEGORIES=* npm run dev
```

See [logging.md](./docs/guides/logging.md) for available categories.

### Building for Production
```bash
npm run build
npm run package
```

### Running Tests
```bash
npm test              # All tests
npm run test:unit     # Unit tests only
npm run test:e2e      # E2E tests only

# E2E tests with mocked downloads (for testing without network)
E2E_MOCK_DOWNLOADS=true E2E_MOCK_DELAYS=true npm run test:e2e
```

### E2E Testing Notes
- Tests run sequentially (not in parallel) to avoid race conditions
- Mock downloads available for testing model download flow
- See [operations guide](./specs/04-operations.md#e2e-testing-configuration) for details

## Recent Updates

### 2025-10-27 - Python Sidecar Migration
- **Architecture upgrade**: Migrated from Ollama to Python FastAPI sidecar for embeddings
- **100% reliability**: Eliminates EOF errors and segmentation faults (was 1-2% failure rate with Ollama)
- **Model**: sentence-transformers paraphrase-multilingual-mpnet-base-v2 (768-dim, multilingual)
- **Performance**: 55-93 texts/sec throughput, <800MB memory usage
- **Auto-managed**: Sidecar runs automatically on port 8421, no manual setup required
- **Simpler codebase**: Removed ~205 lines of workaround code (promise queues, retry logic)
- **HTTP API**: Simple REST interface (/health, /embed, /info endpoints)
- **Database version 4**: One-time re-indexing required on first launch
- **Legacy code**: Ollama implementation preserved for reference
- See `planning/python-sidecar-implementation-plan.md` for full details

### 2025-10-26 - Model Switch to nomic-embed-text
- **Critical fix**: Switched from bge-m3 to nomic-embed-text due to upstream Ollama bugs
- **Stability**: nomic-embed-text is more stable, doesn't have pooling_type crashes
- **Vector dimensions**: Changed from 1024-dim to 768-dim (DB version 3)
- **Database migration**: Auto-migrates on startup, clears old embeddings
- **Root cause**: bge-m3 had segmentation faults in llama.cpp causing intermittent EOF errors
- **Request serialization**: Added promise queue to prevent concurrent Ollama requests
- **See**: `planning/eof-debugging-logging-added.md` for full investigation details

### 2025-10-25 - Ollama Migration
- **Architecture simplification**: Migrated from HuggingFace Transformers + ONNX Runtime to Ollama
- **Memory improvement**: 3-6× reduction in memory footprint using quantized GGUF models
- **Process isolation**: Ollama runs as external service, eliminating child process complexity
- **Model upgrade**: Initially used bge-m3 (later replaced with nomic-embed-text)
- **Auto-management**: Ollama handles model lifecycle, memory management, and auto-scaling
- **Stability improvements**: No more embedder child process crashes or manual restarts
- **Codebase simplification**: Removed ~1000 lines of child process management code
- **Dependencies removed**: `@xenova/transformers`, `onnxruntime-node` (binary dependencies)
- **Setup requirement**: Ollama must be installed and running (auto-detected and started on macOS)
- **Legacy code**: Old transformer-based implementation files retained temporarily for reference

### 2025-09-20 - Selective Logging System
- **Category-based logging**: Replaced verbose logging with selective category system
- **Silent by default**: Only shows errors unless configured (updated 2025-10-27)
- **Developer control**: Use LOG_CATEGORIES environment variable to enable specific logs
- **Performance**: Reduced console I/O overhead by ~90%
- **Debugging presets**: Common scenarios like `EMBEDDER-*` for embedder debugging
- **Logger utility**: Centralized logging in `/src/shared/utils/logger.ts`

### 2025-08-31 - Performance Optimizations & Profiling
- **4x Performance Improvement**: Increased embedding batch size from 8 to 32, added parallel processing
- **Parallel Batch Processing**: Now processes 2 embedding batches concurrently for 2x speedup
- **Configurable Performance**: Added embeddingBatchSize and parallelBatches settings
- **Performance Profiling System**: Added comprehensive profiling to identify bottlenecks
- **ISO-8859-1 Fix**: Enhanced detection and handling of ISO-8859-1 encoded files (common in legacy code)
- **Better Error Handling**: Added detailed logging and fallback encoding strategies
- **Parser version 4**: Text/markdown parsers updated with robust legacy encoding support
- **Identified Bottleneck**: Embeddings take 94.5% of processing time

### 2025-08-30 - Text Encoding Detection
- **Fixed garbled text issue**: Text files with non-UTF-8 encodings (ISO-8859-1, Windows-1252, etc.) now display correctly
- **Multi-encoding support**: Added automatic encoding detection using `chardet` library
- **Encoding conversion**: Proper conversion to UTF-8 using `iconv-lite`
- **UTF-16 detection**: Special handling for UTF-16LE/BE files with and without BOM
- **Mac Roman support**: Added detection for Mac Roman encoded files (common in legacy Mac files)
- **Encoding utility**: Created `src/main/utils/encoding-detector.ts` for reusable encoding detection
- **Parser versioning**: Centralized parser versions with single source of truth in each parser file
- **Comprehensive tests**: Added 30+ unit tests for encoding detection and conversion

### 2025-09-03 - E2E Testing Improvements
- **Sequential Test Execution**: Configured Playwright to run tests sequentially to avoid race conditions
- **Mock Network Requests**: Implemented Undici MockAgent for intercepting fetch in worker threads
- **Test Environment Variables**: Added E2E_MOCK_DOWNLOADS and E2E_MOCK_DELAYS for controlled testing
- **Fixed Model Path Issues**: Updated checkModelExists to accept userDataPath parameter
- **Improved Test Reliability**: E2E tests now pass consistently without network dependencies

### 2025-08-24
- Implemented search-first UI with modal settings
- Added file search feature in status bar
- Fixed .doc file parsing with word-extractor
- Created file status tracking in database
- Normalized documentation file naming
- Reorganized docs into specs/planning folders

## Resources
- [Architecture](./specs/architecture.md) - System design
- [Memory Solution](./specs/memory-solution.md) - Memory management
- [Troubleshooting](./specs/troubleshooting.md) - Common issues
- [Documentation Standards](./specs/documentation-standards.md) - File naming conventions
- [Parser Version Tracking](./planning/parser-version-tracking.md) - Future re-indexing system
- Never run `npm run dev` without asking me first
- Never commit to git without my permission

## Release Notes
- Release notes should be created in the `releases/` folder
- Follow the concise format used in existing releases (e.g., v1.0.2.md)
- Include sections: What's New, How to Update, Notes
- Keep it brief and user-focused