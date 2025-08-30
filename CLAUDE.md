# CLAUDE.md - AI Assistant Context

This file provides important context and guidelines for AI assistants working on the Semantica project.

## Project Overview

Semantica is an Electron-based application that provides offline semantic search capabilities for Mac users. It indexes local documents and enables natural language search using vector embeddings.

## Key Technical Context

### Architecture
- **Multi-process design**: Main process, Worker thread, and Embedder child process
- **Memory isolation**: Embedder process auto-restarts to prevent memory leaks
- **Search-first UI**: Full-screen search with modal settings overlay
- See [architecture.md](./specs/architecture.md) for complete details

### Technology Stack
- **Frontend**: React, TypeScript, Tailwind CSS
- **Backend**: Electron, Node.js Worker Threads
- **Database**: LanceDB for vector storage
- **ML Model**: Xenova/multilingual-e5-small for embeddings
- **File Parsers**: PDF, DOCX, DOC, RTF, TXT, MD

## Important Guidelines

### Documentation Standards
**IMPORTANT**: Follow the documentation naming conventions defined in [documentation-standards.md](./specs/documentation-standards.md):
- Use ALL CAPS for standard files: `README.md`, `CLAUDE.md`, `LICENSE.md`
- Use lowercase-with-hyphens for all other docs: `architecture.md`, `testing-strategy.md`
- Organize docs into `/specs/`, `/docs/`, and `/planning/` folders

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
- Embedder process limited to 300MB external
- Auto-restart after 200-500 files or memory threshold
- See [memory-solution.md](./specs/memory-solution.md) for implementation

### Database Operations
- LanceDB requires initialization with dummy data
- File status tracked in separate table
- Avoid complex WHERE clauses (not yet implemented)
- See [troubleshooting.md](./specs/troubleshooting.md) for common issues

## Common Tasks

### Re-indexing Documents
- Re-indexing uses the existing progress bar (not a separate one)
- Clears all indexes for selected folders
- Automatically starts indexing with current settings

### Adding File Parser Support
1. Create parser in `/app/electron/parsers/`
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
```

## Recent Updates

### 2025-08-30 - Text Encoding Detection
- **Fixed garbled text issue**: Text files with non-UTF-8 encodings (ISO-8859-1, Windows-1252, etc.) now display correctly
- **Multi-encoding support**: Added automatic encoding detection using `chardet` library
- **Encoding conversion**: Proper conversion to UTF-8 using `iconv-lite`
- **UTF-16 detection**: Special handling for UTF-16LE/BE files with and without BOM
- **Mac Roman support**: Added detection for Mac Roman encoded files (common in legacy Mac files)
- **Encoding utility**: Created `src/main/utils/encoding-detector.ts` for reusable encoding detection
- **Parser versioning**: Centralized parser versions with single source of truth in each parser file
- **Comprehensive tests**: Added 30+ unit tests for encoding detection and conversion
- **Parser version 3**: Text and markdown parsers updated to version 3 with encoding support

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