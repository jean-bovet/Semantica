# Historical Documentation

This folder contains documentation for issues that have been resolved. These documents are preserved for historical reference and understanding of the evolution of the system.

## Resolved Issues

### Memory Management
- **[worker-memory-leak-issue.md](./worker-memory-leak-issue.md)** - Original memory leak issue in worker thread
  - **Problem**: Worker thread memory grew to 1.5GB+ during file processing
  - **Resolution**: Implemented WorkerManager with auto-restart at 800MB RSS
  - **Date Resolved**: August 31, 2025

- **[transformers-memory-leak-analysis.md](./transformers-memory-leak-analysis.md)** - Analysis of transformers.js memory leaks
  - **Problem**: Transformers.js library leaking ~50MB per file due to tensor management
  - **Resolution**: Implemented EmbedderManager with auto-restart at 300MB/200 files
  - **Date Resolved**: August 31, 2025

## Current Implementation

For the current production-ready memory management system, see:
- [11-memory-management.md](../11-memory-management.md) - Complete production memory management documentation
- [02-architecture.md](../02-architecture.md) - Current system architecture with process hierarchy