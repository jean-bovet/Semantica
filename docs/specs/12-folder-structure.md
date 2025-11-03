# Folder Structure

*Previous: [10-release-process.md](./10-release-process.md)*

---

## Overview

The Semantica codebase follows a domain-driven design pattern, organizing code by business domain rather than technical layers. This structure improves code discoverability, maintainability, and enforces clear boundaries between different parts of the application.

## Directory Structure

```
semantica/
├── src/
│   ├── main/                     # Electron main process
│   │   ├── core/                 # Core business logic (domain-driven)
│   │   │   ├── indexing/         # File indexing domain
│   │   │   ├── embedding/        # Embedding generation domain
│   │   │   └── reindex/          # Re-indexing domain
│   │   ├── services/             # Application services layer
│   │   ├── worker/               # Worker thread entry point
│   │   │   ├── embeddings/       # Embedder implementations
│   │   │   ├── index.ts          # Worker main entry
│   │   │   ├── WorkerStartup.ts  # Startup state machine
│   │   │   ├── PythonSidecarService.ts  # Sidecar lifecycle
│   │   │   └── PythonSidecarClient.ts   # HTTP client
│   │   ├── parsers/              # File format parsers
│   │   ├── startup/              # Application startup coordination
│   │   ├── pipeline/             # Processing pipeline utilities
│   │   ├── utils/                # Main process utilities
│   │   ├── main.ts               # Main process entry point
│   │   └── preload.ts            # Preload script for renderer
│   │
│   ├── renderer/                  # React UI application
│   │   ├── components/           # React components
│   │   ├── contexts/             # React contexts
│   │   ├── hooks/                # Custom React hooks
│   │   ├── utils/                # UI utilities
│   │   ├── App.tsx               # Root component
│   │   └── main.tsx              # Renderer entry point
│   │
│   └── shared/                    # Shared between main & renderer
│       ├── config/               # Configuration types & I/O
│       ├── types/                # Shared TypeScript types
│       ├── utils/                # Shared utilities (logger)
│       └── parserRegistry.ts     # Parser definitions
│
├── tests/
│   ├── unit/                     # Unit tests
│   ├── integration/              # Integration tests
│   ├── e2e/                      # End-to-end tests
│   ├── fixtures/                 # Test fixtures
│   ├── helpers/                  # Test helpers
│   └── mocks/                    # Test mocks
│
├── docs/
│   ├── specs/                    # System specifications
│   ├── guides/                   # How-to guides
│   ├── analysis/                 # Research and analysis
│   └── planning/                 # Future plans (at root)
│
├── resources/                    # Application resources
├── build/                        # Build configuration
├── dist/                         # Build output
└── releases/                     # Release notes
```

## Core Domain Organization

### `src/main/core/`

The core directory contains the business logic organized by domain:

#### `indexing/` - File Indexing Domain
Handles discovering, scanning, and tracking files for indexing.

- **`fileScanner.ts`**: Main file processing pipeline
  - Scans directories for supported files
  - Queues files for processing
  - Manages processing state

- **`fileStatusManager.ts`**: File status tracking
  - Tracks indexing status (indexed, failed, queued, outdated)
  - Manages file hashes for change detection
  - Handles status persistence in database

- **`directoryScanner.ts`**: Directory traversal
  - Recursively scans directories
  - Applies inclusion/exclusion patterns
  - Handles file system permissions

#### `embedding/` - Embedding Generation Domain
Manages the queue and processing of text embeddings.

- **`EmbeddingQueue.ts`**: Work queue management
  - Batches chunks for efficient processing
  - Implements backpressure control
  - Manages concurrent processing

- **`ConcurrentQueue.ts`**: Concurrent processing
  - Handles parallel batch processing
  - Manages worker pool distribution
  - Implements queue prioritization

- **`PerformanceProfiler.ts`**: Performance monitoring
  - Tracks processing metrics
  - Identifies bottlenecks
  - Generates performance reports

#### `reindex/` - Re-indexing Domain
Handles file updates and folder management.

- **`reindexManager.ts`**: Re-index decision logic
  - Determines when files need re-indexing
  - Tracks parser version changes
  - Manages file modification detection

- **`ReindexOrchestrator.ts`**: Re-index coordination
  - Orchestrates full re-indexing operations
  - Manages progress tracking
  - Handles error recovery

- **`FolderRemovalManager.ts`**: Folder removal
  - Removes folders from index
  - Cleans up orphaned entries
  - Updates file status records

## Services Layer

### `src/main/services/`

Application services provide high-level operations using core domain logic:

- **`PipelineService.ts`**: Pipeline monitoring
  - Formats pipeline status for display
  - Aggregates processing metrics
  - Provides real-time statistics

- **`ReindexService.ts`**: Re-indexing service
  - High-level re-indexing API
  - Coordinates with UI updates
  - Manages user-initiated re-indexing

## Worker Thread

### `src/main/worker/`

Worker thread implementation with Python sidecar integration. Refactored to 1,498 lines (from 1,855) with modular structure:

- **`index.ts`**: Worker thread entry point (1,498 lines)
  - Initializes core components
  - Sets up IPC communication
  - Manages worker lifecycle
  - Orchestrates file processing
  - Uses extracted modules for focused functionality

- **`WorkerStartup.ts`**: Startup state machine
  - Manages 9-stage initialization sequence
  - Listens for Python sidecar progress events
  - Emits `startup:stage` messages to main process

- **`PythonSidecarService.ts`**: Python process lifecycle
  - Spawns and manages Python child process
  - Handles `embed_server.py` on port 8421
  - Parses PROGRESS events from stdout
  - Provides health checks and auto-restart

