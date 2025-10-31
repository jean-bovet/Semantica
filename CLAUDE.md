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
- **Backend**: Electron 38.4.0, Node.js 22.19.0 (via Electron), Worker Threads
- **Database**: LanceDB for vector storage
- **ML Model**: Python sidecar with sentence-transformers (paraphrase-multilingual-mpnet-base-v2, 768-dim)
- **Embedding Service**: FastAPI HTTP server running locally on port 8421
- **File Parsers**: PDF, DOCX, DOC, RTF, TXT, MD, XLSX, XLS, CSV, TSV
- **Build System**: electron-builder 25.1.8 (see Build Notes below)

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
- Unit tests: 505 tests (all passing, in `tests/unit/`)
- Integration tests: 8 tests (in `tests/integration/`, includes Python sidecar integration)
- E2E tests: 5 tests, all passing (requires NODE_ENV=production to load built HTML)

### Memory Management
- Worker process limited to 1500MB RSS
- Python sidecar manages its own memory externally (no manual restarts needed)
- Stable memory usage: 400-600MB for embedding service

### Database Operations
- LanceDB requires initialization with dummy data
- File status tracked in separate table
- Avoid complex WHERE clauses (not yet implemented)

### Build System Notes
- **Electron Version**: 38.4.0 (upgraded from 33.x)
  - Chromium 140, Node.js 22.19.0
  - macOS 12+ (Monterey or later) required
  - Native modules rebuilt for Node.js 22
- **electron-builder**: Must use v25.1.8 (not v26.x)
  - electron-builder 26.x has a bug with LanceDB's optional dependencies
  - It scans all platform-specific packages even if not installed
  - v25.1.8 works perfectly with Electron 38 and handles optional deps correctly
- **Security**: All modern Electron security practices enabled (context isolation, sandbox, secure IPC)

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
npm test                 # Unit tests only (default)
npm run test:unit        # Unit tests only
npm run test:integration # Integration tests only (requires Python sidecar)
npm run test:all         # All unit + integration tests
npm run test:e2e         # E2E tests only

# E2E tests with mocked downloads (for testing without network)
E2E_MOCK_DOWNLOADS=true E2E_MOCK_DELAYS=true npm run test:e2e
```

### E2E Testing Notes
- Tests run sequentially (not in parallel) to avoid race conditions
- Mock downloads available for testing model download flow
- See [operations guide](./docs/specs/04-operations.md#e2e-testing-configuration) for details

## Resources

### Key Documentation
- [Architecture](./docs/specs/02-architecture.md) - System design and overview
- [Startup Flow](./docs/specs/08-startup-flow.md) - Complete initialization sequence
- [Python Sidecar](./docs/specs/python-sidecar.md) - Embedding service specification
- [Folder Structure](./docs/specs/12-folder-structure.md) - Codebase organization
- [Logging Guide](./docs/guides/logging.md) - Category-based logging system

### Important Constraints
- Never run `npm run dev` without asking me first
- Never commit to git without my permission

## Release Notes
- Release notes should be created in the `releases/` folder
- Follow the concise format used in existing releases (e.g., v1.0.2.md)
- Include sections: What's New, How to Update, Notes
- Keep it brief and user-focused