- **`PythonSidecarClient.ts`**: HTTP client for embeddings
  - Makes HTTP requests to Python sidecar API
  - Handles retries and error recovery
  - Timeout management (30s default)

#### `utils/` - File Utilities

Worker utility functions:

- **`fileUtils.ts`**: File operations
  - `getFileHash()`: Calculate file hash from size/mtime
  - `isInsideBundle()`: Check if file is in macOS bundle

#### `database/` - Database Operations

Database management and migration:

- **`migration.ts`**: Database version management (current: v5)
  - `checkDatabaseVersion()`: Check if migration needed
  - `migrateDatabaseIfNeeded()`: Perform migration
  - `writeDatabaseVersion()`: Write version file
  - Version 5: Fixed cross-file contamination in batch processing

- **`operations.ts`**: Database CRUD operations
  - `mergeRows()`: Queue-based row insertion
  - `deleteByPath()`: Delete chunks by file path
  - `maybeCreateIndex()`: Create vector index when needed
  - `createWriteQueueState()`: Manage concurrent writes

#### `batch/` - Batch Processing

Embedding batch processing:

- **`processor.ts`**: Batch processor implementation
  - `processBatchToRows()`: Pure function to process batches
  - `createBatchProcessor()`: Factory for batch processor
  - Fixed bug: Each chunk uses its own file path (not shared)
  - File stats caching to avoid redundant fs.stat() calls

#### `shutdown/` - Graceful Shutdown Orchestration

Coordinates graceful worker shutdown with queue draining:

- **`types.ts`**: Shutdown type definitions
  - `QueueStats`: Generic queue statistics interface
  - `WaitForQueueOptions`: Configuration for queue draining
  - `ShutdownDependencies`: Dependencies needed for shutdown
  - `ShutdownOptions`: Configuration for shutdown process
  - `ShutdownResult`: Per-step results tracking

- **`queueDrainer.ts`**: Generic queue draining logic
  - `waitForQueueToDrain()`: Pure async function for any queue type
  - Configurable timeouts and poll intervals
  - Progress callbacks for monitoring
  - Highly testable (pure function with dependency injection)

- **`orchestrator.ts`**: Graceful shutdown coordination
  - `performGracefulShutdown()`: 8-step shutdown process
  - Drains file queue, embedding queue, write queue (with timeouts)
  - Shuts down Python sidecar and closes database
  - Returns detailed per-step success/failure results

#### `fileStatus.ts` - File Status Management

Track file indexing status:

- `updateFileStatus()`: Update file status in database
  - Tracks indexed, failed, error, deleted states
  - Records chunk count, parser version, error messages

#### `search.ts` - Search Operations

Vector search and statistics:

- `search()`: Perform semantic search on vector database
- `getStats()`: Get database statistics and folder stats
- Interfaces: SearchResult, DatabaseStats, FolderStats

#### `embeddings/` - Embedder Implementations

Worker-specific embedder code:

- **`IEmbedder.ts`**: Embedder interface definition
- **`PythonSidecarEmbedder.ts`**: Python sidecar implementation
  - Implements IEmbedder interface
  - Wraps PythonSidecarClient
  - Provides retry logic and stats tracking
- **`TestEmbedder.ts`**: Mock embedder for tests
- **`EmbedderFactory.ts`**: Factory for creating embedders

## Shared Code

### `src/shared/`

**Code truly shared between main and renderer processes only.**

After cleanup (2025-10-27), this folder contains only code that needs to be accessible from both processes:

- **`config/configIO.ts`**: Configuration I/O
  - Read/write app configuration
  - Validate and migrate config schemas
  - Shared between main (worker) and settings UI

- **`types/startup.ts`**: Startup types (SINGLE SOURCE OF TRUTH)
  - StartupStage type definitions
  - STARTUP_STAGE_ORDER constant
  - IPC message types (StartupStageMessage, StartupErrorMessage)
  - Type-safe message creators

- **`utils/logger.ts`**: Logging utility
  - Category-based logging system
  - Used by all processes (main, worker, renderer)
  - Silent by default unless LOG_CATEGORIES set

- **`parserRegistry.ts`**: Parser definitions
  - File type to parser mappings
  - Shared between file scanner and settings UI

**Note:** Embedder code previously in `src/shared/embeddings/` has been moved to `src/main/worker/embeddings/` since it's only used by the worker thread, not the renderer.

## Design Principles

### 1. Domain-Driven Design
- Code organized by business domain, not technical layers
- Clear boundaries between domains
- Each domain is self-contained with its own logic

### 2. Separation of Concerns
- Core logic separated from infrastructure
- Services layer for high-level operations
- Worker thread only handles coordination

### 3. Testability
- Core logic isolated from Electron/Node specifics
- Dependency injection for testing
- Clear interfaces between components

### 4. Performance
- Domains optimized independently
- Minimal cross-domain dependencies
- Efficient data flow between components

## Migration from Previous Structure

The refactoring moved files from a flat worker directory to domain-specific folders:

| Old Location | New Location | Purpose |
|--------------|--------------|---------|
| `worker/fileScanner.ts` | `core/indexing/fileScanner.ts` | Domain organization |
| `worker/EmbeddingQueue.ts` | `core/embedding/EmbeddingQueue.ts` | Domain organization |
| `worker/reindexManager.ts` | `core/reindex/reindexManager.ts` | Domain organization |
| `worker/PipelineStatusFormatter.ts` | `services/PipelineService.ts` | Service layer |

## Benefits

1. **Improved Navigation**: Related files grouped together
2. **Clear Dependencies**: Domain boundaries prevent coupling
3. **Better Testing**: Core logic isolated from infrastructure
4. **Easier Onboarding**: Structure reflects business domains
5. **Scalability**: New domains can be added independently